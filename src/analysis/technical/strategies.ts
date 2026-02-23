import {
  calcADX,
  calcATR,
  calcBollingerBands,
  calcEMA,
  calcMFI,
  calcROC,
  calcRSI,
  calcSMA,
  calcStochastic,
  calcVolumeRatio,
  calcWilliamsR,
} from './indicators.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StrategyType = 'MEAN_REVERSION' | 'TREND_FOLLOWING' | 'MOMENTUM' | 'BREAKOUT';

export interface StrategySignal {
  strategy: StrategyType;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  strength: number; // 0 to 1
  confidence: number; // 0 to 1
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * OBV trend: slope of the last `window` OBV values normalised to [-1, 1].
 * Builds the full OBV series, then does a linear-regression slope over the window.
 */
function obvTrend(closes: number[], volumes: number[], window = 20): number {
  const len = Math.min(closes.length, volumes.length);
  if (len < window + 1) return 0;

  // Build OBV series
  const obvArr: number[] = [0];
  for (let i = 1; i < len; i++) {
    if (closes[i] > closes[i - 1]) obvArr.push(obvArr[i - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) obvArr.push(obvArr[i - 1] - volumes[i]);
    else obvArr.push(obvArr[i - 1]);
  }

  const recent = obvArr.slice(-window);
  const n = recent.length;
  const xMean = (n - 1) / 2;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * recent[i];
    den += (i - xMean) ** 2;
  }
  if (den === 0) return 0;
  const slope = num / den;
  const meanAbs = recent.reduce((a, b) => a + Math.abs(b), 0) / n || 1;
  return clamp((slope / meanAbs) * 10, -1, 1);
}

/** Annualized volatility from daily returns over a window. */
function annualizedVolatility(closes: number[], window: number): number | null {
  if (closes.length <= window || window <= 0) return null;
  const slice = closes.slice(closes.length - window);
  const returns = slice.slice(1).map((v, i) => (v - slice[i]) / slice[i]);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}

// ---------------------------------------------------------------------------
// Strategy 1 – Mean Reversion
// ---------------------------------------------------------------------------

export function scoreMeanReversion(
  closes: number[],
  highs: number[],
  lows: number[],
  _volumes: number[],
): StrategySignal {
  const reasons: string[] = [];
  let longScore = 0;
  let shortScore = 0;
  let subSignals = 0;
  let agreeing = 0;

  // RSI
  const rsiVal = calcRSI(closes, 14);
  if (rsiVal != null) {
    subSignals++;
    if (rsiVal < 35) {
      const s = clamp((35 - rsiVal) / 35);
      longScore += s * 0.25;
      agreeing++;
      reasons.push(`RSI oversold at ${rsiVal.toFixed(1)}`);
    } else if (rsiVal >= 35 && rsiVal < 40) {
      longScore += 0.1;
      agreeing++;
      reasons.push(`RSI near oversold at ${rsiVal.toFixed(1)}`);
    } else if (rsiVal > 65) {
      const s = clamp((rsiVal - 65) / 35);
      shortScore += s * 0.25;
      agreeing++;
      reasons.push(`RSI overbought at ${rsiVal.toFixed(1)}`);
    } else if (rsiVal > 60 && rsiVal <= 65) {
      shortScore += 0.1;
      agreeing++;
      reasons.push(`RSI near overbought at ${rsiVal.toFixed(1)}`);
    }
  }

  // Bollinger %B
  const bb = calcBollingerBands(closes, 20, 2);
  if (bb != null) {
    const price = closes[closes.length - 1];
    const percentB = bb.upper !== bb.lower ? (price - bb.lower) / (bb.upper - bb.lower) : 0.5;
    subSignals++;
    if (percentB < 0) {
      const s = clamp(-percentB);
      longScore += s * 0.25;
      agreeing++;
      reasons.push(`Price below lower Bollinger Band (%B=${percentB.toFixed(2)})`);
    } else if (percentB > 1) {
      const s = clamp(percentB - 1);
      shortScore += s * 0.25;
      agreeing++;
      reasons.push(`Price above upper Bollinger Band (%B=${percentB.toFixed(2)})`);
    } else if (percentB < 0.2) {
      longScore += 0.1;
      agreeing++;
      reasons.push(`Price near lower Bollinger Band (%B=${percentB.toFixed(2)})`);
    } else if (percentB > 0.8) {
      shortScore += 0.1;
      agreeing++;
      reasons.push(`Price near upper Bollinger Band (%B=${percentB.toFixed(2)})`);
    }
  }

  // Z-score from SMA(50)
  const sma50 = calcSMA(closes, 50);
  const vol20 = annualizedVolatility(closes, 20);
  if (sma50 != null && vol20 != null && vol20 > 0 && closes.length > 0) {
    const price = closes[closes.length - 1];
    const dailyStd = (vol20 / Math.sqrt(252)) * price;
    const zScore = dailyStd > 0 ? (price - sma50) / dailyStd : 0;
    subSignals++;
    if (zScore < -1.2) {
      const s = clamp((-zScore - 1.2) / 2);
      longScore += s * 0.2;
      agreeing++;
      reasons.push(`Price far below SMA(50) (z=${zScore.toFixed(2)})`);
    } else if (zScore > 1.2) {
      const s = clamp((zScore - 1.2) / 2);
      shortScore += s * 0.2;
      agreeing++;
      reasons.push(`Price far above SMA(50) (z=${zScore.toFixed(2)})`);
    }
  }

  // Stochastic
  const stoch = calcStochastic(highs, lows, closes);
  if (stoch != null) {
    subSignals++;
    if (stoch.k < 20) {
      const s = clamp((20 - stoch.k) / 20);
      longScore += s * 0.15;
      agreeing++;
      reasons.push(`Stochastic oversold (%K=${stoch.k.toFixed(1)})`);
    } else if (stoch.k > 80) {
      const s = clamp((stoch.k - 80) / 20);
      shortScore += s * 0.15;
      agreeing++;
      reasons.push(`Stochastic overbought (%K=${stoch.k.toFixed(1)})`);
    }
  }

  // Williams %R
  const wr = calcWilliamsR(highs, lows, closes);
  if (wr != null) {
    subSignals++;
    if (wr < -80) {
      const s = clamp((-80 - wr) / 20);
      longScore += s * 0.15;
      agreeing++;
      reasons.push(`Williams %R oversold (${wr.toFixed(1)})`);
    } else if (wr > -20) {
      const s = clamp((wr + 20) / 20);
      shortScore += s * 0.15;
      agreeing++;
      reasons.push(`Williams %R overbought (${wr.toFixed(1)})`);
    }
  }

  // Determine direction
  const netScore = longScore - shortScore;
  let direction: StrategySignal['direction'] = 'NEUTRAL';
  let strength = 0;

  if (netScore > 0.03) {
    direction = 'LONG';
    strength = clamp(longScore * 2);
  } else if (netScore < -0.03) {
    direction = 'SHORT';
    strength = clamp(shortScore * 2);
  }

  const confidence = subSignals > 0 ? clamp(agreeing / subSignals) : 0;
  if (reasons.length === 0) reasons.push('No mean-reversion signals detected');

  return { strategy: 'MEAN_REVERSION', direction, strength, confidence, reasons };
}

// ---------------------------------------------------------------------------
// Strategy 2 – Trend Following
// ---------------------------------------------------------------------------

export function scoreTrendFollowing(
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
): StrategySignal {
  const reasons: string[] = [];
  let longScore = 0;
  let shortScore = 0;
  let subSignals = 0;
  let agreeing = 0;

  // EMA alignment
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);

