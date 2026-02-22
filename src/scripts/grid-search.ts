/**
 * Parallel Grid Search — Wide-Space Backtest (Score-Precomputed)
 *
 * 214 stocks, 2025-01-01 to 2026-02-21, $10k capital.
 * Runs multi-strategy and legacy scorers across a wide parameter grid.
 * Parallelizes by splitting each (strategy × entryThreshold) into a separate worker.
 *
 * Key optimisation: technical scores depend only on (strategy, symbol, date),
 * NOT on stop-loss, take-profit, position sizing, or entry threshold.  Each
 * worker pre-computes the full score matrix once, then runs a lightweight
 * portfolio simulation for each grid combo (~4 600× fewer scorer calls).
 *
 * Usage:
 *   npx tsx src/scripts/grid-search.ts
 *   npx tsx src/scripts/grid-search.ts --strategy multi
 *   npx tsx src/scripts/grid-search.ts --strategy legacy
 *   npx tsx src/scripts/grid-search.ts --workers 8
 */
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── Grid Parameters ─────────────────────────────────────────────────────────

const GRID = {
  entryThreshold: [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8],
  stopLossPct: [0.02, 0.03, 0.04, 0.05, 0.07, 0.1, 0.12, 0.15],
  takeProfitPct: [0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5],
  maxPositions: [3, 5, 10, 15, 20, 30, 40, 50],
  maxPositionSizePct: [0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.25],
};

// ── Fixed Config ────────────────────────────────────────────────────────────

const START_DATE = '2025-01-01';
const END_DATE = '2026-02-21';
const INITIAL_CAPITAL = 10_000;
const SLIPPAGE_PCT = 0.001;
const SPREAD_BPS = 2;
const COMMISSION = 1.0;

const RESULTS_DIR = './data/backtest_results/grid-wide';
const MERGED_CSV = `${RESULTS_DIR}/all_results.csv`;

// ── Discover cached symbols ─────────────────────────────────────────────────

function getCachedSymbols(): string[] {
  const cacheDir = './data/backtest_cache';
  if (!fs.existsSync(cacheDir)) {
    console.error('No backtest cache directory found. Run with --download-only first.');
    process.exit(1);
  }
  return fs
    .readdirSync(cacheDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
    .sort();
}

// ── Argument parsing ────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let strategy: 'multi' | 'legacy' | 'both' = 'both';
  let maxWorkers = Math.max(1, os.cpus().length - 1);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--strategy') {
      const val = args[++i];
      if (val === 'multi' || val === 'legacy' || val === 'both') strategy = val;
    } else if (args[i] === '--workers') {
      maxWorkers = Math.max(1, Number(args[++i]));
    }
  }
  return { strategy, maxWorkers };
}

// ── Compute grid stats ──────────────────────────────────────────────────────

function countCombos(): number {
  return (
    GRID.entryThreshold.length *
    GRID.stopLossPct.length *
    GRID.takeProfitPct.length *
    GRID.maxPositions.length *
    GRID.maxPositionSizePct.length
  );
}

// ── Worker sub-process mode ─────────────────────────────────────────────────
//
// Key optimisation: technical scores depend only on (strategy, symbol, date) —
// NOT on stop-loss, take-profit, position sizing, or entry threshold.  The old
// approach re-computed every indicator for every grid combo (~4 608× redundant).
// Now we pre-compute the full score matrix once, then run a lightweight
// portfolio simulation for each combo (array lookups + arithmetic only).

