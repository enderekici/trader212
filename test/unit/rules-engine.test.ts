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

function makeContext(
  overrides: {
    symbol?: string;
    techScore?: number;
    fundScore?: number;
    sentScore?: number;
  } = {},
): AIContext {
  return {
    symbol: overrides.symbol ?? 'AAPL',
    currentPrice: 150,
    priceChange1d: 1.2,
    priceChange5d: 3.5,
    priceChange1m: 8.0,
    technical: {
      rsi: 55,
      macdValue: 0.5,
      macdSignal: 0.3,
      macdHistogram: 0.2,
      sma20: 148,
      sma50: 145,
      sma200: 140,
      ema12: 149,
      ema26: 147,
      bollingerUpper: 155,
      bollingerMiddle: 150,
      bollingerLower: 145,
      atr: 2.5,
      adx: 25,
      stochasticK: 60,
      stochasticD: 55,
      williamsR: -40,
      mfi: 55,
      cci: 50,
      obv: 1000000,
      vwap: 150,
      parabolicSar: 148,
      roc: 2,
      forceIndex: 500,
      volumeRatio: 1.1,
      support: 145,
      resistance: 155,
      score: overrides.techScore ?? 50,
    },
    fundamental: {
      peRatio: 25,
      forwardPE: 22,
      revenueGrowthYoY: 0.15,
      profitMargin: 0.2,
      operatingMargin: 0.25,
      debtToEquity: 1.5,
      currentRatio: 1.8,
      marketCap: 2_000_000_000_000,
      sector: 'Technology',
      beta: 1.2,
      dividendYield: 0.005,
      score: overrides.fundScore ?? 50,
    },
    sentiment: {
      headlines: [{ title: 'AAPL beats estimates', score: 0.8, source: 'Reuters' }],
      insiderNetBuying: 100000,
      daysToEarnings: 30,
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
  };
}

describe('RulesEngine', () => {
  let engine: RulesEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    // By default, all configManager.get calls throw so that the engine uses hardcoded defaults
    vi.mocked(configManager.get).mockImplementation(() => {
      throw new Error('config key not found');
    });
    engine = new RulesEngine();
  });

  describe('BUY decisions', () => {
    it('returns BUY when tech >= buyTechMin AND fund >= buyFundMin', async () => {
      const ctx = makeContext({ techScore: 70, fundScore: 60, sentScore: 30 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('BUY');
      expect(result!.reasoning).toContain('BUY');
      expect(result!.reasoning).toContain('tech=70');
    });

    it('returns BUY when tech >= buyTechMin AND sent >= buySentMin', async () => {
      const ctx = makeContext({ techScore: 70, fundScore: 30, sentScore: 65 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('BUY');
      expect(result!.reasoning).toContain('BUY');
      expect(result!.reasoning).toContain('tech=70');
    });

    it('returns BUY when all three scores are high', async () => {
      const ctx = makeContext({ techScore: 80, fundScore: 75, sentScore: 70 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('BUY');
      // All three signals aligned
      expect(result!.reasoning).toContain('3 signals aligned');
    });

    it('does NOT return BUY when tech is below threshold even if fund and sent are high', async () => {
      const ctx = makeContext({ techScore: 60, fundScore: 80, sentScore: 80 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).not.toBe('BUY');
    });
  });

  describe('SELL decisions', () => {
    it('returns SELL when tech <= sellTechMax AND fund <= sellFundMax', async () => {
      const ctx = makeContext({ techScore: 30, fundScore: 25, sentScore: 50 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('SELL');
      expect(result!.reasoning).toContain('SELL');
      expect(result!.reasoning).toContain('tech=30');
      expect(result!.reasoning).toContain('fund=25');
    });

    it('returns SELL at exact boundary values (tech=35, fund=30)', async () => {
      const ctx = makeContext({ techScore: 35, fundScore: 30, sentScore: 50 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('SELL');
    });

    it('does NOT return SELL when tech is low but fund is above threshold', async () => {
      const ctx = makeContext({ techScore: 30, fundScore: 40, sentScore: 50 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).not.toBe('SELL');
    });
  });

  describe('HOLD decisions', () => {
    it('returns HOLD when no BUY or SELL conditions are met', async () => {
      // tech=50 is above sellTechMax=35 and below buyTechMin=65
      // fund=50 is above sellFundMax=30 and below buyFundMin=55
      const ctx = makeContext({ techScore: 50, fundScore: 50, sentScore: 50 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('HOLD');
      expect(result!.conviction).toBe(50);
      expect(result!.reasoning).toContain('HOLD');
      expect(result!.reasoning).toContain('No clear signal');
    });

    it('returns HOLD when tech is high but both fund and sent are low', async () => {
      // tech=70 >= buyTechMin=65, but fund=40 < buyFundMin=55 and sent=40 < buySentMin=60
      const ctx = makeContext({ techScore: 70, fundScore: 40, sentScore: 40 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('HOLD');
    });

    it('returns HOLD when tech is in the middle ground', async () => {
      // tech=40 is above sellTechMax=35 but below buyTechMin=65
      const ctx = makeContext({ techScore: 40, fundScore: 50, sentScore: 50 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('HOLD');
    });
  });

  describe('custom thresholds from configManager', () => {
    it('uses custom thresholds from config when available', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        switch (key) {
          case 'ai.rules.buyTechMin':
            return 50; // lowered from default 65
          case 'ai.rules.buyFundMin':
            return 40; // lowered from default 55
          case 'ai.rules.buySentMin':
            return 45; // lowered from default 60
          case 'ai.rules.sellTechMax':
            return 20; // lowered from default 35
          case 'ai.rules.sellFundMax':
            return 15; // lowered from default 30
          case 'risk.defaultStopLossPct':
            return 0.03;
          case 'risk.maxPositionSizePct':
            return 0.05;
          default:
            throw new Error('config key not found');
        }
      });

      // tech=55 is above custom buyTechMin=50 and fund=45 is above custom buyFundMin=40
      const ctx = makeContext({ techScore: 55, fundScore: 45, sentScore: 30 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('BUY');
    });

    it('uses custom sell thresholds from config', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        switch (key) {
          case 'ai.rules.buyTechMin':
            return 65;
          case 'ai.rules.buyFundMin':
            return 55;
          case 'ai.rules.buySentMin':
            return 60;
          case 'ai.rules.sellTechMax':
            return 45; // raised from default 35
          case 'ai.rules.sellFundMax':
            return 40; // raised from default 30
          case 'risk.defaultStopLossPct':
            return 0.05;
          case 'risk.maxPositionSizePct':
            return 0.1;
          default:
            throw new Error('config key not found');
        }
      });

      // tech=40 <= custom sellTechMax=45 and fund=35 <= custom sellFundMax=40
      const ctx = makeContext({ techScore: 40, fundScore: 35, sentScore: 50 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('SELL');
    });

    it('falls back to defaults when config throws for some keys', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'ai.rules.buyTechMin') return 50; // only this key is available
        throw new Error('config key not found');
      });

      // tech=55 >= custom buyTechMin=50 and fund=60 >= default buyFundMin=55
      const ctx = makeContext({ techScore: 55, fundScore: 60, sentScore: 30 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('BUY');
    });

    it('applies custom risk config values to the decision', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        switch (key) {
          case 'risk.defaultStopLossPct':
            return 0.08;
          case 'risk.maxPositionSizePct':
            return 0.15;
          default:
            throw new Error('config key not found');
        }
      });

      const ctx = makeContext({ techScore: 50, fundScore: 50, sentScore: 50 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.suggestedStopLossPct).toBe(0.08);
      expect(result!.suggestedPositionSizePct).toBe(0.15);
    });
  });

  describe('conviction calculation', () => {
    it('calculates BUY conviction as average of tech and fund when only fund qualifies', async () => {
      // tech=70 >= 65, fund=60 >= 55, sent=30 < 60
      // scores = [70, 60], conviction = round((70+60)/2) = 65
      const ctx = makeContext({ techScore: 70, fundScore: 60, sentScore: 30 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('BUY');
      expect(result!.conviction).toBe(65);
      expect(result!.reasoning).toContain('2 signals aligned');
    });

    it('calculates BUY conviction as average of tech and sent when only sent qualifies', async () => {
      // tech=80 >= 65, fund=40 < 55, sent=70 >= 60
      // scores = [80, 70], conviction = round((80+70)/2) = 75
      const ctx = makeContext({ techScore: 80, fundScore: 40, sentScore: 70 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('BUY');
      expect(result!.conviction).toBe(75);
      expect(result!.reasoning).toContain('2 signals aligned');
    });

    it('calculates BUY conviction as average of all three when all qualify', async () => {
      // tech=90 >= 65, fund=80 >= 55, sent=70 >= 60
      // scores = [90, 80, 70], conviction = round((90+80+70)/3) = 80
      const ctx = makeContext({ techScore: 90, fundScore: 80, sentScore: 70 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('BUY');
      expect(result!.conviction).toBe(80);
      expect(result!.reasoning).toContain('3 signals aligned');
    });

    it('calculates SELL conviction as average of inverted tech and fund', async () => {
      // tech=20, fund=10
      // conviction = round(((100-20) + (100-10)) / 2) = round((80+90)/2) = 85
      const ctx = makeContext({ techScore: 20, fundScore: 10, sentScore: 50 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('SELL');
      expect(result!.conviction).toBe(85);
    });

    it('calculates SELL conviction at boundary values', async () => {
      // tech=35, fund=30
      // conviction = round(((100-35) + (100-30)) / 2) = round((65+70)/2) = 68
      const ctx = makeContext({ techScore: 35, fundScore: 30, sentScore: 50 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('SELL');
      expect(result!.conviction).toBe(68);
    });

    it('HOLD conviction is always 50', async () => {
      const ctx = makeContext({ techScore: 50, fundScore: 45, sentScore: 50 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('HOLD');
      expect(result!.conviction).toBe(50);
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
    it('returns all required AIDecision fields for a BUY', async () => {
      const ctx = makeContext({ techScore: 75, fundScore: 70, sentScore: 65 });
      const result = await engine.analyze(ctx);

      expect(result).not.toBeNull();
      expect(result).toHaveProperty('decision', 'BUY');
      expect(result).toHaveProperty('conviction');
      expect(result).toHaveProperty('reasoning');
      expect(result).toHaveProperty('risks');
      expect(result).toHaveProperty('suggestedStopLossPct');
      expect(result).toHaveProperty('suggestedPositionSizePct');
      expect(result).toHaveProperty('suggestedTakeProfitPct');
      expect(result).toHaveProperty('urgency');
      expect(result).toHaveProperty('exitConditions');
    });

    it('has default stop loss, position size, and take profit when config is unavailable', async () => {
      const ctx = makeContext({ techScore: 75, fundScore: 70, sentScore: 65 });
      const result = await engine.analyze(ctx);

      expect(result!.suggestedStopLossPct).toBe(0.05);
      expect(result!.suggestedPositionSizePct).toBe(0.1);
      expect(result!.suggestedTakeProfitPct).toBe(0.20);
    });

    it('sets urgency to "no_rush" for all decisions', async () => {
      const buyCtx = makeContext({ techScore: 75, fundScore: 70, sentScore: 65 });
      const holdCtx = makeContext({ techScore: 50, fundScore: 50, sentScore: 50 });
      const sellCtx = makeContext({ techScore: 20, fundScore: 15, sentScore: 50 });

      const buyResult = await engine.analyze(buyCtx);
      const holdResult = await engine.analyze(holdCtx);
      const sellResult = await engine.analyze(sellCtx);

      expect(buyResult!.urgency).toBe('no_rush');
      expect(holdResult!.urgency).toBe('no_rush');
      expect(sellResult!.urgency).toBe('no_rush');
    });

    it('sets exitConditions to empty string', async () => {
      const ctx = makeContext({ techScore: 75, fundScore: 70, sentScore: 65 });
      const result = await engine.analyze(ctx);

      expect(result!.exitConditions).toBe('');
    });

    it('includes risks array for BUY decisions', async () => {
      const ctx = makeContext({ techScore: 75, fundScore: 70, sentScore: 65 });
      const result = await engine.analyze(ctx);

      expect(result!.decision).toBe('BUY');
      expect(result!.risks).toEqual(['Rules-based, no nuanced analysis']);
    });

    it('returns empty risks array for SELL decisions', async () => {
      const ctx = makeContext({ techScore: 20, fundScore: 15, sentScore: 50 });
      const result = await engine.analyze(ctx);

      expect(result!.decision).toBe('SELL');
      expect(result!.risks).toEqual([]);
    });

    it('returns empty risks array for HOLD decisions', async () => {
      const ctx = makeContext({ techScore: 50, fundScore: 50, sentScore: 50 });
      const result = await engine.analyze(ctx);

      expect(result!.decision).toBe('HOLD');
      expect(result!.risks).toEqual([]);
    });
  });
});
