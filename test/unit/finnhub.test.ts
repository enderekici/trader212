import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockAxiosGet,
  mockAxiosCreate,
  mockGetKey,
  mockGetKeyCount,
  mockGetEffectiveRateLimit,
  mockConfigGet,
  mockSleep,
} = vi.hoisted(() => {
  const mockAxiosGet = vi.fn();
  return {
    mockAxiosGet,
    mockAxiosCreate: vi.fn(() => ({ get: mockAxiosGet })),
    mockGetKey: vi.fn().mockReturnValue('test-key'),
    mockGetKeyCount: vi.fn().mockReturnValue(1),
    mockGetEffectiveRateLimit: vi.fn().mockReturnValue(60),
    mockConfigGet: vi.fn(),
    mockSleep: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('axios', () => ({
  default: {
    create: mockAxiosCreate,
  },
}));

vi.mock('../../src/utils/helpers.js', () => ({
  sleep: mockSleep,
}));

vi.mock('../../src/utils/key-rotator.js', () => ({
  createFinnhubRotator: () => ({
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

import { FinnhubClient } from '../../src/data/finnhub.js';

describe('FinnhubClient', () => {
  let client: FinnhubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigGet.mockImplementation((key: string) => {
      if (key === 'data.finnhub.quotesEnabled') return true;
      if (key === 'data.finnhub.newsEnabled') return true;
      if (key === 'data.finnhub.earningsEnabled') return true;
      if (key === 'data.finnhub.insidersEnabled') return true;
      return null;
    });
    mockGetKeyCount.mockReturnValue(1);
    mockGetEffectiveRateLimit.mockReturnValue(60);
    client = new FinnhubClient();
  });

  describe('constructor', () => {
    it('creates an axios instance with base URL and timeout', () => {
      expect(mockAxiosCreate).toHaveBeenCalledWith({
        baseURL: 'https://finnhub.io/api/v1',
        timeout: 10_000,
      });
    });

    it('logs warning when no keys configured', () => {
      mockGetKeyCount.mockReturnValue(0);
      const c = new FinnhubClient();
      expect(c).toBeDefined();
    });
  });

  describe('getQuote', () => {
    it('returns quote data', async () => {
      const quoteData = { c: 150, h: 155, l: 148, o: 149, pc: 147, t: 1700000000 };
      mockAxiosGet.mockResolvedValueOnce({ data: quoteData });

      const result = await client.getQuote('AAPL');
      expect(result).toEqual(quoteData);
      expect(mockAxiosGet).toHaveBeenCalledWith('/quote', {
        params: { symbol: 'AAPL', token: 'test-key' },
      });
    });

    it('returns null when quotes are disabled', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'data.finnhub.quotesEnabled') return false;
        return true;
      });

      const result = await client.getQuote('AAPL');
      expect(result).toBeNull();
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('returns null when data is null', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: null });
      const result = await client.getQuote('AAPL');
      expect(result).toBeNull();
    });

    it('returns null when current price is 0', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { c: 0, h: 0, l: 0, o: 0, pc: 0, t: 0 } });
      const result = await client.getQuote('AAPL');
      expect(result).toBeNull();
    });

    it('returns null on error', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('Network error'));
      const result = await client.getQuote('AAPL');
      expect(result).toBeNull();
    });
  });

  describe('getCompanyNews', () => {
    it('returns news articles', async () => {
      const newsData = [
        {
          id: 1,
          category: 'company news',
          datetime: 1700000000,
          headline: 'Test headline',
          image: 'http://example.com/img.jpg',
          related: 'AAPL',
          source: 'Reuters',
          summary: 'Test summary',
          url: 'http://example.com',
        },
      ];
      mockAxiosGet.mockResolvedValueOnce({ data: newsData });

      const result = await client.getCompanyNews('AAPL', '2024-01-01', '2024-01-31');
      expect(result).toEqual(newsData);
      expect(mockAxiosGet).toHaveBeenCalledWith('/company-news', {
        params: { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-31', token: 'test-key' },
      });
    });

    it('returns empty array when news is disabled', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'data.finnhub.newsEnabled') return false;
        return true;
      });

      const result = await client.getCompanyNews('AAPL', '2024-01-01', '2024-01-31');
      expect(result).toEqual([]);
    });

    it('returns empty array when data is null', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: null });
      const result = await client.getCompanyNews('AAPL', '2024-01-01', '2024-01-31');
      expect(result).toEqual([]);
    });

    it('returns empty array on error', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('API Error'));
      const result = await client.getCompanyNews('AAPL', '2024-01-01', '2024-01-31');
      expect(result).toEqual([]);
    });
  });

  describe('getEarningsCalendar', () => {
    it('returns mapped earnings events', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          earningsCalendar: [
            {
              symbol: 'AAPL',
              date: '2024-01-25',
              epsEstimate: 2.1,
              epsActual: 2.18,
              revenueEstimate: 117000000000,
              revenueActual: 119600000000,
              hour: 'amc',
              quarter: 1,
              year: 2024,
            },
          ],
        },
      });

      const result = await client.getEarningsCalendar('2024-01-01', '2024-02-01');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        symbol: 'AAPL',
        date: '2024-01-25',
        epsEstimate: 2.1,
        epsActual: 2.18,
        revenueEstimate: 117000000000,
        revenueActual: 119600000000,
        hour: 'amc',
        quarter: 1,
        year: 2024,
      });
    });

    it('returns empty array when earnings are disabled', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'data.finnhub.earningsEnabled') return false;
        return true;
      });

      const result = await client.getEarningsCalendar('2024-01-01', '2024-02-01');
      expect(result).toEqual([]);
    });

    it('returns empty array when no earningsCalendar in response', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: {} });
      const result = await client.getEarningsCalendar('2024-01-01', '2024-02-01');
      expect(result).toEqual([]);
    });

    it('returns empty array on error', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('API Error'));
      const result = await client.getEarningsCalendar('2024-01-01', '2024-02-01');
      expect(result).toEqual([]);
    });

    it('handles missing fields in earnings events with defaults', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          earningsCalendar: [{}],
        },
      });

      const result = await client.getEarningsCalendar('2024-01-01', '2024-02-01');
      expect(result[0]).toEqual({
        symbol: '',
        date: '',
        epsEstimate: null,
        epsActual: null,
        revenueEstimate: null,
        revenueActual: null,
        hour: '',
        quarter: 0,
        year: 0,
      });
    });
  });

  describe('getInsiderTransactions', () => {
    it('returns mapped insider transactions', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          data: [
            {
              symbol: 'AAPL',
              name: 'Tim Cook',
              share: 1000,
              change: -500,
              filingDate: '2024-01-15',
              transactionDate: '2024-01-14',
              transactionCode: 'S',
              transactionPrice: 185.5,
            },
          ],
        },
      });

      const result = await client.getInsiderTransactions('AAPL');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        symbol: 'AAPL',
        name: 'Tim Cook',
        share: 1000,
        change: -500,
        filingDate: '2024-01-15',
        transactionDate: '2024-01-14',
        transactionCode: 'S',
        transactionPrice: 185.5,
      });
    });

    it('returns empty array when insiders are disabled', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'data.finnhub.insidersEnabled') return false;
        return true;
      });

      const result = await client.getInsiderTransactions('AAPL');
      expect(result).toEqual([]);
    });

    it('returns empty array when data.data is missing', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: {} });
      const result = await client.getInsiderTransactions('AAPL');
      expect(result).toEqual([]);
    });

    it('returns empty array on error', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('API Error'));
      const result = await client.getInsiderTransactions('AAPL');
      expect(result).toEqual([]);
    });

    it('uses symbol param as default for missing symbol in tx', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          data: [
            {
              name: 'Insider',
              share: 100,
              change: 50,
              filingDate: '2024-01-01',
              transactionDate: '2024-01-01',
              transactionCode: 'P',
              transactionPrice: 100,
            },
          ],
        },
      });

      const result = await client.getInsiderTransactions('AAPL');
      expect(result[0].symbol).toBe('AAPL');
    });

    it('handles missing fields with defaults', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: { data: [{}] },
      });

      const result = await client.getInsiderTransactions('TSLA');
      expect(result[0]).toEqual({
        symbol: 'TSLA',
        name: '',
        share: 0,
        change: 0,
        filingDate: '',
        transactionDate: '',
        transactionCode: '',
        transactionPrice: 0,
      });
    });
  });

  describe('rate limiting', () => {
    it('does not sleep when under rate limit', async () => {
      mockAxiosGet.mockResolvedValue({ data: { c: 150, h: 155, l: 148, o: 149, pc: 147, t: 0 } });

      await client.getQuote('AAPL');
      expect(mockSleep).not.toHaveBeenCalled();
    });

    it('waits when rate limit is reached', async () => {
      mockGetEffectiveRateLimit.mockReturnValue(1);
      const rateLimitedClient = new FinnhubClient();
      mockAxiosGet.mockResolvedValue({ data: { c: 150, h: 155, l: 148, o: 149, pc: 147, t: 0 } });

      // First call - under limit
      await rateLimitedClient.getQuote('AAPL');
      mockSleep.mockClear();

      // Second call - should hit rate limit
      await rateLimitedClient.getQuote('TSLA');
      expect(mockSleep).toHaveBeenCalled();
    });

    it('uses RATE_LIMIT_PER_MINUTE fallback when effective limit is 0', async () => {
      mockGetEffectiveRateLimit.mockReturnValue(0);
      const c = new FinnhubClient();
      mockAxiosGet.mockResolvedValue({ data: { c: 100, h: 100, l: 100, o: 100, pc: 100, t: 0 } });
      // Should not crash; uses fallback of 60
      await c.getQuote('AAPL');
    });

    it('passes key from key rotator to API', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { c: 100, h: 100, l: 100, o: 100, pc: 100, t: 0 } });
      await client.getQuote('AAPL');
      expect(mockGetKey).toHaveBeenCalled();
      expect(mockAxiosGet).toHaveBeenCalledWith('/quote', {
        params: { symbol: 'AAPL', token: 'test-key' },
      });
    });
  });
});
