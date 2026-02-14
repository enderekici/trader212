import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportData } from "../../src/monitoring/report-generator.js";
import { getReportGenerator } from "../../src/monitoring/report-generator.js";

// Mock dependencies
vi.mock("../../src/config/manager.js", () => ({
	configManager: {
		get: vi.fn(),
	},
}));

vi.mock("../../src/db/index.js", () => ({
	getDb: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
	createLogger: vi.fn(() => ({
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	})),
}));

import { configManager } from "../../src/config/manager.js";
import { getDb } from "../../src/db/index.js";

describe("ReportGenerator", () => {
	let mockDb: any;

	beforeEach(() => {
		vi.clearAllMocks();

		// Default: reports enabled
		vi.mocked(configManager.get).mockImplementation((key: string) => {
			if (key === "reports.enabled") return true;
			if (key === "reports.schedule") return "daily";
			if (key === "reports.includeEquityCurve") return true;
			return undefined;
		});

		// Setup mock DB with chainable methods
		mockDb = {
			select: vi.fn().mockReturnThis(),
			from: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			all: vi.fn().mockResolvedValue([]),
			get: vi.fn().mockResolvedValue(null),
		};

		vi.mocked(getDb).mockReturnValue(mockDb);
	});

	describe("generateDailyReport", () => {
		it("should generate daily report for current date", async () => {
			const mockTrades = [
				{
					symbol: "AAPL",
					pnl: 100,
					pnlPct: 5,
					exitTime: "2026-02-14T15:30:00.000Z",
				},
				{
					symbol: "GOOGL",
					pnl: -50,
					pnlPct: -2.5,
					exitTime: "2026-02-14T16:00:00.000Z",
				},
			];

			const mockMetrics = [
				{
					date: "2026-02-14",
					totalPnl: 50,
					tradesCount: 2,
					portfolioValue: 10000,
					sharpeRatio: 1.5,
					maxDrawdown: -5,
					profitFactor: 2.0,
				},
			];

			mockDb.all
				.mockResolvedValueOnce(mockTrades)
				.mockResolvedValueOnce(mockMetrics)
				.mockResolvedValueOnce([]); // open positions

			const generator = getReportGenerator();
			const report = await generator.generateDailyReport("2026-02-14");

			expect(report).not.toBeNull();
			expect(report?.summary.totalTrades).toBe(2);
			expect(report?.summary.totalPnl).toBe(50);
			expect(report?.summary.winRate).toBe(50);
		});

		it("should return null when reports disabled", async () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === "reports.enabled") return false;
				return undefined;
			});

			const generator = getReportGenerator();
			const report = await generator.generateDailyReport();

			expect(report).toBeNull();
		});

		it("should use current date when no date provided", async () => {
			mockDb.all
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateDailyReport();

			expect(report).not.toBeNull();
			expect(mockDb.where).toHaveBeenCalled();
		});

		it("should handle empty period (no trades)", async () => {
			mockDb.all
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateDailyReport("2026-02-14");

			expect(report).not.toBeNull();
			expect(report?.summary.totalTrades).toBe(0);
			expect(report?.summary.winRate).toBe(0);
			expect(report?.summary.totalPnl).toBe(0);
			expect(report?.summary.bestTrade).toBeNull();
			expect(report?.summary.worstTrade).toBeNull();
		});
	});

	describe("generateWeeklyReport", () => {
		it("should generate report for past 7 days", async () => {
			const mockTrades = [
				{
					symbol: "AAPL",
					pnl: 200,
					pnlPct: 10,
					exitTime: "2026-02-10T15:30:00.000Z",
				},
				{
					symbol: "GOOGL",
					pnl: 150,
					pnlPct: 7.5,
					exitTime: "2026-02-12T16:00:00.000Z",
				},
				{
					symbol: "MSFT",
					pnl: -100,
					pnlPct: -5,
					exitTime: "2026-02-14T14:00:00.000Z",
				},
			];

			const mockMetrics = [
				{
					date: "2026-02-10",
					totalPnl: 200,
					tradesCount: 1,
					portfolioValue: 10000,
					sharpeRatio: 1.2,
					maxDrawdown: -3,
					profitFactor: 1.8,
				},
				{
					date: "2026-02-12",
					totalPnl: 150,
					tradesCount: 1,
					portfolioValue: 10200,
					sharpeRatio: 1.5,
					maxDrawdown: -4,
					profitFactor: 2.0,
				},
				{
					date: "2026-02-14",
					totalPnl: -100,
					tradesCount: 1,
					portfolioValue: 10250,
					sharpeRatio: 1.3,
					maxDrawdown: -5,
					profitFactor: 1.9,
				},
			];

			mockDb.all
				.mockResolvedValueOnce(mockTrades)
				.mockResolvedValueOnce(mockMetrics)
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateWeeklyReport("2026-02-14");

			expect(report).not.toBeNull();
			expect(report?.summary.totalTrades).toBe(3);
			expect(report?.summary.totalPnl).toBe(250);
			expect(report?.dailyBreakdown.length).toBe(3);
		});

		it("should return null when reports disabled", async () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === "reports.enabled") return false;
				return undefined;
			});

			const generator = getReportGenerator();
			const report = await generator.generateWeeklyReport();

			expect(report).toBeNull();
		});

		it("should use current date as end when no date provided", async () => {
			mockDb.all
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateWeeklyReport();

			expect(report).not.toBeNull();
		});
	});

	describe("generateCustomReport", () => {
		it("should generate report for custom date range", async () => {
			const mockTrades = [
				{
					symbol: "AAPL",
					pnl: 100,
					pnlPct: 5,
					exitTime: "2026-02-01T15:30:00.000Z",
				},
			];

			const mockMetrics = [
				{
					date: "2026-02-01",
					totalPnl: 100,
					tradesCount: 1,
					portfolioValue: 10000,
					sharpeRatio: 1.0,
					maxDrawdown: -2,
					profitFactor: 1.5,
				},
			];

			mockDb.all
				.mockResolvedValueOnce(mockTrades)
				.mockResolvedValueOnce(mockMetrics)
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateCustomReport(
				"2026-02-01T00:00:00.000Z",
				"2026-02-01T23:59:59.999Z",
			);

			expect(report.period.from).toBe("2026-02-01T00:00:00.000Z");
			expect(report.period.to).toBe("2026-02-01T23:59:59.999Z");
			expect(report.summary.totalTrades).toBe(1);
		});

		it("should identify best and worst trades", async () => {
			const mockTrades = [
				{
					symbol: "AAPL",
					pnl: 200,
					pnlPct: 10,
					exitTime: "2026-02-14T15:30:00.000Z",
				},
				{
					symbol: "GOOGL",
					pnl: 50,
					pnlPct: 2.5,
					exitTime: "2026-02-14T16:00:00.000Z",
				},
				{
					symbol: "MSFT",
					pnl: -150,
					pnlPct: -7.5,
					exitTime: "2026-02-14T17:00:00.000Z",
				},
			];

			mockDb.all
				.mockResolvedValueOnce(mockTrades)
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateCustomReport(
				"2026-02-14T00:00:00.000Z",
				"2026-02-14T23:59:59.999Z",
			);

			expect(report.summary.bestTrade?.symbol).toBe("AAPL");
			expect(report.summary.bestTrade?.pnlPct).toBe(10);
			expect(report.summary.worstTrade?.symbol).toBe("MSFT");
			expect(report.summary.worstTrade?.pnlPct).toBe(-7.5);
		});

		it("should calculate top and worst performers", async () => {
			const mockTrades = [
				{
					symbol: "AAPL",
					pnl: 200,
					pnlPct: 10,
					exitTime: "2026-02-14T15:30:00.000Z",
				},
				{
					symbol: "AAPL",
					pnl: 100,
					pnlPct: 5,
					exitTime: "2026-02-14T16:00:00.000Z",
				},
				{
					symbol: "GOOGL",
					pnl: -50,
					pnlPct: -2.5,
					exitTime: "2026-02-14T17:00:00.000Z",
				},
				{
					symbol: "MSFT",
					pnl: -100,
					pnlPct: -5,
					exitTime: "2026-02-14T18:00:00.000Z",
				},
			];

			mockDb.all
				.mockResolvedValueOnce(mockTrades)
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateCustomReport(
				"2026-02-14T00:00:00.000Z",
				"2026-02-14T23:59:59.999Z",
			);

			expect(report.topPerformers[0].symbol).toBe("AAPL");
			expect(report.topPerformers[0].pnl).toBe(300);
			expect(report.topPerformers[0].trades).toBe(2);

			expect(report.worstPerformers[0].symbol).toBe("MSFT");
			expect(report.worstPerformers[0].pnl).toBe(-100);
			expect(report.worstPerformers[0].trades).toBe(1);
		});

		it("should include open positions with hold days", async () => {
			const entryTime = new Date("2026-02-10T10:00:00.000Z");
			const mockPositions = [
				{
					symbol: "AAPL",
					pnl: 50,
					pnlPct: 2.5,
					entryTime: entryTime.toISOString(),
				},
				{
					symbol: "GOOGL",
					pnl: -25,
					pnlPct: -1.25,
					entryTime: entryTime.toISOString(),
				},
			];

			mockDb.all
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce(mockPositions);

			const generator = getReportGenerator();
			const report = await generator.generateCustomReport(
				"2026-02-14T00:00:00.000Z",
				"2026-02-14T23:59:59.999Z",
			);

			expect(report.openPositions.length).toBe(2);
			expect(report.openPositions[0].symbol).toBe("AAPL");
			expect(report.openPositions[0].pnl).toBe(50);
			expect(report.openPositions[0].holdDays).toBeGreaterThanOrEqual(0);
		});

		it("should calculate risk metrics from latest daily metrics", async () => {
			const mockTrades = [
				{
					symbol: "AAPL",
					pnl: 200,
					pnlPct: 10,
					exitTime: "2026-02-14T15:30:00.000Z",
				},
				{
					symbol: "GOOGL",
					pnl: -100,
					pnlPct: -5,
					exitTime: "2026-02-14T16:00:00.000Z",
				},
			];

			const mockMetrics = [
				{
					date: "2026-02-14",
					totalPnl: 100,
					tradesCount: 2,
					portfolioValue: 10000,
					sharpeRatio: 1.8,
					maxDrawdown: -7.5,
					profitFactor: 2.2,
				},
			];

			mockDb.all
				.mockResolvedValueOnce(mockTrades)
				.mockResolvedValueOnce(mockMetrics)
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateCustomReport(
				"2026-02-14T00:00:00.000Z",
				"2026-02-14T23:59:59.999Z",
			);

			expect(report.riskMetrics.sharpeRatio).toBe(1.8);
			expect(report.riskMetrics.maxDrawdown).toBe(-7.5);
			expect(report.riskMetrics.profitFactor).toBe(2.2);
			expect(report.riskMetrics.avgWin).toBe(200);
			expect(report.riskMetrics.avgLoss).toBe(-100);
		});

		it("should handle period with no metrics data", async () => {
			const mockTrades = [
				{
					symbol: "AAPL",
					pnl: 100,
					pnlPct: 5,
					exitTime: "2026-02-14T15:30:00.000Z",
				},
			];

			mockDb.all
				.mockResolvedValueOnce(mockTrades)
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateCustomReport(
				"2026-02-14T00:00:00.000Z",
				"2026-02-14T23:59:59.999Z",
			);

			expect(report.riskMetrics.sharpeRatio).toBe(0);
			expect(report.riskMetrics.maxDrawdown).toBe(0);
			expect(report.riskMetrics.profitFactor).toBe(0);
		});

		it("should handle all winning trades", async () => {
			const mockTrades = [
				{
					symbol: "AAPL",
					pnl: 100,
					pnlPct: 5,
					exitTime: "2026-02-14T15:30:00.000Z",
				},
				{
					symbol: "GOOGL",
					pnl: 200,
					pnlPct: 10,
					exitTime: "2026-02-14T16:00:00.000Z",
				},
			];

			mockDb.all
				.mockResolvedValueOnce(mockTrades)
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateCustomReport(
				"2026-02-14T00:00:00.000Z",
				"2026-02-14T23:59:59.999Z",
			);

			expect(report.summary.winRate).toBe(100);
			expect(report.riskMetrics.avgWin).toBe(150);
			expect(report.riskMetrics.avgLoss).toBe(0);
		});

		it("should handle all losing trades", async () => {
			const mockTrades = [
				{
					symbol: "AAPL",
					pnl: -100,
					pnlPct: -5,
					exitTime: "2026-02-14T15:30:00.000Z",
				},
				{
					symbol: "GOOGL",
					pnl: -50,
					pnlPct: -2.5,
					exitTime: "2026-02-14T16:00:00.000Z",
				},
			];

			mockDb.all
				.mockResolvedValueOnce(mockTrades)
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateCustomReport(
				"2026-02-14T00:00:00.000Z",
				"2026-02-14T23:59:59.999Z",
			);

			expect(report.summary.winRate).toBe(0);
			expect(report.riskMetrics.avgWin).toBe(0);
			expect(report.riskMetrics.avgLoss).toBe(-75);
		});

		it("should handle single trade period", async () => {
			const mockTrades = [
				{
					symbol: "AAPL",
					pnl: 100,
					pnlPct: 5,
					exitTime: "2026-02-14T15:30:00.000Z",
				},
			];

			mockDb.all
				.mockResolvedValueOnce(mockTrades)
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateCustomReport(
				"2026-02-14T00:00:00.000Z",
				"2026-02-14T23:59:59.999Z",
			);

			expect(report.summary.totalTrades).toBe(1);
			expect(report.summary.bestTrade?.symbol).toBe("AAPL");
			expect(report.summary.worstTrade?.symbol).toBe("AAPL");
		});

		it("should handle null pnl values gracefully", async () => {
			const mockTrades = [
				{
					symbol: "AAPL",
					pnl: null,
					pnlPct: null,
					exitTime: "2026-02-14T15:30:00.000Z",
				},
				{
					symbol: "GOOGL",
					pnl: 100,
					pnlPct: 5,
					exitTime: "2026-02-14T16:00:00.000Z",
				},
			];

			mockDb.all
				.mockResolvedValueOnce(mockTrades)
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateCustomReport(
				"2026-02-14T00:00:00.000Z",
				"2026-02-14T23:59:59.999Z",
			);

			expect(report.summary.totalPnl).toBe(100);
			expect(report.summary.totalPnlPct).toBe(5);
		});
	});

	describe("formatAsText", () => {
		it("should format report as plain text", async () => {
			const mockReport: ReportData = {
				period: {
					from: "2026-02-14T00:00:00.000Z",
					to: "2026-02-14T23:59:59.999Z",
				},
				summary: {
					totalTrades: 5,
					winRate: 60,
					totalPnl: 250,
					totalPnlPct: 12.5,
					bestTrade: { symbol: "AAPL", pnlPct: 10 },
					worstTrade: { symbol: "MSFT", pnlPct: -5 },
				},
				dailyBreakdown: [
					{ date: "2026-02-14", pnl: 250, trades: 5, portfolioValue: 10250 },
				],
				topPerformers: [{ symbol: "AAPL", pnl: 300, trades: 2 }],
				worstPerformers: [{ symbol: "MSFT", pnl: -100, trades: 1 }],
				riskMetrics: {
					sharpeRatio: 1.5,
					maxDrawdown: -7.5,
					profitFactor: 2.0,
					avgWin: 150,
					avgLoss: -75,
				},
				openPositions: [
					{ symbol: "GOOGL", pnl: 50, pnlPct: 2.5, holdDays: 3 },
				],
			};

			const generator = getReportGenerator();
			const text = generator.formatAsText(mockReport);

			expect(text).toContain("TRADING REPORT");
			expect(text).toContain("Total Trades: 5");
			expect(text).toContain("Win Rate: 60.00%");
			expect(text).toContain("Total P&L: $250.00");
			expect(text).toContain("Best Trade: AAPL (+10.00%)");
			expect(text).toContain("Worst Trade: MSFT (-5.00%)");
			expect(text).toContain("Sharpe Ratio: 1.500");
			expect(text).toContain("AAPL: $300.00 (2 trades)");
			expect(text).toContain("GOOGL: +2.50% (3d)");
		});

		it("should handle empty sections in text format", async () => {
			const mockReport: ReportData = {
				period: {
					from: "2026-02-14T00:00:00.000Z",
					to: "2026-02-14T23:59:59.999Z",
				},
				summary: {
					totalTrades: 0,
					winRate: 0,
					totalPnl: 0,
					totalPnlPct: 0,
					bestTrade: null,
					worstTrade: null,
				},
				dailyBreakdown: [],
				topPerformers: [],
				worstPerformers: [],
				riskMetrics: {
					sharpeRatio: 0,
					maxDrawdown: 0,
					profitFactor: 0,
					avgWin: 0,
					avgLoss: 0,
				},
				openPositions: [],
			};

			const generator = getReportGenerator();
			const text = generator.formatAsText(mockReport);

			expect(text).toContain("Total Trades: 0");
			expect(text).not.toContain("Best Trade:");
			expect(text).not.toContain("TOP PERFORMERS");
			expect(text).not.toContain("OPEN POSITIONS");
		});
	});

	describe("formatAsMarkdown", () => {
		it("should format report as Markdown", async () => {
			const mockReport: ReportData = {
				period: {
					from: "2026-02-14T00:00:00.000Z",
					to: "2026-02-14T23:59:59.999Z",
				},
				summary: {
					totalTrades: 3,
					winRate: 66.67,
					totalPnl: 150,
					totalPnlPct: 7.5,
					bestTrade: { symbol: "AAPL", pnlPct: 8 },
					worstTrade: { symbol: "GOOGL", pnlPct: -2 },
				},
				dailyBreakdown: [
					{ date: "2026-02-14", pnl: 150, trades: 3, portfolioValue: 10150 },
				],
				topPerformers: [{ symbol: "AAPL", pnl: 200, trades: 1 }],
				worstPerformers: [{ symbol: "GOOGL", pnl: -50, trades: 1 }],
				riskMetrics: {
					sharpeRatio: 1.2,
					maxDrawdown: -5,
					profitFactor: 1.8,
					avgWin: 125,
					avgLoss: -50,
				},
				openPositions: [
					{ symbol: "MSFT", pnl: 30, pnlPct: 1.5, holdDays: 2 },
				],
			};

			const generator = getReportGenerator();
			const markdown = generator.formatAsMarkdown(mockReport);

			expect(markdown).toContain("# 📊 Trading Report");
			expect(markdown).toContain("**Total Trades:** 3");
			expect(markdown).toContain("**Win Rate:** 66.67%");
			expect(markdown).toContain("| Symbol | P&L | Trades |");
			expect(markdown).toContain("| AAPL | $200.00 | 1 |");
			expect(markdown).toContain("| MSFT | +1.50% | 2 |");
		});

		it("should handle negative P&L without + sign in markdown", async () => {
			const mockReport: ReportData = {
				period: {
					from: "2026-02-14T00:00:00.000Z",
					to: "2026-02-14T23:59:59.999Z",
				},
				summary: {
					totalTrades: 1,
					winRate: 0,
					totalPnl: -100,
					totalPnlPct: -5,
					bestTrade: { symbol: "AAPL", pnlPct: -5 },
					worstTrade: { symbol: "AAPL", pnlPct: -5 },
				},
				dailyBreakdown: [],
				topPerformers: [],
				worstPerformers: [],
				riskMetrics: {
					sharpeRatio: 0,
					maxDrawdown: 0,
					profitFactor: 0,
					avgWin: 0,
					avgLoss: -100,
				},
				openPositions: [
					{ symbol: "AAPL", pnl: -50, pnlPct: -2.5, holdDays: 1 },
				],
			};

			const generator = getReportGenerator();
			const markdown = generator.formatAsMarkdown(mockReport);

			expect(markdown).toContain("| AAPL | -2.50% | 1 |");
			expect(markdown).not.toContain("+-");
		});
	});

	describe("formatAsJson", () => {
		it("should format report as JSON", async () => {
			const mockReport: ReportData = {
				period: {
					from: "2026-02-14T00:00:00.000Z",
					to: "2026-02-14T23:59:59.999Z",
				},
				summary: {
					totalTrades: 2,
					winRate: 50,
					totalPnl: 50,
					totalPnlPct: 2.5,
					bestTrade: { symbol: "AAPL", pnlPct: 5 },
					worstTrade: { symbol: "GOOGL", pnlPct: -2.5 },
				},
				dailyBreakdown: [
					{ date: "2026-02-14", pnl: 50, trades: 2, portfolioValue: 10050 },
				],
				topPerformers: [{ symbol: "AAPL", pnl: 100, trades: 1 }],
				worstPerformers: [{ symbol: "GOOGL", pnl: -50, trades: 1 }],
				riskMetrics: {
					sharpeRatio: 1.0,
					maxDrawdown: -3,
					profitFactor: 1.5,
					avgWin: 100,
					avgLoss: -50,
				},
				openPositions: [],
			};

			const generator = getReportGenerator();
			const json = generator.formatAsJson(mockReport);

			expect(json).toBeTruthy();
			const parsed = JSON.parse(json);
			expect(parsed.summary.totalTrades).toBe(2);
			expect(parsed.summary.winRate).toBe(50);
			expect(parsed.riskMetrics.sharpeRatio).toBe(1.0);
		});

		it("should produce valid JSON with pretty formatting", async () => {
			const mockReport: ReportData = {
				period: {
					from: "2026-02-14T00:00:00.000Z",
					to: "2026-02-14T23:59:59.999Z",
				},
				summary: {
					totalTrades: 0,
					winRate: 0,
					totalPnl: 0,
					totalPnlPct: 0,
					bestTrade: null,
					worstTrade: null,
				},
				dailyBreakdown: [],
				topPerformers: [],
				worstPerformers: [],
				riskMetrics: {
					sharpeRatio: 0,
					maxDrawdown: 0,
					profitFactor: 0,
					avgWin: 0,
					avgLoss: 0,
				},
				openPositions: [],
			};

			const generator = getReportGenerator();
			const json = generator.formatAsJson(mockReport);

			expect(json).toContain("\n");
			expect(() => JSON.parse(json)).not.toThrow();
		});
	});

	describe("Edge Cases", () => {
		it("should limit top/worst performers to 5", async () => {
			const mockTrades = [];
			for (let i = 0; i < 10; i++) {
				mockTrades.push({
					symbol: `STOCK${i}`,
					pnl: (i - 5) * 100,
					pnlPct: (i - 5) * 5,
					exitTime: "2026-02-14T15:30:00.000Z",
				});
			}

			mockDb.all
				.mockResolvedValueOnce(mockTrades)
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateCustomReport(
				"2026-02-14T00:00:00.000Z",
				"2026-02-14T23:59:59.999Z",
			);

			expect(report.topPerformers.length).toBeLessThanOrEqual(5);
			expect(report.worstPerformers.length).toBeLessThanOrEqual(5);
		});

		it("should aggregate multiple trades for same symbol", async () => {
			const mockTrades = [
				{
					symbol: "AAPL",
					pnl: 100,
					pnlPct: 5,
					exitTime: "2026-02-14T10:00:00.000Z",
				},
				{
					symbol: "AAPL",
					pnl: 50,
					pnlPct: 2.5,
					exitTime: "2026-02-14T11:00:00.000Z",
				},
				{
					symbol: "AAPL",
					pnl: 25,
					pnlPct: 1.25,
					exitTime: "2026-02-14T12:00:00.000Z",
				},
			];

			mockDb.all
				.mockResolvedValueOnce(mockTrades)
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const generator = getReportGenerator();
			const report = await generator.generateCustomReport(
				"2026-02-14T00:00:00.000Z",
				"2026-02-14T23:59:59.999Z",
			);

			expect(report.topPerformers.length).toBe(1);
			expect(report.topPerformers[0].symbol).toBe("AAPL");
			expect(report.topPerformers[0].pnl).toBe(175);
			expect(report.topPerformers[0].trades).toBe(3);
		});

		it("should handle missing unrealized P&L in positions", async () => {
			const mockPositions = [
				{
					symbol: "AAPL",
					pnl: null,
					pnlPct: null,
					entryTime: "2026-02-10T10:00:00.000Z",
				},
			];

			mockDb.all
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce(mockPositions);

			const generator = getReportGenerator();
			const report = await generator.generateCustomReport(
				"2026-02-14T00:00:00.000Z",
				"2026-02-14T23:59:59.999Z",
			);

			expect(report.openPositions[0].pnl).toBe(0);
			expect(report.openPositions[0].pnlPct).toBe(0);
		});

		it("should calculate hold days correctly", async () => {
			const entryTime = new Date();
			entryTime.setDate(entryTime.getDate() - 5); // 5 days ago

			const mockPositions = [
				{
					symbol: "AAPL",
					pnl: 100,
					pnlPct: 5,
					entryTime: entryTime.toISOString(),
				},
			];

			mockDb.all
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce(mockPositions);

			const generator = getReportGenerator();
			const report = await generator.generateCustomReport(
				"2026-02-14T00:00:00.000Z",
				"2026-02-14T23:59:59.999Z",
			);

			expect(report.openPositions[0].holdDays).toBeGreaterThanOrEqual(4);
			expect(report.openPositions[0].holdDays).toBeLessThanOrEqual(6);
		});
	});

	describe("Singleton Pattern", () => {
		it("should return same instance on multiple calls", () => {
			const instance1 = getReportGenerator();
			const instance2 = getReportGenerator();

			expect(instance1).toBe(instance2);
		});
	});
});
