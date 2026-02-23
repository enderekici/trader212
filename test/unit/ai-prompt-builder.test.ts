import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildAnalysisPrompt, buildResearchDataPrompt } from '../../src/ai/prompt-builder.js';
import type { AIContext } from '../../src/ai/agent.js';
import type { ResearchSymbolData } from '../../src/ai/market-research.js';
import type { MarketContext } from '../../src/data/yahoo-finance.js';
import type { RegimeAnalysis } from '../../src/analysis/regime-detector.js';

vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn((key: string) => {
      if (key === 'ai.research.detailedThreshold') return 3;
      return undefined;
    }),
  },
}));

function makeFullContext(): AIContext {
  return {
    symbol: 'AAPL',
    currentPrice: 150.25,
    priceChange1d: 0.015,
    priceChange5d: 0.032,
    priceChange1m: -0.045,
    dayHigh: 152.30,
    dayLow: 148.80,
    volume: 45000000,
    avgVolume: 38000000,
    technical: {
      rsi: 55.5,
      macdValue: 0.5432,
      macdSignal: 0.3210,
      macdHistogram: 0.2222,
      sma20: 148.50,
      sma50: 145.00,
      sma200: 140.00,
      ema12: 149.20,
      ema26: 147.80,
      bollingerUpper: 155.00,
      bollingerMiddle: 150.00,
      bollingerLower: 145.00,
      atr: 2.50,
      adx: 25.30,
      stochasticK: 60.00,
      stochasticD: 55.00,
      williamsR: -40.00,
      mfi: 55.50,
      cci: 50.00,
      obv: 1234567,
      vwap: 150.10,
      parabolicSar: 148.00,
      roc: 2.50,
      forceIndex: 5000,
      volumeRatio: 1.15,
      perfWeek: 0.012,
      perfMonth: 0.035,
      perfQuarter: -0.045,
      perfYear: 0.12,
      ichimoku: {
        tenkanSen: 149.50,
        kijunSen: 147.20,
        senkouSpanA: 148.10,
        senkouSpanB: 144.60,
        chikouSpan: 150.25,
      },
      adl: 12345678,
      awesomeOscillator: 1.23,
      support: 145.50,
      resistance: 155.50,
      candlestickBullish: null,
      candlestickBearish: null,
      candlestickNeutral: null,
      score: 65,
    },
    fundamental: {
      peRatio: 25.5,
      forwardPE: 22.3,
      pegRatio: 1.8,
      revenueGrowthYoY: 0.15,
      profitMargin: 0.255,
      operatingMargin: 0.30,
      debtToEquity: 1.5,
      currentRatio: 1.2,
      marketCap: 2.5e12,
      sector: 'Technology',
      beta: 1.1,
      dividendYield: 0.006,
      industry: 'Consumer Electronics',
      earningsSurprise: 0.082,
      roe: 0.147,
      roa: 0.058,
      freeCashflow: 95000000000,
      analystBuy: 28,
      analystSell: 4,
      analystTargetPrice: 180.0,
      analystConsensus: 'Buy',
      analystCount: 35,
      shortInterestPct: 0.008,
      institutionalOwnershipPct: 0.62,
      score: 70,
    },
    sentiment: {
      headlines: [
        { title: 'AAPL beats earnings expectations', score: 0.8, source: 'Reuters', relevanceScore: 0.92 },
        { title: 'Apple faces China headwinds', score: -0.3, source: 'Bloomberg', relevanceScore: 0.74 },
      ],
      insiderNetBuying: 5,
      daysToEarnings: 30,
      epsEstimateNextQ: 1.95,
      revenueEstimateNextQ: 94500000000,
      sentimentBreakdown: { positive: 0.55, negative: 0.20, neutral: 0.25 },
      topKeywords: ['earnings', 'AI', 'iPhone', 'China', 'buyback'],
      finraShortVolumePct: 38.5,
      score: 60,
    },
    historicalSignals: [
      {
        timestamp: '2024-01-15T10:00:00Z',
        technicalScore: 70,
        sentimentScore: 55,
        fundamentalScore: 65,
        decision: 'BUY',
        rsi: 45,
        macdHistogram: 0.15,
      },
      {
        timestamp: '2024-01-14T10:00:00Z',
        technicalScore: 60,
        sentimentScore: 50,
        fundamentalScore: 65,
        decision: 'HOLD',
        rsi: 50,
        macdHistogram: -0.05,
      },
    ],
    portfolio: {
      cashAvailable: 10000.50,
      portfolioValue: 50000.75,
      openPositions: 2,
      maxPositions: 10,
      todayPnl: 150.25,
      todayPnlPct: 0.003,
      sectorExposure: { Technology: 2, Healthcare: 1 },
      sectorExposureValue: { Technology: 0.45, Healthcare: 0.20 },
      existingPositions: [
        { symbol: 'MSFT', pnlPct: 0.05, entryPrice: 380.00, currentPrice: 399.00, shares: 10, stopLoss: 370.00, trailingStop: null, holdDays: 5, dcaCount: 0, partialExitCount: 0 },
        { symbol: 'GOOG', pnlPct: -0.02, entryPrice: 140.00, currentPrice: 137.20, shares: 25, stopLoss: null, trailingStop: 135.00, holdDays: 12, dcaCount: 1, partialExitCount: 0 },
      ],
    },
    marketContext: {
      spyPrice: 450.50,
      spyChange1d: 0.005,
      vixLevel: 15.25,
      marketTrend: 'bullish',
    },
    riskConstraints: {
      maxPositionSizePct: 0.10,
      maxStopLossPct: 0.08,
      minStopLossPct: 0.02,
      maxRiskPerTradePct: 0.02,
      dailyLossLimitPct: 0.03,
    },
  };
}

