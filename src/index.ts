import 'dotenv/config';

import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import {
  type AIAgent,
  type AIContext,
  type AIDecision,
  createAIAgent,
  getActiveModelName,
} from './ai/agent.js';
import { MarketResearcher } from './ai/market-research.js';
import { getAISelfImprovement } from './ai/self-improvement.js';
import { CorrelationAnalyzer } from './analysis/correlation.js';
import { scoreFundamentals } from './analysis/fundamental/scorer.js';
import { type SentimentInput, scoreSentiment } from './analysis/sentiment/scorer.js';
import { analyzeTechnicals } from './analysis/technical/scorer.js';
import { registerBotCallbacks } from './api/routes.js';
import { ApiServer } from './api/server.js';
import { Trading212Client } from './api/trading212/client.js';
import { getWebhookManager } from './api/webhooks.js';
import type { WebSocketManager } from './api/websocket.js';
import { minutesToWeekdayCron, Scheduler, timeToCron } from './bot/scheduler.js';
import { configManager } from './config/manager.js';
import { getStrategyProfileManager } from './config/strategy-profiles.js';
import { DataAggregator, type StockData } from './data/data-aggregator.js';
import { FinnhubClient } from './data/finnhub.js';
import { MarketauxClient } from './data/marketaux.js';
import { TickerMapper } from './data/ticker-mapper.js';
import { YahooFinanceClient } from './data/yahoo-finance.js';
import { getDb, initDatabase } from './db/index.js';
import * as schema from './db/schema.js';
import { ApprovalManager } from './execution/approval-manager.js';
import { getConditionalOrderManager } from './execution/conditional-orders.js';
import { getDCAManager } from './execution/dca-manager.js';
import { type BuyParams, type CloseParams, OrderManager } from './execution/order-manager.js';
import { OrderReplacer } from './execution/order-replacer.js';
import { getPairLockManager } from './execution/pair-locks.js';
import { getPartialExitManager } from './execution/partial-exit-manager.js';
import { PositionTracker } from './execution/position-tracker.js';
import { getProtectionManager } from './execution/protections.js';
import { type PortfolioState, RiskGuard, type TradeProposal } from './execution/risk-guard.js';
import { TradePlanner } from './execution/trade-planner.js';
import { getAuditLogger } from './monitoring/audit-log.js';
import { ModelTracker } from './monitoring/model-tracker.js';
import { PerformanceTracker } from './monitoring/performance.js';
import { getReportGenerator } from './monitoring/report-generator.js';
import { getTaxTracker } from './monitoring/tax-tracker.js';
import { TelegramNotifier } from './monitoring/telegram.js';
import { getTradeJournalManager } from './monitoring/trade-journal.js';
import type { StockInfo } from './pairlist/filters.js';
import { createPairlistPipeline } from './pairlist/index.js';
import type { PairlistPipeline } from './pairlist/pipeline.js';
import { formatCurrency, formatPercent } from './utils/helpers.js';
import { createLogger } from './utils/logger.js';
import { getMarketStatus, isUSMarketOpen } from './utils/market-hours.js';

const log = createLogger('bot');

class TradingBot {
  private scheduler!: Scheduler;
  private telegram!: TelegramNotifier;
  private apiServer!: ApiServer;
  private pairlistPipeline!: PairlistPipeline;
  private aiAgent!: AIAgent;
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
  private marketResearcher!: MarketResearcher;
  private modelTracker!: ModelTracker;
  private correlationAnalyzer!: CorrelationAnalyzer;
  private orderReplacer!: OrderReplacer;

  private paused = false;
  private startedAt = '';
  private activeStocks: StockInfo[] = [];
  private lastKnownPortfolio: { cash: number; value: number; timestamp: string } | null = null;
  private lossCooldownUntil: Date | null = null;

