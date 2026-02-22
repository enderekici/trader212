#!/usr/bin/env tsx
/**
 * Strategy Validation Script (Wave 3)
 *
 * Runs walk-forward analysis and Monte Carlo simulation using the
 * best Sharpe config from the Rust grid search, then evaluates all
 * 6 profitability gates.
 *
 * Usage: npx tsx scripts/validate-strategy.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { BacktestDataLoader } from '../src/backtest/data-loader.js';
import { BacktestEngine, type ScoreFn } from '../src/backtest/engine.js';
import {
  evaluateProfitabilityGates,
  formatGateResults,
  generateSummary,
} from '../src/backtest/reporter.js';
import type {
  BacktestConfig,
  BacktestResult,
  WalkForwardResult,
  WalkForwardWindow,
} from '../src/backtest/types.js';
import { createMonteCarloSimulator } from '../src/analysis/monte-carlo.js';

// ── Best Sharpe config from Rust grid search ────────────────────────────
const BEST_CONFIG: Omit<BacktestConfig, 'symbols' | 'startDate' | 'endDate'> = {
  initialCapital: 10_000,
  maxPositions: 10,
  maxPositionSizePct: 0.25,
  stopLossPct: 0.12,
  takeProfitPct: 0.20,
  entryThreshold: 0.30,
  trailingStop: true,
  commission: 0,
  slippagePct: 0.0015,  // Updated Wave 1 default
  spreadBps: 3,          // Updated Wave 1 default
};

const WALK_FORWARD_WINDOWS = 6;  // 6 windows for ~4 years of data
const TRAIN_RATIO = 0.75;        // 75% train / 25% test per window
const MONTE_CARLO_SIMS = 10_000;

// ── Helpers ─────────────────────────────────────────────────────────────

function getCachedSymbols(): string[] {
  const cacheDir = './data/backtest_cache';
  if (!fs.existsSync(cacheDir)) return [];
  return fs.readdirSync(cacheDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();
}

function getDateRange(symbols: string[]): { start: string; end: string } {
  let globalMin = '9999-12-31';
  let globalMax = '0000-01-01';

  for (const sym of symbols.slice(0, 5)) { // Sample first 5 for speed
    const file = path.join('./data/backtest_cache', `${sym}.json`);
    try {
      const candles = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (candles.length > 0) {
        const first = candles[0].date;
        const last = candles[candles.length - 1].date;
        if (first < globalMin) globalMin = first;
        if (last > globalMax) globalMax = last;
      }
    } catch { /* skip */ }
  }

  return { start: globalMin, end: globalMax };
}

async function loadMultiScorer(): Promise<ScoreFn> {
  const { scoreMultiStrategy } = await import('../src/analysis/technical/strategies.js');
  return scoreMultiStrategy;
}

async function runBacktest(config: BacktestConfig, scoreFn: ScoreFn): Promise<BacktestResult> {
  const dataLoader = new BacktestDataLoader();
  const engine = new BacktestEngine({ config, scoreFn, dataLoader });
  return engine.run();
}

// ── Walk-Forward (with multi strategy) ──────────────────────────────────

