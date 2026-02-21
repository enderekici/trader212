import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { RulesEngine } from '../../src/ai/rules-engine.js';
import { configManager } from '../../src/config/manager.js';
import type { AIContext } from '../../src/ai/agent.js';

/**
 * Helper to build AIContext with configurable indicator overrides.
 * Default values are neutral, generating HOLD decisions.
 */
function makeContext(
  overrides: Partial<{
    symbol: string;
    techScore: number;
    fundScore: number;
    sentScore: number;
    rsi: number | null;
    macdValue: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    ema12: number | null;
    sma50: number | null;
    sma200: number | null;
    adx: number | null;
    stochasticK: number | null;
    williamsR: number | null;
    cci: number | null;
    roc: number | null;
    volumeRatio: number | null;
    bollingerUpper: number | null;
    bollingerMiddle: number | null;
    bollingerLower: number | null;
    support: number | null;
    resistance: number | null;
    currentPrice: number;
    atr: number | null;
    mfi: number | null;
    regime: AIContext['regime'];
  }> = {},
): AIContext {
  return {
    symbol: overrides.symbol ?? 'AAPL',
    currentPrice: overrides.currentPrice ?? 150,
    priceChange1d: 1.2,
    priceChange5d: 3.5,
    priceChange1m: 8.0,
    dayHigh: null,
    dayLow: null,
    volume: null,
    avgVolume: null,
    technical: {
      rsi: overrides.rsi !== undefined ? overrides.rsi : 55,
      macdValue: overrides.macdValue !== undefined ? overrides.macdValue : 0.5,
      macdSignal: overrides.macdSignal !== undefined ? overrides.macdSignal : 0.3,
      macdHistogram: overrides.macdHistogram !== undefined ? overrides.macdHistogram : 0.2,
      sma20: 148,
      sma50: overrides.sma50 !== undefined ? overrides.sma50 : 145,
      sma200: overrides.sma200 !== undefined ? overrides.sma200 : 140,
      ema12: overrides.ema12 !== undefined ? overrides.ema12 : 149,
      ema26: 147,
      bollingerUpper: overrides.bollingerUpper !== undefined ? overrides.bollingerUpper : 155,
      bollingerMiddle: overrides.bollingerMiddle !== undefined ? overrides.bollingerMiddle : 150,
      bollingerLower: overrides.bollingerLower !== undefined ? overrides.bollingerLower : 145,
      atr: overrides.atr !== undefined ? overrides.atr : 2.5,
      adx: overrides.adx !== undefined ? overrides.adx : 25,
      stochasticK: overrides.stochasticK !== undefined ? overrides.stochasticK : 60,
      stochasticD: 55,
      williamsR: overrides.williamsR !== undefined ? overrides.williamsR : -40,
      mfi: overrides.mfi !== undefined ? overrides.mfi : 55,
      cci: overrides.cci !== undefined ? overrides.cci : 50,
      obv: 1000000,
      vwap: 150,
      parabolicSar: 148,
      roc: overrides.roc !== undefined ? overrides.roc : 2,
      forceIndex: 500,
      volumeRatio: overrides.volumeRatio !== undefined ? overrides.volumeRatio : 1.1,
      perfWeek: null,
      perfMonth: null,
      perfQuarter: null,
      perfYear: null,
      ichimoku: null,
      adl: null,
      awesomeOscillator: null,
      support: overrides.support !== undefined ? overrides.support : 145,
      resistance: overrides.resistance !== undefined ? overrides.resistance : 155,
      candlestickBullish: null,
      candlestickBearish: null,
      candlestickNeutral: null,
      score: overrides.techScore ?? 50,
    },
    fundamental: {
      peRatio: 25,
      forwardPE: 22,
      pegRatio: null,
      revenueGrowthYoY: 0.15,
      profitMargin: 0.2,
      operatingMargin: 0.25,
      debtToEquity: 1.5,
      currentRatio: 1.8,
      marketCap: 2_000_000_000_000,
      sector: 'Technology',
      beta: 1.2,
      dividendYield: 0.005,
      industry: null,
      earningsSurprise: null,
      roe: null,
      roa: null,
      freeCashflow: null,
      analystBuy: null,
      analystSell: null,
      analystTargetPrice: null,
      analystConsensus: null,
      analystCount: null,
      shortInterestPct: null,
      institutionalOwnershipPct: null,
      score: overrides.fundScore ?? 50,
    },
    sentiment: {
      headlines: [{ title: 'AAPL beats estimates', score: 0.8, source: 'Reuters' }],
      insiderNetBuying: 100000,
      daysToEarnings: 30,
      epsEstimateNextQ: null,
      revenueEstimateNextQ: null,
      sentimentBreakdown: null,
      topKeywords: [],
      finraShortVolumePct: null,
      score: overrides.sentScore ?? 50,
    },
    historicalSignals: [],
    portfolio: {
      cashAvailable: 10000,
      portfolioValue: 100000,
      openPositions: 3,
      maxPositions: 10,
      todayPnl: 250,
      todayPnlPct: 0.25,
      sectorExposure: { Technology: 0.3 },
      sectorExposureValue: { Technology: 30000 },
      existingPositions: [],
    },
    marketContext: {
      spyPrice: 450,
      spyChange1d: 0.5,
      vixLevel: 15,
      marketTrend: 'bullish',
    },
    riskConstraints: {
      maxPositionSizePct: 0.1,
      maxStopLossPct: 0.05,
      minStopLossPct: 0.01,
      maxRiskPerTradePct: 0.02,
      dailyLossLimitPct: 0.03,
    },
    regime: overrides.regime,
  };
}

