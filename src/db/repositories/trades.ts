import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { getDb } from '../index.js';
import { trades } from '../schema.js';

export type TradeInsert = typeof trades.$inferInsert;

export interface TradeFilters {
  symbol?: string;
  side?: 'BUY' | 'SELL';
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function insertTrade(data: TradeInsert) {
  const db = getDb();
  return db.insert(trades).values(data).returning().get();
}

export function closeTrade(
  id: number,
  exitData: {
    exitPrice: number;
    exitTime: string;
    pnl: number;
    pnlPct: number;
    exitReason?: string;
  },
) {
  const db = getDb();
  return db.update(trades).set(exitData).where(eq(trades.id, id)).returning().get();
}

export function getOpenTrades() {
  const db = getDb();
  return db
    .select()
    .from(trades)
    .where(sql`${trades.exitPrice} IS NULL`)
    .orderBy(desc(trades.entryTime))
    .all();
}

export function getTradeById(id: number) {
  const db = getDb();
  return db.select().from(trades).where(eq(trades.id, id)).get();
}

export function getTradeHistory(filters: TradeFilters = {}) {
  const db = getDb();
  const conditions = [];

  if (filters.symbol) conditions.push(eq(trades.symbol, filters.symbol));
  if (filters.side) conditions.push(eq(trades.side, filters.side));
  if (filters.from) conditions.push(gte(trades.entryTime, filters.from));
  if (filters.to) conditions.push(lte(trades.entryTime, filters.to));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = db
    .select()
    .from(trades)
    .where(where)
    .orderBy(desc(trades.entryTime))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0)
    .all();

  const countResult = db.select({ count: sql<number>`count(*)` }).from(trades).where(where).get();

  return { trades: rows, total: countResult?.count ?? 0 };
}

export function getTradesBySymbol(symbol: string) {
  const db = getDb();
  return db
    .select()
    .from(trades)
    .where(eq(trades.symbol, symbol))
    .orderBy(desc(trades.entryTime))
    .all();
}

export function getClosedTrades() {
  const db = getDb();
  return db
    .select()
    .from(trades)
    .where(sql`${trades.exitPrice} IS NOT NULL`)
    .orderBy(desc(trades.exitTime))
    .all();
}
