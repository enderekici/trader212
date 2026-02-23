import { desc, eq } from 'drizzle-orm';
import type { CorrelationAnalyzer } from '../analysis/correlation.js';
import type {
  DecisionContext,
  DecisionEngine,
  TradeDecision,
} from '../analysis/decision-engine.js';
import { scoreFundamentals } from '../analysis/fundamental/scorer.js';
import type { MultiTimeframeResult } from '../analysis/multi-timeframe.js';
import { createMultiTimeframeAnalyzer } from '../analysis/multi-timeframe.js';
import type { RegimeAnalysis } from '../analysis/regime-detector.js';
import { getRegimeDetector } from '../analysis/regime-detector.js';
import { type SentimentInput, scoreSentiment } from '../analysis/sentiment/scorer.js';
import { analyzeTechnicals } from '../analysis/technical/scorer.js';
import { getWebhookManager } from '../api/webhooks.js';
import type { WebSocketManager } from '../api/websocket.js';
import { configManager } from '../config/manager.js';
import type { DataAggregator, StockData } from '../data/data-aggregator.js';
import type { SocialSentimentResult } from '../data/social-sentiment.js';
import { getSocialSentimentAnalyzer } from '../data/social-sentiment.js';
import type { TickerMapper } from '../data/ticker-mapper.js';
import type { OHLCVCandle } from '../data/yahoo-finance.js';
import { getDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { PortfolioState } from '../execution/risk-guard.js';
import { getAuditLogger } from '../monitoring/audit-log.js';
import type { StockInfo } from '../pairlist/filters.js';
import type { PairlistPipeline } from '../pairlist/pipeline.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('analysis-orchestrator');

export interface AnalysisOrchestratorDeps {
  dataAggregator: DataAggregator;
  decisionEngine: DecisionEngine;
  correlationAnalyzer: CorrelationAnalyzer;
  pairlistPipeline: PairlistPipeline;
  tickerMapper: TickerMapper;
  wsManager: WebSocketManager;
}

export class AnalysisOrchestrator {
  constructor(private deps: AnalysisOrchestratorDeps) {}

  async refreshPairlist(activeStocks: StockInfo[]): Promise<StockInfo[]> {
    try {
      // Retry loading ticker mapper if not loaded yet
      if (!this.deps.tickerMapper.isLoaded()) {
        log.info('Ticker mapper not loaded, attempting to load...');
        await this.deps.tickerMapper.load();
      }
      const allStocks = this.deps.tickerMapper.getUSEquities();
      const newActiveStocks = await this.deps.pairlistPipeline.run(allStocks);
      log.info({ count: newActiveStocks.length }, 'Pairlist refreshed');
      this.deps.wsManager.broadcast('pairlist_updated', {
        symbols: newActiveStocks.map((s) => s.symbol),
      });
      return newActiveStocks;
    } catch (err) {
      log.error({ err }, 'Pairlist refresh failed');
      return activeStocks;
    }
  }

  async analyzeStock(
    stock: StockInfo,
    portfolio: PortfolioState,
    spyCandles: OHLCVCandle[] = [],
  ): Promise<{
    shouldTrade: boolean;
    decision: TradeDecision;
    data: StockData;
    technicalScore: number;
    fundamentalScore: number;
    sentimentScore: number;
  } | null> {
    const { symbol } = stock;

    // 1. Get full stock data
    const data = await this.deps.dataAggregator.getStockData(symbol);
    if (!data.quote || data.candles.length === 0) {
      log.warn({ symbol }, 'Insufficient data, skipping');
      return null;
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

    // 2b. Confluence gate -- pre-filter before AI call
    let confluenceEnabled = false;
    try {
      confluenceEnabled = configManager.get<boolean>('analysis.confluenceEnabled');
    } catch {
      /* use defaults */
    }

    if (confluenceEnabled) {
      let minSignals = 2;
      let minScore = 55;
      let minAvgScore = 50;
      try {
        minSignals = configManager.get<number>('analysis.confluenceMinSignals');
      } catch {
        /* use defaults */
      }
      try {
        minScore = configManager.get<number>('analysis.confluenceMinScore');
      } catch {
        /* use defaults */
      }
      try {
        minAvgScore = configManager.get<number>('analysis.confluenceMinAvgScore');
      } catch {
        /* use defaults */
      }

      const scores = [technicalScore, fundamentalScore, sentimentScore];
      const passingSignals = scores.filter((s) => s >= minScore).length;
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

      if (passingSignals < minSignals || avgScore < minAvgScore) {
        log.debug(
          { symbol, technicalScore, fundamentalScore, sentimentScore, passingSignals, avgScore },
          'Confluence gate: insufficient signal alignment, skipping AI call',
        );
        const audit = getAuditLogger();
        audit.logSignal(
          symbol,
          `Skipped by confluence gate: ${passingSignals}/${minSignals} signals, avg ${avgScore.toFixed(0)}/${minAvgScore}`,
        );
        return null;
      }
    }

    // 3. Compute portfolio correlations
    const correlationResults = this.deps.correlationAnalyzer.checkCorrelationWithPortfolio(symbol);
    const portfolioCorrelations = correlationResults.map((c) => ({
      symbol: c.symbol2,
      correlation: c.correlation,
    }));

    // 3c. Regime detection (uses SPY candles fetched once per loop)
    let regimeAnalysis: RegimeAnalysis | null = null;
    try {
      if (spyCandles.length > 0) {
        regimeAnalysis = getRegimeDetector().detect(
          spyCandles,
          data.marketContext.vixLevel ?? undefined,
        );
      }
    } catch (err) {
      log.debug({ symbol, err }, 'Regime detection failed, continuing without');
    }

    // 3d. Multi-timeframe analysis
    let multiTimeframeResult: MultiTimeframeResult | null = null;
    try {
      multiTimeframeResult = createMultiTimeframeAnalyzer().analyze(symbol, data.candles);
    } catch (err) {
      log.debug({ symbol, err }, 'Multi-timeframe analysis failed, continuing without');
    }

    // 3e. Social sentiment (if module has data)
    let socialSentimentResult: SocialSentimentResult | null = null;
    try {
      const socialAnalyzer = getSocialSentimentAnalyzer();
      socialSentimentResult = await socialAnalyzer.analyzeSymbolFull(symbol, []);
    } catch (err) {
      log.debug({ symbol, err }, 'Social sentiment failed, continuing without');
    }

    // 4. Build AI context (portfolio passed from caller)
    const aiContext = this.buildDecisionContext(
      symbol,
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
      socialSentimentResult,
    );

    // 5. Decision engine
    const decision = await this.deps.decisionEngine.analyze(aiContext);
    if (!decision) {
      log.warn({ symbol }, 'Decision engine returned null -- skipping symbol');
      return null;
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
        decisionScore: decision.conviction,
        convictionTotal:
          (technicalScore + fundamentalScore + sentimentScore + decision.conviction) / 4,
        decision: decision.decision,
        executed: false,
        reasoning: decision.reasoning,
        suggestedStopLossPct: decision.suggestedStopLossPct,
        suggestedPositionSizePct: decision.suggestedPositionSizePct,
        suggestedTakeProfitPct: decision.suggestedTakeProfitPct,
      })
      .run();

    // 7. Broadcast signal via WebSocket
    this.deps.wsManager.broadcast('signal_generated', {
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

    // 8. Check conviction gate for BUY
    let shouldTrade = false;
    if (decision.decision === 'BUY') {
      let minConviction = 65;
      try {
        minConviction = configManager.get<number>('ai.minConvictionScore');
      } catch {
        /* use defaults */
      }

      if (decision.conviction < minConviction) {
        log.info(
          { symbol, conviction: decision.conviction, minConviction },
          'BUY conviction below threshold, holding',
        );
      } else {
        shouldTrade = true;
      }
    } else if (decision.decision === 'SELL') {
      shouldTrade = true;
    }

    return {
      shouldTrade,
      decision,
      data,
      technicalScore,
      fundamentalScore,
      sentimentScore,
    };
  }

  buildDecisionContext(
    symbol: string,
    data: StockData,
    techAnalysis: ReturnType<typeof analyzeTechnicals>,
    technicalScore: number,
    fundamentalScore: number,
    sentimentScore: number,
    _sentimentInput: SentimentInput,
    portfolio: PortfolioState,
    portfolioCorrelations?: Array<{ symbol: string; correlation: number }>,
    regimeAnalysis?: RegimeAnalysis | null,
    multiTimeframeResult?: MultiTimeframeResult | null,
    socialSentimentResult?: SocialSentimentResult | null,
  ): DecisionContext {
    const candles = data.candles;
    const latest = candles[candles.length - 1];
    const fiveDaysAgo = candles.length >= 5 ? candles[candles.length - 5] : latest;
    const thirtyDaysAgo = candles.length >= 22 ? candles[candles.length - 22] : latest;

    const price = data.quote?.price ?? 0;
    const priceChange1d = latest ? (price - latest.close) / latest.close : 0;
    const priceChange5d = fiveDaysAgo ? (price - fiveDaysAgo.close) / fiveDaysAgo.close : 0;
    const priceChange1m = thirtyDaysAgo ? (price - thirtyDaysAgo.close) / thirtyDaysAgo.close : 0;

    // Fetch historical signals (only when enabled)
    const db = getDb();
    const includeHistorical = configManager.get<boolean>('ai.includeHistoricalSignals');
    let prevSignals: (typeof schema.signals.$inferSelect)[] = [];
    if (includeHistorical) {
      const historicalSignalCount = configManager.get<number>('ai.historicalSignalCount');
      prevSignals = db
        .select()
        .from(schema.signals)
        .where(eq(schema.signals.symbol, symbol))
        .orderBy(desc(schema.signals.timestamp))
        .limit(historicalSignalCount)
        .all();
    }

    const mc = data.marketContext;

    // Compute insider net buying from InsiderTx
    const insiderNetBuying = data.insiderTransactions.reduce((sum: number, tx) => {
      const val = tx.change ?? 0;
      return sum + val; // positive = buy, negative = sell
    }, 0);

    // Compute days to earnings and estimates (nearest future event only)
    const now = Date.now();
    const nextEarnings = data.earnings
      .filter((e) => new Date(e.date).getTime() > now)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
    const nextEarningsTs = nextEarnings ? new Date(nextEarnings.date).getTime() : undefined;
    const daysToEarnings = nextEarningsTs
      ? Math.ceil((nextEarningsTs - now) / (1000 * 60 * 60 * 24))
      : null;
    const epsEstimateNextQ = nextEarnings?.epsEstimate ?? null;
    const revenueEstimateNextQ = nextEarnings?.revenueEstimate ?? null;

    // Existing positions from DB
    const dbPositions = db.select().from(schema.positions).all();

    return {
      symbol,
      currentPrice: price,
      priceChange1d,
      priceChange5d,
      priceChange1m,
      dayHigh: data.quote?.dayHigh ?? null,
      dayLow: data.quote?.dayLow ?? null,
      volume: data.quote?.volume ?? null,
      avgVolume: data.quote?.avgVolume ?? null,
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
        perfWeek: techAnalysis.perfWeek,
        perfMonth: techAnalysis.perfMonth,
        perfQuarter: techAnalysis.perfQuarter,
        perfYear: techAnalysis.perfYear,
        ichimoku: techAnalysis.ichimoku ?? null,
        adl: techAnalysis.adl,
        awesomeOscillator: techAnalysis.awesomeOscillator,
        support: techAnalysis.supportResistance?.support ?? null,
        resistance: techAnalysis.supportResistance?.resistance ?? null,
        candlestickBullish:
          techAnalysis.candlestickPatterns.bullish.length > 0
            ? techAnalysis.candlestickPatterns.bullish.join(', ')
            : null,
        candlestickBearish:
          techAnalysis.candlestickPatterns.bearish.length > 0
            ? techAnalysis.candlestickPatterns.bearish.join(', ')
            : null,
        candlestickNeutral:
          techAnalysis.candlestickPatterns.neutral.length > 0
            ? techAnalysis.candlestickPatterns.neutral.join(', ')
            : null,
        score: technicalScore,
      },
      fundamental: {
        peRatio: data.fundamentals?.peRatio ?? null,
        forwardPE: data.fundamentals?.forwardPE ?? null,
        pegRatio: data.fundamentals?.pegRatio ?? null,
        revenueGrowthYoY: data.fundamentals?.revenueGrowthYoY ?? null,
        profitMargin: data.fundamentals?.profitMargin ?? null,
        operatingMargin: data.fundamentals?.operatingMargin ?? null,
        debtToEquity: data.fundamentals?.debtToEquity ?? null,
        currentRatio: data.fundamentals?.currentRatio ?? null,
        marketCap: data.fundamentals?.marketCap ?? null,
        sector: data.fundamentals?.sector ?? null,
        beta: data.fundamentals?.beta ?? null,
        dividendYield: data.fundamentals?.dividendYield ?? null,
        industry: data.fundamentals?.industry ?? null,
        earningsSurprise: data.fundamentals?.earningsSurprise ?? null,
        roe: data.fundamentals?.roe ?? null,
        roa: data.fundamentals?.roa ?? null,
        freeCashflow: data.fundamentals?.freeCashflow ?? null,
        analystBuy: data.fundamentals?.analystBuy ?? null,
        analystSell: data.fundamentals?.analystSell ?? null,
        analystTargetPrice: data.fundamentals?.analystTargetPrice ?? null,
        analystConsensus: data.fundamentals?.analystConsensus ?? null,
        analystCount: data.fundamentals?.analystCount ?? null,
        shortInterestPct: data.fundamentals?.shortInterestPct ?? null,
        institutionalOwnershipPct: data.fundamentals?.institutionalOwnershipPct ?? null,
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
            relevanceScore: n.relevanceScore ?? undefined,
          })),
        ],
        insiderNetBuying,
        daysToEarnings,
        epsEstimateNextQ,
        revenueEstimateNextQ,
        sentimentBreakdown: socialSentimentResult?.sentimentBreakdown ?? null,
        topKeywords: socialSentimentResult?.keywords ?? [],
        finraShortVolumePct: data.finraShortVolume?.shortVolumePct ?? null,
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
        sectorExposureValue: portfolio.sectorExposureValue,
        existingPositions: dbPositions.map((p) => ({
          symbol: p.symbol,
          pnlPct: p.pnlPct ?? 0,
          entryPrice: p.entryPrice,
          currentPrice: p.currentPrice ?? p.entryPrice,
          shares: p.shares,
          stopLoss: p.stopLoss ?? null,
          trailingStop: p.trailingStop ?? null,
          holdDays: Math.ceil(
            (Date.now() - new Date(p.entryTime).getTime()) / (1000 * 60 * 60 * 24),
          ),
          dcaCount: p.dcaCount ?? 0,
          partialExitCount: p.partialExitCount ?? 0,
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
      ...(regimeAnalysis
        ? {
            regime: {
              regime: regimeAnalysis.regime,
              confidence: regimeAnalysis.confidence,
              spyTrend: regimeAnalysis.details.spyTrend,
              volatilityPctile: regimeAnalysis.details.volatilityPctile,
              newEntriesAllowed: regimeAnalysis.details.adjustments.newEntriesAllowed,
              positionSizeMultiplier: regimeAnalysis.details.adjustments.positionSizeMultiplier,
              stopLossMultiplier: regimeAnalysis.details.adjustments.stopLossMultiplier,
              entryThresholdAdjustment: regimeAnalysis.details.adjustments.entryThresholdAdjustment,
              breadthScore: regimeAnalysis.details.breadthScore,
            },
          }
        : {}),
      ...(multiTimeframeResult
        ? {
            multiTimeframe: {
              compositeScore: multiTimeframeResult.compositeScore,
              alignment: multiTimeframeResult.alignment,
              timeframeScores: multiTimeframeResult.timeframeScores,
              timeframeDetails: multiTimeframeResult.timeframeDetails.map((td) => ({
                timeframe: td.timeframe,
                score: td.score,
                signal: td.signal,
                candleCount: td.candleCount,
              })),
            },
          }
        : {}),
      ...(socialSentimentResult && socialSentimentResult.mentionCount > 0
        ? {
            socialSentiment: {
              overallScore: socialSentimentResult.overallScore,
              buzzScore: socialSentimentResult.buzzScore,
              mentionCount: socialSentimentResult.mentionCount,
              trendDirection: socialSentimentResult.trendDirection,
            },
          }
        : {}),
    };
  }
}
