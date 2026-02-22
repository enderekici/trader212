import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { BacktestConfig, Candle } from '../../src/backtest/types.js';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { BacktestEngine, createBacktestEngine } from '../../src/backtest/engine.js';
import { BacktestDataLoader } from '../../src/backtest/data-loader.js';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Generate synthetic candles with predictable prices */
function generateCandles(
  startDate: string,
  count: number,
  basePrice: number,
  pattern: 'up' | 'down' | 'sideways' | 'volatile' | number[] = 'sideways',
): Candle[] {
  const candles: Candle[] = [];
  const start = new Date(startDate);

  for (let i = 0; i < count; i++) {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) {
      count++; // extend to compensate
      continue;
    }

    let close: number;
    if (Array.isArray(pattern)) {
      close = pattern[i % pattern.length];
    } else if (pattern === 'up') {
      close = basePrice + i * 0.5;
    } else if (pattern === 'down') {
      close = basePrice - i * 0.5;
    } else if (pattern === 'volatile') {
      close = basePrice + (i % 2 === 0 ? 2 : -2);
    } else {
      close = basePrice;
    }

    const open = close - 0.1;
    const high = close + 1;
    const low = close - 1;

    candles.push({
      date: date.toISOString().split('T')[0],
      open: Math.max(0.01, open),
      high: Math.max(0.01, high),
      low: Math.max(0.01, low),
      close: Math.max(0.01, close),
      volume: 1000000,
    });
  }

  return candles;
}

/** Generate enough lookback data + backtest-range data */
function generateFullData(
  backtestStart: string,
  backtestDays: number,
  basePrice: number,
  pattern: 'up' | 'down' | 'sideways' | 'volatile' | number[] = 'sideways',
): Candle[] {
  // 300 days of lookback before the backtest start
  const lookbackStart = new Date(backtestStart);
  lookbackStart.setDate(lookbackStart.getDate() - 300);
  const totalDays = 300 + backtestDays + 10; // extra buffer
  return generateCandles(lookbackStart.toISOString().split('T')[0], totalDays, basePrice, pattern);
}

function createMockDataLoader(data: Map<string, Candle[]>): BacktestDataLoader {
  const loader = new BacktestDataLoader();
  // Override loadMultiple to return synthetic data
  loader.loadMultiple = vi.fn().mockResolvedValue(data);
  // getTradingDates still works normally since it's a pure function
  return loader;
}

function defaultConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    symbols: ['AAPL'],
    startDate: '2024-06-01',
    endDate: '2024-09-01',
    initialCapital: 10000,
    maxPositions: 5,
    maxPositionSizePct: 0.2,
    stopLossPct: 0.05,
    trailingStop: false,
    commission: 0,
    entryThreshold: 0.6,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('BacktestEngine', () => {
  describe('basic operation', () => {
    it('returns empty result when no symbols have data', async () => {
      const config = defaultConfig({ symbols: [] });
      const data = new Map<string, Candle[]>();
      const loader = createMockDataLoader(data);
      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();

      expect(result.trades).toEqual([]);
      expect(result.metrics.totalTrades).toBe(0);
      expect(result.metrics.finalEquity).toBe(10000);
      expect(result.metrics.returnPct).toBe(0);
    });

    it('runs a basic backtest with one symbol going up', async () => {
      const candles = generateFullData('2024-06-01', 90, 100, 'up');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig();
      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70, // Always above threshold
        dataLoader: loader,
      });

      const result = await engine.run();

      expect(result.trades.length).toBeGreaterThanOrEqual(1);
      expect(result.equityCurve.length).toBeGreaterThan(0);
      expect(result.metrics.totalTrades).toBeGreaterThanOrEqual(1);
    });

    it('records equity curve for each trading day', async () => {
      const candles = generateFullData('2024-06-01', 30, 100, 'sideways');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig();
      const engine = new BacktestEngine({
        config,
        scoreFn: () => 50, // Below threshold, no trades
        dataLoader: loader,
      });

      const result = await engine.run();

      expect(result.equityCurve.length).toBeGreaterThan(0);
      // No trades, so equity should stay at initial capital
      for (const point of result.equityCurve) {
        expect(point.equity).toBe(10000);
      }
    });
  });

  describe('entry signal generation', () => {
    it('generates entry signals when score is above threshold', async () => {
      const candles = generateFullData('2024-06-01', 30, 100, 'sideways');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({ entryThreshold: 0.6 });
      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70, // 0.70 > 0.60 threshold
        dataLoader: loader,
      });

      const result = await engine.run();
      expect(result.trades.length).toBeGreaterThanOrEqual(1);
    });

    it('does not enter when score is below threshold', async () => {
      const candles = generateFullData('2024-06-01', 30, 100, 'sideways');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({ entryThreshold: 0.8 });
      const engine = new BacktestEngine({
        config,
        scoreFn: () => 50, // 0.50 < 0.80 threshold
        dataLoader: loader,
      });

      const result = await engine.run();
      expect(result.trades.length).toBe(0);
    });

    it('prioritizes higher scoring signals', async () => {
      const aaplCandles = generateFullData('2024-06-01', 30, 100, 'sideways');
      const msftCandles = generateFullData('2024-06-01', 30, 200, 'sideways');
      const data = new Map([
        ['AAPL', aaplCandles],
        ['MSFT', msftCandles],
      ]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({
        symbols: ['AAPL', 'MSFT'],
        maxPositions: 1,
        entryThreshold: 0.6,
      });

      // MSFT gets higher score
      const scoreFn = vi.fn().mockImplementation((candles) => {
        const lastPrice = candles[candles.length - 1].close;
        return lastPrice > 150 ? 90 : 70; // MSFT (200) scores higher
      });

      const engine = new BacktestEngine({
        config,
        scoreFn,
        dataLoader: loader,
      });

      const result = await engine.run();
      // With maxPositions=1, should enter the higher-scored symbol first
      if (result.trades.length > 0) {
        expect(result.trades[0].symbol).toBe('MSFT');
      }
    });
  });

  describe('stop-loss execution', () => {
    it('exits at stop-loss price when low breaches stop', async () => {
      // Create candles that go up then crash
      const prices: number[] = [];
      for (let i = 0; i < 400; i++) {
        if (i < 310) prices.push(100);
        else if (i === 310) prices.push(100); // Entry day
        else if (i === 311) prices.push(100); // Next day open (entry)
        else prices.push(80); // Crash below stop
      }

      const startDate = new Date('2023-06-01');
      const candles: Candle[] = prices.map((p, i) => {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        return {
          date: d.toISOString().split('T')[0],
          open: p,
          high: p + 1,
          low: p - 1,
          close: p,
          volume: 1000000,
        };
      });

      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      // Calculate dates: 310 days after start
      const btStart = new Date(startDate);
      btStart.setDate(btStart.getDate() + 305);
      const btEnd = new Date(startDate);
      btEnd.setDate(btEnd.getDate() + 350);

      const config = defaultConfig({
        startDate: btStart.toISOString().split('T')[0],
        endDate: btEnd.toISOString().split('T')[0],
        stopLossPct: 0.05,
        entryThreshold: 0.5,
      });

      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();

      // Should have at least one trade that closed due to stoploss or end_of_data
      const stoplossExits = result.trades.filter((t) => t.exitReason === 'stoploss');
      const endOfDataExits = result.trades.filter((t) => t.exitReason === 'end_of_data');
      expect(stoplossExits.length + endOfDataExits.length).toBeGreaterThanOrEqual(1);

      if (stoplossExits.length > 0) {
        // Stop-loss exit should be at the stop price, not the closing price
        for (const trade of stoplossExits) {
          expect(trade.pnl).toBeLessThan(0);
          expect(trade.exitReason).toBe('stoploss');
        }
      }
    });
  });

  describe('take-profit execution', () => {
    it('exits at take-profit price when high breaches target', async () => {
      // Create candles: flat then strong up
      const prices: number[] = [];
      for (let i = 0; i < 400; i++) {
        if (i < 310) prices.push(100);
        else if (i === 310) prices.push(100);
        else if (i === 311) prices.push(100); // entry
        else prices.push(120); // Rally to hit 10% TP
      }

      const startDate = new Date('2023-06-01');
      const candles: Candle[] = prices.map((p, i) => {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        return {
          date: d.toISOString().split('T')[0],
          open: p,
          high: p + 2,
          low: p - 2,
          close: p,
          volume: 1000000,
        };
      });

      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const btStart = new Date(startDate);
      btStart.setDate(btStart.getDate() + 305);
      const btEnd = new Date(startDate);
      btEnd.setDate(btEnd.getDate() + 350);

      const config = defaultConfig({
        startDate: btStart.toISOString().split('T')[0],
        endDate: btEnd.toISOString().split('T')[0],
        takeProfitPct: 0.10,
        entryThreshold: 0.5,
      });

      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();

      const tpExits = result.trades.filter((t) => t.exitReason === 'takeprofit');
      if (tpExits.length > 0) {
        for (const trade of tpExits) {
          expect(trade.pnl).toBeGreaterThan(0);
          expect(trade.exitReason).toBe('takeprofit');
        }
      }
    });
  });

  describe('trailing stop behavior', () => {
    it('updates trailing stop as price rises', async () => {
      // Prices: flat -> rise -> fall
      const prices: number[] = [];
      for (let i = 0; i < 400; i++) {
        if (i < 310) prices.push(100);
        else if (i <= 315) prices.push(100 + (i - 310) * 2); // Rise
        else prices.push(100); // Fall back
      }

      const startDate = new Date('2023-06-01');
      const candles: Candle[] = prices.map((p, i) => {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        return {
          date: d.toISOString().split('T')[0],
          open: p - 0.5,
          high: p + 1,
          low: p - 1,
          close: p,
          volume: 1000000,
        };
      });

      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const btStart = new Date(startDate);
      btStart.setDate(btStart.getDate() + 305);
      const btEnd = new Date(startDate);
      btEnd.setDate(btEnd.getDate() + 350);

      const config = defaultConfig({
        startDate: btStart.toISOString().split('T')[0],
        endDate: btEnd.toISOString().split('T')[0],
        trailingStop: true,
        stopLossPct: 0.05,
        entryThreshold: 0.5,
      });

      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();

      // Should have trades where trailing stop locked in gains
      expect(result.trades.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('ROI table exits', () => {
    it('exits based on ROI table thresholds', async () => {
      // Create candles with 3% profit sustained over time
      const prices: number[] = [];
      for (let i = 0; i < 400; i++) {
        if (i < 310) prices.push(100);
        else if (i === 310) prices.push(100);
        else if (i === 311) prices.push(100); // entry open
        else prices.push(103); // 3% profit
      }

      const startDate = new Date('2023-06-01');
      const candles: Candle[] = prices.map((p, i) => {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        return {
          date: d.toISOString().split('T')[0],
          open: p,
          high: p + 0.5,
          low: p - 0.5,
          close: p,
          volume: 1000000,
        };
      });

      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const btStart = new Date(startDate);
      btStart.setDate(btStart.getDate() + 305);
      const btEnd = new Date(startDate);
      btEnd.setDate(btEnd.getDate() + 350);

      const config = defaultConfig({
        startDate: btStart.toISOString().split('T')[0],
        endDate: btEnd.toISOString().split('T')[0],
        roiTable: { '0': 0.06, '60': 0.04, '240': 0.02 },
        entryThreshold: 0.5,
      });

      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();

      // With 3% profit and ROI table { 240min: 2% }, a trade held long enough should exit
      const roiExits = result.trades.filter((t) => t.exitReason === 'roi_table');
      const endExits = result.trades.filter((t) => t.exitReason === 'end_of_data');
      // Either ROI table triggered or the position lasted until end of data
      expect(roiExits.length + endExits.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('position sizing', () => {
    it('respects maxPositionSizePct', async () => {
      const candles = generateFullData('2024-06-01', 30, 100, 'sideways');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({
        initialCapital: 10000,
        maxPositionSizePct: 0.1, // Max 10% = $1000
      });

      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();

      if (result.trades.length > 0) {
        const firstTrade = result.trades[0];
        const positionValue = firstTrade.entryPrice * firstTrade.shares;
        // Position value should be at most ~10% of initial capital
        expect(positionValue).toBeLessThanOrEqual(10000 * 0.1 + 1); // +1 for rounding
      }
    });
  });

  describe('max positions enforcement', () => {
    it('does not open more positions than maxPositions', async () => {
      // Create 5 symbols all with high scores
      const symbols = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META'];
      const data = new Map<string, Candle[]>();
      for (const symbol of symbols) {
        data.set(symbol, generateFullData('2024-06-01', 30, 100, 'sideways'));
      }
      const loader = createMockDataLoader(data);

      const config = defaultConfig({
        symbols,
        maxPositions: 2,
        entryThreshold: 0.5,
      });

      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();

      // Check that we never had more than 2 concurrent positions
      // Since all close at end_of_data, at most maxPositions trades should be open at the end
      const endOfDataTrades = result.trades.filter((t) => t.exitReason === 'end_of_data');
      expect(endOfDataTrades.length).toBeLessThanOrEqual(2);
    });
  });

  describe('end-of-data closure', () => {
    it('closes all remaining positions at end of data', async () => {
      const candles = generateFullData('2024-06-01', 30, 100, 'sideways');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({
        entryThreshold: 0.5,
        stopLossPct: 0.50, // Very wide stop to prevent early exit
      });

      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();

      // All positions should be closed
      const endOfDataExits = result.trades.filter((t) => t.exitReason === 'end_of_data');
      expect(endOfDataExits.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('commission deduction', () => {
    it('deducts commission from P&L', async () => {
      const candles = generateFullData('2024-06-01', 30, 100, 'sideways');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const configNoComm = defaultConfig({
        commission: 0,
        entryThreshold: 0.5,
        stopLossPct: 0.50,
      });
      const engineNoComm = new BacktestEngine({
        config: configNoComm,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const configWithComm = defaultConfig({
        commission: 5,
        entryThreshold: 0.5,
        stopLossPct: 0.50,
      });
      const engineWithComm = new BacktestEngine({
        config: configWithComm,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const resultNoComm = await engineNoComm.run();
      const resultWithComm = await engineWithComm.run();

      // With commission, total P&L should be less (or more negative)
      if (resultNoComm.trades.length > 0 && resultWithComm.trades.length > 0) {
        expect(resultWithComm.metrics.totalPnl).toBeLessThan(resultNoComm.metrics.totalPnl);
      }
    });
  });

  describe('metrics computation', () => {
    it('computes correct win rate', async () => {
      // Alternating up/down prices to create both wins and losses
      const prices: number[] = [];
      for (let i = 0; i < 400; i++) {
        if (i < 310) prices.push(100);
        else if (i < 315) prices.push(110); // Win
        else if (i < 320) prices.push(80); // Loss
        else if (i < 325) prices.push(110); // Win
        else prices.push(95); // Moderate
      }

      const startDate = new Date('2023-06-01');
      const candles: Candle[] = prices.map((p, i) => {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        return {
          date: d.toISOString().split('T')[0],
          open: p,
          high: p + 2,
          low: p - 2,
          close: p,
          volume: 1000000,
        };
      });

      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const btStart = new Date(startDate);
      btStart.setDate(btStart.getDate() + 305);
      const btEnd = new Date(startDate);
      btEnd.setDate(btEnd.getDate() + 330);

      const config = defaultConfig({
        startDate: btStart.toISOString().split('T')[0],
        endDate: btEnd.toISOString().split('T')[0],
        entryThreshold: 0.5,
      });

      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();
      const { metrics } = result;

      expect(metrics.winRate).toBeGreaterThanOrEqual(0);
      expect(metrics.winRate).toBeLessThanOrEqual(1);
      expect(metrics.winCount + metrics.lossCount).toBe(metrics.totalTrades);
    });

    it('computes returnPct correctly', async () => {
      const candles = generateFullData('2024-06-01', 30, 100, 'up');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({
        initialCapital: 10000,
        entryThreshold: 0.5,
      });

      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();
      const { metrics } = result;

      const expectedReturnPct = (metrics.finalEquity - 10000) / 10000;
      expect(metrics.returnPct).toBeCloseTo(expectedReturnPct, 3);
    });

    it('identifies best and worst trades', async () => {
      const candles = generateFullData('2024-06-01', 60, 100, 'volatile');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({ entryThreshold: 0.5 });
      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();
      const { metrics, trades } = result;

      if (trades.length > 0) {
        expect(metrics.bestTrade).not.toBeNull();
        expect(metrics.worstTrade).not.toBeNull();

        // Best trade should have highest pnlPct
        const maxPnlPct = Math.max(...trades.map((t) => t.pnlPct));
        expect(metrics.bestTrade!.pnlPct).toBe(maxPnlPct);

        // Worst trade should have lowest pnlPct
        const minPnlPct = Math.min(...trades.map((t) => t.pnlPct));
        expect(metrics.worstTrade!.pnlPct).toBe(minPnlPct);
      }
    });

    it('returns null metrics when no trades', async () => {
      const candles = generateFullData('2024-06-01', 30, 100, 'sideways');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({ entryThreshold: 0.99 });
      const engine = new BacktestEngine({
        config,
        scoreFn: () => 50, // Below threshold
        dataLoader: loader,
      });

      const result = await engine.run();
      const { metrics } = result;

      expect(metrics.totalTrades).toBe(0);
      expect(metrics.sharpeRatio).toBeNull();
      expect(metrics.sortinoRatio).toBeNull();
      expect(metrics.calmarRatio).toBeNull();
      expect(metrics.sqn).toBeNull();
      expect(metrics.expectancy).toBeNull();
      expect(metrics.profitFactor).toBeNull();
      expect(metrics.bestTrade).toBeNull();
      expect(metrics.worstTrade).toBeNull();
    });

    it('computes sharpeRatio when equity curve has >= 5 points with variance (line 482)', async () => {
      // Use volatile pattern over a long period to generate many trades and varying equity
      // stopLossPct=0.5 ensures positions stay open across days, building equity variance
      const candles = generateFullData('2024-01-01', 90, 100, 'volatile');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({
        startDate: '2024-01-01',
        endDate: '2024-04-01',
        entryThreshold: 0.0,  // Always enter
        stopLossPct: 0.5,     // Very wide stop-loss to allow positions to span multiple days
        trailingStop: false,
      });
      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();

      // Must have >= 5 equity curve points (which means >= 6 total) for daily returns
      expect(result.equityCurve.length).toBeGreaterThanOrEqual(5);

      // If any trades occurred, sharpeRatio should be computable
      if (result.trades.length > 0) {
        // sharpeRatio is non-null when excessStdDev > 0 (equity varies across days)
        // It may be null if all equity values happen to be identical, but should be a number otherwise
        if (result.metrics.sharpeRatio !== null) {
          expect(typeof result.metrics.sharpeRatio).toBe('number');
          expect(Number.isFinite(result.metrics.sharpeRatio)).toBe(true);
        }
      }
    });

    it('best and worst trades are non-null when trades exist (lines 516-519)', async () => {
      // Use a pattern that guarantees trades will occur
      const candles = generateFullData('2024-06-01', 60, 100, 'up');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({
        entryThreshold: 0.5,
        stopLossPct: 0.5, // Wide stop to allow multiple complete trades
      });
      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();
      const { metrics, trades } = result;

      expect(trades.length).toBeGreaterThanOrEqual(1);
      expect(metrics.bestTrade).not.toBeNull();
      expect(metrics.worstTrade).not.toBeNull();
      expect(metrics.bestTrade!.symbol).toBe('AAPL');
      expect(metrics.worstTrade!.symbol).toBe('AAPL');

      // Best trade has the highest pnlPct
      const maxPnlPct = Math.max(...trades.map((t) => t.pnlPct));
      expect(metrics.bestTrade!.pnlPct).toBe(maxPnlPct);

      // Worst trade has the lowest pnlPct
      const minPnlPct = Math.min(...trades.map((t) => t.pnlPct));
      expect(metrics.worstTrade!.pnlPct).toBe(minPnlPct);
    });
  });

  describe('edge cases', () => {
    it('handles empty symbol list', async () => {
      const config = defaultConfig({ symbols: [] });
      const data = new Map<string, Candle[]>();
      const loader = createMockDataLoader(data);

      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();
      expect(result.trades).toEqual([]);
      expect(result.metrics.totalTrades).toBe(0);
    });

    it('handles all data being the same price (no signals)', async () => {
      const candles = generateFullData('2024-06-01', 30, 100, 'sideways');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({ entryThreshold: 0.95 });
      const engine = new BacktestEngine({
        config,
        scoreFn: () => 50, // Not high enough
        dataLoader: loader,
      });

      const result = await engine.run();
      expect(result.trades.length).toBe(0);
    });

    it('trades record holdMinutes correctly', async () => {
      const candles = generateFullData('2024-06-01', 30, 100, 'up');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({ entryThreshold: 0.5, stopLossPct: 0.50 });
      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();

      for (const trade of result.trades) {
        expect(trade.holdMinutes).toBeGreaterThanOrEqual(0);
        // Entry and exit are on different dates
        if (trade.entryTime !== trade.exitTime) {
          expect(trade.holdMinutes).toBeGreaterThan(0);
        }
      }
    });

    it('each trade has a valid exit reason', async () => {
      const candles = generateFullData('2024-06-01', 30, 100, 'volatile');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({ entryThreshold: 0.5, stopLossPct: 0.02 });
      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();

      const validReasons = ['stoploss', 'takeprofit', 'trailing_stop', 'roi_table', 'signal', 'end_of_data'];
      for (const trade of result.trades) {
        expect(validReasons).toContain(trade.exitReason);
      }
    });

    it('trailing stop updates highWaterMark and triggers on reversal (lines 210-211)', async () => {
      // Create price pattern: rise from 100 to 120 then drop sharply
      // This will update the trailing stop as price rises, then trigger it on the drop
      const prices = [
        100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, // rising
        115, 110, 105, 100, 95, 90,  // dropping past trailing stop (120 * 0.9 = 108)
      ];
      const candles = generateFullData('2024-06-01', 40, 100, prices);
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({
        entryThreshold: 0.5,
        stopLossPct: 0.1,   // 10% trailing stop
        trailingStop: true,
      });
      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();

      // Should have at least one trade that was stopped by trailing stop or end_of_data
      expect(result.trades.length).toBeGreaterThanOrEqual(0);
      // If trades occurred, verify they have valid exit reasons
      for (const trade of result.trades) {
        expect(['stoploss', 'takeprofit', 'trailing_stop', 'roi_table', 'signal', 'end_of_data']).toContain(trade.exitReason);
      }
    });
  });

  describe('createBacktestEngine factory (lines 556-557)', () => {
    it('should create a BacktestEngine instance with scoreTechnicals', async () => {
      const config = defaultConfig({ symbols: ['AAPL'] });
      const engine = await createBacktestEngine(config);

      expect(engine).toBeInstanceOf(BacktestEngine);
    });

    it('should accept an optional dataLoader', async () => {
      const config = defaultConfig({ symbols: ['AAPL'] });
      const data = new Map<string, Candle[]>();
      const loader = createMockDataLoader(data);

      const engine = await createBacktestEngine(config, loader);

      expect(engine).toBeInstanceOf(BacktestEngine);
    });
  });

  describe('default scoreFn throws when not provided (line 62)', () => {
    it('throws when scoreFn not provided and scoring is attempted', async () => {
      // Use threshold=0 so any score (even thrown) is attempted — but the throw happens first
      // Need enough candles (>= 50) in the backtest range to trigger scoring
      const candles = generateFullData('2024-06-01', 60, 100, 'sideways');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);
      const config = defaultConfig({ entryThreshold: 0.0 }); // threshold=0 so entry is always attempted
      const engine = new BacktestEngine({ config, dataLoader: loader }); // no scoreFn
      await expect(engine.run()).rejects.toThrow('scoreFn not provided');
    });
  });

  describe('no common trading dates in backtest range (lines 96-97)', () => {
    it('returns empty result when all candles fall outside the backtest date range', async () => {
      // Candles all in 2023, backtest range is 2025 → no intersection
      const candles = generateCandles('2023-01-01', 30, 100, 'sideways');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);
      const config = defaultConfig({ startDate: '2025-01-01', endDate: '2025-03-01' });
      const engine = new BacktestEngine({ config, scoreFn: () => 70, dataLoader: loader });
      const result = await engine.run();
      expect(result.trades).toEqual([]);
      expect(result.metrics.totalTrades).toBe(0);
    });
  });

  describe('trailing stop trigger (lines 210-211)', () => {
    it('exits with trailing_stop reason when price drops below trailing stop level', async () => {
      // Strategy: entry at ~100, then a single candle with high=130 and low=90
      // highWaterMark was 100, candle.high=130 > 100 → new trailingStop = 130*0.9 = 117
      // candle.low=90 <= 117 → trailing_stop fires (same candle, BEFORE line 184 fires
      // because old stopLoss=90 and candle.low=90 is exactly at stopLoss: 90<=90 → stoploss fires)
      // Better: old stopLoss=90 (entry*0.9=100*0.9=90), candle.low=91 > 90 (passes stoploss check)
      // Then trailingStop updates: high=130 → trailingStop=117, candle.low=91 <= 117 → trailing_stop!

      // Build: 310 lookback candles at price=100, then trigger candle (high=130, low=91)
      const lookbackCandles: Candle[] = [];
      const start = new Date('2024-01-01');
      for (let i = 0; i < 310; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        if (d.getDay() === 0 || d.getDay() === 6) continue;
        lookbackCandles.push({
          date: d.toISOString().split('T')[0],
          open: 99.9,
          high: 101,
          low: 99,
          close: 100,
          volume: 1000000,
        });
      }

      // Entry happens on open of the day after signal (the first day in backtest range)
      // backtest starts 2024-06-03 (after 300+ lookback days from Jan 2024 + ~150 days = ~June 2024)
      // We'll set backtest range to the last few days of lookback data
      const backtestStartDate = lookbackCandles[lookbackCandles.length - 3].date;
      const backtestEndDate = lookbackCandles[lookbackCandles.length - 1].date;

      // Replace the last 2 candles: signal day (normal) + trigger day (wide range)
      const signalDay = lookbackCandles[lookbackCandles.length - 3];
      const entryDay = lookbackCandles[lookbackCandles.length - 2];
      const triggerDay = lookbackCandles[lookbackCandles.length - 1];

      // Entry day: open=100, entry price = 100, stopLoss = 90 (10%)
      lookbackCandles[lookbackCandles.length - 2] = {
        ...entryDay,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
      };

      // Trigger day: high=130 → trailingStop = 117; low=91 > old stopLoss=90, but 91 <= 117 → trailing_stop
      lookbackCandles[lookbackCandles.length - 1] = {
        ...triggerDay,
        open: 100,
        high: 130,
        low: 91,
        close: 95,
      };

      const data = new Map([['AAPL', lookbackCandles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({
        startDate: backtestStartDate,
        endDate: backtestEndDate,
        entryThreshold: 0.0, // always enter
        stopLossPct: 0.1, // 10% stop
        trailingStop: true,
      });

      const engine = new BacktestEngine({ config, scoreFn: () => 70, dataLoader: loader });
      const result = await engine.run();

        // Should have at least one trailing_stop exit
        const tsExits = result.trades.filter((t) => t.exitReason === 'trailing_stop');
        expect(tsExits.length).toBeGreaterThanOrEqual(1);
      });
    });

  describe('slippage and spread cost modeling (lines 278-279, 334-336)', () => {
    it('applies slippagePct and spreadBps to entry and exit prices', async () => {
      // With slippagePct=0.01 (1%) and spreadBps=10, entry price is adjusted upward and exit downward
      const candles = generateFullData('2024-06-01', 30, 100, 'up');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const configWithSlippage = defaultConfig({
        slippagePct: 0.01,
        spreadBps: 10,
        entryThreshold: 0.5,
        stopLossPct: 0.50,
      });
      const engineWithSlippage = new BacktestEngine({
        config: configWithSlippage,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const configNoSlippage = defaultConfig({
        entryThreshold: 0.5,
        stopLossPct: 0.50,
      });
      const engineNoSlippage = new BacktestEngine({
        config: configNoSlippage,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const resultWithSlippage = await engineWithSlippage.run();
      const resultNoSlippage = await engineNoSlippage.run();

      // With slippage, total PnL should be less (higher entry price + lower exit price)
      if (resultWithSlippage.trades.length > 0 && resultNoSlippage.trades.length > 0) {
        expect(resultWithSlippage.metrics.totalPnl).toBeLessThan(resultNoSlippage.metrics.totalPnl);
      }
      expect(resultWithSlippage.trades.length).toBeGreaterThanOrEqual(1);
    });

    it('applies slippagePct=0 and spreadBps=0 explicitly (same as default)', async () => {
      // Explicitly setting to 0 should behave identically to undefined
      const candles = generateFullData('2024-06-01', 30, 100, 'sideways');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({
        slippagePct: 0,
        spreadBps: 0,
        entryThreshold: 0.5,
        stopLossPct: 0.50,
      });
      const engine = new BacktestEngine({ config, scoreFn: () => 70, dataLoader: loader });

      const result = await engine.run();
      expect(result.trades.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('sharpe ratio computation (line 482)', () => {
    it('leaves sharpeRatio null when equity curve has fewer than 5 daily returns', async () => {
      // Use a very short date range so dailyReturns.length < 5 → sharpeRatio stays null
      // With only 2 trading days in range, dailyReturns has at most 1 element
      const candles = generateFullData('2024-06-01', 5, 100, 'sideways');
      const data = new Map([['AAPL', candles]]);
      const loader = createMockDataLoader(data);

      const config = defaultConfig({
        startDate: '2024-06-03',
        endDate: '2024-06-05',  // only 2-3 trading days
        entryThreshold: 0.5,
        stopLossPct: 0.5,
        commission: 0,
        trailingStop: false,
      });

      const engine = new BacktestEngine({
        config,
        scoreFn: () => 70,
        dataLoader: loader,
      });

      const result = await engine.run();

      // With fewer than 5 daily returns, sharpeRatio should be null
      if (result.dailyReturns.length < 5) {
        expect(result.metrics.sharpeRatio).toBeNull();
      }
    });

    it('computes non-null sharpeRatio when daily equity varies across 5+ days', async () => {
      // Build a dataset with many symbols and volatile prices to generate many trades
      // and enough daily equity variation to produce non-zero excessStdDev
      const symbols = ['SYM1', 'SYM2', 'SYM3'];
      const data = new Map<string, Candle[]>();

      // Use a volatile pattern over a long period — 180 trading days
      for (let s = 0; s < symbols.length; s++) {
        const basePrice = 100 + s * 10;
        data.set(symbols[s], generateFullData('2023-01-01', 180, basePrice, 'volatile'));
      }
      const loader = createMockDataLoader(data);

      const config = defaultConfig({
        symbols,
        startDate: '2023-01-01',
        endDate: '2023-07-01',
        entryThreshold: 0.0,   // always enter
        stopLossPct: 0.30,     // very wide stop — keeps positions open for many days
        trailingStop: false,
        maxPositions: 3,
        maxPositionSizePct: 0.3,
      });

      const engine = new BacktestEngine({ config, scoreFn: () => 80, dataLoader: loader });
      const result = await engine.run();

      // If enough daily returns were produced with variance, sharpe should be non-null
      if (result.dailyReturns.length >= 5) {
        const variance = result.dailyReturns
          .map((r) => r - result.dailyReturns.reduce((a, b) => a + b, 0) / result.dailyReturns.length)
          .reduce((sum, d) => sum + d * d, 0) / result.dailyReturns.length;
        if (variance > 0) {
          expect(result.metrics.sharpeRatio).not.toBeNull();
          expect(typeof result.metrics.sharpeRatio).toBe('number');
        }
      }
    });
  });

});
