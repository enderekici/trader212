import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { OHLCVCandle, FundamentalData } from '../../src/data/yahoo-finance.js';
import type { FinnhubNews, InsiderTx, EarningsEvent } from '../../src/data/finnhub.js';
import type { MarketauxArticle } from '../../src/data/marketaux.js';
import type { StockData, DataAggregator } from '../../src/data/data-aggregator.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock configManager
vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn((key: string) => {
      const defaults: Record<string, unknown> = {
        'analysis.rsi.period': 14,
        'analysis.macd.fast': 12,
        'analysis.macd.slow': 26,
        'analysis.macd.signal': 9,
        'analysis.bb.period': 20,
        'analysis.bb.stdDev': 2,
        'analysis.atr.period': 14,
        'analysis.adx.period': 14,
        'analysis.stochastic.kPeriod': 14,
        'analysis.stochastic.dPeriod': 3,
        'analysis.cci.period': 20,
        'analysis.mfi.period': 14,
        'analysis.roc.period': 12,
        'analysis.supportResistance.lookback': 20,
        'ai.historicalSignalCount': 5,
      };
      return defaults[key] ?? 14;
    }),
  },
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Configurable mock data for historical signals
let mockHistoricalSignals: Array<Record<string, unknown>> = [];

// Mock the database
vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              all: () => mockHistoricalSignals,
            }),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        run: vi.fn(),
      }),
    }),
  }),
}));

vi.mock('../../src/db/schema.js', () => ({
  signals: {},
}));

