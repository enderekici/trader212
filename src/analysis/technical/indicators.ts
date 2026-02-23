import {
  ADL,
  ADX,
  ATR,
  AwesomeOscillator,
  abandonedbaby,
  BollingerBands,
  bearishengulfingpattern,
  bearishharami,
  bullishengulfingpattern,
  bullishharami,
  CCI,
  darkcloudcover,
  doji,
  dragonflydoji,
  EMA,
  eveningdojistar,
  eveningstar,
  ForceIndex,
  gravestonedoji,
  hammerpattern,
  hangingman,
  IchimokuCloud,
  MACD,
  MFI,
  morningdojistar,
  morningstar,
  OBV,
  PSAR,
  piercingline,
  ROC,
  RSI,
  SMA,
  Stochastic,
  shootingstar,
  threeblackcrows,
  threewhitesoldiers,
  tweezerbottom,
  tweezertop,
  VWAP,
  WilliamsR,
} from 'technicalindicators';
import type { OHLCVCandle } from '../../data/yahoo-finance.js';

// ─── RSI ─────────────────────────────────────────────────

export function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const result = RSI.calculate({ values: closes, period });
  return result.length > 0 ? result[result.length - 1] : null;
}

// ─── MACD ────────────────────────────────────────────────

export interface MACDResult {
  value: number;
  signal: number;
  histogram: number;
}

export function calcMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MACDResult | null {
  if (closes.length < slowPeriod + signalPeriod) return null;
  const result = MACD.calculate({
    values: closes,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const last = result[result.length - 1];
  if (!last || last.MACD == null || last.signal == null || last.histogram == null) return null;
  return { value: last.MACD, signal: last.signal, histogram: last.histogram };
}

// ─── SMA ─────────────────────────────────────────────────

export function calcSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const result = SMA.calculate({ values: closes, period });
  return result.length > 0 ? result[result.length - 1] : null;
}

// ─── EMA ─────────────────────────────────────────────────

export function calcEMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const result = EMA.calculate({ values: closes, period });
  return result.length > 0 ? result[result.length - 1] : null;
}

// ─── Bollinger Bands ─────────────────────────────────────

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
}

export function calcBollingerBands(
  closes: number[],
  period = 20,
  stdDev = 2,
): BollingerResult | null {
  if (closes.length < period) return null;
  const result = BollingerBands.calculate({ values: closes, period, stdDev });
  const last = result[result.length - 1];
  if (!last) return null;
  return { upper: last.upper, middle: last.middle, lower: last.lower };
}

// ─── ATR ─────────────────────────────────────────────────

export function calcATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  if (closes.length < period + 1) return null;
  const result = ATR.calculate({ high: highs, low: lows, close: closes, period });
  return result.length > 0 ? result[result.length - 1] : null;
}

// ─── ADX ─────────────────────────────────────────────────

export function calcADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  if (closes.length < period * 2) return null;
  const result = ADX.calculate({ high: highs, low: lows, close: closes, period });
  return result.length > 0 ? result[result.length - 1].adx : null;
}

// ─── Stochastic ──────────────────────────────────────────

export interface StochasticResult {
  k: number;
  d: number;
}

export function calcStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  dPeriod = 3,
): StochasticResult | null {
  if (closes.length < kPeriod + dPeriod) return null;
  const result = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: kPeriod,
    signalPeriod: dPeriod,
  });
  const last = result[result.length - 1];
  if (!last || last.k == null || last.d == null) return null;
  return { k: last.k, d: last.d };
}

// ─── Williams %R ─────────────────────────────────────────

export function calcWilliamsR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  if (closes.length < period) return null;
  const result = WilliamsR.calculate({ high: highs, low: lows, close: closes, period });
  return result.length > 0 ? result[result.length - 1] : null;
}

// ─── MFI ─────────────────────────────────────────────────

export function calcMFI(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  period = 14,
): number | null {
  if (closes.length < period + 1) return null;
  const result = MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period });
  return result.length > 0 ? result[result.length - 1] : null;
}

// ─── CCI ─────────────────────────────────────────────────

export function calcCCI(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 20,
): number | null {
  if (closes.length < period) return null;
  const result = CCI.calculate({ high: highs, low: lows, close: closes, period });
  return result.length > 0 ? result[result.length - 1] : null;
}

// ─── OBV ─────────────────────────────────────────────────

export function calcOBV(closes: number[], volumes: number[]): number | null {
  if (closes.length < 2) return null;
  const result = OBV.calculate({ close: closes, volume: volumes });
  return result.length > 0 ? result[result.length - 1] : null;
}

// ─── VWAP ────────────────────────────────────────────────

