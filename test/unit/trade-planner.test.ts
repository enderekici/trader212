import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────
const mockConfigGet = vi.fn();
vi.mock('../../src/config/manager.js', () => ({
  configManager: { get: (...args: unknown[]) => mockConfigGet(...args) },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  desc: vi.fn(),
  and: vi.fn(),
  lte: vi.fn(),
}));

// DB mock
const mockDbRun = vi.fn().mockReturnValue({ lastInsertRowid: 1n, changes: 1 });
const mockDbGet = vi.fn();
const mockDbAll = vi.fn().mockReturnValue([]);

function createChain() {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'set', 'values', 'orderBy', 'limit', 'onConflictDoUpdate'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.run = mockDbRun;
  chain.get = mockDbGet;
  chain.all = mockDbAll;
  return chain;
}

const mockChain = createChain();

vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    select: () => mockChain,
    insert: () => mockChain,
    update: () => mockChain,
    delete: () => mockChain,
  }),
}));

vi.mock('../../src/db/schema.js', () => ({
  positions: { symbol: 'symbol' },
  tradePlans: { id: 'id', status: 'status', createdAt: 'createdAt' },
}));

// ── Import SUT ──────────────────────────────────────────────────────────────
import { TradePlanner } from '../../src/execution/trade-planner.js';
import type { AIDecision } from '../../src/ai/agent.js';
import type { PortfolioState } from '../../src/execution/risk-guard.js';

function makeDecision(overrides: Partial<AIDecision> = {}): AIDecision {
  return {
    decision: 'BUY',
    conviction: 80,
    reasoning: 'Bullish pattern',
    risks: ['Market volatility'],
    suggestedStopLossPct: 0.05,
    suggestedPositionSizePct: 0.10,
    suggestedTakeProfitPct: 0.15,
    urgency: 'immediate',
    exitConditions: 'Exit when RSI > 70',
    ...overrides,
  };
}

function makePortfolio(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    cashAvailable: 10000,
    portfolioValue: 100000,
    openPositions: 2,
    todayPnl: 0,
    todayPnlPct: 0,
    sectorExposure: {},
    peakValue: 100000,
    ...overrides,
  };
}

