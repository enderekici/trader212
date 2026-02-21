import { formatCurrency, formatPercent, round } from '../utils/helpers.js';
import type { BacktestResult, WalkForwardResult } from './types.js';

export interface ProfitabilityGateResult {
  approved: boolean;
  failedGates: string[];
  passedGates: string[];
}

/**
 * Evaluate 6 profitability gates against backtest results.
 * All gates must pass for the strategy to be approved.
 *
 * Gates:
 *  1. Walk-forward OOS CAGR > 0%
 *  2. Profit factor >= 1.4
 *  3. Sharpe ratio >= 1.2
 *  4. Max drawdown <= 12%
 *  5. Monte Carlo 25th percentile > 0 (requires mcPercentile25 in metrics)
 *  6. Rolling 90-day win rate >= 55%
 */
export function evaluateProfitabilityGates(
  result: BacktestResult,
  walkForward?: WalkForwardResult,
  monteCarloP25?: number,
): ProfitabilityGateResult {
  const failedGates: string[] = [];
  const passedGates: string[] = [];
  const { metrics } = result;

  // Gate 1: Walk-forward OOS CAGR > 0%
  if (walkForward) {
    const oosCagr = walkForward.aggregateMetrics.avgTestReturn;
    if (oosCagr > 0) {
      passedGates.push(`Walk-forward OOS return ${formatPercent(oosCagr)} > 0%`);
    } else {
      failedGates.push(`Walk-forward OOS return ${formatPercent(oosCagr)} <= 0%`);
    }
  } else {
    failedGates.push('Walk-forward OOS data not available');
  }

  // Gate 2: Profit factor >= 1.4
  if (metrics.profitFactor != null && metrics.profitFactor >= 1.4) {
    passedGates.push(`Profit factor ${metrics.profitFactor.toFixed(2)} >= 1.4`);
  } else {
    failedGates.push(
      `Profit factor ${metrics.profitFactor != null ? metrics.profitFactor.toFixed(2) : 'N/A'} < 1.4`,
    );
  }

  // Gate 3: Sharpe ratio >= 1.2
  if (metrics.sharpeRatio != null && metrics.sharpeRatio >= 1.2) {
    passedGates.push(`Sharpe ratio ${metrics.sharpeRatio.toFixed(2)} >= 1.2`);
  } else {
    failedGates.push(
      `Sharpe ratio ${metrics.sharpeRatio != null ? metrics.sharpeRatio.toFixed(2) : 'N/A'} < 1.2`,
    );
  }

  // Gate 4: Max drawdown <= 12%
  if (metrics.maxDrawdownPct <= 0.12) {
    passedGates.push(`Max drawdown ${formatPercent(metrics.maxDrawdownPct)} <= 12%`);
  } else {
    failedGates.push(`Max drawdown ${formatPercent(metrics.maxDrawdownPct)} > 12%`);
  }

  // Gate 5: Monte Carlo 25th percentile > 0
  if (monteCarloP25 != null && monteCarloP25 > 0) {
    passedGates.push(`Monte Carlo P25 ${formatPercent(monteCarloP25)} > 0%`);
  } else if (monteCarloP25 != null) {
    failedGates.push(`Monte Carlo P25 ${formatPercent(monteCarloP25)} <= 0%`);
  } else {
    failedGates.push('Monte Carlo P25 data not available');
  }

  // Gate 6: Win rate >= 55% (using overall backtest win rate as proxy for rolling 90-day)
  if (metrics.winRate >= 0.55) {
    passedGates.push(`Win rate ${formatPercent(metrics.winRate)} >= 55%`);
  } else {
    failedGates.push(`Win rate ${formatPercent(metrics.winRate)} < 55%`);
  }

  return {
    approved: failedGates.length === 0,
    failedGates,
    passedGates,
  };
}

/**
 * Format profitability gate results for console/Telegram output.
 */
export function formatGateResults(gates: ProfitabilityGateResult): string {
  const lines: string[] = [];
  lines.push(`=== Profitability Gates: ${gates.approved ? 'APPROVED' : 'REJECTED'} ===`);
  lines.push('');
  for (const g of gates.passedGates) {
    lines.push(`  [PASS] ${g}`);
  }
  for (const g of gates.failedGates) {
    lines.push(`  [FAIL] ${g}`);
  }
  lines.push('');
  lines.push(
    `Result: ${gates.passedGates.length}/${gates.passedGates.length + gates.failedGates.length} gates passed`,
  );
  return lines.join('\n');
}

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
