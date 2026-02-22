use crate::candlesticks;
use crate::data::Candle;
use crate::indicators;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn last_val(v: &[f64]) -> f64 {
    v.last().copied().unwrap_or(f64::NAN)
}

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

fn clamp01(v: f64) -> f64 {
    clamp(v, 0.0, 1.0)
}

/// Annualized volatility from daily returns over the last `window` closes.
fn annualized_volatility(closes: &[f64], window: usize) -> Option<f64> {
    if closes.len() <= window || window == 0 {
        return None;
    }
    let slice = &closes[closes.len() - window..];
    let n = slice.len() - 1;
    if n == 0 {
        return None;
    }
    let mut sum = 0.0;
    let mut returns = Vec::with_capacity(n);
    for i in 1..slice.len() {
        let r = (slice[i] - slice[i - 1]) / slice[i - 1];
        returns.push(r);
        sum += r;
    }
    let mean = sum / n as f64;
    let variance = returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / n as f64;
    Some(variance.sqrt() * (252.0_f64).sqrt())
}

// ---------------------------------------------------------------------------
// Strategy signal (internal to this module)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum Direction {
    Long,
    Short,
    Neutral,
}

struct StrategySignal {
    direction: Direction,
    strength: f64,
    confidence: f64,
}

// ---------------------------------------------------------------------------
// Strategy 1 -- Mean Reversion
// ---------------------------------------------------------------------------

fn score_mean_reversion(
    opens: &[f64],
    closes: &[f64],
    highs: &[f64],
    lows: &[f64],
    volumes: &[f64],
) -> StrategySignal {
    let mut long_score: f64 = 0.0;
    let mut short_score: f64 = 0.0;
    let mut sub_signals: u32 = 0;
    let mut agreeing: u32 = 0;

    // RSI(14)
    let rsi_vec = indicators::rsi(closes, 14);
    let rsi_val = last_val(&rsi_vec);
    if !rsi_val.is_nan() {
        sub_signals += 1;
        if rsi_val < 35.0 {
            let s = clamp01((35.0 - rsi_val) / 35.0);
            long_score += s * 0.25;
            agreeing += 1;
        } else if rsi_val >= 35.0 && rsi_val < 40.0 {
            long_score += 0.1;
            agreeing += 1;
        } else if rsi_val > 65.0 {
            let s = clamp01((rsi_val - 65.0) / 35.0);
            short_score += s * 0.25;
            agreeing += 1;
        } else if rsi_val > 60.0 && rsi_val <= 65.0 {
            short_score += 0.1;
            agreeing += 1;
        }
    }

    // Bollinger %B
    let (bb_upper, bb_mid, bb_lower) = indicators::bollinger_bands(closes, 20, 2.0);
    let upper = last_val(&bb_upper);
    let lower = last_val(&bb_lower);
    let _mid = last_val(&bb_mid);
    if !upper.is_nan() && !lower.is_nan() && !closes.is_empty() {
        let price = closes[closes.len() - 1];
        let percent_b = if upper != lower {
            (price - lower) / (upper - lower)
        } else {
            0.5
        };
        sub_signals += 1;
        if percent_b < 0.0 {
            let s = clamp01(-percent_b);
            long_score += s * 0.25;
            agreeing += 1;
        } else if percent_b > 1.0 {
            let s = clamp01(percent_b - 1.0);
            short_score += s * 0.25;
            agreeing += 1;
        } else if percent_b < 0.2 {
            long_score += 0.1;
            agreeing += 1;
        } else if percent_b > 0.8 {
            short_score += 0.1;
            agreeing += 1;
        }
    }

    // Z-score from SMA(50)
    let sma50_vec = indicators::sma(closes, 50);
    let sma50_val = last_val(&sma50_vec);
    let vol20 = annualized_volatility(closes, 20);
    if !sma50_val.is_nan() && !closes.is_empty() {
        if let Some(v20) = vol20 {
            if v20 > 0.0 {
                let price = closes[closes.len() - 1];
                let daily_std = (v20 / (252.0_f64).sqrt()) * price;
                let z_score = if daily_std > 0.0 {
                    (price - sma50_val) / daily_std
                } else {
                    0.0
                };
                sub_signals += 1;
                if z_score < -1.2 {
                    let s = clamp01((-z_score - 1.2) / 2.0);
                    long_score += s * 0.2;
                    agreeing += 1;
                } else if z_score > 1.2 {
                    let s = clamp01((z_score - 1.2) / 2.0);
                    short_score += s * 0.2;
                    agreeing += 1;
                }
            }
        }
    }

    // Stochastic(14,3)
    let (stoch_k_vec, _stoch_d_vec) = indicators::stochastic(highs, lows, closes, 14, 3);
    let stoch_k = last_val(&stoch_k_vec);
    if !stoch_k.is_nan() {
        sub_signals += 1;
        if stoch_k < 20.0 {
            let s = clamp01((20.0 - stoch_k) / 20.0);
            long_score += s * 0.15;
            agreeing += 1;
        } else if stoch_k > 80.0 {
            let s = clamp01((stoch_k - 80.0) / 20.0);
            short_score += s * 0.15;
            agreeing += 1;
        }
    }

    // Williams %R(14)
    let wr_vec = indicators::williams_r(highs, lows, closes, 14);
    let wr = last_val(&wr_vec);
    if !wr.is_nan() {
        sub_signals += 1;
        if wr < -80.0 {
            let s = clamp01((-80.0 - wr) / 20.0);
            long_score += s * 0.15;
            agreeing += 1;
        } else if wr > -20.0 {
            let s = clamp01((wr + 20.0) / 20.0);
            short_score += s * 0.15;
            agreeing += 1;
        }
    }

    // Keltner Channel extremes
    let (kc_upper, _kc_mid, kc_lower) =
        indicators::keltner_channels(highs, lows, closes, 20, 14, 2.0);
    let kc_u = last_val(&kc_upper);
    let kc_l = last_val(&kc_lower);
    if !kc_u.is_nan() && !kc_l.is_nan() && !closes.is_empty() {
        let price = closes[closes.len() - 1];
        sub_signals += 1;
        if price < kc_l {
            long_score += 0.12;
            agreeing += 1;
        } else if price > kc_u {
            short_score += 0.12;
            agreeing += 1;
        }
    }

    // Chaikin Money Flow divergence (mean-reversion context with BB)
    let cmf_vec = indicators::chaikin_money_flow(highs, lows, closes, volumes, 20);
    let cmf_val = last_val(&cmf_vec);
    if !cmf_val.is_nan() && !closes.is_empty() {
        let price = closes[closes.len() - 1];
        sub_signals += 1;
        // Check if price is near BB lower band and CMF is deeply negative (divergence -> reversal up)
        if cmf_val < -0.15 && !lower.is_nan() && price < lower + (upper - lower) * 0.2 {
            long_score += 0.08;
            agreeing += 1;
        } else if cmf_val > 0.15 && !upper.is_nan() && price > upper - (upper - lower) * 0.2 {
            short_score += 0.08;
            agreeing += 1;
        }
    }

    // Candlestick reversal patterns
    let candle_sig = candlesticks::detect_patterns(opens, highs, lows, closes);
    {
        sub_signals += 1;
        if candle_sig.net_score > 65.0 {
            long_score += 0.10;
            agreeing += 1;
        } else if candle_sig.net_score < 35.0 {
            short_score += 0.10;
            agreeing += 1;
        }
    }

    // VWAP distance
    let vwap_vec = indicators::vwap(highs, lows, closes, volumes);
    let vwap_val = last_val(&vwap_vec);
    if !vwap_val.is_nan() && vwap_val > 0.0 && !closes.is_empty() {
        let price = closes[closes.len() - 1];
        sub_signals += 1;
        if price < vwap_val * 0.97 {
            long_score += 0.08;
            agreeing += 1;
        } else if price > vwap_val * 1.03 {
            short_score += 0.08;
            agreeing += 1;
        }
    }

    // Determine direction
    let net_score = long_score - short_score;
    let mut direction = Direction::Neutral;
    let mut strength = 0.0;

    if net_score > 0.03 {
        direction = Direction::Long;
        strength = clamp01(long_score * 2.0);
    } else if net_score < -0.03 {
        direction = Direction::Short;
        strength = clamp01(short_score * 2.0);
    }

    let confidence = if sub_signals > 0 {
        clamp01(agreeing as f64 / sub_signals as f64)
    } else {
        0.0
    };

    StrategySignal {
        direction,
        strength,
        confidence,
    }
}

