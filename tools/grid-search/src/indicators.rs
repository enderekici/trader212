// ---------------------------------------------------------------------------
// Technical Indicators — pure Rust, no external indicator crates.
//
// Every series-returning function produces a `Vec<f64>` of the **same length**
// as its input.  Elements where there is insufficient data to compute the
// indicator are set to `f64::NAN`.
//
// The math is a faithful port of the TypeScript implementations in
//   src/analysis/technical/indicators.ts
//   src/analysis/technical/strategies.ts  (obvTrend)
// ---------------------------------------------------------------------------

// ─── SMA ────────────────────────────────────────────────────────────────────

/// Simple Moving Average over `period` values.
#[inline]
pub fn sma(data: &[f64], period: usize) -> Vec<f64> {
    let n = data.len();
    if period == 0 || n == 0 {
        return vec![f64::NAN; n];
    }
    let mut out = vec![f64::NAN; n];
    if n < period {
        return out;
    }

    // Running sum for the first window
    let mut sum: f64 = data[..period].iter().sum();
    out[period - 1] = sum / period as f64;

    for i in period..n {
        sum += data[i] - data[i - period];
        out[i] = sum / period as f64;
    }
    out
}

// ─── EMA ────────────────────────────────────────────────────────────────────

/// Exponential Moving Average.  Seeded with the SMA of the first `period`
/// values, then uses `k = 2 / (period + 1)`.
#[inline]
pub fn ema(data: &[f64], period: usize) -> Vec<f64> {
    let n = data.len();
    if period == 0 || n == 0 {
        return vec![f64::NAN; n];
    }
    let mut out = vec![f64::NAN; n];
    if n < period {
        return out;
    }

    let k = 2.0 / (period as f64 + 1.0);

    // Seed: SMA of first `period` values
    let seed: f64 = data[..period].iter().sum::<f64>() / period as f64;
    out[period - 1] = seed;

    let mut prev = seed;
    for i in period..n {
        let val = data[i] * k + prev * (1.0 - k);
        out[i] = val;
        prev = val;
    }
    out
}

// ─── RSI ────────────────────────────────────────────────────────────────────

/// Relative Strength Index (0-100) using Wilder's smoothing.
///
/// The `technicalindicators` JS library uses Wilder's method: the first value
/// is a simple average of gains/losses over `period`, then subsequent values
/// use `prev_avg * (period - 1) + current) / period`.
///
/// Needs `period + 1` data points for the first value, so `out[period]` is
/// the first non-NAN element.
pub fn rsi(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if period == 0 || n == 0 {
        return vec![f64::NAN; n];
    }
    let mut out = vec![f64::NAN; n];
    if n < period + 1 {
        return out;
    }

    // Calculate first gain/loss averages using simple mean
    let mut avg_gain = 0.0_f64;
    let mut avg_loss = 0.0_f64;
    for i in 1..=period {
        let change = closes[i] - closes[i - 1];
        if change > 0.0 {
            avg_gain += change;
        } else {
            avg_loss -= change; // absolute value
        }
    }
    avg_gain /= period as f64;
    avg_loss /= period as f64;

    if avg_loss == 0.0 {
        out[period] = 100.0;
    } else {
        let rs = avg_gain / avg_loss;
        out[period] = 100.0 - 100.0 / (1.0 + rs);
    }

    // Wilder's smoothing for subsequent values
    let p = period as f64;
    for i in (period + 1)..n {
        let change = closes[i] - closes[i - 1];
        let (gain, loss) = if change > 0.0 {
            (change, 0.0)
        } else {
            (0.0, -change)
        };
        avg_gain = (avg_gain * (p - 1.0) + gain) / p;
        avg_loss = (avg_loss * (p - 1.0) + loss) / p;

        if avg_loss == 0.0 {
            out[i] = 100.0;
        } else {
            let rs = avg_gain / avg_loss;
            out[i] = 100.0 - 100.0 / (1.0 + rs);
        }
    }
    out
}

// ─── ROC ────────────────────────────────────────────────────────────────────

/// Rate of Change (percentage): `(current - past) / past * 100`.
pub fn roc(data: &[f64], period: usize) -> Vec<f64> {
    let n = data.len();
    if period == 0 || n == 0 {
        return vec![f64::NAN; n];
    }
    let mut out = vec![f64::NAN; n];
    for i in period..n {
        let prev = data[i - period];
        if prev != 0.0 {
            out[i] = (data[i] - prev) / prev * 100.0;
        } else {
            out[i] = 0.0;
        }
    }
    out
}

// ─── True Range helper ──────────────────────────────────────────────────────

#[inline]
fn true_range(high: f64, low: f64, prev_close: f64) -> f64 {
    let hl = high - low;
    let hc = (high - prev_close).abs();
    let lc = (low - prev_close).abs();
    hl.max(hc).max(lc)
}

// ─── ATR ────────────────────────────────────────────────────────────────────

/// Average True Range using Wilder's smoothing.
///
/// Needs `period + 1` data points (the first TR requires a previous close).
/// First ATR = simple average of TR over `period`, then Wilder-smoothed.
pub fn atr(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if period == 0 || n == 0 {
        return vec![f64::NAN; n];
    }
    let mut out = vec![f64::NAN; n];
    if n < period + 1 {
        return out;
    }

    // Build TR series (index 0 is NAN since we need a previous close)
    // TR[i] for i >= 1
    // First ATR at index `period` = mean of TR[1..=period]
    let mut tr_sum = 0.0_f64;
    for i in 1..=period {
        tr_sum += true_range(highs[i], lows[i], closes[i - 1]);
    }
    let mut atr_val = tr_sum / period as f64;
    out[period] = atr_val;

    let p = period as f64;
    for i in (period + 1)..n {
        let tr = true_range(highs[i], lows[i], closes[i - 1]);
        atr_val = (atr_val * (p - 1.0) + tr) / p;
        out[i] = atr_val;
    }
    out
}

// ─── ADX ────────────────────────────────────────────────────────────────────

/// Average Directional Index (0-100).
///
/// Steps: compute +DM/-DM, smooth them and TR with Wilder's method to get
/// +DI/-DI, then DX = |+DI - -DI| / (+DI + -DI) * 100, then smooth DX
/// into ADX with Wilder's method.
///
/// The `technicalindicators` library requires `period * 2` data points for the
/// first ADX value, matching the TS guard `if (closes.length < period * 2)`.
pub fn adx(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if period == 0 || n == 0 {
        return vec![f64::NAN; n];
    }
    let mut out = vec![f64::NAN; n];
    if n < period * 2 {
        return out;
    }

    let p = period as f64;

    // Step 1: compute +DM, -DM, TR arrays (starting at index 1)
    // We need at least period values of DM/TR to start smoothing.
    // Smoothed values start at index `period` (using indices 1..=period).

    let mut smooth_plus_dm = 0.0_f64;
    let mut smooth_minus_dm = 0.0_f64;
    let mut smooth_tr = 0.0_f64;

    // Initial sums over first `period` bars (indices 1..=period)
    for i in 1..=period {
        let up_move = highs[i] - highs[i - 1];
        let down_move = lows[i - 1] - lows[i];
        let plus_dm = if up_move > down_move && up_move > 0.0 {
            up_move
        } else {
            0.0
        };
        let minus_dm = if down_move > up_move && down_move > 0.0 {
            down_move
        } else {
            0.0
        };
        smooth_plus_dm += plus_dm;
        smooth_minus_dm += minus_dm;
        smooth_tr += true_range(highs[i], lows[i], closes[i - 1]);
    }

    // Collect DX values to compute first ADX
    let mut dx_values: Vec<f64> = Vec::with_capacity(period);

    // First DI values at index `period`
    let plus_di = if smooth_tr > 0.0 {
        smooth_plus_dm / smooth_tr * 100.0
    } else {
        0.0
    };
    let minus_di = if smooth_tr > 0.0 {
        smooth_minus_dm / smooth_tr * 100.0
    } else {
        0.0
    };
    let di_sum = plus_di + minus_di;
    let dx = if di_sum > 0.0 {
        (plus_di - minus_di).abs() / di_sum * 100.0
    } else {
        0.0
    };
    dx_values.push(dx);

    // Continue smoothing DM/TR and collecting DX for `period - 1` more bars
    for i in (period + 1)..n {
        let up_move = highs[i] - highs[i - 1];
        let down_move = lows[i - 1] - lows[i];
        let plus_dm = if up_move > down_move && up_move > 0.0 {
            up_move
        } else {
            0.0
        };
        let minus_dm = if down_move > up_move && down_move > 0.0 {
            down_move
        } else {
            0.0
        };
        let tr = true_range(highs[i], lows[i], closes[i - 1]);

        // Wilder smoothing: smoothed = prev - prev/period + current
        smooth_plus_dm = smooth_plus_dm - smooth_plus_dm / p + plus_dm;
        smooth_minus_dm = smooth_minus_dm - smooth_minus_dm / p + minus_dm;
        smooth_tr = smooth_tr - smooth_tr / p + tr;

        let pdi = if smooth_tr > 0.0 {
            smooth_plus_dm / smooth_tr * 100.0
        } else {
            0.0
        };
        let mdi = if smooth_tr > 0.0 {
            smooth_minus_dm / smooth_tr * 100.0
        } else {
            0.0
        };
        let ds = pdi + mdi;
        let d = if ds > 0.0 {
            (pdi - mdi).abs() / ds * 100.0
        } else {
            0.0
        };

        dx_values.push(d);

        // Once we have `period` DX values, compute first ADX
        if dx_values.len() == period {
            let adx_val = dx_values.iter().sum::<f64>() / p;
            out[i] = adx_val;

            // Smooth subsequent ADX values
            let mut prev_adx = adx_val;
            for j in (i + 1)..n {
                let up_move2 = highs[j] - highs[j - 1];
                let down_move2 = lows[j - 1] - lows[j];
                let pdm = if up_move2 > down_move2 && up_move2 > 0.0 {
                    up_move2
                } else {
                    0.0
                };
                let mdm = if down_move2 > up_move2 && down_move2 > 0.0 {
                    down_move2
                } else {
                    0.0
                };
                let tr2 = true_range(highs[j], lows[j], closes[j - 1]);

                smooth_plus_dm = smooth_plus_dm - smooth_plus_dm / p + pdm;
                smooth_minus_dm = smooth_minus_dm - smooth_minus_dm / p + mdm;
                smooth_tr = smooth_tr - smooth_tr / p + tr2;

                let pdi2 = if smooth_tr > 0.0 {
                    smooth_plus_dm / smooth_tr * 100.0
                } else {
                    0.0
                };
                let mdi2 = if smooth_tr > 0.0 {
                    smooth_minus_dm / smooth_tr * 100.0
                } else {
                    0.0
                };
                let ds2 = pdi2 + mdi2;
                let dx2 = if ds2 > 0.0 {
                    (pdi2 - mdi2).abs() / ds2 * 100.0
                } else {
                    0.0
                };

                prev_adx = (prev_adx * (p - 1.0) + dx2) / p;
                out[j] = prev_adx;
            }
            break;
        }
    }

    out
}

