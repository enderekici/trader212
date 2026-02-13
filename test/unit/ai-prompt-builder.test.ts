import { describe, expect, it } from 'vitest';
import { buildAnalysisPrompt } from '../../src/ai/prompt-builder.js';
import type { AIContext } from '../../src/ai/agent.js';

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
      existingPositions: [
        { symbol: 'MSFT', pnlPct: 0.05, entryPrice: 380.00, currentPrice: 399.00 },
        { symbol: 'GOOG', pnlPct: -0.02, entryPrice: 140.00, currentPrice: 137.20 },
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
      expect(user).toContain('MSFT: entry $380.00');
      expect(user).toContain('+5.00%');
      expect(user).toContain('GOOG: entry $140.00');
      expect(user).toContain('-2.00%');
      expect(user).toContain('Technology: 2 position(s)');
      expect(user).toContain('Healthcare: 1 position(s)');
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
