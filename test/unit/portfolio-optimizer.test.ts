import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	PortfolioOptimizer,
	getPortfolioOptimizer,
	type PortfolioPosition,
} from '../../src/analysis/portfolio-optimizer.js';

vi.mock('../../src/config/manager.js', () => ({
	configManager: {
		get: vi.fn((key: string) => {
			if (key === 'portfolioOptimization.enabled') return true;
			if (key === 'portfolioOptimization.rebalanceIntervalDays') return 30;
			if (key === 'risk.maxPositionSizePct') return 0.15;
			if (key === 'risk.maxPositions') return 5;
			return undefined;
		}),
	},
}));

vi.mock('../../src/utils/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

describe('PortfolioOptimizer', () => {
	let optimizer: PortfolioOptimizer;

	beforeEach(async () => {
		// Reset mock to default implementation
		const { configManager } = await import('../../src/config/manager.js');
		vi.mocked(configManager.get).mockImplementation((key: string) => {
			if (key === 'portfolioOptimization.enabled') return true;
			if (key === 'portfolioOptimization.rebalanceIntervalDays') return 30;
			if (key === 'risk.maxPositionSizePct') return 0.15;
			if (key === 'risk.maxPositions') return 5;
			return undefined;
		});

		optimizer = new PortfolioOptimizer();
	});

	describe('calculateReturns', () => {
		it('should calculate daily returns from price history', () => {
			const priceHistory = new Map([
				['AAPL', [100, 102, 101, 103]],
				['GOOGL', [200, 210, 205, 215]],
			]);

			const returns = optimizer.calculateReturns(priceHistory);

			expect(returns.size).toBe(2);
			const aaplReturns = returns.get('AAPL') || [];
			expect(aaplReturns).toHaveLength(3);
			expect(aaplReturns[0]).toBeCloseTo(0.02, 5); // (102-100)/100
			expect(aaplReturns[1]).toBeCloseTo(-0.0098, 4); // (101-102)/102
			expect(aaplReturns[2]).toBeCloseTo(0.0198, 4); // (103-101)/101

			const googlReturns = returns.get('GOOGL') || [];
			expect(googlReturns).toHaveLength(3);
			expect(googlReturns[0]).toBeCloseTo(0.05, 5); // (210-200)/200
		});

		it('should return empty array for single price point', () => {
			const priceHistory = new Map([['AAPL', [100]]]);

			const returns = optimizer.calculateReturns(priceHistory);

			expect(returns.get('AAPL')).toEqual([]);
		});

		it('should handle empty price history', () => {
			const priceHistory = new Map([['AAPL', []]]);

			const returns = optimizer.calculateReturns(priceHistory);

			expect(returns.get('AAPL')).toEqual([]);
		});

		it('should handle multiple symbols with varying lengths', () => {
			const priceHistory = new Map([
				['AAPL', [100, 105]],
				['GOOGL', [200, 210, 220, 230]],
			]);

			const returns = optimizer.calculateReturns(priceHistory);

			expect(returns.get('AAPL')).toHaveLength(1);
			expect(returns.get('GOOGL')).toHaveLength(3);
		});
	});

	describe('calculateCovarianceMatrix', () => {
		it('should calculate covariance matrix for known values', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01]],
				['B', [0.02, 0.03, -0.02]],
			]);

			const covMatrix = optimizer.calculateCovarianceMatrix(returns);

			expect(covMatrix.size).toBe(2);
			const rowA = covMatrix.get('A');
			const rowB = covMatrix.get('B');
			expect(rowA).toBeDefined();
			expect(rowB).toBeDefined();

			// Variance of A
			const varA = rowA?.get('A') || 0;
			expect(varA).toBeGreaterThan(0);

			// Covariance should be symmetric
			const covAB = rowA?.get('B') || 0;
			const covBA = rowB?.get('A') || 0;
			expect(covAB).toBeCloseTo(covBA, 8);
		});

		it('should handle zero returns', () => {
			const returns = new Map([
				['A', [0, 0, 0]],
				['B', [0, 0, 0]],
			]);

			const covMatrix = optimizer.calculateCovarianceMatrix(returns);

			const varA = covMatrix.get('A')?.get('A') || 0;
			expect(varA).toBe(0);
		});

		it('should handle single symbol', () => {
			const returns = new Map([['A', [0.01, 0.02, -0.01]]]);

			const covMatrix = optimizer.calculateCovarianceMatrix(returns);

			expect(covMatrix.size).toBe(1);
			const varA = covMatrix.get('A')?.get('A') || 0;
			expect(varA).toBeGreaterThan(0);
		});

		it('should handle empty returns', () => {
			const returns = new Map([['A', []]]);

			const covMatrix = optimizer.calculateCovarianceMatrix(returns);

			const varA = covMatrix.get('A')?.get('A') || 0;
			expect(varA).toBe(0);
		});
	});

	describe('calculateCorrelationMatrix', () => {
		it('should calculate correlation matrix', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [0.015, 0.025, -0.015, 0.035]],
			]);

			const corrMatrix = optimizer.calculateCorrelationMatrix(returns);

			expect(corrMatrix.size).toBe(2);

			// Diagonal should be 1
			expect(corrMatrix.get('A')?.get('A')).toBeCloseTo(1, 5);
			expect(corrMatrix.get('B')?.get('B')).toBeCloseTo(1, 5);

			// Correlation should be symmetric
			const corrAB = corrMatrix.get('A')?.get('B') || 0;
			const corrBA = corrMatrix.get('B')?.get('A') || 0;
			expect(corrAB).toBeCloseTo(corrBA, 8);

			// Correlation should be between -1 and 1
			expect(Math.abs(corrAB)).toBeLessThanOrEqual(1);
		});

		it('should handle perfectly correlated assets', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01]],
				['B', [0.01, 0.02, -0.01]], // Same as A
			]);

			const corrMatrix = optimizer.calculateCorrelationMatrix(returns);

			const corrAB = corrMatrix.get('A')?.get('B') || 0;
			expect(corrAB).toBeCloseTo(1, 5);
		});

		it('should handle zero variance', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01]],
				['B', [0, 0, 0]],
			]);

			const corrMatrix = optimizer.calculateCorrelationMatrix(returns);

			const corrAB = corrMatrix.get('A')?.get('B') || 0;
			expect(corrAB).toBe(0);
			expect(corrMatrix.get('B')?.get('B')).toBe(1);
		});
	});

	describe('optimizeMinVariance', () => {
		it('should optimize for minimum variance with 2 assets', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03, -0.02]],
				['B', [0.005, 0.01, -0.005, 0.015, -0.01]],
			]);

			const weights = optimizer.optimizeMinVariance(returns);

			expect(Object.keys(weights)).toHaveLength(2);
			expect(weights.A).toBeGreaterThan(0);
			expect(weights.B).toBeGreaterThan(0);

			// Weights should sum to approximately 1
			const sum = Object.values(weights).reduce((s, w) => s + w, 0);
			expect(sum).toBeCloseTo(1, 5);
		});

		it('should optimize for minimum variance with 3 assets', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [0.015, 0.025, -0.015, 0.035]],
				['C', [0.008, 0.012, -0.008, 0.018]],
			]);

			const weights = optimizer.optimizeMinVariance(returns);

			expect(Object.keys(weights)).toHaveLength(3);

			const sum = Object.values(weights).reduce((s, w) => s + w, 0);
			expect(sum).toBeCloseTo(1, 5);
		});

		it('should respect max position size constraint', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [0.015, 0.025, -0.015, 0.035]],
			]);

			const weights = optimizer.optimizeMinVariance(returns, {
				maxPositionSize: 0.6,
			});

			expect(weights.A).toBeLessThanOrEqual(0.6);
			expect(weights.B).toBeLessThanOrEqual(0.6);
		});

		it('should not allow short selling by default', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [-0.015, -0.025, 0.015, -0.035]],
			]);

			const weights = optimizer.optimizeMinVariance(returns);

			expect(weights.A).toBeGreaterThanOrEqual(0);
			expect(weights.B).toBeGreaterThanOrEqual(0);
		});

		it('should return single weight for single asset', () => {
			const returns = new Map([['A', [0.01, 0.02, -0.01]]]);

			const weights = optimizer.optimizeMinVariance(returns);

			expect(weights).toEqual({ A: 1.0 });
		});

		it('should return empty object for no assets', () => {
			const returns = new Map();

			const weights = optimizer.optimizeMinVariance(returns);

			expect(weights).toEqual({});
		});
	});

	describe('optimizeMaxSharpe', () => {
		it('should optimize for maximum Sharpe ratio with 2 assets', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03, -0.02]],
				['B', [0.005, 0.01, -0.005, 0.015, -0.01]],
			]);

			const weights = optimizer.optimizeMaxSharpe(returns, 0.0001);

			expect(Object.keys(weights)).toHaveLength(2);

			const sum = Object.values(weights).reduce((s, w) => s + w, 0);
			expect(sum).toBeCloseTo(1, 5);
		});

		it('should optimize for maximum Sharpe ratio with 3 assets', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [0.015, 0.025, -0.015, 0.035]],
				['C', [0.008, 0.012, -0.008, 0.018]],
			]);

			const weights = optimizer.optimizeMaxSharpe(returns, 0.0001);

			expect(Object.keys(weights)).toHaveLength(3);

			const sum = Object.values(weights).reduce((s, w) => s + w, 0);
			expect(sum).toBeCloseTo(1, 5);
		});

		it('should respect max position size constraint', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [0.015, 0.025, -0.015, 0.035]],
			]);

			const weights = optimizer.optimizeMaxSharpe(returns, 0.0001, {
				maxPositionSize: 0.7,
			});

			expect(weights.A).toBeLessThanOrEqual(0.7);
			expect(weights.B).toBeLessThanOrEqual(0.7);
		});

		it('should return single weight for single asset', () => {
			const returns = new Map([['A', [0.01, 0.02, -0.01]]]);

			const weights = optimizer.optimizeMaxSharpe(returns);

			expect(weights).toEqual({ A: 1.0 });
		});

		it('should return empty object for no assets', () => {
			const returns = new Map();

			const weights = optimizer.optimizeMaxSharpe(returns);

			expect(weights).toEqual({});
		});
	});

	describe('optimizeRiskParity', () => {
		it('should optimize for risk parity with 2 assets', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03, -0.02]],
				['B', [0.005, 0.01, -0.005, 0.015, -0.01]],
			]);

			const weights = optimizer.optimizeRiskParity(returns);

			expect(Object.keys(weights)).toHaveLength(2);

			const sum = Object.values(weights).reduce((s, w) => s + w, 0);
			expect(sum).toBeCloseTo(1, 5);
		});

		it('should optimize for risk parity with 3 assets', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [0.015, 0.025, -0.015, 0.035]],
				['C', [0.008, 0.012, -0.008, 0.018]],
			]);

			const weights = optimizer.optimizeRiskParity(returns);

			expect(Object.keys(weights)).toHaveLength(3);

			const sum = Object.values(weights).reduce((s, w) => s + w, 0);
			expect(sum).toBeCloseTo(1, 5);
		});

		it('should return single weight for single asset', () => {
			const returns = new Map([['A', [0.01, 0.02, -0.01]]]);

			const weights = optimizer.optimizeRiskParity(returns);

			expect(weights).toEqual({ A: 1.0 });
		});

		it('should return empty object for no assets', () => {
			const returns = new Map();

			const weights = optimizer.optimizeRiskParity(returns);

			expect(weights).toEqual({});
		});

		it('should balance risk contributions', () => {
			const returns = new Map([
				['A', [0.02, 0.03, -0.02, 0.04, -0.03]], // Higher volatility
				['B', [0.005, 0.01, -0.005, 0.01, -0.005]], // Lower volatility
			]);

			const weights = optimizer.optimizeRiskParity(returns);

			// Lower volatility asset should have higher weight
			expect(weights.B).toBeGreaterThan(weights.A);
		});
	});

	describe('getDiversificationRatio', () => {
		it('should calculate diversification ratio', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [0.015, 0.025, -0.015, 0.035]],
			]);

			const weights = { A: 0.5, B: 0.5 };
			const covMatrix = optimizer.calculateCovarianceMatrix(returns);

			const ratio = optimizer.getDiversificationRatio(weights, covMatrix);

			expect(ratio).toBeGreaterThan(0);
			// Diversification ratio should typically be > 1 for diversified portfolio
			expect(ratio).toBeGreaterThan(1);
		});

		it('should return 0 for empty portfolio', () => {
			const weights = {};
			const covMatrix = new Map();

			const ratio = optimizer.getDiversificationRatio(weights, covMatrix);

			expect(ratio).toBe(0);
		});

		it('should return 1 for single asset portfolio', () => {
			const returns = new Map([['A', [0.01, 0.02, -0.01, 0.03]]]);
			const weights = { A: 1.0 };
			const covMatrix = optimizer.calculateCovarianceMatrix(returns);

			const ratio = optimizer.getDiversificationRatio(weights, covMatrix);

			expect(ratio).toBeCloseTo(1, 5);
		});

		it('should handle zero variance', () => {
			const returns = new Map([['A', [0, 0, 0]]]);
			const weights = { A: 1.0 };
			const covMatrix = optimizer.calculateCovarianceMatrix(returns);

			const ratio = optimizer.getDiversificationRatio(weights, covMatrix);

			expect(ratio).toBe(0);
		});
	});

	describe('getEfficientFrontier', () => {
		it('should generate efficient frontier points', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03, -0.02]],
				['B', [0.015, 0.025, -0.015, 0.035, -0.025]],
			]);

			const frontier = optimizer.getEfficientFrontier(returns, 10);

			expect(frontier).toHaveLength(10);

			for (const point of frontier) {
				expect(point.expectedReturn).toBeDefined();
				expect(point.expectedVolatility).toBeGreaterThanOrEqual(0);
				expect(point.weights).toBeDefined();

				// Weights should sum to 1
				const sum = Object.values(point.weights).reduce((s, w) => s + w, 0);
				expect(sum).toBeCloseTo(1, 5);
			}
		});

		it('should return empty array for no assets', () => {
			const returns = new Map();

			const frontier = optimizer.getEfficientFrontier(returns);

			expect(frontier).toEqual([]);
		});

		it('should generate default 20 points', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [0.015, 0.025, -0.015, 0.035]],
			]);

			const frontier = optimizer.getEfficientFrontier(returns);

			expect(frontier).toHaveLength(20);
		});

		it('should have increasing returns along frontier', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [0.015, 0.025, -0.015, 0.035]],
			]);

			const frontier = optimizer.getEfficientFrontier(returns, 10);

			for (let i = 1; i < frontier.length; i++) {
				// Returns should generally increase (with some tolerance for numerical precision)
				expect(frontier[i].expectedReturn).toBeGreaterThanOrEqual(
					frontier[i - 1].expectedReturn - 0.001,
				);
			}
		});
	});

	describe('suggestRebalance', () => {
		it('should suggest rebalance actions', () => {
			const positions: PortfolioPosition[] = [
				{ symbol: 'AAPL', shares: 10, currentPrice: 150, weight: 0.6 },
				{ symbol: 'GOOGL', shares: 5, currentPrice: 200, weight: 0.4 },
			];

			const priceHistory = new Map([
				['AAPL', [140, 145, 148, 150, 152]],
				['GOOGL', [190, 195, 198, 200, 205]],
			]);

			const result = optimizer.suggestRebalance(positions, priceHistory, 2500);

			expect(result.currentWeights).toBeDefined();
			expect(result.targetWeights).toBeDefined();
			expect(result.actions).toBeDefined();
			expect(result.expectedReturn).toBeDefined();
			expect(result.expectedVolatility).toBeGreaterThanOrEqual(0);
			expect(result.sharpeRatio).toBeDefined();
			expect(result.diversificationRatio).toBeGreaterThan(0);

			// Should have actions for both symbols
			expect(result.actions.length).toBeGreaterThan(0);

			for (const action of result.actions) {
				expect(['buy', 'sell', 'hold']).toContain(action.action);
				expect(action.currentWeight).toBeGreaterThanOrEqual(0);
				expect(action.targetWeight).toBeGreaterThanOrEqual(0);
			}
		});

		it('should return hold actions when disabled', async () => {
			const { configManager } = await import('../../src/config/manager.js');
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'portfolioOptimization.enabled') return false;
				if (key === 'risk.maxPositionSizePct') return 0.15;
				return undefined;
			});

			const positions: PortfolioPosition[] = [
				{ symbol: 'AAPL', shares: 10, currentPrice: 150, weight: 0.6 },
				{ symbol: 'GOOGL', shares: 5, currentPrice: 200, weight: 0.4 },
			];

			const priceHistory = new Map([
				['AAPL', [140, 145, 148, 150]],
				['GOOGL', [190, 195, 198, 200]],
			]);

			const result = optimizer.suggestRebalance(positions, priceHistory, 2500);

			expect(result.actions.every((a) => a.action === 'hold')).toBe(true);
			expect(result.expectedReturn).toBe(0);
			expect(result.expectedVolatility).toBe(0);
			expect(result.sharpeRatio).toBe(0);
		});

		it('should handle empty portfolio', () => {
			const result = optimizer.suggestRebalance([], new Map(), 0);

			expect(result.currentWeights).toEqual({});
			expect(result.targetWeights).toEqual({});
			expect(result.actions).toEqual([]);
			expect(result.expectedReturn).toBe(0);
			expect(result.expectedVolatility).toBe(0);
			expect(result.sharpeRatio).toBe(0);
			expect(result.diversificationRatio).toBe(0);
		});

		it('should handle missing price history', () => {
			const positions: PortfolioPosition[] = [
				{ symbol: 'AAPL', shares: 10, currentPrice: 150, weight: 1.0 },
			];

			const priceHistory = new Map(); // Empty

			const result = optimizer.suggestRebalance(positions, priceHistory, 1500);

			expect(result.actions.every((a) => a.action === 'hold')).toBe(true);
		});

		it('should calculate dollar and share deltas', () => {
			const positions: PortfolioPosition[] = [
				{ symbol: 'AAPL', shares: 10, currentPrice: 100, weight: 0.5 },
				{ symbol: 'GOOGL', shares: 5, currentPrice: 200, weight: 0.5 },
			];

			const priceHistory = new Map([
				['AAPL', [90, 95, 98, 100, 102]],
				['GOOGL', [190, 195, 198, 200, 205]],
			]);

			const result = optimizer.suggestRebalance(positions, priceHistory, 2000);

			for (const action of result.actions) {
				if (action.action === 'buy') {
					expect(action.sharesDelta).toBeGreaterThan(0);
					expect(action.dollarDelta).toBeGreaterThan(0);
				} else if (action.action === 'sell') {
					expect(action.sharesDelta).toBeLessThan(0);
					expect(action.dollarDelta).toBeLessThan(0);
				}
			}
		});

		it('should only rebalance when weight difference > 1%', () => {
			const positions: PortfolioPosition[] = [
				{ symbol: 'AAPL', shares: 50, currentPrice: 100, weight: 0.5 },
				{ symbol: 'GOOGL', shares: 50, currentPrice: 100, weight: 0.5 },
			];

			const priceHistory = new Map([
				['AAPL', [100, 100, 100, 100]],
				['GOOGL', [100, 100, 100, 100]],
			]);

			const result = optimizer.suggestRebalance(positions, priceHistory, 10000);

			// With identical returns, should suggest holding
			const holdActions = result.actions.filter((a) => a.action === 'hold');
			expect(holdActions.length).toBeGreaterThan(0);
		});
	});

	describe('singleton pattern', () => {
		it('should return same instance on multiple calls', () => {
			const instance1 = getPortfolioOptimizer();
			const instance2 = getPortfolioOptimizer();

			expect(instance1).toBe(instance2);
		});
	});

	describe('edge cases', () => {
		it('should handle identical returns across assets', () => {
			const returns = new Map([
				['A', [0.01, 0.01, 0.01]],
				['B', [0.01, 0.01, 0.01]],
				['C', [0.01, 0.01, 0.01]],
			]);

			const weights = optimizer.optimizeMinVariance(returns);

			const sum = Object.values(weights).reduce((s, w) => s + w, 0);
			expect(sum).toBeCloseTo(1, 5);
		});

		it('should handle negative returns', () => {
			const returns = new Map([
				['A', [-0.01, -0.02, -0.01]],
				['B', [-0.015, -0.025, -0.015]],
			]);

			const weights = optimizer.optimizeMaxSharpe(returns, 0.0001);

			const sum = Object.values(weights).reduce((s, w) => s + w, 0);
			expect(sum).toBeCloseTo(1, 5);
		});

		it('should handle large number of assets', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [0.015, 0.025, -0.015, 0.035]],
				['C', [0.008, 0.012, -0.008, 0.018]],
				['D', [0.012, 0.018, -0.012, 0.022]],
				['E', [0.009, 0.014, -0.009, 0.016]],
			]);

			const weights = optimizer.optimizeMinVariance(returns);

			expect(Object.keys(weights)).toHaveLength(5);

			const sum = Object.values(weights).reduce((s, w) => s + w, 0);
			expect(sum).toBeCloseTo(1, 5);
		});

		it('should normalize weights that sum to 1', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [0.015, 0.025, -0.015, 0.035]],
			]);

			const weights = optimizer.optimizeMaxSharpe(returns);

			const sum = Object.values(weights).reduce((s, w) => s + w, 0);
			expect(sum).toBeCloseTo(1, 8);
		});

		it('should handle zero variance asset', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [0, 0, 0, 0]],
			]);

			const weights = optimizer.optimizeMinVariance(returns);

			const sum = Object.values(weights).reduce((s, w) => s + w, 0);
			expect(sum).toBeCloseTo(1, 5);
		});

		it('should handle very small returns', () => {
			const returns = new Map([
				['A', [0.0001, 0.0002, -0.0001, 0.0003]],
				['B', [0.00015, 0.00025, -0.00015, 0.00035]],
			]);

			const weights = optimizer.optimizeMaxSharpe(returns, 0.00001);

			const sum = Object.values(weights).reduce((s, w) => s + w, 0);
			expect(sum).toBeCloseTo(1, 5);
		});

		it('should handle very large returns', () => {
			const returns = new Map([
				['A', [0.1, 0.2, -0.1, 0.3]],
				['B', [0.15, 0.25, -0.15, 0.35]],
			]);

			const weights = optimizer.optimizeMaxSharpe(returns, 0.001);

			const sum = Object.values(weights).reduce((s, w) => s + w, 0);
			expect(sum).toBeCloseTo(1, 5);
		});
	});

	describe('weight constraints', () => {
		it('should respect min position size', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [0.015, 0.025, -0.015, 0.035]],
			]);

			const weights = optimizer.optimizeMinVariance(returns, {
				minPositionSize: 0.1,
			});

			expect(weights.A).toBeGreaterThanOrEqual(0.1);
			expect(weights.B).toBeGreaterThanOrEqual(0.1);
		});

		it('should handle conflicting constraints gracefully', () => {
			const returns = new Map([
				['A', [0.01, 0.02, -0.01, 0.03]],
				['B', [0.015, 0.025, -0.015, 0.035]],
			]);

			const weights = optimizer.optimizeMinVariance(returns, {
				minPositionSize: 0.6, // 2 assets with min 0.6 each can't sum to 1
				maxPositionSize: 0.7,
			});

			// Should still return valid weights that sum to 1
			const sum = Object.values(weights).reduce((s, w) => s + w, 0);
			expect(sum).toBeCloseTo(1, 5);
		});
	});
});