// ---------------------------------------------------------------------------
// Strategy 2 -- Trend Following
// ---------------------------------------------------------------------------

fn score_trend_following(
    _opens: &[f64],
    closes: &[f64],
    highs: &[f64],
    lows: &[f64],
    volumes: &[f64],
) -> StrategySignal {
    let mut long_score: f64 = 0.0;
    let mut short_score: f64 = 0.0;
    let mut sub_signals: u32 = 0;
    let mut agreeing: u32 = 0;

    // EMA alignment (20, 50, 200)
    let ema20_vec = indicators::ema(closes, 20);
    let ema50_vec = indicators::ema(closes, 50);
    let ema200_vec = indicators::ema(closes, 200);
    let ema20 = last_val(&ema20_vec);
    let ema50 = last_val(&ema50_vec);
    let ema200 = last_val(&ema200_vec);

    if !ema20.is_nan() && !ema50.is_nan() && !ema200.is_nan() {
        sub_signals += 1;
        if ema20 > ema50 && ema50 > ema200 {
            long_score += 0.25;
            agreeing += 1;
        } else if ema20 < ema50 && ema50 < ema200 {
            short_score += 0.25;
            agreeing += 1;
        }
    } else if !ema20.is_nan() && !ema50.is_nan() {
        sub_signals += 1;
        if ema20 > ema50 {
            long_score += 0.15;
            agreeing += 1;
        } else if ema20 < ema50 {
            short_score += 0.15;
            agreeing += 1;
        }
    }

    // ADX > 25 confirms trending market
    let adx_vec = indicators::adx(highs, lows, closes, 14);
    let adx_val = last_val(&adx_vec);
    if !adx_val.is_nan() {
        sub_signals += 1;
        if adx_val > 25.0 {
            let s = clamp01((adx_val - 25.0) / 25.0);
            if long_score > short_score {
                long_score += s * 0.15;
            } else if short_score > long_score {
                short_score += s * 0.15;
            } else {
                long_score += s * 0.05;
            }
            agreeing += 1;
        }
    }

    // ROC(20) for trend momentum
    let roc20_vec = indicators::roc(closes, 20);
    let roc20 = last_val(&roc20_vec);
    if !roc20.is_nan() {
        sub_signals += 1;
        if roc20 > 3.0 {
            let s = clamp01(roc20 / 15.0);
            long_score += s * 0.25;
            agreeing += 1;
        } else if roc20 < -3.0 {
            let s = clamp01(-roc20 / 15.0);
            short_score += s * 0.25;
            agreeing += 1;
        }
    }

    // Price above/below EMA(200)
    if !ema200.is_nan() && !closes.is_empty() {
        let price = closes[closes.len() - 1];
        sub_signals += 1;
        if price > ema200 {
            let pct_above = (price - ema200) / ema200;
            long_score += clamp01(pct_above * 5.0) * 0.2;
            agreeing += 1;
        } else {
            let pct_below = (ema200 - price) / ema200;
            short_score += clamp01(pct_below * 5.0) * 0.2;
            agreeing += 1;
        }
    }

    // Volume confirmation
    let rel_vol_vec = indicators::volume_ratio(volumes, 20);
    let rel_vol = last_val(&rel_vol_vec);
    if !rel_vol.is_nan() {
        sub_signals += 1;
        if rel_vol > 1.0 {
            let s = clamp01((rel_vol - 1.0) / 1.5);
            if long_score > short_score {
                long_score += s * 0.15;
            } else {
                short_score += s * 0.15;
            }
            agreeing += 1;
        }
    }

    // Ichimoku alignment
    let (ichi_tenkan, ichi_kijun, ichi_senkou_a, ichi_senkou_b, _ichi_chikou) =
        indicators::ichimoku(highs, lows, closes, 9, 26, 52);
    let tenkan = last_val(&ichi_tenkan);
    let kijun = last_val(&ichi_kijun);
    let senkou_a = last_val(&ichi_senkou_a);
    let senkou_b = last_val(&ichi_senkou_b);
    if !tenkan.is_nan() && !kijun.is_nan() && !senkou_a.is_nan() && !senkou_b.is_nan()
        && !closes.is_empty()
    {
        let price = closes[closes.len() - 1];
        sub_signals += 1;
        let above_a = price > senkou_a;
        let above_b = price > senkou_b;
        let tenkan_above = tenkan > kijun;
        let below_a = price < senkou_a;
        let below_b = price < senkou_b;
        let tenkan_below = tenkan < kijun;

        if above_a && above_b && tenkan_above {
            long_score += 0.15;
            agreeing += 1;
        } else if below_a && below_b && tenkan_below {
            short_score += 0.15;
            agreeing += 1;
        } else {
            // Partial alignment: count matching conditions
            let long_conds =
                above_a as u32 + above_b as u32 + tenkan_above as u32;
            let short_conds =
                below_a as u32 + below_b as u32 + tenkan_below as u32;
            if long_conds >= 2 {
                long_score += 0.08;
                agreeing += 1;
            } else if short_conds >= 2 {
                short_score += 0.08;
                agreeing += 1;
            }
        }
    }

    // Supertrend direction
    let (_st_line, st_dir) = indicators::supertrend(highs, lows, closes, 10, 3.0);
    let st_direction = last_val(&st_dir);
    if !st_direction.is_nan() {
        sub_signals += 1;
        if st_direction == 1.0 {
            long_score += 0.12;
            agreeing += 1;
        } else if st_direction == -1.0 {
            short_score += 0.12;
            agreeing += 1;
        }
    }

    // TRIX confirmation
    let trix_vec = indicators::trix(closes, 14);
    let trix_val = last_val(&trix_vec);
    if !trix_val.is_nan() && trix_vec.len() >= 2 {
        sub_signals += 1;
        let prev_trix = trix_vec[trix_vec.len() - 2];
        if !prev_trix.is_nan() {
            if trix_val > 0.0 && trix_val > prev_trix {
                long_score += 0.08;
                agreeing += 1;
            } else if trix_val < 0.0 && trix_val < prev_trix {
                short_score += 0.08;
                agreeing += 1;
            }
        }
    }

    // Market structure
    let ms_vec = indicators::market_structure(highs, lows, 20);
    let ms_val = last_val(&ms_vec);
    if !ms_val.is_nan() {
        sub_signals += 1;
        if ms_val > 0.5 {
            long_score += 0.10;
            agreeing += 1;
        } else if ms_val < -0.5 {
            short_score += 0.10;
            agreeing += 1;
        }
    }

    let net_score = long_score - short_score;
    let mut direction = Direction::Neutral;
    let mut strength = 0.0;

    if net_score > 0.05 {
        direction = Direction::Long;
        strength = clamp01(long_score * 1.8);
    } else if net_score < -0.05 {
        direction = Direction::Short;
        strength = clamp01(short_score * 1.8);
    }

    let confidence = if sub_signals > 0 {
        clamp01(agreeing as f64 / sub_signals as f64)
    } else {
        0.0
    };

    StrategySignal {
        direction,
        strength,
        confidence,
    }
}

