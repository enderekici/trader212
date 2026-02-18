import { describe, expect, it } from 'vitest';
import {
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
  calcVWAP,
  calcVolumeRatio,
  calcWilliamsR,
  computeAllIndicators,
} from '../../src/analysis/technical/indicators.js';
import type { OHLCVCandle } from '../../src/data/yahoo-finance.js';

// ---------------------------------------------------------------------------
// Helpers to generate realistic OHLCV data
// ---------------------------------------------------------------------------

/** Generate a synthetic price series of `n` candles with a starting price and
 *  small random walks. Uses a deterministic seed-like approach for repeatable tests. */
function generatePriceSeries(n: number, startPrice = 100): {
  closes: number[];
  highs: number[];
  lows: number[];
  opens: number[];
  volumes: number[];
} {
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const opens: number[] = [];
  const volumes: number[] = [];

  let price = startPrice;
  for (let i = 0; i < n; i++) {
    // Deterministic-ish oscillation
    const change = Math.sin(i * 0.3) * 2 + Math.cos(i * 0.17) * 1.5;
    price = Math.max(1, price + change);
    const open = price - change * 0.3;
    const high = Math.max(price, open) + Math.abs(change) * 0.5 + 0.5;
    const low = Math.min(price, open) - Math.abs(change) * 0.5 - 0.5;
    const volume = 1_000_000 + Math.sin(i * 0.5) * 500_000;

    opens.push(+open.toFixed(2));
    closes.push(+price.toFixed(2));
    highs.push(+high.toFixed(2));
    lows.push(+low.toFixed(2));
    volumes.push(Math.round(volume));
  }

  return { closes, highs, lows, opens, volumes };
}

