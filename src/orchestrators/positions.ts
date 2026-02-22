import { eq } from 'drizzle-orm';
import type { CorrelationAnalyzer } from '../analysis/correlation.js';
import type { Trading212Client } from '../api/trading212/client.js';
import type { WebSocketManager } from '../api/websocket.js';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { getDCAManager } from '../execution/dca-manager.js';
import type { OrderManager } from '../execution/order-manager.js';
import type { OrderReplacer } from '../execution/order-replacer.js';
import { getPartialExitManager } from '../execution/partial-exit-manager.js';
import type { PositionTracker } from '../execution/position-tracker.js';
import { getProtectionManager } from '../execution/protections.js';
import type { PortfolioState } from '../execution/risk-guard.js';
import { getAuditLogger } from '../monitoring/audit-log.js';
import type { TelegramNotifier } from '../monitoring/telegram.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('position-orchestrator');

export interface PositionOrchestratorDeps {
  orderManager: OrderManager;
  positionTracker: PositionTracker;
  orderReplacer: OrderReplacer;
  correlationAnalyzer: CorrelationAnalyzer;
  telegram: TelegramNotifier;
  wsManager: WebSocketManager;
  t212Client: Trading212Client;
  getPortfolioState: () => Promise<PortfolioState>;
}

export class PositionOrchestrator {
  constructor(private deps: PositionOrchestratorDeps) {}

  async monitorPositions(): Promise<void> {
    try {
      // Update prices
      await this.deps.positionTracker.updatePositions();

      // Update trailing stops for profitable positions
      await this.deps.positionTracker.updateTrailingStops();

      // Check exit conditions (stop-loss, take-profit, AI conditions)
      const exitResult = await this.deps.positionTracker.checkExitConditions();
      const accountType = configManager.get<string>('t212.accountType') as 'INVEST' | 'ISA';

      for (const symbol of exitResult.positionsToClose) {
        const db = getDb();
        const pos = db
          .select()
          .from(schema.positions)
          .where(eq(schema.positions.symbol, symbol))
          .get();
        if (!pos) continue;

        const exitReason = exitResult.exitReasons[symbol] ?? 'Exit condition triggered';
        log.info({ symbol, exitReason }, 'Auto-closing position due to exit condition');

        try {
          await this.deps.orderManager.executeClose({
            symbol: pos.symbol,
            t212Ticker: pos.t212Ticker,
            shares: pos.shares,
            exitReason,
            accountType,
          });

          // Evaluate protections after close
          const pnlPct = pos.pnlPct ?? 0;
          try {
            getProtectionManager().evaluateAfterClose(symbol, exitReason, pnlPct);
          } catch (protErr) {
            log.error({ symbol, protErr }, 'Protection evaluation failed after position close');
          }

          await this.deps.telegram.sendTradeNotification({
            symbol,
            side: 'SELL',
            shares: pos.shares,
            price: pos.currentPrice ?? pos.entryPrice,
            stopLoss: pos.stopLoss ?? 0,
            reasoning: exitReason,
          });

          this.deps.wsManager.broadcast('trade_executed', {
            symbol,
            side: 'SELL',
            shares: pos.shares,
            price: pos.currentPrice ?? pos.entryPrice,
          });
        } catch (err) {
          log.error({ symbol, err }, 'Failed to auto-close position');
        }
      }

      // Check for stale unfilled orders and reprice if enabled
      await this.processOrderReplacements();

      // Check for correlation drift between held positions
      await this.checkCorrelationDrift();

      // DCA evaluation for losing positions
      await this.evaluateDCAOpportunities();

      // Partial exit evaluation for profitable positions
      await this.evaluatePartialExits();

      // Broadcast updated positions
      const db = getDb();
      const allPositions = db.select().from(schema.positions).all();
      for (const pos of allPositions) {
        this.deps.wsManager.broadcast('position_update', pos);
      }
    } catch (err) {
      log.error({ err }, 'Position monitor failed');
    }
  }

  async syncPositions(): Promise<void> {
    try {
      await this.deps.positionTracker.syncWithT212(this.deps.t212Client);
    } catch (err) {
      log.error({ err }, 'T212 position sync failed');
    }
  }

