import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	RegimeDetector,
	getRegimeDetector,
	type MarketRegime,
} from '../../src/analysis/regime-detector.js';
import type { Candle } from '../../src/data/types.js';

// Mock config manager
vi.mock('../../src/config/manager.js', () => ({
	configManager: {
		get: vi.fn((key: string) => {
			const defaults: Record<string, unknown> = {
				'regime.enabled': true,
				'regime.lookbackDays': 50,
				'regime.vixThresholdHigh': 25,
				'regime.trendMaLength': 50,
				'regime.volatilityWindow': 20,
			};
			return defaults[key];
		}),
	},
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

describe('RegimeDetector', () => {
	let detector: RegimeDetector;

	beforeEach(async () => {
		detector = new RegimeDetector();
		vi.clearAllMocks();

		// Reset to default config
		const { configManager } = await import('../../src/config/manager.js');
		vi.mocked(configManager.get).mockImplementation((key: string) => {
			const defaults: Record<string, unknown> = {
				'regime.enabled': true,
				'regime.lookbackDays': 50,
				'regime.vixThresholdHigh': 25,
				'regime.trendMaLength': 50,
				'regime.volatilityWindow': 20,
			};
			return defaults[key];
		});
	});

	// Helper to create mock candles
	const createCandles = (
		count: number,
		startPrice: number,
		trend: 'up' | 'down' | 'flat' | 'volatile',
	): Candle[] => {
		const candles: Candle[] = [];
		let price = startPrice;

		for (let i = 0; i < count; i++) {
			let change = 0;

			switch (trend) {
				case 'up':
					change = Math.random() * 0.02 + 0.005; // +0.5% to +2.5% daily
					break;
				case 'down':
					change = -(Math.random() * 0.02 + 0.005); // -0.5% to -2.5% daily
					break;
				case 'flat':
					change = (Math.random() - 0.5) * 0.004; // ±0.2% daily
					break;
				case 'volatile':
					change = (Math.random() - 0.5) * 0.08; // ±4% daily
					break;
			}

			price = price * (1 + change);
			const high = price * (1 + Math.random() * 0.01);
			const low = price * (1 - Math.random() * 0.01);

			candles.push({
				timestamp: new Date(2024, 0, i + 1).toISOString(),
				open: price,
				high,
				low,
				close: price,
				volume: 1000000,
			});
		}

		return candles;
	};

	describe('Singleton Pattern', () => {
		it('should return same instance on multiple calls', () => {
			const instance1 = getRegimeDetector();
			const instance2 = getRegimeDetector();
			expect(instance1).toBe(instance2);
		});
	});

	describe('Feature Toggle', () => {
		it('should return null when regime detection is disabled', async () => {
			const { configManager } = await import('../../src/config/manager.js');
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'regime.enabled') return false;
				return 50;
			});

			const candles = createCandles(60, 400, 'up');
			const result = detector.detect(candles);

			expect(result).toBeNull();
		});

		it('should detect regime when enabled', () => {
			const candles = createCandles(60, 400, 'up');
			const result = detector.detect(candles, 15);

			expect(result).not.toBeNull();
			expect(result?.regime).toBeDefined();
		});
	});

	describe('Data Validation', () => {
		it('should return null when insufficient data', () => {
			const candles = createCandles(30, 400, 'up'); // Less than lookbackDays (50)
			const result = detector.detect(candles);

			expect(result).toBeNull();
		});

		it('should handle exact minimum data points', () => {
			const candles = createCandles(50, 400, 'up');
			const result = detector.detect(candles);

			expect(result).not.toBeNull();
		});

		it('should handle more than minimum data points', () => {
			const candles = createCandles(100, 400, 'up');
			const result = detector.detect(candles);

			expect(result).not.toBeNull();
		});
	});

	describe('Trending Up Detection', () => {
		it('should detect trending up regime', () => {
			const candles = createCandles(60, 400, 'up');
			const result = detector.detect(candles, 15);

			expect(result).not.toBeNull();
			expect(result?.regime).toBe('trending_up');
			expect(result?.details.spyTrend).toBe('up');
		});

		it('should have high confidence in strong uptrend with low volatility', () => {
			const candles = createCandles(60, 400, 'up');
			const result = detector.detect(candles, 12);

			expect(result).not.toBeNull();
			expect(result?.confidence).toBeGreaterThan(0.6);
		});

		it('should provide normal adjustments for trending up', () => {
			const adjustments = detector.getAdjustments('trending_up');

			expect(adjustments.positionSizeMultiplier).toBe(1.0);
			expect(adjustments.stopLossMultiplier).toBe(1.0);
			expect(adjustments.entryThresholdAdjustment).toBe(0);
			expect(adjustments.newEntriesAllowed).toBe(true);
		});
	});

	describe('Trending Down Detection', () => {
		it('should detect trending down regime', () => {
			const candles = createCandles(60, 400, 'down');
			const result = detector.detect(candles, 20);

			expect(result).not.toBeNull();
			expect(result?.regime).toBe('trending_down');
			expect(result?.details.spyTrend).toBe('down');
		});

		it('should reduce position size in downtrend', () => {
			const adjustments = detector.getAdjustments('trending_down');

			expect(adjustments.positionSizeMultiplier).toBe(0.5);
			expect(adjustments.stopLossMultiplier).toBe(0.8);
			expect(adjustments.entryThresholdAdjustment).toBe(10);
			expect(adjustments.newEntriesAllowed).toBe(true);
		});
	});

	describe('Range-Bound Detection', () => {
		it('should detect range-bound market with flat prices', () => {
			const candles = createCandles(60, 400, 'flat');
			const result = detector.detect(candles, 15);

			expect(result).not.toBeNull();
			expect(result?.regime).toBe('range_bound');
		});

		it('should detect range-bound when price stays within 3% range', () => {
			// Create candles that oscillate within tight range
			const candles: Candle[] = [];
			const basePrice = 400;

			for (let i = 0; i < 60; i++) {
				const price = basePrice + (Math.sin(i / 5) * basePrice * 0.01); // ±1% oscillation
				candles.push({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: price,
					high: price * 1.002,
					low: price * 0.998,
					close: price,
					volume: 1000000,
				});
			}

			const result = detector.detect(candles, 15);

			expect(result).not.toBeNull();
			expect(result?.regime).toBe('range_bound');
		});

		it('should provide conservative adjustments for range-bound', () => {
			const adjustments = detector.getAdjustments('range_bound');

			expect(adjustments.positionSizeMultiplier).toBe(0.7);
			expect(adjustments.stopLossMultiplier).toBe(0.7);
			expect(adjustments.entryThresholdAdjustment).toBe(5);
			expect(adjustments.newEntriesAllowed).toBe(true);
		});
	});

	describe('High Volatility Detection', () => {
		it('should detect high volatility regime', () => {
			// Create highly volatile candles with large alternating swings
			const candles: Candle[] = [];
			let price = 400;

			// Create stable baseline
			for (let i = 0; i < 30; i++) {
				candles.push({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: price,
					high: price * 1.005,
					low: price * 0.995,
					close: price,
					volume: 1000000,
				});
			}

			// Then create very volatile period
			for (let i = 0; i < 30; i++) {
				const change = (i % 2 === 0 ? 1 : -1) * 0.06; // ±6% alternating
				price = price * (1 + change);
				candles.push({
					timestamp: new Date(2024, 0, 31 + i).toISOString(),
					open: price,
					high: price * 1.02,
					low: price * 0.98,
					close: price,
					volume: 2000000,
				});
			}

			const result = detector.detect(candles, 28); // High VIX

			expect(result).not.toBeNull();
			expect(result?.regime).toBe('high_volatility');
			expect(result?.details.vixLevel).toBeGreaterThan(25);
		});

		it('should significantly reduce position size in high volatility', () => {
			const adjustments = detector.getAdjustments('high_volatility');

			expect(adjustments.positionSizeMultiplier).toBe(0.4);
			expect(adjustments.stopLossMultiplier).toBe(1.5); // Wider stops
			expect(adjustments.entryThresholdAdjustment).toBe(15);
			expect(adjustments.newEntriesAllowed).toBe(true);
		});

		it('should calculate high volatility percentile', () => {
			// Create actual volatile candles (not random)
			const candles: Candle[] = [];
			let price = 400;

			// Stable baseline
			for (let i = 0; i < 30; i++) {
				candles.push({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: price,
					high: price * 1.005,
					low: price * 0.995,
					close: price,
					volume: 1000000,
				});
			}

			// Volatile period
			for (let i = 0; i < 30; i++) {
				const change = (i % 2 === 0 ? 1 : -1) * 0.05; // ±5% swings
				price = price * (1 + change);
				candles.push({
					timestamp: new Date(2024, 0, 31 + i).toISOString(),
					open: price,
					high: price * 1.02,
					low: price * 0.98,
					close: price,
					volume: 2000000,
				});
			}

			const result = detector.detect(candles, 28);

			expect(result).not.toBeNull();
			expect(result?.details.volatilityPctile).toBeGreaterThanOrEqual(50);
		});
	});

	describe('Crash Detection', () => {
		it('should detect crash when SPY drops >7% in 5 days with high VIX', () => {
			const candles: Candle[] = [];
			let price = 400;

			// Create 55 normal days
			for (let i = 0; i < 55; i++) {
				candles.push({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: price,
					high: price * 1.01,
					low: price * 0.99,
					close: price,
					volume: 1000000,
				});
			}

			// Last 5 days: sharp drop
			for (let i = 0; i < 5; i++) {
				price = price * 0.985; // -1.5% daily = -7.3% total
				candles.push({
					timestamp: new Date(2024, 0, 56 + i).toISOString(),
					open: price,
					high: price * 1.005,
					low: price * 0.995,
					close: price,
					volume: 2000000,
				});
			}

			const result = detector.detect(candles, 35); // VIX > 30

			expect(result).not.toBeNull();
			expect(result?.regime).toBe('crash');
			expect(result?.confidence).toBeGreaterThan(0.9);
		});

		it('should not detect crash with moderate drop', () => {
			// Create candles with moderate downtrend (-0.5% daily = -3% total over 5 days)
			const candles: Candle[] = [];
			let price = 400;

			// Create 55 normal days
			for (let i = 0; i < 55; i++) {
				candles.push({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: price,
					high: price * 1.01,
					low: price * 0.99,
					close: price,
					volume: 1000000,
				});
			}

			// Last 5 days: moderate drop
			for (let i = 0; i < 5; i++) {
				price = price * 0.995; // -0.5% daily = -2.5% total
				candles.push({
					timestamp: new Date(2024, 0, 56 + i).toISOString(),
					open: price,
					high: price * 1.005,
					low: price * 0.995,
					close: price,
					volume: 1500000,
				});
			}

			const result = detector.detect(candles, 35); // High VIX but not crash

			expect(result).not.toBeNull();
			expect(result?.regime).not.toBe('crash');
		});

		it('should not detect crash with sharp drop but low VIX', () => {
			const candles: Candle[] = [];
			let price = 400;

			for (let i = 0; i < 55; i++) {
				candles.push({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: price,
					high: price * 1.01,
					low: price * 0.99,
					close: price,
					volume: 1000000,
				});
			}

			for (let i = 0; i < 5; i++) {
				price = price * 0.985;
				candles.push({
					timestamp: new Date(2024, 0, 56 + i).toISOString(),
					open: price,
					high: price * 1.005,
					low: price * 0.995,
					close: price,
					volume: 2000000,
				});
			}

			const result = detector.detect(candles, 18); // Low VIX

			expect(result).not.toBeNull();
			expect(result?.regime).not.toBe('crash');
		});

		it('should block all new entries in crash', () => {
			const adjustments = detector.getAdjustments('crash');

			expect(adjustments.positionSizeMultiplier).toBe(0.0);
			expect(adjustments.newEntriesAllowed).toBe(false);
			expect(adjustments.entryThresholdAdjustment).toBe(100);
		});
	});

	describe('VIX Level Handling', () => {
		it('should use provided VIX level', () => {
			const candles = createCandles(60, 400, 'up');
			const result = detector.detect(candles, 22);

			expect(result).not.toBeNull();
			expect(result?.details.vixLevel).toBe(22);
		});

		it('should use default VIX when not provided', () => {
			const candles = createCandles(60, 400, 'up');
			const result = detector.detect(candles);

			expect(result).not.toBeNull();
			expect(result?.details.vixLevel).toBe(15); // Default neutral VIX
		});

		it('should classify high VIX correctly based on threshold', () => {
			const candles = createCandles(60, 400, 'flat');

			const lowVixResult = detector.detect(candles, 20);
			const highVixResult = detector.detect(candles, 30);

			expect(lowVixResult?.regime).not.toBe('high_volatility');
			expect(highVixResult?.details.vixLevel).toBeGreaterThan(25);
		});
	});

	describe('Confidence Calculation', () => {
		it('should have highest confidence for crash', () => {
			const candles: Candle[] = [];
			let price = 400;

			for (let i = 0; i < 55; i++) {
				candles.push({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: price,
					high: price * 1.01,
					low: price * 0.99,
					close: price,
					volume: 1000000,
				});
			}

			for (let i = 0; i < 5; i++) {
				price = price * 0.985;
				candles.push({
					timestamp: new Date(2024, 0, 56 + i).toISOString(),
					open: price,
					high: price * 1.005,
					low: price * 0.995,
					close: price,
					volume: 2000000,
				});
			}

			const result = detector.detect(candles, 35);

			expect(result).not.toBeNull();
			expect(result?.confidence).toBeGreaterThanOrEqual(0.95);
		});

		it('should have reasonable confidence for clear trends', () => {
			const candles = createCandles(60, 400, 'up');
			const result = detector.detect(candles, 15);

			expect(result).not.toBeNull();
			expect(result?.confidence).toBeGreaterThan(0.6);
			expect(result?.confidence).toBeLessThanOrEqual(1.0);
		});

		it('should have lower confidence for volatile trends', () => {
			const candles = createCandles(60, 400, 'volatile');
			const result = detector.detect(candles, 15);

			expect(result).not.toBeNull();
			expect(result?.confidence).toBeGreaterThan(0.5);
		});
	});

	describe('Breadth Score', () => {
		it('should calculate breadth score', () => {
			const candles = createCandles(60, 400, 'up');
			const result = detector.detect(candles, 15);

			expect(result).not.toBeNull();
			expect(result?.details.breadthScore).toBeGreaterThanOrEqual(0);
			expect(result?.details.breadthScore).toBeLessThanOrEqual(100);
		});

		it('should have higher breadth in stable uptrend', () => {
			// Breadth score is inversely related to volatility (100 - volatilityPctile)
			// So stable markets have higher breadth, volatile markets have lower breadth

			// Create very stable candles (almost no movement)
			const stableCandles: Candle[] = [];
			let price = 400;
			for (let i = 0; i < 60; i++) {
				const change = (i % 2 === 0 ? 1 : -1) * 0.0005; // ±0.05% alternating
				price = price * (1 + change);
				stableCandles.push({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: price,
					high: price * 1.0001,
					low: price * 0.9999,
					close: price,
					volume: 1000000,
				});
			}

			// Create volatile candles
			const volatileCandles: Candle[] = [];
			price = 400;
			for (let i = 0; i < 60; i++) {
				const change = (i % 2 === 0 ? 1 : -1) * 0.05; // ±5% alternating
				price = price * (1 + change);
				volatileCandles.push({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: price,
					high: price * 1.02,
					low: price * 0.98,
					close: price,
					volume: 1000000,
				});
			}

			const stableResult = detector.detect(stableCandles, 15);
			const volatileResult = detector.detect(volatileCandles, 28);

			// Stable market should have higher breadth score than volatile market
			expect(stableResult?.details.breadthScore).toBeGreaterThan(
				volatileResult?.details.breadthScore ?? 0,
			);
		});
	});

	describe('Volatility Percentile', () => {
		it('should calculate volatility percentile between 0-100', () => {
			const candles = createCandles(60, 400, 'up');
			const result = detector.detect(candles, 15);

			expect(result).not.toBeNull();
			expect(result?.details.volatilityPctile).toBeGreaterThanOrEqual(0);
			expect(result?.details.volatilityPctile).toBeLessThanOrEqual(100);
		});

		it('should show higher percentile for volatile markets', () => {
			// Create highly volatile candles with large swings
			const volatileCandles: Candle[] = [];
			let price = 400;
			for (let i = 0; i < 60; i++) {
				const change = (i % 2 === 0 ? 1 : -1) * 0.05; // ±5% alternating
				price = price * (1 + change);
				volatileCandles.push({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: price,
					high: price * 1.01,
					low: price * 0.99,
					close: price,
					volume: 1000000,
				});
			}

			// Create very stable candles
			const stableCandles: Candle[] = [];
			price = 400;
			for (let i = 0; i < 60; i++) {
				const change = (i % 2 === 0 ? 1 : -1) * 0.001; // ±0.1% alternating
				price = price * (1 + change);
				stableCandles.push({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: price,
					high: price * 1.001,
					low: price * 0.999,
					close: price,
					volume: 1000000,
				});
			}

			const stableResult = detector.detect(stableCandles, 15);
			const volatileResult = detector.detect(volatileCandles, 15);

			expect(volatileResult?.details.volatilityPctile).toBeGreaterThan(
				stableResult?.details.volatilityPctile ?? 0,
			);
		});

		it('should return neutral percentile with insufficient data', async () => {
			// Create candles with less than volatilityWindow + 1 data points
			const candles = createCandles(15, 400, 'up');

			// Override config to use smaller lookback for this test
			const { configManager } = await import('../../src/config/manager.js');
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				const overrides: Record<string, unknown> = {
					'regime.enabled': true,
					'regime.lookbackDays': 10,
					'regime.vixThresholdHigh': 25,
					'regime.trendMaLength': 10,
					'regime.volatilityWindow': 20,
				};
				return overrides[key];
			});

			const result = detector.detect(candles, 15);

			expect(result).not.toBeNull();
			expect(result?.details.volatilityPctile).toBe(50);
		});
	});

	describe('Regime Labels', () => {
		it('should return correct label for trending_up', () => {
			const label = detector.getRegimeLabel('trending_up');
			expect(label).toBe('Trending Up - Bull Market');
		});

		it('should return correct label for trending_down', () => {
			const label = detector.getRegimeLabel('trending_down');
			expect(label).toBe('Trending Down - Bear Market');
		});

		it('should return correct label for range_bound', () => {
			const label = detector.getRegimeLabel('range_bound');
			expect(label).toBe('Range-Bound - Sideways Market');
		});

		it('should return correct label for high_volatility', () => {
			const label = detector.getRegimeLabel('high_volatility');
			expect(label).toBe('High Volatility - Choppy Market');
		});

		it('should return correct label for crash', () => {
			const label = detector.getRegimeLabel('crash');
			expect(label).toBe('Market Crash - Risk-Off Mode');
		});
	});

	describe('Edge Cases', () => {
		it('should handle empty candle array', () => {
			const result = detector.detect([]);
			expect(result).toBeNull();
		});

		it('should handle single candle', () => {
			const candles = createCandles(1, 400, 'up');
			const result = detector.detect(candles);
			expect(result).toBeNull();
		});

		it('should handle negative VIX (invalid but defensive)', () => {
			const candles = createCandles(60, 400, 'up');
			const result = detector.detect(candles, -5);

			expect(result).not.toBeNull();
			expect(result?.details.vixLevel).toBe(-5);
		});

		it('should handle extremely high VIX', () => {
			const candles = createCandles(60, 400, 'volatile');
			const result = detector.detect(candles, 80);

			expect(result).not.toBeNull();
			expect(result?.details.vixLevel).toBe(80);
		});

		it('should handle flat market at trend boundary', () => {
			// Create market exactly at MA level
			const candles: Candle[] = [];
			const price = 400;

			for (let i = 0; i < 60; i++) {
				candles.push({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: price,
					high: price * 1.001,
					low: price * 0.999,
					close: price,
					volume: 1000000,
				});
			}

			const result = detector.detect(candles, 15);

			expect(result).not.toBeNull();
			expect(result?.details.spyTrend).toBe('flat');
		});

		it('should handle price exactly at 2% threshold', () => {
			const candles: Candle[] = [];

			// Create 50 candles at one price
			for (let i = 0; i < 50; i++) {
				candles.push({
					timestamp: new Date(2024, 0, i + 1).toISOString(),
					open: 100,
					high: 101,
					low: 99,
					close: 100,
					volume: 1000000,
				});
			}

			// Last 10 candles exactly 2% higher
			for (let i = 0; i < 10; i++) {
				candles.push({
					timestamp: new Date(2024, 0, 51 + i).toISOString(),
					open: 102,
					high: 103,
					low: 101,
					close: 102,
					volume: 1000000,
				});
			}

			const result = detector.detect(candles, 15);

			expect(result).not.toBeNull();
			expect(result?.details.spyTrend).toBe('flat');
		});
	});

	describe('Regime Adjustments Consistency', () => {
		it('should have valid multipliers for all regimes', () => {
			const regimes: MarketRegime[] = [
				'trending_up',
				'trending_down',
				'range_bound',
				'high_volatility',
				'crash',
			];

			for (const regime of regimes) {
				const adj = detector.getAdjustments(regime);

				expect(adj.positionSizeMultiplier).toBeGreaterThanOrEqual(0);
				expect(adj.positionSizeMultiplier).toBeLessThanOrEqual(1.5);
				expect(adj.stopLossMultiplier).toBeGreaterThanOrEqual(0);
				expect(adj.stopLossMultiplier).toBeLessThanOrEqual(2);
				expect(adj.entryThresholdAdjustment).toBeGreaterThanOrEqual(0);
				expect(typeof adj.newEntriesAllowed).toBe('boolean');
			}
		});

		it('should only block entries in crash regime', () => {
			const regimes: MarketRegime[] = [
				'trending_up',
				'trending_down',
				'range_bound',
				'high_volatility',
			];

			for (const regime of regimes) {
				const adj = detector.getAdjustments(regime);
				expect(adj.newEntriesAllowed).toBe(true);
			}

			const crashAdj = detector.getAdjustments('crash');
			expect(crashAdj.newEntriesAllowed).toBe(false);
		});

		it('should have most conservative adjustments for crash', () => {
			const crashAdj = detector.getAdjustments('crash');
			const otherRegimes: MarketRegime[] = [
				'trending_up',
				'trending_down',
				'range_bound',
				'high_volatility',
			];

			for (const regime of otherRegimes) {
				const adj = detector.getAdjustments(regime);
				expect(crashAdj.positionSizeMultiplier).toBeLessThanOrEqual(
					adj.positionSizeMultiplier,
				);
				expect(crashAdj.entryThresholdAdjustment).toBeGreaterThanOrEqual(
					adj.entryThresholdAdjustment,
				);
			}
		});
	});
});