describe('buildAnalysisPrompt', () => {
  describe('system prompt', () => {
    it('returns a system prompt with trading analyst instructions', () => {
      const { system } = buildAnalysisPrompt(makeFullContext());
      expect(system).toContain('expert stock trading analyst');
      expect(system).toContain('Technical indicators');
      expect(system).toContain('Fundamental valuation');
      expect(system).toContain('News sentiment');
      expect(system).toContain('conservative');
      expect(system).toContain('HOLD');
      expect(system).toContain('valid JSON');
    });
  });

  describe('user prompt - price data', () => {
    it('includes symbol and formatted price data', () => {
      const { user } = buildAnalysisPrompt(makeFullContext());
      expect(user).toContain('AAPL');
      expect(user).toContain('$150.25');
      expect(user).toContain('1.50%'); // 0.015 * 100
      expect(user).toContain('3.20%'); // 0.032 * 100
      expect(user).toContain('-4.50%'); // -0.045 * 100
    });
  });

  describe('user prompt - technical indicators', () => {
    it('includes all technical indicators with proper formatting', () => {
      const { user } = buildAnalysisPrompt(makeFullContext());
      expect(user).toContain('RSI(14): 55.50');
      expect(user).toContain('MACD: Value 0.5432');
      expect(user).toContain('Signal 0.3210');
      expect(user).toContain('Histogram 0.2222');
      expect(user).toContain('SMA: 20-day 148.50');
      expect(user).toContain('50-day 145.00');
      expect(user).toContain('200-day 140.00');
      expect(user).toContain('EMA: 12-day 149.20');
      expect(user).toContain('26-day 147.80');
      expect(user).toContain('Bollinger Bands: Upper 155.00');
      expect(user).toContain('ATR(14): 2.50');
      expect(user).toContain('ADX(14): 25.30');
      expect(user).toContain('Stochastic: K 60.00');
      expect(user).toContain('D 55.00');
      expect(user).toContain('Williams %R: -40.00');
      expect(user).toContain('MFI(14): 55.50');
      expect(user).toContain('CCI(20): 50.00');
      expect(user).toContain('OBV: 1234567');
      expect(user).toContain('VWAP: 150.10');
      expect(user).toContain('Parabolic SAR: 148.00');
      expect(user).toContain('ROC(12): 2.50');
      expect(user).toContain('Force Index: 5000');
      expect(user).toContain('Volume Ratio (vs 20d avg): 1.15');
      expect(user).toContain('Support Level: 145.50');
      expect(user).toContain('Resistance Level: 155.50');
      expect(user).toContain('Composite Score: 65/100');
    });
  });

  describe('user prompt - fundamental metrics', () => {
    it('includes all fundamental metrics', () => {
      const { user } = buildAnalysisPrompt(makeFullContext());
      expect(user).toContain('P/E Ratio: 25.50');
      expect(user).toContain('Forward P/E: 22.30');
      expect(user).toContain('Revenue Growth YoY: 15.00%');
      expect(user).toContain('Profit Margin: 25.50%');
      expect(user).toContain('Operating Margin: 30.00%');
      expect(user).toContain('Debt/Equity: 1.50');
      expect(user).toContain('Current Ratio: 1.20');
      expect(user).toContain('$2.50T');
      expect(user).toContain('Sector: Technology');
      expect(user).toContain('Beta: 1.10');
      expect(user).toContain('Dividend Yield: 0.60%');
    });
  });

  describe('user prompt - sentiment', () => {
    it('includes headlines with scores and sources', () => {
      const { user } = buildAnalysisPrompt(makeFullContext());
      expect(user).toContain('[+0.80] "AAPL beats earnings expectations" (Reuters)');
      expect(user).toContain('[-0.30] "Apple faces China headwinds" (Bloomberg)');
      expect(user).toContain('Insider Net Buying: +5 transactions');
      expect(user).toContain('Days to Earnings: 30');
    });

    it('shows negative insider buying without plus sign', () => {
      const ctx = makeFullContext();
      ctx.sentiment.insiderNetBuying = -3;
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('Insider Net Buying: -3 transactions');
    });

    it('shows N/A for null daysToEarnings', () => {
      const ctx = makeFullContext();
      ctx.sentiment.daysToEarnings = null;
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('Days to Earnings: N/A');
    });

    it('shows "(no recent headlines)" when headlines are empty', () => {
      const ctx = makeFullContext();
      ctx.sentiment.headlines = [];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('(no recent headlines)');
    });
  });

  describe('user prompt - historical signals', () => {
    it('includes formatted historical signals', () => {
      const { user } = buildAnalysisPrompt(makeFullContext());
      expect(user).toContain('[2024-01-15T10:00:00Z]');
      expect(user).toContain('Tech: 70');
      expect(user).toContain('RSI: 45.00');
      expect(user).toContain('MACD-H: 0.15');
    });

    it('shows "(no prior signals)" when historicalSignals are empty', () => {
      const ctx = makeFullContext();
      ctx.historicalSignals = [];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('(no prior signals)');
    });
  });

  describe('user prompt - market conditions', () => {
    it('includes market conditions', () => {
      const { user } = buildAnalysisPrompt(makeFullContext());
      expect(user).toContain('SPY Price: $450.50');
      expect(user).toContain('SPY 1-Day Change: 0.50%');
      expect(user).toContain('VIX Level: 15.25');
      expect(user).toContain('Market Trend: bullish');
    });
  });

  describe('user prompt - portfolio state', () => {
    it('includes portfolio and position details', () => {
      const { user } = buildAnalysisPrompt(makeFullContext());
      expect(user).toContain('Cash Available: $10000.50');
      expect(user).toContain('Portfolio Value: $50000.75');
      expect(user).toContain('Open Positions: 2 / 10');
      expect(user).toContain('MSFT: 10 shares @ $380.00');
      expect(user).toContain('+5.00%');
      expect(user).toContain('stop $370.00');
      expect(user).toContain('5d held');
      expect(user).toContain('GOOG: 25 shares @ $140.00');
      expect(user).toContain('-2.00%');
      expect(user).toContain('trailing $135.00');
      expect(user).toContain('12d held');
      expect(user).toContain('DCA×1');
      expect(user).toContain('Technology: 2 position(s) (45.0% of portfolio)');
      expect(user).toContain('Healthcare: 1 position(s) (20.0% of portfolio)');
    });

    it('shows "(none)" when no existing positions', () => {
      const ctx = makeFullContext();
      ctx.portfolio.existingPositions = [];
      const { user } = buildAnalysisPrompt(ctx);
      // The positions section should show (none)
      expect(user).toContain('Existing Positions:\n  (none)');
    });

    it('shows "(none)" when no sector exposure', () => {
      const ctx = makeFullContext();
      ctx.portfolio.sectorExposure = {};
      ctx.portfolio.sectorExposureValue = {};
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('Sector Exposure:\n  (none)');
    });

    it('shows "no stop" when both stopLoss and trailingStop are null (line 190/192 false branch)', () => {
      // Cover the `'no stop'` path: trailingStop=null AND stopLoss=null
      const ctx = makeFullContext();
      ctx.portfolio.existingPositions = [
        { symbol: 'TSLA', pnlPct: 0.03, entryPrice: 200.00, currentPrice: 206.00, shares: 5, stopLoss: null, trailingStop: null, holdDays: 2, dcaCount: 0, partialExitCount: 0 },
      ];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('no stop');
    });

    it('shows partial-exit count in extras when partialExitCount > 0 (line 195 true branch)', () => {
      // Cover `if (pos.partialExitCount > 0)` TRUE branch
      const ctx = makeFullContext();
      ctx.portfolio.existingPositions = [
        { symbol: 'NVDA', pnlPct: 0.15, entryPrice: 500.00, currentPrice: 575.00, shares: 8, stopLoss: 480.00, trailingStop: null, holdDays: 10, dcaCount: 0, partialExitCount: 2 },
      ];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('partial-exit×2');
    });

    it('shows sector without value pct when sector missing from sectorExposureValue (line 205 false branch)', () => {
      // Cover `valuePct !== undefined` FALSE branch: sector exists in sectorExposure but NOT in sectorExposureValue
      const ctx = makeFullContext();
      ctx.portfolio.sectorExposure = { Energy: 1 };
      ctx.portfolio.sectorExposureValue = {}; // Energy not present → valuePct = undefined → no pct string
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('Energy: 1 position(s)');
      // Should NOT include "(X% of portfolio)" after Energy
      expect(user).not.toContain('Energy: 1 position(s) (');
    });
  });

  describe('user prompt - risk constraints', () => {
    it('includes formatted risk constraints', () => {
      const { user } = buildAnalysisPrompt(makeFullContext());
      expect(user).toContain('Max Position Size: 10.00% of portfolio');
      expect(user).toContain('Stop-Loss Range: 2.00% to 8.00%');
      expect(user).toContain('Max Risk Per Trade: 2.00% of portfolio');
      expect(user).toContain('Daily Loss Limit: 3.00% of portfolio');
    });
  });

  describe('user prompt - JSON schema', () => {
    it('includes the expected JSON response schema', () => {
      const { user } = buildAnalysisPrompt(makeFullContext());
      expect(user).toContain('"decision": "BUY | SELL | HOLD"');
      expect(user).toContain('"conviction": 0-100');
      expect(user).toContain('"urgency": "immediate | wait_for_dip | no_rush"');
    });
  });

  describe('fmt helpers - null value handling', () => {
    it('shows N/A for null technical indicators', () => {
      const ctx = makeFullContext();
      ctx.technical.rsi = null;
      ctx.technical.macdValue = null;
      ctx.technical.sma20 = null;
      ctx.technical.atr = null;
      ctx.technical.obv = null;
      ctx.technical.vwap = null;
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('RSI(14): N/A');
      expect(user).toContain('ATR(14): N/A');
    });

    it('shows N/A for null fundamental metrics', () => {
      const ctx = makeFullContext();
      ctx.fundamental.peRatio = null;
      ctx.fundamental.marketCap = null;
      ctx.fundamental.sector = null;
      ctx.fundamental.revenueGrowthYoY = null;
      ctx.fundamental.dividendYield = null;
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('P/E Ratio: N/A');
      expect(user).toContain('Market Cap: N/A');
      expect(user).toContain('Sector: N/A');
      expect(user).toContain('Revenue Growth YoY: N/A');
      expect(user).toContain('Dividend Yield: N/A');
    });
  });

  describe('fmtLarge - market cap formatting', () => {
    it('formats trillions', () => {
      const ctx = makeFullContext();
      ctx.fundamental.marketCap = 2.5e12;
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('$2.50T');
    });

    it('formats billions', () => {
      const ctx = makeFullContext();
      ctx.fundamental.marketCap = 800e9;
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('$800.00B');
    });

    it('formats millions', () => {
      const ctx = makeFullContext();
      ctx.fundamental.marketCap = 500e6;
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('$500.00M');
    });

    it('formats small values as dollars', () => {
      const ctx = makeFullContext();
      ctx.fundamental.marketCap = 999999;
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('$999999');
    });
  });

  describe('headline score formatting', () => {
    it('formats positive scores with + prefix', () => {
      const ctx = makeFullContext();
      ctx.sentiment.headlines = [{ title: 'Good news', score: 0.5, source: 'CNN' }];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('[+0.50]');
    });

    it('formats negative scores without + prefix', () => {
      const ctx = makeFullContext();
      ctx.sentiment.headlines = [{ title: 'Bad news', score: -0.5, source: 'CNN' }];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('[-0.50]');
    });

    it('formats zero score without + prefix', () => {
      const ctx = makeFullContext();
      ctx.sentiment.headlines = [{ title: 'Neutral news', score: 0, source: 'CNN' }];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('[0.00]');
    });
  });

  describe('portfolio correlations section', () => {
    it('renders high correlation label for abs >= 0.7', () => {
      const ctx = makeFullContext();
      ctx.portfolioCorrelations = [{ symbol: 'MSFT', correlation: 0.85 }];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('MSFT: 0.85 (high)');
      expect(user).toContain('PORTFOLIO CORRELATIONS:');
    });

    it('renders moderate correlation label for abs >= 0.4 and < 0.7', () => {
      const ctx = makeFullContext();
      ctx.portfolioCorrelations = [{ symbol: 'GOOG', correlation: 0.55 }];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('GOOG: 0.55 (moderate)');
    });

    it('renders low correlation label for abs < 0.4', () => {
      const ctx = makeFullContext();
      ctx.portfolioCorrelations = [{ symbol: 'TSLA', correlation: 0.15 }];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('TSLA: 0.15 (low)');
    });

    it('renders negative high correlation', () => {
      const ctx = makeFullContext();
      ctx.portfolioCorrelations = [{ symbol: 'SQQQ', correlation: -0.80 }];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('SQQQ: -0.80 (high)');
    });

    it('renders only correlation warnings when no correlations but warnings present', () => {
      const ctx = makeFullContext();
      ctx.portfolioCorrelations = [];
      ctx.correlationWarnings = ['High correlation with MSFT (0.85)'];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('CORRELATION WARNINGS:');
      expect(user).toContain('- High correlation with MSFT (0.85)');
      expect(user).not.toContain('PORTFOLIO CORRELATIONS:');
    });

    it('renders both correlations and warnings when both present', () => {
      const ctx = makeFullContext();
      ctx.portfolioCorrelations = [{ symbol: 'MSFT', correlation: 0.75 }];
      ctx.correlationWarnings = ['Exceeds max correlation threshold'];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('PORTFOLIO CORRELATIONS:');
      expect(user).toContain('MSFT: 0.75 (high)');
      expect(user).toContain('CORRELATION WARNINGS:');
      expect(user).toContain('- Exceeds max correlation threshold');
    });

    it('renders no correlation section when both empty', () => {
      const ctx = makeFullContext();
      ctx.portfolioCorrelations = [];
      ctx.correlationWarnings = [];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).not.toContain('PORTFOLIO CORRELATIONS:');
      expect(user).not.toContain('CORRELATION WARNINGS:');
    });

    it('renders no correlation section when both undefined', () => {
      const ctx = makeFullContext();
      // Do not set portfolioCorrelations or correlationWarnings
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).not.toContain('PORTFOLIO CORRELATIONS:');
      expect(user).not.toContain('CORRELATION WARNINGS:');
    });
  });


  describe('historical signal rsi/macdHistogram null handling', () => {
    it('formats null RSI and MACD histogram as N/A in historical signals', () => {
      const ctx = makeFullContext();
      ctx.historicalSignals = [
        {
          timestamp: '2024-01-15',
          technicalScore: 50,
          sentimentScore: 50,
          fundamentalScore: 50,
          decision: 'HOLD',
          rsi: null,
          macdHistogram: null,
        },
      ];
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('RSI: N/A');
      expect(user).toContain('MACD-H: N/A');
    });
  });

  describe('regime section', () => {
    it('includes MARKET REGIME section when context.regime is set', () => {
      const ctx = makeFullContext();
      ctx.regime = {
        regime: 'trending_up',
        confidence: 0.85,
        spyTrend: 'up',
        volatilityPctile: 30,
        newEntriesAllowed: true,
        positionSizeMultiplier: 1.0,
        stopLossMultiplier: 1.0,
        entryThresholdAdjustment: 0,
        breadthScore: 62,
      };
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('MARKET REGIME:');
      expect(user).toContain('Trending Up (Bull)');
      expect(user).toContain('85% confidence');
      expect(user).toContain('SPY Trend: up');
    });

    it('omits MARKET REGIME section when context.regime is not set', () => {
      const ctx = makeFullContext();
      // regime not set
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).not.toContain('MARKET REGIME:');
    });
  });

  describe('multi-timeframe section', () => {
    it('includes MULTI-TIMEFRAME ANALYSIS when multiTimeframe is set', () => {
      const ctx = makeFullContext();
      ctx.multiTimeframe = {
        compositeScore: 72,
        alignment: 'bullish',
        timeframeScores: { weekly: 70, monthly: 75 },
        timeframeDetails: [
          { timeframe: 'weekly', score: 72, signal: 'bullish', candleCount: 52 },
          { timeframe: 'monthly', score: 68, signal: 'bullish', candleCount: 12 },
        ],
      };
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('MULTI-TIMEFRAME ANALYSIS:');
      expect(user).toContain('Composite Score: 72/100');
      expect(user).toContain('Alignment: bullish');
    });

    it('adds CAUTION note when alignment is mixed', () => {
      const ctx = makeFullContext();
      ctx.multiTimeframe = {
        compositeScore: 50,
        alignment: 'mixed',
        timeframeScores: { weekly: 60, monthly: 40 },
        timeframeDetails: [],
      };
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('Alignment: mixed — CAUTION: conflicting timeframe signals');
    });

    it('omits MULTI-TIMEFRAME ANALYSIS when not set', () => {
      const ctx = makeFullContext();
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).not.toContain('MULTI-TIMEFRAME ANALYSIS:');
    });
  });

  describe('social sentiment section', () => {
    it('shows bearish label when overallScore < -0.2', () => {
      const ctx = makeFullContext();
      ctx.socialSentiment = {
        overallScore: -0.5,
        buzzScore: 30,
        mentionCount: 100,
        trendDirection: 'down',
      };
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('SOCIAL SENTIMENT:');
      expect(user).toContain('bearish');
    });

    it('shows bullish label when overallScore > 0.2 (line 141 true branch)', () => {
      const ctx = makeFullContext();
      ctx.socialSentiment = {
        overallScore: 0.5,
        buzzScore: 75,
        mentionCount: 500,
        trendDirection: 'up',
      };
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('SOCIAL SENTIMENT:');
      expect(user).toContain('bullish');
    });

    it('shows neutral label when overallScore is between -0.2 and 0.2', () => {
      const ctx = makeFullContext();
      ctx.socialSentiment = {
        overallScore: 0.1,
        buzzScore: 50,
        mentionCount: 200,
        trendDirection: 'sideways',
      };
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('neutral');
    });

    it('omits SOCIAL SENTIMENT when not set', () => {
      const ctx = makeFullContext();
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).not.toContain('SOCIAL SENTIMENT:');
    });
  });

  describe('regime crash label (line 105)', () => {
    it('shows "Market Crash (Risk-Off)" label when regime is crash', () => {
      const ctx = makeFullContext();
      ctx.regime = {
        regime: 'crash',
        confidence: 0.95,
        spyTrend: 'down',
        volatilityPctile: 95,
        newEntriesAllowed: false,
        positionSizeMultiplier: 0.25,
        stopLossMultiplier: 1.5,
        entryThresholdAdjustment: 10,
        breadthScore: 20,
      };
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('Market Crash (Risk-Off)');
    });

    it('falls back to raw regime name when regime is not in regimeLabels (line 110 ?? branch)', () => {
      // Cover `regimeLabels[rg.regime] ?? rg.regime` TRUE branch — unknown regime name
      const ctx = makeFullContext();
      ctx.regime = {
        regime: 'unknown_custom_regime' as any,
        confidence: 0.7,
        spyTrend: 'up',
        volatilityPctile: 50,
        newEntriesAllowed: true,
        positionSizeMultiplier: 1.0,
        stopLossMultiplier: 1.0,
        entryThresholdAdjustment: 0,
        breadthScore: 50,
      };
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('MARKET REGIME:');
      expect(user).toContain('unknown_custom_regime');
    });
  });

  describe('candlestick patterns in buildAnalysisPrompt (line 282)', () => {
    it('includes candlestick line when candlestickBullish is set', () => {
      const ctx = makeFullContext();
      ctx.technical.candlestickBullish = 'Hammer, Engulfing';
      ctx.technical.candlestickBearish = null;
      ctx.technical.candlestickNeutral = null;
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('Candlestick Patterns:');
      expect(user).toContain('Bullish [Hammer, Engulfing]');
    });

    it('includes candlestick line when candlestickBearish is set', () => {
      const ctx = makeFullContext();
      ctx.technical.candlestickBullish = null;
      ctx.technical.candlestickBearish = 'ShootingStar';
      ctx.technical.candlestickNeutral = null;
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('Bearish [ShootingStar]');
    });

    it('includes candlestick line when candlestickNeutral is set', () => {
      const ctx = makeFullContext();
      ctx.technical.candlestickBullish = null;
      ctx.technical.candlestickBearish = null;
      ctx.technical.candlestickNeutral = 'Doji';
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('Neutral [Doji]');
    });

    it('omits candlestick line when all candlestick fields are null', () => {
      const ctx = makeFullContext();
      ctx.technical.candlestickBullish = null;
      ctx.technical.candlestickBearish = null;
      ctx.technical.candlestickNeutral = null;
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).not.toContain('Candlestick Patterns:');
    });
  });

  describe('spyChange1d = 0 null path in buildMarketSection (line 355)', () => {
    it('shows N/A for SPY change when spyChange1d is 0 in buildResearchDataPrompt', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol());

      const marketCtx: MarketContext = {
        spyPrice: 450.50,
        spyChange1d: 0,
        vixLevel: 15.25,
        marketTrend: 'neutral',
        vixTermStructure: null,
      };

      const result = buildResearchDataPrompt(data, marketCtx);
      // spyChange1d = 0 is falsy → fmtPct(null) → 'N/A'
      expect(result).toContain('SPY: $450.50');
      expect(result).toContain('N/A');
    });
  });
});