describe('TradePlanner', () => {
  let planner: TradePlanner;

  beforeEach(() => {
    vi.clearAllMocks();
    planner = new TradePlanner();

    mockConfigGet.mockImplementation((key: string) => {
      const defaults: Record<string, unknown> = {
        'execution.minRiskRewardRatio': 1.5,
        'execution.maxHoldDays': 30,
        'execution.approvalTimeoutMinutes': 5,
        't212.accountType': 'INVEST',
        'ai.model': 'claude-sonnet-4-5-20250929',
      };
      return defaults[key];
    });
  });

  // ── createPlan ─────────────────────────────────────────────────────────
  describe('createPlan', () => {
    it('creates a plan with correct calculations', () => {
      // DB get for getPlan after insert
      mockDbGet.mockReturnValueOnce({
        id: 1,
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        status: 'pending',
        side: 'BUY',
        entryPrice: 100,
        shares: 100,
        positionValue: 10000,
        positionSizePct: 0.10,
        stopLossPrice: 95,
        stopLossPct: 0.05,
        takeProfitPrice: 115,
        takeProfitPct: 0.15,
        maxLossDollars: 500,
        riskRewardRatio: 3.0,
        maxHoldDays: 30,
        aiConviction: 80,
        aiReasoning: 'Bullish pattern',
        aiModel: 'claude-sonnet-4-5-20250929',
        risks: '["Market volatility"]',
        urgency: 'immediate',
        exitConditions: 'Exit when RSI > 70',
        technicalScore: null,
        fundamentalScore: null,
        sentimentScore: null,
        accountType: 'INVEST',
        approvedAt: null,
        approvedBy: null,
        expiresAt: '2025-01-01T01:00:00Z',
        createdAt: '2025-01-01T00:00:00Z',
      });

      const plan = planner.createPlan({
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        price: 100,
        decision: makeDecision(),
        portfolio: makePortfolio(),
      });

      expect(plan).not.toBeNull();
      expect(plan!.symbol).toBe('AAPL');
      expect(plan!.side).toBe('BUY');
      expect(plan!.status).toBe('pending');
      expect(plan!.risks).toEqual(['Market volatility']);
    });

    it('returns null when shares calculate to 0', () => {
      const plan = planner.createPlan({
        symbol: 'BRK.A',
        t212Ticker: 'BRK.A_US_EQ',
        price: 500000, // Very high price
        decision: makeDecision({ suggestedPositionSizePct: 0.01 }),
        portfolio: makePortfolio({ portfolioValue: 1000 }),
      });

      expect(plan).toBeNull();
    });

    it('returns null when risk/reward ratio is too low for BUY', () => {
      // With stopLoss=0.15, takeProfit=0.02 => R:R will be low
      const plan = planner.createPlan({
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        price: 100,
        decision: makeDecision({
          decision: 'BUY',
          suggestedStopLossPct: 0.15,
          suggestedTakeProfitPct: 0.02,
        }),
        portfolio: makePortfolio(),
      });

      expect(plan).toBeNull();
    });

    it('returns null when stopLossPct is 0 (R:R ratio = 0) for BUY', () => {
      // stopLossPct = 0 => maxLossDollars = 0 => riskRewardRatio = 0 => < minRR for BUY
      const plan = planner.createPlan({
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        price: 100,
        decision: makeDecision({
          decision: 'BUY',
          suggestedStopLossPct: 0,
          suggestedTakeProfitPct: 0.10,
        }),
        portfolio: makePortfolio(),
      });

      expect(plan).toBeNull();
    });

    it('does NOT reject low R:R for SELL decisions', () => {
      mockDbGet.mockReturnValueOnce({
        id: 2,
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        status: 'pending',
        side: 'SELL',
        entryPrice: 100,
        shares: 100,
        positionValue: 10000,
        positionSizePct: 0.10,
        stopLossPrice: 85,
        stopLossPct: 0.15,
        takeProfitPrice: 102,
        takeProfitPct: 0.02,
        maxLossDollars: 1500,
        riskRewardRatio: 0.13,
        maxHoldDays: 30,
        aiConviction: 80,
        aiReasoning: 'Bearish pattern',
        aiModel: 'claude-sonnet-4-5-20250929',
        risks: '[]',
        urgency: 'immediate',
        exitConditions: null,
        technicalScore: null,
        fundamentalScore: null,
        sentimentScore: null,
        accountType: 'INVEST',
        approvedAt: null,
        approvedBy: null,
        expiresAt: '2025-01-01T01:00:00Z',
        createdAt: '2025-01-01T00:00:00Z',
      });

      const plan = planner.createPlan({
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        price: 100,
        decision: makeDecision({
          decision: 'SELL',
          suggestedStopLossPct: 0.15,
          suggestedTakeProfitPct: 0.02,
        }),
        portfolio: makePortfolio(),
      });

      // SELL should not be rejected for R:R ratio
      expect(plan).not.toBeNull();
    });

    it('includes optional scores when provided', () => {
      mockDbGet.mockReturnValueOnce({
        id: 3,
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        status: 'pending',
        side: 'BUY',
        entryPrice: 100,
        shares: 100,
        positionValue: 10000,
        positionSizePct: 0.10,
        stopLossPrice: 95,
        stopLossPct: 0.05,
        takeProfitPrice: 115,
        takeProfitPct: 0.15,
        maxLossDollars: 500,
        riskRewardRatio: 3.0,
        maxHoldDays: 30,
        aiConviction: 80,
        aiReasoning: 'Bullish',
        aiModel: 'test',
        risks: '[]',
        urgency: 'immediate',
        exitConditions: null,
        technicalScore: 75,
        fundamentalScore: 60,
        sentimentScore: 80,
        accountType: 'INVEST',
        approvedAt: null,
        approvedBy: null,
        expiresAt: '2025-01-01T01:00:00Z',
        createdAt: '2025-01-01T00:00:00Z',
      });

      const plan = planner.createPlan({
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        price: 100,
        decision: makeDecision(),
        portfolio: makePortfolio(),
        technicalScore: 75,
        fundamentalScore: 60,
        sentimentScore: 80,
      });

      expect(plan).not.toBeNull();
      expect(plan!.technicalScore).toBe(75);
      expect(plan!.fundamentalScore).toBe(60);
      expect(plan!.sentimentScore).toBe(80);
    });

    it('returns null when getPlan returns null after insert', () => {
      mockDbGet.mockReturnValueOnce(undefined); // getPlan returns null

      const plan = planner.createPlan({
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        price: 100,
        decision: makeDecision(),
        portfolio: makePortfolio(),
      });

      expect(plan).toBeNull();
    });
  });

  // ── approvePlan ────────────────────────────────────────────────────────
  describe('approvePlan', () => {
    it('updates plan to approved and returns it', () => {
      mockDbGet.mockReturnValueOnce({
        id: 1,
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        status: 'approved',
        side: 'BUY',
        entryPrice: 100,
        shares: 10,
        positionValue: 1000,
        positionSizePct: 0.01,
        stopLossPrice: 95,
        stopLossPct: 0.05,
        takeProfitPrice: 115,
        takeProfitPct: 0.15,
        maxLossDollars: 50,
        riskRewardRatio: 3.0,
        maxHoldDays: 30,
        aiConviction: 80,
        aiReasoning: 'Test',
        aiModel: 'test',
        risks: '[]',
        urgency: null,
        exitConditions: null,
        technicalScore: null,
        fundamentalScore: null,
        sentimentScore: null,
        accountType: 'INVEST',
        approvedAt: '2025-01-01T00:00:00Z',
        approvedBy: 'manual',
        expiresAt: null,
        createdAt: '2025-01-01T00:00:00Z',
      });

      const result = planner.approvePlan(1, 'manual');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('approved');
    });

    it('defaults approvedBy to "auto"', () => {
      mockDbGet.mockReturnValueOnce({
        id: 1,
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        status: 'approved',
        side: 'BUY',
        entryPrice: 100,
        shares: 10,
        positionValue: 1000,
        positionSizePct: 0.01,
        stopLossPrice: 95,
        stopLossPct: 0.05,
        takeProfitPrice: 115,
        takeProfitPct: 0.15,
        maxLossDollars: 50,
        riskRewardRatio: 3.0,
        maxHoldDays: 30,
        aiConviction: 80,
        aiReasoning: 'Test',
        aiModel: 'test',
        risks: '[]',
        urgency: null,
        exitConditions: null,
        technicalScore: null,
        fundamentalScore: null,
        sentimentScore: null,
        accountType: 'INVEST',
        approvedAt: '2025-01-01T00:00:00Z',
        approvedBy: 'auto',
        expiresAt: null,
        createdAt: '2025-01-01T00:00:00Z',
      });

      const result = planner.approvePlan(1);
      expect(result).not.toBeNull();
    });
  });

  // ── rejectPlan ─────────────────────────────────────────────────────────
  describe('rejectPlan', () => {
    it('sets plan status to rejected', () => {
      planner.rejectPlan(1);
      expect(mockDbRun).toHaveBeenCalled();
    });
  });

  // ── markExecuted ───────────────────────────────────────────────────────
  describe('markExecuted', () => {
    it('sets plan status to executed', () => {
      planner.markExecuted(1);
      expect(mockDbRun).toHaveBeenCalled();
    });
  });

  // ── expireOldPlans ─────────────────────────────────────────────────────
  describe('expireOldPlans', () => {
    it('returns number of expired plans', () => {
      mockDbRun.mockReturnValueOnce({ changes: 3 });

      const result = planner.expireOldPlans();
      expect(result).toBe(3);
    });
  });

  // ── getPendingPlans ────────────────────────────────────────────────────
  describe('getPendingPlans', () => {
    it('returns mapped pending plans', () => {
      mockDbAll.mockReturnValueOnce([
        {
          id: 1,
          symbol: 'AAPL',
          t212Ticker: 'AAPL_US_EQ',
          status: 'pending',
          side: 'BUY',
          entryPrice: 100,
          shares: 10,
          positionValue: 1000,
          positionSizePct: 0.01,
          stopLossPrice: 95,
          stopLossPct: 0.05,
          takeProfitPrice: 115,
          takeProfitPct: 0.15,
          maxLossDollars: 50,
          riskRewardRatio: 3.0,
          maxHoldDays: 30,
          aiConviction: 80,
          aiReasoning: 'Test',
          aiModel: 'test',
          risks: '["risk1"]',
          urgency: null,
          exitConditions: null,
          technicalScore: null,
          fundamentalScore: null,
          sentimentScore: null,
          accountType: 'INVEST',
          approvedAt: null,
          approvedBy: null,
          expiresAt: null,
          createdAt: '2025-01-01T00:00:00Z',
        },
      ]);

      const plans = planner.getPendingPlans();
      expect(plans).toHaveLength(1);
      expect(plans[0].risks).toEqual(['risk1']);
    });
  });

  // ── getPlan ────────────────────────────────────────────────────────────
  describe('getPlan', () => {
    it('returns null when plan not found', () => {
      mockDbGet.mockReturnValueOnce(undefined);
      expect(planner.getPlan(999)).toBeNull();
    });

    it('parses risks from JSON', () => {
      mockDbGet.mockReturnValueOnce({
        id: 1,
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        status: 'pending',
        side: 'BUY',
        entryPrice: 100,
        shares: 10,
        positionValue: 1000,
        positionSizePct: 0.01,
        stopLossPrice: 95,
        stopLossPct: 0.05,
        takeProfitPrice: 115,
        takeProfitPct: 0.15,
        maxLossDollars: 50,
        riskRewardRatio: 3.0,
        maxHoldDays: 30,
        aiConviction: 80,
        aiReasoning: 'Test',
        aiModel: 'test',
        risks: '["a","b"]',
        urgency: null,
        exitConditions: null,
        technicalScore: null,
        fundamentalScore: null,
        sentimentScore: null,
        accountType: 'INVEST',
        approvedAt: null,
        approvedBy: null,
        expiresAt: null,
        createdAt: '2025-01-01T00:00:00Z',
      });

      const plan = planner.getPlan(1);
      expect(plan!.risks).toEqual(['a', 'b']);
    });

    it('returns empty array when risks is null', () => {
      mockDbGet.mockReturnValueOnce({
        id: 1,
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        status: 'pending',
        side: 'BUY',
        entryPrice: 100,
        shares: 10,
        positionValue: 1000,
        positionSizePct: 0.01,
        stopLossPrice: 95,
        stopLossPct: 0.05,
        takeProfitPrice: 115,
        takeProfitPct: 0.15,
        maxLossDollars: 50,
        riskRewardRatio: 3.0,
        maxHoldDays: 30,
        aiConviction: 80,
        aiReasoning: 'Test',
        aiModel: 'test',
        risks: null,
        urgency: null,
        exitConditions: null,
        technicalScore: null,
        fundamentalScore: null,
        sentimentScore: null,
        accountType: 'INVEST',
        approvedAt: null,
        approvedBy: null,
        expiresAt: null,
        createdAt: '2025-01-01T00:00:00Z',
      });

      const plan = planner.getPlan(1);
      expect(plan!.risks).toEqual([]);
    });
  });

  // ── getRecentPlans ─────────────────────────────────────────────────────
  describe('getRecentPlans', () => {
    it('returns plans with default limit', () => {
      mockDbAll.mockReturnValueOnce([]);
      const plans = planner.getRecentPlans();
      expect(plans).toEqual([]);
    });

    it('accepts custom limit', () => {
      mockDbAll.mockReturnValueOnce([]);
      const plans = planner.getRecentPlans(5);
      expect(plans).toEqual([]);
    });
  });

  // ── formatPlanMessage ──────────────────────────────────────────────────
  describe('formatPlanMessage', () => {
    it('formats a complete plan message', () => {
      const plan = {
        id: 1,
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        status: 'pending' as const,
        side: 'BUY' as const,
        entryPrice: 150,
        shares: 10,
        positionValue: 1500,
        positionSizePct: 0.03,
        stopLossPrice: 142.5,
        stopLossPct: 0.05,
        takeProfitPrice: 165,
        takeProfitPct: 0.10,
        maxLossDollars: 75,
        riskRewardRatio: 2.0,
        maxHoldDays: 30,
        aiConviction: 80,
        aiReasoning: 'Bullish breakout',
        aiModel: 'test',
        risks: ['Market volatility', 'Earnings risk'],
        urgency: 'immediate',
        exitConditions: null,
        technicalScore: null,
        fundamentalScore: null,
        sentimentScore: null,
        accountType: 'INVEST' as const,
        approvedAt: null,
        approvedBy: null,
        expiresAt: null,
        createdAt: '2025-01-01T00:00:00Z',
      };

      const msg = planner.formatPlanMessage(plan);

      expect(msg).toContain('TRADE PLAN: AAPL');
      expect(msg).toContain('Side: BUY');
      expect(msg).toContain('Entry Price: $150.00');
      expect(msg).toContain('Risk/Reward: 1:2.0');
      expect(msg).toContain('Max Hold: 30 trading days');
      expect(msg).toContain('AI Conviction: 80/100');
      expect(msg).toContain('Reasoning: Bullish breakout');
      expect(msg).toContain('Risks: Market volatility, Earnings risk');
    });

    it('omits max hold days when null', () => {
      const plan = {
        id: 1,
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        status: 'pending' as const,
        side: 'BUY' as const,
        entryPrice: 150,
        shares: 10,
        positionValue: 1500,
        positionSizePct: 0.03,
        stopLossPrice: 142.5,
        stopLossPct: 0.05,
        takeProfitPrice: 165,
        takeProfitPct: 0.10,
        maxLossDollars: 75,
        riskRewardRatio: 2.0,
        maxHoldDays: null,
        aiConviction: 80,
        aiReasoning: null,
        aiModel: null,
        risks: [],
        urgency: null,
        exitConditions: null,
        technicalScore: null,
        fundamentalScore: null,
        sentimentScore: null,
        accountType: 'INVEST' as const,
        approvedAt: null,
        approvedBy: null,
        expiresAt: null,
        createdAt: '2025-01-01T00:00:00Z',
      };

      const msg = planner.formatPlanMessage(plan);

      expect(msg).not.toContain('Max Hold');
      expect(msg).toContain('Reasoning: N/A');
      expect(msg).not.toContain('Risks:');
    });
  });
});