  async start(): Promise<void> {
    log.info('Starting Trading Bot...');

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

    // 8. AI agent
    this.aiAgent = createAIAgent();

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

    // 10c. Market researcher (with live data fetcher for symbol-specific research)
    this.marketResearcher = new MarketResearcher(this.aiAgent);
    this.marketResearcher.setDataFetcher(async (symbols) => {
      const results = new Map<string, import('./ai/market-research.js').SymbolSnapshot>();
      for (const sym of symbols) {
        try {
          const [quote, fundamentals] = await Promise.all([
            this.yahoo.getQuote(sym),
            this.yahoo.getFundamentals(sym),
          ]);
          if (quote) {
            results.set(sym, {
              price: quote.price,
              change1dPct: quote.changePercent,
              marketCap: quote.marketCap ?? fundamentals?.marketCap ?? null,
              peRatio: fundamentals?.peRatio ?? null,
              sector: fundamentals?.sector ?? null,
            });
          }
        } catch (err) {
          log.debug({ err, symbol: sym }, 'Failed to fetch live data for research symbol');
        }
      }
      return results;
    });

    // 10d. Model tracker
    this.modelTracker = new ModelTracker();

    // 10e. Correlation analyzer
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
        await this.analyzeStock({ symbol, t212Ticker, name: symbol });
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
      runResearch: async (params) => {
        return this.marketResearcher.runResearch(params);
      },
      getResearchReports: () => this.marketResearcher.getRecentResearch(),
      getModelStats: () => this.modelTracker.getModelStats(),
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
      () => this.monitorPositions(),
      true,
    );