// ── buildResearchDataPrompt ──────────────────────────────────────────────────

function makeResearchSymbol(overrides?: Partial<ResearchSymbolData>): ResearchSymbolData {
  return {
    price: 150.25,
    change1dPct: 1.5,
    change5dPct: 3.2,
    change1mPct: -4.5,
    technical: {
      rsi: 55.5,
      macd: { value: 0.5432, signal: 0.3210, histogram: 0.2222 },
      sma20: 148.50,
      sma50: 145.00,
      sma200: 140.00,
      ema12: 149.20,
      ema26: 147.80,
      bollinger: { upper: 155.00, middle: 150.00, lower: 145.00 },
      atr: 2.50,
      adx: 25.30,
      stochastic: { k: 60.00, d: 55.00 },
      williamsR: -40.00,
      mfi: 55.50,
      cci: 50.00,
      obv: 1234567,
      vwap: 150.10,
      parabolicSar: 148.00,
      roc: 2.50,
      forceIndex: 5000,
      volumeRatio: 1.15,
      perfWeek: 0.012,
      perfMonth: 0.035,
      perfQuarter: -0.045,
      perfYear: 0.12,
      supportResistance: { support: 145.50, resistance: 155.50 },
      candlestickPatterns: { bullish: [], bearish: [], neutral: [] },
      score: 65,
    },
    fundamentals: {
      peRatio: 25.5,
      forwardPE: 22.3,
      revenueGrowthYoY: 0.15,
      profitMargin: 0.255,
      operatingMargin: 0.30,
      debtToEquity: 1.5,
      currentRatio: 1.2,
      dividendYield: 0.006,
      beta: 1.1,
      earningsSurprise: 3.0,
    },
    fundamentalScore: 70,
    sentimentScore: 60,
    headlines: [
      { title: 'AAPL beats earnings expectations', score: 0.8, source: 'Reuters' },
      { title: 'Apple faces China headwinds', score: -0.3, source: 'Bloomberg' },
    ],
    insiderNetBuying: 5,
    daysToEarnings: 30,
    sector: 'Technology',
    marketCap: 2.5e12,
    ...overrides,
  };
}

