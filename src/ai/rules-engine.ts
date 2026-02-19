import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';
import type { AIAgent, AIContext, AIDecision } from './agent.js';

const log = createLogger('rules-engine');

export class RulesEngine implements AIAgent {
  async analyze(context: AIContext): Promise<AIDecision | null> {
    // Read configurable thresholds
    let buyTechMin = 65;
    let buyFundMin = 55;
    let buySentMin = 60;
    let sellTechMax = 35;
    let sellFundMax = 30;
    try {
      buyTechMin = configManager.get<number>('ai.rules.buyTechMin');
    } catch {
      /* use defaults */
    }
    try {
      buyFundMin = configManager.get<number>('ai.rules.buyFundMin');
    } catch {
      /* use defaults */
    }
    try {
      buySentMin = configManager.get<number>('ai.rules.buySentMin');
    } catch {
      /* use defaults */
    }
    try {
      sellTechMax = configManager.get<number>('ai.rules.sellTechMax');
    } catch {
      /* use defaults */
    }
    try {
      sellFundMax = configManager.get<number>('ai.rules.sellFundMax');
    } catch {
      /* use defaults */
    }

    const tech = context.technical.score;
    const fund = context.fundamental.score;
    const sent = context.sentiment.score;

    let decision: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let conviction = 0;
    let reasoning = '';

    // BUY: tech >= threshold AND (fund >= threshold OR sent >= threshold)
    if (tech >= buyTechMin && (fund >= buyFundMin || sent >= buySentMin)) {
      decision = 'BUY';
      const scores = [tech];
      if (fund >= buyFundMin) scores.push(fund);
      if (sent >= buySentMin) scores.push(sent);
      conviction = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      reasoning =
        `Rules engine BUY: tech=${tech} (>=${buyTechMin}), fund=${fund}, sent=${sent}. ` +
        `${scores.length} signals aligned.`;
    }
    // SELL: tech <= threshold AND fund <= threshold
    else if (tech <= sellTechMax && fund <= sellFundMax) {
      decision = 'SELL';
      conviction = Math.round((100 - tech + (100 - fund)) / 2);
      reasoning = `Rules engine SELL: tech=${tech} (<=${sellTechMax}), fund=${fund} (<=${sellFundMax}).`;
    }
    // HOLD
    else {
      decision = 'HOLD';
      conviction = 50;
      reasoning = `Rules engine HOLD: tech=${tech}, fund=${fund}, sent=${sent}. No clear signal.`;
    }

    log.info(
      { symbol: context.symbol, decision, conviction, tech, fund, sent },
      'Rules engine decision',
    );

    // Use config defaults for stop/target/size
    let stopLossPct = 0.05;
    let positionSizePct = 0.1;
    let takeProfitPct = 0.2;
    try {
      stopLossPct = configManager.get<number>('risk.defaultStopLossPct');
    } catch {
      /* use defaults */
    }
    try {
      positionSizePct = configManager.get<number>('risk.maxPositionSizePct');
    } catch {
      /* use defaults */
    }
    try {
      takeProfitPct = configManager.get<number>('risk.defaultTakeProfitPct');
    } catch {
      /* use defaults */
    }

    return {
      decision,
      conviction,
      reasoning,
      risks: decision === 'BUY' ? ['Rules-based, no nuanced analysis'] : [],
      suggestedStopLossPct: stopLossPct,
      suggestedPositionSizePct: positionSizePct,
      suggestedTakeProfitPct: takeProfitPct,
      urgency: 'no_rush',
      exitConditions: '',
    };
  }

  async rawChat(_system: string, _user: string): Promise<string> {
    return 'Rules engine does not support raw chat. Switch to an AI provider for conversational analysis.';
  }
}
