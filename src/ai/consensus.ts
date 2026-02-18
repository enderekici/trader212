import { createLogger } from '../utils/logger.js';
import { type ModelProfile, OpenAICompatibleAdapter } from './adapters/openai-compat.js';
import type { AIAgent, AIContext, AIDecision } from './agent.js';

const log = createLogger('consensus-engine');

export type ConsensusMode = 'majority' | 'weighted' | 'unanimous';

interface ModelResult {
  profile: ModelProfile;
  decision: AIDecision;
}

export class ConsensusEngine implements AIAgent {
  constructor(
    private profiles: ModelProfile[],
    private mode: ConsensusMode,
    private minAgree: number,
  ) {}

  async analyze(context: AIContext): Promise<AIDecision | null> {
    const enabled = this.profiles.filter((p) => p.enabled);
    if (enabled.length === 0) {
      log.warn('ConsensusEngine: no enabled profiles');
      return null;
    }

    // Call all enabled models in parallel
    const settledResults = await Promise.allSettled(
      enabled.map(async (profile) => {
        const adapter = new OpenAICompatibleAdapter(profile);
        const decision = await adapter.analyze(context);
        if (!decision) throw new Error(`No decision from model ${profile.id}`);
        return { profile, decision } as ModelResult;
      }),
    );

    const successes: ModelResult[] = [];
    for (const result of settledResults) {
      if (result.status === 'fulfilled') {
        successes.push(result.value);
      } else {
        log.warn({ reason: result.reason }, 'ConsensusEngine: model call failed');
      }
    }

    if (successes.length === 0) {
      log.warn('ConsensusEngine: all model calls failed');
      return null;
    }

    switch (this.mode) {
      case 'unanimous':
        return this.resolveUnanimous(successes);
      case 'weighted':
        return this.resolveWeighted(successes);
      default:
        return this.resolveMajority(successes);
    }
  }

  private resolveMajority(results: ModelResult[]): AIDecision | null {
    const counts: Record<string, number> = { BUY: 0, SELL: 0, HOLD: 0 };
    for (const { decision } of results) {
      counts[decision.decision] = (counts[decision.decision] ?? 0) + 1;
    }
    const winner = (Object.keys(counts) as AIDecision['decision'][]).reduce((a, b) =>
      counts[a] >= counts[b] ? a : b,
    );
    if (counts[winner] < this.minAgree) {
      log.info({ counts, minAgree: this.minAgree }, 'ConsensusEngine: majority threshold not met');
      return null;
    }
    const agreeing = results.filter((r) => r.decision.decision === winner);
    return this.mergeDecisions(winner, agreeing);
  }

  private resolveWeighted(results: ModelResult[]): AIDecision | null {
    const weights: Record<string, number> = { BUY: 0, SELL: 0, HOLD: 0 };
    const counts: Record<string, number> = { BUY: 0, SELL: 0, HOLD: 0 };
    for (const { profile, decision } of results) {
      const w = profile.weight ?? 1;
      weights[decision.decision] = (weights[decision.decision] ?? 0) + w;
      counts[decision.decision] = (counts[decision.decision] ?? 0) + 1;
    }
    const winner = (Object.keys(weights) as AIDecision['decision'][]).reduce((a, b) =>
      weights[a] >= weights[b] ? a : b,
    );
    if (counts[winner] < this.minAgree) {
      log.info(
        { weights, counts, minAgree: this.minAgree },
        'ConsensusEngine: weighted threshold not met',
      );
      return null;
    }
    const agreeing = results.filter((r) => r.decision.decision === winner);
    return this.mergeDecisions(winner, agreeing);
  }

  private resolveUnanimous(results: ModelResult[]): AIDecision | null {
    const first = results[0].decision.decision;
    if (!results.every((r) => r.decision.decision === first)) {
      log.info('ConsensusEngine: unanimous mode — models disagree');
      return null;
    }
    return this.mergeDecisions(first, results);
  }

  private mergeDecisions(decision: string, results: ModelResult[]): AIDecision {
    const totalWeight = results.reduce((sum, r) => sum + (r.profile.weight ?? 1), 0);

    // Weighted average for numeric fields
    const conviction =
      results.reduce((sum, r) => sum + r.decision.conviction * (r.profile.weight ?? 1), 0) /
      totalWeight;
    const stopLoss =
      results.reduce(
        (sum, r) => sum + r.decision.suggestedStopLossPct * (r.profile.weight ?? 1),
        0,
      ) / totalWeight;
    const positionSize =
      results.reduce(
        (sum, r) => sum + r.decision.suggestedPositionSizePct * (r.profile.weight ?? 1),
        0,
      ) / totalWeight;
    const takeProfit =
      results.reduce(
        (sum, r) => sum + r.decision.suggestedTakeProfitPct * (r.profile.weight ?? 1),
        0,
      ) / totalWeight;

    // Merge reasoning with model id prefix
    const reasoning = results.map((r) => `[${r.profile.id}] ${r.decision.reasoning}`).join(' | ');

    // Union of all risk arrays (dedupe)
    const risks = [...new Set(results.flatMap((r) => r.decision.risks))];

    // Most common urgency
    const urgencyCounts: Record<string, number> = {};
    for (const r of results) {
      urgencyCounts[r.decision.urgency] = (urgencyCounts[r.decision.urgency] ?? 0) + 1;
    }
    const urgency = (Object.keys(urgencyCounts) as AIDecision['urgency'][]).reduce((a, b) =>
      urgencyCounts[a] >= urgencyCounts[b] ? a : b,
    );

    // First non-empty exitConditions
    const exitConditions =
      results.map((r) => r.decision.exitConditions).find((s) => s?.trim()) ?? '';

    return {
      decision: decision as AIDecision['decision'],
      conviction: Math.round(conviction),
      reasoning,
      risks,
      suggestedStopLossPct: stopLoss,
      suggestedPositionSizePct: positionSize,
      suggestedTakeProfitPct: takeProfit,
      urgency,
      exitConditions,
    };
  }

  async rawChat(system: string, user: string): Promise<string> {
    const first = this.profiles.find((p) => p.enabled);
    if (!first) throw new Error('ConsensusEngine: no enabled profiles for rawChat');
    const adapter = new OpenAICompatibleAdapter(first);
    return adapter.rawChat(system, user);
  }
}