  if (ema20 != null && ema50 != null && ema200 != null) {
    subSignals++;
    if (ema20 > ema50 && ema50 > ema200) {
      longScore += 0.25;
      agreeing++;
      reasons.push('EMAs aligned bullish (20 > 50 > 200)');
    } else if (ema20 < ema50 && ema50 < ema200) {
      shortScore += 0.25;
      agreeing++;
      reasons.push('EMAs aligned bearish (20 < 50 < 200)');
    }
  } else if (ema20 != null && ema50 != null) {
    subSignals++;
    if (ema20 > ema50) {
      longScore += 0.15;
      agreeing++;
      reasons.push('EMAs partially aligned bullish (20 > 50)');
    } else if (ema20 < ema50) {
      shortScore += 0.15;
      agreeing++;
      reasons.push('EMAs partially aligned bearish (20 < 50)');
    }
  }

  // ADX > 25 confirms trending market
  const adxVal = calcADX(highs, lows, closes);
  if (adxVal != null) {
    subSignals++;
    if (adxVal > 25) {
      const s = clamp((adxVal - 25) / 25);
      if (longScore > shortScore) longScore += s * 0.15;
      else if (shortScore > longScore) shortScore += s * 0.15;
      else longScore += s * 0.05;
      agreeing++;
      reasons.push(`ADX confirming trend at ${adxVal.toFixed(1)}`);
    }
  }

