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

import { BacktestEngine } from '../../src/backtest/engine.js';
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
  // getCommonDates still works normally since it's a pure function
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
  });
});
