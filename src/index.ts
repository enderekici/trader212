import 'dotenv/config';

import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import pLimit from 'p-limit';
import { CorrelationAnalyzer } from './analysis/correlation.js';
import { DecisionEngine } from './analysis/decision-engine.js';
import { scoreFundamentals } from './analysis/fundamental/scorer.js';
import { createMultiTimeframeAnalyzer } from './analysis/multi-timeframe.js';
import { getRegimeDetector } from './analysis/regime-detector.js';
import { type SentimentInput, scoreSentiment } from './analysis/sentiment/scorer.js';
import { analyzeTechnicals } from './analysis/technical/scorer.js';
import { registerBotCallbacks } from './api/routes.js';
import { ApiServer } from './api/server.js';
import { Trading212Client } from './api/trading212/client.js';
import type { WebSocketManager } from './api/websocket.js';
import { minutesToWeekdayCron, Scheduler, timeToCron } from './bot/scheduler.js';
import { configManager } from './config/manager.js';
import { getStrategyProfileManager } from './config/strategy-profiles.js';
import { DataAggregator } from './data/data-aggregator.js';
import { FinnhubClient } from './data/finnhub.js';
import { MarketauxClient } from './data/marketaux.js';
import { PriceStreamer } from './data/price-streamer.js';
import { TickerMapper } from './data/ticker-mapper.js';
import { YahooFinanceClient } from './data/yahoo-finance.js';
import { getDb, initDatabase } from './db/index.js';
import * as schema from './db/schema.js';
import { ApprovalManager } from './execution/approval-manager.js';
import { getConditionalOrderManager } from './execution/conditional-orders.js';
import { OrderManager } from './execution/order-manager.js';
import { OrderReplacer } from './execution/order-replacer.js';
import { getPairLockManager } from './execution/pair-locks.js';
import { getPartialExitManager } from './execution/partial-exit-manager.js';
import { PositionTracker } from './execution/position-tracker.js';
import { type PortfolioState, RiskGuard } from './execution/risk-guard.js';
import { TradePlanner } from './execution/trade-planner.js';
import { getAuditLogger } from './monitoring/audit-log.js';
import { PerformanceTracker } from './monitoring/performance.js';
import { getReportGenerator } from './monitoring/report-generator.js';
import { TelegramNotifier } from './monitoring/telegram.js';
import { AnalysisOrchestrator } from './orchestrators/analysis.js';
import { ExecutionOrchestrator } from './orchestrators/execution.js';
import { PositionOrchestrator } from './orchestrators/positions.js';
import type { StockInfo } from './pairlist/filters.js';
import { createPairlistPipeline } from './pairlist/index.js';
import type { PairlistPipeline } from './pairlist/pipeline.js';
import { setupGlobalErrorHandlers } from './utils/error-handlers.js';
import { formatCurrency, formatPercent } from './utils/helpers.js';
import { createLogger } from './utils/logger.js';
import { getMarketStatus, isUSMarketOpen } from './utils/market-hours.js';

const log = createLogger('bot');

// Production safety check - fail fast if missing critical auth in production
if (process.env.NODE_ENV === 'production' && !process.env.API_SECRET_KEY) {
  console.error('FATAL: NODE_ENV=production but API_SECRET_KEY is not set');
  console.error('The API will be completely unauthenticated. Exiting...');
  process.exit(1);
}

class TradingBot {
  private scheduler!: Scheduler;
  private telegram!: TelegramNotifier;
  private apiServer!: ApiServer;
  private pairlistPipeline!: PairlistPipeline;
  private decisionEngine!: DecisionEngine;
  private orderManager!: OrderManager;
  private positionTracker!: PositionTracker;
  private riskGuard!: RiskGuard;
  private performanceTracker!: PerformanceTracker;
  private wsManager!: WebSocketManager;
  private dataAggregator!: DataAggregator;
  private yahoo!: YahooFinanceClient;
  private tickerMapper!: TickerMapper;
  private t212Client!: Trading212Client;
  private tradePlanner!: TradePlanner;
  private approvalManager!: ApprovalManager;
  private correlationAnalyzer!: CorrelationAnalyzer;
  private orderReplacer!: OrderReplacer;
  private priceStreamer!: PriceStreamer;
  private paused = false;
  private startedAt = '';
  private activeStocks: StockInfo[] = [];
  private lastKnownPortfolio: { cash: number; value: number; timestamp: string } | null = null;
  private lossCooldownUntil: Date | null = null;

  // Orchestrators
  private analysisOrchestrator!: AnalysisOrchestrator;
  private executionOrchestrator!: ExecutionOrchestrator;
  private positionOrchestrator!: PositionOrchestrator;