  // MACD — use calcROC as proxy (MACD is already computed elsewhere in the pipeline)
  // Instead, use the ROC for momentum confirmation
  const roc20 = calcROC(closes, 20);
  if (roc20 != null) {
    subSignals++;
    if (roc20 > 3) {
      const s = clamp(roc20 / 15);
      longScore += s * 0.25;
      agreeing++;
      reasons.push(`Positive trend momentum (ROC20=${roc20.toFixed(1)}%)`);
    } else if (roc20 < -3) {
      const s = clamp(-roc20 / 15);
      shortScore += s * 0.25;
      agreeing++;
      reasons.push(`Negative trend momentum (ROC20=${roc20.toFixed(1)}%)`);
    }
  }

  // Price above/below EMA(200)
  if (ema200 != null && closes.length > 0) {
    const price = closes[closes.length - 1];
    subSignals++;
    if (price > ema200) {
      const pctAbove = (price - ema200) / ema200;
      longScore += clamp(pctAbove * 5) * 0.2;
      agreeing++;
      reasons.push(`Price ${(pctAbove * 100).toFixed(1)}% above EMA(200)`);
    } else {
      const pctBelow = (ema200 - price) / ema200;
      shortScore += clamp(pctBelow * 5) * 0.2;
      agreeing++;
      reasons.push(`Price ${(pctBelow * 100).toFixed(1)}% below EMA(200)`);
    }
  }

  // Volume confirmation
  const relVol = calcVolumeRatio(volumes, 20);
  if (relVol != null) {
    subSignals++;
    if (relVol > 1.0) {
      const s = clamp((relVol - 1.0) / 1.5);
      if (longScore > shortScore) longScore += s * 0.15;
      else shortScore += s * 0.15;
      agreeing++;
      reasons.push(`Volume confirming trend (relVol=${relVol.toFixed(2)})`);
    }
  }

  const netScore = longScore - shortScore;
  let direction: StrategySignal['direction'] = 'NEUTRAL';
  let strength = 0;

  if (netScore > 0.05) {
    direction = 'LONG';
    strength = clamp(longScore * 1.8);
  } else if (netScore < -0.05) {
    direction = 'SHORT';
    strength = clamp(shortScore * 1.8);
  }

  const confidence = subSignals > 0 ? clamp(agreeing / subSignals) : 0;
  if (reasons.length === 0) reasons.push('No trend-following signals detected');

  return { strategy: 'TREND_FOLLOWING', direction, strength, confidence, reasons };
}

// ---------------------------------------------------------------------------
// Strategy 3 – Momentum
// ---------------------------------------------------------------------------

