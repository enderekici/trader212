import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { formatCurrency, formatPercent, round } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('performance');

const TRADING_DAYS_PER_YEAR = 252;

// ── Exported pure computation functions (for testability) ─────────────────

export interface DrawdownResult {
  maxDrawdown: number;
  maxDrawdownPct: number;
  currentDrawdown: number;
  currentDrawdownPct: number;
  peakDate: string | null;
  troughDate: string | null;
}

/**
 * Calculates max and current drawdown from a series of trade P&Ls.
 * Similar to FreqTrade's approach: cumulative profit series + rolling high watermark.
 * @param trades Array of { pnl, exitTime } sorted by close date
 */
export function calculateMaxDrawdown(
  trades: Array<{ pnl: number; exitTime: string | null }>,
): DrawdownResult {
  if (trades.length === 0) {
    return {
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      currentDrawdown: 0,
      currentDrawdownPct: 0,
      peakDate: null,
      troughDate: null,
    };
  }

  let peak = 0;
  let cumulative = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let peakDate: string | null = null;
  let troughDate: string | null = null;
  let currentPeakDate: string | null = trades[0].exitTime;

  for (const trade of trades) {
    cumulative += trade.pnl;

    if (cumulative > peak) {
      peak = cumulative;
      currentPeakDate = trade.exitTime;
    }

    const dd = peak - cumulative;
    const ddPct = peak > 0 ? dd / peak : 0;

    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPct = ddPct;
      peakDate = currentPeakDate;
      troughDate = trade.exitTime;
    }
  }

  // Current drawdown (from last high watermark)
  const currentDrawdown = peak - cumulative;
  const currentDrawdownPct = peak > 0 ? currentDrawdown / peak : 0;

  return {
    maxDrawdown: round(maxDrawdown, 2),
    maxDrawdownPct: round(maxDrawdownPct, 4),
    currentDrawdown: round(currentDrawdown, 2),
    currentDrawdownPct: round(currentDrawdownPct, 4),
    peakDate,
    troughDate,
  };
}

/**
 * Sortino Ratio: (mean_daily_return - risk_free) / downside_deviation * sqrt(252)
 * Only uses negative returns for downside deviation.
 * Returns null if fewer than 5 data points.
 */
export function computeSortino(dailyReturns: number[], riskFreeAnnual = 0.05): number | null {
  if (dailyReturns.length < 5) return null;

  const riskFreeDaily = riskFreeAnnual / TRADING_DAYS_PER_YEAR;
  const excessReturns = dailyReturns.map((r) => r - riskFreeDaily);
  const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;

  // Downside deviation: std of negative excess returns only
  const negativeExcess = excessReturns.filter((r) => r < 0);
  if (negativeExcess.length === 0) {
    // No negative returns: infinite Sortino conceptually, return null for safety
    return meanExcess > 0 ? null : 0;
  }

  const downsideVariance =
    negativeExcess.reduce((sum, r) => sum + r ** 2, 0) / excessReturns.length;
  const downsideDeviation = Math.sqrt(downsideVariance);

  if (downsideDeviation === 0) return 0;

  const sortino = (meanExcess / downsideDeviation) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  return round(sortino, 2);
}

/**
 * Calmar Ratio: annualized_return / max_drawdown
 * Returns null if max_drawdown is 0 or fewer than 5 data points.
 */
export function computeCalmar(dailyReturns: number[], maxDrawdownPct: number): number | null {
  if (dailyReturns.length < 5) return null;
  if (maxDrawdownPct <= 0) return null;

  const meanDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const annualizedReturn = meanDailyReturn * TRADING_DAYS_PER_YEAR;

  const calmar = annualizedReturn / maxDrawdownPct;
  return round(calmar, 2);
}

/**
 * SQN (System Quality Number): sqrt(n_trades) * (mean_return / std_return)
 * Van Tharp's metric. Returns null if fewer than 5 trades.
 */
export function computeSQN(tradeReturns: number[]): number | null {
  const n = tradeReturns.length;
  if (n < 5) return null;

  const mean = tradeReturns.reduce((a, b) => a + b, 0) / n;
  const variance = tradeReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  const sqn = Math.sqrt(n) * (mean / stdDev);
  return round(sqn, 2);
}

/**
 * Expectancy: (winRate * avgWin) - (lossRate * avgLoss)
 * Dollar-per-trade expectancy.
 * Also computes expectancy ratio: ((1 + R:R) * winRate) - 1
 */
