//! Parallel Grid Search -- Wide-Space Backtest Engine (Rust)
//!
//! Reads cached symbol JSON files, pre-computes strategy scores, then runs
//! a massive parameter grid search in parallel using rayon.
//!
//! Build:
//!   RUSTFLAGS="-C target-cpu=native" cargo build --release
//!
//! Usage:
//!   ./target/release/grid-search
//!   ./target/release/grid-search --strategy multi
//!   ./target/release/grid-search --strategy legacy
//!   ./target/release/grid-search --cache-dir ./data/backtest_cache
//!   ./target/release/grid-search --output-dir ./data/backtest_results/grid-wide-rs

mod candlesticks;
mod data;
mod indicators;
mod strategies;
mod simulation;

use rayon::prelude::*;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

// ── Grid Parameters ──────────────────────────────────────────────────────────

const ENTRY_THRESHOLDS: &[f64] = &[0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];
const STOP_LOSS_PCTS: &[f64] = &[0.02, 0.03, 0.04, 0.05, 0.07, 0.1, 0.12, 0.15];
const TAKE_PROFIT_PCTS: &[f64] = &[0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];
const MAX_POSITIONS: &[usize] = &[3, 5, 10, 15, 20, 30, 40, 50];
const MAX_POSITION_SIZE_PCTS: &[f64] = &[0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.25];

// ── Fixed Config ─────────────────────────────────────────────────────────────

const START_DATE: &str = "2025-01-01";
const END_DATE: &str = "2026-02-21";
const INITIAL_CAPITAL: f64 = 10_000.0;
const SLIPPAGE_PCT: f64 = 0.001;
const SPREAD_BPS: f64 = 2.0;
const COMMISSION: f64 = 1.0;

const CSV_HEADER: &str = "Strategy,Entry Threshold,Stop Loss %,Take Profit %,Max Positions,\
    Position Size %,Trades,Win Rate %,Return %,Profit Factor,Sharpe Ratio,Sortino Ratio,\
    Calmar Ratio,Max Drawdown %,Avg Win $,Avg Loss $,Expectancy $,Best Trade %,Worst Trade %,\
    Avg Hold Min,Final Equity";

// ── CLI Parsing ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
enum StrategyMode {
    Multi,
    Legacy,
    Both,
}

struct CliArgs {
    strategy: StrategyMode,
    cache_dir: String,
    output_dir: String,
}

fn parse_args() -> CliArgs {
    let args: Vec<String> = std::env::args().collect();
    let mut strategy = StrategyMode::Both;
    let mut cache_dir = String::from("./data/backtest_cache");
    let mut output_dir = String::from("./data/backtest_results/grid-wide-rs");

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--strategy" => {
                i += 1;
                if i < args.len() {
                    strategy = match args[i].as_str() {
                        "multi" => StrategyMode::Multi,
                        "legacy" => StrategyMode::Legacy,
                        "both" => StrategyMode::Both,
                        other => {
                            eprintln!("Unknown strategy '{}', using 'both'", other);
                            StrategyMode::Both
                        }
                    };
                }
            }
            "--cache-dir" => {
                i += 1;
                if i < args.len() {
                    cache_dir = args[i].clone();
                }
            }
            "--output-dir" => {
                i += 1;
                if i < args.len() {
                    output_dir = args[i].clone();
                }
            }
            other => {
                eprintln!("Unknown argument: {}", other);
            }
        }
        i += 1;
    }

    CliArgs {
        strategy,
        cache_dir,
        output_dir,
    }
}

// ── Grid combo generation ────────────────────────────────────────────────────

#[derive(Clone)]
struct GridCombo {
    entry_threshold: f64,
    stop_loss_pct: f64,
    take_profit_pct: f64,
    max_positions: usize,
    max_position_size_pct: f64,
}

