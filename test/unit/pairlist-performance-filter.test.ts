import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configManager } from '../../src/config/manager.js';
import { getDb } from '../../src/db/index.js';
import { PerformanceFilter, type StockInfo } from '../../src/pairlist/filters.js';

vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../src/db/index.js', () => ({
  getDb: vi.fn(),
}));

describe('PerformanceFilter', () => {
  let filter: PerformanceFilter;
  const mockStocks: StockInfo[] = [
    { symbol: 'AAPL', t212Ticker: 'AAPL_US', name: 'Apple Inc.' },
    { symbol: 'TSLA', t212Ticker: 'TSLA_US', name: 'Tesla Inc.' },
    { symbol: 'MSFT', t212Ticker: 'MSFT_US', name: 'Microsoft Corp.' },
    { symbol: 'NVDA', t212Ticker: 'NVDA_US', name: 'Nvidia Corp.' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    filter = new PerformanceFilter();

    // Default config mocks
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      const defaults: Record<string, unknown> = {
        'pairlist.performance.enabled': true,
        'pairlist.performance.minWinRate': 0.4,
        'pairlist.performance.minTrades': 5,
        'pairlist.performance.lookbackDays': 30,
      };
      return defaults[key];
    });
  });

  describe('when disabled', () => {
    it('should return all stocks unchanged', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'pairlist.performance.enabled') return false;
        return null;
      });

      const result = await filter.filter(mockStocks);
      expect(result).toEqual(mockStocks);
      expect(result).toHaveLength(4);
    });
  });

  describe('when enabled', () => {
    it('should keep symbols with no trade history', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        all: vi.fn().mockReturnValue([]),
      };
      vi.mocked(getDb).mockReturnValue(mockDb as never);

      const result = await filter.filter(mockStocks);
      expect(result).toEqual(mockStocks);
      expect(result).toHaveLength(4);
    });

    it('should keep symbols with insufficient trade history', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        all: vi.fn().mockReturnValue([
          { symbol: 'AAPL', pnlPct: 0.05 },
          { symbol: 'AAPL', pnlPct: -0.02 },
          { symbol: 'AAPL', pnlPct: 0.03 },
          // Only 3 trades, below minTrades threshold of 5
        ]),
      };
      vi.mocked(getDb).mockReturnValue(mockDb as never);

      const result = await filter.filter(mockStocks);
      expect(result).toContainEqual(mockStocks[0]); // AAPL should be kept
      expect(result).toHaveLength(4);
    });

    it('should filter out symbols with low win rate', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        all: vi.fn().mockReturnValue([
          { symbol: 'AAPL', pnlPct: 0.05 },
          { symbol: 'AAPL', pnlPct: -0.02 },
          { symbol: 'AAPL', pnlPct: -0.03 },
          { symbol: 'AAPL', pnlPct: -0.01 },
          { symbol: 'AAPL', pnlPct: -0.04 },
          { symbol: 'AAPL', pnlPct: -0.02 },
          // 6 trades, 1 win, win rate = 0.167 < 0.4
        ]),
      };
      vi.mocked(getDb).mockReturnValue(mockDb as never);

      const result = await filter.filter(mockStocks);
      expect(result).not.toContainEqual(mockStocks[0]); // AAPL should be filtered out
      expect(result).toHaveLength(3);
    });

    it('should keep symbols with acceptable win rate', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        all: vi.fn().mockReturnValue([
          { symbol: 'AAPL', pnlPct: 0.05 },
          { symbol: 'AAPL', pnlPct: 0.03 },
          { symbol: 'AAPL', pnlPct: 0.02 },
          { symbol: 'AAPL', pnlPct: -0.01 },
          { symbol: 'AAPL', pnlPct: -0.02 },
          // 5 trades, 3 wins, win rate = 0.6 >= 0.4
        ]),
      };
      vi.mocked(getDb).mockReturnValue(mockDb as never);

      const result = await filter.filter(mockStocks);
      expect(result).toContainEqual(mockStocks[0]); // AAPL should be kept
      expect(result).toHaveLength(4);
    });

    it('should handle multiple symbols with mixed performance', async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        all: vi.fn().mockReturnValue([
          // AAPL: 5 trades, 4 wins, win rate = 0.8 (KEEP)
          { symbol: 'AAPL', pnlPct: 0.05 },
          { symbol: 'AAPL', pnlPct: 0.03 },
          { symbol: 'AAPL', pnlPct: 0.02 },
          { symbol: 'AAPL', pnlPct: 0.01 },
          { symbol: 'AAPL', pnlPct: -0.02 },
          // TSLA: 6 trades, 1 win, win rate = 0.167 (FILTER)
          { symbol: 'TSLA', pnlPct: 0.01 },
          { symbol: 'TSLA', pnlPct: -0.02 },
          { symbol: 'TSLA', pnlPct: -0.03 },
          { symbol: 'TSLA', pnlPct: -0.01 },
          { symbol: 'TSLA', pnlPct: -0.04 },
          { symbol: 'TSLA', pnlPct: -0.02 },
          // MSFT: 3 trades only (KEEP - insufficient history)
          { symbol: 'MSFT', pnlPct: 0.05 },
          { symbol: 'MSFT', pnlPct: -0.02 },
          { symbol: 'MSFT', pnlPct: 0.03 },
          // NVDA: no trades (KEEP)
        ]),
      };
      vi.mocked(getDb).mockReturnValue(mockDb as never);

      const result = await filter.filter(mockStocks);
      expect(result).toHaveLength(3);
      expect(result).toContainEqual(mockStocks[0]); // AAPL
      expect(result).not.toContainEqual(mockStocks[1]); // TSLA filtered
      expect(result).toContainEqual(mockStocks[2]); // MSFT
      expect(result).toContainEqual(mockStocks[3]); // NVDA
    });

    it('should respect custom minWinRate threshold', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        const config: Record<string, unknown> = {
          'pairlist.performance.enabled': true,
          'pairlist.performance.minWinRate': 0.7, // Higher threshold
          'pairlist.performance.minTrades': 5,
          'pairlist.performance.lookbackDays': 30,
        };
        return config[key];
      });

      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        all: vi.fn().mockReturnValue([
          { symbol: 'AAPL', pnlPct: 0.05 },
          { symbol: 'AAPL', pnlPct: 0.03 },
          { symbol: 'AAPL', pnlPct: 0.02 },
          { symbol: 'AAPL', pnlPct: -0.01 },
          { symbol: 'AAPL', pnlPct: -0.02 },
          // 5 trades, 3 wins, win rate = 0.6 < 0.7
        ]),
      };
      vi.mocked(getDb).mockReturnValue(mockDb as never);

      const result = await filter.filter(mockStocks);
      expect(result).not.toContainEqual(mockStocks[0]); // AAPL filtered due to higher threshold
      expect(result).toHaveLength(3);
    });

    it('should use correct lookback period', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        const config: Record<string, unknown> = {
          'pairlist.performance.enabled': true,
          'pairlist.performance.minWinRate': 0.4,
          'pairlist.performance.minTrades': 5,
          'pairlist.performance.lookbackDays': 7, // 7 days
        };
        return config[key];
      });

      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        all: vi.fn().mockReturnValue([]),
      };
      vi.mocked(getDb).mockReturnValue(mockDb as never);

      await filter.filter(mockStocks);

      // Verify where clause was called (lookback period applied)
      expect(mockDb.where).toHaveBeenCalled();
    });
  });

  describe('filter name', () => {
    it('should have correct name', () => {
      expect(filter.name).toBe('performance');
    });
  });
});
