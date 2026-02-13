import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { OHLCVCandle } from '../../src/data/yahoo-finance.js';

// Mock configManager before importing the module under test
vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn((key: string) => {
      const defaults: Record<string, number> = {
        'analysis.rsi.period': 14,
        'analysis.macd.fast': 12,
        'analysis.macd.slow': 26,
        'analysis.macd.signal': 9,
        'analysis.bb.period': 20,
        'analysis.bb.stdDev': 2,
        'analysis.atr.period': 14,
        'analysis.adx.period': 14,
        'analysis.stochastic.kPeriod': 14,
        'analysis.stochastic.dPeriod': 3,
        'analysis.cci.period': 20,
        'analysis.mfi.period': 14,
        'analysis.roc.period': 12,
        'analysis.supportResistance.lookback': 20,
      };
      return defaults[key] ?? 14;
    }),
  },
}));

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock indicators module to directly control return values for computeScore branch testing
const mockCalcRSI = vi.fn();
const mockCalcMACD = vi.fn();
const mockCalcSMA = vi.fn();
const mockCalcEMA = vi.fn();
const mockCalcBollingerBands = vi.fn();
const mockCalcATR = vi.fn();
const mockCalcADX = vi.fn();
const mockCalcStochastic = vi.fn();
const mockCalcWilliamsR = vi.fn();
const mockCalcMFI = vi.fn();
const mockCalcCCI = vi.fn();
const mockCalcOBV = vi.fn();
const mockCalcVWAP = vi.fn();
const mockCalcParabolicSAR = vi.fn();
const mockCalcROC = vi.fn();
const mockCalcForceIndex = vi.fn();
const mockCalcVolumeRatio = vi.fn();
const mockCalcSupportResistance = vi.fn();

vi.mock('../../src/analysis/technical/indicators.js', () => ({
  calcRSI: (...args: unknown[]) => mockCalcRSI(...args),
  calcMACD: (...args: unknown[]) => mockCalcMACD(...args),
  calcSMA: (...args: unknown[]) => mockCalcSMA(...args),
  calcEMA: (...args: unknown[]) => mockCalcEMA(...args),
  calcBollingerBands: (...args: unknown[]) => mockCalcBollingerBands(...args),
  calcATR: (...args: unknown[]) => mockCalcATR(...args),
  calcADX: (...args: unknown[]) => mockCalcADX(...args),
  calcStochastic: (...args: unknown[]) => mockCalcStochastic(...args),
  calcWilliamsR: (...args: unknown[]) => mockCalcWilliamsR(...args),
  calcMFI: (...args: unknown[]) => mockCalcMFI(...args),
  calcCCI: (...args: unknown[]) => mockCalcCCI(...args),
  calcOBV: (...args: unknown[]) => mockCalcOBV(...args),
  calcVWAP: (...args: unknown[]) => mockCalcVWAP(...args),
  calcParabolicSAR: (...args: unknown[]) => mockCalcParabolicSAR(...args),
  calcROC: (...args: unknown[]) => mockCalcROC(...args),
  calcForceIndex: (...args: unknown[]) => mockCalcForceIndex(...args),
  calcVolumeRatio: (...args: unknown[]) => mockCalcVolumeRatio(...args),
  calcSupportResistance: (...args: unknown[]) => mockCalcSupportResistance(...args),
  // Also export the types that are re-exported
}));

import { analyzeTechnicals, scoreTechnicals } from '../../src/analysis/technical/scorer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandle(close: number, i = 0): OHLCVCandle {
  return {
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1_000_000,
  };
}

function makeCandles(closes: number[]): OHLCVCandle[] {
  return closes.map((c, i) => makeCandle(c, i));
}

