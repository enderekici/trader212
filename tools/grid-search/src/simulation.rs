// ---------------------------------------------------------------------------
// Portfolio Simulation Engine
//
// Ported from the TypeScript grid-search.ts `runWorker()` fast simulation loop
// and the backtest engine.ts.  Designed to be called ~50k times per strategy
// via rayon, so it avoids heap allocations in the hot loop where possible.
// ---------------------------------------------------------------------------

/// Configuration for a single simulation run.
#[derive(Clone)]
pub struct SimConfig {
    pub entry_threshold: f64,
    pub stop_loss_pct: f64,
    pub take_profit_pct: f64,
    pub max_positions: usize,
    pub max_position_size_pct: f64,
    pub initial_capital: f64,
    pub slippage_pct: f64,
    pub spread_bps: f64,
    pub commission: f64,
}

/// Result metrics from a single simulation run.
pub struct SimResult {
    pub total_trades: u32,
    pub win_rate: f64,
    pub return_pct: f64,
    pub profit_factor: f64,
    pub sharpe_ratio: f64,
    pub sortino_ratio: f64,
    pub calmar_ratio: f64,
    pub max_drawdown_pct: f64,
    pub avg_win: f64,
    pub avg_loss: f64,
    pub expectancy: f64,
    pub best_trade_pct: f64,
    pub worst_trade_pct: f64,
    pub avg_hold_min: f64,
    pub final_equity: f64,
}

/// Pre-built market data in struct-of-arrays layout for cache-friendly access.
///
/// Flat arrays are indexed as `[date_idx * n_symbols + symbol_idx]`.
/// Scores are per-symbol per-date: `scores[symbol_idx][date_idx]`, with
/// -1.0 meaning "no score available" (insufficient data).
pub struct MarketData {
    pub n_symbols: usize,
    pub n_dates: usize,
    /// Opening prices, flat: `[date_idx * n_symbols + symbol_idx]`
    pub opens: Vec<f64>,
    /// High prices, flat layout
    pub highs: Vec<f64>,
    /// Low prices, flat layout
    pub lows: Vec<f64>,
    /// Closing prices, flat layout
    pub closes: Vec<f64>,
    /// Whether a symbol has data on a given date, flat layout
    pub has_data: Vec<bool>,
    /// Pre-computed scores: `scores[symbol_idx][date_idx]`, -1.0 = no score
    pub scores: Vec<Vec<f64>>,
}

// ---------------------------------------------------------------------------
// Position tracking -- parallel Vecs (SoA) for hot-loop efficiency
// ---------------------------------------------------------------------------

struct Positions {
    symbols: Vec<usize>,
    shares: Vec<u32>,
    entry_prices: Vec<f64>,
    stop_losses: Vec<f64>,
    take_profits: Vec<f64>,
    entry_date_idxs: Vec<usize>,
    /// Per-symbol boolean for O(1) "already in position?" check.
    in_position: Vec<bool>,
}

impl Positions {
    fn new(n_symbols: usize) -> Self {
        Positions {
            symbols: Vec::with_capacity(64),
            shares: Vec::with_capacity(64),
            entry_prices: Vec::with_capacity(64),
            stop_losses: Vec::with_capacity(64),
            take_profits: Vec::with_capacity(64),
            entry_date_idxs: Vec::with_capacity(64),
            in_position: vec![false; n_symbols],
        }
    }

    #[inline]
    fn len(&self) -> usize {
        self.symbols.len()
    }

    #[inline]
    fn push(
        &mut self,
        symbol_idx: usize,
        shares: u32,
        entry_price: f64,
        stop_loss: f64,
        take_profit: f64,
        entry_date_idx: usize,
    ) {
        self.symbols.push(symbol_idx);
        self.shares.push(shares);
        self.entry_prices.push(entry_price);
        self.stop_losses.push(stop_loss);
        self.take_profits.push(take_profit);
        self.entry_date_idxs.push(entry_date_idx);
        self.in_position[symbol_idx] = true;
    }

