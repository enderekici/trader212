import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { PairlistFilter, StockInfo } from '../../src/pairlist/filters.js';

const mockConfigValues: Record<string, unknown> = {};

vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn((key: string) => {
      if (key in mockConfigValues) return mockConfigValues[key];
      throw new Error(`Config key not found: ${key}`);
    }),
  },
}));

const mockDbInsert = vi.fn(() => ({
  values: vi.fn(() => ({
    run: vi.fn(),
  })),
}));

vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    insert: mockDbInsert,
  }),
}));

vi.mock('../../src/db/schema.js', () => ({
  pairlistHistory: {},
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

function makeStock(symbol: string, extra?: Partial<StockInfo>): StockInfo {
  return {
    symbol,
    t212Ticker: symbol,
    name: symbol,
    ...extra,
  };
}

function makeFilter(name: string, fn?: (stocks: StockInfo[]) => StockInfo[]): PairlistFilter {
  return {
    name,
    filter: vi.fn(async (stocks: StockInfo[]) => fn ? fn(stocks) : stocks),
  };
}

describe('pairlist/pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockConfigValues)) {
      delete mockConfigValues[key];
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('PairlistPipeline - dynamic mode', () => {
    it('runs all filters in chain and returns result', async () => {
      mockConfigValues['pairlist.mode'] = 'dynamic';

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const filter1 = makeFilter('f1', (stocks) => stocks.filter(s => s.symbol !== 'B'));
      const filter2 = makeFilter('f2', (stocks) => stocks.slice(0, 1));
      const pipeline = new PairlistPipeline([filter1, filter2]);

      const stocks = [makeStock('A'), makeStock('B'), makeStock('C')];
      const result = await pipeline.run(stocks);

      expect(filter1.filter).toHaveBeenCalled();
      expect(filter2.filter).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('A');
    });

    it('records filter stats showing how many stocks each filter removed', async () => {
      mockConfigValues['pairlist.mode'] = 'dynamic';

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const filter1 = makeFilter('volume', (stocks) => stocks.slice(0, 2));
      const filter2 = makeFilter('price', (stocks) => stocks.slice(0, 1));
      const pipeline = new PairlistPipeline([filter1, filter2]);

      const stocks = [makeStock('A'), makeStock('B'), makeStock('C')];
      await pipeline.run(stocks);

      const stats = pipeline.getFilterStats();
      expect(stats.volume).toBe(1); // removed 1
      expect(stats.price).toBe(1); // removed 1
    });

    it('skips a filter that throws an error', async () => {
      mockConfigValues['pairlist.mode'] = 'dynamic';

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const badFilter: PairlistFilter = {
        name: 'bad',
        filter: vi.fn(async () => { throw new Error('filter error'); }),
      };
      const goodFilter = makeFilter('good', (stocks) => stocks);
      const pipeline = new PairlistPipeline([badFilter, goodFilter]);

      const stocks = [makeStock('A'), makeStock('B')];
      const result = await pipeline.run(stocks);

      expect(result).toHaveLength(2);
      expect(goodFilter.filter).toHaveBeenCalled();
    });

    it('saves result to database', async () => {
      mockConfigValues['pairlist.mode'] = 'dynamic';

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const pipeline = new PairlistPipeline([]);
      await pipeline.run([makeStock('AAPL')]);

      expect(mockDbInsert).toHaveBeenCalled();
    });

    it('handles database save failure gracefully', async () => {
      mockConfigValues['pairlist.mode'] = 'dynamic';
      mockDbInsert.mockImplementationOnce(() => { throw new Error('db error'); });

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const pipeline = new PairlistPipeline([]);
      // Should not throw
      const result = await pipeline.run([makeStock('AAPL')]);
      expect(result).toHaveLength(1);
    });
  });

  describe('PairlistPipeline - static mode', () => {
    it('returns static symbols without running filters', async () => {
      mockConfigValues['pairlist.mode'] = 'static';
      mockConfigValues['pairlist.staticSymbols'] = ['AAPL', 'MSFT'];

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const filter = makeFilter('volume');
      const pipeline = new PairlistPipeline([filter]);

      const result = await pipeline.run([makeStock('GOOG')]);

      expect(filter.filter).not.toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('AAPL');
      expect(result[1].symbol).toBe('MSFT');
    });

    it('converts symbols to uppercase StockInfo', async () => {
      mockConfigValues['pairlist.mode'] = 'static';
      mockConfigValues['pairlist.staticSymbols'] = ['aapl'];

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const pipeline = new PairlistPipeline([]);
      const result = await pipeline.run([]);

      expect(result[0].symbol).toBe('AAPL');
      expect(result[0].t212Ticker).toBe('AAPL');
      expect(result[0].name).toBe('AAPL');
    });

    it('sets filter stats to static: 0', async () => {
      mockConfigValues['pairlist.mode'] = 'static';
      mockConfigValues['pairlist.staticSymbols'] = ['AAPL'];

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const pipeline = new PairlistPipeline([]);
      await pipeline.run([]);

      const stats = pipeline.getFilterStats();
      expect(stats.static).toBe(0);
    });
  });

  describe('PairlistPipeline - hybrid mode', () => {
    it('includes static symbols and applies filters to dynamic pool', async () => {
      mockConfigValues['pairlist.mode'] = 'hybrid';
      mockConfigValues['pairlist.staticSymbols'] = ['AAPL'];
      mockConfigValues['pairlist.maxPairs'] = 3;

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const filter = makeFilter('test', (stocks) => stocks);
      const pipeline = new PairlistPipeline([filter]);

      const stocks = [
        makeStock('AAPL', { price: 150 }),
        makeStock('MSFT', { price: 300 }),
        makeStock('GOOG', { price: 140 }),
      ];

      const result = await pipeline.run(stocks);

      // AAPL is static and appears first, MSFT and GOOG are dynamic
      expect(result[0].symbol).toBe('AAPL');
      expect(result.length).toBe(3);
    });

    it('prefers existing StockInfo for static symbols from input', async () => {
      mockConfigValues['pairlist.mode'] = 'hybrid';
      mockConfigValues['pairlist.staticSymbols'] = ['AAPL'];
      mockConfigValues['pairlist.maxPairs'] = 10;

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const pipeline = new PairlistPipeline([]);
      const stocks = [makeStock('AAPL', { price: 150, volume: 1000000 })];

      const result = await pipeline.run(stocks);

      expect(result[0].price).toBe(150);
      expect(result[0].volume).toBe(1000000);
    });

    it('creates minimal StockInfo for static symbols not in input', async () => {
      mockConfigValues['pairlist.mode'] = 'hybrid';
      mockConfigValues['pairlist.staticSymbols'] = ['TSLA'];
      mockConfigValues['pairlist.maxPairs'] = 10;

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const pipeline = new PairlistPipeline([]);
      const stocks = [makeStock('AAPL')];

      const result = await pipeline.run(stocks);

      expect(result[0].symbol).toBe('TSLA');
      expect(result[0].t212Ticker).toBe('TSLA');
    });

    it('respects maxPairs including static symbols', async () => {
      mockConfigValues['pairlist.mode'] = 'hybrid';
      mockConfigValues['pairlist.staticSymbols'] = ['AAPL', 'MSFT'];
      mockConfigValues['pairlist.maxPairs'] = 3;

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const pipeline = new PairlistPipeline([]);
      const stocks = [
        makeStock('AAPL'),
        makeStock('MSFT'),
        makeStock('GOOG'),
        makeStock('AMZN'),
        makeStock('TSLA'),
      ];

      const result = await pipeline.run(stocks);

      // 2 static + 1 dynamic = 3 total
      expect(result.length).toBe(3);
    });

    it('handles case where all slots taken by static symbols', async () => {
      mockConfigValues['pairlist.mode'] = 'hybrid';
      mockConfigValues['pairlist.staticSymbols'] = ['AAPL', 'MSFT'];
      mockConfigValues['pairlist.maxPairs'] = 2;

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const pipeline = new PairlistPipeline([]);
      const stocks = [makeStock('AAPL'), makeStock('MSFT'), makeStock('GOOG')];

      const result = await pipeline.run(stocks);

      expect(result.length).toBe(2);
      expect(result.map(s => s.symbol)).toEqual(['AAPL', 'MSFT']);
    });

    it('excludes static symbols from dynamic filter pool', async () => {
      mockConfigValues['pairlist.mode'] = 'hybrid';
      mockConfigValues['pairlist.staticSymbols'] = ['AAPL'];
      mockConfigValues['pairlist.maxPairs'] = 10;

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const filterFn = vi.fn(async (stocks: StockInfo[]) => stocks);
      const filter: PairlistFilter = { name: 'test', filter: filterFn };
      const pipeline = new PairlistPipeline([filter]);

      const stocks = [makeStock('AAPL'), makeStock('MSFT'), makeStock('GOOG')];
      await pipeline.run(stocks);

      // Filter should only receive MSFT and GOOG, not AAPL
      const filterInput = filterFn.mock.calls[0][0] as StockInfo[];
      expect(filterInput.map(s => s.symbol)).toEqual(['MSFT', 'GOOG']);
    });

    it('skips failing filters in hybrid mode', async () => {
      mockConfigValues['pairlist.mode'] = 'hybrid';
      mockConfigValues['pairlist.staticSymbols'] = ['AAPL'];
      mockConfigValues['pairlist.maxPairs'] = 10;

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const badFilter: PairlistFilter = {
        name: 'bad',
        filter: vi.fn(async () => { throw new Error('fail'); }),
      };
      const pipeline = new PairlistPipeline([badFilter]);

      const stocks = [makeStock('AAPL'), makeStock('MSFT')];
      const result = await pipeline.run(stocks);

      // AAPL (static) + MSFT (dynamic that survived the skipped filter)
      expect(result.length).toBe(2);
    });

    it('falls back to Infinity when maxPairs config is missing', async () => {
      mockConfigValues['pairlist.mode'] = 'hybrid';
      mockConfigValues['pairlist.staticSymbols'] = ['AAPL'];
      // Don't set pairlist.maxPairs - should fall back to Infinity

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');
      const pipeline = new PairlistPipeline([]);

      const stocks = [makeStock('AAPL'), makeStock('MSFT'), makeStock('GOOG')];
      const result = await pipeline.run(stocks);

      expect(result.length).toBe(3);
    });

    it('records static_protected count in stats', async () => {
      mockConfigValues['pairlist.mode'] = 'hybrid';
      mockConfigValues['pairlist.staticSymbols'] = ['AAPL', 'MSFT'];
      mockConfigValues['pairlist.maxPairs'] = 10;

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');
      const pipeline = new PairlistPipeline([]);

      await pipeline.run([makeStock('GOOG')]);

      const stats = pipeline.getFilterStats();
      expect(stats.static_protected).toBe(2);
    });
  });

  describe('PairlistPipeline - defaults to dynamic', () => {
    it('defaults to dynamic when mode config throws', async () => {
      // Don't set pairlist.mode - configManager.get will throw

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');
      const pipeline = new PairlistPipeline([]);

      const stocks = [makeStock('AAPL')];
      const result = await pipeline.run(stocks);

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('AAPL');
    });
  });

  describe('PairlistPipeline - caching', () => {
    it('getActiveStocks returns null when cache is empty', async () => {
      mockConfigValues['pairlist.mode'] = 'dynamic';
      mockConfigValues['pairlist.refreshMinutes'] = 30;

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');
      const pipeline = new PairlistPipeline([]);

      expect(pipeline.getActiveStocks()).toBeNull();
    });

    it('getActiveStocks returns cached stocks when cache is fresh', async () => {
      mockConfigValues['pairlist.mode'] = 'dynamic';
      mockConfigValues['pairlist.refreshMinutes'] = 30;

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');
      const pipeline = new PairlistPipeline([]);

      const stocks = [makeStock('AAPL')];
      await pipeline.run(stocks);

      const cached = pipeline.getActiveStocks();
      expect(cached).toHaveLength(1);
      expect(cached![0].symbol).toBe('AAPL');
    });

    it('getActiveStocks returns null when cache is expired', async () => {
      vi.useFakeTimers();
      mockConfigValues['pairlist.mode'] = 'dynamic';
      mockConfigValues['pairlist.refreshMinutes'] = 1; // 1 minute

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');
      const pipeline = new PairlistPipeline([]);

      await pipeline.run([makeStock('AAPL')]);

      // Advance time past the cache TTL
      vi.advanceTimersByTime(2 * 60 * 1000); // 2 minutes

      expect(pipeline.getActiveStocks()).toBeNull();
    });
  });

  describe('PairlistPipeline - getFilterStats', () => {
    it('returns a copy of the filter stats', async () => {
      mockConfigValues['pairlist.mode'] = 'dynamic';

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');

      const filter = makeFilter('vol', (stocks) => stocks.slice(0, 1));
      const pipeline = new PairlistPipeline([filter]);

      await pipeline.run([makeStock('A'), makeStock('B')]);

      const stats = pipeline.getFilterStats();
      expect(stats.vol).toBe(1);

      // Mutating the returned stats should not affect internal state
      stats.vol = 999;
      expect(pipeline.getFilterStats().vol).toBe(1);
    });
  });

  describe('PairlistPipeline - static symbol fallback', () => {
    it('returns empty array when staticSymbols config throws in static mode', async () => {
      mockConfigValues['pairlist.mode'] = 'static';
      // Don't set pairlist.staticSymbols - it will throw and fall back to []

      const { PairlistPipeline } = await import('../../src/pairlist/pipeline.js');
      const pipeline = new PairlistPipeline([]);

      const result = await pipeline.run([]);
      expect(result).toHaveLength(0);
    });
  });
});
