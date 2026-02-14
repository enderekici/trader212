import type { OHLCVCandle } from '../data/yahoo-finance.js';
import { getRoiThreshold } from '../execution/roi-table.js';
import {
  calculateMaxDrawdown,
  computeCalmar,
  computeExpectancy,
  computeProfitFactor,
  computeSortino,
  computeSQN,
} from '../monitoring/performance.js';
import { round } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';
import { BacktestDataLoader } from './data-loader.js';
import type {
  BacktestConfig,
  BacktestMetrics,
  BacktestPosition,
  BacktestResult,
  BacktestTrade,
  Candle,
  EntrySignal,
} from './types.js';

const log = createLogger('backtest-engine');

const TRADING_DAYS_PER_YEAR = 252;

/**
 * Score candles using technical analysis. This is a function reference that
 * can be overridden in tests to avoid importing the full scorer (which
 * depends on configManager). In production, it defaults to the real scorer.
 */
export type ScoreFn = (candles: OHLCVCandle[]) => number;

export interface BacktestEngineOptions {
  config: BacktestConfig;
  scoreFn?: ScoreFn;
  dataLoader?: BacktestDataLoader;
}

export class BacktestEngine {
  private config: BacktestConfig;
  private cash: number;
  private positions: Map<string, BacktestPosition>;
  private trades: BacktestTrade[];
  private equityCurve: { date: string; equity: number }[];
  private scoreFn: ScoreFn;
  private dataLoader: BacktestDataLoader;

  constructor(options: BacktestEngineOptions) {
    this.config = options.config;
    this.cash = options.config.initialCapital;
    this.positions = new Map();
    this.trades = [];
    this.equityCurve = [];
    this.dataLoader = options.dataLoader ?? new BacktestDataLoader();

    // Default scoreFn: lazy-load the real scorer to avoid circular dependency issues
    this.scoreFn =
      options.scoreFn ??
      ((_candles: OHLCVCandle[]) => {
        throw new Error(
          'scoreFn not provided. Pass a scoreFn in BacktestEngineOptions or use createBacktestEngine().',
        );
      });
  }

  async run(): Promise<BacktestResult> {
    const { config } = this;
    log.info(
      {
        symbols: config.symbols.length,
        startDate: config.startDate,
        endDate: config.endDate,
        initialCapital: config.initialCapital,
      },
      'Starting backtest',
    );

    // 1. Load historical OHLCV data for all symbols
    const allData = await this.dataLoader.loadMultiple(
      config.symbols,
      config.startDate,
      config.endDate,
    );

    if (allData.size === 0) {
      log.warn('No data loaded for any symbol');
      return this.buildResult();
    }

    // 2. Get common trading dates in the backtest range
    const tradingDates = this.dataLoader.getCommonDates(allData, config.startDate, config.endDate);

    if (tradingDates.length === 0) {
      log.warn('No common trading dates found');
      return this.buildResult();
    }

    log.info(
      { tradingDays: tradingDates.length, symbols: allData.size },
      'Data loaded, iterating through trading days',
    );

    // 3. Build date-indexed maps for fast lookup
    const dateIndexed = this.buildDateIndex(allData);

    // 4. Iterate day by day
    for (let i = 0; i < tradingDates.length; i++) {
      const date = tradingDates[i];
      const prices = dateIndexed.get(date);
      if (!prices) continue;

      // a. Check exit conditions first (FreqTrade pattern: exits before entries)
      this.checkExits(date, prices);

      // b. Generate entry signals (only if we have room for more positions)
      if (this.positions.size < config.maxPositions) {
        const signals = this.generateSignals(date, allData);

        // c. Execute entries for top signals
        for (const signal of signals) {
          if (this.positions.size >= config.maxPositions) break;
          if (this.positions.has(signal.symbol)) continue;

          // Entry at next day's open to avoid look-ahead bias
          const nextDayIdx = i + 1;
          if (nextDayIdx >= tradingDates.length) break;
          const nextDate = tradingDates[nextDayIdx];
          const nextDayPrices = dateIndexed.get(nextDate);
          if (!nextDayPrices) continue;
          const nextDayCandle = nextDayPrices.get(signal.symbol);
          if (!nextDayCandle) continue;

          this.executeEntry(signal, nextDayCandle.open, nextDate);
        }
      }

      // d. Record equity curve point
      const equity = this.computeEquity(prices);
      this.equityCurve.push({ date, equity });
    }

    // 5. Close all remaining positions at end of data
    const lastDate = tradingDates[tradingDates.length - 1];
    const lastPrices = dateIndexed.get(lastDate);
    if (lastPrices) {
      this.closeAllPositions(lastDate, lastPrices, 'end_of_data');
    }

    log.info(
      { trades: this.trades.length, finalEquity: this.computeEquityFromCash() },
      'Backtest complete',
    );

    return this.buildResult();
  }

