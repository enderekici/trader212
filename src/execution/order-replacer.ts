import { eq } from 'drizzle-orm';
import type { Trading212Client } from '../api/trading212/client.js';
import type { Order as T212Order } from '../api/trading212/types.js';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import {
  cancelOrder,
  createOrder,
  findOrderReplacedBy,
  getOpenOrders,
  getOrderById,
  type Order,
  setReplacedByOrderId,
  updateOrderStatus,
} from '../db/repositories/orders.js';
import { positions } from '../db/schema.js';
import { sleep } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('order-replacer');

/** Tags that must never be replaced (protective orders). */
const PROTECTED_ORDER_TAGS = new Set(['stoploss', 'take_profit']);

export interface ReplaceResult {
  checked: number;
  replaced: number;
  skipped: number;
  filledDuringCancel: number;
  errors: string[];
}

export interface ReplaceOrderResult {
  success: boolean;
  newOrderId?: number;
  filledDuringCancel?: boolean;
  error?: string;
}

export class OrderReplacer {
  private t212Client: Trading212Client | null;

  constructor(t212Client: Trading212Client | null) {
    this.t212Client = t212Client;
  }

  /**
   * Check all open orders and replace stale ones whose market price
   * has deviated significantly from the requested price.
   */
  async processOpenOrders(): Promise<ReplaceResult> {
    const result: ReplaceResult = {
      checked: 0,
      replaced: 0,
      skipped: 0,
      filledDuringCancel: 0,
      errors: [],
    };

    const replaceAfterSeconds = configManager.get<number>(
      'execution.orderReplacement.replaceAfterSeconds',
    );
    const maxReplacements = configManager.get<number>('execution.orderReplacement.maxReplacements');

    const openOrders = getOpenOrders();
    if (openOrders.length === 0) {
      log.debug('No open orders to check for replacement');
      return result;
    }

    log.info({ count: openOrders.length }, 'Checking open orders for replacement');

    for (const order of openOrders) {
      result.checked++;

      // Skip protected order types (stoploss, take_profit)
      if (order.orderTag && PROTECTED_ORDER_TAGS.has(order.orderTag)) {
        result.skipped++;
        continue;
      }

      // Skip market orders (they fill immediately, no price to reprice)
      if (order.orderType === 'market') {
        result.skipped++;
        continue;
      }

      // Check order age
      const orderAgeMs = Date.now() - new Date(order.createdAt).getTime();
      const orderAgeSecs = orderAgeMs / 1000;
      if (orderAgeSecs < replaceAfterSeconds) {
        result.skipped++;
        continue;
      }

      // Count replacement chain depth
      const chainDepth = this.getReplacementChainDepth(order);
      if (chainDepth >= maxReplacements) {
        log.info(
          { orderId: order.id, symbol: order.symbol, chainDepth, maxReplacements },
          'Max replacements reached, skipping',
        );
        result.skipped++;
        continue;
      }

      // Get current market price
      const currentPrice = await this.getCurrentPrice(order.symbol);
      if (currentPrice == null) {
        log.warn({ symbol: order.symbol }, 'Could not get current price for replacement check');
        result.skipped++;
        continue;
      }

      // Check if price has deviated enough
      if (!this.shouldReplace(order, currentPrice)) {
        result.skipped++;
        continue;
      }

      // Attempt replacement
      try {
        const replaceResult = await this.replaceOrder(order.id, currentPrice);
        if (replaceResult.success) {
          result.replaced++;
          log.info(
            {
              symbol: order.symbol,
              oldOrderId: order.id,
              newOrderId: replaceResult.newOrderId,
              oldPrice: order.requestedPrice,
              newPrice: currentPrice,
            },
            'Order replaced with updated price',
          );
        } else if (replaceResult.filledDuringCancel) {
          result.filledDuringCancel++;
          log.info(
            { symbol: order.symbol, orderId: order.id },
            'Order filled during cancel attempt — no replacement needed',
          );
        } else {
          result.errors.push(
            `Failed to replace order ${order.id} (${order.symbol}): ${replaceResult.error}`,
          );
        }
      } catch (err) {
        const msg = `Error replacing order ${order.id} (${order.symbol}): ${err instanceof Error ? err.message : String(err)}`;
        log.error({ orderId: order.id, err }, msg);
        result.errors.push(msg);
      }
    }

    log.info(
      {
        checked: result.checked,
        replaced: result.replaced,
        skipped: result.skipped,
        filledDuringCancel: result.filledDuringCancel,
        errors: result.errors.length,
      },
      'Order replacement check complete',
    );

    return result;
  }

  /**
   * Replace a single order with a new price.
   * Handles the cancel-then-verify race condition carefully.
   */
  async replaceOrder(orderId: number, newPrice: number): Promise<ReplaceOrderResult> {
    const order = getOrderById(orderId);
    if (!order) {
      return { success: false, error: `Order ${orderId} not found` };
    }

    // Validate: never replace protected orders
    if (order.orderTag && PROTECTED_ORDER_TAGS.has(order.orderTag)) {
      return { success: false, error: `Cannot replace ${order.orderTag} order` };
    }

    const dryRun = configManager.get<boolean>('execution.dryRun');

    if (dryRun) {
      return this.replaceDryRun(order, newPrice);
    }

    return this.replaceLive(order, newPrice);
  }

