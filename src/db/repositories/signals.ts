import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { getDb } from '../index.js';
import { signals } from '../schema.js';

export type SignalInsert = typeof signals.$inferInsert;

export interface SignalFilters {
  symbol?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function insertSignal(data: SignalInsert) {
  const db = getDb();
  return db.insert(signals).values(data).returning().get();
}

export function getRecentSignals(symbol: string, count = 10) {
  const db = getDb();
  return db
    .select()
    .from(signals)
    .where(eq(signals.symbol, symbol))
    .orderBy(desc(signals.timestamp))
    .limit(count)
    .all();
}

export function getLatestSignal(symbol: string) {
  const db = getDb();
  return db
    .select()
    .from(signals)
    .where(eq(signals.symbol, symbol))
    .orderBy(desc(signals.timestamp))
    .limit(1)
    .get();
}

export function getSignalHistory(filters: SignalFilters = {}) {
  const db = getDb();
  const conditions = [];

  if (filters.symbol) conditions.push(eq(signals.symbol, filters.symbol));
  if (filters.from) conditions.push(gte(signals.timestamp, filters.from));
  if (filters.to) conditions.push(lte(signals.timestamp, filters.to));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = db
    .select()
    .from(signals)
    .where(where)
    .orderBy(desc(signals.timestamp))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0)
    .all();

  const countResult = db.select({ count: sql<number>`count(*)` }).from(signals).where(where).get();

  return { signals: rows, total: countResult?.count ?? 0 };
}

export function markSignalExecuted(id: number) {
  const db = getDb();
  return db.update(signals).set({ executed: true }).where(eq(signals.id, id)).returning().get();
}
