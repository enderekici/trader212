import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockAxiosGet,
  mockAxiosCreate,
  mockGetKey,
  mockGetKeyCount,
  mockGetEffectiveRateLimit,
  mockConfigGet,
} = vi.hoisted(() => {
  const mockAxiosGet = vi.fn();
  return {
    mockAxiosGet,
    mockAxiosCreate: vi.fn(() => ({ get: mockAxiosGet })),
    mockGetKey: vi.fn().mockReturnValue('test-token'),
    mockGetKeyCount: vi.fn().mockReturnValue(1),
    mockGetEffectiveRateLimit: vi.fn().mockReturnValue(100),
    mockConfigGet: vi.fn(),
  };
});

vi.mock('axios', () => ({
  default: {
    create: mockAxiosCreate,
  },
}));

vi.mock('../../src/utils/key-rotator.js', () => ({
  createMarketauxRotator: () => ({
    getKey: mockGetKey,
    getKeyCount: mockGetKeyCount,
    getEffectiveRateLimit: mockGetEffectiveRateLimit,
  }),
}));

vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: mockConfigGet,
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { MarketauxClient } from '../../src/data/marketaux.js';

describe('MarketauxClient', () => {
  let client: MarketauxClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigGet.mockImplementation((key: string) => {
      if (key === 'data.marketaux.enabled') return true;
      if (key === 'data.marketaux.maxCallsPerDay') return 100;
      return null;
    });
    mockGetKeyCount.mockReturnValue(1);
    client = new MarketauxClient();
  });

  describe('constructor', () => {
    it('creates an axios instance with correct baseURL', () => {
      expect(mockAxiosCreate).toHaveBeenCalledWith({
        baseURL: 'https://api.marketaux.com',
        timeout: 10_000,
      });
    });

    it('logs warning when no keys configured', () => {
      mockGetKeyCount.mockReturnValue(0);
      const c = new MarketauxClient();
      expect(c).toBeDefined();
    });
  });

  describe('getNews', () => {
    it('returns mapped news articles', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          data: [
            {
              title: 'Apple earnings beat',
              description: 'Apple reported strong Q4',
              source: 'Reuters',
              url: 'http://example.com/news1',
              published_at: '2024-01-25T10:00:00Z',
              entities: [
                { sentiment_score: 0.8, match_score: 0.95 },
              ],
            },
          ],
        },
      });

      const result = await client.getNews(['AAPL']);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        title: 'Apple earnings beat',
        description: 'Apple reported strong Q4',
        source: 'Reuters',
        url: 'http://example.com/news1',
        publishedAt: '2024-01-25T10:00:00Z',
        sentimentScore: 0.8,
        relevanceScore: 0.95,
      });
    });

    it('passes correct params to API', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { data: [] } });

      await client.getNews(['AAPL', 'TSLA'], { limit: 5 });
      expect(mockAxiosGet).toHaveBeenCalledWith('/v1/news/all', {
        params: {
          api_token: 'test-token',
          symbols: 'AAPL,TSLA',
          filter_entities: true,
          language: 'en',
          limit: 5,
        },
      });
    });

    it('uses default limit of 10', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { data: [] } });

      await client.getNews(['AAPL']);
      expect(mockAxiosGet).toHaveBeenCalledWith('/v1/news/all', expect.objectContaining({
        params: expect.objectContaining({ limit: 10 }),
      }));
    });

    it('returns empty array when disabled', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'data.marketaux.enabled') return false;
        return 100;
      });

      const result = await client.getNews(['AAPL']);
      expect(result).toEqual([]);
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('returns empty array when budget is exhausted', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'data.marketaux.enabled') return true;
        if (key === 'data.marketaux.maxCallsPerDay') return 0;
        return null;
      });

      const c = new MarketauxClient();
      const result = await c.getNews(['AAPL']);
      expect(result).toEqual([]);
    });

    it('returns empty array when data.data is missing', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: {} });
      const result = await client.getNews(['AAPL']);
      expect(result).toEqual([]);
    });

    it('returns empty array on error', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('API Error'));
      const result = await client.getNews(['AAPL']);
      expect(result).toEqual([]);
    });

    it('handles articles with no entities (null sentiment/relevance)', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          data: [
            {
              title: 'Test',
              description: 'Description',
              source: 'Source',
              url: 'http://example.com',
              published_at: '2024-01-01',
            },
          ],
        },
      });

      const result = await client.getNews(['AAPL']);
      expect(result[0].sentimentScore).toBeNull();
      expect(result[0].relevanceScore).toBeNull();
    });

    it('handles articles with empty entities array', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          data: [
            {
              title: 'Test',
              description: 'Description',
              source: 'Source',
              url: 'http://example.com',
              published_at: '2024-01-01',
              entities: [],
            },
          ],
        },
      });

      const result = await client.getNews(['AAPL']);
      expect(result[0].sentimentScore).toBeNull();
      expect(result[0].relevanceScore).toBeNull();
    });

    it('handles entities with undefined sentiment_score and match_score', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          data: [
            {
              title: 'Test',
              description: 'Description',
              source: 'Source',
              url: 'http://example.com',
              published_at: '2024-01-01',
              entities: [{ other_field: 'value' }],
            },
          ],
        },
      });

      const result = await client.getNews(['AAPL']);
      expect(result[0].sentimentScore).toBeNull();
      expect(result[0].relevanceScore).toBeNull();
    });

    it('handles missing article fields with empty string defaults', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: { data: [{}] },
      });

      const result = await client.getNews(['AAPL']);
      expect(result[0]).toEqual({
        title: '',
        description: '',
        source: '',
        url: '',
        publishedAt: '',
        sentimentScore: null,
        relevanceScore: null,
      });
    });

    it('increments callsToday and enforces budget', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'data.marketaux.enabled') return true;
        if (key === 'data.marketaux.maxCallsPerDay') return 2;
        return null;
      });
      mockGetKeyCount.mockReturnValue(1);
      const c = new MarketauxClient();

      mockAxiosGet.mockResolvedValue({ data: { data: [] } });

      await c.getNews(['AAPL']);
      await c.getNews(['TSLA']);
      // Third call should be blocked by budget
      const result = await c.getNews(['GOOG']);
      expect(result).toEqual([]);
    });

    it('resets budget on new day', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'data.marketaux.enabled') return true;
        if (key === 'data.marketaux.maxCallsPerDay') return 1;
        return null;
      });
      mockGetKeyCount.mockReturnValue(1);
      const c = new MarketauxClient();

      mockAxiosGet.mockResolvedValue({ data: { data: [] } });

      // First call succeeds
      await c.getNews(['AAPL']);

      // Simulate a new day by changing the budgetResetDate
      (c as unknown as { budgetResetDate: string }).budgetResetDate = '2020-01-01';

      // Now the budget should reset and allow another call
      const result = await c.getNews(['TSLA']);
      expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    });

    it('multiplies maxCallsPerDay by key count', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'data.marketaux.enabled') return true;
        if (key === 'data.marketaux.maxCallsPerDay') return 1;
        return null;
      });
      mockGetKeyCount.mockReturnValue(3);
      const c = new MarketauxClient();

      mockAxiosGet.mockResolvedValue({ data: { data: [] } });

      // Should allow 3 calls (1 * 3)
      await c.getNews(['AAPL']);
      await c.getNews(['TSLA']);
      await c.getNews(['GOOG']);
      const result = await c.getNews(['MSFT']);
      expect(result).toEqual([]);
      expect(mockAxiosGet).toHaveBeenCalledTimes(3);
    });

    it('uses Math.max(keyCount, 1) for budget when keyCount is 0', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'data.marketaux.enabled') return true;
        if (key === 'data.marketaux.maxCallsPerDay') return 5;
        return null;
      });
      mockGetKeyCount.mockReturnValue(0);
      const c = new MarketauxClient();

      mockAxiosGet.mockResolvedValue({ data: { data: [] } });

      // maxCalls = 5 * Math.max(0, 1) = 5
      await c.getNews(['AAPL']);
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    });
  });
});