// ─── MFI ────────────────────────────────────────────────────────────────────

/// Money Flow Index (0-100).
///
/// Typical price = (H + L + C) / 3.  If TP > prev TP: positive money flow;
/// otherwise negative.  MFI = 100 - 100 / (1 + ratio).
/// Needs `period + 1` data points.
pub fn mfi(
    highs: &[f64],
    lows: &[f64],
    closes: &[f64],
    volumes: &[f64],
    period: usize,
) -> Vec<f64> {
    let n = closes.len();
    if period == 0 || n == 0 {
        return vec![f64::NAN; n];
    }
    let mut out = vec![f64::NAN; n];
    if n < period + 1 {
        return out;
    }

    // Compute typical prices
    let tp: Vec<f64> = (0..n)
        .map(|i| (highs[i] + lows[i] + closes[i]) / 3.0)
        .collect();

    // Compute raw money flow and direction (index 1..n)
    // positive if tp[i] > tp[i-1], negative otherwise
    // We'll use a sliding window of `period` values starting from index 1

    // For the first window: indices 1..=period
    let mut pos_flow = 0.0_f64;
    let mut neg_flow = 0.0_f64;

    // Store the flows for the sliding window
    let mut flows: Vec<f64> = Vec::with_capacity(n); // signed money flow, starting at index 1
    flows.push(0.0); // placeholder for index 0
    for i in 1..n {
        let mf = tp[i] * volumes[i];
        if tp[i] > tp[i - 1] {
            flows.push(mf);
        } else {
            flows.push(-mf);
        }
    }

    // Initial window: flows[1..=period]
    for i in 1..=period {
        if flows[i] > 0.0 {
            pos_flow += flows[i];
        } else {
            neg_flow -= flows[i]; // absolute value
        }
    }

    let mfi_val = if neg_flow == 0.0 {
        100.0
    } else {
        100.0 - 100.0 / (1.0 + pos_flow / neg_flow)
    };
    out[period] = mfi_val;

    // Slide window
    for i in (period + 1)..n {
        let old = flows[i - period];
        let new_val = flows[i];

        // Remove old flow
        if old > 0.0 {
            pos_flow -= old;
        } else {
            neg_flow += old; // old is negative, so add it to reduce neg_flow
        }

        // Add new flow
        if new_val > 0.0 {
            pos_flow += new_val;
        } else {
            neg_flow -= new_val;
        }

        let val = if neg_flow == 0.0 {
            100.0
        } else {
            100.0 - 100.0 / (1.0 + pos_flow / neg_flow)
        };
        out[i] = val;
    }

    out
}

// ─── Williams %R ────────────────────────────────────────────────────────────

/// Williams %R (-100 to 0).
///
/// `%R = (highest_high - close) / (highest_high - lowest_low) * -100`
pub fn williams_r(
    highs: &[f64],
    lows: &[f64],
    closes: &[f64],
    period: usize,
) -> Vec<f64> {
    let n = closes.len();
    if period == 0 || n == 0 {
        return vec![f64::NAN; n];
    }
    let mut out = vec![f64::NAN; n];
    if n < period {
        return out;
    }

    for i in (period - 1)..n {
        let start = i + 1 - period;
        let mut highest = f64::NEG_INFINITY;
        let mut lowest = f64::INFINITY;
        for j in start..=i {
            if highs[j] > highest {
                highest = highs[j];
            }
            if lows[j] < lowest {
                lowest = lows[j];
            }
        }
        let range = highest - lowest;
        if range > 0.0 {
            out[i] = (highest - closes[i]) / range * -100.0;
        } else {
            out[i] = 0.0;
        }
    }
    out
}

// ─── CCI ────────────────────────────────────────────────────────────────────

/// Commodity Channel Index.
///
/// `CCI = (TP - SMA(TP)) / (0.015 * mean_deviation)`
/// where TP = (H + L + C) / 3.
pub fn cci(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if period == 0 || n == 0 {
        return vec![f64::NAN; n];
    }
    let mut out = vec![f64::NAN; n];
    if n < period {
        return out;
    }

    // Compute typical prices
    let tp: Vec<f64> = (0..n)
        .map(|i| (highs[i] + lows[i] + closes[i]) / 3.0)
        .collect();

    for i in (period - 1)..n {
        let start = i + 1 - period;
        let tp_slice = &tp[start..=i];
        let sma_tp = tp_slice.iter().sum::<f64>() / period as f64;

        // Mean deviation
        let mean_dev = tp_slice.iter().map(|&v| (v - sma_tp).abs()).sum::<f64>() / period as f64;

        if mean_dev == 0.0 {
            out[i] = 0.0;
        } else {
            out[i] = (tp[i] - sma_tp) / (0.015 * mean_dev);
        }
    }
    out
}

// ─── Volume Ratio ───────────────────────────────────────────────────────────

/// Volume Ratio: `current_volume / SMA(volume, period)`.
///
/// The TS implementation uses the last `period` volumes as the average
/// denominator and the very last volume as the numerator.  It needs
/// `period + 1` points.  This version produces a value for each element
/// where enough history exists.
pub fn volume_ratio(volumes: &[f64], period: usize) -> Vec<f64> {
    let n = volumes.len();
    if period == 0 || n == 0 {
        return vec![f64::NAN; n];
    }
    let mut out = vec![f64::NAN; n];
    if n < period + 1 {
        return out;
    }

    // At each index i (>= period), compute: vol[i] / mean(vol[i-period+1..=i]).
    // First output at index `period` (TS requires period + 1 data points).
    let mut sum: f64 = volumes[1..=period].iter().sum();
    out[period] = if sum > 0.0 {
        volumes[period] / (sum / period as f64)
    } else {
        f64::NAN
    };

    for i in (period + 1)..n {
        sum += volumes[i] - volumes[i - period];
        let avg = sum / period as f64;
        out[i] = if avg > 0.0 {
            volumes[i] / avg
        } else {
            f64::NAN
        };
    }
    out
}

// ─── Parabolic SAR ──────────────────────────────────────────────────────────

/// Parabolic SAR with configurable acceleration factor.
///
/// Standard implementation: starts in long mode.  SAR follows the extreme
/// point with an acceleration factor that increases on each new extreme,
/// from `af_start` by `af_step` up to `af_max`.
pub fn parabolic_sar(
    highs: &[f64],
    lows: &[f64],
    af_start: f64,
    af_step: f64,
    af_max: f64,
) -> Vec<f64> {
    let n = highs.len();
    if n < 2 {
        return vec![f64::NAN; n];
    }

    let mut out = vec![f64::NAN; n];

    // Determine initial trend: if second bar's high > first bar's high, start long
    let mut is_long = highs[1] >= highs[0];
    let mut af = af_start;
    let mut ep: f64; // extreme point
    let mut sar: f64;

    if is_long {
        sar = lows[0];
        ep = highs[0];
    } else {
        sar = highs[0];
        ep = lows[0];
    }

    out[0] = sar;

    for i in 1..n {
        // Check for reversal
        if is_long {
            if lows[i] < sar {
                // Reverse to short
                is_long = false;
                sar = ep; // SAR becomes the extreme point
                ep = lows[i];
                af = af_start;
            }
        } else if highs[i] > sar {
            // Reverse to long
            is_long = true;
            sar = ep;
            ep = highs[i];
            af = af_start;
        }

        if is_long {
            // Update extreme point
            if highs[i] > ep {
                ep = highs[i];
                af = (af + af_step).min(af_max);
            }
            // Update SAR
            sar += af * (ep - sar);
            // SAR must not be above the low of the current or previous bar
            if i >= 1 {
                sar = sar.min(lows[i - 1]);
            }
            sar = sar.min(lows[i]);
        } else {
            // Update extreme point
            if lows[i] < ep {
                ep = lows[i];
                af = (af + af_step).min(af_max);
            }
            // Update SAR
            sar += af * (ep - sar);
            // SAR must not be below the high of the current or previous bar
            if i >= 1 {
                sar = sar.max(highs[i - 1]);
            }
            sar = sar.max(highs[i]);
        }

        out[i] = sar;
    }

    out
}

// ─── Bollinger Bands ────────────────────────────────────────────────────────

/// Bollinger Bands: `(upper, middle, lower)`.
///
/// `middle = SMA(period)`, `upper = middle + std_mult * stddev`,
/// `lower = middle - std_mult * stddev`.
/// Uses population standard deviation (matching `technicalindicators`).
pub fn bollinger_bands(
    closes: &[f64],
    period: usize,
    std_mult: f64,
) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
    let n = closes.len();
    let nan_vec = || vec![f64::NAN; n];
    if period == 0 || n < period {
        return (nan_vec(), nan_vec(), nan_vec());
    }

    let mut upper = vec![f64::NAN; n];
    let mut middle = vec![f64::NAN; n];
    let mut lower = vec![f64::NAN; n];

    // Running sum for SMA
    let mut sum: f64 = closes[..period].iter().sum();

    for i in (period - 1)..n {
        if i > period - 1 {
            sum += closes[i] - closes[i - period];
        }
        let mean = sum / period as f64;

        // Population standard deviation
        let start = i + 1 - period;
        let variance = closes[start..=i]
            .iter()
            .map(|&v| (v - mean) * (v - mean))
            .sum::<f64>()
            / period as f64;
        let std_dev = variance.sqrt();

        middle[i] = mean;
        upper[i] = mean + std_mult * std_dev;
        lower[i] = mean - std_mult * std_dev;
    }

    (upper, middle, lower)
}

// ─── Stochastic Oscillator ──────────────────────────────────────────────────

