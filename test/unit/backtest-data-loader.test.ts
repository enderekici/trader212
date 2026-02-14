import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Candle } from '../../src/backtest/types.js';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock configManager (required by YahooFinanceClient)
vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn(() => 365),
  },
}));

// Mock the Yahoo Finance client
const mockGetHistoricalData = vi.fn();
vi.mock('../../src/data/yahoo-finance.js', () => ({
  YahooFinanceClient: vi.fn().mockImplementation(function () {
    return {
      getHistoricalData: mockGetHistoricalData,
    };
  }),
}));

import { BacktestDataLoader } from '../../src/backtest/data-loader.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeCandles(dates: string[], basePrice = 100): Candle[] {
  return dates.map((date, i) => ({
    date,
    open: basePrice + i * 0.1,
    high: basePrice + i * 0.1 + 1,
    low: basePrice + i * 0.1 - 1,
    close: basePrice + i * 0.1,
    volume: 1000000,
  }));
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('BacktestDataLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadOHLCV', () => {
    it('loads data for a single symbol', async () => {
      const candles = makeCandles([
        '2024-01-01', '2024-01-02', '2024-01-03',
        '2024-06-01', '2024-06-02', '2024-06-03',
      ]);
      mockGetHistoricalData.mockResolvedValue(candles);

      const loader = new BacktestDataLoader();
      const result = await loader.loadOHLCV('AAPL', '2024-06-01', '2024-06-30');

      expect(mockGetHistoricalData).toHaveBeenCalledWith('AAPL', expect.any(Number));
      expect(result.length).toBeGreaterThan(0);
      // All returned candles should be <= endDate
      for (const c of result) {
        expect(c.date <= '2024-06-30').toBe(true);
      }
    });

    it('returns empty array when Yahoo returns no data', async () => {
      mockGetHistoricalData.mockResolvedValue([]);

      const loader = new BacktestDataLoader();
      const result = await loader.loadOHLCV('INVALID', '2024-06-01', '2024-06-30');

      expect(result).toEqual([]);
    });

    it('filters candles to not exceed endDate', async () => {
      const candles = makeCandles([
        '2024-06-01', '2024-06-02', '2024-06-03',
        '2024-07-01', '2024-07-02',
      ]);
      mockGetHistoricalData.mockResolvedValue(candles);

      const loader = new BacktestDataLoader();
      const result = await loader.loadOHLCV('AAPL', '2024-06-01', '2024-06-30');

      // Should not include July candles
      for (const c of result) {
        expect(c.date <= '2024-06-30').toBe(true);
      }
    });

    it('maps OHLCVCandle fields to Candle interface', async () => {
      const candles = [{
        date: '2024-06-01',
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 5000000,
      }];
      mockGetHistoricalData.mockResolvedValue(candles);

      const loader = new BacktestDataLoader();
      const result = await loader.loadOHLCV('AAPL', '2024-06-01', '2024-06-30');

      expect(result[0]).toEqual({
        date: '2024-06-01',
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 5000000,
      });
    });
  });

  describe('loadMultiple', () => {
    it('loads data for multiple symbols in parallel', async () => {
      const aaplCandles = makeCandles(['2024-06-01', '2024-06-02', '2024-06-03'], 150);
      const msftCandles = makeCandles(['2024-06-01', '2024-06-02', '2024-06-03'], 300);

      mockGetHistoricalData.mockImplementation(async (symbol: string) => {
        if (symbol === 'AAPL') return aaplCandles;
        if (symbol === 'MSFT') return msftCandles;
        return [];
      });

      const loader = new BacktestDataLoader();
      const result = await loader.loadMultiple(
        ['AAPL', 'MSFT'],
        '2024-06-01',
        '2024-06-30',
      );

      expect(result.size).toBe(2);
      expect(result.has('AAPL')).toBe(true);
      expect(result.has('MSFT')).toBe(true);
      expect(result.get('AAPL')!.length).toBe(3);
      expect(result.get('MSFT')!.length).toBe(3);
    });

    it('skips symbols with no data', async () => {
      const aaplCandles = makeCandles(['2024-06-01', '2024-06-02'], 150);

      mockGetHistoricalData.mockImplementation(async (symbol: string) => {
        if (symbol === 'AAPL') return aaplCandles;
        return []; // INVALID returns no data
      });

      const loader = new BacktestDataLoader();
      const result = await loader.loadMultiple(
        ['AAPL', 'INVALID'],
        '2024-06-01',
        '2024-06-30',
      );

      expect(result.size).toBe(1);
      expect(result.has('AAPL')).toBe(true);
      expect(result.has('INVALID')).toBe(false);
    });

    it('handles all symbols returning no data', async () => {
      mockGetHistoricalData.mockResolvedValue([]);

      const loader = new BacktestDataLoader();
      const result = await loader.loadMultiple(
        ['AAPL', 'MSFT'],
        '2024-06-01',
        '2024-06-30',
      );

      expect(result.size).toBe(0);
    });

    it('handles empty symbol list', async () => {
      const loader = new BacktestDataLoader();
      const result = await loader.loadMultiple([], '2024-06-01', '2024-06-30');

      expect(result.size).toBe(0);
      expect(mockGetHistoricalData).not.toHaveBeenCalled();
    });
  });

  describe('getCommonDates', () => {
    it('returns common dates across all symbols within range', () => {
      const data = new Map<string, Candle[]>([
        ['AAPL', makeCandles(['2024-06-01', '2024-06-02', '2024-06-03', '2024-06-04'])],
        ['MSFT', makeCandles(['2024-06-01', '2024-06-02', '2024-06-03'])],
      ]);

      const loader = new BacktestDataLoader();
      const commonDates = loader.getCommonDates(data, '2024-06-01', '2024-06-30');

      expect(commonDates).toEqual(['2024-06-01', '2024-06-02', '2024-06-03']);
    });

    it('returns empty array for empty data', () => {
      const data = new Map<string, Candle[]>();

      const loader = new BacktestDataLoader();
      const commonDates = loader.getCommonDates(data, '2024-06-01', '2024-06-30');

      expect(commonDates).toEqual([]);
    });

    it('filters dates to within startDate and endDate', () => {
      const data = new Map<string, Candle[]>([
        ['AAPL', makeCandles([
          '2024-05-01', '2024-05-15',
          '2024-06-01', '2024-06-02',
          '2024-07-01',
        ])],
        ['MSFT', makeCandles([
          '2024-05-01', '2024-05-15',
          '2024-06-01', '2024-06-02',
          '2024-07-01',
        ])],
      ]);

      const loader = new BacktestDataLoader();
      const commonDates = loader.getCommonDates(data, '2024-06-01', '2024-06-30');

      expect(commonDates).toEqual(['2024-06-01', '2024-06-02']);
    });

    it('returns dates sorted chronologically', () => {
      const data = new Map<string, Candle[]>([
        ['AAPL', makeCandles(['2024-06-03', '2024-06-01', '2024-06-02'])],
      ]);

      const loader = new BacktestDataLoader();
      const commonDates = loader.getCommonDates(data, '2024-06-01', '2024-06-30');

      expect(commonDates).toEqual(['2024-06-01', '2024-06-02', '2024-06-03']);
    });

    it('handles single symbol', () => {
      const data = new Map<string, Candle[]>([
        ['AAPL', makeCandles(['2024-06-01', '2024-06-02', '2024-06-03'])],
      ]);

      const loader = new BacktestDataLoader();
      const commonDates = loader.getCommonDates(data, '2024-06-01', '2024-06-30');

      expect(commonDates).toEqual(['2024-06-01', '2024-06-02', '2024-06-03']);
    });

    it('returns empty when symbols have no overlapping dates', () => {
      const data = new Map<string, Candle[]>([
        ['AAPL', makeCandles(['2024-06-01', '2024-06-02'])],
        ['MSFT', makeCandles(['2024-06-03', '2024-06-04'])],
      ]);

      const loader = new BacktestDataLoader();
      const commonDates = loader.getCommonDates(data, '2024-06-01', '2024-06-30');

      expect(commonDates).toEqual([]);
    });

    it('handles missing data gracefully (symbols with data outside range)', () => {
      const data = new Map<string, Candle[]>([
        ['AAPL', makeCandles(['2024-01-01', '2024-01-02'])],
        ['MSFT', makeCandles(['2024-01-01', '2024-01-02'])],
      ]);

      const loader = new BacktestDataLoader();
      const commonDates = loader.getCommonDates(data, '2024-06-01', '2024-06-30');

      expect(commonDates).toEqual([]);
    });
  });
});
