import { round } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('monte-carlo');

// ── Interfaces ────────────────────────────────────────────────────────────

export interface MonteCarloConfig {
  simulations?: number;
  confidenceLevels?: number[];
  seed?: number; // For reproducible testing
}

export interface MonteCarloPercentile {
  level: number;
  finalEquity: number;
  maxDrawdown: number;
  totalReturn: number;
}

export interface MonteCarloDistributionBucket {
  bucketMin: number;
  bucketMax: number;
  count: number;
}

export interface MonteCarloResult {
  simulations: number;
  percentiles: MonteCarloPercentile[];
  expectedValue: number;
  probabilityOfProfit: number;
  probabilityOfRuin: number; // P(drawdown > 50%)
  confidenceInterval: { lower: number; upper: number };
  distribution: MonteCarloDistributionBucket[];
  worstCase: { finalEquity: number; maxDrawdownPct: number };
  bestCase: { finalEquity: number; returnPct: number };
}

export interface TradeInput {
  pnl?: number | null;
  pnlPct?: number | null;
}

interface SimulationRun {
  finalEquity: number;
  maxDrawdownPct: number;
  totalReturn: number;
}

// ── Seeded Random Number Generator (for reproducible tests) ──────────────

class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    // Simple LCG (Linear Congruential Generator)
    this.seed = (this.seed * 1103515245 + 12345) % 2147483648;
    return this.seed / 2147483648;
  }

  // Random integer in [0, max)
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
}

// ── MonteCarloSimulator ───────────────────────────────────────────────────