/// Stochastic Oscillator: `(%K, %D)`.
///
/// `%K = (close - lowest_low) / (highest_high - lowest_low) * 100`
/// `%D = SMA(%K, d_period)`
///
/// Needs `k_period + d_period - 1` data points.
pub fn stochastic(
    highs: &[f64],
    lows: &[f64],
    closes: &[f64],
    k_period: usize,
    d_period: usize,
) -> (Vec<f64>, Vec<f64>) {
    let n = closes.len();
    let nan_vec = || vec![f64::NAN; n];
    if k_period == 0 || d_period == 0 || n < k_period {
        return (nan_vec(), nan_vec());
    }

    // Compute raw %K
    let mut k_values = vec![f64::NAN; n];
    for i in (k_period - 1)..n {
        let start = i + 1 - k_period;
        let mut highest = f64::NEG_INFINITY;
        let mut lowest = f64::INFINITY;
        for j in start..=i {
            if highs[j] > highest {
                highest = highs[j];
            }
            if lows[j] < lowest {
                lowest = lows[j];
            }
        }
        let range = highest - lowest;
        k_values[i] = if range > 0.0 {
            (closes[i] - lowest) / range * 100.0
        } else {
            50.0 // neutral when range is zero
        };
    }

    // %D = SMA of %K over d_period
    // First valid %K is at index k_period - 1
    // First valid %D is at index k_period - 1 + d_period - 1 = k_period + d_period - 2
    let mut d_values = vec![f64::NAN; n];
    let k_start = k_period - 1;
    let d_start = k_start + d_period - 1;

    if d_start < n {
        let mut k_sum: f64 = k_values[k_start..=d_start].iter().sum();
        d_values[d_start] = k_sum / d_period as f64;

        for i in (d_start + 1)..n {
            k_sum += k_values[i] - k_values[i - d_period];
            d_values[i] = k_sum / d_period as f64;
        }
    }

    (k_values, d_values)
}

// ─── MACD ───────────────────────────────────────────────────────────────────

/// MACD: `(macd_line, signal_line, histogram)`.
///
/// `macd_line = EMA(fast) - EMA(slow)`
/// `signal_line = EMA(macd_line, signal_period)`
/// `histogram = macd_line - signal_line`
///
/// Uses EMA seeded with SMA.
pub fn macd(
    closes: &[f64],
    fast: usize,
    slow: usize,
    signal_period: usize,
) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
    let n = closes.len();
    let nan_vec = || vec![f64::NAN; n];
    if fast == 0 || slow == 0 || signal_period == 0 || fast >= slow {
        return (nan_vec(), nan_vec(), nan_vec());
    }

    let fast_ema = ema(closes, fast);
    let slow_ema = ema(closes, slow);

    // MACD line: fast_ema - slow_ema (valid from index slow - 1)
    let mut macd_line = vec![f64::NAN; n];
    for i in 0..n {
        if !fast_ema[i].is_nan() && !slow_ema[i].is_nan() {
            macd_line[i] = fast_ema[i] - slow_ema[i];
        }
    }

    // Signal line: EMA of MACD line over signal_period
    // First valid MACD is at index slow - 1
    // We need signal_period valid MACD values to seed the signal EMA
    let macd_start = slow - 1;
    let signal_start = macd_start + signal_period - 1;

    let mut signal_line = vec![f64::NAN; n];
    let mut histogram = vec![f64::NAN; n];

    if signal_start < n {
        // Seed signal EMA with SMA of first signal_period MACD values
        let seed: f64 =
            macd_line[macd_start..=signal_start].iter().sum::<f64>() / signal_period as f64;
        signal_line[signal_start] = seed;
        histogram[signal_start] = macd_line[signal_start] - seed;

        let k = 2.0 / (signal_period as f64 + 1.0);
        let mut prev_signal = seed;
        for i in (signal_start + 1)..n {
            if !macd_line[i].is_nan() {
                let sig = macd_line[i] * k + prev_signal * (1.0 - k);
                signal_line[i] = sig;
                histogram[i] = macd_line[i] - sig;
                prev_signal = sig;
            }
        }
    }

    (macd_line, signal_line, histogram)
}

// ─── OBV Trend ──────────────────────────────────────────────────────────────

/// OBV Trend: slope of the last `window` OBV values, normalised to [-1, 1].
///
/// Builds the full OBV series, then computes a linear-regression slope over
/// the last `window` values, normalised by dividing by the mean absolute
/// OBV of that window (scaled by 10, then clamped to [-1, 1]).
///
/// Port of `obvTrend()` from `strategies.ts`.
pub fn obv_trend(closes: &[f64], volumes: &[f64], window: usize) -> f64 {
    let len = closes.len().min(volumes.len());
    if len < window + 1 {
        return 0.0;
    }

    // Build OBV series
    let mut obv = Vec::with_capacity(len);
    obv.push(0.0_f64);
    for i in 1..len {
        let prev = obv[i - 1];
        if closes[i] > closes[i - 1] {
            obv.push(prev + volumes[i]);
        } else if closes[i] < closes[i - 1] {
            obv.push(prev - volumes[i]);
        } else {
            obv.push(prev);
        }
    }

    // Take last `window` values
    let recent = &obv[len - window..];
    let n = recent.len() as f64;
    let x_mean = (n - 1.0) / 2.0;

    let mut num = 0.0_f64;
    let mut den = 0.0_f64;
    for (i, &val) in recent.iter().enumerate() {
        let x = i as f64 - x_mean;
        num += x * val;
        den += x * x;
    }

    if den == 0.0 {
        return 0.0;
    }

    let slope = num / den;
    let mean_abs = {
        let sum: f64 = recent.iter().map(|v| v.abs()).sum();
        let avg = sum / n;
        if avg == 0.0 {
            1.0
        } else {
            avg
        }
    };

    clamp(slope / mean_abs * 10.0, -1.0, 1.0)
}

// ─── Utility ────────────────────────────────────────────────────────────────

#[inline]
fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

// ─── Ichimoku Cloud ────────────────────────────────────────────────────────

/// Ichimoku Cloud: (tenkan_sen, kijun_sen, senkou_span_a, senkou_span_b, chikou_span).
///
/// tenkan = (highest_high + lowest_low) / 2 over tenkan_period
/// kijun  = (highest_high + lowest_low) / 2 over kijun_period
/// senkou_a = (tenkan + kijun) / 2
/// senkou_b = (highest_high + lowest_low) / 2 over senkou_b_period
/// chikou  = close shifted back kijun_period
///
/// Standard params: tenkan=9, kijun=26, senkou_b=52.
pub fn ichimoku(
    highs: &[f64],
    lows: &[f64],
    closes: &[f64],
    tenkan_period: usize,
    kijun_period: usize,
    senkou_b_period: usize,
) -> (Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>) {
    let n = closes.len();
    let nan_vec = || vec![f64::NAN; n];
    if n == 0 || tenkan_period == 0 || kijun_period == 0 || senkou_b_period == 0 {
        return (nan_vec(), nan_vec(), nan_vec(), nan_vec(), nan_vec());
    }

    let mut tenkan_sen = vec![f64::NAN; n];
    let mut kijun_sen = vec![f64::NAN; n];
    let mut senkou_span_a = vec![f64::NAN; n];
    let mut senkou_span_b = vec![f64::NAN; n];
    let mut chikou_span = vec![f64::NAN; n];

    // Helper: (highest_high + lowest_low) / 2 over a window ending at index i
    #[inline]
    fn midpoint(highs: &[f64], lows: &[f64], end: usize, period: usize) -> f64 {
        if end + 1 < period {
            return f64::NAN;
        }
        let start = end + 1 - period;
        let mut hh = f64::NEG_INFINITY;
        let mut ll = f64::INFINITY;
        for j in start..=end {
            if highs[j] > hh {
                hh = highs[j];
            }
            if lows[j] < ll {
                ll = lows[j];
            }
        }
        (hh + ll) / 2.0
    }

    for i in 0..n {
        // Tenkan-sen
        if i + 1 >= tenkan_period {
            tenkan_sen[i] = midpoint(highs, lows, i, tenkan_period);
        }

        // Kijun-sen
        if i + 1 >= kijun_period {
            kijun_sen[i] = midpoint(highs, lows, i, kijun_period);
        }

        // Senkou Span A = (tenkan + kijun) / 2
        if !tenkan_sen[i].is_nan() && !kijun_sen[i].is_nan() {
            senkou_span_a[i] = (tenkan_sen[i] + kijun_sen[i]) / 2.0;
        }

        // Senkou Span B
        if i + 1 >= senkou_b_period {
            senkou_span_b[i] = midpoint(highs, lows, i, senkou_b_period);
        }

        // Chikou Span = close shifted back kijun_period
        if i >= kijun_period {
            chikou_span[i] = closes[i - kijun_period];
        }
    }

    (tenkan_sen, kijun_sen, senkou_span_a, senkou_span_b, chikou_span)
}

// ─── Awesome Oscillator ───────────────────────────────────────────────────

/// Awesome Oscillator: SMA(midpoint, 5) - SMA(midpoint, 34).
///
/// midpoint = (high + low) / 2.  First valid at index 33.
pub fn awesome_oscillator(highs: &[f64], lows: &[f64]) -> Vec<f64> {
    let n = highs.len();
    if n == 0 {
        return vec![];
    }

    // Compute midpoints
    let mid: Vec<f64> = (0..n).map(|i| (highs[i] + lows[i]) / 2.0).collect();

    let fast = sma(&mid, 5);
    let slow = sma(&mid, 34);

    let mut out = vec![f64::NAN; n];
    for i in 0..n {
        if !fast[i].is_nan() && !slow[i].is_nan() {
            out[i] = fast[i] - slow[i];
        }
    }
    out
}

// ─── VWAP ─────────────────────────────────────────────────────────────────

/// Volume-Weighted Average Price (cumulative, no intraday reset).
///
/// VWAP = cumulative(typical_price * volume) / cumulative(volume)
/// typical_price = (H + L + C) / 3
pub fn vwap(highs: &[f64], lows: &[f64], closes: &[f64], volumes: &[f64]) -> Vec<f64> {
    let n = closes.len();
    if n == 0 {
        return vec![];
    }

    let mut out = vec![f64::NAN; n];
    let mut cum_tpv = 0.0_f64;
    let mut cum_vol = 0.0_f64;

    for i in 0..n {
        let tp = (highs[i] + lows[i] + closes[i]) / 3.0;
        cum_tpv += tp * volumes[i];
        cum_vol += volumes[i];
        if cum_vol > 0.0 {
            out[i] = cum_tpv / cum_vol;
        }
    }
    out
}

// ─── Force Index ──────────────────────────────────────────────────────────

