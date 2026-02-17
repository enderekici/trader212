import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { BacktestConfig, BacktestResult, BacktestMetrics } from '../../src/backtest/types.js';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the backtest engine
const mockRun = vi.fn();
vi.mock('../../src/backtest/engine.js', () => ({
  createBacktestEngine: vi.fn().mockImplementation(async () => ({
    run: mockRun,
  })),
}));

import { WalkForwardAnalyzer } from '../../src/backtest/walk-forward.js';
import { createBacktestEngine } from '../../src/backtest/engine.js';

const mockedCreateEngine = vi.mocked(createBacktestEngine);

// ── Helpers ──────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    symbols: ['AAPL'],
    startDate: '2024-01-01',
    endDate: '2024-07-01',
    initialCapital: 10000,
    maxPositions: 3,
    maxPositionSizePct: 0.25,
    stopLossPct: 5,
    trailingStop: false,
    commission: 0,
    entryThreshold: 60,
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<BacktestMetrics> = {}): BacktestMetrics {
  return {
    totalTrades: 10,
    winCount: 6,
    lossCount: 4,
    winRate: 0.6,
    totalPnl: 500,
    totalPnlPct: 5,
    avgWin: 150,
    avgLoss: -100,
    maxDrawdown: 200,
    maxDrawdownPct: 2,
    currentDrawdown: 0,
    sharpeRatio: 1.5,
    sortinoRatio: 2.0,
    calmarRatio: 2.5,
    sqn: 1.8,
    expectancy: 50,
    profitFactor: 1.5,
    avgHoldMinutes: 300,
    bestTrade: { symbol: 'AAPL', pnlPct: 8 },
    worstTrade: { symbol: 'AAPL', pnlPct: -3 },
    finalEquity: 10500,
    returnPct: 5,
    ...overrides,
  };
}

