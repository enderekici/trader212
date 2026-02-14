import type { Trading212Client } from '../api/trading212/client.js';
import type { Order as T212Order } from '../api/trading212/types.js';
import {
  getOpenOrders,
  type Order,
  type OrderUpdate,
  updateOrderStatus,
} from '../db/repositories/orders.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('order-sync');

export interface SyncResult {
  synced: number;
  filled: number;
  cancelled: number;
  failed: number;
  errors: string[];
}

/**
 * OrderSynchronizer fetches order status from T212 for all open local orders
 * and updates local records to match the exchange state.
 */
export class OrderSynchronizer {
  private t212Client: Trading212Client;

  constructor(t212Client: Trading212Client) {
    this.t212Client = t212Client;
  }

  /**
   * Sync all open (pending/open/partially_filled) local orders
   * with the exchange state.
   */
  async syncOpenOrders(): Promise<SyncResult> {
    const result: SyncResult = {
      synced: 0,
      filled: 0,
      cancelled: 0,
      failed: 0,
      errors: [],
    };

    const openOrders = getOpenOrders();

    if (openOrders.length === 0) {
      log.debug('No open orders to sync');
      return result;
    }

    log.info({ count: openOrders.length }, 'Syncing open orders with T212');

    for (const localOrder of openOrders) {
      try {
        const update = await this.syncOrder(localOrder);
        if (update) {
          updateOrderStatus(localOrder.id, update);
          result.synced++;

          if (update.status === 'filled') result.filled++;
          else if (update.status === 'cancelled') result.cancelled++;
          else if (update.status === 'failed') result.failed++;
        }
      } catch (err) {
        const msg = `Failed to sync order ${localOrder.id}: ${err instanceof Error ? err.message : String(err)}`;
        log.error({ orderId: localOrder.id, err }, msg);
        result.errors.push(msg);
      }
    }

    log.info(
      {
        synced: result.synced,
        filled: result.filled,
        cancelled: result.cancelled,
        failed: result.failed,
      },
      'Order sync complete',
    );

    return result;
  }

  /**
   * Sync a single order with the exchange. Returns an OrderUpdate
   * if the local record needs updating, or null if no change needed.
   */
  async syncOrder(localOrder: Order): Promise<OrderUpdate | null> {
    // Skip orders without a T212 ID (e.g., pending orders that haven't been placed yet)
    if (!localOrder.t212OrderId) {
      // Check if the pending order is stale (created more than 5 minutes ago without T212 ID)
      if (localOrder.status === 'pending') {
        const createdAt = new Date(localOrder.createdAt).getTime();
        const ageMs = Date.now() - createdAt;
        if (ageMs > 5 * 60 * 1000) {
          log.warn(
            { orderId: localOrder.id, ageMs },
            'Stale pending order without T212 ID — marking as failed',
          );
          return {
            status: 'failed',
            cancelReason: 'Stale pending order: no exchange ID after 5 minutes',
          };
        }
      }
      return null;
    }

    // Skip dry-run orders
    if (localOrder.t212OrderId.startsWith('dry_run_')) {
      return null;
    }

    let t212Order: T212Order;
    try {
      t212Order = await this.t212Client.getOrder(Number(localOrder.t212OrderId));
    } catch (err) {
      log.warn(
        { orderId: localOrder.id, t212OrderId: localOrder.t212OrderId, err },
        'Failed to fetch T212 order — may have been removed',
      );
      return null;
    }

    const now = new Date().toISOString();

    // Map T212 status to local status
    switch (t212Order.status) {
      case 'FILLED': {
        if (localOrder.status === 'filled') return null; // Already up to date

        const filledPrice = this.extractFillPrice(t212Order);
        const filledQuantity = t212Order.filledQuantity ?? t212Order.quantity ?? 0;

        log.info(
          {
            orderId: localOrder.id,
            symbol: localOrder.symbol,
            filledPrice,
            filledQuantity,
          },
          'Order filled on exchange',
        );

        return {
          status: 'filled',
          filledQuantity,
          filledPrice: filledPrice ?? undefined,
          filledAt: now,
          updatedAt: now,
        };
      }

      case 'CANCELLED':
      case 'REJECTED': {
        if (localOrder.status === 'cancelled' || localOrder.status === 'failed') return null;

        log.info(
          { orderId: localOrder.id, symbol: localOrder.symbol, t212Status: t212Order.status },
          'Order cancelled/rejected on exchange',
        );

        return {
          status: t212Order.status === 'CANCELLED' ? 'cancelled' : 'failed',
          cancelReason: `Exchange status: ${t212Order.status}`,
          updatedAt: now,
        };
      }

      case 'NEW':
      case 'WORKING': {
        // Detect partial fills
        if (t212Order.filledQuantity && t212Order.filledQuantity > 0) {
          const requestedQty = localOrder.requestedQuantity;
          if (t212Order.filledQuantity < requestedQty) {
            if (localOrder.status !== 'partially_filled') {
              const filledPrice = this.extractFillPrice(t212Order);
              log.info(
                {
                  orderId: localOrder.id,
                  symbol: localOrder.symbol,
                  filledQuantity: t212Order.filledQuantity,
                  requestedQuantity: requestedQty,
                },
                'Partial fill detected',
              );

              return {
                status: 'partially_filled',
                filledQuantity: t212Order.filledQuantity,
                filledPrice: filledPrice ?? undefined,
                updatedAt: now,
              };
            }
          }
        }

        // Status is open/working, ensure local status reflects that
        if (localOrder.status === 'pending') {
          return {
            status: 'open',
            updatedAt: now,
          };
        }
        return null;
      }

      default:
        log.debug(
          { orderId: localOrder.id, t212Status: t212Order.status },
          'Unknown T212 order status',
        );
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