fn generate_combos() -> Vec<GridCombo> {
    let total = ENTRY_THRESHOLDS.len()
        * STOP_LOSS_PCTS.len()
        * TAKE_PROFIT_PCTS.len()
        * MAX_POSITIONS.len()
        * MAX_POSITION_SIZE_PCTS.len();
    let mut combos = Vec::with_capacity(total);

    for &entry_threshold in ENTRY_THRESHOLDS {
        for &stop_loss_pct in STOP_LOSS_PCTS {
            for &take_profit_pct in TAKE_PROFIT_PCTS {
                for &max_positions in MAX_POSITIONS {
                    for &max_position_size_pct in MAX_POSITION_SIZE_PCTS {
                        combos.push(GridCombo {
                            entry_threshold,
                            stop_loss_pct,
                            take_profit_pct,
                            max_positions,
                            max_position_size_pct,
                        });
                    }
                }
            }
        }
    }

    combos
}

// ── CSV result row ───────────────────────────────────────────────────────────

fn format_csv_row(
    strategy_label: &str,
    combo: &GridCombo,
    result: &simulation::SimResult,
) -> String {
    format!(
        "{},{},{:.1},{:.1},{},{:.1},{},{:.2},{:.2},{:.3},{:.3},{:.3},{:.3},{:.2},{:.2},{:.2},{:.2},{:.2},{:.2},{:.0},{:.2}",
        strategy_label,
        combo.entry_threshold,
        combo.stop_loss_pct * 100.0,
        combo.take_profit_pct * 100.0,
        combo.max_positions,
        combo.max_position_size_pct * 100.0,
        result.total_trades,
        result.win_rate * 100.0,
        result.return_pct * 100.0,
        result.profit_factor,
        result.sharpe_ratio,
        result.sortino_ratio,
        result.calmar_ratio,
        result.max_drawdown_pct * 100.0,
        result.avg_win,
        result.avg_loss,
        result.expectancy,
        result.best_trade_pct * 100.0,
        result.worst_trade_pct * 100.0,
        result.avg_hold_min,
        result.final_equity,
    )
}

// ── Analysis / reporting types ───────────────────────────────────────────────

#[derive(Clone)]
#[allow(dead_code)]
struct ParsedResult {
    strategy: String,
    entry_threshold: f64,
    stop_loss_pct: f64,
    take_profit_pct: f64,
    max_positions: usize,
    position_size_pct: f64,
    trades: u32,
    win_rate: f64,
    return_pct: f64,
    profit_factor: f64,
    sharpe: f64,
    sortino: f64,
    calmar: f64,
    max_dd: f64,
    avg_win: f64,
    avg_loss: f64,
    expectancy: f64,
    best_trade: f64,
    worst_trade: f64,
    avg_hold_min: f64,
    final_equity: f64,
}

fn parse_csv_line(line: &str) -> Option<ParsedResult> {
    let cols: Vec<&str> = line.split(',').collect();
    if cols.len() < 21 {
        return None;
    }
    Some(ParsedResult {
        strategy: cols[0].to_string(),
        entry_threshold: cols[1].parse().ok()?,
        stop_loss_pct: cols[2].parse().ok()?,
        take_profit_pct: cols[3].parse().ok()?,
        max_positions: cols[4].parse().ok()?,
        position_size_pct: cols[5].parse().ok()?,
        trades: cols[6].parse().ok()?,
        win_rate: cols[7].parse().ok()?,
        return_pct: cols[8].parse().ok()?,
        profit_factor: cols[9].parse().ok()?,
        sharpe: cols[10].parse().ok()?,
        sortino: cols[11].parse().ok()?,
        calmar: cols[12].parse().ok()?,
        max_dd: cols[13].parse().ok()?,
        avg_win: cols[14].parse().ok()?,
        avg_loss: cols[15].parse().ok()?,
        expectancy: cols[16].parse().ok()?,
        best_trade: cols[17].parse().ok()?,
        worst_trade: cols[18].parse().ok()?,
        avg_hold_min: cols[19].parse().ok()?,
        final_equity: cols[20].parse().ok()?,
    })
}

// ── Analysis printing ────────────────────────────────────────────────────────

fn print_table_header() {
    println!(
        "  # | Strategy       | Thr  |  SL% |  TP% | Pos | Size% | Trades | WinR% | Return% |    PF | Sharpe | MaxDD% | Final $"
    );
    println!(
        "  --+----------------+------+------+------+-----+-------+--------+-------+---------+-------+--------+--------+--------"
    );
}

