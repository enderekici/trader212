import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../src/config/manager.js', () => ({
	configManager: {
		get: vi.fn(),
	},
}));

vi.mock('../../src/db/index.js', () => ({
	getDb: vi.fn(),
}));

vi.mock('../../src/db/repositories/tax-lots.js', () => ({
	createTaxLot: vi.fn(),
	getOpenLots: vi.fn(),
	closeLot: vi.fn(),
	getClosedLots: vi.fn(),
	getLotsBySymbol: vi.fn(),
	getYearSummary: vi.fn(),
}));

import { configManager } from '../../src/config/manager.js';
import { getDb } from '../../src/db/index.js';
import {
	closeLot,
	createTaxLot,
	getClosedLots,
	getLotsBySymbol,
	getOpenLots,
	getYearSummary,
} from '../../src/db/repositories/tax-lots.js';
import { getTaxTracker } from '../../src/monitoring/tax-tracker.js';

describe('TaxTracker', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(configManager.get).mockImplementation((key: string) => {
			const defaults: Record<string, unknown> = {
				'tax.enabled': true,
				'tax.shortTermRate': 0.37,
				'tax.longTermRate': 0.2,
				'tax.harvestThreshold': -500,
			};
			return defaults[key];
		});
	});

	describe('recordPurchase', () => {
		it('should create a tax lot when enabled', async () => {
			vi.mocked(createTaxLot).mockResolvedValue({
				id: 1,
				symbol: 'AAPL',
				shares: 10,
				costBasis: 150,
				purchaseDate: '2025-01-01T00:00:00.000Z',
				saleDate: null,
				salePrice: null,
				pnl: null,
				holdingPeriod: null,
				accountType: 'INVEST',
				createdAt: '2025-01-01T00:00:00.000Z',
			});

			const tracker = getTaxTracker();
			await tracker.recordPurchase('AAPL', 10, 150, 'INVEST');

			expect(createTaxLot).toHaveBeenCalledWith({
				symbol: 'AAPL',
				shares: 10,
				costBasis: 150,
				purchaseDate: expect.any(String),
				accountType: 'INVEST',
			});
		});

		it('should skip recording when tax tracking is disabled', async () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'tax.enabled') return false;
				return null;
			});

			const tracker = getTaxTracker();
			await tracker.recordPurchase('AAPL', 10, 150, 'INVEST');

			expect(createTaxLot).not.toHaveBeenCalled();
		});

		it('should support ISA account type', async () => {
			vi.mocked(createTaxLot).mockResolvedValue({
				id: 1,
				symbol: 'MSFT',
				shares: 5,
				costBasis: 300,
				purchaseDate: '2025-01-01T00:00:00.000Z',
				saleDate: null,
				salePrice: null,
				pnl: null,
				holdingPeriod: null,
				accountType: 'ISA',
				createdAt: '2025-01-01T00:00:00.000Z',
			});

			const tracker = getTaxTracker();
			await tracker.recordPurchase('MSFT', 5, 300, 'ISA');

			expect(createTaxLot).toHaveBeenCalledWith({
				symbol: 'MSFT',
				shares: 5,
				costBasis: 300,
				purchaseDate: expect.any(String),
				accountType: 'ISA',
			});
		});
	});

	describe('recordSale', () => {
		it('should close tax lots using FIFO', async () => {
			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'AAPL',
					shares: 10,
					costBasis: 150,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
				{
					id: 2,
					symbol: 'AAPL',
					shares: 5,
					costBasis: 160,
					purchaseDate: '2024-06-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-06-01T00:00:00.000Z',
				},
			]);

			vi.mocked(createTaxLot).mockResolvedValue({
				id: 3,
				symbol: 'AAPL',
				shares: 3,
				costBasis: 160,
				purchaseDate: '2024-06-01T00:00:00.000Z',
				saleDate: null,
				salePrice: null,
				pnl: null,
				holdingPeriod: null,
				accountType: 'INVEST',
				createdAt: '2024-06-01T00:00:00.000Z',
			});

			const tracker = getTaxTracker();
			await tracker.recordSale('AAPL', 12, 180, '2025-02-01T00:00:00.000Z');

			// First lot: 10 shares, (180 - 150) * 10 = 300 gain, long term (>1 year)
			expect(closeLot).toHaveBeenNthCalledWith(1, 1, {
				saleDate: '2025-02-01T00:00:00.000Z',
				salePrice: 180,
				pnl: 300,
				holdingPeriod: 'long',
			});

			// Second lot: 2 shares, (180 - 160) * 2 = 40 gain, short term (<1 year)
			expect(closeLot).toHaveBeenNthCalledWith(2, 2, {
				saleDate: '2025-02-01T00:00:00.000Z',
				salePrice: 180,
				pnl: 40,
				holdingPeriod: 'short',
			});

			// Should create a new lot for the remaining 3 shares from lot 2
			expect(createTaxLot).toHaveBeenCalledWith({
				symbol: 'AAPL',
				shares: 3,
				costBasis: 160,
				purchaseDate: '2024-06-01T00:00:00.000Z',
				accountType: 'INVEST',
			});
		});

		it('should calculate short-term gains correctly', async () => {
			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'TSLA',
					shares: 10,
					costBasis: 200,
					purchaseDate: '2025-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2025-01-01T00:00:00.000Z',
				},
			]);

			const tracker = getTaxTracker();
			await tracker.recordSale('TSLA', 10, 250, '2025-06-01T00:00:00.000Z');

			// (250 - 200) * 10 = 500 gain, short term (<1 year)
			expect(closeLot).toHaveBeenCalledWith(1, {
				saleDate: '2025-06-01T00:00:00.000Z',
				salePrice: 250,
				pnl: 500,
				holdingPeriod: 'short',
			});
		});

		it('should calculate long-term gains correctly', async () => {
			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'GOOGL',
					shares: 10,
					costBasis: 100,
					purchaseDate: '2023-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2023-01-01T00:00:00.000Z',
				},
			]);

			const tracker = getTaxTracker();
			await tracker.recordSale('GOOGL', 10, 150, '2025-02-01T00:00:00.000Z');

			// (150 - 100) * 10 = 500 gain, long term (>1 year)
			expect(closeLot).toHaveBeenCalledWith(1, {
				saleDate: '2025-02-01T00:00:00.000Z',
				salePrice: 150,
				pnl: 500,
				holdingPeriod: 'long',
			});
		});

		it('should handle losses correctly', async () => {
			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'META',
					shares: 10,
					costBasis: 200,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			]);

			const tracker = getTaxTracker();
			await tracker.recordSale('META', 10, 150, '2025-02-01T00:00:00.000Z');

			// (150 - 200) * 10 = -500 loss
			expect(closeLot).toHaveBeenCalledWith(1, {
				saleDate: '2025-02-01T00:00:00.000Z',
				salePrice: 150,
				pnl: -500,
				holdingPeriod: 'long',
			});
		});

		it('should skip recording when tax tracking is disabled', async () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'tax.enabled') return false;
				return null;
			});

			const tracker = getTaxTracker();
			await tracker.recordSale('AAPL', 10, 180);

			expect(getOpenLots).not.toHaveBeenCalled();
			expect(closeLot).not.toHaveBeenCalled();
		});

		it('should warn when no open lots exist', async () => {
			vi.mocked(getOpenLots).mockResolvedValue([]);

			const tracker = getTaxTracker();
			await tracker.recordSale('AAPL', 10, 180);

			expect(closeLot).not.toHaveBeenCalled();
		});

		it('should use current date when saleDate not provided', async () => {
			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'AAPL',
					shares: 10,
					costBasis: 150,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			]);

			const tracker = getTaxTracker();
			await tracker.recordSale('AAPL', 10, 180);

			expect(closeLot).toHaveBeenCalledWith(1, {
				saleDate: expect.any(String),
				salePrice: 180,
				pnl: 300,
				holdingPeriod: expect.any(String),
			});
		});

		it('should handle partial lot sales', async () => {
			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'NVDA',
					shares: 10,
					costBasis: 400,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			]);

			vi.mocked(createTaxLot).mockResolvedValue({
				id: 2,
				symbol: 'NVDA',
				shares: 5,
				costBasis: 400,
				purchaseDate: '2024-01-01T00:00:00.000Z',
				saleDate: null,
				salePrice: null,
				pnl: null,
				holdingPeriod: null,
				accountType: 'INVEST',
				createdAt: '2024-01-01T00:00:00.000Z',
			});

			const tracker = getTaxTracker();
			await tracker.recordSale('NVDA', 5, 500, '2025-02-01T00:00:00.000Z');

			// Should close 5 shares: (500 - 400) * 5 = 500 gain
			expect(closeLot).toHaveBeenCalledWith(1, {
				saleDate: '2025-02-01T00:00:00.000Z',
				salePrice: 500,
				pnl: 500,
				holdingPeriod: 'long',
			});

			// Should create a new lot for the remaining 5 shares
			expect(createTaxLot).toHaveBeenCalledWith({
				symbol: 'NVDA',
				shares: 5,
				costBasis: 400,
				purchaseDate: '2024-01-01T00:00:00.000Z',
				accountType: 'INVEST',
			});
		});
	});

	describe('getHarvestCandidates', () => {
		it('should identify tax-loss harvest opportunities', async () => {
			const now = new Date('2025-06-01T00:00:00.000Z');
			vi.useFakeTimers();
			vi.setSystemTime(now);

			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'AAPL',
					shares: 10,
					costBasis: 200,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
				{
					id: 2,
					symbol: 'TSLA',
					shares: 5,
					costBasis: 300,
					purchaseDate: '2025-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2025-01-01T00:00:00.000Z',
				},
			]);

			const currentPrices = new Map([
				['AAPL', 145], // -550 unrealized loss (long term) - 10 * (145 - 200)
				['TSLA', 200], // -500 unrealized loss (short term, at threshold, excluded)
			]);

			const tracker = getTaxTracker();
			const candidates = await tracker.getHarvestCandidates(currentPrices);

			// Only AAPL should be included (below threshold)
			expect(candidates).toHaveLength(1);
			expect(candidates[0]).toMatchObject({
				symbol: 'AAPL',
				shares: 10,
				costBasis: 200,
				currentPrice: 145,
				unrealizedLoss: -550,
				holdingPeriod: 'long',
				taxSavings: 110, // 550 * 0.20 (long term rate)
			});

			vi.useRealTimers();
		});

		it('should calculate tax savings based on holding period', async () => {
			const now = new Date('2025-06-01T00:00:00.000Z');
			vi.useFakeTimers();
			vi.setSystemTime(now);

			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'NVDA',
					shares: 10,
					costBasis: 500,
					purchaseDate: '2025-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2025-01-01T00:00:00.000Z',
				},
			]);

			const currentPrices = new Map([['NVDA', 400]]); // -1000 loss

			const tracker = getTaxTracker();
			const candidates = await tracker.getHarvestCandidates(currentPrices);

			expect(candidates).toHaveLength(1);
			expect(candidates[0].taxSavings).toBe(370); // 1000 * 0.37 (short term rate)

			vi.useRealTimers();
		});

		it('should sort candidates by unrealized loss', async () => {
			const now = new Date('2025-06-01T00:00:00.000Z');
			vi.useFakeTimers();
			vi.setSystemTime(now);

			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'AAPL',
					shares: 10,
					costBasis: 200,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
				{
					id: 2,
					symbol: 'TSLA',
					shares: 10,
					costBasis: 300,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			]);

			const currentPrices = new Map([
				['AAPL', 145], // -550 loss (10 * (145 - 200) = -550)
				['TSLA', 200], // -1000 loss (10 * (200 - 300) = -1000)
			]);

			const tracker = getTaxTracker();
			const candidates = await tracker.getHarvestCandidates(currentPrices);

			expect(candidates).toHaveLength(2);
			expect(candidates[0].symbol).toBe('TSLA'); // Largest loss first
			expect(candidates[1].symbol).toBe('AAPL');

			vi.useRealTimers();
		});

		it('should exclude positions above threshold', async () => {
			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'AAPL',
					shares: 10,
					costBasis: 200,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			]);

			const currentPrices = new Map([['AAPL', 195]]); // -50 loss (above -500 threshold)

			const tracker = getTaxTracker();
			const candidates = await tracker.getHarvestCandidates(currentPrices);

			expect(candidates).toHaveLength(0);
		});

		it('should skip symbols without current prices', async () => {
			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'AAPL',
					shares: 10,
					costBasis: 200,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			]);

			const currentPrices = new Map<string, number>(); // No prices

			const tracker = getTaxTracker();
			const candidates = await tracker.getHarvestCandidates(currentPrices);

			expect(candidates).toHaveLength(0);
		});

		it('should return empty array when disabled', async () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'tax.enabled') return false;
				return null;
			});

			const tracker = getTaxTracker();
			const candidates = await tracker.getHarvestCandidates(new Map());

			expect(candidates).toHaveLength(0);
		});
	});

	describe('getYearlyTaxSummary', () => {
		it('should calculate net tax liability', async () => {
			vi.mocked(getYearSummary).mockResolvedValue({
				year: 2025,
				shortTermGains: 1000,
				longTermGains: 2000,
				shortTermLosses: 200,
				longTermLosses: 500,
			});

			vi.mocked(getOpenLots).mockResolvedValue([]);

			const tracker = getTaxTracker();
			const summary = await tracker.getYearlyTaxSummary(2025);

			// Short term: (1000 - 200) * 0.37 = 296
			// Long term: (2000 - 500) * 0.20 = 300
			// Total: 596
			expect(summary.netTaxLiability).toBeCloseTo(596);
		});

		it('should not apply negative tax liability', async () => {
			vi.mocked(getYearSummary).mockResolvedValue({
				year: 2025,
				shortTermGains: 500,
				longTermGains: 1000,
				shortTermLosses: 2000,
				longTermLosses: 3000,
			});

			vi.mocked(getOpenLots).mockResolvedValue([]);

			const tracker = getTaxTracker();
			const summary = await tracker.getYearlyTaxSummary(2025);

			// Losses exceed gains, so tax liability should be 0
			expect(summary.netTaxLiability).toBe(0);
		});

		it('should use current year if not specified', async () => {
			const currentYear = new Date().getFullYear();

			vi.mocked(getYearSummary).mockResolvedValue({
				year: currentYear,
				shortTermGains: 0,
				longTermGains: 0,
				shortTermLosses: 0,
				longTermLosses: 0,
			});

			vi.mocked(getOpenLots).mockResolvedValue([]);

			const tracker = getTaxTracker();
			await tracker.getYearlyTaxSummary();

			expect(getYearSummary).toHaveBeenCalledWith(currentYear);
		});

		it('should return zeros when disabled', async () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'tax.enabled') return false;
				return null;
			});

			const tracker = getTaxTracker();
			const summary = await tracker.getYearlyTaxSummary(2025);

			expect(summary).toEqual({
				shortTermGains: 0,
				longTermGains: 0,
				shortTermLosses: 0,
				longTermLosses: 0,
				netTaxLiability: 0,
				harvestOpportunities: 0,
			});
		});
	});

	describe('getWashSaleWarnings', () => {
		it('should warn about recent loss sales within 30 days', async () => {
			const today = new Date('2025-02-14T00:00:00.000Z');
			const twentyDaysAgo = new Date('2025-01-25T00:00:00.000Z');

			vi.mocked(getClosedLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'AAPL',
					shares: 10,
					costBasis: 200,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: twentyDaysAgo.toISOString(),
					salePrice: 150,
					pnl: -500,
					holdingPeriod: 'long',
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			]);

			vi.useFakeTimers();
			vi.setSystemTime(today);

			const tracker = getTaxTracker();
			const warnings = await tracker.getWashSaleWarnings('AAPL');

			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toMatchObject({
				symbol: 'AAPL',
				saleDate: twentyDaysAgo.toISOString(),
				daysUntilSafe: 10,
			});

			vi.useRealTimers();
		});

		it('should not warn about old sales beyond 30 days', async () => {
			const today = new Date('2025-02-14T00:00:00.000Z');
			const fortyDaysAgo = new Date('2025-01-05T00:00:00.000Z');

			vi.mocked(getClosedLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'AAPL',
					shares: 10,
					costBasis: 200,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: fortyDaysAgo.toISOString(),
					salePrice: 150,
					pnl: -500,
					holdingPeriod: 'long',
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			]);

			vi.useFakeTimers();
			vi.setSystemTime(today);

			const tracker = getTaxTracker();
			const warnings = await tracker.getWashSaleWarnings('AAPL');

			expect(warnings).toHaveLength(0);

			vi.useRealTimers();
		});

		it('should not warn about profitable sales', async () => {
			vi.mocked(getClosedLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'AAPL',
					shares: 10,
					costBasis: 150,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: '2025-02-01T00:00:00.000Z',
					salePrice: 200,
					pnl: 500,
					holdingPeriod: 'long',
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			]);

			const tracker = getTaxTracker();
			const warnings = await tracker.getWashSaleWarnings('AAPL');

			expect(warnings).toHaveLength(0);
		});

		it('should filter by symbol', async () => {
			vi.mocked(getClosedLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'AAPL',
					shares: 10,
					costBasis: 200,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: '2025-02-01T00:00:00.000Z',
					salePrice: 150,
					pnl: -500,
					holdingPeriod: 'long',
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
				{
					id: 2,
					symbol: 'TSLA',
					shares: 5,
					costBasis: 300,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: '2025-02-01T00:00:00.000Z',
					salePrice: 250,
					pnl: -250,
					holdingPeriod: 'long',
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			]);

			const tracker = getTaxTracker();
			const warnings = await tracker.getWashSaleWarnings('AAPL');

			expect(warnings.every((w) => w.symbol === 'AAPL')).toBe(true);
		});

		it('should return empty array when disabled', async () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'tax.enabled') return false;
				return null;
			});

			const tracker = getTaxTracker();
			const warnings = await tracker.getWashSaleWarnings('AAPL');

			expect(warnings).toHaveLength(0);
		});
	});

	describe('estimateTaxImpact', () => {
		it('should estimate tax on profitable sale', async () => {
			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'AAPL',
					shares: 10,
					costBasis: 150,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			]);

			const tracker = getTaxTracker();
			const estimate = await tracker.estimateTaxImpact('AAPL', 10, 200);

			// (200 - 150) * 10 = 500 gain (long term)
			// 500 * 0.20 = 100 tax
			expect(estimate.totalPnL).toBe(500);
			expect(estimate.longTermPnL).toBe(500);
			expect(estimate.shortTermPnL).toBe(0);
			expect(estimate.estimatedTax).toBe(100);
			expect(estimate.effectiveTaxRate).toBeCloseTo(0.2);
		});

		it('should estimate tax on short-term sale', async () => {
			const now = new Date('2025-06-01T00:00:00.000Z');
			vi.useFakeTimers();
			vi.setSystemTime(now);

			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'TSLA',
					shares: 10,
					costBasis: 200,
					purchaseDate: '2025-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2025-01-01T00:00:00.000Z',
				},
			]);

			const tracker = getTaxTracker();
			const estimate = await tracker.estimateTaxImpact('TSLA', 10, 300);

			// (300 - 200) * 10 = 1000 gain (short term)
			// 1000 * 0.37 = 370 tax
			expect(estimate.totalPnL).toBe(1000);
			expect(estimate.shortTermPnL).toBe(1000);
			expect(estimate.longTermPnL).toBe(0);
			expect(estimate.estimatedTax).toBe(370);
			expect(estimate.effectiveTaxRate).toBeCloseTo(0.37);

			vi.useRealTimers();
		});

		it('should handle mixed short and long term lots', async () => {
			const now = new Date('2025-06-01T00:00:00.000Z');
			vi.useFakeTimers();
			vi.setSystemTime(now);

			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'AAPL',
					shares: 10,
					costBasis: 100,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
				{
					id: 2,
					symbol: 'AAPL',
					shares: 5,
					costBasis: 150,
					purchaseDate: '2025-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2025-01-01T00:00:00.000Z',
				},
			]);

			const tracker = getTaxTracker();
			const estimate = await tracker.estimateTaxImpact('AAPL', 15, 200);

			// First lot: 10 shares * (200 - 100) = 1000 long term -> 200 tax
			// Second lot: 5 shares * (200 - 150) = 250 short term -> 92.5 tax
			// Total: 292.5 tax
			expect(estimate.totalPnL).toBe(1250);
			expect(estimate.longTermPnL).toBe(1000);
			expect(estimate.shortTermPnL).toBe(250);
			expect(estimate.estimatedTax).toBeCloseTo(292.5);

			vi.useRealTimers();
		});

		it('should not apply negative tax on losses', async () => {
			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'META',
					shares: 10,
					costBasis: 300,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			]);

			const tracker = getTaxTracker();
			const estimate = await tracker.estimateTaxImpact('META', 10, 200);

			// (200 - 300) * 10 = -1000 loss
			expect(estimate.totalPnL).toBe(-1000);
			expect(estimate.estimatedTax).toBe(0);
			expect(estimate.effectiveTaxRate).toBe(0);
		});

		it('should handle partial lot sales', async () => {
			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'NVDA',
					shares: 20,
					costBasis: 400,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			]);

			const tracker = getTaxTracker();
			const estimate = await tracker.estimateTaxImpact('NVDA', 10, 500);

			// Only selling 10 of 20 shares: (500 - 400) * 10 = 1000 gain
			expect(estimate.totalPnL).toBe(1000);
			expect(estimate.estimatedTax).toBe(200); // 1000 * 0.20 (long term)
		});

		it('should return zeros when disabled', async () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'tax.enabled') return false;
				return null;
			});

			const tracker = getTaxTracker();
			const estimate = await tracker.estimateTaxImpact('AAPL', 10, 200);

			expect(estimate).toEqual({
				totalPnL: 0,
				shortTermPnL: 0,
				longTermPnL: 0,
				estimatedTax: 0,
				effectiveTaxRate: 0,
			});
		});

		it('should handle zero shares', async () => {
			vi.mocked(getOpenLots).mockResolvedValue([
				{
					id: 1,
					symbol: 'AAPL',
					shares: 10,
					costBasis: 150,
					purchaseDate: '2024-01-01T00:00:00.000Z',
					saleDate: null,
					salePrice: null,
					pnl: null,
					holdingPeriod: null,
					accountType: 'INVEST',
					createdAt: '2024-01-01T00:00:00.000Z',
				},
			]);

			const tracker = getTaxTracker();
			const estimate = await tracker.estimateTaxImpact('AAPL', 0, 200);

			expect(estimate.totalPnL).toBe(0);
			expect(estimate.estimatedTax).toBe(0);
		});
	});

	describe('singleton pattern', () => {
		it('should return the same instance', () => {
			const tracker1 = getTaxTracker();
			const tracker2 = getTaxTracker();

			expect(tracker1).toBe(tracker2);
		});
	});
});
