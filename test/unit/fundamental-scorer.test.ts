import { describe, expect, it, vi } from 'vitest';
import type { FundamentalData } from '../../src/data/yahoo-finance.js';

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
  analyzeFundamentals,
  scoreFundamentals,
} from '../../src/analysis/fundamental/scorer.js';

// ---------------------------------------------------------------------------
// Helper: create FundamentalData with overrides
// ---------------------------------------------------------------------------

function makeFundamentals(overrides: Partial<FundamentalData> = {}): FundamentalData {
  return {
    peRatio: null,
    forwardPE: null,
    revenueGrowthYoY: null,
    profitMargin: null,
    operatingMargin: null,
    debtToEquity: null,
    currentRatio: null,
    marketCap: null,
    sector: null,
    industry: null,
    earningsSurprise: null,
    dividendYield: null,
    beta: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Fundamental Scorer', () => {
  describe('scoreFundamentals', () => {
    it('returns the score from analyzeFundamentals', () => {
      const data = makeFundamentals({ peRatio: 15, revenueGrowthYoY: 0.2 });
      const score = scoreFundamentals(data);
      const analysis = analyzeFundamentals(data);
      expect(score).toBe(analysis.score);
    });
  });

  describe('analyzeFundamentals', () => {
    // ── Score = 50 when all nulls ─────────────────────────────────────────

    it('returns score 50 when all data is null', () => {
      const data = makeFundamentals();
      const result = analyzeFundamentals(data);
      expect(result.score).toBe(50);
    });

    // ── P/E Ratio branches ────────────────────────────────────────────────

    it('scores peRatio < 10 as 85', () => {
      const result = analyzeFundamentals(makeFundamentals({ peRatio: 8 }));
      // Only peRatio contributing, weight 15, signal 85
      expect(result.score).toBe(85);
    });

    it('scores peRatio 10-15 as 75', () => {
      const result = analyzeFundamentals(makeFundamentals({ peRatio: 12 }));
      expect(result.score).toBe(75);
    });

    it('scores peRatio 15-20 as 65', () => {
      const result = analyzeFundamentals(makeFundamentals({ peRatio: 18 }));
      expect(result.score).toBe(65);
    });

    it('scores peRatio 20-25 as 55', () => {
      const result = analyzeFundamentals(makeFundamentals({ peRatio: 22 }));
      expect(result.score).toBe(55);
    });

    it('scores peRatio 25-35 as 40', () => {
      const result = analyzeFundamentals(makeFundamentals({ peRatio: 30 }));
      expect(result.score).toBe(40);
    });

    it('scores peRatio 35-50 as 25', () => {
      const result = analyzeFundamentals(makeFundamentals({ peRatio: 40 }));
      expect(result.score).toBe(25);
    });

    it('scores peRatio >= 50 as 15', () => {
      const result = analyzeFundamentals(makeFundamentals({ peRatio: 60 }));
      expect(result.score).toBe(15);
    });

    it('skips peRatio when null', () => {
      const result = analyzeFundamentals(makeFundamentals({ peRatio: null }));
      expect(result.score).toBe(50);
    });

    it('skips peRatio when zero', () => {
      const result = analyzeFundamentals(makeFundamentals({ peRatio: 0 }));
      expect(result.score).toBe(50);
    });

    it('skips peRatio when negative', () => {
      const result = analyzeFundamentals(makeFundamentals({ peRatio: -5 }));
      expect(result.score).toBe(50);
    });

    // ── Forward P/E branches ──────────────────────────────────────────────

    it('scores forwardPE < 10 as 85', () => {
      const result = analyzeFundamentals(makeFundamentals({ forwardPE: 8 }));
      expect(result.score).toBe(85);
    });

    it('scores forwardPE 10-15 as 75', () => {
      const result = analyzeFundamentals(makeFundamentals({ forwardPE: 12 }));
      expect(result.score).toBe(75);
    });

    it('scores forwardPE 15-20 as 65', () => {
      const result = analyzeFundamentals(makeFundamentals({ forwardPE: 17 }));
      expect(result.score).toBe(65);
    });

    it('scores forwardPE 20-30 as 45', () => {
      const result = analyzeFundamentals(makeFundamentals({ forwardPE: 25 }));
      expect(result.score).toBe(45);
    });

    it('scores forwardPE >= 30 as 20', () => {
      const result = analyzeFundamentals(makeFundamentals({ forwardPE: 35 }));
      expect(result.score).toBe(20);
    });

    it('boosts forwardPE when it is lower than peRatio (improving forward)', () => {
      // peRatio = 20 -> peSignal = 55 (20 is NOT < 20, but IS < 25), weight 15
      // forwardPE = 12 -> fpeSignal = 75 (10 <= 12 < 15), then +10 for improving = 85, weight 10
      // combined: (55*15 + 85*10) / 25 = (825 + 850) / 25 = 67
      const result = analyzeFundamentals(makeFundamentals({ peRatio: 20, forwardPE: 12 }));
      expect(result.score).toBe(67);
    });

    it('caps forwardPE boost at 100', () => {
      // peRatio = 20 -> peSignal = 55, weight 15
      // forwardPE = 5 -> fpeSignal = 85 (< 10), +10 for improving = 95, weight 10
      // combined: (55*15 + 95*10) / 25 = (825 + 950) / 25 = 71
      const result = analyzeFundamentals(makeFundamentals({ peRatio: 20, forwardPE: 5 }));
      expect(result.score).toBe(71);
    });

    it('skips forwardPE when null', () => {
      const result = analyzeFundamentals(makeFundamentals({ forwardPE: null }));
      expect(result.score).toBe(50);
    });

    it('skips forwardPE when zero or negative', () => {
      const result = analyzeFundamentals(makeFundamentals({ forwardPE: 0 }));
      expect(result.score).toBe(50);
      const result2 = analyzeFundamentals(makeFundamentals({ forwardPE: -3 }));
      expect(result2.score).toBe(50);
    });

    // ── Revenue Growth branches ───────────────────────────────────────────

    it('scores revenueGrowthYoY > 0.3 as 90', () => {
      const result = analyzeFundamentals(makeFundamentals({ revenueGrowthYoY: 0.4 }));
      expect(result.score).toBe(90);
    });

    it('scores revenueGrowthYoY 0.2-0.3 as 80', () => {
      const result = analyzeFundamentals(makeFundamentals({ revenueGrowthYoY: 0.25 }));
      expect(result.score).toBe(80);
    });

    it('scores revenueGrowthYoY 0.1-0.2 as 70', () => {
      const result = analyzeFundamentals(makeFundamentals({ revenueGrowthYoY: 0.15 }));
      expect(result.score).toBe(70);
    });

    it('scores revenueGrowthYoY 0.05-0.1 as 60', () => {
      const result = analyzeFundamentals(makeFundamentals({ revenueGrowthYoY: 0.07 }));
      expect(result.score).toBe(60);
    });

    it('scores revenueGrowthYoY 0 to 0.05 as 50', () => {
      const result = analyzeFundamentals(makeFundamentals({ revenueGrowthYoY: 0.02 }));
      expect(result.score).toBe(50);
    });

    it('scores revenueGrowthYoY -0.1 to 0 as 35', () => {
      const result = analyzeFundamentals(makeFundamentals({ revenueGrowthYoY: -0.05 }));
      expect(result.score).toBe(35);
    });

    it('scores revenueGrowthYoY < -0.1 as 15', () => {
      const result = analyzeFundamentals(makeFundamentals({ revenueGrowthYoY: -0.2 }));
      expect(result.score).toBe(15);
    });

    // ── Profit Margin branches ────────────────────────────────────────────

    it('scores profitMargin > 0.25 as 85', () => {
      const result = analyzeFundamentals(makeFundamentals({ profitMargin: 0.3 }));
      expect(result.score).toBe(85);
    });

    it('scores profitMargin 0.15-0.25 as 70', () => {
      const result = analyzeFundamentals(makeFundamentals({ profitMargin: 0.2 }));
      expect(result.score).toBe(70);
    });

    it('scores profitMargin 0.08-0.15 as 55', () => {
      const result = analyzeFundamentals(makeFundamentals({ profitMargin: 0.1 }));
      expect(result.score).toBe(55);
    });

    it('scores profitMargin 0-0.08 as 40', () => {
      const result = analyzeFundamentals(makeFundamentals({ profitMargin: 0.04 }));
      expect(result.score).toBe(40);
    });

    it('scores profitMargin < 0 as 15', () => {
      const result = analyzeFundamentals(makeFundamentals({ profitMargin: -0.1 }));
      expect(result.score).toBe(15);
    });

    // ── Operating Margin branches ─────────────────────────────────────────

    it('scores operatingMargin > 0.3 as 85', () => {
      const result = analyzeFundamentals(makeFundamentals({ operatingMargin: 0.35 }));
      expect(result.score).toBe(85);
    });

    it('scores operatingMargin 0.2-0.3 as 70', () => {
      const result = analyzeFundamentals(makeFundamentals({ operatingMargin: 0.25 }));
      expect(result.score).toBe(70);
    });

    it('scores operatingMargin 0.1-0.2 as 55', () => {
      const result = analyzeFundamentals(makeFundamentals({ operatingMargin: 0.15 }));
      expect(result.score).toBe(55);
    });

    it('scores operatingMargin 0-0.1 as 40', () => {
      const result = analyzeFundamentals(makeFundamentals({ operatingMargin: 0.05 }));
      expect(result.score).toBe(40);
    });

    it('scores operatingMargin < 0 as 15', () => {
      const result = analyzeFundamentals(makeFundamentals({ operatingMargin: -0.1 }));
      expect(result.score).toBe(15);
    });

    // ── Debt to Equity branches ───────────────────────────────────────────

    it('scores debtToEquity < 0.3 as 85', () => {
      const result = analyzeFundamentals(makeFundamentals({ debtToEquity: 0.2 }));
      expect(result.score).toBe(85);
    });

    it('scores debtToEquity 0.3-0.5 as 75', () => {
      const result = analyzeFundamentals(makeFundamentals({ debtToEquity: 0.4 }));
      expect(result.score).toBe(75);
    });

    it('scores debtToEquity 0.5-1.0 as 60', () => {
      const result = analyzeFundamentals(makeFundamentals({ debtToEquity: 0.7 }));
      expect(result.score).toBe(60);
    });

    it('scores debtToEquity 1.0-1.5 as 45', () => {
      const result = analyzeFundamentals(makeFundamentals({ debtToEquity: 1.2 }));
      expect(result.score).toBe(45);
    });

    it('scores debtToEquity 1.5-2.0 as 30', () => {
      const result = analyzeFundamentals(makeFundamentals({ debtToEquity: 1.7 }));
      expect(result.score).toBe(30);
    });

    it('scores debtToEquity >= 2.0 as 15', () => {
      const result = analyzeFundamentals(makeFundamentals({ debtToEquity: 3.0 }));
      expect(result.score).toBe(15);
    });

    // ── Current Ratio branches ────────────────────────────────────────────

    it('scores currentRatio > 3 as 70', () => {
      const result = analyzeFundamentals(makeFundamentals({ currentRatio: 4 }));
      expect(result.score).toBe(70);
    });

    it('scores currentRatio 2-3 as 80', () => {
      const result = analyzeFundamentals(makeFundamentals({ currentRatio: 2.5 }));
      expect(result.score).toBe(80);
    });

    it('scores currentRatio 1.5-2 as 70', () => {
      const result = analyzeFundamentals(makeFundamentals({ currentRatio: 1.7 }));
      expect(result.score).toBe(70);
    });

    it('scores currentRatio 1-1.5 as 55', () => {
      const result = analyzeFundamentals(makeFundamentals({ currentRatio: 1.2 }));
      expect(result.score).toBe(55);
    });

    it('scores currentRatio < 1 as 20', () => {
      const result = analyzeFundamentals(makeFundamentals({ currentRatio: 0.5 }));
      expect(result.score).toBe(20);
    });

    // ── Earnings Surprise branches ────────────────────────────────────────

    it('scores earningsSurprise > 0.1 as 85', () => {
      const result = analyzeFundamentals(makeFundamentals({ earningsSurprise: 0.15 }));
      expect(result.score).toBe(85);
    });

    it('scores earningsSurprise 0.05-0.1 as 70', () => {
      const result = analyzeFundamentals(makeFundamentals({ earningsSurprise: 0.07 }));
      expect(result.score).toBe(70);
    });

    it('scores earningsSurprise 0-0.05 as 60', () => {
      const result = analyzeFundamentals(makeFundamentals({ earningsSurprise: 0.02 }));
      expect(result.score).toBe(60);
    });

    it('scores earningsSurprise -0.05 to 0 as 40', () => {
      const result = analyzeFundamentals(makeFundamentals({ earningsSurprise: -0.03 }));
      expect(result.score).toBe(40);
    });

    it('scores earningsSurprise < -0.05 as 20', () => {
      const result = analyzeFundamentals(makeFundamentals({ earningsSurprise: -0.1 }));
      expect(result.score).toBe(20);
    });

    // ── Full data combination ─────────────────────────────────────────────

    it('combines all metrics correctly for a strong company', () => {
      const data = makeFundamentals({
        peRatio: 12,      // 75, weight 15
        forwardPE: 10,    // 75 + 10 (improving) = 85, weight 10
        revenueGrowthYoY: 0.25, // 80, weight 20
        profitMargin: 0.2, // 70, weight 10
        operatingMargin: 0.25, // 70, weight 10
        debtToEquity: 0.4, // 75, weight 15
        currentRatio: 2.5, // 80, weight 10
        earningsSurprise: 0.08, // 70, weight 10
      });
      const result = analyzeFundamentals(data);
      // Verify: (75*15 + 85*10 + 80*20 + 70*10 + 70*10 + 75*15 + 80*10 + 70*10) / (15+10+20+10+10+15+10+10)
      // = (1125 + 850 + 1600 + 700 + 700 + 1125 + 800 + 700) / 100
      // = 7600 / 100 = 76
      expect(result.score).toBe(76);
    });

    it('combines all metrics correctly for a weak company', () => {
      const data = makeFundamentals({
        peRatio: 60,       // 15, weight 15
        forwardPE: 35,     // 20, but since 35 < 60 -> +10 = 30, weight 10
        revenueGrowthYoY: -0.2, // 15, weight 20
        profitMargin: -0.1, // 15, weight 10
        operatingMargin: -0.1, // 15, weight 10
        debtToEquity: 3.0, // 15, weight 15
        currentRatio: 0.5, // 20, weight 10
        earningsSurprise: -0.1, // 20, weight 10
      });
      const result = analyzeFundamentals(data);
      // = (15*15 + 30*10 + 15*20 + 15*10 + 15*10 + 15*15 + 20*10 + 20*10) / 100
      // = (225 + 300 + 300 + 150 + 150 + 225 + 200 + 200) / 100
      // = 1750 / 100 = 17.5 -> 18 (rounded)
      expect(result.score).toBe(18);
    });

    // ── Output shape ──────────────────────────────────────────────────────

    it('returns all fields in the analysis result', () => {
      const data = makeFundamentals({
        peRatio: 15,
        forwardPE: 12,
        revenueGrowthYoY: 0.1,
        profitMargin: 0.15,
        operatingMargin: 0.2,
        debtToEquity: 0.5,
        currentRatio: 2,
        marketCap: 1e10,
        sector: 'Technology',
        beta: 1.2,
        dividendYield: 0.02,
        earningsSurprise: 0.05,
      });
      const result = analyzeFundamentals(data);

      expect(result.peRatio).toBe(15);
      expect(result.forwardPE).toBe(12);
      expect(result.revenueGrowthYoY).toBe(0.1);
      expect(result.profitMargin).toBe(0.15);
      expect(result.operatingMargin).toBe(0.2);
      expect(result.debtToEquity).toBe(0.5);
      expect(result.currentRatio).toBe(2);
      expect(result.marketCap).toBe(1e10);
      expect(result.sector).toBe('Technology');
      expect(result.beta).toBe(1.2);
      expect(result.dividendYield).toBe(0.02);
      expect(result.earningsSurprise).toBe(0.05);
      expect(typeof result.score).toBe('number');
    });
  });
});