export class MonteCarloSimulator {
  /**
   * Run Monte Carlo simulation on historical trades.
   * Randomly samples trades with replacement (bootstrap) and simulates equity curves.
   */
  simulate(trades: TradeInput[], config?: MonteCarloConfig): MonteCarloResult | null {
    if (trades.length === 0) {
      log.warn('No trades provided for Monte Carlo simulation');
      return null;
    }

    // Extract returns (pnlPct)
    const returns = trades
      .map((t) => t.pnlPct)
      .filter((pct): pct is number => pct != null && !Number.isNaN(pct));

    if (returns.length === 0) {
      log.warn('No valid returns (pnlPct) in trades');
      return null;
    }

    const numSimulations = config?.simulations ?? 10000;
    const confidenceLevels = config?.confidenceLevels ?? [0.05, 0.25, 0.5, 0.75, 0.95];
    const seed = config?.seed;

    const rng = seed != null ? new SeededRandom(seed) : null;

    log.info(
      { trades: returns.length, simulations: numSimulations },
      'Running Monte Carlo simulation',
    );

    const results: SimulationRun[] = [];

    for (let i = 0; i < numSimulations; i++) {
      // Bootstrap: sample N trades with replacement
      const sampledReturns: number[] = [];
      for (let j = 0; j < returns.length; j++) {
        const idx = rng ? rng.nextInt(returns.length) : Math.floor(Math.random() * returns.length);
        sampledReturns.push(returns[idx]);
      }

      // Compute equity curve and max drawdown
      let equity = 1.0; // Start at 100%
      let peak = 1.0;
      let maxDrawdown = 0;

      for (const ret of sampledReturns) {
        equity *= 1 + ret;
        if (equity > peak) peak = equity;
        const dd = (peak - equity) / peak;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }

      const totalReturn = equity - 1.0;

      results.push({
        finalEquity: equity,
        maxDrawdownPct: maxDrawdown,
        totalReturn,
      });
    }

    // Sort by final equity
    results.sort((a, b) => a.finalEquity - b.finalEquity);

    // Compute percentiles
    const percentiles: MonteCarloPercentile[] = [];
    for (const level of confidenceLevels) {
      const idx = Math.floor(level * (results.length - 1));
      const run = results[idx];
      percentiles.push({
        level: round(level, 4),
        finalEquity: round(run.finalEquity, 4),
        maxDrawdown: round(run.maxDrawdownPct, 4),
        totalReturn: round(run.totalReturn, 4),
      });
    }

    // Expected value (mean final equity)
    const expectedValue = round(
      results.reduce((sum, r) => sum + r.finalEquity, 0) / results.length,
      4,
    );

    // Probability of profit (final equity > 1.0)
    const profitCount = results.filter((r) => r.finalEquity > 1.0).length;
    const probabilityOfProfit = round(profitCount / results.length, 4);

    // Probability of ruin (max drawdown > 50%)
    const ruinCount = results.filter((r) => r.maxDrawdownPct > 0.5).length;
    const probabilityOfRuin = round(ruinCount / results.length, 4);

    // Confidence interval (5th to 95th percentile)
    const ci5idx = Math.floor(0.05 * (results.length - 1));
    const ci95idx = Math.floor(0.95 * (results.length - 1));
    const confidenceInterval = {
      lower: round(results[ci5idx].finalEquity, 4),
      upper: round(results[ci95idx].finalEquity, 4),
    };

    // Distribution histogram (20 buckets)
    const numBuckets = 20;
    const minEquity = results[0].finalEquity;
    const maxEquity = results[results.length - 1].finalEquity;
    const bucketSize = (maxEquity - minEquity) / numBuckets;

    const distribution: MonteCarloDistributionBucket[] = [];
    for (let i = 0; i < numBuckets; i++) {
      const bucketMin = minEquity + i * bucketSize;
      const bucketMax = minEquity + (i + 1) * bucketSize;
      const count = results.filter(
        (r) => r.finalEquity >= bucketMin && r.finalEquity < bucketMax,
      ).length;
      distribution.push({
        bucketMin: round(bucketMin, 4),
        bucketMax: round(bucketMax, 4),
        count,
      });
    }
    // Last bucket includes max value
    if (distribution.length > 0) {
      const lastIdx = results.filter(
        (r) => r.finalEquity >= distribution[distribution.length - 1].bucketMin,
      ).length;
      distribution[distribution.length - 1].count = lastIdx;
    }

    // Worst and best cases
    const worstCase = {
      finalEquity: round(results[0].finalEquity, 4),
      maxDrawdownPct: round(Math.max(...results.map((r) => r.maxDrawdownPct)), 4),
    };
    const bestCase = {
      finalEquity: round(results[results.length - 1].finalEquity, 4),
      returnPct: round(results[results.length - 1].totalReturn, 4),
    };

    log.info(
      {
        expectedValue,
        probabilityOfProfit,
        probabilityOfRuin,
        worstCase,
        bestCase,
      },
      'Monte Carlo simulation complete',
    );

    return {
      simulations: numSimulations,
      percentiles,
      expectedValue,
      probabilityOfProfit,
      probabilityOfRuin,
      confidenceInterval,
      distribution,
      worstCase,
      bestCase,
    };
  }

