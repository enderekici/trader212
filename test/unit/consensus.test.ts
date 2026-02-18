import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AIContext, AIDecision } from '../../src/ai/agent.js';
import type { ModelProfile } from '../../src/ai/adapters/openai-compat.js';

// We need to control what each adapter instance does per-test.
// Use a queue approach: each new OpenAICompatibleAdapter() pops from the queue.
const adapterQueue: Array<{ analyze: ReturnType<typeof vi.fn>; rawChat: ReturnType<typeof vi.fn> }> = [];

vi.mock('../../src/ai/adapters/openai-compat.js', () => ({
  OpenAICompatibleAdapter: vi.fn().mockImplementation(function () {
    const instance = adapterQueue.shift() ?? {
      analyze: vi.fn().mockResolvedValue(null),
      rawChat: vi.fn().mockResolvedValue(''),
    };
    Object.assign(this, instance);
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { ConsensusEngine } from '../../src/ai/consensus.js';
import { OpenAICompatibleAdapter } from '../../src/ai/adapters/openai-compat.js';

function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: 'model-a',
    baseUrl: 'http://localhost:8080/v1',
    model: 'gpt-4',
    apiKey: 'sk-test',
    weight: 1,
    enabled: true,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<AIDecision> = {}): AIDecision {
  return {
    decision: 'BUY',
    conviction: 70,
    reasoning: 'Strong uptrend',
    risks: ['volatility risk'],
    suggestedStopLossPct: 0.05,
    suggestedPositionSizePct: 0.1,
    suggestedTakeProfitPct: 0.15,
    urgency: 'no_rush',
    exitConditions: 'rsi > 75',
    ...overrides,
  };
}

function makeContext(): AIContext {
  return {
    symbol: 'AAPL',
    currentPrice: 180,
    priceChange1d: 0.01,
    priceChange5d: 0.02,
    priceChange1m: 0.05,
    technical: {
      rsi: 55, macdValue: 1, macdSignal: 0.5, macdHistogram: 0.5,
      sma20: 175, sma50: 170, sma200: 160,
      ema12: 178, ema26: 172,
      bollingerUpper: 190, bollingerMiddle: 178, bollingerLower: 165,
      atr: 3, adx: 25, stochasticK: 60, stochasticD: 55,
      williamsR: -40, mfi: 55, cci: 50, obv: 1000000, vwap: 179,
      parabolicSar: 172, roc: 2, forceIndex: 5000, volumeRatio: 1.1,
      support: 170, resistance: 190, score: 65,
      candlestickBullish: null, candlestickBearish: null, candlestickNeutral: null,
    },
    fundamental: {
      peRatio: 28, forwardPE: 24, revenueGrowthYoY: 0.08,
      profitMargin: 0.25, operatingMargin: 0.30, debtToEquity: 1.5,
      currentRatio: 1.0, marketCap: 2.8e12, sector: 'Technology',
      beta: 1.2, dividendYield: 0.005, score: 70,
    },
    sentiment: {
      headlines: [{ title: 'AAPL beats earnings', score: 0.8, source: 'Reuters' }],
      insiderNetBuying: 5,
      daysToEarnings: 45,
      score: 65,
    },
    historicalSignals: [],
    portfolio: {
      cashAvailable: 20000, portfolioValue: 100000, openPositions: 3,
      maxPositions: 10, todayPnl: 200, todayPnlPct: 0.002,
      sectorExposure: { Technology: 0.3 },
      sectorExposureValue: { Technology: 30000 },
      existingPositions: [],
    },
    marketContext: {
      spyPrice: 450, spyChange1d: 0.005, vixLevel: 15, marketTrend: 'bullish',
    },
    riskConstraints: {
      maxPositionSizePct: 0.15, maxStopLossPct: 0.08,
      minStopLossPct: 0.02, maxRiskPerTradePct: 0.02,
      dailyLossLimitPct: 0.03,
    },
  };
}

/** Push per-call mock behavior into the queue */
function pushAdapter(arg: AIDecision | null | Error): void {
  if (arg instanceof Error) {
    adapterQueue.push({
      analyze: vi.fn().mockRejectedValue(arg),
      rawChat: vi.fn().mockRejectedValue(arg),
    });
  } else {
    adapterQueue.push({
      analyze: vi.fn().mockResolvedValue(arg),
      rawChat: vi.fn().mockResolvedValue(''),
    });
  }
}

describe('ConsensusEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterQueue.length = 0;
  });

  describe('majority mode', () => {
    it('returns the majority decision when ≥ minAgree models agree', async () => {
      const profiles = [
        makeProfile({ id: 'a', weight: 1 }),
        makeProfile({ id: 'b', weight: 1 }),
        makeProfile({ id: 'c', weight: 1 }),
      ];

      pushAdapter(makeDecision({ decision: 'BUY', conviction: 80, reasoning: 'A: bullish' }));
      pushAdapter(makeDecision({ decision: 'BUY', conviction: 60, reasoning: 'B: bullish' }));
      pushAdapter(makeDecision({ decision: 'HOLD', conviction: 50, reasoning: 'C: neutral' }));

      const engine = new ConsensusEngine(profiles, 'majority', 2);
      const result = await engine.analyze(makeContext());

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('BUY');
      // Conviction should be average of agreeing models (80+60)/2 = 70
      expect(result!.conviction).toBe(70);
    });

    it('returns null when no decision meets minAgree threshold', async () => {
      const profiles = [
        makeProfile({ id: 'a' }),
        makeProfile({ id: 'b' }),
        makeProfile({ id: 'c' }),
      ];

      pushAdapter(makeDecision({ decision: 'BUY' }));
      pushAdapter(makeDecision({ decision: 'SELL' }));
      pushAdapter(makeDecision({ decision: 'HOLD' }));

      const engine = new ConsensusEngine(profiles, 'majority', 2);
      const result = await engine.analyze(makeContext());

      expect(result).toBeNull();
    });

    it('handles unknown decision type via ?? 0 fallback (lines 65, 83-84)', async () => {
      // Cast an invalid decision type to bypass TypeScript - adds new key to counts
      const profiles = [
        makeProfile({ id: 'a', weight: 1 }),
        makeProfile({ id: 'b', weight: 1 }),
        makeProfile({ id: 'c', weight: 1 }),
      ];
      pushAdapter(makeDecision({ decision: 'STRONG_BUY' as AIDecision['decision'] }));
      pushAdapter(makeDecision({ decision: 'BUY' }));
      pushAdapter(makeDecision({ decision: 'BUY' }));

      const engine = new ConsensusEngine(profiles, 'majority', 2);
      const result = await engine.analyze(makeContext());
      expect(result!.decision).toBe('BUY');
    });

    it('handles unknown decision type in weighted mode via ?? 0 fallback (lines 83-84)', async () => {
      const profiles = [
        makeProfile({ id: 'a', weight: 2 }),
        makeProfile({ id: 'b', weight: 1 }),
        makeProfile({ id: 'c', weight: 1 }),
      ];
      pushAdapter(makeDecision({ decision: 'STRONG_SELL' as AIDecision['decision'] }));
      pushAdapter(makeDecision({ decision: 'SELL' }));
      pushAdapter(makeDecision({ decision: 'SELL' }));

      const engine = new ConsensusEngine(profiles, 'weighted', 2);
      const result = await engine.analyze(makeContext());
      expect(result!.decision).toBe('SELL');
    });
  });

  describe('weighted mode', () => {
    it('picks the decision with the highest weight sum', async () => {
      const profiles = [
        makeProfile({ id: 'heavy', weight: 10 }),
        makeProfile({ id: 'light1', weight: 1 }),
        makeProfile({ id: 'light2', weight: 1 }),
      ];

      // heavy model says SELL; two light models say BUY (outvoted by weight)
      pushAdapter(makeDecision({ decision: 'SELL', conviction: 90, reasoning: 'heavy: bearish' }));
      pushAdapter(makeDecision({ decision: 'BUY', conviction: 60, reasoning: 'light1: bullish' }));
      pushAdapter(makeDecision({ decision: 'BUY', conviction: 50, reasoning: 'light2: bullish' }));

      const engine = new ConsensusEngine(profiles, 'weighted', 1);
      const result = await engine.analyze(makeContext());

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('SELL');
    });

    it('returns null when weighted winner count < minAgree', async () => {
      const profiles = [
        makeProfile({ id: 'a', weight: 5 }),
        makeProfile({ id: 'b', weight: 3 }),
        makeProfile({ id: 'c', weight: 1 }),
      ];

      // each model votes differently — no count >= 2
      pushAdapter(makeDecision({ decision: 'BUY' }));
      pushAdapter(makeDecision({ decision: 'SELL' }));
      pushAdapter(makeDecision({ decision: 'HOLD' }));

      const engine = new ConsensusEngine(profiles, 'weighted', 2);
      const result = await engine.analyze(makeContext());

      expect(result).toBeNull();
    });

    it('uses weight=1 when profile.weight is undefined', async () => {
      const profiles = [
        // weight deliberately omitted → coerced by makeProfile to 1
        makeProfile({ id: 'a', weight: undefined as unknown as number }),
        makeProfile({ id: 'b', weight: undefined as unknown as number }),
      ];

      pushAdapter(makeDecision({ decision: 'BUY', conviction: 80 }));
      pushAdapter(makeDecision({ decision: 'BUY', conviction: 60 }));

      const engine = new ConsensusEngine(profiles, 'weighted', 2);
      const result = await engine.analyze(makeContext());

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('BUY');
    });
  });

  describe('unanimous mode', () => {
    it('returns decision when all models agree', async () => {
      const profiles = [makeProfile({ id: 'a' }), makeProfile({ id: 'b' })];

      pushAdapter(makeDecision({ decision: 'BUY', reasoning: 'A:bull' }));
      pushAdapter(makeDecision({ decision: 'BUY', reasoning: 'B:bull' }));

      const engine = new ConsensusEngine(profiles, 'unanimous', 1);
      const result = await engine.analyze(makeContext());

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('BUY');
    });

    it('returns null when models disagree', async () => {
      const profiles = [makeProfile({ id: 'a' }), makeProfile({ id: 'b' })];

      pushAdapter(makeDecision({ decision: 'BUY' }));
      pushAdapter(makeDecision({ decision: 'SELL' }));

      const engine = new ConsensusEngine(profiles, 'unanimous', 1);
      const result = await engine.analyze(makeContext());

      expect(result).toBeNull();
    });
  });

  describe('merged output', () => {
    it('merges reasoning with model id prefixes', async () => {
      const profiles = [
        makeProfile({ id: 'alpha', weight: 1 }),
        makeProfile({ id: 'beta', weight: 1 }),
      ];

      pushAdapter(makeDecision({ decision: 'BUY', reasoning: 'alpha thinks buy' }));
      pushAdapter(makeDecision({ decision: 'BUY', reasoning: 'beta also buy' }));

      const engine = new ConsensusEngine(profiles, 'unanimous', 1);
      const result = await engine.analyze(makeContext());

      expect(result!.reasoning).toContain('[alpha]');
      expect(result!.reasoning).toContain('[beta]');
    });

    it('deduplicates risks from multiple models', async () => {
      const profiles = [makeProfile({ id: 'a', weight: 1 }), makeProfile({ id: 'b', weight: 1 })];

      pushAdapter(makeDecision({ decision: 'BUY', risks: ['risk-X', 'risk-Y'] }));
      pushAdapter(makeDecision({ decision: 'BUY', risks: ['risk-Y', 'risk-Z'] }));

      const engine = new ConsensusEngine(profiles, 'unanimous', 1);
      const result = await engine.analyze(makeContext());

      expect(result!.risks).toEqual(expect.arrayContaining(['risk-X', 'risk-Y', 'risk-Z']));
      expect(result!.risks.length).toBe(3); // no duplicates
    });

    it('uses empty string exitConditions when all models have empty/whitespace exitConditions', async () => {
      const profiles = [makeProfile({ id: 'a', weight: 1 }), makeProfile({ id: 'b', weight: 1 })];

      pushAdapter(makeDecision({ decision: 'BUY', exitConditions: '   ' }));
      pushAdapter(makeDecision({ decision: 'BUY', exitConditions: '' }));

      const engine = new ConsensusEngine(profiles, 'unanimous', 1);
      const result = await engine.analyze(makeContext());

      expect(result).not.toBeNull();
      expect(result!.exitConditions).toBe('');
    });

    it('resolves urgency tie by keeping the first (a >= b always wins)', async () => {
      const profiles = [
        makeProfile({ id: 'a', weight: 1 }),
        makeProfile({ id: 'b', weight: 1 }),
        makeProfile({ id: 'c', weight: 1 }),
        makeProfile({ id: 'd', weight: 1 }),
      ];

      // 2 immediate, 2 no_rush — tie goes to immediate (first in reduce)
      pushAdapter(makeDecision({ decision: 'BUY', urgency: 'immediate' }));
      pushAdapter(makeDecision({ decision: 'BUY', urgency: 'immediate' }));
      pushAdapter(makeDecision({ decision: 'BUY', urgency: 'no_rush' }));
      pushAdapter(makeDecision({ decision: 'BUY', urgency: 'no_rush' }));

      const engine = new ConsensusEngine(profiles, 'majority', 2);
      const result = await engine.analyze(makeContext());

      expect(result).not.toBeNull();
      // Tie: both have count 2, reduce keeps a (immediate) since a >= b
      expect(result!.urgency).toBe('immediate');
    });

    it('resolves urgency when second value has strictly higher count (b wins via < branch)', async () => {
      const profiles = [
        makeProfile({ id: 'a', weight: 1 }),
        makeProfile({ id: 'b', weight: 1 }),
        makeProfile({ id: 'c', weight: 1 }),
      ];

      // 1 immediate + 2 no_rush → no_rush (b) wins because urgencyCounts[a] < urgencyCounts[b]
      pushAdapter(makeDecision({ decision: 'BUY', urgency: 'immediate' }));
      pushAdapter(makeDecision({ decision: 'BUY', urgency: 'no_rush' }));
      pushAdapter(makeDecision({ decision: 'BUY', urgency: 'no_rush' }));

      const engine = new ConsensusEngine(profiles, 'majority', 2);
      const result = await engine.analyze(makeContext());

      expect(result).not.toBeNull();
      expect(result!.urgency).toBe('no_rush');
    });
  });

  describe('error handling', () => {
    it('treats null-returning adapter as a failed model (line 33)', async () => {
      // pushAdapter(null) → adapter.analyze() resolves null → throw inside Promise → rejected settlement
      const profiles = [makeProfile({ id: 'a' }), makeProfile({ id: 'b' })];
      pushAdapter(null); // returns null → triggers line 33 throw
      pushAdapter(makeDecision({ decision: 'BUY' })); // succeeds
      const engine = new ConsensusEngine(profiles, 'majority', 1);
      const result = await engine.analyze(makeContext());
      expect(result).not.toBeNull();
      expect(result!.decision).toBe('BUY');
    });

    it('returns null when all model calls fail', async () => {
      const profiles = [makeProfile({ id: 'a' }), makeProfile({ id: 'b' })];

      pushAdapter(new Error('API error'));
      pushAdapter(new Error('API error'));

      const engine = new ConsensusEngine(profiles, 'majority', 1);
      const result = await engine.analyze(makeContext());

      expect(result).toBeNull();
    });

    it('continues with successful models when some fail', async () => {
      const profiles = [makeProfile({ id: 'a' }), makeProfile({ id: 'b' })];

      pushAdapter(new Error('model A failed'));
      pushAdapter(makeDecision({ decision: 'SELL' }));

      const engine = new ConsensusEngine(profiles, 'majority', 1);
      const result = await engine.analyze(makeContext());

      expect(result).not.toBeNull();
      expect(result!.decision).toBe('SELL');
    });

    it('returns null when no profiles are enabled', async () => {
      const profiles: ModelProfile[] = [];
      const engine = new ConsensusEngine(profiles, 'majority', 1);
      const result = await engine.analyze(makeContext());
      expect(result).toBeNull();
    });
  });

  describe('rawChat', () => {
    it('uses the first enabled profile for rawChat', async () => {
      const profiles = [makeProfile({ id: 'first' }), makeProfile({ id: 'second' })];
      const mockRawChat = vi.fn().mockResolvedValue('pong');
      adapterQueue.push({
        analyze: vi.fn(),
        rawChat: mockRawChat,
      });

      const engine = new ConsensusEngine(profiles, 'majority', 1);
      const result = await engine.rawChat('system', 'user');

      expect(result).toBe('pong');
      // Only one adapter should be created for rawChat
      expect(OpenAICompatibleAdapter).toHaveBeenCalledOnce();
    });

    it('throws when no profiles are available for rawChat', async () => {
      const engine = new ConsensusEngine([], 'majority', 1);
      await expect(engine.rawChat('sys', 'usr')).rejects.toThrow('no enabled profiles');
    });
  });
});