async function runWorker() {
  const workerArgs = process.argv.slice(2);
  const configIdx = workerArgs.indexOf('--worker-config');
  if (configIdx === -1) process.exit(1);
  const configFile = workerArgs[configIdx + 1];
  const workerConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));

  const symbols: string[] = workerConfig.symbols;
  const strategyMode: 'multi' | 'legacy' = workerConfig.strategy;
  const threshold: number = workerConfig.entryThreshold;
  const outFile: string = workerConfig.outFile;
  const strategyLabel = strategyMode === 'multi' ? 'Multi-Strategy' : 'Legacy';

  // ── Import scorer ──────────────────────────────────────────────────────
  type Candle = {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  type ScoreFn = (candles: Candle[]) => number;
  let scoreFn: ScoreFn;
  let dbPath: string | null = null;

  if (strategyMode === 'multi') {
    const { scoreMultiStrategy } = await import('../analysis/technical/strategies.js');
    scoreFn = scoreMultiStrategy;
  } else {
    // Legacy scorer depends on configManager → needs a DB
    const { initDatabase } = await import('../db/index.js');
    const { configManager } = await import('../config/manager.js');
    dbPath = `./data/grid_worker_${process.pid}.db`;
    try {
      initDatabase(dbPath);
    } catch (_e) {
      // already initialized
    }
    await configManager.seedDefaults();
    const { scoreTechnicals } = await import('../analysis/technical/scorer.js');
    scoreFn = scoreTechnicals;
  }

  // ── Load data ──────────────────────────────────────────────────────────
  const { BacktestDataLoader } = await import('../backtest/data-loader.js');
  const dataLoader = new BacktestDataLoader();
  const allData = await dataLoader.loadMultiple(symbols, START_DATE, END_DATE, true);
  if (allData.size === 0) {
    console.error(`[Worker ${process.pid}] No data loaded, exiting.`);
    process.exit(1);
  }

  // ── Common dates & date-indexed prices ─────────────────────────────────
  const tradingDates = dataLoader.getCommonDates(allData, START_DATE, END_DATE);
  if (tradingDates.length === 0) {
    console.error(`[Worker ${process.pid}] No common trading dates, exiting.`);
    process.exit(1);
  }

  const nDates = tradingDates.length;
  const symbolList = Array.from(allData.keys());
  const nSymbols = symbolList.length;
  const symbolIdx = new Map<string, number>();
  for (let i = 0; i < nSymbols; i++) symbolIdx.set(symbolList[i], i);

  // Flat arrays for per-date per-symbol OHLC (indexed [dateIdx * nSymbols + symbolIdx])
  const opens = new Float64Array(nDates * nSymbols);
  const highs = new Float64Array(nDates * nSymbols);
  const lows = new Float64Array(nDates * nSymbols);
  const closes = new Float64Array(nDates * nSymbols);
  const hasData = new Uint8Array(nDates * nSymbols); // 1 if symbol has data on this date

  const dateToIdx = new Map<string, number>();
  for (let d = 0; d < nDates; d++) dateToIdx.set(tradingDates[d], d);

  for (const [sym, candles] of allData) {
    const si = symbolIdx.get(sym)!;
    for (const c of candles) {
      const di = dateToIdx.get(c.date);
      if (di == null) continue;
      const idx = di * nSymbols + si;
      opens[idx] = c.open;
      highs[idx] = c.high;
      lows[idx] = c.low;
      closes[idx] = c.close;
      hasData[idx] = 1;
    }
  }

  // ── PRE-COMPUTE ALL SCORES ─────────────────────────────────────────────
  // scoreMatrix[si][di] = normalised score (0–1), or -1 = insufficient data
  console.log(
    `  [${strategyLabel} thr=${threshold}] Pre-computing scores (${nSymbols} symbols × ${nDates} dates)...`,
  );
  const scoreT0 = Date.now();
  const scoreMatrix: Float64Array[] = new Array(nSymbols);

  for (let si = 0; si < nSymbols; si++) {
    const candles = allData.get(symbolList[si])!;
    const scores = new Float64Array(nDates).fill(-1);
    // Two-pointer: candles and tradingDates are both sorted by date
    let candleEnd = 0;
    for (let di = 0; di < nDates; di++) {
      const date = tradingDates[di];
      while (candleEnd < candles.length && candles[candleEnd].date <= date) {
        candleEnd++;
      }
      if (candleEnd < 50) continue; // need ≥50 candles for indicators
      scores[di] = scoreFn(candles.slice(0, candleEnd)) / 100;
    }
    scoreMatrix[si] = scores;
  }

  const scoreMs = Date.now() - scoreT0;
  console.log(
    `  [${strategyLabel} thr=${threshold}] Scoring done in ${(scoreMs / 1000).toFixed(1)}s`,
  );

  // ── CSV header ─────────────────────────────────────────────────────────
  const header =
    'Strategy,Entry Threshold,Stop Loss %,Take Profit %,Max Positions,Position Size %,' +
    'Trades,Win Rate %,Return %,Profit Factor,Sharpe Ratio,Sortino Ratio,Calmar Ratio,' +
    'Max Drawdown %,Avg Win $,Avg Loss $,Expectancy $,Best Trade %,Worst Trade %,' +
    'Avg Hold Min,Final Equity';
  fs.writeFileSync(outFile, `${header}\n`);

  // ── Fast simulation loop ──────────────────────────────────────────────
  const totalCombos =
    GRID.stopLossPct.length *
    GRID.takeProfitPct.length *
    GRID.maxPositions.length *
    GRID.maxPositionSizePct.length;
  let runCount = 0;
  const slippageAdj = SLIPPAGE_PCT;
  const spreadAdj = SPREAD_BPS / 20000;
  const csvBuf: string[] = [];

  for (const stopLossPct of GRID.stopLossPct) {
    for (const takeProfitPct of GRID.takeProfitPct) {
      for (const maxPositions of GRID.maxPositions) {
        for (const maxPositionSizePct of GRID.maxPositionSizePct) {
          runCount++;
          if (runCount % 500 === 0 || runCount === 1) {
            process.stdout.write(
              `\r  [${strategyLabel} thr=${threshold}] ${runCount}/${totalCombos} (${((runCount / totalCombos) * 100).toFixed(0)}%)`,
            );
          }

          // ── Per-combo state ─────────────────────────────────
          let cash = INITIAL_CAPITAL;

          // Position tracking — parallel arrays for speed
          const posSym: number[] = []; // symbol indices
          const posShares: number[] = [];
          const posEntry: number[] = []; // adjusted entry price
          const posSL: number[] = [];
          const posTP: number[] = [];
          const posEntryDi: number[] = [];
          const posScore: number[] = [];

          const tradePnls: number[] = [];
          const tradePnlPcts: number[] = [];
          const tradeHoldDays: number[] = [];
          const equityCurve = new Float64Array(nDates);

          // Set of symbols currently held (for O(1) lookup)
          const inPosition = new Uint8Array(nSymbols);

          for (let di = 0; di < nDates; di++) {
            const rowOff = di * nSymbols;

            // 1. Check exits (iterate backwards to allow splice)
            for (let p = posSym.length - 1; p >= 0; p--) {
              const si = posSym[p];
              if (!hasData[rowOff + si]) continue;
              const lo = lows[rowOff + si];
              const hi = highs[rowOff + si];
              let exitPrice = 0;
              let hit = false;

              if (lo <= posSL[p]) {
                exitPrice = posSL[p] * (1 - slippageAdj - spreadAdj);
                hit = true;
              } else if (hi >= posTP[p]) {
                exitPrice = posTP[p] * (1 - slippageAdj - spreadAdj);
                hit = true;
              }

              if (hit) {
                const pnl = (exitPrice - posEntry[p]) * posShares[p] - COMMISSION;
                const pnlPct = (exitPrice - posEntry[p]) / posEntry[p];
                cash += posShares[p] * exitPrice - COMMISSION;
                tradePnls.push(pnl);
                tradePnlPcts.push(pnlPct);
                tradeHoldDays.push(di - posEntryDi[p]);
                inPosition[si] = 0;
                // Remove position (swap with last for O(1))
                const last = posSym.length - 1;
                posSym[p] = posSym[last];
                posShares[p] = posShares[last];
                posEntry[p] = posEntry[last];
                posSL[p] = posSL[last];
                posTP[p] = posTP[last];
                posEntryDi[p] = posEntryDi[last];
                posScore[p] = posScore[last];
                posSym.pop();
                posShares.pop();
                posEntry.pop();
                posSL.pop();
                posTP.pop();
                posEntryDi.pop();
                posScore.pop();
              }
            }

            // 2. Generate entry signals (if room & next day exists)
            if (posSym.length < maxPositions && di + 1 < nDates) {
              // Collect qualifying signals
              const sigSi: number[] = [];
              const sigScore: number[] = [];
              for (let si = 0; si < nSymbols; si++) {
                if (inPosition[si]) continue;
                const sc = scoreMatrix[si][di];
                if (sc < 0 || sc < threshold) continue;
                sigSi.push(si);
                sigScore.push(sc);
              }

              // Sort descending by score (insertion sort — small N)
              for (let i = 1; i < sigSi.length; i++) {
                const si = sigSi[i];
                const sc = sigScore[i];
                let j = i - 1;
                while (j >= 0 && sigScore[j] < sc) {
                  sigSi[j + 1] = sigSi[j];
                  sigScore[j + 1] = sigScore[j];
                  j--;
                }
                sigSi[j + 1] = si;
                sigScore[j + 1] = sc;
              }

              // Execute entries at next day's open
              const nextOff = (di + 1) * nSymbols;
              for (let k = 0; k < sigSi.length; k++) {
                if (posSym.length >= maxPositions) break;
                const si = sigSi[k];
                if (!hasData[nextOff + si]) continue;

                const entryPrice = opens[nextOff + si] * (1 + slippageAdj + spreadAdj);

                // Equity for sizing uses entry-price-based position value
                let posValue = 0;
                for (let p = 0; p < posSym.length; p++) posValue += posEntry[p] * posShares[p];
                const equity = cash + posValue;
                const positionValue = Math.min(maxPositionSizePct * equity, cash);
                if (positionValue <= 0) break;

                const shares = Math.floor(positionValue / entryPrice);
                if (shares <= 0) continue;
                const cost = shares * entryPrice + COMMISSION;
                if (cost > cash) continue;

                cash -= cost;
                posSym.push(si);
                posShares.push(shares);
                posEntry.push(entryPrice);
                posSL.push(entryPrice * (1 - stopLossPct));
                posTP.push(entryPrice * (1 + takeProfitPct));
                posEntryDi.push(di + 1);
                posScore.push(sigScore[k]);
                inPosition[si] = 1;
              }
            }

            // 3. Record equity (positions valued at today's close)
            let posValue = 0;
            for (let p = 0; p < posSym.length; p++) {
              const si = posSym[p];
              posValue += (hasData[rowOff + si] ? closes[rowOff + si] : posEntry[p]) * posShares[p];
            }
            equityCurve[di] = cash + posValue;
          }

          // Close remaining positions at last day's close
          const lastOff = (nDates - 1) * nSymbols;
          for (let p = 0; p < posSym.length; p++) {
            const si = posSym[p];
            if (!hasData[lastOff + si]) continue;
            const exitPrice = closes[lastOff + si] * (1 - slippageAdj - spreadAdj);
            const pnl = (exitPrice - posEntry[p]) * posShares[p] - COMMISSION;
            const pnlPct = (exitPrice - posEntry[p]) / posEntry[p];
            cash += posShares[p] * exitPrice - COMMISSION;
            tradePnls.push(pnl);
            tradePnlPcts.push(pnlPct);
            tradeHoldDays.push(nDates - 1 - posEntryDi[p]);
          }

          // ── Compute metrics ────────────────────────────────
          const totalTrades = tradePnls.length;
          const finalEquity = nDates > 0 ? equityCurve[nDates - 1] : INITIAL_CAPITAL;

          if (totalTrades === 0) {
            csvBuf.push(
              [
                strategyLabel,
                threshold,
                (stopLossPct * 100).toFixed(1),
                (takeProfitPct * 100).toFixed(1),
                maxPositions,
                (maxPositionSizePct * 100).toFixed(1),
                0,
                '0.00',
                '0.00',
                '0',
                '0',
                '0',
                '0',
                '0.00',
                '0',
                '0',
                '0',
                '0',
                '0',
                '0',
                finalEquity.toFixed(2),
              ].join(','),
            );
            continue;
          }

          let grossProfit = 0;
          let grossLoss = 0;
          let winCount = 0;
          for (const p of tradePnls) {
            if (p > 0) {
              grossProfit += p;
              winCount++;
            } else {
              grossLoss -= p; // accumulate absolute loss
            }
          }
          const winRate = winCount / totalTrades;
          const returnPct = (finalEquity - INITIAL_CAPITAL) / INITIAL_CAPITAL;
          const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;
          const avgWin = winCount > 0 ? grossProfit / winCount : 0;
          const lossCount = totalTrades - winCount;
          const avgLoss = lossCount > 0 ? grossLoss / lossCount : 0;
          const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

          // Daily returns → Sharpe, Sortino
          let sharpe = 0;
          let sortino = 0;
          if (nDates >= 6) {
            const rfd = 0.05 / 252;
            let sumExcess = 0;
            let count = 0;
            const excess: number[] = [];
            for (let i = 1; i < nDates; i++) {
              if (equityCurve[i - 1] > 0) {
                const r = (equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1] - rfd;
                excess.push(r);
                sumExcess += r;
                count++;
              }
            }
            if (count >= 5) {
              const mean = sumExcess / count;
              let variance = 0;
              let dsSum = 0;
              let dsCount = 0;
              for (const r of excess) {
                variance += (r - mean) ** 2;
                if (r < 0) {
                  dsSum += r ** 2;
                  dsCount++;
                }
              }
              variance /= count;
              const std = Math.sqrt(variance);
              if (std > 0) sharpe = (mean / std) * Math.sqrt(252);
              if (dsCount > 0) {
                const dsDev = Math.sqrt(dsSum / count);
                if (dsDev > 0) sortino = (mean / dsDev) * Math.sqrt(252);
              }
            }
          }

          // Max drawdown from equity curve
          let peak = equityCurve[0];
          let maxDD = 0;
          for (let i = 0; i < nDates; i++) {
            if (equityCurve[i] > peak) peak = equityCurve[i];
            const dd = (peak - equityCurve[i]) / peak;
            if (dd > maxDD) maxDD = dd;
          }

          // Calmar
          let calmar = 0;
          if (nDates >= 6 && maxDD > 0) {
            let sumDaily = 0;
            let dCount = 0;
            for (let i = 1; i < nDates; i++) {
              if (equityCurve[i - 1] > 0) {
                sumDaily += (equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1];
                dCount++;
              }
            }
            if (dCount > 0) calmar = ((sumDaily / dCount) * 252) / maxDD;
          }

          // Best / worst trade
          let bestPct = -Infinity;
          let worstPct = Infinity;
          for (const p of tradePnlPcts) {
            if (p > bestPct) bestPct = p;
            if (p < worstPct) worstPct = p;
          }

          // Avg hold (in minutes — each day gap ≈ 1440 min, matching engine's Date diff)
          let holdSum = 0;
          for (const d of tradeHoldDays) holdSum += d;
          const avgHoldMin = (holdSum / totalTrades) * 1440;

          csvBuf.push(
            [
              strategyLabel,
              threshold,
              (stopLossPct * 100).toFixed(1),
              (takeProfitPct * 100).toFixed(1),
              maxPositions,
              (maxPositionSizePct * 100).toFixed(1),
              totalTrades,
              (winRate * 100).toFixed(2),
              (returnPct * 100).toFixed(2),
              profitFactor.toFixed(3),
              sharpe.toFixed(3),
              sortino.toFixed(3),
              calmar.toFixed(3),
              (maxDD * 100).toFixed(2),
              avgWin.toFixed(2),
              avgLoss.toFixed(2),
              expectancy.toFixed(2),
              (bestPct * 100).toFixed(2),
              (worstPct * 100).toFixed(2),
              avgHoldMin.toFixed(0),
              finalEquity.toFixed(2),
            ].join(','),
          );
        }
      }
    }
  }

  // Batch-write all CSV lines at once
  if (csvBuf.length > 0) fs.appendFileSync(outFile, `${csvBuf.join('\n')}\n`);

  const totalMs = Date.now() - scoreT0;
  console.log(
    `\n  [${strategyLabel} thr=${threshold}] Done. ${runCount} combos → ${outFile}` +
      ` (scoring: ${(scoreMs / 1000).toFixed(1)}s, sims: ${((totalMs - scoreMs) / 1000).toFixed(1)}s, total: ${(totalMs / 1000).toFixed(1)}s)`,
  );

  // Cleanup worker DB (legacy only)
  if (dbPath) {
    try {
      fs.unlinkSync(dbPath);
    } catch (_e) {
      // ignore
    }
    try {
      fs.unlinkSync(`${dbPath}-wal`);
    } catch (_e) {
      // ignore
    }
    try {
      fs.unlinkSync(`${dbPath}-shm`);
    } catch (_e) {
      // ignore
    }
  }
}

