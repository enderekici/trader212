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
  });
});
