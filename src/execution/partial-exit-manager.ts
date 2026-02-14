import { eq } from 'drizzle-orm';
import type { Trading212Client } from '../api/trading212/client.js';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import { createOrder, updateOrderStatus } from '../db/repositories/orders.js';
import { positions, trades } from '../db/schema.js';
import { sleep } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('partial-exit');

interface PartialExitTier {
  pctGain: number;
  sellPct: number;
}

interface Position {
  id: number;
  symbol: string;
  t212Ticker: string;
  shares: number;
  entryPrice: number;
  entryTime: string;
  currentPrice: number | null;
  pnl: number | null;
  pnlPct: number | null;
  stopLoss: number | null;
  trailingStop: number | null;
  takeProfit: number | null;
  convictionScore: number | null;
  stopOrderId: string | null;
  takeProfitOrderId: string | null;
  aiExitConditions: string | null;
  accountType: 'INVEST' | 'ISA';
  dcaCount: number | null;
  totalInvested: number | null;
  partialExitCount: number | null;
  updatedAt: string | null;
}

interface EvaluationResult {
  shouldExit: boolean;
  tier?: PartialExitTier;
  sharesToSell?: number;
  reason?: string;
}

interface PartialExitResult {
  success: boolean;
  sharesToSell?: number;
  newStopLoss?: number;
  error?: string;
}

export class PartialExitManager {
  private t212Client: Trading212Client | null = null;

  setT212Client(client: Trading212Client): void {
    this.t212Client = client;
  }

  /**
   * Evaluate if a position should trigger a partial exit.
   * Returns the tier to execute and shares to sell.
   */
  evaluatePosition(position: Position): EvaluationResult {
    const enabled = configManager.get<boolean>('partialExit.enabled');
    if (!enabled) {
      return { shouldExit: false, reason: 'Partial exits disabled' };
    }

    // Can't exit if we don't have current price
    if (position.currentPrice == null) {
      return { shouldExit: false, reason: 'No current price available' };
    }

    // Calculate current P&L percentage
    const pnlPct = (position.currentPrice - position.entryPrice) / position.entryPrice;

    // Position not profitable
    if (pnlPct <= 0) {
      return { shouldExit: false, reason: 'Position not profitable' };
    }

    const tiers = configManager.get<PartialExitTier[]>('partialExit.tiers');
    const currentExitCount = position.partialExitCount ?? 0;

    // All tiers already executed
    if (currentExitCount >= tiers.length) {
      return { shouldExit: false, reason: 'All partial exit tiers already executed' };
    }

    // Get the next tier to execute
    const nextTier = tiers[currentExitCount];

    // Check if we've reached the next tier's profit threshold
    if (pnlPct >= nextTier.pctGain) {
      const sharesToSell = Math.floor(position.shares * nextTier.sellPct);

      // Ensure we sell at least 1 share and don't sell all shares
      if (sharesToSell < 1) {
        return {
          shouldExit: false,
          reason: `Tier ${currentExitCount + 1} triggered but calculated shares to sell (${sharesToSell}) is less than 1`,
        };
      }

      if (sharesToSell >= position.shares) {
        return {
          shouldExit: false,
          reason: `Tier ${currentExitCount + 1} would sell all shares (${sharesToSell} >= ${position.shares})`,
        };
      }

      log.info(
        {
          symbol: position.symbol,
          pnlPct: `${(pnlPct * 100).toFixed(2)}%`,
          tierNum: currentExitCount + 1,
          tierGain: `${(nextTier.pctGain * 100).toFixed(2)}%`,
          sellPct: `${(nextTier.sellPct * 100).toFixed(2)}%`,
          sharesToSell,
          remainingShares: position.shares - sharesToSell,
        },
        'Partial exit tier triggered',
      );

      return {
        shouldExit: true,
        tier: nextTier,
        sharesToSell,
        reason: `Tier ${currentExitCount + 1}: ${(nextTier.pctGain * 100).toFixed(1)}% gain reached`,
      };
    }

    return {
      shouldExit: false,
      reason: `Next tier (${currentExitCount + 1}) requires ${(nextTier.pctGain * 100).toFixed(1)}% gain, current: ${(pnlPct * 100).toFixed(1)}%`,
    };
  }

