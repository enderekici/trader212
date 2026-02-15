import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TechnicalAnalysis } from '../../src/analysis/technical/scorer.js';
import { configManager } from '../../src/config/manager.js';
import { calculateATRStopLoss, getRecommendedStopLossPct } from '../../src/execution/atr-stoploss.js';

vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn((key: string) => {
      const defaults: Record<string, unknown> = {
        'risk.atrStopLossEnabled': false,
        'risk.atrStopLossMultiplier': 2.0,
        'risk.defaultStopLossPct': 0.05,
      };
      return defaults[key];
    }),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ATR Stop-Loss', () => {
  const mockTechAnalysis: TechnicalAnalysis = {
    rsi: 50,
    macd: null,
    sma20: 100,
    sma50: 100,
    sma200: 100,
    ema12: 100,
    ema26: 100,
    bollinger: null,
    atr: 2.5, // $2.50 ATR
    adx: 25,
    stochastic: null,
    williamsR: null,
    mfi: null,
    cci: null,
    obv: null,
    vwap: 100,
    parabolicSar: null,
    roc: null,
    forceIndex: null,
    volumeRatio: 1.0,
    supportLevel: 95,
    resistanceLevel: 105,
    score: 50,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateATRStopLoss', () => {
    it('should use fixed percentage when ATR is disabled', () => {
      const result = calculateATRStopLoss(100, mockTechAnalysis, 0.05);

      expect(result.method).toBe('fixed');
      expect(result.stopLossPrice).toBe(95); // 100 - 5%
      expect(result.stopLossPct).toBe(0.05);
      expect(result.atrValue).toBeNull();
      expect(result.atrMultiplier).toBeNull();
    });

    it('should use ATR when enabled', () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'risk.atrStopLossEnabled') return true;
        if (key === 'risk.atrStopLossMultiplier') return 2.0;
        return null;
      });

      const result = calculateATRStopLoss(100, mockTechAnalysis, 0.05);

      expect(result.method).toBe('atr');
      expect(result.atrValue).toBe(2.5);
      expect(result.atrMultiplier).toBe(2.0);
      expect(result.stopLossDistance).toBe(5.0); // 2.5 * 2.0
      expect(result.stopLossPrice).toBe(95); // 100 - 5.0
      expect(result.stopLossPct).toBe(0.05); // 5.0 / 100
    });

    it('should fallback to fixed when ATR is null', () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'risk.atrStopLossEnabled') return true;
        if (key === 'risk.atrStopLossMultiplier') return 2.0;
        return null;
      });

      const noAtrAnalysis = { ...mockTechAnalysis, atr: null };
      const result = calculateATRStopLoss(100, noAtrAnalysis, 0.05);

      expect(result.method).toBe('fixed');
      expect(result.stopLossPct).toBe(0.05);
    });

    it('should fallback to fixed when ATR is zero', () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'risk.atrStopLossEnabled') return true;
        if (key === 'risk.atrStopLossMultiplier') return 2.0;
        return null;
      });

      const zeroAtrAnalysis = { ...mockTechAnalysis, atr: 0 };
      const result = calculateATRStopLoss(100, zeroAtrAnalysis, 0.05);

      expect(result.method).toBe('fixed');
      expect(result.stopLossPct).toBe(0.05);
    });

    it('should calculate wider stops for high volatility stocks', () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'risk.atrStopLossEnabled') return true;
        if (key === 'risk.atrStopLossMultiplier') return 2.0;
        return null;
      });

      const highVolAnalysis = { ...mockTechAnalysis, atr: 5.0 }; // High ATR
      const result = calculateATRStopLoss(100, highVolAnalysis, 0.05);

      expect(result.method).toBe('atr');
      expect(result.stopLossDistance).toBe(10.0); // 5.0 * 2.0
      expect(result.stopLossPrice).toBe(90); // 100 - 10.0
      expect(result.stopLossPct).toBe(0.10); // 10% stop for volatile stock
    });

    it('should calculate tighter stops for low volatility stocks', () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'risk.atrStopLossEnabled') return true;
        if (key === 'risk.atrStopLossMultiplier') return 2.0;
        return null;
      });

      const lowVolAnalysis = { ...mockTechAnalysis, atr: 1.0 }; // Low ATR
      const result = calculateATRStopLoss(100, lowVolAnalysis, 0.05);

      expect(result.method).toBe('atr');
      expect(result.stopLossDistance).toBe(2.0); // 1.0 * 2.0
      expect(result.stopLossPrice).toBe(98); // 100 - 2.0
      expect(result.stopLossPct).toBe(0.02); // 2% stop for stable stock
    });
  });

  describe('getRecommendedStopLossPct', () => {
    it('should return default when ATR disabled', () => {
      const result = getRecommendedStopLossPct(mockTechAnalysis);
      expect(result).toBe(0.05);
    });

    it('should estimate ATR-based percentage when enabled', () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'risk.atrStopLossEnabled') return true;
        if (key === 'risk.atrStopLossMultiplier') return 2.0;
        if (key === 'risk.defaultStopLossPct') return 0.05;
        return null;
      });

      const result = getRecommendedStopLossPct(mockTechAnalysis);
      // Estimated: (2.5 * 2.0) / 100 = 0.05
      expect(result).toBeGreaterThanOrEqual(0.05);
    });

    it('should fallback to default when ATR is null', () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'risk.atrStopLossEnabled') return true;
        if (key === 'risk.atrStopLossMultiplier') return 2.0;
        if (key === 'risk.defaultStopLossPct') return 0.05;
        return null;
      });

      const noAtrAnalysis = { ...mockTechAnalysis, atr: null };
      const result = getRecommendedStopLossPct(noAtrAnalysis);
      expect(result).toBe(0.05);
    });
  });
});