async function runWalkForward(
  config: BacktestConfig,
  scoreFn: ScoreFn,
  windows: number,
  trainRatio: number,
): Promise<WalkForwardResult> {
  const startMs = new Date(config.startDate).getTime();
  const endMs = new Date(config.endDate).getTime();
  const windowMs = (endMs - startMs) / windows;

  const windowResults: WalkForwardWindow[] = [];

  for (let i = 0; i < windows; i++) {
    const windowStart = startMs + i * windowMs;
    const windowEnd = windowStart + windowMs;
    const trainEnd = windowStart + windowMs * trainRatio;

    const trainConfig: BacktestConfig = {
      ...config,
      startDate: new Date(windowStart).toISOString().split('T')[0],
      endDate: new Date(trainEnd).toISOString().split('T')[0],
    };

    const testConfig: BacktestConfig = {
      ...config,
      startDate: new Date(trainEnd).toISOString().split('T')[0],
      endDate: new Date(windowEnd).toISOString().split('T')[0],
    };

    console.log(`\n  Window ${i + 1}/${windows}:`);
    console.log(`    Train: ${trainConfig.startDate} to ${trainConfig.endDate}`);
    console.log(`    Test:  ${testConfig.startDate} to ${testConfig.endDate}`);

    const trainResult = await runBacktest(trainConfig, scoreFn);
    console.log(`    Train: ${trainResult.metrics.totalTrades} trades, return ${(trainResult.metrics.returnPct * 100).toFixed(2)}%`);

    const testResult = await runBacktest(testConfig, scoreFn);
    console.log(`    Test:  ${testResult.metrics.totalTrades} trades, return ${(testResult.metrics.returnPct * 100).toFixed(2)}%, WR ${(testResult.metrics.winRate * 100).toFixed(1)}%`);

    windowResults.push({
      windowIndex: i,
      trainStart: trainConfig.startDate,
      trainEnd: trainConfig.endDate,
      testStart: testConfig.startDate,
      testEnd: testConfig.endDate,
      trainResult,
      testResult,
    });
  }

  // Aggregate out-of-sample metrics
  const testResults = windowResults.map(w => w.testResult);
  const avgTestReturn = testResults.reduce((s, r) => s + r.metrics.returnPct, 0) / testResults.length;
  const sharpes = testResults.map(r => r.metrics.sharpeRatio).filter((s): s is number => s != null);
  const avgTestSharpe = sharpes.length > 0 ? sharpes.reduce((a, b) => a + b, 0) / sharpes.length : null;
  const avgTestWinRate = testResults.reduce((s, r) => s + r.metrics.winRate, 0) / testResults.length;
  const avgTestMaxDrawdown = testResults.reduce((s, r) => s + r.metrics.maxDrawdownPct, 0) / testResults.length;
  const totalTestTrades = testResults.reduce((s, r) => s + r.metrics.totalTrades, 0);
  const positiveWindows = testResults.filter(r => r.metrics.returnPct > 0).length;
  const oosConsistency = positiveWindows / testResults.length;

  return {
    config,
    windows: windowResults,
    aggregateMetrics: {
      avgTestReturn,
      avgTestSharpe,
      avgTestWinRate,
      avgTestMaxDrawdown,
      totalTestTrades,
      oosConsistency,
    },
  };
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(70));
  console.log('  STRATEGY VALIDATION (Wave 3)');
  console.log('  Multi-Strategy 4-Strategy Consensus — Best Sharpe Config');
  console.log('='.repeat(70));

  // 1. Discover symbols and date range
  const symbols = getCachedSymbols();
  const { start, end } = getDateRange(symbols);
  console.log(`\nCached data: ${symbols.length} symbols, ${start} to ${end}`);

  // Use a reasonable start date (skip warmup period)
  const backtestStart = '2022-06-01';
  const backtestEnd = end;
  console.log(`Backtest range: ${backtestStart} to ${backtestEnd}`);

  const config: BacktestConfig = {
    ...BEST_CONFIG,
    symbols,
    startDate: backtestStart,
    endDate: backtestEnd,
  };

  console.log(`\nConfig: entry=${config.entryThreshold}, SL=${(config.stopLossPct * 100)}%, TP=${((config.takeProfitPct ?? 0) * 100)}%, maxPos=${config.maxPositions}, size=${(config.maxPositionSizePct * 100)}%`);
  console.log(`Transaction costs: slippage=${((config.slippagePct ?? 0) * 100).toFixed(2)}%, spread=${config.spreadBps}bps`);

  // 2. Load multi-strategy scorer
  console.log('\nLoading multi-strategy scorer...');
  const scoreFn = await loadMultiScorer();

  // ── S1: Full Backtest ─────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(70));
  console.log('  S1: Full Period Backtest');
  console.log('─'.repeat(70));

  const fullResult = await runBacktest(config, scoreFn);
  console.log(generateSummary(fullResult));

  // ── S2: Walk-Forward Analysis ─────────────────────────────────────────
  console.log('\n' + '─'.repeat(70));
  console.log(`  S2: Walk-Forward Analysis (${WALK_FORWARD_WINDOWS} windows, ${(TRAIN_RATIO * 100)}/${((1 - TRAIN_RATIO) * 100)} split)`);
  console.log('─'.repeat(70));

  const wfResult = await runWalkForward(config, scoreFn, WALK_FORWARD_WINDOWS, TRAIN_RATIO);

  console.log('\n  Walk-Forward Aggregate OOS Metrics:');
  console.log(`    Avg OOS Return:      ${(wfResult.aggregateMetrics.avgTestReturn * 100).toFixed(2)}%`);
  console.log(`    Avg OOS Sharpe:      ${wfResult.aggregateMetrics.avgTestSharpe?.toFixed(2) ?? 'N/A'}`);
  console.log(`    Avg OOS Win Rate:    ${(wfResult.aggregateMetrics.avgTestWinRate * 100).toFixed(1)}%`);
  console.log(`    Avg OOS Max DD:      ${(wfResult.aggregateMetrics.avgTestMaxDrawdown * 100).toFixed(2)}%`);
  console.log(`    Total OOS Trades:    ${wfResult.aggregateMetrics.totalTestTrades}`);
  console.log(`    OOS Consistency:     ${(wfResult.aggregateMetrics.oosConsistency * 100).toFixed(0)}% windows profitable`);

  // ── S3: Monte Carlo Simulation ────────────────────────────────────────
  console.log('\n' + '─'.repeat(70));
  console.log(`  S3: Monte Carlo Simulation (${MONTE_CARLO_SIMS.toLocaleString()} iterations)`);
  console.log('─'.repeat(70));

  const simulator = createMonteCarloSimulator();
  const mcResult = simulator.simulate(fullResult.trades, {
    simulations: MONTE_CARLO_SIMS,
    confidenceLevels: [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95],
  });

  if (mcResult) {
    console.log(simulator.formatReport(mcResult));
  } else {
    console.log('  Monte Carlo simulation failed (no valid trades)');
  }

  // ── Profitability Gates ───────────────────────────────────────────────
  console.log('─'.repeat(70));
  console.log('  PROFITABILITY GATES');
  console.log('─'.repeat(70));

  const mcP25 = mcResult?.percentiles.find(p => p.level === 0.25)?.totalReturn ?? null;
  const gates = evaluateProfitabilityGates(fullResult, wfResult, mcP25);
  console.log(formatGateResults(gates));

  // ── Per-Window Detail ─────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(70));
  console.log('  Walk-Forward Window Detail');
  console.log('─'.repeat(70));

  console.log('\n  Window | Test Period              | Trades | Return   | Win Rate | Sharpe  | Max DD');
  console.log('  ' + '-'.repeat(95));

  for (const w of wfResult.windows) {
    const m = w.testResult.metrics;
    console.log(
      `  ${(w.windowIndex + 1).toString().padStart(6)} | ` +
      `${w.testStart} to ${w.testEnd} | ` +
      `${m.totalTrades.toString().padStart(6)} | ` +
      `${(m.returnPct * 100).toFixed(2).padStart(7)}% | ` +
      `${(m.winRate * 100).toFixed(1).padStart(7)}% | ` +
      `${(m.sharpeRatio?.toFixed(2) ?? 'N/A').padStart(7)} | ` +
      `${(m.maxDrawdownPct * 100).toFixed(2).padStart(6)}%`
    );
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log(`  VALIDATION RESULT: ${gates.approved ? 'ALL GATES PASSED' : `${gates.failedGates.length} GATE(S) FAILED`}`);
  console.log(`  Gates: ${gates.passedGates.length}/${gates.passedGates.length + gates.failedGates.length} passed`);
  console.log('='.repeat(70));

  // Exit with appropriate code
  process.exit(gates.approved ? 0 : 1);
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(2);
});