export function calcVWAP(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  intradayCandles?: OHLCVCandle[],
): number | null {
  // If intraday candles are provided and sufficient, use them for a proper session VWAP
  if (intradayCandles && intradayCandles.length >= 5) {
    const iHighs = intradayCandles.map((c) => c.high);
    const iLows = intradayCandles.map((c) => c.low);
    const iCloses = intradayCandles.map((c) => c.close);
    const iVolumes = intradayCandles.map((c) => c.volume);
    const result = VWAP.calculate({
      high: iHighs,
      low: iLows,
      close: iCloses,
      volume: iVolumes,
    });
    return result.length > 0 ? result[result.length - 1] : null;
  }

  if (closes.length < 1) return null;
  const result = VWAP.calculate({ high: highs, low: lows, close: closes, volume: volumes });
  return result.length > 0 ? result[result.length - 1] : null;
}

// ─── Parabolic SAR ───────────────────────────────────────

export function calcParabolicSAR(
  highs: number[],
  lows: number[],
  step = 0.02,
  max = 0.2,
): number | null {
  if (highs.length < 2) return null;
  const result = PSAR.calculate({ high: highs, low: lows, step, max });
  return result.length > 0 ? result[result.length - 1] : null;
}

// ─── ROC ─────────────────────────────────────────────────

export function calcROC(closes: number[], period = 12): number | null {
  if (closes.length < period + 1) return null;
  const result = ROC.calculate({ values: closes, period });
  return result.length > 0 ? result[result.length - 1] : null;
}

// ─── Force Index ─────────────────────────────────────────

export function calcForceIndex(closes: number[], volumes: number[], period = 13): number | null {
  if (closes.length < period + 1) return null;
  const result = ForceIndex.calculate({ close: closes, volume: volumes, period });
  return result.length > 0 ? result[result.length - 1] : null;
}

// ─── ADL ─────────────────────────────────────────────────

export function calcADL(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
): number | null {
  if (closes.length < 1) return null;
  const result = ADL.calculate({ high: highs, low: lows, close: closes, volume: volumes });
  return result.length > 0 ? result[result.length - 1] : null;
}

// ─── Awesome Oscillator ──────────────────────────────────

export function calcAwesomeOscillator(highs: number[], lows: number[]): number | null {
  if (highs.length < 34) return null;
  const result = AwesomeOscillator.calculate({
    high: highs,
    low: lows,
    fastPeriod: 5,
    slowPeriod: 34,
  });
  return result.length > 0 ? result[result.length - 1] : null;
}

// ─── Ichimoku Cloud ──────────────────────────────────────

export interface IchimokuResult {
  tenkanSen: number;
  kijunSen: number;
  senkouSpanA: number;
  senkouSpanB: number;
  chikouSpan: number;
}

export function calcIchimokuCloud(
  highs: number[],
  lows: number[],
  closes: number[],
): IchimokuResult | null {
  if (highs.length < 52) return null;
  const result = IchimokuCloud.calculate({
    high: highs,
    low: lows,
    conversionPeriod: 9,
    basePeriod: 26,
    spanPeriod: 52,
    displacement: 26,
  });
  const last = result[result.length - 1];
  if (!last) return null;
  return {
    tenkanSen: last.conversion,
    kijunSen: last.base,
    senkouSpanA: last.spanA,
    senkouSpanB: last.spanB,
    chikouSpan: closes[closes.length - 1],
  };
}

// ─── Support / Resistance ────────────────────────────────

export interface SupportResistance {
  support: number;
  resistance: number;
}

export function calcSupportResistance(
  highs: number[],
  lows: number[],
  lookback = 20,
): SupportResistance | null {
  if (highs.length < lookback) return null;

  const recentHighs = highs.slice(-lookback);
  const recentLows = lows.slice(-lookback);

  const resistance = Math.max(...recentHighs);
  const support = Math.min(...recentLows);

  return { support, resistance };
}

// ─── Volume Ratio ────────────────────────────────────────

export function calcVolumeRatio(volumes: number[], period = 20): number | null {
  if (volumes.length < period + 1) return null;
  const recentAvg = volumes.slice(-period).reduce((a, b) => a + b, 0) / period;
  const currentVol = volumes[volumes.length - 1];
  return recentAvg > 0 ? currentVol / recentAvg : null;
}

// ─── Performance Metrics ─────────────────────────────────