// ---------------------------------------------------------------------------
// Strategy 3 -- Momentum
// ---------------------------------------------------------------------------

fn score_momentum(
    _opens: &[f64],
    closes: &[f64],
    highs: &[f64],
    lows: &[f64],
    volumes: &[f64],
) -> StrategySignal {
    let mut long_score: f64 = 0.0;
    let mut short_score: f64 = 0.0;
    let mut sub_signals: u32 = 0;
    let mut agreeing: u32 = 0;

    // ROC(10) and ROC(20)
    let roc10_vec = indicators::roc(closes, 10);
    let roc20_vec = indicators::roc(closes, 20);
    let roc10 = last_val(&roc10_vec);
    let roc20 = last_val(&roc20_vec);
    if !roc10.is_nan() && !roc20.is_nan() {
        sub_signals += 1;
        if roc10 > 1.0 && roc20 > 2.0 {
            let s = clamp01((roc10 + roc20) / 30.0);
            long_score += s * 0.25;
            agreeing += 1;
        } else if roc10 < -1.0 && roc20 < -2.0 {
            let s = clamp01((-roc10 + -roc20) / 30.0);
            short_score += s * 0.25;
            agreeing += 1;
        }
    }

    // RSI in momentum zone
    let rsi_vec = indicators::rsi(closes, 14);
    let rsi_val = last_val(&rsi_vec);
    if !rsi_val.is_nan() {
        sub_signals += 1;
        if rsi_val >= 50.0 && rsi_val <= 70.0 {
            let s = clamp01((rsi_val - 50.0) / 20.0);
            long_score += s * 0.2;
            agreeing += 1;
        } else if rsi_val >= 30.0 && rsi_val < 50.0 {
            let s = clamp01((50.0 - rsi_val) / 20.0);
            short_score += s * 0.2;
            agreeing += 1;
        }
    }

    // Relative volume above average
    let rel_vol_vec = indicators::volume_ratio(volumes, 20);
    let rel_vol = last_val(&rel_vol_vec);
    if !rel_vol.is_nan() {
        sub_signals += 1;
        if rel_vol > 1.2 {
            let s = clamp01((rel_vol - 1.2) / 1.5);
            if long_score >= short_score {
                long_score += s * 0.2;
            } else {
                short_score += s * 0.2;
            }
            agreeing += 1;
        }
    }

    // OBV trend
    let obv_t = indicators::obv_trend(closes, volumes, 20);
    if obv_t.abs() > 0.1 {
        sub_signals += 1;
        if obv_t > 0.1 {
            long_score += clamp01(obv_t) * 0.2;
            agreeing += 1;
        } else {
            short_score += clamp01(-obv_t) * 0.2;
            agreeing += 1;
        }
    }

    // MFI confirmation
    let mfi_vec = indicators::mfi(highs, lows, closes, volumes, 14);
    let mfi_val = last_val(&mfi_vec);
    if !mfi_val.is_nan() {
        sub_signals += 1;
        if mfi_val > 50.0 && long_score > short_score {
            let s = clamp01((mfi_val - 50.0) / 30.0);
            long_score += s * 0.15;
            agreeing += 1;
        } else if mfi_val < 50.0 && short_score > long_score {
            let s = clamp01((50.0 - mfi_val) / 30.0);
            short_score += s * 0.15;
            agreeing += 1;
        }
    }

    // Awesome Oscillator
    let ao_vec = indicators::awesome_oscillator(highs, lows);
    let ao_val = last_val(&ao_vec);
    if !ao_val.is_nan() && ao_vec.len() >= 2 {
        let prev_ao = ao_vec[ao_vec.len() - 2];
        if !prev_ao.is_nan() {
            sub_signals += 1;
            if ao_val > 0.0 && ao_val > prev_ao {
                long_score += 0.12;
                agreeing += 1;
            } else if ao_val < 0.0 && ao_val < prev_ao {
                short_score += 0.12;
                agreeing += 1;
            }
        }
    }

    // Force Index
    let fi_vec = indicators::force_index(closes, volumes, 13);
    let fi_val = last_val(&fi_vec);
    if !fi_val.is_nan() {
        sub_signals += 1;
        if fi_val > 0.0 {
            long_score += 0.10;
            agreeing += 1;
        } else if fi_val < 0.0 {
            short_score += 0.10;
            agreeing += 1;
        }
    }

    // Elder Ray
    let (er_bull, er_bear) = indicators::elder_ray(highs, lows, closes, 13);
    let bull_power = last_val(&er_bull);
    let bear_power = last_val(&er_bear);
    if !bull_power.is_nan() && !bear_power.is_nan() && er_bear.len() >= 2 && er_bull.len() >= 2 {
        let prev_bear = er_bear[er_bear.len() - 2];
        let prev_bull = er_bull[er_bull.len() - 2];
        sub_signals += 1;
        // Bullish: bull_power > 0 AND bear_power is rising (improving)
        if bull_power > 0.0 && !prev_bear.is_nan() && bear_power > prev_bear {
            long_score += 0.10;
            agreeing += 1;
        }
        // Bearish: bear_power < 0 AND bull_power is falling (weakening)
        else if bear_power < 0.0 && !prev_bull.is_nan() && bull_power < prev_bull {
            short_score += 0.10;
            agreeing += 1;
        }
    }

    // ADL trend (compare ADL to its SMA(20))
    let adl_vec = indicators::adl(highs, lows, closes, volumes);
    let adl_val = last_val(&adl_vec);
    if !adl_val.is_nan() {
        let adl_sma_vec = indicators::sma(&adl_vec, 20);
        let adl_sma = last_val(&adl_sma_vec);
        if !adl_sma.is_nan() {
            sub_signals += 1;
            if adl_val > adl_sma {
                long_score += 0.08;
                agreeing += 1;
            } else {
                short_score += 0.08;
                agreeing += 1;
            }
        }
    }

    let net_score = long_score - short_score;
    let mut direction = Direction::Neutral;
    let mut strength = 0.0;

    if net_score > 0.05 {
        direction = Direction::Long;
        strength = clamp01(long_score * 1.8);
    } else if net_score < -0.05 {
        direction = Direction::Short;
        strength = clamp01(short_score * 1.8);
    }

    let confidence = if sub_signals > 0 {
        clamp01(agreeing as f64 / sub_signals as f64)
    } else {
        0.0
    };

    StrategySignal {
        direction,
        strength,
        confidence,
    }
}