export function scoreMomentum(
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
): StrategySignal {
  const reasons: string[] = [];
  let longScore = 0;
  let shortScore = 0;
  let subSignals = 0;
  let agreeing = 0;

  // Rate of change over 10 and 20 periods
  const roc10 = calcROC(closes, 10);
  const roc20 = calcROC(closes, 20);
  if (roc10 != null && roc20 != null) {
    subSignals++;
    if (roc10 > 1 && roc20 > 2) {
      const s = clamp((roc10 + roc20) / 30);
      longScore += s * 0.25;
      agreeing++;
      reasons.push(`Strong positive ROC (10d=${roc10.toFixed(1)}%, 20d=${roc20.toFixed(1)}%)`);
    } else if (roc10 < -1 && roc20 < -2) {
      const s = clamp((-roc10 + -roc20) / 30);
      shortScore += s * 0.25;
      agreeing++;
      reasons.push(`Strong negative ROC (10d=${roc10.toFixed(1)}%, 20d=${roc20.toFixed(1)}%)`);
    }
  }

  // RSI in momentum zone
  const rsiVal = calcRSI(closes, 14);
  if (rsiVal != null) {
    subSignals++;
    if (rsiVal >= 50 && rsiVal <= 70) {
      const s = clamp((rsiVal - 50) / 20);
      longScore += s * 0.2;
      agreeing++;
      reasons.push(`RSI in bullish momentum zone (${rsiVal.toFixed(1)})`);
    } else if (rsiVal >= 30 && rsiVal < 50) {
      const s = clamp((50 - rsiVal) / 20);
      shortScore += s * 0.2;
      agreeing++;
      reasons.push(`RSI in bearish momentum zone (${rsiVal.toFixed(1)})`);
    }
  }

  // Relative volume above average
  const relVol = calcVolumeRatio(volumes, 20);
  if (relVol != null) {
    subSignals++;
    if (relVol > 1.2) {
      const s = clamp((relVol - 1.2) / 1.5);
      if (longScore >= shortScore) longScore += s * 0.2;
      else shortScore += s * 0.2;
      agreeing++;
      reasons.push(`Above-average volume participation (relVol=${relVol.toFixed(2)})`);
    }
  }

  // OBV trend
  const obvT = obvTrend(closes, volumes, 20);
  if (Math.abs(obvT) > 0.1) {
    subSignals++;
    if (obvT > 0.1) {
      longScore += clamp(obvT) * 0.2;
      agreeing++;
      reasons.push(`OBV trending up (slope=${obvT.toFixed(2)})`);
    } else {
      shortScore += clamp(-obvT) * 0.2;
      agreeing++;
      reasons.push(`OBV trending down (slope=${obvT.toFixed(2)})`);
    }
  }

  // MFI confirmation
  const mfiVal = calcMFI(highs, lows, closes, volumes);
  if (mfiVal != null) {
    subSignals++;
    if (mfiVal > 50 && longScore > shortScore) {
      const s = clamp((mfiVal - 50) / 30);
      longScore += s * 0.15;
      agreeing++;
      reasons.push(`MFI confirms buying pressure (${mfiVal.toFixed(1)})`);
    } else if (mfiVal < 50 && shortScore > longScore) {
      const s = clamp((50 - mfiVal) / 30);
      shortScore += s * 0.15;
      agreeing++;
      reasons.push(`MFI confirms selling pressure (${mfiVal.toFixed(1)})`);
    }
  }

  const netScore = longScore - shortScore;
  let direction: StrategySignal['direction'] = 'NEUTRAL';
  let strength = 0;

  if (netScore > 0.05) {
    direction = 'LONG';
    strength = clamp(longScore * 1.8);
  } else if (netScore < -0.05) {
    direction = 'SHORT';
    strength = clamp(shortScore * 1.8);
  }

  const confidence = subSignals > 0 ? clamp(agreeing / subSignals) : 0;
  if (reasons.length === 0) reasons.push('No momentum signals detected');

  return { strategy: 'MOMENTUM', direction, strength, confidence, reasons };
}

// ---------------------------------------------------------------------------
// Strategy 4 – Breakout
// ---------------------------------------------------------------------------

