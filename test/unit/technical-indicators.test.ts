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
  calcROC,
  calcRSI,
  calcSMA,
  calcStochastic,
  calcSupportResistance,
  calcVWAP,
  calcVolumeRatio,
  calcWilliamsR,
} from '../../src/analysis/technical/indicators.js';

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
});
