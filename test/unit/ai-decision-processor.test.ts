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

import { processAIDecision } from '../../src/ai/decision-processor.js';
import { configManager } from '../../src/config/manager.js';

describe('processAIDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'risk.minStopLossPct') return 0.02;
      if (key === 'risk.maxStopLossPct') return 0.08;
      if (key === 'risk.maxPositionSizePct') return 0.15;
      return undefined;
    });
  });

  const validDecision = {
    decision: 'BUY',
    conviction: 75,
    reasoning: 'Strong technical and fundamental signals',
    risks: ['Market downturn', 'Earnings miss'],
    suggestedStopLossPct: 0.05,
    suggestedPositionSizePct: 0.08,
    suggestedTakeProfitPct: 0.15,
    urgency: 'immediate',
    exitConditions: 'Stop loss at 5% or take profit at 15%',
  };

  describe('valid JSON parsing', () => {
    it('parses valid JSON string correctly', () => {
      const result = processAIDecision(JSON.stringify(validDecision));

      expect(result.decision).toBe('BUY');
      expect(result.conviction).toBe(75);
      expect(result.reasoning).toBe('Strong technical and fundamental signals');
      expect(result.risks).toEqual(['Market downturn', 'Earnings miss']);
      expect(result.suggestedStopLossPct).toBe(0.05);
      expect(result.suggestedPositionSizePct).toBe(0.08);
      expect(result.suggestedTakeProfitPct).toBe(0.15);
      expect(result.urgency).toBe('immediate');
      expect(result.exitConditions).toBe('Stop loss at 5% or take profit at 15%');
    });

    it('parses SELL decision', () => {
      const result = processAIDecision(
        JSON.stringify({ ...validDecision, decision: 'SELL' }),
      );
      expect(result.decision).toBe('SELL');
    });

    it('parses HOLD decision', () => {
      const result = processAIDecision(
        JSON.stringify({ ...validDecision, decision: 'HOLD' }),
      );
      expect(result.decision).toBe('HOLD');
    });

    it('parses wait_for_dip urgency', () => {
      const result = processAIDecision(
        JSON.stringify({ ...validDecision, urgency: 'wait_for_dip' }),
      );
      expect(result.urgency).toBe('wait_for_dip');
    });

    it('parses no_rush urgency', () => {
      const result = processAIDecision(
        JSON.stringify({ ...validDecision, urgency: 'no_rush' }),
      );
      expect(result.urgency).toBe('no_rush');
    });
  });

  describe('extractJson - think tags', () => {
    it('strips <think>...</think> tags before parsing', () => {
      const raw = `<think>Let me analyze this carefully...</think>
${JSON.stringify(validDecision)}`;

      const result = processAIDecision(raw);
      expect(result.decision).toBe('BUY');
      expect(result.conviction).toBe(75);
    });

    it('strips multiple think blocks', () => {
      const raw = `<think>First thought</think>
<think>Second thought</think>
${JSON.stringify(validDecision)}`;

      const result = processAIDecision(raw);
      expect(result.decision).toBe('BUY');
    });

    it('strips think tags with multiline content', () => {
      const raw = `<think>
Let me think step by step:
1. RSI is oversold
2. MACD showing divergence
3. Volume increasing
</think>
${JSON.stringify(validDecision)}`;

      const result = processAIDecision(raw);
      expect(result.decision).toBe('BUY');
    });
  });

  describe('extractJson - code blocks', () => {
    it('extracts JSON from ```json code block', () => {
      const raw = `Here is my analysis:
\`\`\`json
${JSON.stringify(validDecision)}
\`\`\``;

      const result = processAIDecision(raw);
      expect(result.decision).toBe('BUY');
    });

    it('extracts JSON from ``` code block without language', () => {
      const raw = `\`\`\`
${JSON.stringify(validDecision)}
\`\`\``;

      const result = processAIDecision(raw);
      expect(result.decision).toBe('BUY');
    });

    it('extracts JSON from code block with think tags', () => {
      const raw = `<think>Analyzing...</think>
\`\`\`json
${JSON.stringify(validDecision)}
\`\`\``;

      const result = processAIDecision(raw);
      expect(result.decision).toBe('BUY');
    });
  });

  describe('extractJson - raw JSON object', () => {
    it('extracts JSON object from surrounding text', () => {
      const raw = `Based on my analysis, here is the decision:
${JSON.stringify(validDecision)}
That concludes my analysis.`;

      const result = processAIDecision(raw);
      expect(result.decision).toBe('BUY');
    });
  });

  describe('extractJson - plain text fallback', () => {
    it('returns trimmed text when no JSON pattern found', () => {
      const raw = 'no json here at all';
      const result = processAIDecision(raw);
      // Should default to HOLD because JSON.parse will fail
      expect(result.decision).toBe('HOLD');
      expect(result.conviction).toBe(0);
      expect(result.reasoning).toContain('AI response parsing failed');
    });
  });

  describe('safety clamping', () => {
    it('clamps conviction to 0-100 range (too high)', () => {
      const result = processAIDecision(
        JSON.stringify({ ...validDecision, conviction: 150 }),
      );
      expect(result.conviction).toBe(100);
    });

    it('clamps conviction to 0-100 range (too low)', () => {
      const result = processAIDecision(
        JSON.stringify({ ...validDecision, conviction: -10 }),
      );
      expect(result.conviction).toBe(0);
    });

    it('clamps suggestedStopLossPct to configured min/max', () => {
      // minStopLoss = 0.02, maxStopLoss = 0.08
      const resultTooLow = processAIDecision(
        JSON.stringify({ ...validDecision, suggestedStopLossPct: 0.001 }),
      );
      expect(resultTooLow.suggestedStopLossPct).toBe(0.02);

      const resultTooHigh = processAIDecision(
        JSON.stringify({ ...validDecision, suggestedStopLossPct: 0.5 }),
      );
      expect(resultTooHigh.suggestedStopLossPct).toBe(0.08);
    });

    it('clamps suggestedPositionSizePct to 0.01 - maxPositionSize', () => {
      // maxPositionSize = 0.15
      const resultTooLow = processAIDecision(
        JSON.stringify({ ...validDecision, suggestedPositionSizePct: 0.001 }),
      );
      expect(resultTooLow.suggestedPositionSizePct).toBe(0.01);

      const resultTooHigh = processAIDecision(
        JSON.stringify({ ...validDecision, suggestedPositionSizePct: 0.5 }),
      );
      expect(resultTooHigh.suggestedPositionSizePct).toBe(0.15);
    });

    it('clamps suggestedTakeProfitPct to 0.02-0.5', () => {
      const resultTooLow = processAIDecision(
        JSON.stringify({ ...validDecision, suggestedTakeProfitPct: 0.001 }),
      );
      expect(resultTooLow.suggestedTakeProfitPct).toBe(0.02);

      const resultTooHigh = processAIDecision(
        JSON.stringify({ ...validDecision, suggestedTakeProfitPct: 0.9 }),
      );
      expect(resultTooHigh.suggestedTakeProfitPct).toBe(0.5);
    });

    it('does not alter values already within range', () => {
      const result = processAIDecision(JSON.stringify(validDecision));
      expect(result.suggestedStopLossPct).toBe(0.05);
      expect(result.suggestedPositionSizePct).toBe(0.08);
      expect(result.suggestedTakeProfitPct).toBe(0.15);
      expect(result.conviction).toBe(75);
    });
  });

  describe('error handling - defaults to HOLD', () => {
    it('returns default HOLD for completely invalid JSON', () => {
      const result = processAIDecision('this is not json at all {}{}{}');
      expect(result.decision).toBe('HOLD');
      expect(result.conviction).toBe(0);
      expect(result.reasoning).toContain('AI response parsing failed');
      expect(result.risks).toEqual(['AI response could not be parsed']);
      expect(result.suggestedStopLossPct).toBe(0.05);
      expect(result.suggestedPositionSizePct).toBe(0.03);
      expect(result.suggestedTakeProfitPct).toBe(0.1);
      expect(result.urgency).toBe('no_rush');
      expect(result.exitConditions).toContain('defaulted to HOLD');
    });

    it('returns default HOLD for empty string', () => {
      const result = processAIDecision('');
      expect(result.decision).toBe('HOLD');
      expect(result.conviction).toBe(0);
    });

    it('returns default HOLD when decision field is invalid enum value', () => {
      const result = processAIDecision(
        JSON.stringify({ ...validDecision, decision: 'MAYBE' }),
      );
      expect(result.decision).toBe('HOLD');
      expect(result.reasoning).toContain('AI response parsing failed');
    });

    it('returns default HOLD when urgency is invalid', () => {
      const result = processAIDecision(
        JSON.stringify({ ...validDecision, urgency: 'right_now' }),
      );
      expect(result.decision).toBe('HOLD');
    });

    it('returns default HOLD when required fields are missing', () => {
      const result = processAIDecision(
        JSON.stringify({ decision: 'BUY' }),
      );
      expect(result.decision).toBe('HOLD');
    });

    it('returns default HOLD when conviction is not a number', () => {
      const result = processAIDecision(
        JSON.stringify({ ...validDecision, conviction: 'high' }),
      );
      expect(result.decision).toBe('HOLD');
    });

    it('returns default HOLD when risks is not an array', () => {
      const result = processAIDecision(
        JSON.stringify({ ...validDecision, risks: 'some risk' }),
      );
      expect(result.decision).toBe('HOLD');
    });

    it('returns default HOLD when reasoning is not a string', () => {
      const result = processAIDecision(
        JSON.stringify({ ...validDecision, reasoning: 123 }),
      );
      expect(result.decision).toBe('HOLD');
    });

    it('handles non-Error exceptions in catch block', () => {
      // Trigger a string error via malformed text that produces a non-Error throw
      // In practice, JSON.parse throwing is an Error, but we test the String(err) path
      // by verifying the catch logs correctly for Error instances
      const result = processAIDecision('totally broken');
      expect(result.decision).toBe('HOLD');
      expect(result.reasoning).toContain('AI response parsing failed');
    });

    it('handles non-Error thrown from configManager.get after validation', () => {
      // After zod validation succeeds, configManager.get is called. If it throws
      // a non-Error value, the String(err) branch of the catch should be taken.
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'risk.minStopLossPct') throw 'config not found';
        return 0.02;
      });

      const result = processAIDecision(JSON.stringify({
        decision: 'BUY',
        conviction: 75,
        reasoning: 'test',
        risks: ['risk1'],
        suggestedStopLossPct: 0.05,
        suggestedPositionSizePct: 0.08,
        suggestedTakeProfitPct: 0.15,
        urgency: 'immediate',
        exitConditions: 'test',
      }));

      expect(result.decision).toBe('HOLD');
      expect(result.reasoning).toContain('config not found');
    });
  });
});
