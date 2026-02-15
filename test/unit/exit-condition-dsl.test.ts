import { describe, it, expect, vi } from 'vitest';
import {
	evaluateExitCondition,
	evaluateExitConditions,
	formatExitCondition,
	parseExitConditionText,
	type ExitCondition,
	type ExitContext,
} from '../../src/execution/exit-condition-dsl.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

function makeContext(overrides: Partial<ExitContext> = {}): ExitContext {
	return {
		currentPrice: 150,
		previousPrice: 148,
		entryPrice: 140,
		pnlPct: 7.14,
		pnlAbs: 10,
		daysHeld: 5,
		hoursHeld: 120,
		indicators: {
			RSI: 65,
			SMA200: 145,
			MACD: 1.5,
			ADX: 30,
		},
		volume: 1_000_000,
		avgVolume: 800_000,
		...overrides,
	};
}

describe('evaluateExitCondition', () => {
	describe('price conditions', () => {
		it('evaluates price above', () => {
			const cond: ExitCondition = { type: 'price', operator: 'above', value: 145 };
			expect(evaluateExitCondition(cond, makeContext())).toBe(true);
		});

		it('evaluates price below', () => {
			const cond: ExitCondition = { type: 'price', operator: 'below', value: 160 };
			expect(evaluateExitCondition(cond, makeContext())).toBe(true);
		});

		it('evaluates price below when price is above value', () => {
			const cond: ExitCondition = { type: 'price', operator: 'below', value: 145 };
			expect(evaluateExitCondition(cond, makeContext())).toBe(false);
		});

		it('evaluates crosses_above', () => {
			const cond: ExitCondition = { type: 'price', operator: 'crosses_above', value: 149 };
			// previousPrice=148 <= 149 and currentPrice=150 > 149
			expect(evaluateExitCondition(cond, makeContext())).toBe(true);
		});

		it('evaluates crosses_below', () => {
			const cond: ExitCondition = { type: 'price', operator: 'crosses_below', value: 149 };
			// previousPrice=148 >= 149? No, so false
			expect(evaluateExitCondition(cond, makeContext())).toBe(false);
		});

		it('crosses_above requires previousPrice', () => {
			const cond: ExitCondition = { type: 'price', operator: 'crosses_above', value: 149 };
			expect(evaluateExitCondition(cond, makeContext({ previousPrice: undefined }))).toBe(false);
		});
	});

	describe('indicator conditions', () => {
		it('evaluates indicator above', () => {
			const cond: ExitCondition = {
				type: 'indicator',
				indicator: 'RSI',
				operator: 'above',
				value: 60,
			};
			expect(evaluateExitCondition(cond, makeContext())).toBe(true);
		});

		it('evaluates indicator below', () => {
			const cond: ExitCondition = {
				type: 'indicator',
				indicator: 'RSI',
				operator: 'below',
				value: 70,
			};
			expect(evaluateExitCondition(cond, makeContext())).toBe(true);
		});

		it('returns false when indicator not available', () => {
			const cond: ExitCondition = {
				type: 'indicator',
				indicator: 'VWAP',
				operator: 'above',
				value: 100,
			};
			expect(evaluateExitCondition(cond, makeContext())).toBe(false);
		});
	});

	describe('time conditions', () => {
		it('evaluates days_held gt', () => {
			const cond: ExitCondition = {
				type: 'time',
				metric: 'days_held',
				operator: 'gt',
				value: 3,
			};
			expect(evaluateExitCondition(cond, makeContext())).toBe(true);
		});

		it('evaluates days_held lt', () => {
			const cond: ExitCondition = {
				type: 'time',
				metric: 'days_held',
				operator: 'lt',
				value: 3,
			};
			expect(evaluateExitCondition(cond, makeContext())).toBe(false);
		});

		it('evaluates hours_held gte', () => {
			const cond: ExitCondition = {
				type: 'time',
				metric: 'hours_held',
				operator: 'gte',
				value: 120,
			};
			expect(evaluateExitCondition(cond, makeContext())).toBe(true);
		});

		it('evaluates days_held eq', () => {
			const cond: ExitCondition = {
				type: 'time',
				metric: 'days_held',
				operator: 'eq',
				value: 5,
			};
			expect(evaluateExitCondition(cond, makeContext())).toBe(true);
		});
	});

	describe('profit conditions', () => {
		it('evaluates pnl_pct gt', () => {
			const cond: ExitCondition = {
				type: 'profit',
				metric: 'pnl_pct',
				operator: 'gt',
				value: 5,
			};
			expect(evaluateExitCondition(cond, makeContext())).toBe(true);
		});

		it('evaluates pnl_abs lte', () => {
			const cond: ExitCondition = {
				type: 'profit',
				metric: 'pnl_abs',
				operator: 'lte',
				value: 10,
			};
			expect(evaluateExitCondition(cond, makeContext())).toBe(true);
		});
	});

	describe('volume conditions', () => {
		it('evaluates current_volume gt', () => {
			const cond: ExitCondition = {
				type: 'volume',
				metric: 'current_volume',
				operator: 'gt',
				value: 500_000,
			};
			expect(evaluateExitCondition(cond, makeContext())).toBe(true);
		});

		it('evaluates volume_ratio gt', () => {
			const cond: ExitCondition = {
				type: 'volume',
				metric: 'volume_ratio',
				operator: 'gt',
				value: 1.0,
			};
			// volume=1M, avgVolume=800K, ratio=1.25 > 1.0
			expect(evaluateExitCondition(cond, makeContext())).toBe(true);
		});

		it('returns false when volume data unavailable', () => {
			const cond: ExitCondition = {
				type: 'volume',
				metric: 'current_volume',
				operator: 'gt',
				value: 500_000,
			};
			expect(
				evaluateExitCondition(cond, makeContext({ volume: undefined })),
			).toBe(false);
		});

		it('returns false for volume_ratio when avgVolume is 0', () => {
			const cond: ExitCondition = {
				type: 'volume',
				metric: 'volume_ratio',
				operator: 'gt',
				value: 1,
			};
			expect(
				evaluateExitCondition(cond, makeContext({ avgVolume: 0 })),
			).toBe(false);
		});
	});

	describe('composite conditions', () => {
		it('evaluates all (AND) - all true', () => {
			const cond: ExitCondition = {
				type: 'all',
				conditions: [
					{ type: 'price', operator: 'above', value: 145 },
					{ type: 'profit', metric: 'pnl_pct', operator: 'gt', value: 5 },
				],
			};
			expect(evaluateExitCondition(cond, makeContext())).toBe(true);
		});

		it('evaluates all (AND) - one false', () => {
			const cond: ExitCondition = {
				type: 'all',
				conditions: [
					{ type: 'price', operator: 'above', value: 145 },
					{ type: 'price', operator: 'below', value: 145 }, // false
				],
			};
			expect(evaluateExitCondition(cond, makeContext())).toBe(false);
		});

		it('evaluates any (OR) - one true', () => {
			const cond: ExitCondition = {
				type: 'any',
				conditions: [
					{ type: 'price', operator: 'below', value: 145 }, // false
					{ type: 'profit', metric: 'pnl_pct', operator: 'gt', value: 5 }, // true
				],
			};
			expect(evaluateExitCondition(cond, makeContext())).toBe(true);
		});

		it('evaluates any (OR) - all false', () => {
			const cond: ExitCondition = {
				type: 'any',
				conditions: [
					{ type: 'price', operator: 'below', value: 100 },
					{ type: 'price', operator: 'above', value: 200 },
				],
			};
			expect(evaluateExitCondition(cond, makeContext())).toBe(false);
		});
	});
});