  async start(): Promise<void> {
    log.info('Starting Trading Bot...');

    // 0. Setup global error handlers
    setupGlobalErrorHandlers((error, source) => {
      log.fatal({ err: error, source }, 'Critical error - attempting to notify Telegram');
      // Send emergency alert via telegram if available
      if (this.telegram) {
        this.telegram
          .sendAlert(`CRITICAL ERROR (${source})`, `${error.message}\n\nBot may be unstable!`)
          .catch(() => {
            /* ignore telegram errors during critical shutdown */
          });
      }
    });

    // 1. Database
    initDatabase();

    // 2. Config
    await configManager.seedDefaults();
    const environment = configManager.get<string>('t212.environment');
    const accountType = configManager.get<string>('t212.accountType');
    const dryRun = configManager.get<boolean>('execution.dryRun');
    log.info({ environment, accountType, dryRun }, 'Configuration loaded');

    // 3. Trading212 client
    this.t212Client = new Trading212Client(process.env.TRADING212_API_KEY ?? '');

    // 4. Ticker mapper
    this.tickerMapper = new TickerMapper(this.t212Client);
    await this.tickerMapper.load();

    // 5. Data sources
    this.yahoo = new YahooFinanceClient();
    const finnhub = new FinnhubClient();
    const marketaux = new MarketauxClient();

    // 6. Data aggregator
    this.dataAggregator = new DataAggregator(this.yahoo, finnhub, marketaux);

    // 7. Pairlist pipeline
    this.pairlistPipeline = createPairlistPipeline();

    // 8. Decision engine
    this.decisionEngine = new DecisionEngine();

    // 9. Execution components
    this.orderManager = new OrderManager();
    this.orderManager.setT212Client(this.t212Client);
    this.positionTracker = new PositionTracker();
    this.riskGuard = new RiskGuard();

    // 10. Performance tracker
    this.performanceTracker = new PerformanceTracker();

    // 10b. Trade planner + approval
    this.tradePlanner = new TradePlanner();
    this.approvalManager = new ApprovalManager(this.tradePlanner);

    // 10c. Correlation analyzer
    this.correlationAnalyzer = new CorrelationAnalyzer();

    // 10f. Order replacer (opt-in repricing of unfilled limit orders)
    this.orderReplacer = new OrderReplacer(this.t212Client);

    // 10g. Strategy profiles — seed built-in presets
    try {
      getStrategyProfileManager().seedBuiltinPresets();
    } catch (err) {
      log.error({ err }, 'Failed to seed strategy profiles');
    }

    // 10h. Partial exit manager — needs T212 client for execution
    getPartialExitManager().setT212Client(this.t212Client);

    // 11. Telegram with command handlers
    this.telegram = new TelegramNotifier();
    this.telegram.registerCommands({
      onStatus: () => this.handleStatusCommand(),
      onPause: () => this.handlePauseCommand(),
      onResume: () => this.handleResumeCommand(),
      onClose: (ticker) => this.handleCloseCommand(ticker),
      onPositions: () => this.handlePositionsCommand(),
      onPerformance: () => this.handlePerformanceCommand(),
      onPairlist: () => this.handlePairlistCommand(),
    });

    // 12. API server
    this.apiServer = new ApiServer();
    await this.apiServer.start();
    this.wsManager = this.apiServer.getWsManager();

    // 12c. PriceStreamer → WebSocket forwarding
    this.priceStreamer = new PriceStreamer();
    this.priceStreamer.on('price_update', (update) => {
      this.wsManager.broadcast('price_update', update);
    });

    // 10i. Create orchestrators
    this.analysisOrchestrator = new AnalysisOrchestrator({
      dataAggregator: this.dataAggregator,
      decisionEngine: this.decisionEngine,
      correlationAnalyzer: this.correlationAnalyzer,
      pairlistPipeline: this.pairlistPipeline,
      tickerMapper: this.tickerMapper,
      wsManager: this.wsManager,
    });

    this.executionOrchestrator = new ExecutionOrchestrator({
      orderManager: this.orderManager,
      riskGuard: this.riskGuard,
      tradePlanner: this.tradePlanner,
      approvalManager: this.approvalManager,
      correlationAnalyzer: this.correlationAnalyzer,
      telegram: this.telegram,
      wsManager: this.wsManager,
      getPortfolioState: () => this.getPortfolioState(),
      getLossCooldownUntil: () => this.lossCooldownUntil,
    });

    this.positionOrchestrator = new PositionOrchestrator({
      orderManager: this.orderManager,
      positionTracker: this.positionTracker,
      orderReplacer: this.orderReplacer,
      correlationAnalyzer: this.correlationAnalyzer,
      telegram: this.telegram,
      wsManager: this.wsManager,
      t212Client: this.t212Client,
      getPortfolioState: () => this.getPortfolioState(),
    });

    // 12b. Register bot callbacks for API control endpoints
    registerBotCallbacks({
      getStatus: () => ({ paused: this.paused, startedAt: this.startedAt }),
      setPaused: (paused) => {
        this.paused = paused;
        const audit = getAuditLogger();
        audit.logControl(paused ? 'Bot paused via API' : 'Bot resumed via API');
        log.info({ paused }, 'Bot pause state changed via API');
      },
      closePosition: async (symbol) => {
        const db = getDb();
        const pos = db
          .select()
          .from(schema.positions)
          .where(eq(schema.positions.symbol, symbol))
          .get();
        if (!pos) return `No open position for ${symbol}`;
        const accountType = configManager.get<string>('t212.accountType') as 'INVEST' | 'ISA';
        await this.orderManager.executeClose({
          symbol: pos.symbol,
          t212Ticker: pos.t212Ticker,
          shares: pos.shares,
          exitReason: 'Manual close via dashboard',
          accountType,
        });
        return `Position ${symbol} close executed`;
      },
      analyzeSymbol: async (symbol) => {
        const t212Ticker = this.tickerMapper.toT212Ticker(symbol);
        if (!t212Ticker) return `Unknown symbol: ${symbol}`;
        const portfolio = await this.getPortfolioState();
        await this.analyzeStock({ symbol, t212Ticker, name: symbol }, portfolio);
        return `Analysis completed for ${symbol}`;
      },
      refreshPairlist: async () => {
        await this.refreshPairlist();
        return `Pairlist refreshed: ${this.activeStocks.length} stocks`;
      },
      emergencyStop: async () => {
        log.warn('EMERGENCY STOP: Closing all positions and pausing bot');
        this.paused = true;
        const audit = getAuditLogger();
        audit.logControl('EMERGENCY STOP triggered', { source: 'dashboard' });

        const db = getDb();
        const allPositions = db.select().from(schema.positions).all();
        const accountType = configManager.get<string>('t212.accountType') as 'INVEST' | 'ISA';
        const results = await Promise.allSettled(
          allPositions.map((pos) =>
            this.orderManager.executeClose({
              symbol: pos.symbol,
              t212Ticker: pos.t212Ticker,
              shares: pos.shares,
              exitReason: 'Emergency stop',
              accountType,
            }),
          ),
        );
        const closed = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
        const failed = results.filter(
          (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success),
        );
        for (const f of failed) {
          log.error({ result: f }, 'Failed to close position during emergency stop');
        }
        await this.telegram.sendAlert(
          'EMERGENCY STOP',
          `Bot paused. ${closed}/${allPositions.length} positions closed.`,
        );
        this.wsManager.broadcast('bot_status', {
          status: 'paused',
          message: 'Emergency stop activated',
        });
        return `Emergency stop: ${closed}/${allPositions.length} positions closed, bot paused`;
      },
      getTradePlans: () => this.tradePlanner.getRecentPlans(),
      approveTradePlan: (id) => this.tradePlanner.approvePlan(id, 'dashboard'),
      rejectTradePlan: (id) => this.tradePlanner.rejectPlan(id),
    });

    // 13. Scheduler
    this.scheduler = new Scheduler();
    this.scheduler.setOnJobFailure((jobName, error) => {
      const criticalJobs = ['positionMonitor', 'analysisLoop', 't212Sync', 'expirePlans'];
      if (criticalJobs.includes(jobName)) {
        this.telegram
          .sendAlert('Job Failed', `Critical job '${jobName}' failed: ${error}`)
          .catch(() => {
            /* swallow telegram failures */
          });
      }
    });

    const pairlistMinutes = configManager.get<number>('pairlist.refreshMinutes');
    const analysisMinutes = configManager.get<number>('analysis.intervalMinutes');
    const positionMonitorMinutes = configManager.get<number>('execution.positionMonitorMinutes');
    const t212SyncMinutes = configManager.get<number>('execution.t212SyncMinutes');
    const dailySummaryTime = configManager.get<string>('monitoring.dailySummaryTime');
    const preMarketAlertTime = configManager.get<string>('monitoring.preMarketAlertTime');

    this.scheduler.registerJob(
      'pairlistRefresh',
      minutesToWeekdayCron(pairlistMinutes),
      () => this.refreshPairlist(),
      true,
    );

    this.scheduler.registerJob(
      'analysisLoop',
      minutesToWeekdayCron(analysisMinutes),
      () => this.analysisLoop(),
      true,
    );

    this.scheduler.registerJob(
      'positionMonitor',
      minutesToWeekdayCron(positionMonitorMinutes),
      () => this.positionOrchestrator.monitorPositions(),
      true,
    );

    this.scheduler.registerJob(
      't212Sync',
      minutesToWeekdayCron(t212SyncMinutes),
      () => this.positionOrchestrator.syncPositions(),
      true,
    );

    this.scheduler.registerJob(
      'dailySummary',
      timeToCron(dailySummaryTime),
      () => this.sendDailySummary(),
      false,
    );

    this.scheduler.registerJob(
      'preMarketAlert',
      timeToCron(preMarketAlertTime),
      () => this.sendPreMarketAlert(),
      false,
    );

    this.scheduler.registerJob('weeklyReport', '0 17 * * 5', () => this.sendWeeklyReport(), false);

    // 24/7 news monitoring (off-hours, reduced frequency)
    const newsOffHoursMinutes = configManager.get<number>(
      'data.newsMonitoring.offHoursIntervalMinutes',
    );
    const newsMonEnabled = configManager.get<boolean>('data.newsMonitoring.enabled');
    if (newsMonEnabled) {
      this.scheduler.registerJob(
        'offHoursNews',
        minutesToWeekdayCron(newsOffHoursMinutes),
        () => this.offHoursNewsMonitor(),
        false, // runs 24/7
      );
    }

    // Position re-evaluation
    const reEvalEnabled = configManager.get<boolean>('execution.reEvaluatePositions');
    const reEvalMinutes = configManager.get<number>('execution.reEvalIntervalMinutes');
    if (reEvalEnabled) {
      this.scheduler.registerJob(
        'positionReEval',
        minutesToWeekdayCron(reEvalMinutes),
        () => this.reEvaluatePositions(),
        true,
      );
    }

    // Expire old trade plans + cleanup expired pair locks (every 5 min)
    this.scheduler.registerJob(
      'expirePlans',
      '*/5 * * * *',
      () => {
        this.approvalManager.checkExpiredPlans();
        try {
          getPairLockManager().cleanupExpired();
        } catch (err) {
          log.error({ err }, 'Pair lock cleanup failed');
        }
      },
      false,
    );

    // Conditional orders monitoring
    const condOrdersEnabled = configManager.get<boolean>('conditionalOrders.enabled');
    if (condOrdersEnabled) {
      const checkIntervalSec = configManager.get<number>('conditionalOrders.checkIntervalSeconds');
      this.scheduler.registerJob(
        'conditionalOrders',
        `*/${Math.max(1, Math.ceil(checkIntervalSec / 60))} * * * 1-5`,
        () => this.checkConditionalOrders(),
        true,
      );
    }

    this.scheduler.start();

    this.startedAt = new Date().toISOString();

    // 14. Send startup notification
    await this.telegram.sendMessage(
      `<b>Trading Bot Started</b>\nEnv: ${environment}\nAccount: ${accountType}\nDry run: ${dryRun}\nMarket: ${getMarketStatus()}`,
    );

    log.info('Trading Bot started successfully');
  }

