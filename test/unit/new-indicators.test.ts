import { describe, expect, it } from 'vitest';
import {
  calcADLSeries,
  calcCMF,
  calcElderRay,
  calcKeltnerChannels,
  calcMarketStructure,
  calcSqueezeDetect,
  calcSupertrend,
  calcTRIX,
} from '../../src/analysis/technical/indicators.js';

// ---------------------------------------------------------------------------
// Helper to generate realistic OHLCV data
// ---------------------------------------------------------------------------

function generateOHLCV(
  n: number,
  basePrice = 100,
): { opens: number[]; highs: number[]; lows: number[]; closes: number[]; volumes: number[] } {
  const opens: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  const volumes: number[] = [];
  let price = basePrice;
  for (let i = 0; i < n; i++) {
    const change = (Math.sin(i * 0.3) * 2 + Math.cos(i * 0.7)) * 0.5;
    const o = price;
    const c = price + change;
    const h = Math.max(o, c) + Math.abs(change) * 0.5;
    const l = Math.min(o, c) - Math.abs(change) * 0.5;
    opens.push(o);
    highs.push(h);
    lows.push(l);
    closes.push(c);
    volumes.push(1000000 + Math.round(Math.sin(i * 0.5) * 500000));
    price = c;
  }
  return { opens, highs, lows, closes, volumes };
}

/** Generate monotonically trending OHLCV data */
function generateTrending(
  n: number,
  direction: 'up' | 'down',
  basePrice = 100,
): { opens: number[]; highs: number[]; lows: number[]; closes: number[]; volumes: number[] } {
  const opens: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  const volumes: number[] = [];
  let price = basePrice;
  const step = direction === 'up' ? 1.0 : -1.0;
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = price + step;
    const h = Math.max(o, c) + 0.3;
    const l = Math.min(o, c) - 0.3;
    opens.push(o);
    highs.push(h);
    lows.push(l);
    closes.push(c);
    volumes.push(1000000);
    price = c;
  }
  return { opens, highs, lows, closes, volumes };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calcKeltnerChannels', () => {
  it('returns null with insufficient data (< 20 bars)', () => {
    const { highs, lows, closes } = generateOHLCV(10);
    expect(calcKeltnerChannels(highs, lows, closes)).toBeNull();
  });

  it('returns valid result with 50+ bars', () => {
    const { highs, lows, closes } = generateOHLCV(60);
    const result = calcKeltnerChannels(highs, lows, closes);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('upper');
    expect(result).toHaveProperty('middle');
    expect(result).toHaveProperty('lower');
  });

  it('upper > middle > lower always', () => {
    const { highs, lows, closes } = generateOHLCV(60);
    const result = calcKeltnerChannels(highs, lows, closes)!;
    expect(result.upper).toBeGreaterThan(result.middle);
    expect(result.middle).toBeGreaterThan(result.lower);
  });

  it('respects custom parameters', () => {
    const { highs, lows, closes } = generateOHLCV(80);
    const narrow = calcKeltnerChannels(highs, lows, closes, 20, 14, 1.0)!;
    const wide = calcKeltnerChannels(highs, lows, closes, 20, 14, 3.0)!;
    // Same middle EMA, but wider multiplier means wider bands
    expect(narrow.middle).toBeCloseTo(wide.middle, 5);
    expect(wide.upper - wide.middle).toBeGreaterThan(narrow.upper - narrow.middle);
    expect(wide.middle - wide.lower).toBeGreaterThan(narrow.middle - narrow.lower);
  });
});

describe('calcCMF', () => {
  it('returns null with < 20 bars', () => {
    const { highs, lows, closes, volumes } = generateOHLCV(10);
    expect(calcCMF(highs, lows, closes, volumes)).toBeNull();
  });

  it('returns a value in [-1, 1] range', () => {
    const { highs, lows, closes, volumes } = generateOHLCV(50);
    const result = calcCMF(highs, lows, closes, volumes);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(-1);
    expect(result!).toBeLessThanOrEqual(1);
  });

  it('returns 0 when all volumes are 0', () => {
    const { highs, lows, closes } = generateOHLCV(30);
    const zeroVolumes = new Array(30).fill(0);
    const result = calcCMF(highs, lows, closes, zeroVolumes);
    expect(result).toBe(0);
  });

  it('respects custom period', () => {
    const { highs, lows, closes, volumes } = generateOHLCV(50);
    const r10 = calcCMF(highs, lows, closes, volumes, 10);
    const r30 = calcCMF(highs, lows, closes, volumes, 30);
    expect(r10).not.toBeNull();
    expect(r30).not.toBeNull();
    // Different periods generally produce different values
    expect(typeof r10).toBe('number');
    expect(typeof r30).toBe('number');
  });
});

describe('calcSupertrend', () => {
  it('returns null with insufficient data', () => {
    const { highs, lows, closes } = generateOHLCV(5);
    expect(calcSupertrend(highs, lows, closes)).toBeNull();
  });

  it('returns valid result with enough data', () => {
    const { highs, lows, closes } = generateOHLCV(50);
    const result = calcSupertrend(highs, lows, closes);
    expect(result).not.toBeNull();
  });

  it('direction is either 1 or -1', () => {
    const { highs, lows, closes } = generateOHLCV(50);
    const result = calcSupertrend(highs, lows, closes)!;
    expect([1, -1]).toContain(result.direction);
  });

  it('line is a positive number', () => {
    const { highs, lows, closes } = generateOHLCV(50);
    const result = calcSupertrend(highs, lows, closes)!;
    expect(result.line).toBeGreaterThan(0);
    expect(Number.isFinite(result.line)).toBe(true);
  });
});

