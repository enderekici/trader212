import 'dotenv/config';

import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { type AIAgent, type AIContext, type AIDecision, createAIAgent } from './ai/agent.js';
import { MarketResearcher } from './ai/market-research.js';
import { CorrelationAnalyzer } from './analysis/correlation.js';
import { scoreFundamentals } from './analysis/fundamental/scorer.js';
import { type SentimentInput, scoreSentiment } from './analysis/sentiment/scorer.js';
import { analyzeTechnicals } from './analysis/technical/scorer.js';
import { registerBotCallbacks } from './api/routes.js';
import { ApiServer } from './api/server.js';
import { Trading212Client } from './api/trading212/client.js';
import type { WebSocketManager } from './api/websocket.js';
import { minutesToWeekdayCron, Scheduler, timeToCron } from './bot/scheduler.js';
import { configManager } from './config/manager.js';
import { DataAggregator, type StockData } from './data/data-aggregator.js';
import { FinnhubClient } from './data/finnhub.js';
import { MarketauxClient } from './data/marketaux.js';
import { TickerMapper } from './data/ticker-mapper.js';
import { YahooFinanceClient } from './data/yahoo-finance.js';
import { getDb, initDatabase } from './db/index.js';
import * as schema from './db/schema.js';
import { ApprovalManager } from './execution/approval-manager.js';
import { type BuyParams, type CloseParams, OrderManager } from './execution/order-manager.js';
import { PositionTracker } from './execution/position-tracker.js';
import { type PortfolioState, RiskGuard, type TradeProposal } from './execution/risk-guard.js';
import { TradePlanner } from './execution/trade-planner.js';
import { getAuditLogger } from './monitoring/audit-log.js';
import { ModelTracker } from './monitoring/model-tracker.js';
import { PerformanceTracker } from './monitoring/performance.js';
import { TelegramNotifier } from './monitoring/telegram.js';
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
  private tickerMapper!: TickerMapper;
  private t212Client!: Trading212Client;
  private tradePlanner!: TradePlanner;
  private approvalManager!: ApprovalManager;
  private marketResearcher!: MarketResearcher;
  private modelTracker!: ModelTracker;
  private correlationAnalyzer!: CorrelationAnalyzer;

  private paused = false;
  private startedAt = '';
  private activeStocks: StockInfo[] = [];
  private lastKnownPortfolio: { cash: number; value: number; timestamp: string } | null = null;

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
    const yahoo = new YahooFinanceClient();
    const finnhub = new FinnhubClient();
    const marketaux = new MarketauxClient();

    // 6. Data aggregator
    this.dataAggregator = new DataAggregator(yahoo, finnhub, marketaux);

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

    // 10c. Market researcher
    this.marketResearcher = new MarketResearcher(this.aiAgent);

    // 10d. Model tracker
    this.modelTracker = new ModelTracker();

    // 10e. Correlation analyzer
    this.correlationAnalyzer = new CorrelationAnalyzer();

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

    // Expire old trade plans (every 5 min)
    this.scheduler.registerJob(
      'expirePlans',
      '*/5 * * * *',
      () => this.approvalManager.checkExpiredPlans(),
      false,
    );

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

    // Issue #5: Check daily loss limit and auto-pause if breached
    const portfolio = await this.getPortfolioState();
    if (this.riskGuard.checkDailyLoss(portfolio)) {
      this.paused = true;
      log.warn('Daily loss limit breached — auto-pausing trading');
      await this.telegram.sendAlert(
        'Daily Loss Limit',
        `Trading auto-paused. Today P&L: ${formatCurrency(portfolio.todayPnl)} (${formatPercent(portfolio.todayPnlPct)})`,
      );
      return;
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

    // 3. Build AI context
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
    );

    // 4. AI decision
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

    // 5. Store signal in DB
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
        aiModel: configManager.get<string>('ai.model'),
        suggestedStopLossPct: decision.suggestedStopLossPct,
        suggestedPositionSizePct: decision.suggestedPositionSizePct,
        suggestedTakeProfitPct: decision.suggestedTakeProfitPct,
      })
      .run();

    // 6. Broadcast signal via WebSocket
    this.wsManager.broadcast('signal_generated', {
      symbol,
      decision: decision.decision,
      conviction: decision.conviction,
      technicalScore,
      fundamentalScore,
      sentimentScore,
    });

    // 7. Execute if actionable
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
      aiModel: configManager.get<string>('ai.model'),
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
        const buyParams: BuyParams = {
          symbol: plan.symbol,
          t212Ticker: plan.t212Ticker,
          shares: plan.shares,
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
        const closeParams: CloseParams = {
          symbol: plan.symbol,
          t212Ticker: plan.t212Ticker,
          shares: plan.shares,
          exitReason: plan.aiReasoning ?? 'AI sell signal',
          accountType,
        };
        await this.orderManager.executeClose(closeParams);
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

        log.info({ symbol }, 'Auto-closing position due to exit condition');

        try {
          await this.orderManager.executeClose({
            symbol: pos.symbol,
            t212Ticker: pos.t212Ticker,
            shares: pos.shares,
            exitReason: 'Exit condition triggered',
            accountType,
          });

          await this.telegram.sendTradeNotification({
            symbol,
            side: 'SELL',
            shares: pos.shares,
            price: pos.currentPrice ?? pos.entryPrice,
            stopLoss: pos.stopLoss ?? 0,
            reasoning: 'Exit condition triggered',
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
    } catch (err) {
      log.error({ err }, 'Failed to send weekly report');
    }
  }

  // ─── Telegram Command Handlers ─────────────────────────

  private async handleStatusCommand(): Promise<string> {
    const marketStatus = getMarketStatus();
    const portfolio = await this.getPortfolioState();
    const uptime = this.getUptime();

    return [
      '<b>Bot Status</b>',
      `Status: ${this.paused ? 'PAUSED' : 'RUNNING'}`,
      `Market: ${marketStatus}`,
      `Uptime: ${uptime}`,
      `Portfolio: ${formatCurrency(portfolio.portfolioValue)}`,
      `Cash: ${formatCurrency(portfolio.cashAvailable)}`,
      `Open positions: ${portfolio.openPositions}`,
      `Today P&L: ${formatCurrency(portfolio.todayPnl)} (${formatPercent(portfolio.todayPnlPct)})`,
      `Pairlist: ${this.activeStocks.length} stocks`,
    ].join('\n');
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
    };
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
