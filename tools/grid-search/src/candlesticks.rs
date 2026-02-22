// ---------------------------------------------------------------------------
// Candlestick Pattern Detection
//
// Detects 19 common candlestick patterns and returns a composite score.
// Ported from the TypeScript implementation in src/analysis/technical/indicators.ts
// ---------------------------------------------------------------------------

// ─── Public Types ─────────────────────────────────────────────────────────────

/// Result of candlestick pattern detection at a single bar.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct CandlestickSignal {
    pub bullish_count: u32,
    pub bearish_count: u32,
    /// 0–100 scale: 50 = neutral, >50 = bullish, <50 = bearish.
    pub net_score: f64,
}

// ─── OHLC Helpers ─────────────────────────────────────────────────────────────

#[inline]
fn body(open: f64, close: f64) -> f64 {
    (close - open).abs()
}

#[inline]
fn upper_shadow(high: f64, open: f64, close: f64) -> f64 {
    high - open.max(close)
}

#[inline]
fn lower_shadow(low: f64, open: f64, close: f64) -> f64 {
    open.min(close) - low
}

#[inline]
fn range(high: f64, low: f64) -> f64 {
    high - low
}

// ─── Bullish Patterns ─────────────────────────────────────────────────────────

/// Hammer — small body at top, long lower shadow (>= 2× body), short upper.
fn hammer(open: f64, high: f64, low: f64, close: f64) -> Option<bool> {
    let b = body(open, close);
    if b <= 0.0 {
        return Some(false);
    }
    let ls = lower_shadow(low, open, close);
    let us = upper_shadow(high, open, close);
    Some(ls >= 2.0 * b && us <= b * 0.3)
}

/// Inverted hammer — small body at bottom, long upper shadow (>= 2× body).
fn inverted_hammer(open: f64, high: f64, low: f64, close: f64) -> Option<bool> {
    let b = body(open, close);
    if b <= 0.0 {
        return Some(false);
    }
    let ls = lower_shadow(low, open, close);
    let us = upper_shadow(high, open, close);
    Some(us >= 2.0 * b && ls <= b * 0.3)
}

/// Bullish engulfing — prior red candle, current green body engulfs prior body.
fn bullish_engulfing(
    prev_o: f64, prev_c: f64,
    cur_o: f64, cur_c: f64,
) -> Option<bool> {
    let prev_red = prev_c < prev_o;
    let cur_green = cur_c > cur_o;
    Some(prev_red && cur_green && cur_o <= prev_c && cur_c >= prev_o)
}

/// Piercing line — prior red, current opens below prior low, closes above
/// midpoint of prior body.
fn piercing_line(
    prev_o: f64, prev_h: f64, prev_l: f64, prev_c: f64,
    cur_o: f64, cur_c: f64,
) -> Option<bool> {
    let _ = prev_h; // included for API symmetry, not used in condition
    let prev_red = prev_c < prev_o;
    let cur_green = cur_c > cur_o;
    let midpoint = (prev_o + prev_c) / 2.0;
    Some(prev_red && cur_green && cur_o < prev_l && cur_c > midpoint)
}

/// Morning star — 3-bar: big red, small body (gap down), big green closing
/// into first bar's body.
fn morning_star(
    o: [f64; 3], h: [f64; 3], l: [f64; 3], c: [f64; 3],
) -> Option<bool> {
    let _ = (h, l); // shadows not directly tested
    let body0 = body(o[0], c[0]);
    let body1 = body(o[1], c[1]);
    let body2 = body(o[2], c[2]);
    let bar0_red = c[0] < o[0];
    let bar2_green = c[2] > o[2];
    let small_middle = body1 < body0 * 0.5;
    let closes_into = c[2] > (o[0] + c[0]) / 2.0;
    Some(bar0_red && small_middle && bar2_green && closes_into && body2 > 0.0)
}

/// Three white soldiers — 3 consecutive green candles, each closing higher,
/// each opening within prior body.
fn three_white_soldiers(
    o: [f64; 3], _h: [f64; 3], _l: [f64; 3], c: [f64; 3],
) -> Option<bool> {
    let all_green = (0..3).all(|i| c[i] > o[i]);
    let each_higher = c[1] > c[0] && c[2] > c[1];
    let open_within_1 = o[1] >= o[0] && o[1] <= c[0];
    let open_within_2 = o[2] >= o[1] && o[2] <= c[1];
    Some(all_green && each_higher && open_within_1 && open_within_2)
}

