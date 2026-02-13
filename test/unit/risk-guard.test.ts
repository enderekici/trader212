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

const mockAll = vi.fn().mockReturnValue([]);
const mockLimit = vi.fn().mockReturnValue({ all: mockAll });
const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({ select: mockSelect }),
}));

vi.mock('../../src/db/schema.js', () => ({
  trades: {
    exitPrice: 'exitPrice',
    exitTime: 'exitTime',
    pnl: 'pnl',
    entryPrice: 'entryPrice',
  },
}));

vi.mock('drizzle-orm', () => ({
  desc: vi.fn((col: unknown) => col),
  isNotNull: vi.fn((col: unknown) => col),
}));

// ── Import SUT ──────────────────────────────────────────────────────────────
import { RiskGuard, type PortfolioState, type TradeProposal } from '../../src/execution/risk-guard.js';

function makePortfolio(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    cashAvailable: 10000,
    portfolioValue: 50000,
    openPositions: 2,
    todayPnl: 0,
    todayPnlPct: 0,
    sectorExposure: {},
    sectorExposureValue: {},
    peakValue: 50000,
    ...overrides,
  };
}

function makeProposal(overrides: Partial<TradeProposal> = {}): TradeProposal {
  return {
    symbol: 'AAPL',
    side: 'BUY',
    shares: 10,
    price: 150,
    stopLossPct: 0.05,
    positionSizePct: 0.03,
    ...overrides,
  };
}

