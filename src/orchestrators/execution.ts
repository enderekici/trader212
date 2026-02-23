import { desc, eq, gte } from 'drizzle-orm';
import type { CorrelationAnalyzer } from '../analysis/correlation.js';
import type { TradeDecision } from '../analysis/decision-engine.js';
import { getWebhookManager } from '../api/webhooks.js';
import type { WebSocketManager } from '../api/websocket.js';
import { configManager } from '../config/manager.js';
import type { StockData } from '../data/data-aggregator.js';
import { getDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { ApprovalManager } from '../execution/approval-manager.js';
import type { BuyParams, CloseParams, OrderManager } from '../execution/order-manager.js';
import { getProtectionManager } from '../execution/protections.js';
import type { PortfolioState, RiskGuard, TradeProposal } from '../execution/risk-guard.js';
import type { TradePlan, TradePlanner } from '../execution/trade-planner.js';
import { getAuditLogger } from '../monitoring/audit-log.js';
import { getTaxTracker } from '../monitoring/tax-tracker.js';
import type { TelegramNotifier } from '../monitoring/telegram.js';
import { getTradeJournalManager } from '../monitoring/trade-journal.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('execution-orchestrator');

export interface ExecutionOrchestratorDeps {
  orderManager: OrderManager;
  riskGuard: RiskGuard;
  tradePlanner: TradePlanner;
  approvalManager: ApprovalManager;
  correlationAnalyzer: CorrelationAnalyzer;
  telegram: TelegramNotifier;
  wsManager: WebSocketManager;
  getPortfolioState: () => Promise<PortfolioState>;
  getLossCooldownUntil: () => Date | null;
}

export class ExecutionOrchestrator {
  constructor(private deps: ExecutionOrchestratorDeps) {}

  async executeTrade(
    symbol: string,
    t212Ticker: string,
    data: StockData,
    decision: TradeDecision,
    portfolio: PortfolioState,
    technicalScore?: number,
    fundamentalScore?: number,
    sentimentScore?: number,
  ): Promise<void> {
    const price = data.quote?.price ?? 0;
    const audit = getAuditLogger();

    // Overtrading protection
    const maxDailyTrades = configManager.get<number>('risk.maxDailyTrades');
    const todayStr = new Date().toISOString().split('T')[0];
    const todayTradeCount = getDb()
      .select()
      .from(schema.trades)
      .where(gte(schema.trades.entryTime, todayStr))
      .all().length;
    if (todayTradeCount >= maxDailyTrades) {
      log.warn({ todayTradeCount, maxDailyTrades }, 'Daily trade limit reached');
      audit.logRisk(`Daily trade limit: ${todayTradeCount}/${maxDailyTrades}`);
      return;
    }

    // Check portfolio correlation for BUY orders
    if (decision.decision === 'BUY') {
      const correlations = this.deps.correlationAnalyzer.checkCorrelationWithPortfolio(symbol);
      const highCorr = correlations.filter((c) => c.isHighlyCorrelated);
      if (highCorr.length > 0) {
        log.warn(
          { symbol, correlatedWith: highCorr.map((c) => c.symbol2) },
          'High correlation with existing positions',
        );
        audit.logRisk(
          `${symbol} highly correlated with ${highCorr.map((c) => c.symbol2).join(', ')}`,
          { correlations: highCorr },
        );
        return; // Hard block: don't trade highly correlated positions
      }
    }

    // Earnings blackout enforcement
    const blackoutDays = configManager.get<number>('data.earningsBlackoutDays') ?? 3;
    if (blackoutDays > 0 && data.earnings?.length) {
      const now = new Date();
      const hasUpcomingEarnings = data.earnings.some((e) => {
        const earningsDate = new Date(e.date);
        const daysUntil = (earningsDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        return daysUntil >= 0 && daysUntil <= blackoutDays;
      });
      if (hasUpcomingEarnings) {
        log.info({ symbol, blackoutDays }, 'Skipping trade: earnings blackout period');
        audit.logRisk(`Earnings blackout: ${symbol} has earnings within ${blackoutDays} days`);
        return;
      }
    }

    // Create trade plan instead of executing immediately
    const plan = this.deps.tradePlanner.createPlan({
      symbol,
      t212Ticker,
      price,
      decision,
      portfolio,
      technicalScore,
      fundamentalScore,
      sentimentScore,
    });

    if (!plan) {
      log.warn({ symbol }, 'Trade plan creation failed (insufficient R:R or 0 shares)');
      return;
    }

    // Send plan to WebSocket
    this.deps.wsManager.broadcast('trade_plan_created', plan);
    audit.logTrade(
      symbol,
      `Trade plan created: ${plan.side} ${plan.shares} shares @ $${price.toFixed(2)}`,
      {
        planId: plan.id,
        riskReward: plan.riskRewardRatio,
        conviction: plan.conviction,
      },
    );

    // Process through approval flow
    const { shouldExecute, plan: processedPlan } =
      await this.deps.approvalManager.processNewPlan(plan);

    if (!shouldExecute) {
      // Approval required - send to Telegram and wait
      const planMsg = this.deps.tradePlanner.formatPlanMessage(processedPlan);
      await this.deps.telegram.sendMessage(
        `<b>Trade Plan Pending Approval</b>\n<pre>${planMsg}</pre>\n\nReply /approve_${plan.id} or /reject_${plan.id}`,
      );
      return;
    }

    // Execute the approved plan
    await this.executeApprovedPlan(processedPlan);
  }

  async executeApprovedPlan(plan: TradePlan | null): Promise<void> {
    if (!plan) return;

    const accountType = plan.accountType as 'INVEST' | 'ISA';
    const audit = getAuditLogger();

    // Validate with risk guard
    const portfolio = await this.deps.getPortfolioState();
    const fundRow = getDb()
      .select({ sector: schema.fundamentalCache.sector })
      .from(schema.fundamentalCache)
      .where(eq(schema.fundamentalCache.symbol, plan.symbol))
      .orderBy(desc(schema.fundamentalCache.fetchedAt))
      .limit(1)
      .get();

    const proposal: TradeProposal = {
      symbol: plan.symbol,
      side: plan.side,
      shares: plan.shares,
      price: plan.entryPrice,
      stopLossPct: plan.stopLossPct,
      positionSizePct: plan.positionSizePct,
      sector: fundRow?.sector ?? undefined,
    };

    const validation = this.deps.riskGuard.validateTrade(proposal, portfolio);
    if (!validation.allowed) {
      log.warn({ symbol: plan.symbol, reason: validation.reason }, 'Trade rejected by risk guard');
      audit.logRisk(`Trade rejected: ${plan.symbol} - ${validation.reason}`, { planId: plan.id });
      return;
    }

    log.info(
      {
        symbol: plan.symbol,
        side: plan.side,
        shares: plan.shares,
        price: plan.entryPrice,
        conviction: plan.conviction,
      },
      'Executing trade from plan',
    );

    try {
      if (plan.side === 'BUY') {
        // Apply streak-based position size reduction
        let adjustedShares = plan.shares;
        const streakMultiplier = this.deps.riskGuard.getLosingStreakMultiplier();
        if (streakMultiplier < 1.0) {
          adjustedShares = Math.max(1, Math.floor(plan.shares * streakMultiplier));
          log.info(
            {
              symbol: plan.symbol,
              originalShares: plan.shares,
              adjustedShares,
              streakMultiplier,
            },
            'Position size reduced due to losing streak',
          );
          audit.logRisk(
            `Streak reduction: ${plan.symbol} shares ${plan.shares} -> ${adjustedShares} (x${streakMultiplier})`,
            { planId: plan.id, streakMultiplier },
          );
        }

        // Apply cool-down position size reduction (stacks with streak reduction)
        const lossCooldownUntil = this.deps.getLossCooldownUntil();
        if (lossCooldownUntil && new Date() < lossCooldownUntil) {
          const factor = configManager.get<number>('risk.lossCooldownSizeFactor') ?? 0.5;
          const beforeCooldown = adjustedShares;
          adjustedShares = Math.max(1, Math.floor(adjustedShares * factor));
          log.warn(
            {
              symbol: plan.symbol,
              factor,
              beforeCooldown,
              afterCooldown: adjustedShares,
              cooldownUntil: lossCooldownUntil.toISOString(),
            },
            'Cool-down: reduced position size',
          );
          audit.logRisk(
            `Cool-down reduction: ${plan.symbol} shares ${beforeCooldown} -> ${adjustedShares} (x${factor})`,
            { planId: plan.id, factor, cooldownUntil: lossCooldownUntil.toISOString() },
          );
        }

        const buyParams: BuyParams = {
          symbol: plan.symbol,
          t212Ticker: plan.t212Ticker,
          shares: adjustedShares,
          price: plan.entryPrice,
          stopLossPct: plan.stopLossPct,
          takeProfitPct: plan.takeProfitPct,
          reasoning: plan.reasoning ?? '',
          conviction: plan.conviction,
          accountType,
        };
        await this.deps.orderManager.executeBuy(buyParams);
      } else {
        const exitReason = plan.reasoning ?? 'AI sell signal';
        const closeParams: CloseParams = {
          symbol: plan.symbol,
          t212Ticker: plan.t212Ticker,
          shares: plan.shares,
          exitReason,
          accountType,
        };
        await this.deps.orderManager.executeClose(closeParams);

        // Evaluate protections after sell
        try {
          // We don't have exact pnlPct here; pass 0 as protections query DB directly
          getProtectionManager().evaluateAfterClose(plan.symbol, exitReason, 0);
        } catch (protErr) {
          log.error(
            { symbol: plan.symbol, protErr },
            'Protection evaluation failed after plan sell',
          );
        }
      }

      this.deps.tradePlanner.markExecuted(plan.id);
      audit.logTrade(
        plan.symbol,
        `Trade executed: ${plan.side} ${plan.shares} shares @ $${plan.entryPrice.toFixed(2)}`,
        { planId: plan.id },
      );

      await this.deps.telegram.sendTradeNotification({
        symbol: plan.symbol,
        side: plan.side,
        shares: plan.shares,
        price: plan.entryPrice,
        stopLoss: plan.stopLossPrice,
        reasoning: plan.reasoning ?? '',
      });

      this.deps.wsManager.broadcast('trade_executed', {
        symbol: plan.symbol,
        side: plan.side,
        shares: plan.shares,
        price: plan.entryPrice,
      });

      // Webhook dispatch
      try {
        await getWebhookManager().sendOutbound('trade_executed', {
          symbol: plan.symbol,
          side: plan.side,
          shares: plan.shares,
          price: plan.entryPrice,
          planId: plan.id,
        });
      } catch (whErr) {
        log.error({ whErr }, 'Webhook dispatch failed');
      }

      // Trade journal auto-annotation
      try {
        getTradeJournalManager().autoAnnotate(
          plan.symbol,
          plan.side === 'BUY' ? 'trade_open' : 'trade_close',
          {
            price: plan.entryPrice,
            shares: plan.shares,
            conviction: plan.conviction,
            reasoning: plan.reasoning,
          },
        );
      } catch (jErr) {
        log.error({ jErr }, 'Trade journal annotation failed');
      }

      // Tax lot tracking
      try {
        const taxTracker = getTaxTracker();
        if (plan.side === 'BUY') {
          await taxTracker.recordPurchase(plan.symbol, plan.shares, plan.entryPrice, accountType);
        } else {
          await taxTracker.recordSale(plan.symbol, plan.shares, plan.entryPrice);
        }
      } catch (taxErr) {
        log.error({ taxErr }, 'Tax lot tracking failed');
      }
    } catch (err) {
      log.error({ symbol: plan.symbol, err }, 'Trade execution failed');
      audit.logError(`Trade execution failed: ${plan.symbol}`, {
        planId: plan.id,
        error: String(err),
      });
      await this.deps.telegram.sendAlert(
        'Trade Execution Failed',
        `${plan.symbol} ${plan.side}: ${err}`,
      );
    }
  }
}
