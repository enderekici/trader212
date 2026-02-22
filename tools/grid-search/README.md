# Grid Search — Rust Backtest Engine

High-performance parallel grid search over backtesting parameters. Evaluates **101,376 parameter combinations** across 214 stocks and 282 trading dates in **~8 seconds** on a modern machine.

## Why Rust?

The original TypeScript grid search (`src/scripts/grid-search.ts`) recomputed technical indicators for every parameter combination, making it impractically slow. This Rust implementation:

1. **Pre-computes scores once** — technical indicator scores depend only on (strategy, symbol, date), not on SL/TP/position sizing. Computing them once eliminates ~4,600x redundant work.
2. **Parallel simulation with rayon** — all 50,688 combos per strategy run in parallel across all CPU cores.
3. **Cache-friendly SoA layout** — flat `Vec<f64>` arrays indexed as `[date_idx * n_symbols + symbol_idx]` for optimal memory access patterns.

## Prerequisites

- [Rust toolchain](https://rustup.rs/) (1.70+)
- Cached backtest data in `./data/backtest_cache/` (JSON files from the TS backtest data loader)

## Build

```bash
# Native CPU optimizations (recommended for ~10-20% speedup)
RUSTFLAGS="-C target-cpu=native" cargo build --release

# Standard build
cargo build --release
```

Binary is at `./target/release/grid-search`.

## Usage

```bash
# Run from project root
./tools/grid-search/target/release/grid-search

# Options
./tools/grid-search/target/release/grid-search --strategy multi    # Multi-Strategy only
./tools/grid-search/target/release/grid-search --strategy legacy   # Legacy scorer only
./tools/grid-search/target/release/grid-search --strategy both     # Both (default)
./tools/grid-search/target/release/grid-search --cache-dir ./data/backtest_cache
./tools/grid-search/target/release/grid-search --output-dir ./data/backtest_results/grid-wide-rs
```

### Defaults

| Option | Default |
|--------|---------|
| `--strategy` | `both` |
| `--cache-dir` | `./data/backtest_cache` |
| `--output-dir` | `./data/backtest_results/grid-wide-rs` |

## Grid Dimensions

| Parameter | Values | Count |
|-----------|--------|-------|
| Entry Threshold | 0.3, 0.35, 0.4 ... 0.8 | 11 |
| Stop Loss % | 2%, 3%, 4%, 5%, 7%, 10%, 12%, 15% | 8 |
| Take Profit % | 5%, 8%, 10%, 15%, 20%, 25%, 30%, 40%, 50% | 9 |
| Max Positions | 3, 5, 10, 15, 20, 30, 40, 50 | 8 |
| Position Size % | 2%, 3%, 5%, 8%, 10%, 15%, 20%, 25% | 8 |

**Total: 50,688 combinations per strategy, 101,376 for both.**

## Strategies

### Multi-Strategy (recommended)
4-strategy regime-weighted consensus with 16 new sub-signals beyond the original TS port:

- **Mean Reversion** (9 sub-signals): RSI, Bollinger %B, Z-score, Stochastic, Williams %R, + Keltner extremes, Chaikin MF divergence, candlestick reversals, VWAP distance
- **Trend Following** (10 sub-signals): EMA alignment, ADX, ROC, EMA(200), volume, + Ichimoku alignment, Supertrend, TRIX, market structure
- **Momentum** (9 sub-signals): ROC dual, RSI zones, volume, OBV trend, MFI, + Awesome Oscillator, Force Index, Elder Ray, ADL trend
- **Breakout** (10 sub-signals): Donchian 20/50, volume surge, ATR expansion, ADX, BB bandwidth, + squeeze detection, S/R breaks, Ichimoku cloud breakout, Keltner expansion

Regime detection adjusts strategy weights for trending up/down, sideways, and volatile markets.

### Legacy
Weighted-average scorer using 16 technical indicators (RSI, MACD, SMA/EMA, Bollinger, ADX, Stochastic, Williams %R, MFI, CCI, Parabolic SAR, ROC, Volume Ratio, Ichimoku, Awesome Oscillator, candlestick patterns). Full 118-weight coverage.

## Output

Results are written as CSV files to the output directory:

- `results-multi.csv` — Multi-Strategy results
- `results-legacy.csv` — Legacy results
- `all_results.csv` — Merged results

### CSV Columns

```
Strategy, Entry Threshold, Stop Loss %, Take Profit %, Max Positions,
Position Size %, Trades, Win Rate %, Return %, Profit Factor, Sharpe Ratio,
Sortino Ratio, Calmar Ratio, Max Drawdown %, Avg Win $, Avg Loss $,
Expectancy $, Best Trade %, Worst Trade %, Avg Hold Min, Final Equity
```

### Console Analysis

After simulation, the tool prints:
- Top 20 configs by Return x Profit Factor
- Top 20 configs by Sharpe Ratio
- Top 20 configs by risk-adjusted return (Return / MaxDD)
- Per-strategy summary (profitable %, avg return, median return, avg Sharpe)
- Parameter sensitivity analysis with ASCII bar charts

## Architecture

```
main.rs         — CLI, orchestration, CSV I/O, analysis tables
data.rs         — JSON data loader, common date intersection
indicators.rs   — 28 technical indicators (pure Rust, no dependencies)
candlesticks.rs — 19 candlestick pattern detections
strategies.rs   — Multi-Strategy (4 strategies, 38 sub-signals) and Legacy scorers
simulation.rs   — Portfolio simulation engine (SoA position tracking)
```

### Flow

```
1. Load cached JSON  →  data.rs
2. Build flat SoA price arrays (opens/highs/lows/closes)
3. Pre-compute score matrix [symbol][date]  →  strategies.rs + indicators.rs
4. Parallel grid simulation (rayon)  →  simulation.rs
5. Write CSV + print analysis  →  main.rs
```

### Simulation Details

- Entries at next day's open (prevents look-ahead bias)
- Exits before entries each day
- Stop-loss and take-profit checked against intraday high/low
- Slippage (0.1%) and spread (2 bps) applied on entry and exit
- Commission ($1) per trade
- Sharpe/Sortino annualized (RF = 5%, 252 trading days)
- Max drawdown from daily equity curve

## Tests

```bash
cargo test
```

66 unit tests covering all indicators, candlestick patterns, and edge cases.
