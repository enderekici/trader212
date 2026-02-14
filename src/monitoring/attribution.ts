import { desc, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { formatCurrency, formatPercent, round } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('attribution');

// ── Types ─────────────────────────────────────────────────────────────────

export interface FactorStats {
  contribution: number; // average P&L for trades where this factor was dominant
  accuracy: number; // % of trades where this factor led to profit
  avgReturn: number; // average % return
  tradeCount: number; // number of trades where this factor was dominant
}

export interface DecisionStats {
  count: number;
  totalPnl: number;
  winRate: number;
}

export interface ExitReasonStats {
  count: number;
  avgPnl: number;
  avgHoldMinutes: number;
}

export interface PeriodStats {
  count: number;
  totalPnl: number;
  winRate: number;
  avgReturn: number;
}

export interface AttributionResult {
  byFactor: {
    technical: FactorStats;
    fundamental: FactorStats;
    sentiment: FactorStats;
    ai: FactorStats;
  };
  byDecisionType: {
    BUY: DecisionStats;
    SELL: DecisionStats;
  };
  byExitReason: Record<string, ExitReasonStats>;
  bySector: Record<string, PeriodStats>;
  byTimeOfDay: {
    morning: PeriodStats; // 9:30-12:00 ET
    midday: PeriodStats; // 12:00-14:00 ET
    afternoon: PeriodStats; // 14:00-16:00 ET
  };
  byDayOfWeek: Record<string, PeriodStats>;
  factorCorrelations: {
    factors: string[];
    matrix: number[][];
  };
  insights: string[];
}

interface TradeWithSignal {
  trade: typeof schema.trades.$inferSelect;
  signal: typeof schema.signals.$inferSelect | null;
  sector: string | null;
}

// ── Pure Computation Functions ────────────────────────────────────────────

/**
 * Matches trades to their entry signals by symbol and timestamp proximity.
 * Returns trades with their associated signals and sector info.
 */
export function matchTradesToSignals(
  trades: Array<typeof schema.trades.$inferSelect>,
  signals: Array<typeof schema.signals.$inferSelect>,
  fundamentals: Array<{ symbol: string; sector: string | null }>,
): TradeWithSignal[] {
  const result: TradeWithSignal[] = [];
  const sectorMap = new Map(fundamentals.map((f) => [f.symbol, f.sector ?? 'Unknown']));

  for (const trade of trades) {
    // Find signal closest to entry time (within 1 hour)
    const entryTime = new Date(trade.entryTime).getTime();
    const maxTimeDiff = 60 * 60 * 1000; // 1 hour

    let closestSignal: typeof schema.signals.$inferSelect | null = null;
    let minTimeDiff = Number.POSITIVE_INFINITY;

    for (const signal of signals) {
      if (signal.symbol !== trade.symbol) continue;
      const signalTime = new Date(signal.timestamp).getTime();
      const timeDiff = Math.abs(entryTime - signalTime);

      if (timeDiff < maxTimeDiff && timeDiff < minTimeDiff) {
        minTimeDiff = timeDiff;
        closestSignal = signal;
      }
    }

    result.push({
      trade,
      signal: closestSignal,
      sector: sectorMap.get(trade.symbol) ?? null,
    });
  }

  return result;
}

/**
 * Determines which factor was dominant for a given signal.
 * Returns 'technical', 'fundamental', 'sentiment', 'ai', or null if no clear dominant factor.
 */
export function getDominantFactor(
  signal: typeof schema.signals.$inferSelect | null,
): string | null {
  if (!signal) return null;

  const technical = signal.technicalScore ?? 0;
  const fundamental = signal.fundamentalScore ?? 0;
  const sentiment = signal.sentimentScore ?? 0;
  const ai = signal.aiScore ?? 0;

  // Require score > 0.6 to be considered dominant
  const threshold = 0.6;
  const scores = [
    { name: 'technical', value: technical },
    { name: 'fundamental', value: fundamental },
    { name: 'sentiment', value: sentiment },
    { name: 'ai', value: ai },
  ];

  const maxScore = Math.max(technical, fundamental, sentiment, ai);
  if (maxScore < threshold) return null;

  const dominant = scores.find((s) => s.value === maxScore);
  return dominant?.name ?? null;
}

/**
 * Computes factor attribution stats from matched trades.
 */
export function computeFactorAttribution(
  matchedTrades: TradeWithSignal[],
): AttributionResult['byFactor'] {
  const factorTrades: Record<string, Array<{ pnl: number; pnlPct: number }>> = {
    technical: [],
    fundamental: [],
    sentiment: [],
    ai: [],
  };

  for (const { trade, signal } of matchedTrades) {
    const factor = getDominantFactor(signal);
    if (!factor || !(factor in factorTrades)) continue;

    const pnl = trade.pnl ?? 0;
    const pnlPct = trade.pnlPct ?? 0;
    factorTrades[factor].push({ pnl, pnlPct });
  }

  const result: AttributionResult['byFactor'] = {
    technical: createFactorStats(factorTrades.technical),
    fundamental: createFactorStats(factorTrades.fundamental),
    sentiment: createFactorStats(factorTrades.sentiment),
    ai: createFactorStats(factorTrades.ai),
  };

  return result;
}

function createFactorStats(trades: Array<{ pnl: number; pnlPct: number }>): FactorStats {
  if (trades.length === 0) {
    return {
      contribution: 0,
      accuracy: 0,
      avgReturn: 0,
      tradeCount: 0,
    };
  }

  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const avgReturn = trades.reduce((sum, t) => sum + t.pnlPct, 0) / trades.length;

  return {
    contribution: round(totalPnl / trades.length, 2),
    accuracy: round(wins / trades.length, 4),
    avgReturn: round(avgReturn, 4),
    tradeCount: trades.length,
  };
}

/**
 * Groups trades by decision type (BUY/SELL).
 */
export function computeByDecisionType(
  matchedTrades: TradeWithSignal[],
): AttributionResult['byDecisionType'] {
  const buyTrades: Array<{ pnl: number }> = [];
  const sellTrades: Array<{ pnl: number }> = [];

  for (const { trade, signal } of matchedTrades) {
    const decision = signal?.decision ?? trade.side; // fallback to trade side if no signal
    const pnl = trade.pnl ?? 0;

    if (decision === 'BUY') {
      buyTrades.push({ pnl });
    } else if (decision === 'SELL') {
      sellTrades.push({ pnl });
    }
  }

  return {
    BUY: createDecisionStats(buyTrades),
    SELL: createDecisionStats(sellTrades),
  };
}

function createDecisionStats(trades: Array<{ pnl: number }>): DecisionStats {
  if (trades.length === 0) {
    return { count: 0, totalPnl: 0, winRate: 0 };
  }

  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;

  return {
    count: trades.length,
    totalPnl: round(totalPnl, 2),
    winRate: round(wins / trades.length, 4),
  };
}

/**
 * Groups trades by exit reason.
 */
export function computeByExitReason(
  matchedTrades: TradeWithSignal[],
): Record<string, ExitReasonStats> {
  const reasonMap = new Map<string, Array<{ pnl: number; holdMinutes: number }>>();

  for (const { trade } of matchedTrades) {
    const reason = trade.exitReason ?? 'unknown';
    const pnl = trade.pnl ?? 0;

    let holdMinutes = 0;
    if (trade.entryTime && trade.exitTime) {
      const entry = new Date(trade.entryTime).getTime();
      const exit = new Date(trade.exitTime).getTime();
      holdMinutes = (exit - entry) / (1000 * 60);
    }

    const existing = reasonMap.get(reason) ?? [];
    existing.push({ pnl, holdMinutes });
    reasonMap.set(reason, existing);
  }

  const result: Record<string, ExitReasonStats> = {};
  for (const [reason, trades] of reasonMap) {
    const avgPnl = trades.reduce((sum, t) => sum + t.pnl, 0) / trades.length;
    const avgHoldMinutes = trades.reduce((sum, t) => sum + t.holdMinutes, 0) / trades.length;

    result[reason] = {
      count: trades.length,
      avgPnl: round(avgPnl, 2),
      avgHoldMinutes: round(avgHoldMinutes, 2),
    };
  }

  return result;
}

/**
 * Groups trades by sector.
 */
export function computeBySector(matchedTrades: TradeWithSignal[]): Record<string, PeriodStats> {
  const sectorMap = new Map<string, Array<{ pnl: number; pnlPct: number }>>();

  for (const { trade, sector } of matchedTrades) {
    const sectorKey = sector ?? 'Unknown';
    const pnl = trade.pnl ?? 0;
    const pnlPct = trade.pnlPct ?? 0;

    const existing = sectorMap.get(sectorKey) ?? [];
    existing.push({ pnl, pnlPct });
    sectorMap.set(sectorKey, existing);
  }

  const result: Record<string, PeriodStats> = {};
  for (const [sector, trades] of sectorMap) {
    result[sector] = createPeriodStats(trades);
  }

  return result;
}

function createPeriodStats(trades: Array<{ pnl: number; pnlPct: number }>): PeriodStats {
  if (trades.length === 0) {
    return { count: 0, totalPnl: 0, winRate: 0, avgReturn: 0 };
  }

  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const avgReturn = trades.reduce((sum, t) => sum + t.pnlPct, 0) / trades.length;

  return {
    count: trades.length,
    totalPnl: round(totalPnl, 2),
    winRate: round(wins / trades.length, 4),
    avgReturn: round(avgReturn, 4),
  };
}

/**
 * Groups trades by time of day (ET timezone).
 */
export function computeByTimeOfDay(
  matchedTrades: TradeWithSignal[],
): AttributionResult['byTimeOfDay'] {
  const morning: Array<{ pnl: number; pnlPct: number }> = [];
  const midday: Array<{ pnl: number; pnlPct: number }> = [];
  const afternoon: Array<{ pnl: number; pnlPct: number }> = [];

  for (const { trade } of matchedTrades) {
    const entryTime = new Date(trade.entryTime);
    // Convert to ET (UTC-5 or UTC-4 during DST)
    // For simplicity, assume UTC-5 (standard time)
    const etHour = (entryTime.getUTCHours() - 5 + 24) % 24;
    const etMinutes = entryTime.getUTCMinutes();
    const timeInMinutes = etHour * 60 + etMinutes;

    const pnl = trade.pnl ?? 0;
    const pnlPct = trade.pnlPct ?? 0;

    // Market hours: 9:30 AM - 4:00 PM ET
    // Morning: 9:30 - 12:00 (570 - 720 minutes)
    // Midday: 12:00 - 14:00 (720 - 840 minutes)
    // Afternoon: 14:00 - 16:00 (840 - 960 minutes)
    if (timeInMinutes >= 570 && timeInMinutes < 720) {
      morning.push({ pnl, pnlPct });
    } else if (timeInMinutes >= 720 && timeInMinutes < 840) {
      midday.push({ pnl, pnlPct });
    } else if (timeInMinutes >= 840 && timeInMinutes < 960) {
      afternoon.push({ pnl, pnlPct });
    }
  }

  return {
    morning: createPeriodStats(morning),
    midday: createPeriodStats(midday),
    afternoon: createPeriodStats(afternoon),
  };
}

/**
 * Groups trades by day of week.
 */
export function computeByDayOfWeek(matchedTrades: TradeWithSignal[]): Record<string, PeriodStats> {
  const dayMap = new Map<string, Array<{ pnl: number; pnlPct: number }>>();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  for (const { trade } of matchedTrades) {
    const entryTime = new Date(trade.entryTime);
    const dayOfWeek = dayNames[entryTime.getUTCDay()];

    const pnl = trade.pnl ?? 0;
    const pnlPct = trade.pnlPct ?? 0;

    const existing = dayMap.get(dayOfWeek) ?? [];
    existing.push({ pnl, pnlPct });
    dayMap.set(dayOfWeek, existing);
  }

  const result: Record<string, PeriodStats> = {};
  for (const [day, trades] of dayMap) {
    result[day] = createPeriodStats(trades);
  }

  return result;
}

/**
 * Computes Pearson correlation matrix for factor scores.
 */
export function computeFactorCorrelations(
  matchedTrades: TradeWithSignal[],
): AttributionResult['factorCorrelations'] {
  const factors = ['technical', 'fundamental', 'sentiment', 'ai'];
  const scores: number[][] = [[], [], [], []]; // [technical[], fundamental[], sentiment[], ai[]]

  for (const { signal } of matchedTrades) {
    if (!signal) continue;

    scores[0].push(signal.technicalScore ?? 0);
    scores[1].push(signal.fundamentalScore ?? 0);
    scores[2].push(signal.sentimentScore ?? 0);
    scores[3].push(signal.aiScore ?? 0);
  }

  const matrix: number[][] = [];
  for (let i = 0; i < factors.length; i++) {
    matrix[i] = [];
    for (let j = 0; j < factors.length; j++) {
      if (i === j) {
        matrix[i][j] = 1;
      } else {
        matrix[i][j] = pearsonCorrelation(scores[i], scores[j]);
      }
    }
  }

  return { factors, matrix };
}

function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length === 0 || y.length === 0 || x.length !== y.length) return 0;

  const n = x.length;
  const meanX = x.reduce((sum, val) => sum + val, 0) / n;
  const meanY = y.reduce((sum, val) => sum + val, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx ** 2;
    denomY += dy ** 2;
  }

  const denom = Math.sqrt(denomX * denomY);
  if (denom === 0) return 0;

  return round(numerator / denom, 4);
}