fn print_table_row(rank: usize, r: &ParsedResult) {
    println!(
        "  {:2} | {:<14} | {:.2} | {:>4.1} | {:>4.1} | {:>3} | {:>5.1} | {:>6} | {:>5.1} | {:>7.1} | {:>5.2} | {:>6.2} | {:>6.1} | {:>7.0}",
        rank,
        r.strategy,
        r.entry_threshold,
        r.stop_loss_pct,
        r.take_profit_pct,
        r.max_positions,
        r.position_size_pct,
        r.trades,
        r.win_rate,
        r.return_pct,
        r.profit_factor,
        r.sharpe,
        r.max_dd,
        r.final_equity,
    );
}

fn print_table_row_risk_adj(rank: usize, r: &ParsedResult, risk_adj: f64) {
    println!(
        "  {:2} | {:<14} | {:.2} | {:>4.1} | {:>4.1} | {:>3} | {:>5.1} | {:>6} | {:>5.1} | {:>7.1} | {:>5.2} | {:>6.2} | {:>6.1} | {:>5.2}",
        rank,
        r.strategy,
        r.entry_threshold,
        r.stop_loss_pct,
        r.take_profit_pct,
        r.max_positions,
        r.position_size_pct,
        r.trades,
        r.win_rate,
        r.return_pct,
        r.profit_factor,
        r.sharpe,
        r.max_dd,
        risk_adj,
    );
}