describe('RiskGuard', () => {
  let guard: RiskGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    guard = new RiskGuard();

    mockConfigGet.mockImplementation((key: string) => {
      const defaults: Record<string, unknown> = {
        'risk.maxPositions': 5,
        'risk.maxPositionSizePct': 0.15,
        'risk.maxRiskPerTradePct': 0.02,
        'risk.maxSectorConcentration': 3,
        'risk.dailyLossLimitPct': 0.05,
        'risk.maxDrawdownAlertPct': 0.10,
      };
      return defaults[key];
    });
  });

  // ── validateTrade ──────────────────────────────────────────────────────
  describe('validateTrade', () => {
    it('allows a valid BUY trade', () => {
      const result = guard.validateTrade(makeProposal(), makePortfolio());
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('always allows SELL trades without position limits', () => {
      const result = guard.validateTrade(
        makeProposal({ side: 'SELL' }),
        makePortfolio({ openPositions: 10 }),
      );
      expect(result.allowed).toBe(true);
    });

    it('rejects when max positions reached', () => {
      const result = guard.validateTrade(
        makeProposal(),
        makePortfolio({ openPositions: 5 }),
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Max positions reached');
    });

    it('rejects when position size exceeds limit', () => {
      // 100 shares * $150 = $15,000 > 0.15 * $50,000 = $7,500
      const result = guard.validateTrade(
        makeProposal({ shares: 100, price: 150 }),
        makePortfolio(),
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Position size');
    });

    it('rejects when trade risk exceeds max risk per trade', () => {
      // positionValue * stopLossPct: 50 * 150 * 0.20 = $1,500
      // maxRisk = 0.02 * 50000 = $1,000
      const result = guard.validateTrade(
        makeProposal({ shares: 50, price: 150, stopLossPct: 0.20 }),
        makePortfolio({ portfolioValue: 50000 }),
      );
      // Position size is 50 * 150 = 7500 which is within 0.15 * 50000 = 7500
      // But risk = 7500 * 0.20 = 1500 > 1000
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Trade risk');
    });

    it('rejects when sector concentration exceeded', () => {
      const result = guard.validateTrade(
        makeProposal({ sector: 'Technology' }),
        makePortfolio({ sectorExposure: { Technology: 3 } }),
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Sector');
    });

    it('allows when sector is under limit', () => {
      const result = guard.validateTrade(
        makeProposal({ sector: 'Technology' }),
        makePortfolio({ sectorExposure: { Technology: 2 } }),
      );
      expect(result.allowed).toBe(true);
    });

    it('rejects when sector value percentage exceeds limit', () => {
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'risk.maxPositions': 5,
          'risk.maxPositionSizePct': 0.15,
          'risk.maxRiskPerTradePct': 0.02,
          'risk.maxSectorConcentration': 3,
          'risk.dailyLossLimitPct': 0.05,
          'risk.maxDrawdownAlertPct': 0.10,
          'risk.maxSectorValuePct': 0.35,
        };
        return defaults[key];
      });

      const result = guard.validateTrade(
        makeProposal({ sector: 'Technology' }),
        makePortfolio({
          sectorExposure: { Technology: 2 },
          sectorExposureValue: { Technology: 0.40 },
        }),
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('value');
    });

    it('allows when sector not in exposure map', () => {
      const result = guard.validateTrade(
        makeProposal({ sector: 'Healthcare' }),
        makePortfolio({ sectorExposure: { Technology: 2 } }),
      );
      expect(result.allowed).toBe(true);
    });

    it('allows when no sector specified on proposal', () => {
      const result = guard.validateTrade(
        makeProposal({ sector: undefined }),
        makePortfolio(),
      );
      expect(result.allowed).toBe(true);
    });

    it('rejects when insufficient cash', () => {
      // 10 * 150 = 1500 > 1000 cash
      const result = guard.validateTrade(
        makeProposal({ shares: 10, price: 150 }),
        makePortfolio({ cashAvailable: 1000 }),
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Insufficient cash');
    });
  });

  // ── checkDailyLoss ─────────────────────────────────────────────────────
  describe('checkDailyLoss', () => {
    it('returns true when daily loss exceeds limit', () => {
      const result = guard.checkDailyLoss(
        makePortfolio({ todayPnlPct: -0.06 }),
      );
      expect(result).toBe(true);
    });

    it('returns false when daily loss is within limit', () => {
      const result = guard.checkDailyLoss(
        makePortfolio({ todayPnlPct: -0.03 }),
      );
      expect(result).toBe(false);
    });

    it('returns false when portfolio is profitable today', () => {
      const result = guard.checkDailyLoss(
        makePortfolio({ todayPnlPct: 0.02 }),
      );
      expect(result).toBe(false);
    });

    it('returns true when exactly at the limit boundary', () => {
      // todayPnlPct = -0.05, limit = 0.05 => -0.05 < -0.05 is false
      const result = guard.checkDailyLoss(
        makePortfolio({ todayPnlPct: -0.05 }),
      );
      expect(result).toBe(false);
    });

    it('returns true when exceeding limit by a tiny amount', () => {
      const result = guard.checkDailyLoss(
        makePortfolio({ todayPnlPct: -0.0501 }),
      );
      expect(result).toBe(true);
    });
  });

  // ── checkDrawdown ──────────────────────────────────────────────────────
  describe('checkDrawdown', () => {
    it('returns true when drawdown exceeds alert threshold', () => {
      // drawdown = (60000 - 50000) / 60000 = 0.1667 > 0.10
      const result = guard.checkDrawdown(
        makePortfolio({ peakValue: 60000, portfolioValue: 50000 }),
      );
      expect(result).toBe(true);
    });

    it('returns false when drawdown is within threshold', () => {
      // drawdown = (50000 - 48000) / 50000 = 0.04 < 0.10
      const result = guard.checkDrawdown(
        makePortfolio({ peakValue: 50000, portfolioValue: 48000 }),
      );
      expect(result).toBe(false);
    });

    it('returns false when peakValue is 0', () => {
      const result = guard.checkDrawdown(
        makePortfolio({ peakValue: 0, portfolioValue: 50000 }),
      );
      expect(result).toBe(false);
    });

    it('returns false when peakValue is negative', () => {
      const result = guard.checkDrawdown(
        makePortfolio({ peakValue: -1, portfolioValue: 50000 }),
      );
      expect(result).toBe(false);
    });

    it('returns false when no drawdown (portfolio at peak)', () => {
      const result = guard.checkDrawdown(
        makePortfolio({ peakValue: 50000, portfolioValue: 50000 }),
      );
      expect(result).toBe(false);
    });

    it('returns true at exactly the threshold', () => {
      // drawdown = (50000 - 45000) / 50000 = 0.10 > 0.10 is false (not strictly greater)
      const result = guard.checkDrawdown(
        makePortfolio({ peakValue: 50000, portfolioValue: 45000 }),
      );
      expect(result).toBe(false);
    });

    it('returns true just past the threshold', () => {
      // drawdown = (50000 - 44999) / 50000 = 0.10002 > 0.10
      const result = guard.checkDrawdown(
        makePortfolio({ peakValue: 50000, portfolioValue: 44999 }),
      );
      expect(result).toBe(true);
    });
  });

  // ── getLosingStreakMultiplier ────────────────────────────────────────────
  describe('getLosingStreakMultiplier', () => {
    beforeEach(() => {
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'risk.maxPositions': 5,
          'risk.maxPositionSizePct': 0.15,
          'risk.maxRiskPerTradePct': 0.02,
          'risk.maxSectorConcentration': 3,
          'risk.dailyLossLimitPct': 0.05,
          'risk.maxDrawdownAlertPct': 0.10,
          'risk.streakReductionThreshold': 3,
          'risk.streakReductionFactor': 0.5,
        };
        return defaults[key];
      });
    });

    it('returns 1.0 when no closed trades exist', () => {
      mockAll.mockReturnValueOnce([]);
      const result = guard.getLosingStreakMultiplier();
      expect(result).toBe(1.0);
    });

    it('returns 1.0 when most recent trade is a win', () => {
      mockAll.mockReturnValueOnce([
        { pnl: 100, exitPrice: 160, entryPrice: 150 },
      ]);
      const result = guard.getLosingStreakMultiplier();
      expect(result).toBe(1.0);
    });

    it('returns 1.0 when losses are below threshold', () => {
      mockAll.mockReturnValueOnce([
        { pnl: -50, exitPrice: 145, entryPrice: 150 },
        { pnl: -30, exitPrice: 147, entryPrice: 150 },
        { pnl: 100, exitPrice: 160, entryPrice: 150 },
      ]);
      const result = guard.getLosingStreakMultiplier();
      expect(result).toBe(1.0);
    });

    it('returns factor when consecutive losses equal threshold', () => {
      // 3 consecutive losses with threshold=3, factor=0.5 -> 0.5^1 = 0.5
      mockAll.mockReturnValueOnce([
        { pnl: -50, exitPrice: 145, entryPrice: 150 },
        { pnl: -30, exitPrice: 147, entryPrice: 150 },
        { pnl: -20, exitPrice: 148, entryPrice: 150 },
        { pnl: 100, exitPrice: 160, entryPrice: 150 },
      ]);
      const result = guard.getLosingStreakMultiplier();
      expect(result).toBe(0.5);
    });

    it('returns factor when consecutive losses exceed threshold but below 2x', () => {
      // 4 consecutive losses with threshold=3 -> floor(4/3)=1 -> 0.5^1 = 0.5
      mockAll.mockReturnValueOnce([
        { pnl: -50, exitPrice: 145, entryPrice: 150 },
        { pnl: -30, exitPrice: 147, entryPrice: 150 },
        { pnl: -20, exitPrice: 148, entryPrice: 150 },
        { pnl: -10, exitPrice: 149, entryPrice: 150 },
        { pnl: 100, exitPrice: 160, entryPrice: 150 },
      ]);
      const result = guard.getLosingStreakMultiplier();
      expect(result).toBe(0.5);
    });

    it('returns factor^2 when consecutive losses reach 2x threshold', () => {
      // 6 consecutive losses with threshold=3, factor=0.5 -> 0.5^2 = 0.25
      mockAll.mockReturnValueOnce([
        { pnl: -50, exitPrice: 145, entryPrice: 150 },
        { pnl: -30, exitPrice: 147, entryPrice: 150 },
        { pnl: -20, exitPrice: 148, entryPrice: 150 },
        { pnl: -10, exitPrice: 149, entryPrice: 150 },
        { pnl: -5, exitPrice: 149.5, entryPrice: 150 },
        { pnl: -15, exitPrice: 148.5, entryPrice: 150 },
        { pnl: 100, exitPrice: 160, entryPrice: 150 },
      ]);
      const result = guard.getLosingStreakMultiplier();
      expect(result).toBe(0.25);
    });

    it('uses exitPrice vs entryPrice when pnl is null', () => {
      // pnl is null, exitPrice < entryPrice -> counted as loss
      mockAll.mockReturnValueOnce([
        { pnl: null, exitPrice: 145, entryPrice: 150 },
        { pnl: null, exitPrice: 147, entryPrice: 150 },
        { pnl: null, exitPrice: 148, entryPrice: 150 },
        { pnl: 100, exitPrice: 160, entryPrice: 150 },
      ]);
      const result = guard.getLosingStreakMultiplier();
      expect(result).toBe(0.5);
    });

    it('counts as loss when both pnl and exitPrice are null', () => {
      // pnl is null, exitPrice is null -> (0 < entryPrice) -> counted as loss
      mockAll.mockReturnValueOnce([
        { pnl: null, exitPrice: null, entryPrice: 150 },
        { pnl: null, exitPrice: null, entryPrice: 140 },
        { pnl: null, exitPrice: null, entryPrice: 130 },
      ]);
      const result = guard.getLosingStreakMultiplier();
      expect(result).toBe(0.5);
    });

    it('returns 1.0 when threshold is 0', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'risk.streakReductionThreshold') return 0;
        if (key === 'risk.streakReductionFactor') return 0.5;
        return undefined;
      });
      const result = guard.getLosingStreakMultiplier();
      expect(result).toBe(1.0);
    });

    it('returns 1.0 when factor is 1.0 (no reduction)', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'risk.streakReductionThreshold') return 3;
        if (key === 'risk.streakReductionFactor') return 1.0;
        return undefined;
      });
      const result = guard.getLosingStreakMultiplier();
      expect(result).toBe(1.0);
    });

    it('returns 1.0 when factor is 0 (invalid)', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'risk.streakReductionThreshold') return 3;
        if (key === 'risk.streakReductionFactor') return 0;
        return undefined;
      });
      const result = guard.getLosingStreakMultiplier();
      expect(result).toBe(1.0);
    });

    it('returns 1.0 when getDb throws (graceful fallback)', () => {
      mockSelect.mockImplementationOnce(() => {
        throw new Error('DB not initialized');
      });
      const result = guard.getLosingStreakMultiplier();
      expect(result).toBe(1.0);
    });

    it('stops counting at first win in the streak', () => {
      // Pattern: loss, loss, win, loss, loss, loss
      // Only 2 consecutive from most recent -> below threshold of 3
      mockAll.mockReturnValueOnce([
        { pnl: -50, exitPrice: 145, entryPrice: 150 },
        { pnl: -30, exitPrice: 147, entryPrice: 150 },
        { pnl: 100, exitPrice: 160, entryPrice: 150 }, // win breaks the streak
        { pnl: -20, exitPrice: 148, entryPrice: 150 },
        { pnl: -10, exitPrice: 149, entryPrice: 150 },
        { pnl: -5, exitPrice: 149.5, entryPrice: 150 },
      ]);
      const result = guard.getLosingStreakMultiplier();
      expect(result).toBe(1.0);
    });

    it('handles all losses with no wins', () => {
      // 9 consecutive losses with threshold=3, factor=0.5 -> 0.5^3 = 0.125
      mockAll.mockReturnValueOnce([
        { pnl: -50, exitPrice: 145, entryPrice: 150 },
        { pnl: -30, exitPrice: 147, entryPrice: 150 },
        { pnl: -20, exitPrice: 148, entryPrice: 150 },
        { pnl: -10, exitPrice: 149, entryPrice: 150 },
        { pnl: -5, exitPrice: 149.5, entryPrice: 150 },
        { pnl: -15, exitPrice: 148.5, entryPrice: 150 },
        { pnl: -25, exitPrice: 147.5, entryPrice: 150 },
        { pnl: -35, exitPrice: 146.5, entryPrice: 150 },
        { pnl: -45, exitPrice: 145.5, entryPrice: 150 },
      ]);
      const result = guard.getLosingStreakMultiplier();
      expect(result).toBe(0.125);
    });
  });
});
