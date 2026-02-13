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
    decision: 'BUY',
    conviction: 80,
    reasoning: 'strong signals',
    risks: ['market risk'],
    suggestedStopLossPct: 0.05,
    suggestedPositionSizePct: 0.08,
    suggestedTakeProfitPct: 0.15,
    urgency: 'immediate',
    exitConditions: 'stop loss hit',
  }),
}));

import { OllamaAdapter } from '../../src/ai/adapters/ollama.js';
import { configManager } from '../../src/config/manager.js';
import { processAIDecision } from '../../src/ai/decision-processor.js';
import type { AIContext } from '../../src/ai/agent.js';

function makeContext(): AIContext {
  return {
    symbol: 'MSFT',
    currentPrice: 400,
    priceChange1d: 0.02,
    priceChange5d: 0.03,
    priceChange1m: 0.08,
    technical: {
      rsi: 65, macdValue: 1.2, macdSignal: 0.8, macdHistogram: 0.4,
      sma20: 395, sma50: 390, sma200: 370,
      ema12: 398, ema26: 394,
      bollingerUpper: 410, bollingerMiddle: 400, bollingerLower: 390,
      atr: 5, adx: 30, stochasticK: 70, stochasticD: 65,
      williamsR: -30, mfi: 60, cci: 80, obv: 2000000, vwap: 399,
      parabolicSar: 395, roc: 3, forceIndex: 8000, volumeRatio: 1.3,
      support: 390, resistance: 410, score: 75,
    },
    fundamental: {
      peRatio: 30, forwardPE: 28, revenueGrowthYoY: 0.12,
      profitMargin: 0.35, operatingMargin: 0.4, debtToEquity: 0.8,
      currentRatio: 2.0, marketCap: 3e12, sector: 'Technology',
      beta: 0.9, dividendYield: 0.008, score: 72,
    },
    sentiment: {
      headlines: [],
      insiderNetBuying: 3,
      daysToEarnings: null,
      score: 55,
    },
    historicalSignals: [],
    portfolio: {
      cashAvailable: 20000, portfolioValue: 100000, openPositions: 3,
      maxPositions: 10, todayPnl: 200, todayPnlPct: 0.002,
      sectorExposure: {}, existingPositions: [],
    },
    marketContext: {
      spyPrice: 450, spyChange1d: 0.003, vixLevel: 14, marketTrend: 'bullish',
    },
    riskConstraints: {
      maxPositionSizePct: 0.1, maxStopLossPct: 0.08,
      minStopLossPct: 0.02, maxRiskPerTradePct: 0.02,
      dailyLossLimitPct: 0.03,
    },
  };
}

describe('OllamaAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'ai.ollama.baseUrl') return 'http://localhost:11434';
      if (key === 'ai.ollama.model') return 'llama3';
      if (key === 'ai.timeoutSeconds') return 120;
      return undefined;
    });
  });

  describe('analyze', () => {
    it('calls Ollama API with correct parameters and returns processed decision', async () => {
      mockPost.mockResolvedValue({
        data: {
          message: { content: '{"decision":"BUY","conviction":80}' },
        },
      });

      const adapter = new OllamaAdapter();
      const result = await adapter.analyze(makeContext());

      expect(mockPost).toHaveBeenCalledOnce();
      expect(mockPost).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        {
          model: 'llama3',
          messages: [
            { role: 'system', content: 'mock system prompt' },
            { role: 'user', content: 'mock user prompt' },
          ],
          stream: false,
          format: 'json',
        },
        { timeout: 120000 },
      );
      expect(processAIDecision).toHaveBeenCalledWith('{"decision":"BUY","conviction":80}');
      expect(result.decision).toBe('BUY');
      expect(result.conviction).toBe(80);
    });

    it('propagates API errors', async () => {
      mockPost.mockRejectedValue(new Error('Connection refused'));

      const adapter = new OllamaAdapter();
      await expect(adapter.analyze(makeContext())).rejects.toThrow('Connection refused');
    });

    it('uses correct timeout from config', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'ai.ollama.baseUrl') return 'http://localhost:11434';
        if (key === 'ai.ollama.model') return 'llama3';
        if (key === 'ai.timeoutSeconds') return 60;
        return undefined;
      });

      mockPost.mockResolvedValue({
        data: { message: { content: '{}' } },
      });

      const adapter = new OllamaAdapter();
      await adapter.analyze(makeContext());

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        { timeout: 60000 },
      );
    });
  });

  describe('rawChat', () => {
    it('calls Ollama API and returns raw content', async () => {
      mockPost.mockResolvedValue({
        data: {
          message: { content: 'Here is my analysis...' },
        },
      });

      const adapter = new OllamaAdapter();
      const result = await adapter.rawChat('system prompt', 'user message');

      expect(mockPost).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        {
          model: 'llama3',
          messages: [
            { role: 'system', content: 'system prompt' },
            { role: 'user', content: 'user message' },
          ],
          stream: false,
        },
        { timeout: 120000 },
      );
      expect(result).toBe('Here is my analysis...');
    });

    it('does not include format:json for rawChat', async () => {
      mockPost.mockResolvedValue({
        data: { message: { content: 'response' } },
      });

      const adapter = new OllamaAdapter();
      await adapter.rawChat('sys', 'usr');

      const callBody = mockPost.mock.calls[0][1];
      expect(callBody).not.toHaveProperty('format');
    });

    it('propagates API errors', async () => {
      mockPost.mockRejectedValue(new Error('Timeout'));

      const adapter = new OllamaAdapter();
      await expect(adapter.rawChat('sys', 'usr')).rejects.toThrow('Timeout');
    });
  });
});