describe('buildResearchDataPrompt', () => {
  describe('detailed mode (<=3 symbols)', () => {
    it('uses detailed format for 1 symbol', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol());

      const result = buildResearchDataPrompt(data);

      expect(result).toContain('=== AAPL ===');
      expect(result).toContain('$150.25');
      expect(result).toContain('+1.50%');
      expect(result).toContain('+3.20%');
      expect(result).toContain('-4.50%');
    });

    it('includes full technical indicators in detailed mode', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol());

      const result = buildResearchDataPrompt(data);

      expect(result).toContain('TECHNICAL (Score: 65/100)');
      expect(result).toContain('RSI(14): 55.50');
      expect(result).toContain('MACD-H: 0.2222');
      expect(result).toContain('ADX: 25.30');
      expect(result).toContain('SMA: 20d 148.50');
      expect(result).toContain('50d 145.00');
      expect(result).toContain('200d 140.00');
      expect(result).toContain('Bollinger: U 155.00');
      expect(result).toContain('ATR: 2.50');
      expect(result).toContain('Stoch K/D: 60.00/55.00');
      expect(result).toContain('Williams %R: -40.00');
      expect(result).toContain('MFI: 55.50');
      expect(result).toContain('CCI: 50.00');
      expect(result).toContain('OBV: 1234567');
      expect(result).toContain('VWAP: 150.10');
      expect(result).toContain('Vol Ratio: 1.15');
      expect(result).toContain('SAR: 148.00');
      expect(result).toContain('ROC: 2.50');
      expect(result).toContain('Force: 5000');
      expect(result).toContain('Support: 145.50');
      expect(result).toContain('Resistance: 155.50');
    });

    it('includes candlestick patterns in detailed mode when patterns are present', () => {
      const data = new Map<string, ResearchSymbolData>();
      const sym = makeResearchSymbol();
      // Add candlestick patterns to the technical data
      (sym.technical as any).candlestickPatterns = { bullish: ['Hammer', 'Engulfing'], bearish: ['ShootingStar'], neutral: [] };
      data.set('AAPL', sym);

      const result = buildResearchDataPrompt(data);

      expect(result).toContain('Candlestick:');
      expect(result).toContain('Bullish [Hammer, Engulfing]');
      expect(result).toContain('Bearish [ShootingStar]');
    });

    it('includes full fundamental metrics in detailed mode', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol());

      const result = buildResearchDataPrompt(data);

      expect(result).toContain('FUNDAMENTAL (Score: 70/100)');
      expect(result).toContain('P/E: 25.50');
      expect(result).toContain('Fwd P/E: 22.30');
      expect(result).toContain('Growth: 15.00%');
      expect(result).toContain('Margin: 25.50%');
      expect(result).toContain('D/E: 1.50');
      expect(result).toContain('Beta: 1.10');
      expect(result).toContain('Div Yield: 0.60%');
      expect(result).toContain('Earnings Surprise: 3.00');
    });

    it('includes sentiment with headlines in detailed mode', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol());

      const result = buildResearchDataPrompt(data);

      expect(result).toContain('SENTIMENT (Score: 60/100)');
      expect(result).toContain('[+0.80] "AAPL beats earnings expectations" (Reuters)');
      expect(result).toContain('[-0.30] "Apple faces China headwinds" (Bloomberg)');
      expect(result).toContain('Insider Net Buying: +5');
      expect(result).toContain('Days to Earnings: 30');
    });

    it('uses detailed format for exactly 3 symbols', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol());
      data.set('MSFT', makeResearchSymbol({ price: 400 }));
      data.set('NVDA', makeResearchSymbol({ price: 800 }));

      const result = buildResearchDataPrompt(data);

      // Detailed format uses === markers
      expect(result).toContain('=== AAPL ===');
      expect(result).toContain('=== MSFT ===');
      expect(result).toContain('=== NVDA ===');
      expect(result).not.toContain('--- AAPL ---');
    });

    it('omits sector/mcap line when sector is null in detailed mode (line 382)', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol({ sector: null }));

      const result = buildResearchDataPrompt(data);
      expect(result).toContain('=== AAPL ===');
      expect(result).not.toContain('Sector:');
    });

    it('shows negative change1dPct without + prefix in detailed mode (line 380 false branch)', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol({ change1dPct: -2.5 }));

      const result = buildResearchDataPrompt(data);
      expect(result).toContain('1d: -2.50%');
      expect(result).not.toContain('1d: +-2.50%');
    });

    it('shows negative change5dPct without + prefix in detailed mode (line 380 nested ternary false branch)', () => {
      const data = new Map<string, ResearchSymbolData>();
      // change5dPct is negative (non-null), change1mPct is positive (non-null)
      data.set('AAPL', makeResearchSymbol({ change5dPct: -2.1, change1mPct: 3.4 }));

      const result = buildResearchDataPrompt(data);
      expect(result).toContain('5d: -2.10%');
      expect(result).toContain('1m: +3.40%');
      expect(result).not.toMatch(/5d: \+-/);
    });

    it('includes neutral candlestick patterns in detailed mode (line 410 cpNeut.length > 0)', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol({
        technical: {
          ...makeResearchSymbol().technical!,
          candlestickPatterns: { bullish: [], bearish: [], neutral: ['Doji'] },
        },
      }));

      const result = buildResearchDataPrompt(data);
      expect(result).toContain('Neutral [Doji]');
    });
  });

  describe('condensed mode (>3 symbols)', () => {
    it('uses condensed format for 4+ symbols', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol());
      data.set('MSFT', makeResearchSymbol({ price: 400 }));
      data.set('NVDA', makeResearchSymbol({ price: 800 }));
      data.set('GOOGL', makeResearchSymbol({ price: 170 }));

      const result = buildResearchDataPrompt(data);

      // Condensed format uses --- markers
      expect(result).toContain('--- AAPL ---');
      expect(result).toContain('--- MSFT ---');
      expect(result).toContain('--- NVDA ---');
      expect(result).toContain('--- GOOGL ---');
      expect(result).not.toContain('=== AAPL ===');
    });

    it('includes key technical indicators in condensed mode', () => {
      const data = new Map<string, ResearchSymbolData>();
      for (const sym of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
        data.set(sym, makeResearchSymbol());
      }

      const result = buildResearchDataPrompt(data);

      // Condensed has compact tech line: Tech(65): RSI ... | MACD-H ... | ADX ... | SMA50 ... | ATR ... | VolR ...
      expect(result).toContain('Tech(65)');
      expect(result).toContain('RSI 55.50');
      expect(result).toContain('MACD-H 0.2222');
      expect(result).toContain('ADX 25.30');
      expect(result).toContain('SMA50 145.00');
      expect(result).toContain('ATR 2.50');
      expect(result).toContain('VolR 1.15');
    });

    it('includes key fundamentals in condensed mode', () => {
      const data = new Map<string, ResearchSymbolData>();
      for (const sym of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
        data.set(sym, makeResearchSymbol());
      }

      const result = buildResearchDataPrompt(data);

      // Condensed has compact fund line
      expect(result).toContain('Fund(70)');
      expect(result).toContain('P/E 25.50');
      expect(result).toContain('FwdPE 22.30');
      expect(result).toContain('Growth 15.00%');
      expect(result).toContain('Margin 25.50%');
      expect(result).toContain('D/E 1.50');
    });

    it('truncates headline titles in condensed mode', () => {
      const data = new Map<string, ResearchSymbolData>();
      const longHeadline = 'A'.repeat(100);
      for (const sym of ['A', 'B', 'C', 'D']) {
        data.set(
          sym,
          makeResearchSymbol({
            headlines: [{ title: longHeadline, score: 0.5, source: 'Test' }],
          }),
        );
      }

      const result = buildResearchDataPrompt(data);
      // Headlines truncated to 60 chars in condensed mode
      expect(result).toContain(`"${'A'.repeat(60)}"`);
      expect(result).not.toContain(`"${'A'.repeat(61)}"`);
    });

    it('omits sector/mcap line when sector is null in condensed mode (line 453)', () => {
      const data = new Map<string, ResearchSymbolData>();
      for (const sym of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
        data.set(sym, makeResearchSymbol({ sector: null }));
      }

      const result = buildResearchDataPrompt(data);
      // No sector line in condensed format
      expect(result).not.toContain('Technology');
      expect(result).toContain('--- AAPL ---');
    });

    it('omits earnings when daysToEarnings is null in condensed mode (line 481)', () => {
      const data = new Map<string, ResearchSymbolData>();
      for (const sym of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
        data.set(sym, makeResearchSymbol({ daysToEarnings: null }));
      }

      const result = buildResearchDataPrompt(data);
      expect(result).not.toContain('Earnings:');
    });

    it('omits insider line when insiderNetBuying is 0 in condensed mode (lines 482-483)', () => {
      const data = new Map<string, ResearchSymbolData>();
      for (const sym of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
        data.set(sym, makeResearchSymbol({ insiderNetBuying: 0 }));
      }

      const result = buildResearchDataPrompt(data);
      expect(result).not.toContain('Insider:');
    });

    it('includes insider line when insiderNetBuying is non-zero in condensed mode (line 483)', () => {
      const data = new Map<string, ResearchSymbolData>();
      for (const sym of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
        data.set(sym, makeResearchSymbol({ insiderNetBuying: 7 }));
      }

      const result = buildResearchDataPrompt(data);
      expect(result).toContain('Insider: +7');
    });

    it('shows N/A for change5dPct and change1mPct when null in condensed mode (line 451 ternaries)', () => {
      const data = new Map<string, ResearchSymbolData>();
      for (const sym of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
        data.set(sym, makeResearchSymbol({ change5dPct: null, change1mPct: null }));
      }

      const result = buildResearchDataPrompt(data);
      expect(result).toContain('5d: N/A');
      expect(result).toContain('1m: N/A');
    });

    it('shows negative change1dPct without + prefix in condensed mode (line 451 false branch)', () => {
      const data = new Map<string, ResearchSymbolData>();
      for (const sym of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
        data.set(sym, makeResearchSymbol({ change1dPct: -2.5 }));
      }

      const result = buildResearchDataPrompt(data);
      expect(result).toContain('1d: -2.50%');
      expect(result).not.toMatch(/1d: \+-/);
    });

    it('covers negative change5dPct and positive change1mPct in condensed mode (line 451 remaining branches)', () => {
      const data = new Map<string, ResearchSymbolData>();
      for (const sym of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
        data.set(sym, makeResearchSymbol({ change5dPct: -1.5, change1mPct: 2.0 }));
      }
      const result = buildResearchDataPrompt(data);
      expect(result).toContain('5d: -1.50%');
      expect(result).toContain('1m: +2.00%');
    });

    it('omits technical line when d.technical is null in condensed mode (lines 456-461)', () => {
      const data = new Map<string, ResearchSymbolData>();
      for (const sym of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
        data.set(sym, makeResearchSymbol({ technical: null }));
      }

      const result = buildResearchDataPrompt(data);
      expect(result).not.toContain('Tech(');
    });

    it('omits fundamentals line when d.fundamentals is null in condensed mode (lines 464-469)', () => {
      const data = new Map<string, ResearchSymbolData>();
      for (const sym of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
        data.set(sym, makeResearchSymbol({ fundamentals: null, fundamentalScore: 0 }));
      }

      const result = buildResearchDataPrompt(data);
      expect(result).not.toContain('Fund(');
    });

    it('omits headlines in sentiment line when headlines empty in condensed mode (line 473 false branch)', () => {
      const data = new Map<string, ResearchSymbolData>();
      for (const sym of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
        data.set(sym, makeResearchSymbol({ headlines: [] }));
      }

      const result = buildResearchDataPrompt(data);
      // Should still have sentiment score line but no quoted headlines
      expect(result).toContain('Sent(60)');
      expect(result).not.toContain('"AAPL beats');
    });

    it('shows negative change5dPct and change1mPct with sign in condensed mode (line 451 nested ternaries)', () => {
      const data = new Map<string, ResearchSymbolData>();
      for (const sym of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
        data.set(sym, makeResearchSymbol({ change5dPct: -3.1, change1mPct: -7.2 }));
      }

      const result = buildResearchDataPrompt(data);
      expect(result).toContain('5d: -3.10%');
      expect(result).toContain('1m: -7.20%');
      // Ensure no spurious + prefix
      expect(result).not.toMatch(/5d: \+-/);
      expect(result).not.toMatch(/1m: \+-/);
    });

    it('shows negative insiderNetBuying without + prefix in condensed mode (line 483 false branch)', () => {
      const data = new Map<string, ResearchSymbolData>();
      for (const sym of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
        data.set(sym, makeResearchSymbol({ insiderNetBuying: -5 }));
      }

      const result = buildResearchDataPrompt(data);
      expect(result).toContain('Insider: -5');
      expect(result).not.toContain('Insider: +-5');
    });
  });

  describe('market context section', () => {
    it('includes SPY/VIX data when marketCtx provided', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol());

      const marketCtx: MarketContext = {
        spyPrice: 450.50,
        spyChange1d: 0.5,
        vixLevel: 15.25,
        marketTrend: 'bullish',
        vixTermStructure: null,
      };

      const result = buildResearchDataPrompt(data, marketCtx);

      expect(result).toContain('MARKET CONDITIONS:');
      expect(result).toContain('SPY: $450.50');
      expect(result).toContain('VIX: 15.25');
      expect(result).toContain('Trend: bullish');
    });

    it('includes regime data when provided', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol());

      const regime: RegimeAnalysis = {
        regime: 'trending_up',
        confidence: 0.85,
        details: {
          spyTrend: 'bullish',
          volatilityPctile: 30,
          adjustments: {
            newEntriesAllowed: true,
            positionSizeMultiplier: 1.0,
            stopLossMultiplier: 1.0,
          },
        },
      };

      const result = buildResearchDataPrompt(data, null, regime);

      expect(result).toContain('MARKET CONDITIONS:');
      expect(result).toContain('Regime: Trending Up (Bull) (85% conf)');
    });

    it('uses raw regime string when regime key is unknown (line 369 ?? false branch)', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol());

      const regime = {
        regime: 'custom_unknown_regime' as unknown as RegimeAnalysis['regime'],
        confidence: 0.70,
        details: {
          spyTrend: 'flat' as const,
          volatilityPctile: 50,
          adjustments: {
            newEntriesAllowed: true,
            positionSizeMultiplier: 1.0,
            stopLossMultiplier: 1.0,
            entryThresholdAdjustment: 0,
          },
        },
      } as RegimeAnalysis;

      const result = buildResearchDataPrompt(data, null, regime);

      // Unknown regime key → falls through to regime.regime raw string
      expect(result).toContain('Regime: custom_unknown_regime (70% conf)');
    });

    it('omits market section when no context or regime', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol());

      const result = buildResearchDataPrompt(data);

      expect(result).not.toContain('MARKET CONDITIONS:');
    });
  });

  describe('edge cases', () => {
    it('handles null technical analysis', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol({ technical: null }));

      const result = buildResearchDataPrompt(data);

      expect(result).toContain('=== AAPL ===');
      expect(result).not.toContain('TECHNICAL');
    });

    it('handles null fundamentals', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol({ fundamentals: null, fundamentalScore: 0 }));

      const result = buildResearchDataPrompt(data);

      expect(result).toContain('=== AAPL ===');
      expect(result).not.toContain('FUNDAMENTAL');
    });

    it('handles empty headlines', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol({ headlines: [] }));

      const result = buildResearchDataPrompt(data);

      expect(result).toContain('(no recent headlines)');
    });

    it('handles null daysToEarnings', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol({ daysToEarnings: null }));

      const result = buildResearchDataPrompt(data);

      expect(result).toContain('Days to Earnings: N/A');
    });

    it('handles negative insider buying', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol({ insiderNetBuying: -3 }));

      const result = buildResearchDataPrompt(data);

      expect(result).toContain('Insider Net Buying: -3');
    });

    it('handles null change5dPct and change1mPct', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol({ change5dPct: null, change1mPct: null }));

      const result = buildResearchDataPrompt(data);

      expect(result).toContain('5d: N/A');
      expect(result).toContain('1m: N/A');
    });

    it('includes the IMPORTANT instruction about actual data', () => {
      const data = new Map<string, ResearchSymbolData>();
      data.set('AAPL', makeResearchSymbol());

      const result = buildResearchDataPrompt(data);

      expect(result).toContain('IMPORTANT: Use the ACTUAL market data');
      expect(result).toContain('Do NOT hallucinate');
    });
  });
});
