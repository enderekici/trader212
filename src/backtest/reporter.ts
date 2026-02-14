import { formatCurrency, formatPercent, round } from '../utils/helpers.js';
import type { BacktestResult } from './types.js';

/**
 * Generate a text summary suitable for console output or Telegram.
 */
export function generateSummary(result: BacktestResult): string {
  const { metrics, config } = result;
  const lines: string[] = [];

  lines.push('=== Backtest Results ===');
  lines.push(`Period: ${config.startDate} to ${config.endDate}`);
  lines.push(`Symbols: ${config.symbols.join(', ')}`);
  lines.push(`Initial Capital: ${formatCurrency(config.initialCapital)}`);
  lines.push('');

  lines.push('--- Performance ---');
  lines.push(`Final Equity: ${formatCurrency(metrics.finalEquity)}`);
  lines.push(`Return: ${formatPercent(metrics.returnPct)}`);
  lines.push(`Total P&L: ${formatCurrency(metrics.totalPnl)}`);
  lines.push('');

  lines.push('--- Trade Statistics ---');
  lines.push(`Total Trades: ${metrics.totalTrades}`);
  lines.push(`Win Rate: ${formatPercent(metrics.winRate)}`);
  lines.push(`Wins: ${metrics.winCount} | Losses: ${metrics.lossCount}`);
  lines.push(`Avg Win: ${metrics.avgWin != null ? formatCurrency(metrics.avgWin) : 'N/A'}`);
  lines.push(`Avg Loss: ${metrics.avgLoss != null ? formatCurrency(metrics.avgLoss) : 'N/A'}`);
  lines.push(
    `Avg Hold: ${metrics.avgHoldMinutes > 0 ? formatHoldTime(metrics.avgHoldMinutes) : 'N/A'}`,
  );
  lines.push('');

  lines.push('--- Risk Metrics ---');
  lines.push(`Max Drawdown: ${formatPercent(metrics.maxDrawdownPct)}`);
  lines.push(`Sharpe Ratio: ${metrics.sharpeRatio ?? 'N/A'}`);
  lines.push(`Sortino Ratio: ${metrics.sortinoRatio ?? 'N/A'}`);
  lines.push(`Calmar Ratio: ${metrics.calmarRatio ?? 'N/A'}`);
  lines.push(`SQN: ${metrics.sqn ?? 'N/A'}`);
  lines.push(`Profit Factor: ${metrics.profitFactor ?? 'N/A'}`);
  lines.push(
    `Expectancy: ${metrics.expectancy != null ? formatCurrency(metrics.expectancy) : 'N/A'}`,
  );

  if (metrics.bestTrade) {
    lines.push('');
    lines.push(
      `Best Trade: ${metrics.bestTrade.symbol} (${formatPercent(metrics.bestTrade.pnlPct)})`,
    );
  }
  if (metrics.worstTrade) {
    lines.push(
      `Worst Trade: ${metrics.worstTrade.symbol} (${formatPercent(metrics.worstTrade.pnlPct)})`,
    );
  }

  return lines.join('\n');
}

/**
 * Generate a per-symbol breakdown of trades.
 */
export function generateSymbolBreakdown(result: BacktestResult): string {
  const { trades } = result;
  if (trades.length === 0) return 'No trades to analyze.';

  // Group trades by symbol
  const bySymbol = new Map<
    string,
    { trades: number; wins: number; totalPnl: number; avgPnlPct: number }
  >();

  for (const trade of trades) {
    const existing = bySymbol.get(trade.symbol) ?? {
      trades: 0,
      wins: 0,
      totalPnl: 0,
      avgPnlPct: 0,
    };
    existing.trades++;
    if (trade.pnl > 0) existing.wins++;
    existing.totalPnl += trade.pnl;
    existing.avgPnlPct += trade.pnlPct;
    bySymbol.set(trade.symbol, existing);
  }

  const lines: string[] = ['=== Per-Symbol Breakdown ===', ''];

  // Sort by total P&L descending
  const entries = [...bySymbol.entries()]
    .map(([symbol, data]) => ({
      symbol,
      ...data,
      avgPnlPct: data.avgPnlPct / data.trades,
      winRate: data.wins / data.trades,
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl);

  for (const entry of entries) {
    lines.push(
      `${entry.symbol}: ${entry.trades} trades, WR ${formatPercent(entry.winRate)}, ` +
        `P&L ${formatCurrency(entry.totalPnl)}, Avg ${formatPercent(entry.avgPnlPct)}`,
    );
  }

  return lines.join('\n');
}

/**
 * Format the equity curve for API response.
 */
export function formatEquityCurve(result: BacktestResult): {
  dates: string[];
  values: number[];
  initialCapital: number;
} {
  return {
    dates: result.equityCurve.map((p) => p.date),
    values: result.equityCurve.map((p) => round(p.equity, 2)),
    initialCapital: result.config.initialCapital,
  };
}

function formatHoldTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d ${remainingHours}h`;
}