  /**
   * Run simulation with compounding position sizing.
   * Each trade applies return to current equity (not fixed amount).
   */
  simulateWithSizing(
    trades: TradeInput[],
    initialCapital = 10000,
    config?: MonteCarloConfig,
  ): MonteCarloResult | null {
    if (trades.length === 0) {
      log.warn('No trades provided for compounded Monte Carlo simulation');
      return null;
    }

    // Extract returns (pnlPct)
    const returns = trades
      .map((t) => t.pnlPct)
      .filter((pct): pct is number => pct != null && !Number.isNaN(pct));

    if (returns.length === 0) {
      log.warn('No valid returns (pnlPct) in trades');
      return null;
    }

    const numSimulations = config?.simulations ?? 10000;
    const confidenceLevels = config?.confidenceLevels ?? [0.05, 0.25, 0.5, 0.75, 0.95];
    const seed = config?.seed;

    const rng = seed != null ? new SeededRandom(seed) : null;

    log.info(
      { trades: returns.length, simulations: numSimulations, initialCapital },
      'Running compounded Monte Carlo simulation',
    );

    const results: SimulationRun[] = [];

    for (let i = 0; i < numSimulations; i++) {
      // Bootstrap: sample N trades with replacement
      const sampledReturns: number[] = [];
      for (let j = 0; j < returns.length; j++) {
        const idx = rng ? rng.nextInt(returns.length) : Math.floor(Math.random() * returns.length);
        sampledReturns.push(returns[idx]);
      }

      // Compute equity curve with compounding
      let equity = initialCapital;
      let peak = initialCapital;
      let maxDrawdown = 0;

      for (const ret of sampledReturns) {
        equity *= 1 + ret;
        if (equity > peak) peak = equity;
        const dd = peak > 0 ? (peak - equity) / peak : 0;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }

      const totalReturn = equity / initialCapital - 1.0;

      results.push({
        finalEquity: equity,
        maxDrawdownPct: maxDrawdown,
        totalReturn,
      });
    }

    // Sort by final equity
    results.sort((a, b) => a.finalEquity - b.finalEquity);

    // Compute percentiles
    const percentiles: MonteCarloPercentile[] = [];
    for (const level of confidenceLevels) {
      const idx = Math.floor(level * (results.length - 1));
      const run = results[idx];
      percentiles.push({
        level: round(level, 4),
        finalEquity: round(run.finalEquity, 2),
        maxDrawdown: round(run.maxDrawdownPct, 4),
        totalReturn: round(run.totalReturn, 4),
      });
    }

    // Expected value (mean final equity)
    const expectedValue = round(
      results.reduce((sum, r) => sum + r.finalEquity, 0) / results.length,
      2,
    );

    // Probability of profit (final equity > initialCapital)
    const profitCount = results.filter((r) => r.finalEquity > initialCapital).length;
    const probabilityOfProfit = round(profitCount / results.length, 4);

    // Probability of ruin (max drawdown > 50%)
    const ruinCount = results.filter((r) => r.maxDrawdownPct > 0.5).length;
    const probabilityOfRuin = round(ruinCount / results.length, 4);

    // Confidence interval (5th to 95th percentile)
    const ci5idx = Math.floor(0.05 * (results.length - 1));
    const ci95idx = Math.floor(0.95 * (results.length - 1));
    const confidenceInterval = {
      lower: round(results[ci5idx].finalEquity, 2),
      upper: round(results[ci95idx].finalEquity, 2),
    };

    // Distribution histogram (20 buckets)
    const numBuckets = 20;
    const minEquity = results[0].finalEquity;
    const maxEquity = results[results.length - 1].finalEquity;
    const bucketSize = (maxEquity - minEquity) / numBuckets;

    const distribution: MonteCarloDistributionBucket[] = [];
    for (let i = 0; i < numBuckets; i++) {
      const bucketMin = minEquity + i * bucketSize;
      const bucketMax = minEquity + (i + 1) * bucketSize;
      const count = results.filter(
        (r) => r.finalEquity >= bucketMin && r.finalEquity < bucketMax,
      ).length;
      distribution.push({
        bucketMin: round(bucketMin, 2),
        bucketMax: round(bucketMax, 2),
        count,
      });
    }
    // Last bucket includes max value
    if (distribution.length > 0) {
      const lastIdx = results.filter(
        (r) => r.finalEquity >= distribution[distribution.length - 1].bucketMin,
      ).length;
      distribution[distribution.length - 1].count = lastIdx;
    }

    // Worst and best cases
    const worstCase = {
      finalEquity: round(results[0].finalEquity, 2),
      maxDrawdownPct: round(Math.max(...results.map((r) => r.maxDrawdownPct)), 4),
    };
    const bestCase = {
      finalEquity: round(results[results.length - 1].finalEquity, 2),
      returnPct: round(results[results.length - 1].totalReturn, 4),
    };

    log.info(
      {
        expectedValue,
        probabilityOfProfit,
        probabilityOfRuin,
        worstCase,
        bestCase,
      },
      'Compounded Monte Carlo simulation complete',
    );

    return {
      simulations: numSimulations,
      percentiles,
      expectedValue,
      probabilityOfProfit,
      probabilityOfRuin,
      confidenceInterval,
      distribution,
      worstCase,
      bestCase,
    };
  }

