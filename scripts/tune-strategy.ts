#!/usr/bin/env tsx
/**
 * Strategy Tuning Script
 *
 * Runs a parameter sweep across entry threshold, stop-loss, and symbol
 * universe size to find configurations that pass profitability gates.
 *
 * Usage: npx tsx scripts/tune-strategy.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { BacktestDataLoader } from '../src/backtest/data-loader.js';
import { BacktestEngine, type ScoreFn } from '../src/backtest/engine.js';
import { evaluateProfitabilityGates } from '../src/backtest/reporter.js';
import type { BacktestConfig, BacktestResult, WalkForwardResult, WalkForwardWindow } from '../src/backtest/types.js';
import { createMonteCarloSimulator } from '../src/analysis/monte-carlo.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function getCachedSymbols(): string[] {
  const cacheDir = './data/backtest_cache';
  return fs.readdirSync(cacheDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();
}

/** Rank symbols by average daily volume (descending) and return top N */
function getTopSymbolsByVolume(allSymbols: string[], topN: number): string[] {
  const volumes: { symbol: string; avgVol: number }[] = [];

  for (const sym of allSymbols) {
    const file = path.join('./data/backtest_cache', `${sym}.json`);
    try {
      const candles = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (candles.length > 0) {
        const totalVol = candles.reduce((s: number, c: { volume: number }) => s + c.volume, 0);
        volumes.push({ symbol: sym, avgVol: totalVol / candles.length });
      }
    } catch { /* skip */ }
  }

  return volumes
    .sort((a, b) => b.avgVol - a.avgVol)
    .slice(0, topN)
    .map(v => v.symbol);
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

    const trainResult = await runBacktest(trainConfig, scoreFn);
    const testResult = await runBacktest(testConfig, scoreFn);

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

  const testResults = windowResults.map(w => w.testResult);
  const avgTestReturn = testResults.reduce((s, r) => s + r.metrics.returnPct, 0) / testResults.length;
  const sharpes = testResults.map(r => r.metrics.sharpeRatio).filter((s): s is number => s != null);
  const avgTestSharpe = sharpes.length > 0 ? sharpes.reduce((a, b) => a + b, 0) / sharpes.length : null;
  const avgTestWinRate = testResults.reduce((s, r) => s + r.metrics.winRate, 0) / testResults.length;
  const avgTestMaxDrawdown = testResults.reduce((s, r) => s + r.metrics.maxDrawdownPct, 0) / testResults.length;
  const totalTestTrades = testResults.reduce((s, r) => s + r.metrics.totalTrades, 0);
  const positiveWindows = testResults.filter(r => r.metrics.returnPct > 0).length;

  return {
    config,
    windows: windowResults,
    aggregateMetrics: {
      avgTestReturn,
      avgTestSharpe,
      avgTestWinRate,
      avgTestMaxDrawdown,
      totalTestTrades,
      oosConsistency: positiveWindows / testResults.length,
    },
  };
}

// ── Parameter Grid ──────────────────────────────────────────────────────

interface Combo {
  label: string;
  symbolCount: number;
  entryThreshold: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxPositions: number;
  maxPositionSizePct: number;
}

