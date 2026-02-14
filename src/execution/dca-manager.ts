import { eq } from 'drizzle-orm';
import type { Trading212Client } from '../api/trading212/client.js';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import { createOrder, updateOrderStatus } from '../db/repositories/orders.js';
import { positions, trades } from '../db/schema.js';
import { sleep } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('dca-manager');

export interface DCAEvaluation {
  shouldDCA: boolean;
  reason?: string;
  shares?: number;
  newAvgPrice?: number;
  dcaRound?: number;
}

export interface PortfolioState {
  cashAvailable: number;
}

export interface Position {
  symbol: string;
  shares: number;
  entryPrice: number;
  entryTime: string;
  dcaCount: number;
  totalInvested: number | null;
}

export class DCAManager {
  /**
   * Evaluate whether a position should trigger a DCA buy.
   * DCA triggers when price drops by (dropPctPerRound × (dcaRound + 1)) below original entry.
   */
  evaluatePosition(
    symbol: string,
    currentPrice: number,
    position: Position,
    portfolio: PortfolioState,
  ): DCAEvaluation {
    const enabled = configManager.get<boolean>('dca.enabled');
    if (!enabled) {
      return { shouldDCA: false, reason: 'DCA feature disabled' };
    }

    const maxRounds = configManager.get<number>('dca.maxRounds');
    const dropPctPerRound = configManager.get<number>('dca.dropPctPerRound');
    const sizeMultiplier = configManager.get<number>('dca.sizeMultiplier');
    const minTimeBetweenMinutes = configManager.get<number>('dca.minTimeBetweenMinutes');

    // Check max rounds
    if (position.dcaCount >= maxRounds) {
      return { shouldDCA: false, reason: `Max DCA rounds reached (${maxRounds})` };
    }

    const nextRound = position.dcaCount + 1;
    const requiredDrop = dropPctPerRound * nextRound;
    const triggerPrice = position.entryPrice * (1 - requiredDrop);

    // Check price drop threshold
    if (currentPrice >= triggerPrice) {
      const currentDrop = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
      return {
        shouldDCA: false,
        reason: `Price not low enough (current drop: ${currentDrop.toFixed(2)}%, need: ${(requiredDrop * 100).toFixed(2)}%)`,
      };
    }

    // Check time since last DCA or entry
    const db = getDb();
    const lastTrade = db
      .select()
      .from(trades)
      .where(eq(trades.symbol, symbol))
      .orderBy(trades.id)
      .all()
      .filter((t) => t.side === 'BUY')
      .pop();

    if (lastTrade) {
      const lastTradeTime = new Date(lastTrade.entryTime).getTime();
      const now = Date.now();
      const minutesSince = (now - lastTradeTime) / (1000 * 60);

      if (minutesSince < minTimeBetweenMinutes) {
        return {
          shouldDCA: false,
          reason: `Too soon since last buy (${minutesSince.toFixed(1)}m < ${minTimeBetweenMinutes}m)`,
        };
      }
    }

    // Calculate position size for this DCA round
    // Strategy: each DCA round buys originalShares × multiplier^dcaCount
    // We need to infer the original shares from the current position
    // If totalInvested is available and this is first DCA (dcaCount=0),
    // original shares = totalInvested / entryPrice
    // Otherwise, use current shares as the original size for simplicity
    const currentInvested = position.totalInvested ?? position.shares * position.entryPrice;
    const estimatedOriginalShares = currentInvested / position.entryPrice;

    // DCA share size for this round
    const dcaShares = Math.floor(estimatedOriginalShares * sizeMultiplier ** position.dcaCount);

    if (dcaShares < 1) {
      return {
        shouldDCA: false,
        reason: `Calculated DCA shares < 1 (${dcaShares.toFixed(2)})`,
      };
    }

    const dcaInvestment = dcaShares * currentPrice;

    // Check if portfolio has enough cash
    if (portfolio.cashAvailable < dcaInvestment) {
      return {
        shouldDCA: false,
        reason: `Insufficient cash ($${portfolio.cashAvailable.toFixed(2)} < $${dcaInvestment.toFixed(2)})`,
      };
    }

    // Calculate new average entry price
    const totalInvested = currentInvested + dcaInvestment;
    const totalShares = position.shares + dcaShares;
    const newAvgPrice = totalInvested / totalShares;

    log.info(
      {
        symbol,
        currentPrice,
        triggerPrice,
        dcaRound: nextRound,
        dcaShares,
        newAvgPrice,
      },
      'DCA trigger conditions met',
    );

    return {
      shouldDCA: true,
      shares: dcaShares,
      newAvgPrice,
      dcaRound: nextRound,
      reason: `Price dropped ${((1 - currentPrice / position.entryPrice) * 100).toFixed(2)}% (trigger at ${(requiredDrop * 100).toFixed(2)}%)`,
    };
  }

