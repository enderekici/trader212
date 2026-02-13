import {
  ADL,
  ADX,
  ATR,
  AwesomeOscillator,
  BollingerBands,
  CCI,
  EMA,
  ForceIndex,
  IchimokuCloud,
  MACD,
  MFI,
  OBV,
  PSAR,
  ROC,
  RSI,
  SMA,
  Stochastic,
  VWAP,
  WilliamsR,
} from 'technicalindicators';

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
): number | null {
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
