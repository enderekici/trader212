import { describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';

describe('db/schema', () => {
  describe('trades table', () => {
    it('exports trades table', () => {
      expect(schema.trades).toBeDefined();
    });

    it('has all required columns', () => {
      const cols = Object.keys(schema.trades);
      expect(cols).toContain('id');
      expect(cols).toContain('symbol');
      expect(cols).toContain('t212Ticker');
      expect(cols).toContain('side');
      expect(cols).toContain('shares');
      expect(cols).toContain('entryPrice');
      expect(cols).toContain('exitPrice');
      expect(cols).toContain('pnl');
      expect(cols).toContain('pnlPct');
      expect(cols).toContain('entryTime');
      expect(cols).toContain('exitTime');
      expect(cols).toContain('stopLoss');
      expect(cols).toContain('takeProfit');
      expect(cols).toContain('exitReason');
      expect(cols).toContain('aiReasoning');
      expect(cols).toContain('convictionScore');
      expect(cols).toContain('aiModel');
      expect(cols).toContain('accountType');
      expect(cols).toContain('createdAt');
    });
  });

  describe('signals table', () => {
    it('exports signals table', () => {
      expect(schema.signals).toBeDefined();
    });

    it('has technical indicator columns', () => {
      const cols = Object.keys(schema.signals);
      expect(cols).toContain('rsi');
      expect(cols).toContain('macdValue');
      expect(cols).toContain('macdSignal');
      expect(cols).toContain('macdHistogram');
      expect(cols).toContain('sma20');
      expect(cols).toContain('sma50');
      expect(cols).toContain('sma200');
      expect(cols).toContain('ema12');
      expect(cols).toContain('ema26');
      expect(cols).toContain('bollingerUpper');
      expect(cols).toContain('bollingerMiddle');
      expect(cols).toContain('bollingerLower');
      expect(cols).toContain('atr');
      expect(cols).toContain('adx');
      expect(cols).toContain('stochasticK');
      expect(cols).toContain('stochasticD');
      expect(cols).toContain('williamsR');
      expect(cols).toContain('mfi');
      expect(cols).toContain('cci');
      expect(cols).toContain('obv');
      expect(cols).toContain('vwap');
      expect(cols).toContain('parabolicSar');
      expect(cols).toContain('roc');
      expect(cols).toContain('forceIndex');
      expect(cols).toContain('volumeRatio');
    });

    it('has scoring and decision columns', () => {
      const cols = Object.keys(schema.signals);
      expect(cols).toContain('technicalScore');
      expect(cols).toContain('sentimentScore');
      expect(cols).toContain('fundamentalScore');
      expect(cols).toContain('aiScore');
      expect(cols).toContain('convictionTotal');
      expect(cols).toContain('decision');
      expect(cols).toContain('executed');
      expect(cols).toContain('aiReasoning');
      expect(cols).toContain('aiModel');
    });

    it('has suggestion columns', () => {
      const cols = Object.keys(schema.signals);
      expect(cols).toContain('suggestedStopLossPct');
      expect(cols).toContain('suggestedPositionSizePct');
      expect(cols).toContain('suggestedTakeProfitPct');
    });
  });

  describe('positions table', () => {
    it('exports positions table', () => {
      expect(schema.positions).toBeDefined();
    });

    it('has all required columns', () => {
      const cols = Object.keys(schema.positions);
      expect(cols).toContain('id');
      expect(cols).toContain('symbol');
      expect(cols).toContain('t212Ticker');
      expect(cols).toContain('shares');
      expect(cols).toContain('entryPrice');
      expect(cols).toContain('entryTime');
      expect(cols).toContain('currentPrice');
      expect(cols).toContain('pnl');
      expect(cols).toContain('pnlPct');
      expect(cols).toContain('stopLoss');
      expect(cols).toContain('trailingStop');
      expect(cols).toContain('takeProfit');
      expect(cols).toContain('convictionScore');
      expect(cols).toContain('stopOrderId');
      expect(cols).toContain('aiExitConditions');
      expect(cols).toContain('accountType');
      expect(cols).toContain('updatedAt');
    });
  });

  describe('priceCache table', () => {
    it('exports priceCache table', () => {
      expect(schema.priceCache).toBeDefined();
    });

    it('has OHLCV columns', () => {
      const cols = Object.keys(schema.priceCache);
      expect(cols).toContain('open');
      expect(cols).toContain('high');
      expect(cols).toContain('low');
      expect(cols).toContain('close');
      expect(cols).toContain('volume');
      expect(cols).toContain('timeframe');
    });
  });

  describe('newsCache table', () => {
    it('exports newsCache table', () => {
      expect(schema.newsCache).toBeDefined();
    });

    it('has correct columns', () => {
      const cols = Object.keys(schema.newsCache);
      expect(cols).toContain('symbol');
      expect(cols).toContain('title');
      expect(cols).toContain('source');
      expect(cols).toContain('url');
      expect(cols).toContain('publishedAt');
      expect(cols).toContain('sentimentScore');
      expect(cols).toContain('fetchedAt');
    });
  });

  describe('earningsCalendar table', () => {
    it('exports earningsCalendar table', () => {
      expect(schema.earningsCalendar).toBeDefined();
    });

    it('has correct columns', () => {
      const cols = Object.keys(schema.earningsCalendar);
      expect(cols).toContain('symbol');
      expect(cols).toContain('earningsDate');
      expect(cols).toContain('estimate');
      expect(cols).toContain('actual');
      expect(cols).toContain('surprise');
      expect(cols).toContain('fetchedAt');
    });
  });

  describe('insiderTransactions table', () => {
    it('exports insiderTransactions table', () => {
      expect(schema.insiderTransactions).toBeDefined();
    });

    it('has correct columns', () => {
      const cols = Object.keys(schema.insiderTransactions);
      expect(cols).toContain('symbol');
      expect(cols).toContain('filingDate');
      expect(cols).toContain('transactionDate');
      expect(cols).toContain('ownerName');
      expect(cols).toContain('transactionType');
      expect(cols).toContain('shares');
      expect(cols).toContain('pricePerShare');
      expect(cols).toContain('totalValue');
    });
  });

  describe('fundamentalCache table', () => {
    it('exports fundamentalCache table', () => {
      expect(schema.fundamentalCache).toBeDefined();
    });

    it('has fundamental data columns', () => {
      const cols = Object.keys(schema.fundamentalCache);
      expect(cols).toContain('peRatio');
      expect(cols).toContain('forwardPE');
      expect(cols).toContain('revenueGrowthYoY');
      expect(cols).toContain('profitMargin');
      expect(cols).toContain('operatingMargin');
      expect(cols).toContain('debtToEquity');
      expect(cols).toContain('currentRatio');
      expect(cols).toContain('marketCap');
      expect(cols).toContain('sector');
      expect(cols).toContain('industry');
      expect(cols).toContain('earningsSurprise');
      expect(cols).toContain('dividendYield');
      expect(cols).toContain('beta');
    });
  });

  describe('dailyMetrics table', () => {
    it('exports dailyMetrics table', () => {
      expect(schema.dailyMetrics).toBeDefined();
    });

    it('has performance metric columns', () => {
      const cols = Object.keys(schema.dailyMetrics);
      expect(cols).toContain('date');
      expect(cols).toContain('totalPnl');
      expect(cols).toContain('tradesCount');
      expect(cols).toContain('winCount');
      expect(cols).toContain('lossCount');
      expect(cols).toContain('winRate');
      expect(cols).toContain('maxDrawdown');
      expect(cols).toContain('sharpeRatio');
      expect(cols).toContain('profitFactor');
      expect(cols).toContain('portfolioValue');
      expect(cols).toContain('cashBalance');
    });
  });

  describe('pairlistHistory table', () => {
    it('exports pairlistHistory table', () => {
      expect(schema.pairlistHistory).toBeDefined();
    });

    it('has correct columns', () => {
      const cols = Object.keys(schema.pairlistHistory);
      expect(cols).toContain('timestamp');
      expect(cols).toContain('symbols');
      expect(cols).toContain('filterStats');
    });
  });

  describe('config table', () => {
    it('exports config table', () => {
      expect(schema.config).toBeDefined();
    });

    it('has correct columns', () => {
      const cols = Object.keys(schema.config);
      expect(cols).toContain('key');
      expect(cols).toContain('value');
      expect(cols).toContain('category');
      expect(cols).toContain('description');
      expect(cols).toContain('updatedAt');
    });
  });

  describe('tradePlans table', () => {
    it('exports tradePlans table', () => {
      expect(schema.tradePlans).toBeDefined();
    });

    it('has all required columns', () => {
      const cols = Object.keys(schema.tradePlans);
      expect(cols).toContain('symbol');
      expect(cols).toContain('t212Ticker');
      expect(cols).toContain('status');
      expect(cols).toContain('side');
      expect(cols).toContain('entryPrice');
      expect(cols).toContain('shares');
      expect(cols).toContain('positionValue');
      expect(cols).toContain('positionSizePct');
      expect(cols).toContain('stopLossPrice');
      expect(cols).toContain('stopLossPct');
      expect(cols).toContain('takeProfitPrice');
      expect(cols).toContain('takeProfitPct');
      expect(cols).toContain('maxLossDollars');
      expect(cols).toContain('riskRewardRatio');
      expect(cols).toContain('aiConviction');
      expect(cols).toContain('accountType');
      expect(cols).toContain('createdAt');
    });
  });

  describe('aiResearch table', () => {
    it('exports aiResearch table', () => {
      expect(schema.aiResearch).toBeDefined();
    });

    it('has correct columns', () => {
      const cols = Object.keys(schema.aiResearch);
      expect(cols).toContain('timestamp');
      expect(cols).toContain('query');
      expect(cols).toContain('symbols');
      expect(cols).toContain('results');
      expect(cols).toContain('aiModel');
      expect(cols).toContain('marketContext');
      expect(cols).toContain('createdAt');
    });
  });

  describe('modelPerformance table', () => {
    it('exports modelPerformance table', () => {
      expect(schema.modelPerformance).toBeDefined();
    });

    it('has correct columns', () => {
      const cols = Object.keys(schema.modelPerformance);
      expect(cols).toContain('aiModel');
      expect(cols).toContain('symbol');
      expect(cols).toContain('decision');
      expect(cols).toContain('conviction');
      expect(cols).toContain('signalTimestamp');
      expect(cols).toContain('priceAtSignal');
      expect(cols).toContain('priceAfter1d');
      expect(cols).toContain('priceAfter5d');
      expect(cols).toContain('priceAfter10d');
      expect(cols).toContain('actualOutcome');
      expect(cols).toContain('actualReturnPct');
      expect(cols).toContain('evaluatedAt');
    });
  });

  describe('auditLog table', () => {
    it('exports auditLog table', () => {
      expect(schema.auditLog).toBeDefined();
    });

    it('has correct columns', () => {
      const cols = Object.keys(schema.auditLog);
      expect(cols).toContain('timestamp');
      expect(cols).toContain('eventType');
      expect(cols).toContain('category');
      expect(cols).toContain('symbol');
      expect(cols).toContain('summary');
      expect(cols).toContain('details');
      expect(cols).toContain('severity');
    });
  });
});
