import { and, desc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { formatCurrency, formatPercent, round } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('performance');

export interface PerformanceMetrics {
  totalTrades: number;
  winRate: number;
  avgReturnPct: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  avgHoldDuration: string;
  bestTrade: { symbol: string; pnlPct: number } | null;
  worstTrade: { symbol: string; pnlPct: number } | null;
}

export interface SectorBreakdown {
  sector: string;
  trades: number;
  winRate: number;
  totalPnl: number;
  avgReturnPct: number;
}

export class PerformanceTracker {
  getMetrics(): PerformanceMetrics {
    const db = getDb();

    const closedTrades = db
      .select()
      .from(schema.trades)
      .where(isNotNull(schema.trades.exitPrice))
      .all();

    const totalTrades = closedTrades.length;

    if (totalTrades === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        avgReturnPct: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        profitFactor: 0,
        avgHoldDuration: 'N/A',
        bestTrade: null,
        worstTrade: null,
      };
    }

    const returns = closedTrades.map((t) => t.pnlPct ?? 0);
    const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
    const losses = closedTrades.filter((t) => (t.pnl ?? 0) <= 0);

    const winRate = wins.length / totalTrades;

    const avgReturnPct = returns.reduce((a, b) => a + b, 0) / totalTrades;

    // Sharpe ratio: annualized
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;

    // Max drawdown from cumulative P&L
    let peak = 0;
    let maxDrawdown = 0;
    let cumulative = 0;
    for (const trade of closedTrades) {
      cumulative += trade.pnl ?? 0;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak > 0 ? (peak - cumulative) / peak : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Profit factor
    const totalWins = wins.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + (t.pnl ?? 0), 0));
    const profitFactor =
      totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Number.POSITIVE_INFINITY : 0;

    // Average hold duration
    let totalHoldMs = 0;
    let holdCount = 0;
    for (const trade of closedTrades) {
      if (trade.entryTime && trade.exitTime) {
        const entry = new Date(trade.entryTime).getTime();
        const exit = new Date(trade.exitTime).getTime();
        if (!Number.isNaN(entry) && !Number.isNaN(exit)) {
          totalHoldMs += exit - entry;
          holdCount++;
        }
      }
    }
    const avgHoldMs = holdCount > 0 ? totalHoldMs / holdCount : 0;
    const avgHoldDuration = formatDuration(avgHoldMs);

    // Best / worst trades
    const sorted = [...closedTrades].sort((a, b) => (a.pnlPct ?? 0) - (b.pnlPct ?? 0));
    const worstTrade = sorted[0]
      ? { symbol: sorted[0].symbol, pnlPct: sorted[0].pnlPct ?? 0 }
      : null;
    const bestTrade = sorted[sorted.length - 1]
      ? { symbol: sorted[sorted.length - 1].symbol, pnlPct: sorted[sorted.length - 1].pnlPct ?? 0 }
      : null;

    return {
      totalTrades,
      winRate: round(winRate, 4),
      avgReturnPct: round(avgReturnPct, 4),
      sharpeRatio: round(sharpeRatio, 2),
      maxDrawdown: round(maxDrawdown, 4),
      profitFactor: round(profitFactor, 2),
      avgHoldDuration,
      bestTrade,
      worstTrade,
    };
  }

  getPerSectorBreakdown(): SectorBreakdown[] {
    const db = getDb();

    const closedTrades = db
      .select()
      .from(schema.trades)
      .where(isNotNull(schema.trades.exitPrice))
      .all();

    // Join with fundamental cache to get sector info
    const sectorMap = new Map<string, typeof closedTrades>();
    for (const trade of closedTrades) {
      const fundRow = db
        .select({ sector: schema.fundamentalCache.sector })
        .from(schema.fundamentalCache)
        .where(eq(schema.fundamentalCache.symbol, trade.symbol))
        .orderBy(desc(schema.fundamentalCache.fetchedAt))
        .limit(1)
        .get();

      const sector = fundRow?.sector ?? 'Unknown';
      const existing = sectorMap.get(sector) ?? [];
      existing.push(trade);
      sectorMap.set(sector, existing);
    }

    const result: SectorBreakdown[] = [];
    for (const [sector, trades] of sectorMap) {
      const wins = trades.filter((t) => (t.pnl ?? 0) > 0).length;
      const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
      const avgReturn = trades.reduce((sum, t) => sum + (t.pnlPct ?? 0), 0) / trades.length;

      result.push({
        sector,
        trades: trades.length,
        winRate: round(wins / trades.length, 4),
        totalPnl: round(totalPnl, 2),
        avgReturnPct: round(avgReturn, 4),
      });
    }

    return result.sort((a, b) => b.totalPnl - a.totalPnl);
  }

  generateDailySummary(): string {
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];

    const todayTrades = db
      .select()
      .from(schema.trades)
      .where(and(gte(schema.trades.entryTime, today), isNotNull(schema.trades.exitPrice)))
      .all();

    const totalPnl = todayTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const wins = todayTrades.filter((t) => (t.pnl ?? 0) > 0).length;
    const winRate = todayTrades.length > 0 ? wins / todayTrades.length : 0;

    const openPositions = db.select().from(schema.positions).all();

    const unrealizedPnl = openPositions.reduce((sum, p) => sum + (p.pnl ?? 0), 0);

    const lines = [
      `<b>Daily Summary - ${today}</b>`,
      '',
      `Trades today: ${todayTrades.length}`,
      `Realized P&amp;L: ${formatCurrency(totalPnl)}`,
      `Win rate: ${formatPercent(winRate)}`,
      `Open positions: ${openPositions.length}`,
      `Unrealized P&amp;L: ${formatCurrency(unrealizedPnl)}`,
    ];

    if (todayTrades.length > 0) {
      lines.push('', '<b>Trades:</b>');
      for (const t of todayTrades) {
        const emoji = (t.pnl ?? 0) >= 0 ? '+' : '';
        lines.push(
          `  ${t.side} ${t.symbol}: ${emoji}${formatCurrency(t.pnl ?? 0)} (${formatPercent(t.pnlPct ?? 0)})`,
        );
      }
    }

    return lines.join('\n');
  }

  generateWeeklySummary(): string {
    const db = getDb();
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekStart = weekAgo.toISOString().split('T')[0];

    const weekTrades = db
      .select()
      .from(schema.trades)
      .where(and(gte(schema.trades.entryTime, weekStart), isNotNull(schema.trades.exitPrice)))
      .all();

    const totalPnl = weekTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const wins = weekTrades.filter((t) => (t.pnl ?? 0) > 0).length;
    const winRate = weekTrades.length > 0 ? wins / weekTrades.length : 0;
    const avgReturn =
      weekTrades.length > 0
        ? weekTrades.reduce((sum, t) => sum + (t.pnlPct ?? 0), 0) / weekTrades.length
        : 0;

    const metrics = this.getMetrics();

    const lines = [
      '<b>Weekly Performance Report</b>',
      `Period: ${weekStart} to ${now.toISOString().split('T')[0]}`,
      '',
      `Trades this week: ${weekTrades.length}`,
      `Weekly P&amp;L: ${formatCurrency(totalPnl)}`,
      `Win rate: ${formatPercent(winRate)}`,
      `Avg return: ${formatPercent(avgReturn)}`,
      '',
      '<b>All-Time Stats:</b>',
      `Total trades: ${metrics.totalTrades}`,
      `Win rate: ${formatPercent(metrics.winRate)}`,
      `Sharpe ratio: ${metrics.sharpeRatio}`,
      `Max drawdown: ${formatPercent(metrics.maxDrawdown)}`,
      `Profit factor: ${metrics.profitFactor}`,
    ];

    if (metrics.bestTrade) {
      lines.push(
        `Best trade: ${metrics.bestTrade.symbol} (${formatPercent(metrics.bestTrade.pnlPct)})`,
      );
    }
    if (metrics.worstTrade) {
      lines.push(
        `Worst trade: ${metrics.worstTrade.symbol} (${formatPercent(metrics.worstTrade.pnlPct)})`,
      );
    }

    return lines.join('\n');
  }

  async saveDailyMetrics(): Promise<void> {
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];

    const todayTrades = db
      .select()
      .from(schema.trades)
      .where(and(gte(schema.trades.entryTime, today), isNotNull(schema.trades.exitPrice)))
      .all();

    const totalPnl = todayTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const wins = todayTrades.filter((t) => (t.pnl ?? 0) > 0).length;
    const losses = todayTrades.length - wins;
    const winRate = todayTrades.length > 0 ? wins / todayTrades.length : 0;

    const metrics = this.getMetrics();

    try {
      db.insert(schema.dailyMetrics)
        .values({
          date: today,
          totalPnl: round(totalPnl, 2),
          tradesCount: todayTrades.length,
          winCount: wins,
          lossCount: losses,
          winRate: round(winRate, 4),
          maxDrawdown: round(metrics.maxDrawdown, 4),
          sharpeRatio: round(metrics.sharpeRatio, 2),
          profitFactor: round(metrics.profitFactor, 2),
        })
        .onConflictDoUpdate({
          target: schema.dailyMetrics.date,
          set: {
            totalPnl: round(totalPnl, 2),
            tradesCount: todayTrades.length,
            winCount: wins,
            lossCount: losses,
            winRate: round(winRate, 4),
            maxDrawdown: round(metrics.maxDrawdown, 4),
            sharpeRatio: round(metrics.sharpeRatio, 2),
            profitFactor: round(metrics.profitFactor, 2),
          },
        })
        .run();

      log.info({ date: today, totalPnl, trades: todayTrades.length }, 'Daily metrics saved');
    } catch (err) {
      log.error({ err }, 'Failed to save daily metrics');
    }
  }
}

function formatDuration(ms: number): string {
  if (ms <= 0) return 'N/A';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }
  return `${hours}h ${minutes}m`;
}
