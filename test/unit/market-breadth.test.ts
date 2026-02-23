import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

// Mock indicators to control calcSMA return values
vi.mock('../../src/analysis/technical/indicators.js', () => ({
	calcSMA: vi.fn(),
}));

import { computeMarketBreadth } from '../../src/analysis/market-breadth.js';
import { calcSMA } from '../../src/analysis/technical/indicators.js';

const mockedCalcSMA = vi.mocked(calcSMA);

function makeCandles(count: number, closeValue: number): { close: number }[] {
	return Array.from({ length: count }, () => ({ close: closeValue }));
}

describe('computeMarketBreadth', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns oversold when most symbols are below SMA(50)', () => {
		// 10 symbols, all with price below SMA(50)
		const symbolCandles = new Map<string, { close: number }[]>();
		for (let i = 0; i < 10; i++) {
			symbolCandles.set(`SYM${i}`, makeCandles(60, 100));
		}

		// SMA(50) returns 120 (above current price of 100) for all
		// SMA(200) returns null (not enough data)
		mockedCalcSMA.mockImplementation((_closes, period) => {
			if (period === 50) return 120;
			return null;
		});

		const result = computeMarketBreadth(symbolCandles);

		expect(result.above50dPct).toBe(0);
		expect(result.signal).toBe('oversold');
	});

	it('returns overbought when most symbols are above SMA(50)', () => {
		const symbolCandles = new Map<string, { close: number }[]>();
		for (let i = 0; i < 10; i++) {
			symbolCandles.set(`SYM${i}`, makeCandles(60, 150));
		}

		// SMA(50) returns 100 (below current price of 150) for all
		mockedCalcSMA.mockImplementation((_closes, period) => {
			if (period === 50) return 100;
			return null;
		});

		const result = computeMarketBreadth(symbolCandles);

		expect(result.above50dPct).toBe(100);
		expect(result.signal).toBe('overbought');
	});

	it('returns neutral for balanced markets', () => {
		const symbolCandles = new Map<string, { close: number }[]>();
		for (let i = 0; i < 10; i++) {
			symbolCandles.set(`SYM${i}`, makeCandles(60, 100));
		}

		// 5 symbols above SMA(50), 5 below → 50% = neutral
		let callCount = 0;
		mockedCalcSMA.mockImplementation((_closes, period) => {
			if (period === 50) {
				callCount++;
				// Alternate: odd calls return SMA below price, even calls return SMA above
				return callCount % 2 === 1 ? 80 : 120;
			}
			return null;
		});

		const result = computeMarketBreadth(symbolCandles);

		expect(result.above50dPct).toBe(50);
		expect(result.signal).toBe('neutral');
	});

	it('handles empty Map input gracefully', () => {
		const symbolCandles = new Map<string, { close: number }[]>();

		const result = computeMarketBreadth(symbolCandles);

		expect(result.above50dPct).toBe(50);
		expect(result.above200dPct).toBe(50);
		expect(result.signal).toBe('neutral');
		// calcSMA should never be called
		expect(mockedCalcSMA).not.toHaveBeenCalled();
	});

	it('skips symbols with insufficient data (< 50 candles)', () => {
		const symbolCandles = new Map<string, { close: number }[]>();
		// 3 symbols with insufficient data
		symbolCandles.set('SHORT1', makeCandles(10, 100));
		symbolCandles.set('SHORT2', makeCandles(30, 100));
		symbolCandles.set('SHORT3', makeCandles(49, 100));

		const result = computeMarketBreadth(symbolCandles);

		// No symbols qualify → fallback
		expect(result.above50dPct).toBe(50);
		expect(result.above200dPct).toBe(50);
		expect(result.signal).toBe('neutral');
		// calcSMA should never be called since all are skipped
		expect(mockedCalcSMA).not.toHaveBeenCalled();
	});

	it('correctly computes above200dPct independently from above50dPct', () => {
		const symbolCandles = new Map<string, { close: number }[]>();
		for (let i = 0; i < 4; i++) {
			symbolCandles.set(`SYM${i}`, makeCandles(250, 100));
		}

		// All above SMA(50) but only 1 of 4 above SMA(200)
		let sma200CallCount = 0;
		mockedCalcSMA.mockImplementation((_closes, period) => {
			if (period === 50) return 80; // all above SMA(50)
			if (period === 200) {
				sma200CallCount++;
				return sma200CallCount === 1 ? 90 : 110; // 1 above, 3 below
			}
			return null;
		});

		const result = computeMarketBreadth(symbolCandles);

		expect(result.above50dPct).toBe(100);
		expect(result.above200dPct).toBe(25);
		expect(result.signal).toBe('overbought');
	});
});
