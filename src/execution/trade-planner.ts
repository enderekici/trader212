import { and, desc, eq, lte } from 'drizzle-orm';
import { type AIDecision, getActiveModelName } from '../ai/agent.js';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import { tradePlans } from '../db/schema.js';
import { createLogger } from '../utils/logger.js';
import type { PortfolioState } from './risk-guard.js';

const log = createLogger('trade-planner');

export interface TradePlan {
  id: number;
  symbol: string;
  t212Ticker: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'expired';
  side: 'BUY' | 'SELL';
  entryPrice: number;
  shares: number;
  positionValue: number;
  positionSizePct: number;
  stopLossPrice: number;
  stopLossPct: number;
  takeProfitPrice: number;
  takeProfitPct: number;
  maxLossDollars: number;
  riskRewardRatio: number;
  maxHoldDays: number | null;
  aiConviction: number;
  aiReasoning: string | null;
  aiModel: string | null;
  risks: string[];
  urgency: string | null;
  exitConditions: string | null;
  technicalScore: number | null;
  fundamentalScore: number | null;
  sentimentScore: number | null;
  accountType: 'INVEST' | 'ISA';
  approvedAt: string | null;
  approvedBy: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export class TradePlanner {
  createPlan(params: {
    symbol: string;
    t212Ticker: string;
    price: number;
    decision: AIDecision;
    portfolio: PortfolioState;
    technicalScore?: number;
    fundamentalScore?: number;
    sentimentScore?: number;
  }): TradePlan | null {
    const { symbol, t212Ticker, price, decision, portfolio } = params;

    // Calculate position size
    const shares = Math.floor(
      (portfolio.portfolioValue * decision.suggestedPositionSizePct) / price,
    );
    if (shares <= 0) {
      log.warn({ symbol, price }, 'Calculated 0 shares, cannot create plan');
      return null;
    }

    const positionValue = shares * price;
    const positionSizePct = positionValue / portfolio.portfolioValue;

    const stopLossPrice = price * (1 - decision.suggestedStopLossPct);
    const takeProfitPrice = price * (1 + decision.suggestedTakeProfitPct);
    const maxLossDollars = (price - stopLossPrice) * shares;
    const potentialGain = (takeProfitPrice - price) * shares;
    const riskRewardRatio = maxLossDollars > 0 ? potentialGain / maxLossDollars : 0;

    // Check minimum risk/reward ratio
    const minRR = configManager.get<number>('execution.minRiskRewardRatio');
    if (riskRewardRatio < minRR && decision.decision === 'BUY') {
      log.warn({ symbol, riskRewardRatio, minRequired: minRR }, 'Risk/reward ratio too low');
      return null;
    }

    const maxHoldDays = configManager.get<number>('execution.maxHoldDays');
    const accountType = configManager.get<string>('t212.accountType') as 'INVEST' | 'ISA';
    const now = new Date().toISOString();

    // Set expiry based on approval timeout
    const timeoutMinutes = configManager.get<number>('execution.approvalTimeoutMinutes');
    const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString();

    const db = getDb();
    const result = db
      .insert(tradePlans)
      .values({
        symbol,
        t212Ticker,
        status: 'pending',
        side: decision.decision as 'BUY' | 'SELL',
        entryPrice: price,
        shares,
        positionValue,
        positionSizePct,
        stopLossPrice,
        stopLossPct: decision.suggestedStopLossPct,
        takeProfitPrice,
        takeProfitPct: decision.suggestedTakeProfitPct,
        maxLossDollars,
        riskRewardRatio,
        maxHoldDays,
        aiConviction: decision.conviction,
        aiReasoning: decision.reasoning,
        aiModel: getActiveModelName(),
        risks: JSON.stringify(decision.risks),
        urgency: decision.urgency,
        exitConditions: decision.exitConditions,
        technicalScore: params.technicalScore ?? null,
        fundamentalScore: params.fundamentalScore ?? null,
        sentimentScore: params.sentimentScore ?? null,
        accountType,
        expiresAt,
        createdAt: now,
      })
      .run();

    const plan = this.getPlan(Number(result.lastInsertRowid));
    if (plan) {
      log.info(
        {
          symbol,
          shares,
          entryPrice: price,
          stopLoss: stopLossPrice,
          takeProfit: takeProfitPrice,
          riskReward: riskRewardRatio.toFixed(2),
          conviction: decision.conviction,
          status: 'pending',
        },
        'Trade plan created',
      );
    }

    return plan;
  }

  approvePlan(planId: number, approvedBy = 'auto'): TradePlan | null {
    const db = getDb();
    db.update(tradePlans)
      .set({ status: 'approved', approvedAt: new Date().toISOString(), approvedBy })
      .where(eq(tradePlans.id, planId))
      .run();

    return this.getPlan(planId);
  }

  rejectPlan(planId: number): void {
    const db = getDb();
    db.update(tradePlans).set({ status: 'rejected' }).where(eq(tradePlans.id, planId)).run();
  }

  markExecuted(planId: number): void {
    const db = getDb();
    db.update(tradePlans).set({ status: 'executed' }).where(eq(tradePlans.id, planId)).run();
  }

  expireOldPlans(): number {
    const db = getDb();
    const now = new Date().toISOString();
    const result = db
      .update(tradePlans)
      .set({ status: 'expired' })
      .where(and(eq(tradePlans.status, 'pending'), lte(tradePlans.expiresAt, now)))
      .run();
    return result.changes;
  }

  getPendingPlans(): TradePlan[] {
    const db = getDb();
    const rows = db
      .select()
      .from(tradePlans)
      .where(eq(tradePlans.status, 'pending'))
      .orderBy(desc(tradePlans.createdAt))
      .all();
    return rows.map(this.rowToPlan);
  }

  getPlan(id: number): TradePlan | null {
    const db = getDb();
    const row = db.select().from(tradePlans).where(eq(tradePlans.id, id)).get();
    return row ? this.rowToPlan(row) : null;
  }

  getRecentPlans(limit = 20): TradePlan[] {
    const db = getDb();
    const rows = db
      .select()
      .from(tradePlans)
      .orderBy(desc(tradePlans.createdAt))
      .limit(limit)
      .all();
    return rows.map(this.rowToPlan);
  }

  formatPlanMessage(plan: TradePlan): string {
    return [
      `TRADE PLAN: ${plan.symbol}`,
      '\u2500'.repeat(30),
      `Side: ${plan.side}`,
      `Entry Price: $${plan.entryPrice.toFixed(2)}`,
      `Shares: ${plan.shares} ($${plan.positionValue.toFixed(2)} = ${(plan.positionSizePct * 100).toFixed(1)}% of portfolio)`,
      `Stop Loss: $${plan.stopLossPrice.toFixed(2)} (-${(plan.stopLossPct * 100).toFixed(1)}%) → max loss: $${plan.maxLossDollars.toFixed(2)}`,
      `Take Profit: $${plan.takeProfitPrice.toFixed(2)} (+${(plan.takeProfitPct * 100).toFixed(1)}%)`,
      `Risk/Reward: 1:${plan.riskRewardRatio.toFixed(1)}`,
      plan.maxHoldDays ? `Max Hold: ${plan.maxHoldDays} trading days` : '',
      `AI Conviction: ${plan.aiConviction}/100`,
      `Reasoning: ${plan.aiReasoning ?? 'N/A'}`,
      plan.risks.length > 0 ? `Risks: ${plan.risks.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private rowToPlan(row: typeof tradePlans.$inferSelect): TradePlan {
    return {
      ...row,
      status: row.status as TradePlan['status'],
      side: row.side as 'BUY' | 'SELL',
      accountType: row.accountType as 'INVEST' | 'ISA',
      risks: row.risks ? JSON.parse(row.risks) : [],
    };
  }
}