const COMBOS: Combo[] = [
  // Vary symbol universe size
  { label: 'Top30 / entry0.30 / SL12',  symbolCount: 30,  entryThreshold: 0.30, stopLossPct: 0.12, takeProfitPct: 0.20, maxPositions: 10, maxPositionSizePct: 0.25 },
  { label: 'Top50 / entry0.30 / SL12',  symbolCount: 50,  entryThreshold: 0.30, stopLossPct: 0.12, takeProfitPct: 0.20, maxPositions: 10, maxPositionSizePct: 0.25 },

  // Raise entry threshold
  { label: 'Top30 / entry0.50 / SL12',  symbolCount: 30,  entryThreshold: 0.50, stopLossPct: 0.12, takeProfitPct: 0.20, maxPositions: 10, maxPositionSizePct: 0.25 },
  { label: 'Top50 / entry0.50 / SL12',  symbolCount: 50,  entryThreshold: 0.50, stopLossPct: 0.12, takeProfitPct: 0.20, maxPositions: 10, maxPositionSizePct: 0.25 },
  { label: 'Top30 / entry0.60 / SL12',  symbolCount: 30,  entryThreshold: 0.60, stopLossPct: 0.12, takeProfitPct: 0.20, maxPositions: 10, maxPositionSizePct: 0.25 },

  // Tighter stop-loss
  { label: 'Top30 / entry0.50 / SL7',   symbolCount: 30,  entryThreshold: 0.50, stopLossPct: 0.07, takeProfitPct: 0.15, maxPositions: 10, maxPositionSizePct: 0.25 },
  { label: 'Top30 / entry0.50 / SL8',   symbolCount: 30,  entryThreshold: 0.50, stopLossPct: 0.08, takeProfitPct: 0.18, maxPositions: 10, maxPositionSizePct: 0.25 },
  { label: 'Top50 / entry0.50 / SL7',   symbolCount: 50,  entryThreshold: 0.50, stopLossPct: 0.07, takeProfitPct: 0.15, maxPositions: 10, maxPositionSizePct: 0.25 },
  { label: 'Top50 / entry0.50 / SL8',   symbolCount: 50,  entryThreshold: 0.50, stopLossPct: 0.08, takeProfitPct: 0.18, maxPositions: 10, maxPositionSizePct: 0.25 },

  // Fewer positions (concentrated)
  { label: 'Top30 / entry0.50 / SL8 / 5pos',  symbolCount: 30,  entryThreshold: 0.50, stopLossPct: 0.08, takeProfitPct: 0.18, maxPositions: 5, maxPositionSizePct: 0.30 },
  { label: 'Top50 / entry0.50 / SL8 / 5pos',  symbolCount: 50,  entryThreshold: 0.50, stopLossPct: 0.08, takeProfitPct: 0.18, maxPositions: 5, maxPositionSizePct: 0.30 },

  // Aggressive filter: high threshold + tight stops
  { label: 'Top30 / entry0.60 / SL7',   symbolCount: 30,  entryThreshold: 0.60, stopLossPct: 0.07, takeProfitPct: 0.15, maxPositions: 10, maxPositionSizePct: 0.25 },
  { label: 'Top30 / entry0.60 / SL8',   symbolCount: 30,  entryThreshold: 0.60, stopLossPct: 0.08, takeProfitPct: 0.18, maxPositions: 10, maxPositionSizePct: 0.25 },

  // More positions / smaller size (diversification)
  { label: 'Top30 / entry0.50 / SL8 / 8pos',  symbolCount: 30,  entryThreshold: 0.50, stopLossPct: 0.08, takeProfitPct: 0.18, maxPositions: 8, maxPositionSizePct: 0.20 },
  { label: 'Top50 / entry0.50 / SL8 / 8pos',  symbolCount: 50,  entryThreshold: 0.50, stopLossPct: 0.08, takeProfitPct: 0.18, maxPositions: 8, maxPositionSizePct: 0.20 },
];

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(80));
  console.log('  STRATEGY TUNING — Parameter Sweep');
  console.log('='.repeat(80));

  const allSymbols = getCachedSymbols();
  console.log(`\nTotal cached symbols: ${allSymbols.length}`);
  console.log('Ranking by average daily volume...');

  // Pre-compute volume rankings for each needed size
  const symbolSets = new Map<number, string[]>();
  const uniqueSizes = [...new Set(COMBOS.map(c => c.symbolCount))];
  const maxSize = Math.max(...uniqueSizes);
  const topSymbols = getTopSymbolsByVolume(allSymbols, maxSize);

  for (const size of uniqueSizes) {
    symbolSets.set(size, topSymbols.slice(0, size));
  }

  console.log(`Top 10 by volume: ${topSymbols.slice(0, 10).join(', ')}`);

  const scoreFn = await loadMultiScorer();
  const simulator = createMonteCarloSimulator();

  const backtestStart = '2018-01-01';
  const backtestEnd = '2026-02-19';

  // Results table
  interface Result {
    label: string;
    trades: number;
    returnPct: number;
    winRate: number;
    sharpe: number | null;
    profitFactor: number | null;
    maxDD: number;
    oosReturn: number;
    oosSharpe: number | null;
    oosWR: number;
    oosConsistency: number;
    mcP25: number | null;
    gatesPassed: number;
    totalGates: number;
  }

  const results: Result[] = [];

  for (let idx = 0; idx < COMBOS.length; idx++) {
    const combo = COMBOS[idx];
    const symbols = symbolSets.get(combo.symbolCount)!;

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`  [${idx + 1}/${COMBOS.length}] ${combo.label} (${symbols.length} symbols)`);
    console.log('─'.repeat(80));

    const config: BacktestConfig = {
      symbols,
      startDate: backtestStart,
      endDate: backtestEnd,
      initialCapital: 10_000,
      maxPositions: combo.maxPositions,
      maxPositionSizePct: combo.maxPositionSizePct,
      stopLossPct: combo.stopLossPct,
      takeProfitPct: combo.takeProfitPct,
      entryThreshold: combo.entryThreshold,
      trailingStop: true,
      commission: 0,
      slippagePct: 0.0015,
      spreadBps: 3,
    };

    // Full backtest
    const fullResult = await runBacktest(config, scoreFn);
    const m = fullResult.metrics;
    console.log(`  Full: ${m.totalTrades} trades, return ${(m.returnPct * 100).toFixed(2)}%, WR ${(m.winRate * 100).toFixed(1)}%, Sharpe ${m.sharpeRatio?.toFixed(2) ?? 'N/A'}, PF ${m.profitFactor?.toFixed(2) ?? 'N/A'}, DD ${(m.maxDrawdownPct * 100).toFixed(2)}%`);

    // Walk-forward (6 windows)
    const wf = await runWalkForward(config, scoreFn, 6, 0.75);
    const agg = wf.aggregateMetrics;
    console.log(`  OOS:  ${agg.totalTestTrades} trades, return ${(agg.avgTestReturn * 100).toFixed(2)}%, WR ${(agg.avgTestWinRate * 100).toFixed(1)}%, Sharpe ${agg.avgTestSharpe?.toFixed(2) ?? 'N/A'}, consistency ${(agg.oosConsistency * 100).toFixed(0)}%`);

    // Monte Carlo
    const mcResult = simulator.simulate(fullResult.trades, { simulations: 5000 });
    const mcP25 = mcResult?.percentiles.find(p => p.level === 0.25)?.totalReturn ?? null;
    console.log(`  MC:   P25=${mcP25 != null ? (mcP25 * 100).toFixed(2) + '%' : 'N/A'}, P(profit)=${mcResult ? (mcResult.probabilityOfProfit * 100).toFixed(1) + '%' : 'N/A'}`);

    // Gates
    const gates = evaluateProfitabilityGates(fullResult, wf, mcP25);
    console.log(`  Gates: ${gates.passedGates.length}/${gates.passedGates.length + gates.failedGates.length} passed ${gates.approved ? '*** APPROVED ***' : ''}`);

    results.push({
      label: combo.label,
      trades: m.totalTrades,
      returnPct: m.returnPct,
      winRate: m.winRate,
      sharpe: m.sharpeRatio,
      profitFactor: m.profitFactor,
      maxDD: m.maxDrawdownPct,
      oosReturn: agg.avgTestReturn,
      oosSharpe: agg.avgTestSharpe,
      oosWR: agg.avgTestWinRate,
      oosConsistency: agg.oosConsistency,
      mcP25,
      gatesPassed: gates.passedGates.length,
      totalGates: gates.passedGates.length + gates.failedGates.length,
    });
  }

  // ── Summary Table ─────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(120));
  console.log('  SWEEP RESULTS — Sorted by Gates Passed (then Sharpe)');
  console.log('='.repeat(120));

  results.sort((a, b) => {
    if (b.gatesPassed !== a.gatesPassed) return b.gatesPassed - a.gatesPassed;
    return (b.sharpe ?? -99) - (a.sharpe ?? -99);
  });

  console.log('\n  Config                              | Trades | Return  | WR     | Sharpe | PF    | MaxDD  | OOS Ret | OOS WR | MC P25  | Gates');
  console.log('  ' + '-'.repeat(118));

  for (const r of results) {
    console.log(
      `  ${r.label.padEnd(37)} | ` +
      `${r.trades.toString().padStart(6)} | ` +
      `${(r.returnPct * 100).toFixed(1).padStart(6)}% | ` +
      `${(r.winRate * 100).toFixed(1).padStart(5)}% | ` +
      `${(r.sharpe?.toFixed(2) ?? 'N/A').padStart(6)} | ` +
      `${(r.profitFactor?.toFixed(2) ?? 'N/A').padStart(5)} | ` +
      `${(r.maxDD * 100).toFixed(1).padStart(5)}% | ` +
      `${(r.oosReturn * 100).toFixed(1).padStart(6)}% | ` +
      `${(r.oosWR * 100).toFixed(1).padStart(5)}% | ` +
      `${(r.mcP25 != null ? (r.mcP25 * 100).toFixed(1) + '%' : 'N/A').padStart(7)} | ` +
      `${r.gatesPassed}/${r.totalGates}`
    );
  }

  console.log('\n' + '='.repeat(120));
}

main().catch((err) => {
  console.error('Tuning failed:', err);
  process.exit(2);
});
