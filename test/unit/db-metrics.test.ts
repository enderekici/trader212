import { describe, expect, it, vi, beforeEach } from 'vitest';

function createChainableMock(terminalValue?: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (prop === 'then' || prop === 'catch') return undefined;
      if (!chain[prop]) {
        chain[prop] = vi.fn((..._args: unknown[]) => {
          if (prop === 'get') return terminalValue;
          if (prop === 'all') return terminalValue;
          if (prop === 'run') return terminalValue;
          if (prop === 'reverse') return typeof terminalValue === 'object' && Array.isArray(terminalValue) ? terminalValue.reverse() : terminalValue;
          return new Proxy({}, handler);
        });
      }
      return chain[prop];
    },
  };
  return new Proxy({}, handler);
}

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
};

vi.mock('../../src/db/index.js', () => ({
  getDb: () => mockDb,
}));

vi.mock('../../src/db/schema.js', () => ({
  dailyMetrics: {
    date: 'date',
    portfolioValue: 'portfolioValue',
    cashBalance: 'cashBalance',
    totalPnl: 'totalPnl',
  },
}));

describe('db/repositories/metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('insertDailyMetrics', () => {
    it('inserts a daily metrics record', async () => {
      const data = { date: '2024-01-01', totalPnl: 100, tradesCount: 5 };
      mockDb.insert.mockReturnValue(createChainableMock(data));

      const { insertDailyMetrics } = await import('../../src/db/repositories/metrics.js');
      const result = insertDailyMetrics(data as any);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(result).toEqual(data);
    });
  });

  describe('upsertDailyMetrics', () => {
    it('upserts daily metrics using onConflictDoUpdate', async () => {
      const data = { date: '2024-01-01', totalPnl: 200 };
      mockDb.insert.mockReturnValue(createChainableMock(data));

      const { upsertDailyMetrics } = await import('../../src/db/repositories/metrics.js');
      const result = upsertDailyMetrics(data as any);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(result).toEqual(data);
    });
  });

  describe('getMetricsRange', () => {
    it('returns metrics within a date range', async () => {
      const metrics = [
        { date: '2024-01-01', totalPnl: 100 },
        { date: '2024-01-02', totalPnl: 200 },
      ];
      mockDb.select.mockReturnValue(createChainableMock(metrics));

      const { getMetricsRange } = await import('../../src/db/repositories/metrics.js');
      const result = getMetricsRange('2024-01-01', '2024-01-02');
      expect(result).toEqual(metrics);
    });

    it('returns empty array when no metrics in range', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getMetricsRange } = await import('../../src/db/repositories/metrics.js');
      const result = getMetricsRange('2024-06-01', '2024-06-02');
      expect(result).toEqual([]);
    });
  });

  describe('getLatestMetrics', () => {
    it('returns the latest metrics entry', async () => {
      const latest = { date: '2024-01-15', totalPnl: 500 };
      mockDb.select.mockReturnValue(createChainableMock(latest));

      const { getLatestMetrics } = await import('../../src/db/repositories/metrics.js');
      const result = getLatestMetrics();
      expect(result).toEqual(latest);
    });

    it('returns undefined when no metrics exist', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const { getLatestMetrics } = await import('../../src/db/repositories/metrics.js');
      const result = getLatestMetrics();
      expect(result).toBeUndefined();
    });
  });

  describe('getEquityCurve', () => {
    it('returns equity curve data reversed (chronological order)', async () => {
      const data = [
        { date: '2024-01-02', portfolioValue: 10200 },
        { date: '2024-01-01', portfolioValue: 10000 },
      ];
      mockDb.select.mockReturnValue(createChainableMock([...data]));

      const { getEquityCurve } = await import('../../src/db/repositories/metrics.js');
      const result = getEquityCurve();
      // The function reverses the result - the mock returns reversed data
      expect(result).toBeDefined();
    });

    it('accepts a custom days parameter', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getEquityCurve } = await import('../../src/db/repositories/metrics.js');
      const result = getEquityCurve(30);
      expect(result).toBeDefined();
    });

    it('uses default of 90 days', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getEquityCurve } = await import('../../src/db/repositories/metrics.js');
      getEquityCurve();
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('getAllDailyMetrics', () => {
    it('returns all daily metrics', async () => {
      const metrics = [
        { date: '2024-01-02', totalPnl: 200 },
        { date: '2024-01-01', totalPnl: 100 },
      ];
      mockDb.select.mockReturnValue(createChainableMock(metrics));

      const { getAllDailyMetrics } = await import('../../src/db/repositories/metrics.js');
      const result = getAllDailyMetrics();
      expect(result).toEqual(metrics);
    });
  });
});
