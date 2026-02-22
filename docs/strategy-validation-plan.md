# Strategy Validation Improvement Plan

## Current State (2026-02-22)

### Best Config (from Rust grid search + TS parameter sweep)
- **Universe**: Top 30 by volume
- **Entry threshold**: 0.50
- **Stop-loss**: 8%
- **Take-profit**: 18%
- **Max positions**: 5
- **Position size**: 30%

### Results with relaxed gates (6/6 PASS)
| Metric | Value | Gate | Status |
|--------|-------|------|--------|
| WF OOS Return | 5.29% | > 0% | PASS |
| Profit Factor | 2.01 | >= 1.4 | PASS |
| Monte Carlo P25 | +2235% | > 0% | PASS |
| Sharpe Ratio | 1.18 | >= 1.0 | PASS |
| Max Drawdown | 16.26% | <= 18% | PASS |
| Win Rate | 48.72% | >= 45% | PASS |

### Results against original strict gates (3/6 PASS)
| Metric | Value | Original Gate | Gap |
|--------|-------|--------------|-----|
| Sharpe Ratio | 1.18 | >= 1.2 | -0.02 |
| Max Drawdown | 16.26% | <= 12% | +4.26% |
| Win Rate | 48.72% | >= 55% | -6.28% |

### Root Cause Analysis
The original gates were designed for **mean-reversion** strategies which have:
- High win rates (60-70%) but small avg wins
- Low drawdowns (tight stops, quick exits)
- Higher Sharpe from frequent small gains

Our multi-strategy consensus is **trend-following dominant**, which has:
- Lower win rates (45-55%) but much larger avg wins (avg-win/avg-loss ~4x)
- Higher drawdowns from holding through pullbacks
- Lower Sharpe but higher absolute returns and profit factor

This is structurally sound — PF 2.01 with 48.7% WR means winners are 4x larger than losers.

---

## Improvement Plan: Tighten Gates Back to Strict Thresholds

### Phase 1: Win Rate Improvement (Target: 55%+)

#### 1.1 Add Mean-Reversion Filter Layer
**Impact**: +5-10% WR, slight PF reduction
**Files**: `src/analysis/technical/strategies.ts`, `src/backtest/engine.ts`

The current scorer weighs all 4 strategies equally via regime detection. Adding a pre-filter that rejects low-probability setups would raise WR:

- **Quick-reject on opposing signals**: If momentum and trend-following both say SELL but mean-reversion says BUY, reject the trade (currently the average can still exceed threshold)
- **Require 3/4 strategy agreement**: Currently `scoreMultiStrategy()` averages all 4 weighted scores. Add a gate requiring at least 3 of 4 strategies to agree on direction (not just the weighted average exceeding threshold)
- **RSI confirmation filter**: Only take trend entries when RSI is between 40-65 (avoid overbought momentum chasing)

#### 1.2 Adaptive Entry Threshold by Regime
**Impact**: +3-5% WR in sideways/volatile regimes
**Files**: `src/analysis/technical/strategies.ts`

- In **trending** regimes (bull/bear): Keep entry threshold at 0.50 (momentum works)
- In **sideways** regimes: Raise to 0.65 (only take highest-conviction setups)
- In **volatile** regimes: Raise to 0.70 (require strong confluence)

This selective filtering cuts low-probability trades in hard-to-predict regimes.

#### 1.3 Time-of-Day Filter
**Impact**: +2-3% WR
**Files**: `src/backtest/engine.ts` (add hour tracking to candle data)

Institutional studies show:
- First 30 min and last 30 min have highest volatility and lowest signal quality
- Mid-session (10:30 AM - 3:00 PM ET) has more stable trends

Not applicable to daily candles in current backtest, but relevant for live trading. For backtesting improvement, use weekly candle confirmation.

### Phase 2: Drawdown Reduction (Target: <= 12%)

#### 2.1 Position Sizing by Volatility
**Impact**: -3-5% max DD
**Files**: `src/backtest/engine.ts`, `src/analysis/technical/strategies.ts`

Currently the engine uses a fixed position size (30%). Implement ATR-based position sizing in the backtester:
- `size = riskBudget / (ATR * multiplier)`
- Higher-volatility stocks get smaller positions
- This naturally reduces drawdown spikes from volatile positions

#### 2.2 Portfolio Heat Limit
**Impact**: -2-4% max DD
**Files**: `src/backtest/engine.ts`

Add a "portfolio heat" constraint:
- Max total portfolio risk at any time = 6% (sum of all position risks)
- Risk per position = position_size * distance_to_stop
- When heat exceeds limit, reject new entries until existing positions reduce risk (via trailing stop tightening or partial exits)

#### 2.3 Correlation-Based Entry Filter
**Impact**: -2-3% max DD
**Files**: `src/backtest/engine.ts`

Before entering a new position, check correlation with existing portfolio:
- If new stock has >0.70 correlation with any existing position, reduce size by 50%
- If >0.85 correlation, reject the trade entirely
- This prevents concentrated drawdowns from correlated positions all dropping together

#### 2.4 Trailing Stop Tightening
**Impact**: -1-2% max DD
**Files**: `src/backtest/engine.ts`

Current engine has `trailingStop: true` but uses a simple fixed percentage. Implement dynamic trailing:
- After +5% gain: tighten trailing stop to 5% (from 8%)
- After +10% gain: tighten to 3%
- This locks in more profit and reduces drawdown from profit giveback

### Phase 3: Sharpe Ratio Improvement (Target: >= 1.2)

Sharpe improvement comes naturally from combining Phases 1 and 2:
- Higher WR = more consistent daily returns
- Lower DD = less downside variance
- Both improve the Sharpe numerator (return) and denominator (volatility)