export function calcPerfMetrics(candles: OHLCVCandle[]): {
  perfWeek: number | null;
  perfMonth: number | null;
  perfQuarter: number | null;
  perfYear: number | null;
  relativeVolume: number | null;
} {
  const n = candles.length;
  const last = candles[n - 1];

  const pctChange = (from: OHLCVCandle): number => ((last.close - from.close) / from.close) * 100;

  const perfWeek = n >= 6 ? pctChange(candles[n - 6]) : null;
  const perfMonth = n >= 22 ? pctChange(candles[n - 22]) : null;
  const perfQuarter = n >= 66 ? pctChange(candles[n - 66]) : null;
  const perfYear = n >= 253 ? pctChange(candles[n - 253]) : null;

  // relativeVolume: today volume / avg of last 20 candle volumes
  const lookback = Math.min(20, n);
  const slice = candles.slice(n - lookback);
  const avgVol20 = lookback > 0 ? slice.reduce((s, c) => s + c.volume, 0) / lookback : 0;
  const relativeVolume = avgVol20 > 0 && n > 0 ? last.volume / avgVol20 : null;

  return { perfWeek, perfMonth, perfQuarter, perfYear, relativeVolume };
}

// ─── Keltner Channels ───────────────────────────────────────

export interface KeltnerResult {
  upper: number;
  middle: number;
  lower: number;
}

export function calcKeltnerChannels(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 20,
  atrPeriod = 14,
  multiplier = 2.0,
): KeltnerResult | null {
  const middle = calcEMA(closes, period);
  const atr = calcATR(highs, lows, closes, atrPeriod);
  if (middle == null || atr == null) return null;
  return {
    upper: middle + multiplier * atr,
    middle,
    lower: middle - multiplier * atr,
  };
}

// ─── Chaikin Money Flow ─────────────────────────────────────

export function calcCMF(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  period = 20,
): number | null {
  if (closes.length < period) return null;

  let mfvSum = 0;
  let volSum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const hl = highs[i] - lows[i];
    const mfm = hl > 0 ? (closes[i] - lows[i] - (highs[i] - closes[i])) / hl : 0;
    mfvSum += mfm * volumes[i];
    volSum += volumes[i];
  }
  return volSum > 0 ? mfvSum / volSum : 0;
}

// ─── Supertrend ─────────────────────────────────────────────

export interface SupertrendResult {
  line: number;
  direction: 1 | -1; // 1 = bullish (price above), -1 = bearish
}

export function calcSupertrend(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 10,
  multiplier = 3.0,
): SupertrendResult | null {
  const atr = calcATR(highs, lows, closes, period);
  if (atr == null || closes.length < period + 1) return null;

  // Compute over the last few bars to determine direction
  const len = closes.length;
  let upperBand = (highs[len - 1] + lows[len - 1]) / 2 + multiplier * atr;
  let lowerBand = (highs[len - 1] + lows[len - 1]) / 2 - multiplier * atr;
  let direction: 1 | -1 = closes[len - 1] > upperBand ? 1 : -1;

  // Walk back a few bars to stabilize direction
  const lookback = Math.min(20, len - period);
  for (let i = len - lookback; i < len; i++) {
    const mid = (highs[i] + lows[i]) / 2;
    const ub = mid + multiplier * atr;
    const lb = mid - multiplier * atr;

    if (direction === 1) {
      lowerBand = Math.max(lowerBand, lb);
      if (closes[i] < lowerBand) {
        direction = -1;
        upperBand = ub;
      }
    } else {
      upperBand = Math.min(upperBand, ub);
      if (closes[i] > upperBand) {
        direction = 1;
        lowerBand = lb;
      }
    }
  }

  return {
    line: direction === 1 ? lowerBand : upperBand,
    direction,
  };
}

// ─── TRIX ───────────────────────────────────────────────────

export interface TRIXResult {
  value: number;
  prev: number;
}

export function calcTRIX(closes: number[], period = 14): TRIXResult | null {
  // TRIX = 1-period % change of triple-smoothed EMA
  // Need enough data for 3 rounds of EMA + 1 extra value
  if (closes.length < period * 3 + 1) return null;

  // First EMA
  const ema1 = EMA.calculate({ values: closes, period });
  if (ema1.length < period + 1) return null;

  // Second EMA
  const ema2 = EMA.calculate({ values: ema1, period });
  if (ema2.length < 2) return null;

  // Third EMA
  const ema3 = EMA.calculate({ values: ema2, period });
  if (ema3.length < 2) return null;

  const curr = ema3[ema3.length - 1];
  const prev = ema3[ema3.length - 2];
  if (prev === 0) return null;

  return {
    value: ((curr - prev) / prev) * 100,
    prev: ema3.length >= 3 ? ((prev - ema3[ema3.length - 3]) / ema3[ema3.length - 3]) * 100 : 0,
  };
}