// ---------------------------------------------------------------------------
// Strategy 4 -- Breakout
// ---------------------------------------------------------------------------

fn score_breakout(
    _opens: &[f64],
    closes: &[f64],
    highs: &[f64],
    lows: &[f64],
    volumes: &[f64],
) -> StrategySignal {
    let mut long_score: f64 = 0.0;
    let mut short_score: f64 = 0.0;
    let mut sub_signals: u32 = 0;
    let mut agreeing: u32 = 0;

    let price = if !closes.is_empty() {
        closes[closes.len() - 1]
    } else {
        0.0
    };

    // Donchian channel breakout (20-period high/low)
    let lookback: usize = 20;
    if highs.len() >= lookback && lows.len() >= lookback {
        let channel_highs = &highs[highs.len() - lookback..];
        let channel_lows = &lows[lows.len() - lookback..];
        let donchian_high = channel_highs
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        let donchian_low = channel_lows
            .iter()
            .copied()
            .fold(f64::INFINITY, f64::min);
        sub_signals += 1;

        if price >= donchian_high {
            long_score += 0.3;
            agreeing += 1;
        } else if price <= donchian_low {
            short_score += 0.3;
            agreeing += 1;
        } else {
            let range = donchian_high - donchian_low;
            if range > 0.0 {
                let position = (price - donchian_low) / range;
                if position > 0.9 {
                    long_score += 0.15;
                    agreeing += 1;
                } else if position < 0.1 {
                    short_score += 0.15;
                    agreeing += 1;
                }
            }
        }
    }

    // 50-period Donchian (secondary confirmation)
    let lookback50: usize = 50;
    if highs.len() >= lookback50 && lows.len() >= lookback50 {
        let channel_highs50 = &highs[highs.len() - lookback50..];
        let channel_lows50 = &lows[lows.len() - lookback50..];
        let donchian_high50 = channel_highs50
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        let donchian_low50 = channel_lows50
            .iter()
            .copied()
            .fold(f64::INFINITY, f64::min);
        sub_signals += 1;

        if price >= donchian_high50 {
            long_score += 0.2;
            agreeing += 1;
        } else if price <= donchian_low50 {
            short_score += 0.2;
            agreeing += 1;
        }
    }

    // Volume surge
    let rel_vol_vec = indicators::volume_ratio(volumes, 20);
    let rel_vol = last_val(&rel_vol_vec);
    if !rel_vol.is_nan() {
        sub_signals += 1;
        if rel_vol > 1.3 {
            let s = clamp01((rel_vol - 1.3) / 2.0);
            if long_score >= short_score {
                long_score += s * 0.25;
            } else {
                short_score += s * 0.25;
            }
            agreeing += 1;
        }
    }

    // ATR expansion (current ATR(14) vs long ATR(50))
    let current_atr_vec = indicators::atr(highs, lows, closes, 14);
    let long_atr_vec = indicators::atr(highs, lows, closes, 50);
    let current_atr = last_val(&current_atr_vec);
    let long_atr = last_val(&long_atr_vec);
    if !current_atr.is_nan() && !long_atr.is_nan() && long_atr > 0.0 {
        sub_signals += 1;
        let atr_ratio = current_atr / long_atr;
        if atr_ratio > 1.1 {
            let s = clamp01((atr_ratio - 1.1) / 1.0);
            if long_score >= short_score {
                long_score += s * 0.2;
            } else {
                short_score += s * 0.2;
            }
            agreeing += 1;
        }
    }

    // ADX rising above 20
    let adx_vec = indicators::adx(highs, lows, closes, 14);
    let adx_val = last_val(&adx_vec);
    if !adx_val.is_nan() {
        sub_signals += 1;
        if adx_val > 20.0 && adx_val < 40.0 {
            let s = clamp01((adx_val - 20.0) / 20.0);
            if long_score >= short_score {
                long_score += s * 0.15;
            } else {
                short_score += s * 0.15;
            }
            agreeing += 1;
        }
    }

    // Bollinger bandwidth expanding
    let (bb_upper, bb_mid, bb_lower) = indicators::bollinger_bands(closes, 20, 2.0);
    let upper = last_val(&bb_upper);
    let middle = last_val(&bb_mid);
    let lower = last_val(&bb_lower);
    if !upper.is_nan() && !middle.is_nan() && !lower.is_nan() {
        sub_signals += 1;
        let bandwidth = if middle != 0.0 {
            (upper - lower) / middle
        } else {
            0.0
        };
        if bandwidth > 0.08 {
            let s = clamp01((bandwidth - 0.08) / 0.1);
            if long_score >= short_score {
                long_score += s * 0.1;
            } else {
                short_score += s * 0.1;
            }
            agreeing += 1;
        }
    }

    // Squeeze detection (BB inside KC -> compression -> breakout imminent)
    let squeeze_vec =
        indicators::squeeze_detect(highs, lows, closes, 20, 2.0, 20, 14, 1.5);
    if squeeze_vec.len() >= 6 {
        sub_signals += 1;
        let n = squeeze_vec.len();
        // Check if squeeze was active in last 5 bars and just released
        let recent_squeeze = squeeze_vec[n - 6..n - 1].iter().any(|&s| s);
        let now_released = !squeeze_vec[n - 1];
        if recent_squeeze && now_released {
            // Squeeze just released -- strong breakout signal in price direction
            if closes.len() >= 2 {
                let last_close = closes[closes.len() - 1];
                let prev_close = closes[closes.len() - 2];
                if last_close > prev_close {
                    long_score += 0.20;
                    agreeing += 1;
                } else if last_close < prev_close {
                    short_score += 0.20;
                    agreeing += 1;
                }
            }
        }
    }

    // Support/Resistance breaks
    let (sr_support, sr_resistance) = indicators::support_resistance(highs, lows, 50);
    let sr_sup = last_val(&sr_support);
    let sr_res = last_val(&sr_resistance);
    if !sr_sup.is_nan() && !sr_res.is_nan() {
        sub_signals += 1;
        if price > sr_res {
            long_score += 0.12;
            agreeing += 1;
        } else if price < sr_sup {
            short_score += 0.12;
            agreeing += 1;
        }
    }

    // Ichimoku cloud breakout (kumo breakout)
    let (_, _, ichi_senkou_a, ichi_senkou_b, _) =
        indicators::ichimoku(highs, lows, closes, 9, 26, 52);
    let senkou_a = last_val(&ichi_senkou_a);
    let senkou_b = last_val(&ichi_senkou_b);
    if !senkou_a.is_nan() && !senkou_b.is_nan() {
        sub_signals += 1;
        if price > senkou_a && price > senkou_b {
            long_score += 0.10;
            agreeing += 1;
        } else if price < senkou_a && price < senkou_b {
            short_score += 0.10;
            agreeing += 1;
        }
    }

    // Keltner expansion (price outside KC with volume surge)
    let (kc_upper_bo, _kc_mid_bo, kc_lower_bo) =
        indicators::keltner_channels(highs, lows, closes, 20, 14, 2.0);
    let kc_u = last_val(&kc_upper_bo);
    let kc_l = last_val(&kc_lower_bo);
    if !kc_u.is_nan() && !kc_l.is_nan() && !rel_vol.is_nan() {
        sub_signals += 1;
        if price > kc_u && rel_vol > 1.2 {
            long_score += 0.10;
            agreeing += 1;
        } else if price < kc_l && rel_vol > 1.2 {
            short_score += 0.10;
            agreeing += 1;
        }
    }

    let net_score = long_score - short_score;
    let mut direction = Direction::Neutral;
    let mut strength = 0.0;

    if net_score > 0.03 {
        direction = Direction::Long;
        strength = clamp01(long_score * 1.6);
    } else if net_score < -0.03 {
        direction = Direction::Short;
        strength = clamp01(short_score * 1.6);
    }

    let confidence = if sub_signals > 0 {
        clamp01(agreeing as f64 / sub_signals as f64)
    } else {
        0.0
    };

    StrategySignal {
        direction,
        strength,
        confidence,
    }
}

