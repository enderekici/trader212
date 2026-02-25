import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { StockInfo } from '../../src/pairlist/filters.js';

const mockConfigValues: Record<string, unknown> = {};

vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn((key: string) => {
      if (key in mockConfigValues) return mockConfigValues[key];
      throw new Error(`Config key not found: ${key}`);
    }),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock DB for PerformanceFilter
const mockDbAll = vi.fn().mockReturnValue([]);
vi.mock('../../src/db/index.js', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    all: mockDbAll,
  })),
}));

function makeStock(overrides: Partial<StockInfo> & { symbol: string }): StockInfo {
  return {
    t212Ticker: overrides.symbol,
    name: overrides.symbol,
    ...overrides,
  };
}

describe('pairlist/filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset config values
    for (const key of Object.keys(mockConfigValues)) {
      delete mockConfigValues[key];
    }
  });

  describe('VolumeFilter', () => {
    it('filters stocks below minimum volume', async () => {
      mockConfigValues['pairlist.volume.minAvgDailyVolume'] = 500000;
      mockConfigValues['pairlist.volume.topN'] = 100;

      const { VolumeFilter } = await import('../../src/pairlist/filters.js');
      const filter = new VolumeFilter();

      const stocks = [
        makeStock({ symbol: 'AAPL', volume: 1000000 }),
        makeStock({ symbol: 'MSFT', volume: 200000 }),
        makeStock({ symbol: 'GOOG', volume: 800000 }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(2);
      expect(result.map(s => s.symbol)).toEqual(['AAPL', 'GOOG']);
    });

    it('sorts by volume descending and limits to topN', async () => {
      mockConfigValues['pairlist.volume.minAvgDailyVolume'] = 0;
      mockConfigValues['pairlist.volume.topN'] = 2;

      const { VolumeFilter } = await import('../../src/pairlist/filters.js');
      const filter = new VolumeFilter();

      const stocks = [
        makeStock({ symbol: 'A', volume: 100 }),
        makeStock({ symbol: 'B', volume: 300 }),
        makeStock({ symbol: 'C', volume: 200 }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('B');
      expect(result[1].symbol).toBe('C');
    });

    it('excludes stocks with null volume', async () => {
      mockConfigValues['pairlist.volume.minAvgDailyVolume'] = 100;
      mockConfigValues['pairlist.volume.topN'] = 100;

      const { VolumeFilter } = await import('../../src/pairlist/filters.js');
      const filter = new VolumeFilter();

      const stocks = [
        makeStock({ symbol: 'AAPL', volume: undefined }),
        makeStock({ symbol: 'MSFT', volume: 500 }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('MSFT');
    });

    it('returns empty array when all stocks have insufficient volume', async () => {
      mockConfigValues['pairlist.volume.minAvgDailyVolume'] = 1000000;
      mockConfigValues['pairlist.volume.topN'] = 100;

      const { VolumeFilter } = await import('../../src/pairlist/filters.js');
      const filter = new VolumeFilter();

      const stocks = [
        makeStock({ symbol: 'A', volume: 100 }),
        makeStock({ symbol: 'B', volume: 200 }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(0);
    });

    it('has correct name property', async () => {
      const { VolumeFilter } = await import('../../src/pairlist/filters.js');
      const filter = new VolumeFilter();
      expect(filter.name).toBe('volume');
    });
  });

  describe('PriceFilter', () => {
    it('filters stocks outside price range', async () => {
      mockConfigValues['pairlist.price.min'] = 5;
      mockConfigValues['pairlist.price.max'] = 1500;

      const { PriceFilter } = await import('../../src/pairlist/filters.js');
      const filter = new PriceFilter();

      const stocks = [
        makeStock({ symbol: 'CHEAP', price: 2 }),
        makeStock({ symbol: 'GOOD', price: 100 }),
        makeStock({ symbol: 'EXPENSIVE', price: 2000 }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('GOOD');
    });

    it('includes stocks at boundary values', async () => {
      mockConfigValues['pairlist.price.min'] = 5;
      mockConfigValues['pairlist.price.max'] = 1500;

      const { PriceFilter } = await import('../../src/pairlist/filters.js');
      const filter = new PriceFilter();

      const stocks = [
        makeStock({ symbol: 'MIN', price: 5 }),
        makeStock({ symbol: 'MAX', price: 1500 }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(2);
    });

    it('excludes stocks with null price', async () => {
      mockConfigValues['pairlist.price.min'] = 1;
      mockConfigValues['pairlist.price.max'] = 10000;

      const { PriceFilter } = await import('../../src/pairlist/filters.js');
      const filter = new PriceFilter();

      const stocks = [
        makeStock({ symbol: 'NULL', price: undefined }),
        makeStock({ symbol: 'OK', price: 50 }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('OK');
    });

    it('has correct name property', async () => {
      const { PriceFilter } = await import('../../src/pairlist/filters.js');
      const filter = new PriceFilter();
      expect(filter.name).toBe('price');
    });
  });

  describe('MarketCapFilter', () => {
    it('filters stocks below minimum market cap', async () => {
      mockConfigValues['pairlist.marketCap.minBillions'] = 2;

      const { MarketCapFilter } = await import('../../src/pairlist/filters.js');
      const filter = new MarketCapFilter();

      const stocks = [
        makeStock({ symbol: 'BIG', marketCap: 5e9 }),
        makeStock({ symbol: 'SMALL', marketCap: 1e9 }),
        makeStock({ symbol: 'HUGE', marketCap: 100e9 }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(2);
      expect(result.map(s => s.symbol)).toEqual(['BIG', 'HUGE']);
    });

    it('excludes stocks with null market cap', async () => {
      mockConfigValues['pairlist.marketCap.minBillions'] = 1;

      const { MarketCapFilter } = await import('../../src/pairlist/filters.js');
      const filter = new MarketCapFilter();

      const stocks = [
        makeStock({ symbol: 'NULL', marketCap: undefined }),
        makeStock({ symbol: 'OK', marketCap: 2e9 }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(1);
    });

    it('includes stocks at exactly the boundary', async () => {
      mockConfigValues['pairlist.marketCap.minBillions'] = 2;

      const { MarketCapFilter } = await import('../../src/pairlist/filters.js');
      const filter = new MarketCapFilter();

      const stocks = [makeStock({ symbol: 'EXACT', marketCap: 2e9 })];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(1);
    });

    it('has correct name property', async () => {
      const { MarketCapFilter } = await import('../../src/pairlist/filters.js');
      const filter = new MarketCapFilter();
      expect(filter.name).toBe('marketCap');
    });
  });

  describe('VolatilityFilter', () => {
    it('filters stocks outside volatility range', async () => {
      mockConfigValues['pairlist.volatility.minDailyPct'] = 0.5;
      mockConfigValues['pairlist.volatility.maxDailyPct'] = 10;

      const { VolatilityFilter } = await import('../../src/pairlist/filters.js');
      const filter = new VolatilityFilter();

      const stocks = [
        makeStock({ symbol: 'STABLE', volatility: 0.1 }),
        makeStock({ symbol: 'NORMAL', volatility: 3 }),
        makeStock({ symbol: 'WILD', volatility: 15 }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('NORMAL');
    });

    it('includes stocks at boundary values', async () => {
      mockConfigValues['pairlist.volatility.minDailyPct'] = 0.5;
      mockConfigValues['pairlist.volatility.maxDailyPct'] = 10;

      const { VolatilityFilter } = await import('../../src/pairlist/filters.js');
      const filter = new VolatilityFilter();

      const stocks = [
        makeStock({ symbol: 'MIN', volatility: 0.5 }),
        makeStock({ symbol: 'MAX', volatility: 10 }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(2);
    });

    it('excludes stocks with null volatility', async () => {
      mockConfigValues['pairlist.volatility.minDailyPct'] = 0;
      mockConfigValues['pairlist.volatility.maxDailyPct'] = 100;

      const { VolatilityFilter } = await import('../../src/pairlist/filters.js');
      const filter = new VolatilityFilter();

      const stocks = [
        makeStock({ symbol: 'NULL', volatility: undefined }),
        makeStock({ symbol: 'OK', volatility: 2 }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(1);
    });

    it('has correct name property', async () => {
      const { VolatilityFilter } = await import('../../src/pairlist/filters.js');
      const filter = new VolatilityFilter();
      expect(filter.name).toBe('volatility');
    });
  });

  describe('BlacklistFilter', () => {
    it('removes blacklisted symbols', async () => {
      mockConfigValues['pairlist.blacklist'] = ['AAPL', 'GOOG'];

      const { BlacklistFilter } = await import('../../src/pairlist/filters.js');
      const filter = new BlacklistFilter();

      const stocks = [
        makeStock({ symbol: 'AAPL' }),
        makeStock({ symbol: 'MSFT' }),
        makeStock({ symbol: 'GOOG' }),
        makeStock({ symbol: 'AMZN' }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(2);
      expect(result.map(s => s.symbol)).toEqual(['MSFT', 'AMZN']);
    });

    it('is case insensitive', async () => {
      mockConfigValues['pairlist.blacklist'] = ['aapl'];

      const { BlacklistFilter } = await import('../../src/pairlist/filters.js');
      const filter = new BlacklistFilter();

      const stocks = [makeStock({ symbol: 'AAPL' }), makeStock({ symbol: 'MSFT' })];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('MSFT');
    });

    it('returns all stocks when blacklist is empty', async () => {
      mockConfigValues['pairlist.blacklist'] = [];

      const { BlacklistFilter } = await import('../../src/pairlist/filters.js');
      const filter = new BlacklistFilter();

      const stocks = [makeStock({ symbol: 'AAPL' }), makeStock({ symbol: 'MSFT' })];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(2);
    });

    it('has correct name property', async () => {
      const { BlacklistFilter } = await import('../../src/pairlist/filters.js');
      const filter = new BlacklistFilter();
      expect(filter.name).toBe('blacklist');
    });
  });

  describe('MaxPairsFilter', () => {
    it('limits the number of stocks to maxPairs', async () => {
      mockConfigValues['pairlist.maxPairs'] = 2;

      const { MaxPairsFilter } = await import('../../src/pairlist/filters.js');
      const filter = new MaxPairsFilter();

      const stocks = [
        makeStock({ symbol: 'A' }),
        makeStock({ symbol: 'B' }),
        makeStock({ symbol: 'C' }),
        makeStock({ symbol: 'D' }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('A');
      expect(result[1].symbol).toBe('B');
    });

    it('returns all stocks when under the limit', async () => {
      mockConfigValues['pairlist.maxPairs'] = 10;

      const { MaxPairsFilter } = await import('../../src/pairlist/filters.js');
      const filter = new MaxPairsFilter();

      const stocks = [makeStock({ symbol: 'A' }), makeStock({ symbol: 'B' })];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(2);
    });

    it('returns empty array when maxPairs is 0', async () => {
      mockConfigValues['pairlist.maxPairs'] = 0;

      const { MaxPairsFilter } = await import('../../src/pairlist/filters.js');
      const filter = new MaxPairsFilter();

      const stocks = [makeStock({ symbol: 'A' })];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(0);
    });

    it('has correct name property', async () => {
      const { MaxPairsFilter } = await import('../../src/pairlist/filters.js');
      const filter = new MaxPairsFilter();
      expect(filter.name).toBe('maxPairs');
    });
  });

  describe('PerformanceFilter', () => {
    beforeEach(() => {
      mockDbAll.mockReset();
      mockDbAll.mockReturnValue([]);
    });

    it('passes all stocks when filter is disabled', async () => {
      mockConfigValues['pairlist.performance.enabled'] = false;

      const { PerformanceFilter } = await import('../../src/pairlist/filters.js');
      const filter = new PerformanceFilter();

      const stocks = [makeStock({ symbol: 'AAPL' }), makeStock({ symbol: 'MSFT' })];
      const result = await filter.filter(stocks);

      expect(result).toHaveLength(2);
    });

    it('passes stocks with no trade history when enabled', async () => {
      mockConfigValues['pairlist.performance.enabled'] = true;
      mockConfigValues['pairlist.performance.minWinRate'] = 0.5;
      mockConfigValues['pairlist.performance.minTrades'] = 3;

      // No trades in DB
      mockDbAll.mockReturnValue([]);

      const { PerformanceFilter } = await import('../../src/pairlist/filters.js');
      const filter = new PerformanceFilter();

      const stocks = [makeStock({ symbol: 'AAPL' }), makeStock({ symbol: 'MSFT' })];
      const result = await filter.filter(stocks);

      expect(result).toHaveLength(2);
    });

    it('filters out stocks below minimum win rate (line 159: pnlPct with real values)', async () => {
      mockConfigValues['pairlist.performance.enabled'] = true;
      mockConfigValues['pairlist.performance.minWinRate'] = 0.5;
      mockConfigValues['pairlist.performance.minTrades'] = 2;

      // AAPL: 1 win, 3 losses → 25% win rate → filtered out
      // MSFT: 3 wins, 1 loss → 75% win rate → kept
      mockDbAll.mockReturnValue([
        { symbol: 'AAPL', pnlPct: 5 },
        { symbol: 'AAPL', pnlPct: -3 },
        { symbol: 'AAPL', pnlPct: -2 },
        { symbol: 'AAPL', pnlPct: -1 },
        { symbol: 'MSFT', pnlPct: 4 },
        { symbol: 'MSFT', pnlPct: 3 },
        { symbol: 'MSFT', pnlPct: 2 },
        { symbol: 'MSFT', pnlPct: -1 },
      ]);

      const { PerformanceFilter } = await import('../../src/pairlist/filters.js');
      const filter = new PerformanceFilter();

      const stocks = [makeStock({ symbol: 'AAPL' }), makeStock({ symbol: 'MSFT' })];
      const result = await filter.filter(stocks);

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('MSFT');
    });

    it('treats null pnlPct as 0 via ?? 0 fallback (line 159)', async () => {
      mockConfigValues['pairlist.performance.enabled'] = true;
      mockConfigValues['pairlist.performance.minWinRate'] = 0.5;
      mockConfigValues['pairlist.performance.minTrades'] = 2;

      // AAPL: 2 trades with null pnlPct → pnl = 0 each time (not > 0) → 0% win rate → filtered out
      mockDbAll.mockReturnValue([
        { symbol: 'AAPL', pnlPct: null },
        { symbol: 'AAPL', pnlPct: null },
      ]);

      const { PerformanceFilter } = await import('../../src/pairlist/filters.js');
      const filter = new PerformanceFilter();

      const stocks = [makeStock({ symbol: 'AAPL' })];
      const result = await filter.filter(stocks);

      // 0% win rate < 50% min → filtered out
      expect(result).toHaveLength(0);
    });

    it('has correct name property', async () => {
      const { PerformanceFilter } = await import('../../src/pairlist/filters.js');
      const filter = new PerformanceFilter();
      expect(filter.name).toBe('performance');
    });
  });

  describe('T212Filter', () => {
    function makeMockMapper(loaded: boolean, available: Set<string>) {
      return {
        isLoaded: () => loaded,
        isAvailable: (symbol: string) => available.has(symbol),
      } as import('../../src/data/ticker-mapper.js').TickerMapper;
    }

    it('filters out stocks not available on T212', async () => {
      const mapper = makeMockMapper(true, new Set(['AAPL', 'GOOG']));
      const { T212Filter } = await import('../../src/pairlist/filters.js');
      const filter = new T212Filter(mapper);

      const stocks = [
        makeStock({ symbol: 'AAPL' }),
        makeStock({ symbol: 'MSFT' }),
        makeStock({ symbol: 'GOOG' }),
        makeStock({ symbol: 'FAKE' }),
      ];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.symbol)).toEqual(['AAPL', 'GOOG']);
    });

    it('passes all stocks through when mapper is not loaded', async () => {
      const mapper = makeMockMapper(false, new Set());
      const { T212Filter } = await import('../../src/pairlist/filters.js');
      const filter = new T212Filter(mapper);

      const stocks = [makeStock({ symbol: 'AAPL' }), makeStock({ symbol: 'FAKE' })];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(2);
    });

    it('returns empty array when no stocks are available', async () => {
      const mapper = makeMockMapper(true, new Set());
      const { T212Filter } = await import('../../src/pairlist/filters.js');
      const filter = new T212Filter(mapper);

      const stocks = [makeStock({ symbol: 'AAPL' }), makeStock({ symbol: 'MSFT' })];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(0);
    });

    it('returns all stocks when all are available', async () => {
      const mapper = makeMockMapper(true, new Set(['AAPL', 'MSFT']));
      const { T212Filter } = await import('../../src/pairlist/filters.js');
      const filter = new T212Filter(mapper);

      const stocks = [makeStock({ symbol: 'AAPL' }), makeStock({ symbol: 'MSFT' })];

      const result = await filter.filter(stocks);
      expect(result).toHaveLength(2);
    });

    it('has correct name property', async () => {
      const mapper = makeMockMapper(false, new Set());
      const { T212Filter } = await import('../../src/pairlist/filters.js');
      const filter = new T212Filter(mapper);
      expect(filter.name).toBe('t212');
    });
  });
});