  private buildDateIndex(allData: Map<string, Candle[]>): Map<string, Map<string, Candle>> {
    const index = new Map<string, Map<string, Candle>>();

    for (const [symbol, candles] of allData) {
      for (const candle of candles) {
        let dateMap = index.get(candle.date);
        if (!dateMap) {
          dateMap = new Map();
          index.set(candle.date, dateMap);
        }
        dateMap.set(symbol, candle);
      }
    }

    return index;
  }

  private checkExits(date: string, prices: Map<string, Candle>): void {
    const symbolsToClose: { symbol: string; price: number; reason: string }[] = [];

    for (const [symbol, position] of this.positions) {
      const candle = prices.get(symbol);
      if (!candle) continue;

      // Check stop-loss: candle low breaches stop price
      if (candle.low <= position.stopLoss) {
        symbolsToClose.push({ symbol, price: position.stopLoss, reason: 'stoploss' });
        continue;
      }

      // Check take-profit: candle high reaches take-profit price
      if (position.takeProfit != null && candle.high >= position.takeProfit) {
        symbolsToClose.push({ symbol, price: position.takeProfit, reason: 'takeprofit' });
        continue;
      }

      // Update trailing stop
      if (this.config.trailingStop && candle.high > position.highWaterMark) {
        position.highWaterMark = candle.high;
        const newTrailingStop = position.highWaterMark * (1 - this.config.stopLossPct);
        if (position.trailingStop == null || newTrailingStop > position.trailingStop) {
          position.trailingStop = newTrailingStop;
          // Update stop-loss to trailing stop if it's higher
          if (position.trailingStop > position.stopLoss) {
            position.stopLoss = position.trailingStop;
          }
        }
      }

      // Check trailing stop (may have been updated above)
      if (position.trailingStop != null && candle.low <= position.trailingStop) {
        symbolsToClose.push({ symbol, price: position.trailingStop, reason: 'trailing_stop' });
        continue;
      }

      // Check ROI table
      if (this.config.roiTable) {
        const entryMs = new Date(position.entryTime).getTime();
        const currentMs = new Date(date).getTime();
        const tradeMinutes = (currentMs - entryMs) / 60000;
        const threshold = getRoiThreshold(this.config.roiTable, tradeMinutes);

        if (threshold != null) {
          const currentProfitPct = (candle.close - position.entryPrice) / position.entryPrice;
          if (currentProfitPct >= threshold) {
            symbolsToClose.push({ symbol, price: candle.close, reason: 'roi_table' });
          }
        }
      }
    }

    // Execute exits
    for (const { symbol, price, reason } of symbolsToClose) {
      this.executeExit(symbol, price, date, reason);
    }
  }