  async stop(): Promise<void> {
    log.info('Shutting down — cancelling pending orders...');
    try {
      const orders = await this.t212Client.getOrders();
      const pending = orders.filter((o) => o.status === 'NEW' || o.status === 'PARTIALLY_FILLED');
      for (const order of pending) {
        try {
          await this.t212Client.cancelOrder(order.id);
          log.info({ orderId: order.id }, 'Cancelled pending order during shutdown');
        } catch (err) {
          log.error({ orderId: order.id, err }, 'Failed to cancel order during shutdown');
        }
      }
      if (pending.length > 0) {
        log.info({ count: pending.length }, 'Pending orders cancelled');
      }
    } catch (err) {
      log.error({ err }, 'Failed to cancel orders during shutdown');
    }
    this.scheduler.stop();
    await this.apiServer.stop();
    this.telegram.stop();
    await this.telegram.sendMessage('<b>Trading Bot stopping...</b>');
    log.info('Trading Bot stopped');
  }

  // ─── Core Loops ────────────────────────────────────────

  private async refreshPairlist(): Promise<void> {
    this.activeStocks = await this.analysisOrchestrator.refreshPairlist(this.activeStocks);
  }

  private async analysisLoop(): Promise<void> {
    if (this.paused) {
      log.info('Bot is paused, skipping analysis loop');
      return;
    }

    // Clear cool-down if it has expired
    if (this.lossCooldownUntil && new Date() >= this.lossCooldownUntil) {
      log.info('Loss cool-down period expired, resuming normal position sizing');
      this.lossCooldownUntil = null;
    }

    // Check daily loss limit — cool-down recovery instead of permanent pause
    const portfolio = await this.getPortfolioState();
    if (this.riskGuard.checkDailyLoss(portfolio)) {
      const dailyLossLimitPct = configManager.get<number>('risk.dailyLossLimitPct');
      const isInCooldown = this.lossCooldownUntil && new Date() < this.lossCooldownUntil;

      if (isInCooldown) {
        // Already in cool-down — check hard limit (2x daily loss)
        const hardLimitPct = dailyLossLimitPct * 2;
        if (Math.abs(portfolio.todayPnlPct) >= hardLimitPct) {
          log.error(
            { todayPnlPct: portfolio.todayPnlPct, hardLimit: -hardLimitPct },
            'HARD LIMIT: Daily loss exceeded 2x limit during cool-down — emergency stop',
          );
          const audit = getAuditLogger();
          audit.logRisk(
            `Hard loss limit breached (2x): ${formatPercent(portfolio.todayPnlPct)}`,
            { hardLimitPct, todayPnlPct: portfolio.todayPnlPct },
            'error',
          );
          // Trigger emergency stop via the existing callback
          this.paused = true;
          this.lossCooldownUntil = null;
          const db = getDb();
          const allPositions = db.select().from(schema.positions).all();
          const accountType = configManager.get<string>('t212.accountType') as 'INVEST' | 'ISA';
          const results = await Promise.allSettled(
            allPositions.map((pos) =>
              this.orderManager.executeClose({
                symbol: pos.symbol,
                t212Ticker: pos.t212Ticker,
                shares: pos.shares,
                exitReason: 'Hard loss limit emergency stop',
                accountType,
              }),
            ),
          );
          const closed = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
          await this.telegram.sendAlert(
            'HARD LOSS LIMIT',
            `Emergency stop: daily loss ${formatPercent(portfolio.todayPnlPct)} exceeded 2x limit. ${closed}/${allPositions.length} positions closed.`,
          );
          this.wsManager.broadcast('bot_status', {
            status: 'paused',
            message: 'Hard loss limit emergency stop',
          });
          return;
        }
        // Still within hard limit — continue with reduced sizing (handled in executeApprovedPlan)
        log.warn(
          {
            todayPnlPct: portfolio.todayPnlPct,
            cooldownUntil: this.lossCooldownUntil?.toISOString(),
          },
          'Daily loss limit breached but in cool-down — continuing with reduced position sizes',
        );
      } else {
        // First breach — activate cool-down instead of pausing
        const cooldownMinutes = configManager.get<number>('risk.lossCooldownMinutes') ?? 60;
        this.lossCooldownUntil = new Date(Date.now() + cooldownMinutes * 60_000);
        const audit = getAuditLogger();
        audit.logRisk(`Daily loss limit breached — entering ${cooldownMinutes}min cool-down`, {
          todayPnlPct: portfolio.todayPnlPct,
          cooldownUntil: this.lossCooldownUntil.toISOString(),
        });
        log.warn(
          { cooldownMinutes, cooldownUntil: this.lossCooldownUntil.toISOString() },
          'Daily loss limit breached — entering cool-down with reduced position sizing',
        );
        await this.telegram.sendAlert(
          'Daily Loss Cool-Down',
          `Loss limit breached (${formatPercent(portfolio.todayPnlPct)}). Entering ${cooldownMinutes}-minute cool-down with reduced position sizing. Hard stop at 2x loss.`,
        );
        this.wsManager.broadcast('bot_status', {
          status: 'cooldown',
          message: `Loss cool-down active until ${this.lossCooldownUntil.toISOString()}`,
        });
      }
    }

    // Check drawdown alert
    if (this.riskGuard.checkDrawdown(portfolio)) {
      await this.telegram.sendAlert(
        'Drawdown Alert',
        `Portfolio drawdown exceeded threshold. Value: ${formatCurrency(portfolio.portfolioValue)}`,
      );
    }

    if (this.activeStocks.length === 0) {
      log.warn('No active stocks in pairlist, running refresh first');
      await this.refreshPairlist();
      if (this.activeStocks.length === 0) return;
    }

    log.info({ stockCount: this.activeStocks.length }, 'Starting analysis loop');

    // Fetch SPY candles once for regime detection (shared across all stocks)
    let spyCandles: import('./data/yahoo-finance.js').OHLCVCandle[] = [];
    try {
      spyCandles = await this.yahoo.getHistoricalData('SPY', 90);
    } catch (err) {
      log.debug({ err }, 'Failed to fetch SPY candles for regime detection');
    }

    // Parallel analysis with bounded concurrency (5 stocks at a time)
    const limit = pLimit(5);
    const analysisPromises = this.activeStocks.map((stock) =>
      limit(async () => {
        try {
          await this.analyzeStock(stock, portfolio, spyCandles);
        } catch (err) {
          log.error({ symbol: stock.symbol, err }, 'Analysis failed for stock');
        }
      }),
    );

    await Promise.all(analysisPromises);
  }

