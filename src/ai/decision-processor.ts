import { z } from 'zod';
import { configManager } from '../config/manager.js';
import { clamp } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';
import type { AIDecision } from './agent.js';

const log = createLogger('ai-decision');

const aiDecisionSchema = z.object({
  decision: z.enum(['BUY', 'SELL', 'HOLD']),
  conviction: z.coerce.number().optional().default(50),
  reasoning: z.string().optional().default(''),
  risks: z.array(z.string()).optional().default([]),
  suggestedStopLossPct: z.coerce.number().optional().default(0),
  suggestedPositionSizePct: z.coerce.number().optional().default(0),
  suggestedTakeProfitPct: z.coerce.number().optional().default(0),
  urgency: z.enum(['immediate', 'wait_for_dip', 'no_rush']).optional().default('no_rush'),
  exitConditions: z.string().optional().default(''),
});

function extractJson(raw: string): string {
  // Strip <think>...</think> tags from thinking models (e.g. Qwen3)
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Try to find JSON object directly (first complete object)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];

  return text.trim();
}

function normalizeDecisionFields(input: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...input };
  if (typeof normalized.decision === 'string') {
    normalized.decision = normalized.decision.toUpperCase();
  }
  if (typeof normalized.urgency === 'string') {
    const raw = normalized.urgency.toLowerCase().trim();
    const mapped = raw
      .replace(/\s+/g, '_')
      .replace(/-/g, '_')
      .replace(/no_rush|norush|no_?rush/g, 'no_rush')
      .replace(/wait.*dip|wait_for_dip|waitfordip/g, 'wait_for_dip')
      .replace(/immediate|now|urgent/g, 'immediate');
    normalized.urgency = ['immediate', 'wait_for_dip', 'no_rush'].includes(mapped)
      ? mapped
      : 'no_rush';
  }
  if (!Array.isArray(normalized.risks) && typeof normalized.risks === 'string') {
    normalized.risks = [normalized.risks];
  }
  return normalized;
}

function coerceMissingNumbers(
  parsed: Record<string, unknown>,
  defaults: {
    suggestedStopLossPct: number;
    suggestedPositionSizePct: number;
    suggestedTakeProfitPct: number;
  },
): Record<string, unknown> {
  const output = { ...parsed };
  if (!output.suggestedStopLossPct || Number.isNaN(Number(output.suggestedStopLossPct))) {
    output.suggestedStopLossPct = defaults.suggestedStopLossPct;
  }
  if (!output.suggestedPositionSizePct || Number.isNaN(Number(output.suggestedPositionSizePct))) {
    output.suggestedPositionSizePct = defaults.suggestedPositionSizePct;
  }
  if (!output.suggestedTakeProfitPct || Number.isNaN(Number(output.suggestedTakeProfitPct))) {
    output.suggestedTakeProfitPct = defaults.suggestedTakeProfitPct;
  }
  return output;
}


export function processAIDecision(rawText: string): AIDecision | null {
  try {
    const jsonStr = extractJson(rawText);
    const parsed = normalizeDecisionFields(JSON.parse(jsonStr));
    const minStopLoss = configManager.get<number>('risk.minStopLossPct');
    const maxStopLoss = configManager.get<number>('risk.maxStopLossPct');
    const maxPositionSize = configManager.get<number>('risk.maxPositionSizePct');
    const fallback = {
      suggestedStopLossPct: minStopLoss,
      suggestedPositionSizePct: Math.min(0.03, maxPositionSize),
      suggestedTakeProfitPct: Math.max(0.05, minStopLoss * 3),
    };
    const prepared = coerceMissingNumbers(parsed, fallback);
    const validated = aiDecisionSchema.parse(prepared);

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
    log.error(
      { err: message, rawText: rawText.slice(0, 500) },
      'Failed to parse AI decision — returning null (no trade)',
    );
    return null;
  }
}
