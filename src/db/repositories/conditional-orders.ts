import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../index.js';
import { conditionalOrders } from '../schema.js';

export interface ConditionalOrderData {
  symbol: string;
  triggerType: 'price_above' | 'price_below' | 'time' | 'indicator';
  triggerCondition: string; // JSON
  action: string; // JSON
  linkedOrderId?: number;
  ocoGroupId?: string;
  expiresAt?: string;
}

export interface ConditionalOrder {
  id: number;
  symbol: string;
  triggerType: 'price_above' | 'price_below' | 'time' | 'indicator';
  triggerCondition: string;
  action: string;
  status: 'pending' | 'triggered' | 'executed' | 'cancelled' | 'expired';
  linkedOrderId: number | null;
  ocoGroupId: string | null;
  expiresAt: string | null;
  createdAt: string;
  triggeredAt: string | null;
}

export function createConditionalOrder(data: ConditionalOrderData): ConditionalOrder {
  const db = getDb();
  const now = new Date().toISOString();

  const result = db
    .insert(conditionalOrders)
    .values({
      symbol: data.symbol,
      triggerType: data.triggerType,
      triggerCondition: data.triggerCondition,
      action: data.action,
      status: 'pending',
      linkedOrderId: data.linkedOrderId ?? null,
      ocoGroupId: data.ocoGroupId ?? null,
      expiresAt: data.expiresAt ?? null,
      createdAt: now,
      triggeredAt: null,
    })
    .returning()
    .get();

  return result;
}

export function getActiveOrders(symbol?: string): ConditionalOrder[] {
  const db = getDb();

  if (symbol) {
    return db
      .select()
      .from(conditionalOrders)
      .where(and(eq(conditionalOrders.status, 'pending'), eq(conditionalOrders.symbol, symbol)))
      .orderBy(desc(conditionalOrders.createdAt))
      .all();
  }

  return db
    .select()
    .from(conditionalOrders)
    .where(eq(conditionalOrders.status, 'pending'))
    .orderBy(desc(conditionalOrders.createdAt))
    .all();
}

export function getOrderById(id: number): ConditionalOrder | undefined {
  const db = getDb();
  return db.select().from(conditionalOrders).where(eq(conditionalOrders.id, id)).get();
}

export function updateOrderStatus(
  id: number,
  status: 'pending' | 'triggered' | 'executed' | 'cancelled' | 'expired',
  triggeredAt?: string,
): void {
  const db = getDb();
  const updates: {
    status: 'pending' | 'triggered' | 'executed' | 'cancelled' | 'expired';
    triggeredAt?: string;
  } = { status };

  if (triggeredAt) {
    updates.triggeredAt = triggeredAt;
  }

  db.update(conditionalOrders).set(updates).where(eq(conditionalOrders.id, id)).run();
}

export function cancelOrder(id: number): void {
  updateOrderStatus(id, 'cancelled');
}

export function cancelOcoGroup(groupId: string, exceptOrderId?: number): void {
  const db = getDb();

  if (exceptOrderId) {
    db.update(conditionalOrders)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(conditionalOrders.ocoGroupId, groupId),
          eq(conditionalOrders.status, 'pending'),
          // Cancel all orders in the group except the triggered one
          // Using NOT EQUAL logic
        ),
      )
      .run();

    // Since drizzle doesn't have a direct "not equal" combinator, we need to do this differently
    // Let's get all orders in the group and filter manually
    const ordersInGroup = db
      .select()
      .from(conditionalOrders)
      .where(
        and(eq(conditionalOrders.ocoGroupId, groupId), eq(conditionalOrders.status, 'pending')),
      )
      .all();

    for (const order of ordersInGroup) {
      if (order.id !== exceptOrderId) {
        cancelOrder(order.id);
      }
    }
  } else {
    db.update(conditionalOrders)
      .set({ status: 'cancelled' })
      .where(
        and(eq(conditionalOrders.ocoGroupId, groupId), eq(conditionalOrders.status, 'pending')),
      )
      .run();
  }
}

export function getExpiredOrders(): ConditionalOrder[] {
  const db = getDb();
  const now = new Date().toISOString();

  // Get all pending orders
  const pending = db
    .select()
    .from(conditionalOrders)
    .where(eq(conditionalOrders.status, 'pending'))
    .all();

  // Filter those that have expired
  return pending.filter((order) => order.expiresAt && order.expiresAt < now);
}

export function getOcoGroup(groupId: string): ConditionalOrder[] {
  const db = getDb();
  return db.select().from(conditionalOrders).where(eq(conditionalOrders.ocoGroupId, groupId)).all();
}
