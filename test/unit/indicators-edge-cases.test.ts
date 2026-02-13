/**
 * Edge-case tests for indicator functions where the underlying library
 * returns empty arrays. These branches are practically unreachable with
 * real data but exist as defensive guards.
 */
import { describe, expect, it, vi } from 'vitest';

// Mock the technicalindicators library to return empty arrays
vi.mock('technicalindicators', () => ({
  RSI: { calculate: vi.fn(() => []) },
  MACD: { calculate: vi.fn(() => []) },
  SMA: { calculate: vi.fn(() => []) },
  EMA: { calculate: vi.fn(() => []) },
  BollingerBands: { calculate: vi.fn(() => []) },
  ATR: { calculate: vi.fn(() => []) },
  ADX: { calculate: vi.fn(() => []) },
  Stochastic: { calculate: vi.fn(() => []) },
  WilliamsR: { calculate: vi.fn(() => []) },
  MFI: { calculate: vi.fn(() => []) },
  CCI: { calculate: vi.fn(() => []) },
  OBV: { calculate: vi.fn(() => []) },
  VWAP: { calculate: vi.fn(() => []) },
  PSAR: { calculate: vi.fn(() => []) },
  ROC: { calculate: vi.fn(() => []) },
  ForceIndex: { calculate: vi.fn(() => []) },
  ADL: { calculate: vi.fn(() => []) },
  AwesomeOscillator: { calculate: vi.fn(() => []) },
  IchimokuCloud: { calculate: vi.fn(() => []) },
}));

import {
  calcRSI,
  calcMACD,
  calcSMA,
  calcEMA,
  calcBollingerBands,
  calcATR,
  calcADX,
  calcStochastic,
  calcWilliamsR,
  calcMFI,
  calcCCI,
  calcOBV,
  calcVWAP,
  calcParabolicSAR,
  calcROC,
  calcForceIndex,
  calcADL,
  calcAwesomeOscillator,
  calcIchimokuCloud,
} from '../../src/analysis/technical/indicators.js';

// Generate enough data to pass the length guards
const closes = Array(300).fill(100);
const highs = Array(300).fill(105);
const lows = Array(300).fill(95);
const volumes = Array(300).fill(1_000_000);

describe('Indicator edge cases - library returns empty arrays', () => {
  it('calcRSI returns null when library returns empty', () => {
    expect(calcRSI(closes)).toBeNull();
  });

  it('calcMACD returns null when library returns empty', () => {
    expect(calcMACD(closes)).toBeNull();
  });

  it('calcSMA returns null when library returns empty', () => {
    expect(calcSMA(closes, 20)).toBeNull();
  });

  it('calcEMA returns null when library returns empty', () => {
    expect(calcEMA(closes, 12)).toBeNull();
  });

  it('calcBollingerBands returns null when library returns empty', () => {
    expect(calcBollingerBands(closes)).toBeNull();
  });

  it('calcATR returns null when library returns empty', () => {
    expect(calcATR(highs, lows, closes)).toBeNull();
  });

  it('calcADX returns null when library returns empty', () => {
    expect(calcADX(highs, lows, closes)).toBeNull();
  });

  it('calcStochastic returns null when library returns empty', () => {
    expect(calcStochastic(highs, lows, closes)).toBeNull();
  });

  it('calcWilliamsR returns null when library returns empty', () => {
    expect(calcWilliamsR(highs, lows, closes)).toBeNull();
  });

  it('calcMFI returns null when library returns empty', () => {
    expect(calcMFI(highs, lows, closes, volumes)).toBeNull();
  });

  it('calcCCI returns null when library returns empty', () => {
    expect(calcCCI(highs, lows, closes)).toBeNull();
  });

  it('calcOBV returns null when library returns empty', () => {
    expect(calcOBV(closes, volumes)).toBeNull();
  });

  it('calcVWAP returns null when library returns empty', () => {
    expect(calcVWAP(highs, lows, closes, volumes)).toBeNull();
  });

  it('calcParabolicSAR returns null when library returns empty', () => {
    expect(calcParabolicSAR(highs, lows)).toBeNull();
  });

  it('calcROC returns null when library returns empty', () => {
    expect(calcROC(closes)).toBeNull();
  });

  it('calcForceIndex returns null when library returns empty', () => {
    expect(calcForceIndex(closes, volumes)).toBeNull();
  });

  it('calcADL returns null when library returns empty', () => {
    expect(calcADL(highs, lows, closes, volumes)).toBeNull();
  });

  it('calcAwesomeOscillator returns null when library returns empty', () => {
    expect(calcAwesomeOscillator(highs, lows)).toBeNull();
  });

  it('calcIchimokuCloud returns null when library returns empty', () => {
    expect(calcIchimokuCloud(highs, lows, closes)).toBeNull();
  });
});

describe('MACD edge case - last element has null fields', () => {
  it('returns null when MACD result has null MACD value', async () => {
    const { MACD } = await import('technicalindicators');
    (MACD.calculate as ReturnType<typeof vi.fn>).mockReturnValue([
      { MACD: null, signal: 1, histogram: 1 },
    ]);
    expect(calcMACD(closes)).toBeNull();
  });

  it('returns null when MACD result has null signal', async () => {
    const { MACD } = await import('technicalindicators');
    (MACD.calculate as ReturnType<typeof vi.fn>).mockReturnValue([
      { MACD: 1, signal: null, histogram: 1 },
    ]);
    expect(calcMACD(closes)).toBeNull();
  });

  it('returns null when MACD result has null histogram', async () => {
    const { MACD } = await import('technicalindicators');
    (MACD.calculate as ReturnType<typeof vi.fn>).mockReturnValue([
      { MACD: 1, signal: 1, histogram: null },
    ]);
    expect(calcMACD(closes)).toBeNull();
  });
});

describe('Stochastic edge case - last element has null fields', () => {
  it('returns null when Stochastic result has null k', async () => {
    const { Stochastic } = await import('technicalindicators');
    (Stochastic.calculate as ReturnType<typeof vi.fn>).mockReturnValue([
      { k: null, d: 50 },
    ]);
    expect(calcStochastic(highs, lows, closes)).toBeNull();
  });

  it('returns null when Stochastic result has null d', async () => {
    const { Stochastic } = await import('technicalindicators');
    (Stochastic.calculate as ReturnType<typeof vi.fn>).mockReturnValue([
      { k: 50, d: null },
    ]);
    expect(calcStochastic(highs, lows, closes)).toBeNull();
  });
});