/// Force Index: EMA-smoothed (close - prev_close) * volume.
///
/// Raw force = (close[i] - close[i-1]) * volume[i], then EMA over `period`.
/// First valid at index `period` (1 for raw + period - 1 for EMA seed).
pub fn force_index(closes: &[f64], volumes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if period == 0 || n == 0 {
        return vec![f64::NAN; n];
    }
    if n < 2 {
        return vec![f64::NAN; n];
    }

    // Compute raw force index (index 0 is NAN)
    let mut raw = vec![f64::NAN; n];
    for i in 1..n {
        raw[i] = (closes[i] - closes[i - 1]) * volumes[i];
    }

    // EMA of raw values starting from index 1
    // We need `period` valid raw values to seed: indices 1..=period
    let mut out = vec![f64::NAN; n];
    if n < period + 1 {
        return out;
    }

    // Seed EMA with SMA of raw[1..=period]
    let seed: f64 = raw[1..=period].iter().sum::<f64>() / period as f64;
    out[period] = seed;

    let k = 2.0 / (period as f64 + 1.0);
    let mut prev = seed;
    for i in (period + 1)..n {
        let val = raw[i] * k + prev * (1.0 - k);
        out[i] = val;
        prev = val;
    }
    out
}

// ─── Accumulation/Distribution Line ───────────────────────────────────────

/// Accumulation/Distribution Line.
///
/// CLV = ((close - low) - (high - close)) / (high - low), 0 if high == low.
/// MF = CLV * volume.  ADL is the cumulative sum of MF.
pub fn adl(highs: &[f64], lows: &[f64], closes: &[f64], volumes: &[f64]) -> Vec<f64> {
    let n = closes.len();
    if n == 0 {
        return vec![];
    }

    let mut out = vec![f64::NAN; n];
    let mut cum = 0.0_f64;

    for i in 0..n {
        let hl = highs[i] - lows[i];
        let clv = if hl > 0.0 {
            ((closes[i] - lows[i]) - (highs[i] - closes[i])) / hl
        } else {
            0.0
        };
        let mf = clv * volumes[i];
        cum += mf;
        out[i] = cum;
    }
    out
}

// ─── Keltner Channels ─────────────────────────────────────────────────────

/// Keltner Channels: (upper, middle, lower).
///
/// middle = EMA(closes, ema_period)
/// upper  = middle + multiplier * ATR(atr_period)
/// lower  = middle - multiplier * ATR(atr_period)
pub fn keltner_channels(
    highs: &[f64],
    lows: &[f64],
    closes: &[f64],
    ema_period: usize,
    atr_period: usize,
    multiplier: f64,
) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
    let n = closes.len();
    let nan_vec = || vec![f64::NAN; n];
    if n == 0 || ema_period == 0 || atr_period == 0 {
        return (nan_vec(), nan_vec(), nan_vec());
    }

    let mid = ema(closes, ema_period);
    let atr_vals = atr(highs, lows, closes, atr_period);

    let mut upper = vec![f64::NAN; n];
    let mut middle = vec![f64::NAN; n];
    let mut lower = vec![f64::NAN; n];

    for i in 0..n {
        if !mid[i].is_nan() && !atr_vals[i].is_nan() {
            middle[i] = mid[i];
            upper[i] = mid[i] + multiplier * atr_vals[i];
            lower[i] = mid[i] - multiplier * atr_vals[i];
        }
    }

    (upper, middle, lower)
}

// ─── Squeeze Detect ───────────────────────────────────────────────────────

/// Squeeze detection: Bollinger Bands inside Keltner Channels.
///
/// Returns `Vec<bool>` of the same length as input.
/// squeeze = true when BB_lower > KC_lower AND BB_upper < KC_upper.
pub fn squeeze_detect(
    highs: &[f64],
    lows: &[f64],
    closes: &[f64],
    bb_period: usize,
    bb_mult: f64,
    kc_ema_period: usize,
    kc_atr_period: usize,
    kc_mult: f64,
) -> Vec<bool> {
    let n = closes.len();
    if n == 0 {
        return vec![];
    }

    let (bb_upper, _bb_middle, bb_lower) = bollinger_bands(closes, bb_period, bb_mult);
    let (kc_upper, _kc_middle, kc_lower) =
        keltner_channels(highs, lows, closes, kc_ema_period, kc_atr_period, kc_mult);

    let mut out = vec![false; n];
    for i in 0..n {
        if !bb_upper[i].is_nan()
            && !bb_lower[i].is_nan()
            && !kc_upper[i].is_nan()
            && !kc_lower[i].is_nan()
        {
            out[i] = bb_lower[i] > kc_lower[i] && bb_upper[i] < kc_upper[i];
        }
    }
    out
}

// ─── TRIX ─────────────────────────────────────────────────────────────────

/// TRIX: triple-smoothed EMA rate of change (percentage).
///
/// ema1 = EMA(closes, period)
/// ema2 = EMA(ema1_valid, period)
/// ema3 = EMA(ema2_valid, period)
/// TRIX[i] = (ema3[i] - ema3[i-1]) / ema3[i-1] * 100
pub fn trix(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if period == 0 || n == 0 {
        return vec![f64::NAN; n];
    }

    let ema1 = ema(closes, period);

    // Extract valid values from ema1 for the second EMA pass,
    // keeping track of the original indices.
    let valid1: Vec<(usize, f64)> = ema1
        .iter()
        .enumerate()
        .filter(|(_, v)| !v.is_nan())
        .map(|(i, &v)| (i, v))
        .collect();

    if valid1.len() < period {
        return vec![f64::NAN; n];
    }

    // Compute ema2 on the extracted valid values
    let vals1: Vec<f64> = valid1.iter().map(|(_, v)| *v).collect();
    let ema2_raw = ema(&vals1, period);

    // Map ema2 back to original indices
    let mut ema2 = vec![f64::NAN; n];
    for (j, &(orig_idx, _)) in valid1.iter().enumerate() {
        if !ema2_raw[j].is_nan() {
            ema2[orig_idx] = ema2_raw[j];
        }
    }

    // Extract valid values from ema2 for the third EMA pass
    let valid2: Vec<(usize, f64)> = ema2
        .iter()
        .enumerate()
        .filter(|(_, v)| !v.is_nan())
        .map(|(i, &v)| (i, v))
        .collect();

    if valid2.len() < period {
        return vec![f64::NAN; n];
    }

    let vals2: Vec<f64> = valid2.iter().map(|(_, v)| *v).collect();
    let ema3_raw = ema(&vals2, period);

    // Map ema3 back to original indices
    let mut ema3 = vec![f64::NAN; n];
    for (j, &(orig_idx, _)) in valid2.iter().enumerate() {
        if !ema3_raw[j].is_nan() {
            ema3[orig_idx] = ema3_raw[j];
        }
    }

    // TRIX = rate of change of ema3
    let mut out = vec![f64::NAN; n];
    let mut prev_valid: Option<(usize, f64)> = None;
    for i in 0..n {
        if !ema3[i].is_nan() {
            if let Some((_prev_idx, prev_val)) = prev_valid {
                if prev_val != 0.0 {
                    out[i] = (ema3[i] - prev_val) / prev_val * 100.0;
                } else {
                    out[i] = 0.0;
                }
            }
            prev_valid = Some((i, ema3[i]));
        }
    }
    out
}

// ─── Chaikin Money Flow ───────────────────────────────────────────────────

/// Chaikin Money Flow over `period`.
///
/// CMF = sum(CLV * volume, period) / sum(volume, period)
/// CLV = ((close - low) - (high - close)) / (high - low)
/// Range: -1 to +1.  First valid at index period - 1.
pub fn chaikin_money_flow(
    highs: &[f64],
    lows: &[f64],
    closes: &[f64],
    volumes: &[f64],
    period: usize,
) -> Vec<f64> {
    let n = closes.len();
    if period == 0 || n == 0 {
        return vec![f64::NAN; n];
    }
    let mut out = vec![f64::NAN; n];
    if n < period {
        return out;
    }

    // Precompute CLV * volume and volume for the sliding window
    let mut mf_vol: Vec<f64> = Vec::with_capacity(n);
    for i in 0..n {
        let hl = highs[i] - lows[i];
        let clv = if hl > 0.0 {
            ((closes[i] - lows[i]) - (highs[i] - closes[i])) / hl
        } else {
            0.0
        };
        mf_vol.push(clv * volumes[i]);
    }

    // Initial window sum
    let mut sum_mf: f64 = mf_vol[..period].iter().sum();
    let mut sum_vol: f64 = volumes[..period].iter().sum();

    out[period - 1] = if sum_vol > 0.0 {
        sum_mf / sum_vol
    } else {
        0.0
    };

    for i in period..n {
        sum_mf += mf_vol[i] - mf_vol[i - period];
        sum_vol += volumes[i] - volumes[i - period];
        out[i] = if sum_vol > 0.0 {
            sum_mf / sum_vol
        } else {
            0.0
        };
    }
    out
}

// ─── Elder Ray ────────────────────────────────────────────────────────────

/// Elder Ray: (bull_power, bear_power).
///
/// bull_power = high - EMA(close, period)
/// bear_power = low - EMA(close, period)
pub fn elder_ray(
    highs: &[f64],
    lows: &[f64],
    closes: &[f64],
    period: usize,
) -> (Vec<f64>, Vec<f64>) {
    let n = closes.len();
    let nan_vec = || vec![f64::NAN; n];
    if period == 0 || n == 0 {
        return (nan_vec(), nan_vec());
    }

    let ema_vals = ema(closes, period);
    let mut bull = vec![f64::NAN; n];
    let mut bear = vec![f64::NAN; n];

    for i in 0..n {
        if !ema_vals[i].is_nan() {
            bull[i] = highs[i] - ema_vals[i];
            bear[i] = lows[i] - ema_vals[i];
        }
    }
    (bull, bear)
}

// ─── Supertrend ───────────────────────────────────────────────────────────