  /**
   * Check if an order should be replaced based on price deviation.
   */
  shouldReplace(order: Order, currentPrice: number): boolean {
    const priceDeviationPct = configManager.get<number>(
      'execution.orderReplacement.priceDeviationPct',
    );

    if (order.requestedPrice == null || order.requestedPrice <= 0) {
      return false;
    }

    if (currentPrice <= 0) {
      return false;
    }

    const deviation = Math.abs(currentPrice - order.requestedPrice) / order.requestedPrice;
    return deviation > priceDeviationPct;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Dry-run replacement: cancel old, create new, fill immediately.
   */
  private replaceDryRun(order: Order, newPrice: number): ReplaceOrderResult {
    const now = new Date().toISOString();

    // Cancel old order
    cancelOrder(order.id, 'replaced');

    // Create new order at new price
    const newOrderId = createOrder({
      symbol: order.symbol,
      side: order.side as 'BUY' | 'SELL',
      orderType: order.orderType as 'market' | 'limit' | 'stop',
      requestedQuantity: order.requestedQuantity,
      requestedPrice: newPrice,
      stopPrice: order.stopPrice ?? undefined,
      orderTag: order.orderTag ?? 'entry',
      accountType: order.accountType as 'INVEST' | 'ISA',
    });

    // Link old order to new one
    setReplacedByOrderId(order.id, newOrderId);

    const dryT212Id = `dry_run_replace_${order.side}_${order.symbol}_${Date.now()}`;

    // Fill immediately in dry-run
    updateOrderStatus(newOrderId, {
      status: 'filled',
      t212OrderId: dryT212Id,
      filledQuantity: order.requestedQuantity,
      filledPrice: newPrice,
      filledAt: now,
    });

    log.info(
      {
        symbol: order.symbol,
        oldOrderId: order.id,
        newOrderId,
        oldPrice: order.requestedPrice,
        newPrice,
        mode: 'DRY_RUN',
      },
      'Simulated order replacement',
    );

    return { success: true, newOrderId };
  }

  /**
   * Live replacement: cancel on T212, verify cancellation, place new order.
   */
  private async replaceLive(order: Order, newPrice: number): Promise<ReplaceOrderResult> {
    if (!this.t212Client) {
      return { success: false, error: 'T212 client not initialized' };
    }

    if (!order.t212OrderId) {
      return { success: false, error: 'Order has no T212 ID — cannot cancel on exchange' };
    }

    // Skip dry-run T212 IDs
    if (order.t212OrderId.startsWith('dry_run_')) {
      return { success: false, error: 'Cannot replace dry-run order in live mode' };
    }

    const t212Id = Number(order.t212OrderId);
    const client = this.t212Client;

    // Step 1: Attempt cancel with retry
    let cancelled = false;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await client.cancelOrder(t212Id);
        cancelled = true;
        break;
      } catch (err) {
        log.warn(
          { orderId: order.id, t212Id, attempt, err },
          'Cancel attempt failed — checking order status',
        );

        // Check if order was filled in the meantime
        try {
          const t212Order: T212Order = await client.getOrder(t212Id);

          if (t212Order.status === 'FILLED') {
            // Order was filled — update our record
            const fillPrice = this.extractFillPrice(t212Order);
            const fillQty = t212Order.filledQuantity ?? t212Order.quantity ?? 0;

            updateOrderStatus(order.id, {
              status: 'filled',
              filledQuantity: fillQty,
              filledPrice: fillPrice ?? undefined,
              filledAt: new Date().toISOString(),
            });

            log.info(
              { orderId: order.id, t212Id, fillPrice },
              'Order filled during cancel — no replacement needed',
            );

            return { success: false, filledDuringCancel: true };
          }

          if (t212Order.status === 'CANCELLED' || t212Order.status === 'REJECTED') {
            cancelled = true;
            break;
          }

          // Still open — retry after delay
          if (attempt < maxRetries - 1) {
            await sleep(500);
          }
        } catch (statusErr) {
          log.error(
            { orderId: order.id, t212Id, statusErr },
            'Failed to check order status after cancel failure',
          );
          if (attempt < maxRetries - 1) {
            await sleep(500);
          }
        }
      }
    }

    if (!cancelled) {
      return {
        success: false,
        error: `Failed to cancel order ${order.id} after ${maxRetries} attempts`,
      };
    }

