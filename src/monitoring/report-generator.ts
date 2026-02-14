import { and, desc, gte, lte } from 'drizzle-orm';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import { dailyMetrics, positions, trades } from '../db/schema.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('report-generator');

export interface ReportData {
  period: {
    from: string;
    to: string;
  };
  summary: {
    totalTrades: number;
    winRate: number;
    totalPnl: number;
    totalPnlPct: number;
    bestTrade: { symbol: string; pnlPct: number } | null;
    worstTrade: { symbol: string; pnlPct: number } | null;
  };
  dailyBreakdown: Array<{
    date: string;
    pnl: number;
    trades: number;
    portfolioValue: number;
  }>;
  topPerformers: Array<{ symbol: string; pnl: number; trades: number }>;
  worstPerformers: Array<{ symbol: string; pnl: number; trades: number }>;
  riskMetrics: {
    sharpeRatio: number;
    maxDrawdown: number;
    profitFactor: number;
    avgWin: number;
    avgLoss: number;
  };
  openPositions: Array<{
    symbol: string;
    pnl: number;
    pnlPct: number;
    holdDays: number;
  }>;
}

class ReportGenerator {
  /**
   * Generate report for a single day
   */
  async generateDailyReport(date?: string): Promise<ReportData | null> {
    const enabled = configManager.get<boolean>('reports.enabled');
    if (!enabled) {
      logger.info('Reports disabled in config');
      return null;
    }

    const targetDate = date || new Date().toISOString().split('T')[0];
    const from = `${targetDate}T00:00:00.000Z`;
    const to = `${targetDate}T23:59:59.999Z`;

    logger.info({ date: targetDate }, 'Generating daily report');
    return this.generateCustomReport(from, to);
  }

  /**
   * Generate report for the past 7 days
   */
  async generateWeeklyReport(weekEndDate?: string): Promise<ReportData | null> {
    const enabled = configManager.get<boolean>('reports.enabled');
    if (!enabled) {
      logger.info('Reports disabled in config');
      return null;
    }

    const endDate = weekEndDate ? new Date(weekEndDate) : new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6); // 7 days total

    const from = `${startDate.toISOString().split('T')[0]}T00:00:00.000Z`;
    const to = `${endDate.toISOString().split('T')[0]}T23:59:59.999Z`;