describe('calcTRIX', () => {
  it('returns null with < period*3+1 bars (default period=14, need 43)', () => {
    const { closes } = generateOHLCV(30);
    expect(calcTRIX(closes)).toBeNull();
  });

  it('returns valid {value, prev} with enough data', () => {
    const { closes } = generateOHLCV(80);
    const result = calcTRIX(closes);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('value');
    expect(result).toHaveProperty('prev');
  });

  it('value and prev are finite numbers', () => {
    const { closes } = generateOHLCV(80);
    const result = calcTRIX(closes)!;
    expect(Number.isFinite(result.value)).toBe(true);
    expect(Number.isFinite(result.prev)).toBe(true);
  });

  it('works with custom period', () => {
    const { closes } = generateOHLCV(50);
    // period=5 requires 5*3+1=16 bars
    const result = calcTRIX(closes, 5);
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!.value)).toBe(true);
  });
});

describe('calcElderRay', () => {
  it('returns null with < period+1 bars (default period=13, need 14)', () => {
    const { highs, lows, closes } = generateOHLCV(10);
    expect(calcElderRay(highs, lows, closes)).toBeNull();
  });

  it('returns all four fields with enough data', () => {
    const { highs, lows, closes } = generateOHLCV(30);
    const result = calcElderRay(highs, lows, closes);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('bullPower');
    expect(result).toHaveProperty('bearPower');
    expect(result).toHaveProperty('prevBull');
    expect(result).toHaveProperty('prevBear');
  });

  it('bullPower = high - EMA, bearPower = low - EMA (bull >= bear)', () => {
    const { highs, lows, closes } = generateOHLCV(40);
    const result = calcElderRay(highs, lows, closes)!;
    // Bull power uses high (always >= close), bear power uses low (always <= close)
    // So bullPower should be >= bearPower since high >= low
    expect(result.bullPower).toBeGreaterThanOrEqual(result.bearPower);
  });

  it('all values are finite numbers', () => {
    const { highs, lows, closes } = generateOHLCV(40);
    const result = calcElderRay(highs, lows, closes)!;
    expect(Number.isFinite(result.bullPower)).toBe(true);
    expect(Number.isFinite(result.bearPower)).toBe(true);
    expect(Number.isFinite(result.prevBull)).toBe(true);
    expect(Number.isFinite(result.prevBear)).toBe(true);
  });
});

describe('calcMarketStructure', () => {
  it('returns null with < 20 bars', () => {
    const { highs, lows } = generateOHLCV(10);
    expect(calcMarketStructure(highs, lows)).toBeNull();
  });

  it('returns value in [-1, 1]', () => {
    const { highs, lows } = generateOHLCV(40);
    const result = calcMarketStructure(highs, lows);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(-1);
    expect(result!).toBeLessThanOrEqual(1);
  });

  it('uptrending data produces positive score', () => {
    const { highs, lows } = generateTrending(30, 'up');
    const result = calcMarketStructure(highs, lows);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  it('downtrending data produces negative score', () => {
    const { highs, lows } = generateTrending(30, 'down', 200);
    const result = calcMarketStructure(highs, lows);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0);
  });

  it('respects custom period', () => {
    const { highs, lows } = generateOHLCV(50);
    const r10 = calcMarketStructure(highs, lows, 10);
    const r40 = calcMarketStructure(highs, lows, 40);
    expect(r10).not.toBeNull();
    expect(r40).not.toBeNull();
  });
});

describe('calcSqueezeDetect', () => {
  it('returns null with insufficient data', () => {
    const { highs, lows, closes } = generateOHLCV(10);
    expect(calcSqueezeDetect(highs, lows, closes)).toBeNull();
  });

  it('squeezing and justReleased are booleans', () => {
    const { highs, lows, closes } = generateOHLCV(60);
    const result = calcSqueezeDetect(highs, lows, closes);
    expect(result).not.toBeNull();
    expect(typeof result!.squeezing).toBe('boolean');
    expect(typeof result!.justReleased).toBe('boolean');
  });

  it('cannot have both squeezing=true and justReleased=true', () => {
    const { highs, lows, closes } = generateOHLCV(60);
    const result = calcSqueezeDetect(highs, lows, closes)!;
    // justReleased = prevSqueeze && !currentSqueeze
    // squeezing = currentSqueeze
    // If squeezing is true, justReleased must be false (since !currentSqueeze would be false)
    if (result.squeezing) {
      expect(result.justReleased).toBe(false);
    }
  });

  it('returns valid result with large dataset', () => {
    const { highs, lows, closes } = generateOHLCV(200);
    const result = calcSqueezeDetect(highs, lows, closes);
    expect(result).not.toBeNull();
  });
});

describe('calcADLSeries', () => {
  it('returns empty array for empty input', () => {
    const result = calcADLSeries([], [], [], []);
    expect(result).toEqual([]);
  });

  it('returns array of same length as input', () => {
    const { highs, lows, closes, volumes } = generateOHLCV(30);
    const result = calcADLSeries(highs, lows, closes, volumes);
    expect(result).toHaveLength(30);
  });

  it('all values are finite numbers', () => {
    const { highs, lows, closes, volumes } = generateOHLCV(30);
    const result = calcADLSeries(highs, lows, closes, volumes);
    for (const val of result) {
      expect(Number.isFinite(val)).toBe(true);
    }
  });

  it('returns single element for single candle input', () => {
    const result = calcADLSeries([105], [95], [100], [1000000]);
    expect(result).toHaveLength(1);
    expect(Number.isFinite(result[0])).toBe(true);
  });
});