export function computeExpectancy(trades: Array<{ pnl: number }>): {
  expectancy: number | null;
  expectancyRatio: number | null;
  avgWin: number | null;
  avgLoss: number | null;
} {
  if (trades.length === 0) {
    return { expectancy: null, expectancyRatio: null, avgWin: null, avgLoss: null };
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);

  const winRate = wins.length / trades.length;
  const lossRate = losses.length / trades.length;

  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;

  const avgLoss =
    losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;

  const expectancy = round(winRate * avgWin - lossRate * avgLoss, 2);

  // Expectancy ratio: ((1 + avgWin/avgLoss) * winRate) - 1
  let expectancyRatio: number | null = null;
  if (avgLoss > 0) {
    const riskRewardRatio = avgWin / avgLoss;
    expectancyRatio = round((1 + riskRewardRatio) * winRate - 1, 4);
  } else if (wins.length > 0) {
    // All wins, no losses
    expectancyRatio = null;
  }

  return {
    expectancy,
    expectancyRatio,
    avgWin: wins.length > 0 ? round(avgWin, 2) : null,
    avgLoss: losses.length > 0 ? round(avgLoss, 2) : null,
  };
}

/**
 * Profit Factor: sum(winning_pnl) / abs(sum(losing_pnl))
 * Returns null if no losing trades.
 */
export function computeProfitFactor(trades: Array<{ pnl: number }>): number | null {
  if (trades.length === 0) return null;

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);

  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

  if (grossLoss === 0) {
    return grossProfit > 0 ? null : null;
  }

  return round(grossProfit / grossLoss, 2);
}

// ── Interfaces ────────────────────────────────────────────────────────────

export interface PerformanceMetrics {
  totalTrades: number;
  winRate: number;
  avgReturnPct: number;
  sharpeRatio: number;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  sqn: number | null;
  maxDrawdown: number;
  currentDrawdown: number;
  profitFactor: number;
  expectancy: number | null;
  expectancyRatio: number | null;
  avgWin: number | null;
  avgLoss: number | null;
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
        sortinoRatio: null,
        calmarRatio: null,
        sqn: null,
        maxDrawdown: 0,
        currentDrawdown: 0,
        profitFactor: 0,
        expectancy: null,
        expectancyRatio: null,
        avgWin: null,
        avgLoss: null,
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

    // Sharpe ratio from daily portfolio returns (not per-trade returns)
    let sharpeRatio = 0;
    let sortinoRatio: number | null = null;
    let calmarRatio: number | null = null;

    const dailyMetricsRows = db
      .select()
      .from(schema.dailyMetrics)
      .orderBy(desc(schema.dailyMetrics.date))
      .all();

    const dailyReturns: number[] = [];
    if (dailyMetricsRows.length >= 5) {
      for (let i = 0; i < dailyMetricsRows.length - 1; i++) {
        const current = dailyMetricsRows[i].portfolioValue;
        const previous = dailyMetricsRows[i + 1].portfolioValue;
        if (current != null && previous != null && previous > 0) {
          dailyReturns.push((current - previous) / previous);
        }
      }
      if (dailyReturns.length >= 5) {
        const riskFreeDaily = 0.05 / TRADING_DAYS_PER_YEAR;
        const excessReturns = dailyReturns.map((r) => r - riskFreeDaily);
        const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
        const excessVariance =
          excessReturns.reduce((sum, r) => sum + (r - meanExcess) ** 2, 0) / excessReturns.length;
        const excessStdDev = Math.sqrt(excessVariance);
        sharpeRatio =
          excessStdDev > 0 ? (meanExcess / excessStdDev) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0;

        // Sortino ratio from daily returns
        sortinoRatio = computeSortino(dailyReturns);
      }
    }

    // Max drawdown from cumulative P&L (FreqTrade-style)
    const sortedTrades = [...closedTrades].sort((a, b) => {
      const aTime = a.exitTime ?? a.entryTime;
      const bTime = b.exitTime ?? b.entryTime;
      return aTime.localeCompare(bTime);
    });
    const tradePnls = sortedTrades.map((t) => ({
      pnl: t.pnl ?? 0,
      exitTime: t.exitTime ?? t.entryTime,
    }));
    const drawdownResult = calculateMaxDrawdown(tradePnls);
    let maxDrawdown = drawdownResult.maxDrawdownPct;
    let currentDrawdown = drawdownResult.currentDrawdownPct;

    // Include unrealized P&L from open positions for accurate drawdown
    const openPositions = db.select().from(schema.positions).all();
    const unrealizedPnl = openPositions.reduce(
      (sum, p) => sum + ((p.currentPrice ?? p.entryPrice) - p.entryPrice) * p.shares,
      0,
    );
    // Adjust current drawdown with unrealized P&L
    const cumulativePnl = tradePnls.reduce((sum, t) => sum + t.pnl, 0);
    let peak = 0;
    let cum = 0;
    for (const t of tradePnls) {
      cum += t.pnl;
      if (cum > peak) peak = cum;
    }
    const totalCumulative = cumulativePnl + unrealizedPnl;
    if (totalCumulative > peak) peak = totalCumulative;
    const unrealizedDrawdown = peak > 0 ? (peak - totalCumulative) / peak : 0;
    if (unrealizedDrawdown > maxDrawdown) maxDrawdown = unrealizedDrawdown;
    currentDrawdown = peak > 0 ? (peak - totalCumulative) / peak : 0;

