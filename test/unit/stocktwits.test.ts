import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { StockTwitsClient, getStockTwitsClient } from '../../src/data/stocktwits.js';

describe('StockTwitsClient', () => {
  let client: StockTwitsClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new StockTwitsClient();
    // Reset fetch mock
    global.fetch = vi.fn();
  });

  const makeResponse = (body: unknown, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => body,
  });

  describe('getSymbolData', () => {
    it('parses bullish/bearish counts correctly', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse({
          messages: [
            { entities: { sentiment: { basic: 'Bullish' } } },
            { entities: { sentiment: { basic: 'Bullish' } } },
            { entities: { sentiment: { basic: 'Bearish' } } },
            { entities: {} }, // no sentiment tag
          ],
          symbol: { watchlist_count: 12345 },
        }),
      );

      const data = await client.getSymbolData('AAPL');
      expect(data).not.toBeNull();
      expect(data!.bullishCount).toBe(2);
      expect(data!.bearishCount).toBe(1);
      expect(data!.totalMessages).toBe(4);
      expect(data!.watchlistCount).toBe(12345);
      expect(data!.sentimentRatio).toBeCloseTo(2 / 3, 5);
      expect(data!.symbol).toBe('AAPL');
      expect(data!.fetchedAt).toBeTruthy();
    });

    it('returns null when sentimentRatio has no tagged messages', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse({
          messages: [
            { entities: {} },
            { entities: {} },
          ],
          symbol: { watchlist_count: 0 },
        }),
      );

      const data = await client.getSymbolData('AAPL');
      expect(data).not.toBeNull();
      expect(data!.sentimentRatio).toBeNull();
    });

    it('returns null on non-OK response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse({}, false, 404),
      );

      const data = await client.getSymbolData('UNKNOWN');
      expect(data).toBeNull();
    });

    it('returns null on network error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network error'),
      );

      const data = await client.getSymbolData('AAPL');
      expect(data).toBeNull();
    });

    it('handles empty messages array', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse({
          messages: [],
          symbol: { watchlist_count: 100 },
        }),
      );

      const data = await client.getSymbolData('AAPL');
      expect(data).not.toBeNull();
      expect(data!.totalMessages).toBe(0);
      expect(data!.bullishCount).toBe(0);
      expect(data!.bearishCount).toBe(0);
      expect(data!.sentimentRatio).toBeNull();
    });

    it('handles missing messages field', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse({}),
      );

      const data = await client.getSymbolData('AAPL');
      expect(data).not.toBeNull();
      expect(data!.totalMessages).toBe(0);
      expect(data!.watchlistCount).toBe(0);
    });

    it('handles missing symbol.watchlist_count', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse({
          messages: [{ entities: { sentiment: { basic: 'Bullish' } } }],
        }),
      );

      const data = await client.getSymbolData('AAPL');
      expect(data!.watchlistCount).toBe(0);
    });

    it('encodes symbol in URL', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse({ messages: [], symbol: {} }),
      );

      await client.getSymbolData('BRK.B');

      const [calledUrl] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
      expect(calledUrl).toContain('BRK.B');
    });

    it('returns sentimentRatio 1 when all messages are bullish', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse({
          messages: [
            { entities: { sentiment: { basic: 'Bullish' } } },
            { entities: { sentiment: { basic: 'Bullish' } } },
          ],
          symbol: { watchlist_count: 0 },
        }),
      );

      const data = await client.getSymbolData('AAPL');
      expect(data!.sentimentRatio).toBe(1);
    });

    it('returns sentimentRatio 0 when all messages are bearish', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse({
          messages: [
            { entities: { sentiment: { basic: 'Bearish' } } },
            { entities: { sentiment: { basic: 'Bearish' } } },
          ],
          symbol: { watchlist_count: 0 },
        }),
      );

      const data = await client.getSymbolData('AAPL');
      expect(data!.sentimentRatio).toBe(0);
    });
  });

  describe('getBatch', () => {
    it('calls getSymbolData for each symbol', async () => {
      const spy = vi.spyOn(client, 'getSymbolData').mockResolvedValue(null);

      await client.getBatch(['AAPL', 'MSFT', 'GOOG']);
      expect(spy).toHaveBeenCalledTimes(3);
      expect(spy).toHaveBeenCalledWith('AAPL');
      expect(spy).toHaveBeenCalledWith('MSFT');
      expect(spy).toHaveBeenCalledWith('GOOG');
    });

    it('returns a Map with only non-null results', async () => {
      vi.spyOn(client, 'getSymbolData').mockImplementation(async (sym) => {
        if (sym === 'AAPL') {
          return {
            symbol: 'AAPL',
            bullishCount: 5,
            bearishCount: 2,
            totalMessages: 10,
            watchlistCount: 1000,
            sentimentRatio: 5 / 7,
            fetchedAt: new Date().toISOString(),
          };
        }
        return null;
      });

      const result = await client.getBatch(['AAPL', 'UNKNOWN']);
      expect(result.size).toBe(1);
      expect(result.has('AAPL')).toBe(true);
      expect(result.has('UNKNOWN')).toBe(false);
    });

    it('returns empty Map when all calls return null', async () => {
      vi.spyOn(client, 'getSymbolData').mockResolvedValue(null);
      const result = await client.getBatch(['AAPL', 'MSFT']);
      expect(result.size).toBe(0);
    });
  });

  describe('getStockTwitsClient', () => {
    it('returns the same singleton instance', () => {
      const a = getStockTwitsClient();
      const b = getStockTwitsClient();
      expect(a).toBe(b);
    });
  });
});