// ── Main orchestrator ───────────────────────────────────────────────────────

async function main() {
  // If we're a forked worker, run worker mode
  if (process.argv.includes('--worker-config')) {
    await runWorker();
    return;
  }

  const { strategy, maxWorkers } = parseArgs();
  const symbols = getCachedSymbols();

  const strategies: ('multi' | 'legacy')[] = strategy === 'both' ? ['multi', 'legacy'] : [strategy];

  const combosPerThreshold =
    GRID.stopLossPct.length *
    GRID.takeProfitPct.length *
    GRID.maxPositions.length *
    GRID.maxPositionSizePct.length;
  const totalJobs = strategies.length * GRID.entryThreshold.length;
  const totalCombos = strategies.length * countCombos();

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║           WIDE-SPACE GRID SEARCH — BACKTEST ENGINE          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n  Symbols:          ${symbols.length} cached stocks`);
  console.log(`  Period:           ${START_DATE} → ${END_DATE}`);
  console.log(`  Capital:          $${INITIAL_CAPITAL.toLocaleString()}`);
  console.log(
    `  Strategies:       ${strategies.map((s) => (s === 'multi' ? 'Multi-Strategy' : 'Legacy')).join(', ')}`,
  );
  console.log(`  Trailing Stop:    Always OFF`);
  console.log(
    `  Slippage:         ${(SLIPPAGE_PCT * 100).toFixed(1)}%  |  Spread: ${SPREAD_BPS} bps  |  Commission: $${COMMISSION}`,
  );
  console.log(`\n  Grid dimensions:`);
  console.log(
    `    Entry Threshold:  ${GRID.entryThreshold.join(', ')}  (${GRID.entryThreshold.length})`,
  );
  console.log(
    `    Stop Loss %:      ${GRID.stopLossPct.map((v) => `${(v * 100).toFixed(0)}%`).join(', ')}  (${GRID.stopLossPct.length})`,
  );
  console.log(
    `    Take Profit %:    ${GRID.takeProfitPct.map((v) => `${(v * 100).toFixed(0)}%`).join(', ')}  (${GRID.takeProfitPct.length})`,
  );
  console.log(
    `    Max Positions:    ${GRID.maxPositions.join(', ')}  (${GRID.maxPositions.length})`,
  );
  console.log(
    `    Position Size %:  ${GRID.maxPositionSizePct.map((v) => `${(v * 100).toFixed(0)}%`).join(', ')}  (${GRID.maxPositionSizePct.length})`,
  );
  console.log(`\n  Combos/threshold:  ${combosPerThreshold.toLocaleString()}`);
  console.log(`  Total combos:      ${totalCombos.toLocaleString()}`);
  console.log(`  Parallel jobs:     ${totalJobs} (max ${maxWorkers} concurrent)`);
  console.log(`  Results dir:       ${RESULTS_DIR}`);
  console.log('');

  // Create results directory
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  // Build job list
  interface Job {
    strategy: 'multi' | 'legacy';
    threshold: number;
    outFile: string;
    configFile: string;
  }

  const jobs: Job[] = [];
  for (const strat of strategies) {
    for (const threshold of GRID.entryThreshold) {
      const label = strat === 'multi' ? 'multi' : 'legacy';
      const thrLabel = (threshold * 100).toFixed(0).padStart(2, '0');
      const outFile = `${RESULTS_DIR}/results-${label}-${thrLabel}.csv`;
      const configFile = `${RESULTS_DIR}/.worker-${label}-${thrLabel}.json`;

      // Write worker config
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          strategy: strat,
          entryThreshold: threshold,
          symbols,
          outFile,
        }),
      );

      jobs.push({ strategy: strat, threshold, outFile, configFile });
    }
  }

  // Run jobs with concurrency limit
  const startTime = Date.now();
  let completed = 0;

  async function runJob(job: Job): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = fork(process.argv[1], ['--worker-config', job.configFile], {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });
      child.on('exit', (code) => {
        completed++;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const pct = ((completed / jobs.length) * 100).toFixed(0);
        console.log(`  ✓ Job ${completed}/${jobs.length} (${pct}%) done [${elapsed}s elapsed]`);
        // Clean up config file
        try {
          fs.unlinkSync(job.configFile);
        } catch (_e) {
          // ignore
        }
        if (code === 0) resolve();
        else reject(new Error(`Worker exited with code ${code}`));
      });
      child.on('error', reject);
    });
  }

  // Semaphore-style concurrency
  const running: Promise<void>[] = [];
  for (const job of jobs) {
    const p = runJob(job);
    running.push(p);
    if (running.length >= maxWorkers) {
      await Promise.race(running);
      // Remove settled promises
      for (let i = running.length - 1; i >= 0; i--) {
        const settled = await Promise.race([running[i].then(() => true), Promise.resolve(false)]);
        if (settled) running.splice(i, 1);
      }
    }
  }
  await Promise.all(running);

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);

  // ── Merge all CSV files ─────────────────────────────────────────────────

  console.log('\n  Merging results...');
  const csvFiles = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith('results-') && f.endsWith('.csv'))
    .map((f) => path.join(RESULTS_DIR, f))
    .sort();

  const header =
    'Strategy,Entry Threshold,Stop Loss %,Take Profit %,Max Positions,Position Size %,' +
    'Trades,Win Rate %,Return %,Profit Factor,Sharpe Ratio,Sortino Ratio,Calmar Ratio,' +
    'Max Drawdown %,Avg Win $,Avg Loss $,Expectancy $,Best Trade %,Worst Trade %,' +
    'Avg Hold Min,Final Equity';
  const allLines: string[] = [header];
  for (const f of csvFiles) {
    const lines = fs.readFileSync(f, 'utf-8').trim().split('\n');
    // Skip header line
    allLines.push(...lines.slice(1));
  }
  fs.writeFileSync(MERGED_CSV, `${allLines.join('\n')}\n`);

  // ── Analysis ────────────────────────────────────────────────────────────

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                       GRID SEARCH RESULTS                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Parse all results
  interface Result {
    strategy: string;
    entryThreshold: number;
    stopLossPct: number;
    takeProfitPct: number;
    maxPositions: number;
    positionSizePct: number;
    trades: number;
    winRate: number;
    returnPct: number;
    profitFactor: number;
    sharpe: number;
    sortino: number;
    calmar: number;
    maxDD: number;
    avgWin: number;
    avgLoss: number;
    expectancy: number;
    bestTrade: number;
    worstTrade: number;
    avgHoldMin: number;
    finalEquity: number;
  }

  const results: Result[] = [];
  for (const line of allLines.slice(1)) {
    const cols = line.split(',');
    if (cols.length < 21) continue;
    results.push({
      strategy: cols[0],
      entryThreshold: Number(cols[1]),
      stopLossPct: Number(cols[2]),
      takeProfitPct: Number(cols[3]),
      maxPositions: Number(cols[4]),
      positionSizePct: Number(cols[5]),
      trades: Number(cols[6]),
      winRate: Number(cols[7]),
      returnPct: Number(cols[8]),
      profitFactor: Number(cols[9]),
      sharpe: Number(cols[10]),
      sortino: Number(cols[11]),
      calmar: Number(cols[12]),
      maxDD: Number(cols[13]),
      avgWin: Number(cols[14]),
      avgLoss: Number(cols[15]),
      expectancy: Number(cols[16]),
      bestTrade: Number(cols[17]),
      worstTrade: Number(cols[18]),
      avgHoldMin: Number(cols[19]),
      finalEquity: Number(cols[20]),
    });
  }

  console.log(`\n  Total results:     ${results.length.toLocaleString()}`);
  console.log(`  Total time:        ${totalElapsed}s`);

  // Filter to meaningful results (at least 10 trades)
  const meaningful = results.filter((r) => r.trades >= 10);
  console.log(`  Meaningful (≥10 trades): ${meaningful.length.toLocaleString()}`);

  // ── Top 20 by Return × Profit Factor ──────────────────────────────────

  const byScore = [...meaningful]
    .map((r) => ({ ...r, score: r.returnPct * Math.max(r.profitFactor, 0) }))
    .sort((a, b) => b.score - a.score);

  console.log('\n  ═══ TOP 20 BY RETURN × PROFIT FACTOR ═══\n');
  console.log(
    '  # │ Strategy       │ Thr  │  SL% │  TP% │ Pos │ Size% │ Trades │ WinR% │ Return% │    PF │ Sharpe │ MaxDD% │ Final $',
  );
  console.log(
    '  ──┼────────────────┼──────┼──────┼──────┼─────┼───────┼────────┼───────┼─────────┼───────┼────────┼────────┼────────',
  );
  for (let i = 0; i < Math.min(20, byScore.length); i++) {
    const r = byScore[i];
    console.log(
      `  ${String(i + 1).padStart(2)} │ ${r.strategy.padEnd(14)} │ ${r.entryThreshold.toFixed(2)} │ ${r.stopLossPct.toFixed(1).padStart(4)} │ ${r.takeProfitPct.toFixed(1).padStart(4)} │ ${String(r.maxPositions).padStart(3)} │ ${r.positionSizePct.toFixed(1).padStart(5)} │ ${String(r.trades).padStart(6)} │ ${r.winRate.toFixed(1).padStart(5)} │ ${r.returnPct.toFixed(1).padStart(7)} │ ${r.profitFactor.toFixed(2).padStart(5)} │ ${r.sharpe.toFixed(2).padStart(6)} │ ${r.maxDD.toFixed(1).padStart(6)} │ ${r.finalEquity.toFixed(0).padStart(7)}`,
    );
  }

  // ── Top 20 by Sharpe Ratio ────────────────────────────────────────────

  const bySharpe = [...meaningful].sort((a, b) => b.sharpe - a.sharpe);

  console.log('\n  ═══ TOP 20 BY SHARPE RATIO ═══\n');
  console.log(
    '  # │ Strategy       │ Thr  │  SL% │  TP% │ Pos │ Size% │ Trades │ WinR% │ Return% │    PF │ Sharpe │ MaxDD% │ Final $',
  );
  console.log(
    '  ──┼────────────────┼──────┼──────┼──────┼─────┼───────┼────────┼───────┼─────────┼───────┼────────┼────────┼────────',
  );
  for (let i = 0; i < Math.min(20, bySharpe.length); i++) {
    const r = bySharpe[i];
    console.log(
      `  ${String(i + 1).padStart(2)} │ ${r.strategy.padEnd(14)} │ ${r.entryThreshold.toFixed(2)} │ ${r.stopLossPct.toFixed(1).padStart(4)} │ ${r.takeProfitPct.toFixed(1).padStart(4)} │ ${String(r.maxPositions).padStart(3)} │ ${r.positionSizePct.toFixed(1).padStart(5)} │ ${String(r.trades).padStart(6)} │ ${r.winRate.toFixed(1).padStart(5)} │ ${r.returnPct.toFixed(1).padStart(7)} │ ${r.profitFactor.toFixed(2).padStart(5)} │ ${r.sharpe.toFixed(2).padStart(6)} │ ${r.maxDD.toFixed(1).padStart(6)} │ ${r.finalEquity.toFixed(0).padStart(7)}`,
    );
  }

  // ── Top 20 by Risk-Adjusted (Return / MaxDD) ─────────────────────────

  const byRiskAdj = [...meaningful]
    .filter((r) => r.maxDD > 0)
    .map((r) => ({ ...r, riskAdj: r.returnPct / r.maxDD }))
    .sort((a, b) => b.riskAdj - a.riskAdj);

  console.log('\n  ═══ TOP 20 BY RISK-ADJUSTED RETURN (Return% / MaxDD%) ═══\n');
  console.log(
    '  # │ Strategy       │ Thr  │  SL% │  TP% │ Pos │ Size% │ Trades │ WinR% │ Return% │    PF │ Sharpe │ MaxDD% │ R/DD',
  );
  console.log(
    '  ──┼────────────────┼──────┼──────┼──────┼─────┼───────┼────────┼───────┼─────────┼───────┼────────┼────────┼──────',
  );
  for (let i = 0; i < Math.min(20, byRiskAdj.length); i++) {
    const r = byRiskAdj[i];
    console.log(
      `  ${String(i + 1).padStart(2)} │ ${r.strategy.padEnd(14)} │ ${r.entryThreshold.toFixed(2)} │ ${r.stopLossPct.toFixed(1).padStart(4)} │ ${r.takeProfitPct.toFixed(1).padStart(4)} │ ${String(r.maxPositions).padStart(3)} │ ${r.positionSizePct.toFixed(1).padStart(5)} │ ${String(r.trades).padStart(6)} │ ${r.winRate.toFixed(1).padStart(5)} │ ${r.returnPct.toFixed(1).padStart(7)} │ ${r.profitFactor.toFixed(2).padStart(5)} │ ${r.sharpe.toFixed(2).padStart(6)} │ ${r.maxDD.toFixed(1).padStart(6)} │ ${r.riskAdj.toFixed(2).padStart(5)}`,
    );
  }

  // ── Strategy Comparison ───────────────────────────────────────────────

  for (const strat of ['Multi-Strategy', 'Legacy'] as const) {
    const stratResults = meaningful.filter((r) => r.strategy === strat);
    if (stratResults.length === 0) continue;

    const profitable = stratResults.filter((r) => r.returnPct > 0);
    const avgReturn = stratResults.reduce((s, r) => s + r.returnPct, 0) / stratResults.length;
    const avgSharpe = stratResults.reduce((s, r) => s + r.sharpe, 0) / stratResults.length;
    const avgPF = stratResults.reduce((s, r) => s + r.profitFactor, 0) / stratResults.length;
    const medianReturn = [...stratResults].sort((a, b) => a.returnPct - b.returnPct)[
      Math.floor(stratResults.length / 2)
    ].returnPct;

    console.log(`\n  ═══ ${strat.toUpperCase()} SUMMARY ═══`);
    console.log(`    Total configs tested: ${stratResults.length.toLocaleString()}`);
    console.log(
      `    Profitable configs:   ${profitable.length} (${((profitable.length / stratResults.length) * 100).toFixed(1)}%)`,
    );
    console.log(`    Avg Return:           ${avgReturn.toFixed(2)}%`);
    console.log(`    Median Return:        ${medianReturn.toFixed(2)}%`);
    console.log(`    Avg Sharpe:           ${avgSharpe.toFixed(3)}`);
    console.log(`    Avg Profit Factor:    ${avgPF.toFixed(3)}`);
  }

  // ── Parameter Sensitivity Analysis ────────────────────────────────────

  console.log('\n  ═══ PARAMETER SENSITIVITY (avg return by parameter value) ═══\n');

  // Entry Threshold
  console.log('  Entry Threshold:');
  for (const t of GRID.entryThreshold) {
    const subset = meaningful.filter((r) => r.entryThreshold === t);
    if (subset.length === 0) continue;
    const avg = subset.reduce((s, r) => s + r.returnPct, 0) / subset.length;
    const bar =
      avg > 0
        ? '█'.repeat(Math.min(40, Math.round(avg / 2)))
        : '░'.repeat(Math.min(40, Math.round(Math.abs(avg) / 2)));
    console.log(
      `    ${t.toFixed(2)} │ ${avg.toFixed(1).padStart(7)}% │ ${bar}  (n=${subset.length})`,
    );
  }

  // Stop Loss
  console.log('\n  Stop Loss %:');
  for (const sl of GRID.stopLossPct) {
    const subset = meaningful.filter((r) => r.stopLossPct === sl * 100);
    if (subset.length === 0) continue;
    const avg = subset.reduce((s, r) => s + r.returnPct, 0) / subset.length;
    const bar =
      avg > 0
        ? '█'.repeat(Math.min(40, Math.round(avg / 2)))
        : '░'.repeat(Math.min(40, Math.round(Math.abs(avg) / 2)));
    console.log(
      `    ${(sl * 100).toFixed(0).padStart(3)}% │ ${avg.toFixed(1).padStart(7)}% │ ${bar}  (n=${subset.length})`,
    );
  }

  // Take Profit
  console.log('\n  Take Profit %:');
  for (const tp of GRID.takeProfitPct) {
    const subset = meaningful.filter((r) => r.takeProfitPct === tp * 100);
    if (subset.length === 0) continue;
    const avg = subset.reduce((s, r) => s + r.returnPct, 0) / subset.length;
    const bar =
      avg > 0
        ? '█'.repeat(Math.min(40, Math.round(avg / 2)))
        : '░'.repeat(Math.min(40, Math.round(Math.abs(avg) / 2)));
    console.log(
      `    ${(tp * 100).toFixed(0).padStart(3)}% │ ${avg.toFixed(1).padStart(7)}% │ ${bar}  (n=${subset.length})`,
    );
  }

  // Max Positions
  console.log('\n  Max Positions:');
  for (const mp of GRID.maxPositions) {
    const subset = meaningful.filter((r) => r.maxPositions === mp);
    if (subset.length === 0) continue;
    const avg = subset.reduce((s, r) => s + r.returnPct, 0) / subset.length;
    const bar =
      avg > 0
        ? '█'.repeat(Math.min(40, Math.round(avg / 2)))
        : '░'.repeat(Math.min(40, Math.round(Math.abs(avg) / 2)));
    console.log(
      `    ${String(mp).padStart(3)}  │ ${avg.toFixed(1).padStart(7)}% │ ${bar}  (n=${subset.length})`,
    );
  }

  // Position Size
  console.log('\n  Position Size %:');
  for (const ps of GRID.maxPositionSizePct) {
    const subset = meaningful.filter((r) => r.positionSizePct === ps * 100);
    if (subset.length === 0) continue;
    const avg = subset.reduce((s, r) => s + r.returnPct, 0) / subset.length;
    const bar =
      avg > 0
        ? '█'.repeat(Math.min(40, Math.round(avg / 2)))
        : '░'.repeat(Math.min(40, Math.round(Math.abs(avg) / 2)));
    console.log(
      `    ${(ps * 100).toFixed(0).padStart(3)}% │ ${avg.toFixed(1).padStart(7)}% │ ${bar}  (n=${subset.length})`,
    );
  }

  // ── Best Config Recommendation ────────────────────────────────────────

  if (byScore.length > 0) {
    const best = byScore[0];
    const bestSharpeR = bySharpe[0];
    const bestRisk = byRiskAdj[0];

    console.log('\n  ═══ RECOMMENDED CONFIGURATIONS ═══\n');
    console.log('  Best Overall (Return × PF):');
    console.log(`    Strategy:       ${best.strategy}`);
    console.log(`    Entry Threshold: ${best.entryThreshold}`);
    console.log(`    Stop Loss:      ${best.stopLossPct}%`);
    console.log(`    Take Profit:    ${best.takeProfitPct}%`);
    console.log(`    Max Positions:  ${best.maxPositions}`);
    console.log(`    Position Size:  ${best.positionSizePct}%`);
    console.log(
      `    → Return: ${best.returnPct.toFixed(1)}% | PF: ${best.profitFactor.toFixed(2)} | Sharpe: ${best.sharpe.toFixed(2)} | MaxDD: ${best.maxDD.toFixed(1)}% | Final: $${best.finalEquity.toFixed(0)}`,
    );

    console.log('\n  Best Sharpe Ratio:');
    console.log(`    Strategy:       ${bestSharpeR.strategy}`);
    console.log(`    Entry Threshold: ${bestSharpeR.entryThreshold}`);
    console.log(`    Stop Loss:      ${bestSharpeR.stopLossPct}%`);
    console.log(`    Take Profit:    ${bestSharpeR.takeProfitPct}%`);
    console.log(`    Max Positions:  ${bestSharpeR.maxPositions}`);
    console.log(`    Position Size:  ${bestSharpeR.positionSizePct}%`);
    console.log(
      `    → Return: ${bestSharpeR.returnPct.toFixed(1)}% | PF: ${bestSharpeR.profitFactor.toFixed(2)} | Sharpe: ${bestSharpeR.sharpe.toFixed(2)} | MaxDD: ${bestSharpeR.maxDD.toFixed(1)}% | Final: $${bestSharpeR.finalEquity.toFixed(0)}`,
    );

    console.log('\n  Best Risk-Adjusted (Return/MaxDD):');
    console.log(`    Strategy:       ${bestRisk.strategy}`);
    console.log(`    Entry Threshold: ${bestRisk.entryThreshold}`);
    console.log(`    Stop Loss:      ${bestRisk.stopLossPct}%`);
    console.log(`    Take Profit:    ${bestRisk.takeProfitPct}%`);
    console.log(`    Max Positions:  ${bestRisk.maxPositions}`);
    console.log(`    Position Size:  ${bestRisk.positionSizePct}%`);
    console.log(
      `    → Return: ${bestRisk.returnPct.toFixed(1)}% | PF: ${bestRisk.profitFactor.toFixed(2)} | Sharpe: ${bestRisk.sharpe.toFixed(2)} | MaxDD: ${bestRisk.maxDD.toFixed(1)}% | R/DD: ${bestRisk.riskAdj.toFixed(2)}`,
    );
  }

  console.log(`\n  Full results: ${MERGED_CSV}`);
  console.log(`  Per-slice CSVs: ${RESULTS_DIR}/results-*.csv`);
  console.log(`  Total time: ${totalElapsed}s\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
