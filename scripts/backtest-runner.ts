/**
 * Single-config backtest runner. All params via env vars.
 * Outputs one JSON line to stdout.
 *
 * Env vars:
 *   BT_SYMBOLS          comma-separated tickers
 *   BT_START            YYYY-MM-DD
 *   BT_END              YYYY-MM-DD
 *   BT_CAPITAL          number (default 10000)
 *   BT_ENTRY_THRESHOLD  0.0–1.0 (default 0.55)
 *   BT_STOP_LOSS        0.01–0.20 (default 0.07)
 *   BT_TAKE_PROFIT      0.05–0.50 (default 0.20)
 *   BT_TRAILING_STOP    true|false (default true)
 *   BT_MAX_POSITIONS    integer (default 5)
 *   BT_MAX_POS_SIZE_PCT 0.05–0.50 (default 0.15)
 *   BT_COMMISSION       number (default 0)
 *   BT_LABEL            descriptive label
 */
import 'dotenv/config';
import { initDatabase } from '../src/db/index.js';
import { createBacktestEngine } from '../src/backtest/engine.js';
import type { BacktestConfig } from '../src/backtest/types.js';

const e = process.env;

const SYMBOLS = (e.BT_SYMBOLS ?? 'AAPL,MSFT,NVDA,TSLA,AMZN,META,GOOGL,JPM,V,UNH').split(',');
const START   = e.BT_START ?? '2023-01-01';
const END     = e.BT_END   ?? '2024-12-31';

const config: BacktestConfig = {
  symbols:            SYMBOLS,
  startDate:          START,
  endDate:            END,
  initialCapital:     Number(e.BT_CAPITAL          ?? 10000),
  entryThreshold:     Number(e.BT_ENTRY_THRESHOLD  ?? 0.55),
  stopLossPct:        Number(e.BT_STOP_LOSS        ?? 0.07),
  takeProfitPct:      Number(e.BT_TAKE_PROFIT      ?? 0.20),
  trailingStop:       (e.BT_TRAILING_STOP ?? 'true') === 'true',
  maxPositions:       Number(e.BT_MAX_POSITIONS    ?? 5),
  maxPositionSizePct: Number(e.BT_MAX_POS_SIZE_PCT ?? 0.15),
  commission:         Number(e.BT_COMMISSION       ?? 0),
  slippagePct:        0.001,
  spreadBps:          5,
};

// suppress all log output — only emit JSON
process.env.LOG_LEVEL = 'silent';

initDatabase(':memory:');

const engine = await createBacktestEngine(config);
const result = await engine.run();
const m = result.metrics;

// Composite score: reward return + sharpe, penalise drawdown
// Must have >= 15 trades to be considered valid
const valid = m.totalTrades >= 15;
const score = valid
  ? (m.returnPct * 100) *
    (m.sharpeRatio != null && m.sharpeRatio > 0 ? 1 + m.sharpeRatio * 0.3 : 0.6) *
    m.winRate *
    (1 - m.maxDrawdownPct) *
    ((m.profitFactor ?? 0) > 1 ? (m.profitFactor ?? 1) : 0.5)
  : -999;

const out = {
  label:              e.BT_LABEL ?? 'unlabelled',
  score:              Math.round(score * 10000) / 10000,
  valid,
  config: {
    start:            START,
    end:              END,
    entryThreshold:   config.entryThreshold,
    stopLossPct:      config.stopLossPct,
    takeProfitPct:    config.takeProfitPct,
    trailingStop:     config.trailingStop,
    maxPositions:     config.maxPositions,
    maxPositionSizePct: config.maxPositionSizePct,
  },
  metrics: {
    totalTrades:    m.totalTrades,
    winRate:        Math.round(m.winRate * 10000) / 100,
    returnPct:      Math.round(m.returnPct * 10000) / 100,
    finalEquity:    m.finalEquity,
    profitFactor:   m.profitFactor != null ? Math.round(m.profitFactor * 100) / 100 : null,
    sharpeRatio:    m.sharpeRatio  != null ? Math.round(m.sharpeRatio  * 100) / 100 : null,
    sortinoRatio:   m.sortinoRatio != null ? Math.round(m.sortinoRatio * 100) / 100 : null,
    maxDrawdownPct: Math.round(m.maxDrawdownPct * 10000) / 100,
    expectancy:     m.expectancy   != null ? Math.round(m.expectancy   * 100) / 100 : null,
    avgHoldMinutes: m.avgHoldMinutes,
    bestTrade:      m.bestTrade,
    worstTrade:     m.worstTrade,
  },
};

process.stdout.write(JSON.stringify(out) + '\n');