  private async analyzeStock(
    stock: StockInfo,
    portfolio: PortfolioState,
    spyCandles: import('./data/yahoo-finance.js').OHLCVCandle[] = [],
  ): Promise<void> {
    const result = await this.analysisOrchestrator.analyzeStock(stock, portfolio, spyCandles);
    if (!result) return;

    const { shouldTrade, decision, data, technicalScore, fundamentalScore, sentimentScore } =
      result;

    if (shouldTrade) {
      await this.executionOrchestrator.executeTrade(
        stock.symbol,
        stock.t212Ticker,
        data,
        decision,
        portfolio,
        technicalScore,
        fundamentalScore,
        sentimentScore,
      );
    }
  }

  private async sendDailySummary(): Promise<void> {
    try {
      const summary = this.performanceTracker.generateDailySummary();
      await this.telegram.sendMessage(summary);
      await this.performanceTracker.saveDailyMetrics();

      // Generate scheduled daily report
      try {
        const reportGen = getReportGenerator();
        const report = await reportGen.generateDailyReport();
        if (report) {
          const text = reportGen.formatAsText(report);
          await this.telegram.sendMessage(text);
          log.info('Daily report generated and sent');
        }
      } catch (repErr) {
        log.error({ repErr }, 'Daily report generation failed');
      }

      // Reset cool-down at end of trading day
      if (this.lossCooldownUntil) {
        log.info('Clearing loss cool-down at end of trading day');
        this.lossCooldownUntil = null;
      }
    } catch (err) {
      log.error({ err }, 'Failed to send daily summary');
    }
  }