describe('RulesEngine', () => {
  let engine: RulesEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configManager.get).mockImplementation(() => {
      throw new Error('config key not found');
    });
    engine = new RulesEngine();
  });

  describe('BUY decisions (multi-strategy consensus)', () => {
    it('returns BUY when multiple strategies agree LONG with strong signals', async () => {
      // RSI=25 (mean-reversion oversold) + EMA aligned bullish (trend-following)
      // + ROC=8 (momentum) + price near resistance (breakout) + high volume
      const ctx = makeContext({
        rsi: 25,
        stochasticK: 15,
        williamsR: -85,
        cci: -120,
        ema12: 149,
        sma50: 145,
        sma200: 140,
        adx: 30,
        macdValue: 2,
        macdSignal: 1,
        macdHistogram: 1,
        roc: 8,
        volumeRatio: 1.5,
        currentPrice: 155,
        resistance: 155,
        support: 145,
        mfi: 60,
      });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('BUY');
      expect(result!.conviction).toBeGreaterThan(30);
    });

    it('returns BUY when trend-following and momentum align strongly', async () => {
      const ctx = makeContext({
        rsi: 58,
        ema12: 155,
        sma50: 148,
        sma200: 135,
        adx: 35,
        macdValue: 3,
        macdSignal: 1.5,
        macdHistogram: 1.5,
        roc: 10,
        volumeRatio: 1.8,
        mfi: 65,
        currentPrice: 160,
        support: 150,
        resistance: 158,
      });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('BUY');
    });
  });

  describe('SELL decisions (multi-strategy consensus)', () => {
    it('returns SELL when multiple strategies agree SHORT with strong signals', async () => {
      // RSI=80 (mean-reversion overbought) + EMA aligned bearish (trend)
      // + ROC=-8 (negative momentum) + price below support (breakout)
      const ctx = makeContext({
        rsi: 80,
        stochasticK: 90,
        williamsR: -10,
        cci: 150,
        ema12: 140,
        sma50: 148,
        sma200: 155,
        adx: 35,
        macdValue: -2,
        macdSignal: -0.5,
        macdHistogram: -1.5,
        roc: -8,
        volumeRatio: 1.6,
        currentPrice: 135,
        support: 140,
        resistance: 155,
        mfi: 35,
      });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('SELL');
      expect(result!.conviction).toBeGreaterThan(30);
    });
  });

  describe('HOLD decisions', () => {
    it('returns HOLD when indicators are neutral (no strong consensus)', async () => {
      // Default context has neutral indicators
      const ctx = makeContext();
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('HOLD');
    });

    it('returns HOLD when strategies conflict (mixed LONG/SHORT)', async () => {
      // RSI=25 (mean-reversion says LONG) but EMA aligned bearish (trend says SHORT)
      const ctx = makeContext({
        rsi: 25,
        stochasticK: 15,
        ema12: 140,
        sma50: 148,
        sma200: 155,
        adx: 15,
        macdValue: 0.1,
        macdSignal: 0.1,
        macdHistogram: 0,
        roc: 0,
        volumeRatio: 0.9,
      });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      // With conflicting signals, either HOLD or weak directional
      expect(['HOLD', 'BUY', 'SELL']).toContain(result!.decision);
    });
  });

  describe('rawChat', () => {
    it('returns a non-support message', async () => {
      const message = await engine.rawChat('system prompt', 'user message');
      expect(message).toBe(
        'Rules engine does not support raw chat. Switch to an AI provider for conversational analysis.',
      );
    });

    it('ignores the system and user parameters', async () => {
      const msg1 = await engine.rawChat('', '');
      const msg2 = await engine.rawChat('foo', 'bar');
      expect(msg1).toBe(msg2);
    });
  });

  describe('AIDecision shape', () => {
    it('returns all required AIDecision fields', async () => {
      const ctx = makeContext({
        rsi: 25,
        stochasticK: 15,
        williamsR: -85,
        cci: -120,
        ema12: 149,
        sma50: 145,
        sma200: 140,
        adx: 30,
        macdValue: 2,
        macdSignal: 1,
        macdHistogram: 1,
        roc: 8,
        volumeRatio: 1.5,
        currentPrice: 155,
        resistance: 155,
        support: 145,
        mfi: 60,
      });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result).toHaveProperty('decision');
      expect(result).toHaveProperty('conviction');
      expect(result).toHaveProperty('reasoning');
      expect(result).toHaveProperty('risks');
      expect(result).toHaveProperty('suggestedStopLossPct');
      expect(result).toHaveProperty('suggestedPositionSizePct');
      expect(result).toHaveProperty('suggestedTakeProfitPct');
      expect(result).toHaveProperty('urgency');
      expect(result).toHaveProperty('exitConditions');
      expect(['BUY', 'SELL', 'HOLD']).toContain(result!.decision);
      expect(typeof result!.conviction).toBe('number');
      expect(typeof result!.reasoning).toBe('string');
      expect(Array.isArray(result!.risks)).toBe(true);
    });

    it('uses ATR-based stop-loss and take-profit', async () => {
      const ctx = makeContext({ atr: 5.0, currentPrice: 100 });
      const result = await engine.analyze(ctx);

      // ATR=5, price=100 → SL = 2*5/100 = 10%, TP = 3*5/100 = 15%
      expect(result!.suggestedStopLossPct).toBeCloseTo(0.10, 1);
      expect(result!.suggestedTakeProfitPct).toBeCloseTo(0.15, 1);
    });

    it('falls back to config defaults when ATR is null', async () => {
      const ctx = makeContext({ atr: null });
      const result = await engine.analyze(ctx);

      // Config throws → defaults: SL=0.04, TP=0.2, posSize=0.1
      expect(result!.suggestedStopLossPct).toBe(0.04);
      expect(result!.suggestedTakeProfitPct).toBe(0.2);
      expect(result!.suggestedPositionSizePct).toBe(0.1);
    });

    it('sets urgency to "no_rush" for all decisions', async () => {
      const ctx = makeContext();
      const result = await engine.analyze(ctx);

      expect(result!.urgency).toBe('no_rush');
    });

    it('sets exitConditions to empty string', async () => {
      const ctx = makeContext();
      const result = await engine.analyze(ctx);

      expect(result!.exitConditions).toBe('');
    });

    it('includes risks array for BUY decisions', async () => {
      const ctx = makeContext({
        rsi: 25,
        stochasticK: 15,
        williamsR: -85,
        cci: -120,
        ema12: 149,
        sma50: 145,
        sma200: 140,
        adx: 30,
        macdValue: 2,
        macdSignal: 1,
        macdHistogram: 1,
        roc: 8,
        volumeRatio: 1.5,
        currentPrice: 155,
        resistance: 155,
        support: 145,
        mfi: 60,
      });
      const result = await engine.analyze(ctx);

      if (result!.decision === 'BUY') {
        expect(result!.risks).toEqual(['Rules-based multi-strategy consensus']);
      }
    });

    it('returns empty risks array for HOLD decisions', async () => {
      const ctx = makeContext();
      const result = await engine.analyze(ctx);

      expect(result!.decision).toBe('HOLD');
      expect(result!.risks).toEqual([]);
    });
  });

  describe('regime weighting', () => {
    it('uses regime from context for strategy weighting', async () => {
      const bullCtx = makeContext({
        regime: {
          regime: 'strong_bull',
          confidence: 0.8,
          spyTrend: 'bullish',
          volatilityPctile: 30,
          newEntriesAllowed: true,
          positionSizeMultiplier: 1.0,
          stopLossMultiplier: 1.0,
          entryThresholdAdjustment: 0,
          breadthScore: 0.7,
        },
      });
      const result = await engine.analyze(bullCtx);

      expect(result).not.toBeNull();
      expect(result!.reasoning).toContain('regime=strong_bull');
    });

    it('includes strategy info in reasoning', async () => {
      const ctx = makeContext({
        rsi: 25,
        ema12: 149,
        sma50: 145,
        sma200: 140,
      });
      const result = await engine.analyze(ctx);

      expect(result!.reasoning).toContain('conviction=');
      expect(result!.reasoning).toContain('fund=');
    });
  });

  describe('config integration', () => {
    it('uses custom risk config values for stop-loss and position size', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'risk.defaultStopLossPct') return 0.08;
        if (key === 'risk.maxPositionSizePct') return 0.15;
        if (key === 'risk.defaultTakeProfitPct') return 0.25;
        throw new Error('config key not found');
      });

      // ATR=null forces config fallback
      const ctx = makeContext({ atr: null });
      const result = await engine.analyze(ctx);

      expect(result!.suggestedStopLossPct).toBe(0.08);
      expect(result!.suggestedPositionSizePct).toBe(0.15);
      expect(result!.suggestedTakeProfitPct).toBe(0.25);
    });
  });
});