// A large dataset for tests that need 200+ points
const large = generatePriceSeries(250);
// A small dataset for boundary / insufficient-data tests
const tiny = generatePriceSeries(5, 50);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Technical Indicators', () => {
  // ── RSI ──────────────────────────────────────────────────────────────────

  describe('calcRSI', () => {
    it('returns null when data is insufficient (< period + 1)', () => {
      expect(calcRSI(tiny.closes, 14)).toBeNull();
      expect(calcRSI([], 14)).toBeNull();
      expect(calcRSI([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], 14)).toBeNull();
    });

    it('returns a number between 0 and 100 for sufficient data', () => {
      const rsi = calcRSI(large.closes);
      expect(rsi).not.toBeNull();
      expect(rsi).toBeGreaterThanOrEqual(0);
      expect(rsi).toBeLessThanOrEqual(100);
    });

    it('accepts custom period', () => {
      const rsi = calcRSI(large.closes, 7);
      expect(rsi).not.toBeNull();
      expect(typeof rsi).toBe('number');
    });

    it('uses default period of 14', () => {
      // With exactly 15 data points (period + 1 = 15)
      const data = large.closes.slice(0, 16);
      const rsi = calcRSI(data);
      expect(rsi).not.toBeNull();
    });
  });

  // ── MACD ─────────────────────────────────────────────────────────────────

  describe('calcMACD', () => {
    it('returns null when data is insufficient (< slowPeriod + signalPeriod)', () => {
      expect(calcMACD(tiny.closes)).toBeNull();
      expect(calcMACD([])).toBeNull();
      // need at least 26 + 9 = 35
      expect(calcMACD(large.closes.slice(0, 34))).toBeNull();
    });

    it('returns MACDResult with value, signal, histogram for sufficient data', () => {
      const macd = calcMACD(large.closes);
      expect(macd).not.toBeNull();
      expect(macd).toHaveProperty('value');
      expect(macd).toHaveProperty('signal');
      expect(macd).toHaveProperty('histogram');
      expect(typeof macd!.value).toBe('number');
      expect(typeof macd!.signal).toBe('number');
      expect(typeof macd!.histogram).toBe('number');
    });

    it('accepts custom fast/slow/signal periods', () => {
      const macd = calcMACD(large.closes, 8, 21, 5);
      expect(macd).not.toBeNull();
    });
  });

  // ── SMA ──────────────────────────────────────────────────────────────────

  describe('calcSMA', () => {
    it('returns null when data is insufficient', () => {
      expect(calcSMA([], 20)).toBeNull();
      expect(calcSMA(tiny.closes, 20)).toBeNull();
    });

    it('returns a number for sufficient data', () => {
      const sma = calcSMA(large.closes, 20);
      expect(sma).not.toBeNull();
      expect(typeof sma).toBe('number');
    });

    it('SMA of constant values equals that constant', () => {
      const constant = Array(50).fill(42);
      expect(calcSMA(constant, 20)).toBeCloseTo(42, 5);
    });

    it('works with period 200', () => {
      const sma200 = calcSMA(large.closes, 200);
      expect(sma200).not.toBeNull();
    });
  });

  // ── EMA ──────────────────────────────────────────────────────────────────

  describe('calcEMA', () => {
    it('returns null when data is insufficient', () => {
      expect(calcEMA([], 12)).toBeNull();
      expect(calcEMA(tiny.closes, 12)).toBeNull();
    });

    it('returns a number for sufficient data', () => {
      const ema = calcEMA(large.closes, 12);
      expect(ema).not.toBeNull();
      expect(typeof ema).toBe('number');
    });

    it('EMA of constant values equals that constant', () => {
      const constant = Array(50).fill(55);
      expect(calcEMA(constant, 12)).toBeCloseTo(55, 5);
    });
  });

  // ── Bollinger Bands ──────────────────────────────────────────────────────

  describe('calcBollingerBands', () => {
    it('returns null when data is insufficient', () => {
      expect(calcBollingerBands(tiny.closes)).toBeNull();
      expect(calcBollingerBands([], 20)).toBeNull();
    });

    it('returns upper, middle, lower for sufficient data', () => {
      const bb = calcBollingerBands(large.closes);
      expect(bb).not.toBeNull();
      expect(bb).toHaveProperty('upper');
      expect(bb).toHaveProperty('middle');
      expect(bb).toHaveProperty('lower');
      expect(bb!.upper).toBeGreaterThan(bb!.middle);
      expect(bb!.middle).toBeGreaterThan(bb!.lower);
    });

    it('accepts custom period and stdDev', () => {
      const bb = calcBollingerBands(large.closes, 10, 1);
      expect(bb).not.toBeNull();
    });

    it('bands collapse for constant data', () => {
      const constant = Array(30).fill(100);
      const bb = calcBollingerBands(constant, 20, 2);
      expect(bb).not.toBeNull();
      // upper == middle == lower when stddev is 0
      expect(bb!.upper).toBeCloseTo(bb!.middle, 5);
      expect(bb!.lower).toBeCloseTo(bb!.middle, 5);
    });
  });

  // ── ATR ──────────────────────────────────────────────────────────────────

  describe('calcATR', () => {
    it('returns null when data is insufficient', () => {
      expect(calcATR(tiny.highs, tiny.lows, tiny.closes, 14)).toBeNull();
      expect(calcATR([], [], [], 14)).toBeNull();
    });

    it('returns a positive number for sufficient data', () => {
      const atr = calcATR(large.highs, large.lows, large.closes);
      expect(atr).not.toBeNull();
      expect(atr).toBeGreaterThan(0);
    });

    it('accepts custom period', () => {
      const atr = calcATR(large.highs, large.lows, large.closes, 7);
      expect(atr).not.toBeNull();
    });
  });

  // ── ADX ──────────────────────────────────────────────────────────────────

  describe('calcADX', () => {
    it('returns null when data is insufficient (< period * 2)', () => {
      expect(calcADX(tiny.highs, tiny.lows, tiny.closes, 14)).toBeNull();
      expect(calcADX([], [], [], 14)).toBeNull();
      // 14 * 2 = 28, so 27 data points is not enough
      const short = generatePriceSeries(27);
      expect(calcADX(short.highs, short.lows, short.closes, 14)).toBeNull();
    });

    it('returns a number for sufficient data', () => {
      const adx = calcADX(large.highs, large.lows, large.closes);
      expect(adx).not.toBeNull();
      expect(typeof adx).toBe('number');
    });
  });

  // ── Stochastic ───────────────────────────────────────────────────────────

  describe('calcStochastic', () => {
    it('returns null when data is insufficient', () => {
      expect(calcStochastic(tiny.highs, tiny.lows, tiny.closes)).toBeNull();
      expect(calcStochastic([], [], [])).toBeNull();
    });

    it('returns k and d values for sufficient data', () => {
      const stoch = calcStochastic(large.highs, large.lows, large.closes);
      expect(stoch).not.toBeNull();
      expect(stoch).toHaveProperty('k');
      expect(stoch).toHaveProperty('d');
      expect(stoch!.k).toBeGreaterThanOrEqual(0);
      expect(stoch!.k).toBeLessThanOrEqual(100);
    });

    it('accepts custom kPeriod and dPeriod', () => {
      const stoch = calcStochastic(large.highs, large.lows, large.closes, 5, 3);
      expect(stoch).not.toBeNull();
    });
  });

  // ── Williams %R ──────────────────────────────────────────────────────────

  describe('calcWilliamsR', () => {
    it('returns null when data is insufficient', () => {
      expect(calcWilliamsR(tiny.highs, tiny.lows, tiny.closes, 14)).toBeNull();
      expect(calcWilliamsR([], [], [], 14)).toBeNull();
    });

    it('returns a number between -100 and 0 for sufficient data', () => {
      const wr = calcWilliamsR(large.highs, large.lows, large.closes);
      expect(wr).not.toBeNull();
      expect(wr).toBeGreaterThanOrEqual(-100);
      expect(wr).toBeLessThanOrEqual(0);
    });
  });

  // ── MFI ──────────────────────────────────────────────────────────────────

  describe('calcMFI', () => {
    it('returns null when data is insufficient', () => {
      expect(calcMFI(tiny.highs, tiny.lows, tiny.closes, tiny.volumes, 14)).toBeNull();
      expect(calcMFI([], [], [], [], 14)).toBeNull();
    });

    it('returns a number between 0 and 100 for sufficient data', () => {
      const mfi = calcMFI(large.highs, large.lows, large.closes, large.volumes);
      expect(mfi).not.toBeNull();
      expect(mfi).toBeGreaterThanOrEqual(0);
      expect(mfi).toBeLessThanOrEqual(100);
    });
  });

  // ── CCI ──────────────────────────────────────────────────────────────────

  describe('calcCCI', () => {
    it('returns null when data is insufficient', () => {
      expect(calcCCI(tiny.highs, tiny.lows, tiny.closes, 20)).toBeNull();
      expect(calcCCI([], [], [], 20)).toBeNull();
    });

    it('returns a number for sufficient data', () => {
      const cci = calcCCI(large.highs, large.lows, large.closes);
      expect(cci).not.toBeNull();
      expect(typeof cci).toBe('number');
    });
  });

  // ── OBV ──────────────────────────────────────────────────────────────────

  describe('calcOBV', () => {
    it('returns null when data has fewer than 2 data points', () => {
      expect(calcOBV([100], [1000])).toBeNull();
      expect(calcOBV([], [])).toBeNull();
    });

    it('returns a number for sufficient data', () => {
      const obv = calcOBV(large.closes, large.volumes);
      expect(obv).not.toBeNull();
      expect(typeof obv).toBe('number');
    });
  });

  // ── VWAP ─────────────────────────────────────────────────────────────────

  describe('calcVWAP', () => {
    it('returns null when data is empty', () => {
      expect(calcVWAP([], [], [], [])).toBeNull();
    });

    it('returns a number for sufficient data', () => {
      const vwap = calcVWAP(large.highs, large.lows, large.closes, large.volumes);
      expect(vwap).not.toBeNull();
      expect(typeof vwap).toBe('number');
    });
  });

  // ── Parabolic SAR ───────────────────────────────────────────────────────

  describe('calcParabolicSAR', () => {
    it('returns null when data has fewer than 2 data points', () => {
      expect(calcParabolicSAR([100], [90])).toBeNull();
      expect(calcParabolicSAR([], [])).toBeNull();
    });

    it('returns a number for sufficient data', () => {
      const psar = calcParabolicSAR(large.highs, large.lows);
      expect(psar).not.toBeNull();
      expect(typeof psar).toBe('number');
    });

    it('accepts custom step and max', () => {
      const psar = calcParabolicSAR(large.highs, large.lows, 0.01, 0.1);
      expect(psar).not.toBeNull();
    });
  });

  // ── ROC ──────────────────────────────────────────────────────────────────

  describe('calcROC', () => {
    it('returns null when data is insufficient', () => {
      expect(calcROC(tiny.closes, 12)).toBeNull();
      expect(calcROC([], 12)).toBeNull();
    });

    it('returns a number for sufficient data', () => {
      const roc = calcROC(large.closes);
      expect(roc).not.toBeNull();
      expect(typeof roc).toBe('number');
    });
  });

  // ── Force Index ─────────────────────────────────────────────────────────

  describe('calcForceIndex', () => {
    it('returns null when data is insufficient', () => {
      expect(calcForceIndex(tiny.closes, tiny.volumes, 13)).toBeNull();
      expect(calcForceIndex([], [], 13)).toBeNull();
    });

    it('returns a number for sufficient data', () => {
      const fi = calcForceIndex(large.closes, large.volumes);
      expect(fi).not.toBeNull();
      expect(typeof fi).toBe('number');
    });
  });

  // ── ADL ─────────────────────────────────────────────────────────────────

  describe('calcADL', () => {
    it('returns null when data is empty', () => {
      expect(calcADL([], [], [], [])).toBeNull();
    });

    it('returns a number for sufficient data', () => {
      const adl = calcADL(large.highs, large.lows, large.closes, large.volumes);
      expect(adl).not.toBeNull();
      expect(typeof adl).toBe('number');
    });
  });

  // ── Awesome Oscillator ──────────────────────────────────────────────────

  describe('calcAwesomeOscillator', () => {
    it('returns null when data has fewer than 34 data points', () => {
      expect(calcAwesomeOscillator(tiny.highs, tiny.lows)).toBeNull();
      const short = generatePriceSeries(33);
      expect(calcAwesomeOscillator(short.highs, short.lows)).toBeNull();
    });

    it('returns a number for sufficient data (>= 34)', () => {
      const ao = calcAwesomeOscillator(large.highs, large.lows);
      expect(ao).not.toBeNull();
      expect(typeof ao).toBe('number');
    });
  });

  // ── Ichimoku Cloud ──────────────────────────────────────────────────────

  describe('calcIchimokuCloud', () => {
    it('returns null when data has fewer than 52 data points', () => {
      expect(calcIchimokuCloud(tiny.highs, tiny.lows, tiny.closes)).toBeNull();
      const short = generatePriceSeries(51);
      expect(calcIchimokuCloud(short.highs, short.lows, short.closes)).toBeNull();
    });

    it('returns IchimokuResult for sufficient data', () => {
      const ich = calcIchimokuCloud(large.highs, large.lows, large.closes);
      expect(ich).not.toBeNull();
      expect(ich).toHaveProperty('tenkanSen');
      expect(ich).toHaveProperty('kijunSen');
      expect(ich).toHaveProperty('senkouSpanA');
      expect(ich).toHaveProperty('senkouSpanB');
      expect(ich).toHaveProperty('chikouSpan');
      // chikouSpan should equal the last close price
      expect(ich!.chikouSpan).toBe(large.closes[large.closes.length - 1]);
    });
  });

  // ── Support / Resistance ────────────────────────────────────────────────

  describe('calcSupportResistance', () => {
    it('returns null when data is insufficient', () => {
      expect(calcSupportResistance(tiny.highs, tiny.lows, 20)).toBeNull();
      expect(calcSupportResistance([], [], 20)).toBeNull();
    });

    it('returns support and resistance for sufficient data', () => {
      const sr = calcSupportResistance(large.highs, large.lows);
      expect(sr).not.toBeNull();
      expect(sr).toHaveProperty('support');
      expect(sr).toHaveProperty('resistance');
      expect(sr!.resistance).toBeGreaterThanOrEqual(sr!.support);
    });

    it('uses default lookback of 20', () => {
      const sr = calcSupportResistance(large.highs, large.lows);
      // Manually compute from last 20 candles
      const recentHighs = large.highs.slice(-20);
      const recentLows = large.lows.slice(-20);
      expect(sr!.resistance).toBe(Math.max(...recentHighs));
      expect(sr!.support).toBe(Math.min(...recentLows));
    });

    it('accepts custom lookback', () => {
      const sr = calcSupportResistance(large.highs, large.lows, 10);
      expect(sr).not.toBeNull();
      const recentHighs = large.highs.slice(-10);
      const recentLows = large.lows.slice(-10);
      expect(sr!.resistance).toBe(Math.max(...recentHighs));
      expect(sr!.support).toBe(Math.min(...recentLows));
    });
  });

  // ── Volume Ratio ────────────────────────────────────────────────────────

  describe('calcVolumeRatio', () => {
    it('returns null when data is insufficient (< period + 1)', () => {
      expect(calcVolumeRatio(tiny.volumes, 20)).toBeNull();
      expect(calcVolumeRatio([], 20)).toBeNull();
    });

    it('returns a positive number for sufficient data', () => {
      const vr = calcVolumeRatio(large.volumes);
      expect(vr).not.toBeNull();
      expect(vr).toBeGreaterThan(0);
    });

    it('returns null if average volume is zero', () => {
      const zeroVols = Array(25).fill(0);
      expect(calcVolumeRatio(zeroVols, 20)).toBeNull();
    });

    it('returns 1 for constant volumes', () => {
      const constant = Array(25).fill(1000);
      const vr = calcVolumeRatio(constant, 20);
      expect(vr).toBeCloseTo(1, 5);
    });
  });

  // ── VWAP with intraday candles ───────────────────────────────────────────

  describe('calcVWAP (intraday path)', () => {
    function makeCandles(n: number, price = 100): OHLCVCandle[] {
      return Array.from({ length: n }, (_, i) => ({
        date: new Date(Date.now() + i * 300_000).toISOString(),
        open: price,
        high: price + 1,
        low: price - 1,
        close: price,
        volume: 1_000_000,
      }));
    }

    it('uses intraday candles when >= 5 bars provided', () => {
      const intraday = makeCandles(10, 150);
      const vwap = calcVWAP(large.highs, large.lows, large.closes, large.volumes, intraday);
      expect(vwap).not.toBeNull();
      // All candles have same price so VWAP should equal that price
      expect(vwap).toBeCloseTo(150, 1);
    });

    it('falls back to daily when fewer than 5 intraday candles', () => {
      const intraday = makeCandles(3, 999); // only 3 bars — should be ignored
      const vwapWithFewIntraday = calcVWAP(large.highs, large.lows, large.closes, large.volumes, intraday);
      const vwapDaily = calcVWAP(large.highs, large.lows, large.closes, large.volumes);
      expect(vwapWithFewIntraday).toBeCloseTo(vwapDaily!, 5);
    });

    it('falls back to daily when intradayCandles is undefined', () => {
      const vwapUndefined = calcVWAP(large.highs, large.lows, large.closes, large.volumes, undefined);
      const vwapDaily = calcVWAP(large.highs, large.lows, large.closes, large.volumes);
      expect(vwapUndefined).toBeCloseTo(vwapDaily!, 5);
    });
  });

  // ── calcPerfMetrics ──────────────────────────────────────────────────────

  describe('calcPerfMetrics', () => {
    function makeCandles(n: number, startPrice = 100): OHLCVCandle[] {
      return Array.from({ length: n }, (_, i) => ({
        date: new Date(Date.now() + i * 86_400_000).toISOString(),
        open: startPrice + i,
        high: startPrice + i + 1,
        low: startPrice + i - 1,
        close: startPrice + i,
        volume: 1_000_000,
      }));
    }

    it('returns all nulls when candles array is empty', () => {
      // calcPerfMetrics is called with non-empty array (guard is in computeAllIndicators)
      // but if n<6 we still get nulls for most fields
      const result = calcPerfMetrics(makeCandles(1));
      expect(result.perfWeek).toBeNull();
      expect(result.perfMonth).toBeNull();
      expect(result.perfQuarter).toBeNull();
      expect(result.perfYear).toBeNull();
    });

    it('computes perfWeek when >= 6 candles', () => {
      const candles = makeCandles(10, 100);
      const result = calcPerfMetrics(candles);
      expect(result.perfWeek).not.toBeNull();
      // close[9] = 109, close[4] = 104 → pct = (109-104)/104 * 100 ≈ 4.81
      expect(result.perfWeek).toBeCloseTo(((109 - 104) / 104) * 100, 1);
    });

    it('computes perfMonth when >= 22 candles', () => {
      const candles = makeCandles(25, 100);
      const result = calcPerfMetrics(candles);
      expect(result.perfMonth).not.toBeNull();
    });

    it('perfMonth is null when < 22 candles', () => {
      const candles = makeCandles(21, 100);
      const result = calcPerfMetrics(candles);
      expect(result.perfMonth).toBeNull();
    });

    it('perfQuarter is null when < 66 candles', () => {
      const candles = makeCandles(65, 100);
      const result = calcPerfMetrics(candles);
      expect(result.perfQuarter).toBeNull();
    });

    it('computes perfQuarter when >= 66 candles', () => {
      const candles = makeCandles(70, 100);
      const result = calcPerfMetrics(candles);
      expect(result.perfQuarter).not.toBeNull();
    });

    it('perfYear is null when < 253 candles', () => {
      const candles = makeCandles(252, 100);
      const result = calcPerfMetrics(candles);
      expect(result.perfYear).toBeNull();
    });

    it('computes perfYear when >= 253 candles', () => {
      const candles = makeCandles(260, 100);
      const result = calcPerfMetrics(candles);
      expect(result.perfYear).not.toBeNull();
    });

    it('computes relativeVolume correctly', () => {
      // Last candle has 2x the volume of the preceding 19
      const candles = makeCandles(25, 100).map((c, i) => ({
        ...c,
        volume: i === 24 ? 2_000_000 : 1_000_000,
      }));
      const result = calcPerfMetrics(candles);
      // avg of last 20 candles includes the 2M candle: (19 * 1M + 1 * 2M) / 20 = 1.05M
      // relVol = 2M / 1.05M ≈ 1.905
      expect(result.relativeVolume).not.toBeNull();
      expect(result.relativeVolume).toBeCloseTo(2_000_000 / ((19 * 1_000_000 + 2_000_000) / 20), 3);
    });

    it('relativeVolume is null when all volumes are zero', () => {
      const candles = makeCandles(10, 100).map((c) => ({ ...c, volume: 0 }));
      const result = calcPerfMetrics(candles);
      expect(result.relativeVolume).toBeNull();
    });
  });

  // ── computeAllIndicators ─────────────────────────────────────────────────

  describe('computeAllIndicators', () => {
    function makeOHLCVCandles(n: number, startPrice = 100): OHLCVCandle[] {
      return Array.from({ length: n }, (_, i) => ({
        date: new Date(Date.now() + i * 86_400_000).toISOString(),
        open: startPrice + i,
        high: startPrice + i + 1,
        low: startPrice + i - 1,
        close: startPrice + i,
        volume: 1_000_000,
      }));
    }

    it('returns an object with all IndicatorSet keys', () => {
      const candles = makeOHLCVCandles(30);
      const result = computeAllIndicators(candles);
      expect(result).toHaveProperty('vwap');
      expect(result).toHaveProperty('perfWeek');
      expect(result).toHaveProperty('perfMonth');
      expect(result).toHaveProperty('perfQuarter');
      expect(result).toHaveProperty('perfYear');
      expect(result).toHaveProperty('relativeVolume');
    });

    it('returns all nulls when candles array is empty', () => {
      const result = computeAllIndicators([]);
      expect(result.vwap).toBeNull();
      expect(result.perfWeek).toBeNull();
      expect(result.perfMonth).toBeNull();
      expect(result.perfQuarter).toBeNull();
      expect(result.perfYear).toBeNull();
      expect(result.relativeVolume).toBeNull();
    });

    it('passes intraday candles through to VWAP when provided', () => {
      const candles = makeOHLCVCandles(30, 100);
      // 10 intraday bars all at price 200 → intraday VWAP should be ~200
      const intraday = Array.from({ length: 10 }, (_, i) => ({
        date: new Date(Date.now() + i * 300_000).toISOString(),
        open: 200,
        high: 201,
        low: 199,
        close: 200,
        volume: 500_000,
      }));
      const result = computeAllIndicators(candles, intraday);
      expect(result.vwap).not.toBeNull();
      expect(result.vwap).toBeCloseTo(200, 1);
    });

    it('computes vwap from daily candles when no intraday provided', () => {
      const candles = makeOHLCVCandles(30, 100);
      const result = computeAllIndicators(candles);
      const expectedVwap = calcVWAP(
        candles.map((c) => c.high),
        candles.map((c) => c.low),
        candles.map((c) => c.close),
        candles.map((c) => c.volume),
      );
      expect(result.vwap).toBeCloseTo(expectedVwap!, 5);
    });
  });
});
