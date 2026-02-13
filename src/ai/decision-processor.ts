import { z } from 'zod';
import { configManager } from '../config/manager.js';
import { clamp } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';
import type { AIDecision } from './agent.js';

const log = createLogger('ai-decision');

const aiDecisionSchema = z.object({
  decision: z.enum(['BUY', 'SELL', 'HOLD']),
  conviction: z.number(),
  reasoning: z.string(),
  risks: z.array(z.string()),
  suggestedStopLossPct: z.number(),
  suggestedPositionSizePct: z.number(),
  suggestedTakeProfitPct: z.number(),
  urgency: z.enum(['immediate', 'wait_for_dip', 'no_rush']),
  exitConditions: z.string(),
});

function extractJson(raw: string): string {
  // Strip <think>...</think> tags from thinking models (e.g. Qwen3)
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Try to find JSON object directly
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];

  return text.trim();
}

function defaultHoldDecision(reason: string): AIDecision {
  return {
    decision: 'HOLD',
    conviction: 0,
    reasoning: reason,
    risks: ['AI response could not be parsed'],
    suggestedStopLossPct: 0.05,
    suggestedPositionSizePct: 0.03,
    suggestedTakeProfitPct: 0.1,
    urgency: 'no_rush',
    exitConditions: 'N/A - defaulted to HOLD due to parsing failure',
  };
}

export function processAIDecision(rawText: string): AIDecision {
  try {
    const jsonStr = extractJson(rawText);
    const parsed = JSON.parse(jsonStr);
    const validated = aiDecisionSchema.parse(parsed);

    const minStopLoss = configManager.get<number>('risk.minStopLossPct');
    const maxStopLoss = configManager.get<number>('risk.maxStopLossPct');
    const maxPositionSize = configManager.get<number>('risk.maxPositionSizePct');

    return {
      decision: validated.decision,
      conviction: clamp(validated.conviction, 0, 100),
      reasoning: validated.reasoning,
      risks: validated.risks,
      suggestedStopLossPct: clamp(validated.suggestedStopLossPct, minStopLoss, maxStopLoss),
      suggestedPositionSizePct: clamp(validated.suggestedPositionSizePct, 0.01, maxPositionSize),
      suggestedTakeProfitPct: clamp(validated.suggestedTakeProfitPct, 0.02, 0.5),
      urgency: validated.urgency,
      exitConditions: validated.exitConditions,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(
      { err: message, rawText: rawText.slice(0, 500) },
      'Failed to parse AI decision, defaulting to HOLD',
    );
    return defaultHoldDecision(`AI response parsing failed: ${message}`);
  }
}
