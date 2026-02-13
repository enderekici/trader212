import { and, desc, eq, gte } from 'drizzle-orm';
import { getDb } from '../index.js';
import { fundamentalCache, newsCache, pairlistHistory, priceCache } from '../schema.js';

// ── Price Cache ───────────────────────────────────────────────────────

export type PriceCacheInsert = typeof priceCache.$inferInsert;

export function cachePrice(data: PriceCacheInsert) {
  const db = getDb();
  return db.insert(priceCache).values(data).returning().get();
}

export function cachePrices(data: PriceCacheInsert[]) {
  if (data.length === 0) return [];
  const db = getDb();
  return db.insert(priceCache).values(data).returning().all();
}

export function getCachedPrices(symbol: string, from?: string, timeframe = '1d') {
  const db = getDb();
  const conditions = [eq(priceCache.symbol, symbol), eq(priceCache.timeframe, timeframe)];
  if (from) conditions.push(gte(priceCache.timestamp, from));

  return db
    .select()
    .from(priceCache)
    .where(and(...conditions))
    .orderBy(desc(priceCache.timestamp))
    .all();
}

export function getLatestPrice(symbol: string) {
  const db = getDb();
  return db
    .select()
    .from(priceCache)
    .where(eq(priceCache.symbol, symbol))
    .orderBy(desc(priceCache.timestamp))
    .limit(1)
    .get();
}

// ── News Cache ────────────────────────────────────────────────────────

export type NewsCacheInsert = typeof newsCache.$inferInsert;

export function cacheNews(data: NewsCacheInsert) {
  const db = getDb();
  return db.insert(newsCache).values(data).returning().get();
}

export function cacheNewsMany(data: NewsCacheInsert[]) {
  if (data.length === 0) return [];
  const db = getDb();
  return db.insert(newsCache).values(data).returning().all();
}

export function getCachedNews(symbol: string, since?: string) {
  const db = getDb();
  const conditions = [eq(newsCache.symbol, symbol)];
  if (since) conditions.push(gte(newsCache.fetchedAt, since));

  return db
    .select()
    .from(newsCache)
    .where(and(...conditions))
    .orderBy(desc(newsCache.fetchedAt))
    .all();
}

// ── Fundamental Cache ─────────────────────────────────────────────────

export type FundamentalCacheInsert = typeof fundamentalCache.$inferInsert;

export function cacheFundamentals(data: FundamentalCacheInsert) {
  const db = getDb();
  return db.insert(fundamentalCache).values(data).returning().get();
}

export function getCachedFundamentals(symbol: string) {
  const db = getDb();
  return db
    .select()
    .from(fundamentalCache)
    .where(eq(fundamentalCache.symbol, symbol))
    .orderBy(desc(fundamentalCache.fetchedAt))
    .limit(1)
    .get();
}

// ── Pairlist History ──────────────────────────────────────────────────

export type PairlistHistoryInsert = typeof pairlistHistory.$inferInsert;

export function insertPairlistRun(data: PairlistHistoryInsert) {
  const db = getDb();
  return db.insert(pairlistHistory).values(data).returning().get();
}

export function getLatestPairlist() {
  const db = getDb();
  return db.select().from(pairlistHistory).orderBy(desc(pairlistHistory.timestamp)).limit(1).get();
}

export function getPairlistHistory(limit = 20) {
  const db = getDb();
  return db
    .select()
    .from(pairlistHistory)
    .orderBy(desc(pairlistHistory.timestamp))
    .limit(limit)
    .all();
}
