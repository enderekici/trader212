import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FinnhubNews, InsiderTx, EarningsEvent } from '../../src/data/finnhub.js';
import type { MarketauxArticle } from '../../src/data/marketaux.js';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  analyzeSentiment,
  scoreSentiment,
  type SentimentInput,
} from '../../src/analysis/sentiment/scorer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMarketauxArticle(overrides: Partial<MarketauxArticle> = {}): MarketauxArticle {
  return {
    title: 'Test Article',
    description: 'A test description',
    source: 'TestSource',
    url: 'https://example.com/article',
    publishedAt: new Date().toISOString(),
    sentimentScore: 0,
    relevanceScore: 0.8,
    ...overrides,
  };
}

function makeFinnhubNews(overrides: Partial<FinnhubNews> = {}): FinnhubNews {
  return {
    id: 1,
    category: 'company',
    datetime: Math.floor(Date.now() / 1000),
    headline: 'Test headline',
    image: '',
    related: 'AAPL',
    source: 'FinnhubSource',
    summary: 'Test summary',
    url: 'https://example.com/news',
    ...overrides,
  };
}

function makeInsiderTx(overrides: Partial<InsiderTx> = {}): InsiderTx {
  return {
    symbol: 'AAPL',
    name: 'John Doe',
    share: 1000,
    change: 1000,
    filingDate: '2024-01-15',
    transactionDate: '2024-01-14',
    transactionCode: 'P',
    transactionPrice: 150,
    ...overrides,
  };
}

function makeEarningsEvent(overrides: Partial<EarningsEvent> = {}): EarningsEvent {
  return {
    symbol: 'AAPL',
    date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
    epsEstimate: 1.5,
    epsActual: null,
    revenueEstimate: 1e9,
    revenueActual: null,
    hour: 'amc',
    quarter: 1,
    year: 2024,
    ...overrides,
  };
}