  /**
   * Get tiers that have not yet been triggered for a position.
   */
  getRemainingTiers(position: Position): PartialExitTier[] {
    const tiers = configManager.get<PartialExitTier[]>('partialExit.tiers');
    const currentExitCount = position.partialExitCount ?? 0;
    return tiers.slice(currentExitCount);
  }

  /**
   * Execute a partial exit by selling a portion of the position.
   */
  async executePartialExit(
    symbol: string,
    t212Ticker: string,
    sharesToSell: number,
    exitReason: string,
    accountType: 'INVEST' | 'ISA',
  ): Promise<PartialExitResult> {
    const dryRun = configManager.get<boolean>('execution.dryRun');
    const db = getDb();

    const position = db.select().from(positions).where(eq(positions.symbol, symbol)).get();

    if (!position) {
      log.warn({ symbol }, 'No position found for partial exit');
      return { success: false, error: `No position for ${symbol}` };
    }

    if (sharesToSell >= position.shares) {
      log.warn(
        { symbol, sharesToSell, totalShares: position.shares },
        'Cannot sell all shares in partial exit',
      );
      return {
        success: false,
        error: `Cannot sell ${sharesToSell} shares (total: ${position.shares})`,
      };
    }

    const now = new Date().toISOString();
    const exitPrice = position.currentPrice ?? position.entryPrice;
    const partialPnl = (exitPrice - position.entryPrice) * sharesToSell;
    const partialPnlPct = (exitPrice - position.entryPrice) / position.entryPrice;
    const isFirstPartialExit = (position.partialExitCount ?? 0) === 0;

    if (dryRun) {
      // Create order record for dry-run tracking
      const localOrderId = createOrder({
        symbol,
        side: 'SELL',
        orderType: 'market',
        requestedQuantity: sharesToSell,
        requestedPrice: exitPrice,
        orderTag: 'partial_exit',
        accountType,
      });

      const dryT212Id = `dry_run_PARTIAL_EXIT_${symbol}_${Date.now()}`;

      log.info(
        {
          symbol,
          sharesToSell,
          remainingShares: position.shares - sharesToSell,
          entryPrice: position.entryPrice,
          exitPrice,
          partialPnl,
          partialPnlPct: `${(partialPnlPct * 100).toFixed(2)}%`,
          exitReason,
          mode: 'DRY_RUN',
        },
        'Simulated partial exit',
      );

      // Record partial exit trade and update position atomically
      let newStopLoss = position.stopLoss;
      const moveToBreakeven = configManager.get<boolean>('partialExit.moveStopToBreakeven');

      if (moveToBreakeven && isFirstPartialExit) {
        newStopLoss = position.entryPrice;
        log.info(
          { symbol, newStopLoss },
          'Moving stop to breakeven after first partial exit (dry-run)',
        );
      }

      db.transaction((tx) => {
        // Create a SELL trade record for the partial exit
        tx.insert(trades)
          .values({
            symbol,
            t212Ticker,
            side: 'SELL',
            shares: sharesToSell,
            entryPrice: position.entryPrice,
            exitPrice,
            pnl: partialPnl,
            pnlPct: partialPnlPct,
            entryTime: position.entryTime,
            exitTime: now,
            exitReason,
            intendedPrice: exitPrice,
            slippage: 0,
            accountType,
          })
          .run();

        // Update position: reduce shares, increment partialExitCount
        tx.update(positions)
          .set({
            shares: position.shares - sharesToSell,
            stopLoss: newStopLoss,
            partialExitCount: (position.partialExitCount ?? 0) + 1,
            updatedAt: now,
          })
          .where(eq(positions.symbol, symbol))
          .run();
      });

      // Mark order as filled
      updateOrderStatus(localOrderId, {
        status: 'filled',
        t212OrderId: dryT212Id,
        filledQuantity: sharesToSell,
        filledPrice: exitPrice,
        filledAt: now,
      });

      return { success: true, sharesToSell, newStopLoss: newStopLoss ?? undefined };
    }

    // Live execution
    if (!this.t212Client) {
      return { success: false, error: 'T212 client not initialized' };
    }

    // Create pending order record
    const localOrderId = createOrder({
      symbol,
      side: 'SELL',
      orderType: 'market',
      requestedQuantity: sharesToSell,
      requestedPrice: exitPrice,
      orderTag: 'partial_exit',
      accountType,
    });

    try {
      const client = this.t212Client;
      if (!client) throw new Error('Trading212 client not initialized');

      // Place market sell order for partial shares
      const order = await client.placeMarketOrder({
        ticker: t212Ticker,
        quantity: sharesToSell,
        timeValidity: 'DAY',
      });
      log.info({ symbol, orderId: order.id, sharesToSell }, 'Partial exit market order placed');

      // Update order with exchange ID
      updateOrderStatus(localOrderId, {
        status: 'open',
        t212OrderId: String(order.id),
      });

      // Wait for fill
      const fillPrice = await this.waitForFill(client, order.id);
      if (fillPrice == null) {
        updateOrderStatus(localOrderId, {
          status: 'failed',
          cancelReason: 'Partial exit order fill timeout',
        });
        return {
          success: false,
          error: 'Partial exit order fill timeout',
        };
      }

      // Mark order as filled
      updateOrderStatus(localOrderId, {
        status: 'filled',
        filledQuantity: sharesToSell,
        filledPrice: fillPrice,
        filledAt: new Date().toISOString(),
      });

      const actualPartialPnl = (fillPrice - position.entryPrice) * sharesToSell;
      const actualPartialPnlPct = (fillPrice - position.entryPrice) / position.entryPrice;
      const intendedExitPrice = position.currentPrice ?? position.entryPrice;
      const sellSlippage = (intendedExitPrice - fillPrice) / intendedExitPrice;

      // Determine new stop-loss if this is the first partial exit
      let newStopLoss = position.stopLoss;
      const moveToBreakeven = configManager.get<boolean>('partialExit.moveStopToBreakeven');

      if (moveToBreakeven && isFirstPartialExit && position.stopOrderId) {
        newStopLoss = position.entryPrice;

        // Cancel old stop order
        try {
          await client.cancelOrder(Number(position.stopOrderId));
          log.info({ symbol, oldStopOrderId: position.stopOrderId }, 'Cancelled old stop order');
        } catch (err) {
          log.warn({ symbol, err }, 'Failed to cancel old stop order');
        }

        // Wait before placing new stop (exchange needs time)
        const stopDelay = configManager.get<number>('execution.stopLossDelay');
        await sleep(stopDelay);

        // Place new stop at breakeven
        const newShares = position.shares - sharesToSell;
        try {
          const slOrderId = createOrder({
            symbol,
            side: 'SELL',
            orderType: 'stop',
            requestedQuantity: newShares,
            stopPrice: newStopLoss,
            orderTag: 'stoploss',
            accountType,
          });

          const stopOrder = await client.placeStopOrder({
            ticker: t212Ticker,
            quantity: newShares,
            stopPrice: newStopLoss,
            timeValidity: 'GTC',
          });

          updateOrderStatus(slOrderId, {
            status: 'open',
            t212OrderId: String(stopOrder.id),
          });

          log.info(
            { symbol, newStopOrderId: stopOrder.id, newStopLoss },
            'Moved stop to breakeven after first partial exit',
          );

          // Update position with new stop order ID
          db.update(positions)
            .set({ stopOrderId: String(stopOrder.id) })
            .where(eq(positions.symbol, symbol))
            .run();
        } catch (err) {
          log.error({ symbol, err }, 'Failed to place new stop-loss at breakeven');
        }
      }

      // Record partial exit trade and update position atomically
      db.transaction((tx) => {
        // Create a SELL trade record for the partial exit
        tx.insert(trades)
          .values({
            symbol,
            t212Ticker,
            side: 'SELL',
            shares: sharesToSell,
            entryPrice: position.entryPrice,
            exitPrice: fillPrice,
            pnl: actualPartialPnl,
            pnlPct: actualPartialPnlPct,
            entryTime: position.entryTime,
            exitTime: now,
            exitReason,
            intendedPrice: intendedExitPrice,
            slippage: sellSlippage,
            accountType,
          })
          .run();

        // Update position: reduce shares, increment partialExitCount, update stop
        tx.update(positions)
          .set({
            shares: position.shares - sharesToSell,
            stopLoss: newStopLoss,
            partialExitCount: (position.partialExitCount ?? 0) + 1,
            updatedAt: now,
          })
          .where(eq(positions.symbol, symbol))
          .run();
      });

      log.info(
        {
          symbol,
          sharesToSell,
          remainingShares: position.shares - sharesToSell,
          fillPrice,
          partialPnl: actualPartialPnl,
          partialPnlPct: `${(actualPartialPnlPct * 100).toFixed(2)}%`,
          newStopLoss,
          exitReason,
        },
        'Partial exit executed',
      );

      return {
        success: true,
        sharesToSell,
        newStopLoss: newStopLoss ?? undefined,
      };
    } catch (err) {
      updateOrderStatus(localOrderId, {
        status: 'failed',
        cancelReason: err instanceof Error ? err.message : String(err),
      });
      log.error({ symbol, err }, 'Failed to execute partial exit');
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async waitForFill(client: Trading212Client, orderId: number): Promise<number | null> {
    const timeoutSecs = configManager.get<number>('execution.orderTimeoutSeconds');
    const maxAttempts = timeoutSecs * 2; // Poll every 500ms

    for (let i = 0; i < maxAttempts; i++) {
      const order = await client.getOrder(orderId);

      if (order.status === 'FILLED') {
        // Compute fill price from filledValue / filledQuantity
        if (order.filledValue != null && order.filledQuantity != null && order.filledQuantity > 0) {
          return order.filledValue / order.filledQuantity;
        }
        // Fallback: use the order's value/quantity
        if (order.value != null && order.quantity != null && order.quantity > 0) {
          return order.value / order.quantity;
        }
        log.warn({ orderId }, 'Order filled but no price data available');
        return null;
      }

      if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
        log.error({ orderId, status: order.status }, 'Order was not filled');
        return null;
      }

      await sleep(500);
    }

    // Timeout -- attempt to cancel the order
    log.warn({ orderId, timeoutSecs }, 'Order fill timed out — attempting cancel');
    try {
      await client.cancelOrder(orderId);
      log.info({ orderId }, 'Timed-out order cancelled');
    } catch (cancelErr) {
      // Cancel failed -- order may have filled in the meantime
      log.warn({ orderId, cancelErr }, 'Cancel failed — checking final status');
      try {
        const finalOrder = await client.getOrder(orderId);
        if (finalOrder.status === 'FILLED') {
          if (
            finalOrder.filledValue != null &&
            finalOrder.filledQuantity != null &&
            finalOrder.filledQuantity > 0
          ) {
            return finalOrder.filledValue / finalOrder.filledQuantity;
          }
        }
      } catch (statusErr) {
        log.error({ orderId, statusErr }, 'Failed to check final order status');
      }
    }
    return null;
  }
}

// Singleton instance
let instance: PartialExitManager | null = null;

export function getPartialExitManager(): PartialExitManager {
  if (!instance) {
    instance = new PartialExitManager();
  }
  return instance;
}