    /// Swap-remove for O(1) removal.  Clears `in_position` for the removed symbol.
    #[inline]
    fn swap_remove(&mut self, idx: usize) {
        let si = self.symbols[idx];
        self.in_position[si] = false;

        let last = self.symbols.len() - 1;
        self.symbols.swap(idx, last);
        self.shares.swap(idx, last);
        self.entry_prices.swap(idx, last);
        self.stop_losses.swap(idx, last);
        self.take_profits.swap(idx, last);
        self.entry_date_idxs.swap(idx, last);

        self.symbols.pop();
        self.shares.pop();
        self.entry_prices.pop();
        self.stop_losses.pop();
        self.take_profits.pop();
        self.entry_date_idxs.pop();
    }

}

// ---------------------------------------------------------------------------
// Default (empty) SimResult
// ---------------------------------------------------------------------------

fn empty_result(initial_capital: f64) -> SimResult {
    SimResult {
        total_trades: 0,
        win_rate: 0.0,
        return_pct: 0.0,
        profit_factor: 0.0,
        sharpe_ratio: 0.0,
        sortino_ratio: 0.0,
        calmar_ratio: 0.0,
        max_drawdown_pct: 0.0,
        avg_win: 0.0,
        avg_loss: 0.0,
        expectancy: 0.0,
        best_trade_pct: 0.0,
        worst_trade_pct: 0.0,
        avg_hold_min: 0.0,
        final_equity: initial_capital,
    }
}

// ---------------------------------------------------------------------------
// Core simulation
// ---------------------------------------------------------------------------