fn print_analysis(all_results: &[ParsedResult], elapsed_secs: f64) {
    println!();
    println!("================================================================");
    println!("                     GRID SEARCH RESULTS                         ");
    println!("================================================================");

    println!("\n  Total results:     {}", all_results.len());
    println!("  Total time:        {:.0}s", elapsed_secs);

    // Filter to meaningful results (at least 10 trades)
    let meaningful: Vec<&ParsedResult> = all_results.iter().filter(|r| r.trades >= 10).collect();
    println!("  Meaningful (>=10 trades): {}", meaningful.len());

    if meaningful.is_empty() {
        println!("\n  No meaningful results found.");
        return;
    }

    // ── Top 20 by Return x Profit Factor ─────────────────────────────────
    let mut by_score: Vec<(&ParsedResult, f64)> = meaningful
        .iter()
        .map(|r| (*r, r.return_pct * r.profit_factor.max(0.0)))
        .collect();
    by_score.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    println!("\n  === TOP 20 BY RETURN x PROFIT FACTOR ===\n");
    print_table_header();
    for (i, (r, _)) in by_score.iter().take(20).enumerate() {
        print_table_row(i + 1, r);
    }

    // ── Top 20 by Sharpe Ratio ───────────────────────────────────────────
    let mut by_sharpe: Vec<&ParsedResult> = meaningful.clone();
    by_sharpe.sort_by(|a, b| b.sharpe.partial_cmp(&a.sharpe).unwrap_or(std::cmp::Ordering::Equal));

    println!("\n  === TOP 20 BY SHARPE RATIO ===\n");
    print_table_header();
    for (i, r) in by_sharpe.iter().take(20).enumerate() {
        print_table_row(i + 1, r);
    }

    // ── Top 20 by Risk-Adjusted (Return / MaxDD) ────────────────────────
    let mut by_risk_adj: Vec<(&ParsedResult, f64)> = meaningful
        .iter()
        .filter(|r| r.max_dd > 0.0)
        .map(|r| (*r, r.return_pct / r.max_dd))
        .collect();
    by_risk_adj.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    println!("\n  === TOP 20 BY RISK-ADJUSTED RETURN (Return% / MaxDD%) ===\n");
    println!(
        "  # | Strategy       | Thr  |  SL% |  TP% | Pos | Size% | Trades | WinR% | Return% |    PF | Sharpe | MaxDD% | R/DD"
    );
    println!(
        "  --+----------------+------+------+------+-----+-------+--------+-------+---------+-------+--------+--------+------"
    );
    for (i, (r, risk_adj)) in by_risk_adj.iter().take(20).enumerate() {
        print_table_row_risk_adj(i + 1, r, *risk_adj);
    }

    // ── Strategy Comparison ──────────────────────────────────────────────
    for strat in &["Multi-Strategy", "Legacy"] {
        let strat_results: Vec<&&ParsedResult> =
            meaningful.iter().filter(|r| r.strategy == *strat).collect();
        if strat_results.is_empty() {
            continue;
        }

        let n = strat_results.len() as f64;
        let profitable = strat_results.iter().filter(|r| r.return_pct > 0.0).count();
        let avg_return: f64 = strat_results.iter().map(|r| r.return_pct).sum::<f64>() / n;
        let avg_sharpe: f64 = strat_results.iter().map(|r| r.sharpe).sum::<f64>() / n;
        let avg_pf: f64 = strat_results.iter().map(|r| r.profit_factor).sum::<f64>() / n;

        let mut returns: Vec<f64> = strat_results.iter().map(|r| r.return_pct).collect();
        returns.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median_return = returns[returns.len() / 2];

        println!("\n  === {} SUMMARY ===", strat.to_uppercase());
        println!("    Total configs tested: {}", strat_results.len());
        println!(
            "    Profitable configs:   {} ({:.1}%)",
            profitable,
            (profitable as f64 / n) * 100.0
        );
        println!("    Avg Return:           {:.2}%", avg_return);
        println!("    Median Return:        {:.2}%", median_return);
        println!("    Avg Sharpe:           {:.3}", avg_sharpe);
        println!("    Avg Profit Factor:    {:.3}", avg_pf);
    }

    // ── Parameter Sensitivity Analysis ───────────────────────────────────
    println!("\n  === PARAMETER SENSITIVITY (avg return by parameter value) ===\n");

    // Entry Threshold
    println!("  Entry Threshold:");
    for &t in ENTRY_THRESHOLDS {
        let subset: Vec<&&ParsedResult> = meaningful
            .iter()
            .filter(|r| (r.entry_threshold - t).abs() < 0.001)
            .collect();
        if subset.is_empty() {
            continue;
        }
        let avg = subset.iter().map(|r| r.return_pct).sum::<f64>() / subset.len() as f64;
        let bar = make_bar(avg);
        println!(
            "    {:.2} | {:>7.1}% | {}  (n={})",
            t,
            avg,
            bar,
            subset.len()
        );
    }

    // Stop Loss
    println!("\n  Stop Loss %:");
    for &sl in STOP_LOSS_PCTS {
        let sl_pct = sl * 100.0;
        let subset: Vec<&&ParsedResult> = meaningful
            .iter()
            .filter(|r| (r.stop_loss_pct - sl_pct).abs() < 0.05)
            .collect();
        if subset.is_empty() {
            continue;
        }
        let avg = subset.iter().map(|r| r.return_pct).sum::<f64>() / subset.len() as f64;
        let bar = make_bar(avg);
        println!(
            "    {:>3.0}% | {:>7.1}% | {}  (n={})",
            sl_pct,
            avg,
            bar,
            subset.len()
        );
    }

    // Take Profit
    println!("\n  Take Profit %:");
    for &tp in TAKE_PROFIT_PCTS {
        let tp_pct = tp * 100.0;
        let subset: Vec<&&ParsedResult> = meaningful
            .iter()
            .filter(|r| (r.take_profit_pct - tp_pct).abs() < 0.05)
            .collect();
        if subset.is_empty() {
            continue;
        }
        let avg = subset.iter().map(|r| r.return_pct).sum::<f64>() / subset.len() as f64;
        let bar = make_bar(avg);
        println!(
            "    {:>3.0}% | {:>7.1}% | {}  (n={})",
            tp_pct,
            avg,
            bar,
            subset.len()
        );
    }

    // Max Positions
    println!("\n  Max Positions:");
    for &mp in MAX_POSITIONS {
        let subset: Vec<&&ParsedResult> = meaningful
            .iter()
            .filter(|r| r.max_positions == mp)
            .collect();
        if subset.is_empty() {
            continue;
        }
        let avg = subset.iter().map(|r| r.return_pct).sum::<f64>() / subset.len() as f64;
        let bar = make_bar(avg);
        println!(
            "    {:>3}  | {:>7.1}% | {}  (n={})",
            mp,
            avg,
            bar,
            subset.len()
        );
    }

    // Position Size
    println!("\n  Position Size %:");
    for &ps in MAX_POSITION_SIZE_PCTS {
        let ps_pct = ps * 100.0;
        let subset: Vec<&&ParsedResult> = meaningful
            .iter()
            .filter(|r| (r.position_size_pct - ps_pct).abs() < 0.05)
            .collect();
        if subset.is_empty() {
            continue;
        }
        let avg = subset.iter().map(|r| r.return_pct).sum::<f64>() / subset.len() as f64;
        let bar = make_bar(avg);
        println!(
            "    {:>3.0}% | {:>7.1}% | {}  (n={})",
            ps_pct,
            avg,
            bar,
            subset.len()
        );
    }

    // ── Best Config Recommendations ──────────────────────────────────────
    if !by_score.is_empty() {
        println!("\n  === RECOMMENDED CONFIGURATIONS ===\n");

        let best = by_score[0].0;
        println!("  Best Overall (Return x PF):");
        println!("    Strategy:        {}", best.strategy);
        println!("    Entry Threshold: {}", best.entry_threshold);
        println!("    Stop Loss:       {}%", best.stop_loss_pct);
        println!("    Take Profit:     {}%", best.take_profit_pct);
        println!("    Max Positions:   {}", best.max_positions);
        println!("    Position Size:   {}%", best.position_size_pct);
        println!(
            "    -> Return: {:.1}% | PF: {:.2} | Sharpe: {:.2} | MaxDD: {:.1}% | Final: ${:.0}",
            best.return_pct,
            best.profit_factor,
            best.sharpe,
            best.max_dd,
            best.final_equity
        );

        let best_sharpe = by_sharpe[0];
        println!("\n  Best Sharpe Ratio:");
        println!("    Strategy:        {}", best_sharpe.strategy);
        println!("    Entry Threshold: {}", best_sharpe.entry_threshold);
        println!("    Stop Loss:       {}%", best_sharpe.stop_loss_pct);
        println!("    Take Profit:     {}%", best_sharpe.take_profit_pct);
        println!("    Max Positions:   {}", best_sharpe.max_positions);
        println!("    Position Size:   {}%", best_sharpe.position_size_pct);
        println!(
            "    -> Return: {:.1}% | PF: {:.2} | Sharpe: {:.2} | MaxDD: {:.1}% | Final: ${:.0}",
            best_sharpe.return_pct,
            best_sharpe.profit_factor,
            best_sharpe.sharpe,
            best_sharpe.max_dd,
            best_sharpe.final_equity
        );

        if !by_risk_adj.is_empty() {
            let (best_risk, best_risk_adj_val) = by_risk_adj[0];
            println!("\n  Best Risk-Adjusted (Return/MaxDD):");
            println!("    Strategy:        {}", best_risk.strategy);
            println!("    Entry Threshold: {}", best_risk.entry_threshold);
            println!("    Stop Loss:       {}%", best_risk.stop_loss_pct);
            println!("    Take Profit:     {}%", best_risk.take_profit_pct);
            println!("    Max Positions:   {}", best_risk.max_positions);
            println!("    Position Size:   {}%", best_risk.position_size_pct);
            println!(
                "    -> Return: {:.1}% | PF: {:.2} | Sharpe: {:.2} | MaxDD: {:.1}% | R/DD: {:.2}",
                best_risk.return_pct,
                best_risk.profit_factor,
                best_risk.sharpe,
                best_risk.max_dd,
                best_risk_adj_val
            );
        }
    }
}