  private async sendPreMarketAlert(): Promise<void> {
    try {
      const db = getDb();
      const openPositions = db.select().from(schema.positions).all();
      const metrics = this.performanceTracker.getMetrics();
      const lines = [
        '<b>Pre-Market Alert</b>',
        `Open positions: ${openPositions.length}`,
        `Market status: ${getMarketStatus()}`,
        `All-time win rate: ${formatPercent(metrics.winRate)}`,
        `Pairlist size: ${this.activeStocks.length}`,
      ];
      await this.telegram.sendMessage(lines.join('\n'));
    } catch (err) {
      log.error({ err }, 'Failed to send pre-market alert');
    }
  }

  private async sendWeeklyReport(): Promise<void> {
    try {
      const report = this.performanceTracker.generateWeeklySummary();
      await this.telegram.sendMessage(report);

      // Generate scheduled weekly report
      try {
        const reportGen = getReportGenerator();
        const weeklyReport = await reportGen.generateWeeklyReport();
        if (weeklyReport) {
          const text = reportGen.formatAsText(weeklyReport);
          await this.telegram.sendMessage(text);
          log.info('Weekly report generated and sent');
        }
      } catch (repErr) {
        log.error({ repErr }, 'Weekly report generation failed');
      }
    } catch (err) {
      log.error({ err }, 'Failed to send weekly report');
    }
  }