  /**
   * Execute a DCA buy order and update position accordingly.
   */
  async executeDCA(
    symbol: string,
    t212Ticker: string,
    shares: number,
    price: number,
    accountType: 'INVEST' | 'ISA',
    t212Client?: Trading212Client,
  ): Promise<{ success: boolean; error?: string }> {
    const dryRun = configManager.get<boolean>('execution.dryRun');
    const db = getDb();

    const position = db.select().from(positions).where(eq(positions.symbol, symbol)).get();
    if (!position) {
      return { success: false, error: `No position found for ${symbol}` };
    }

    const now = new Date().toISOString();
    const dcaRound = (position.dcaCount ?? 0) + 1;
    const dcaInvestment = shares * price;

    if (dryRun) {
      // Create order record
      const localOrderId = createOrder({
        symbol,
        side: 'BUY',
        orderType: 'market',
        requestedQuantity: shares,
        requestedPrice: price,
        orderTag: 'dca',
        accountType,
      });

      const dryT212Id = `dry_run_DCA_${symbol}_${Date.now()}`;

      // Update position with new average price
      const currentInvested = position.totalInvested ?? position.shares * position.entryPrice;
      const totalInvested = currentInvested + dcaInvestment;
      const totalShares = position.shares + shares;
      const newAvgPrice = totalInvested / totalShares;

      log.info(
        {
          symbol,
          dcaRound,
          shares,
          price,
          oldAvgPrice: position.entryPrice,
          newAvgPrice,
          totalShares,
          mode: 'DRY_RUN',
        },
        'DCA buy executed (simulated)',
      );

      db.transaction((tx) => {
        // Record DCA trade
        tx.insert(trades)
          .values({
            symbol,
            t212Ticker,
            side: 'BUY',
            shares,
            entryPrice: price,
            entryTime: now,
            aiReasoning: `DCA round ${dcaRound}`,
            convictionScore: 0,
            intendedPrice: price,
            slippage: 0,
            accountType,
            dcaRound,
          })
          .run();

        // Update position
        tx.update(positions)
          .set({
            shares: totalShares,
            entryPrice: newAvgPrice,
            dcaCount: dcaRound,
            totalInvested,
            currentPrice: price,
            pnl: (price - newAvgPrice) * totalShares,
            pnlPct: (price - newAvgPrice) / newAvgPrice,
            updatedAt: now,
          })
          .where(eq(positions.symbol, symbol))
          .run();
      });

      // Mark order as filled
      updateOrderStatus(localOrderId, {
        status: 'filled',
        t212OrderId: dryT212Id,
        filledQuantity: shares,
        filledPrice: price,
        filledAt: now,
      });

      return { success: true };
    }

    // Live execution
    if (!t212Client) {
      return { success: false, error: 'T212 client not initialized' };
    }

    const localOrderId = createOrder({
      symbol,
      side: 'BUY',
      orderType: 'market',
      requestedQuantity: shares,
      requestedPrice: price,
      orderTag: 'dca',
      accountType,
    });

    try {
      // Place market buy
      const order = await t212Client.placeMarketOrder({
        ticker: t212Ticker,
        quantity: shares,
        timeValidity: 'DAY',
      });

      log.info({ symbol, orderId: order.id, dcaRound }, 'DCA buy order placed');

      updateOrderStatus(localOrderId, {
        status: 'open',
        t212OrderId: String(order.id),
      });

      // Wait for fill
      const fillPrice = await this.waitForFill(t212Client, order.id);
      if (fillPrice == null) {
        updateOrderStatus(localOrderId, {
          status: 'failed',
          cancelReason: 'DCA order fill timeout',
        });
        return { success: false, error: 'DCA order fill timeout' };
      }

      updateOrderStatus(localOrderId, {
        status: 'filled',
        filledQuantity: shares,
        filledPrice: fillPrice,
        filledAt: new Date().toISOString(),
      });

      // Update position with new average price
      const currentInvested = position.totalInvested ?? position.shares * position.entryPrice;
      const totalInvested = currentInvested + shares * fillPrice;
      const totalShares = position.shares + shares;
      const newAvgPrice = totalInvested / totalShares;

      const buySlippage = (fillPrice - price) / price;

      db.transaction((tx) => {
        // Record DCA trade
        tx.insert(trades)
          .values({
            symbol,
            t212Ticker,
            side: 'BUY',
            shares,
            entryPrice: fillPrice,
            entryTime: now,
            aiReasoning: `DCA round ${dcaRound}`,
            convictionScore: 0,
            intendedPrice: price,
            slippage: buySlippage,
            accountType,
            dcaRound,
          })
          .run();

        // Update position
        tx.update(positions)
          .set({
            shares: totalShares,
            entryPrice: newAvgPrice,
            dcaCount: dcaRound,
            totalInvested,
            currentPrice: fillPrice,
            pnl: (fillPrice - newAvgPrice) * totalShares,
            pnlPct: (fillPrice - newAvgPrice) / newAvgPrice,
            updatedAt: now,
          })
          .where(eq(positions.symbol, symbol))
          .run();
      });

      log.info(
        {
          symbol,
          dcaRound,
          fillPrice,
          shares,
          newAvgPrice,
          totalShares,
        },
        'DCA buy executed and position updated',
      );

      return { success: true };
    } catch (err) {
      updateOrderStatus(localOrderId, {
        status: 'failed',
        cancelReason: err instanceof Error ? err.message : String(err),
      });
      log.error({ symbol, err }, 'Failed to execute DCA buy');
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
        if (order.filledValue != null && order.filledQuantity != null && order.filledQuantity > 0) {
          return order.filledValue / order.filledQuantity;
        }
        if (order.value != null && order.quantity != null && order.quantity > 0) {
          return order.value / order.quantity;
        }
        log.warn({ orderId }, 'DCA order filled but no price data available');
        return null;
      }

      if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
        log.error({ orderId, status: order.status }, 'DCA order was not filled');
        return null;
      }

      await sleep(500);
    }

    // Timeout
    log.warn({ orderId, timeoutSecs }, 'DCA order fill timed out — attempting cancel');
    try {
      await client.cancelOrder(orderId);
      log.info({ orderId }, 'Timed-out DCA order cancelled');
    } catch (cancelErr) {
      log.warn({ orderId, cancelErr }, 'Cancel failed — checking final DCA order status');
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
        log.error({ orderId, statusErr }, 'Failed to check final DCA order status');
      }
    }
    return null;
  }
}

// Singleton instance
let dcaManagerInstance: DCAManager | null = null;

export function getDCAManager(): DCAManager {
  if (!dcaManagerInstance) {
    dcaManagerInstance = new DCAManager();
  }
  return dcaManagerInstance;
}
