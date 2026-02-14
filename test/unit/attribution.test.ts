import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as schema from '../../src/db/schema.js';
import {
  PerformanceAttributor,
  computeByDecisionType,
  computeByDayOfWeek,
  computeByExitReason,
  computeBySector,
  computeByTimeOfDay,
  computeFactorAttribution,
  computeFactorCorrelations,
  generateInsights,
  getDominantFactor,
  getPerformanceAttributor,
  matchTradesToSignals,
} from '../../src/monitoring/attribution.js';

// ── Mock Data Factories ───────────────────────────────────────────────────

function createTrade(overrides: Partial<typeof schema.trades.$inferSelect> = {}): typeof schema.trades.$inferSelect {
  return {
    id: 1,
    symbol: 'AAPL',
    t212Ticker: 'AAPL_US_EQ',
    side: 'BUY',
    shares: 10,
    entryPrice: 100,
    exitPrice: 105,
    pnl: 50,
    pnlPct: 0.05,
    entryTime: '2024-01-15T14:30:00.000Z',
    exitTime: '2024-01-16T14:30:00.000Z',
    stopLoss: 95,
    takeProfit: 110,
    exitReason: 'take_profit',
    aiReasoning: null,
    convictionScore: 0.8,
    aiModel: 'claude-opus-4',
    intendedPrice: 100,
    slippage: 0,
    accountType: 'INVEST',
    dcaRound: null,
    journalNotes: null,
    journalTags: null,
    createdAt: '2024-01-15T14:30:00.000Z',
    ...overrides,
  };
}

