import { describe, expect, it } from 'vitest';
import { createMonteCarloSimulator } from '../../src/analysis/monte-carlo.js';
import type { TradeInput } from '../../src/analysis/monte-carlo.js';

describe('MonteCarloSimulator', () => {
  const simulator = createMonteCarloSimulator();

  describe('simulate()', () => {
    it('should return null for empty trades array', () => {
      const result = simulator.simulate([]);
      expect(result).toBeNull();
    });

    it('should return null when no valid pnlPct values', () => {
      const trades: TradeInput[] = [{ pnl: 100 }, { pnl: -50 }, { pnl: 75 }];
      const result = simulator.simulate(trades);
      expect(result).toBeNull();
    });

    it('should run basic simulation with known trades', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
        { pnlPct: 0.01 },
        { pnlPct: -0.02 },
      ];

      const result = simulator.simulate(trades, { simulations: 1000, seed: 42 });

      expect(result).toBeDefined();
      expect(result?.simulations).toBe(1000);
      expect(result?.percentiles).toHaveLength(5);
      expect(result?.distribution).toHaveLength(20);
    });

    it('should have percentiles in ascending order', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
        { pnlPct: 0.01 },
        { pnlPct: -0.02 },
      ];

      const result = simulator.simulate(trades, { simulations: 1000, seed: 42 });

      expect(result).toBeDefined();
      const percentiles = result!.percentiles;

      // Check that percentile levels are in order
      for (let i = 1; i < percentiles.length; i++) {
        expect(percentiles[i].level).toBeGreaterThan(percentiles[i - 1].level);
      }

      // Check that final equity values are in order
      for (let i = 1; i < percentiles.length; i++) {
        expect(percentiles[i].finalEquity).toBeGreaterThanOrEqual(percentiles[i - 1].finalEquity);
      }
    });

    it('should compute correct percentile levels', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
      ];

      const result = simulator.simulate(trades, {
        simulations: 1000,
        confidenceLevels: [0.05, 0.25, 0.5, 0.75, 0.95],
        seed: 42,
      });

      expect(result).toBeDefined();
      expect(result!.percentiles).toHaveLength(5);
      expect(result!.percentiles[0].level).toBe(0.05);
      expect(result!.percentiles[1].level).toBe(0.25);
      expect(result!.percentiles[2].level).toBe(0.5);
      expect(result!.percentiles[3].level).toBe(0.75);
      expect(result!.percentiles[4].level).toBe(0.95);
    });

    it('should compute probability of profit near 100% for all winning trades', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: 0.03 },
        { pnlPct: 0.02 },
        { pnlPct: 0.04 },
        { pnlPct: 0.01 },
      ];

      const result = simulator.simulate(trades, { simulations: 1000, seed: 42 });

      expect(result).toBeDefined();
      expect(result!.probabilityOfProfit).toBeGreaterThan(0.99);
    });

    it('should compute probability of profit near 0% for all losing trades', () => {
      const trades: TradeInput[] = [
        { pnlPct: -0.05 },
        { pnlPct: -0.03 },
        { pnlPct: -0.02 },
        { pnlPct: -0.04 },
        { pnlPct: -0.01 },
      ];

      const result = simulator.simulate(trades, { simulations: 1000, seed: 42 });

      expect(result).toBeDefined();
      expect(result!.probabilityOfProfit).toBe(0);
    });

    it('should compute probability of ruin correctly', () => {
      const trades: TradeInput[] = [
        { pnlPct: -0.25 }, // Larger losses to ensure >50% drawdown
        { pnlPct: -0.25 },
        { pnlPct: -0.25 },
        { pnlPct: 0.05 },
      ];

      const result = simulator.simulate(trades, { simulations: 1000, seed: 42 });

      expect(result).toBeDefined();
      expect(result!.probabilityOfRuin).toBeGreaterThan(0); // Some chance of ruin with large losses
    });

    it('should compute zero probability of ruin for small positive trades', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.01 },
        { pnlPct: 0.02 },
        { pnlPct: 0.01 },
      ];

      const result = simulator.simulate(trades, { simulations: 1000, seed: 42 });

      expect(result).toBeDefined();
      expect(result!.probabilityOfRuin).toBe(0);
    });

    it('should generate distribution buckets', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
        { pnlPct: 0.01 },
      ];

      const result = simulator.simulate(trades, { simulations: 1000, seed: 42 });

      expect(result).toBeDefined();
      expect(result!.distribution).toHaveLength(20);

      // Sum of all bucket counts should equal total simulations
      const totalCount = result!.distribution.reduce((sum, bucket) => sum + bucket.count, 0);
      expect(totalCount).toBeGreaterThan(0);

      // Check bucket ordering
      for (let i = 1; i < result!.distribution.length; i++) {
        expect(result!.distribution[i].bucketMin).toBeGreaterThanOrEqual(
          result!.distribution[i - 1].bucketMin,
        );
      }
    });

    it('should compute worst case scenario', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
      ];

      const result = simulator.simulate(trades, { simulations: 1000, seed: 42 });

      expect(result).toBeDefined();
      expect(result!.worstCase.finalEquity).toBeGreaterThan(0);
      expect(result!.worstCase.maxDrawdownPct).toBeGreaterThanOrEqual(0);
      expect(result!.worstCase.maxDrawdownPct).toBeLessThanOrEqual(1);
    });

    it('should compute best case scenario', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
      ];

      const result = simulator.simulate(trades, { simulations: 1000, seed: 42 });

      expect(result).toBeDefined();
      expect(result!.bestCase.finalEquity).toBeGreaterThan(0);
      expect(result!.bestCase.returnPct).toBeGreaterThanOrEqual(result!.worstCase.finalEquity - 1);
    });

    it('should compute 95% confidence interval', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
      ];

      const result = simulator.simulate(trades, { simulations: 1000, seed: 42 });

      expect(result).toBeDefined();
      expect(result!.confidenceInterval.lower).toBeGreaterThan(0);
      expect(result!.confidenceInterval.upper).toBeGreaterThan(result!.confidenceInterval.lower);
    });

    it('should compute expected value close to geometric mean for symmetric trades', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.03 },
        { pnlPct: -0.03 },
        { pnlPct: 0.03 },
        { pnlPct: -0.03 },
      ];

      const result = simulator.simulate(trades, { simulations: 10000, seed: 42 });

      expect(result).toBeDefined();
      // Expected value should be close to 1.0 for symmetric returns
      expect(result!.expectedValue).toBeCloseTo(1.0, 1);
    });

    it('should handle single trade', () => {
      const trades: TradeInput[] = [{ pnlPct: 0.05 }];

      const result = simulator.simulate(trades, { simulations: 100, seed: 42 });

      expect(result).toBeDefined();
      expect(result!.expectedValue).toBeCloseTo(1.05, 4);
      expect(result!.probabilityOfProfit).toBe(1.0);
      expect(result!.probabilityOfRuin).toBe(0);
    });

    it('should be deterministic with same seed', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
      ];

      const result1 = simulator.simulate(trades, { simulations: 1000, seed: 12345 });
      const result2 = simulator.simulate(trades, { simulations: 1000, seed: 12345 });

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result1!.expectedValue).toBe(result2!.expectedValue);
      expect(result1!.probabilityOfProfit).toBe(result2!.probabilityOfProfit);
      expect(result1!.percentiles[2].finalEquity).toBe(result2!.percentiles[2].finalEquity);
    });

    it('should handle all same returns', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.02 },
        { pnlPct: 0.02 },
        { pnlPct: 0.02 },
      ];

      const result = simulator.simulate(trades, { simulations: 100, seed: 42 });

      expect(result).toBeDefined();
      // All simulations should yield same result
      const expectedEquity = Math.pow(1.02, 3);
      expect(result!.expectedValue).toBeCloseTo(expectedEquity, 4);
      expect(result!.worstCase.finalEquity).toBeCloseTo(result!.bestCase.finalEquity, 4);
    });

    it('should ignore null and NaN pnlPct values', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: null },
        { pnlPct: Number.NaN },
        { pnlPct: 0.02 },
      ];

      const result = simulator.simulate(trades, { simulations: 100, seed: 42 });

      expect(result).toBeDefined();
      // Should only use the 2 valid trades
      expect(result!.simulations).toBe(100);
    });

    it('should handle very few trades', () => {
      const trades: TradeInput[] = [{ pnlPct: 0.05 }, { pnlPct: -0.03 }];

      const result = simulator.simulate(trades, { simulations: 100, seed: 42 });

      expect(result).toBeDefined();
      expect(result!.simulations).toBe(100);
    });

    it('should handle custom confidence levels', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
      ];

      const result = simulator.simulate(trades, {
        simulations: 1000,
        confidenceLevels: [0.1, 0.5, 0.9],
        seed: 42,
      });

      expect(result).toBeDefined();
      expect(result!.percentiles).toHaveLength(3);
      expect(result!.percentiles[0].level).toBe(0.1);
      expect(result!.percentiles[1].level).toBe(0.5);
      expect(result!.percentiles[2].level).toBe(0.9);
    });
  });

  describe('simulateWithSizing()', () => {
    it('should return null for empty trades', () => {
      const result = simulator.simulateWithSizing([]);
      expect(result).toBeNull();
    });

    it('should return null when no valid pnlPct values', () => {
      const trades: TradeInput[] = [{ pnl: 100 }, { pnl: -50 }];
      const result = simulator.simulateWithSizing(trades);
      expect(result).toBeNull();
    });

    it('should use initial capital in compounding', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.10 },
        { pnlPct: 0.10 },
      ];

      const initialCapital = 10000;
      const result = simulator.simulateWithSizing(trades, initialCapital, {
        simulations: 100,
        seed: 42,
      });

      expect(result).toBeDefined();
      // With 2 x 10% gains compounded: 10000 * 1.1 * 1.1 = 12100
      const expectedEquity = initialCapital * 1.1 * 1.1;
      expect(result!.expectedValue).toBeCloseTo(expectedEquity, 0);
    });

    it('should compound returns correctly', () => {
      const trades: TradeInput[] = [{ pnlPct: 0.05 }];

      const result = simulator.simulateWithSizing(trades, 10000, {
        simulations: 100,
        seed: 42,
      });

      expect(result).toBeDefined();
      expect(result!.expectedValue).toBeCloseTo(10500, 0);
    });

    it('should differ from non-compounding simulation', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.10 },
        { pnlPct: 0.10 },
        { pnlPct: 0.10 },
      ];

      const nonCompounding = simulator.simulate(trades, { simulations: 100, seed: 42 });
      const compounding = simulator.simulateWithSizing(trades, 10000, {
        simulations: 100,
        seed: 42,
      });

      expect(nonCompounding).toBeDefined();
      expect(compounding).toBeDefined();

      // Non-compounding uses equity as ratio (1.0 base)
      // Compounding uses dollar values (10000 base)
      expect(nonCompounding!.expectedValue).toBeCloseTo(1.331, 2); // 1.1^3
      expect(compounding!.expectedValue).toBeCloseTo(13310, 0); // 10000 * 1.1^3
    });

    it('should compute probability of profit relative to initial capital', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: 0.03 },
        { pnlPct: 0.02 },
      ];

      const result = simulator.simulateWithSizing(trades, 10000, {
        simulations: 1000,
        seed: 42,
      });

      expect(result).toBeDefined();
      expect(result!.probabilityOfProfit).toBeGreaterThan(0.99);
    });

    it('should handle losses with compounding', () => {
      const trades: TradeInput[] = [
        { pnlPct: -0.10 },
        { pnlPct: -0.10 },
      ];

      const result = simulator.simulateWithSizing(trades, 10000, {
        simulations: 100,
        seed: 42,
      });

      expect(result).toBeDefined();
      // 10000 * 0.9 * 0.9 = 8100
      expect(result!.expectedValue).toBeCloseTo(8100, 0);
    });
  });

  describe('getConfidenceInterval()', () => {
    it('should return null for invalid level', () => {
      const trades: TradeInput[] = [{ pnlPct: 0.05 }];
      const result = simulator.simulate(trades, { simulations: 100, seed: 42 });

      expect(result).toBeDefined();
      expect(simulator.getConfidenceInterval(result!, -0.1)).toBeNull();
      expect(simulator.getConfidenceInterval(result!, 1.1)).toBeNull();
    });

    it('should compute 95% confidence interval', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
      ];

      const result = simulator.simulate(trades, {
        simulations: 1000,
        confidenceLevels: [0.025, 0.05, 0.25, 0.5, 0.75, 0.95, 0.975],
        seed: 42,
      });

      expect(result).toBeDefined();
      const ci = simulator.getConfidenceInterval(result!, 0.95);

      expect(ci).toBeDefined();
      expect(ci!.lower).toBeGreaterThan(0);
      expect(ci!.upper).toBeGreaterThan(ci!.lower);
    });

    it('should compute 90% confidence interval', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
      ];

      const result = simulator.simulate(trades, { simulations: 1000, seed: 42 });

      expect(result).toBeDefined();
      const ci = simulator.getConfidenceInterval(result!, 0.90);

      expect(ci).toBeDefined();
      expect(ci!.lower).toBeGreaterThan(0);
      expect(ci!.upper).toBeGreaterThan(ci!.lower);
    });

    it('should compute narrower interval for higher confidence', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
      ];

      const result = simulator.simulate(trades, {
        simulations: 1000,
        confidenceLevels: [0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99],
        seed: 42,
      });

      expect(result).toBeDefined();
      const ci50 = simulator.getConfidenceInterval(result!, 0.50);
      const ci95 = simulator.getConfidenceInterval(result!, 0.95);

      expect(ci50).toBeDefined();
      expect(ci95).toBeDefined();

      // 95% CI should be wider than 50% CI
      const width50 = ci50!.upper - ci50!.lower;
      const width95 = ci95!.upper - ci95!.lower;
      expect(width95).toBeGreaterThan(width50);
    });
  });

  describe('formatReport()', () => {
    it('should format basic report', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
      ];

      const result = simulator.simulate(trades, { simulations: 1000, seed: 42 });

      expect(result).toBeDefined();
      const report = simulator.formatReport(result!);

      expect(report).toContain('Monte Carlo Simulation Report');
      expect(report).toContain('Simulations: 1,000');
      expect(report).toContain('Expected Value:');
      expect(report).toContain('Probability of Profit:');
      expect(report).toContain('Probability of Ruin');
      expect(report).toContain('Confidence Interval:');
      expect(report).toContain('Percentiles:');
      expect(report).toContain('Worst Case:');
      expect(report).toContain('Best Case:');
      expect(report).toContain('Distribution');
    });

    it('should include percentile table', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
      ];

      const result = simulator.simulate(trades, {
        simulations: 1000,
        confidenceLevels: [0.05, 0.5, 0.95],
        seed: 42,
      });

      expect(result).toBeDefined();
      const report = simulator.formatReport(result!);

      expect(report).toContain('5th:');
      expect(report).toContain('50th:');
      expect(report).toContain('95th:');
    });

    it('should include distribution histogram', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.05 },
        { pnlPct: -0.03 },
        { pnlPct: 0.02 },
      ];

      const result = simulator.simulate(trades, { simulations: 1000, seed: 42 });

      expect(result).toBeDefined();
      const report = simulator.formatReport(result!);

      // Should have histogram bars
      expect(report).toContain('█');
      expect(report).toContain('Distribution (20 buckets)');
    });
  });

  describe('edge cases', () => {
    it('should handle very large positive returns', () => {
      const trades: TradeInput[] = [
        { pnlPct: 1.0 }, // 100% gain
        { pnlPct: 0.5 }, // 50% gain
      ];

      const result = simulator.simulate(trades, { simulations: 100, seed: 42 });

      expect(result).toBeDefined();
      expect(result!.probabilityOfProfit).toBe(1.0);
      expect(result!.probabilityOfRuin).toBe(0);
    });

    it('should handle very large negative returns', () => {
      const trades: TradeInput[] = [
        { pnlPct: -0.50 }, // 50% loss
        { pnlPct: -0.30 }, // 30% loss
      ];

      const result = simulator.simulate(trades, { simulations: 100, seed: 42 });

      expect(result).toBeDefined();
      expect(result!.probabilityOfProfit).toBe(0);
      expect(result!.probabilityOfRuin).toBeGreaterThan(0);
    });

    it('should handle mixed extreme returns', () => {
      const trades: TradeInput[] = [
        { pnlPct: 0.50 },
        { pnlPct: -0.40 },
        { pnlPct: 0.30 },
        { pnlPct: -0.20 },
      ];

      const result = simulator.simulate(trades, { simulations: 1000, seed: 42 });

      expect(result).toBeDefined();
      expect(result!.simulations).toBe(1000);
    });

    it('should handle zero returns', () => {
      const trades: TradeInput[] = [{ pnlPct: 0.0 }, { pnlPct: 0.0 }, { pnlPct: 0.0 }];

      const result = simulator.simulate(trades, { simulations: 100, seed: 42 });

      expect(result).toBeDefined();
      expect(result!.expectedValue).toBeCloseTo(1.0, 4);
      expect(result!.probabilityOfProfit).toBe(0); // No profit, but no loss
      expect(result!.probabilityOfRuin).toBe(0);
    });
  });
});