// ---------------------------------------------------------------------------
// Regime Detection & Weights
// ---------------------------------------------------------------------------

fn detect_regime(closes: &[f64], highs: &[f64], lows: &[f64]) -> &'static str {
    let adx_vec = indicators::adx(highs, lows, closes, 14);
    let adx_val = last_val(&adx_vec);
    let short_atr_vec = indicators::atr(highs, lows, closes, 14);
    let long_atr_vec = indicators::atr(highs, lows, closes, 50);
    let short_atr = last_val(&short_atr_vec);
    let long_atr = last_val(&long_atr_vec);

    let atr_ratio = if !short_atr.is_nan() && !long_atr.is_nan() && long_atr > 0.0 {
        short_atr / long_atr
    } else {
        1.0
    };

    // High vol + weak trend = volatile
    if atr_ratio > 1.3 && (adx_val.is_nan() || adx_val < 20.0) {
        return "volatile";
    }
    // Strong trend
    if !adx_val.is_nan() && adx_val > 30.0 {
        let ema50_vec = indicators::ema(closes, 50);
        let ema50 = last_val(&ema50_vec);
        let price = if !closes.is_empty() {
            closes[closes.len() - 1]
        } else {
            0.0
        };
        if !ema50.is_nan() && price > ema50 {
            return "trending_up";
        }
        return "trending_down";
    }
    // Moderate trend
    if !adx_val.is_nan() && adx_val > 20.0 {
        return "moderate_trend";
    }
    // Default: range-bound / sideways
    "sideways"
}

