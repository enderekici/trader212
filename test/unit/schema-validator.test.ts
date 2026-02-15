import { describe, it, expect } from 'vitest';
import {
	configSchemas,
	getConfigSchema,
	validateConfigValue,
} from '../../src/config/schema-validator.js';

describe('schema-validator', () => {
	describe('configSchemas', () => {
		it('contains schemas for known config keys', () => {
			expect(configSchemas.has('t212.environment')).toBe(true);
			expect(configSchemas.has('risk.maxPositions')).toBe(true);
			expect(configSchemas.has('ai.provider')).toBe(true);
			expect(configSchemas.has('execution.dryRun')).toBe(true);
			expect(configSchemas.has('streaming.enabled')).toBe(true);
		});

		it('covers all major categories', () => {
			const categories = [
				't212.environment',
				'pairlist.enabled',
				'data.finnhub.enabled',
				'analysis.intervalMinutes',
				'ai.enabled',
				'risk.maxPositions',
				'execution.dryRun',
				'protection.cooldownMinutes',
				'exit.roiEnabled',
				'dca.enabled',
				'partialExit.enabled',
				'multiTimeframe.enabled',
				'regime.enabled',
				'webhook.enabled',
				'attribution.enabled',
				'riskParity.enabled',
				'tax.enabled',
				'monteCarlo.simulations',
				'portfolioOptimization.enabled',
				'socialSentiment.enabled',
				'conditionalOrders.enabled',
				'aiSelfImprovement.enabled',
				'reports.enabled',
				'webResearch.enabled',
				'streaming.enabled',
				'monitoring.dailySummaryTime',
			];
			for (const key of categories) {
				expect(configSchemas.has(key)).toBe(true);
			}
		});
	});

	describe('getConfigSchema', () => {
		it('returns schema for known key', () => {
			const schema = getConfigSchema('t212.environment');
			expect(schema).toBeDefined();
		});

		it('returns undefined for unknown key', () => {
			const schema = getConfigSchema('unknown.key.here');
			expect(schema).toBeUndefined();
		});
	});

	describe('validateConfigValue', () => {
		// ── Trading212 ────────────────────────────────────────
		it('validates t212.environment accepts demo/live', () => {
			expect(validateConfigValue('t212.environment', 'demo')).toEqual({ valid: true });
			expect(validateConfigValue('t212.environment', 'live')).toEqual({ valid: true });
		});

		it('rejects invalid t212.environment', () => {
			const result = validateConfigValue('t212.environment', 'staging');
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		});

		it('validates t212.accountType', () => {
			expect(validateConfigValue('t212.accountType', 'INVEST')).toEqual({ valid: true });
			expect(validateConfigValue('t212.accountType', 'ISA')).toEqual({ valid: true });
			expect(validateConfigValue('t212.accountType', 'MARGIN').valid).toBe(false);
		});

		// ── Pairlist ──────────────────────────────────────────
		it('validates pairlist.enabled as boolean', () => {
			expect(validateConfigValue('pairlist.enabled', true)).toEqual({ valid: true });
			expect(validateConfigValue('pairlist.enabled', false)).toEqual({ valid: true });
			expect(validateConfigValue('pairlist.enabled', 'yes').valid).toBe(false);
		});

		it('validates pairlist.refreshMinutes range', () => {
			expect(validateConfigValue('pairlist.refreshMinutes', 30)).toEqual({ valid: true });
			expect(validateConfigValue('pairlist.refreshMinutes', 0).valid).toBe(false);
			expect(validateConfigValue('pairlist.refreshMinutes', 1441).valid).toBe(false);
		});

		it('validates pairlist.filters as array of valid filter names', () => {
			expect(validateConfigValue('pairlist.filters', ['volume', 'price'])).toEqual({
				valid: true,
			});
			expect(validateConfigValue('pairlist.filters', ['invalid']).valid).toBe(false);
		});

		it('validates pairlist.mode enum', () => {
			expect(validateConfigValue('pairlist.mode', 'dynamic')).toEqual({ valid: true });
			expect(validateConfigValue('pairlist.mode', 'static')).toEqual({ valid: true });
			expect(validateConfigValue('pairlist.mode', 'hybrid')).toEqual({ valid: true });
			expect(validateConfigValue('pairlist.mode', 'random').valid).toBe(false);
		});

		it('validates pairlist.maxPairs integer range', () => {
			expect(validateConfigValue('pairlist.maxPairs', 30)).toEqual({ valid: true });
			expect(validateConfigValue('pairlist.maxPairs', 0).valid).toBe(false);
			expect(validateConfigValue('pairlist.maxPairs', 501).valid).toBe(false);
			expect(validateConfigValue('pairlist.maxPairs', 1.5).valid).toBe(false);
		});

		// ── Data Sources ──────────────────────────────────────
		it('validates data source booleans', () => {
			expect(validateConfigValue('data.finnhub.enabled', true)).toEqual({ valid: true });
			expect(validateConfigValue('data.yahoo.enabled', false)).toEqual({ valid: true });
		});

		it('validates data.marketaux.maxCallsPerDay', () => {
			expect(validateConfigValue('data.marketaux.maxCallsPerDay', 100)).toEqual({ valid: true });
			expect(validateConfigValue('data.marketaux.maxCallsPerDay', 0).valid).toBe(false);
		});

		// ── Analysis ──────────────────────────────────────────
		it('validates analysis.rsi.period', () => {
			expect(validateConfigValue('analysis.rsi.period', 14)).toEqual({ valid: true });
			expect(validateConfigValue('analysis.rsi.period', 1).valid).toBe(false);
		});

		it('validates analysis.sma.periods as array of integers', () => {
			expect(validateConfigValue('analysis.sma.periods', [20, 50, 200])).toEqual({
				valid: true,
			});
			expect(validateConfigValue('analysis.sma.periods', 'twenty').valid).toBe(false);
		});

		// ── AI ─────────────────────────────────────────────────
		it('validates ai.provider enum', () => {
			expect(validateConfigValue('ai.provider', 'anthropic')).toEqual({ valid: true });
			expect(validateConfigValue('ai.provider', 'ollama')).toEqual({ valid: true });
			expect(validateConfigValue('ai.provider', 'openai-compatible')).toEqual({ valid: true });
			expect(validateConfigValue('ai.provider', 'gpt4all').valid).toBe(false);
		});

		it('validates ai.temperature range', () => {
			expect(validateConfigValue('ai.temperature', 0.1)).toEqual({ valid: true });
			expect(validateConfigValue('ai.temperature', 0)).toEqual({ valid: true });
			expect(validateConfigValue('ai.temperature', 2)).toEqual({ valid: true });
			expect(validateConfigValue('ai.temperature', -0.1).valid).toBe(false);
			expect(validateConfigValue('ai.temperature', 2.1).valid).toBe(false);
		});

		it('validates ai.model as non-empty string', () => {
			expect(validateConfigValue('ai.model', 'claude-sonnet-4-5-20250929')).toEqual({
				valid: true,
			});
			expect(validateConfigValue('ai.model', '').valid).toBe(false);
		});

		// ── Risk ──────────────────────────────────────────────
		it('validates risk.maxPositions as positive integer', () => {
			expect(validateConfigValue('risk.maxPositions', 5)).toEqual({ valid: true });
			expect(validateConfigValue('risk.maxPositions', 0).valid).toBe(false);
			expect(validateConfigValue('risk.maxPositions', -1).valid).toBe(false);
		});

		it('validates risk.maxPositionSizePct 0.01-1 range', () => {
			expect(validateConfigValue('risk.maxPositionSizePct', 0.15)).toEqual({ valid: true });
			expect(validateConfigValue('risk.maxPositionSizePct', 0).valid).toBe(false);
			expect(validateConfigValue('risk.maxPositionSizePct', 1.1).valid).toBe(false);
		});

		it('validates risk.maxCorrelation 0-1 range', () => {
			expect(validateConfigValue('risk.maxCorrelation', 0.85)).toEqual({ valid: true });
			expect(validateConfigValue('risk.maxCorrelation', 1.1).valid).toBe(false);
		});

		// ── Execution ─────────────────────────────────────────
		it('validates execution.dryRun as boolean', () => {
			expect(validateConfigValue('execution.dryRun', true)).toEqual({ valid: true });
			expect(validateConfigValue('execution.dryRun', 'true').valid).toBe(false);
		});

		it('validates execution.minRiskRewardRatio', () => {
			expect(validateConfigValue('execution.minRiskRewardRatio', 1.5)).toEqual({ valid: true });
			expect(validateConfigValue('execution.minRiskRewardRatio', 0.05).valid).toBe(false);
		});

		// ── Protection ────────────────────────────────────────
		it('validates protection schemas', () => {
			expect(validateConfigValue('protection.cooldownMinutes', 30)).toEqual({ valid: true });
			expect(validateConfigValue('protection.stoplossGuard.enabled', true)).toEqual({
				valid: true,
			});
			expect(validateConfigValue('protection.stoplossGuard.tradeLimit', 3)).toEqual({
				valid: true,
			});
		});

		// ── Exit ──────────────────────────────────────────────
		it('validates exit.roiEnabled as boolean', () => {
			expect(validateConfigValue('exit.roiEnabled', true)).toEqual({ valid: true });
		});

		it('validates exit.roiTable as record of numbers', () => {
			expect(validateConfigValue('exit.roiTable', { '0': 0.06, '60': 0.04 })).toEqual({
				valid: true,
			});
		});

		// ── DCA ───────────────────────────────────────────────
		it('validates dca.maxRounds', () => {
			expect(validateConfigValue('dca.maxRounds', 3)).toEqual({ valid: true });
			expect(validateConfigValue('dca.maxRounds', 0).valid).toBe(false);
			expect(validateConfigValue('dca.maxRounds', 21).valid).toBe(false);
		});

		// ── Partial Exit ──────────────────────────────────────
		it('validates partialExit.tiers', () => {
			expect(
				validateConfigValue('partialExit.tiers', [{ pctGain: 0.05, sellPct: 0.5 }]),
			).toEqual({ valid: true });
			expect(validateConfigValue('partialExit.tiers', []).valid).toBe(false);
		});

		// ── Streaming ─────────────────────────────────────────
		it('validates streaming.enabled', () => {
			expect(validateConfigValue('streaming.enabled', true)).toEqual({ valid: true });
			expect(validateConfigValue('streaming.enabled', 'on').valid).toBe(false);
		});

		it('validates streaming.intervalSeconds range', () => {
			expect(validateConfigValue('streaming.intervalSeconds', 15)).toEqual({ valid: true });
			expect(validateConfigValue('streaming.intervalSeconds', 4).valid).toBe(false);
			expect(validateConfigValue('streaming.intervalSeconds', 301).valid).toBe(false);
		});

		// ── Monitoring ────────────────────────────────────────
		it('validates monitoring.dailySummaryTime format', () => {
			expect(validateConfigValue('monitoring.dailySummaryTime', '16:30')).toEqual({
				valid: true,
			});
			expect(validateConfigValue('monitoring.dailySummaryTime', '4:30pm').valid).toBe(false);
		});

		it('validates monitoring.weeklyReportDay enum', () => {
			expect(validateConfigValue('monitoring.weeklyReportDay', 'friday')).toEqual({
				valid: true,
			});
			expect(validateConfigValue('monitoring.weeklyReportDay', 'Funday').valid).toBe(false);
		});

		// ── Unknown keys ──────────────────────────────────────
		it('returns valid for unknown keys (forward compatibility)', () => {
			expect(validateConfigValue('custom.unknown.key', 'anything')).toEqual({ valid: true });
			expect(validateConfigValue('future.feature.flag', 42)).toEqual({ valid: true });
		});

		// ── Edge cases ────────────────────────────────────────
		it('rejects null/undefined for typed keys', () => {
			expect(validateConfigValue('risk.maxPositions', null).valid).toBe(false);
			expect(validateConfigValue('ai.enabled', undefined).valid).toBe(false);
		});

		it('rejects wrong types for numeric keys', () => {
			expect(validateConfigValue('risk.maxPositions', 'five').valid).toBe(false);
			expect(validateConfigValue('analysis.intervalMinutes', true).valid).toBe(false);
		});
	});
});
