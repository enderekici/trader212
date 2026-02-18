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