    this.scheduler.registerJob(
      't212Sync',
      minutesToWeekdayCron(t212SyncMinutes),
      () => this.syncPositions(),
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

    // AI market research
    const researchEnabled = configManager.get<boolean>('ai.research.enabled');
    const researchMinutes = configManager.get<number>('ai.research.intervalMinutes');
    if (researchEnabled) {
      this.scheduler.registerJob(
        'marketResearch',
        minutesToWeekdayCron(researchMinutes),
        () => this.runScheduledResearch(),
        true,
      );
    }

    // Model performance evaluation (daily)
    this.scheduler.registerJob(
      'modelEvaluation',
      '0 18 * * 1-5', // 6 PM ET weekdays
      async () => {
        await this.modelTracker.evaluatePendingPredictions();
      },
      false,
    );

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

    // AI self-improvement feedback (daily after model evaluation)
    const aiSelfImprovementEnabled = configManager.get<boolean>('aiSelfImprovement.enabled');
    if (aiSelfImprovementEnabled) {
      this.scheduler.registerJob(
        'aiSelfImprovement',
        '30 18 * * 1-5', // 6:30 PM ET weekdays
        () => this.runAISelfImprovement(),
        false,
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
    try {
      // Retry loading ticker mapper if not loaded yet
      if (!this.tickerMapper.isLoaded()) {
        log.info('Ticker mapper not loaded, attempting to load...');
        await this.tickerMapper.load();
      }
      const allStocks = this.tickerMapper.getUSEquities();
      this.activeStocks = await this.pairlistPipeline.run(allStocks);
      log.info({ count: this.activeStocks.length }, 'Pairlist refreshed');
      this.wsManager.broadcast('pairlist_updated', {
        symbols: this.activeStocks.map((s) => s.symbol),
      });
    } catch (err) {
      log.error({ err }, 'Pairlist refresh failed');
    }
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

    for (const stock of this.activeStocks) {
      try {
        await this.analyzeStock(stock);
      } catch (err) {
        log.error({ symbol: stock.symbol, err }, 'Analysis failed for stock');
      }
    }
  }

  private async analyzeStock(stock: StockInfo): Promise<void> {
    const { symbol, t212Ticker } = stock;

    // 1. Get full stock data
    const data = await this.dataAggregator.getStockData(symbol);
    if (!data.quote || data.candles.length === 0) {
      log.warn({ symbol }, 'Insufficient data, skipping');
      return;
    }

    // 2. Run scorers
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

    // 3. Compute portfolio correlations
    const correlationResults = this.correlationAnalyzer.checkCorrelationWithPortfolio(symbol);
    const portfolioCorrelations = correlationResults.map((c) => ({
      symbol: c.symbol2,
      correlation: c.correlation,
    }));

    // 4. Build AI context
    const portfolio = await this.getPortfolioState();
    const aiContext = this.buildAIContext(
      symbol,
      data,
      techAnalysis,
      technicalScore,
      fundamentalScore,
      sentimentScore,
      sentimentInput,
      portfolio,
      portfolioCorrelations,
    );

    // 5. AI decision
    const aiEnabled = configManager.get<boolean>('ai.enabled');
    let decision: AIDecision = {
      decision: 'HOLD',
      conviction: 0,
      reasoning: 'AI disabled',
      risks: [],
      suggestedStopLossPct: 0.05,
      suggestedPositionSizePct: 0.1,
      suggestedTakeProfitPct: 0.15,
      urgency: 'no_rush',
      exitConditions: '',
    };

    if (aiEnabled) {
      decision = await this.aiAgent.analyze(aiContext);
    }

    // 6. Store signal in DB
    const db = getDb();
    db.insert(schema.signals)
      .values({
        timestamp: new Date().toISOString(),
        symbol,
        rsi: techAnalysis.rsi,
        macdValue: techAnalysis.macd?.value ?? null,
        macdSignal: techAnalysis.macd?.signal ?? null,
        macdHistogram: techAnalysis.macd?.histogram ?? null,
        sma20: techAnalysis.sma20,
        sma50: techAnalysis.sma50,
        sma200: techAnalysis.sma200,
        ema12: techAnalysis.ema12,
        ema26: techAnalysis.ema26,
        bollingerUpper: techAnalysis.bollinger?.upper ?? null,
        bollingerMiddle: techAnalysis.bollinger?.middle ?? null,
        bollingerLower: techAnalysis.bollinger?.lower ?? null,
        atr: techAnalysis.atr,
        adx: techAnalysis.adx,
        stochasticK: techAnalysis.stochastic?.k ?? null,
        stochasticD: techAnalysis.stochastic?.d ?? null,
        williamsR: techAnalysis.williamsR,
        mfi: techAnalysis.mfi,
        cci: techAnalysis.cci,
        obv: techAnalysis.obv,
        vwap: techAnalysis.vwap,
        parabolicSar: techAnalysis.parabolicSar,
        roc: techAnalysis.roc,
        forceIndex: techAnalysis.forceIndex,
        volumeRatio: techAnalysis.volumeRatio,
        supportLevel: techAnalysis.supportResistance?.support ?? null,
        resistanceLevel: techAnalysis.supportResistance?.resistance ?? null,
        technicalScore,
        sentimentScore,
        fundamentalScore,
        aiScore: decision.conviction,
        convictionTotal:
          (technicalScore + fundamentalScore + sentimentScore + decision.conviction) / 4,
        decision: decision.decision,
        executed: false,
        aiReasoning: decision.reasoning,
        aiModel: getActiveModelName(),
        suggestedStopLossPct: decision.suggestedStopLossPct,
        suggestedPositionSizePct: decision.suggestedPositionSizePct,
        suggestedTakeProfitPct: decision.suggestedTakeProfitPct,
      })
      .run();

    // 7. Broadcast signal via WebSocket
    this.wsManager.broadcast('signal_generated', {
      symbol,
      decision: decision.decision,
      conviction: decision.conviction,
      technicalScore,
      fundamentalScore,
      sentimentScore,
    });

    // 7b. Webhook dispatch for signal
    try {
      await getWebhookManager().sendOutbound('signal_generated', {
        symbol,
        decision: decision.decision,
        conviction: decision.conviction,
        technicalScore,
        fundamentalScore,
        sentimentScore,
      });
    } catch {
      // Non-critical, swallow webhook errors
    }

    // 8. Execute if actionable
    if (decision.decision === 'BUY' || decision.decision === 'SELL') {
      await this.executeTrade(
        symbol,
        t212Ticker,
        data,
        decision,
        portfolio,
        technicalScore,
        fundamentalScore,
        sentimentScore,
      );
    }
  }

  private async executeTrade(
    symbol: string,
    t212Ticker: string,
    data: StockData,
    decision: AIDecision,
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

    // Record AI prediction for model tracking
    this.modelTracker.recordPrediction({
      aiModel: getActiveModelName(),
      symbol,
      decision: decision.decision,
      conviction: decision.conviction,
      priceAtSignal: price,
    });

    // Check portfolio correlation for BUY orders
    if (decision.decision === 'BUY') {
      const correlations = this.correlationAnalyzer.checkCorrelationWithPortfolio(symbol);
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
    const plan = this.tradePlanner.createPlan({
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
    this.wsManager.broadcast('trade_plan_created', plan);
    audit.logTrade(
      symbol,
      `Trade plan created: ${plan.side} ${plan.shares} shares @ $${price.toFixed(2)}`,
      {
        planId: plan.id,
        riskReward: plan.riskRewardRatio,
        conviction: plan.aiConviction,
      },
    );

    // Process through approval flow
    const { shouldExecute, plan: processedPlan } = await this.approvalManager.processNewPlan(plan);

    if (!shouldExecute) {
      // Approval required - send to Telegram and wait
      const planMsg = this.tradePlanner.formatPlanMessage(processedPlan);
      await this.telegram.sendMessage(
        `<b>Trade Plan Pending Approval</b>\n<pre>${planMsg}</pre>\n\nReply /approve_${plan.id} or /reject_${plan.id}`,
      );
      return;
    }

    // Execute the approved plan
    await this.executeApprovedPlan(processedPlan);
  }

  private async executeApprovedPlan(plan: ReturnType<TradePlanner['getPlan']>): Promise<void> {
    if (!plan) return;

    const accountType = plan.accountType as 'INVEST' | 'ISA';
    const audit = getAuditLogger();

    // Validate with risk guard
    const portfolio = await this.getPortfolioState();
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

    const validation = this.riskGuard.validateTrade(proposal, portfolio);
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
        conviction: plan.aiConviction,
      },
      'Executing trade from plan',
    );

    try {
      if (plan.side === 'BUY') {
        // Apply streak-based position size reduction
        let adjustedShares = plan.shares;
        const streakMultiplier = this.riskGuard.getLosingStreakMultiplier();
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
        if (this.lossCooldownUntil && new Date() < this.lossCooldownUntil) {
          const factor = configManager.get<number>('risk.lossCooldownSizeFactor') ?? 0.5;
          const beforeCooldown = adjustedShares;
          adjustedShares = Math.max(1, Math.floor(adjustedShares * factor));
          log.warn(
            {
              symbol: plan.symbol,
              factor,
              beforeCooldown,
              afterCooldown: adjustedShares,
              cooldownUntil: this.lossCooldownUntil.toISOString(),
            },
            'Cool-down: reduced position size',
          );
          audit.logRisk(
            `Cool-down reduction: ${plan.symbol} shares ${beforeCooldown} -> ${adjustedShares} (x${factor})`,
            { planId: plan.id, factor, cooldownUntil: this.lossCooldownUntil.toISOString() },
          );
        }

        const buyParams: BuyParams = {
          symbol: plan.symbol,
          t212Ticker: plan.t212Ticker,
          shares: adjustedShares,
          price: plan.entryPrice,
          stopLossPct: plan.stopLossPct,
          takeProfitPct: plan.takeProfitPct,
          aiReasoning: plan.aiReasoning ?? '',
          conviction: plan.aiConviction,
          aiModel: plan.aiModel ?? '',
          accountType,
        };
        await this.orderManager.executeBuy(buyParams);
      } else {
        const exitReason = plan.aiReasoning ?? 'AI sell signal';
        const closeParams: CloseParams = {
          symbol: plan.symbol,
          t212Ticker: plan.t212Ticker,
          shares: plan.shares,
          exitReason,
          accountType,
        };
        await this.orderManager.executeClose(closeParams);

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

      this.tradePlanner.markExecuted(plan.id);
      audit.logTrade(
        plan.symbol,
        `Trade executed: ${plan.side} ${plan.shares} shares @ $${plan.entryPrice.toFixed(2)}`,
        { planId: plan.id },
      );

      await this.telegram.sendTradeNotification({
        symbol: plan.symbol,
        side: plan.side,
        shares: plan.shares,
        price: plan.entryPrice,
        stopLoss: plan.stopLossPrice,
        reasoning: plan.aiReasoning ?? '',
      });

      this.wsManager.broadcast('trade_executed', {
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
            conviction: plan.aiConviction,
            reasoning: plan.aiReasoning,
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
      await this.telegram.sendAlert(
        'Trade Execution Failed',
        `${plan.symbol} ${plan.side}: ${err}`,
      );
    }
  }

  private async monitorPositions(): Promise<void> {
    try {
      // Update prices
      await this.positionTracker.updatePositions();

      // Update trailing stops for profitable positions
      await this.positionTracker.updateTrailingStops();

      // Check exit conditions (stop-loss, take-profit, AI conditions)
      const exitResult = await this.positionTracker.checkExitConditions();
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
          await this.orderManager.executeClose({
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

          await this.telegram.sendTradeNotification({
            symbol,
            side: 'SELL',
            shares: pos.shares,
            price: pos.currentPrice ?? pos.entryPrice,
            stopLoss: pos.stopLoss ?? 0,
            reasoning: exitReason,
          });

          this.wsManager.broadcast('trade_executed', {
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
        this.wsManager.broadcast('position_update', pos);
      }
    } catch (err) {
      log.error({ err }, 'Position monitor failed');
    }
  }

  private async syncPositions(): Promise<void> {
    try {
      await this.positionTracker.syncWithT212(this.t212Client);
    } catch (err) {
      log.error({ err }, 'T212 position sync failed');
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

        const portfolio = await this.getPortfolioState();
        const aiContext = this.buildAIContext(
          pos.symbol,
          data,
          techAnalysis,
          technicalScore,
          fundamentalScore,
          sentimentScore,
          sentimentInput,
          portfolio,
          portfolioCorrelations,
        );

        // Add position context to signal re-evaluation
        const aiEnabled = configManager.get<boolean>('ai.enabled');
        if (!aiEnabled) continue;

        const decision = await this.aiAgent.analyze(aiContext);

        // If AI suggests SELL for a position we hold, consider adjusting
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
                aiExitConditions: JSON.stringify({
                  ...JSON.parse(pos.aiExitConditions ?? '{}'),
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

  private async processOrderReplacements(): Promise<void> {
    const enabled = configManager.get<boolean>('execution.orderReplacement.enabled');
    if (!enabled) return;

    const audit = getAuditLogger();

    try {
      const result = await this.orderReplacer.processOpenOrders();
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
        await this.telegram.sendAlert(
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
      const { symbols, matrix } = this.correlationAnalyzer.getPortfolioCorrelationMatrix();

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

            await this.telegram.sendAlert(
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

  private async runScheduledResearch(): Promise<void> {
    try {
      const audit = getAuditLogger();
      const report = await this.marketResearcher.runResearch();
      audit.logResearch(`Market research completed: ${report.results.length} stocks analyzed`);
      this.wsManager.broadcast('research_completed', {
        reportId: report.id,
        resultCount: report.results.length,
      });
    } catch (err) {
      log.error({ err }, 'Scheduled market research failed');
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

  private buildAIContext(
    symbol: string,
    data: StockData,
    techAnalysis: ReturnType<typeof analyzeTechnicals>,
    technicalScore: number,
    fundamentalScore: number,
    sentimentScore: number,
    _sentimentInput: SentimentInput,
    portfolio: PortfolioState,
    portfolioCorrelations?: Array<{ symbol: string; correlation: number }>,
  ): AIContext {
    const candles = data.candles;
    const latest = candles[candles.length - 1];
    const fiveDaysAgo = candles.length >= 5 ? candles[candles.length - 5] : latest;
    const thirtyDaysAgo = candles.length >= 22 ? candles[candles.length - 22] : latest;

    const price = data.quote?.price ?? 0;
    const priceChange1d = latest ? (price - latest.close) / latest.close : 0;
    const priceChange5d = fiveDaysAgo ? (price - fiveDaysAgo.close) / fiveDaysAgo.close : 0;
    const priceChange1m = thirtyDaysAgo ? (price - thirtyDaysAgo.close) / thirtyDaysAgo.close : 0;

    // Fetch historical signals
    const db = getDb();
    const historicalSignalCount = configManager.get<number>('ai.historicalSignalCount');
    const prevSignals = db
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.symbol, symbol))
      .orderBy(desc(schema.signals.timestamp))
      .limit(historicalSignalCount)
      .all();

    const mc = data.marketContext;

    // Compute insider net buying from InsiderTx
    const insiderNetBuying = data.insiderTransactions.reduce((sum: number, tx) => {
      const val = tx.change ?? 0;
      return sum + val; // positive = buy, negative = sell
    }, 0);

    // Compute days to earnings
    const daysToEarnings =
      data.earnings.length > 0
        ? Math.ceil(
            (new Date(data.earnings[0].date).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
          )
        : null;

    // Existing positions from DB
    const dbPositions = db.select().from(schema.positions).all();

    return {
      symbol,
      currentPrice: price,
      priceChange1d,
      priceChange5d,
      priceChange1m,
      technical: {
        rsi: techAnalysis.rsi,
        macdValue: techAnalysis.macd?.value ?? null,
        macdSignal: techAnalysis.macd?.signal ?? null,
        macdHistogram: techAnalysis.macd?.histogram ?? null,
        sma20: techAnalysis.sma20,
        sma50: techAnalysis.sma50,
        sma200: techAnalysis.sma200,
        ema12: techAnalysis.ema12,
        ema26: techAnalysis.ema26,
        bollingerUpper: techAnalysis.bollinger?.upper ?? null,
        bollingerMiddle: techAnalysis.bollinger?.middle ?? null,
        bollingerLower: techAnalysis.bollinger?.lower ?? null,
        atr: techAnalysis.atr,
        adx: techAnalysis.adx,
        stochasticK: techAnalysis.stochastic?.k ?? null,
        stochasticD: techAnalysis.stochastic?.d ?? null,
        williamsR: techAnalysis.williamsR,
        mfi: techAnalysis.mfi,
        cci: techAnalysis.cci,
        obv: techAnalysis.obv,
        vwap: techAnalysis.vwap,
        parabolicSar: techAnalysis.parabolicSar,
        roc: techAnalysis.roc,
        forceIndex: techAnalysis.forceIndex,
        volumeRatio: techAnalysis.volumeRatio,
        support: techAnalysis.supportResistance?.support ?? null,
        resistance: techAnalysis.supportResistance?.resistance ?? null,
        score: technicalScore,
      },
      fundamental: {
        peRatio: data.fundamentals?.peRatio ?? null,
        forwardPE: data.fundamentals?.forwardPE ?? null,
        revenueGrowthYoY: data.fundamentals?.revenueGrowthYoY ?? null,
        profitMargin: data.fundamentals?.profitMargin ?? null,
        operatingMargin: data.fundamentals?.operatingMargin ?? null,
        debtToEquity: data.fundamentals?.debtToEquity ?? null,
        currentRatio: data.fundamentals?.currentRatio ?? null,
        marketCap: data.fundamentals?.marketCap ?? null,
        sector: data.fundamentals?.sector ?? null,
        beta: data.fundamentals?.beta ?? null,
        dividendYield: data.fundamentals?.dividendYield ?? null,
        score: fundamentalScore,
      },
      sentiment: {
        headlines: [
          ...data.finnhubNews.slice(0, 5).map((n) => ({
            title: n.headline,
            score: 0,
            source: n.source,
          })),
          ...data.marketauxNews.slice(0, 5).map((n) => ({
            title: n.title,
            score: n.sentimentScore ?? 0,
            source: n.source,
          })),
        ],
        insiderNetBuying,
        daysToEarnings,
        score: sentimentScore,
      },
      historicalSignals: prevSignals.map((s) => ({
        timestamp: s.timestamp,
        technicalScore: s.technicalScore ?? 0,
        sentimentScore: s.sentimentScore ?? 0,
        fundamentalScore: s.fundamentalScore ?? 0,
        decision: s.decision ?? 'HOLD',
        rsi: s.rsi ?? null,
        macdHistogram: s.macdHistogram ?? null,
      })),
      portfolio: {
        cashAvailable: portfolio.cashAvailable,
        portfolioValue: portfolio.portfolioValue,
        openPositions: portfolio.openPositions,
        maxPositions: configManager.get<number>('risk.maxPositions'),
        todayPnl: portfolio.todayPnl,
        todayPnlPct: portfolio.todayPnlPct,
        sectorExposure: portfolio.sectorExposure,
        existingPositions: dbPositions.map((p) => ({
          symbol: p.symbol,
          pnlPct: p.pnlPct ?? 0,
          entryPrice: p.entryPrice,
          currentPrice: p.currentPrice ?? p.entryPrice,
        })),
      },
      marketContext: {
        spyPrice: mc.spyPrice ?? 0,
        spyChange1d: mc.spyChange1d ?? 0,
        vixLevel: mc.vixLevel ?? 0,
        marketTrend: mc.marketTrend,
      },
      riskConstraints: {
        maxPositionSizePct: configManager.get<number>('risk.maxPositionSizePct'),
        maxStopLossPct: configManager.get<number>('risk.maxStopLossPct'),
        minStopLossPct: configManager.get<number>('risk.minStopLossPct'),
        maxRiskPerTradePct: configManager.get<number>('risk.maxRiskPerTradePct'),
        dailyLossLimitPct: configManager.get<number>('risk.dailyLossLimitPct'),
      },
      portfolioCorrelations: portfolioCorrelations ?? [],
    };
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

  private async evaluateDCAOpportunities(): Promise<void> {
    try {
      const dcaManager = getDCAManager();
      const db = getDb();
      const allPositions = db.select().from(schema.positions).all();
      const portfolio = await this.getPortfolioState();
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
              this.t212Client,
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

  private async runAISelfImprovement(): Promise<void> {
    try {
      const selfImprove = getAISelfImprovement();
      const aiModel = getActiveModelName();
      const feedback = await selfImprove.generateFeedback(aiModel);
      if (feedback) {
        log.info(
          { biases: feedback.biases.length, suggestions: feedback.suggestions.length },
          'AI self-improvement feedback generated',
        );
        const audit = getAuditLogger();
        audit.logResearch('AI self-improvement feedback generated', {
          biases: feedback.biases.length,
          suggestions: feedback.suggestions.length,
        });
      }
    } catch (err) {
      log.error({ err }, 'AI self-improvement failed');
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