function createSignal(overrides: Partial<typeof schema.signals.$inferSelect> = {}): typeof schema.signals.$inferSelect {
  return {
    id: 1,
    timestamp: '2024-01-15T14:00:00.000Z',
    symbol: 'AAPL',
    rsi: 65,
    macdValue: 0.5,
    macdSignal: 0.3,
    macdHistogram: 0.2,
    sma20: 100,
    sma50: 98,
    sma200: 95,
    ema12: 101,
    ema26: 99,
    bollingerUpper: 105,
    bollingerMiddle: 100,
    bollingerLower: 95,
    atr: 2,
    adx: 25,
    stochasticK: 70,
    stochasticD: 65,
    williamsR: -30,
    mfi: 60,
    cci: 80,
    obv: 1000000,
    vwap: 100.5,
    parabolicSar: 99,
    roc: 0.02,
    forceIndex: 1000,
    volumeRatio: 1.5,
    supportLevel: 98,
    resistanceLevel: 105,
    technicalScore: 0.7,
    sentimentScore: 0.5,
    fundamentalScore: 0.6,
    aiScore: 0.8,
    convictionTotal: 0.65,
    decision: 'BUY',
    executed: true,
    aiReasoning: 'Strong technical setup',
    aiModel: 'claude-opus-4',
    suggestedStopLossPct: 0.05,
    suggestedPositionSizePct: 0.1,
    suggestedTakeProfitPct: 0.1,
    extraIndicators: null,
    newsHeadlines: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('attribution', () => {
  describe('matchTradesToSignals', () => {
    it('should match trades to signals by symbol and timestamp proximity', () => {
      const trades = [
        createTrade({ symbol: 'AAPL', entryTime: '2024-01-15T14:30:00.000Z' }),
        createTrade({ symbol: 'MSFT', entryTime: '2024-01-15T15:00:00.000Z' }),
      ];

      const signals = [
        createSignal({ symbol: 'AAPL', timestamp: '2024-01-15T14:25:00.000Z' }),
        createSignal({ symbol: 'MSFT', timestamp: '2024-01-15T14:55:00.000Z' }),
      ];

      const fundamentals = [
        { symbol: 'AAPL', sector: 'Technology' },
        { symbol: 'MSFT', sector: 'Technology' },
      ];

      const result = matchTradesToSignals(trades, signals, fundamentals);

      expect(result).toHaveLength(2);
      expect(result[0].trade.symbol).toBe('AAPL');
      expect(result[0].signal?.symbol).toBe('AAPL');
      expect(result[0].sector).toBe('Technology');

      expect(result[1].trade.symbol).toBe('MSFT');
      expect(result[1].signal?.symbol).toBe('MSFT');
      expect(result[1].sector).toBe('Technology');
    });

    it('should not match trades when signal is too far away (> 1 hour)', () => {
      const trades = [createTrade({ symbol: 'AAPL', entryTime: '2024-01-15T14:30:00.000Z' })];

      const signals = [
        createSignal({ symbol: 'AAPL', timestamp: '2024-01-15T12:00:00.000Z' }), // 2.5 hours before
      ];

      const result = matchTradesToSignals(trades, signals, []);

      expect(result).toHaveLength(1);
      expect(result[0].signal).toBeNull();
    });

    it('should pick closest signal when multiple signals exist', () => {
      const trades = [createTrade({ symbol: 'AAPL', entryTime: '2024-01-15T14:30:00.000Z' })];

      const signals = [
        createSignal({ id: 1, symbol: 'AAPL', timestamp: '2024-01-15T14:00:00.000Z' }),
        createSignal({ id: 2, symbol: 'AAPL', timestamp: '2024-01-15T14:20:00.000Z' }), // closer
        createSignal({ id: 3, symbol: 'AAPL', timestamp: '2024-01-15T13:30:00.000Z' }),
      ];

      const result = matchTradesToSignals(trades, signals, []);

      expect(result[0].signal?.id).toBe(2);
    });

    it('should use "Unknown" sector when not found', () => {
      const trades = [createTrade({ symbol: 'AAPL' })];
      const signals = [createSignal({ symbol: 'AAPL' })];
      const fundamentals: Array<{ symbol: string; sector: string | null }> = [];

      const result = matchTradesToSignals(trades, signals, fundamentals);

      expect(result[0].sector).toBeNull();
    });

    it('should handle empty inputs', () => {
      expect(matchTradesToSignals([], [], [])).toEqual([]);
    });
  });

  describe('getDominantFactor', () => {
    it('should return "technical" when technical score is highest and > 0.6', () => {
      const signal = createSignal({
        technicalScore: 0.8,
        fundamentalScore: 0.5,
        sentimentScore: 0.4,
        aiScore: 0.6,
      });

      expect(getDominantFactor(signal)).toBe('technical');
    });

    it('should return "fundamental" when fundamental score is highest and > 0.6', () => {
      const signal = createSignal({
        technicalScore: 0.5,
        fundamentalScore: 0.75,
        sentimentScore: 0.4,
        aiScore: 0.6,
      });

      expect(getDominantFactor(signal)).toBe('fundamental');
    });

    it('should return "sentiment" when sentiment score is highest and > 0.6', () => {
      const signal = createSignal({
        technicalScore: 0.5,
        fundamentalScore: 0.5,
        sentimentScore: 0.7,
        aiScore: 0.6,
      });

      expect(getDominantFactor(signal)).toBe('sentiment');
    });

    it('should return "ai" when ai score is highest and > 0.6', () => {
      const signal = createSignal({
        technicalScore: 0.5,
        fundamentalScore: 0.5,
        sentimentScore: 0.4,
        aiScore: 0.85,
      });

      expect(getDominantFactor(signal)).toBe('ai');
    });

    it('should return null when all scores are below 0.6', () => {
      const signal = createSignal({
        technicalScore: 0.5,
        fundamentalScore: 0.5,
        sentimentScore: 0.4,
        aiScore: 0.55,
      });

      expect(getDominantFactor(signal)).toBeNull();
    });

    it('should return null when signal is null', () => {
      expect(getDominantFactor(null)).toBeNull();
    });
  });

  describe('computeFactorAttribution', () => {
    it('should compute correct stats for each factor', () => {
      const matchedTrades = [
        {
          trade: createTrade({ pnl: 100, pnlPct: 0.1 }),
          signal: createSignal({ technicalScore: 0.8, fundamentalScore: 0.5, sentimentScore: 0.4, aiScore: 0.5 }),
          sector: 'Technology',
        },
        {
          trade: createTrade({ pnl: -50, pnlPct: -0.05 }),
          signal: createSignal({ technicalScore: 0.7, fundamentalScore: 0.5, sentimentScore: 0.4, aiScore: 0.5 }),
          sector: 'Technology',
        },
        {
          trade: createTrade({ pnl: 200, pnlPct: 0.2 }),
          signal: createSignal({ technicalScore: 0.5, fundamentalScore: 0.9, sentimentScore: 0.4, aiScore: 0.5 }),
          sector: 'Finance',
        },
      ];

      const result = computeFactorAttribution(matchedTrades);

      // Technical factor: 2 trades (100, -50), avg = 25, accuracy = 1/2 = 0.5
      expect(result.technical.tradeCount).toBe(2);
      expect(result.technical.contribution).toBe(25);
      expect(result.technical.accuracy).toBe(0.5);
      expect(result.technical.avgReturn).toBe(0.025);

      // Fundamental factor: 1 trade (200), avg = 200, accuracy = 1/1 = 1.0
      expect(result.fundamental.tradeCount).toBe(1);
      expect(result.fundamental.contribution).toBe(200);
      expect(result.fundamental.accuracy).toBe(1);
      expect(result.fundamental.avgReturn).toBe(0.2);

      // Sentiment and AI should have no trades (scores < 0.6)
      expect(result.sentiment.tradeCount).toBe(0);
      expect(result.ai.tradeCount).toBe(0);
    });

    it('should handle trades without signals', () => {
      const matchedTrades = [
        {
          trade: createTrade({ pnl: 100, pnlPct: 0.1 }),
          signal: null,
          sector: 'Technology',
        },
      ];

      const result = computeFactorAttribution(matchedTrades);

      expect(result.technical.tradeCount).toBe(0);
      expect(result.fundamental.tradeCount).toBe(0);
      expect(result.sentiment.tradeCount).toBe(0);
      expect(result.ai.tradeCount).toBe(0);
    });

    it('should handle empty input', () => {
      const result = computeFactorAttribution([]);

      expect(result.technical.tradeCount).toBe(0);
      expect(result.technical.contribution).toBe(0);
    });
  });

  describe('computeByDecisionType', () => {
    it('should group trades by BUY/SELL decision', () => {
      const matchedTrades = [
        {
          trade: createTrade({ pnl: 100 }),
          signal: createSignal({ decision: 'BUY' }),
          sector: null,
        },
        {
          trade: createTrade({ pnl: -50 }),
          signal: createSignal({ decision: 'BUY' }),
          sector: null,
        },
        {
          trade: createTrade({ pnl: 200 }),
          signal: createSignal({ decision: 'SELL' }),
          sector: null,
        },
      ];

      const result = computeByDecisionType(matchedTrades);

      expect(result.BUY.count).toBe(2);
      expect(result.BUY.totalPnl).toBe(50);
      expect(result.BUY.winRate).toBe(0.5);

      expect(result.SELL.count).toBe(1);
      expect(result.SELL.totalPnl).toBe(200);
      expect(result.SELL.winRate).toBe(1);
    });

    it('should fallback to trade side if no signal decision', () => {
      const matchedTrades = [
        {
          trade: createTrade({ side: 'BUY', pnl: 100 }),
          signal: null,
          sector: null,
        },
      ];

      const result = computeByDecisionType(matchedTrades);

      expect(result.BUY.count).toBe(1);
      expect(result.BUY.totalPnl).toBe(100);
    });

    it('should handle empty input', () => {
      const result = computeByDecisionType([]);

      expect(result.BUY.count).toBe(0);
      expect(result.SELL.count).toBe(0);
    });
  });

  describe('computeByExitReason', () => {
    it('should group trades by exit reason', () => {
      const matchedTrades = [
        {
          trade: createTrade({
            exitReason: 'take_profit',
            pnl: 100,
            entryTime: '2024-01-15T14:00:00.000Z',
            exitTime: '2024-01-15T15:00:00.000Z',
          }),
          signal: null,
          sector: null,
        },
        {
          trade: createTrade({
            exitReason: 'take_profit',
            pnl: 150,
            entryTime: '2024-01-16T14:00:00.000Z',
            exitTime: '2024-01-16T16:00:00.000Z',
          }),
          signal: null,
          sector: null,
        },
        {
          trade: createTrade({
            exitReason: 'stop_loss',
            pnl: -50,
            entryTime: '2024-01-17T14:00:00.000Z',
            exitTime: '2024-01-17T14:30:00.000Z',
          }),
          signal: null,
          sector: null,
        },
      ];

      const result = computeByExitReason(matchedTrades);

      expect(result.take_profit.count).toBe(2);
      expect(result.take_profit.avgPnl).toBe(125);
      expect(result.take_profit.avgHoldMinutes).toBe(90); // (60 + 120) / 2

      expect(result.stop_loss.count).toBe(1);
      expect(result.stop_loss.avgPnl).toBe(-50);
      expect(result.stop_loss.avgHoldMinutes).toBe(30);
    });

    it('should use "unknown" for missing exit reason', () => {
      const matchedTrades = [
        {
          trade: createTrade({ exitReason: null, pnl: 100 }),
          signal: null,
          sector: null,
        },
      ];

      const result = computeByExitReason(matchedTrades);

      expect(result.unknown).toBeDefined();
      expect(result.unknown.count).toBe(1);
    });

    it('should handle empty input', () => {
      const result = computeByExitReason([]);
      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('computeBySector', () => {
    it('should group trades by sector', () => {
      const matchedTrades = [
        {
          trade: createTrade({ pnl: 100, pnlPct: 0.1 }),
          signal: null,
          sector: 'Technology',
        },
        {
          trade: createTrade({ pnl: -50, pnlPct: -0.05 }),
          signal: null,
          sector: 'Technology',
        },
        {
          trade: createTrade({ pnl: 200, pnlPct: 0.2 }),
          signal: null,
          sector: 'Finance',
        },
      ];

      const result = computeBySector(matchedTrades);

      expect(result.Technology.count).toBe(2);
      expect(result.Technology.totalPnl).toBe(50);
      expect(result.Technology.winRate).toBe(0.5);
      expect(result.Technology.avgReturn).toBe(0.025);

      expect(result.Finance.count).toBe(1);
      expect(result.Finance.totalPnl).toBe(200);
      expect(result.Finance.winRate).toBe(1);
    });

    it('should use "Unknown" for null sectors', () => {
      const matchedTrades = [
        {
          trade: createTrade({ pnl: 100 }),
          signal: null,
          sector: null,
        },
      ];

      const result = computeBySector(matchedTrades);

      expect(result.Unknown).toBeDefined();
      expect(result.Unknown.count).toBe(1);
    });

    it('should handle empty input', () => {
      const result = computeBySector([]);
      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('computeByTimeOfDay', () => {
    it('should group trades by market time periods', () => {
      const matchedTrades = [
        {
          // Morning: 9:30 ET = 14:30 UTC
          trade: createTrade({ pnl: 100, pnlPct: 0.1, entryTime: '2024-01-15T14:30:00.000Z' }),
          signal: null,
          sector: null,
        },
        {
          // Morning: 11:00 ET = 16:00 UTC
          trade: createTrade({ pnl: 50, pnlPct: 0.05, entryTime: '2024-01-15T16:00:00.000Z' }),
          signal: null,
          sector: null,
        },
        {
          // Midday: 13:00 ET = 18:00 UTC
          trade: createTrade({ pnl: 200, pnlPct: 0.2, entryTime: '2024-01-15T18:00:00.000Z' }),
          signal: null,
          sector: null,
        },
        {
          // Afternoon: 15:00 ET = 20:00 UTC
          trade: createTrade({ pnl: -50, pnlPct: -0.05, entryTime: '2024-01-15T20:00:00.000Z' }),
          signal: null,
          sector: null,
        },
      ];

      const result = computeByTimeOfDay(matchedTrades);

      expect(result.morning.count).toBe(2);
      expect(result.morning.totalPnl).toBe(150);
      expect(result.morning.winRate).toBe(1);

      expect(result.midday.count).toBe(1);
      expect(result.midday.totalPnl).toBe(200);

      expect(result.afternoon.count).toBe(1);
      expect(result.afternoon.totalPnl).toBe(-50);
    });

    it('should handle trades outside market hours', () => {
      const matchedTrades = [
        {
          // 6:00 AM ET = 11:00 UTC (before market open)
          trade: createTrade({ pnl: 100, entryTime: '2024-01-15T11:00:00.000Z' }),
          signal: null,
          sector: null,
        },
      ];

      const result = computeByTimeOfDay(matchedTrades);

      expect(result.morning.count).toBe(0);
      expect(result.midday.count).toBe(0);
      expect(result.afternoon.count).toBe(0);
    });

    it('should handle empty input', () => {
      const result = computeByTimeOfDay([]);

      expect(result.morning.count).toBe(0);
      expect(result.midday.count).toBe(0);
      expect(result.afternoon.count).toBe(0);
    });
  });

  describe('computeByDayOfWeek', () => {
    it('should group trades by day of week', () => {
      const matchedTrades = [
        {
          // Monday, Jan 15, 2024
          trade: createTrade({ pnl: 100, pnlPct: 0.1, entryTime: '2024-01-15T14:00:00.000Z' }),
          signal: null,
          sector: null,
        },
        {
          // Monday, Jan 15, 2024
          trade: createTrade({ pnl: -50, pnlPct: -0.05, entryTime: '2024-01-15T15:00:00.000Z' }),
          signal: null,
          sector: null,
        },
        {
          // Tuesday, Jan 16, 2024
          trade: createTrade({ pnl: 200, pnlPct: 0.2, entryTime: '2024-01-16T14:00:00.000Z' }),
          signal: null,
          sector: null,
        },
      ];

      const result = computeByDayOfWeek(matchedTrades);

      expect(result.Monday.count).toBe(2);
      expect(result.Monday.totalPnl).toBe(50);
      expect(result.Monday.winRate).toBe(0.5);
      expect(result.Monday.avgReturn).toBe(0.025);

      expect(result.Tuesday.count).toBe(1);
      expect(result.Tuesday.totalPnl).toBe(200);
      expect(result.Tuesday.winRate).toBe(1);
    });

    it('should handle empty input', () => {
      const result = computeByDayOfWeek([]);
      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('computeFactorCorrelations', () => {
    it('should compute Pearson correlation matrix for factor scores', () => {
      const matchedTrades = [
        {
          trade: createTrade(),
          signal: createSignal({ technicalScore: 0.8, fundamentalScore: 0.6, sentimentScore: 0.5, aiScore: 0.7 }),
          sector: null,
        },
        {
          trade: createTrade(),
          signal: createSignal({ technicalScore: 0.7, fundamentalScore: 0.5, sentimentScore: 0.4, aiScore: 0.6 }),
          sector: null,
        },
        {
          trade: createTrade(),
          signal: createSignal({ technicalScore: 0.9, fundamentalScore: 0.7, sentimentScore: 0.6, aiScore: 0.8 }),
          sector: null,
        },
      ];

      const result = computeFactorCorrelations(matchedTrades);

      expect(result.factors).toEqual(['technical', 'fundamental', 'sentiment', 'ai']);
      expect(result.matrix).toHaveLength(4);
      expect(result.matrix[0]).toHaveLength(4);

      // Diagonal should be 1
      expect(result.matrix[0][0]).toBe(1);
      expect(result.matrix[1][1]).toBe(1);
      expect(result.matrix[2][2]).toBe(1);
      expect(result.matrix[3][3]).toBe(1);

      // Correlations should be symmetric
      expect(result.matrix[0][1]).toBe(result.matrix[1][0]);
      expect(result.matrix[0][2]).toBe(result.matrix[2][0]);
    });

    it('should handle trades without signals', () => {
      const matchedTrades = [
        {
          trade: createTrade(),
          signal: null,
          sector: null,
        },
      ];

      const result = computeFactorCorrelations(matchedTrades);

      // Should return identity matrix when no signals
      expect(result.matrix[0][1]).toBe(0);
      expect(result.matrix[1][0]).toBe(0);
    });

    it('should handle empty input', () => {
      const result = computeFactorCorrelations([]);

      expect(result.factors).toEqual(['technical', 'fundamental', 'sentiment', 'ai']);
      expect(result.matrix[0][0]).toBe(1);
    });
  });

  describe('generateInsights', () => {
    it('should generate factor accuracy insights', () => {
      const result = {
        byFactor: {
          technical: { contribution: 50, accuracy: 0.65, avgReturn: 0.023, tradeCount: 10 },
          fundamental: { contribution: 30, accuracy: 0.55, avgReturn: 0.015, tradeCount: 5 },
          sentiment: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          ai: { contribution: 100, accuracy: 0.75, avgReturn: 0.045, tradeCount: 8 },
        },
        byDecisionType: {
          BUY: { count: 15, totalPnl: 500, winRate: 0.6 },
          SELL: { count: 5, totalPnl: 100, winRate: 0.4 },
        },
        byExitReason: {
          take_profit: { count: 10, avgPnl: 100, avgHoldMinutes: 120 },
          stop_loss: { count: 5, avgPnl: -50, avgHoldMinutes: 60 },
        },
        bySector: {
          Technology: { count: 10, totalPnl: 1234, winRate: 0.7, avgReturn: 0.05 },
          Finance: { count: 5, totalPnl: -200, winRate: 0.3, avgReturn: -0.02 },
        },
        byTimeOfDay: {
          morning: { count: 8, totalPnl: 400, winRate: 0.75, avgReturn: 0.03 },
          midday: { count: 5, totalPnl: 200, winRate: 0.6, avgReturn: 0.02 },
          afternoon: { count: 3, totalPnl: 100, winRate: 0.5, avgReturn: 0.015 },
        },
        byDayOfWeek: {
          Monday: { count: 5, totalPnl: 300, winRate: 0.6, avgReturn: 0.03 },
          Tuesday: { count: 3, totalPnl: 150, winRate: 0.67, avgReturn: 0.025 },
          Friday: { count: 4, totalPnl: 100, winRate: 0.5, avgReturn: 0.015 },
        },
        factorCorrelations: {
          factors: ['technical', 'fundamental', 'sentiment', 'ai'],
          matrix: [
            [1, 0.5, 0.3, 0.8],
            [0.5, 1, 0.2, 0.4],
            [0.3, 0.2, 1, 0.6],
            [0.8, 0.4, 0.6, 1],
          ],
        },
        insights: [],
      };

      const insights = generateInsights(result);

      expect(insights.length).toBeGreaterThan(0);
      expect(insights.some((i) => i.includes('Technical signals'))).toBe(true);
      expect(insights.some((i) => i.includes('AI signals'))).toBe(true);
      expect(insights.some((i) => i.includes('strongest factor'))).toBe(true);
      expect(insights.some((i) => i.includes('Technology'))).toBe(true);
      expect(insights.some((i) => i.includes('Monday'))).toBe(true);
    });

    it('should generate sector insights for best and worst sectors', () => {
      const result = {
        byFactor: {
          technical: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          fundamental: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          sentiment: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          ai: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
        },
        byDecisionType: {
          BUY: { count: 0, totalPnl: 0, winRate: 0 },
          SELL: { count: 0, totalPnl: 0, winRate: 0 },
        },
        byExitReason: {},
        bySector: {
          Technology: { count: 10, totalPnl: 1500, winRate: 0.7, avgReturn: 0.05 },
          Finance: { count: 5, totalPnl: -300, winRate: 0.3, avgReturn: -0.02 },
        },
        byTimeOfDay: {
          morning: { count: 0, totalPnl: 0, winRate: 0, avgReturn: 0 },
          midday: { count: 0, totalPnl: 0, winRate: 0, avgReturn: 0 },
          afternoon: { count: 0, totalPnl: 0, winRate: 0, avgReturn: 0 },
        },
        byDayOfWeek: {},
        factorCorrelations: {
          factors: ['technical', 'fundamental', 'sentiment', 'ai'],
          matrix: [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
          ],
        },
        insights: [],
      };

      const insights = generateInsights(result);

      expect(insights.some((i) => i.includes('Technology') && i.includes('$1,500.00'))).toBe(true);
      expect(insights.some((i) => i.includes('Finance') && i.includes('-$300.00'))).toBe(true);
    });

    it('should generate day of week insights', () => {
      const result = {
        byFactor: {
          technical: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          fundamental: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          sentiment: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          ai: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
        },
        byDecisionType: {
          BUY: { count: 0, totalPnl: 0, winRate: 0 },
          SELL: { count: 0, totalPnl: 0, winRate: 0 },
        },
        byExitReason: {},
        bySector: {},
        byTimeOfDay: {
          morning: { count: 0, totalPnl: 0, winRate: 0, avgReturn: 0 },
          midday: { count: 0, totalPnl: 0, winRate: 0, avgReturn: 0 },
          afternoon: { count: 0, totalPnl: 0, winRate: 0, avgReturn: 0 },
        },
        byDayOfWeek: {
          Monday: { count: 5, totalPnl: 300, winRate: 0.6, avgReturn: 0.04 },
          Friday: { count: 4, totalPnl: 100, winRate: 0.5, avgReturn: 0.015 },
        },
        factorCorrelations: {
          factors: ['technical', 'fundamental', 'sentiment', 'ai'],
          matrix: [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
          ],
        },
        insights: [],
      };

      const insights = generateInsights(result);

      expect(insights.some((i) => i.includes('Monday') && i.includes('Friday'))).toBe(true);
    });

    it('should generate time of day insights', () => {
      const result = {
        byFactor: {
          technical: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          fundamental: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          sentiment: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          ai: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
        },
        byDecisionType: {
          BUY: { count: 0, totalPnl: 0, winRate: 0 },
          SELL: { count: 0, totalPnl: 0, winRate: 0 },
        },
        byExitReason: {},
        bySector: {},
        byTimeOfDay: {
          morning: { count: 8, totalPnl: 400, winRate: 0.75, avgReturn: 0.05 },
          midday: { count: 5, totalPnl: 200, winRate: 0.6, avgReturn: 0.02 },
          afternoon: { count: 3, totalPnl: 100, winRate: 0.5, avgReturn: 0.015 },
        },
        byDayOfWeek: {},
        factorCorrelations: {
          factors: ['technical', 'fundamental', 'sentiment', 'ai'],
          matrix: [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
          ],
        },
        insights: [],
      };

      const insights = generateInsights(result);

      expect(insights.some((i) => i.includes('Morning') || i.includes('morning'))).toBe(true);
    });

    it('should generate factor correlation insights', () => {
      const result = {
        byFactor: {
          technical: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          fundamental: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          sentiment: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          ai: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
        },
        byDecisionType: {
          BUY: { count: 0, totalPnl: 0, winRate: 0 },
          SELL: { count: 0, totalPnl: 0, winRate: 0 },
        },
        byExitReason: {},
        bySector: {},
        byTimeOfDay: {
          morning: { count: 0, totalPnl: 0, winRate: 0, avgReturn: 0 },
          midday: { count: 0, totalPnl: 0, winRate: 0, avgReturn: 0 },
          afternoon: { count: 0, totalPnl: 0, winRate: 0, avgReturn: 0 },
        },
        byDayOfWeek: {},
        factorCorrelations: {
          factors: ['technical', 'fundamental', 'sentiment', 'ai'],
          matrix: [
            [1, 0.5, 0.3, 0.85],
            [0.5, 1, 0.2, 0.4],
            [0.3, 0.2, 1, 0.6],
            [0.85, 0.4, 0.6, 1],
          ],
        },
        insights: [],
      };

      const insights = generateInsights(result);

      expect(insights.some((i) => i.includes('correlated'))).toBe(true);
    });

    it('should return empty array when no data', () => {
      const result = {
        byFactor: {
          technical: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          fundamental: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          sentiment: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
          ai: { contribution: 0, accuracy: 0, avgReturn: 0, tradeCount: 0 },
        },
        byDecisionType: {
          BUY: { count: 0, totalPnl: 0, winRate: 0 },
          SELL: { count: 0, totalPnl: 0, winRate: 0 },
        },
        byExitReason: {},
        bySector: {},
        byTimeOfDay: {
          morning: { count: 0, totalPnl: 0, winRate: 0, avgReturn: 0 },
          midday: { count: 0, totalPnl: 0, winRate: 0, avgReturn: 0 },
          afternoon: { count: 0, totalPnl: 0, winRate: 0, avgReturn: 0 },
        },
        byDayOfWeek: {},
        factorCorrelations: {
          factors: ['technical', 'fundamental', 'sentiment', 'ai'],
          matrix: [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
          ],
        },
        insights: [],
      };

      const insights = generateInsights(result);

      expect(insights).toEqual([]);
    });
  });

  describe('PerformanceAttributor', () => {
    describe('analyze', () => {
      it('should perform full attribution analysis', () => {
        const trades = [
          createTrade({ symbol: 'AAPL', pnl: 100, pnlPct: 0.1, entryTime: '2024-01-15T14:30:00.000Z' }),
          createTrade({ symbol: 'MSFT', pnl: 50, pnlPct: 0.05, entryTime: '2024-01-15T15:00:00.000Z' }),
        ];

        const signals = [
          createSignal({ symbol: 'AAPL', timestamp: '2024-01-15T14:25:00.000Z', technicalScore: 0.8 }),
          createSignal({ symbol: 'MSFT', timestamp: '2024-01-15T14:55:00.000Z', fundamentalScore: 0.9 }),
        ];

        const fundamentals = [
          { symbol: 'AAPL', sector: 'Technology' },
          { symbol: 'MSFT', sector: 'Technology' },
        ];

        const attributor = new PerformanceAttributor();
        const result = attributor.analyze(trades, signals, fundamentals);

        expect(result.byFactor.technical.tradeCount).toBe(1);
        expect(result.byFactor.fundamental.tradeCount).toBe(1);
        expect(result.bySector.Technology).toBeDefined();
        expect(result.insights.length).toBeGreaterThan(0);
      });

      it('should return empty result for empty trades', () => {
        const attributor = new PerformanceAttributor();
        const result = attributor.analyze([], [], []);

        expect(result.byFactor.technical.tradeCount).toBe(0);
        expect(result.byDecisionType.BUY.count).toBe(0);
        expect(result.insights).toEqual([]);
      });
    });
  });

  describe('getPerformanceAttributor', () => {
    it('should return singleton instance', () => {
      const instance1 = getPerformanceAttributor();
      const instance2 = getPerformanceAttributor();

      expect(instance1).toBe(instance2);
      expect(instance1).toBeInstanceOf(PerformanceAttributor);
    });
  });
});
