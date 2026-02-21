import fs from 'node:fs';
import path from 'node:path';
import { BacktestDataLoader } from '../backtest/data-loader.js';
import { createBacktestEngine } from '../backtest/engine.js';
import { ALL_SECTORS_SYMBOLS } from '../backtest/sectors.js';
import type { BacktestConfig, BacktestMetrics } from '../backtest/types.js';
import { configManager } from '../config/manager.js';
import { initDatabase } from '../db/index.js';

// --- Configuration Interfaces ---

interface BacktestGrid {
  entryThreshold: number[];
  stopLossPct: number[];
  takeProfitPct: number[];
  trailingStop: boolean[];
  maxPositions: number[];
  maxPositionSizePct: number[];
  roiTable: (Record<string, number> | null)[]; // Allow disabling ROI exits
}

interface BacktestRunConfig {
  symbols?: string[];
  startDate: string;
  endDate: string;
  initialCapital: number;
  resultsFile: string;
  grid: BacktestGrid;
}

// Default Configuration
const DEFAULT_CONFIG: BacktestRunConfig = {
  // Use S&P 500 representative set by default
  symbols: ALL_SECTORS_SYMBOLS,
  startDate: '2023-01-01',
  endDate: '2026-01-31',
  initialCapital: 50000,
  resultsFile: './data/backtest_results/latest_results.csv',
  // Default Grid: "World Class" configuration
  grid: {
    entryThreshold: [0.55],
    stopLossPct: [0.04],
    takeProfitPct: [0.2],
    trailingStop: [false],
    maxPositions: [20],
    maxPositionSizePct: [0.05],
    roiTable: [null], // Disabled by default
  },
};

// --- Helper Functions ---

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toCsvLine = (config: BacktestConfig, metrics: BacktestMetrics) => {
  const roiDesc = config.roiTable ? 'Active' : 'None';
  return [
    config.entryThreshold,
    config.stopLossPct,
    config.takeProfitPct ?? 'Trailing',
    config.trailingStop,
    config.maxPositions,
    config.maxPositionSizePct,
    roiDesc,
    metrics.totalTrades,
    (metrics.winRate * 100).toFixed(2),
    (metrics.returnPct * 100).toFixed(2),
    metrics.profitFactor?.toFixed(2) ?? '0.00',
    metrics.sharpeRatio?.toFixed(2) ?? '0.00',
    (metrics.maxDrawdownPct * 100).toFixed(2),
  ].join(',');
};

function printResultTable(result: { metrics: BacktestMetrics }) {
  const m = result.metrics;
  console.log('\n┌──────────────────────────────┬──────────────────┐');
  console.log('│ Metric                       │ Value            │');
  console.log('├──────────────────────────────┼──────────────────┤');
  console.log(`│ Total Return                 │ ${(m.returnPct * 100).toFixed(2)}%          │`);
  console.log(
    `│ Profit Factor                │ ${m.profitFactor?.toFixed(2) ?? 'N/A'}             │`,
  );
  console.log(`│ Win Rate                     │ ${(m.winRate * 100).toFixed(2)}%           │`);
  console.log(`│ Total Trades                 │ ${m.totalTrades.toString().padEnd(16)} │`);
  console.log(
    `│ Max Drawdown                 │ ${(m.maxDrawdownPct * 100).toFixed(2)}%           │`,
  );
  console.log(
    `│ Sharpe Ratio                 │ ${m.sharpeRatio?.toFixed(2) ?? 'N/A'}             │`,
  );
  console.log(
    `│ Expectancy                   │ ${m.expectancy?.toFixed(2) ?? 'N/A'}             │`,
  );
  console.log(`│ Avg Win                      │ $${m.avgWin?.toFixed(2) ?? 'N/A'}          │`);
  console.log(`│ Avg Loss                     │ $${m.avgLoss?.toFixed(2) ?? 'N/A'}          │`);
  console.log('└──────────────────────────────┴──────────────────┘');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const config: Partial<BacktestRunConfig> = {};
  let downloadOnly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config') {
      const configFile = args[++i];
      if (fs.existsSync(configFile)) {
        try {
          const fileConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
          Object.assign(config, fileConfig);
          console.log(`Loaded config from ${configFile}`);
        } catch (e) {
          console.error(`Failed to load config from ${configFile}:`, e);
        }
      } else {
        console.error(`Config file not found: ${configFile}`);
      }
    } else if (arg === '--download-only') {
      downloadOnly = true;
    } else if (arg === '--startDate') {
      config.startDate = args[++i];
    } else if (arg === '--endDate') {
      config.endDate = args[++i];
    } else if (arg === '--capital') {
      config.initialCapital = Number(args[++i]);
    } else if (arg === '--symbols') {
      config.symbols = args[++i].split(',').map((s) => s.trim());
    }
  }

  return { config, downloadOnly };
}