  // ─── Telegram Command Handlers ─────────────────────────

  private async handleStatusCommand(): Promise<string> {
    const marketStatus = getMarketStatus();
    const portfolio = await this.getPortfolioState();
    const uptime = this.getUptime();

    const statusLabel = this.paused
      ? 'PAUSED'
      : this.lossCooldownUntil && new Date() < this.lossCooldownUntil
        ? 'COOL-DOWN'
        : 'RUNNING';

    const lines = [
      '<b>Bot Status</b>',
      `Status: ${statusLabel}`,
      `Market: ${marketStatus}`,
      `Uptime: ${uptime}`,
      `Portfolio: ${formatCurrency(portfolio.portfolioValue)}`,
      `Cash: ${formatCurrency(portfolio.cashAvailable)}`,
      `Open positions: ${portfolio.openPositions}`,
      `Today P&L: ${formatCurrency(portfolio.todayPnl)} (${formatPercent(portfolio.todayPnlPct)})`,
      `Pairlist: ${this.activeStocks.length} stocks`,
    ];

    if (this.lossCooldownUntil && new Date() < this.lossCooldownUntil) {
      const remainingMs = this.lossCooldownUntil.getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60_000);
      const factor = configManager.get<number>('risk.lossCooldownSizeFactor') ?? 0.5;
      lines.push(
        `Cool-down: ${remainingMin}min remaining (${(factor * 100).toFixed(0)}% position sizing)`,
      );
    }