/** Set all indicator mocks to return null */
function resetIndicatorMocks() {
  mockCalcRSI.mockReturnValue(null);
  mockCalcMACD.mockReturnValue(null);
  mockCalcSMA.mockReturnValue(null);
  mockCalcEMA.mockReturnValue(null);
  mockCalcBollingerBands.mockReturnValue(null);
  mockCalcATR.mockReturnValue(null);
  mockCalcADX.mockReturnValue(null);
  mockCalcStochastic.mockReturnValue(null);
  mockCalcWilliamsR.mockReturnValue(null);
  mockCalcMFI.mockReturnValue(null);
  mockCalcCCI.mockReturnValue(null);
  mockCalcOBV.mockReturnValue(null);
  mockCalcVWAP.mockReturnValue(null);
  mockCalcParabolicSAR.mockReturnValue(null);
  mockCalcROC.mockReturnValue(null);
  mockCalcForceIndex.mockReturnValue(null);
  mockCalcVolumeRatio.mockReturnValue(null);
  mockCalcSupportResistance.mockReturnValue(null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Technical Scorer', () => {
  const singleCandle = makeCandles([100]);

  beforeEach(() => {
    vi.clearAllMocks();
    resetIndicatorMocks();
  });

  describe('analyzeTechnicals', () => {
    it('returns all indicator fields', () => {
      mockCalcRSI.mockReturnValue(50);
      mockCalcMACD.mockReturnValue({ value: 1, signal: 0.5, histogram: 0.5 });
      mockCalcSMA.mockReturnValue(100);
      mockCalcEMA.mockReturnValue(100);
      mockCalcBollingerBands.mockReturnValue({ upper: 110, middle: 100, lower: 90 });
      mockCalcATR.mockReturnValue(2);
      mockCalcADX.mockReturnValue(25);
      mockCalcStochastic.mockReturnValue({ k: 50, d: 45 });
      mockCalcWilliamsR.mockReturnValue(-50);
      mockCalcMFI.mockReturnValue(50);
      mockCalcCCI.mockReturnValue(0);
      mockCalcOBV.mockReturnValue(1000000);
      mockCalcVWAP.mockReturnValue(100);
      mockCalcParabolicSAR.mockReturnValue(95);
      mockCalcROC.mockReturnValue(2);
      mockCalcForceIndex.mockReturnValue(5000);
      mockCalcVolumeRatio.mockReturnValue(1.2);
      mockCalcSupportResistance.mockReturnValue({ support: 95, resistance: 105 });

      const result = analyzeTechnicals(singleCandle);

      expect(result.rsi).toBe(50);
      expect(result.macd).toEqual({ value: 1, signal: 0.5, histogram: 0.5 });
      expect(result.bollinger).toEqual({ upper: 110, middle: 100, lower: 90 });
      expect(result.atr).toBe(2);
      expect(result.adx).toBe(25);
      expect(result.stochastic).toEqual({ k: 50, d: 45 });
      expect(result.williamsR).toBe(-50);
      expect(result.mfi).toBe(50);
      expect(result.cci).toBe(0);
      expect(result.obv).toBe(1000000);
      expect(result.vwap).toBe(100);
      expect(result.parabolicSar).toBe(95);
      expect(result.roc).toBe(2);
      expect(result.forceIndex).toBe(5000);
      expect(result.volumeRatio).toBe(1.2);
      expect(result.supportResistance).toEqual({ support: 95, resistance: 105 });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('handles all null indicators', () => {
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(50); // totalWeight === 0 => return 50
    });
  });

  describe('scoreTechnicals', () => {
    it('delegates to analyzeTechnicals and returns its score', () => {
      mockCalcRSI.mockReturnValue(25);
      const score = scoreTechnicals(singleCandle);
      expect(typeof score).toBe('number');
    });
  });

  // ── computeScore branch tests ─────────────────────────────────────────

  describe('RSI scoring branches', () => {
    it('RSI < 30 -> high bullish signal (80 + (30 - rsi))', () => {
      mockCalcRSI.mockReturnValue(20); // signal = 80 + 10 = 90
      const result = analyzeTechnicals(singleCandle);
      // score = 90 (only RSI contributing)
      expect(result.score).toBe(90);
    });

    it('RSI 30-40 -> signal 65', () => {
      mockCalcRSI.mockReturnValue(35);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(65);
    });

    it('RSI > 70 -> bearish signal (20 - (rsi - 70))', () => {
      mockCalcRSI.mockReturnValue(80); // signal = 20 - 10 = 10
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(10);
    });

    it('RSI 60-70 -> signal 35', () => {
      mockCalcRSI.mockReturnValue(65);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(35);
    });

    it('RSI 40-60 -> neutral signal 50', () => {
      mockCalcRSI.mockReturnValue(50);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(50);
    });

    it('RSI signal clamped to 0 (extreme overbought)', () => {
      mockCalcRSI.mockReturnValue(95); // signal = 20 - 25 = -5, clamped to 0
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(0);
    });

    it('RSI signal clamped to 100 (extreme oversold)', () => {
      mockCalcRSI.mockReturnValue(0); // signal = 80 + 30 = 110, clamped to 100
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(100);
    });
  });

  describe('MACD scoring branches', () => {
    it('positive histogram -> bullish (50 + hist*10, capped at 90)', () => {
      mockCalcMACD.mockReturnValue({ value: 2, signal: 1, histogram: 3 });
      const result = analyzeTechnicals(singleCandle);
      // signal = min(50 + 30, 90) = 80
      expect(result.score).toBe(80);
    });

    it('large positive histogram -> capped at 90', () => {
      mockCalcMACD.mockReturnValue({ value: 5, signal: 1, histogram: 10 });
      const result = analyzeTechnicals(singleCandle);
      // signal = min(50 + 100, 90) = 90
      expect(result.score).toBe(90);
    });

    it('negative histogram -> bearish (50 + hist*10, floored at 10)', () => {
      mockCalcMACD.mockReturnValue({ value: -1, signal: 1, histogram: -3 });
      const result = analyzeTechnicals(singleCandle);
      // signal = max(50 - 30, 10) = 20
      expect(result.score).toBe(20);
    });

    it('large negative histogram -> floored at 10', () => {
      mockCalcMACD.mockReturnValue({ value: -5, signal: 1, histogram: -10 });
      const result = analyzeTechnicals(singleCandle);
      // signal = max(50 - 100, 10) = 10
      expect(result.score).toBe(10);
    });
  });

  describe('Moving average trend scoring branches', () => {
    // SMA is called 3 times with periods 20, 50, 200 - we need to return
    // different values depending on the period argument
    function setupSMAs(sma20: number, sma50: number, sma200: number) {
      mockCalcSMA.mockImplementation((_closes: number[], period: number) => {
        if (period === 20) return sma20;
        if (period === 50) return sma50;
        if (period === 200) return sma200;
        return null;
      });
    }

    it('price > sma20, sma50, sma200 -> signal 85', () => {
      // price = 100, all SMAs below
      setupSMAs(90, 80, 70);
      const result = analyzeTechnicals(singleCandle);
      // golden cross: sma50(80) > sma200(70) -> +5 = 90
      expect(result.score).toBe(90);
    });

    it('price > sma20, sma50 but < sma200 -> signal 70', () => {
      setupSMAs(90, 80, 110);
      const result = analyzeTechnicals(singleCandle);
      // death cross: sma50(80) < sma200(110) -> -5 = 65
      expect(result.score).toBe(65);
    });

    it('price > sma20 only -> signal 60', () => {
      setupSMAs(90, 110, 120);
      const result = analyzeTechnicals(singleCandle);
      // death cross: sma50(110) < sma200(120) -> -5 = 55
      expect(result.score).toBe(55);
    });

    it('price < sma20, sma50, sma200 -> signal 15', () => {
      setupSMAs(110, 120, 130);
      const result = analyzeTechnicals(singleCandle);
      // death cross: sma50(120) < sma200(130) -> -5 = 10
      expect(result.score).toBe(10);
    });

    it('price < sma20, sma50 but > sma200 -> signal 30', () => {
      setupSMAs(110, 120, 90);
      const result = analyzeTechnicals(singleCandle);
      // golden cross: sma50(120) > sma200(90) -> +5 = 35
      expect(result.score).toBe(35);
    });

    it('price < sma20 only -> signal 40', () => {
      setupSMAs(110, 90, 80);
      const result = analyzeTechnicals(singleCandle);
      // golden cross: sma50(90) > sma200(80) -> +5 = 45
      expect(result.score).toBe(45);
    });

    it('price equals sma20 (falls through to default 50)', () => {
      setupSMAs(100, 90, 80);
      const result = analyzeTechnicals(singleCandle);
      // price === sma20, none of the conditions match -> stays 50
      // golden cross: +5 = 55
      expect(result.score).toBe(55);
    });
  });

  describe('EMA crossover scoring', () => {
    it('ema12 > ema26 -> bullish (70)', () => {
      mockCalcEMA.mockImplementation((_closes: number[], period: number) => {
        return period === 12 ? 105 : 95;
      });
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(70);
    });

    it('ema12 <= ema26 -> bearish (30)', () => {
      mockCalcEMA.mockImplementation((_closes: number[], period: number) => {
        return period === 12 ? 95 : 105;
      });
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(30);
    });
  });

  describe('Bollinger Bands scoring', () => {
    it('price near lower band -> high bullish', () => {
      // price = 100, lower = 95, upper = 110
      mockCalcBollingerBands.mockReturnValue({ upper: 110, middle: 102, lower: 95 });
      const result = analyzeTechnicals(singleCandle);
      // position = (100 - 95) / (110 - 95) = 5/15 = 0.333
      // signal = (1 - 0.333) * 100 = 66.7
      expect(result.score).toBe(67);
    });

    it('price near upper band -> low bearish', () => {
      mockCalcBollingerBands.mockReturnValue({ upper: 105, middle: 98, lower: 90 });
      const result = analyzeTechnicals(singleCandle);
      // position = (100 - 90) / (105 - 90) = 10/15 = 0.667
      // signal = (1 - 0.667) * 100 = 33.3
      expect(result.score).toBe(33);
    });

    it('zero range bands -> no BB signal added', () => {
      mockCalcBollingerBands.mockReturnValue({ upper: 100, middle: 100, lower: 100 });
      const result = analyzeTechnicals(singleCandle);
      // bbRange = 0, no signal added, falls to totalWeight=0 -> 50
      expect(result.score).toBe(50);
    });
  });

  describe('ADX scoring', () => {
    it('ADX > 25 -> strong trend (65)', () => {
      mockCalcADX.mockReturnValue(30);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(65);
    });

    it('ADX 20-25 -> moderate trend (55)', () => {
      mockCalcADX.mockReturnValue(22);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(55);
    });

    it('ADX < 20 -> weak trend (45)', () => {
      mockCalcADX.mockReturnValue(15);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(45);
    });
  });

  describe('Stochastic scoring', () => {
    it('k < 20 -> oversold (80), k > d -> +10 = 90', () => {
      mockCalcStochastic.mockReturnValue({ k: 15, d: 10 });
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(90);
    });

    it('k > 80 -> overbought (20), k > d -> +10 = 30', () => {
      mockCalcStochastic.mockReturnValue({ k: 85, d: 80 });
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(30);
    });

    it('k 20-80 -> neutral (50), k < d -> -10 = 40', () => {
      mockCalcStochastic.mockReturnValue({ k: 50, d: 55 });
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(40);
    });

    it('k < 20, k < d -> 80 - 10 = 70', () => {
      mockCalcStochastic.mockReturnValue({ k: 10, d: 15 });
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(70);
    });

    it('k > 80, k < d -> 20 - 10 = 10', () => {
      mockCalcStochastic.mockReturnValue({ k: 85, d: 90 });
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(10);
    });

    it('stochastic signal clamped to [0, 100]', () => {
      mockCalcStochastic.mockReturnValue({ k: 90, d: 95 });
      const result = analyzeTechnicals(singleCandle);
      // 20 - 10 = 10 -> clamped at 0 min -> still 10
      expect(result.score).toBe(10);
    });
  });

  describe('Williams %R scoring', () => {
    it('williamsR < -80 -> oversold bullish (75)', () => {
      mockCalcWilliamsR.mockReturnValue(-90);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(75);
    });

    it('williamsR > -20 -> overbought bearish (25)', () => {
      mockCalcWilliamsR.mockReturnValue(-10);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(25);
    });

    it('williamsR between -80 and -20 -> neutral (50)', () => {
      mockCalcWilliamsR.mockReturnValue(-50);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(50);
    });
  });

  describe('MFI scoring', () => {
    it('MFI < 20 -> oversold (80)', () => {
      mockCalcMFI.mockReturnValue(15);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(80);
    });

    it('MFI > 80 -> overbought (20)', () => {
      mockCalcMFI.mockReturnValue(85);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(20);
    });

    it('MFI 20-80 -> neutral (50)', () => {
      mockCalcMFI.mockReturnValue(50);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(50);
    });
  });

  describe('CCI scoring', () => {
    it('CCI < -100 -> oversold bullish (75)', () => {
      mockCalcCCI.mockReturnValue(-150);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(75);
    });

    it('CCI > 100 -> overbought bearish (25)', () => {
      mockCalcCCI.mockReturnValue(150);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(25);
    });

    it('CCI -100 to 100 -> neutral (50)', () => {
      mockCalcCCI.mockReturnValue(0);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(50);
    });
  });

  describe('Parabolic SAR scoring', () => {
    it('price > SAR -> bullish (70)', () => {
      // price = 100, SAR = 95
      mockCalcParabolicSAR.mockReturnValue(95);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(70);
    });

    it('price <= SAR -> bearish (30)', () => {
      // price = 100, SAR = 105
      mockCalcParabolicSAR.mockReturnValue(105);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(30);
    });
  });

  describe('ROC scoring', () => {
    it('positive ROC -> bullish', () => {
      mockCalcROC.mockReturnValue(5); // signal = min(50 + 25, 85) = 75
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(75);
    });

    it('large positive ROC -> capped at 85', () => {
      mockCalcROC.mockReturnValue(20); // signal = min(50 + 100, 85) = 85
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(85);
    });

    it('negative ROC -> bearish', () => {
      mockCalcROC.mockReturnValue(-5); // signal = max(50 - 25, 15) = 25
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(25);
    });

    it('large negative ROC -> floored at 15', () => {
      mockCalcROC.mockReturnValue(-20); // signal = max(50 - 100, 15) = 15
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(15);
    });
  });

  describe('Volume ratio scoring', () => {
    it('volumeRatio > 1.5 -> high conviction (60)', () => {
      mockCalcVolumeRatio.mockReturnValue(2.0);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(60);
    });

    it('volumeRatio < 0.5 -> low conviction (40)', () => {
      mockCalcVolumeRatio.mockReturnValue(0.3);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(40);
    });

    it('volumeRatio 0.5-1.5 -> neutral (50)', () => {
      mockCalcVolumeRatio.mockReturnValue(1.0);
      const result = analyzeTechnicals(singleCandle);
      expect(result.score).toBe(50);
    });
  });

  describe('combined scoring', () => {
    it('combines multiple indicators with proper weights', () => {
      // RSI = 25 -> signal = 80 + 5 = 85, weight 15
      // MACD hist = 2 -> signal = min(50 + 20, 90) = 70, weight 15
      mockCalcRSI.mockReturnValue(25);
      mockCalcMACD.mockReturnValue({ value: 2, signal: 1, histogram: 2 });
      const result = analyzeTechnicals(singleCandle);
      // combined = (85*15 + 70*15) / (15+15) = (1275 + 1050) / 30 = 2325/30 = 77.5 -> 78
      expect(result.score).toBe(78);
    });
  });
});