export function scoreBreakout(
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
): StrategySignal {
  const reasons: string[] = [];
  let longScore = 0;
  let shortScore = 0;
  let subSignals = 0;
  let agreeing = 0;

  const price = closes.length > 0 ? closes[closes.length - 1] : 0;
  const lookback = 20;

  // Donchian channel breakout (20-period high/low)
  if (highs.length >= lookback && lows.length >= lookback) {
    const channelHighs = highs.slice(highs.length - lookback);
    const channelLows = lows.slice(lows.length - lookback);
    const donchianHigh = Math.max(...channelHighs);
    const donchianLow = Math.min(...channelLows);
    subSignals++;

    if (price >= donchianHigh) {
      longScore += 0.3;
      agreeing++;
      reasons.push(`Price breaking above 20-period high ($${donchianHigh.toFixed(2)})`);
    } else if (price <= donchianLow) {
      shortScore += 0.3;
      agreeing++;
      reasons.push(`Price breaking below 20-period low ($${donchianLow.toFixed(2)})`);
    } else {
      const range = donchianHigh - donchianLow;
      if (range > 0) {
        const position = (price - donchianLow) / range;
        if (position > 0.9) {
          longScore += 0.15;
          agreeing++;
          reasons.push(`Price near 20-period high (position=${(position * 100).toFixed(0)}%)`);
        } else if (position < 0.1) {
          shortScore += 0.15;
          agreeing++;
          reasons.push(`Price near 20-period low (position=${(position * 100).toFixed(0)}%)`);
        }
      }
    }
  }

  // 50-period Donchian (secondary confirmation)
  const lookback50 = 50;
  if (highs.length >= lookback50 && lows.length >= lookback50) {
    const channelHighs50 = highs.slice(highs.length - lookback50);
    const channelLows50 = lows.slice(lows.length - lookback50);
    const donchianHigh50 = Math.max(...channelHighs50);
    const donchianLow50 = Math.min(...channelLows50);
    subSignals++;

    if (price >= donchianHigh50) {
      longScore += 0.2;
      agreeing++;
      reasons.push(`Price breaking above 50-period high ($${donchianHigh50.toFixed(2)})`);
    } else if (price <= donchianLow50) {
      shortScore += 0.2;
      agreeing++;
      reasons.push(`Price breaking below 50-period low ($${donchianLow50.toFixed(2)})`);
    }
  }

  // Volume surge
  const relVol = calcVolumeRatio(volumes, 20);
  if (relVol != null) {
    subSignals++;
    if (relVol > 1.3) {
      const s = clamp((relVol - 1.3) / 2);
      if (longScore >= shortScore) longScore += s * 0.25;
      else shortScore += s * 0.25;
      agreeing++;
      reasons.push(`Volume surge (relVol=${relVol.toFixed(2)})`);
    }
  }

  // ATR expansion
  const currentATR = calcATR(highs, lows, closes, 14);
  const longATR = calcATR(highs, lows, closes, 50);
  if (currentATR != null && longATR != null && longATR > 0) {
    subSignals++;
    const atrRatio = currentATR / longATR;
    if (atrRatio > 1.1) {
      const s = clamp((atrRatio - 1.1) / 1.0);
      if (longScore >= shortScore) longScore += s * 0.2;
      else shortScore += s * 0.2;
      agreeing++;
      reasons.push(`ATR expanding (ratio=${atrRatio.toFixed(2)}x avg)`);
    }
  }

  // ADX rising above 20
  const adxVal = calcADX(highs, lows, closes);
  if (adxVal != null) {
    subSignals++;
    if (adxVal > 20 && adxVal < 40) {
      const s = clamp((adxVal - 20) / 20);
      if (longScore >= shortScore) longScore += s * 0.15;
      else shortScore += s * 0.15;
      agreeing++;
      reasons.push(`ADX rising into trend territory (${adxVal.toFixed(1)})`);
    }
  }

  // Bollinger bandwidth expanding
  const bb = calcBollingerBands(closes, 20, 2);
  if (bb != null) {
    subSignals++;
    const bandwidth = bb.middle !== 0 ? (bb.upper - bb.lower) / bb.middle : 0;
    if (bandwidth > 0.08) {
      const s = clamp((bandwidth - 0.08) / 0.1);
      if (longScore >= shortScore) longScore += s * 0.1;
      else shortScore += s * 0.1;
      agreeing++;
      reasons.push(`Bollinger bandwidth expanding (${(bandwidth * 100).toFixed(1)}%)`);
    }
  }

  const netScore = longScore - shortScore;
  let direction: StrategySignal['direction'] = 'NEUTRAL';
  let strength = 0;

  if (netScore > 0.03) {
    direction = 'LONG';
    strength = clamp(longScore * 1.6);
  } else if (netScore < -0.03) {
    direction = 'SHORT';
    strength = clamp(shortScore * 1.6);
  }

  const confidence = subSignals > 0 ? clamp(agreeing / subSignals) : 0;
  if (reasons.length === 0) reasons.push('No breakout signals detected');

  return { strategy: 'BREAKOUT', direction, strength, confidence, reasons };
}

