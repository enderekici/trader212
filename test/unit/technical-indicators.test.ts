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

    it('handles zero candles: lookback=0 branch (line 391 false branch)', () => {
      // With n=0, lookback = Math.min(20, 0) = 0 → hits the `lookback > 0` false branch
      // All perf metrics are null, relativeVolume is null (n === 0)
      const result = calcPerfMetrics([]);
      expect(result.perfWeek).toBeNull();
      expect(result.perfMonth).toBeNull();
      expect(result.perfQuarter).toBeNull();
      expect(result.perfYear).toBeNull();
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

// ── detectCandlestickPatterns (Inside Day / Outside Day) ──────────────────

import { detectCandlestickPatterns } from '../../src/analysis/technical/indicators.js';

describe('detectCandlestickPatterns - manual patterns', () => {
  function makePatternCandles(
    overrides: { open: number; high: number; low: number; close: number }[],
  ): OHLCVCandle[] {
    return overrides.map((c, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      ...c,
      volume: 1_000_000,
    }));
  }

  it('returns empty result when opens.length < 5 (line 457 early return)', () => {
    // Only 4 candles - should return empty result immediately
    const candles = makePatternCandles([
      { open: 100, high: 110, low: 90, close: 105 },
      { open: 101, high: 111, low: 91, close: 106 },
      { open: 102, high: 112, low: 92, close: 107 },
      { open: 103, high: 113, low: 93, close: 108 },
    ]);
    const opens = candles.map((c) => c.open);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bullish).toEqual([]);
    expect(result.bearish).toEqual([]);
    expect(result.neutral).toEqual([]);
  });

  it('detects Inside Day: today range within yesterday range (line 514)', () => {
    // Need at least 5 candles for the function to proceed past the early return
    const candles = makePatternCandles([
      { open: 100, high: 110, low: 90, close: 105 },
      { open: 101, high: 111, low: 91, close: 106 },
      { open: 102, high: 112, low: 92, close: 107 },
      // yesterday: high=120, low=80
      { open: 100, high: 120, low: 80, close: 100 },
      // today: high=115 (< 120), low=85 (> 80) → Inside Day
      { open: 100, high: 115, low: 85, close: 100 },
    ]);

    const opens = candles.map((c) => c.open);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    const result = detectCandlestickPatterns(opens, highs, lows, closes);

    expect(result.neutral).toContain('Inside Day');
  });

  it('detects Outside Day: today range engulfs yesterday range (line 525)', () => {
    // Need at least 5 candles for the function to proceed
    const candles = makePatternCandles([
      { open: 100, high: 110, low: 90, close: 105 },
      { open: 101, high: 111, low: 91, close: 106 },
      { open: 102, high: 112, low: 92, close: 107 },
      // yesterday: high=105, low=95
      { open: 100, high: 105, low: 95, close: 100 },
      // today: high=110 (> 105), low=90 (< 95) → Outside Day
      { open: 100, high: 110, low: 90, close: 100 },
    ]);

    const opens = candles.map((c) => c.open);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    const result = detectCandlestickPatterns(opens, highs, lows, closes);

    expect(result.neutral).toContain('Outside Day');
  });

  it('detects Dragonfly Doji: open=close=high with long lower shadow (line 491)', () => {
    // Need 5 candles; last candle is a dragonfly doji (open=close=high, long lower shadow)
    const candles = makePatternCandles([
      { open: 100, high: 105, low: 95, close: 103 },
      { open: 103, high: 108, low: 98, close: 106 },
      { open: 106, high: 111, low: 101, close: 109 },
      { open: 109, high: 114, low: 104, close: 112 },
      // Dragonfly Doji: open=close=high, long lower shadow
      { open: 115, high: 115, low: 100, close: 115 },
    ]);
    const opens = candles.map((c) => c.open);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.neutral).toContain('Dragonfly Doji');
  });

  it('detects Gravestone Doji: open=close=low with long upper shadow (line 492)', () => {
    // Need 5 candles; last candle is a gravestone doji (open=close=low, long upper shadow)
    const candles = makePatternCandles([
      { open: 100, high: 105, low: 95, close: 103 },
      { open: 103, high: 108, low: 98, close: 106 },
      { open: 106, high: 111, low: 101, close: 109 },
      { open: 109, high: 114, low: 104, close: 112 },
      // Gravestone Doji: open=close=low, long upper shadow
      { open: 112, high: 127, low: 112, close: 112 },
    ]);
    const opens = candles.map((c) => c.open);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.neutral).toContain('Gravestone Doji');
  });

  it('detects NR7: today has the smallest range of last 7 bars (line 504)', () => {
    // Need >= 7 candles so NR7 code runs; last candle must have the smallest range
    // Bars 1-6: range = 20 each (high-low = 20); last bar (day 7): range = 5 (the smallest)
    const candles = makePatternCandles([
      { open: 100, high: 110, low: 90, close: 100 },  // range 20
      { open: 100, high: 110, low: 90, close: 100 },  // range 20
      { open: 100, high: 110, low: 90, close: 100 },  // range 20
      { open: 100, high: 110, low: 90, close: 100 },  // range 20
      { open: 100, high: 110, low: 90, close: 100 },  // range 20
      { open: 100, high: 110, low: 90, close: 100 },  // range 20
      // Last bar: range = 5 (today ≤ all previous 6 days → NR7)
      { open: 100, high: 103, low: 98, close: 101 },  // range 5
    ]);

    const opens = candles.map((c) => c.open);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.neutral).toContain('NR7');
  });

  // ── Library pattern tests (lines 468-487) ──

  it('detects Bullish Engulfing pattern (line 468)', () => {
    // 5 candles total; last 2 form bullish engulfing
    const opens  = [105, 103, 101, 110, 95];
    const highs  = [107, 106, 104, 115, 120];
    const lows   = [103, 100, 99,  95,  90];
    const closes = [106, 104, 102, 100, 115];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bullish).toContain('Bullish Engulfing');
  });

  it('detects Hammer pattern (line 469)', () => {
    // 5-candle downtrend ending with hammer
    const opens  = [112, 108, 105, 100, 103];
    const highs  = [114, 110, 107, 102, 110];
    const lows   = [108, 105, 102,  96, 102];
    const closes = [110, 107, 104, 102, 108];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bullish).toContain('Hammer');
  });

  it('detects Morning Star pattern (line 470)', () => {
    // 5 candles; last 3 form morning star
    const opens  = [105, 102, 100, 72, 77];
    const highs  = [107, 104, 102, 75, 100];
    const lows   = [103, 100, 78,  70, 76];
    const closes = [104, 101, 80,  73, 95];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bullish).toContain('Morning Star');
  });

  it('detects Morning Doji Star pattern (line 471)', () => {
    // 5 candles; last 3 form morning doji star
    const opens  = [105, 102, 100, 72, 77];
    const highs  = [107, 104, 102, 75, 100];
    const lows   = [103, 100, 78,  70, 76];
    const closes = [104, 101, 80,  72, 95];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bullish).toContain('Morning Doji Star');
  });

  it('detects Three White Soldiers pattern (line 472)', () => {
    // 5 candles; last 3 form three white soldiers
    const opens  = [95, 98, 100, 104, 109];
    const highs  = [100, 103, 110, 115, 120];
    const lows   = [94,  97,  99, 103, 108];
    const closes = [99, 102, 108, 113, 118];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bullish).toContain('Three White Soldiers');
  });

  it('detects Bullish Harami pattern (line 473)', () => {
    // 5 candles; last 2 form bullish harami
    const opens  = [60, 58, 57, 55, 48];
    const highs  = [62, 60, 59, 58, 52];
    const lows   = [50, 48, 46, 42, 46];
    const closes = [52, 50, 48, 44, 51];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bullish).toContain('Bullish Harami');
  });

  it('detects Tweezer Bottom pattern (line 474)', () => {
    const opens  = [110, 108, 106, 104, 102];
    const highs  = [112, 110, 108, 106, 104];
    const lows   = [100,  99,  95,  90,  90];
    const closes = [109, 107, 105, 102, 103];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bullish).toContain('Tweezer Bottom');
  });

  it('detects Piercing Line pattern (line 475)', () => {
    // 5 candles; last 2 form piercing line
    const opens  = [60, 58, 57, 55, 42];
    const highs  = [62, 60, 59, 57, 52];
    const lows   = [55, 52, 50, 43, 40];
    const closes = [58, 56, 53, 44, 51];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bullish).toContain('Piercing Line');
  });

  it('detects Abandoned Baby bullish pattern (line 476)', () => {
    // 5 candles; last 3 form abandoned baby
    const opens  = [105, 102, 100, 70, 76];
    const highs  = [107, 104, 102, 72, 90];
    const lows   = [103, 100, 78,  68, 74];
    const closes = [104, 101, 80,  70, 88];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bullish).toContain('Abandoned Baby');
  });

  it('detects Bearish Engulfing pattern (line 479)', () => {
    // 5 candles; last 2 form bearish engulfing
    const opens  = [40, 42, 43, 45, 55];
    const highs  = [44, 47, 50, 55, 58];
    const lows   = [38, 40, 41, 42, 43];
    const closes = [43, 46, 49, 53, 44];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bearish).toContain('Bearish Engulfing');
  });

  it('detects Shooting Star pattern (line 480)', () => {
    const opens  = [100, 103, 106, 112, 113];
    const highs  = [105, 108, 111, 120, 115];
    const lows   = [ 99, 102, 105, 110, 107];
    const closes = [103, 106, 110, 110, 108];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bearish).toContain('Shooting Star');
  });

  it('detects Evening Star pattern (line 481)', () => {
    // 5 candles; last 3 form evening star
    const opens  = [75, 78, 80, 107, 104];
    const highs  = [ 79, 82, 102, 110, 106];
    const lows   = [ 73, 76,  78, 105,  75];
    const closes = [ 78, 80, 100, 108,  77];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bearish).toContain('Evening Star');
  });

  it('detects Evening Doji Star pattern (line 482)', () => {
    // 5 candles; last 3 form evening doji star
    const opens  = [75, 78, 80, 107, 104];
    const highs  = [79, 82, 102, 110, 106];
    const lows   = [73, 76,  78, 105,  75];
    const closes = [78, 80, 100, 107,  77];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bearish).toContain('Evening Doji Star');
  });

  it('detects Three Black Crows pattern (line 483)', () => {
    // 5 candles; last 3 form three black crows
    const opens  = [115, 112, 110, 107, 104];
    const highs  = [118, 115, 112, 109, 106];
    const lows   = [108, 105, 99,   97,  92];
    const closes = [112, 110, 100,  98,  93];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bearish).toContain('Three Black Crows');
  });

  it('detects Bearish Harami pattern (line 484)', () => {
    // 5 candles; last 2 form bearish harami
    const opens  = [40, 42, 43, 44, 53];
    const highs  = [50, 52, 54, 58, 56];
    const lows   = [38, 40, 41, 42, 50];
    const closes = [48, 50, 52, 55, 51];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bearish).toContain('Bearish Harami');
  });

  it('detects Tweezer Top pattern (line 485)', () => {
    const opens  = [100, 103, 106, 109, 110];
    const highs  = [105, 108, 111, 115, 115];
    const lows   = [ 99, 102, 105, 107, 108];
    const closes = [103, 106, 109, 112, 111];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bearish).toContain('Tweezer Top');
  });

  it('detects Dark Cloud Cover pattern (line 486)', () => {
    // 5 candles; last 2 form dark cloud cover
    const opens  = [95, 98, 100, 100, 123];
    const highs  = [98, 100, 122, 122, 125];
    const lows   = [93, 96,  98,  98, 107];
    const closes = [97, 99, 120, 120, 109];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bearish).toContain('Dark Cloud Cover');
  });

  it('detects Hanging Man pattern (line 487)', () => {
    const opens  = [100, 103, 106, 112, 113];
    const highs  = [105, 108, 111, 112, 115];
    const lows   = [ 99, 102, 105, 104, 107];
    const closes = [103, 106, 110, 110, 108];
    const result = detectCandlestickPatterns(opens, highs, lows, closes);
    expect(result.bearish).toContain('Hanging Man');
  });
});