/// Supertrend: (supertrend_line, direction).
///
/// direction = 1.0 (uptrend) or -1.0 (downtrend).
/// Uses ATR-based bands with clamping logic for trend persistence.
/// Standard params: period=10, multiplier=3.0.
pub fn supertrend(
    highs: &[f64],
    lows: &[f64],
    closes: &[f64],
    period: usize,
    multiplier: f64,
) -> (Vec<f64>, Vec<f64>) {
    let n = closes.len();
    let nan_vec = || vec![f64::NAN; n];
    if period == 0 || n == 0 {
        return (nan_vec(), nan_vec());
    }

    let atr_vals = atr(highs, lows, closes, period);

    let mut st_line = vec![f64::NAN; n];
    let mut direction = vec![f64::NAN; n];

    // Find the first index where ATR is valid
    let first_valid = match atr_vals.iter().position(|v| !v.is_nan()) {
        Some(idx) => idx,
        None => return (st_line, direction),
    };

    // Initialize at first valid index
    let hl2 = (highs[first_valid] + lows[first_valid]) / 2.0;
    let mut final_upper = hl2 + multiplier * atr_vals[first_valid];
    let mut final_lower = hl2 - multiplier * atr_vals[first_valid];

    // Start in uptrend if close is above midpoint of bands
    let mut dir = 1.0_f64;
    st_line[first_valid] = final_lower;
    direction[first_valid] = dir;

    for i in (first_valid + 1)..n {
        if atr_vals[i].is_nan() {
            continue;
        }

        let hl2 = (highs[i] + lows[i]) / 2.0;
        let basic_upper = hl2 + multiplier * atr_vals[i];
        let basic_lower = hl2 - multiplier * atr_vals[i];

        // Clamping logic for final bands
        let prev_close = closes[i - 1];
        final_upper = if basic_upper < final_upper || prev_close > final_upper {
            basic_upper
        } else {
            final_upper
        };
        final_lower = if basic_lower > final_lower || prev_close < final_lower {
            basic_lower
        } else {
            final_lower
        };

        // Determine direction
        if dir == 1.0 {
            // Currently in uptrend
            if closes[i] < final_lower {
                dir = -1.0; // flip to downtrend
            }
        } else {
            // Currently in downtrend
            if closes[i] > final_upper {
                dir = 1.0; // flip to uptrend
            }
        }

        st_line[i] = if dir == 1.0 {
            final_lower
        } else {
            final_upper
        };
        direction[i] = dir;
    }

    (st_line, direction)
}

// ─── Support & Resistance ─────────────────────────────────────────────────

/// Support & Resistance (Donchian Channel): (support, resistance).
///
/// resistance = max of highs over [i-lookback+1..=i]
/// support    = min of lows  over [i-lookback+1..=i]
/// First valid at index lookback - 1.
pub fn support_resistance(
    highs: &[f64],
    lows: &[f64],
    lookback: usize,
) -> (Vec<f64>, Vec<f64>) {
    let n = highs.len();
    let nan_vec = || vec![f64::NAN; n];
    if lookback == 0 || n == 0 {
        return (nan_vec(), nan_vec());
    }

    let mut support = vec![f64::NAN; n];
    let mut resistance = vec![f64::NAN; n];

    if n < lookback {
        return (support, resistance);
    }

    for i in (lookback - 1)..n {
        let start = i + 1 - lookback;
        let mut hh = f64::NEG_INFINITY;
        let mut ll = f64::INFINITY;
        for j in start..=i {
            if highs[j] > hh {
                hh = highs[j];
            }
            if lows[j] < ll {
                ll = lows[j];
            }
        }
        resistance[i] = hh;
        support[i] = ll;
    }

    (support, resistance)
}

// ─── Market Structure ─────────────────────────────────────────────────────