    // Calmar ratio (uses daily returns and max drawdown)
    if (dailyReturns.length >= 5 && maxDrawdown > 0) {
      calmarRatio = computeCalmar(dailyReturns, maxDrawdown);
    }

    // SQN from per-trade returns
    const sqn = computeSQN(returns);

    // Expectancy and avgWin/avgLoss
    const tradesPnl = closedTrades.map((t) => ({ pnl: t.pnl ?? 0 }));
    const { expectancy, expectancyRatio, avgWin, avgLoss } = computeExpectancy(tradesPnl);

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
      sortinoRatio,
      calmarRatio,
      sqn,
      maxDrawdown: round(maxDrawdown, 4),
      currentDrawdown: round(currentDrawdown, 4),
      profitFactor: round(profitFactor, 2),
      expectancy,
      expectancyRatio,
      avgWin,
      avgLoss,
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

    const metrics = this.getMetrics();

    const lines = [
      `<b>Daily Summary - ${today}</b>`,
      '',
      `Trades today: ${todayTrades.length}`,
      `Realized P&amp;L: ${formatCurrency(totalPnl)}`,
      `Win rate: ${formatPercent(winRate)}`,
      `Open positions: ${openPositions.length}`,
      `Unrealized P&amp;L: ${formatCurrency(unrealizedPnl)}`,
      '',
      '<b>Risk Metrics:</b>',
      `Sortino: ${metrics.sortinoRatio ?? 'N/A'}`,
      `Calmar: ${metrics.calmarRatio ?? 'N/A'}`,
      `SQN: ${metrics.sqn ?? 'N/A'}`,
      `Expectancy: ${metrics.expectancy != null ? formatCurrency(metrics.expectancy) : 'N/A'}`,
      `Current DD: ${formatPercent(metrics.currentDrawdown)}`,
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
      `Sortino ratio: ${metrics.sortinoRatio ?? 'N/A'}`,
      `Calmar ratio: ${metrics.calmarRatio ?? 'N/A'}`,
      `Max drawdown: ${formatPercent(metrics.maxDrawdown)}`,
      `Current drawdown: ${formatPercent(metrics.currentDrawdown)}`,
      `Profit factor: ${metrics.profitFactor}`,
      `SQN: ${metrics.sqn ?? 'N/A'}`,
      `Expectancy: ${metrics.expectancy != null ? formatCurrency(metrics.expectancy) : 'N/A'}`,
      `Avg win: ${metrics.avgWin != null ? formatCurrency(metrics.avgWin) : 'N/A'}`,
      `Avg loss: ${metrics.avgLoss != null ? formatCurrency(metrics.avgLoss) : 'N/A'}`,
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
      const metricsValues = {
        date: today,
        totalPnl: round(totalPnl, 2),
        tradesCount: todayTrades.length,
        winCount: wins,
        lossCount: losses,
        winRate: round(winRate, 4),
        maxDrawdown: round(metrics.maxDrawdown, 4),
        sharpeRatio: round(metrics.sharpeRatio, 2),
        profitFactor: round(metrics.profitFactor, 2),
        sortinoRatio: metrics.sortinoRatio,
        calmarRatio: metrics.calmarRatio,
        sqn: metrics.sqn,
        expectancy: metrics.expectancy,
        avgWin: metrics.avgWin,
        avgLoss: metrics.avgLoss,
        currentDrawdown: round(metrics.currentDrawdown, 4),
      };

      db.insert(schema.dailyMetrics)
        .values(metricsValues)
        .onConflictDoUpdate({
          target: schema.dailyMetrics.date,
          set: {
            totalPnl: metricsValues.totalPnl,
            tradesCount: metricsValues.tradesCount,
            winCount: metricsValues.winCount,
            lossCount: metricsValues.lossCount,
            winRate: metricsValues.winRate,
            maxDrawdown: metricsValues.maxDrawdown,
            sharpeRatio: metricsValues.sharpeRatio,
            profitFactor: metricsValues.profitFactor,
            sortinoRatio: metricsValues.sortinoRatio,
            calmarRatio: metricsValues.calmarRatio,
            sqn: metricsValues.sqn,
            expectancy: metricsValues.expectancy,
            avgWin: metricsValues.avgWin,
            avgLoss: metricsValues.avgLoss,
            currentDrawdown: metricsValues.currentDrawdown,
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