/// Returns weights for [MEAN_REVERSION, TREND_FOLLOWING, MOMENTUM, BREAKOUT].
fn get_regime_weights(regime: &str) -> [f64; 4] {
    match regime {
        "trending_up" => [0.1, 0.4, 0.3, 0.2],
        "trending_down" => [0.3, 0.35, 0.2, 0.15],
        "moderate_trend" => [0.2, 0.3, 0.3, 0.2],
        "volatile" => [0.35, 0.15, 0.25, 0.25],
        _ /* sideways */ => [0.35, 0.15, 0.25, 0.25],
    }
}

// ---------------------------------------------------------------------------
// Public API: Multi-Strategy Consensus Scorer (0-100)
// ---------------------------------------------------------------------------

/// Score using 4-strategy consensus (mean-reversion, trend-following, momentum, breakout).
/// Returns 0-100. Port of `scoreMultiStrategy()` from strategies.ts.
pub fn score_multi_strategy(candles: &[Candle]) -> f64 {
    if candles.len() < 50 {
        return 50.0; // insufficient data -> neutral
    }

    let opens: Vec<f64> = candles.iter().map(|c| c.open).collect();
    let closes: Vec<f64> = candles.iter().map(|c| c.close).collect();
    let highs: Vec<f64> = candles.iter().map(|c| c.high).collect();
    let lows: Vec<f64> = candles.iter().map(|c| c.low).collect();
    let volumes: Vec<f64> = candles.iter().map(|c| c.volume).collect();

    // Run all 4 strategies
    let mr = score_mean_reversion(&opens, &closes, &highs, &lows, &volumes);
    let tf = score_trend_following(&opens, &closes, &highs, &lows, &volumes);
    let mo = score_momentum(&opens, &closes, &highs, &lows, &volumes);
    let bo = score_breakout(&opens, &closes, &highs, &lows, &volumes);

    let strategies = [&mr, &tf, &mo, &bo];

    // Detect regime and get weights [MR, TF, MO, BO]
    let regime = detect_regime(&closes, &highs, &lows);
    let weights = get_regime_weights(regime);

    // Count agreements
    let long_count = strategies
        .iter()
        .filter(|s| s.direction == Direction::Long)
        .count();
    let short_count = strategies
        .iter()
        .filter(|s| s.direction == Direction::Short)
        .count();

    // Weighted strength calculation
    let mut weighted_long: f64 = 0.0;
    let mut weighted_short: f64 = 0.0;
    for (i, s) in strategies.iter().enumerate() {
        let w = weights[i];
        match s.direction {
            Direction::Long => weighted_long += s.strength * s.confidence * w,
            Direction::Short => weighted_short += s.strength * s.confidence * w,
            Direction::Neutral => {}
        }
    }

    // Multi-strategy agreement gate
    if long_count >= 2 {
        // Strong LONG consensus: 55-95 range
        return (55.0 + clamp01(weighted_long * 2.0) * 40.0).round();
    }

    if short_count >= 2 {
        // Strong SHORT consensus: 5-40 range
        return (40.0 - clamp01(weighted_short * 2.0) * 35.0).round();
    }

    // Single high-conviction strategy
    if long_count == 1 {
        // Find the long strategy
        if let Some(s) = strategies.iter().find(|s| s.direction == Direction::Long) {
            if s.strength > 0.35 && s.confidence > 0.4 {
                return (50.0 + clamp01(weighted_long * 1.5) * 35.0).round();
            }
        }
    }

    if short_count == 1 {
        if let Some(s) = strategies.iter().find(|s| s.direction == Direction::Short) {
            if s.strength > 0.35 && s.confidence > 0.4 {
                return (45.0 - clamp01(weighted_short * 1.5) * 30.0).round();
            }
        }
    }

    // Neutral -- slight bias from weighted scores
    let net_score = weighted_long - weighted_short;
    (50.0 + clamp(net_score * 10.0, -10.0, 10.0)).round()
}

