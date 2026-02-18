import { configManager } from '../../config/manager.js';
import type { OHLCVCandle } from '../../data/yahoo-finance.js';
import { createLogger } from '../../utils/logger.js';
import {
  type BollingerResult,
  type CandlestickPatterns,
  type IchimokuResult,
  calcADL,
  calcADX,
  calcATR,
  calcAwesomeOscillator,
  calcBollingerBands,
  calcCCI,
  calcEMA,
  calcForceIndex,
  calcIchimokuCloud,
  calcMACD,
  calcMFI,
  calcOBV,
  calcParabolicSAR,
  calcPerfMetrics,
  calcROC,
  calcRSI,
  calcSMA,
  calcStochastic,
  calcSupportResistance,
  calcVolumeRatio,
  calcVWAP,
  calcWilliamsR,
  detectCandlestickPatterns,
  type MACDResult,
  type StochasticResult,
  type SupportResistance,
} from './indicators.js';

const log = createLogger('technical-scorer');

const DEFAULT_TECHNICAL_WEIGHTS: Record<string, number> = {
  rsi: 15,
  macd: 15,
  movingAverage: 15,
  emaCross: 5,
  bollinger: 10,
  adx: 5,
  stochastic: 10,
  williamsR: 5,
  mfi: 5,
  cci: 5,
  parabolicSar: 5,
  roc: 3,
  volumeRatio: 2,
  candlestick: 8,
  ichimoku: 8,
  awesomeOscillator: 4,
};

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
  perfWeek: number | null;
  perfMonth: number | null;
  perfQuarter: number | null;
  perfYear: number | null;
  supportResistance: SupportResistance | null;
  candlestickPatterns: CandlestickPatterns;
  ichimoku: IchimokuResult | null;
  adl: number | null;
  awesomeOscillator: number | null;
  score: number;
}

export function scoreTechnicals(candles: OHLCVCandle[]): number {
  const analysis = analyzeTechnicals(candles);
  return analysis.score;
}

export function analyzeTechnicals(candles: OHLCVCandle[]): TechnicalAnalysis {
  const opens = candles.map((c) => c.open);
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
  const ichimoku = calcIchimokuCloud(highs, lows, closes);
  const adl = calcADL(highs, lows, closes, volumes);
  const awesomeOscillator = calcAwesomeOscillator(highs, lows);
  const { perfWeek, perfMonth, perfQuarter, perfYear } = calcPerfMetrics(candles);
  const supportResistance = calcSupportResistance(highs, lows, srLookback);
  const candlestickPatterns = detectCandlestickPatterns(opens, highs, lows, closes);

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
    candlestickPatterns,
    ichimoku,
    adl,
    awesomeOscillator,
  });

  log.debug(
    { score, rsi, macdHist: macd?.histogram, candlestickPatterns },
    'Technical analysis complete',
  );

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
    perfWeek,
    perfMonth,
    perfQuarter,
    perfYear,
    supportResistance,
    candlestickPatterns,
    ichimoku,
    adl,
    awesomeOscillator,
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
  candlestickPatterns: CandlestickPatterns;
  ichimoku: IchimokuResult | null;
  adl: number | null;
  awesomeOscillator: number | null;
}