  private async processOrderReplacements(): Promise<void> {
    const enabled = configManager.get<boolean>('execution.orderReplacement.enabled');
    if (!enabled) return;

    const audit = getAuditLogger();

    try {
      const result = await this.deps.orderReplacer.processOpenOrders();
      if (result.replaced > 0) {
        log.info(
          { replaced: result.replaced, checked: result.checked },
          'Order replacements processed',
        );
        audit.logTrade(
          '*',
          `Order replacement: ${result.replaced} orders repriced (${result.checked} checked)`,
          {
            replaced: result.replaced,
            skipped: result.skipped,
            filledDuringCancel: result.filledDuringCancel,
          },
        );
      }
      if (result.errors.length > 0) {
        for (const error of result.errors) {
          log.error({ error }, 'Order replacement error');
        }
        await this.deps.telegram.sendAlert(
          'Order Replacement Errors',
          `${result.errors.length} error(s) during order replacement. Check logs.`,
        );
      }
    } catch (err) {
      log.error({ err }, 'Order replacement processing failed');
    }
  }

  private async checkCorrelationDrift(): Promise<void> {
    const db = getDb();
    const allPositions = db.select().from(schema.positions).all();
    if (allPositions.length < 2) return;

    const audit = getAuditLogger();
    const maxCorrelation = configManager.get<number>('risk.maxCorrelation');

    try {
      const { symbols, matrix } = this.deps.correlationAnalyzer.getPortfolioCorrelationMatrix();

      for (let i = 0; i < symbols.length; i++) {
        for (let j = i + 1; j < symbols.length; j++) {
          const corr = matrix[i][j];
          if (Math.abs(corr) > maxCorrelation) {
            const pair = `${symbols[i]}/${symbols[j]}`;
            const corrStr = corr.toFixed(2);

            log.warn(
              { pair, correlation: corr, threshold: maxCorrelation },
              'Correlation drift detected between held positions',
            );

            audit.logRisk(
              `Correlation drift: ${pair} at ${corrStr} (threshold: ${maxCorrelation})`,
              { symbol1: symbols[i], symbol2: symbols[j], correlation: corr },
            );

            await this.deps.telegram.sendAlert(
              'Correlation Drift',
              `${pair} correlation spiked to ${corrStr} (max: ${maxCorrelation}). Consider reducing exposure.`,
            );
          }
        }
      }
    } catch (err) {
      log.error({ err }, 'Correlation drift check failed');
    }
  }

  private async evaluateDCAOpportunities(): Promise<void> {
    try {
      const dcaManager = getDCAManager();
      const db = getDb();
      const allPositions = db.select().from(schema.positions).all();
      const portfolio = await this.deps.getPortfolioState();
      const accountType = configManager.get<string>('t212.accountType') as 'INVEST' | 'ISA';

      for (const pos of allPositions) {
        if (!pos.currentPrice) continue;

        const evaluation = dcaManager.evaluatePosition(
          pos.symbol,
          pos.currentPrice,
          {
            symbol: pos.symbol,
            shares: pos.shares,
            entryPrice: pos.entryPrice,
            entryTime: pos.entryTime,
            dcaCount: pos.dcaCount ?? 0,
            totalInvested: pos.totalInvested,
          },
          portfolio,
        );

        if (evaluation.shouldDCA && evaluation.shares && evaluation.shares > 0) {
          log.info(
            { symbol: pos.symbol, shares: evaluation.shares, round: (pos.dcaCount ?? 0) + 1 },
            'DCA opportunity detected',
          );
          try {
            await dcaManager.executeDCA(
              pos.symbol,
              pos.t212Ticker,
              evaluation.shares,
              pos.currentPrice,
              accountType,
              this.deps.t212Client,
            );
          } catch (dcaErr) {
            log.error({ symbol: pos.symbol, dcaErr }, 'DCA execution failed');
          }
        }
      }
    } catch (err) {
      log.error({ err }, 'DCA evaluation failed');
    }
  }

  private async evaluatePartialExits(): Promise<void> {
    try {
      const partialExitMgr = getPartialExitManager();
      const db = getDb();
      const allPositions = db.select().from(schema.positions).all();
      const accountType = configManager.get<string>('t212.accountType') as 'INVEST' | 'ISA';

      for (const pos of allPositions) {
        const evaluation = partialExitMgr.evaluatePosition(pos);

        if (evaluation.shouldExit && evaluation.sharesToSell && evaluation.sharesToSell > 0) {
          log.info(
            { symbol: pos.symbol, sharesToSell: evaluation.sharesToSell },
            'Partial exit triggered',
          );
          try {
            await partialExitMgr.executePartialExit(
              pos.symbol,
              pos.t212Ticker,
              evaluation.sharesToSell,
              evaluation.reason ?? 'Partial exit tier reached',
              accountType,
            );
          } catch (peErr) {
            log.error({ symbol: pos.symbol, peErr }, 'Partial exit execution failed');
          }
        }
      }
    } catch (err) {
      log.error({ err }, 'Partial exit evaluation failed');
    }
  }
}
