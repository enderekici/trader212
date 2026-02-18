import { and, desc, eq, gte } from 'drizzle-orm';
import type { FundamentalData } from '../../data/yahoo-finance.js';
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

/**
 * Returns cached FundamentalData if it exists and has not expired (ttlHours).
 * Returns null when missing or stale.
 */
export function getFundamentals(symbol: string, ttlHours = 24): FundamentalData | null {
  const row = getCachedFundamentals(symbol);
  if (!row) return null;

  const fetchedAt = new Date(row.fetchedAt).getTime();
  const expiresAt = fetchedAt + ttlHours * 60 * 60 * 1000;
  if (Date.now() > expiresAt) return null;

  return {
    peRatio: row.peRatio ?? null,
    forwardPE: row.forwardPE ?? null,
    revenueGrowthYoY: row.revenueGrowthYoY ?? null,
    profitMargin: row.profitMargin ?? null,
    operatingMargin: row.operatingMargin ?? null,
    debtToEquity: row.debtToEquity ?? null,
    currentRatio: row.currentRatio ?? null,
    marketCap: row.marketCap ?? null,
    sector: row.sector ?? null,
    industry: row.industry ?? null,
    earningsSurprise: row.earningsSurprise ?? null,
    dividendYield: row.dividendYield ?? null,
    beta: row.beta ?? null,
    // New fields are not in the fundamental_cache schema columns yet;
    // return nulls so callers get type-safe FundamentalData
    analystTargetPrice: null,
    analystConsensus: null,
    analystCount: null,
    shortInterestPct: null,
    institutionalOwnershipPct: null,
    pegRatio: null,
    roe: null,
    roa: null,
    freeCashflow: null,
    analystBuy: null,
    analystSell: null,
  };
}

/**
 * Upsert fundamental data into the DB cache (inserts or replaces by symbol).
 */
export function setFundamentals(symbol: string, data: FundamentalData, _ttlHours = 24): void {
  const db = getDb();
  const fetchedAt = new Date().toISOString();
  db.insert(fundamentalCache)
    .values({
      symbol,
      fetchedAt,
      peRatio: data.peRatio ?? undefined,
      forwardPE: data.forwardPE ?? undefined,
      revenueGrowthYoY: data.revenueGrowthYoY ?? undefined,
      profitMargin: data.profitMargin ?? undefined,
      operatingMargin: data.operatingMargin ?? undefined,
      debtToEquity: data.debtToEquity ?? undefined,
      currentRatio: data.currentRatio ?? undefined,
      marketCap: data.marketCap ?? undefined,
      sector: data.sector ?? undefined,
      industry: data.industry ?? undefined,
      earningsSurprise: data.earningsSurprise ?? undefined,
      dividendYield: data.dividendYield ?? undefined,
      beta: data.beta ?? undefined,
    })
    .run();
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
