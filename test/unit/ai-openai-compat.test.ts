import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock external dependencies
const mockPost = vi.fn();
vi.mock('axios', () => ({
  default: {
    post: (...args: unknown[]) => mockPost(...args),
  },
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
    decision: 'SELL',
    conviction: 70,
    reasoning: 'bearish signals',
    risks: ['reversal risk'],
    suggestedStopLossPct: 0.03,
    suggestedPositionSizePct: 0.05,
    suggestedTakeProfitPct: 0.1,
    urgency: 'immediate',
    exitConditions: 'take profit hit',
  }),
}));

import { OpenAICompatibleAdapter } from '../../src/ai/adapters/openai-compat.js';
import { configManager } from '../../src/config/manager.js';
import { processAIDecision } from '../../src/ai/decision-processor.js';
import type { AIContext } from '../../src/ai/agent.js';

function makeContext(): AIContext {
  return {
    symbol: 'TSLA',
    currentPrice: 250,
    priceChange1d: -0.03,
    priceChange5d: -0.05,
    priceChange1m: -0.1,
    technical: {
      rsi: 30, macdValue: -1, macdSignal: -0.5, macdHistogram: -0.5,
      sma20: 260, sma50: 270, sma200: 280,
      ema12: 255, ema26: 262,
      bollingerUpper: 280, bollingerMiddle: 265, bollingerLower: 250,
      atr: 8, adx: 35, stochasticK: 20, stochasticD: 25,
      williamsR: -80, mfi: 30, cci: -100, obv: 500000, vwap: 252,
      parabolicSar: 265, roc: -5, forceIndex: -3000, volumeRatio: 1.5,
      support: 240, resistance: 270, score: 30,
    },
    fundamental: {
      peRatio: 60, forwardPE: 45, revenueGrowthYoY: 0.2,
      profitMargin: 0.1, operatingMargin: 0.08, debtToEquity: 0.5,
      currentRatio: 1.5, marketCap: 800e9, sector: 'Consumer Cyclical',
      beta: 2.0, dividendYield: null, score: 40,
    },
    sentiment: {
      headlines: [{ title: 'TSLA misses delivery targets', score: -0.6, source: 'Bloomberg' }],
      insiderNetBuying: -2,
      daysToEarnings: 10,
      score: 35,
    },
    historicalSignals: [],
    portfolio: {
      cashAvailable: 15000, portfolioValue: 80000, openPositions: 5,
      maxPositions: 10, todayPnl: -300, todayPnlPct: -0.00375,
      sectorExposure: { 'Consumer Cyclical': 1 },
      existingPositions: [
        { symbol: 'TSLA', pnlPct: -0.05, entryPrice: 263, currentPrice: 250 },
      ],
    },
    marketContext: {
      spyPrice: 440, spyChange1d: -0.01, vixLevel: 22, marketTrend: 'bearish',
    },
    riskConstraints: {
      maxPositionSizePct: 0.1, maxStopLossPct: 0.08,
      minStopLossPct: 0.02, maxRiskPerTradePct: 0.02,
      dailyLossLimitPct: 0.03,
    },
  };
}

describe('OpenAICompatibleAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'ai.openaiCompat.baseUrl') return 'http://localhost:8080/v1';
      if (key === 'ai.openaiCompat.model') return 'gpt-4';
      if (key === 'ai.openaiCompat.apiKey') return 'sk-test-key';
      if (key === 'ai.temperature') return 0.5;
      if (key === 'ai.timeoutSeconds') return 90;
      return undefined;
    });
  });

  describe('analyze', () => {
    it('calls OpenAI-compatible API with correct parameters and auth header', async () => {
      mockPost.mockResolvedValue({
        data: {
          choices: [{ message: { content: '{"decision":"SELL"}' } }],
        },
      });

      const adapter = new OpenAICompatibleAdapter();
      const result = await adapter.analyze(makeContext());

      expect(mockPost).toHaveBeenCalledOnce();
      expect(mockPost).toHaveBeenCalledWith(
        'http://localhost:8080/v1/chat/completions',
        {
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'mock system prompt' },
            { role: 'user', content: 'mock user prompt' },
          ],
          temperature: 0.5,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer sk-test-key',
          },
          timeout: 90000,
        },
      );
      expect(processAIDecision).toHaveBeenCalledWith('{"decision":"SELL"}');
      expect(result.decision).toBe('SELL');
    });

    it('omits Authorization header when apiKey is empty', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'ai.openaiCompat.baseUrl') return 'http://localhost:8080/v1';
        if (key === 'ai.openaiCompat.model') return 'gpt-4';
        if (key === 'ai.openaiCompat.apiKey') return '';
        if (key === 'ai.temperature') return 0.5;
        if (key === 'ai.timeoutSeconds') return 90;
        return undefined;
      });

      mockPost.mockResolvedValue({
        data: { choices: [{ message: { content: '{}' } }] },
      });

      const adapter = new OpenAICompatibleAdapter();
      await adapter.analyze(makeContext());

      const callHeaders = mockPost.mock.calls[0][2].headers;
      expect(callHeaders).not.toHaveProperty('Authorization');
      expect(callHeaders['Content-Type']).toBe('application/json');
    });

    it('propagates API errors', async () => {
      mockPost.mockRejectedValue(new Error('502 Bad Gateway'));

      const adapter = new OpenAICompatibleAdapter();
      await expect(adapter.analyze(makeContext())).rejects.toThrow('502 Bad Gateway');
    });
  });

  describe('rawChat', () => {
    it('calls OpenAI-compatible API and returns raw text', async () => {
      mockPost.mockResolvedValue({
        data: {
          choices: [{ message: { content: 'Research results here...' } }],
        },
      });

      const adapter = new OpenAICompatibleAdapter();
      const result = await adapter.rawChat('system', 'user msg');

      expect(mockPost).toHaveBeenCalledWith(
        'http://localhost:8080/v1/chat/completions',
        {
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'system' },
            { role: 'user', content: 'user msg' },
          ],
          temperature: 0.5,
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test-key',
          }),
          timeout: 90000,
        }),
      );
      expect(result).toBe('Research results here...');
    });

    it('omits Authorization header when apiKey is empty in rawChat', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'ai.openaiCompat.baseUrl') return 'http://localhost:8080/v1';
        if (key === 'ai.openaiCompat.model') return 'gpt-4';
        if (key === 'ai.openaiCompat.apiKey') return '';
        if (key === 'ai.temperature') return 0.5;
        if (key === 'ai.timeoutSeconds') return 90;
        return undefined;
      });

      mockPost.mockResolvedValue({
        data: { choices: [{ message: { content: 'ok' } }] },
      });

      const adapter = new OpenAICompatibleAdapter();
      await adapter.rawChat('sys', 'usr');

      const callHeaders = mockPost.mock.calls[0][2].headers;
      expect(callHeaders).not.toHaveProperty('Authorization');
    });

    it('propagates API errors', async () => {
      mockPost.mockRejectedValue(new Error('Service unavailable'));

      const adapter = new OpenAICompatibleAdapter();
      await expect(adapter.rawChat('sys', 'usr')).rejects.toThrow('Service unavailable');
    });
  });
});