/// Bullish harami — prior red, current small green body contained in prior body.
fn bullish_harami(
    prev_o: f64, prev_c: f64,
    cur_o: f64, cur_c: f64,
) -> Option<bool> {
    let prev_red = prev_c < prev_o;
    let cur_green = cur_c > cur_o;
    Some(prev_red && cur_green && cur_o >= prev_c && cur_c <= prev_o)
}

/// Dragonfly doji — open ≈ close ≈ high, long lower shadow.
fn dragonfly_doji(open: f64, high: f64, low: f64, close: f64) -> Option<bool> {
    let r = range(high, low);
    if r <= 0.0 {
        return Some(false);
    }
    let b = body(open, close);
    let us = upper_shadow(high, open, close);
    let ls = lower_shadow(low, open, close);
    Some(b <= r * 0.05 && us <= r * 0.05 && ls >= r * 0.7)
}

// ─── Bearish Patterns ─────────────────────────────────────────────────────────

/// Hanging man — same shape as hammer, but in bearish context (prior bar
/// closed higher than bar two bars ago).
fn hanging_man(
    open: f64, high: f64, low: f64, close: f64,
    prev_close: f64, prev2_close: f64,
) -> Option<bool> {
    let shape = hammer(open, high, low, close)?;
    let bearish_ctx = prev_close > prev2_close;
    Some(shape && bearish_ctx)
}

/// Shooting star — same shape as inverted hammer, bearish context.
fn shooting_star(
    open: f64, high: f64, low: f64, close: f64,
    prev_close: f64, prev2_close: f64,
) -> Option<bool> {
    let shape = inverted_hammer(open, high, low, close)?;
    let bearish_ctx = prev_close > prev2_close;
    Some(shape && bearish_ctx)
}

/// Bearish engulfing — prior green, current red body engulfs prior body.
fn bearish_engulfing(
    prev_o: f64, prev_c: f64,
    cur_o: f64, cur_c: f64,
) -> Option<bool> {
    let prev_green = prev_c > prev_o;
    let cur_red = cur_c < cur_o;
    Some(prev_green && cur_red && cur_o >= prev_c && cur_c <= prev_o)
}

/// Dark cloud cover — prior green, current opens above prior high, closes
/// below midpoint of prior body.
fn dark_cloud_cover(
    prev_o: f64, prev_h: f64, _prev_l: f64, prev_c: f64,
    cur_o: f64, cur_c: f64,
) -> Option<bool> {
    let prev_green = prev_c > prev_o;
    let cur_red = cur_c < cur_o;
    let midpoint = (prev_o + prev_c) / 2.0;
    Some(prev_green && cur_red && cur_o > prev_h && cur_c < midpoint)
}

/// Evening star — 3-bar: big green, small body (gap up), big red closing into
/// first bar's body.
fn evening_star(
    o: [f64; 3], h: [f64; 3], l: [f64; 3], c: [f64; 3],
) -> Option<bool> {
    let _ = (h, l);
    let body0 = body(o[0], c[0]);
    let body1 = body(o[1], c[1]);
    let body2 = body(o[2], c[2]);
    let bar0_green = c[0] > o[0];
    let bar2_red = c[2] < o[2];
    let small_middle = body1 < body0 * 0.5;
    let closes_into = c[2] < (o[0] + c[0]) / 2.0;
    Some(bar0_green && small_middle && bar2_red && closes_into && body2 > 0.0)
}

/// Three black crows — 3 consecutive red candles, each closing lower, each
/// opening within prior body.
fn three_black_crows(
    o: [f64; 3], _h: [f64; 3], _l: [f64; 3], c: [f64; 3],
) -> Option<bool> {
    let all_red = (0..3).all(|i| c[i] < o[i]);
    let each_lower = c[1] < c[0] && c[2] < c[1];
    let open_within_1 = o[1] <= o[0] && o[1] >= c[0];
    let open_within_2 = o[2] <= o[1] && o[2] >= c[1];
    Some(all_red && each_lower && open_within_1 && open_within_2)
}