vi.mock('drizzle-orm', () => ({
  desc: vi.fn((col: unknown) => col),
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

import { analyzeStock } from '../../src/analysis/analyzer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateCandles(n: number, startPrice = 100): OHLCVCandle[] {
  const candles: OHLCVCandle[] = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    const change = Math.sin(i * 0.3) * 2 + Math.cos(i * 0.17) * 1.5;
    price = Math.max(1, price + change);
    const high = Math.max(price, price - change * 0.3) + Math.abs(change) * 0.5 + 0.5;
    const low = Math.min(price, price - change * 0.3) - Math.abs(change) * 0.5 - 0.5;

    candles.push({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: +(price - change * 0.3).toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +price.toFixed(2),
      volume: 1_000_000,
    });
  }
  return candles;
}

function createMockDataAggregator(stockData: StockData): DataAggregator {
  return {
    getStockData: vi.fn().mockResolvedValue(stockData),
    getQuote: vi.fn(),
    getMarketContext: vi.fn(),
  } as unknown as DataAggregator;
}

function makeStockData(overrides: Partial<StockData> = {}): StockData {
  return {
    symbol: 'AAPL',
    candles: generateCandles(250),
    quote: { price: 150, change: 2.5, changePercent: 1.7 },
    fundamentals: {
      peRatio: 15,
      forwardPE: 12,
      revenueGrowthYoY: 0.2,
      profitMargin: 0.25,
      operatingMargin: 0.3,
      debtToEquity: 0.5,
      currentRatio: 2.0,
      marketCap: 2.5e12,
      sector: 'Technology',
      industry: 'Consumer Electronics',
      earningsSurprise: 0.05,
      dividendYield: 0.005,
      beta: 1.2,
    },
    finnhubNews: [],
    marketauxNews: [],
    earnings: [],
    insiderTransactions: [],
    marketContext: { spyPrice: 500, spyChange1d: 0.3, vixLevel: 15, marketTrend: 'neutral' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Analyzer - analyzeStock', () => {
  beforeEach(() => {
    mockHistoricalSignals = [];
  });

  it('returns null when no quote data is available', async () => {
    const stockData = makeStockData({ quote: null });
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);
    expect(result).toBeNull();
  });

  it('returns null when candles array is empty', async () => {
    const stockData = makeStockData({ candles: [] });
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);
    expect(result).toBeNull();
  });

  it('returns full analysis with valid data', async () => {
    const stockData = makeStockData();
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);

    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('AAPL');
    expect(result!.price).toBe(150);
    expect(result!.technical).toBeDefined();
    expect(result!.fundamental).toBeDefined();
    expect(result!.sentiment).toBeDefined();
    expect(result!.historicalSignals).toBeDefined();
    expect(result!.data).toBeDefined();
    expect(result!.timestamp).toBeDefined();
  });

  it('returns fundamental as null when no fundamentals data', async () => {
    const stockData = makeStockData({ fundamentals: null });
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);

    expect(result).not.toBeNull();
    expect(result!.fundamental).toBeNull();
  });

  it('includes technical scores in the result', async () => {
    const stockData = makeStockData();
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);

    expect(result!.technical.score).toBeGreaterThanOrEqual(0);
    expect(result!.technical.score).toBeLessThanOrEqual(100);
  });

  it('includes sentiment scores in the result', async () => {
    const stockData = makeStockData({
      marketauxNews: [
        {
          title: 'Positive news',
          description: 'Great earnings report',
          source: 'Reuters',
          url: 'https://example.com',
          publishedAt: new Date().toISOString(),
          sentimentScore: 0.8,
          relevanceScore: 0.9,
        },
      ],
    });
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);

    expect(result!.sentiment.score).toBeGreaterThanOrEqual(0);
    expect(result!.sentiment.score).toBeLessThanOrEqual(100);
    expect(result!.sentiment.articles).toHaveLength(1);
  });

  it('passes insider transactions to sentiment analysis', async () => {
    const stockData = makeStockData({
      insiderTransactions: [
        {
          symbol: 'AAPL',
          name: 'Tim Cook',
          share: 1000,
          change: 5000,
          filingDate: '2024-01-15',
          transactionDate: '2024-01-14',
          transactionCode: 'P',
          transactionPrice: 150,
        },
      ],
    });
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);

    expect(result!.sentiment.insiderNetBuying).toBe(5000);
  });

  it('passes earnings to sentiment analysis', async () => {
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const stockData = makeStockData({
      earnings: [
        {
          symbol: 'AAPL',
          date: futureDate.toISOString(),
          epsEstimate: 1.5,
          epsActual: null,
          revenueEstimate: 1e9,
          revenueActual: null,
          hour: 'amc',
          quarter: 1,
          year: 2024,
        },
      ],
    });
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);

    expect(result!.sentiment.daysToEarnings).not.toBeNull();
    expect(result!.sentiment.daysToEarnings).toBeGreaterThanOrEqual(13);
    expect(result!.sentiment.daysToEarnings).toBeLessThanOrEqual(15);
  });

  it('calls dataAggregator.getStockData with the correct symbol', async () => {
    const stockData = makeStockData();
    const aggregator = createMockDataAggregator(stockData);
    await analyzeStock('TSLA', aggregator);

    expect(aggregator.getStockData).toHaveBeenCalledWith('TSLA');
  });

  it('returns historicalSignals as an array', async () => {
    const stockData = makeStockData();
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);

    expect(Array.isArray(result!.historicalSignals)).toBe(true);
  });

  it('includes the original StockData in the result', async () => {
    const stockData = makeStockData();
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);

    expect(result!.data).toBe(stockData);
  });

  // ── Historical signals mapping (lines 74-80) ───────────────────────────

  it('maps historical signals with all fields present', async () => {
    mockHistoricalSignals = [
      {
        timestamp: '2024-01-10T00:00:00Z',
        technicalScore: 65,
        sentimentScore: 70,
        fundamentalScore: 60,
        decision: 'BUY',
        rsi: 45,
        macdHistogram: 1.5,
      },
    ];
    const stockData = makeStockData();
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);

    expect(result!.historicalSignals).toHaveLength(1);
    const signal = result!.historicalSignals[0];
    expect(signal.timestamp).toBe('2024-01-10T00:00:00Z');
    expect(signal.technicalScore).toBe(65);
    expect(signal.sentimentScore).toBe(70);
    expect(signal.fundamentalScore).toBe(60);
    expect(signal.decision).toBe('BUY');
    expect(signal.rsi).toBe(45);
    expect(signal.macdHistogram).toBe(1.5);
  });

  it('maps historical signals with null fields using defaults', async () => {
    mockHistoricalSignals = [
      {
        timestamp: '2024-01-10T00:00:00Z',
        technicalScore: null,
        sentimentScore: null,
        fundamentalScore: null,
        decision: null,
        rsi: null,
        macdHistogram: null,
      },
    ];
    const stockData = makeStockData();
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);

    expect(result!.historicalSignals).toHaveLength(1);
    const signal = result!.historicalSignals[0];
    expect(signal.technicalScore).toBe(0);     // null ?? 0
    expect(signal.sentimentScore).toBe(0);      // null ?? 0
    expect(signal.fundamentalScore).toBe(0);    // null ?? 0
    expect(signal.decision).toBe('HOLD');       // null ?? 'HOLD'
    expect(signal.rsi).toBeNull();              // null ?? null
    expect(signal.macdHistogram).toBeNull();    // null ?? null
  });

  it('maps historical signals with undefined fields using defaults', async () => {
    mockHistoricalSignals = [
      {
        timestamp: '2024-01-10T00:00:00Z',
        // Fields not present => undefined
      },
    ];
    const stockData = makeStockData();
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);

    expect(result!.historicalSignals).toHaveLength(1);
    const signal = result!.historicalSignals[0];
    expect(signal.technicalScore).toBe(0);
    expect(signal.sentimentScore).toBe(0);
    expect(signal.fundamentalScore).toBe(0);
    expect(signal.decision).toBe('HOLD');
    expect(signal.rsi).toBeNull();
    expect(signal.macdHistogram).toBeNull();
  });

  it('handles partial indicator data (30 candles - no SMA50/200, no MACD)', async () => {
    // With 30 candles, macd (needs 35), sma50, sma200 will be null
    // but sma20, bollinger, rsi will compute
    const stockData = makeStockData({
      candles: generateCandles(30),
    });
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);

    expect(result).not.toBeNull();
    // Technical analysis runs on 30 candles => some indicators null
    expect(result!.technical.sma200).toBeNull();
    expect(result!.technical.macd).toBeNull();
    expect(result!.technical.sma20).not.toBeNull();
  });

  it('stores signal snapshot in DB (covers all optional chaining branches)', async () => {
    // With only 5 candles: macd, bollinger, stochastic will all be null
    // This exercises the ?? null fallbacks for all optional chaining in the insert
    const stockData = makeStockData({
      candles: generateCandles(5),
    });
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);

    expect(result).not.toBeNull();
    // With 5 candles most indicators are null
    expect(result!.technical.macd).toBeNull();
    expect(result!.technical.bollinger).toBeNull();
    expect(result!.technical.stochastic).toBeNull();
    expect(result!.technical.supportResistance).toBeNull();
  });

  it('handles multiple historical signals', async () => {
    mockHistoricalSignals = [
      {
        timestamp: '2024-01-10T00:00:00Z',
        technicalScore: 65,
        sentimentScore: 55,
        fundamentalScore: 70,
        decision: 'BUY',
        rsi: 30,
        macdHistogram: 2,
      },
      {
        timestamp: '2024-01-09T00:00:00Z',
        technicalScore: null,
        sentimentScore: null,
        fundamentalScore: null,
        decision: null,
        rsi: null,
        macdHistogram: null,
      },
    ];
    const stockData = makeStockData();
    const aggregator = createMockDataAggregator(stockData);
    const result = await analyzeStock('AAPL', aggregator);

    expect(result!.historicalSignals).toHaveLength(2);
    expect(result!.historicalSignals[0].decision).toBe('BUY');
    expect(result!.historicalSignals[1].decision).toBe('HOLD');
  });
});