    logger.info({ from, to }, 'Generating weekly report');
    return this.generateCustomReport(from, to);
  }

  /**
   * Generate report for custom date range
   */
  async generateCustomReport(from: string, to: string): Promise<ReportData> {
    logger.info({ from, to }, 'Generating custom report');

    const db = getDb();

    // Fetch trades and metrics
    const periodTrades = await this.fetchTradesForPeriod(from, to);
    const periodMetrics = await this.fetchMetricsForPeriod(from, to);

    // Calculate summary
    const totalTrades = periodTrades.length;
    const winningTrades = periodTrades.filter((t) => (t.pnl ?? 0) > 0);
    const _losingTrades = periodTrades.filter((t) => (t.pnl ?? 0) < 0);
    const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;

    const totalPnl = periodTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const totalPnlPct = periodTrades.reduce((sum, t) => sum + (t.pnlPct ?? 0), 0);

    const bestTrade =
      periodTrades.length > 0
        ? periodTrades.reduce((best, t) => ((t.pnlPct ?? 0) > (best.pnlPct ?? 0) ? t : best))
        : null;

    const worstTrade =
      periodTrades.length > 0
        ? periodTrades.reduce((worst, t) => ((t.pnlPct ?? 0) < (worst.pnlPct ?? 0) ? t : worst))
        : null;

    // Daily breakdown
    const dailyBreakdown = periodMetrics.map((m) => ({
      date: m.date,
      pnl: m.totalPnl ?? 0,
      trades: m.tradesCount ?? 0,
      portfolioValue: m.portfolioValue ?? 0,
    }));

    // Top/worst performers
    const { topPerformers, worstPerformers } = this.getTopBottomPerformers(periodTrades, 5);

    // Risk metrics
    const riskMetrics = this.calculateRiskMetrics(periodTrades, periodMetrics);

    // Open positions
    const openPositionRows = await db.select().from(positions).all();

    const openPositions = openPositionRows.map((p) => {
      const entryTime = new Date(p.entryTime);
      const now = new Date();
      const holdDays = Math.floor((now.getTime() - entryTime.getTime()) / (1000 * 60 * 60 * 24));

      return {
        symbol: p.symbol,
        pnl: p.pnl ?? 0,
        pnlPct: p.pnlPct ?? 0,
        holdDays,
      };
    });

    return {
      period: { from, to },
      summary: {
        totalTrades,
        winRate,
        totalPnl,
        totalPnlPct,
        bestTrade: bestTrade ? { symbol: bestTrade.symbol, pnlPct: bestTrade.pnlPct ?? 0 } : null,
        worstTrade: worstTrade
          ? { symbol: worstTrade.symbol, pnlPct: worstTrade.pnlPct ?? 0 }
          : null,
      },
      dailyBreakdown,
      topPerformers,
      worstPerformers,
      riskMetrics,
      openPositions,
    };
  }

  /**
   * Format report as plain text (suitable for Telegram)
   */
  formatAsText(report: ReportData): string {
    const lines: string[] = [];

    lines.push('📊 TRADING REPORT');
    lines.push('='.repeat(40));
    lines.push(`Period: ${report.period.from.split('T')[0]} to ${report.period.to.split('T')[0]}`);
    lines.push('');

    // Summary
    lines.push('📈 SUMMARY');
    lines.push(`Total Trades: ${report.summary.totalTrades}`);
    lines.push(`Win Rate: ${report.summary.winRate.toFixed(2)}%`);
    lines.push(
      `Total P&L: $${report.summary.totalPnl.toFixed(2)} (${report.summary.totalPnlPct.toFixed(2)}%)`,
    );

    if (report.summary.bestTrade) {
      lines.push(
        `Best Trade: ${report.summary.bestTrade.symbol} (+${report.summary.bestTrade.pnlPct.toFixed(2)}%)`,
      );
    }

    if (report.summary.worstTrade) {
      lines.push(
        `Worst Trade: ${report.summary.worstTrade.symbol} (${report.summary.worstTrade.pnlPct.toFixed(2)}%)`,
      );
    }
    lines.push('');

    // Risk Metrics
    lines.push('⚖️ RISK METRICS');
    lines.push(`Sharpe Ratio: ${report.riskMetrics.sharpeRatio.toFixed(3)}`);
    lines.push(`Max Drawdown: ${report.riskMetrics.maxDrawdown.toFixed(2)}%`);
    lines.push(`Profit Factor: ${report.riskMetrics.profitFactor.toFixed(2)}`);
    lines.push(`Avg Win: $${report.riskMetrics.avgWin.toFixed(2)}`);
    lines.push(`Avg Loss: $${report.riskMetrics.avgLoss.toFixed(2)}`);
    lines.push('');

    // Top Performers
    if (report.topPerformers.length > 0) {
      lines.push('🏆 TOP PERFORMERS');
      for (const p of report.topPerformers) {
        lines.push(`  ${p.symbol}: $${p.pnl.toFixed(2)} (${p.trades} trades)`);
      }
      lines.push('');
    }

    // Worst Performers
    if (report.worstPerformers.length > 0) {
      lines.push('📉 WORST PERFORMERS');
      for (const p of report.worstPerformers) {
        lines.push(`  ${p.symbol}: $${p.pnl.toFixed(2)} (${p.trades} trades)`);
      }
      lines.push('');
    }

    // Open Positions
    if (report.openPositions.length > 0) {
      lines.push('💼 OPEN POSITIONS');
      for (const p of report.openPositions) {
        lines.push(
          `  ${p.symbol}: ${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}% (${p.holdDays}d)`,
        );
      }
      lines.push('');
    }

    // Daily Breakdown
    if (report.dailyBreakdown.length > 0) {
      lines.push('📅 DAILY BREAKDOWN');
      for (const day of report.dailyBreakdown) {
        lines.push(`  ${day.date}: $${day.pnl.toFixed(2)} (${day.trades} trades)`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format report as Markdown
   */
  formatAsMarkdown(report: ReportData): string {
    const lines: string[] = [];

    lines.push('# 📊 Trading Report');
    lines.push('');
    lines.push(
      `**Period:** ${report.period.from.split('T')[0]} to ${report.period.to.split('T')[0]}`,
    );
    lines.push('');

    // Summary
    lines.push('## 📈 Summary');
    lines.push('');
    lines.push(`- **Total Trades:** ${report.summary.totalTrades}`);
    lines.push(`- **Win Rate:** ${report.summary.winRate.toFixed(2)}%`);
    lines.push(
      `- **Total P&L:** $${report.summary.totalPnl.toFixed(2)} (${report.summary.totalPnlPct.toFixed(2)}%)`,
    );

    if (report.summary.bestTrade) {
      const bestSign = report.summary.bestTrade.pnlPct >= 0 ? '+' : '';
      lines.push(
        `- **Best Trade:** ${report.summary.bestTrade.symbol} (${bestSign}${report.summary.bestTrade.pnlPct.toFixed(2)}%)`,
      );
    }

    if (report.summary.worstTrade) {
      lines.push(
        `- **Worst Trade:** ${report.summary.worstTrade.symbol} (${report.summary.worstTrade.pnlPct.toFixed(2)}%)`,
      );
    }
    lines.push('');

    // Risk Metrics
    lines.push('## ⚖️ Risk Metrics');
    lines.push('');
    lines.push(`- **Sharpe Ratio:** ${report.riskMetrics.sharpeRatio.toFixed(3)}`);
    lines.push(`- **Max Drawdown:** ${report.riskMetrics.maxDrawdown.toFixed(2)}%`);
    lines.push(`- **Profit Factor:** ${report.riskMetrics.profitFactor.toFixed(2)}`);
    lines.push(`- **Avg Win:** $${report.riskMetrics.avgWin.toFixed(2)}`);
    lines.push(`- **Avg Loss:** $${report.riskMetrics.avgLoss.toFixed(2)}`);
    lines.push('');

    // Top Performers
    if (report.topPerformers.length > 0) {
      lines.push('## 🏆 Top Performers');
      lines.push('');
      lines.push('| Symbol | P&L | Trades |');
      lines.push('|--------|-----|--------|');
      for (const p of report.topPerformers) {
        lines.push(`| ${p.symbol} | $${p.pnl.toFixed(2)} | ${p.trades} |`);
      }
      lines.push('');
    }

    // Worst Performers
    if (report.worstPerformers.length > 0) {
      lines.push('## 📉 Worst Performers');
      lines.push('');
      lines.push('| Symbol | P&L | Trades |');
      lines.push('|--------|-----|--------|');
      for (const p of report.worstPerformers) {
        lines.push(`| ${p.symbol} | $${p.pnl.toFixed(2)} | ${p.trades} |`);
      }
      lines.push('');
    }

    // Open Positions
    if (report.openPositions.length > 0) {
      lines.push('## 💼 Open Positions');
      lines.push('');
      lines.push('| Symbol | P&L % | Hold Days |');
      lines.push('|--------|-------|-----------|');
      for (const p of report.openPositions) {
        const pnlSign = p.pnlPct >= 0 ? '+' : '';
        lines.push(`| ${p.symbol} | ${pnlSign}${p.pnlPct.toFixed(2)}% | ${p.holdDays} |`);
      }
      lines.push('');
    }

    // Daily Breakdown
    if (report.dailyBreakdown.length > 0) {
      lines.push('## 📅 Daily Breakdown');
      lines.push('');
      lines.push('| Date | P&L | Trades |');
      lines.push('|------|-----|--------|');
      for (const day of report.dailyBreakdown) {
        lines.push(`| ${day.date} | $${day.pnl.toFixed(2)} | ${day.trades} |`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format report as JSON
   */
  formatAsJson(report: ReportData): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Fetch trades for a given period
   */
  private async fetchTradesForPeriod(from: string, to: string) {
    const db = getDb();
    return db
      .select()
      .from(trades)
      .where(and(gte(trades.exitTime, from), lte(trades.exitTime, to)))
      .orderBy(desc(trades.exitTime))
      .all();
  }

  /**
   * Fetch daily metrics for a given period
   */
  private async fetchMetricsForPeriod(from: string, to: string) {
    const db = getDb();
    const fromDate = from.split('T')[0];
    const toDate = to.split('T')[0];

    return db
      .select()
      .from(dailyMetrics)
      .where(and(gte(dailyMetrics.date, fromDate), lte(dailyMetrics.date, toDate)))
      .orderBy(dailyMetrics.date)
      .all();
  }

  /**
   * Calculate risk metrics from trades and daily metrics
   */
  private calculateRiskMetrics(
    periodTrades: Array<{
      symbol: string;
      pnl: number | null;
      pnlPct: number | null;
    }>,
    periodMetrics: Array<{
      sharpeRatio: number | null;
      maxDrawdown: number | null;
      profitFactor: number | null;
    }>,
  ) {
    const winningTrades = periodTrades.filter((t) => (t.pnl ?? 0) > 0);
    const losingTrades = periodTrades.filter((t) => (t.pnl ?? 0) < 0);

    const avgWin =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / winningTrades.length
        : 0;

    const avgLoss =
      losingTrades.length > 0
        ? losingTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / losingTrades.length
        : 0;

    // Use latest metrics values
    const latestMetrics = periodMetrics[periodMetrics.length - 1];

    const sharpeRatio = latestMetrics?.sharpeRatio ?? 0;
    const maxDrawdown = latestMetrics?.maxDrawdown ?? 0;
    const profitFactor = latestMetrics?.profitFactor ?? 0;

    return {
      sharpeRatio,
      maxDrawdown,
      profitFactor,
      avgWin,
      avgLoss,
    };
  }

  /**
   * Get top and worst performers by symbol
   */
  private getTopBottomPerformers(
    periodTrades: Array<{
      symbol: string;
      pnl: number | null;
    }>,
    limit: number,
  ) {
    // Group by symbol
    const symbolMap = new Map<string, { pnl: number; trades: number }>();

    for (const trade of periodTrades) {
      const existing = symbolMap.get(trade.symbol);
      if (existing) {
        existing.pnl += trade.pnl ?? 0;
        existing.trades += 1;
      } else {
        symbolMap.set(trade.symbol, {
          pnl: trade.pnl ?? 0,
          trades: 1,
        });
      }
    }

    // Convert to array and sort
    const performers = Array.from(symbolMap.entries())
      .map(([symbol, data]) => ({
        symbol,
        pnl: data.pnl,
        trades: data.trades,
      }))
      .sort((a, b) => b.pnl - a.pnl);

    const topPerformers = performers.slice(0, limit);
    const worstPerformers = performers.slice(-limit).reverse();

    return { topPerformers, worstPerformers };
  }
}

let instance: ReportGenerator | null = null;

export function getReportGenerator(): ReportGenerator {
  if (!instance) {
    instance = new ReportGenerator();
  }
  return instance;
}