    // Step 2: Verify cancellation by fetching order status
    try {
      const verifyOrder: T212Order = await client.getOrder(t212Id);

      if (verifyOrder.status === 'FILLED') {
        const fillPrice = this.extractFillPrice(verifyOrder);
        const fillQty = verifyOrder.filledQuantity ?? verifyOrder.quantity ?? 0;
        updateOrderStatus(order.id, {
          status: 'filled',
          filledQuantity: fillQty,
          filledPrice: fillPrice ?? undefined,
          filledAt: new Date().toISOString(),
        });
        return { success: false, filledDuringCancel: true };
      }

      if (verifyOrder.status !== 'CANCELLED' && verifyOrder.status !== 'REJECTED') {
        return {
          success: false,
          error: `Order status after cancel is '${verifyOrder.status}', expected CANCELLED`,
        };
      }
    } catch (err) {
      // If we can't verify, proceed cautiously — cancel was accepted
      log.warn(
        { orderId: order.id, t212Id, err },
        'Could not verify cancel — proceeding with replacement',
      );
    }

    // Step 3: Mark old order as cancelled
    cancelOrder(order.id, 'replaced');

    // Step 4: Resolve T212 ticker for the symbol
    const ticker = await this.resolveT212Ticker(order.symbol, client, t212Id);
    if (!ticker) {
      return {
        success: false,
        error: `Could not resolve T212 ticker for ${order.symbol}`,
      };
    }

    // Step 5: Place new order at updated price
    try {
      let newT212Order: T212Order;

      if (order.orderType === 'limit') {
        newT212Order = await client.placeLimitOrder({
          ticker,
          quantity: order.requestedQuantity,
          limitPrice: newPrice,
          timeValidity: 'DAY',
        });
      } else if (order.orderType === 'stop') {
        newT212Order = await client.placeStopOrder({
          ticker,
          quantity: order.requestedQuantity,
          stopPrice: newPrice,
          timeValidity: 'DAY',
        });
      } else {
        newT212Order = await client.placeMarketOrder({
          ticker,
          quantity: order.requestedQuantity,
          timeValidity: 'DAY',
        });
      }

      // Step 6: Create new order record in DB
      const newOrderId = createOrder({
        symbol: order.symbol,
        side: order.side as 'BUY' | 'SELL',
        orderType: order.orderType as 'market' | 'limit' | 'stop',
        requestedQuantity: order.requestedQuantity,
        requestedPrice: newPrice,
        stopPrice: order.orderType === 'stop' ? newPrice : (order.stopPrice ?? undefined),
        orderTag: order.orderTag ?? 'entry',
        accountType: order.accountType as 'INVEST' | 'ISA',
      });

      // Update new order with T212 ID
      updateOrderStatus(newOrderId, {
        status: 'open',
        t212OrderId: String(newT212Order.id),
      });

      // Link old order to new one
      setReplacedByOrderId(order.id, newOrderId);

      log.info(
        {
          symbol: order.symbol,
          oldOrderId: order.id,
          newOrderId,
          newT212Id: newT212Order.id,
          oldPrice: order.requestedPrice,
          newPrice,
        },
        'Order replaced on exchange',
      );

      return { success: true, newOrderId };
    } catch (err) {
      log.error(
        { orderId: order.id, symbol: order.symbol, err },
        'Failed to place replacement order',
      );
      return {
        success: false,
        error: `Failed to place replacement: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Walk the replacement chain backwards to count how many times
   * the original order has been replaced.
   */
  private getReplacementChainDepth(order: Order): number {
    let depth = 0;
    let currentId = order.id;

    // Search backwards: find orders whose replacedByOrderId === currentId
    // Each such parent means we are one step further from the original
    let parentOrder = findOrderReplacedBy(currentId);

    while (parentOrder) {
      depth++;
      // Safety: prevent infinite loops on self-referential data
      if (parentOrder.id === currentId) break;
      currentId = parentOrder.id;
      parentOrder = findOrderReplacedBy(currentId);
    }

    return depth;
  }

  /**
   * Resolve the T212 ticker for a symbol by checking the T212 order
   * or falling back to the positions table.
   */
  private async resolveT212Ticker(
    symbol: string,
    client: Trading212Client,
    t212OrderId: number,
  ): Promise<string | undefined> {
    // Try to get ticker from the T212 order itself
    try {
      const t212Order: T212Order = await client.getOrder(t212OrderId);
      const ticker = t212Order.ticker ?? t212Order.instrument?.ticker;
      if (ticker) return ticker;
    } catch {
      // Fallback below
    }

    // Fallback: look up from positions table
    try {
      const db = getDb();
      const pos = db
        .select({ t212Ticker: positions.t212Ticker })
        .from(positions)
        .where(eq(positions.symbol, symbol))
        .get();
      return pos?.t212Ticker;
    } catch {
      return undefined;
    }
  }

  /**
   * Get current market price for a symbol.
   */
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

  /** Extract fill price from a T212 order response. */
  private extractFillPrice(t212Order: T212Order): number | null {
    if (
      t212Order.filledValue != null &&
      t212Order.filledQuantity != null &&
      t212Order.filledQuantity > 0
    ) {
      return t212Order.filledValue / t212Order.filledQuantity;
    }
    if (t212Order.value != null && t212Order.quantity != null && t212Order.quantity > 0) {
      return t212Order.value / t212Order.quantity;
    }
    return null;
  }
}