/// Market Structure score: -1.0 (bearish) to 1.0 (bullish).
///
/// Splits a lookback window into 4 equal quarters and compares:
///   Q4_high vs Q2_high, Q4_low vs Q2_low (recent vs mid-past)
///   Q3_high vs Q1_high, Q3_low vs Q1_low (mid-recent vs earliest)
/// Each comparison yields +1 (higher) or -1 (lower).
/// Score = (bullish - bearish) / 4.0.
/// First valid at index lookback * 4 - 1.
pub fn market_structure(highs: &[f64], lows: &[f64], lookback: usize) -> Vec<f64> {
    let n = highs.len();
    if lookback == 0 || n == 0 {
        return vec![f64::NAN; n];
    }

    let total_window = lookback * 4;
    let mut out = vec![f64::NAN; n];

    if n < total_window {
        return out;
    }

    for i in (total_window - 1)..n {
        let base = i + 1 - total_window;

        // Quarter boundaries
        let q1_start = base;
        let q1_end = base + lookback;
        let q2_start = q1_end;
        let q2_end = q2_start + lookback;
        let q3_start = q2_end;
        let q3_end = q3_start + lookback;
        let q4_start = q3_end;
        let q4_end = q4_start + lookback; // == i + 1

        // Helper to get max high and min low for a range
        #[inline]
        fn quarter_stats(highs: &[f64], lows: &[f64], start: usize, end: usize) -> (f64, f64) {
            let mut hh = f64::NEG_INFINITY;
            let mut ll = f64::INFINITY;
            for j in start..end {
                if highs[j] > hh {
                    hh = highs[j];
                }
                if lows[j] < ll {
                    ll = lows[j];
                }
            }
            (hh, ll)
        }

        let (q1_high, q1_low) = quarter_stats(highs, lows, q1_start, q1_end);
        let (q2_high, q2_low) = quarter_stats(highs, lows, q2_start, q2_end);
        let (q3_high, q3_low) = quarter_stats(highs, lows, q3_start, q3_end);
        let (q4_high, q4_low) = quarter_stats(highs, lows, q4_start, q4_end);

        let mut bullish = 0_i32;
        let mut bearish = 0_i32;

        // Q4 vs Q2 comparisons
        if q4_high > q2_high {
            bullish += 1;
        } else {
            bearish += 1;
        }
        if q4_low > q2_low {
            bullish += 1;
        } else {
            bearish += 1;
        }

        // Q3 vs Q1 comparisons
        if q3_high > q1_high {
            bullish += 1;
        } else {
            bearish += 1;
        }
        if q3_low > q1_low {
            bullish += 1;
        } else {
            bearish += 1;
        }

        out[i] = (bullish - bearish) as f64 / 4.0;
    }
    out
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: f64, b: f64, eps: f64) -> bool {
        if a.is_nan() && b.is_nan() {
            return true;
        }
        (a - b).abs() < eps
    }

    #[test]
    fn test_sma_basic() {
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = sma(&data, 3);
        assert_eq!(result.len(), 5);
        assert!(result[0].is_nan());
        assert!(result[1].is_nan());
        assert!(approx_eq(result[2], 2.0, 1e-10));
        assert!(approx_eq(result[3], 3.0, 1e-10));
        assert!(approx_eq(result[4], 4.0, 1e-10));
    }

    #[test]
    fn test_sma_period_equals_length() {
        let data = vec![2.0, 4.0, 6.0];
        let result = sma(&data, 3);
        assert!(result[0].is_nan());
        assert!(result[1].is_nan());
        assert!(approx_eq(result[2], 4.0, 1e-10));
    }

    #[test]
    fn test_sma_insufficient_data() {
        let data = vec![1.0, 2.0];
        let result = sma(&data, 5);
        assert!(result.iter().all(|v| v.is_nan()));
    }

    #[test]
    fn test_ema_basic() {
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        let result = ema(&data, 3);
        assert_eq!(result.len(), 6);
        assert!(result[0].is_nan());
        assert!(result[1].is_nan());
        // Seed = (1+2+3)/3 = 2.0
        assert!(approx_eq(result[2], 2.0, 1e-10));
        // k = 2/(3+1) = 0.5
        // EMA[3] = 4*0.5 + 2.0*0.5 = 3.0
        assert!(approx_eq(result[3], 3.0, 1e-10));
        // EMA[4] = 5*0.5 + 3.0*0.5 = 4.0
        assert!(approx_eq(result[4], 4.0, 1e-10));
    }

    #[test]
    fn test_rsi_all_gains() {
        // All prices going up — RSI should be 100
        let closes = vec![10.0, 11.0, 12.0, 13.0, 14.0, 15.0];
        let result = rsi(&closes, 5);
        // First valid at index 5
        assert!(approx_eq(result[5], 100.0, 1e-10));
    }

    #[test]
    fn test_rsi_all_losses() {
        // All prices going down — RSI should be 0
        let closes = vec![15.0, 14.0, 13.0, 12.0, 11.0, 10.0];
        let result = rsi(&closes, 5);
        assert!(approx_eq(result[5], 0.0, 1e-10));
    }

    #[test]
    fn test_rsi_length_matches_input() {
        let closes = vec![10.0, 11.0, 10.5, 11.5, 10.8, 11.2, 10.3, 11.8];
        let result = rsi(&closes, 5);
        assert_eq!(result.len(), closes.len());
        // First 5 should be NAN (need period + 1 = 6 points, so index 5 is first)
        for i in 0..5 {
            assert!(result[i].is_nan(), "index {i} should be NAN");
        }
        for i in 5..closes.len() {
            assert!(!result[i].is_nan(), "index {i} should not be NAN");
            assert!(result[i] >= 0.0 && result[i] <= 100.0);
        }
    }

    #[test]
    fn test_roc_basic() {
        let data = vec![100.0, 110.0, 105.0, 120.0];
        let result = roc(&data, 2);
        assert!(result[0].is_nan());
        assert!(result[1].is_nan());
        // roc[2] = (105 - 100) / 100 * 100 = 5.0
        assert!(approx_eq(result[2], 5.0, 1e-10));
        // roc[3] = (120 - 110) / 110 * 100 ≈ 9.0909
        assert!(approx_eq(result[3], 9.090909, 1e-4));
    }

    #[test]
    fn test_atr_basic() {
        // Simple case: constant bars
        let highs = vec![12.0, 12.0, 12.0, 12.0];
        let lows = vec![10.0, 10.0, 10.0, 10.0];
        let closes = vec![11.0, 11.0, 11.0, 11.0];
        let result = atr(&highs, &lows, &closes, 2);
        // TR for constant bars = high - low = 2.0
        // ATR at index 2 = mean(TR[1], TR[2]) = 2.0
        assert!(approx_eq(result[2], 2.0, 1e-10));
    }

    #[test]
    fn test_bollinger_bands_basic() {
        let closes = vec![20.0, 21.0, 22.0, 21.0, 20.0];
        let (upper, middle, lower) = bollinger_bands(&closes, 5, 2.0);
        assert_eq!(upper.len(), 5);
        assert_eq!(middle.len(), 5);
        assert_eq!(lower.len(), 5);
        // First 4 should be NAN
        for i in 0..4 {
            assert!(upper[i].is_nan());
            assert!(middle[i].is_nan());
            assert!(lower[i].is_nan());
        }
        let mean = (20.0 + 21.0 + 22.0 + 21.0 + 20.0) / 5.0;
        assert!(approx_eq(middle[4], mean, 1e-10));
        assert!(upper[4] > middle[4]);
        assert!(lower[4] < middle[4]);
        assert!(approx_eq(upper[4] - middle[4], middle[4] - lower[4], 1e-10));
    }

    #[test]
    fn test_stochastic_basic() {
        let highs = vec![5.0, 6.0, 7.0, 6.0, 5.0];
        let lows = vec![3.0, 4.0, 5.0, 4.0, 3.0];
        let closes = vec![4.0, 5.0, 6.0, 5.0, 4.0];
        let (k, d) = stochastic(&highs, &lows, &closes, 3, 2);
        assert_eq!(k.len(), 5);
        assert_eq!(d.len(), 5);
        // First valid %K at index 2
        // Window [0..2]: highest high = 7, lowest low = 3, close = 6
        // %K = (6 - 3) / (7 - 3) * 100 = 75
        assert!(approx_eq(k[2], 75.0, 1e-10));
    }

    #[test]
    fn test_macd_output_length() {
        let closes: Vec<f64> = (0..50).map(|i| 100.0 + (i as f64).sin() * 5.0).collect();
        let (macd_line, signal, hist) = macd(&closes, 12, 26, 9);
        assert_eq!(macd_line.len(), 50);
        assert_eq!(signal.len(), 50);
        assert_eq!(hist.len(), 50);
        // First valid MACD at index 25, first valid signal at 25 + 8 = 33
        assert!(macd_line[24].is_nan());
        assert!(!macd_line[25].is_nan());
        assert!(signal[32].is_nan());
        assert!(!signal[33].is_nan());
    }

    #[test]
    fn test_williams_r_range() {
        let n = 30;
        let highs: Vec<f64> = (0..n).map(|i| 100.0 + (i as f64) * 0.5).collect();
        let lows: Vec<f64> = (0..n).map(|i| 95.0 + (i as f64) * 0.3).collect();
        let closes: Vec<f64> = (0..n).map(|i| 97.0 + (i as f64) * 0.4).collect();
        let result = williams_r(&highs, &lows, &closes, 14);
        for i in 13..n {
            assert!(!result[i].is_nan());
            assert!(result[i] >= -100.0 && result[i] <= 0.0);
        }
    }

    #[test]
    fn test_mfi_range() {
        let n = 30;
        let highs: Vec<f64> = (0..n).map(|i| 100.0 + (i as f64) * 0.5).collect();
        let lows: Vec<f64> = (0..n).map(|i| 95.0 + (i as f64) * 0.3).collect();
        let closes: Vec<f64> = (0..n).map(|i| 97.0 + (i as f64) * 0.4).collect();
        let volumes: Vec<f64> = (0..n).map(|i| 1000.0 + (i as f64) * 10.0).collect();
        let result = mfi(&highs, &lows, &closes, &volumes, 14);
        for i in 14..n {
            assert!(!result[i].is_nan());
            assert!(result[i] >= 0.0 && result[i] <= 100.0);
        }
    }

    #[test]
    fn test_cci_output() {
        let n = 25;
        let highs: Vec<f64> = (0..n).map(|i| 102.0 + (i as f64).sin()).collect();
        let lows: Vec<f64> = (0..n).map(|i| 98.0 + (i as f64).sin()).collect();
        let closes: Vec<f64> = (0..n).map(|i| 100.0 + (i as f64).sin()).collect();
        let result = cci(&highs, &lows, &closes, 20);
        for i in 0..19 {
            assert!(result[i].is_nan());
        }
        for i in 19..n {
            assert!(!result[i].is_nan());
        }
    }

    #[test]
    fn test_obv_trend_uptrend() {
        let mut closes = Vec::new();
        let mut volumes = Vec::new();
        for i in 0..30 {
            closes.push(100.0 + i as f64);
            volumes.push(1000.0);
        }
        let trend = obv_trend(&closes, &volumes, 20);
        // All closes increasing -> OBV monotonically increasing -> positive slope
        assert!(trend > 0.0, "expected positive OBV trend, got {trend}");
    }

    #[test]
    fn test_obv_trend_downtrend() {
        let mut closes = Vec::new();
        let mut volumes = Vec::new();
        for i in 0..30 {
            closes.push(130.0 - i as f64);
            volumes.push(1000.0);
        }
        let trend = obv_trend(&closes, &volumes, 20);
        assert!(trend < 0.0, "expected negative OBV trend, got {trend}");
    }

    #[test]
    fn test_obv_trend_insufficient_data() {
        let closes = vec![1.0, 2.0, 3.0];
        let volumes = vec![100.0, 100.0, 100.0];
        let trend = obv_trend(&closes, &volumes, 20);
        assert_eq!(trend, 0.0);
    }

    #[test]
    fn test_volume_ratio_basic() {
        let mut volumes = vec![100.0; 21];
        volumes[20] = 200.0; // Double the average
        let result = volume_ratio(&volumes, 20);
        // At index 20: avg of volumes[1..=20], which includes the 200.
        // avg = (19 * 100 + 200) / 20 = 2100/20 = 105
        // ratio = 200 / 105 ≈ 1.905
        assert!(!result[20].is_nan());
        assert!(result[20] > 1.0);
    }

    #[test]
    fn test_parabolic_sar_length() {
        let highs = vec![10.0, 11.0, 12.0, 11.0, 10.0];
        let lows = vec![8.0, 9.0, 10.0, 9.0, 8.0];
        let result = parabolic_sar(&highs, &lows, 0.02, 0.02, 0.2);
        assert_eq!(result.len(), 5);
        // All values should be non-NAN
        for v in &result {
            assert!(!v.is_nan());
        }
    }

    #[test]
    fn test_adx_needs_double_period() {
        let n = 27; // less than 14*2 = 28
        let highs: Vec<f64> = (0..n).map(|i| 102.0 + (i as f64) * 0.1).collect();
        let lows: Vec<f64> = (0..n).map(|i| 98.0 + (i as f64) * 0.1).collect();
        let closes: Vec<f64> = (0..n).map(|i| 100.0 + (i as f64) * 0.1).collect();
        let result = adx(&highs, &lows, &closes, 14);
        // With n < period*2, all should be NAN
        assert!(result.iter().all(|v| v.is_nan()));
    }

    #[test]
    fn test_adx_range() {
        let n = 60;
        let highs: Vec<f64> = (0..n).map(|i| 102.0 + (i as f64 * 0.3).sin() * 5.0).collect();
        let lows: Vec<f64> = (0..n).map(|i| 98.0 + (i as f64 * 0.3).sin() * 5.0).collect();
        let closes: Vec<f64> = (0..n).map(|i| 100.0 + (i as f64 * 0.3).sin() * 5.0).collect();
        let result = adx(&highs, &lows, &closes, 14);
        // Should have some non-NAN values in the latter half
        let valid_count = result.iter().filter(|v| !v.is_nan()).count();
        assert!(valid_count > 0);
        for &v in &result {
            if !v.is_nan() {
                assert!(v >= 0.0 && v <= 100.0, "ADX should be 0-100, got {v}");
            }
        }
    }

    #[test]
    fn test_all_output_lengths_match_input() {
        let n = 50;
        let data: Vec<f64> = (0..n).map(|i| 100.0 + (i as f64) * 0.5).collect();
        let highs: Vec<f64> = (0..n).map(|i| 102.0 + (i as f64) * 0.5).collect();
        let lows: Vec<f64> = (0..n).map(|i| 98.0 + (i as f64) * 0.5).collect();
        let volumes: Vec<f64> = (0..n).map(|_| 1000.0).collect();

        assert_eq!(sma(&data, 14).len(), n);
        assert_eq!(ema(&data, 14).len(), n);
        assert_eq!(rsi(&data, 14).len(), n);
        assert_eq!(roc(&data, 12).len(), n);
        assert_eq!(atr(&highs, &lows, &data, 14).len(), n);
        assert_eq!(adx(&highs, &lows, &data, 14).len(), n);
        assert_eq!(mfi(&highs, &lows, &data, &volumes, 14).len(), n);
        assert_eq!(williams_r(&highs, &lows, &data, 14).len(), n);
        assert_eq!(cci(&highs, &lows, &data, 20).len(), n);
        assert_eq!(volume_ratio(&volumes, 20).len(), n);
        assert_eq!(parabolic_sar(&highs, &lows, 0.02, 0.02, 0.2).len(), n);

        let (u, m, l) = bollinger_bands(&data, 20, 2.0);
        assert_eq!(u.len(), n);
        assert_eq!(m.len(), n);
        assert_eq!(l.len(), n);

        let (k, d) = stochastic(&highs, &lows, &data, 14, 3);
        assert_eq!(k.len(), n);
        assert_eq!(d.len(), n);

        let (ml, sl, h) = macd(&data, 12, 26, 9);
        assert_eq!(ml.len(), n);
        assert_eq!(sl.len(), n);
        assert_eq!(h.len(), n);
    }

    #[test]
    fn test_empty_input() {
        let empty: Vec<f64> = vec![];
        assert_eq!(sma(&empty, 14).len(), 0);
        assert_eq!(ema(&empty, 14).len(), 0);
        assert_eq!(rsi(&empty, 14).len(), 0);
        assert_eq!(roc(&empty, 12).len(), 0);
        assert_eq!(atr(&empty, &empty, &empty, 14).len(), 0);
        assert_eq!(adx(&empty, &empty, &empty, 14).len(), 0);
        assert_eq!(mfi(&empty, &empty, &empty, &empty, 14).len(), 0);
        assert_eq!(williams_r(&empty, &empty, &empty, 14).len(), 0);
        assert_eq!(cci(&empty, &empty, &empty, 20).len(), 0);
        assert_eq!(volume_ratio(&empty, 20).len(), 0);
        assert_eq!(parabolic_sar(&empty, &empty, 0.02, 0.02, 0.2).len(), 0);
        assert_eq!(obv_trend(&empty, &empty, 20), 0.0);
    }

    // ─── Ichimoku Tests ───────────────────────────────────────────────────

    #[test]
    fn test_ichimoku_basic() {
        // Build a simple uptrend of 60 bars
        let n = 60;
        let highs: Vec<f64> = (0..n).map(|i| 102.0 + i as f64).collect();
        let lows: Vec<f64> = (0..n).map(|i| 98.0 + i as f64).collect();
        let closes: Vec<f64> = (0..n).map(|i| 100.0 + i as f64).collect();

        let (tenkan, kijun, senkou_a, senkou_b, chikou) =
            ichimoku(&highs, &lows, &closes, 9, 26, 52);

        assert_eq!(tenkan.len(), n);
        assert_eq!(kijun.len(), n);
        assert_eq!(senkou_a.len(), n);
        assert_eq!(senkou_b.len(), n);
        assert_eq!(chikou.len(), n);

        // Tenkan first valid at index 8 (period 9 - 1)
        assert!(tenkan[7].is_nan());
        assert!(!tenkan[8].is_nan());

        // Kijun first valid at index 25 (period 26 - 1)
        assert!(kijun[24].is_nan());
        assert!(!kijun[25].is_nan());

        // Verify tenkan at index 8: (max of highs[0..=8] + min of lows[0..=8]) / 2
        // highs[0..=8] max = 110, lows[0..=8] min = 98
        // tenkan = (110 + 98) / 2 = 104
        assert!(approx_eq(tenkan[8], 104.0, 1e-10));

        // Verify kijun at index 25: (max highs[0..=25] + min lows[0..=25]) / 2
        // highs[25] = 127, lows[0] = 98
        // kijun = (127 + 98) / 2 = 112.5
        assert!(approx_eq(kijun[25], 112.5, 1e-10));

        // Chikou at index 26 = closes[0] = 100
        assert!(chikou[25].is_nan());
        assert!(approx_eq(chikou[26], 100.0, 1e-10));

        // Senkou span B first valid at index 51
        assert!(senkou_b[50].is_nan());
        assert!(!senkou_b[51].is_nan());
    }

    #[test]
    fn test_ichimoku_empty() {
        let empty: Vec<f64> = vec![];
        let (t, k, sa, sb, c) = ichimoku(&empty, &empty, &empty, 9, 26, 52);
        assert_eq!(t.len(), 0);
        assert_eq!(k.len(), 0);
        assert_eq!(sa.len(), 0);
        assert_eq!(sb.len(), 0);
        assert_eq!(c.len(), 0);
    }

    // ─── Awesome Oscillator Tests ─────────────────────────────────────────

    #[test]
    fn test_awesome_oscillator_length() {
        let n = 50;
        let highs: Vec<f64> = (0..n).map(|i| 102.0 + (i as f64 * 0.2).sin() * 3.0).collect();
        let lows: Vec<f64> = (0..n).map(|i| 98.0 + (i as f64 * 0.2).sin() * 3.0).collect();
        let result = awesome_oscillator(&highs, &lows);
        assert_eq!(result.len(), n);

        // First valid at index 33 (needs SMA(34))
        for i in 0..33 {
            assert!(result[i].is_nan(), "index {i} should be NAN");
        }
        assert!(!result[33].is_nan(), "index 33 should be valid");
    }

    #[test]
    fn test_awesome_oscillator_empty() {
        let result = awesome_oscillator(&[], &[]);
        assert_eq!(result.len(), 0);
    }

    // ─── VWAP Tests ───────────────────────────────────────────────────────

    #[test]
    fn test_vwap_basic() {
        let highs = vec![12.0, 13.0, 14.0];
        let lows = vec![10.0, 11.0, 12.0];
        let closes = vec![11.0, 12.0, 13.0];
        let volumes = vec![100.0, 200.0, 300.0];
        let result = vwap(&highs, &lows, &closes, &volumes);
        assert_eq!(result.len(), 3);

        // Index 0: tp = (12+10+11)/3 = 11.0; vwap = 11*100/100 = 11.0
        assert!(approx_eq(result[0], 11.0, 1e-10));

        // Index 1: tp = (13+11+12)/3 = 12.0; cum_tpv = 11*100 + 12*200 = 3500; cum_vol = 300
        // vwap = 3500/300 ≈ 11.6667
        assert!(approx_eq(result[1], 3500.0 / 300.0, 1e-4));

        // All values should be non-NAN
        for v in &result {
            assert!(!v.is_nan());
        }
    }

    #[test]
    fn test_vwap_empty() {
        let result = vwap(&[], &[], &[], &[]);
        assert_eq!(result.len(), 0);
    }

    // ─── Force Index Tests ────────────────────────────────────────────────

    #[test]
    fn test_force_index_length() {
        let n = 30;
        let closes: Vec<f64> = (0..n).map(|i| 100.0 + i as f64).collect();
        let volumes: Vec<f64> = vec![1000.0; n];
        let result = force_index(&closes, &volumes, 13);
        assert_eq!(result.len(), n);

        // First valid at index 13
        for i in 0..13 {
            assert!(result[i].is_nan(), "index {i} should be NAN");
        }
        assert!(!result[13].is_nan(), "index 13 should be valid");
    }

    #[test]
    fn test_force_index_empty() {
        let result = force_index(&[], &[], 13);
        assert_eq!(result.len(), 0);
    }

    // ─── ADL Tests ────────────────────────────────────────────────────────

    #[test]
    fn test_adl_basic() {
        // When close == high, CLV = 1.0; when close == low, CLV = -1.0
        let highs = vec![12.0, 13.0, 14.0];
        let lows = vec![10.0, 11.0, 12.0];
        let closes = vec![12.0, 11.0, 14.0]; // high, low, high
        let volumes = vec![100.0, 200.0, 300.0];
        let result = adl(&highs, &lows, &closes, &volumes);
        assert_eq!(result.len(), 3);

        // Index 0: CLV = ((12-10)-(12-12))/(12-10) = 2/2 = 1.0; MF = 100; ADL = 100
        assert!(approx_eq(result[0], 100.0, 1e-10));

        // Index 1: CLV = ((11-11)-(13-11))/(13-11) = -2/2 = -1.0; MF = -200; ADL = 100-200 = -100
        assert!(approx_eq(result[1], -100.0, 1e-10));

        // Index 2: CLV = ((14-12)-(14-14))/(14-12) = 2/2 = 1.0; MF = 300; ADL = -100+300 = 200
        assert!(approx_eq(result[2], 200.0, 1e-10));
    }

    #[test]
    fn test_adl_empty() {
        let result = adl(&[], &[], &[], &[]);
        assert_eq!(result.len(), 0);
    }

    // ─── Keltner Channels Tests ───────────────────────────────────────────

    #[test]
    fn test_keltner_channels_basic() {
        let n = 30;
        let highs: Vec<f64> = (0..n).map(|i| 102.0 + (i as f64 * 0.3).sin() * 2.0).collect();
        let lows: Vec<f64> = (0..n).map(|i| 98.0 + (i as f64 * 0.3).sin() * 2.0).collect();
        let closes: Vec<f64> = (0..n).map(|i| 100.0 + (i as f64 * 0.3).sin() * 2.0).collect();

        let (upper, middle, lower) = keltner_channels(&highs, &lows, &closes, 20, 10, 1.5);
        assert_eq!(upper.len(), n);
        assert_eq!(middle.len(), n);
        assert_eq!(lower.len(), n);

        // Both EMA(20) and ATR(10) need to be valid for the channel to appear
        // EMA(20) first valid at index 19, ATR(10) first valid at index 10
        // So channels first valid at index 19
        for i in 0..19 {
            assert!(upper[i].is_nan(), "upper[{i}] should be NAN");
        }
        // Once valid, upper > middle > lower
        for i in 19..n {
            if !upper[i].is_nan() && !middle[i].is_nan() && !lower[i].is_nan() {
                assert!(
                    upper[i] > middle[i],
                    "upper should be > middle at index {i}"
                );
                assert!(
                    middle[i] > lower[i],
                    "middle should be > lower at index {i}"
                );
            }
        }
    }

    #[test]
    fn test_keltner_channels_empty() {
        let empty: Vec<f64> = vec![];
        let (u, m, l) = keltner_channels(&empty, &empty, &empty, 20, 10, 1.5);
        assert_eq!(u.len(), 0);
        assert_eq!(m.len(), 0);
        assert_eq!(l.len(), 0);
    }

    // ─── Squeeze Detect Tests ─────────────────────────────────────────────

    #[test]
    fn test_squeeze_detect_basic() {
        // With very low volatility (constant prices), BB will be very tight
        // and KC will be wider, so squeeze should be true
        let n = 30;
        let closes: Vec<f64> = vec![100.0; n];
        let highs: Vec<f64> = vec![100.5; n];
        let lows: Vec<f64> = vec![99.5; n];

        let result = squeeze_detect(&highs, &lows, &closes, 20, 2.0, 20, 10, 1.5);
        assert_eq!(result.len(), n);

        // With constant closes, BB stddev = 0, so BB upper = BB lower = middle
        // KC will have some width from ATR. BB is inside KC -> squeeze = true
        // But BB upper == BB lower == middle, so BB_upper < KC_upper and BB_lower > KC_lower
        // depends on ATR being > 0. With constant H-L = 1.0, ATR = 1.0.
        // The first index where both BB and KC are valid will show squeeze.
        let valid_count = result.iter().filter(|&&v| v).count();
        // At least some squeeze detections after warmup
        assert!(valid_count > 0, "should detect squeezes with constant prices");
    }

    #[test]
    fn test_squeeze_detect_empty() {
        let result = squeeze_detect(&[], &[], &[], 20, 2.0, 20, 10, 1.5);
        assert_eq!(result.len(), 0);
    }

    // ─── TRIX Tests ───────────────────────────────────────────────────────

    #[test]
    fn test_trix_length() {
        let n = 60;
        let closes: Vec<f64> = (0..n).map(|i| 100.0 + (i as f64 * 0.3).sin() * 5.0).collect();
        let result = trix(&closes, 10);
        assert_eq!(result.len(), n);

        // Many early values should be NAN (triple EMA needs 3*period warmup roughly)
        let nan_count = result.iter().filter(|v| v.is_nan()).count();
        let valid_count = n - nan_count;
        assert!(valid_count > 0, "should have some valid TRIX values");

        // TRIX is a rate of change, should be small numbers
        for &v in &result {
            if !v.is_nan() {
                assert!(v.abs() < 50.0, "TRIX should be small percentage, got {v}");
            }
        }
    }

    #[test]
    fn test_trix_empty() {
        let result = trix(&[], 10);
        assert_eq!(result.len(), 0);
    }

    // ─── Chaikin Money Flow Tests ─────────────────────────────────────────

    #[test]
    fn test_chaikin_money_flow_range() {
        let n = 30;
        let highs: Vec<f64> = (0..n).map(|i| 102.0 + (i as f64 * 0.5).sin() * 3.0).collect();
        let lows: Vec<f64> = (0..n).map(|i| 98.0 + (i as f64 * 0.5).sin() * 3.0).collect();
        let closes: Vec<f64> = (0..n).map(|i| 100.0 + (i as f64 * 0.5).sin() * 3.0).collect();
        let volumes: Vec<f64> = vec![1000.0; n];

        let result = chaikin_money_flow(&highs, &lows, &closes, &volumes, 20);
        assert_eq!(result.len(), n);

        // First valid at index 19
        for i in 0..19 {
            assert!(result[i].is_nan(), "index {i} should be NAN");
        }

        // CMF should be between -1 and 1
        for i in 19..n {
            assert!(!result[i].is_nan(), "index {i} should not be NAN");
            assert!(
                result[i] >= -1.0 - 1e-10 && result[i] <= 1.0 + 1e-10,
                "CMF should be in [-1, 1], got {} at index {}",
                result[i],
                i
            );
        }
    }

    #[test]
    fn test_chaikin_money_flow_empty() {
        let result = chaikin_money_flow(&[], &[], &[], &[], 20);
        assert_eq!(result.len(), 0);
    }

    // ─── Elder Ray Tests ──────────────────────────────────────────────────

    #[test]
    fn test_elder_ray_basic() {
        let n = 20;
        let highs: Vec<f64> = (0..n).map(|i| 105.0 + i as f64).collect();
        let lows: Vec<f64> = (0..n).map(|i| 95.0 + i as f64).collect();
        let closes: Vec<f64> = (0..n).map(|i| 100.0 + i as f64).collect();

        let (bull, bear) = elder_ray(&highs, &lows, &closes, 13);
        assert_eq!(bull.len(), n);
        assert_eq!(bear.len(), n);

        // First valid at index 12 (EMA period 13)
        assert!(bull[11].is_nan());
        assert!(bear[11].is_nan());
        assert!(!bull[12].is_nan());
        assert!(!bear[12].is_nan());

        // Bull power = high - EMA should be positive (high > close > EMA in uptrend)
        for i in 12..n {
            assert!(bull[i] > 0.0, "bull power should be positive in uptrend at index {i}");
        }

        // Bull power > bear power always (since high > low)
        for i in 12..n {
            assert!(bull[i] > bear[i],
                "bull power should exceed bear power at index {i}");
        }
    }

    #[test]
    fn test_elder_ray_empty() {
        let empty: Vec<f64> = vec![];
        let (b, r) = elder_ray(&empty, &empty, &empty, 13);
        assert_eq!(b.len(), 0);
        assert_eq!(r.len(), 0);
    }

    // ─── Supertrend Tests ─────────────────────────────────────────────────

    #[test]
    fn test_supertrend_direction() {
        // Strong uptrend: direction should be 1.0 (uptrend)
        let n = 40;
        let highs: Vec<f64> = (0..n).map(|i| 102.0 + i as f64 * 2.0).collect();
        let lows: Vec<f64> = (0..n).map(|i| 98.0 + i as f64 * 2.0).collect();
        let closes: Vec<f64> = (0..n).map(|i| 100.0 + i as f64 * 2.0).collect();

        let (st_line, direction) = supertrend(&highs, &lows, &closes, 10, 3.0);
        assert_eq!(st_line.len(), n);
        assert_eq!(direction.len(), n);

        // After warmup, direction should be 1.0 in a strong uptrend
        let valid_dirs: Vec<f64> = direction.iter().filter(|v| !v.is_nan()).copied().collect();
        assert!(!valid_dirs.is_empty(), "should have valid direction values");

        // In a strong uptrend, most/all directions should be 1.0
        let uptrend_count = valid_dirs.iter().filter(|&&v| v == 1.0).count();
        assert!(
            uptrend_count as f64 / valid_dirs.len() as f64 > 0.5,
            "most direction values should be 1.0 in uptrend"
        );

        // Supertrend line should be below closes in uptrend
        for i in 0..n {
            if !st_line[i].is_nan() && direction[i] == 1.0 {
                assert!(
                    st_line[i] <= closes[i],
                    "supertrend should be below close in uptrend at index {i}: st={}, close={}",
                    st_line[i],
                    closes[i]
                );
            }
        }
    }

    #[test]
    fn test_supertrend_empty() {
        let empty: Vec<f64> = vec![];
        let (st, dir) = supertrend(&empty, &empty, &empty, 10, 3.0);
        assert_eq!(st.len(), 0);
        assert_eq!(dir.len(), 0);
    }

    // ─── Support & Resistance Tests ───────────────────────────────────────

    #[test]
    fn test_support_resistance_basic() {
        let highs = vec![10.0, 12.0, 11.0, 13.0, 12.0];
        let lows = vec![8.0, 9.0, 7.0, 10.0, 9.0];

        let (support, resistance) = support_resistance(&highs, &lows, 3);
        assert_eq!(support.len(), 5);
        assert_eq!(resistance.len(), 5);

        // First valid at index 2 (lookback 3 - 1)
        assert!(support[0].is_nan());
        assert!(support[1].is_nan());
        assert!(resistance[0].is_nan());
        assert!(resistance[1].is_nan());

        // Index 2: window [0,1,2]; resistance = max(10,12,11) = 12; support = min(8,9,7) = 7
        assert!(approx_eq(resistance[2], 12.0, 1e-10));
        assert!(approx_eq(support[2], 7.0, 1e-10));

        // Index 3: window [1,2,3]; resistance = max(12,11,13) = 13; support = min(9,7,10) = 7
        assert!(approx_eq(resistance[3], 13.0, 1e-10));
        assert!(approx_eq(support[3], 7.0, 1e-10));

        // Index 4: window [2,3,4]; resistance = max(11,13,12) = 13; support = min(7,10,9) = 7
        assert!(approx_eq(resistance[4], 13.0, 1e-10));
        assert!(approx_eq(support[4], 7.0, 1e-10));

        // Resistance >= support always
        for i in 2..5 {
            assert!(resistance[i] >= support[i]);
        }
    }

    #[test]
    fn test_support_resistance_empty() {
        let empty: Vec<f64> = vec![];
        let (s, r) = support_resistance(&empty, &empty, 10);
        assert_eq!(s.len(), 0);
        assert_eq!(r.len(), 0);
    }

    // ─── Market Structure Tests ───────────────────────────────────────────

    #[test]
    fn test_market_structure_basic() {
        // Strong uptrend: each quarter should show higher highs and higher lows
        let lookback = 5;
        let n = lookback * 4; // 20
        let highs: Vec<f64> = (0..n).map(|i| 100.0 + i as f64 * 2.0).collect();
        let lows: Vec<f64> = (0..n).map(|i| 95.0 + i as f64 * 2.0).collect();
        let result = market_structure(&highs, &lows, lookback);
        assert_eq!(result.len(), n);

        // First valid at index 19 (lookback * 4 - 1)
        for i in 0..(n - 1) {
            assert!(result[i].is_nan(), "index {i} should be NAN");
        }

        // At index 19, should detect bullish structure (all 4 comparisons bullish => 1.0)
        assert!(approx_eq(result[n - 1], 1.0, 1e-10),
            "expected 1.0 for strong uptrend, got {}", result[n - 1]);
    }

    #[test]
    fn test_market_structure_downtrend() {
        let lookback = 5;
        let n = lookback * 4;
        // Strong downtrend
        let highs: Vec<f64> = (0..n).map(|i| 200.0 - i as f64 * 2.0).collect();
        let lows: Vec<f64> = (0..n).map(|i| 195.0 - i as f64 * 2.0).collect();
        let result = market_structure(&highs, &lows, lookback);

        // At index 19, should detect bearish structure => -1.0
        assert!(approx_eq(result[n - 1], -1.0, 1e-10),
            "expected -1.0 for strong downtrend, got {}", result[n - 1]);
    }

    #[test]
    fn test_market_structure_range() {
        // Any valid value should be in [-1, 1]
        let lookback = 5;
        let n = 40;
        let highs: Vec<f64> = (0..n).map(|i| 102.0 + (i as f64 * 0.5).sin() * 5.0).collect();
        let lows: Vec<f64> = (0..n).map(|i| 98.0 + (i as f64 * 0.5).sin() * 5.0).collect();
        let result = market_structure(&highs, &lows, lookback);
        for &v in &result {
            if !v.is_nan() {
                assert!(v >= -1.0 && v <= 1.0, "market structure should be in [-1,1], got {v}");
            }
        }
    }

    #[test]
    fn test_market_structure_empty() {
        let result = market_structure(&[], &[], 5);
        assert_eq!(result.len(), 0);
    }

    // ─── New Indicators Output Length Test ─────────────────────────────────

    #[test]
    fn test_new_indicators_output_lengths() {
        let n = 60;
        let highs: Vec<f64> = (0..n).map(|i| 102.0 + (i as f64) * 0.5).collect();
        let lows: Vec<f64> = (0..n).map(|i| 98.0 + (i as f64) * 0.5).collect();
        let closes: Vec<f64> = (0..n).map(|i| 100.0 + (i as f64) * 0.5).collect();
        let volumes: Vec<f64> = vec![1000.0; n];

        let (t, k, sa, sb, c) = ichimoku(&highs, &lows, &closes, 9, 26, 52);
        assert_eq!(t.len(), n);
        assert_eq!(k.len(), n);
        assert_eq!(sa.len(), n);
        assert_eq!(sb.len(), n);
        assert_eq!(c.len(), n);

        assert_eq!(awesome_oscillator(&highs, &lows).len(), n);
        assert_eq!(vwap(&highs, &lows, &closes, &volumes).len(), n);
        assert_eq!(force_index(&closes, &volumes, 13).len(), n);
        assert_eq!(adl(&highs, &lows, &closes, &volumes).len(), n);

        let (ku, km, kl) = keltner_channels(&highs, &lows, &closes, 20, 10, 1.5);
        assert_eq!(ku.len(), n);
        assert_eq!(km.len(), n);
        assert_eq!(kl.len(), n);

        assert_eq!(squeeze_detect(&highs, &lows, &closes, 20, 2.0, 20, 10, 1.5).len(), n);
        assert_eq!(trix(&closes, 10).len(), n);
        assert_eq!(chaikin_money_flow(&highs, &lows, &closes, &volumes, 20).len(), n);

        let (bull, bear) = elder_ray(&highs, &lows, &closes, 13);
        assert_eq!(bull.len(), n);
        assert_eq!(bear.len(), n);

        let (st, dir) = supertrend(&highs, &lows, &closes, 10, 3.0);
        assert_eq!(st.len(), n);
        assert_eq!(dir.len(), n);

        let (sup, res) = support_resistance(&highs, &lows, 20);
        assert_eq!(sup.len(), n);
        assert_eq!(res.len(), n);

        assert_eq!(market_structure(&highs, &lows, 10).len(), n);
    }
}
