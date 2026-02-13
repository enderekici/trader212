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
  priceCache: { symbol: 'symbol', timestamp: 'timestamp', timeframe: 'timeframe' },
  newsCache: { symbol: 'symbol', fetchedAt: 'fetchedAt' },
  fundamentalCache: { symbol: 'symbol', fetchedAt: 'fetchedAt' },
  pairlistHistory: { timestamp: 'timestamp' },
}));

describe('db/repositories/cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cachePrice', () => {
    it('inserts a price record and returns it', async () => {
      const data = { symbol: 'AAPL', timestamp: '2024-01-01', close: 150 };
      mockDb.insert.mockReturnValue(createChainableMock(data));

      const { cachePrice } = await import('../../src/db/repositories/cache.js');
      const result = cachePrice(data as any);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(result).toEqual(data);
    });
  });

  describe('cachePrices', () => {
    it('inserts multiple price records', async () => {
      const data = [
        { symbol: 'AAPL', timestamp: '2024-01-01', close: 150 },
        { symbol: 'AAPL', timestamp: '2024-01-02', close: 152 },
      ];
      mockDb.insert.mockReturnValue(createChainableMock(data));

      const { cachePrices } = await import('../../src/db/repositories/cache.js');
      const result = cachePrices(data as any);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(result).toEqual(data);
    });

    it('returns empty array for empty input', async () => {
      const { cachePrices } = await import('../../src/db/repositories/cache.js');
      const result = cachePrices([]);
      expect(result).toEqual([]);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe('getCachedPrices', () => {
    it('returns cached prices for a symbol', async () => {
      const prices = [{ symbol: 'AAPL', close: 150 }];
      mockDb.select.mockReturnValue(createChainableMock(prices));

      const { getCachedPrices } = await import('../../src/db/repositories/cache.js');
      const result = getCachedPrices('AAPL');
      expect(result).toEqual(prices);
    });

    it('accepts a from date filter', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getCachedPrices } = await import('../../src/db/repositories/cache.js');
      const result = getCachedPrices('AAPL', '2024-01-01');
      expect(result).toEqual([]);
    });

    it('accepts a custom timeframe', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getCachedPrices } = await import('../../src/db/repositories/cache.js');
      const result = getCachedPrices('AAPL', undefined, '1h');
      expect(result).toEqual([]);
    });
  });

  describe('getLatestPrice', () => {
    it('returns the latest price for a symbol', async () => {
      const price = { symbol: 'AAPL', close: 155 };
      mockDb.select.mockReturnValue(createChainableMock(price));

      const { getLatestPrice } = await import('../../src/db/repositories/cache.js');
      const result = getLatestPrice('AAPL');
      expect(result).toEqual(price);
    });

    it('returns undefined when no price found', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const { getLatestPrice } = await import('../../src/db/repositories/cache.js');
      const result = getLatestPrice('XYZ');
      expect(result).toBeUndefined();
    });
  });

  describe('cacheNews', () => {
    it('inserts a news record', async () => {
      const data = { symbol: 'AAPL', title: 'News', fetchedAt: '2024-01-01' };
      mockDb.insert.mockReturnValue(createChainableMock(data));

      const { cacheNews } = await import('../../src/db/repositories/cache.js');
      const result = cacheNews(data as any);
      expect(result).toEqual(data);
    });
  });

  describe('cacheNewsMany', () => {
    it('inserts multiple news records', async () => {
      const data = [
        { symbol: 'AAPL', title: 'News1', fetchedAt: '2024-01-01' },
        { symbol: 'AAPL', title: 'News2', fetchedAt: '2024-01-02' },
      ];
      mockDb.insert.mockReturnValue(createChainableMock(data));

      const { cacheNewsMany } = await import('../../src/db/repositories/cache.js');
      const result = cacheNewsMany(data as any);
      expect(result).toEqual(data);
    });

    it('returns empty array for empty input', async () => {
      const { cacheNewsMany } = await import('../../src/db/repositories/cache.js');
      const result = cacheNewsMany([]);
      expect(result).toEqual([]);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe('getCachedNews', () => {
    it('returns cached news for a symbol', async () => {
      const news = [{ symbol: 'AAPL', title: 'News' }];
      mockDb.select.mockReturnValue(createChainableMock(news));

      const { getCachedNews } = await import('../../src/db/repositories/cache.js');
      const result = getCachedNews('AAPL');
      expect(result).toEqual(news);
    });

    it('accepts a since filter', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getCachedNews } = await import('../../src/db/repositories/cache.js');
      const result = getCachedNews('AAPL', '2024-01-01');
      expect(result).toEqual([]);
    });
  });

  describe('cacheFundamentals', () => {
    it('inserts a fundamental record', async () => {
      const data = { symbol: 'AAPL', fetchedAt: '2024-01-01', peRatio: 25 };
      mockDb.insert.mockReturnValue(createChainableMock(data));

      const { cacheFundamentals } = await import('../../src/db/repositories/cache.js');
      const result = cacheFundamentals(data as any);
      expect(result).toEqual(data);
    });
  });

  describe('getCachedFundamentals', () => {
    it('returns cached fundamentals for a symbol', async () => {
      const fund = { symbol: 'AAPL', peRatio: 25 };
      mockDb.select.mockReturnValue(createChainableMock(fund));

      const { getCachedFundamentals } = await import('../../src/db/repositories/cache.js');
      const result = getCachedFundamentals('AAPL');
      expect(result).toEqual(fund);
    });

    it('returns undefined when no fundamentals found', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const { getCachedFundamentals } = await import('../../src/db/repositories/cache.js');
      const result = getCachedFundamentals('XYZ');
      expect(result).toBeUndefined();
    });
  });

  describe('insertPairlistRun', () => {
    it('inserts a pairlist run record', async () => {
      const data = { timestamp: '2024-01-01', symbols: '["AAPL"]' };
      mockDb.insert.mockReturnValue(createChainableMock(data));

      const { insertPairlistRun } = await import('../../src/db/repositories/cache.js');
      const result = insertPairlistRun(data as any);
      expect(result).toEqual(data);
    });
  });

  describe('getLatestPairlist', () => {
    it('returns the latest pairlist entry', async () => {
      const entry = { timestamp: '2024-01-01', symbols: '["AAPL"]' };
      mockDb.select.mockReturnValue(createChainableMock(entry));

      const { getLatestPairlist } = await import('../../src/db/repositories/cache.js');
      const result = getLatestPairlist();
      expect(result).toEqual(entry);
    });
  });

  describe('getPairlistHistory', () => {
    it('returns pairlist history with default limit', async () => {
      const entries = [{ timestamp: '2024-01-01', symbols: '["AAPL"]' }];
      mockDb.select.mockReturnValue(createChainableMock(entries));

      const { getPairlistHistory } = await import('../../src/db/repositories/cache.js');
      const result = getPairlistHistory();
      expect(result).toEqual(entries);
    });

    it('accepts a custom limit', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getPairlistHistory } = await import('../../src/db/repositories/cache.js');
      const result = getPairlistHistory(5);
      expect(result).toEqual([]);
    });
  });
});