/// Bearish harami — prior green, current small red body contained in prior body.
fn bearish_harami(
    prev_o: f64, prev_c: f64,
    cur_o: f64, cur_c: f64,
) -> Option<bool> {
    let prev_green = prev_c > prev_o;
    let cur_red = cur_c < cur_o;
    Some(prev_green && cur_red && cur_o <= prev_c && cur_c >= prev_o)
}

/// Gravestone doji — open ≈ close ≈ low, long upper shadow.
fn gravestone_doji(open: f64, high: f64, low: f64, close: f64) -> Option<bool> {
    let r = range(high, low);
    if r <= 0.0 {
        return Some(false);
    }
    let b = body(open, close);
    let us = upper_shadow(high, open, close);
    let ls = lower_shadow(low, open, close);
    Some(b <= r * 0.05 && ls <= r * 0.05 && us >= r * 0.7)
}

// ─── Neutral Patterns ─────────────────────────────────────────────────────────

/// Doji — open ≈ close (body <= 5% of range), moderate shadows both sides.
fn doji(open: f64, high: f64, low: f64, close: f64) -> Option<bool> {
    let r = range(high, low);
    if r <= 0.0 {
        return Some(false);
    }
    let b = body(open, close);
    let us = upper_shadow(high, open, close);
    let ls = lower_shadow(low, open, close);
    Some(b <= r * 0.05 && us > r * 0.05 && ls > r * 0.05)
}

/// Spinning top — small body (<= 30% of range), shadows on both sides.
fn spinning_top(open: f64, high: f64, low: f64, close: f64) -> Option<bool> {
    let r = range(high, low);
    if r <= 0.0 {
        return Some(false);
    }
    let b = body(open, close);
    let us = upper_shadow(high, open, close);
    let ls = lower_shadow(low, open, close);
    Some(b <= r * 0.3 && us > 0.0 && ls > 0.0)
}

/// Marubozu — very large body (>= 95% of range), almost no shadows.
/// Returns `Some((true, is_bullish))` when detected.
fn marubozu(open: f64, high: f64, low: f64, close: f64) -> Option<(bool, bool)> {
    let r = range(high, low);
    if r <= 0.0 {
        return Some((false, false));
    }
    let b = body(open, close);
    let detected = b >= r * 0.95;
    let is_bullish = close > open;
    Some((detected, is_bullish))
}

// ─── Composite Detection ──────────────────────────────────────────────────────

