import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Trading212Client } from '../api/trading212/client.js';
import type { Order } from '../api/trading212/types.js';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import { createOrder, updateOrderStatus } from '../db/repositories/orders.js';
import { positions, trades } from '../db/schema.js';
import { sleep } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('order-manager');

export interface BuyParams {
  symbol: string;
  t212Ticker: string;
  shares: number;
  price: number;
  stopLossPct: number;
  takeProfitPct: number;
  aiReasoning: string;
  conviction: number;
  aiModel: string;
  accountType: 'INVEST' | 'ISA';
}

export interface CloseParams {
  symbol: string;
  t212Ticker: string;
  shares: number;
  exitReason: string;
  accountType: 'INVEST' | 'ISA';
}

export interface OrderResult {
  success: boolean;
  tradeId?: number;
  orderId?: string;
  localOrderId?: number;
  error?: string;
}

export class OrderManager {
  private t212Client: Trading212Client | null = null;

  setT212Client(client: Trading212Client): void {
    this.t212Client = client;
  }

  async executeBuy(params: BuyParams): Promise<OrderResult> {
    const dryRun = configManager.get<boolean>('execution.dryRun');
    const db = getDb();

    const stopLossPrice = params.price * (1 - params.stopLossPct);
    const takeProfitPrice = params.price * (1 + params.takeProfitPct);
    const now = new Date().toISOString();

    if (dryRun) {
      // Create order record for dry-run tracking
      const localOrderId = createOrder({
        symbol: params.symbol,
        side: 'BUY',
        orderType: 'market',
        requestedQuantity: params.shares,
        requestedPrice: params.price,
        orderTag: 'entry',
        accountType: params.accountType,
      });

      const dryT212Id = `dry_run_BUY_${params.symbol}_${Date.now()}`;
      const dryTpOrderId =
        params.takeProfitPct > 0
          ? `tp-dry-${Date.now()}-${randomBytes(4).toString('hex')}`
          : undefined;

      log.info(
        {
          symbol: params.symbol,
          shares: params.shares,
          price: params.price,
          stopLoss: stopLossPrice,
          takeProfit: takeProfitPrice,
          takeProfitOrderId: dryTpOrderId,
          mode: 'DRY_RUN',
        },
        'Simulated BUY order',
      );

      let tradeRowId: number | bigint = 0;
      let duplicateError = false;
      db.transaction((tx) => {
        // Duplicate check inside transaction to prevent race conditions
        const existing = tx
          .select()
          .from(positions)
          .where(eq(positions.symbol, params.symbol))
          .get();
        if (existing) {
          duplicateError = true;
          return;
        }

        const trade = tx
          .insert(trades)
          .values({
            symbol: params.symbol,
            t212Ticker: params.t212Ticker,
            side: 'BUY',
            shares: params.shares,
            entryPrice: params.price,
            entryTime: now,
            stopLoss: stopLossPrice,
            takeProfit: takeProfitPrice,
            aiReasoning: params.aiReasoning,
            convictionScore: params.conviction,
            aiModel: params.aiModel,
            intendedPrice: params.price,
            slippage: 0,
            accountType: params.accountType,
          })
          .run();

        tradeRowId = trade.lastInsertRowid;

        tx.insert(positions)
          .values({
            symbol: params.symbol,
            t212Ticker: params.t212Ticker,
            shares: params.shares,
            entryPrice: params.price,
            entryTime: now,
            currentPrice: params.price,
            pnl: 0,
            pnlPct: 0,
            stopLoss: stopLossPrice,
            takeProfit: takeProfitPrice,
            convictionScore: params.conviction,
            takeProfitOrderId: dryTpOrderId,
            accountType: params.accountType,
            updatedAt: now,
          })
          .run();
      });

      if (duplicateError) {
        log.warn({ symbol: params.symbol }, 'Position already exists, skipping buy');
        return { success: false, error: `Position already exists for ${params.symbol}` };
      }

      // Update order as filled immediately in dry-run
      updateOrderStatus(localOrderId, {
        status: 'filled',
        t212OrderId: dryT212Id,
        filledQuantity: params.shares,
        filledPrice: params.price,
        filledAt: now,
      });

      return { success: true, tradeId: Number(tradeRowId), localOrderId };
    }

    // Live execution
    if (!this.t212Client) {
      return { success: false, error: 'T212 client not initialized' };
    }

    // Duplicate protection: check if position already exists (before placing on exchange)
    const existing = db.select().from(positions).where(eq(positions.symbol, params.symbol)).get();
    if (existing) {
      log.warn({ symbol: params.symbol }, 'Position already exists, skipping buy');
      return { success: false, error: `Position already exists for ${params.symbol}` };
    }

    // Create pending order record before placing on exchange
    const localOrderId = createOrder({
      symbol: params.symbol,
      side: 'BUY',
      orderType: 'market',
      requestedQuantity: params.shares,
      requestedPrice: params.price,
      orderTag: 'entry',
      accountType: params.accountType,
    });

    try {
      const client = this.t212Client;
      if (!client) throw new Error('Trading212 client not initialized');

      // Place market order
      const order = await client.placeMarketOrder({
        ticker: params.t212Ticker,
        quantity: params.shares,
        timeValidity: 'DAY',
      });
      log.info({ symbol: params.symbol, orderId: order.id }, 'Market buy order placed');

      // Update order with exchange ID and status
      updateOrderStatus(localOrderId, {
        status: 'open',
        t212OrderId: String(order.id),
      });

      // Wait for fill with timeout
      const fillPrice = await this.waitForFill(client, order.id);
      if (fillPrice == null) {
        updateOrderStatus(localOrderId, {
          status: 'failed',
          cancelReason: 'Order fill timeout',
        });
        return {
          success: false,
          orderId: String(order.id),
          localOrderId,
          error: 'Order fill timeout',
        };
      }

      // Mark entry order as filled
      updateOrderStatus(localOrderId, {
        status: 'filled',
        filledQuantity: params.shares,
        filledPrice: fillPrice,
        filledAt: new Date().toISOString(),
      });

      const actualStopLoss = fillPrice * (1 - params.stopLossPct);
      const actualTakeProfit = fillPrice * (1 + params.takeProfitPct);

      // Wait before placing stop order (exchange needs time to settle)
      const stopDelay = configManager.get<number>('execution.stopLossDelay');
      await sleep(stopDelay);

      // Place stop-loss order (GTC so it persists across trading sessions)
      let stopOrderId: string | undefined;
      try {
        // Track the stop-loss order
        const slOrderId = createOrder({
          symbol: params.symbol,
          side: 'SELL',
          orderType: 'stop',
          requestedQuantity: params.shares,
          stopPrice: actualStopLoss,
          orderTag: 'stoploss',
          accountType: params.accountType,
        });

        const stopOrder = await client.placeStopOrder({
          ticker: params.t212Ticker,
          quantity: params.shares,
          stopPrice: actualStopLoss,
          timeValidity: 'GTC',
        });
        stopOrderId = String(stopOrder.id);

        updateOrderStatus(slOrderId, {
          status: 'open',
          t212OrderId: stopOrderId,
        });

        log.info(
          { symbol: params.symbol, stopOrderId, stopPrice: actualStopLoss },
          'Stop-loss order placed',
        );
      } catch (err) {
        log.error(
          { symbol: params.symbol, err },
          'Failed to place stop-loss — closing unprotected position',
        );
        try {
          await client.placeMarketOrder({
            ticker: params.t212Ticker,
            quantity: params.shares,
            timeValidity: 'DAY',
          });
          log.warn({ symbol: params.symbol }, 'Position closed after stop-loss failure');
        } catch (closeErr) {
          log.fatal(
            { symbol: params.symbol, closeErr },
            'FATAL: Cannot close unprotected position — MANUAL INTERVENTION REQUIRED',
          );
        }
      }

      // Place take-profit limit order (GTC) -- only if takeProfitPct is set
      let takeProfitOrderId: string | undefined;
      if (params.takeProfitPct > 0) {
        try {
          const tpLocalId = createOrder({
            symbol: params.symbol,
            side: 'SELL',
            orderType: 'limit',
            requestedQuantity: params.shares,
            requestedPrice: actualTakeProfit,
            orderTag: 'take_profit',
            accountType: params.accountType,
          });

          const tpOrder = await client.placeLimitOrder({
            ticker: params.t212Ticker,
            quantity: params.shares,
            limitPrice: actualTakeProfit,
            timeValidity: 'GTC',
          });
          takeProfitOrderId = String(tpOrder.id);

          updateOrderStatus(tpLocalId, {
            status: 'open',
            t212OrderId: takeProfitOrderId,
          });

          log.info(
            { symbol: params.symbol, takeProfitOrderId, takeProfitPrice: actualTakeProfit },
            'Take-profit limit order placed',
          );
        } catch (err) {
          log.warn(
            { symbol: params.symbol, err },
            'Failed to place take-profit order — position remains open without TP on exchange',
          );
        }
      }

      // Record trade and position atomically
      const buySlippage = (fillPrice - params.price) / params.price;
      let tradeRowId: number | bigint = 0;
      db.transaction((tx) => {
        const trade = tx
          .insert(trades)
          .values({
            symbol: params.symbol,
            t212Ticker: params.t212Ticker,
            side: 'BUY',
            shares: params.shares,
            entryPrice: fillPrice,
            entryTime: now,
            stopLoss: actualStopLoss,
            takeProfit: actualTakeProfit,
            aiReasoning: params.aiReasoning,
            convictionScore: params.conviction,
            aiModel: params.aiModel,
            intendedPrice: params.price,
            slippage: buySlippage,
            accountType: params.accountType,
          })
          .run();

        tradeRowId = trade.lastInsertRowid;

        tx.insert(positions)
          .values({
            symbol: params.symbol,
            t212Ticker: params.t212Ticker,
            shares: params.shares,
            entryPrice: fillPrice,
            entryTime: now,
            currentPrice: fillPrice,
            pnl: 0,
            pnlPct: 0,
            stopLoss: actualStopLoss,
            takeProfit: actualTakeProfit,
            convictionScore: params.conviction,
            stopOrderId,
            takeProfitOrderId,
            accountType: params.accountType,
            updatedAt: now,
          })
          .run();
      });

      log.info(
        { symbol: params.symbol, fillPrice, shares: params.shares, orderId: order.id },
        'BUY order filled and recorded',
      );

      return {
        success: true,
        tradeId: Number(tradeRowId),
        orderId: String(order.id),
        localOrderId,
      };
    } catch (err) {
      updateOrderStatus(localOrderId, {
        status: 'failed',
        cancelReason: err instanceof Error ? err.message : String(err),
      });
      log.error({ symbol: params.symbol, err }, 'Failed to execute buy order');
      return {
        success: false,
        localOrderId,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async executeClose(params: CloseParams): Promise<OrderResult> {
    const dryRun = configManager.get<boolean>('execution.dryRun');
    const db = getDb();

    const position = db.select().from(positions).where(eq(positions.symbol, params.symbol)).get();

    if (!position) {
      log.warn({ symbol: params.symbol }, 'No position found to close');
      return { success: false, error: `No position for ${params.symbol}` };
    }

    const now = new Date().toISOString();

    // Determine order tag based on exit reason
    const orderTag = this.resolveExitOrderTag(params.exitReason);

    if (dryRun) {
      const exitPrice = position.currentPrice ?? position.entryPrice;
      const pnl = (exitPrice - position.entryPrice) * position.shares;
      const pnlPct = (exitPrice - position.entryPrice) / position.entryPrice;

      // Create order record for dry-run tracking
      const localOrderId = createOrder({
        symbol: params.symbol,
        side: 'SELL',
        orderType: 'market',
        requestedQuantity: params.shares,
        requestedPrice: exitPrice,
        orderTag,
        accountType: params.accountType,
      });

      const dryT212Id = `dry_run_SELL_${params.symbol}_${Date.now()}`;

      log.info(
        {
          symbol: params.symbol,
          shares: params.shares,
          entryPrice: position.entryPrice,
          exitPrice,
          pnl,
          pnlPct: `${(pnlPct * 100).toFixed(2)}%`,
          exitReason: params.exitReason,
          mode: 'DRY_RUN',
        },
        'Simulated CLOSE order',
      );

      // Record closing trade and remove position atomically
      db.transaction((tx) => {
        tx.insert(trades)
          .values({
            symbol: params.symbol,
            t212Ticker: params.t212Ticker,
            side: 'SELL',
            shares: params.shares,
            entryPrice: position.entryPrice,
            exitPrice,
            pnl,
            pnlPct,
            entryTime: position.entryTime,
            exitTime: now,
            exitReason: params.exitReason,
            intendedPrice: exitPrice,
            slippage: 0,
            accountType: params.accountType,
          })
          .run();

        tx.delete(positions).where(eq(positions.symbol, params.symbol)).run();
      });

      // Mark order as filled
      updateOrderStatus(localOrderId, {
        status: 'filled',
        t212OrderId: dryT212Id,
        filledQuantity: params.shares,
        filledPrice: exitPrice,
        filledAt: now,
      });

      return { success: true, localOrderId };
    }

    // Live execution
    if (!this.t212Client) {
      return { success: false, error: 'T212 client not initialized' };
    }

    // Create pending order record
    const localOrderId = createOrder({
      symbol: params.symbol,
      side: 'SELL',
      orderType: 'market',
      requestedQuantity: params.shares,
      requestedPrice: position.currentPrice ?? position.entryPrice,
      orderTag,
      accountType: params.accountType,
    });

    try {
      const client = this.t212Client;
      if (!client) throw new Error('Trading212 client not initialized');

      // Cancel existing stop order if present
      if (position.stopOrderId) {
        try {
          await client.cancelOrder(Number(position.stopOrderId));
          log.info(
            { symbol: params.symbol, stopOrderId: position.stopOrderId },
            'Cancelled stop order',
          );
        } catch (err) {
          log.warn(
            { symbol: params.symbol, err },
            'Failed to cancel stop order (may already be filled)',
          );
        }
      }

      // Cancel existing take-profit order if present
      if (position.takeProfitOrderId) {
        try {
          await client.cancelOrder(Number(position.takeProfitOrderId));
          log.info(
            { symbol: params.symbol, takeProfitOrderId: position.takeProfitOrderId },
            'Cancelled take-profit order',
          );
        } catch (err) {
          log.warn(
            { symbol: params.symbol, err },
            'Failed to cancel take-profit order (may already be filled)',
          );
        }
      }

      // Place sell order via market order
      const order = await client.placeMarketOrder({
        ticker: params.t212Ticker,
        quantity: params.shares,
        timeValidity: 'DAY',
      });
      log.info({ symbol: params.symbol, orderId: order.id }, 'Market sell order placed');

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
          cancelReason: 'Sell order fill timeout',
        });
        return {
          success: false,
          orderId: String(order.id),
          localOrderId,
          error: 'Sell order fill timeout',
        };
      }

      // Mark order as filled
      updateOrderStatus(localOrderId, {
        status: 'filled',
        filledQuantity: params.shares,
        filledPrice: fillPrice,
        filledAt: new Date().toISOString(),
      });

      const pnl = (fillPrice - position.entryPrice) * position.shares;
      const pnlPct = (fillPrice - position.entryPrice) / position.entryPrice;

      // Slippage tracking for sells: intended price is what the bot saw at decision time
      const intendedExitPrice = position.currentPrice ?? position.entryPrice;
      const sellSlippage = (intendedExitPrice - fillPrice) / intendedExitPrice;

      // Record closing trade and remove position atomically
      db.transaction((tx) => {
        tx.insert(trades)
          .values({
            symbol: params.symbol,
            t212Ticker: params.t212Ticker,
            side: 'SELL',
            shares: params.shares,
            entryPrice: position.entryPrice,
            exitPrice: fillPrice,
            pnl,
            pnlPct,
            entryTime: position.entryTime,
            exitTime: now,
            exitReason: params.exitReason,
            intendedPrice: intendedExitPrice,
            slippage: sellSlippage,
            accountType: params.accountType,
          })
          .run();

        tx.delete(positions).where(eq(positions.symbol, params.symbol)).run();
      });

      log.info(
        {
          symbol: params.symbol,
          fillPrice,
          pnl,
          pnlPct: `${(pnlPct * 100).toFixed(2)}%`,
          exitReason: params.exitReason,
        },
        'Position closed',
      );

      return { success: true, orderId: String(order.id), localOrderId };
    } catch (err) {
      updateOrderStatus(localOrderId, {
        status: 'failed',
        cancelReason: err instanceof Error ? err.message : String(err),
      });
      log.error({ symbol: params.symbol, err }, 'Failed to execute close order');
      return {
        success: false,
        localOrderId,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getCurrentPrice(symbol: string): Promise<number | null> {
    try {
      const { YahooFinanceClient } = await import('../data/yahoo-finance.js');
      const yahoo = new YahooFinanceClient();
      const quote = await yahoo.getQuote(symbol);
      return quote?.price ?? null;
    } catch (err) {
      log.error({ symbol, err }, 'Failed to get current price');
      return null;
    }
  }

  /** Map exit reason text to an order tag. */
  private resolveExitOrderTag(exitReason: string): string {
    const lower = exitReason.toLowerCase();
    if (lower.includes('take profit') || lower.includes('take-profit') || lower.includes('tp ')) {
      return 'take_profit';
    }
    if (lower.includes('stoploss') || lower.includes('stop-loss') || lower.includes('stop loss')) {
      return 'stoploss';
    }
    if (lower.includes('partial')) {
      return 'partial_exit';
    }
    return 'exit';
  }

  private async waitForFill(client: Trading212Client, orderId: number): Promise<number | null> {
    const timeoutSecs = configManager.get<number>('execution.orderTimeoutSeconds');
    const maxAttempts = timeoutSecs * 2; // Poll every 500ms

    for (let i = 0; i < maxAttempts; i++) {
      const order: Order = await client.getOrder(orderId);

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
        const finalOrder: Order = await client.getOrder(orderId);
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
