import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../index.js';
import { orders } from '../schema.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type Order = typeof orders.$inferSelect;

export type OrderStatus =
  | 'pending'
  | 'open'
  | 'filled'
  | 'partially_filled'
  | 'cancelled'
  | 'expired'
  | 'failed';

export interface NewOrder {
  tradeId?: number;
  positionId?: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'market' | 'limit' | 'stop';
  requestedQuantity: number;
  requestedPrice?: number;
  stopPrice?: number;
  orderTag: string; // 'entry' | 'exit' | 'dca' | 'stoploss' | 'take_profit' | 'partial_exit'
  accountType: 'INVEST' | 'ISA';
}

export interface OrderUpdate {
  status?: OrderStatus;
  filledQuantity?: number;
  filledPrice?: number;
  t212OrderId?: string;
  cancelReason?: string;
  filledAt?: string;
  updatedAt?: string;
}

// ── Repository functions ───────────────────────────────────────────────────

/** Create a new order record. Returns the order ID. */
export function createOrder(order: NewOrder): number {
  const db = getDb();
  const now = new Date().toISOString();

  const result = db
    .insert(orders)
    .values({
      tradeId: order.tradeId ?? null,
      positionId: order.positionId ?? null,
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      status: 'pending',
      requestedQuantity: order.requestedQuantity,
      requestedPrice: order.requestedPrice ?? null,
      stopPrice: order.stopPrice ?? null,
      orderTag: order.orderTag,
      accountType: order.accountType,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return Number(result.lastInsertRowid);
}

/** Update order status and/or fill information. */
export function updateOrderStatus(orderId: number, updates: OrderUpdate): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.update(orders)
    .set({
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.filledQuantity !== undefined && { filledQuantity: updates.filledQuantity }),
      ...(updates.filledPrice !== undefined && { filledPrice: updates.filledPrice }),
      ...(updates.t212OrderId !== undefined && { t212OrderId: updates.t212OrderId }),
      ...(updates.cancelReason !== undefined && { cancelReason: updates.cancelReason }),
      ...(updates.filledAt !== undefined && { filledAt: updates.filledAt }),
      updatedAt: updates.updatedAt ?? now,
    })
    .where(eq(orders.id, orderId))
    .run();
}

/** Get all orders for a trade. */
export function getOrdersByTrade(tradeId: number): Order[] {
  const db = getDb();
  return db
    .select()
    .from(orders)
    .where(eq(orders.tradeId, tradeId))
    .orderBy(desc(orders.createdAt))
    .all();
}

/** Get all orders for a position. */
export function getOrdersByPosition(positionId: number): Order[] {
  const db = getDb();
  return db
    .select()
    .from(orders)
    .where(eq(orders.positionId, positionId))
    .orderBy(desc(orders.createdAt))
    .all();
}

/** Get all orders for a symbol. */
export function getOrdersBySymbol(symbol: string): Order[] {
  const db = getDb();
  return db
    .select()
    .from(orders)
    .where(eq(orders.symbol, symbol))
    .orderBy(desc(orders.createdAt))
    .all();
}

/** Get all open (unfilled) orders -- pending, open, or partially_filled. */
export function getOpenOrders(): Order[] {
  const db = getDb();
  return db
    .select()
    .from(orders)
    .where(inArray(orders.status, ['pending', 'open', 'partially_filled']))
    .orderBy(desc(orders.createdAt))
    .all();
}

/** Get order by T212 exchange order ID. */
export function getOrderByT212Id(t212OrderId: string): Order | undefined {
  const db = getDb();
  return db.select().from(orders).where(eq(orders.t212OrderId, t212OrderId)).get();
}

/** Get order by local ID. */
export function getOrderById(orderId: number): Order | undefined {
  const db = getDb();
  return db.select().from(orders).where(eq(orders.id, orderId)).get();
}

/** Cancel an order: set status to 'cancelled' and record reason. */
export function cancelOrder(orderId: number, reason: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.update(orders)
    .set({
      status: 'cancelled',
      cancelReason: reason,
      updatedAt: now,
    })
    .where(eq(orders.id, orderId))
    .run();
}

/** Get recent orders with optional filters. */
export function getRecentOrders(
  filters: { symbol?: string; status?: OrderStatus | string; limit?: number } = {},
): Order[] {
  const db = getDb();
  const conditions = [];

  if (filters.symbol) conditions.push(eq(orders.symbol, filters.symbol));
  if (filters.status) conditions.push(eq(orders.status, filters.status as OrderStatus));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(orders)
    .where(where)
    .orderBy(desc(orders.createdAt))
    .limit(filters.limit ?? 50)
    .all();
}

/** Get total order count with optional filters. */
export function getOrderCount(
  filters: { symbol?: string; status?: OrderStatus | string } = {},
): number {
  const db = getDb();
  const conditions = [];

  if (filters.symbol) conditions.push(eq(orders.symbol, filters.symbol));
  if (filters.status) conditions.push(eq(orders.status, filters.status as OrderStatus));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = db.select({ count: sql<number>`count(*)` }).from(orders).where(where).get();

  return result?.count ?? 0;
}

/** Find the order that was replaced by the given orderId (parent in replacement chain). */
export function findOrderReplacedBy(replacedByOrderId: number): Order | undefined {
  const db = getDb();
  return db.select().from(orders).where(eq(orders.replacedByOrderId, replacedByOrderId)).get();
}

/** Set the replacedByOrderId field on an order record. */
export function setReplacedByOrderId(orderId: number, replacedByOrderId: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.update(orders).set({ replacedByOrderId, updatedAt: now }).where(eq(orders.id, orderId)).run();
}

/**
 * Recalculate trade from filled orders (FreqTrade's recalc_trade_from_orders).
 *
 * Given multiple filled orders (e.g. DCA buys), computes the volume-weighted
 * average price and total filled quantity.
 */
export function recalcFromOrders(filledOrders: Order[]): {
  avgPrice: number;
  totalQuantity: number;
  totalStake: number;
} {
  if (filledOrders.length === 0) {
    return { avgPrice: 0, totalQuantity: 0, totalStake: 0 };
  }

  let totalStake = 0;
  let totalQuantity = 0;

  for (const order of filledOrders) {
    const qty = order.filledQuantity ?? 0;
    const price = order.filledPrice ?? 0;
    totalStake += qty * price;
    totalQuantity += qty;
  }

  const avgPrice = totalQuantity > 0 ? totalStake / totalQuantity : 0;

  return { avgPrice, totalQuantity, totalStake };
}
