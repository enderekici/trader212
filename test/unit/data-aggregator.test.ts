import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn(),
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

import { DataAggregator } from '../../src/data/data-aggregator.js';
import type { FinnhubClient, FinnhubQuote, EarningsEvent, InsiderTx, FinnhubNews } from '../../src/data/finnhub.js';
import type { MarketauxClient, MarketauxArticle } from '../../src/data/marketaux.js';
import type { YahooFinanceClient, OHLCVCandle, FundamentalData, MarketContext, QuoteData } from '../../src/data/yahoo-finance.js';

function createMockYahoo(): {
  getHistoricalData: ReturnType<typeof vi.fn>;
  getFundamentals: ReturnType<typeof vi.fn>;
  getMarketContext: ReturnType<typeof vi.fn>;
  getQuote: ReturnType<typeof vi.fn>;
} {
  return {
    getHistoricalData: vi.fn().mockResolvedValue([]),
    getFundamentals: vi.fn().mockResolvedValue(null),
    getMarketContext: vi.fn().mockResolvedValue({
      spyPrice: null,
      spyChange1d: null,
      vixLevel: null,
      marketTrend: 'neutral' as const,
    }),
    getQuote: vi.fn().mockResolvedValue(null),
  };
}

function createMockFinnhub(): {
  getQuote: ReturnType<typeof vi.fn>;
  getCompanyNews: ReturnType<typeof vi.fn>;
  getEarningsCalendar: ReturnType<typeof vi.fn>;
  getInsiderTransactions: ReturnType<typeof vi.fn>;
} {
  return {
    getQuote: vi.fn().mockResolvedValue(null),
    getCompanyNews: vi.fn().mockResolvedValue([]),
    getEarningsCalendar: vi.fn().mockResolvedValue([]),
    getInsiderTransactions: vi.fn().mockResolvedValue([]),
  };
}

function createMockMarketaux(): {
  getNews: ReturnType<typeof vi.fn>;
} {
  return {
    getNews: vi.fn().mockResolvedValue([]),
  };
}