// ---------------------------------------------------------------------------
// Multi-Strategy Consensus Scorer (for backtesting)
// ---------------------------------------------------------------------------

/**
 * Regime-weighted strategy weights based on market conditions.
 * Detected from price data: volatility percentile + trend strength.
 */
function detectRegimeFromCandles(closes: number[], highs: number[], lows: number[]): string {
  // ADX for trend strength
  const adx = calcADX(highs, lows, closes);
  // Volatility percentile from recent ATR vs long-term ATR
  const shortATR = calcATR(highs, lows, closes, 14);
  const longATR = calcATR(highs, lows, closes, 50);
  const atrRatio = shortATR != null && longATR != null && longATR > 0 ? shortATR / longATR : 1;

  // High vol + weak trend = volatile
  if (atrRatio > 1.3 && (adx == null || adx < 20)) return 'volatile';
  // Strong trend
  if (adx != null && adx > 30) {
    const ema50 = calcEMA(closes, 50);
    const price = closes[closes.length - 1];
    if (ema50 != null && price > ema50) return 'trending_up';
    return 'trending_down';
  }
  // Moderate trend
  if (adx != null && adx > 20) return 'moderate_trend';
  // Default: range-bound / sideways
  return 'sideways';
}

function getRegimeWeights(regime: string): Record<StrategyType, number> {
  switch (regime) {
    case 'trending_up':
      return { TREND_FOLLOWING: 0.4, MOMENTUM: 0.3, BREAKOUT: 0.2, MEAN_REVERSION: 0.1 };
    case 'trending_down':
      return { TREND_FOLLOWING: 0.35, MEAN_REVERSION: 0.3, MOMENTUM: 0.2, BREAKOUT: 0.15 };
    case 'moderate_trend':
      return { TREND_FOLLOWING: 0.3, MOMENTUM: 0.3, BREAKOUT: 0.2, MEAN_REVERSION: 0.2 };
    case 'volatile':
      return { MEAN_REVERSION: 0.35, BREAKOUT: 0.25, MOMENTUM: 0.25, TREND_FOLLOWING: 0.15 };
    default: // sideways
      return { MEAN_REVERSION: 0.35, MOMENTUM: 0.25, BREAKOUT: 0.25, TREND_FOLLOWING: 0.15 };
  }
}

/**
 * Multi-strategy consensus score. Runs all 4 strategies, weights them by
 * detected market regime, and returns a 0-100 score compatible with the
 * backtest engine's scoreFn interface.
 *
 * Score mapping:
 *   - 2+ LONG strategies: 50 + weighted strength * 50 → 50-100
 *   - 1 high-conviction LONG: 50 + strength * 40 → 50-90
 *   - NEUTRAL / mixed: 40-60
 *   - SHORT signals: 0-40
 */
