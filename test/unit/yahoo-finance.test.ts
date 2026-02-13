import { describe, expect, it, vi, beforeEach } from 'vitest';

// Use vi.hoisted to create mock functions before vi.mock hoisting
const { mockYfQuote, mockAxiosGet } = vi.hoisted(() => ({
  mockYfQuote: vi.fn(),
  mockAxiosGet: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { get: mockAxiosGet },
}));

vi.mock('yahoo-finance2', () => {
  return {
    default: class {
      quote = mockYfQuote;
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
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          quoteSummary: {
            result: [
              {
                financialData: {
                  currentPrice: { raw: 150 },
                  revenueGrowth: { raw: 0.15 },
                  profitMargins: { raw: 0.25 },
                  operatingMargins: { raw: 0.3 },
                  debtToEquity: { raw: 1.5 },
                  currentRatio: { raw: 1.2 },
                  marketCap: { raw: 2500000000000 },
                },
                defaultKeyStatistics: {
                  trailingEps: { raw: 6.5 },
                  forwardPE: { raw: 25 },
                  enterpriseValue: { raw: 2600000000000 },
                  dividendYield: { raw: 0.005 },
                  beta: { raw: 1.2 },
                },
                summaryProfile: {
                  sector: 'Technology',
                  industry: 'Consumer Electronics',
                },
                earningsHistory: {
                  history: [{ surprisePercent: { raw: 5.2 } }],
                },
              },
            ],
          },
        },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f).not.toBeNull();
      expect(f!.peRatio).toBeCloseTo(150 / 6.5, 1);
      expect(f!.forwardPE).toBe(25);
      expect(f!.revenueGrowthYoY).toBe(0.15);
      expect(f!.profitMargin).toBe(0.25);
      expect(f!.operatingMargin).toBe(0.3);
      expect(f!.debtToEquity).toBe(1.5);
      expect(f!.currentRatio).toBe(1.2);
      expect(f!.marketCap).toBe(2600000000000);
      expect(f!.sector).toBe('Technology');
      expect(f!.industry).toBe('Consumer Electronics');
      expect(f!.earningsSurprise).toBe(5.2);
      expect(f!.dividendYield).toBe(0.005);
      expect(f!.beta).toBe(1.2);
    });

    it('returns null peRatio when trailingEps is missing', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          quoteSummary: {
            result: [
              {
                financialData: { currentPrice: { raw: 150 } },
                defaultKeyStatistics: {},
                summaryProfile: {},
              },
            ],
          },
        },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.peRatio).toBeNull();
    });

    it('returns null peRatio when currentPrice is missing', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          quoteSummary: {
            result: [
              {
                financialData: {},
                defaultKeyStatistics: { trailingEps: { raw: 5 } },
                summaryProfile: {},
              },
            ],
          },
        },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.peRatio).toBeNull();
    });

    it('handles rawVal with direct number values (not {raw} objects)', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          quoteSummary: {
            result: [
              {
                financialData: { currentPrice: 150, revenueGrowth: 0.1 },
                defaultKeyStatistics: { trailingEps: 6, forwardPE: 20 },
                summaryProfile: {},
              },
            ],
          },
        },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.peRatio).toBeCloseTo(150 / 6, 1);
      expect(f!.forwardPE).toBe(20);
      expect(f!.revenueGrowthYoY).toBe(0.1);
    });

    it('returns null when quoteSummary result is empty', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: { quoteSummary: { result: [] } },
      });

      const f = await client.getFundamentals('INVALID');
      expect(f).toBeNull();
    });

    it('returns null on error', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('API Error'));
      const f = await client.getFundamentals('AAPL');
      expect(f).toBeNull();
    });

    it('handles null earningsHistory', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          quoteSummary: {
            result: [
              {
                financialData: {},
                defaultKeyStatistics: {},
                summaryProfile: {},
                earningsHistory: null,
              },
            ],
          },
        },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.earningsSurprise).toBeNull();
    });

    it('handles empty earningsHistory.history array', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          quoteSummary: {
            result: [
              {
                financialData: {},
                defaultKeyStatistics: {},
                summaryProfile: {},
                earningsHistory: { history: [] },
              },
            ],
          },
        },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.earningsSurprise).toBeNull();
    });

    it('falls back to financialData marketCap when enterpriseValue is null', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          quoteSummary: {
            result: [
              {
                financialData: { marketCap: { raw: 1000000000 } },
                defaultKeyStatistics: {},
                summaryProfile: {},
              },
            ],
          },
        },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.marketCap).toBe(1000000000);
    });

    it('handles missing profile sector/industry', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          quoteSummary: {
            result: [
              {
                financialData: {},
                defaultKeyStatistics: {},
                summaryProfile: {},
              },
            ],
          },
        },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.sector).toBeNull();
      expect(f!.industry).toBeNull();
    });

    it('returns null for non-number, non-raw-object values via rawVal', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          quoteSummary: {
            result: [
              {
                financialData: { revenueGrowth: 'string-val' },
                defaultKeyStatistics: { forwardPE: true },
                summaryProfile: {},
              },
            ],
          },
        },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.revenueGrowthYoY).toBeNull();
      expect(f!.forwardPE).toBeNull();
    });

    it('returns null when quoteSummary itself is missing', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: {} });
      const f = await client.getFundamentals('AAPL');
      expect(f).toBeNull();
    });

    it('handles rawVal with undefined obj', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          quoteSummary: {
            result: [
              {
                summaryProfile: {},
              },
            ],
          },
        },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.profitMargin).toBeNull();
      expect(f!.forwardPE).toBeNull();
    });

    it('handles rawVal with null value for a key', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          quoteSummary: {
            result: [
              {
                financialData: { revenueGrowth: null },
                defaultKeyStatistics: { forwardPE: null },
                summaryProfile: {},
              },
            ],
          },
        },
      });

      const f = await client.getFundamentals('AAPL');
      expect(f!.revenueGrowthYoY).toBeNull();
      expect(f!.forwardPE).toBeNull();
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
      });

      const quote = await client.getQuote('AAPL');
      expect(quote).toEqual({
        price: 150,
        change: 2.5,
        changePercent: 1.7,
        volume: 50000000,
        avgVolume: 60000000,
        marketCap: 2500000000000,
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
      });
    });
  });
});