  /**
   * Get confidence interval at specific level.
   * @param results Monte Carlo result object
   * @param level Confidence level (e.g., 0.95 for 95%)
   */
  getConfidenceInterval(
    results: MonteCarloResult,
    level: number,
  ): { lower: number; upper: number } | null {
    if (level < 0 || level > 1) {
      log.warn({ level }, 'Invalid confidence level (must be 0-1)');
      return null;
    }

    const lowerLevel = (1 - level) / 2;
    const upperLevel = 1 - lowerLevel;

    const lowerPercentile = results.percentiles.find((p) => p.level >= lowerLevel);
    const upperPercentile = results.percentiles.find((p) => p.level >= upperLevel);

    if (!lowerPercentile || !upperPercentile) {
      log.warn({ level }, 'Could not find percentiles for confidence interval');
      return null;
    }

    return {
      lower: lowerPercentile.finalEquity,
      upper: upperPercentile.finalEquity,
    };
  }

  /**
   * Format Monte Carlo results as human-readable report.
   */
  formatReport(result: MonteCarloResult): string {
    const lines: string[] = [];
    lines.push('=== Monte Carlo Simulation Report ===');
    lines.push('');
    lines.push(`Simulations: ${result.simulations.toLocaleString()}`);
    lines.push(
      `Expected Value: ${result.expectedValue.toFixed(4)} (${((result.expectedValue - 1) * 100).toFixed(2)}%)`,
    );
    lines.push(`Probability of Profit: ${(result.probabilityOfProfit * 100).toFixed(2)}%`);
    lines.push(`Probability of Ruin (DD > 50%): ${(result.probabilityOfRuin * 100).toFixed(2)}%`);
    lines.push('');
    lines.push(
      `95% Confidence Interval: [${result.confidenceInterval.lower.toFixed(4)}, ${result.confidenceInterval.upper.toFixed(4)}]`,
    );
    lines.push('');
    lines.push('Percentiles:');
    for (const p of result.percentiles) {
      const pct = (p.level * 100).toFixed(0);
      lines.push(
        `  ${pct.padStart(3)}th: Equity=${p.finalEquity.toFixed(4)} | Return=${(p.totalReturn * 100).toFixed(2)}% | MaxDD=${(p.maxDrawdown * 100).toFixed(2)}%`,
      );
    }
    lines.push('');
    lines.push('Worst Case:');
    lines.push(`  Final Equity: ${result.worstCase.finalEquity.toFixed(4)}`);
    lines.push(`  Max Drawdown: ${(result.worstCase.maxDrawdownPct * 100).toFixed(2)}%`);
    lines.push('');
    lines.push('Best Case:');
    lines.push(`  Final Equity: ${result.bestCase.finalEquity.toFixed(4)}`);
    lines.push(`  Return: ${(result.bestCase.returnPct * 100).toFixed(2)}%`);
    lines.push('');
    lines.push('Distribution (20 buckets):');
    for (const bucket of result.distribution) {
      const pct = ((bucket.count / result.simulations) * 100).toFixed(1);
      const bar = '█'.repeat(Math.floor((bucket.count / result.simulations) * 50));
      lines.push(
        `  [${bucket.bucketMin.toFixed(2)} - ${bucket.bucketMax.toFixed(2)}]: ${bucket.count.toString().padStart(5)} (${pct.padStart(5)}%) ${bar}`,
      );
    }
    lines.push('');
    return lines.join('\n');
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

export function createMonteCarloSimulator(): MonteCarloSimulator {
  return new MonteCarloSimulator();
}