describe('evaluateExitConditions', () => {
	it('returns shouldExit=false when no conditions trigger', () => {
		const result = evaluateExitConditions(
			[{ type: 'price', operator: 'above', value: 200 }],
			makeContext(),
		);
		expect(result.shouldExit).toBe(false);
		expect(result.triggeredConditions).toHaveLength(0);
	});

	it('returns triggered conditions as formatted strings', () => {
		const result = evaluateExitConditions(
			[
				{ type: 'price', operator: 'above', value: 145 },
				{ type: 'price', operator: 'above', value: 200 }, // not triggered
			],
			makeContext(),
		);
		expect(result.shouldExit).toBe(true);
		expect(result.triggeredConditions).toHaveLength(1);
		expect(result.triggeredConditions[0]).toContain('above');
	});

	it('reports multiple triggered conditions', () => {
		const result = evaluateExitConditions(
			[
				{ type: 'price', operator: 'above', value: 145 },
				{ type: 'profit', metric: 'pnl_pct', operator: 'gt', value: 5 },
			],
			makeContext(),
		);
		expect(result.triggeredConditions).toHaveLength(2);
	});
});

describe('formatExitCondition', () => {
	it('formats price condition', () => {
		expect(
			formatExitCondition({ type: 'price', operator: 'above', value: 150 }),
		).toBe('Price above $150.00');
	});

	it('formats price crosses_above', () => {
		expect(
			formatExitCondition({ type: 'price', operator: 'crosses_above', value: 200 }),
		).toBe('Price crosses above $200.00');
	});

	it('formats indicator condition', () => {
		expect(
			formatExitCondition({
				type: 'indicator',
				indicator: 'RSI',
				operator: 'below',
				value: 30,
			}),
		).toBe('RSI below 30');
	});

	it('formats time condition', () => {
		expect(
			formatExitCondition({ type: 'time', metric: 'days_held', operator: 'gt', value: 30 }),
		).toBe('Days held > 30');
	});

	it('formats profit pct condition', () => {
		expect(
			formatExitCondition({
				type: 'profit',
				metric: 'pnl_pct',
				operator: 'gt',
				value: 10,
			}),
		).toContain('10');
	});

	it('formats volume condition', () => {
		expect(
			formatExitCondition({
				type: 'volume',
				metric: 'volume_ratio',
				operator: 'gt',
				value: 2,
			}),
		).toBe('Volume ratio > 2');
	});

	it('formats composite all condition', () => {
		const result = formatExitCondition({
			type: 'all',
			conditions: [
				{ type: 'price', operator: 'above', value: 150 },
				{ type: 'time', metric: 'days_held', operator: 'gt', value: 5 },
			],
		});
		expect(result).toContain('ALL:');
	});

	it('formats composite any condition', () => {
		const result = formatExitCondition({
			type: 'any',
			conditions: [
				{ type: 'price', operator: 'below', value: 100 },
			],
		});
		expect(result).toContain('ANY:');
	});
});