// ─── Elder Ray ──────────────────────────────────────────────

export interface ElderRayResult {
  bullPower: number;
  bearPower: number;
  prevBull: number;
  prevBear: number;
}

export function calcElderRay(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 13,
): ElderRayResult | null {
  if (closes.length < period + 1) return null;

  const emaValues = EMA.calculate({ values: closes, period });
  if (emaValues.length < 2) return null;

  const emaLast = emaValues[emaValues.length - 1];
  const emaPrev = emaValues[emaValues.length - 2];

  // Align EMA indices with OHLC
  const offset = closes.length - emaValues.length;
  const lastIdx = closes.length - 1;
  const prevIdx = lastIdx - 1;

  return {
    bullPower: highs[lastIdx] - emaLast,
    bearPower: lows[lastIdx] - emaLast,
    prevBull: prevIdx >= offset ? highs[prevIdx] - emaPrev : 0,
    prevBear: prevIdx >= offset ? lows[prevIdx] - emaPrev : 0,
  };
}

// ─── Market Structure ───────────────────────────────────────

/**
 * Market structure score based on higher-highs/higher-lows vs lower-highs/lower-lows.
 * Returns a value in [-1, 1]: positive = uptrend structure, negative = downtrend.
 */
export function calcMarketStructure(highs: number[], lows: number[], period = 20): number | null {
  if (highs.length < period) return null;

  const recentH = highs.slice(-period);
  const recentL = lows.slice(-period);

  let hhCount = 0;
  let llCount = 0;
  let lhCount = 0;
  let hlCount = 0;

  for (let i = 1; i < period; i++) {
    if (recentH[i] > recentH[i - 1]) hhCount++;
    else if (recentH[i] < recentH[i - 1]) lhCount++;

    if (recentL[i] > recentL[i - 1]) hlCount++;
    else if (recentL[i] < recentL[i - 1]) llCount++;
  }

  const total = period - 1;
  if (total === 0) return 0;

  const bullish = (hhCount + hlCount) / total;
  const bearish = (lhCount + llCount) / total;

  return Math.max(-1, Math.min(1, bullish - bearish));
}

// ─── Squeeze Detection ──────────────────────────────────────

export interface SqueezeResult {
  squeezing: boolean;
  justReleased: boolean;
}

/**
 * Detects Bollinger Band squeeze (BB inside KC) and release.
 * Squeezing = BB bands are inside Keltner Channels.
 * Just released = was squeezing on prior bar, not squeezing now.
 */
export function calcSqueezeDetect(
  highs: number[],
  lows: number[],
  closes: number[],
  bbPeriod = 20,
  bbMult = 2,
  kcPeriod = 20,
  kcAtrPeriod = 14,
  kcMult = 1.5,
): SqueezeResult | null {
  if (closes.length < Math.max(bbPeriod, kcPeriod, kcAtrPeriod) + 2) return null;

  // Current bar
  const bb = calcBollingerBands(closes, bbPeriod, bbMult);
  const kc = calcKeltnerChannels(highs, lows, closes, kcPeriod, kcAtrPeriod, kcMult);
  if (!bb || !kc) return null;

  const currentSqueeze = bb.lower > kc.lower && bb.upper < kc.upper;

  // Previous bar
  const prevCloses = closes.slice(0, -1);
  const prevHighs = highs.slice(0, -1);
  const prevLows = lows.slice(0, -1);
  const prevBB = calcBollingerBands(prevCloses, bbPeriod, bbMult);
  const prevKC = calcKeltnerChannels(
    prevHighs,
    prevLows,
    prevCloses,
    kcPeriod,
    kcAtrPeriod,
    kcMult,
  );

  let prevSqueeze = false;
  if (prevBB && prevKC) {
    prevSqueeze = prevBB.lower > prevKC.lower && prevBB.upper < prevKC.upper;
  }

  return {
    squeezing: currentSqueeze,
    justReleased: prevSqueeze && !currentSqueeze,
  };
}

// ─── ADL Series ─────────────────────────────────────────────

/**
 * Returns the full Accumulation/Distribution Line series.
 * Used for computing ADL vs its SMA for trend divergence.
 */
export function calcADLSeries(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
): number[] {
  const result = ADL.calculate({ high: highs, low: lows, close: closes, volume: volumes });
  return result;
}

// ─── Compute All Indicators ───────────────────────────────

export interface IndicatorSet {
  vwap: number | null;
  perfWeek: number | null;
  perfMonth: number | null;
  perfQuarter: number | null;
  perfYear: number | null;
  relativeVolume: number | null;
}

