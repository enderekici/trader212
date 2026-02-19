# Backtesting Documentation

This guide explains how to run backtests for the Trading212 bot to validate strategies and optimize parameters.

## Quick Start

To run a backtest with the current default configuration on a representative S&P 500 dataset:

```bash
npm run backtest
```

This will:
1.  Load historical data for ~200 S&P 500 stocks (Jan 2023 - Jan 2026).
2.  Simulate trading using the default "World Class" strategy parameters.
3.  Output a performance summary table to the console.
4.  Save detailed results to `data/backtest_results/latest_results.csv`.

## Configuration

The backtest script is located at `src/scripts/backtest.ts`. You can modify the `GRID` constant at the top of the file to change the parameters being tested.

### Single Run (Verification)
By default, the script is configured to run a **single verification pass** using the best known parameters:

```typescript
const GRID = {
  entryThreshold: [0.55],
  stopLossPct: [0.04],
  takeProfitPct: [0.20],
  trailingStop: [false],
};
```

### Grid Search (Optimization)
To perform a grid search (test multiple combinations to find the best settings), expand the arrays in `src/scripts/backtest.ts`:

```typescript
const GRID = {
  entryThreshold: [0.55, 0.60, 0.65],
  stopLossPct: [0.03, 0.04, 0.05],
  takeProfitPct: [0.15, 0.20, 0.25],
  trailingStop: [false],
};
```

When you run `npm run backtest` with multiple values, the script will:
1.  Iterate through every combination.
2.  Log progress for each run.
3.  Append each result to the CSV file.
4.  Print the **Best Configuration** found at the end.

## Dataset
The script uses a hardcoded list of ~200 stocks across 11 major sectors (Technology, Healthcare, Finance, Energy, etc.) to ensure a diverse and representative sample of the market. This avoids the bias of testing only on "tech high-flyers".

## Output Metrics

The results include:
-   **Total Return:** Net profit percentage.
-   **Profit Factor:** Gross Profit / Gross Loss ( > 1.5 is good).
-   **Win Rate:** Percentage of profitable trades.
-   **Max Drawdown:** Maximum peak-to-valley decline in equity.
-   **Sharpe Ratio:** Risk-adjusted return metric.
-   **Expectancy:** Average dollar value per trade.

## Troubleshooting
-   **"No data found"**: Occasional 404s for specific tickers (e.g., delisted stocks like DISH or PARA) are normal and handled gracefully.
-   **Rate Limiting**: The script includes delays between batches to respect Yahoo Finance rate limits.
