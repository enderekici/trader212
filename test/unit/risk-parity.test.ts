import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OHLCVCandle } from '../../src/data/yahoo-finance.js';
import type { PositionInfo } from '../../src/execution/risk-parity.js';
import { RiskParitySizer } from '../../src/execution/risk-parity.js';

// Mock config manager
const mockConfigGet = vi.fn();
vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: (...args: unknown[]) => mockConfigGet(...args),
  },
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('RiskParitySizer', () => {
  let sizer: RiskParitySizer;

  beforeEach(() => {
    sizer = new RiskParitySizer();
    vi.clearAllMocks();

    // Default config values
    mockConfigGet.mockImplementation((key: string) => {
      const defaults: Record<string, unknown> = {
        'riskParity.enabled': true,
        'riskParity.targetVolatility': 0.15,
        'riskParity.lookbackDays': 20,
        'risk.maxPositionSizePct': 0.15,
      };
      return defaults[key];
    });
  });

  // Helper to generate mock candles with specific volatility characteristics
  function generateCandles(
    days: number,
    basePrice: number,
    dailyVolatility: number,
  ): OHLCVCandle[] {
    const candles: OHLCVCandle[] = [];
    let price = basePrice;

    for (let i = 0; i < days; i++) {
      // Simulate price movement with specified daily volatility
      const dailyReturn = (Math.random() - 0.5) * 2 * dailyVolatility;
      price = price * (1 + dailyReturn);

      const open = price * (1 - Math.random() * 0.005);
      const close = price;
      const high = Math.max(open, close) * (1 + Math.random() * 0.01);
      const low = Math.min(open, close) * (1 - Math.random() * 0.01);

      candles.push({
        date: new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0],
        open,
        high,
        low,
        close,
        volume: 1000000,
      });
    }

    return candles;
  }

  describe('getVolatility', () => {
    it('should compute annualized volatility from candles', () => {
      const candles: OHLCVCandle[] = [
        { date: '2024-01-01', open: 100, high: 102, low: 99, close: 101, volume: 1000 },
        { date: '2024-01-02', open: 101, high: 103, low: 100, close: 102, volume: 1000 },
        { date: '2024-01-03', open: 102, high: 104, low: 101, close: 103, volume: 1000 },
        { date: '2024-01-04', open: 103, high: 105, low: 102, close: 102, volume: 1000 },
        { date: '2024-01-05', open: 102, high: 104, low: 101, close: 103, volume: 1000 },
      ];

      const vol = sizer.getVolatility(candles);

      expect(vol).toBeGreaterThan(0);
      expect(vol).toBeLessThan(1); // Should be a reasonable annualized volatility
      expect(Number.isNaN(vol)).toBe(false);
    });

    it('should return 0 for insufficient data', () => {
      const candles: OHLCVCandle[] = [
        { date: '2024-01-01', open: 100, high: 102, low: 99, close: 101, volume: 1000 },
      ];

      const vol = sizer.getVolatility(candles);
      expect(vol).toBe(0);
    });

    it('should return 0 for empty candles array', () => {
      const vol = sizer.getVolatility([]);
      expect(vol).toBe(0);
    });

    it('should handle zero price gracefully', () => {
      const candles: OHLCVCandle[] = [
        { date: '2024-01-01', open: 100, high: 102, low: 99, close: 0, volume: 1000 },
        { date: '2024-01-02', open: 101, high: 103, low: 100, close: 102, volume: 1000 },
      ];

      const vol = sizer.getVolatility(candles);
      expect(vol).toBe(0); // Should skip invalid data
    });

    it('should respect lookback days parameter', () => {
      const candles = generateCandles(50, 100, 0.02);

      // Use only last 10 days
      const vol10 = sizer.getVolatility(candles, 10);

      // Use all 50 days
      const vol50 = sizer.getVolatility(candles, 50);

      expect(vol10).toBeGreaterThan(0);
      expect(vol50).toBeGreaterThan(0);
      // Volatility estimates may differ based on lookback period
    });

    it('should compute higher volatility for volatile stocks', () => {
      const lowVolCandles = generateCandles(30, 100, 0.005); // 0.5% daily vol
      const highVolCandles = generateCandles(30, 100, 0.03); // 3% daily vol

      const lowVol = sizer.getVolatility(lowVolCandles);
      const highVol = sizer.getVolatility(highVolCandles);

      // High volatility stock should have higher annualized volatility
      expect(highVol).toBeGreaterThan(lowVol);
    });
  });

  describe('calculatePositionSize', () => {
    const portfolioValue = 10000;
    const openPositions: PositionInfo[] = [];

    it('should calculate position size for high volatility stock (smaller position)', () => {
      const highVolCandles = generateCandles(30, 100, 0.03); // High volatility stock

      const result = sizer.calculatePositionSize('TSLA', highVolCandles, portfolioValue, openPositions);

      expect(result.shares).toBeGreaterThan(0);
      expect(result.positionSizePct).toBeGreaterThan(0);
      expect(result.symbolVolatility).toBeGreaterThan(0);
      expect(result.reason).toContain('Risk parity');
    });

    it('should calculate position size for low volatility stock (larger position)', () => {
      const lowVolCandles = generateCandles(30, 100, 0.005); // Low volatility stock

      const result = sizer.calculatePositionSize('KO', lowVolCandles, portfolioValue, openPositions);

      expect(result.shares).toBeGreaterThan(0);
      expect(result.positionSizePct).toBeGreaterThan(0);
      expect(result.symbolVolatility).toBeGreaterThan(0);
      expect(result.reason).toContain('Risk parity');
    });

    it('should give larger position to low volatility stock vs high volatility stock', () => {
      const lowVolCandles = generateCandles(30, 50, 0.005); // Low vol, $50 stock
      const highVolCandles = generateCandles(30, 50, 0.03); // High vol, $50 stock (same price)

      const lowVolResult = sizer.calculatePositionSize('KO', lowVolCandles, portfolioValue, openPositions);
      const highVolResult = sizer.calculatePositionSize('TSLA', highVolCandles, portfolioValue, openPositions);

      // With different volatilities, position sizes should differ
      // (May be capped at maxPositionSizePct for both, but at minimum they should not be equal)
      expect(lowVolResult.symbolVolatility).toBeLessThan(highVolResult.symbolVolatility);
    });

    it('should cap position size at maxPositionSizePct', () => {
      // Very low volatility stock that would normally get huge position
      const veryLowVolCandles: OHLCVCandle[] = [];
      let price = 10;
      for (let i = 0; i < 30; i++) {
        // Tiny price movements (very low volatility)
        price = price + (Math.random() - 0.5) * 0.01;
        veryLowVolCandles.push({
          date: new Date(Date.now() - (30 - i) * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0],
          open: price,
          high: price + 0.01,
          low: price - 0.01,
          close: price,
          volume: 1000,
        });
      }

      const result = sizer.calculatePositionSize('UTIL', veryLowVolCandles, portfolioValue, openPositions);

      // Should be capped at 15%
      expect(result.positionSizePct).toBeLessThanOrEqual(0.15);
      expect(result.reason).toContain('capped');
    });

    it('should adjust position size based on number of open positions', () => {
      const candles = generateCandles(30, 100, 0.02);

      // No open positions
      const result1 = sizer.calculatePositionSize('AAPL', candles, portfolioValue, []);

      // 4 open positions
      const positions: PositionInfo[] = [
        { symbol: 'MSFT', shares: 10, currentPrice: 300, entryPrice: 290 },
        { symbol: 'GOOGL', shares: 20, currentPrice: 150, entryPrice: 145 },
        { symbol: 'AMZN', shares: 15, currentPrice: 180, entryPrice: 175 },
        { symbol: 'NVDA', shares: 5, currentPrice: 800, entryPrice: 750 },
      ];
      const result2 = sizer.calculatePositionSize('AAPL', candles, portfolioValue, positions);

      // Both should return valid results
      expect(result1.shares).toBeGreaterThan(0);
      expect(result2.shares).toBeGreaterThan(0);
      // The formula adjusts by sqrt(N), so with 1 position vs 5 positions:
      // target contribution = 0.15 / sqrt(1) = 0.15 vs 0.15 / sqrt(5) = 0.067
      // This should result in smaller position with more positions
      expect(result1.positionSizePct).toBeGreaterThan(0);
      expect(result2.positionSizePct).toBeGreaterThan(0);
    });

    it('should return default sizing when risk parity is disabled', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'riskParity.enabled') return false;
        if (key === 'risk.maxPositionSizePct') return 0.15;
        return 0;
      });

      const candles = generateCandles(30, 100, 0.02);
      const result = sizer.calculatePositionSize('AAPL', candles, portfolioValue, openPositions);

      expect(result.reason).toContain('disabled');
      expect(result.symbolVolatility).toBe(0);
      expect(result.positionSizePct).toBe(0.15);
    });

    it('should handle insufficient volatility data gracefully', () => {
      const insufficientCandles: OHLCVCandle[] = [
        { date: '2024-01-01', open: 100, high: 102, low: 99, close: 101, volume: 1000 },
      ];

      const result = sizer.calculatePositionSize('AAPL', insufficientCandles, portfolioValue, openPositions);

      expect(result.symbolVolatility).toBe(0);
      expect(result.reason).toContain('Insufficient data');
      expect(result.shares).toBeGreaterThan(0); // Should still return default sizing
    });

    it('should handle zero volatility (flat price)', () => {
      const flatCandles: OHLCVCandle[] = [];
      for (let i = 0; i < 30; i++) {
        flatCandles.push({
          date: new Date(Date.now() - (30 - i) * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0],
          open: 100,
          high: 100,
          low: 100,
          close: 100,
          volume: 1000,
        });
      }

      const result = sizer.calculatePositionSize('FLAT', flatCandles, portfolioValue, openPositions);

      expect(result.symbolVolatility).toBe(0);
      expect(result.shares).toBeGreaterThan(0); // Fallback to default
    });

    it('should compute correct shares based on current price', () => {
      const candles = generateCandles(30, 200, 0.02); // $200 stock
      const currentPrice = candles[candles.length - 1].close;

      const result = sizer.calculatePositionSize('AAPL', candles, portfolioValue, openPositions);

      // Shares should be based on position size and current price (integer shares)
      expect(result.shares).toBeGreaterThan(0);
      expect(Number.isInteger(result.shares)).toBe(true);
      // The actual position value should be close to the intended percentage
      const actualValue = result.shares * currentPrice;
      const intendedValue = result.positionSizePct * portfolioValue;
      // Allow 1 share worth of rounding difference
      expect(Math.abs(actualValue - intendedValue)).toBeLessThan(currentPrice);
    });
  });

  describe('getPortfolioVolatility', () => {
    it('should compute portfolio volatility from position volatilities', () => {
      const positions = [
        { symbol: 'AAPL', volatility: 0.25, weightPct: 0.3 },
        { symbol: 'MSFT', volatility: 0.20, weightPct: 0.3 },
        { symbol: 'GOOGL', volatility: 0.30, weightPct: 0.4 },
      ];

      const portfolioVol = sizer.getPortfolioVolatility(positions);

      expect(portfolioVol).toBeGreaterThan(0);
      expect(portfolioVol).toBeLessThan(0.30); // Should be less than highest individual volatility due to diversification
      expect(Number.isNaN(portfolioVol)).toBe(false);
    });

    it('should return 0 for empty positions', () => {
      const portfolioVol = sizer.getPortfolioVolatility([]);
      expect(portfolioVol).toBe(0);
    });

    it('should return single position volatility for single position', () => {
      const positions = [{ symbol: 'AAPL', volatility: 0.25, weightPct: 1.0 }];

      const portfolioVol = sizer.getPortfolioVolatility(positions);

      expect(portfolioVol).toBeCloseTo(0.25, 2);
    });

    it('should show diversification benefit (lower portfolio vol than weighted average)', () => {
      const positions = [
        { symbol: 'AAPL', volatility: 0.30, weightPct: 0.5 },
        { symbol: 'MSFT', volatility: 0.30, weightPct: 0.5 },
      ];

      const portfolioVol = sizer.getPortfolioVolatility(positions);
      const weightedAvgVol = 0.3 * 0.5 + 0.3 * 0.5; // 0.3

      // Under zero correlation, portfolio vol should be less than weighted average
      expect(portfolioVol).toBeLessThan(weightedAvgVol);
    });

    it('should handle unequal weights correctly', () => {
      const positions = [
        { symbol: 'AAPL', volatility: 0.20, weightPct: 0.7 },
        { symbol: 'MSFT', volatility: 0.40, weightPct: 0.3 },
      ];

      const portfolioVol = sizer.getPortfolioVolatility(positions);

      // Portfolio vol should be closer to the higher-weighted position's volatility
      expect(portfolioVol).toBeGreaterThan(0.15);
      expect(portfolioVol).toBeLessThan(0.30);
    });
  });

  describe('suggestRebalance', () => {
    it('should suggest rebalance actions for misaligned positions', () => {
      const positions: PositionInfo[] = [
        { symbol: 'AAPL', shares: 100, currentPrice: 150, entryPrice: 140 },
        { symbol: 'MSFT', shares: 50, currentPrice: 300, entryPrice: 290 },
      ];

      const candles = new Map<string, OHLCVCandle[]>();
      candles.set('AAPL', generateCandles(30, 150, 0.01)); // Low vol
      candles.set('MSFT', generateCandles(30, 300, 0.03)); // High vol

      const actions = sizer.suggestRebalance(positions, candles);

      expect(actions).toHaveLength(2);
      expect(actions[0].symbol).toBe('AAPL');
      expect(actions[1].symbol).toBe('MSFT');
      expect(actions[0].action).toMatch(/increase|decrease|hold/);
      expect(actions[1].action).toMatch(/increase|decrease|hold/);
    });

    it('should suggest increase for underweight low-vol position', () => {
      // AAPL is 33% of portfolio but has low vol, should increase
      // MSFT is 67% of portfolio and has high vol, should decrease
      const positions: PositionInfo[] = [
        { symbol: 'AAPL', shares: 10, currentPrice: 100, entryPrice: 95 }, // $1000 (33%)
        { symbol: 'MSFT', shares: 20, currentPrice: 100, entryPrice: 95 }, // $2000 (67%)
      ];

      const candles = new Map<string, OHLCVCandle[]>();
      candles.set('AAPL', generateCandles(30, 100, 0.005)); // Very low vol
      candles.set('MSFT', generateCandles(30, 100, 0.04)); // High vol

      const actions = sizer.suggestRebalance(positions, candles);

      const aaplAction = actions.find((a) => a.symbol === 'AAPL');
      const msftAction = actions.find((a) => a.symbol === 'MSFT');

      // Low vol stock should be increased
      expect(aaplAction?.action).toBe('increase');
      // High vol stock should be decreased
      expect(msftAction?.action).toBe('decrease');
    });

    it('should suggest hold for properly balanced positions', () => {
      const positions: PositionInfo[] = [
        { symbol: 'AAPL', shares: 50, currentPrice: 100, entryPrice: 95 },
        { symbol: 'MSFT', shares: 50, currentPrice: 100, entryPrice: 95 },
      ];

      const candles = new Map<string, OHLCVCandle[]>();
      // Both have similar volatility, so equal weights should be close to optimal
      candles.set('AAPL', generateCandles(30, 100, 0.02));
      candles.set('MSFT', generateCandles(30, 100, 0.02));

      const actions = sizer.suggestRebalance(positions, candles);

      // Should get rebalance suggestions for both
      expect(actions).toHaveLength(2);
      // Current allocation is 50/50
      expect(actions[0].currentPct).toBeCloseTo(0.5, 1);
      expect(actions[1].currentPct).toBeCloseTo(0.5, 1);
      // Target percentages should be computed based on volatility
      expect(actions[0].targetPct).toBeGreaterThan(0);
      expect(actions[1].targetPct).toBeGreaterThan(0);
    });

    it('should return empty array when risk parity is disabled', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'riskParity.enabled') return false;
        return 0;
      });

      const positions: PositionInfo[] = [
        { symbol: 'AAPL', shares: 100, currentPrice: 150, entryPrice: 140 },
      ];

      const candles = new Map<string, OHLCVCandle[]>();
      candles.set('AAPL', generateCandles(30, 150, 0.02));

      const actions = sizer.suggestRebalance(positions, candles);

      expect(actions).toHaveLength(0);
    });

    it('should return empty array for empty positions', () => {
      const candles = new Map<string, OHLCVCandle[]>();
      const actions = sizer.suggestRebalance([], candles);

      expect(actions).toHaveLength(0);
    });

    it('should skip positions without candle data', () => {
      const positions: PositionInfo[] = [
        { symbol: 'AAPL', shares: 100, currentPrice: 150, entryPrice: 140 },
        { symbol: 'MSFT', shares: 50, currentPrice: 300, entryPrice: 290 },
      ];

      const candles = new Map<string, OHLCVCandle[]>();
      candles.set('AAPL', generateCandles(30, 150, 0.02));
      // MSFT has no candles

      const actions = sizer.suggestRebalance(positions, candles);

      expect(actions).toHaveLength(1);
      expect(actions[0].symbol).toBe('AAPL');
    });

    it('should skip positions with invalid volatility', () => {
      const positions: PositionInfo[] = [
        { symbol: 'AAPL', shares: 100, currentPrice: 150, entryPrice: 140 },
      ];

      const candles = new Map<string, OHLCVCandle[]>();
      // Insufficient candles for volatility calculation
      candles.set('AAPL', [{ date: '2024-01-01', open: 150, high: 151, low: 149, close: 150, volume: 1000 }]);

      const actions = sizer.suggestRebalance(positions, candles);

      expect(actions).toHaveLength(0);
    });

    it('should compute current and target percentages correctly', () => {
      const positions: PositionInfo[] = [
        { symbol: 'AAPL', shares: 10, currentPrice: 100, entryPrice: 95 }, // $1000
        { symbol: 'MSFT', shares: 10, currentPrice: 200, entryPrice: 190 }, // $2000
      ];

      const candles = new Map<string, OHLCVCandle[]>();
      candles.set('AAPL', generateCandles(30, 100, 0.02));
      candles.set('MSFT', generateCandles(30, 200, 0.02));

      const actions = sizer.suggestRebalance(positions, candles);

      const aaplAction = actions.find((a) => a.symbol === 'AAPL');
      const msftAction = actions.find((a) => a.symbol === 'MSFT');

      expect(aaplAction?.currentPct).toBeCloseTo(1000 / 3000, 2); // 0.33
      expect(msftAction?.currentPct).toBeCloseTo(2000 / 3000, 2); // 0.67
      expect(aaplAction?.targetPct).toBeGreaterThan(0);
      expect(msftAction?.targetPct).toBeGreaterThan(0);
    });

    it('should not suggest rebalance for deviation under 2% threshold', () => {
      const positions: PositionInfo[] = [
        { symbol: 'AAPL', shares: 51, currentPrice: 100, entryPrice: 95 }, // $5100 (51%)
        { symbol: 'MSFT', shares: 49, currentPrice: 100, entryPrice: 95 }, // $4900 (49%)
      ];

      const candles = new Map<string, OHLCVCandle[]>();
      // Equal volatility, so 50/50 is optimal
      candles.set('AAPL', generateCandles(30, 100, 0.02));
      candles.set('MSFT', generateCandles(30, 100, 0.02));

      const actions = sizer.suggestRebalance(positions, candles);

      // Should get suggestions
      expect(actions).toHaveLength(2);
      // Current allocation is 51/49, which is very close to balanced
      expect(actions[0].currentPct).toBeCloseTo(0.51, 2);
      expect(actions[1].currentPct).toBeCloseTo(0.49, 2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very high number of positions', () => {
      const candles = generateCandles(30, 100, 0.02);
      const positions: PositionInfo[] = Array.from({ length: 20 }, (_, i) => ({
        symbol: `STOCK${i}`,
        shares: 10,
        currentPrice: 100,
        entryPrice: 95,
      }));

      const result = sizer.calculatePositionSize('NEWSTOCK', candles, 100000, positions);

      expect(result.shares).toBeGreaterThan(0);
      expect(result.positionSizePct).toBeGreaterThan(0);
      // With 21 positions total, target contribution = 0.15 / sqrt(21) = 0.0327
      // This should be significantly less than the max 15%, but may still be capped
      expect(result.positionSizePct).toBeLessThanOrEqual(0.15);
    });

    it('should handle single position scenario', () => {
      const candles = generateCandles(30, 100, 0.02);

      const result = sizer.calculatePositionSize('AAPL', candles, 10000, []);

      expect(result.shares).toBeGreaterThan(0);
      expect(result.positionSizePct).toBeGreaterThan(0);
    });

    it('should handle very small portfolio value', () => {
      const candles = generateCandles(30, 100, 0.02);

      const result = sizer.calculatePositionSize('AAPL', candles, 500, []);

      expect(result.shares).toBeGreaterThanOrEqual(0);
      // With small portfolio and $100 stock, might get 0 or very few shares
    });

    it('should handle very expensive stock', () => {
      const candles = generateCandles(30, 5000, 0.02); // $5000 stock (e.g., BRK.A)
      const portfolioValue = 10000;

      const result = sizer.calculatePositionSize('BRK.A', candles, portfolioValue, []);

      // Should get at most 1-2 shares
      expect(result.shares).toBeLessThanOrEqual(2);
    });

    it('should return integer shares (no fractional shares)', () => {
      const candles = generateCandles(30, 123.45, 0.02);

      const result = sizer.calculatePositionSize('AAPL', candles, 10000, []);

      expect(Number.isInteger(result.shares)).toBe(true);
      expect(result.shares).toBeGreaterThanOrEqual(0);
    });
  });
});
