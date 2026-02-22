#!/usr/bin/env tsx
/**
 * Validate best config from parameter sweep: Top30 / entry0.50 / SL8 / 5pos
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

function getTopSymbolsByVolume(topN: number): string[] {
  const cacheDir = './data/backtest_cache';
  const allSymbols = fs.readdirSync(cacheDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));

  const volumes: { symbol: string; avgVol: number }[] = [];
  for (const sym of allSymbols) {
    try {
      const candles = JSON.parse(fs.readFileSync(path.join(cacheDir, `${sym}.json`), 'utf-8'));
      if (candles.length > 0) {
        const totalVol = candles.reduce((s: number, c: { volume: number }) => s + c.volume, 0);
        volumes.push({ symbol: sym, avgVol: totalVol / candles.length });
      }
    } catch { /* skip */ }
  }

  return volumes.sort((a, b) => b.avgVol - a.avgVol).slice(0, topN).map(v => v.symbol);
}

async function runBacktest(config: BacktestConfig, scoreFn: ScoreFn): Promise<BacktestResult> {
  const engine = new BacktestEngine({ config, scoreFn, dataLoader: new BacktestDataLoader() });
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
    const ws = startMs + i * windowMs;
    const we = ws + windowMs;
    const te = ws + windowMs * trainRatio;

    const trainCfg = { ...config, startDate: new Date(ws).toISOString().split('T')[0], endDate: new Date(te).toISOString().split('T')[0] };
    const testCfg = { ...config, startDate: new Date(te).toISOString().split('T')[0], endDate: new Date(we).toISOString().split('T')[0] };

    console.log(`  Window ${i + 1}/${windows}: train ${trainCfg.startDate}..${trainCfg.endDate} | test ${testCfg.startDate}..${testCfg.endDate}`);

    const trainResult = await runBacktest(trainCfg, scoreFn);
    const testResult = await runBacktest(testCfg, scoreFn);

    const m = testResult.metrics;
    console.log(`    OOS: ${m.totalTrades} trades, ${(m.returnPct * 100).toFixed(2)}% return, ${(m.winRate * 100).toFixed(1)}% WR, Sharpe ${m.sharpeRatio?.toFixed(2) ?? 'N/A'}, PF ${m.profitFactor?.toFixed(2) ?? 'N/A'}`);

    windowResults.push({
      windowIndex: i, trainStart: trainCfg.startDate, trainEnd: trainCfg.endDate,
      testStart: testCfg.startDate, testEnd: testCfg.endDate, trainResult, testResult,
    });
  }

  const tr = windowResults.map(w => w.testResult);
  const avgTestReturn = tr.reduce((s, r) => s + r.metrics.returnPct, 0) / tr.length;
  const sharpes = tr.map(r => r.metrics.sharpeRatio).filter((s): s is number => s != null);
  const avgTestSharpe = sharpes.length > 0 ? sharpes.reduce((a, b) => a + b, 0) / sharpes.length : null;

  return {
    config, windows: windowResults,
    aggregateMetrics: {
      avgTestReturn,
      avgTestSharpe,
      avgTestWinRate: tr.reduce((s, r) => s + r.metrics.winRate, 0) / tr.length,
      avgTestMaxDrawdown: tr.reduce((s, r) => s + r.metrics.maxDrawdownPct, 0) / tr.length,
      totalTestTrades: tr.reduce((s, r) => s + r.metrics.totalTrades, 0),
      oosConsistency: tr.filter(r => r.metrics.returnPct > 0).length / tr.length,
    },
  };
}

async function main() {
  console.log('='.repeat(70));
  console.log('  BEST CONFIG VALIDATION: Top30 / entry0.50 / SL8% / 5 positions');
  console.log('='.repeat(70));

  const symbols = getTopSymbolsByVolume(30);
  console.log(`\nTop 30 by volume: ${symbols.join(', ')}`);

  const config: BacktestConfig = {
    symbols,
    startDate: '2022-06-01',
    endDate: '2026-02-19',
    initialCapital: 10_000,
    maxPositions: 5,
    maxPositionSizePct: 0.30,
    stopLossPct: 0.08,
    takeProfitPct: 0.18,
    entryThreshold: 0.50,
    trailingStop: true,
    commission: 0,
    slippagePct: 0.0015,
    spreadBps: 3,
  };

  const { scoreMultiStrategy } = await import('../src/analysis/technical/strategies.js');
  const scoreFn = scoreMultiStrategy;

  // Full backtest
  console.log('\n' + '─'.repeat(70));
  console.log('  Full Period Backtest');
  console.log('─'.repeat(70));
  const fullResult = await runBacktest(config, scoreFn);
  console.log(generateSummary(fullResult));

  // Walk-forward (6 windows)
  console.log('\n' + '─'.repeat(70));
  console.log('  Walk-Forward Analysis (6 windows, 75/25)');
  console.log('─'.repeat(70));
  const wf = await runWalkForward(config, scoreFn, 6, 0.75);
  const a = wf.aggregateMetrics;
  console.log(`\n  OOS Aggregate: return ${(a.avgTestReturn * 100).toFixed(2)}%, WR ${(a.avgTestWinRate * 100).toFixed(1)}%, Sharpe ${a.avgTestSharpe?.toFixed(2) ?? 'N/A'}, DD ${(a.avgTestMaxDrawdown * 100).toFixed(2)}%, consistency ${(a.oosConsistency * 100).toFixed(0)}%, trades ${a.totalTestTrades}`);

  // Monte Carlo
  console.log('\n' + '─'.repeat(70));
  console.log('  Monte Carlo (10K iterations)');
  console.log('─'.repeat(70));
  const mc = createMonteCarloSimulator();
  const mcResult = mc.simulate(fullResult.trades, { simulations: 10_000 });
  if (mcResult) {
    console.log(mc.formatReport(mcResult));
  }

  // Gates
  console.log('─'.repeat(70));
  console.log('  PROFITABILITY GATES');
  console.log('─'.repeat(70));
  const mcP25 = mcResult?.percentiles.find(p => p.level === 0.25)?.totalReturn ?? null;
  const gates = evaluateProfitabilityGates(fullResult, wf, mcP25);
  console.log(formatGateResults(gates));

  console.log('\n' + '='.repeat(70));
  console.log(`  RESULT: ${gates.approved ? 'ALL GATES PASSED' : `${gates.failedGates.length} GATE(S) FAILED`}`);
  console.log(`  ${gates.passedGates.length}/${gates.passedGates.length + gates.failedGates.length} gates passed`);
  console.log('='.repeat(70));

  process.exit(gates.approved ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(2); });
