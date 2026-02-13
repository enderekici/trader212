import { configManager } from '../../config/manager.js';
import type { OHLCVCandle } from '../../data/yahoo-finance.js';
import { createLogger } from '../../utils/logger.js';
import {
  type BollingerResult,
  type MACDResult,
  type StochasticResult,
  type SupportResistance,
  calcADX,
  calcATR,
  calcBollingerBands,
  calcCCI,
  calcEMA,
  calcForceIndex,
  calcMACD,
  calcMFI,
  calcOBV,
  calcParabolicSAR,
  calcROC,
  calcRSI,
  calcSMA,
  calcStochastic,
  calcSupportResistance,
  calcVWAP,
  calcVolumeRatio,
  calcWilliamsR,
} from './indicators.js';

const log = createLogger('technical-scorer');

export interface TechnicalAnalysis {
  rsi: number | null;
  macd: MACDResult | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema12: number | null;
  ema26: number | null;
  bollinger: BollingerResult | null;
  atr: number | null;
  adx: number | null;
  stochastic: StochasticResult | null;
  williamsR: number | null;
  mfi: number | null;
  cci: number | null;
  obv: number | null;
  vwap: number | null;
  parabolicSar: number | null;
  roc: number | null;
  forceIndex: number | null;
  volumeRatio: number | null;
  supportResistance: SupportResistance | null;
  score: number;
}

export function scoreTechnicals(candles: OHLCVCandle[]): number {
  const analysis = analyzeTechnicals(candles);
  return analysis.score;
}

export function analyzeTechnicals(candles: OHLCVCandle[]): TechnicalAnalysis {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  // Read config periods
  const rsiPeriod = configManager.get<number>('analysis.rsi.period');
  const macdFast = configManager.get<number>('analysis.macd.fast');
  const macdSlow = configManager.get<number>('analysis.macd.slow');
  const macdSignalPeriod = configManager.get<number>('analysis.macd.signal');
  const bbPeriod = configManager.get<number>('analysis.bb.period');
  const bbStdDev = configManager.get<number>('analysis.bb.stdDev');
  const atrPeriod = configManager.get<number>('analysis.atr.period');
  const adxPeriod = configManager.get<number>('analysis.adx.period');
  const stochK = configManager.get<number>('analysis.stochastic.kPeriod');
  const stochD = configManager.get<number>('analysis.stochastic.dPeriod');
  const cciPeriod = configManager.get<number>('analysis.cci.period');
  const mfiPeriod = configManager.get<number>('analysis.mfi.period');
  const rocPeriod = configManager.get<number>('analysis.roc.period');
  const srLookback = configManager.get<number>('analysis.supportResistance.lookback');

  // Compute all indicators
  const rsi = calcRSI(closes, rsiPeriod);
  const macd = calcMACD(closes, macdFast, macdSlow, macdSignalPeriod);
  const sma20 = calcSMA(closes, 20);
  const sma50 = calcSMA(closes, 50);
  const sma200 = calcSMA(closes, 200);
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const bollinger = calcBollingerBands(closes, bbPeriod, bbStdDev);
  const atr = calcATR(highs, lows, closes, atrPeriod);
  const adx = calcADX(highs, lows, closes, adxPeriod);
  const stochastic = calcStochastic(highs, lows, closes, stochK, stochD);
  const williamsR = calcWilliamsR(highs, lows, closes, 14);
  const mfi = calcMFI(highs, lows, closes, volumes, mfiPeriod);
  const cci = calcCCI(highs, lows, closes, cciPeriod);
  const obv = calcOBV(closes, volumes);
  const vwap = calcVWAP(highs, lows, closes, volumes);
  const parabolicSar = calcParabolicSAR(highs, lows);
  const roc = calcROC(closes, rocPeriod);
  const forceIndex = calcForceIndex(closes, volumes);
  const volumeRatio = calcVolumeRatio(volumes);
  const supportResistance = calcSupportResistance(highs, lows, srLookback);

  const price = closes[closes.length - 1];
  const score = computeScore(price, {
    rsi,
    macd,
    sma20,
    sma50,
    sma200,
    ema12,
    ema26,
    bollinger,
    adx,
    stochastic,
    williamsR,
    mfi,
    cci,
    parabolicSar,
    roc,
    volumeRatio,
    supportResistance,
  });

  log.debug({ score, rsi, macdHist: macd?.histogram }, 'Technical analysis complete');

  return {
    rsi,
    macd,
    sma20,
    sma50,
    sma200,
    ema12,
    ema26,
    bollinger,
    atr,
    adx,
    stochastic,
    williamsR,
    mfi,
    cci,
    obv,
    vwap,
    parabolicSar,
    roc,
    forceIndex,
    volumeRatio,
    supportResistance,
    score,
  };
}

interface ScoreInputs {
  rsi: number | null;
  macd: MACDResult | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema12: number | null;
  ema26: number | null;
  bollinger: BollingerResult | null;
  adx: number | null;
  stochastic: StochasticResult | null;
  williamsR: number | null;
  mfi: number | null;
  cci: number | null;
  parabolicSar: number | null;
  roc: number | null;
  volumeRatio: number | null;
  supportResistance: SupportResistance | null;
}

