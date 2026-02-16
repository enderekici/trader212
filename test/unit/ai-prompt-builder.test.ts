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
      support: 145.50,
      resistance: 155.50,
      score: 65,
    },
    fundamental: {
      peRatio: 25.5,
      forwardPE: 22.3,
      revenueGrowthYoY: 0.15,
      profitMargin: 0.255,
      operatingMargin: 0.30,
      debtToEquity: 1.5,
      currentRatio: 1.2,
      marketCap: 2.5e12,
      sector: 'Technology',
      beta: 1.1,
      dividendYield: 0.006,
      score: 70,
    },
    sentiment: {
      headlines: [
        { title: 'AAPL beats earnings expectations', score: 0.8, source: 'Reuters' },
        { title: 'Apple faces China headwinds', score: -0.3, source: 'Bloomberg' },
      ],
      insiderNetBuying: 5,
      daysToEarnings: 30,
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

  describe('web research section', () => {
    it('renders ANALYST & WEB RESEARCH section when webResearch is present', () => {
      const ctx = makeFullContext();
      ctx.webResearch = {
        pegRatio: 1.25,
        analystTargetPrice: 185.00,
        analystConsensus: 'Buy',
        analystCount: 15,
        shortInterestPct: 0.025,
        institutionalOwnershipPct: 0.785,
        epsEstimateNextQ: 1.82,
        revenueEstimateNextQ: 24.5e9,
        perfWeek: 0.023,
        perfMonth: 0.051,
        perfQuarter: 0.128,
        perfYear: 0.285,
      };
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('ANALYST & WEB RESEARCH DATA:');
      expect(user).toContain('PEG Ratio: 1.25');
      expect(user).toContain('Analyst Target Price: $185.00');
      expect(user).toContain('Analyst Consensus: Buy (15 analysts)');
      expect(user).toContain('Short Interest: 2.5%');
      expect(user).toContain('Institutional Ownership: 78.5%');
      expect(user).toContain('EPS Estimate (next Q): $1.82');
      expect(user).toContain('Revenue Estimate (next Q): $24.5B');
      expect(user).toContain('Performance:');
      expect(user).toContain('1W +2.3%');
      expect(user).toContain('1M +5.1%');
      expect(user).toContain('1Q +12.8%');
      expect(user).toContain('1Y +28.5%');
    });

    it('calculates upside percentage from target price', () => {
      const ctx = makeFullContext();
      ctx.currentPrice = 100;
      ctx.webResearch = {
        pegRatio: null,
        analystTargetPrice: 120,
        analystConsensus: null,
        analystCount: null,
        shortInterestPct: null,
        institutionalOwnershipPct: null,
        epsEstimateNextQ: null,
        revenueEstimateNextQ: null,
        perfWeek: null,
        perfMonth: null,
        perfQuarter: null,
        perfYear: null,
      };
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('Analyst Target Price: $120.00 (+20.0%)');
    });

    it('omits section when webResearch is undefined', () => {
      const ctx = makeFullContext();
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).not.toContain('ANALYST & WEB RESEARCH DATA:');
    });

    it('omits section when all webResearch values are null', () => {
      const ctx = makeFullContext();
      ctx.webResearch = {
        pegRatio: null,
        analystTargetPrice: null,
        analystConsensus: null,
        analystCount: null,
        shortInterestPct: null,
        institutionalOwnershipPct: null,
        epsEstimateNextQ: null,
        revenueEstimateNextQ: null,
        perfWeek: null,
        perfMonth: null,
        perfQuarter: null,
        perfYear: null,
      };
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).not.toContain('ANALYST & WEB RESEARCH DATA:');
    });

    it('renders consensus without count when analystCount is null', () => {
      const ctx = makeFullContext();
      ctx.webResearch = {
        pegRatio: null,
        analystTargetPrice: null,
        analystConsensus: 'Strong Buy',
        analystCount: null,
        shortInterestPct: null,
        institutionalOwnershipPct: null,
        epsEstimateNextQ: null,
        revenueEstimateNextQ: null,
        perfWeek: null,
        perfMonth: null,
        perfQuarter: null,
        perfYear: null,
      };
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('Analyst Consensus: Strong Buy');
      expect(user).not.toContain('analysts)');
    });

    it('handles negative performance values', () => {
      const ctx = makeFullContext();
      ctx.webResearch = {
        pegRatio: null,
        analystTargetPrice: null,
        analystConsensus: null,
        analystCount: null,
        shortInterestPct: null,
        institutionalOwnershipPct: null,
        epsEstimateNextQ: null,
        revenueEstimateNextQ: null,
        perfWeek: -0.035,
        perfMonth: -0.082,
        perfQuarter: null,
        perfYear: null,
      };
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('1W -3.5%');
      expect(user).toContain('1M -8.2%');
    });

    it('formats revenue in millions when less than 1B', () => {
      const ctx = makeFullContext();
      ctx.webResearch = {
        pegRatio: null,
        analystTargetPrice: null,
        analystConsensus: null,
        analystCount: null,
        shortInterestPct: null,
        institutionalOwnershipPct: null,
        epsEstimateNextQ: null,
        revenueEstimateNextQ: 500e6,
        perfWeek: null,
        perfMonth: null,
        perfQuarter: null,
        perfYear: null,
      };
      const { user } = buildAnalysisPrompt(ctx);
      expect(user).toContain('Revenue Estimate (next Q): $500.0M');
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
      supportResistance: { support: 145.50, resistance: 155.50 },
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