function makeResult(metricsOverrides: Partial<BacktestMetrics> = {}): BacktestResult {
  const config = makeConfig();
  return {
    config,
    trades: [],
    metrics: makeMetrics(metricsOverrides),
    equityCurve: [],
    dailyReturns: [],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('WalkForwardAnalyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates correct number of windows', async () => {
    const config = makeConfig({
      startDate: '2024-01-01',
      endDate: '2024-07-01',
    });

    // Each window needs a train run and a test run
    mockRun.mockResolvedValue(makeResult({ returnPct: 3 }));

    const analyzer = new WalkForwardAnalyzer(config, 3, 0.7);
    const result = await analyzer.run();

    expect(result.windows).toHaveLength(3);
    // 3 windows x 2 engine runs each (train + test) = 6 calls
    expect(mockedCreateEngine).toHaveBeenCalledTimes(6);
  });

  it('train/test date splits respect trainRatio', async () => {
    // 6 months = 2024-01-01 to 2024-07-01, 3 windows, 70% train
    const config = makeConfig({
      startDate: '2024-01-01',
      endDate: '2024-07-01',
    });

    mockRun.mockResolvedValue(makeResult());

    const analyzer = new WalkForwardAnalyzer(config, 3, 0.7);
    const result = await analyzer.run();

    // The total range is 182 days (Jan 1 to Jul 1), each window ~60.67 days
    // trainRatio = 0.7, so train portion = 0.7 * windowMs, test = 0.3 * windowMs
    for (const w of result.windows) {
      const trainStart = new Date(w.trainStart).getTime();
      const trainEnd = new Date(w.trainEnd).getTime();
      const testStart = new Date(w.testStart).getTime();
      const testEnd = new Date(w.testEnd).getTime();

      // trainEnd should equal testStart (contiguous)
      expect(trainEnd).toBe(testStart);

      // Verify train duration is ~70% and test is ~30% of window
      const windowDuration = testEnd - trainStart;
      const trainDuration = trainEnd - trainStart;
      const ratio = trainDuration / windowDuration;
      expect(ratio).toBeCloseTo(0.7, 1);
    }

    // Verify configs passed to createBacktestEngine
    // Window 0 train call
    const firstTrainCall = mockedCreateEngine.mock.calls[0][0];
    expect(firstTrainCall.startDate).toBe(config.startDate);
    // Window 0 test call
    const firstTestCall = mockedCreateEngine.mock.calls[1][0];
    expect(firstTestCall.startDate).toBe(firstTrainCall.endDate);
  });

  it('aggregates out-of-sample metrics correctly', async () => {
    const config = makeConfig({
      startDate: '2024-01-01',
      endDate: '2024-07-01',
    });

    // Alternate between train and test results for each window
    // Window 0: train, test; Window 1: train, test; Window 2: train, test
    const testMetrics = [
      { returnPct: 6, sharpeRatio: 1.2, winRate: 0.7, maxDrawdownPct: 3, totalTrades: 8 },
      { returnPct: 4, sharpeRatio: 0.8, winRate: 0.5, maxDrawdownPct: 5, totalTrades: 12 },
      { returnPct: -2, sharpeRatio: -0.4, winRate: 0.3, maxDrawdownPct: 8, totalTrades: 10 },
    ];

    let callIndex = 0;
    mockRun.mockImplementation(async () => {
      const idx = callIndex++;
      // Even indices are train runs, odd indices are test runs
      if (idx % 2 === 1) {
        const testIdx = Math.floor(idx / 2);
        return makeResult(testMetrics[testIdx]);
      }
      return makeResult(); // train result (not used in aggregation)
    });

    const analyzer = new WalkForwardAnalyzer(config, 3, 0.7);
    const result = await analyzer.run();

    const agg = result.aggregateMetrics;

    // avgTestReturn = (6 + 4 + -2) / 3 = 8/3 ≈ 2.6667
    expect(agg.avgTestReturn).toBeCloseTo((6 + 4 + -2) / 3, 5);

    // avgTestSharpe = (1.2 + 0.8 + -0.4) / 3 = 1.6/3 ≈ 0.5333
    expect(agg.avgTestSharpe).toBeCloseTo((1.2 + 0.8 + -0.4) / 3, 5);

    // avgTestWinRate = (0.7 + 0.5 + 0.3) / 3 = 0.5
    expect(agg.avgTestWinRate).toBeCloseTo(0.5, 5);

    // avgTestMaxDrawdown = (3 + 5 + 8) / 3 ≈ 5.3333
    expect(agg.avgTestMaxDrawdown).toBeCloseTo((3 + 5 + 8) / 3, 5);

    // totalTestTrades = 8 + 12 + 10 = 30
    expect(agg.totalTestTrades).toBe(30);
  });

  it('calculates OOS consistency as percentage of windows with positive returns', async () => {
    const config = makeConfig({
      startDate: '2024-01-01',
      endDate: '2024-07-01',
    });

    // 3 windows: test returns of 5, -3, 2 -> 2/3 positive
    const testReturns = [5, -3, 2];

    let callIndex = 0;
    mockRun.mockImplementation(async () => {
      const idx = callIndex++;
      if (idx % 2 === 1) {
        const testIdx = Math.floor(idx / 2);
        return makeResult({ returnPct: testReturns[testIdx] });
      }
      return makeResult();
    });

    const analyzer = new WalkForwardAnalyzer(config, 3, 0.7);
    const result = await analyzer.run();

    // 2 out of 3 windows had positive returns
    expect(result.aggregateMetrics.oosConsistency).toBeCloseTo(2 / 3, 5);
  });

  it('handles windows with null sharpe ratios', async () => {
    const config = makeConfig({
      startDate: '2024-01-01',
      endDate: '2024-07-01',
    });

    // 3 windows: sharpe values of 1.5, null, 0.5
    const testSharpes: (number | null)[] = [1.5, null, 0.5];

    let callIndex = 0;
    mockRun.mockImplementation(async () => {
      const idx = callIndex++;
      if (idx % 2 === 1) {
        const testIdx = Math.floor(idx / 2);
        return makeResult({ sharpeRatio: testSharpes[testIdx] });
      }
      return makeResult();
    });

    const analyzer = new WalkForwardAnalyzer(config, 3, 0.7);
    const result = await analyzer.run();

    // null sharpes are filtered out, average of [1.5, 0.5] = 1.0
    expect(result.aggregateMetrics.avgTestSharpe).toBeCloseTo(1.0, 5);
  });

  it('returns null avgTestSharpe when all sharpe ratios are null', async () => {
    const config = makeConfig({
      startDate: '2024-01-01',
      endDate: '2024-04-01',
    });

    mockRun.mockImplementation(async () => makeResult({ sharpeRatio: null }));

    const analyzer = new WalkForwardAnalyzer(config, 2, 0.7);
    const result = await analyzer.run();

    expect(result.aggregateMetrics.avgTestSharpe).toBeNull();
  });

  it('handles single window case', async () => {
    const config = makeConfig({
      startDate: '2024-01-01',
      endDate: '2024-04-01',
    });

    const testReturn = 7.5;
    let callIndex = 0;
    mockRun.mockImplementation(async () => {
      const idx = callIndex++;
      if (idx % 2 === 1) {
        return makeResult({
          returnPct: testReturn,
          sharpeRatio: 2.0,
          winRate: 0.65,
          maxDrawdownPct: 4,
          totalTrades: 15,
        });
      }
      return makeResult();
    });

    const analyzer = new WalkForwardAnalyzer(config, 1, 0.7);
    const result = await analyzer.run();

    expect(result.windows).toHaveLength(1);
    expect(mockedCreateEngine).toHaveBeenCalledTimes(2); // 1 train + 1 test

    // With a single window, aggregates equal the single test result
    expect(result.aggregateMetrics.avgTestReturn).toBe(testReturn);
    expect(result.aggregateMetrics.avgTestSharpe).toBe(2.0);
    expect(result.aggregateMetrics.avgTestWinRate).toBe(0.65);
    expect(result.aggregateMetrics.avgTestMaxDrawdown).toBe(4);
    expect(result.aggregateMetrics.totalTestTrades).toBe(15);

    // Single positive window => 100% consistency
    expect(result.aggregateMetrics.oosConsistency).toBe(1);
  });

  it('returns original config in result', async () => {
    const config = makeConfig({
      symbols: ['AAPL', 'MSFT'],
      startDate: '2024-01-01',
      endDate: '2024-07-01',
      initialCapital: 50000,
    });

    mockRun.mockResolvedValue(makeResult());

    const analyzer = new WalkForwardAnalyzer(config, 2, 0.7);
    const result = await analyzer.run();

    expect(result.config).toBe(config);
  });

  it('window indices are sequential starting from 0', async () => {
    const config = makeConfig({
      startDate: '2024-01-01',
      endDate: '2024-07-01',
    });

    mockRun.mockResolvedValue(makeResult());

    const analyzer = new WalkForwardAnalyzer(config, 3, 0.7);
    const result = await analyzer.run();

    expect(result.windows.map((w) => w.windowIndex)).toEqual([0, 1, 2]);
  });

  it('OOS consistency is 0 when all windows have negative returns', async () => {
    const config = makeConfig({
      startDate: '2024-01-01',
      endDate: '2024-07-01',
    });

    const testReturns = [-2, -5, -1];
    let callIndex = 0;
    mockRun.mockImplementation(async () => {
      const idx = callIndex++;
      if (idx % 2 === 1) {
        const testIdx = Math.floor(idx / 2);
        return makeResult({ returnPct: testReturns[testIdx] });
      }
      return makeResult();
    });

    const analyzer = new WalkForwardAnalyzer(config, 3, 0.7);
    const result = await analyzer.run();

    expect(result.aggregateMetrics.oosConsistency).toBe(0);
  });

  it('OOS consistency treats zero return as non-positive', async () => {
    const config = makeConfig({
      startDate: '2024-01-01',
      endDate: '2024-04-01',
    });

    // returnPct = 0 is NOT > 0, so should not count as positive
    let callIndex = 0;
    mockRun.mockImplementation(async () => {
      const idx = callIndex++;
      if (idx % 2 === 1) {
        return makeResult({ returnPct: 0 });
      }
      return makeResult();
    });

    const analyzer = new WalkForwardAnalyzer(config, 2, 0.7);
    const result = await analyzer.run();

    expect(result.aggregateMetrics.oosConsistency).toBe(0);
  });
});