/**
 * Generates human-readable insights from attribution results.
 */
export function generateInsights(result: AttributionResult): string[] {
  const insights: string[] = [];

  // Factor insights
  const factors: Array<{ name: string; stats: FactorStats }> = [
    { name: 'Technical', stats: result.byFactor.technical },
    { name: 'Fundamental', stats: result.byFactor.fundamental },
    { name: 'Sentiment', stats: result.byFactor.sentiment },
    { name: 'AI', stats: result.byFactor.ai },
  ];

  for (const { name, stats } of factors) {
    if (stats.tradeCount > 0) {
      const accuracyPct = formatPercent(stats.accuracy);
      const avgReturnPct = formatPercent(stats.avgReturn);
      insights.push(
        `${name} signals are ${accuracyPct} accurate with ${avgReturnPct} avg return (${stats.tradeCount} trades)`,
      );
    }
  }

  // Best performing factor
  const sortedFactors = factors
    .filter((f) => f.stats.tradeCount > 0)
    .sort((a, b) => b.stats.contribution - a.stats.contribution);

  if (sortedFactors.length > 0) {
    const best = sortedFactors[0];
    insights.push(
      `Your strongest factor is ${best.name} (${formatCurrency(best.stats.contribution)} avg contribution)`,
    );
  }

  // Sector insights
  const sectors = Object.entries(result.bySector).sort((a, b) => b[1].totalPnl - a[1].totalPnl);
  if (sectors.length > 0) {
    const [bestSector, stats] = sectors[0];
    if (stats.totalPnl > 0) {
      insights.push(
        `Your strongest sector is ${bestSector} (${formatCurrency(stats.totalPnl)} total P&L, ${formatPercent(stats.winRate)} win rate)`,
      );
    }

    // Worst sector
    const worstSector = sectors[sectors.length - 1];
    if (worstSector && worstSector[1].totalPnl < 0) {
      insights.push(
        `Your weakest sector is ${worstSector[0]} (${formatCurrency(worstSector[1].totalPnl)} total P&L)`,
      );
    }
  }

  // Day of week insights
  const weekdayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const weekdays = weekdayOrder
    .map((day) => ({ day, stats: result.byDayOfWeek[day] }))
    .filter((d) => d.stats && d.stats.count > 0)
    .sort((a, b) => (b.stats?.avgReturn ?? 0) - (a.stats?.avgReturn ?? 0));

  if (weekdays.length >= 2) {
    const best = weekdays[0];
    const worst = weekdays[weekdays.length - 1];
    const diff = (best.stats?.avgReturn ?? 0) - (worst.stats?.avgReturn ?? 0);
    if (Math.abs(diff) > 0.01) {
      // > 1% difference
      insights.push(
        `${best.day} trades outperform ${worst.day} trades by ${formatPercent(Math.abs(diff))}`,
      );
    }
  }

  // Time of day insights
  const times = [
    { name: 'morning', stats: result.byTimeOfDay.morning },
    { name: 'midday', stats: result.byTimeOfDay.midday },
    { name: 'afternoon', stats: result.byTimeOfDay.afternoon },
  ]
    .filter((t) => t.stats.count > 0)
    .sort((a, b) => b.stats.avgReturn - a.stats.avgReturn);

  if (times.length >= 2) {
    const best = times[0];
    const worst = times[times.length - 1];
    const diff = best.stats.avgReturn - worst.stats.avgReturn;
    if (Math.abs(diff) > 0.01) {
      insights.push(
        `${capitalizeFirst(best.name)} trading performs best (${formatPercent(best.stats.avgReturn)} avg return)`,
      );
    }
  }

  // Exit reason insights
  const exitReasons = Object.entries(result.byExitReason).sort((a, b) => b[1].avgPnl - a[1].avgPnl);
  if (exitReasons.length > 0) {
    const [bestReason, stats] = exitReasons[0];
    if (stats.avgPnl > 0) {
      insights.push(
        `Most profitable exit reason: ${bestReason} (${formatCurrency(stats.avgPnl)} avg P&L)`,
      );
    }
  }

  // Decision type insights
  const buyWinRate = result.byDecisionType.BUY.winRate;
  const sellWinRate = result.byDecisionType.SELL.winRate;
  if (result.byDecisionType.BUY.count > 0 && result.byDecisionType.SELL.count > 0) {
    if (buyWinRate > sellWinRate) {
      insights.push(
        `BUY signals perform better (${formatPercent(buyWinRate)} vs ${formatPercent(sellWinRate)} win rate)`,
      );
    } else if (sellWinRate > buyWinRate) {
      insights.push(
        `SELL signals perform better (${formatPercent(sellWinRate)} vs ${formatPercent(buyWinRate)} win rate)`,
      );
    }
  }

  // Factor correlation insights
  const { factors: factorNames, matrix } = result.factorCorrelations;
  for (let i = 0; i < factorNames.length; i++) {
    for (let j = i + 1; j < factorNames.length; j++) {
      const corr = matrix[i][j];
      if (Math.abs(corr) > 0.7) {
        // High correlation
        insights.push(
          `${capitalizeFirst(factorNames[i])} and ${factorNames[j]} signals are ${corr > 0 ? 'positively' : 'negatively'} correlated (${corr.toFixed(2)})`,
        );
      }
    }
  }

  return insights;
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── PerformanceAttributor Class ──────────────────────────────────────────

export class PerformanceAttributor {
  /**
   * Main analysis function. Accepts trades and signals as parameters for testability.
   * Computes full attribution breakdown and insights.
   */
  analyze(
    trades: Array<typeof schema.trades.$inferSelect>,
    signals: Array<typeof schema.signals.$inferSelect>,
    fundamentals: Array<{ symbol: string; sector: string | null }> = [],
  ): AttributionResult {
    if (trades.length === 0) {
      return this.emptyResult();
    }

    const matched = matchTradesToSignals(trades, signals, fundamentals);

    const byFactor = computeFactorAttribution(matched);
    const byDecisionType = computeByDecisionType(matched);
    const byExitReason = computeByExitReason(matched);
    const bySector = computeBySector(matched);
    const byTimeOfDay = computeByTimeOfDay(matched);
    const byDayOfWeek = computeByDayOfWeek(matched);
    const factorCorrelations = computeFactorCorrelations(matched);

    const result: AttributionResult = {
      byFactor,
      byDecisionType,
      byExitReason,
      bySector,
      byTimeOfDay,
      byDayOfWeek,
      factorCorrelations,
      insights: [],
    };

    result.insights = generateInsights(result);

    log.info(
      { tradeCount: trades.length, insightCount: result.insights.length },
      'Attribution analysis complete',
    );

    return result;
  }

  /**
   * Queries the database for closed trades and their signals, then runs attribution analysis.
   */
  getFactorBreakdown(): AttributionResult {
    const db = getDb();

    // Get all closed trades
    const closedTrades = db
      .select()
      .from(schema.trades)
      .where(isNotNull(schema.trades.exitPrice))
      .all();

    if (closedTrades.length === 0) {
      log.info('No closed trades found for attribution');
      return this.emptyResult();
    }

    // Get all signals
    const allSignals = db.select().from(schema.signals).all();

    // Get sector info from fundamental cache
    const fundamentals: Array<{ symbol: string; sector: string | null }> = [];
    const uniqueSymbols = [...new Set(closedTrades.map((t) => t.symbol))];

    for (const symbol of uniqueSymbols) {
      const fundRow = db
        .select({ sector: schema.fundamentalCache.sector })
        .from(schema.fundamentalCache)
        .where(eq(schema.fundamentalCache.symbol, symbol))
        .orderBy(desc(schema.fundamentalCache.fetchedAt))
        .limit(1)
        .get();

      fundamentals.push({ symbol, sector: fundRow?.sector ?? null });
    }

    return this.analyze(closedTrades, allSignals, fundamentals);
  }

  private emptyResult(): AttributionResult {
    const emptyStats: FactorStats = {
      contribution: 0,
      accuracy: 0,
      avgReturn: 0,
      tradeCount: 0,
    };

    const emptyDecisionStats: DecisionStats = {
      count: 0,
      totalPnl: 0,
      winRate: 0,
    };

    const emptyPeriodStats: PeriodStats = {
      count: 0,
      totalPnl: 0,
      winRate: 0,
      avgReturn: 0,
    };

    return {
      byFactor: {
        technical: emptyStats,
        fundamental: emptyStats,
        sentiment: emptyStats,
        ai: emptyStats,
      },
      byDecisionType: {
        BUY: emptyDecisionStats,
        SELL: emptyDecisionStats,
      },
      byExitReason: {},
      bySector: {},
      byTimeOfDay: {
        morning: emptyPeriodStats,
        midday: emptyPeriodStats,
        afternoon: emptyPeriodStats,
      },
      byDayOfWeek: {},
      factorCorrelations: {
        factors: ['technical', 'fundamental', 'sentiment', 'ai'],
        matrix: [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
          [0, 0, 0, 1],
        ],
      },
      insights: [],
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────

let attributorInstance: PerformanceAttributor | null = null;

export function getPerformanceAttributor(): PerformanceAttributor {
  if (!attributorInstance) {
    attributorInstance = new PerformanceAttributor();
  }
  return attributorInstance;
}