/// Run a single portfolio simulation over the pre-built `MarketData`.
///
/// This is the hot function called ~50 000 times per strategy via rayon.
/// It avoids allocations where possible: the only per-run allocations are the
/// trade-result Vecs (which grow as trades occur) and the equity curve.
pub fn simulate(market: &MarketData, config: &SimConfig) -> SimResult {
    let n_symbols = market.n_symbols;
    let n_dates = market.n_dates;

    if n_dates == 0 || n_symbols == 0 {
        return empty_result(config.initial_capital);
    }

    let slippage_adj = config.slippage_pct;
    let spread_adj = config.spread_bps / 20000.0;

    let mut cash = config.initial_capital;
    let mut pos = Positions::new(n_symbols);

    // Trade results (collected as we go)
    let mut trade_pnls: Vec<f64> = Vec::with_capacity(256);
    let mut trade_pnl_pcts: Vec<f64> = Vec::with_capacity(256);
    let mut trade_hold_days: Vec<u32> = Vec::with_capacity(256);

    // Equity curve (one value per date for Sharpe/Sortino/drawdown)
    let mut equity_curve: Vec<f64> = Vec::with_capacity(n_dates);

    // Reusable signal buffers (avoid per-day allocation)
    let mut sig_symbols: Vec<usize> = Vec::with_capacity(n_symbols);
    let mut sig_scores: Vec<f64> = Vec::with_capacity(n_symbols);

    for di in 0..n_dates {
        let row_off = di * n_symbols;

        // -----------------------------------------------------------------
        // 1. Check exits (iterate backwards for swap-remove correctness)
        // -----------------------------------------------------------------
        let mut p = pos.len();
        while p > 0 {
            p -= 1;
            let si = pos.symbols[p];
            if !market.has_data[row_off + si] {
                continue;
            }
            let lo = market.lows[row_off + si];
            let hi = market.highs[row_off + si];

            let mut exit_price = 0.0;
            let mut hit = false;

            if lo <= pos.stop_losses[p] {
                // Stop-loss hit: exit at stop-loss price with slippage
                exit_price = pos.stop_losses[p] * (1.0 - slippage_adj - spread_adj);
                hit = true;
            } else if hi >= pos.take_profits[p] {
                // Take-profit hit: exit at take-profit price with slippage
                exit_price = pos.take_profits[p] * (1.0 - slippage_adj - spread_adj);
                hit = true;
            }

            if hit {
                let entry = pos.entry_prices[p];
                let shares = pos.shares[p] as f64;
                let pnl = (exit_price - entry) * shares - config.commission;
                let pnl_pct = (exit_price - entry) / entry;
                cash += shares * exit_price - config.commission;

                trade_pnls.push(pnl);
                trade_pnl_pcts.push(pnl_pct);
                trade_hold_days.push((di - pos.entry_date_idxs[p]) as u32);

                pos.swap_remove(p);
            }
        }

        // -----------------------------------------------------------------
        // 2. Generate entry signals (if room and next day exists)
        // -----------------------------------------------------------------
        if pos.len() < config.max_positions && di + 1 < n_dates {
            sig_symbols.clear();
            sig_scores.clear();

            for si in 0..n_symbols {
                if pos.in_position[si] {
                    continue;
                }
                let sc = market.scores[si][di];
                if sc < 0.0 || sc < config.entry_threshold {
                    continue;
                }
                sig_symbols.push(si);
                sig_scores.push(sc);
            }

            // Sort descending by score (insertion sort -- typically small N)
            for i in 1..sig_symbols.len() {
                let si = sig_symbols[i];
                let sc = sig_scores[i];
                let mut j = i;
                while j > 0 && sig_scores[j - 1] < sc {
                    sig_symbols[j] = sig_symbols[j - 1];
                    sig_scores[j] = sig_scores[j - 1];
                    j -= 1;
                }
                sig_symbols[j] = si;
                sig_scores[j] = sc;
            }

            // Execute entries at next day's open
            let next_off = (di + 1) * n_symbols;
            for k in 0..sig_symbols.len() {
                if pos.len() >= config.max_positions {
                    break;
                }
                let si = sig_symbols[k];
                if !market.has_data[next_off + si] {
                    continue;
                }

                let entry_price = market.opens[next_off + si] * (1.0 + slippage_adj + spread_adj);

                // Equity for sizing: cash + sum(entry_price * shares) for open positions
                // (uses entry prices, not market prices -- matches the TS engine)
                let mut pos_value: f64 = 0.0;
                for p_idx in 0..pos.len() {
                    pos_value += pos.entry_prices[p_idx] * pos.shares[p_idx] as f64;
                }
                let equity = cash + pos_value;
                let position_value =
                    (config.max_position_size_pct * equity).min(cash);
                if position_value <= 0.0 {
                    break;
                }

                let shares = (position_value / entry_price).floor() as u32;
                if shares == 0 {
                    continue;
                }
                let cost = shares as f64 * entry_price + config.commission;
                if cost > cash {
                    continue;
                }

                cash -= cost;
                let stop_loss = entry_price * (1.0 - config.stop_loss_pct);
                let take_profit = entry_price * (1.0 + config.take_profit_pct);

                pos.push(si, shares, entry_price, stop_loss, take_profit, di + 1);
            }
        }

        // -----------------------------------------------------------------
        // 3. Record equity (positions valued at today's close)
        // -----------------------------------------------------------------
        let mut pos_value: f64 = 0.0;
        for p_idx in 0..pos.len() {
            let si = pos.symbols[p_idx];
            let price = if market.has_data[row_off + si] {
                market.closes[row_off + si]
            } else {
                pos.entry_prices[p_idx]
            };
            pos_value += price * pos.shares[p_idx] as f64;
        }
        equity_curve.push(cash + pos_value);
    }

    // -----------------------------------------------------------------
    // 4. Close remaining positions at last day's close
    // -----------------------------------------------------------------
    if n_dates > 0 {
        let last_off = (n_dates - 1) * n_symbols;
        for p_idx in 0..pos.len() {
            let si = pos.symbols[p_idx];
            if !market.has_data[last_off + si] {
                continue;
            }
            let exit_price = market.closes[last_off + si] * (1.0 - slippage_adj - spread_adj);
            let entry = pos.entry_prices[p_idx];
            let shares = pos.shares[p_idx] as f64;
            let pnl = (exit_price - entry) * shares - config.commission;
            let pnl_pct = (exit_price - entry) / entry;

            trade_pnls.push(pnl);
            trade_pnl_pcts.push(pnl_pct);
            trade_hold_days.push((n_dates - 1 - pos.entry_date_idxs[p_idx]) as u32);
        }
    }

    // -----------------------------------------------------------------
    // 5. Compute metrics
    // -----------------------------------------------------------------
    let total_trades = trade_pnls.len() as u32;
    let final_equity = if !equity_curve.is_empty() {
        *equity_curve.last().unwrap()
    } else {
        config.initial_capital
    };

    if total_trades == 0 {
        return SimResult {
            final_equity,
            ..empty_result(config.initial_capital)
        };
    }

    // Win/loss aggregation
    let mut gross_profit: f64 = 0.0;
    let mut gross_loss: f64 = 0.0;
    let mut win_count: u32 = 0;
    for &pnl in &trade_pnls {
        if pnl > 0.0 {
            gross_profit += pnl;
            win_count += 1;
        } else {
            gross_loss -= pnl; // accumulate absolute loss
        }
    }

    let loss_count = total_trades - win_count;
    let win_rate = win_count as f64 / total_trades as f64;
    let return_pct = (final_equity - config.initial_capital) / config.initial_capital;
    let profit_factor = if gross_loss > 0.0 {
        gross_profit / gross_loss
    } else {
        0.0
    };
    let avg_win = if win_count > 0 {
        gross_profit / win_count as f64
    } else {
        0.0
    };
    let avg_loss = if loss_count > 0 {
        gross_loss / loss_count as f64
    } else {
        0.0
    };
    let expectancy = win_rate * avg_win - (1.0 - win_rate) * avg_loss;

    // -----------------------------------------------------------------
    // Daily returns -> Sharpe, Sortino
    // -----------------------------------------------------------------
    let mut sharpe: f64 = 0.0;
    let mut sortino: f64 = 0.0;

    if equity_curve.len() >= 6 {
        let rf_daily = 0.05 / 252.0;
        let mut excess: Vec<f64> = Vec::with_capacity(equity_curve.len());
        let mut sum_excess: f64 = 0.0;

        for i in 1..equity_curve.len() {
            if equity_curve[i - 1] > 0.0 {
                let r = (equity_curve[i] - equity_curve[i - 1]) / equity_curve[i - 1] - rf_daily;
                excess.push(r);
                sum_excess += r;
            }
        }

        let count = excess.len();
        if count >= 5 {
            let mean = sum_excess / count as f64;

            let mut variance: f64 = 0.0;
            let mut ds_sum: f64 = 0.0;

            for &r in &excess {
                variance += (r - mean).powi(2);
                if r < 0.0 {
                    ds_sum += r.powi(2);
                }
            }
            variance /= count as f64;

            let std = variance.sqrt();
            if std > 0.0 {
                sharpe = (mean / std) * (252.0_f64).sqrt();
            }

            let ds_dev = (ds_sum / count as f64).sqrt();
            if ds_dev > 0.0 {
                sortino = (mean / ds_dev) * (252.0_f64).sqrt();
            }
        }
    }

    // -----------------------------------------------------------------
    // Max drawdown from equity curve
    // -----------------------------------------------------------------
    let mut peak = equity_curve[0];
    let mut max_dd: f64 = 0.0;
    for &eq in &equity_curve {
        if eq > peak {
            peak = eq;
        }
        if peak > 0.0 {
            let dd = (peak - eq) / peak;
            if dd > max_dd {
                max_dd = dd;
            }
        }
    }

    // -----------------------------------------------------------------
    // Calmar ratio
    // -----------------------------------------------------------------
    let mut calmar: f64 = 0.0;
    if equity_curve.len() >= 6 && max_dd > 0.0 {
        let mut sum_daily: f64 = 0.0;
        let mut d_count: u32 = 0;
        for i in 1..equity_curve.len() {
            if equity_curve[i - 1] > 0.0 {
                sum_daily += (equity_curve[i] - equity_curve[i - 1]) / equity_curve[i - 1];
                d_count += 1;
            }
        }
        if d_count > 0 {
            calmar = (sum_daily / d_count as f64) * 252.0 / max_dd;
        }
    }

    // -----------------------------------------------------------------
    // Best / worst trade pct
    // -----------------------------------------------------------------
    let mut best_pct = f64::NEG_INFINITY;
    let mut worst_pct = f64::INFINITY;
    for &p in &trade_pnl_pcts {
        if p > best_pct {
            best_pct = p;
        }
        if p < worst_pct {
            worst_pct = p;
        }
    }

    // -----------------------------------------------------------------
    // Avg hold (in minutes -- each day gap = 1440 min, matching TS engine)
    // -----------------------------------------------------------------
    let mut hold_sum: u64 = 0;
    for &d in &trade_hold_days {
        hold_sum += d as u64;
    }
    let avg_hold_min = (hold_sum as f64 / total_trades as f64) * 1440.0;

    SimResult {
        total_trades,
        win_rate,
        return_pct,
        profit_factor,
        sharpe_ratio: sharpe,
        sortino_ratio: sortino,
        calmar_ratio: calmar,
        max_drawdown_pct: max_dd,
        avg_win,
        avg_loss,
        expectancy,
        best_trade_pct: best_pct,
        worst_trade_pct: worst_pct,
        avg_hold_min,
        final_equity,
    }
}
