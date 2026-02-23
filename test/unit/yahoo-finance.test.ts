import { describe, expect, it, vi, beforeEach } from 'vitest';

// Use vi.hoisted to create mock functions before vi.mock hoisting
const { mockYfQuote, mockYfQuoteSummary, mockAxiosGet } = vi.hoisted(() => ({
  mockYfQuote: vi.fn(),
  mockYfQuoteSummary: vi.fn(),
  mockAxiosGet: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { get: mockAxiosGet },
}));

vi.mock('yahoo-finance2', () => {
  return {
    default: class {
      quote = mockYfQuote;
      quoteSummary = mockYfQuoteSummary;
    },
  };
});

vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn((key: string) => {
      if (key === 'analysis.historicalDays') return 90;
      return null;
    }),
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

import { YahooFinanceClient } from '../../src/data/yahoo-finance.js';

describe('YahooFinanceClient', () => {
  let client: YahooFinanceClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new YahooFinanceClient();
  });

  describe('getHistoricalData', () => {
    it('returns candles from Yahoo Chart API', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          chart: {
            result: [
              {
                timestamp: [1700000000, 1700086400],
                indicators: {
                  quote: [
                    {
                      open: [150, 152],
                      high: [155, 158],
                      low: [149, 151],
                      close: [154, 157],
                      volume: [1000000, 1200000],
                    },
                  ],
                },
              },
            ],
          },
        },
      });

      const candles = await client.getHistoricalData('AAPL');
      expect(candles).toHaveLength(2);
      expect(candles[0]).toEqual({
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        open: 150,
        high: 155,
        low: 149,
        close: 154,
        volume: 1000000,
      });
    });

    it('uses custom days parameter instead of config default', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          chart: {
            result: [
              {
                timestamp: [1700000000],
                indicators: {
                  quote: [{ open: [100], high: [105], low: [95], close: [103], volume: [500000] }],
                },
              },
            ],
          },
        },
      });

      await client.getHistoricalData('AAPL', 30);
      const call = mockAxiosGet.mock.calls[0];
      expect(call[0]).toContain('AAPL');
    });

    it('returns empty array when result is undefined', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: { chart: { result: [] } },
      });

      const candles = await client.getHistoricalData('INVALID');
      expect(candles).toEqual([]);
    });

    it('returns empty array when result has no timestamp', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: { chart: { result: [{ indicators: { quote: [{}] } }] } },
      });

      const candles = await client.getHistoricalData('AAPL');
      expect(candles).toEqual([]);
    });

    it('returns empty array when result has no quote indicator', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: { chart: { result: [{ timestamp: [1700000000], indicators: {} }] } },
      });

      const candles = await client.getHistoricalData('AAPL');
      expect(candles).toEqual([]);
    });

    it('skips candles where open is null', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          chart: {
            result: [
              {
                timestamp: [1700000000, 1700086400],
                indicators: {
                  quote: [
                    {
                      open: [null, 152],
                      high: [null, 158],
                      low: [null, 151],
                      close: [154, 157],
                      volume: [null, 1200000],
                    },
                  ],
                },
              },
            ],
          },
        },
      });

      const candles = await client.getHistoricalData('AAPL');
      expect(candles).toHaveLength(1);
      expect(candles[0].open).toBe(152);
    });

    it('skips candles where close is null', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          chart: {
            result: [
              {
                timestamp: [1700000000],
                indicators: {
                  quote: [{ open: [150], high: [155], low: [149], close: [null], volume: [1000000] }],
                },
              },
            ],
          },
        },
      });

      const candles = await client.getHistoricalData('AAPL');
      expect(candles).toHaveLength(0);
    });

    it('uses open as fallback for null high and low', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          chart: {
            result: [
              {
                timestamp: [1700000000],
                indicators: {
                  quote: [{ open: [150], high: [null], low: [null], close: [155], volume: [1000000] }],
                },
              },
            ],
          },
        },
      });

      const candles = await client.getHistoricalData('AAPL');
      expect(candles[0].high).toBe(150);
      expect(candles[0].low).toBe(150);
    });

    it('uses 0 as fallback for null volume', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          chart: {
            result: [
              {
                timestamp: [1700000000],
                indicators: {
                  quote: [{ open: [150], high: [155], low: [149], close: [154], volume: [null] }],
                },
              },
            ],
          },
        },
      });

      const candles = await client.getHistoricalData('AAPL');
      expect(candles[0].volume).toBe(0);
    });

    it('returns empty array on network error', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('Network Error'));
      const candles = await client.getHistoricalData('AAPL');
      expect(candles).toEqual([]);
    });

    it('returns empty array when data is null', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: null });
      const candles = await client.getHistoricalData('AAPL');
      expect(candles).toEqual([]);
    });
  });

  describe('getFundamentals', () => {
    it('returns fundamental data from quoteSummary', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: {
          currentPrice: { raw: 150 },
          revenueGrowth: { raw: 0.15 },
          profitMargins: { raw: 0.25 },
          operatingMargins: { raw: 0.3 },
          debtToEquity: { raw: 1.5 },
          currentRatio: { raw: 1.2 },
          marketCap: { raw: 2500000000000 },
          targetMeanPrice: { raw: 200 },
          recommendationKey: 'buy',
          numberOfAnalystOpinions: { raw: 42 },
          returnOnEquity: { raw: 0.25 },
          returnOnAssets: { raw: 0.1 },
          freeCashflow: { raw: 80000000000 },
        },
        defaultKeyStatistics: {
          trailingEps: { raw: 6.5 },
          forwardPE: { raw: 25 },
          enterpriseValue: { raw: 2600000000000 },
          dividendYield: { raw: 0.005 },
          beta: { raw: 1.2 },
          shortPercentOfFloat: { raw: 0.007 },
          heldPercentInstitutions: { raw: 0.6 },
          pegRatio: { raw: 1.8 },
        },
        summaryDetail: {
          trailingPE: { raw: 28.5 },
          marketCap: { raw: 2500000000000 },
        },
        summaryProfile: {
          sector: 'Technology',
          industry: 'Consumer Electronics',
        },
        earningsHistory: {
          history: [{ surprisePercent: { raw: 5.2 } }],
        },
        recommendationTrend: {
          trend: [
            { strongBuy: 10, buy: 15, hold: 8, sell: 3, strongSell: 1 },
          ],
        },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f).not.toBeNull();
      // P/E should now come from summaryDetail.trailingPE, not computed
      expect(f!.peRatio).toBe(28.5);
      expect(f!.forwardPE).toBe(25);
      expect(f!.revenueGrowthYoY).toBe(0.15);
      expect(f!.profitMargin).toBe(0.25);
      expect(f!.operatingMargin).toBe(0.3);
      expect(f!.debtToEquity).toBe(1.5);
      expect(f!.currentRatio).toBe(1.2);
      // marketCap from summaryDetail, not enterpriseValue
      expect(f!.marketCap).toBe(2500000000000);
      expect(f!.sector).toBe('Technology');
      expect(f!.industry).toBe('Consumer Electronics');
      expect(f!.earningsSurprise).toBe(5.2);
      expect(f!.dividendYield).toBe(0.005);
      expect(f!.beta).toBe(1.2);
      // New fields
      expect(f!.analystTargetPrice).toBe(200);
      expect(f!.analystConsensus).toBe('buy');
      expect(f!.analystCount).toBe(42);
      expect(f!.shortInterestPct).toBeCloseTo(0.7, 3);
      expect(f!.institutionalOwnershipPct).toBeCloseTo(60, 1);
      expect(f!.pegRatio).toBe(1.8);
      expect(f!.roe).toBeCloseTo(25, 1);
      expect(f!.roa).toBeCloseTo(10, 1);
      expect(f!.freeCashflow).toBe(80000000000);
      expect(f!.analystBuy).toBe(25); // strongBuy(10) + buy(15)
      expect(f!.analystSell).toBe(4);  // strongSell(1) + sell(3)
    });

    it('P/E uses summaryDetail.trailingPE, not currentPrice/trailingEPS computation', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: { currentPrice: { raw: 100 } },
        defaultKeyStatistics: { trailingEps: { raw: 5 } }, // 100/5 = 20 (old behavior)
        summaryDetail: { trailingPE: { raw: 18 } }, // correct value
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      // Should use summaryDetail.trailingPE (18), NOT computed value (20)
      expect(f!.peRatio).toBe(18);
    });

    it('marketCap uses summaryDetail.marketCap, not enterpriseValue', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: {},
        defaultKeyStatistics: { enterpriseValue: { raw: 999999999999 } }, // old wrong source
        summaryDetail: { marketCap: { raw: 500000000000 } }, // correct source
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.marketCap).toBe(500000000000);
    });

    it('falls back to price.marketCap when summaryDetail.marketCap is missing', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: {},
        defaultKeyStatistics: {},
        summaryDetail: {}, // no marketCap
        price: { marketCap: { raw: 300000000000 } },
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.marketCap).toBe(300000000000);
    });

    it('returns null peRatio when summaryDetail is missing', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: { currentPrice: { raw: 150 } },
        defaultKeyStatistics: {},
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.peRatio).toBeNull();
    });

    it('shortInterestPct multiplied by 100', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: {},
        defaultKeyStatistics: { shortPercentOfFloat: { raw: 0.05 } }, // 5%
        summaryDetail: {},
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.shortInterestPct).toBeCloseTo(5, 3);
    });

    it('institutionalOwnershipPct multiplied by 100', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: {},
        defaultKeyStatistics: { heldPercentInstitutions: { raw: 0.75 } }, // 75%
        summaryDetail: {},
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.institutionalOwnershipPct).toBeCloseTo(75, 3);
    });

    it('roe and roa multiplied by 100', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: {
          returnOnEquity: { raw: 0.35 },
          returnOnAssets: { raw: 0.08 },
        },
        defaultKeyStatistics: {},
        summaryDetail: {},
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.roe).toBeCloseTo(35, 3);
      expect(f!.roa).toBeCloseTo(8, 3);
    });

    it('analystBuy and analystSell from recommendationTrend', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: {},
        defaultKeyStatistics: {},
        summaryDetail: {},
        summaryProfile: {},
        recommendationTrend: {
          trend: [
            { strongBuy: 5, buy: 10, hold: 8, sell: 2, strongSell: 1 },
          ],
        },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.analystBuy).toBe(15); // 5 + 10
      expect(f!.analystSell).toBe(3);  // 2 + 1
    });

    it('analystBuy and analystSell default missing trend fields to 0 via ?? 0 (lines 171-174)', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: {},
        defaultKeyStatistics: {},
        summaryDetail: {},
        summaryProfile: {},
        recommendationTrend: {
          trend: [
            // All four fields missing: strongBuy, buy, strongSell, sell are undefined
            // Each resolves via `?? 0` fallback to 0
            { hold: 8 },
          ],
        },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.analystBuy).toBe(0);   // (undefined ?? 0) + (undefined ?? 0) = 0 + 0
      expect(f!.analystSell).toBe(0);  // (undefined ?? 0) + (undefined ?? 0) = 0 + 0
    });

    it('analystBuy and analystSell are null when no recommendationTrend', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: {},
        defaultKeyStatistics: {},
        summaryDetail: {},
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.analystBuy).toBeNull();
      expect(f!.analystSell).toBeNull();
    });

    it('handles rawVal with direct number values (not {raw} objects)', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: { currentPrice: 150, revenueGrowth: 0.1 },
        defaultKeyStatistics: { trailingEps: 6, forwardPE: 20 },
        summaryDetail: { trailingPE: 22 },
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.peRatio).toBe(22);
      expect(f!.forwardPE).toBe(20);
      expect(f!.revenueGrowthYoY).toBe(0.1);
    });

    it('returns null when quoteSummary result is empty', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce(null);

      const f = await client.getFundamentals('INVALID');
      expect(f).toBeNull();
    });

    it('returns null on error', async () => {
      mockYfQuoteSummary.mockRejectedValueOnce(new Error('API Error'));
      const f = await client.getFundamentals('AAPL');
      expect(f).toBeNull();
    });

    it('handles null earningsHistory', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: {},
        defaultKeyStatistics: {},
        summaryDetail: {},
        summaryProfile: {},
        earningsHistory: null,
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.earningsSurprise).toBeNull();
    });

    it('handles empty earningsHistory.history array', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: {},
        defaultKeyStatistics: {},
        summaryDetail: {},
        summaryProfile: {},
        earningsHistory: { history: [] },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.earningsSurprise).toBeNull();
    });

    it('falls back to financialData marketCap when summaryDetail and price are missing', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: { marketCap: { raw: 1000000000 } },
        defaultKeyStatistics: {},
        summaryDetail: {},
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      // summaryDetail.marketCap is undefined -> falls back to price.marketCap (also missing) -> null
      expect(f!.marketCap).toBeNull();
    });

    it('handles missing profile sector/industry', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: {},
        defaultKeyStatistics: {},
        summaryDetail: {},
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.sector).toBeNull();
      expect(f!.industry).toBeNull();
    });

    it('returns null when quoteSummary itself is missing', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce(null);
      const f = await client.getFundamentals('AAPL');
      expect(f).toBeNull();
    });

    it('handles rawVal with undefined obj', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        summaryDetail: {},
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.profitMargin).toBeNull();
      expect(f!.forwardPE).toBeNull();
    });

    it('handles rawVal with null value for a key', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: { revenueGrowth: null },
        defaultKeyStatistics: { forwardPE: null },
        summaryDetail: {},
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.revenueGrowthYoY).toBeNull();
      expect(f!.forwardPE).toBeNull();
    });

    it('new fields are null-safe when data is missing', async () => {
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: {},
        defaultKeyStatistics: {},
        summaryDetail: {},
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.analystTargetPrice).toBeNull();
      expect(f!.analystConsensus).toBeNull();
      expect(f!.analystCount).toBeNull();
      expect(f!.shortInterestPct).toBeNull();
      expect(f!.institutionalOwnershipPct).toBeNull();
      expect(f!.pegRatio).toBeNull();
      expect(f!.roe).toBeNull();
      expect(f!.roa).toBeNull();
      expect(f!.freeCashflow).toBeNull();
      expect(f!.analystBuy).toBeNull();
      expect(f!.analystSell).toBeNull();
    });
  });

  describe('getMarketContext', () => {
    it('returns bullish context when spy is up and vix is low', async () => {
      mockYfQuote
        .mockResolvedValueOnce({
          regularMarketPrice: 450,
          regularMarketChangePercent: 1.5,
        })
        .mockResolvedValueOnce({
          regularMarketPrice: 15,
        });

      const ctx = await client.getMarketContext();
      expect(ctx.spyPrice).toBe(450);
      expect(ctx.spyChange1d).toBe(1.5);
      expect(ctx.vixLevel).toBe(15);
      expect(ctx.marketTrend).toBe('bullish');
    });

    it('returns bearish context when spy is down', async () => {
      mockYfQuote
        .mockResolvedValueOnce({
          regularMarketPrice: 420,
          regularMarketChangePercent: -1.0,
        })
        .mockResolvedValueOnce({
          regularMarketPrice: 25,
        });

      const ctx = await client.getMarketContext();
      expect(ctx.marketTrend).toBe('bearish');
    });

    it('returns bearish context when vix is above 30', async () => {
      mockYfQuote
        .mockResolvedValueOnce({
          regularMarketPrice: 440,
          regularMarketChangePercent: 0.2,
        })
        .mockResolvedValueOnce({
          regularMarketPrice: 35,
        });

      const ctx = await client.getMarketContext();
      expect(ctx.marketTrend).toBe('bearish');
    });

    it('returns neutral context when spy change and vix are moderate', async () => {
      mockYfQuote
        .mockResolvedValueOnce({
          regularMarketPrice: 440,
          regularMarketChangePercent: 0.2,
        })
        .mockResolvedValueOnce({
          regularMarketPrice: 22,
        });

      const ctx = await client.getMarketContext();
      expect(ctx.marketTrend).toBe('neutral');
    });

    it('returns neutral when SPY quote fails', async () => {
      mockYfQuote
        .mockRejectedValueOnce(new Error('SPY failed'))
        .mockResolvedValueOnce({ regularMarketPrice: 20 });

      const ctx = await client.getMarketContext();
      expect(ctx.spyPrice).toBeNull();
      expect(ctx.marketTrend).toBe('neutral');
    });

    it('returns neutral when VIX quote fails', async () => {
      mockYfQuote
        .mockResolvedValueOnce({
          regularMarketPrice: 450,
          regularMarketChangePercent: 1.0,
        })
        .mockRejectedValueOnce(new Error('VIX failed'));

      const ctx = await client.getMarketContext();
      expect(ctx.vixLevel).toBeNull();
      expect(ctx.marketTrend).toBe('neutral');
    });

    it('handles null SPY result', async () => {
      mockYfQuote
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ regularMarketPrice: 20 });

      const ctx = await client.getMarketContext();
      expect(ctx.spyPrice).toBeNull();
    });

    it('handles null VIX result', async () => {
      mockYfQuote
        .mockResolvedValueOnce({ regularMarketPrice: 450, regularMarketChangePercent: 1 })
        .mockResolvedValueOnce(null);

      const ctx = await client.getMarketContext();
      expect(ctx.vixLevel).toBeNull();
    });

    it('handles missing regularMarketPrice on SPY', async () => {
      mockYfQuote
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ regularMarketPrice: 20 });

      const ctx = await client.getMarketContext();
      expect(ctx.spyPrice).toBeNull();
    });

    it('handles missing regularMarketPrice on VIX', async () => {
      mockYfQuote
        .mockResolvedValueOnce({ regularMarketPrice: 450, regularMarketChangePercent: 0.3 })
        .mockResolvedValueOnce({}); // VIX result with no regularMarketPrice

      const ctx = await client.getMarketContext();
      expect(ctx.vixLevel).toBeNull();
    });

    it('catches synchronous errors in the try block and returns default context', async () => {
      // Make yf.quote throw synchronously to trigger the outer catch block
      mockYfQuote.mockImplementation(() => {
        throw new Error('Synchronous error');
      });

      const ctx = await client.getMarketContext();
      expect(ctx).toEqual({
        spyPrice: null,
        spyChange1d: null,
        vixLevel: null,
        marketTrend: 'neutral',
        vixTermStructure: null,
      });
    });
  });

  describe('getQuote', () => {
    it('returns quote data from yahoo-finance2', async () => {
      mockYfQuote.mockResolvedValueOnce({
        regularMarketPrice: 150,
        regularMarketChange: 2.5,
        regularMarketChangePercent: 1.7,
        regularMarketVolume: 50000000,
        averageDailyVolume3Month: 60000000,
        marketCap: 2500000000000,
        regularMarketDayHigh: 152,
        regularMarketDayLow: 148,
      });

      const quote = await client.getQuote('AAPL');
      expect(quote).toEqual({
        price: 150,
        change: 2.5,
        changePercent: 1.7,
        volume: 50000000,
        avgVolume: 60000000,
        marketCap: 2500000000000,
        dayHigh: 152,
        dayLow: 148,
      });
    });

    it('returns null when result is null', async () => {
      mockYfQuote.mockResolvedValueOnce(null);
      const quote = await client.getQuote('AAPL');
      expect(quote).toBeNull();
    });

    it('returns null on error', async () => {
      mockYfQuote.mockRejectedValueOnce(new Error('Quote failed'));
      const quote = await client.getQuote('AAPL');
      expect(quote).toBeNull();
    });

    it('uses defaults for missing fields', async () => {
      mockYfQuote.mockResolvedValueOnce({});
      const quote = await client.getQuote('AAPL');
      expect(quote).toEqual({
        price: 0,
        change: 0,
        changePercent: 0,
        volume: 0,
        avgVolume: 0,
        marketCap: null,
        dayHigh: null,
        dayLow: null,
      });
    });
  });

  describe('getIntradayCandles', () => {
    const makeChartResponse = (candles: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>) => ({
      data: {
        chart: {
          result: [
            {
              timestamp: candles.map((c) => c.t),
              indicators: {
                quote: [
                  {
                    open: candles.map((c) => c.o),
                    high: candles.map((c) => c.h),
                    low: candles.map((c) => c.l),
                    close: candles.map((c) => c.c),
                    volume: candles.map((c) => c.v),
                  },
                ],
              },
            },
          ],
        },
      },
    });

    it('returns parsed candles with ISO timestamps', async () => {
      const ts = 1700000000; // some unix timestamp
      mockAxiosGet.mockResolvedValueOnce(
        makeChartResponse([
          { t: ts, o: 100, h: 105, l: 99, c: 103, v: 1000000 },
          { t: ts + 300, o: 103, h: 108, l: 102, c: 106, v: 1200000 },
        ]),
      );

      const candles = await client.getIntradayCandles('AAPL');
      expect(candles).toHaveLength(2);
      expect(candles[0]).toEqual({
        date: new Date(ts * 1000).toISOString(),
        open: 100,
        high: 105,
        low: 99,
        close: 103,
        volume: 1000000,
      });
      expect(candles[1].open).toBe(103);
      expect(candles[1].close).toBe(106);
    });

    it('skips candles where open or close is null', async () => {
      const ts = 1700000000;
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          chart: {
            result: [
              {
                timestamp: [ts, ts + 300, ts + 600],
                indicators: {
                  quote: [
                    {
                      open: [null, 103, 106],
                      high: [105, 108, 110],
                      low: [99, 102, 104],
                      close: [103, null, 108],
                      volume: [1000000, 1200000, 900000],
                    },
                  ],
                },
              },
            ],
          },
        },
      });

      const candles = await client.getIntradayCandles('AAPL');
      // first skipped (open null), second skipped (close null), third ok
      expect(candles).toHaveLength(1);
      expect(candles[0].open).toBe(106);
    });

    it('uses open as fallback for null high/low', async () => {
      const ts = 1700000000;
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          chart: {
            result: [
              {
                timestamp: [ts],
                indicators: {
                  quote: [
                    {
                      open: [100],
                      high: [null],
                      low: [null],
                      close: [102],
                      volume: [null],
                    },
                  ],
                },
              },
            ],
          },
        },
      });

      const candles = await client.getIntradayCandles('AAPL');
      expect(candles).toHaveLength(1);
      expect(candles[0].high).toBe(100); // fallback to open
      expect(candles[0].low).toBe(100);  // fallback to open
      expect(candles[0].volume).toBe(0); // fallback to 0
    });

    it('returns empty array when chart result is missing', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { chart: { result: null } } });
      const candles = await client.getIntradayCandles('AAPL');
      expect(candles).toEqual([]);
    });

    it('returns empty array when timestamp array is absent', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          chart: {
            result: [{ indicators: { quote: [{}] } }],
          },
        },
      });
      const candles = await client.getIntradayCandles('AAPL');
      expect(candles).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('Network error'));
      const candles = await client.getIntradayCandles('AAPL');
      expect(candles).toEqual([]);
    });
  });

  describe('getFundamentals - rawVal object without raw key', () => {
    it('returns null when value is an object without a raw key', async () => {
      // The rawVal helper returns null for objects that don't have 'raw' key (line 156)
      mockYfQuoteSummary.mockResolvedValueOnce({
        financialData: {
          // Pass an object without a 'raw' key — should fall through to return null
          revenueGrowth: { notRaw: 0.2 },
          profitMargins: { someOtherKey: 0.3 },
        },
        defaultKeyStatistics: {
          forwardPE: { anotherKey: 25 },
        },
        summaryDetail: {},
        summaryProfile: {},
      });

      const f = await client.getFundamentals('AAPL');
      expect(f).not.toBeNull();
      // All fields that used rawVal with non-raw objects should be null
      expect(f!.revenueGrowthYoY).toBeNull();
      expect(f!.profitMargin).toBeNull();
      expect(f!.forwardPE).toBeNull();
    });
  });
});