function makeInput(overrides: Partial<SentimentInput> = {}): SentimentInput {
  return {
    finnhubNews: [],
    marketauxNews: [],
    insiderTransactions: [],
    earnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sentiment Scorer', () => {
  describe('scoreSentiment', () => {
    it('returns the score from analyzeSentiment', () => {
      const input = makeInput();
      const score = scoreSentiment(input);
      const analysis = analyzeSentiment(input);
      expect(score).toBe(analysis.score);
    });
  });

  describe('analyzeSentiment', () => {
    // ── Empty data ────────────────────────────────────────────────────────

    it('returns neutral score (50) with no data at all', () => {
      const result = analyzeSentiment(makeInput());
      // newsScore=50, insiderScore=50, combined = 50*0.7 + 50*0.3 = 50
      expect(result.score).toBe(50);
      expect(result.articles).toHaveLength(0);
      expect(result.insiderNetBuying).toBe(0);
      expect(result.daysToEarnings).toBeNull();
    });

    // ── Marketaux news (primary source) ───────────────────────────────────

    it('processes marketaux news with positive sentiment', () => {
      const input = makeInput({
        marketauxNews: [
          makeMarketauxArticle({ sentimentScore: 0.8, title: 'Great earnings!' }),
          makeMarketauxArticle({ sentimentScore: 0.6, title: 'Revenue growth' }),
        ],
      });
      const result = analyzeSentiment(input);
      expect(result.articles).toHaveLength(2);
      expect(result.score).toBeGreaterThan(50); // positive sentiment should push above 50
    });

    it('processes marketaux news with negative sentiment', () => {
      const input = makeInput({
        marketauxNews: [
          makeMarketauxArticle({ sentimentScore: -0.8, title: 'Missed earnings' }),
          makeMarketauxArticle({ sentimentScore: -0.5, title: 'Revenue decline' }),
        ],
      });
      const result = analyzeSentiment(input);
      expect(result.score).toBeLessThan(50); // negative sentiment should push below 50
    });

    it('uses null sentimentScore as 0', () => {
      const input = makeInput({
        marketauxNews: [makeMarketauxArticle({ sentimentScore: null })],
      });
      const result = analyzeSentiment(input);
      // sentiment = 0, so newsScore = 50 + 0*50 = 50
      expect(result.articles[0].score).toBe(0);
    });

    it('applies recency weighting (recent articles matter more)', () => {
      const now = new Date();
      const recentDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
      const oldDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

      const input = makeInput({
        marketauxNews: [
          makeMarketauxArticle({ sentimentScore: 1.0, publishedAt: recentDate.toISOString() }),
          makeMarketauxArticle({ sentimentScore: -1.0, publishedAt: oldDate.toISOString() }),
        ],
      });
      const result = analyzeSentiment(input);
      // The recent positive article should outweigh the old negative one
      expect(result.score).toBeGreaterThan(50);
      // Check that recency weights differ
      expect(result.articles[0].recencyWeight).toBeGreaterThan(result.articles[1].recencyWeight);
    });

    it('clamps newsScore to [0, 100]', () => {
      const input = makeInput({
        marketauxNews: [
          makeMarketauxArticle({ sentimentScore: 2.0 }), // extreme positive
        ],
      });
      const result = analyzeSentiment(input);
      // newsScore = 50 + 2 * 50 = 150, clamped to 100
      // combined = 100*0.7 + 50*0.3 = 85
      expect(result.score).toBeLessThanOrEqual(100);
    });

    // ── Finnhub news (fallback when no marketaux) ─────────────────────────

    it('falls back to finnhub keyword scoring when no marketaux articles', () => {
      const input = makeInput({
        finnhubNews: [
          makeFinnhubNews({
            headline: 'Stock surge: company beats expectations',
            summary: 'Strong growth and bullish momentum in revenue beat',
          }),
        ],
      });
      const result = analyzeSentiment(input);
      expect(result.articles).toHaveLength(1);
      expect(result.articles[0].score).toBeGreaterThan(0); // bullish keywords
    });

    it('keyword scoring produces negative score for bearish text', () => {
      const input = makeInput({
        finnhubNews: [
          makeFinnhubNews({
            headline: 'Stock crash: company faces lawsuit',
            summary: 'Decline, loss, and risk of bankruptcy',
          }),
        ],
      });
      const result = analyzeSentiment(input);
      expect(result.articles[0].score).toBeLessThan(0);
    });

    it('keyword scoring returns 0 for neutral text (no keywords)', () => {
      const input = makeInput({
        finnhubNews: [
          makeFinnhubNews({
            headline: 'Company announces new product',
            summary: 'The new product is available now',
          }),
        ],
      });
      const result = analyzeSentiment(input);
      expect(result.articles[0].score).toBe(0);
    });

    it('does NOT use finnhub news when marketaux news is present', () => {
      const input = makeInput({
        marketauxNews: [makeMarketauxArticle({ sentimentScore: 0.5 })],
        finnhubNews: [
          makeFinnhubNews({
            headline: 'crash decline loss bankruptcy',
            summary: 'plunge bearish',
          }),
        ],
      });
      const result = analyzeSentiment(input);
      // Only marketaux articles should be processed
      expect(result.articles).toHaveLength(1);
      expect(result.articles[0].source).toBe('TestSource');
    });

    it('handles mixed bullish and bearish keywords', () => {
      const input = makeInput({
        finnhubNews: [
          makeFinnhubNews({
            headline: 'Company shows growth despite risk',
            summary: 'surge and decline mixed signals',
          }),
        ],
      });
      const result = analyzeSentiment(input);
      expect(result.articles).toHaveLength(1);
      // With mixed keywords the score should be near zero
      expect(Math.abs(result.articles[0].score)).toBeLessThanOrEqual(1);
    });

    // ── Insider Transactions ──────────────────────────────────────────────

    it('detects net insider buying (Purchase)', () => {
      const input = makeInput({
        insiderTransactions: [
          makeInsiderTx({ transactionCode: 'P', change: 5000 }),
          makeInsiderTx({ transactionCode: 'P', change: 3000 }),
        ],
      });
      const result = analyzeSentiment(input);
      expect(result.insiderNetBuying).toBe(8000);
      // insiderScore = min(50 + 8000/1000, 80) = min(58, 80) = 58
      // combined = 50*0.7 + 58*0.3 = 35 + 17.4 = 52.4 -> 52
      expect(result.score).toBeGreaterThan(50);
    });

    it('detects net insider selling (Sale)', () => {
      const input = makeInput({
        insiderTransactions: [
          makeInsiderTx({ transactionCode: 'S', change: -5000 }),
          makeInsiderTx({ transactionCode: 'S', change: -3000 }),
        ],
      });
      const result = analyzeSentiment(input);
      expect(result.insiderNetBuying).toBe(-8000);
      // insiderScore = max(50 + (-8000)/1000, 20) = max(42, 20) = 42
      // combined = 50*0.7 + 42*0.3 = 35 + 12.6 = 47.6 -> 48
      expect(result.score).toBeLessThan(50);
    });

    it('caps insider buying score at 80', () => {
      const input = makeInput({
        insiderTransactions: [
          makeInsiderTx({ transactionCode: 'P', change: 100000 }),
        ],
      });
      const result = analyzeSentiment(input);
      // insiderScore = min(50 + 100000/1000, 80) = 80
      // combined = 50*0.7 + 80*0.3 = 35 + 24 = 59
      expect(result.score).toBe(59);
    });

    it('floors insider selling score at 20', () => {
      const input = makeInput({
        insiderTransactions: [
          makeInsiderTx({ transactionCode: 'S', change: -100000 }),
        ],
      });
      const result = analyzeSentiment(input);
      // insiderScore = max(50 + (-100000)/1000, 20) = 20
      // combined = 50*0.7 + 20*0.3 = 35 + 6 = 41
      expect(result.score).toBe(41);
    });

    it('ignores transactions with unknown codes', () => {
      const input = makeInput({
        insiderTransactions: [
          makeInsiderTx({ transactionCode: 'X', change: 5000 }),
        ],
      });
      const result = analyzeSentiment(input);
      // insiderNetBuying stays 0, but transactions.length > 0 so insiderScore = 50 (net=0)
      expect(result.insiderNetBuying).toBe(0);
    });

    it('handles mixed buy and sell transactions', () => {
      const input = makeInput({
        insiderTransactions: [
          makeInsiderTx({ transactionCode: 'P', change: 5000 }),
          makeInsiderTx({ transactionCode: 'S', change: -3000 }),
        ],
      });
      const result = analyzeSentiment(input);
      expect(result.insiderNetBuying).toBe(2000);
    });

    // ── Earnings proximity ────────────────────────────────────────────────

    it('calculates daysToEarnings for future earnings', () => {
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const input = makeInput({
        earnings: [makeEarningsEvent({ date: futureDate.toISOString() })],
      });
      const result = analyzeSentiment(input);
      expect(result.daysToEarnings).not.toBeNull();
      expect(result.daysToEarnings).toBeGreaterThanOrEqual(9);
      expect(result.daysToEarnings).toBeLessThanOrEqual(11);
    });

    it('returns null daysToEarnings when no future earnings', () => {
      const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const input = makeInput({
        earnings: [makeEarningsEvent({ date: pastDate.toISOString() })],
      });
      const result = analyzeSentiment(input);
      expect(result.daysToEarnings).toBeNull();
    });

    it('returns null daysToEarnings when earnings list is empty', () => {
      const result = analyzeSentiment(makeInput());
      expect(result.daysToEarnings).toBeNull();
    });

    it('picks the nearest future earnings event', () => {
      const near = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const far = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const input = makeInput({
        earnings: [
          makeEarningsEvent({ date: far.toISOString() }),
          makeEarningsEvent({ date: near.toISOString() }),
        ],
      });
      const result = analyzeSentiment(input);
      expect(result.daysToEarnings).toBeLessThanOrEqual(6);
    });

    // ── Combined scoring ──────────────────────────────────────────────────

    it('combines news and insider sentiment (70/30 split)', () => {
      const input = makeInput({
        marketauxNews: [
          makeMarketauxArticle({ sentimentScore: 1.0 }), // max bullish
        ],
        insiderTransactions: [
          makeInsiderTx({ transactionCode: 'P', change: 50000 }),
        ],
      });
      const result = analyzeSentiment(input);
      // newsScore = 50 + 1.0*50 = 100
      // insiderScore = min(50 + 50000/1000, 80) = 80
      // combined = 100*0.7 + 80*0.3 = 70 + 24 = 94
      expect(result.score).toBe(94);
    });

    it('final score is clamped to [0, 100]', () => {
      const input = makeInput({
        marketauxNews: [
          makeMarketauxArticle({ sentimentScore: -2.0 }), // extreme negative (out of typical range)
        ],
        insiderTransactions: [
          makeInsiderTx({ transactionCode: 'S', change: -200000 }),
        ],
      });
      const result = analyzeSentiment(input);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    // ── Output shape ──────────────────────────────────────────────────────

    it('returns correct shape', () => {
      const input = makeInput({
        marketauxNews: [makeMarketauxArticle()],
        insiderTransactions: [makeInsiderTx()],
        earnings: [makeEarningsEvent()],
      });
      const result = analyzeSentiment(input);

      expect(result).toHaveProperty('articles');
      expect(result).toHaveProperty('insiderNetBuying');
      expect(result).toHaveProperty('daysToEarnings');
      expect(result).toHaveProperty('score');
      expect(Array.isArray(result.articles)).toBe(true);

      // Each article has the right shape
      const article = result.articles[0];
      expect(article).toHaveProperty('title');
      expect(article).toHaveProperty('source');
      expect(article).toHaveProperty('score');
      expect(article).toHaveProperty('recencyWeight');
    });
  });
});
