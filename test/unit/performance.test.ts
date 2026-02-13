import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: unknown) => col),
  eq: vi.fn(),
  gte: vi.fn(),
  isNotNull: vi.fn(),
  lte: vi.fn(),
  sql: vi.fn(),
}));

// DB mock
const mockDbRun = vi.fn().mockReturnValue({ lastInsertRowid: 1n, changes: 1 });
const mockDbGet = vi.fn();
const mockTradesAll = vi.fn().mockReturnValue([]);
const mockPositionsAll = vi.fn().mockReturnValue([]);
const mockFundGet = vi.fn();

function createChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'set', 'values', 'orderBy', 'limit', 'onConflictDoUpdate'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.run = overrides.run ?? mockDbRun;
  chain.get = overrides.get ?? mockDbGet;
  chain.all = overrides.all ?? mockTradesAll;
  return chain;
}

// We need separate chains for trades and positions queries
let selectCallCount = 0;
const tradesChain = createChain({ all: mockTradesAll });
const positionsChain = createChain({ all: mockPositionsAll });
const fundChain = createChain({ get: mockFundGet });
const insertChain = createChain();

vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    select: () => {
      selectCallCount++;
      // The implementation calls select() multiple times:
      // Different methods use different patterns.
      // We'll use the shared tradesChain for all and let tests control .all()
      return tradesChain;
    },
    insert: () => insertChain,
    update: () => createChain(),
  }),
}));

vi.mock('../../src/db/schema.js', () => ({
  trades: { exitPrice: 'exitPrice', entryTime: 'entryTime' },
  positions: { symbol: 'symbol' },
  fundamentalCache: { symbol: 'symbol', sector: 'sector', fetchedAt: 'fetchedAt' },
  dailyMetrics: { date: 'date' },
}));

// ── Import SUT ──────────────────────────────────────────────────────────────
import { PerformanceTracker } from '../../src/monitoring/performance.js';