// --- Main Pipeline ---

async function runBacktest() {
  console.log('\n🚀 Starting Backtest Engine...');
  console.log('Initializing database...');
  try {
    initDatabase('./data/backtest_large.db');
  } catch (_e) {
    // Database might already be initialized
  }

  await configManager.seedDefaults();

  // Parse arguments and merge with default config
  const { config: argConfig, downloadOnly } = parseArgs();
  const runConfig: BacktestRunConfig = {
    ...DEFAULT_CONFIG,
    ...argConfig,
    grid: {
      ...DEFAULT_CONFIG.grid,
      ...(argConfig.grid || {}),
    },
  };

  // If symbols is explicitly null/undefined in argConfig, use default, but if it's empty array, use it?
  // The merge above handles it if argConfig.symbols is undefined.
  // If user passed specific symbols via --symbols, it overrides everything.

  console.log(`\n📊 Configuration:`);
  console.log(
    `   - Symbols: ${runConfig.symbols?.length ?? 0} ${runConfig.symbols === ALL_SECTORS_SYMBOLS ? '(Default S&P 500 Subset)' : '(Custom)'}`,
  );
  console.log(`   - Period:  ${runConfig.startDate} to ${runConfig.endDate}`);
  console.log(`   - Capital: $${runConfig.initialCapital.toLocaleString()}`);
  if (downloadOnly) {
    console.log(`   - Mode:    DOWNLOAD ONLY`);
  }

  // Ensure results directory exists
  const resultsDir = path.dirname(runConfig.resultsFile);
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  console.log(
    `\n📥 Pre-loading market data${downloadOnly ? ' (downloading from Yahoo)' : ' (from cache)'}...`,
  );
  const dataLoader = new BacktestDataLoader();
  const allData = new Map();
  const symbols = runConfig.symbols ?? [];

  // In normal backtest mode, only use cached data (no network calls).
  // In download-only mode, fetch from Yahoo and save to cache.
  const cacheOnly = !downloadOnly;

  // Batch loading
  const BATCH_SIZE = 20;

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    process.stdout.write(
      `   Loading batch ${Math.ceil((i + 1) / BATCH_SIZE)}/${Math.ceil(symbols.length / BATCH_SIZE)}... `,
    );
    try {
      const batchData = await dataLoader.loadMultiple(
        batch,
        runConfig.startDate,
        runConfig.endDate,
        cacheOnly,
      );
      for (const [key, val] of batchData) {
        allData.set(key, val);
      }
      console.log(`OK (${batchData.size} loaded)`);
    } catch (error) {
      console.log(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!cacheOnly) await sleep(250);
  }

  console.log(`\n✅ Data loaded for ${allData.size} symbols.`);

  if (downloadOnly) {
    console.log('Download complete. Exiting.');
    return;
  }

  console.log(`   Starting Simulation...`);

  // Override loader to use memory cache
  dataLoader.loadMultiple = async (syms) => {
    const subset = new Map();
    for (const s of syms) {
      if (allData.has(s)) subset.set(s, allData.get(s));
    }
    return subset;
  };

  const header =
    'Entry Threshold,Stop Loss,Take Profit,Trailing Stop,Max Pos,Size %,ROI,Trades,Win Rate %,Return %,Profit Factor,Sharpe Ratio,Max Drawdown %';

  const grid = {
    entryThreshold: runConfig.grid.entryThreshold ?? [0.55],
    stopLossPct: runConfig.grid.stopLossPct ?? [0.04],
    takeProfitPct: runConfig.grid.takeProfitPct ?? [0.2],
    trailingStop: runConfig.grid.trailingStop ?? [false],
    maxPositions: runConfig.grid.maxPositions ?? [20],
    maxPositionSizePct: runConfig.grid.maxPositionSizePct ?? [0.05],
    roiTable: runConfig.grid.roiTable ?? [null],
  };

  const isSingleRun =
    grid.entryThreshold.length === 1 &&
    grid.stopLossPct.length === 1 &&
    grid.takeProfitPct.length === 1 &&
    grid.trailingStop.length === 1 &&
    grid.maxPositions.length === 1 &&
    grid.maxPositionSizePct.length === 1 &&
    grid.roiTable.length === 1;

  // Reset results file for a clean run if single config, otherwise append
  // Actually, if we are running a new backtest, we probably want to clear previous results unless explicitly appending?
  // Let's stick to the previous logic: if single run, overwrite. If grid, check if exists.
  if (isSingleRun) {
    fs.writeFileSync(runConfig.resultsFile, `${header}\n`);
  } else if (!fs.existsSync(runConfig.resultsFile)) {
    fs.writeFileSync(runConfig.resultsFile, `${header}\n`);
  }

  let bestResult: { config: BacktestConfig; metrics: BacktestMetrics } | null = null;
  const totalCombinations =
    grid.entryThreshold.length *
    grid.stopLossPct.length *
    grid.takeProfitPct.length *
    grid.trailingStop.length *
    grid.maxPositions.length *
    grid.maxPositionSizePct.length *
    grid.roiTable.length;

  let runCount = 0;

  for (const entryThreshold of grid.entryThreshold) {
    for (const stopLossPct of grid.stopLossPct) {
      for (const takeProfitPct of grid.takeProfitPct) {
        for (const trailingStop of grid.trailingStop) {
          for (const maxPositions of grid.maxPositions) {
            for (const maxPositionSizePct of grid.maxPositionSizePct) {
              for (const roiTable of grid.roiTable) {
                // Skip invalid combinations if necessary, though current logic handles it
                // Note: In previous code, we had logic to skip undefined TP if not trailing.
                // The grid types here assume numbers, so let's check for "undefined" or handling trailing separately if needed.
                // For now, trailingStop implies we might not use fixed TP, but the grid has TP values.
                // If the user wants trailing stop ONLY, they might set TP to a very high value or we need logic.
                // The engine logic usually prioritizes TP if set.

                runCount++;
                if (totalCombinations > 1) {
                  console.log(
                    `\n▶ Run ${runCount}/${totalCombinations} | Thr: ${entryThreshold} | SL: ${stopLossPct} | TP: ${takeProfitPct} | Tr: ${trailingStop} | Pos: ${maxPositions} | Sz: ${maxPositionSizePct} | ROI: ${roiTable ? 'Yes' : 'No'}`,
                  );
                }

                const config: BacktestConfig = {
                  symbols: Array.from(allData.keys()),
                  startDate: runConfig.startDate,
                  endDate: runConfig.endDate,
                  initialCapital: runConfig.initialCapital,
                  maxPositions,
                  maxPositionSizePct,
                  stopLossPct,
                  takeProfitPct,
                  trailingStop,
                  commission: 1.0,
                  entryThreshold,
                  slippagePct: 0.001,
                  spreadBps: 2,
                  roiTable: roiTable as Record<string, number> | undefined,
                };

                try {
                  const engine = await createBacktestEngine(config, dataLoader);
                  const result = await engine.run();

                  const csvLine = toCsvLine(config, result.metrics);
                  fs.appendFileSync(runConfig.resultsFile, `${csvLine}\n`);

                  const score = result.metrics.returnPct * (result.metrics.profitFactor || 0);
                  if (
                    !bestResult ||
                    score > bestResult.metrics.returnPct * (bestResult.metrics.profitFactor || 0)
                  ) {
                    bestResult = { config, metrics: result.metrics };
                  }

                  if (isSingleRun) {
                    printResultTable(result);
                  } else {
                    console.log(
                      `   Result: ${(result.metrics.returnPct * 100).toFixed(2)}% Return | PF: ${result.metrics.profitFactor?.toFixed(2)}`,
                    );
                  }
                } catch (error) {
                  console.log(
                    `   Failed: ${error instanceof Error ? error.message : String(error)}`,
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  if (!isSingleRun && bestResult) {
    console.log('\n🏆 *** BEST CONFIGURATION ***');
    console.log(`Entry Threshold: ${bestResult.config.entryThreshold}`);
    console.log(`Stop Loss: ${(bestResult.config.stopLossPct * 100).toFixed(1)}%`);
    console.log(
      `Take Profit: ${bestResult.config.takeProfitPct ? `${(bestResult.config.takeProfitPct * 100).toFixed(1)}%` : 'Trailing Only'}`,
    );
    console.log(`Max Pos: ${bestResult.config.maxPositions}`);
    console.log(`Size %: ${(bestResult.config.maxPositionSizePct * 100).toFixed(1)}%`);
    console.log(`ROI Table: ${bestResult.config.roiTable ? 'Yes' : 'No'}`);
    printResultTable(bestResult);
  }

  console.log(`\n💾 Results saved to: ${runConfig.resultsFile}`);
}

runBacktest();