fn make_bar(avg: f64) -> String {
    if avg > 0.0 {
        let len = (avg / 2.0).round().min(40.0).max(0.0) as usize;
        "#".repeat(len)
    } else {
        let len = (avg.abs() / 2.0).round().min(40.0).max(0.0) as usize;
        ".".repeat(len)
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

fn main() -> anyhow::Result<()> {
    let args = parse_args();
    let overall_start = Instant::now();

    // Determine which strategies to run
    let strategies_to_run: Vec<&str> = match args.strategy {
        StrategyMode::Multi => vec!["multi"],
        StrategyMode::Legacy => vec!["legacy"],
        StrategyMode::Both => vec!["multi", "legacy"],
    };

    // ── 1. Load cached symbol data ───────────────────────────────────────
    println!("\n  Loading cached symbol data from {}...", args.cache_dir);
    let load_start = Instant::now();
    let symbol_data = data::load_cached_symbols(&args.cache_dir)?;
    let load_elapsed = load_start.elapsed().as_secs_f64();
    println!(
        "  Loaded {} symbols in {:.1}s",
        symbol_data.len(),
        load_elapsed
    );

    if symbol_data.is_empty() {
        anyhow::bail!("No symbol data found in cache directory: {}", args.cache_dir);
    }

    // ── 2. Get common trading dates ──────────────────────────────────────
    let trading_dates = data::get_common_dates(&symbol_data, START_DATE, END_DATE);
    println!("  Trading dates: {} (from {} to {})", trading_dates.len(), START_DATE, END_DATE);

    if trading_dates.is_empty() {
        anyhow::bail!("No common trading dates found in range {} to {}", START_DATE, END_DATE);
    }

    let n_dates = trading_dates.len();
    let n_symbols = symbol_data.len();

    // ── 3. Build flat SoA price arrays ───────────────────────────────────
    println!("  Building price arrays ({} symbols x {} dates)...", n_symbols, n_dates);

    let mut opens = vec![0.0f64; n_dates * n_symbols];
    let mut highs = vec![0.0f64; n_dates * n_symbols];
    let mut lows = vec![0.0f64; n_dates * n_symbols];
    let mut closes = vec![0.0f64; n_dates * n_symbols];
    let mut has_data = vec![false; n_dates * n_symbols];

    // Build date-to-index lookup
    let date_to_idx: HashMap<&str, usize> = trading_dates
        .iter()
        .enumerate()
        .map(|(i, d)| (d.as_str(), i))
        .collect();

    // Symbol names in order
    let symbol_names: Vec<&str> = symbol_data.iter().map(|(name, _)| name.as_str()).collect();

    for (si, (_sym, candles)) in symbol_data.iter().enumerate() {
        for c in candles {
            if let Some(&di) = date_to_idx.get(c.date.as_str()) {
                let idx = di * n_symbols + si;
                opens[idx] = c.open;
                highs[idx] = c.high;
                lows[idx] = c.low;
                closes[idx] = c.close;
                has_data[idx] = true;
            }
        }
    }

    // ── Grid stats ───────────────────────────────────────────────────────
    let combos_per_threshold = STOP_LOSS_PCTS.len()
        * TAKE_PROFIT_PCTS.len()
        * MAX_POSITIONS.len()
        * MAX_POSITION_SIZE_PCTS.len();
    let total_combos_per_strategy = ENTRY_THRESHOLDS.len() * combos_per_threshold;
    let total_combos = strategies_to_run.len() * total_combos_per_strategy;

    // ── Print banner ─────────────────────────────────────────────────────
    println!();
    println!("================================================================");
    println!("        WIDE-SPACE GRID SEARCH -- BACKTEST ENGINE (Rust)         ");
    println!("================================================================");
    println!();
    println!("  Symbols:          {} cached stocks", n_symbols);
    println!("  Period:           {} -> {}", START_DATE, END_DATE);
    println!("  Trading dates:    {}", n_dates);
    println!("  Capital:          ${}", INITIAL_CAPITAL as u64);
    println!(
        "  Strategies:       {}",
        strategies_to_run
            .iter()
            .map(|s| if *s == "multi" { "Multi-Strategy" } else { "Legacy" })
            .collect::<Vec<_>>()
            .join(", ")
    );
    println!("  Trailing Stop:    Always OFF");
    println!(
        "  Slippage:         {:.1}%  |  Spread: {} bps  |  Commission: ${}",
        SLIPPAGE_PCT * 100.0,
        SPREAD_BPS,
        COMMISSION
    );
    println!();
    println!("  Grid dimensions:");
    println!(
        "    Entry Threshold:  {}  ({})",
        ENTRY_THRESHOLDS
            .iter()
            .map(|v| format!("{}", v))
            .collect::<Vec<_>>()
            .join(", "),
        ENTRY_THRESHOLDS.len()
    );
    println!(
        "    Stop Loss %:      {}  ({})",
        STOP_LOSS_PCTS
            .iter()
            .map(|v| format!("{:.0}%", v * 100.0))
            .collect::<Vec<_>>()
            .join(", "),
        STOP_LOSS_PCTS.len()
    );
    println!(
        "    Take Profit %:    {}  ({})",
        TAKE_PROFIT_PCTS
            .iter()
            .map(|v| format!("{:.0}%", v * 100.0))
            .collect::<Vec<_>>()
            .join(", "),
        TAKE_PROFIT_PCTS.len()
    );
    println!(
        "    Max Positions:    {}  ({})",
        MAX_POSITIONS
            .iter()
            .map(|v| format!("{}", v))
            .collect::<Vec<_>>()
            .join(", "),
        MAX_POSITIONS.len()
    );
    println!(
        "    Position Size %:  {}  ({})",
        MAX_POSITION_SIZE_PCTS
            .iter()
            .map(|v| format!("{:.0}%", v * 100.0))
            .collect::<Vec<_>>()
            .join(", "),
        MAX_POSITION_SIZE_PCTS.len()
    );
    println!();
    println!("  Combos/threshold:  {}", combos_per_threshold);
    println!("  Total combos:      {}", total_combos);
    println!(
        "  Parallelism:       rayon ({} threads)",
        rayon::current_num_threads()
    );
    println!("  Output dir:        {}", args.output_dir);
    println!();

    // Create output directory
    fs::create_dir_all(&args.output_dir)?;

    let all_combos = generate_combos();
    let mut csv_files: Vec<String> = Vec::new();

    // ── 4. Per-strategy loop ─────────────────────────────────────────────
    for strategy_name in &strategies_to_run {
        let strategy_label = if *strategy_name == "multi" {
            "Multi-Strategy"
        } else {
            "Legacy"
        };
        let score_fn: fn(&[data::Candle]) -> f64 = if *strategy_name == "multi" {
            strategies::score_multi_strategy
        } else {
            strategies::score_legacy
        };

        // ── 4a. Pre-compute score matrix ─────────────────────────────────
        println!(
            "  [{}] Pre-computing scores ({} symbols x {} dates)...",
            strategy_label, n_symbols, n_dates
        );
        let score_start = Instant::now();

        let score_progress = AtomicUsize::new(0);

        // Parallel score computation per symbol
        let score_matrix: Vec<Vec<f64>> = (0..n_symbols)
            .into_par_iter()
            .map(|si| {
                let candles = &symbol_data[si].1;
                let mut scores = vec![-1.0f64; n_dates];

                // Two-pointer: candles and trading_dates are both sorted by date
                let mut candle_end: usize = 0;
                for di in 0..n_dates {
                    let date = &trading_dates[di];
                    while candle_end < candles.len() && candles[candle_end].date.as_str() <= date.as_str() {
                        candle_end += 1;
                    }
                    if candle_end < 50 {
                        continue; // need >=50 candles for indicators
                    }
                    let raw = score_fn(&candles[..candle_end]);
                    scores[di] = raw / 100.0;
                }

                let done = score_progress.fetch_add(1, Ordering::Relaxed) + 1;
                if done % 20 == 0 || done == n_symbols {
                    eprint!(
                        "\r  [{}] Scored {}/{} symbols...",
                        strategy_label, done, n_symbols
                    );
                }

                scores
            })
            .collect();

        let score_elapsed = score_start.elapsed().as_secs_f64();
        eprintln!();
        println!(
            "  [{}] Scoring done in {:.1}s",
            strategy_label, score_elapsed
        );

        // ── 4b. Build MarketData struct ──────────────────────────────────
        let market_data = simulation::MarketData {
            n_symbols,
            n_dates,
            opens: opens.clone(),
            highs: highs.clone(),
            lows: lows.clone(),
            closes: closes.clone(),
            has_data: has_data.clone(),
            scores: score_matrix,
        };

        // ── 4c. Run simulation grid ─────────────────────────────────────
        println!(
            "  [{}] Running {} grid combos...",
            strategy_label,
            all_combos.len()
        );
        let sim_start = Instant::now();
        let sim_progress = AtomicUsize::new(0);
        let n_combos = all_combos.len();

        let results: Vec<(GridCombo, simulation::SimResult)> = all_combos
            .par_iter()
            .map(|combo| {
                let config = simulation::SimConfig {
                    entry_threshold: combo.entry_threshold,
                    stop_loss_pct: combo.stop_loss_pct,
                    take_profit_pct: combo.take_profit_pct,
                    max_positions: combo.max_positions,
                    max_position_size_pct: combo.max_position_size_pct,
                    initial_capital: INITIAL_CAPITAL,
                    slippage_pct: SLIPPAGE_PCT,
                    spread_bps: SPREAD_BPS,
                    commission: COMMISSION,
                };
                let result = simulation::simulate(&market_data, &config);

                let done = sim_progress.fetch_add(1, Ordering::Relaxed) + 1;
                if done % 5000 == 0 || done == n_combos {
                    eprint!(
                        "\r  [{}] {}/{} combos ({:.0}%)",
                        strategy_label,
                        done,
                        n_combos,
                        (done as f64 / n_combos as f64) * 100.0
                    );
                }

                (combo.clone(), result)
            })
            .collect();

        let sim_elapsed = sim_start.elapsed().as_secs_f64();
        eprintln!();
        println!(
            "  [{}] Simulation done in {:.1}s ({} results)",
            strategy_label,
            sim_elapsed,
            results.len()
        );

        // ── 4d. Write CSV ────────────────────────────────────────────────
        let csv_path = format!(
            "{}/results-{}.csv",
            args.output_dir,
            if *strategy_name == "multi" {
                "multi"
            } else {
                "legacy"
            }
        );
        println!("  [{}] Writing {}...", strategy_label, csv_path);

        let mut file = fs::File::create(&csv_path)?;
        writeln!(file, "{}", CSV_HEADER)?;
        for (combo, result) in &results {
            writeln!(file, "{}", format_csv_row(strategy_label, combo, result))?;
        }
        file.flush()?;
        csv_files.push(csv_path.clone());

        println!(
            "  [{}] Complete. Scoring: {:.1}s, Simulation: {:.1}s",
            strategy_label, score_elapsed, sim_elapsed
        );
        println!();
    }

    // ── 5. Merge CSVs into all_results.csv ───────────────────────────────
    println!("  Merging results...");
    let merged_path = format!("{}/all_results.csv", args.output_dir);
    let mut merged_file = fs::File::create(&merged_path)?;
    writeln!(merged_file, "{}", CSV_HEADER)?;

    let mut all_parsed_results: Vec<ParsedResult> = Vec::new();

    for csv_path in &csv_files {
        let content = fs::read_to_string(csv_path)?;
        for line in content.lines().skip(1) {
            // skip header
            if !line.is_empty() {
                writeln!(merged_file, "{}", line)?;
                if let Some(parsed) = parse_csv_line(line) {
                    all_parsed_results.push(parsed);
                }
            }
        }
    }
    merged_file.flush()?;

    // ── 6. Print analysis ────────────────────────────────────────────────
    let total_elapsed = overall_start.elapsed().as_secs_f64();
    print_analysis(&all_parsed_results, total_elapsed);

    println!();
    println!("  Full results: {}", merged_path);
    println!(
        "  Per-strategy CSVs: {}/results-*.csv",
        args.output_dir
    );
    println!(
        "  Symbols used: {}",
        symbol_names.join(", ").chars().take(120).collect::<String>()
    );
    if symbol_names.len() > 10 {
        println!("    ... and {} more", symbol_names.len() - 10);
    }
    println!("  Total time: {:.0}s", total_elapsed);
    println!();

    Ok(())
}