  private generateSignals(date: string, allData: Map<string, Candle[]>): EntrySignal[] {
    const signals: EntrySignal[] = [];

    for (const [symbol, candles] of allData) {
      // Skip if already in a position
      if (this.positions.has(symbol)) continue;

      // Get candles up to and including current date
      const candlesUpToDate = candles.filter((c) => c.date <= date);
      if (candlesUpToDate.length < 50) continue; // Need minimum history

      // Convert to OHLCVCandle format for scoring
      const ohlcvCandles: OHLCVCandle[] = candlesUpToDate.map((c) => ({
        date: c.date,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

      const score = this.scoreFn(ohlcvCandles);

      // Normalize score to 0-1 range (scorer returns 0-100)
      const normalizedScore = score / 100;

      if (normalizedScore >= this.config.entryThreshold) {
        const lastCandle = candlesUpToDate[candlesUpToDate.length - 1];
        signals.push({
          symbol,
          score: normalizedScore,
          price: lastCandle.close,
        });
      }
    }

    // Sort by score descending (best signals first)
    return signals.sort((a, b) => b.score - a.score);
  }

  private executeEntry(signal: EntrySignal, entryPrice: number, date: string): void {
    const equity = this.computeEquityFromCash();
    const maxPositionValue = this.config.maxPositionSizePct * equity;
    const positionValue = Math.min(maxPositionValue, this.cash);

    if (positionValue <= 0) return;

    const shares = Math.floor(positionValue / entryPrice);
    if (shares <= 0) return;

    const cost = shares * entryPrice + this.config.commission;
    if (cost > this.cash) return;

    const stopLoss = entryPrice * (1 - this.config.stopLossPct);
    const takeProfit =
      this.config.takeProfitPct != null ? entryPrice * (1 + this.config.takeProfitPct) : undefined;

    this.cash -= cost;

    const position: BacktestPosition = {
      symbol: signal.symbol,
      shares,
      entryPrice,
      entryTime: date,
      stopLoss,
      trailingStop: this.config.trailingStop ? stopLoss : undefined,
      takeProfit,
      highWaterMark: entryPrice,
      technicalScore: signal.score,
    };

    this.positions.set(signal.symbol, position);

    log.debug(
      {
        symbol: signal.symbol,
        shares,
        entryPrice,
        stopLoss,
        takeProfit,
        date,
      },
      'Entry executed',
    );
  }

  private executeExit(symbol: string, exitPrice: number, date: string, reason: string): void {
    const position = this.positions.get(symbol);
    if (!position) return;

    const grossPnl = (exitPrice - position.entryPrice) * position.shares;
    const pnl = grossPnl - this.config.commission;
    const pnlPct = (exitPrice - position.entryPrice) / position.entryPrice;

    const entryMs = new Date(position.entryTime).getTime();
    const exitMs = new Date(date).getTime();
    const holdMinutes = (exitMs - entryMs) / 60000;

    this.cash += position.shares * exitPrice - this.config.commission;

    const trade: BacktestTrade = {
      symbol,
      side: 'SELL',
      entryPrice: position.entryPrice,
      exitPrice,
      shares: position.shares,
      entryTime: position.entryTime,
      exitTime: date,
      pnl: round(pnl, 2),
      pnlPct: round(pnlPct, 4),
      exitReason: reason,
      holdMinutes: Math.round(holdMinutes),
      technicalScore: position.technicalScore,
    };

    this.trades.push(trade);
    this.positions.delete(symbol);

    log.debug(
      {
        symbol,
        exitPrice,
        pnl: trade.pnl,
        pnlPct: trade.pnlPct,
        reason,
        date,
      },
      'Exit executed',
    );
  }

  private closeAllPositions(date: string, prices: Map<string, Candle>, reason: string): void {
    const symbols = [...this.positions.keys()];
    for (const symbol of symbols) {
      const candle = prices.get(symbol);
      if (candle) {
        this.executeExit(symbol, candle.close, date, reason);
      }
    }
  }

  private computeEquity(prices: Map<string, Candle>): number {
    let positionValue = 0;
    for (const [symbol, position] of this.positions) {
      const candle = prices.get(symbol);
      const price = candle ? candle.close : position.entryPrice;
      positionValue += price * position.shares;
    }
    return round(this.cash + positionValue, 2);
  }

  private computeEquityFromCash(): number {
    let positionValue = 0;
    for (const position of this.positions.values()) {
      positionValue += position.entryPrice * position.shares;
    }
    return this.cash + positionValue;
  }

  private buildResult(): BacktestResult {
    const metrics = this.computeMetrics();
    const dailyReturns = this.computeDailyReturns();

    return {
      config: this.config,
      trades: this.trades,
      metrics,
      equityCurve: this.equityCurve,
      dailyReturns,
    };
  }

  private computeDailyReturns(): number[] {
    const returns: number[] = [];
    for (let i = 1; i < this.equityCurve.length; i++) {
      const prev = this.equityCurve[i - 1].equity;
      const curr = this.equityCurve[i].equity;
      if (prev > 0) {
        returns.push((curr - prev) / prev);
      }
    }
    return returns;
  }

  private computeMetrics(): BacktestMetrics {
    const { trades, config } = this;
    const finalEquity =
      this.equityCurve.length > 0
        ? this.equityCurve[this.equityCurve.length - 1].equity
        : config.initialCapital;

    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winCount: 0,
        lossCount: 0,
        winRate: 0,
        totalPnl: 0,
        totalPnlPct: 0,
        avgWin: null,
        avgLoss: null,
        maxDrawdown: 0,
        maxDrawdownPct: 0,
        currentDrawdown: 0,
        sharpeRatio: null,
        sortinoRatio: null,
        calmarRatio: null,
        sqn: null,
        expectancy: null,
        profitFactor: null,
        avgHoldMinutes: 0,
        bestTrade: null,
        worstTrade: null,
        finalEquity: round(finalEquity, 2),
        returnPct: 0,
      };
    }

    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl <= 0);
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

    // Daily returns for Sharpe/Sortino/Calmar
    const dailyReturns = this.computeDailyReturns();

    // Sharpe ratio
    let sharpeRatio: number | null = null;
    if (dailyReturns.length >= 5) {
      const riskFreeDaily = 0.05 / TRADING_DAYS_PER_YEAR;
      const excessReturns = dailyReturns.map((r) => r - riskFreeDaily);
      const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
      const excessVariance =
        excessReturns.reduce((sum, r) => sum + (r - meanExcess) ** 2, 0) / excessReturns.length;
      const excessStdDev = Math.sqrt(excessVariance);
      if (excessStdDev > 0) {
        sharpeRatio = round((meanExcess / excessStdDev) * Math.sqrt(TRADING_DAYS_PER_YEAR), 2);
      }
    }

    // Sortino ratio
    const sortinoRatio = computeSortino(dailyReturns);

    // Max drawdown from cumulative trade P&Ls
    const tradePnls = trades.map((t) => ({ pnl: t.pnl, exitTime: t.exitTime }));
    const drawdownResult = calculateMaxDrawdown(tradePnls);

    // Calmar ratio
    const calmarRatio =
      dailyReturns.length >= 5 && drawdownResult.maxDrawdownPct > 0
        ? computeCalmar(dailyReturns, drawdownResult.maxDrawdownPct)
        : null;

    // SQN from per-trade return percentages
    const tradeReturnPcts = trades.map((t) => t.pnlPct);
    const sqn = computeSQN(tradeReturnPcts);

    // Expectancy
    const { expectancy, avgWin, avgLoss } = computeExpectancy(trades.map((t) => ({ pnl: t.pnl })));

    // Profit factor
    const profitFactor = computeProfitFactor(trades.map((t) => ({ pnl: t.pnl })));

    // Average hold time
    const avgHoldMinutes =
      trades.length > 0 ? trades.reduce((sum, t) => sum + t.holdMinutes, 0) / trades.length : 0;

    // Best/worst trades
    const sorted = [...trades].sort((a, b) => a.pnlPct - b.pnlPct);
    const worstTrade = sorted[0] ? { symbol: sorted[0].symbol, pnlPct: sorted[0].pnlPct } : null;
    const bestTrade = sorted[sorted.length - 1]
      ? { symbol: sorted[sorted.length - 1].symbol, pnlPct: sorted[sorted.length - 1].pnlPct }
      : null;

    return {
      totalTrades: trades.length,
      winCount: wins.length,
      lossCount: losses.length,
      winRate: round(wins.length / trades.length, 4),
      totalPnl: round(totalPnl, 2),
      totalPnlPct: round(totalPnl / config.initialCapital, 4),
      avgWin,
      avgLoss,
      maxDrawdown: drawdownResult.maxDrawdown,
      maxDrawdownPct: drawdownResult.maxDrawdownPct,
      currentDrawdown: drawdownResult.currentDrawdown,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      sqn,
      expectancy,
      profitFactor,
      avgHoldMinutes: round(avgHoldMinutes, 0),
      bestTrade,
      worstTrade,
      finalEquity: round(finalEquity, 2),
      returnPct: round((finalEquity - config.initialCapital) / config.initialCapital, 4),
    };
  }
}

/**
 * Factory that creates a BacktestEngine with the real scorer loaded.
 * Use this in production; use the constructor directly in tests.
 */
export async function createBacktestEngine(
  config: BacktestConfig,
  dataLoader?: BacktestDataLoader,
): Promise<BacktestEngine> {
  const { scoreTechnicals } = await import('../analysis/technical/scorer.js');
  return new BacktestEngine({
    config,
    scoreFn: scoreTechnicals,
    dataLoader,
  });
}