    return lines.join('\n');
  }

  private async handlePauseCommand(): Promise<string> {
    this.paused = true;
    log.info('Trading paused via Telegram');
    return 'Trading paused. Use /resume to restart.';
  }

  private async handleResumeCommand(): Promise<string> {
    this.paused = false;
    log.info('Trading resumed via Telegram');
    return 'Trading resumed.';
  }

  private async handleCloseCommand(ticker: string): Promise<string> {
    try {
      const db = getDb();
      const pos = db
        .select()
        .from(schema.positions)
        .where(eq(schema.positions.symbol, ticker))
        .get();
      if (!pos) return `No open position for ${ticker}.`;

      const accountType = configManager.get<string>('t212.accountType') as 'INVEST' | 'ISA';
      await this.orderManager.executeClose({
        symbol: pos.symbol,
        t212Ticker: pos.t212Ticker,
        shares: pos.shares,
        exitReason: 'Manual close via Telegram',
        accountType,
      });
      return `Position ${ticker} close order submitted.`;
    } catch (err) {
      return `Failed to close ${ticker}: ${err}`;
    }
  }

  private async handlePositionsCommand(): Promise<string> {
    const db = getDb();
    const allPositions = db.select().from(schema.positions).all();
    if (allPositions.length === 0) return 'No open positions.';

    const lines = ['<b>Open Positions:</b>'];
    for (const p of allPositions) {
      const emoji = (p.pnlPct ?? 0) >= 0 ? '+' : '';
      lines.push(
        `${p.symbol}: ${p.shares} shares @ ${formatCurrency(p.entryPrice)} | ${emoji}${formatPercent(p.pnlPct ?? 0)}`,
      );
    }
    return lines.join('\n');
  }

  private async handlePerformanceCommand(): Promise<string> {
    const m = this.performanceTracker.getMetrics();
    return [
      '<b>Performance Metrics</b>',
      `Total trades: ${m.totalTrades}`,
      `Win rate: ${formatPercent(m.winRate)}`,
      `Avg return: ${formatPercent(m.avgReturnPct)}`,
      `Sharpe ratio: ${m.sharpeRatio.toFixed(2)}`,
      `Max drawdown: ${formatPercent(m.maxDrawdown)}`,
      `Profit factor: ${m.profitFactor.toFixed(2)}`,
      `Avg hold: ${m.avgHoldDuration}`,
      m.bestTrade ? `Best: ${m.bestTrade.symbol} (${formatPercent(m.bestTrade.pnlPct)})` : '',
      m.worstTrade ? `Worst: ${m.worstTrade.symbol} (${formatPercent(m.worstTrade.pnlPct)})` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async handlePairlistCommand(): Promise<string> {
    if (this.activeStocks.length === 0) return 'Pairlist is empty.';
    const symbols = this.activeStocks.map((s) => s.symbol).join(', ');
    return `<b>Active Pairlist (${this.activeStocks.length}):</b>\n${symbols}`;
  }

  // ─── New Feature Methods ──────────────────────────────

  private async offHoursNewsMonitor(): Promise<void> {
    // Only run outside market hours (analysis loop handles market hours)
    if (isUSMarketOpen()) return;

    if (this.activeStocks.length === 0) return;

    const audit = getAuditLogger();
    log.debug('Running off-hours news monitoring');

    try {
      // Check news for top stocks only (conserve API budget)
      const topStocks = this.activeStocks.slice(0, 10);
      for (const stock of topStocks) {
        const data = await this.dataAggregator.getStockData(stock.symbol);
        // Cache news in DB for use when market opens
        if (data.finnhubNews.length > 0 || data.marketauxNews.length > 0) {
          const totalNews = data.finnhubNews.length + data.marketauxNews.length;
          log.debug({ symbol: stock.symbol, newsCount: totalNews }, 'Off-hours news fetched');
        }
      }
    } catch (err) {
      log.error({ err }, 'Off-hours news monitoring failed');
      audit.logError('Off-hours news monitoring failed', { error: String(err) });
    }
  }

  private async reEvaluatePositions(): Promise<void> {
    const db = getDb();
    const allPositions = db.select().from(schema.positions).all();
    if (allPositions.length === 0) return;

    const audit = getAuditLogger();
    log.info({ positionCount: allPositions.length }, 'Re-evaluating open positions');

    // Fetch SPY candles once for regime detection
    let spyCandles: import('./data/yahoo-finance.js').OHLCVCandle[] = [];
    try {
      spyCandles = await this.yahoo.getHistoricalData('SPY', 90);
    } catch (err) {
      log.debug({ err }, 'Failed to fetch SPY candles for re-eval regime detection');
    }

    for (const pos of allPositions) {
      try {
        const data = await this.dataAggregator.getStockData(pos.symbol);
        if (!data.quote) continue;

        const techAnalysis = analyzeTechnicals(data.candles);
        const technicalScore = techAnalysis.score;
        const fundamentalScore = data.fundamentals ? scoreFundamentals(data.fundamentals) : 0;
        const sentimentInput: SentimentInput = {
          finnhubNews: data.finnhubNews,
          marketauxNews: data.marketauxNews,
          insiderTransactions: data.insiderTransactions,
          earnings: data.earnings,
        };
        const sentimentScore = scoreSentiment(sentimentInput);

        const correlationResults = this.correlationAnalyzer.checkCorrelationWithPortfolio(
          pos.symbol,
        );
        const portfolioCorrelations = correlationResults.map((c) => ({
          symbol: c.symbol2,
          correlation: c.correlation,
        }));

        // Regime + multi-timeframe for re-eval context
        let regimeAnalysis = null;
        try {
          if (spyCandles.length > 0) {
            regimeAnalysis = getRegimeDetector().detect(
              spyCandles,
              data.marketContext.vixLevel ?? undefined,
            );
          }
        } catch {
          /* non-critical */
        }

        let multiTimeframeResult = null;
        try {
          multiTimeframeResult = createMultiTimeframeAnalyzer().analyze(pos.symbol, data.candles);
        } catch {
          /* non-critical */
        }

        const portfolio = await this.getPortfolioState();
        const context = this.analysisOrchestrator.buildDecisionContext(
          pos.symbol,
          data,
          techAnalysis,
          technicalScore,
          fundamentalScore,
          sentimentScore,
          sentimentInput,
          portfolio,
          portfolioCorrelations,
          regimeAnalysis,
          multiTimeframeResult,
        );

        const decision = await this.decisionEngine.analyze(context);
        if (!decision) {
          log.warn({ symbol: pos.symbol }, 'Re-evaluation failed — skipping');
          continue;
        }

        // If decision engine suggests SELL for a position we hold, consider adjusting
        if (decision.decision === 'SELL' && decision.conviction > 60) {
          audit.logSignal(
            pos.symbol,
            `Re-evaluation suggests SELL (conviction: ${decision.conviction})`,
            {
              currentPnlPct: pos.pnlPct,
              reasoning: decision.reasoning,
            },
          );

          // Update exit conditions based on new analysis
          const newStopLoss = data.quote.price * (1 - decision.suggestedStopLossPct);
          const currentStop = pos.trailingStop ?? pos.stopLoss;
          if (currentStop && newStopLoss > currentStop) {
            db.update(schema.positions)
              .set({
                trailingStop: newStopLoss,
                exitConditions: JSON.stringify({
                  ...JSON.parse(pos.exitConditions ?? '{}'),
                  reEvalSuggestion: 'SELL',
                  reEvalConviction: decision.conviction,
                  reEvalReasoning: decision.reasoning,
                }),
                updatedAt: new Date().toISOString(),
              })
              .where(eq(schema.positions.symbol, pos.symbol))
              .run();

            log.info(
              { symbol: pos.symbol, oldStop: currentStop, newStop: newStopLoss },
              'Tightened stop after re-evaluation',
            );
          }
        }
      } catch (err) {
        log.error({ symbol: pos.symbol, err }, 'Position re-evaluation failed');
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────

  private async getPortfolioState(): Promise<PortfolioState> {
    try {
      const db = getDb();
      const allPositions = db.select().from(schema.positions).all();
      const positionsValue = allPositions.reduce(
        (sum: number, p) => sum + (p.currentPrice ?? p.entryPrice) * p.shares,
        0,
      );

      const today = new Date().toISOString().split('T')[0];
      const todayTrades = db
        .select()
        .from(schema.trades)
        .where(and(gte(schema.trades.entryTime, today), isNotNull(schema.trades.exitPrice)))
        .all();

      const closedTradePnl = todayTrades.reduce((sum: number, t) => sum + (t.pnl ?? 0), 0);

      // Include unrealized P&L from open positions
      const unrealizedPnl = allPositions.reduce(
        (sum: number, p) => sum + ((p.currentPrice ?? p.entryPrice) - p.entryPrice) * p.shares,
        0,
      );
      const todayPnl = closedTradePnl + unrealizedPnl;

      // Use T212 API for actual cash balance when available
      let cashAvailable = 0;
      let portfolioValue = 0;
      try {
        const accountCash = await this.t212Client.getAccountCash();
        cashAvailable = accountCash.free ?? accountCash.availableToTrade ?? 0;
        portfolioValue = (accountCash.total ?? cashAvailable) + positionsValue;
        if (portfolioValue <= 0) portfolioValue = cashAvailable + positionsValue;
        this.lastKnownPortfolio = {
          cash: cashAvailable,
          value: portfolioValue,
          timestamp: new Date().toISOString(),
        };
      } catch (err) {
        log.debug({ err }, 'Failed to fetch T212 account cash');
        if (this.lastKnownPortfolio) {
          const cacheAgeMs = Date.now() - new Date(this.lastKnownPortfolio.timestamp).getTime();
          if (cacheAgeMs < 30 * 60 * 1000) {
            log.warn({ cacheAge: Math.round(cacheAgeMs / 1000) }, 'Using cached portfolio values');
            cashAvailable = this.lastKnownPortfolio.cash;
            portfolioValue = this.lastKnownPortfolio.value;
          } else {
            log.error('Portfolio cache stale and T212 API unavailable — pausing trading');
            this.paused = true;
          }
        } else {
          log.error('No portfolio cache and T212 API unavailable — pausing trading');
          this.paused = true;
        }
      }

      // Sector exposure: count and dollar-weighted
      const sectorExposure: Record<string, number> = {};
      const sectorExposureValue: Record<string, number> = {};
      for (const p of allPositions) {
        const posValue = (p.currentPrice ?? p.entryPrice) * p.shares;
        const fundRow = db
          .select({ sector: schema.fundamentalCache.sector })
          .from(schema.fundamentalCache)
          .where(eq(schema.fundamentalCache.symbol, p.symbol))
          .orderBy(desc(schema.fundamentalCache.fetchedAt))
          .limit(1)
          .get();
        const sector = fundRow?.sector ?? 'Unknown';
        sectorExposure[sector] = (sectorExposure[sector] ?? 0) + 1;
        sectorExposureValue[sector] = (sectorExposureValue[sector] ?? 0) + posValue;
      }
      // Convert to percentages
      if (portfolioValue > 0) {
        for (const sector of Object.keys(sectorExposureValue)) {
          sectorExposureValue[sector] = sectorExposureValue[sector] / portfolioValue;
        }
      }

      // Track peak value in DB for drawdown calculation
      const latestMetrics = db
        .select()
        .from(schema.dailyMetrics)
        .orderBy(desc(schema.dailyMetrics.date))
        .limit(1)
        .get();
      const peakValue = Math.max(portfolioValue, latestMetrics?.portfolioValue ?? portfolioValue);

      return {
        cashAvailable,
        portfolioValue,
        openPositions: allPositions.length,
        todayPnl,
        todayPnlPct: portfolioValue > 0 ? todayPnl / portfolioValue : 0,
        sectorExposure,
        sectorExposureValue,
        peakValue,
      };
    } catch {
      log.error('getPortfolioState failed completely — pausing trading');
      this.paused = true;
      return {
        cashAvailable: 0,
        portfolioValue: 0,
        openPositions: 0,
        todayPnl: 0,
        todayPnlPct: 0,
        sectorExposure: {},
        sectorExposureValue: {},
        peakValue: 0,
      };
    }
  }

  private async checkConditionalOrders(): Promise<void> {
    try {
      const condOrderMgr = getConditionalOrderManager();

      // Build current prices from open positions
      const db = getDb();
      const allPositions = db.select().from(schema.positions).all();
      const currentPrices = new Map<string, number>();
      for (const p of allPositions) {
        if (p.currentPrice) currentPrices.set(p.symbol, p.currentPrice);
      }

      const triggered = condOrderMgr.checkTriggers(currentPrices);
      if (triggered.length > 0) {
        const audit = getAuditLogger();
        for (const action of triggered) {
          log.info(
            { orderId: action.orderId, type: action.action.type, symbol: action.symbol },
            'Conditional order triggered',
          );
          audit.logTrade(
            action.symbol,
            `Conditional order triggered: ${action.action.type} ${action.action.shares ?? 0} shares`,
            { orderId: action.orderId },
          );
        }
      }

      // Expire old orders
      const expired = condOrderMgr.expireOldOrders();
      if (expired > 0) {
        log.info({ count: expired }, 'Expired conditional orders');
      }
    } catch (err) {
      log.error({ err }, 'Conditional orders check failed');
    }
  }

  private getUptime(): string {
    if (!this.startedAt) return 'N/A';
    const ms = Date.now() - new Date(this.startedAt).getTime();
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h ${minutes}m`;
    }
    return `${hours}h ${minutes}m`;
  }
}

// ─── Entry Point ───────────────────────────────────────

const bot = new TradingBot();

process.on('SIGINT', async () => {
  log.info('SIGINT received, shutting down...');
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log.info('SIGTERM received, shutting down...');
  await bot.stop();
  process.exit(0);
});

bot.start().catch((err) => {
  log.fatal({ err }, 'Failed to start bot');
  process.exit(1);
});
