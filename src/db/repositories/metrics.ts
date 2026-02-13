import { and, asc, desc, gte, lte } from 'drizzle-orm';
import { getDb } from '../index.js';
import { dailyMetrics } from '../schema.js';

export type DailyMetricsInsert = typeof dailyMetrics.$inferInsert;

export function insertDailyMetrics(data: DailyMetricsInsert) {
  const db = getDb();
  return db.insert(dailyMetrics).values(data).returning().get();
}

export function upsertDailyMetrics(data: DailyMetricsInsert) {
  const db = getDb();
  return db
    .insert(dailyMetrics)
    .values(data)
    .onConflictDoUpdate({
      target: dailyMetrics.date,
      set: {
        totalPnl: data.totalPnl,
        tradesCount: data.tradesCount,
        winCount: data.winCount,
        lossCount: data.lossCount,
        winRate: data.winRate,
        maxDrawdown: data.maxDrawdown,
        sharpeRatio: data.sharpeRatio,
        profitFactor: data.profitFactor,
        portfolioValue: data.portfolioValue,
        cashBalance: data.cashBalance,
        accountType: data.accountType,
      },
    })
    .returning()
    .get();
}

export function getMetricsRange(from: string, to: string) {
  const db = getDb();
  return db
    .select()
    .from(dailyMetrics)
    .where(and(gte(dailyMetrics.date, from), lte(dailyMetrics.date, to)))
    .orderBy(asc(dailyMetrics.date))
    .all();
}

export function getLatestMetrics() {
  const db = getDb();
  return db.select().from(dailyMetrics).orderBy(desc(dailyMetrics.date)).limit(1).get();
}

export function getEquityCurve(days = 90) {
  const db = getDb();
  return db
    .select({
      date: dailyMetrics.date,
      portfolioValue: dailyMetrics.portfolioValue,
      cashBalance: dailyMetrics.cashBalance,
      totalPnl: dailyMetrics.totalPnl,
    })
    .from(dailyMetrics)
    .orderBy(desc(dailyMetrics.date))
    .limit(days)
    .all()
    .reverse();
}

export function getAllDailyMetrics() {
  const db = getDb();
  return db.select().from(dailyMetrics).orderBy(desc(dailyMetrics.date)).all();
}