describe('DataAggregator', () => {
  let aggregator: DataAggregator;
  let mockYahoo: ReturnType<typeof createMockYahoo>;
  let mockFinnhub: ReturnType<typeof createMockFinnhub>;
  let mockMarketaux: ReturnType<typeof createMockMarketaux>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockYahoo = createMockYahoo();
    mockFinnhub = createMockFinnhub();
    mockMarketaux = createMockMarketaux();
    aggregator = new DataAggregator(
      mockYahoo as unknown as YahooFinanceClient,
      mockFinnhub as unknown as FinnhubClient,
      mockMarketaux as unknown as MarketauxClient,
    );
  });

  describe('getStockData', () => {
    it('returns aggregated data from all sources', async () => {
      const candles: OHLCVCandle[] = [
        { date: '2024-01-25', open: 148, high: 152, low: 147, close: 150, volume: 50000000 },
      ];
      const finnhubQuote: FinnhubQuote = { c: 150, h: 152, l: 147, o: 148, pc: 145, t: 0 };
      const fundamentals: FundamentalData = {
        peRatio: 25, forwardPE: 22, revenueGrowthYoY: 0.1,
        profitMargin: 0.25, operatingMargin: 0.3, debtToEquity: 1.2,
        currentRatio: 1.5, marketCap: 2500000000000, sector: 'Tech',
        industry: 'Electronics', earningsSurprise: 3.0, dividendYield: 0.005, beta: 1.1,
      };
      const finnhubNews: FinnhubNews[] = [
        { id: 1, category: 'company', datetime: 1700000000, headline: 'News', image: '', related: 'AAPL', source: 'Reuters', summary: 'Sum', url: 'http://example.com' },
      ];
      const marketauxNews: MarketauxArticle[] = [
        { title: 'News', description: 'Desc', source: 'MkA', url: 'http://example.com', publishedAt: '2024-01-25', sentimentScore: 0.8, relevanceScore: 0.9 },
      ];
      const earnings: EarningsEvent[] = [
        { symbol: 'AAPL', date: '2024-02-01', epsEstimate: 2.1, epsActual: null, revenueEstimate: null, revenueActual: null, hour: 'amc', quarter: 1, year: 2024 },
        { symbol: 'MSFT', date: '2024-02-05', epsEstimate: 3.0, epsActual: null, revenueEstimate: null, revenueActual: null, hour: 'bmo', quarter: 1, year: 2024 },
      ];
      const insiders: InsiderTx[] = [
        { symbol: 'AAPL', name: 'Tim Cook', share: 1000, change: -500, filingDate: '2024-01-15', transactionDate: '2024-01-14', transactionCode: 'S', transactionPrice: 185 },
      ];
      const marketCtx: MarketContext = {
        spyPrice: 480, spyChange1d: 1.2, vixLevel: 14, marketTrend: 'bullish',
      };

      mockYahoo.getHistoricalData.mockResolvedValueOnce(candles);
      mockFinnhub.getQuote.mockResolvedValueOnce(finnhubQuote);
      mockYahoo.getFundamentals.mockResolvedValueOnce(fundamentals);
      mockFinnhub.getCompanyNews.mockResolvedValueOnce(finnhubNews);
      mockMarketaux.getNews.mockResolvedValueOnce(marketauxNews);
      mockFinnhub.getEarningsCalendar.mockResolvedValueOnce(earnings);
      mockFinnhub.getInsiderTransactions.mockResolvedValueOnce(insiders);
      mockYahoo.getMarketContext.mockResolvedValueOnce(marketCtx);

      const result = await aggregator.getStockData('AAPL');

      expect(result.symbol).toBe('AAPL');
      expect(result.candles).toEqual(candles);
      expect(result.quote).toEqual({
        price: 150,
        change: 5,
        changePercent: (5 / 145) * 100,
      });
      expect(result.fundamentals).toEqual(fundamentals);
      expect(result.finnhubNews).toEqual(finnhubNews);
      expect(result.marketauxNews).toEqual(marketauxNews);
      expect(result.earnings).toHaveLength(1);
      expect(result.earnings[0].symbol).toBe('AAPL');
      expect(result.insiderTransactions).toEqual(insiders);
      expect(result.marketContext).toEqual(marketCtx);
    });

    it('falls back to Yahoo quote when Finnhub quote fails', async () => {
      mockFinnhub.getQuote.mockResolvedValueOnce(null);
      mockYahoo.getQuote.mockResolvedValueOnce({
        price: 148,
        change: 2,
        changePercent: 1.37,
        volume: 50000000,
        avgVolume: 60000000,
        marketCap: 2500000000000,
      });

      const result = await aggregator.getStockData('AAPL');
      expect(result.quote).toEqual({
        price: 148,
        change: 2,
        changePercent: 1.37,
      });
    });

    it('falls back to Yahoo quote when Finnhub quote rejects', async () => {
      mockFinnhub.getQuote.mockRejectedValueOnce(new Error('Finnhub down'));
      mockYahoo.getQuote.mockResolvedValueOnce({
        price: 148,
        change: 2,
        changePercent: 1.37,
        volume: 50000000,
        avgVolume: 60000000,
        marketCap: null,
      });

      const result = await aggregator.getStockData('AAPL');
      expect(result.quote).toEqual({
        price: 148,
        change: 2,
        changePercent: 1.37,
      });
    });

    it('has null quote when both Finnhub and Yahoo fail', async () => {
      mockFinnhub.getQuote.mockResolvedValueOnce(null);
      mockYahoo.getQuote.mockResolvedValueOnce(null);

      const result = await aggregator.getStockData('AAPL');
      expect(result.quote).toBeNull();
    });

    it('has null quote when both Finnhub rejects and Yahoo throws', async () => {
      mockFinnhub.getQuote.mockRejectedValueOnce(new Error('fail'));
      mockYahoo.getQuote.mockRejectedValueOnce(new Error('Yahoo also fail'));

      const result = await aggregator.getStockData('AAPL');
      expect(result.quote).toBeNull();
    });

    it('handles all sources failing gracefully', async () => {
      mockYahoo.getHistoricalData.mockRejectedValueOnce(new Error('candles fail'));
      mockFinnhub.getQuote.mockRejectedValueOnce(new Error('quote fail'));
      mockYahoo.getFundamentals.mockRejectedValueOnce(new Error('fundamentals fail'));
      mockFinnhub.getCompanyNews.mockRejectedValueOnce(new Error('news fail'));
      mockMarketaux.getNews.mockRejectedValueOnce(new Error('marketaux fail'));
      mockFinnhub.getEarningsCalendar.mockRejectedValueOnce(new Error('earnings fail'));
      mockFinnhub.getInsiderTransactions.mockRejectedValueOnce(new Error('insider fail'));
      mockYahoo.getMarketContext.mockRejectedValueOnce(new Error('context fail'));
      mockYahoo.getQuote.mockRejectedValueOnce(new Error('yahoo quote fail'));

      const result = await aggregator.getStockData('AAPL');
      expect(result.symbol).toBe('AAPL');
      expect(result.candles).toEqual([]);
      expect(result.quote).toBeNull();
      expect(result.fundamentals).toBeNull();
      expect(result.finnhubNews).toEqual([]);
      expect(result.marketauxNews).toEqual([]);
      expect(result.earnings).toEqual([]);
      expect(result.insiderTransactions).toEqual([]);
      expect(result.marketContext).toEqual({
        spyPrice: null,
        spyChange1d: null,
        vixLevel: null,
        marketTrend: 'neutral',
      });
    });

    it('filters earnings to only include matching symbol', async () => {
      mockFinnhub.getEarningsCalendar.mockResolvedValueOnce([
        { symbol: 'AAPL', date: '2024-02-01', epsEstimate: 2.1, epsActual: null, revenueEstimate: null, revenueActual: null, hour: 'amc', quarter: 1, year: 2024 },
        { symbol: 'MSFT', date: '2024-02-05', epsEstimate: 3.0, epsActual: null, revenueEstimate: null, revenueActual: null, hour: 'bmo', quarter: 1, year: 2024 },
        { symbol: 'AAPL', date: '2024-05-01', epsEstimate: 1.5, epsActual: null, revenueEstimate: null, revenueActual: null, hour: 'amc', quarter: 2, year: 2024 },
      ]);

      const result = await aggregator.getStockData('AAPL');
      expect(result.earnings).toHaveLength(2);
      expect(result.earnings.every((e) => e.symbol === 'AAPL')).toBe(true);
    });

    it('calculates changePercent as 0 when previous close is 0', async () => {
      mockFinnhub.getQuote.mockResolvedValueOnce({ c: 10, h: 11, l: 9, o: 10, pc: 0, t: 0 });

      const result = await aggregator.getStockData('AAPL');
      expect(result.quote?.changePercent).toBe(0);
    });
  });

  describe('getQuote', () => {
    it('returns Finnhub quote when available', async () => {
      mockFinnhub.getQuote.mockResolvedValueOnce({ c: 150, h: 155, l: 148, o: 149, pc: 145, t: 0 });

      const result = await aggregator.getQuote('AAPL');
      expect(result).toEqual({ price: 150, change: 5 });
    });

    it('falls back to Yahoo when Finnhub returns null', async () => {
      mockFinnhub.getQuote.mockResolvedValueOnce(null);
      mockYahoo.getQuote.mockResolvedValueOnce({
        price: 148,
        change: 2,
        changePercent: 1.37,
        volume: 50000000,
        avgVolume: 60000000,
        marketCap: null,
      });

      const result = await aggregator.getQuote('AAPL');
      expect(result).toEqual({ price: 148, change: 2 });
    });

    it('falls back to Yahoo when Finnhub throws', async () => {
      mockFinnhub.getQuote.mockRejectedValueOnce(new Error('Finnhub down'));
      mockYahoo.getQuote.mockResolvedValueOnce({
        price: 148,
        change: 2,
        changePercent: 1.37,
        volume: 50000000,
        avgVolume: 60000000,
        marketCap: null,
      });

      const result = await aggregator.getQuote('AAPL');
      expect(result).toEqual({ price: 148, change: 2 });
    });

    it('falls back to Yahoo when Finnhub returns c=0', async () => {
      mockFinnhub.getQuote.mockResolvedValueOnce({ c: 0, h: 0, l: 0, o: 0, pc: 0, t: 0 });
      mockYahoo.getQuote.mockResolvedValueOnce({
        price: 148,
        change: 2,
        changePercent: 1.37,
        volume: 50000000,
        avgVolume: 60000000,
        marketCap: null,
      });

      const result = await aggregator.getQuote('AAPL');
      expect(result).toEqual({ price: 148, change: 2 });
    });

    it('throws when both sources fail', async () => {
      mockFinnhub.getQuote.mockResolvedValueOnce(null);
      mockYahoo.getQuote.mockResolvedValueOnce(null);

      await expect(aggregator.getQuote('AAPL')).rejects.toThrow(
        'Unable to get quote for AAPL from any source',
      );
    });
  });

  describe('getMarketContext', () => {
    it('delegates to Yahoo', async () => {
      const ctx: MarketContext = {
        spyPrice: 480, spyChange1d: 1.0, vixLevel: 15, marketTrend: 'bullish',
      };
      mockYahoo.getMarketContext.mockResolvedValueOnce(ctx);

      const result = await aggregator.getMarketContext();
      expect(result).toEqual(ctx);
      expect(mockYahoo.getMarketContext).toHaveBeenCalled();
    });
  });

  describe('fundamental caching', () => {
    it('caches fundamentals and returns cached value on second call', async () => {
      const fundamentals: FundamentalData = {
        peRatio: 25, forwardPE: 22, revenueGrowthYoY: 0.1,
        profitMargin: 0.25, operatingMargin: 0.3, debtToEquity: 1.2,
        currentRatio: 1.5, marketCap: 2500000000000, sector: 'Tech',
        industry: 'Electronics', earningsSurprise: 3.0, dividendYield: 0.005, beta: 1.1,
      };
      mockYahoo.getFundamentals.mockResolvedValue(fundamentals);

      // First call
      await aggregator.getStockData('AAPL');
      expect(mockYahoo.getFundamentals).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await aggregator.getStockData('AAPL');
      expect(mockYahoo.getFundamentals).toHaveBeenCalledTimes(1);
    });

    it('does not cache null fundamentals', async () => {
      mockYahoo.getFundamentals.mockResolvedValue(null);

      await aggregator.getStockData('AAPL');
      await aggregator.getStockData('AAPL');
      expect(mockYahoo.getFundamentals).toHaveBeenCalledTimes(2);
    });

    it('refreshes cache after TTL expires', async () => {
      const fundamentals: FundamentalData = {
        peRatio: 25, forwardPE: 22, revenueGrowthYoY: 0.1,
        profitMargin: 0.25, operatingMargin: 0.3, debtToEquity: 1.2,
        currentRatio: 1.5, marketCap: 2500000000000, sector: 'Tech',
        industry: 'Electronics', earningsSurprise: 3.0, dividendYield: 0.005, beta: 1.1,
      };
      mockYahoo.getFundamentals.mockResolvedValue(fundamentals);

      // First call
      await aggregator.getStockData('AAPL');
      expect(mockYahoo.getFundamentals).toHaveBeenCalledTimes(1);

      // Manipulate cache to be expired
      const cache = (aggregator as unknown as { fundamentalCache: Map<string, { data: FundamentalData; expiresAt: number }> }).fundamentalCache;
      const entry = cache.get('AAPL');
      if (entry) {
        entry.expiresAt = Date.now() - 1;
      }

      // Second call - cache expired, should fetch again
      await aggregator.getStockData('AAPL');
      expect(mockYahoo.getFundamentals).toHaveBeenCalledTimes(2);
    });
  });
});
