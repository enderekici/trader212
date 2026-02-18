import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	type CalibrationBucket,
	type ModelComparison,
	type PerformanceFeedback,
	getAISelfImprovement,
} from '../../src/ai/self-improvement.js';

// Mock dependencies
vi.mock('../../src/config/manager.js', () => ({
	configManager: {
		get: vi.fn(),
	},
}));

vi.mock('../../src/db/index.js', () => ({
	getDb: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
	createLogger: vi.fn(() => ({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	})),
}));

const { configManager } = await import('../../src/config/manager.js');
const { getDb } = await import('../../src/db/index.js');

describe('AISelfImprovement', () => {
	let mockDb: any;

	beforeEach(() => {
		vi.clearAllMocks();

		// Default config
		vi.mocked(configManager.get).mockImplementation((key: string) => {
			if (key === 'aiSelfImprovement.enabled') return true;
			if (key === 'aiSelfImprovement.feedbackWindow') return 30;
			if (key === 'aiSelfImprovement.minSamples') return 10;
			return undefined;
		});

		// Mock drizzle chain
		mockDb = {
			select: vi.fn().mockReturnThis(),
			from: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			all: vi.fn().mockReturnValue([]),
			get: vi.fn().mockReturnValue(null),
		};

		vi.mocked(getDb).mockReturnValue(mockDb);
	});

	describe('generateFeedback', () => {
		it('should return null when disabled', async () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'aiSelfImprovement.enabled') return false;
				return undefined;
			});

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.generateFeedback();

			expect(result).toBeNull();
		});

		it('should return null when insufficient samples', async () => {
			mockDb.all.mockReturnValue([
				{
					id: 1,
					aiModel: 'claude-opus-4',
					symbol: 'AAPL',
					decision: 'BUY',
					conviction: 75,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					actualOutcome: 'correct',
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				},
			]);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.generateFeedback();

			expect(result).toBeNull();
		});

		it('should generate feedback with sufficient data', async () => {
			const predictions = Array.from({ length: 20 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: i % 3 === 0 ? 'BUY' : i % 3 === 1 ? 'SELL' : 'HOLD',
				conviction: 60 + i,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				actualOutcome: i % 2 === 0 ? 'correct' : 'incorrect',
				actualReturnPct: i % 2 === 0 ? 5 : -3,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.generateFeedback();

			expect(result).toBeDefined();
			expect(result?.overallAccuracy).toBe(0.5);
			expect(result?.sampleSize).toBe(20);
			expect(result?.periodDays).toBe(30);
			expect(result?.suggestions).toBeDefined();
			expect(result?.biases).toBeDefined();
		});

		it('should calculate accuracy by decision type', async () => {
			const predictions = [
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 1,
					aiModel: 'claude-opus-4',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					actualOutcome: i < 8 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: i < 8 ? 5 : -3,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 11,
					aiModel: 'claude-opus-4',
					symbol: 'MSFT',
					decision: 'SELL' as const,
					conviction: 65,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 200,
					actualOutcome: i < 5 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: i < 5 ? 3 : -2,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.generateFeedback();

			expect(result?.buyAccuracy).toBe(0.8);
			expect(result?.sellAccuracy).toBe(0.5);
		});

		it('should populate bestPerformingSetups for high-conviction SELL with accuracy >= 0.75', async () => {
			// 4 high-conviction SELL predictions all correct → accuracy = 1.0 >= 0.75
			const predictions = Array.from({ length: 10 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: (i < 4 ? 'SELL' : 'BUY') as 'SELL' | 'BUY',
				conviction: i < 4 ? 85 : 60,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				actualOutcome: 'correct' as const,
				actualReturnPct: 3,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.generateFeedback();

			expect(result?.bestPerformingSetups.some((s) => s.includes('High-conviction SELL'))).toBe(true);
		});

		it('should populate worstPerformingSetups for high-conviction SELL with accuracy < 0.5', async () => {
			// 4 high-conviction SELL predictions — 1 correct, 3 incorrect → accuracy = 0.25 < 0.5
			const predictions = Array.from({ length: 10 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: (i < 4 ? 'SELL' : 'BUY') as 'SELL' | 'BUY',
				conviction: i < 4 ? 85 : 60,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				actualOutcome: (i === 0 ? 'correct' : 'incorrect') as 'correct' | 'incorrect',
				actualReturnPct: i === 0 ? 3 : -2,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.generateFeedback();

			expect(result?.worstPerformingSetups.some((s) => s.includes('High-conviction SELL'))).toBe(true);
		});

		it('should populate worstPerformingSetups for high-conviction BUY with accuracy < 0.5', async () => {
			// 4 high-conviction BUY predictions — 1 correct, 3 incorrect → accuracy = 0.25 < 0.5
			const predictions = Array.from({ length: 10 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 85,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				actualOutcome: (i === 0 ? 'correct' : 'incorrect') as 'correct' | 'incorrect',
				actualReturnPct: i === 0 ? 5 : -3,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.generateFeedback();

			expect(result?.worstPerformingSetups.some((s) => s.includes('High-conviction BUY'))).toBe(true);
		});

		it('should call getMostCommonDecision for big winners path', async () => {
			// Need >= minSamples (10) predictions total, >= 5 with actualReturnPct correct
			// Use 8 BUY with return=1 and 2 SELL with return=10
			// avg = (8×1 + 2×10)/10 = 2.8; bigWinners = returns > 5.6 → both SELL predictions ✓
			const predictions = [
				...Array.from({ length: 8 }, (_, i) => ({
					id: i + 1,
					aiModel: 'model-a',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 60,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 100,
					actualOutcome: 'correct' as const,
					actualReturnPct: 1,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 2 }, (_, i) => ({
					id: i + 9,
					aiModel: 'model-a',
					symbol: 'MSFT',
					decision: 'SELL' as const,
					conviction: 60,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 200,
					actualOutcome: 'correct' as const,
					actualReturnPct: 10,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.generateFeedback();

			// getMostCommonDecision called; most common among bigWinners is SELL (both have SELL)
			expect(result?.bestPerformingSetups.some((s) => s.includes('SELL signals with strong returns'))).toBe(true);
		});

		it('should calculate conviction correlation', async () => {
			const predictions = [
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 1,
					aiModel: 'claude-opus-4',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 85,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					actualOutcome: 'correct' as const,
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 11,
					aiModel: 'claude-opus-4',
					symbol: 'MSFT',
					decision: 'SELL' as const,
					conviction: 45,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 200,
					actualOutcome: 'incorrect' as const,
					actualReturnPct: -3,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.generateFeedback();

			expect(result?.avgConvictionCorrect).toBe(85);
			expect(result?.avgConvictionIncorrect).toBe(45);
		});

		it('should filter by AI model when specified', async () => {
			const predictions = Array.from({ length: 15 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 70,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				actualOutcome: 'correct' as const,
				actualReturnPct: 5,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			await selfImprovement.generateFeedback('claude-opus-4');

			expect(mockDb.where).toHaveBeenCalled();
		});

		it('should handle zero accuracy for decision types', async () => {
			const predictions = Array.from({ length: 10 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 70,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				actualOutcome: 'correct' as const,
				actualReturnPct: 5,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.generateFeedback();

			expect(result?.sellAccuracy).toBe(0);
			expect(result?.holdAccuracy).toBe(0);
		});
	});

	describe('detectBiases', () => {
		const selfImprovement = getAISelfImprovement();

		it('should return empty array for no predictions', () => {
			const biases = selfImprovement.detectBiases([]);
			expect(biases).toEqual([]);
		});

		it('should detect overconfidence bias', () => {
			const predictions = Array.from({ length: 10 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 85,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: i < 5 ? ('correct' as const) : ('incorrect' as const),
				actualReturnPct: i < 5 ? 5 : -3,
				evaluatedAt: new Date().toISOString(),
			}));

			const biases = selfImprovement.detectBiases(predictions);

			expect(biases.some((b) => b.includes('Overconfidence'))).toBe(true);
		});

		it('should detect BUY direction bias', () => {
			const predictions = Array.from({ length: 20 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: i < 15 ? ('BUY' as const) : ('SELL' as const),
				conviction: 70,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: 'correct' as const,
				actualReturnPct: 5,
				evaluatedAt: new Date().toISOString(),
			}));

			const biases = selfImprovement.detectBiases(predictions);

			expect(
				biases.some((b) => b.includes('Direction bias: Favoring BUY')),
			).toBe(true);
		});

		it('should detect SELL direction bias', () => {
			const predictions = Array.from({ length: 20 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: i < 15 ? ('SELL' as const) : ('BUY' as const),
				conviction: 70,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: 'correct' as const,
				actualReturnPct: 5,
				evaluatedAt: new Date().toISOString(),
			}));

			const biases = selfImprovement.detectBiases(predictions);

			expect(
				biases.some((b) => b.includes('Direction bias: Favoring SELL')),
			).toBe(true);
		});

		it('should detect HOLD direction bias', () => {
			const predictions = Array.from({ length: 20 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: i < 15 ? ('HOLD' as const) : ('BUY' as const),
				conviction: 70,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: 'correct' as const,
				actualReturnPct: 5,
				evaluatedAt: new Date().toISOString(),
			}));

			const biases = selfImprovement.detectBiases(predictions);

			expect(
				biases.some((b) => b.includes('Direction bias: Favoring HOLD')),
			).toBe(true);
		});

		it('should detect poor conviction calibration', () => {
			const predictions = [
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 1,
					aiModel: 'claude-opus-4',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 30,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 5 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 11,
					aiModel: 'claude-opus-4',
					symbol: 'MSFT',
					decision: 'SELL' as const,
					conviction: 85,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 200,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 5 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: -3,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			const biases = selfImprovement.detectBiases(predictions);

			expect(
				biases.some((b) => b.includes('Conviction calibration')),
			).toBe(true);
		});

		it('should ignore symbols with fewer than 3 predictions in symbol-bias check (line 234 false branch)', () => {
			// AAPL has 2 predictions (< 3, filtered out), MSFT and GOOGL and TSLA have 5 each
			// With only 3 symbols contributing (< 3 required for symbolAccuracies.length >= 3), no bias triggered
			const predictions = [
				// AAPL: 2 predictions (too few — filtered out at line 234)
				...Array.from({ length: 2 }, (_, i) => ({
					id: i + 1,
					aiModel: 'claude-opus-4',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: 'correct' as const,
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
				// MSFT: 5 predictions (>= 3, included)
				...Array.from({ length: 5 }, (_, i) => ({
					id: i + 3,
					aiModel: 'claude-opus-4',
					symbol: 'MSFT',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 200,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: 'correct' as const,
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
				// GOOGL: 5 predictions (>= 3, included)
				...Array.from({ length: 5 }, (_, i) => ({
					id: i + 8,
					aiModel: 'claude-opus-4',
					symbol: 'GOOGL',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 100,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: 'correct' as const,
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
				// TSLA: 5 predictions (>= 3, included)
				...Array.from({ length: 5 }, (_, i) => ({
					id: i + 13,
					aiModel: 'claude-opus-4',
					symbol: 'TSLA',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 180,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: 'correct' as const,
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			const biases = selfImprovement.detectBiases(predictions);

			// AAPL filtered out (line 234 false branch hit), no stock-specific weakness detected
			expect(biases.some((b) => b.includes('Stock-specific weakness'))).toBe(false);
		});

		it('should detect stock-specific weakness', () => {
			const predictions = [
				...Array.from({ length: 5 }, (_, i) => ({
					id: i + 1,
					aiModel: 'claude-opus-4',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: 'incorrect' as const,
					actualReturnPct: -5,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 5 }, (_, i) => ({
					id: i + 6,
					aiModel: 'claude-opus-4',
					symbol: 'MSFT',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 200,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: 'correct' as const,
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 5 }, (_, i) => ({
					id: i + 11,
					aiModel: 'claude-opus-4',
					symbol: 'GOOGL',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 100,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: 'correct' as const,
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 5 }, (_, i) => ({
					id: i + 16,
					aiModel: 'claude-opus-4',
					symbol: 'TSLA',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 180,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: 'correct' as const,
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			const biases = selfImprovement.detectBiases(predictions);

			expect(
				biases.some((b) => b.includes('Stock-specific weakness')),
			).toBe(true);
		});

		it('should detect recent underperformance timing bias', () => {
			const predictions = [
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 1,
					aiModel: 'claude-opus-4',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date(Date.now() - i * 86400000).toISOString(),
					priceAtSignal: 150,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 2 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: i < 2 ? 5 : -3,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 11,
					aiModel: 'claude-opus-4',
					symbol: 'MSFT',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date(Date.now() - (i + 10) * 86400000).toISOString(),
					priceAtSignal: 200,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: 'correct' as const,
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			const biases = selfImprovement.detectBiases(predictions);

			expect(biases.some((b) => b.includes('Timing bias'))).toBe(true);
			expect(
				biases.some((b) => b.includes('Recent predictions') && b.includes('underperforming')),
			).toBe(true);
		});

		it('should detect recent improvement timing bias', () => {
			const predictions = [
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 1,
					aiModel: 'claude-opus-4',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date(Date.now() - i * 86400000).toISOString(),
					priceAtSignal: 150,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: 'correct' as const,
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 11,
					aiModel: 'claude-opus-4',
					symbol: 'MSFT',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date(Date.now() - (i + 10) * 86400000).toISOString(),
					priceAtSignal: 200,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 2 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: i < 2 ? 5 : -3,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			const biases = selfImprovement.detectBiases(predictions);

			expect(biases.some((b) => b.includes('Timing bias'))).toBe(true);
			expect(
				biases.some((b) => b.includes('Recent predictions') && b.includes('improving')),
			).toBe(true);
		});
	});

	describe('generateSuggestions', () => {
		const selfImprovement = getAISelfImprovement();

		it('should suggest caution for low overall accuracy', () => {
			const feedback: PerformanceFeedback = {
				overallAccuracy: 0.45,
				buyAccuracy: 0.5,
				sellAccuracy: 0.4,
				holdAccuracy: 0.45,
				avgConvictionCorrect: 75,
				avgConvictionIncorrect: 70,
				bestPerformingSetups: [],
				worstPerformingSetups: [],
				biases: [],
				suggestions: [],
				sampleSize: 20,
				periodDays: 30,
			};

			const suggestions = selfImprovement.generateSuggestions(feedback);

			expect(
				suggestions.some((s) => s.includes('below 55%')),
			).toBe(true);
		});

		it('should encourage continuation for high accuracy', () => {
			const feedback: PerformanceFeedback = {
				overallAccuracy: 0.75,
				buyAccuracy: 0.8,
				sellAccuracy: 0.7,
				holdAccuracy: 0.75,
				avgConvictionCorrect: 80,
				avgConvictionIncorrect: 60,
				bestPerformingSetups: [],
				worstPerformingSetups: [],
				biases: [],
				suggestions: [],
				sampleSize: 20,
				periodDays: 30,
			};

			const suggestions = selfImprovement.generateSuggestions(feedback);

			expect(
				suggestions.some((s) => s.includes('Strong overall performance')),
			).toBe(true);
		});

		it('should suggest caution for low BUY accuracy', () => {
			const feedback: PerformanceFeedback = {
				overallAccuracy: 0.6,
				buyAccuracy: 0.4,
				sellAccuracy: 0.7,
				holdAccuracy: 0.65,
				avgConvictionCorrect: 75,
				avgConvictionIncorrect: 70,
				bestPerformingSetups: [],
				worstPerformingSetups: [],
				biases: [],
				suggestions: [],
				sampleSize: 20,
				periodDays: 30,
			};

			const suggestions = selfImprovement.generateSuggestions(feedback);

			expect(
				suggestions.some((s) => s.includes('BUY accuracy') && s.includes('conservative')),
			).toBe(true);
		});

		it('should suggest caution for low SELL accuracy', () => {
			const feedback: PerformanceFeedback = {
				overallAccuracy: 0.6,
				buyAccuracy: 0.7,
				sellAccuracy: 0.35,
				holdAccuracy: 0.65,
				avgConvictionCorrect: 75,
				avgConvictionIncorrect: 70,
				bestPerformingSetups: [],
				worstPerformingSetups: [],
				biases: [],
				suggestions: [],
				sampleSize: 20,
				periodDays: 30,
			};

			const suggestions = selfImprovement.generateSuggestions(feedback);

			expect(
				suggestions.some((s) => s.includes('SELL accuracy') && s.includes('conservative')),
			).toBe(true);
		});

		it('should highlight best decision type', () => {
			const feedback: PerformanceFeedback = {
				overallAccuracy: 0.6,
				buyAccuracy: 0.85,
				sellAccuracy: 0.5,
				holdAccuracy: 0.55,
				avgConvictionCorrect: 75,
				avgConvictionIncorrect: 70,
				bestPerformingSetups: [],
				worstPerformingSetups: [],
				biases: [],
				suggestions: [],
				sampleSize: 20,
				periodDays: 30,
			};

			const suggestions = selfImprovement.generateSuggestions(feedback);

			expect(
				suggestions.some((s) => s.includes('BUY signals are most accurate')),
			).toBe(true);
		});

		it('should flag poor conviction calibration', () => {
			const feedback: PerformanceFeedback = {
				overallAccuracy: 0.6,
				buyAccuracy: 0.6,
				sellAccuracy: 0.6,
				holdAccuracy: 0.6,
				avgConvictionCorrect: 72,
				avgConvictionIncorrect: 70,
				bestPerformingSetups: [],
				worstPerformingSetups: [],
				biases: [],
				suggestions: [],
				sampleSize: 20,
				periodDays: 30,
			};

			const suggestions = selfImprovement.generateSuggestions(feedback);

			expect(
				suggestions.some((s) => s.includes('poorly calibrated')),
			).toBe(true);
		});

		it('should acknowledge good conviction calibration', () => {
			const feedback: PerformanceFeedback = {
				overallAccuracy: 0.6,
				buyAccuracy: 0.6,
				sellAccuracy: 0.6,
				holdAccuracy: 0.6,
				avgConvictionCorrect: 85,
				avgConvictionIncorrect: 55,
				bestPerformingSetups: [],
				worstPerformingSetups: [],
				biases: [],
				suggestions: [],
				sampleSize: 20,
				periodDays: 30,
			};

			const suggestions = selfImprovement.generateSuggestions(feedback);

			expect(
				suggestions.some((s) => s.includes('Well-calibrated')),
			).toBe(true);
		});

		it('should generate bias-based suggestions', () => {
			const feedback: PerformanceFeedback = {
				overallAccuracy: 0.6,
				buyAccuracy: 0.6,
				sellAccuracy: 0.6,
				holdAccuracy: 0.6,
				avgConvictionCorrect: 75,
				avgConvictionIncorrect: 70,
				bestPerformingSetups: [],
				worstPerformingSetups: [],
				biases: ['Overconfidence: High conviction predictions have 55% accuracy'],
				suggestions: [],
				sampleSize: 20,
				periodDays: 30,
			};

			const suggestions = selfImprovement.generateSuggestions(feedback);

			expect(
				suggestions.some((s) => s.includes('Reduce conviction')),
			).toBe(true);
		});

		it('should generate SELL direction bias suggestion', () => {
			const feedback: PerformanceFeedback = {
				overallAccuracy: 0.6,
				buyAccuracy: 0.6,
				sellAccuracy: 0.6,
				holdAccuracy: 0.6,
				avgConvictionCorrect: 75,
				avgConvictionIncorrect: 70,
				bestPerformingSetups: [],
				worstPerformingSetups: [],
				biases: ['Direction bias: Favoring SELL (75% of predictions)'],
				suggestions: [],
				sampleSize: 20,
				periodDays: 30,
			};

			const suggestions = selfImprovement.generateSuggestions(feedback);

			expect(
				suggestions.some((s) => s.includes('too bearish') || s.includes('SELL signals')),
			).toBe(true);
		});

		it('should suggest avoiding worst setups', () => {
			const feedback: PerformanceFeedback = {
				overallAccuracy: 0.6,
				buyAccuracy: 0.6,
				sellAccuracy: 0.6,
				holdAccuracy: 0.6,
				avgConvictionCorrect: 75,
				avgConvictionIncorrect: 70,
				bestPerformingSetups: [],
				worstPerformingSetups: ['High-conviction SELL signals (30% accurate)'],
				biases: [],
				suggestions: [],
				sampleSize: 20,
				periodDays: 30,
			};

			const suggestions = selfImprovement.generateSuggestions(feedback);

			expect(
				suggestions.some((s) => s.includes('Avoid or reduce exposure to')),
			).toBe(true);
		});

		it('should suggest doubling down on best setups', () => {
			const feedback: PerformanceFeedback = {
				overallAccuracy: 0.6,
				buyAccuracy: 0.6,
				sellAccuracy: 0.6,
				holdAccuracy: 0.6,
				avgConvictionCorrect: 75,
				avgConvictionIncorrect: 70,
				bestPerformingSetups: ['High-conviction BUY signals (85% accurate)'],
				worstPerformingSetups: [],
				biases: [],
				suggestions: [],
				sampleSize: 20,
				periodDays: 30,
			};

			const suggestions = selfImprovement.generateSuggestions(feedback);

			expect(
				suggestions.some((s) => s.includes('Double down on')),
			).toBe(true);
		});
	});

	describe('buildFeedbackPromptSection', () => {
		it('should return empty string when disabled', async () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'aiSelfImprovement.enabled') return false;
				return undefined;
			});

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.buildFeedbackPromptSection();

			expect(result).toBe('');
		});

		it('should return empty string when insufficient data', async () => {
			mockDb.all.mockReturnValue([]);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.buildFeedbackPromptSection();

			expect(result).toBe('');
		});

		it('should build formatted prompt section with sufficient data', async () => {
			const predictions = Array.from({ length: 20 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 75,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: i < 12 ? ('correct' as const) : ('incorrect' as const),
				actualReturnPct: i < 12 ? 5 : -3,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.buildFeedbackPromptSection();

			expect(result).toContain('## Your Recent Performance');
			expect(result).toContain('Overall accuracy: 60%');
			expect(result).toContain('last 30 days');
			expect(result).toContain('20 predictions');
		});

		it('should include best setup line when bestPerformingSetups is non-empty', async () => {
			// Use high-conviction BUY predictions with >= 75% accuracy to populate bestPerformingSetups
			const predictions = Array.from({ length: 20 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 85, // >= 80 for high-conviction
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: i < 16 ? ('correct' as const) : ('incorrect' as const), // 80% accuracy >= 75%
				actualReturnPct: i < 16 ? 5 : -3,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.buildFeedbackPromptSection();

			expect(result).toContain('- Best setup:');
			expect(result).toContain('High-conviction BUY signals');
		});

		it('should include suggestion line when accuracy < 0.55 (line 453)', async () => {
			// 10/20 = 50% accuracy → below 0.55 → generateSuggestions returns non-empty array
			const predictions = Array.from({ length: 20 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 70,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: i < 10 ? ('correct' as const) : ('incorrect' as const), // 50% accuracy
				actualReturnPct: i < 10 ? 3 : -2,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.buildFeedbackPromptSection();

			expect(result).toContain('- Suggestion:');
		});

		it('should skip avgConvictionCorrect line when all predictions are incorrect (line 443 false branch)', async () => {
			// All predictions incorrect → correct.length = 0 → avgConvictionCorrect = 0 → line 443 false branch
			const predictions = Array.from({ length: 20 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 75,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: 'incorrect' as const,
				actualReturnPct: -3,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.buildFeedbackPromptSection();

			expect(result).toContain('## Your Recent Performance');
			expect(result).not.toContain('high-conviction');
		});
		it('should skip biases line when biases array is empty (line 449 false branch)', async () => {
			// Design: mixed BUY/SELL/HOLD decisions (4 each = 33%, no direction bias),
			// low conviction (60, no overconfidence check), single symbol (no sector bias),
			// 12 total → recentPreds = 4 < 5 (timing bias check skipped).
			// Result: biases = [] → line 449 FALSE branch fires.
			const decisions = ['BUY', 'SELL', 'HOLD', 'BUY', 'SELL', 'HOLD', 'BUY', 'SELL', 'HOLD', 'BUY', 'SELL', 'HOLD'] as const;
			const predictions = decisions.map((decision, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision,
				conviction: 60,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: i % 2 === 0 ? ('correct' as const) : ('incorrect' as const),
				actualReturnPct: i % 2 === 0 ? 2 : -1,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.buildFeedbackPromptSection();

			// Should still return a prompt section with accuracy info
			expect(result).toContain('## Your Recent Performance');
			// But no bias line since biases array is empty
			expect(result).not.toContain('Detected biases');
		});
	});

	describe('compareModels', () => {
		it('should return disabled message when disabled', async () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'aiSelfImprovement.enabled') return false;
				return undefined;
			});

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.compareModels();

			expect(result.models).toEqual([]);
			expect(result.recommendation).toContain('disabled');
		});

		it('should return insufficient data message with no predictions', async () => {
			mockDb.all.mockReturnValue([]);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.compareModels();

			expect(result.models).toEqual([]);
			expect(result.recommendation).toContain('Insufficient data');
		});

		it('should compare multiple models', async () => {
			const predictions = [
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 1,
					aiModel: 'claude-opus-4',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 8 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: i < 8 ? 5 : -3,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 11,
					aiModel: 'gpt-4',
					symbol: 'MSFT',
					decision: 'SELL' as const,
					conviction: 65,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 200,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 5 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: i < 5 ? 3 : -2,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.compareModels();

			expect(result.models).toHaveLength(2);
			expect(result.models[0].model).toBe('claude-opus-4');
			expect(result.models[0].accuracy).toBe(0.8);
			expect(result.models[1].model).toBe('gpt-4');
			expect(result.models[1].accuracy).toBe(0.5);
			expect(result.recommendation).toContain('claude-opus-4');
		});

		it('should recommend significantly better model', async () => {
			const predictions = [
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 1,
					aiModel: 'model-a',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 9 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 11,
					aiModel: 'model-b',
					symbol: 'MSFT',
					decision: 'SELL' as const,
					conviction: 65,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 200,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 6 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: 3,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.compareModels();

			expect(result.recommendation).toContain('significantly outperforms');
		});

		it('should handle single model', async () => {
			const predictions = Array.from({ length: 10 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 70,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: 'correct' as const,
				actualReturnPct: 5,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.compareModels();

			expect(result.models).toHaveLength(1);
			expect(result.recommendation).toContain('Only one model');
		});

		it('should identify best decision type per model', async () => {
			const predictions = [
				...Array.from({ length: 5 }, (_, i) => ({
					id: i + 1,
					aiModel: 'model-a',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: 'correct' as const,
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 5 }, (_, i) => ({
					id: i + 6,
					aiModel: 'model-a',
					symbol: 'MSFT',
					decision: 'SELL' as const,
					conviction: 65,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 200,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 2 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: 3,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.compareModels();

			expect(result.models[0].bestDecision).toBe('BUY');
		});

		it('should compute HOLD accuracy per model in compareModels', async () => {
			const predictions = [
				...Array.from({ length: 5 }, (_, i) => ({
					id: i + 1,
					aiModel: 'model-h',
					symbol: 'AAPL',
					decision: 'HOLD' as const,
					conviction: 55,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 4 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: 1,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.compareModels();

			expect(result.models).toHaveLength(1);
			// holdAcc = 4/5 = 0.8, buyAcc = 0, sellAcc = 0 → bestDecision = HOLD
			expect(result.models[0].bestDecision).toBe('HOLD');
		});

		it('should generate "moderately outperforms" recommendation when diff is 0.05-0.1', async () => {
			// model-a: 13/17 ≈ 0.7647, model-b: 7/10 = 0.7 → diff ≈ 0.065 (clearly > 0.05 and < 0.1)
			// Avoids floating point edge case of 8/10 - 7/10 = 0.1000...009 which triggers "significantly"
			const predictions = [
				...Array.from({ length: 17 }, (_, i) => ({
					id: i + 1,
					aiModel: 'model-a',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 13 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 18,
					aiModel: 'model-b',
					symbol: 'MSFT',
					decision: 'SELL' as const,
					conviction: 60,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 200,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 7 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: 3,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.compareModels();

			// diff = 13/17 - 7/10 ≈ 0.065, which is > 0.05 but NOT > 0.1 → "moderately outperforms"
			expect(result.recommendation).toContain('moderately outperforms');
		});

		it('should generate "Models perform similarly" recommendation when diff <= 0.05', async () => {
			// model-a: 7/10 = 0.7, model-b: 7/10 = 0.7 → diff = 0.0 ≤ 0.05
			const predictions = [
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 1,
					aiModel: 'model-x',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 7 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 11,
					aiModel: 'model-y',
					symbol: 'MSFT',
					decision: 'SELL' as const,
					conviction: 65,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 200,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 7 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: 3,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.compareModels();

			expect(result.recommendation).toContain('Models perform similarly');
		});

		it('computes avgReturn=0 when all actualReturnPct are null (lines 509-510 false branch)', async () => {
			// All predictions have actualReturnPct: null → withReturns.length === 0 → avgReturn = 0
			const predictions = Array.from({ length: 10 }, (_, i) => ({
				id: i + 1,
				aiModel: 'model-null',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 70,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: i < 7 ? ('correct' as const) : ('incorrect' as const),
				actualReturnPct: null,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.compareModels();

			expect(result.models).toHaveLength(1);
			// withReturns.length === 0 → avgReturn = 0 (line 509-510 false branch)
			expect(result.models[0].avgReturn).toBe(0);
		});

		it('computes correct avgReturn when all actualReturnPct are non-null (line 510 true branch)', async () => {
			// withReturns.length > 0 → avgReturn computed via reduce (line 510 true branch)
			const predictions = Array.from({ length: 10 }, (_, i) => ({
				id: i + 1,
				aiModel: 'model-returns',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 70,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: i < 7 ? ('correct' as const) : ('incorrect' as const),
				actualReturnPct: 4, // all non-null → withReturns has 10 items → avgReturn = 4
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.compareModels();

			expect(result.models).toHaveLength(1);
			// withReturns.length === 10 > 0 → avgReturn = sum(4*10) / 10 = 4
			expect(result.models[0].avgReturn).toBe(4);
		});
	});

	describe('getCalibrationCurve', () => {
		it('should return empty array when disabled', async () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'aiSelfImprovement.enabled') return false;
				return undefined;
			});

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.getCalibrationCurve();

			expect(result).toEqual([]);
		});

		it('should return calibration buckets', async () => {
			const predictions = [
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 1,
					aiModel: 'claude-opus-4',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 15,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 2 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 10 }, (_, i) => ({
					id: i + 11,
					aiModel: 'claude-opus-4',
					symbol: 'MSFT',
					decision: 'SELL' as const,
					conviction: 85,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 200,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 8 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: 3,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.getCalibrationCurve();

			expect(result.length).toBeGreaterThan(0);
			expect(result[0]).toHaveProperty('convictionRange');
			expect(result[0]).toHaveProperty('predictions');
			expect(result[0]).toHaveProperty('accuracy');
			expect(result[0]).toHaveProperty('avgConviction');
		});

		it('should filter by model when specified', async () => {
			const predictions = Array.from({ length: 10 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 85,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: 'correct' as const,
				actualReturnPct: 5,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			await selfImprovement.getCalibrationCurve('claude-opus-4');

			expect(mockDb.where).toHaveBeenCalled();
		});

		it('should omit empty buckets', async () => {
			const predictions = Array.from({ length: 10 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 85,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: 'correct' as const,
				actualReturnPct: 5,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.getCalibrationCurve();

			// Only one bucket (80-100) should be populated
			expect(result).toHaveLength(1);
			expect(result[0].convictionRange).toBe('80-100');
		});

		it('should calculate correct accuracy per bucket', async () => {
			const predictions = [
				...Array.from({ length: 5 }, (_, i) => ({
					id: i + 1,
					aiModel: 'claude-opus-4',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 85,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 4 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				})),
				...Array.from({ length: 5 }, (_, i) => ({
					id: i + 6,
					aiModel: 'claude-opus-4',
					symbol: 'MSFT',
					decision: 'SELL' as const,
					conviction: 15,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 200,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: i < 1 ? ('correct' as const) : ('incorrect' as const),
					actualReturnPct: 3,
					evaluatedAt: new Date().toISOString(),
				})),
			];

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.getCalibrationCurve();

			const highBucket = result.find((b) => b.convictionRange === '80-100');
			const lowBucket = result.find((b) => b.convictionRange === '0-20');

			expect(highBucket?.accuracy).toBe(0.8);
			expect(lowBucket?.accuracy).toBe(0.2);
		});
	});

	describe('edge cases', () => {
		it('should handle all correct predictions', async () => {
			const predictions = Array.from({ length: 15 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 70,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: 'correct' as const,
				actualReturnPct: 5,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.generateFeedback();

			expect(result?.overallAccuracy).toBe(1);
			expect(result?.avgConvictionCorrect).toBe(70);
			expect(result?.avgConvictionIncorrect).toBe(0);
		});

		it('should handle all incorrect predictions', async () => {
			const predictions = Array.from({ length: 15 }, (_, i) => ({
				id: i + 1,
				aiModel: 'claude-opus-4',
				symbol: 'AAPL',
				decision: 'BUY' as const,
				conviction: 70,
				signalTimestamp: new Date().toISOString(),
				priceAtSignal: 150,
				priceAfter1d: null,
				priceAfter5d: null,
				priceAfter10d: null,
				actualOutcome: 'incorrect' as const,
				actualReturnPct: -5,
				evaluatedAt: new Date().toISOString(),
			}));

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.generateFeedback();

			expect(result?.overallAccuracy).toBe(0);
			expect(result?.avgConvictionCorrect).toBe(0);
			expect(result?.avgConvictionIncorrect).toBe(70);
		});

		it('should handle single prediction at minimum threshold', async () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'aiSelfImprovement.enabled') return true;
				if (key === 'aiSelfImprovement.feedbackWindow') return 30;
				if (key === 'aiSelfImprovement.minSamples') return 1;
				return undefined;
			});

			const predictions = [
				{
					id: 1,
					aiModel: 'claude-opus-4',
					symbol: 'AAPL',
					decision: 'BUY' as const,
					conviction: 70,
					signalTimestamp: new Date().toISOString(),
					priceAtSignal: 150,
					priceAfter1d: null,
					priceAfter5d: null,
					priceAfter10d: null,
					actualOutcome: 'correct' as const,
					actualReturnPct: 5,
					evaluatedAt: new Date().toISOString(),
				},
			];

			mockDb.all.mockReturnValue(predictions);

			const selfImprovement = getAISelfImprovement();
			const result = await selfImprovement.generateFeedback();

			expect(result).toBeDefined();
			expect(result?.sampleSize).toBe(1);
		});
	});

	describe('singleton pattern', () => {
		it('should return same instance', () => {
			const instance1 = getAISelfImprovement();
			const instance2 = getAISelfImprovement();

			expect(instance1).toBe(instance2);
		});
	});
});