describe('parseExitConditionText', () => {
	it('parses empty string to empty array', () => {
		expect(parseExitConditionText('')).toEqual([]);
		expect(parseExitConditionText('  ')).toEqual([]);
	});

	it('parses "price above $150"', () => {
		const result = parseExitConditionText('price above $150');
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ type: 'price', operator: 'above', value: 150 });
	});

	it('parses "price below 50"', () => {
		const result = parseExitConditionText('price below 50');
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ type: 'price', operator: 'below', value: 50 });
	});

	it('parses "stop at $45"', () => {
		const result = parseExitConditionText('stop at $45');
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ type: 'price', operator: 'below', value: 45 });
	});

	it('parses "RSI below 30"', () => {
		const result = parseExitConditionText('RSI below 30');
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			type: 'indicator',
			indicator: 'RSI',
			operator: 'below',
			value: 30,
		});
	});

	it('parses "ADX above 25"', () => {
		const result = parseExitConditionText('ADX above 25');
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			type: 'indicator',
			indicator: 'ADX',
			operator: 'above',
			value: 25,
		});
	});

	it('parses "profit > 10%"', () => {
		const result = parseExitConditionText('profit > 10%');
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			type: 'profit',
			metric: 'pnl_pct',
			operator: 'gt',
			value: 10,
		});
	});

	it('parses "pnl > $500"', () => {
		const result = parseExitConditionText('pnl > $500');
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			type: 'profit',
			metric: 'pnl_abs',
			operator: 'gt',
			value: 500,
		});
	});

	it('parses "hold 30 days"', () => {
		const result = parseExitConditionText('hold 30 days');
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			type: 'time',
			metric: 'days_held',
			operator: 'gt',
			value: 30,
		});
	});

	it('parses "hold for 48 hours"', () => {
		const result = parseExitConditionText('hold for 48 hours');
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			type: 'time',
			metric: 'hours_held',
			operator: 'gt',
			value: 48,
		});
	});

	it('parses "days held > 10"', () => {
		const result = parseExitConditionText('days held > 10');
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			type: 'time',
			metric: 'days_held',
			operator: 'gt',
			value: 10,
		});
	});

	it('parses "close above 200-SMA"', () => {
		const result = parseExitConditionText('close above 200-SMA');
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			type: 'indicator',
			indicator: 'SMA200',
			operator: 'above',
			value: 0,
		});
	});

	it('parses "volume > 1000000"', () => {
		const result = parseExitConditionText('volume > 1000000');
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			type: 'volume',
			metric: 'current_volume',
			operator: 'gt',
			value: 1000000,
		});
	});

	it('parses "volume ratio > 2"', () => {
		const result = parseExitConditionText('volume ratio > 2');
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			type: 'volume',
			metric: 'volume_ratio',
			operator: 'gt',
			value: 2,
		});
	});

	it('parses compound "and" conditions', () => {
		const result = parseExitConditionText('RSI below 30 and price above $150');
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe('all');
		if (result[0].type === 'all') {
			expect(result[0].conditions).toHaveLength(2);
		}
	});

	it('parses compound "or" conditions', () => {
		const result = parseExitConditionText('profit > 10% or hold 30 days');
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe('any');
		if (result[0].type === 'any') {
			expect(result[0].conditions).toHaveLength(2);
		}
	});

	it('returns empty for unparseable text', () => {
		const result = parseExitConditionText('do something random');
		expect(result).toEqual([]);
	});

	it('handles indicator aliases', () => {
		expect(parseExitConditionText('close above SMA200')).toHaveLength(1);
		expect(parseExitConditionText('close below 50-sma')).toHaveLength(1);
		expect(parseExitConditionText('close above bollinger upper')).toHaveLength(1);
	});
});