export function computeAllIndicators(
  candles: OHLCVCandle[],
  intradayCandles?: OHLCVCandle[],
): IndicatorSet {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const vwap = calcVWAP(highs, lows, closes, volumes, intradayCandles);
  const perf =
    candles.length > 0
      ? calcPerfMetrics(candles)
      : {
          perfWeek: null,
          perfMonth: null,
          perfQuarter: null,
          perfYear: null,
          relativeVolume: null,
        };

  return {
    vwap,
    ...perf,
  };
}

// ─── Candlestick Pattern Detection ──────────────────────────────────

export interface CandlestickPatterns {
  bullish: string[];
  bearish: string[];
  neutral: string[];
}

/**
 * Detect candlestick patterns on the last few candles using technicalindicators
 * library functions plus manual NR7/InsideDay/OutsideDay detection.
 * Each library function takes {open, high, low, close} arrays and returns boolean.
 * We pass the last N candles needed for each pattern (most need 1-5).
 */
export function detectCandlestickPatterns(
  opens: number[],
  highs: number[],
  lows: number[],
  closes: number[],
): CandlestickPatterns {
  const result: CandlestickPatterns = { bullish: [], bearish: [], neutral: [] };

  if (opens.length < 5) return result;

  // Helper to slice last N candles for pattern detection
  const last = (n: number) => ({
    open: opens.slice(-n),
    high: highs.slice(-n),
    low: lows.slice(-n),
    close: closes.slice(-n),
  });

  // ── Bullish patterns ──
  if (bullishengulfingpattern(last(2))) result.bullish.push('Bullish Engulfing');
  if (hammerpattern(last(5))) result.bullish.push('Hammer');
  if (morningstar(last(3))) result.bullish.push('Morning Star');
  if (morningdojistar(last(3))) result.bullish.push('Morning Doji Star');
  if (threewhitesoldiers(last(3))) result.bullish.push('Three White Soldiers');
  if (bullishharami(last(2))) result.bullish.push('Bullish Harami');
  if (tweezerbottom(last(5))) result.bullish.push('Tweezer Bottom');
  if (piercingline(last(2))) result.bullish.push('Piercing Line');
  if (abandonedbaby(last(3))) result.bullish.push('Abandoned Baby');

  // ── Bearish patterns ──
  if (bearishengulfingpattern(last(2))) result.bearish.push('Bearish Engulfing');
  if (shootingstar(last(5))) result.bearish.push('Shooting Star');
  if (eveningstar(last(3))) result.bearish.push('Evening Star');
  if (eveningdojistar(last(3))) result.bearish.push('Evening Doji Star');
  if (threeblackcrows(last(3))) result.bearish.push('Three Black Crows');
  if (bearishharami(last(2))) result.bearish.push('Bearish Harami');
  if (tweezertop(last(5))) result.bearish.push('Tweezer Top');
  if (darkcloudcover(last(2))) result.bearish.push('Dark Cloud Cover');
  if (hangingman(last(5))) result.bearish.push('Hanging Man');

  // ── Neutral / indecision patterns ──
  if (doji(last(1))) result.neutral.push('Doji');
  if (dragonflydoji(last(1))) result.neutral.push('Dragonfly Doji');
  if (gravestonedoji(last(1))) result.neutral.push('Gravestone Doji');

  // ── Manual patterns (simple math) ──

  // NR7: today's range is the smallest of the last 7 bars
  if (highs.length >= 7) {
    const ranges = [];
    for (let i = highs.length - 7; i < highs.length; i++) {
      ranges.push(highs[i] - lows[i]);
    }
    const todayRange = ranges[ranges.length - 1];
    const isNR7 = ranges.slice(0, -1).every((r) => todayRange <= r);
    if (isNR7) result.neutral.push('NR7');
  }

  // Inside Day: today's range is within yesterday's range
  if (highs.length >= 2) {
    const todayHigh = highs[highs.length - 1];
    const todayLow = lows[lows.length - 1];
    const yesterdayHigh = highs[highs.length - 2];
    const yesterdayLow = lows[lows.length - 2];
    if (todayHigh < yesterdayHigh && todayLow > yesterdayLow) {
      result.neutral.push('Inside Day');
    }
  }

  // Outside Day: today's range engulfs yesterday's range
  if (highs.length >= 2) {
    const todayHigh = highs[highs.length - 1];
    const todayLow = lows[lows.length - 1];
    const yesterdayHigh = highs[highs.length - 2];
    const yesterdayLow = lows[lows.length - 2];
    if (todayHigh > yesterdayHigh && todayLow < yesterdayLow) {
      result.neutral.push('Outside Day');
    }
  }

  return result;
}