/// Detect candlestick patterns at the last bar of the given OHLC data.
/// Needs at least 3 bars for multi-bar patterns.
#[inline]
pub fn detect_patterns(
    opens: &[f64],
    highs: &[f64],
    lows: &[f64],
    closes: &[f64],
) -> CandlestickSignal {
    let n = opens.len();

    // Insufficient data — return neutral.
    if n == 0
        || highs.len() != n
        || lows.len() != n
        || closes.len() != n
    {
        return CandlestickSignal {
            bullish_count: 0,
            bearish_count: 0,
            net_score: 50.0,
        };
    }

    let i = n - 1; // last bar index
    let (o, h, l, c) = (opens[i], highs[i], lows[i], closes[i]);

    let mut bullish_count: u32 = 0;
    let mut bearish_count: u32 = 0;
    let mut weighted_bullish: f64 = 0.0;
    let mut weighted_bearish: f64 = 0.0;

    // --- Doji variants (detect first to avoid double-counting with hammer shapes) ---

    let is_dragonfly = dragonfly_doji(o, h, l, c).unwrap_or(false);
    let is_gravestone = gravestone_doji(o, h, l, c).unwrap_or(false);

    if is_dragonfly {
        bullish_count += 1;
        weighted_bullish += 0.5;
    }
    if is_gravestone {
        bearish_count += 1;
        weighted_bearish += 0.5;
    }

    // --- Single-bar bullish -------------------------------------------------

    // Hammer (weight 1.0) — skip if dragonfly_doji (same shape, more specific)
    if !is_dragonfly && hammer(o, h, l, c).unwrap_or(false) {
        bullish_count += 1;
        weighted_bullish += 1.0;
    }

    // Inverted hammer (weight 0.5) — skip if gravestone_doji (same shape, more specific)
    if !is_gravestone && inverted_hammer(o, h, l, c).unwrap_or(false) {
        bullish_count += 1;
        weighted_bullish += 0.5;
    }

    // --- Single-bar bearish -------------------------------------------------

    // --- Neutral single-bar -------------------------------------------------

    // Doji (weight 0.5 — counted as bullish since indecision leans contrarian)
    // Only count plain doji if not already a specific doji variant
    if doji(o, h, l, c).unwrap_or(false) && !is_dragonfly && !is_gravestone {
        bullish_count += 1;
        weighted_bullish += 0.5;
    }

    // Spinning top (weight 0.5 — neutral)
    if spinning_top(o, h, l, c).unwrap_or(false) {
        // Also neutral; no directional weight
    }

    // Marubozu (weight 1.0 — direction-dependent)
    if let Some((detected, is_bull)) = marubozu(o, h, l, c) {
        if detected {
            if is_bull {
                bullish_count += 1;
                weighted_bullish += 1.0;
            } else {
                bearish_count += 1;
                weighted_bearish += 1.0;
            }
        }
    }

    // --- Two-bar patterns (need at least 2 bars) ----------------------------

    if n >= 2 {
        let (po, _ph, _pl, pc) = (
            opens[i - 1], highs[i - 1], lows[i - 1], closes[i - 1],
        );
        let prev_h = highs[i - 1];
        let prev_l = lows[i - 1];

        // Bullish engulfing (weight 2.0)
        if bullish_engulfing(po, pc, o, c).unwrap_or(false) {
            bullish_count += 1;
            weighted_bullish += 2.0;
        }

        // Piercing line (weight 1.0)
        if piercing_line(po, prev_h, prev_l, pc, o, c).unwrap_or(false) {
            bullish_count += 1;
            weighted_bullish += 1.0;
        }

        // Bullish harami (weight 1.0)
        if bullish_harami(po, pc, o, c).unwrap_or(false) {
            bullish_count += 1;
            weighted_bullish += 1.0;
        }

        // Bearish engulfing (weight 2.0)
        if bearish_engulfing(po, pc, o, c).unwrap_or(false) {
            bearish_count += 1;
            weighted_bearish += 2.0;
        }

        // Dark cloud cover (weight 1.0)
        if dark_cloud_cover(po, prev_h, prev_l, pc, o, c).unwrap_or(false) {
            bearish_count += 1;
            weighted_bearish += 1.0;
        }

        // Bearish harami (weight 1.0)
        if bearish_harami(po, pc, o, c).unwrap_or(false) {
            bearish_count += 1;
            weighted_bearish += 1.0;
        }
    }

    // --- Three-bar patterns (need at least 3 bars) --------------------------

    if n >= 3 {
        let o3 = [opens[i - 2], opens[i - 1], opens[i]];
        let h3 = [highs[i - 2], highs[i - 1], highs[i]];
        let l3 = [lows[i - 2], lows[i - 1], lows[i]];
        let c3 = [closes[i - 2], closes[i - 1], closes[i]];

        let prev2_c = closes[i - 2];
        let prev_c = closes[i - 1];

        // Morning star (weight 2.0)
        if morning_star(o3, h3, l3, c3).unwrap_or(false) {
            bullish_count += 1;
            weighted_bullish += 2.0;
        }

        // Three white soldiers (weight 2.0)
        if three_white_soldiers(o3, h3, l3, c3).unwrap_or(false) {
            bullish_count += 1;
            weighted_bullish += 2.0;
        }

        // Evening star (weight 2.0)
        if evening_star(o3, h3, l3, c3).unwrap_or(false) {
            bearish_count += 1;
            weighted_bearish += 2.0;
        }

        // Three black crows (weight 2.0)
        if three_black_crows(o3, h3, l3, c3).unwrap_or(false) {
            bearish_count += 1;
            weighted_bearish += 2.0;
        }

        // Hanging man (weight 0.5) — needs bearish context from 2 bars ago
        if hanging_man(o, h, l, c, prev_c, prev2_c).unwrap_or(false) {
            bearish_count += 1;
            weighted_bearish += 0.5;
        }

        // Shooting star (weight 1.0) — needs bearish context from 2 bars ago
        if shooting_star(o, h, l, c, prev_c, prev2_c).unwrap_or(false) {
            bearish_count += 1;
            weighted_bearish += 1.0;
        }
    }

    // --- Scoring -------------------------------------------------------------

    let max_possible: f64 = 10.0;
    let net = weighted_bullish - weighted_bearish;
    let raw = 50.0 + (net / max_possible) * 40.0;
    let net_score = raw.clamp(10.0, 90.0);

    CandlestickSignal {
        bullish_count,
        bearish_count,
        net_score,
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Build simple slice helpers for test readability.
    fn sig(opens: &[f64], highs: &[f64], lows: &[f64], closes: &[f64]) -> CandlestickSignal {
        detect_patterns(opens, highs, lows, closes)
    }

    #[test]
    fn test_hammer_detection() {
        // Hammer: open=50, close=51, low=45 (long lower shadow), high=51.2
        // body = 1, lower_shadow = 50-45 = 5, upper_shadow = 51.2-51 = 0.2
        // 5 >= 2*1 ✓, 0.2 <= 1*0.3 ✓
        let s = sig(&[50.0], &[51.2], &[45.0], &[51.0]);
        assert!(s.bullish_count >= 1, "should detect hammer as bullish");
        assert!(s.net_score > 50.0, "hammer should push score bullish");
    }

    #[test]
    fn test_engulfing_bullish() {
        // Bar 0: red candle O=52 C=48 (body=4)
        // Bar 1: green candle O=47 C=53 (body=6, engulfs prior)
        let opens  = [52.0, 47.0];
        let highs  = [53.0, 54.0];
        let lows   = [47.0, 46.0];
        let closes = [48.0, 53.0];

        let s = sig(&opens, &highs, &lows, &closes);
        assert!(s.bullish_count >= 1, "should detect bullish engulfing");
        assert!(s.net_score > 50.0, "bullish engulfing should push score up");
    }

    #[test]
    fn test_engulfing_bearish() {
        // Bar 0: green candle O=48 C=52 (body=4)
        // Bar 1: red candle O=53 C=47 (body=6, engulfs prior)
        let opens  = [48.0, 53.0];
        let highs  = [53.0, 54.0];
        let lows   = [47.0, 46.0];
        let closes = [52.0, 47.0];

        let s = sig(&opens, &highs, &lows, &closes);
        assert!(s.bearish_count >= 1, "should detect bearish engulfing");
        assert!(s.net_score < 50.0, "bearish engulfing should push score down");
    }

    #[test]
    fn test_doji_detection() {
        // Doji: open ≈ close, range = high-low = 10, body = 0.1 (1% of range)
        // upper_shadow = 55 - 50.05 = 4.95, lower_shadow = 49.95 - 45 = 4.95
        let s = sig(&[50.0], &[55.0], &[45.0], &[50.1]);
        // body=0.1, range=10 → 1% ✓, both shadows > 5% ✓
        assert!(s.bullish_count >= 1, "doji should be counted");
        // Score should be near neutral (doji has only 0.5 weight)
        assert!(
            s.net_score >= 45.0 && s.net_score <= 55.0,
            "doji should keep score near neutral, got {}",
            s.net_score
        );
    }

    #[test]
    fn test_insufficient_data() {
        // Empty slices
        let s = sig(&[], &[], &[], &[]);
        assert_eq!(s.bullish_count, 0);
        assert_eq!(s.bearish_count, 0);
        assert!((s.net_score - 50.0).abs() < f64::EPSILON, "empty data should be neutral");

        // Single bar with flat candle (no pattern)
        let s2 = sig(&[50.0], &[50.0], &[50.0], &[50.0]);
        assert!((s2.net_score - 50.0).abs() < f64::EPSILON, "flat bar should be neutral");
    }

    #[test]
    fn test_score_range() {
        // Even with extreme patterns, score must stay in [10, 90].
        // Build a strongly bullish scenario: bullish engulfing + hammer-like last bar
        let opens  = [60.0, 55.0, 42.0];
        let highs  = [61.0, 56.0, 52.2];
        let lows   = [54.0, 49.0, 35.0];
        let closes = [55.0, 50.0, 52.0];

        let s = sig(&opens, &highs, &lows, &closes);
        assert!(
            s.net_score >= 10.0 && s.net_score <= 90.0,
            "score must be in [10,90], got {}",
            s.net_score
        );

        // Strongly bearish scenario
        let opens  = [40.0, 45.0, 58.0];
        let highs  = [46.0, 51.0, 65.0];
        let lows   = [39.0, 44.0, 47.8];
        let closes = [45.0, 50.0, 48.0];

        let s2 = sig(&opens, &highs, &lows, &closes);
        assert!(
            s2.net_score >= 10.0 && s2.net_score <= 90.0,
            "score must be in [10,90], got {}",
            s2.net_score
        );
    }

    #[test]
    fn test_morning_star() {
        // Bar 0: big red O=55 C=45 (body=10)
        // Bar 1: small body O=44 C=44.5 (body=0.5, < 10*0.5=5 ✓)
        // Bar 2: big green O=45 C=52 (closes above midpoint of bar0 = 50) ✓
        let opens  = [55.0, 44.0, 45.0];
        let highs  = [56.0, 45.0, 53.0];
        let lows   = [44.0, 43.0, 44.0];
        let closes = [45.0, 44.5, 52.0];

        let s = sig(&opens, &highs, &lows, &closes);
        assert!(s.bullish_count >= 1, "should detect morning star");
        assert!(s.net_score > 50.0, "morning star should be bullish");
    }

    #[test]
    fn test_evening_star() {
        // Bar 0: big green O=45 C=55 (body=10)
        // Bar 1: small body O=56 C=55.5 (body=0.5, < 10*0.5=5 ✓)
        // Bar 2: big red O=55 C=48 (closes below midpoint of bar0 = 50) ✓
        let opens  = [45.0, 56.0, 55.0];
        let highs  = [56.0, 57.0, 56.0];
        let lows   = [44.0, 55.0, 47.0];
        let closes = [55.0, 55.5, 48.0];

        let s = sig(&opens, &highs, &lows, &closes);
        assert!(s.bearish_count >= 1, "should detect evening star");
        assert!(s.net_score < 50.0, "evening star should be bearish");
    }

    #[test]
    fn test_marubozu_bullish() {
        // Green marubozu: O=100, H=110, L=100, C=110 → body=10, range=10 → 100% ✓
        let s = sig(&[100.0], &[110.0], &[100.0], &[110.0]);
        assert!(s.bullish_count >= 1, "should detect bullish marubozu");
        assert!(s.net_score > 50.0, "bullish marubozu should push score up");
    }

    #[test]
    fn test_marubozu_bearish() {
        // Red marubozu: O=110, H=110, L=100, C=100 → body=10, range=10 → 100% ✓
        let s = sig(&[110.0], &[110.0], &[100.0], &[100.0]);
        assert!(s.bearish_count >= 1, "should detect bearish marubozu");
        assert!(s.net_score < 50.0, "bearish marubozu should push score down");
    }

    #[test]
    fn test_three_white_soldiers() {
        // 3 green candles, each closing higher, each opening within prior body
        let opens  = [40.0, 42.0, 44.0];
        let highs  = [45.0, 47.0, 49.0];
        let lows   = [39.0, 41.0, 43.0];
        let closes = [44.0, 46.0, 48.0];

        let s = sig(&opens, &highs, &lows, &closes);
        assert!(s.bullish_count >= 1, "should detect three white soldiers");
        assert!(s.net_score > 50.0, "three white soldiers should be bullish");
    }

    #[test]
    fn test_three_black_crows() {
        // 3 red candles, each closing lower, each opening within prior body
        let opens  = [48.0, 46.0, 44.0];
        let highs  = [49.0, 47.0, 45.0];
        let lows   = [43.0, 41.0, 39.0];
        let closes = [44.0, 42.0, 40.0];

        let s = sig(&opens, &highs, &lows, &closes);
        assert!(s.bearish_count >= 1, "should detect three black crows");
        assert!(s.net_score < 50.0, "three black crows should be bearish");
    }

    #[test]
    fn test_gravestone_doji() {
        // O ≈ C ≈ low, long upper shadow
        // O=100, C=100.1, L=100, H=110 → body=0.1, range=10
        // body <= 0.5 ✓, lower_shadow = 0 <= 0.5 ✓, upper_shadow = 9.9 >= 7.0 ✓
        let s = sig(&[100.0], &[110.0], &[100.0], &[100.1]);
        assert!(s.bearish_count >= 1, "should detect gravestone doji");
        assert!(s.net_score < 50.0, "gravestone doji should be bearish");
    }
}