export function scoreMultiStrategy(
  candles: {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[],
): number {
  if (candles.length < 50) return 50; // insufficient data → neutral

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  // Run all 4 strategies
  const mr = scoreMeanReversion(closes, highs, lows, volumes);
  const tf = scoreTrendFollowing(closes, highs, lows, volumes);
  const mo = scoreMomentum(closes, highs, lows, volumes);
  const bo = scoreBreakout(closes, highs, lows, volumes);

  const strategies = [mr, tf, mo, bo];

  // Detect regime and get weights
  const regime = detectRegimeFromCandles(closes, highs, lows);
  const weights = getRegimeWeights(regime);

  // Count agreements
  const longStrategies = strategies.filter((s) => s.direction === 'LONG');
  const shortStrategies = strategies.filter((s) => s.direction === 'SHORT');

  // Weighted strength calculation
  let weightedLong = 0;
  let weightedShort = 0;
  for (const s of strategies) {
    const w = weights[s.strategy];
    if (s.direction === 'LONG') weightedLong += s.strength * s.confidence * w;
    else if (s.direction === 'SHORT') weightedShort += s.strength * s.confidence * w;
  }

  // Multi-strategy agreement gate
  let score: number;

  if (longStrategies.length >= 2) {
    // Strong LONG consensus: 55-95 range
    score = 55 + clamp(weightedLong * 2) * 40;
  } else if (shortStrategies.length >= 2) {
    // Strong SHORT consensus: 5-40 range
    score = 40 - clamp(weightedShort * 2) * 35;
  } else if (
    longStrategies.length === 1 &&
    longStrategies[0].strength > 0.35 &&
    longStrategies[0].confidence > 0.4
  ) {
    // Single high-conviction LONG strategy
    score = 50 + clamp(weightedLong * 1.5) * 35;
  } else if (
    shortStrategies.length === 1 &&
    shortStrategies[0].strength > 0.35 &&
    shortStrategies[0].confidence > 0.4
  ) {
    // Single high-conviction SHORT strategy
    score = 45 - clamp(weightedShort * 1.5) * 30;
  } else {
    // Neutral — slight bias from weighted scores
    const netScore = weightedLong - weightedShort;
    score = 50 + clamp(netScore * 10, -10, 10);
  }

  return Math.round(score);
}

/**
 * Contextual wrapper around scoreMultiStrategy that adjusts for market-level signals.
 * - Breadth divergence: dampen bullish signals when breadth is oversold (10%)
 * - Breadth confirmation: boost bullish signals when breadth is overbought (3%)
 * - Extreme low breadth (<20%): dampen bullish up to 15%
 * - Pre-FOMC: compress score 15% toward neutral (50)
 */
export function scoreMultiStrategyWithContext(
  candles: {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[],
  context?: {
    breadthAbove50dPct?: number;
    breadthSignal?: string;
    fomcIsPreFOMC?: boolean;
  },
): number {
  const raw = scoreMultiStrategy(candles);
  if (!context) return raw;

  let adjusted = raw;

  // Breadth adjustments (only apply to bullish scores > 50)
  if (context.breadthAbove50dPct != null) {
    if (adjusted > 50) {
      if (context.breadthSignal === 'oversold') {
        // Divergence: market breadth weak but symbol bullish → dampen 10%
        adjusted = 50 + (adjusted - 50) * 0.9;
      } else if (context.breadthSignal === 'overbought') {
        // Confirmation: broad market strong → boost 3%
        adjusted = 50 + (adjusted - 50) * 1.03;
      }
      // Extreme low breadth: extra dampening
      if (context.breadthAbove50dPct < 20) {
        const dampFactor = 0.85 + (context.breadthAbove50dPct / 20) * 0.15; // 0.85-1.0
        adjusted = 50 + (adjusted - 50) * dampFactor;
      }
    }
  }

  // Pre-FOMC: compress toward neutral by 15%
  if (context.fomcIsPreFOMC) {
    adjusted = 50 + (adjusted - 50) * 0.85;
  }

  return Math.round(Math.max(0, Math.min(100, adjusted)));
}