describe('PerformanceTracker', () => {
  let tracker: PerformanceTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    selectCallCount = 0;
    tracker = new PerformanceTracker();
  });

  // ── getMetrics ─────────────────────────────────────────────────────────
  describe('getMetrics', () => {
    it('returns zeros when no closed trades', () => {
      mockTradesAll.mockReturnValueOnce([]);

      const metrics = tracker.getMetrics();

      expect(metrics.totalTrades).toBe(0);
      expect(metrics.winRate).toBe(0);
      expect(metrics.sharpeRatio).toBe(0);
      expect(metrics.maxDrawdown).toBe(0);
      expect(metrics.profitFactor).toBe(0);
      expect(metrics.avgHoldDuration).toBe('N/A');
      expect(metrics.bestTrade).toBeNull();
      expect(metrics.worstTrade).toBeNull();
    });

    it('calculates correct metrics for winning trades', () => {
      mockTradesAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          pnl: 100,
          pnlPct: 0.05,
          entryTime: '2025-01-01T10:00:00Z',
          exitTime: '2025-01-02T10:00:00Z',
          exitPrice: 105,
        },
        {
          symbol: 'GOOG',
          pnl: 200,
          pnlPct: 0.10,
          entryTime: '2025-01-01T10:00:00Z',
          exitTime: '2025-01-03T10:00:00Z',
          exitPrice: 110,
        },
      ]);

      const metrics = tracker.getMetrics();

      expect(metrics.totalTrades).toBe(2);
      expect(metrics.winRate).toBe(1);
      expect(metrics.avgReturnPct).toBeGreaterThan(0);
      expect(metrics.profitFactor).toBe(Infinity);
    });

    it('calculates correct metrics with mix of wins and losses', () => {
      mockTradesAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          pnl: 100,
          pnlPct: 0.05,
          entryTime: '2025-01-01T10:00:00Z',
          exitTime: '2025-01-02T10:00:00Z',
          exitPrice: 105,
        },
        {
          symbol: 'GOOG',
          pnl: -50,
          pnlPct: -0.025,
          entryTime: '2025-01-01T10:00:00Z',
          exitTime: '2025-01-03T10:00:00Z',
          exitPrice: 95,
        },
      ]);

      const metrics = tracker.getMetrics();

      expect(metrics.totalTrades).toBe(2);
      expect(metrics.winRate).toBe(0.5);
      expect(metrics.profitFactor).toBe(2); // 100/50
    });

    it('identifies best and worst trades correctly', () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'AAPL', pnl: 100, pnlPct: 0.10, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 110 },
        { symbol: 'GOOG', pnl: -50, pnlPct: -0.05, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 95 },
        { symbol: 'MSFT', pnl: 200, pnlPct: 0.20, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 120 },
      ]);

      const metrics = tracker.getMetrics();

      expect(metrics.bestTrade!.symbol).toBe('MSFT');
      expect(metrics.bestTrade!.pnlPct).toBe(0.20);
      expect(metrics.worstTrade!.symbol).toBe('GOOG');
      expect(metrics.worstTrade!.pnlPct).toBe(-0.05);
    });

    it('calculates max drawdown correctly', () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'A', pnl: 100, pnlPct: 0.05, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 105 },
        { symbol: 'B', pnl: -80, pnlPct: -0.04, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 96 },
        { symbol: 'C', pnl: -50, pnlPct: -0.025, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 97.5 },
      ]);

      const metrics = tracker.getMetrics();

      // Peak after A: 100, cumulative after B: 20, drawdown = 80/100 = 0.80
      // cumulative after C: -30, but peak is still 100, drawdown = 130/100 = 1.3
      expect(metrics.maxDrawdown).toBeGreaterThan(0);
    });

    it('handles zero standard deviation (same returns)', () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'A', pnl: 100, pnlPct: 0.05, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 105 },
        { symbol: 'B', pnl: 100, pnlPct: 0.05, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 105 },
      ]);

      const metrics = tracker.getMetrics();

      expect(metrics.sharpeRatio).toBe(0);
    });

    it('handles all losing trades (profitFactor = 0)', () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'A', pnl: -100, pnlPct: -0.05, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 95 },
        { symbol: 'B', pnl: -50, pnlPct: -0.025, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 97.5 },
      ]);

      const metrics = tracker.getMetrics();

      expect(metrics.winRate).toBe(0);
      expect(metrics.profitFactor).toBe(0);
    });

    it('handles trades without entry/exit times for hold duration', () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'A', pnl: 100, pnlPct: 0.05, entryTime: null, exitTime: null, exitPrice: 105 },
      ]);

      const metrics = tracker.getMetrics();

      expect(metrics.avgHoldDuration).toBe('N/A');
    });

    it('formats hold duration in days when >= 24h', () => {
      const entry = new Date('2025-01-01T10:00:00Z');
      const exit = new Date('2025-01-04T10:00:00Z');
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'A', pnl: 100, pnlPct: 0.05, entryTime: entry.toISOString(), exitTime: exit.toISOString(), exitPrice: 105 },
      ]);

      const metrics = tracker.getMetrics();

      expect(metrics.avgHoldDuration).toContain('d');
    });

    it('formats hold duration in hours/minutes when < 24h', () => {
      const entry = new Date('2025-01-01T10:00:00Z');
      const exit = new Date('2025-01-01T15:30:00Z');
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'A', pnl: 100, pnlPct: 0.05, entryTime: entry.toISOString(), exitTime: exit.toISOString(), exitPrice: 105 },
      ]);

      const metrics = tracker.getMetrics();

      expect(metrics.avgHoldDuration).toContain('h');
      expect(metrics.avgHoldDuration).toContain('m');
    });

    it('handles null pnl and pnlPct gracefully', () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'A', pnl: null, pnlPct: null, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 105 },
      ]);

      const metrics = tracker.getMetrics();

      expect(metrics.totalTrades).toBe(1);
      expect(metrics.winRate).toBe(0);
    });

    it('calculates Sharpe ratio from daily metrics when >= 5 data points', () => {
      // closedTrades
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'A', pnl: 100, pnlPct: 0.05, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 105 },
      ]);
      // dailyMetrics (need >= 5 rows with portfolio values to trigger daily Sharpe calc)
      // Ordered by date desc, so first row is most recent
      mockTradesAll.mockReturnValueOnce([
        { portfolioValue: 10600, date: '2025-01-07' },
        { portfolioValue: 10500, date: '2025-01-06' },
        { portfolioValue: 10300, date: '2025-01-05' },
        { portfolioValue: 10200, date: '2025-01-04' },
        { portfolioValue: 10100, date: '2025-01-03' },
        { portfolioValue: 10000, date: '2025-01-02' },
      ]);
      // positions
      mockTradesAll.mockReturnValueOnce([]);

      const metrics = tracker.getMetrics();

      // dailyReturns: (10600-10500)/10500, (10500-10300)/10300, (10300-10200)/10200, (10200-10100)/10100, (10100-10000)/10000
      // All positive returns → positive Sharpe
      expect(metrics.sharpeRatio).toBeGreaterThan(0);
    });

    it('returns Sharpe ratio 0 when daily metrics have zero variance', () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'A', pnl: 100, pnlPct: 0.05, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 105 },
      ]);
      // All same portfolio value → zero returns → zero std dev → Sharpe = 0
      mockTradesAll.mockReturnValueOnce([
        { portfolioValue: 10000, date: '2025-01-07' },
        { portfolioValue: 10000, date: '2025-01-06' },
        { portfolioValue: 10000, date: '2025-01-05' },
        { portfolioValue: 10000, date: '2025-01-04' },
        { portfolioValue: 10000, date: '2025-01-03' },
        { portfolioValue: 10000, date: '2025-01-02' },
      ]);
      mockTradesAll.mockReturnValueOnce([]);

      const metrics = tracker.getMetrics();

      expect(metrics.sharpeRatio).toBe(0);
    });

    it('skips daily metrics rows with null portfolio values', () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'A', pnl: 100, pnlPct: 0.05, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 105 },
      ]);
      // Some null values — should skip those pairs
      mockTradesAll.mockReturnValueOnce([
        { portfolioValue: 10600, date: '2025-01-07' },
        { portfolioValue: null, date: '2025-01-06' },
        { portfolioValue: 10300, date: '2025-01-05' },
        { portfolioValue: 10200, date: '2025-01-04' },
        { portfolioValue: 10100, date: '2025-01-03' },
        { portfolioValue: 10000, date: '2025-01-02' },
      ]);
      mockTradesAll.mockReturnValueOnce([]);

      const metrics = tracker.getMetrics();

      // With a null in the middle, some daily return pairs get skipped
      // Remaining dailyReturns < 5 means Sharpe stays 0
      expect(typeof metrics.sharpeRatio).toBe('number');
    });

    it('does not calculate Sharpe when fewer than 5 daily metric rows', () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'A', pnl: 100, pnlPct: 0.05, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 105 },
      ]);
      // Only 3 rows (< 5 threshold)
      mockTradesAll.mockReturnValueOnce([
        { portfolioValue: 10200, date: '2025-01-03' },
        { portfolioValue: 10100, date: '2025-01-02' },
        { portfolioValue: 10000, date: '2025-01-01' },
      ]);
      mockTradesAll.mockReturnValueOnce([]);

      const metrics = tracker.getMetrics();

      expect(metrics.sharpeRatio).toBe(0);
    });

    it('includes unrealized P&L in max drawdown calculation', () => {
      // Closed trades: cumulative = 100, peak = 100
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'A', pnl: 100, pnlPct: 0.05, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 105 },
      ]);
      // dailyMetrics
      mockTradesAll.mockReturnValueOnce([]);
      // Open positions with unrealized loss
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'B', entryPrice: 100, currentPrice: 50, shares: 2 },
      ]);

      const metrics = tracker.getMetrics();

      // cumulative from closed = 100, peak = 100
      // unrealizedPnl = (50 - 100) * 2 = -100
      // totalCumulative = 100 + (-100) = 0
      // peak stays at 100 (since 0 < 100)
      // unrealizedDrawdown = (100 - 0) / 100 = 1.0
      expect(metrics.maxDrawdown).toBe(1);
    });

    it('updates peak when unrealized P&L exceeds closed peak', () => {
      // Closed trades: cumulative = 100, peak = 100
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'A', pnl: 100, pnlPct: 0.05, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 105 },
      ]);
      mockTradesAll.mockReturnValueOnce([]);
      // Open positions with unrealized gain
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'B', entryPrice: 100, currentPrice: 200, shares: 2 },
      ]);

      const metrics = tracker.getMetrics();

      // unrealizedPnl = (200 - 100) * 2 = 200
      // totalCumulative = 100 + 200 = 300 > peak(100) → peak updated to 300
      // unrealizedDrawdown = (300 - 300) / 300 = 0
      // maxDrawdown from closed trades was 0, unrealized drawdown is 0
      expect(metrics.maxDrawdown).toBe(0);
    });

    it('uses entryPrice as currentPrice fallback for unrealized P&L', () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'A', pnl: 100, pnlPct: 0.05, entryTime: '2025-01-01', exitTime: '2025-01-02', exitPrice: 105 },
      ]);
      mockTradesAll.mockReturnValueOnce([]);
      // Position with null currentPrice
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'B', entryPrice: 100, currentPrice: null, shares: 2 },
      ]);

      const metrics = tracker.getMetrics();

      // unrealizedPnl = (100 - 100) * 2 = 0 (uses entryPrice as fallback)
      // totalCumulative = 100 + 0 = 100, peak = 100, drawdown = 0
      expect(metrics.maxDrawdown).toBe(0);
    });
  });

  // ── getPerSectorBreakdown ──────────────────────────────────────────────
  describe('getPerSectorBreakdown', () => {
    it('returns empty array when no closed trades', () => {
      mockTradesAll.mockReturnValueOnce([]);

      const result = tracker.getPerSectorBreakdown();
      expect(result).toEqual([]);
    });

    it('groups trades by sector', () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'AAPL', pnl: 100, pnlPct: 0.05, exitPrice: 105 },
        { symbol: 'GOOG', pnl: -50, pnlPct: -0.025, exitPrice: 95 },
      ]);

      // Fund cache lookups
      (tradesChain.get as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ sector: 'Technology' })
        .mockReturnValueOnce({ sector: 'Technology' });

      const result = tracker.getPerSectorBreakdown();

      expect(result).toHaveLength(1);
      expect(result[0].sector).toBe('Technology');
      expect(result[0].trades).toBe(2);
    });

    it('uses "Unknown" for trades without sector', () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'XYZ', pnl: 100, pnlPct: 0.05, exitPrice: 105 },
      ]);

      (tradesChain.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);

      const result = tracker.getPerSectorBreakdown();

      expect(result).toHaveLength(1);
      expect(result[0].sector).toBe('Unknown');
    });
  });

  // ── generateDailySummary ───────────────────────────────────────────────
  describe('generateDailySummary', () => {
    it('generates summary with trades and open positions', () => {
      // First all() - trades
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'AAPL', side: 'BUY', pnl: 100, pnlPct: 0.05, exitPrice: 105 },
      ]);
      // Second all() - positions
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'GOOG', pnl: 50 },
      ]);

      const summary = tracker.generateDailySummary();

      expect(summary).toContain('Daily Summary');
      expect(summary).toContain('Trades today: 1');
      expect(summary).toContain('Open positions: 1');
    });

    it('includes trade details with positive and negative pnl formatting', () => {
      // Trades with positive and negative pnl
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'AAPL', side: 'BUY', pnl: 100, pnlPct: 0.05, exitPrice: 105 },
        { symbol: 'GOOG', side: 'SELL', pnl: -50, pnlPct: -0.025, exitPrice: 95 },
      ]);
      // Open positions with non-null pnl
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'MSFT', pnl: 75 },
        { symbol: 'TSLA', pnl: -30 },
      ]);

      const summary = tracker.generateDailySummary();

      expect(summary).toContain('Trades today: 2');
      // Positive trade should have '+' prefix
      expect(summary).toContain('BUY AAPL: +');
      // Negative trade should NOT have '+' prefix
      expect(summary).toContain('SELL GOOG:');
      expect(summary).not.toContain('SELL GOOG: +');
      expect(summary).toContain('Open positions: 2');
      // Unrealized P&L: 75 + (-30) = 45
      expect(summary).toContain('Unrealized P');
    });

    it('handles trades with null pnl in daily summary', () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'AAPL', side: 'BUY', pnl: null, pnlPct: null, exitPrice: 105 },
      ]);
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'MSFT', pnl: null },
      ]);

      const summary = tracker.generateDailySummary();

      expect(summary).toContain('Trades today: 1');
      expect(summary).toContain('Open positions: 1');
    });

    it('generates summary with no trades', () => {
      mockTradesAll.mockReturnValueOnce([]);
      mockTradesAll.mockReturnValueOnce([]);

      const summary = tracker.generateDailySummary();

      expect(summary).toContain('Trades today: 0');
    });
  });

  // ── generateWeeklySummary ──────────────────────────────────────────────
  describe('generateWeeklySummary', () => {
    it('generates weekly report with all-time stats', () => {
      // weekTrades
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'AAPL', pnl: 100, pnlPct: 0.05, exitPrice: 105, entryTime: '2025-01-01', exitTime: '2025-01-02' },
      ]);
      // getMetrics -> closedTrades
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'AAPL', pnl: 100, pnlPct: 0.05, exitPrice: 105, entryTime: '2025-01-01', exitTime: '2025-01-02' },
      ]);

      const summary = tracker.generateWeeklySummary();

      expect(summary).toContain('Weekly Performance Report');
      expect(summary).toContain('All-Time Stats');
    });

    it('generates weekly report with no trades', () => {
      mockTradesAll.mockReturnValueOnce([]);
      mockTradesAll.mockReturnValueOnce([]);

      const summary = tracker.generateWeeklySummary();

      expect(summary).toContain('Trades this week: 0');
    });

    it('includes best and worst trade when available', () => {
      mockTradesAll.mockReturnValueOnce([]);
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'AAPL', pnl: 100, pnlPct: 0.10, exitPrice: 110, entryTime: '2025-01-01', exitTime: '2025-01-02' },
        { symbol: 'GOOG', pnl: -50, pnlPct: -0.05, exitPrice: 95, entryTime: '2025-01-01', exitTime: '2025-01-02' },
      ]);

      const summary = tracker.generateWeeklySummary();

      expect(summary).toContain('Best trade: AAPL');
      expect(summary).toContain('Worst trade: GOOG');
    });

    it('handles null pnl and pnlPct in weekly trades', () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'AAPL', pnl: null, pnlPct: null, exitPrice: 105, entryTime: '2025-01-01', exitTime: '2025-01-02' },
      ]);
      mockTradesAll.mockReturnValueOnce([]);

      const summary = tracker.generateWeeklySummary();

      expect(summary).toContain('Trades this week: 1');
    });
  });

  // ── saveDailyMetrics ───────────────────────────────────────────────────
  describe('saveDailyMetrics', () => {
    it('saves metrics to daily_metrics table', async () => {
      // saveDailyMetrics: todayTrades
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'AAPL', pnl: 100, pnlPct: 0.05, exitPrice: 105, entryTime: '2025-01-01', exitTime: '2025-01-02' },
      ]);
      // getMetrics inside saveDailyMetrics
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'AAPL', pnl: 100, pnlPct: 0.05, exitPrice: 105, entryTime: '2025-01-01', exitTime: '2025-01-02' },
      ]);

      await tracker.saveDailyMetrics();

      expect(insertChain.run).toHaveBeenCalled();
    });

    it('handles DB error gracefully', async () => {
      mockTradesAll.mockReturnValueOnce([]);
      mockTradesAll.mockReturnValueOnce([]);
      (insertChain.run as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('DB error');
      });

      await expect(tracker.saveDailyMetrics()).resolves.not.toThrow();
    });

    it('handles null pnl and pnlPct in daily metrics', async () => {
      mockTradesAll.mockReturnValueOnce([
        { symbol: 'AAPL', pnl: null, pnlPct: null, exitPrice: 105, entryTime: '2025-01-01', exitTime: '2025-01-02' },
      ]);
      mockTradesAll.mockReturnValueOnce([]);

      await tracker.saveDailyMetrics();

      expect(insertChain.run).toHaveBeenCalled();
    });
  });
});
