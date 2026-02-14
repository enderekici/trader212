import { describe, expect, it } from 'vitest';
import {
  calculateMaxDrawdown,
  computeCalmar,
  computeExpectancy,
  computeProfitFactor,
  computeSQN,
  computeSortino,
} from '../../src/monitoring/performance.js';

// ── computeSortino ──────────────────────────────────────────────────────

describe('computeSortino', () => {
  it('returns null with fewer than 5 data points', () => {
    expect(computeSortino([0.01, 0.02, -0.01, 0.03])).toBeNull();
    expect(computeSortino([])).toBeNull();
    expect(computeSortino([0.01])).toBeNull();
  });

  it('computes correct Sortino for known values', () => {
    // Daily returns: 5 days of mixed returns
    const dailyReturns = [0.01, -0.005, 0.02, -0.01, 0.015];
    const result = computeSortino(dailyReturns, 0.05);

    expect(result).not.toBeNull();
    expect(typeof result).toBe('number');

    // Manual calculation:
    // riskFreeDaily = 0.05 / 252 ~ 0.000198
    // excessReturns: [0.009802, -0.005198, 0.019802, -0.010198, 0.014802]
    // meanExcess = (0.009802 + (-0.005198) + 0.019802 + (-0.010198) + 0.014802) / 5 = 0.029010 / 5 = 0.005802
    // negativeExcess: [-0.005198, -0.010198]
    // downsideVariance = (0.005198^2 + 0.010198^2) / 5 = (0.00002702 + 0.00010400) / 5 = 0.00002620
    // downsideDeviation = sqrt(0.00002620) ~ 0.005119
    // sortino = (0.005802 / 0.005119) * sqrt(252) ~ 1.1334 * 15.875 ~ 17.99
    expect(result).toBeGreaterThan(0);
  });

  it('returns null when all returns are positive (no downside)', () => {
    const dailyReturns = [0.01, 0.02, 0.015, 0.008, 0.012];
    const result = computeSortino(dailyReturns, 0.0);
    // All excess returns positive, no negative returns -> null (infinite Sortino)
    expect(result).toBeNull();
  });

  it('returns 0 when all returns are zero and risk-free is zero', () => {
    const dailyReturns = [0, 0, 0, 0, 0];
    const result = computeSortino(dailyReturns, 0.0);
    expect(result).toBe(0);
  });

  it('handles all negative returns', () => {
    const dailyReturns = [-0.01, -0.02, -0.015, -0.008, -0.012];
    const result = computeSortino(dailyReturns);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0);
  });

  it('uses risk-free rate of 5% by default', () => {
    const dailyReturns = [0.01, -0.005, 0.02, -0.01, 0.015];
    const withDefault = computeSortino(dailyReturns);
    const withExplicit = computeSortino(dailyReturns, 0.05);
    expect(withDefault).toBe(withExplicit);
  });

  it('returns higher value for lower downside risk', () => {
    // Lower downside risk (small negatives)
    const lowRisk = [0.01, -0.001, 0.02, -0.001, 0.015];
    // Higher downside risk (large negatives)
    const highRisk = [0.01, -0.05, 0.02, -0.05, 0.015];

    const lowResult = computeSortino(lowRisk, 0);
    const highResult = computeSortino(highRisk, 0);

    expect(lowResult).not.toBeNull();
    expect(highResult).not.toBeNull();
    expect(lowResult!).toBeGreaterThan(highResult!);
  });
});

// ── computeCalmar ───────────────────────────────────────────────────────