function computeScore(price: number, inputs: ScoreInputs): number {
  let totalWeight = 0;
  let weightedSum = 0;

  const add = (signal: number, weight: number) => {
    totalWeight += weight;
    weightedSum += signal * weight;
  };

  // RSI (weight 15) — oversold=bullish, overbought=bearish
  if (inputs.rsi != null) {
    let rsiSignal: number;
    if (inputs.rsi < 30) rsiSignal = 80 + (30 - inputs.rsi);
    else if (inputs.rsi < 40) rsiSignal = 65;
    else if (inputs.rsi > 70) rsiSignal = 20 - (inputs.rsi - 70);
    else if (inputs.rsi > 60) rsiSignal = 35;
    else rsiSignal = 50;
    add(Math.max(0, Math.min(100, rsiSignal)), 15);
  }

  // MACD (weight 15) — histogram positive=bullish
  if (inputs.macd != null) {
    const hist = inputs.macd.histogram;
    const macdSignal = hist > 0 ? Math.min(50 + hist * 10, 90) : Math.max(50 + hist * 10, 10);
    add(macdSignal, 15);
  }

  // Moving average trend (weight 15)
  if (inputs.sma20 != null && inputs.sma50 != null && inputs.sma200 != null) {
    let maSignal = 50;
    if (price > inputs.sma20 && price > inputs.sma50 && price > inputs.sma200) maSignal = 85;
    else if (price > inputs.sma20 && price > inputs.sma50) maSignal = 70;
    else if (price > inputs.sma20) maSignal = 60;
    else if (price < inputs.sma20 && price < inputs.sma50 && price < inputs.sma200) maSignal = 15;
    else if (price < inputs.sma20 && price < inputs.sma50) maSignal = 30;
    else if (price < inputs.sma20) maSignal = 40;

    // Golden/death cross bonus
    if (inputs.sma50 > inputs.sma200) maSignal = Math.min(maSignal + 5, 100);
    else maSignal = Math.max(maSignal - 5, 0);

    add(maSignal, 15);
  }

  // EMA crossover (weight 5)
  if (inputs.ema12 != null && inputs.ema26 != null) {
    add(inputs.ema12 > inputs.ema26 ? 70 : 30, 5);
  }

  // Bollinger Bands (weight 10)
  if (inputs.bollinger != null) {
    const bbRange = inputs.bollinger.upper - inputs.bollinger.lower;
    if (bbRange > 0) {
      const position = (price - inputs.bollinger.lower) / bbRange;
      // Near lower band = bullish, near upper = bearish (mean-reversion)
      const bbSignal = Math.max(0, Math.min(100, (1 - position) * 100));
      add(bbSignal, 10);
    }
  }

  // ADX (weight 5) — strong trend amplifier
  if (inputs.adx != null) {
    // ADX > 25 means strong trend; we reward strong trends slightly
    const adxSignal = inputs.adx > 25 ? 65 : inputs.adx > 20 ? 55 : 45;
    add(adxSignal, 5);
  }

  // Stochastic (weight 10)
  if (inputs.stochastic != null) {
    let stochSignal: number;
    if (inputs.stochastic.k < 20) stochSignal = 80;
    else if (inputs.stochastic.k > 80) stochSignal = 20;
    else stochSignal = 50;
    // K crossing above D = bullish
    if (inputs.stochastic.k > inputs.stochastic.d) stochSignal += 10;
    else stochSignal -= 10;
    add(Math.max(0, Math.min(100, stochSignal)), 10);
  }

  // Williams %R (weight 5)
  if (inputs.williamsR != null) {
    // -80 to -100 = oversold=bullish, 0 to -20 = overbought=bearish
    const wrSignal = inputs.williamsR < -80 ? 75 : inputs.williamsR > -20 ? 25 : 50;
    add(wrSignal, 5);
  }

  // MFI (weight 5)
  if (inputs.mfi != null) {
    let mfiSignal: number;
    if (inputs.mfi < 20) mfiSignal = 80;
    else if (inputs.mfi > 80) mfiSignal = 20;
    else mfiSignal = 50;
    add(mfiSignal, 5);
  }

  // CCI (weight 5)
  if (inputs.cci != null) {
    const cciSignal = inputs.cci < -100 ? 75 : inputs.cci > 100 ? 25 : 50;
    add(cciSignal, 5);
  }

  // Parabolic SAR (weight 5)
  if (inputs.parabolicSar != null) {
    add(price > inputs.parabolicSar ? 70 : 30, 5);
  }

  // ROC (weight 3)
  if (inputs.roc != null) {
    const rocSignal =
      inputs.roc > 0 ? Math.min(50 + inputs.roc * 5, 85) : Math.max(50 + inputs.roc * 5, 15);
    add(rocSignal, 3);
  }

  // Volume ratio (weight 2)
  if (inputs.volumeRatio != null) {
    // High volume = conviction signal (neutral direction)
    const volSignal = inputs.volumeRatio > 1.5 ? 60 : inputs.volumeRatio < 0.5 ? 40 : 50;
    add(volSignal, 2);
  }

  if (totalWeight === 0) return 50;
  return Math.round(weightedSum / totalWeight);
}