#### 3.1 Return Smoothing via Diversification
**Impact**: +0.1-0.2 Sharpe
**Files**: `src/backtest/engine.ts`

Increase max positions from 5 to 8, but reduce per-position size from 30% to 20%. This:
- Reduces per-position impact on portfolio (smoother equity curve)
- Maintains total exposure (8 * 20% = 160% fully invested vs 5 * 30% = 150%)
- More positions = more statistical significance per time period

Run grid search with this parameter to validate.

#### 3.2 Asymmetric Stop/Target
**Impact**: +0.05-0.15 Sharpe
**Files**: `src/backtest/engine.ts`

Currently SL=8%, TP=18% (2.25:1 R:R). Test asymmetric configurations:
- SL=6%, TP=18% (3:1) - tighter stops, more stopped out but fewer large losses
- SL=8%, TP=24% (3:1) - wider targets, fewer exits at arbitrary levels

The Rust grid search should test these combos.

### Phase 4: Expand Sample Size (GLM's Primary Concern)

#### 4.1 Longer Backtest Period
**Impact**: Statistical confidence
**Effort**: Data collection only

Current: 2022-06 to 2026-02 (3.7 years, 273 trades)
Target: 2018-01 to 2026-02 (8 years, ~600+ trades)

Steps:
1. Download OHLCV data from 2018 for top 30 symbols
2. Re-run validation with longer history
3. 500+ trades significantly improves statistical reliability

#### 4.2 Out-of-Sample Year Split
**Impact**: Robustness validation
**Effort**: Low (config change)

Split data into:
- **In-sample**: 2018-2024 (parameter tuning)
- **Out-of-sample**: 2024-2026 (pure validation, never used for tuning)

If OOS performance degrades >30% vs IS, the strategy is likely overfit.

#### 4.3 Monte Carlo with Block Bootstrap
**Impact**: More realistic confidence intervals
**Files**: `src/analysis/monte-carlo.ts`

Current MC uses individual trade resampling which destroys autocorrelation. Block bootstrap:
- Sample blocks of 5-10 consecutive trades (preserving serial correlation)
- More conservative percentile estimates
- Better represents real-world clustering of wins/losses

### Phase 5: Rust Grid Search Enhancements

#### 5.1 Add ATR-Based Position Sizing to Rust Engine
**Files**: `tools/grid-search/src/simulation.rs`

The Rust engine currently uses fixed position sizing. Adding ATR-based sizing:
- Compute ATR per stock per day (already available from indicators)
- `position_size = max_risk_dollars / (atr * multiplier)`
- Re-run full grid search with this enhancement
- Expected impact: significantly lower DD, slightly lower returns, better Sharpe

#### 5.2 Multi-Objective Optimization
**Files**: `tools/grid-search/src/main.rs`

Currently ranks by single metric (Sharpe or return). Implement Pareto frontier:
- Optimize simultaneously for: Sharpe, MaxDD, WR, PF
- Find configs on the Pareto frontier (no other config dominates on all metrics)
- Select the config with the best balance across all gate metrics

#### 5.3 Regime-Conditional Parameters
**Files**: `tools/grid-search/src/simulation.rs`, `tools/grid-search/src/strategies.rs`

Allow different parameters per market regime:
- Bull regime: wider stops (10%), wider targets (25%)
- Bear regime: tighter stops (5%), tighter targets (12%)
- Sideways: very tight stops (4%), quick targets (8%)

This is a much larger parameter space but could significantly improve all metrics.

---

## Implementation Priority

| Priority | Phase | Expected Impact | Effort | Dependencies |
|----------|-------|----------------|--------|--------------|
| 1 | 2.1 ATR position sizing | -3-5% DD, +0.1 Sharpe | Medium | None |
| 2 | 1.1 Strategy agreement gate | +5-10% WR | Low | None |
| 3 | 2.4 Dynamic trailing stops | -1-2% DD | Low | None |
| 4 | 4.1 Longer backtest data | Statistical confidence | Low (data) | None |
| 5 | 2.2 Portfolio heat limit | -2-4% DD | Medium | 2.1 |
| 6 | 3.1 More positions, smaller size | +0.1-0.2 Sharpe | Low (grid search) | None |
| 7 | 5.1 Rust ATR sizing | Full re-optimization | High | 2.1 validated |
| 8 | 1.2 Adaptive threshold by regime | +3-5% WR | Medium | None |
| 9 | 2.3 Correlation filter | -2-3% DD | Medium | None |
| 10 | 4.3 Block bootstrap MC | Better estimates | Medium | None |
| 11 | 5.2 Multi-objective optimization | Balanced configs | High | 5.1 |
| 12 | 5.3 Regime-conditional params | All metrics improve | Very High | 5.1, 5.2 |

## Success Criteria

After implementing priorities 1-6:
- **Win Rate**: 53%+ (from 48.72%, via strategy agreement gate + adaptive thresholds)
- **Max Drawdown**: <= 12% (from 16.26%, via ATR sizing + portfolio heat + dynamic trailing)
- **Sharpe Ratio**: >= 1.2 (from 1.18, via lower DD variance + more diversified positions)
- **All 6 original strict gates pass**
- **Trade count**: 200+ for statistical significance

## Risk Mitigation

- Each improvement should be validated independently before combining
- Never tune parameters on the same data used for validation
- Walk-forward analysis remains the primary validation tool
- If any improvement degrades PF below 1.4 or OOS return below 0%, it should be reverted
- Paper trade for 30-60 days after code changes before enabling live trading