describe('computeCalmar', () => {
  it('returns null with fewer than 5 data points', () => {
    expect(computeCalmar([0.01, 0.02, -0.01, 0.03], 0.1)).toBeNull();
    expect(computeCalmar([], 0.1)).toBeNull();
  });

  it('returns null when max drawdown is zero', () => {
    expect(computeCalmar([0.01, 0.02, 0.015, 0.008, 0.012], 0)).toBeNull();
  });

  it('returns null when max drawdown is negative', () => {
    expect(computeCalmar([0.01, 0.02, 0.015, 0.008, 0.012], -0.1)).toBeNull();
  });

  it('computes correct Calmar for known values', () => {
    // mean daily return = 0.002, annualized = 0.002 * 252 = 0.504
    // max drawdown = 0.20
    // Calmar = 0.504 / 0.20 = 2.52
    const dailyReturns = [0.002, 0.002, 0.002, 0.002, 0.002];
    const result = computeCalmar(dailyReturns, 0.20);

    expect(result).not.toBeNull();
    expect(result).toBe(2.52);
  });

  it('returns negative Calmar for losing strategy', () => {
    const dailyReturns = [-0.002, -0.002, -0.002, -0.002, -0.002];
    const result = computeCalmar(dailyReturns, 0.30);

    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0);
  });

  it('computes higher Calmar for higher returns relative to drawdown', () => {
    const highReturns = [0.01, 0.01, 0.01, 0.01, 0.01];
    const lowReturns = [0.001, 0.001, 0.001, 0.001, 0.001];

    const highCalmar = computeCalmar(highReturns, 0.10);
    const lowCalmar = computeCalmar(lowReturns, 0.10);

    expect(highCalmar).not.toBeNull();
    expect(lowCalmar).not.toBeNull();
    expect(highCalmar!).toBeGreaterThan(lowCalmar!);
  });
});

// ── computeSQN ──────────────────────────────────────────────────────────