// ---------------------------------------------------------------------------
// Public API: Legacy Weighted-Average Scorer (0-100)
// ---------------------------------------------------------------------------

/// Default weights for the legacy scorer (from DEFAULT_TECHNICAL_WEIGHTS in scorer.ts).
struct LegacyWeights {
    rsi: f64,
    macd: f64,
    moving_average: f64,
    ema_cross: f64,
    bollinger: f64,
    adx: f64,
    stochastic: f64,
    williams_r: f64,
    mfi: f64,
    cci: f64,
    parabolic_sar: f64,
    roc: f64,
    volume_ratio: f64,
}

const DEFAULT_LEGACY_WEIGHTS: LegacyWeights = LegacyWeights {
    rsi: 15.0,
    macd: 15.0,
    moving_average: 15.0,
    ema_cross: 5.0,
    bollinger: 10.0,
    adx: 5.0,
    stochastic: 10.0,
    williams_r: 5.0,
    mfi: 5.0,
    cci: 5.0,
    parabolic_sar: 5.0,
    roc: 3.0,
    volume_ratio: 2.0,
};

/// Score using legacy weighted-average scorer.
/// Returns 0-100. Port of `computeScore()` from scorer.ts.
///
/// Includes ichimoku (weight 8), awesome oscillator (weight 5), and candlestick
/// patterns (weight 7) for a total weight of ~118.
pub fn score_legacy(candles: &[Candle]) -> f64 {
    if candles.is_empty() {
        return 50.0;
    }

    let opens: Vec<f64> = candles.iter().map(|c| c.open).collect();
    let closes: Vec<f64> = candles.iter().map(|c| c.close).collect();
    let highs: Vec<f64> = candles.iter().map(|c| c.high).collect();
    let lows: Vec<f64> = candles.iter().map(|c| c.low).collect();
    let volumes: Vec<f64> = candles.iter().map(|c| c.volume).collect();

    let price = closes[closes.len() - 1];
    let w = &DEFAULT_LEGACY_WEIGHTS;

    let mut total_weight: f64 = 0.0;
    let mut weighted_sum: f64 = 0.0;

    // Helper closure to accumulate weighted signals
    let mut add = |signal: f64, weight: f64| {
        total_weight += weight;
        weighted_sum += signal * weight;
    };

    // --- RSI ---
    let rsi_vec = indicators::rsi(&closes, 14);
    let rsi_val = last_val(&rsi_vec);
    if !rsi_val.is_nan() {
        let rsi_signal = if rsi_val < 30.0 {
            80.0 + (30.0 - rsi_val)
        } else if rsi_val < 40.0 {
            65.0
        } else if rsi_val > 70.0 {
            20.0 - (rsi_val - 70.0)
        } else if rsi_val > 60.0 {
            35.0
        } else {
            50.0
        };
        add(rsi_signal.max(0.0).min(100.0), w.rsi);
    }

    // --- MACD ---
    let (_macd_line, _signal_line, histogram) = indicators::macd(&closes, 12, 26, 9);
    let hist = last_val(&histogram);
    if !hist.is_nan() {
        let macd_signal = if hist > 0.0 {
            (50.0 + hist * 10.0).min(90.0)
        } else {
            (50.0 + hist * 10.0).max(10.0)
        };
        add(macd_signal, w.macd);
    }

    // --- Moving Average Trend ---
    let sma20_vec = indicators::sma(&closes, 20);
    let sma50_vec = indicators::sma(&closes, 50);
    let sma200_vec = indicators::sma(&closes, 200);
    let sma20 = last_val(&sma20_vec);
    let sma50 = last_val(&sma50_vec);
    let sma200 = last_val(&sma200_vec);
    if !sma20.is_nan() && !sma50.is_nan() && !sma200.is_nan() {
        let mut ma_signal: f64 = 50.0;
        if price > sma20 && price > sma50 && price > sma200 {
            ma_signal = 85.0;
        } else if price > sma20 && price > sma50 {
            ma_signal = 70.0;
        } else if price > sma20 {
            ma_signal = 60.0;
        } else if price < sma20 && price < sma50 && price < sma200 {
            ma_signal = 15.0;
        } else if price < sma20 && price < sma50 {
            ma_signal = 30.0;
        } else if price < sma20 {
            ma_signal = 40.0;
        }

        // Golden/death cross bonus
        if sma50 > sma200 {
            ma_signal = (ma_signal + 5.0).min(100.0);
        } else {
            ma_signal = (ma_signal - 5.0).max(0.0);
        }

        add(ma_signal, w.moving_average);
    }

    // --- EMA Crossover ---
    let ema12_vec = indicators::ema(&closes, 12);
    let ema26_vec = indicators::ema(&closes, 26);
    let ema12 = last_val(&ema12_vec);
    let ema26 = last_val(&ema26_vec);
    if !ema12.is_nan() && !ema26.is_nan() {
        add(if ema12 > ema26 { 70.0 } else { 30.0 }, w.ema_cross);
    }

    // --- Bollinger Bands ---
    let (bb_upper, _bb_mid, bb_lower) = indicators::bollinger_bands(&closes, 20, 2.0);
    let upper = last_val(&bb_upper);
    let lower = last_val(&bb_lower);
    if !upper.is_nan() && !lower.is_nan() {
        let bb_range = upper - lower;
        if bb_range > 0.0 {
            let position = (price - lower) / bb_range;
            // Near lower band = bullish, near upper = bearish (mean-reversion)
            let bb_signal = ((1.0 - position) * 100.0).max(0.0).min(100.0);
            add(bb_signal, w.bollinger);
        }
    }

    // --- ADX ---
    let adx_vec = indicators::adx(&highs, &lows, &closes, 14);
    let adx_val = last_val(&adx_vec);
    if !adx_val.is_nan() {
        let adx_signal = if adx_val > 25.0 {
            65.0
        } else if adx_val > 20.0 {
            55.0
        } else {
            45.0
        };
        add(adx_signal, w.adx);
    }

    // --- Stochastic ---
    let (stoch_k_vec, stoch_d_vec) = indicators::stochastic(&highs, &lows, &closes, 14, 3);
    let stoch_k = last_val(&stoch_k_vec);
    let stoch_d = last_val(&stoch_d_vec);
    if !stoch_k.is_nan() {
        let mut stoch_signal: f64 = if stoch_k < 20.0 {
            80.0
        } else if stoch_k > 80.0 {
            20.0
        } else {
            50.0
        };
        // K crossing above D = bullish
        if !stoch_d.is_nan() {
            if stoch_k > stoch_d {
                stoch_signal += 10.0;
            } else {
                stoch_signal -= 10.0;
            }
        }
        add(stoch_signal.max(0.0).min(100.0), w.stochastic);
    }

    // --- Williams %R ---
    let wr_vec = indicators::williams_r(&highs, &lows, &closes, 14);
    let wr = last_val(&wr_vec);
    if !wr.is_nan() {
        let wr_signal = if wr < -80.0 {
            75.0
        } else if wr > -20.0 {
            25.0
        } else {
            50.0
        };
        add(wr_signal, w.williams_r);
    }

    // --- MFI ---
    let mfi_vec = indicators::mfi(&highs, &lows, &closes, &volumes, 14);
    let mfi_val = last_val(&mfi_vec);
    if !mfi_val.is_nan() {
        let mfi_signal = if mfi_val < 20.0 {
            80.0
        } else if mfi_val > 80.0 {
            20.0
        } else {
            50.0
        };
        add(mfi_signal, w.mfi);
    }

    // --- CCI ---
    let cci_vec = indicators::cci(&highs, &lows, &closes, 20);
    let cci_val = last_val(&cci_vec);
    if !cci_val.is_nan() {
        let cci_signal = if cci_val < -100.0 {
            75.0
        } else if cci_val > 100.0 {
            25.0
        } else {
            50.0
        };
        add(cci_signal, w.cci);
    }

    // --- Parabolic SAR ---
    let psar_vec = indicators::parabolic_sar(&highs, &lows, 0.02, 0.02, 0.2);
    let psar = last_val(&psar_vec);
    if !psar.is_nan() {
        add(if price > psar { 70.0 } else { 30.0 }, w.parabolic_sar);
    }

    // --- ROC ---
    let roc_vec = indicators::roc(&closes, 12);
    let roc_val = last_val(&roc_vec);
    if !roc_val.is_nan() {
        let roc_signal = if roc_val > 0.0 {
            (50.0 + roc_val * 5.0).min(85.0)
        } else {
            (50.0 + roc_val * 5.0).max(15.0)
        };
        add(roc_signal, w.roc);
    }

    // --- Volume Ratio ---
    let vol_ratio_vec = indicators::volume_ratio(&volumes, 20);
    let vol_ratio = last_val(&vol_ratio_vec);
    if !vol_ratio.is_nan() {
        let vol_signal = if vol_ratio > 1.5 {
            60.0
        } else if vol_ratio < 0.5 {
            40.0
        } else {
            50.0
        };
        add(vol_signal, w.volume_ratio);
    }

    // --- Ichimoku signal (weight 8.0) ---
    let (ichi_tenkan, ichi_kijun, ichi_senkou_a, ichi_senkou_b, _ichi_chikou) =
        indicators::ichimoku(&highs, &lows, &closes, 9, 26, 52);
    let tenkan = last_val(&ichi_tenkan);
    let kijun = last_val(&ichi_kijun);
    let senkou_a = last_val(&ichi_senkou_a);
    let senkou_b = last_val(&ichi_senkou_b);
    if !tenkan.is_nan() && !kijun.is_nan() && !senkou_a.is_nan() && !senkou_b.is_nan() {
        let ichi_signal = if price > senkou_a && tenkan > kijun {
            75.0
        } else if price < senkou_b && tenkan < kijun {
            25.0
        } else {
            50.0
        };
        add(ichi_signal, 8.0);
    }

    // --- Awesome Oscillator signal (weight 5.0) ---
    let ao_vec = indicators::awesome_oscillator(&highs, &lows);
    let ao_val = last_val(&ao_vec);
    if !ao_val.is_nan() {
        let ao_signal = if ao_val > 0.0 {
            (60.0 + clamp(ao_val * 2.0, 0.0, 25.0)).min(100.0)
        } else {
            (40.0 - clamp(-ao_val * 2.0, 0.0, 25.0)).max(0.0)
        };
        add(ao_signal, 5.0);
    }

    // --- Candlestick patterns signal (weight 7.0) ---
    let candle_sig = candlesticks::detect_patterns(&opens, &highs, &lows, &closes);
    add(candle_sig.net_score, 7.0);

    if total_weight == 0.0 {
        return 50.0;
    }
    (weighted_sum / total_weight).round()
}
