import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock external dependencies
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

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

vi.mock('../../src/ai/prompt-builder.js', () => ({
  buildAnalysisPrompt: vi.fn().mockReturnValue({
    system: 'mock system prompt',
    user: 'mock user prompt',
  }),
}));

vi.mock('../../src/ai/decision-processor.js', () => ({
  processAIDecision: vi.fn().mockReturnValue({
    decision: 'HOLD',
    conviction: 50,
    reasoning: 'test',
    risks: [],
    suggestedStopLossPct: 0.05,
    suggestedPositionSizePct: 0.05,
    suggestedTakeProfitPct: 0.1,
    urgency: 'no_rush',
    exitConditions: 'test',
  }),
}));

import { AnthropicAdapter } from '../../src/ai/adapters/anthropic.js';
import { configManager } from '../../src/config/manager.js';
import { processAIDecision } from '../../src/ai/decision-processor.js';
import type { AIContext } from '../../src/ai/agent.js';

function makeContext(): AIContext {
  return {
    symbol: 'AAPL',
    currentPrice: 150,
    priceChange1d: 0.01,
    priceChange5d: 0.02,
    priceChange1m: 0.05,
    technical: {
      rsi: 55, macdValue: 0.5, macdSignal: 0.3, macdHistogram: 0.2,
      sma20: 148, sma50: 145, sma200: 140,
      ema12: 149, ema26: 147,
      bollingerUpper: 155, bollingerMiddle: 150, bollingerLower: 145,
      atr: 2.5, adx: 25, stochasticK: 60, stochasticD: 55,
      williamsR: -40, mfi: 55, cci: 50, obv: 1000000, vwap: 150,
      parabolicSar: 148, roc: 2, forceIndex: 5000, volumeRatio: 1.1,
      support: 145, resistance: 155, score: 65,
    },
    fundamental: {
      peRatio: 25, forwardPE: 22, revenueGrowthYoY: 0.15,
      profitMargin: 0.25, operatingMargin: 0.3, debtToEquity: 1.5,
      currentRatio: 1.2, marketCap: 2.5e12, sector: 'Technology',
      beta: 1.1, dividendYield: 0.006, score: 70,
    },
    sentiment: {
      headlines: [{ title: 'AAPL beats earnings', score: 0.8, source: 'Reuters' }],
      insiderNetBuying: 5,
      daysToEarnings: 30,
      score: 60,
    },
    historicalSignals: [],
    portfolio: {
      cashAvailable: 10000, portfolioValue: 50000, openPositions: 2,
      maxPositions: 10, todayPnl: 100, todayPnlPct: 0.002,
      sectorExposure: { Technology: 2 },
      existingPositions: [],
    },
    marketContext: {
      spyPrice: 450, spyChange1d: 0.005, vixLevel: 15, marketTrend: 'bullish',
    },
    riskConstraints: {
      maxPositionSizePct: 0.1, maxStopLossPct: 0.08,
      minStopLossPct: 0.02, maxRiskPerTradePct: 0.02,
      dailyLossLimitPct: 0.03,
    },
  };
}

describe('AnthropicAdapter', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'ai.model') return 'claude-sonnet-4-20250514';
      if (key === 'ai.temperature') return 0.7;
      return undefined;
    });
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  describe('analyze', () => {
    it('calls Anthropic API and returns processed decision', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{"decision":"HOLD"}' }],
      });

      const adapter = new AnthropicAdapter();
      const result = await adapter.analyze(makeContext());

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          temperature: 0.7,
          system: 'mock system prompt',
          messages: [{ role: 'user', content: 'mock user prompt' }],
        }),
      );
      expect(processAIDecision).toHaveBeenCalledWith('{"decision":"HOLD"}');
      expect(result.decision).toBe('HOLD');
    });

    it('handles non-text content blocks by using empty string', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'image', source: {} }],
      });

      const adapter = new AnthropicAdapter();
      await adapter.analyze(makeContext());

      expect(processAIDecision).toHaveBeenCalledWith('');
    });

    it('throws when ANTHROPIC_API_KEY is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const adapter = new AnthropicAdapter();
      await expect(adapter.analyze(makeContext())).rejects.toThrow('ANTHROPIC_API_KEY not set');
    });

    it('propagates API errors', async () => {
      mockCreate.mockRejectedValue(new Error('API rate limit'));

      const adapter = new AnthropicAdapter();
      await expect(adapter.analyze(makeContext())).rejects.toThrow('API rate limit');
    });
  });

  describe('rawChat', () => {
    it('calls Anthropic API and returns text response', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello world' }],
      });

      const adapter = new AnthropicAdapter();
      const result = await adapter.rawChat('system prompt', 'user message');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          temperature: 0.7,
          system: 'system prompt',
          messages: [{ role: 'user', content: 'user message' }],
        }),
      );
      expect(result).toBe('Hello world');
    });

    it('returns empty string for non-text content', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'x', name: 'y', input: {} }],
      });

      const adapter = new AnthropicAdapter();
      const result = await adapter.rawChat('sys', 'usr');
      expect(result).toBe('');
    });

    it('throws when ANTHROPIC_API_KEY is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const adapter = new AnthropicAdapter();
      await expect(adapter.rawChat('sys', 'usr')).rejects.toThrow('ANTHROPIC_API_KEY not set');
    });

    it('propagates API errors', async () => {
      mockCreate.mockRejectedValue(new Error('Network error'));

      const adapter = new AnthropicAdapter();
      await expect(adapter.rawChat('sys', 'usr')).rejects.toThrow('Network error');
    });
  });
});
