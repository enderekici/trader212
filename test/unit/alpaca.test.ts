import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock helpers
vi.mock('../../src/utils/helpers.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// Mock configManager
vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn().mockReturnValue('iex'),
  },
}));

// Mock axios
const mockGet = vi.fn();
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({ get: mockGet })),
  },
}));

import { AlpacaClient } from '../../src/data/alpaca.js';

describe('AlpacaClient', () => {
  let client: AlpacaClient;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALPACA_API_KEY = 'test-key';
    process.env.ALPACA_API_SECRET = 'test-secret';
    client = new AlpacaClient();
  });

  afterEach(() => {
    delete process.env.ALPACA_API_KEY;
    delete process.env.ALPACA_API_SECRET;
  });

  describe('constructor', () => {
    it('throws when ALPACA_API_KEY is missing', () => {
      delete process.env.ALPACA_API_KEY;
      expect(() => new AlpacaClient()).toThrow(
        'ALPACA_API_KEY and ALPACA_API_SECRET environment variables are required',
      );
    });

    it('throws when ALPACA_API_SECRET is missing', () => {
      delete process.env.ALPACA_API_SECRET;
      expect(() => new AlpacaClient()).toThrow(
        'ALPACA_API_KEY and ALPACA_API_SECRET environment variables are required',
      );
    });

    it('creates client when both env vars are set', () => {
      expect(client).toBeInstanceOf(AlpacaClient);
    });
  });

  describe('getHistoricalBars', () => {
    it('fetches bars and maps to OHLCVCandle format', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          bars: [
            { t: '2024-01-15T00:00:00Z', o: 100, h: 105, l: 99, c: 103, v: 50000, n: 100, vw: 102 },
            { t: '2024-01-16T00:00:00Z', o: 103, h: 108, l: 102, c: 107, v: 60000, n: 120, vw: 105 },
          ],
          next_page_token: null,
        },
      });

      const candles = await client.getHistoricalBars('AAPL', '2024-01-15', '2024-01-16');

      expect(candles).toEqual([
        { date: '2024-01-15', open: 100, high: 105, low: 99, close: 103, volume: 50000 },
        { date: '2024-01-16', open: 103, high: 108, low: 102, close: 107, volume: 60000 },
      ]);

      expect(mockGet).toHaveBeenCalledWith('/v2/stocks/AAPL/bars', {
        params: expect.objectContaining({
          start: '2024-01-15',
          end: '2024-01-16',
          timeframe: '1Day',
          feed: 'iex',
        }),
      });
    });

    it('handles pagination via next_page_token', async () => {
      mockGet
        .mockResolvedValueOnce({
          data: {
            bars: [{ t: '2024-01-15T00:00:00Z', o: 100, h: 105, l: 99, c: 103, v: 50000, n: 100, vw: 102 }],
            next_page_token: 'abc123',
          },
        })
        .mockResolvedValueOnce({
          data: {
            bars: [{ t: '2024-01-16T00:00:00Z', o: 103, h: 108, l: 102, c: 107, v: 60000, n: 120, vw: 105 }],
            next_page_token: null,
          },
        });

      const candles = await client.getHistoricalBars('AAPL', '2024-01-15', '2024-01-16');

      expect(candles).toHaveLength(2);
      expect(mockGet).toHaveBeenCalledTimes(2);

      // Second call should include page_token
      expect(mockGet).toHaveBeenLastCalledWith('/v2/stocks/AAPL/bars', {
        params: expect.objectContaining({ page_token: 'abc123' }),
      });
    });

    it('returns empty array when no bars in response', async () => {
      mockGet.mockResolvedValueOnce({
        data: { bars: null, next_page_token: null },
      });

      const candles = await client.getHistoricalBars('XYZ', '2024-01-15', '2024-01-16');
      expect(candles).toEqual([]);
    });
  });

  describe('getSnapshots', () => {
    it('fetches snapshots for multiple symbols', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          AAPL: {
            latestTrade: { t: '2024-01-15T16:00:00Z', p: 185.5, s: 100 },
            latestQuote: { bp: 185.4, ap: 185.6, bs: 200, as: 300, t: '2024-01-15T16:00:00Z' },
            minuteBar: null,
            dailyBar: { t: '2024-01-15T00:00:00Z', o: 183, h: 186, l: 182, c: 185.5, v: 50000000, n: 1000, vw: 184 },
            prevDailyBar: { t: '2024-01-14T00:00:00Z', o: 182, h: 184, l: 181, c: 183, v: 45000000, n: 900, vw: 183 },
          },
          MSFT: {
            latestTrade: { t: '2024-01-15T16:00:00Z', p: 395.2, s: 50 },
            latestQuote: null,
            minuteBar: null,
            dailyBar: null,
            prevDailyBar: null,
          },
        },
      });

      const snapshots = await client.getSnapshots(['AAPL', 'MSFT']);

      expect(snapshots.size).toBe(2);
      expect(snapshots.get('AAPL')?.latestTrade?.p).toBe(185.5);
      expect(snapshots.get('MSFT')?.latestTrade?.p).toBe(395.2);

      expect(mockGet).toHaveBeenCalledWith('/v2/stocks/snapshots', {
        params: { symbols: 'AAPL,MSFT', feed: 'iex' },
      });
    });

    it('batches requests for more than 50 symbols', async () => {
      const symbols = Array.from({ length: 75 }, (_, i) => `SYM${i}`);

      mockGet
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: {} });

      await client.getSnapshots(symbols);

      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  describe('getLatestQuotes', () => {
    it('fetches and maps latest quotes', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          quotes: {
            AAPL: { bp: 185.4, ap: 185.6, bs: 200, as: 300, t: '2024-01-15T16:00:00Z' },
          },
        },
      });

      const quotes = await client.getLatestQuotes(['AAPL']);

      expect(quotes.size).toBe(1);
      const q = quotes.get('AAPL');
      expect(q).toEqual({
        symbol: 'AAPL',
        bidPrice: 185.4,
        askPrice: 185.6,
        bidSize: 200,
        askSize: 300,
        timestamp: '2024-01-15T16:00:00Z',
      });
    });

    it('returns empty map when no quotes', async () => {
      mockGet.mockResolvedValueOnce({ data: { quotes: null } });

      const quotes = await client.getLatestQuotes(['AAPL']);
      expect(quotes.size).toBe(0);
    });
  });

  describe('getNews', () => {
    it('fetches and maps news articles', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          news: [
            {
              id: 123,
              headline: 'AAPL Earnings Beat',
              summary: 'Apple beats estimates',
              url: 'https://example.com/news/123',
              source: 'Reuters',
              symbols: ['AAPL'],
              created_at: '2024-01-15T10:00:00Z',
            },
          ],
        },
      });

      const articles = await client.getNews(['AAPL'], 10);

      expect(articles).toHaveLength(1);
      expect(articles[0]).toEqual({
        id: 123,
        headline: 'AAPL Earnings Beat',
        summary: 'Apple beats estimates',
        url: 'https://example.com/news/123',
        source: 'Reuters',
        symbols: ['AAPL'],
        createdAt: '2024-01-15T10:00:00Z',
      });

      expect(mockGet).toHaveBeenCalledWith('/v1beta1/news', {
        params: { limit: 10, symbols: 'AAPL' },
      });
    });

    it('works without symbol filter', async () => {
      mockGet.mockResolvedValueOnce({ data: { news: [] } });

      const articles = await client.getNews();

      expect(articles).toEqual([]);
      expect(mockGet).toHaveBeenCalledWith('/v1beta1/news', {
        params: { limit: 50 },
      });
    });

    it('returns empty array when response has no news', async () => {
      mockGet.mockResolvedValueOnce({ data: {} });

      const articles = await client.getNews(['AAPL']);
      expect(articles).toEqual([]);
    });
  });

  describe('getLatestBars', () => {
    it('fetches and maps latest bars', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          bars: {
            AAPL: { t: '2024-01-15T00:00:00Z', o: 183, h: 186, l: 182, c: 185, v: 50000000, n: 1000, vw: 184 },
          },
        },
      });

      const bars = await client.getLatestBars(['AAPL']);

      expect(bars.size).toBe(1);
      expect(bars.get('AAPL')?.c).toBe(185);
    });

    it('returns empty map when no bars', async () => {
      mockGet.mockResolvedValueOnce({ data: { bars: null } });

      const bars = await client.getLatestBars(['AAPL']);
      expect(bars.size).toBe(0);
    });
  });
});