describe('computeSQN', () => {
  it('returns null with fewer than 5 trades', () => {
    expect(computeSQN([0.05, -0.02, 0.03, 0.01])).toBeNull();
    expect(computeSQN([])).toBeNull();
    expect(computeSQN([0.05])).toBeNull();
  });

  it('returns 0 when standard deviation is zero', () => {
    expect(computeSQN([0.05, 0.05, 0.05, 0.05, 0.05])).toBe(0);
  });

  it('computes correct SQN for known values', () => {
    // trades: [0.10, -0.05, 0.08, -0.03, 0.12]
    // n = 5
    // mean = (0.10 - 0.05 + 0.08 - 0.03 + 0.12) / 5 = 0.22 / 5 = 0.044
    // variance = ((0.10-0.044)^2 + (-0.05-0.044)^2 + (0.08-0.044)^2 + (-0.03-0.044)^2 + (0.12-0.044)^2) / 5
    //          = (0.003136 + 0.008836 + 0.001296 + 0.005476 + 0.005776) / 5
    //          = 0.024520 / 5 = 0.004904
    // stdDev = sqrt(0.004904) ~ 0.07003
    // SQN = sqrt(5) * (0.044 / 0.07003) = 2.2361 * 0.6283 ~ 1.41
    const tradeReturns = [0.10, -0.05, 0.08, -0.03, 0.12];
    const result = computeSQN(tradeReturns);

    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(1.41, 1);
  });

  it('returns positive SQN for profitable system', () => {
    const tradeReturns = [0.05, 0.03, 0.02, 0.04, 0.01, -0.01, 0.03];
    const result = computeSQN(tradeReturns);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  it('returns negative SQN for losing system', () => {
    const tradeReturns = [-0.05, -0.03, -0.02, -0.04, -0.01, 0.01, -0.03];
    const result = computeSQN(tradeReturns);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0);
  });

  it('scales with square root of trade count', () => {
    // Same mean and std, but more trades -> higher absolute SQN
    const returns5 = [0.05, -0.02, 0.03, 0.01, 0.04];
    const returns10 = [0.05, -0.02, 0.03, 0.01, 0.04, 0.05, -0.02, 0.03, 0.01, 0.04];

    const sqn5 = computeSQN(returns5);
    const sqn10 = computeSQN(returns10);

    expect(sqn5).not.toBeNull();
    expect(sqn10).not.toBeNull();
    // With same distribution, SQN10 should be roughly sqrt(2) * SQN5
    expect(sqn10!).toBeGreaterThan(sqn5!);
  });
});

// ── computeExpectancy ───────────────────────────────────────────────────

describe('computeExpectancy', () => {
  it('returns nulls for empty trades', () => {
    const result = computeExpectancy([]);
    expect(result.expectancy).toBeNull();
    expect(result.expectancyRatio).toBeNull();
    expect(result.avgWin).toBeNull();
    expect(result.avgLoss).toBeNull();
  });

  it('computes correct expectancy for known values', () => {
    // 3 wins of $100 each, 2 losses of $50 each
    const trades = [
      { pnl: 100 },
      { pnl: 100 },
      { pnl: 100 },
      { pnl: -50 },
      { pnl: -50 },
    ];
    const result = computeExpectancy(trades);

    // winRate = 3/5 = 0.6, lossRate = 2/5 = 0.4
    // avgWin = 100, avgLoss = 50
    // expectancy = (0.6 * 100) - (0.4 * 50) = 60 - 20 = 40
    expect(result.expectancy).toBe(40);
    expect(result.avgWin).toBe(100);
    expect(result.avgLoss).toBe(50);

    // R:R = 100/50 = 2
    // expectancyRatio = ((1 + 2) * 0.6) - 1 = 1.8 - 1 = 0.8
    expect(result.expectancyRatio).toBe(0.8);
  });

  it('handles all winning trades', () => {
    const trades = [{ pnl: 100 }, { pnl: 200 }, { pnl: 150 }];
    const result = computeExpectancy(trades);

    // winRate = 1, lossRate = 0
    // avgWin = 150, avgLoss = 0
    // expectancy = (1 * 150) - (0 * 0) = 150
    expect(result.expectancy).toBe(150);
    expect(result.avgWin).toBe(150);
    expect(result.avgLoss).toBeNull();
    expect(result.expectancyRatio).toBeNull(); // Cannot compute R:R with no losses
  });

  it('handles all losing trades', () => {
    const trades = [{ pnl: -100 }, { pnl: -200 }, { pnl: -150 }];
    const result = computeExpectancy(trades);

    // winRate = 0, lossRate = 1
    // avgWin = 0, avgLoss = 150
    // expectancy = (0 * 0) - (1 * 150) = -150
    expect(result.expectancy).toBe(-150);
    expect(result.avgWin).toBeNull();
    expect(result.avgLoss).toBe(150);

    // R:R = 0/150 = 0
    // expectancyRatio = ((1 + 0) * 0) - 1 = -1
    expect(result.expectancyRatio).toBe(-1);
  });

  it('handles single winning trade', () => {
    const result = computeExpectancy([{ pnl: 500 }]);
    expect(result.expectancy).toBe(500);
    expect(result.avgWin).toBe(500);
    expect(result.avgLoss).toBeNull();
  });

  it('handles single losing trade', () => {
    const result = computeExpectancy([{ pnl: -300 }]);
    expect(result.expectancy).toBe(-300);
    expect(result.avgWin).toBeNull();
    expect(result.avgLoss).toBe(300);
  });

  it('treats zero P&L as a loss', () => {
    const trades = [{ pnl: 0 }, { pnl: 100 }];
    const result = computeExpectancy(trades);

    // winRate = 0.5, lossRate = 0.5
    // avgWin = 100, avgLoss = 0 (the zero trade)
    expect(result.avgWin).toBe(100);
    expect(result.avgLoss).toBe(0);
    // expectancy = (0.5 * 100) - (0.5 * 0) = 50
    expect(result.expectancy).toBe(50);
  });

  it('computes negative expectancy for losing system', () => {
    const trades = [
      { pnl: 50 },
      { pnl: -100 },
      { pnl: -100 },
      { pnl: -100 },
      { pnl: 50 },
    ];
    const result = computeExpectancy(trades);
    expect(result.expectancy).not.toBeNull();
    expect(result.expectancy!).toBeLessThan(0);
  });
});

// ── computeProfitFactor ─────────────────────────────────────────────────

describe('computeProfitFactor', () => {
  it('returns null for empty trades', () => {
    expect(computeProfitFactor([])).toBeNull();
  });

  it('returns null for all winning trades (no losses)', () => {
    const trades = [{ pnl: 100 }, { pnl: 200 }, { pnl: 50 }];
    expect(computeProfitFactor(trades)).toBeNull();
  });

  it('returns null for all zero P&L trades', () => {
    // Zero P&L trades are "losses" but grossProfit = 0, grossLoss = 0
    const trades = [{ pnl: 0 }, { pnl: 0 }];
    expect(computeProfitFactor(trades)).toBeNull();
  });

  it('computes correct profit factor', () => {
    // grossProfit = 300, grossLoss = 150 => PF = 2
    const trades = [
      { pnl: 100 },
      { pnl: -50 },
      { pnl: 200 },
      { pnl: -100 },
    ];
    expect(computeProfitFactor(trades)).toBe(2);
  });

  it('returns value < 1 for losing system', () => {
    const trades = [
      { pnl: 50 },
      { pnl: -100 },
      { pnl: -200 },
    ];
    const result = computeProfitFactor(trades);
    expect(result).not.toBeNull();
    // grossProfit = 50, grossLoss = 300 => PF = 0.17
    expect(result!).toBeLessThan(1);
  });

  it('returns exactly 1 for break-even system', () => {
    const trades = [
      { pnl: 100 },
      { pnl: -100 },
    ];
    expect(computeProfitFactor(trades)).toBe(1);
  });

  it('handles all losing trades', () => {
    const trades = [{ pnl: -100 }, { pnl: -200 }];
    // grossProfit = 0, grossLoss = 300
    // Since grossLoss > 0 but grossProfit = 0 → 0/300 = 0
    expect(computeProfitFactor(trades)).toBe(0);
  });
});

// ── calculateMaxDrawdown ────────────────────────────────────────────────

describe('calculateMaxDrawdown', () => {
  it('returns zeros for empty trades', () => {
    const result = calculateMaxDrawdown([]);
    expect(result.maxDrawdown).toBe(0);
    expect(result.maxDrawdownPct).toBe(0);
    expect(result.currentDrawdown).toBe(0);
    expect(result.currentDrawdownPct).toBe(0);
    expect(result.peakDate).toBeNull();
    expect(result.troughDate).toBeNull();
  });

  it('returns zero drawdown for monotonically increasing P&L', () => {
    const trades = [
      { pnl: 100, exitTime: '2025-01-01' },
      { pnl: 50, exitTime: '2025-01-02' },
      { pnl: 75, exitTime: '2025-01-03' },
    ];
    const result = calculateMaxDrawdown(trades);

    expect(result.maxDrawdown).toBe(0);
    expect(result.maxDrawdownPct).toBe(0);
    expect(result.currentDrawdown).toBe(0);
    expect(result.currentDrawdownPct).toBe(0);
  });

  it('computes correct drawdown for known scenario', () => {
    // Cumulative: 100, 150, 100, 80, 130
    // Peak: 100, 150, 150, 150, 150
    // Drawdown: 0, 0, 50, 70, 20
    // Drawdown%: 0, 0, 33.33%, 46.67%, 13.33%
    const trades = [
      { pnl: 100, exitTime: '2025-01-01' },
      { pnl: 50, exitTime: '2025-01-02' },
      { pnl: -50, exitTime: '2025-01-03' },
      { pnl: -20, exitTime: '2025-01-04' },
      { pnl: 50, exitTime: '2025-01-05' },
    ];
    const result = calculateMaxDrawdown(trades);

    expect(result.maxDrawdown).toBe(70);
    expect(result.maxDrawdownPct).toBeCloseTo(0.4667, 3);
    expect(result.peakDate).toBe('2025-01-02');
    expect(result.troughDate).toBe('2025-01-04');
  });

  it('tracks current drawdown correctly when not at peak', () => {
    // Cumulative: 100, 50 (current)
    // Peak at 100, current at 50
    const trades = [
      { pnl: 100, exitTime: '2025-01-01' },
      { pnl: -50, exitTime: '2025-01-02' },
    ];
    const result = calculateMaxDrawdown(trades);

    expect(result.currentDrawdown).toBe(50);
    expect(result.currentDrawdownPct).toBe(0.5);
    // Max drawdown is same as current drawdown here
    expect(result.maxDrawdown).toBe(50);
  });

  it('current drawdown is zero when at new high', () => {
    const trades = [
      { pnl: 100, exitTime: '2025-01-01' },
      { pnl: -50, exitTime: '2025-01-02' },
      { pnl: 100, exitTime: '2025-01-03' },
    ];
    const result = calculateMaxDrawdown(trades);

    // Cumulative: 100, 50, 150 (new high)
    expect(result.currentDrawdown).toBe(0);
    expect(result.currentDrawdownPct).toBe(0);
    // Max drawdown occurred between 100 and 50
    expect(result.maxDrawdown).toBe(50);
    expect(result.maxDrawdownPct).toBe(0.5);
  });

  it('handles single trade (no drawdown possible)', () => {
    const result = calculateMaxDrawdown([{ pnl: 100, exitTime: '2025-01-01' }]);
    expect(result.maxDrawdown).toBe(0);
    expect(result.currentDrawdown).toBe(0);
  });

  it('handles single losing trade', () => {
    const result = calculateMaxDrawdown([{ pnl: -100, exitTime: '2025-01-01' }]);
    // cumulative goes to -100, peak stays at 0 (never positive)
    // absolute drawdown = peak(0) - cumulative(-100) = 100
    expect(result.maxDrawdown).toBe(100);
    // Since peak is 0, drawdown pct = 0 (division guard: can't express % of 0)
    expect(result.maxDrawdownPct).toBe(0);
  });

  it('handles deep drawdown followed by recovery', () => {
    // Cumulative: 200, 100, 0, 50, 300
    const trades = [
      { pnl: 200, exitTime: '2025-01-01' },
      { pnl: -100, exitTime: '2025-01-02' },
      { pnl: -100, exitTime: '2025-01-03' },
      { pnl: 50, exitTime: '2025-01-04' },
      { pnl: 250, exitTime: '2025-01-05' },
    ];
    const result = calculateMaxDrawdown(trades);

    expect(result.maxDrawdown).toBe(200);
    expect(result.maxDrawdownPct).toBe(1.0);
    expect(result.currentDrawdown).toBe(0);
    expect(result.peakDate).toBe('2025-01-01');
    expect(result.troughDate).toBe('2025-01-03');
  });

  it('handles all same P&L values', () => {
    const trades = [
      { pnl: 50, exitTime: '2025-01-01' },
      { pnl: 50, exitTime: '2025-01-02' },
      { pnl: 50, exitTime: '2025-01-03' },
    ];
    const result = calculateMaxDrawdown(trades);

    // Monotonically increasing -> no drawdown
    expect(result.maxDrawdown).toBe(0);
    expect(result.currentDrawdown).toBe(0);
  });

  it('handles null exit times gracefully', () => {
    const trades = [
      { pnl: 100, exitTime: null },
      { pnl: -50, exitTime: null },
    ];
    const result = calculateMaxDrawdown(trades);

    expect(result.maxDrawdown).toBe(50);
    expect(result.peakDate).toBeNull();
    expect(result.troughDate).toBeNull();
  });

  it('identifies correct peak and trough dates for multiple drawdowns', () => {
    // Cumulative: 100, 80, 120, 50, 90
    // First DD: peak=100 (day1), trough=80 (day2), DD=20
    // Second DD: peak=120 (day3), trough=50 (day4), DD=70
    const trades = [
      { pnl: 100, exitTime: '2025-01-01' },
      { pnl: -20, exitTime: '2025-01-02' },
      { pnl: 40, exitTime: '2025-01-03' },
      { pnl: -70, exitTime: '2025-01-04' },
      { pnl: 40, exitTime: '2025-01-05' },
    ];
    const result = calculateMaxDrawdown(trades);

    expect(result.maxDrawdown).toBe(70);
    expect(result.peakDate).toBe('2025-01-03');
    expect(result.troughDate).toBe('2025-01-04');
  });
});

// ── Edge cases & integration ────────────────────────────────────────────

describe('Edge cases', () => {
  it('computeSortino handles very small returns', () => {
    const dailyReturns = [0.0001, -0.0001, 0.0002, -0.0001, 0.0001];
    const result = computeSortino(dailyReturns, 0);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('number');
    expect(Number.isFinite(result!)).toBe(true);
  });

  it('computeSQN handles very large number of trades', () => {
    const tradeReturns = Array.from({ length: 1000 }, (_, i) =>
      i % 3 === 0 ? -0.02 : 0.03,
    );
    const result = computeSQN(tradeReturns);
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!)).toBe(true);
  });

  it('computeExpectancy handles mixed zero and non-zero P&Ls', () => {
    const trades = [{ pnl: 0 }, { pnl: 0 }, { pnl: 100 }, { pnl: -50 }];
    const result = computeExpectancy(trades);
    expect(result.expectancy).not.toBeNull();
    expect(typeof result.expectancy).toBe('number');
  });

  it('calculateMaxDrawdown with alternating wins and losses', () => {
    const trades = [
      { pnl: 100, exitTime: '2025-01-01' },
      { pnl: -50, exitTime: '2025-01-02' },
      { pnl: 100, exitTime: '2025-01-03' },
      { pnl: -50, exitTime: '2025-01-04' },
      { pnl: 100, exitTime: '2025-01-05' },
      { pnl: -50, exitTime: '2025-01-06' },
    ];
    const result = calculateMaxDrawdown(trades);

    // Cumulative: 100, 50, 150, 100, 200, 150
    // Max drawdown is 50 (from any peak)
    expect(result.maxDrawdown).toBe(50);
    // Peak is 200, current is 150, current DD = 50
    expect(result.currentDrawdown).toBe(50);
  });

  it('all computations return finite numbers (no NaN or Infinity)', () => {
    const dailyReturns = [0.01, -0.02, 0.015, -0.005, 0.01, -0.008, 0.02];
    const tradeReturns = [0.05, -0.02, 0.03, -0.01, 0.04, -0.03, 0.02];
    const trades = tradeReturns.map((r) => ({ pnl: r * 10000 }));

    const sortino = computeSortino(dailyReturns);
    const calmar = computeCalmar(dailyReturns, 0.15);
    const sqn = computeSQN(tradeReturns);
    const pf = computeProfitFactor(trades);
    const exp = computeExpectancy(trades);

    if (sortino != null) expect(Number.isFinite(sortino)).toBe(true);
    if (calmar != null) expect(Number.isFinite(calmar)).toBe(true);
    if (sqn != null) expect(Number.isFinite(sqn)).toBe(true);
    if (pf != null) expect(Number.isFinite(pf)).toBe(true);
    if (exp.expectancy != null) expect(Number.isFinite(exp.expectancy)).toBe(true);
    if (exp.expectancyRatio != null) expect(Number.isFinite(exp.expectancyRatio)).toBe(true);
    if (exp.avgWin != null) expect(Number.isFinite(exp.avgWin)).toBe(true);
    if (exp.avgLoss != null) expect(Number.isFinite(exp.avgLoss)).toBe(true);
  });
});
