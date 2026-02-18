/**
 * Standalone backtest script — no server required.
 * Usage: npx tsx scripts/backtest.ts
 */
import 'dotenv/config';
import { initDatabase } from '../src/db/index.js';
import { createBacktestEngine } from '../src/backtest/engine.js';
import { WalkForwardAnalyzer } from '../src/backtest/walk-forward.js';
import type { BacktestConfig, BacktestResult } from '../src/backtest/types.js';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'GOOGL', 'JPM', 'V', 'UNH'];
const START_DATE = '2022-01-01';
const END_DATE = '2024-12-31';
const INITIAL_CAPITAL = 10_000;

const config: BacktestConfig = {
  symbols: SYMBOLS,
  startDate: START_DATE,
  endDate: END_DATE,
  initialCapital: INITIAL_CAPITAL,
  maxPositions: 5,
  maxPositionSizePct: 0.15,
  stopLossPct: 0.07,
  takeProfitPct: 0.20,
  trailingStop: true,
  commission: 0,
  entryThreshold: 0.60,
  slippagePct: 0.001,
  spreadBps: 5,
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const usd = (n: number) => `$${n.toFixed(2)}`;
const num = (n: number | null, decimals = 2) => n == null ? 'N/A' : n.toFixed(decimals);

function printResult(label: string, result: BacktestResult) {
  const m = result.metrics;
  const duration = `${START_DATE} → ${END_DATE}`;
  const arrow = m.returnPct >= 0 ? '▲' : '▼';
  const profitable = m.returnPct > 0 && m.winRate >= 0.4 && (m.profitFactor ?? 0) > 1;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`  ${duration}  |  Symbols: ${SYMBOLS.length}  |  Capital: ${usd(INITIAL_CAPITAL)}`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Return:          ${arrow} ${pct(m.returnPct)}  (${usd(m.finalEquity - INITIAL_CAPITAL)})`);
  console.log(`  Final Equity:    ${usd(m.finalEquity)}`);
  console.log(`  Total Trades:    ${m.totalTrades}  (${m.winCount}W / ${m.lossCount}L)`);
  console.log(`  Win Rate:        ${pct(m.winRate)}`);
  console.log(`  Profit Factor:   ${num(m.profitFactor)}`);
  console.log(`  Expectancy:      ${usd(m.expectancy ?? 0)} per trade`);
  console.log(`  Avg Win:         ${usd(m.avgWin ?? 0)}   Avg Loss: ${usd(m.avgLoss ?? 0)}`);
  console.log(`  Max Drawdown:    ${pct(m.maxDrawdownPct)}`);
  console.log(`  Sharpe Ratio:    ${num(m.sharpeRatio)}`);
  console.log(`  Sortino Ratio:   ${num(m.sortinoRatio)}`);
  console.log(`  Calmar Ratio:    ${num(m.calmarRatio)}`);
  console.log(`  SQN:             ${num(m.sqn)}`);
  console.log(`  Avg Hold:        ${Math.round(m.avgHoldMinutes / 1440)} days`);
  if (m.bestTrade)  console.log(`  Best Trade:      ${m.bestTrade.symbol} +${pct(m.bestTrade.pnlPct)}`);
  if (m.worstTrade) console.log(`  Worst Trade:     ${m.worstTrade.symbol} ${pct(m.worstTrade.pnlPct)}`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  VERDICT: ${profitable ? '✅ PROFITABLE' : '❌ NOT PROFITABLE'}`);
  console.log(`${'─'.repeat(60)}\n`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  // Init in-memory DB so configManager can fall back to defaults
  initDatabase(':memory:');

  console.log('\n🚀  Trader212 Backtest Runner');
  console.log(`    Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`    Period:  ${START_DATE} → ${END_DATE}`);
  console.log(`    Capital: ${usd(INITIAL_CAPITAL)}`);
  console.log('\n⏳  Fetching data from Yahoo Finance...\n');

  // ── 1. Full period backtest ──────────────────────────────────────────────
  const engine = await createBacktestEngine(config);
  const result = await engine.run();
  printResult('FULL BACKTEST (2022–2024)', result);

  // ── 2. Walk-forward (3 windows, 70/30 train/test) ───────────────────────
  console.log('⏳  Running walk-forward analysis (3 windows)...\n');
  const wfa = new WalkForwardAnalyzer(config, 3, 0.7);
  const wfResult = await wfa.run();

  console.log(`${'─'.repeat(60)}`);
  console.log('  WALK-FORWARD ANALYSIS (3 windows, 70% train / 30% test)');
  console.log(`${'─'.repeat(60)}`);

  for (const w of wfResult.windows) {
    const tm = w.trainResult.metrics;
    const vm = w.testResult.metrics;
    const wArrow = vm.returnPct >= 0 ? '▲' : '▼';
    console.log(`\n  Window ${w.windowIndex + 1}`);
    console.log(`    Train: ${w.trainStart} → ${w.trainEnd}  return: ${pct(tm.returnPct)}  win: ${pct(tm.winRate)}  trades: ${tm.totalTrades}`);
    console.log(`    Test:  ${w.testStart} → ${w.testEnd}  return: ${wArrow} ${pct(vm.returnPct)}  win: ${pct(vm.winRate)}  trades: ${vm.totalTrades}`);
  }

  const agg = wfResult.aggregateMetrics;
  const oosArrow = agg.avgTestReturn >= 0 ? '▲' : '▼';
  console.log(`\n  Aggregate Out-of-Sample:`);
  console.log(`    Avg Return:      ${oosArrow} ${pct(agg.avgTestReturn)}`);
  console.log(`    Avg Sharpe:      ${num(agg.avgTestSharpe)}`);
  console.log(`    Avg Win Rate:    ${pct(agg.avgTestWinRate)}`);
  console.log(`    Avg Drawdown:    ${pct(agg.avgTestMaxDrawdown)}`);
  console.log(`    Total Trades:    ${agg.totalTestTrades}`);
  console.log(`    OOS Consistency: ${pct(agg.oosConsistency)} (profitable windows)`);

  const overallProfitable =
    result.metrics.returnPct > 0 &&
    result.metrics.winRate >= 0.4 &&
    (result.metrics.profitFactor ?? 0) > 1 &&
    agg.oosConsistency >= 0.5;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  OVERALL VERDICT: ${overallProfitable ? '✅  The strategy IS profitable' : '❌  The strategy is NOT reliably profitable'}`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch((err) => {
  console.error('Backtest failed:', err);
  process.exit(1);
});
