import { eq } from 'drizzle-orm';
import type { Trading212Client } from '../api/trading212/client.js';
import type { Order } from '../api/trading212/types.js';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
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

    // Duplicate protection: check if position already exists
    const existing = db.select().from(positions).where(eq(positions.symbol, params.symbol)).get();

    if (existing) {
      log.warn({ symbol: params.symbol }, 'Position already exists, skipping buy');
      return { success: false, error: `Position already exists for ${params.symbol}` };
    }

    const stopLossPrice = params.price * (1 - params.stopLossPct);
    const takeProfitPrice = params.price * (1 + params.takeProfitPct);
    const now = new Date().toISOString();

    if (dryRun) {
      log.info(
        {
          symbol: params.symbol,
          shares: params.shares,
          price: params.price,
          stopLoss: stopLossPrice,
          takeProfit: takeProfitPrice,
          mode: 'DRY_RUN',
        },
        'Simulated BUY order',
      );

      const trade = db
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
          accountType: params.accountType,
        })
        .run();

      db.insert(positions)
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
          accountType: params.accountType,
          updatedAt: now,
        })
        .run();

      return { success: true, tradeId: Number(trade.lastInsertRowid) };
    }

    // Live execution
    if (!this.t212Client) {
      return { success: false, error: 'T212 client not initialized' };
    }

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

      // Wait for fill with timeout
      const fillPrice = await this.waitForFill(client, order.id);
      if (fillPrice == null) {
        return { success: false, orderId: String(order.id), error: 'Order fill timeout' };
      }

      const actualStopLoss = fillPrice * (1 - params.stopLossPct);
      const actualTakeProfit = fillPrice * (1 + params.takeProfitPct);

      // Wait before placing stop order (exchange needs time to settle)
      const stopDelay = configManager.get<number>('execution.stopLossDelay');
      await sleep(stopDelay);

      // Place stop-loss order
      let stopOrderId: string | undefined;
      try {
        const stopOrder = await client.placeStopOrder({
          ticker: params.t212Ticker,
          quantity: params.shares,
          stopPrice: actualStopLoss,
          timeValidity: 'DAY',
        });
        stopOrderId = String(stopOrder.id);
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

      // Record trade
      const trade = db
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
          accountType: params.accountType,
        })
        .run();

      // Upsert position
      db.insert(positions)
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
          accountType: params.accountType,
          updatedAt: now,
        })
        .run();

      log.info(
        { symbol: params.symbol, fillPrice, shares: params.shares, orderId: order.id },
        'BUY order filled and recorded',
      );

      return { success: true, tradeId: Number(trade.lastInsertRowid), orderId: String(order.id) };
    } catch (err) {
      log.error({ symbol: params.symbol, err }, 'Failed to execute buy order');
      return { success: false, error: err instanceof Error ? err.message : String(err) };
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

    if (dryRun) {
      const exitPrice = position.currentPrice ?? position.entryPrice;
      const pnl = (exitPrice - position.entryPrice) * position.shares;
      const pnlPct = (exitPrice - position.entryPrice) / position.entryPrice;

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

      // Record closing trade
      db.insert(trades)
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
          accountType: params.accountType,
        })
        .run();

      // Remove position
      db.delete(positions).where(eq(positions.symbol, params.symbol)).run();

      return { success: true };
    }

    // Live execution
    if (!this.t212Client) {
      return { success: false, error: 'T212 client not initialized' };
    }

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

      // Place sell order via market order
      const order = await client.placeMarketOrder({
        ticker: params.t212Ticker,
        quantity: params.shares,
        timeValidity: 'DAY',
      });
      log.info({ symbol: params.symbol, orderId: order.id }, 'Market sell order placed');

      // Wait for fill
      const fillPrice = await this.waitForFill(client, order.id);
      if (fillPrice == null) {
        return { success: false, orderId: String(order.id), error: 'Sell order fill timeout' };
      }

      const pnl = (fillPrice - position.entryPrice) * position.shares;
      const pnlPct = (fillPrice - position.entryPrice) / position.entryPrice;

      // Record closing trade
      db.insert(trades)
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
          accountType: params.accountType,
        })
        .run();

      // Remove position
      db.delete(positions).where(eq(positions.symbol, params.symbol)).run();

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

      return { success: true, orderId: String(order.id) };
    } catch (err) {
      log.error({ symbol: params.symbol, err }, 'Failed to execute close order');
      return { success: false, error: err instanceof Error ? err.message : String(err) };
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

    // Timeout — attempt to cancel the order
    log.warn({ orderId, timeoutSecs }, 'Order fill timed out — attempting cancel');
    try {
      await client.cancelOrder(orderId);
      log.info({ orderId }, 'Timed-out order cancelled');
    } catch (cancelErr) {
      // Cancel failed — order may have filled in the meantime
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
