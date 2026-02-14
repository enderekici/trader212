import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiTimeframeAnalyzer } from '../../src/analysis/multi-timeframe.js';
import type { OHLCVCandle } from '../../src/data/yahoo-finance.js';

// Mock the config manager
vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn(),
  },
}));

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock the technical scorer
vi.mock('../../src/analysis/technical/scorer.js', () => ({
  scoreTechnicals: vi.fn(),
}));

import { configManager } from '../../src/config/manager.js';
import { scoreTechnicals } from '../../src/analysis/technical/scorer.js';

describe('MultiTimeframeAnalyzer', () => {
  let analyzer: MultiTimeframeAnalyzer;
  let mockConfigGet: ReturnType<typeof vi.fn>;
  let mockScoreTechnicals: ReturnType<typeof vi.fn>;

  // Helper to create sample candles
  const createCandles = (count: number): OHLCVCandle[] => {
    const candles: OHLCVCandle[] = [];
    const baseDate = new Date('2024-01-01');

    for (let i = 0; i < count; i++) {
      const date = new Date(baseDate);
      date.setDate(baseDate.getDate() + i);

      candles.push({
        date: date.toISOString().split('T')[0],
        open: 100 + i,
        high: 105 + i,
        low: 95 + i,
        close: 102 + i,
        volume: 1_000_000,
      });
    }

    return candles;
  };

  beforeEach(() => {
    mockConfigGet = vi.mocked(configManager.get);
    mockScoreTechnicals = vi.mocked(scoreTechnicals);

    // Default config values
    mockConfigGet.mockImplementation((key: string) => {
      if (key === 'multiTimeframe.enabled') return true;
      if (key === 'multiTimeframe.timeframes') return ['1d', '4h', '1h'];
      if (key === 'multiTimeframe.weights') return { '1d': 0.5, '4h': 0.3, '1h': 0.2 };
      return undefined;
    });

    // Default scorer returns 50 (neutral)
    mockScoreTechnicals.mockReturnValue(50);

    analyzer = new MultiTimeframeAnalyzer();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Feature Toggle', () => {
    it('should return null when feature is disabled', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'multiTimeframe.enabled') return false;
        return undefined;
      });

      const candles = createCandles(100);
      const result = analyzer.analyze('AAPL', candles);

      expect(result).toBeNull();
    });

    it('should analyze when feature is enabled', () => {
      const candles = createCandles(100);
      const result = analyzer.analyze('AAPL', candles);

      expect(result).not.toBeNull();
      expect(result?.compositeScore).toBeDefined();
    });
  });

  describe('Input Validation', () => {
    it('should handle empty candles array', () => {
      const result = analyzer.analyze('AAPL', []);

      expect(result).not.toBeNull();
      expect(result?.compositeScore).toBe(50);
      expect(result?.alignment).toBe('mixed');
      expect(result?.details).toContain('unavailable');
    });

    it('should handle null/undefined candles', () => {
      const result1 = analyzer.analyze('AAPL', null as unknown as OHLCVCandle[]);
      const result2 = analyzer.analyze('AAPL', undefined as unknown as OHLCVCandle[]);

      expect(result1?.compositeScore).toBe(50);
      expect(result2?.compositeScore).toBe(50);
    });

    it('should handle single candle', () => {
      const candles = createCandles(1);
      mockScoreTechnicals.mockReturnValue(70);

      const result = analyzer.analyze('AAPL', candles);

      expect(result).not.toBeNull();
      expect(result?.compositeScore).toBeGreaterThan(50);
    });
  });

  describe('Composite Score Calculation', () => {
    it('should compute weighted composite score correctly', () => {
      const candles = createCandles(100);

      // 1d: 80, 4h: 60, 1h: 40
      mockScoreTechnicals.mockImplementation((candles: OHLCVCandle[]) => {
        if (candles.length >= 100) return 80; // Daily (all candles)
        if (candles.length >= 20) return 60; // 4h (20 candles)
        return 40; // 1h (5 candles)
      });

      const result = analyzer.analyze('AAPL', candles);

      // Expected: 0.5*80 + 0.3*60 + 0.2*40 = 40 + 18 + 8 = 66
      expect(result?.compositeScore).toBe(66);
      expect(result?.timeframeScores['1d']).toBe(80);
      expect(result?.timeframeScores['4h']).toBe(60);
      expect(result?.timeframeScores['1h']).toBe(40);
    });

    it('should handle all timeframes with same score', () => {
      const candles = createCandles(100);
      mockScoreTechnicals.mockReturnValue(75);

      const result = analyzer.analyze('AAPL', candles);

      // All timeframes = 75, composite should be 75
      expect(result?.compositeScore).toBe(75);
    });

    it('should handle extreme scores (0 and 100)', () => {
      const candles = createCandles(100);

      mockScoreTechnicals.mockImplementation((candles: OHLCVCandle[]) => {
        if (candles.length >= 100) return 100;
        if (candles.length >= 20) return 50;
        return 0;
      });

      const result = analyzer.analyze('AAPL', candles);

      // 0.5*100 + 0.3*50 + 0.2*0 = 50 + 15 + 0 = 65
      expect(result?.compositeScore).toBe(65);
    });
  });

  describe('Weight Normalization', () => {
    it('should normalize weights that do not sum to 1.0', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'multiTimeframe.enabled') return true;
        if (key === 'multiTimeframe.timeframes') return ['1d', '4h', '1h'];
        // Weights sum to 2.0
        if (key === 'multiTimeframe.weights') return { '1d': 1.0, '4h': 0.6, '1h': 0.4 };
        return undefined;
      });

      const candles = createCandles(100);
      mockScoreTechnicals.mockReturnValue(60);

      const result = analyzer.analyze('AAPL', candles);

      // All scores are 60, so composite should be 60 regardless of weight normalization
      expect(result?.compositeScore).toBe(60);
    });

    it('should handle missing weights with equal distribution', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'multiTimeframe.enabled') return true;
        if (key === 'multiTimeframe.timeframes') return ['1d', '4h', '1h'];
        // No weights provided
        if (key === 'multiTimeframe.weights') return {};
        return undefined;
      });

      const candles = createCandles(100);

      mockScoreTechnicals.mockImplementation((candles: OHLCVCandle[]) => {
        if (candles.length >= 100) return 90;
        if (candles.length >= 20) return 60;
        return 30;
      });

      const result = analyzer.analyze('AAPL', candles);

      // Equal weights: (90 + 60 + 30) / 3 = 60
      expect(result?.compositeScore).toBe(60);
    });

    it('should handle null weights with equal distribution', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'multiTimeframe.enabled') return true;
        if (key === 'multiTimeframe.timeframes') return ['1d', '4h'];
        if (key === 'multiTimeframe.weights') return null;
        return undefined;
      });

      const candles = createCandles(100);
      mockScoreTechnicals.mockReturnValue(80);

      const result = analyzer.analyze('AAPL', candles);

      // Equal weights, both 80: (80 + 80) / 2 = 80
      expect(result?.compositeScore).toBe(80);
    });

    it('should handle partial weight definitions', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'multiTimeframe.enabled') return true;
        if (key === 'multiTimeframe.timeframes') return ['1d', '4h', '1h'];
        // Only 1d has weight
        if (key === 'multiTimeframe.weights') return { '1d': 1.0 };
        return undefined;
      });

      const candles = createCandles(100);

      mockScoreTechnicals.mockImplementation((candles: OHLCVCandle[]) => {
        if (candles.length >= 100) return 100;
        return 50;
      });

      const result = analyzer.analyze('AAPL', candles);

      // Only 1d has weight 1.0, others 0: composite = 100
      expect(result?.compositeScore).toBe(100);
    });

    it('should handle zero-sum weights gracefully', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'multiTimeframe.enabled') return true;
        if (key === 'multiTimeframe.timeframes') return ['1d', '4h'];
        // All weights are zero
        if (key === 'multiTimeframe.weights') return { '1d': 0, '4h': 0 };
        return undefined;
      });

      const candles = createCandles(100);
      mockScoreTechnicals.mockReturnValue(75);

      const result = analyzer.analyze('AAPL', candles);

      // Should fall back to equal weights
      expect(result?.compositeScore).toBe(75);
    });
  });

  describe('Alignment Detection', () => {
    it('should detect bullish alignment when all timeframes are bullish', () => {
      const candles = createCandles(100);
      mockScoreTechnicals.mockReturnValue(75); // All bullish (>= 60)

      const result = analyzer.analyze('AAPL', candles);

      expect(result?.alignment).toBe('bullish');
      expect(result?.details).toContain('bullish alignment');
    });

    it('should detect bearish alignment when all timeframes are bearish', () => {
      const candles = createCandles(100);
      mockScoreTechnicals.mockReturnValue(30); // All bearish (<= 40)

      const result = analyzer.analyze('AAPL', candles);

      expect(result?.alignment).toBe('bearish');
      expect(result?.details).toContain('bearish alignment');
    });

    it('should detect mixed signals when timeframes disagree', () => {
      const candles = createCandles(100);

      mockScoreTechnicals.mockImplementation((candles: OHLCVCandle[]) => {
        if (candles.length >= 100) return 70; // Bullish
        if (candles.length >= 20) return 50; // Neutral
        return 30; // Bearish
      });

      const result = analyzer.analyze('AAPL', candles);

      expect(result?.alignment).toBe('mixed');
      expect(result?.details).toContain('Mixed signals');
    });

    it('should treat all neutral as mixed', () => {
      const candles = createCandles(100);
      mockScoreTechnicals.mockReturnValue(50); // All neutral

      const result = analyzer.analyze('AAPL', candles);

      expect(result?.alignment).toBe('mixed');
    });

    it('should detect alignment with neutral timeframes present', () => {
      const candles = createCandles(100);

      mockScoreTechnicals.mockImplementation((candles: OHLCVCandle[]) => {
        if (candles.length >= 100) return 70; // Bullish
        if (candles.length >= 20) return 50; // Neutral
        return 65; // Bullish
      });

      const result = analyzer.analyze('AAPL', candles);

      // 1d and 1h are bullish, 4h is neutral -> bullish alignment
      expect(result?.alignment).toBe('bullish');
    });
  });

  describe('Timeframe Processing', () => {
    it('should process different timeframe formats', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'multiTimeframe.enabled') return true;
        if (key === 'multiTimeframe.timeframes') return ['1d', '4h', '1h'];
        if (key === 'multiTimeframe.weights') return { '1d': 0.5, '4h': 0.3, '1h': 0.2 };
        return undefined;
      });

      const candles = createCandles(100);

      let callCount = 0;
      mockScoreTechnicals.mockImplementation((candles: OHLCVCandle[]) => {
        callCount++;
        // Daily gets all 100 candles
        if (candles.length === 100) return 80;
        // 4h gets ~20 candles
        if (candles.length === 20) return 60;
        // 1h gets ~5 candles
        if (candles.length === 5) return 40;
        return 50;
      });

      const result = analyzer.analyze('AAPL', candles);

      expect(callCount).toBe(3); // Called once per timeframe
      expect(result?.timeframeDetails).toHaveLength(3);
      expect(result?.timeframeDetails[0].candleCount).toBe(100); // Daily
      expect(result?.timeframeDetails[1].candleCount).toBe(20); // 4h
      expect(result?.timeframeDetails[2].candleCount).toBe(5); // 1h
    });

    it('should handle insufficient data for a timeframe', () => {
      const candles = createCandles(3); // Only 3 candles

      const result = analyzer.analyze('AAPL', candles);

      expect(result).not.toBeNull();
      // All timeframes should get some data (1d gets 3, 4h gets 3, 1h gets 3)
      expect(result?.timeframeDetails).toHaveLength(3);
    });

    it('should handle empty timeframes configuration', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'multiTimeframe.enabled') return true;
        if (key === 'multiTimeframe.timeframes') return [];
        if (key === 'multiTimeframe.weights') return {};
        return undefined;
      });

      const candles = createCandles(100);
      const result = analyzer.analyze('AAPL', candles);

      expect(result?.compositeScore).toBe(50);
      expect(result?.timeframeScores).toEqual({});
      expect(result?.alignment).toBe('mixed');
    });
  });

  describe('Details Generation', () => {
    it('should generate detailed summary with all timeframe scores', () => {
      const candles = createCandles(100);

      mockScoreTechnicals.mockImplementation((candles: OHLCVCandle[]) => {
        if (candles.length >= 100) return 80;
        if (candles.length >= 20) return 60;
        return 40;
      });

      const result = analyzer.analyze('AAPL', candles);

      expect(result?.details).toContain('Composite Score: 66/100');
      expect(result?.details).toContain('1d: 80/100 (bullish)');
      expect(result?.details).toContain('4h: 60/100 (bullish)');
      expect(result?.details).toContain('1h: 40/100 (bearish)');
      expect(result?.details).toContain('Mixed signals');
    });

    it('should include candle counts in details', () => {
      const candles = createCandles(100);
      mockScoreTechnicals.mockReturnValue(70);

      const result = analyzer.analyze('AAPL', candles);

      expect(result?.details).toContain('[100 candles]');
      expect(result?.details).toContain('[20 candles]');
      expect(result?.details).toContain('[5 candles]');
    });
  });

  describe('Custom Scorer Function', () => {
    it('should accept custom scorer function', () => {
      const customScorer = vi.fn().mockReturnValue(85);
      const customAnalyzer = new MultiTimeframeAnalyzer(customScorer);

      const candles = createCandles(100);
      const result = customAnalyzer.analyze('AAPL', candles);

      expect(customScorer).toHaveBeenCalled();
      expect(result?.compositeScore).toBe(85);
      expect(mockScoreTechnicals).not.toHaveBeenCalled();
    });

    it('should pass correct candle slices to scorer', () => {
      const customScorer = vi.fn().mockReturnValue(60);
      const customAnalyzer = new MultiTimeframeAnalyzer(customScorer);

      const candles = createCandles(100);
      customAnalyzer.analyze('AAPL', candles);

      // Should be called 3 times (1d, 4h, 1h)
      expect(customScorer).toHaveBeenCalledTimes(3);

      // Check call arguments
      const calls = customScorer.mock.calls;
      expect(calls[0][0]).toHaveLength(100); // Daily
      expect(calls[1][0]).toHaveLength(20); // 4h
      expect(calls[2][0]).toHaveLength(5); // 1h
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small candle count', () => {
      const candles = createCandles(2);
      mockScoreTechnicals.mockReturnValue(55);

      const result = analyzer.analyze('AAPL', candles);

      expect(result).not.toBeNull();
      expect(result?.compositeScore).toBe(55);
    });

    it('should handle very large candle count', () => {
      const candles = createCandles(1000);
      mockScoreTechnicals.mockReturnValue(72);

      const result = analyzer.analyze('AAPL', candles);

      expect(result).not.toBeNull();
      expect(result?.compositeScore).toBe(72);
    });

    it('should round composite score to integer', () => {
      const candles = createCandles(100);

      mockScoreTechnicals.mockImplementation((candles: OHLCVCandle[]) => {
        if (candles.length >= 100) return 77;
        if (candles.length >= 20) return 63;
        return 41;
      });

      const result = analyzer.analyze('AAPL', candles);

      // 0.5*77 + 0.3*63 + 0.2*41 = 38.5 + 18.9 + 8.2 = 65.6 -> rounds to 66
      expect(result?.compositeScore).toBe(66);
      expect(Number.isInteger(result?.compositeScore)).toBe(true);
    });

    it('should handle single timeframe configuration', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'multiTimeframe.enabled') return true;
        if (key === 'multiTimeframe.timeframes') return ['1d'];
        if (key === 'multiTimeframe.weights') return { '1d': 1.0 };
        return undefined;
      });

      const candles = createCandles(100);
      mockScoreTechnicals.mockReturnValue(88);

      const result = analyzer.analyze('AAPL', candles);

      expect(result?.compositeScore).toBe(88);
      expect(result?.timeframeDetails).toHaveLength(1);
      expect(result?.alignment).toBe('bullish');
    });

    it('should handle unusual timeframe names', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'multiTimeframe.enabled') return true;
        if (key === 'multiTimeframe.timeframes') return ['daily', 'weekly'];
        if (key === 'multiTimeframe.weights') return { daily: 0.6, weekly: 0.4 };
        return undefined;
      });

      const candles = createCandles(100);
      mockScoreTechnicals.mockReturnValue(65);

      const result = analyzer.analyze('AAPL', candles);

      expect(result).not.toBeNull();
      expect(result?.compositeScore).toBe(65);
      expect(result?.timeframeScores['daily']).toBe(65);
      expect(result?.timeframeScores['weekly']).toBe(65);
    });
  });

  describe('Signal Mapping', () => {
    it('should map score >= 60 to bullish', () => {
      const candles = createCandles(100);
      mockScoreTechnicals.mockReturnValue(60);

      const result = analyzer.analyze('AAPL', candles);

      expect(result?.timeframeDetails[0].signal).toBe('bullish');
    });

    it('should map score <= 40 to bearish', () => {
      const candles = createCandles(100);
      mockScoreTechnicals.mockReturnValue(40);

      const result = analyzer.analyze('AAPL', candles);

      expect(result?.timeframeDetails[0].signal).toBe('bearish');
    });

    it('should map score between 40 and 60 to neutral', () => {
      const candles = createCandles(100);
      mockScoreTechnicals.mockReturnValue(50);

      const result = analyzer.analyze('AAPL', candles);

      expect(result?.timeframeDetails[0].signal).toBe('neutral');
    });

    it('should handle boundary values correctly', () => {
      const candles = createCandles(100);

      // Test 59 (should be neutral)
      mockScoreTechnicals.mockReturnValue(59);
      let result = analyzer.analyze('AAPL', candles);
      expect(result?.timeframeDetails[0].signal).toBe('neutral');

      // Test 60 (should be bullish)
      mockScoreTechnicals.mockReturnValue(60);
      result = analyzer.analyze('AAPL', candles);
      expect(result?.timeframeDetails[0].signal).toBe('bullish');

      // Test 41 (should be neutral)
      mockScoreTechnicals.mockReturnValue(41);
      result = analyzer.analyze('AAPL', candles);
      expect(result?.timeframeDetails[0].signal).toBe('neutral');

      // Test 40 (should be bearish)
      mockScoreTechnicals.mockReturnValue(40);
      result = analyzer.analyze('AAPL', candles);
      expect(result?.timeframeDetails[0].signal).toBe('bearish');
    });
  });

  describe('Factory Function', () => {
    it('should create analyzer instance via factory', async () => {
      const { createMultiTimeframeAnalyzer } = await import(
        '../../src/analysis/multi-timeframe.js'
      );
      const factoryAnalyzer = createMultiTimeframeAnalyzer();

      expect(factoryAnalyzer).toBeInstanceOf(MultiTimeframeAnalyzer);
    });
  });
});