function computeScore(price: number, inputs: ScoreInputs): number {
  let totalWeight = 0;
  let weightedSum = 0;

  // Merge config weights over defaults
  let configWeights: Record<string, number> = {};
  try {
    configWeights = configManager.get<Record<string, number>>('scoring.technical.weights');
  } catch {
    /* use defaults */
  }
  const weights = { ...DEFAULT_TECHNICAL_WEIGHTS, ...configWeights };

  const add = (signal: number, weight: number) => {
    totalWeight += weight;
    weightedSum += signal * weight;
  };

  // RSI — oversold=bullish, overbought=bearish
  if (inputs.rsi != null) {
    let rsiSignal: number;
    if (inputs.rsi < 30) rsiSignal = 80 + (30 - inputs.rsi);
    else if (inputs.rsi < 40) rsiSignal = 65;
    else if (inputs.rsi > 70) rsiSignal = 20 - (inputs.rsi - 70);
    else if (inputs.rsi > 60) rsiSignal = 35;
    else rsiSignal = 50;
    add(Math.max(0, Math.min(100, rsiSignal)), weights.rsi);
  }

  // MACD — histogram positive=bullish
  if (inputs.macd != null) {
    const hist = inputs.macd.histogram;
    const macdSignal = hist > 0 ? Math.min(50 + hist * 10, 90) : Math.max(50 + hist * 10, 10);
    add(macdSignal, weights.macd);
  }

  // Moving average trend
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

    add(maSignal, weights.movingAverage);
  }

  // EMA crossover
  if (inputs.ema12 != null && inputs.ema26 != null) {
    add(inputs.ema12 > inputs.ema26 ? 70 : 30, weights.emaCross);
  }

  // Bollinger Bands
  if (inputs.bollinger != null) {
    const bbRange = inputs.bollinger.upper - inputs.bollinger.lower;
    if (bbRange > 0) {
      const position = (price - inputs.bollinger.lower) / bbRange;
      // Near lower band = bullish, near upper = bearish (mean-reversion)
      const bbSignal = Math.max(0, Math.min(100, (1 - position) * 100));
      add(bbSignal, weights.bollinger);
    }
  }

  // ADX — strong trend amplifier
  if (inputs.adx != null) {
    // ADX > 25 means strong trend; we reward strong trends slightly
    const adxSignal = inputs.adx > 25 ? 65 : inputs.adx > 20 ? 55 : 45;
    add(adxSignal, weights.adx);
  }

  // Stochastic
  if (inputs.stochastic != null) {
    let stochSignal: number;
    if (inputs.stochastic.k < 20) stochSignal = 80;
    else if (inputs.stochastic.k > 80) stochSignal = 20;
    else stochSignal = 50;
    // K crossing above D = bullish
    if (inputs.stochastic.k > inputs.stochastic.d) stochSignal += 10;
    else stochSignal -= 10;
    add(Math.max(0, Math.min(100, stochSignal)), weights.stochastic);
  }

  // Williams %R
  if (inputs.williamsR != null) {
    // -80 to -100 = oversold=bullish, 0 to -20 = overbought=bearish
    const wrSignal = inputs.williamsR < -80 ? 75 : inputs.williamsR > -20 ? 25 : 50;
    add(wrSignal, weights.williamsR);
  }

  // MFI
  if (inputs.mfi != null) {
    let mfiSignal: number;
    if (inputs.mfi < 20) mfiSignal = 80;
    else if (inputs.mfi > 80) mfiSignal = 20;
    else mfiSignal = 50;
    add(mfiSignal, weights.mfi);
  }

  // CCI
  if (inputs.cci != null) {
    const cciSignal = inputs.cci < -100 ? 75 : inputs.cci > 100 ? 25 : 50;
    add(cciSignal, weights.cci);
  }

  // Parabolic SAR
  if (inputs.parabolicSar != null) {
    add(price > inputs.parabolicSar ? 70 : 30, weights.parabolicSar);
  }

  // ROC
  if (inputs.roc != null) {
    const rocSignal =
      inputs.roc > 0 ? Math.min(50 + inputs.roc * 5, 85) : Math.max(50 + inputs.roc * 5, 15);
    add(rocSignal, weights.roc);
  }

  // Volume ratio
  if (inputs.volumeRatio != null) {
    // High volume = conviction signal (neutral direction)
    const volSignal = inputs.volumeRatio > 1.5 ? 60 : inputs.volumeRatio < 0.5 ? 40 : 50;
    add(volSignal, weights.volumeRatio);
  }

  // Candlestick patterns
  {
    const cp = inputs.candlestickPatterns;
    const bullCount = cp.bullish.length;
    const bearCount = cp.bearish.length;
    const netBull = bullCount - bearCount;
    if (bullCount > 0 || bearCount > 0) {
      let cpSignal: number;
      if (netBull > 0) {
        // Net bullish: 70 base + 5 per extra bullish pattern, capped at 85
        cpSignal = Math.min(70 + (netBull - 1) * 5, 85);
      } else if (netBull < 0) {
        // Net bearish: 30 base - 5 per extra bearish pattern, floored at 15
        cpSignal = Math.max(30 + (netBull + 1) * 5, 15);
      } else {
        // Equal bullish and bearish = mixed
        cpSignal = 50;
      }
      add(cpSignal, weights.candlestick);
    }
  }

  // Ichimoku Cloud
  if (inputs.ichimoku != null) {
    const { tenkanSen, kijunSen, senkouSpanA, senkouSpanB } = inputs.ichimoku;
    const cloudTop = Math.max(senkouSpanA, senkouSpanB);
    const cloudBottom = Math.min(senkouSpanA, senkouSpanB);
    let ichimokuSignal = 50;
    if (price > cloudTop) {
      // Price above cloud = strong bullish
      ichimokuSignal = 80;
    } else if (price < cloudBottom) {
      // Price below cloud = strong bearish
      ichimokuSignal = 20;
    } else {
      // Price inside cloud = neutral/uncertain
      ichimokuSignal = 50;
    }
    // Tenkan/Kijun cross bonus
    if (tenkanSen > kijunSen) ichimokuSignal = Math.min(ichimokuSignal + 5, 100);
    else ichimokuSignal = Math.max(ichimokuSignal - 5, 0);
    add(ichimokuSignal, weights.ichimoku);
  }

  // Awesome Oscillator — positive = bullish momentum, negative = bearish
  if (inputs.awesomeOscillator != null) {
    const ao = inputs.awesomeOscillator;
    const aoSignal = ao > 0 ? Math.min(50 + ao * 5, 80) : Math.max(50 + ao * 5, 20);
    add(aoSignal, weights.awesomeOscillator);
  }

  if (totalWeight === 0) return 50;
  return Math.round(weightedSum / totalWeight);
}
