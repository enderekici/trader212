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

// ── Import SUT ──────────────────────────────────────────────────────────────
import { ApprovalManager } from '../../src/execution/approval-manager.js';
import type { TradePlan, TradePlanner } from '../../src/execution/trade-planner.js';

function makePlan(overrides: Partial<TradePlan> = {}): TradePlan {
  return {
    id: 1,
    symbol: 'AAPL',
    t212Ticker: 'AAPL_US_EQ',
    status: 'pending',
    side: 'BUY',
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
    aiReasoning: 'Test',
    aiModel: 'test',
    risks: [],
    urgency: 'immediate',
    exitConditions: null,
    technicalScore: null,
    fundamentalScore: null,
    sentimentScore: null,
    accountType: 'INVEST',
    approvedAt: null,
    approvedBy: null,
    expiresAt: null,
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMockPlanner(): TradePlanner {
  return {
    approvePlan: vi.fn().mockReturnValue(makePlan({ status: 'approved', approvedBy: 'auto' })),
    rejectPlan: vi.fn(),
    getPendingPlans: vi.fn().mockReturnValue([]),
    createPlan: vi.fn(),
    markExecuted: vi.fn(),
    expireOldPlans: vi.fn(),
    getPlan: vi.fn(),
    getRecentPlans: vi.fn(),
    formatPlanMessage: vi.fn(),
  } as unknown as TradePlanner;
}

describe('ApprovalManager', () => {
  let approvalManager: ApprovalManager;
  let mockPlanner: ReturnType<typeof makeMockPlanner>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPlanner = makeMockPlanner();
    approvalManager = new ApprovalManager(mockPlanner as TradePlanner);
  });

  // ── processNewPlan ─────────────────────────────────────────────────────
  describe('processNewPlan', () => {
    it('auto-approves when requireApproval is false', async () => {
      mockConfigGet.mockReturnValue(false);

      const result = await approvalManager.processNewPlan(makePlan());

      expect(result.shouldExecute).toBe(true);
      expect(mockPlanner.approvePlan).toHaveBeenCalledWith(1, 'auto');
    });

    it('returns original plan when approvePlan returns null', async () => {
      mockConfigGet.mockReturnValue(false);
      (mockPlanner.approvePlan as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      const plan = makePlan();
      const result = await approvalManager.processNewPlan(plan);

      expect(result.shouldExecute).toBe(true);
      expect(result.plan).toBe(plan);
    });

    it('waits for manual approval when requireApproval is true', async () => {
      mockConfigGet.mockReturnValue(true);

      const result = await approvalManager.processNewPlan(makePlan());

      expect(result.shouldExecute).toBe(false);
      expect(mockPlanner.approvePlan).not.toHaveBeenCalled();
    });
  });

  // ── handleApproval ─────────────────────────────────────────────────────
  describe('handleApproval', () => {
    it('approves plan when approved=true', () => {
      const result = approvalManager.handleApproval(1, true, 'telegram');

      expect(mockPlanner.approvePlan).toHaveBeenCalledWith(1, 'telegram');
      expect(result).not.toBeNull();
    });

    it('uses "manual" as default approver', () => {
      approvalManager.handleApproval(1, true);

      expect(mockPlanner.approvePlan).toHaveBeenCalledWith(1, 'manual');
    });

    it('rejects plan when approved=false', () => {
      const result = approvalManager.handleApproval(1, false);

      expect(mockPlanner.rejectPlan).toHaveBeenCalledWith(1);
      expect(result).toBeNull();
    });
  });

  // ── checkExpiredPlans ──────────────────────────────────────────────────
  describe('checkExpiredPlans', () => {
    it('auto-executes expired plans when autoExecute is true', () => {
      mockConfigGet.mockReturnValue(true);
      const expiredPlan = makePlan({
        expiresAt: '2020-01-01T00:00:00Z', // already expired
      });
      (mockPlanner.getPendingPlans as ReturnType<typeof vi.fn>).mockReturnValue([expiredPlan]);

      approvalManager.checkExpiredPlans();

      expect(mockPlanner.approvePlan).toHaveBeenCalledWith(1, 'auto-timeout');
    });

    it('rejects expired plans when autoExecute is false', () => {
      mockConfigGet.mockReturnValue(false);
      const expiredPlan = makePlan({
        expiresAt: '2020-01-01T00:00:00Z',
      });
      (mockPlanner.getPendingPlans as ReturnType<typeof vi.fn>).mockReturnValue([expiredPlan]);

      approvalManager.checkExpiredPlans();

      expect(mockPlanner.rejectPlan).toHaveBeenCalledWith(1);
    });

    it('does not touch non-expired plans', () => {
      mockConfigGet.mockReturnValue(false);
      const futurePlan = makePlan({
        expiresAt: '2099-01-01T00:00:00Z',
      });
      (mockPlanner.getPendingPlans as ReturnType<typeof vi.fn>).mockReturnValue([futurePlan]);

      approvalManager.checkExpiredPlans();

      expect(mockPlanner.approvePlan).not.toHaveBeenCalled();
      expect(mockPlanner.rejectPlan).not.toHaveBeenCalled();
    });

    it('does not touch plans without expiresAt', () => {
      mockConfigGet.mockReturnValue(false);
      const plan = makePlan({ expiresAt: null });
      (mockPlanner.getPendingPlans as ReturnType<typeof vi.fn>).mockReturnValue([plan]);

      approvalManager.checkExpiredPlans();

      expect(mockPlanner.approvePlan).not.toHaveBeenCalled();
      expect(mockPlanner.rejectPlan).not.toHaveBeenCalled();
    });

    it('handles multiple expired plans', () => {
      mockConfigGet.mockReturnValue(false);
      const plans = [
        makePlan({ id: 1, expiresAt: '2020-01-01T00:00:00Z' }),
        makePlan({ id: 2, expiresAt: '2020-06-01T00:00:00Z' }),
        makePlan({ id: 3, expiresAt: '2099-01-01T00:00:00Z' }),
      ];
      (mockPlanner.getPendingPlans as ReturnType<typeof vi.fn>).mockReturnValue(plans);

      approvalManager.checkExpiredPlans();

      expect(mockPlanner.rejectPlan).toHaveBeenCalledTimes(2);
      expect(mockPlanner.rejectPlan).toHaveBeenCalledWith(1);
      expect(mockPlanner.rejectPlan).toHaveBeenCalledWith(2);
    });
  });
});
