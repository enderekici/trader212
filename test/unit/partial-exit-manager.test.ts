import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trading212Client } from '../../src/api/trading212/client.js';
import { getPartialExitManager, PartialExitManager } from '../../src/execution/partial-exit-manager.js';

// Mock dependencies
vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn(),
  },
}));

vi.mock('../../src/db/index.js', () => ({
  getDb: vi.fn(),
}));

vi.mock('../../src/db/repositories/orders.js', () => ({
  createOrder: vi.fn(() => 1),
  updateOrderStatus: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

vi.mock('../../src/utils/helpers.js', () => ({
  sleep: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../src/db/schema.js', () => ({
  positions: {
    symbol: 'symbol',
  },
  trades: {},
}));

const { configManager } = await import('../../src/config/manager.js');
const { getDb } = await import('../../src/db/index.js');
const { createOrder, updateOrderStatus } = await import('../../src/db/repositories/orders.js');
const { sleep } = await import('../../src/utils/helpers.js');

describe('PartialExitManager', () => {
  let manager: PartialExitManager;
  let mockDb: any;
  let mockT212Client: Trading212Client;

  const createMockPosition = (overrides = {}) => ({
    id: 1,
    symbol: 'AAPL',
    t212Ticker: 'AAPL_US_EQ',
    shares: 100,
    entryPrice: 100,
    entryTime: '2024-01-01T10:00:00Z',
    currentPrice: 110,
    pnl: 1000,
    pnlPct: 0.1,
    stopLoss: 95,
    trailingStop: null,
    takeProfit: 120,
    convictionScore: 0.8,
    stopOrderId: 'stop123',
    takeProfitOrderId: 'tp123',
    aiExitConditions: null,
    accountType: 'INVEST' as const,
    dcaCount: 0,
    totalInvested: null,
    partialExitCount: 0,
    updatedAt: '2024-01-01T10:00:00Z',
    ...overrides,
  });

  beforeEach(() => {
    manager = new PartialExitManager();

    // Mock database
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      get: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      run: vi.fn(),
      transaction: vi.fn((fn) => fn(mockDb)),
      values: vi.fn().mockReturnThis(),
    };

    vi.mocked(getDb).mockReturnValue(mockDb);

    // Mock T212 client
    mockT212Client = {
      placeMarketOrder: vi.fn(),
      placeStopOrder: vi.fn(),
      cancelOrder: vi.fn(),
      getOrder: vi.fn(),
    } as any;

    manager.setT212Client(mockT212Client);

    // Default config
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      const defaults: Record<string, any> = {
        'partialExit.enabled': true,
        'partialExit.tiers': [
          { pctGain: 0.05, sellPct: 0.5 },
          { pctGain: 0.1, sellPct: 0.25 },
        ],
        'partialExit.moveStopToBreakeven': true,
        'execution.dryRun': true,
        'execution.orderTimeoutSeconds': 10,
        'execution.stopLossDelay': 3000,
      };
      return defaults[key];
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('evaluatePosition', () => {
    it('should return shouldExit=false when feature is disabled', () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'partialExit.enabled') return false;
        return true;
      });

      const position = createMockPosition();
      const result = manager.evaluatePosition(position);

      expect(result.shouldExit).toBe(false);
      expect(result.reason).toBe('Partial exits disabled');
    });

    it('should return shouldExit=false when current price is null', () => {
      const position = createMockPosition({ currentPrice: null });
      const result = manager.evaluatePosition(position);

      expect(result.shouldExit).toBe(false);
      expect(result.reason).toBe('No current price available');
    });

    it('should return shouldExit=false when position is not profitable', () => {
      const position = createMockPosition({ currentPrice: 95 }); // Below entry price
      const result = manager.evaluatePosition(position);

      expect(result.shouldExit).toBe(false);
      expect(result.reason).toBe('Position not profitable');
    });

    it('should trigger first tier when 5% gain is reached', () => {
      const position = createMockPosition({
        entryPrice: 100,
        currentPrice: 105, // 5% gain
        shares: 100,
        partialExitCount: 0,
      });

      const result = manager.evaluatePosition(position);

      expect(result.shouldExit).toBe(true);
      expect(result.tier).toEqual({ pctGain: 0.05, sellPct: 0.5 });
      expect(result.sharesToSell).toBe(50); // 50% of 100 shares
      expect(result.reason).toContain('Tier 1');
    });

    it('should trigger second tier when 10% gain is reached and first tier already executed', () => {
      const position = createMockPosition({
        entryPrice: 100,
        currentPrice: 110, // 10% gain
        shares: 50, // Already sold 50 shares in first tier
        partialExitCount: 1,
      });

      const result = manager.evaluatePosition(position);

      expect(result.shouldExit).toBe(true);
      expect(result.tier).toEqual({ pctGain: 0.1, sellPct: 0.25 });
      expect(result.sharesToSell).toBe(12); // 25% of 50 shares (floor)
      expect(result.reason).toContain('Tier 2');
    });

    it('should not trigger tier if gain threshold not reached', () => {
      const position = createMockPosition({
        entryPrice: 100,
        currentPrice: 104, // 4% gain (below 5% threshold)
        shares: 100,
        partialExitCount: 0,
      });

      const result = manager.evaluatePosition(position);

      expect(result.shouldExit).toBe(false);
      expect(result.reason).toContain('Next tier (1) requires 5.0% gain');
    });

    it('should return shouldExit=false when all tiers already executed', () => {
      const position = createMockPosition({
        currentPrice: 120,
        partialExitCount: 2, // Both tiers executed
      });

      const result = manager.evaluatePosition(position);

      expect(result.shouldExit).toBe(false);
      expect(result.reason).toBe('All partial exit tiers already executed');
    });

    it('should not sell if calculated shares is less than 1', () => {
      const position = createMockPosition({
        entryPrice: 100,
        currentPrice: 105,
        shares: 1, // Only 1 share, 50% would be 0.5 shares
        partialExitCount: 0,
      });

      const result = manager.evaluatePosition(position);

      expect(result.shouldExit).toBe(false);
      expect(result.reason).toContain('calculated shares to sell (0) is less than 1');
    });

    it('should not sell if it would sell all shares', () => {
      const position = createMockPosition({
        entryPrice: 100,
        currentPrice: 105,
        shares: 2,
        partialExitCount: 0,
      });

      // With 50% sellPct and 2 shares, floor(2 * 0.5) = 1, which is fine
      // But let's test with 100% tier
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'partialExit.tiers') {
          return [{ pctGain: 0.05, sellPct: 1.0 }]; // 100% sell would close position
        }
        return true;
      });

      const result = manager.evaluatePosition(position);

      expect(result.shouldExit).toBe(false);
      expect(result.reason).toContain('would sell all shares');
    });

    it('should handle fractional shares correctly using floor', () => {
      const position = createMockPosition({
        entryPrice: 100,
        currentPrice: 105,
        shares: 10,
        partialExitCount: 0,
      });

      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'partialExit.tiers') {
          return [{ pctGain: 0.05, sellPct: 0.33 }]; // 33% of 10 = 3.3, should floor to 3
        }
        return true;
      });

      const result = manager.evaluatePosition(position);

      expect(result.shouldExit).toBe(true);
      expect(result.sharesToSell).toBe(3); // floor(10 * 0.33) = 3
    });

    it('should work with very small positions', () => {
      const position = createMockPosition({
        entryPrice: 100,
        currentPrice: 105,
        shares: 3,
        partialExitCount: 0,
      });

      const result = manager.evaluatePosition(position);

      expect(result.shouldExit).toBe(true);
      expect(result.sharesToSell).toBe(1); // floor(3 * 0.5) = 1
      expect(result.tier?.sellPct).toBe(0.5);
    });

    it('should handle exact gain threshold', () => {
      const position = createMockPosition({
        entryPrice: 100,
        currentPrice: 105.0, // Exactly 5% gain
        shares: 100,
        partialExitCount: 0,
      });

      const result = manager.evaluatePosition(position);

      expect(result.shouldExit).toBe(true);
      expect(result.tier?.pctGain).toBe(0.05);
    });

    it('should skip to second tier if first already executed and gain is sufficient', () => {
      const position = createMockPosition({
        entryPrice: 100,
        currentPrice: 110, // 10% gain
        shares: 50,
        partialExitCount: 1, // First tier already done
      });

      const result = manager.evaluatePosition(position);

      expect(result.shouldExit).toBe(true);
      expect(result.tier?.pctGain).toBe(0.1); // Second tier
    });
  });

  describe('getRemainingTiers', () => {
    it('should return all tiers when none executed', () => {
      const position = createMockPosition({ partialExitCount: 0 });
      const remaining = manager.getRemainingTiers(position);

      expect(remaining).toEqual([
        { pctGain: 0.05, sellPct: 0.5 },
        { pctGain: 0.1, sellPct: 0.25 },
      ]);
    });

    it('should return only second tier when first is executed', () => {
      const position = createMockPosition({ partialExitCount: 1 });
      const remaining = manager.getRemainingTiers(position);

      expect(remaining).toEqual([{ pctGain: 0.1, sellPct: 0.25 }]);
    });

    it('should return empty array when all tiers executed', () => {
      const position = createMockPosition({ partialExitCount: 2 });
      const remaining = manager.getRemainingTiers(position);

      expect(remaining).toEqual([]);
    });

    it('should handle null partialExitCount as 0', () => {
      const position = createMockPosition({ partialExitCount: null });
      const remaining = manager.getRemainingTiers(position);

      expect(remaining).toEqual([
        { pctGain: 0.05, sellPct: 0.5 },
        { pctGain: 0.1, sellPct: 0.25 },
      ]);
    });
  });

  describe('executePartialExit - dry run', () => {
    beforeEach(() => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        const defaults: Record<string, any> = {
          'partialExit.enabled': true,
          'partialExit.moveStopToBreakeven': true,
          'execution.dryRun': true,
          'execution.orderTimeoutSeconds': 10,
        };
        return defaults[key];
      });
    });

    it('should execute partial exit in dry-run mode', async () => {
      const position = createMockPosition({
        symbol: 'AAPL',
        shares: 100,
        entryPrice: 100,
        currentPrice: 105,
        partialExitCount: 0,
        stopLoss: 95,
      });

      mockDb.get.mockReturnValue(position);

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1: 5.0% gain reached', 'INVEST');

      expect(result.success).toBe(true);
      expect(result.sharesToSell).toBe(50);
      expect(result.newStopLoss).toBe(100); // Moved to breakeven

      // Verify trade was recorded
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalled();

      // Verify position was updated
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should move stop to breakeven on first partial exit', async () => {
      const position = createMockPosition({
        shares: 100,
        entryPrice: 100,
        currentPrice: 105,
        partialExitCount: 0,
        stopLoss: 95,
      });

      mockDb.get.mockReturnValue(position);

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(result.success).toBe(true);
      expect(result.newStopLoss).toBe(100); // Entry price
    });

    it('should not move stop to breakeven on second partial exit', async () => {
      const position = createMockPosition({
        shares: 50,
        entryPrice: 100,
        currentPrice: 110,
        partialExitCount: 1, // Already did first partial exit
        stopLoss: 100,
      });

      mockDb.get.mockReturnValue(position);

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 12, 'Tier 2', 'INVEST');

      expect(result.success).toBe(true);
      expect(result.newStopLoss).toBe(100); // Unchanged
    });

    it('should not move stop if moveStopToBreakeven is disabled', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'partialExit.moveStopToBreakeven') return false;
        if (key === 'execution.dryRun') return true;
        return true;
      });

      const position = createMockPosition({
        shares: 100,
        entryPrice: 100,
        currentPrice: 105,
        partialExitCount: 0,
        stopLoss: 95,
      });

      mockDb.get.mockReturnValue(position);

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(result.success).toBe(true);
      expect(result.newStopLoss).toBe(95); // Unchanged
    });

    it('should return error if no position found', async () => {
      mockDb.get.mockReturnValue(null);

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Test', 'INVEST');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No position for AAPL');
    });

    it('should return error if trying to sell all shares', async () => {
      const position = createMockPosition({
        shares: 50,
      });

      mockDb.get.mockReturnValue(position);

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Test', 'INVEST');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot sell 50 shares');
    });

    it('should return error if trying to sell more shares than available', async () => {
      const position = createMockPosition({
        shares: 40,
      });

      mockDb.get.mockReturnValue(position);

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Test', 'INVEST');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot sell 50 shares (total: 40)');
    });

    it('should create order record with partial_exit tag', async () => {
      const position = createMockPosition({ shares: 100 });
      mockDb.get.mockReturnValue(position);

      await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          orderTag: 'partial_exit',
          side: 'SELL',
          requestedQuantity: 50,
        }),
      );
    });

    it('should increment partialExitCount', async () => {
      const position = createMockPosition({
        shares: 100,
        partialExitCount: 0,
      });

      mockDb.get.mockReturnValue(position);

      await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      // Check that update was called with incremented count
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          partialExitCount: 1,
        }),
      );
    });
  });

  describe('executePartialExit - live execution', () => {
    beforeEach(() => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        const defaults: Record<string, any> = {
          'partialExit.enabled': true,
          'partialExit.moveStopToBreakeven': true,
          'execution.dryRun': false, // Live mode
          'execution.orderTimeoutSeconds': 10,
          'execution.stopLossDelay': 3000,
        };
        return defaults[key];
      });

      // Mock successful order fill
      vi.mocked(mockT212Client.placeMarketOrder).mockResolvedValue({ id: 12345 } as any);
      vi.mocked(mockT212Client.placeStopOrder).mockResolvedValue({ id: 67890 } as any);
      vi.mocked(mockT212Client.getOrder).mockResolvedValue({
        status: 'FILLED',
        filledValue: 5250, // 50 shares * 105
        filledQuantity: 50,
      } as any);
    });

    it('should execute partial exit in live mode', async () => {
      const position = createMockPosition({
        shares: 100,
        entryPrice: 100,
        currentPrice: 105,
        partialExitCount: 0,
        stopOrderId: 'old-stop-123',
      });

      mockDb.get.mockReturnValue(position);

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(result.success).toBe(true);
      expect(result.sharesToSell).toBe(50);
      expect(result.newStopLoss).toBe(100);

      // Verify T212 calls
      expect(mockT212Client.placeMarketOrder).toHaveBeenCalledWith({
        ticker: 'AAPL_US_EQ',
        quantity: 50,
        timeValidity: 'DAY',
      });

      // Should cancel old stop and place new one at breakeven
      expect(mockT212Client.cancelOrder).toHaveBeenCalledWith(Number('old-stop-123'));
      expect(sleep).toHaveBeenCalledWith(3000);
      expect(mockT212Client.placeStopOrder).toHaveBeenCalledWith({
        ticker: 'AAPL_US_EQ',
        quantity: 50, // Remaining shares
        stopPrice: 100,
        timeValidity: 'GTC',
      });
    });

    it('should handle order timeout', async () => {
      const position = createMockPosition({ shares: 100 });
      mockDb.get.mockReturnValue(position);

      // Mock order never fills
      vi.mocked(mockT212Client.getOrder).mockResolvedValue({
        status: 'NEW',
      } as any);

      vi.mocked(mockT212Client.cancelOrder).mockResolvedValue(undefined);

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Partial exit order fill timeout');
    });

    it('should return error if T212 client not set', async () => {
      const managerNoClient = new PartialExitManager();

      const position = createMockPosition({ shares: 100 });
      mockDb.get.mockReturnValue(position);

      const result = await managerNoClient.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(result.success).toBe(false);
      expect(result.error).toBe('T212 client not initialized');
    });

    it('should handle order placement failure', async () => {
      const position = createMockPosition({ shares: 100 });
      mockDb.get.mockReturnValue(position);

      vi.mocked(mockT212Client.placeMarketOrder).mockRejectedValue(new Error('API error'));

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(result.success).toBe(false);
      expect(result.error).toBe('API error');

      // Verify order marked as failed
      expect(updateOrderStatus).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({
          status: 'failed',
          cancelReason: 'API error',
        }),
      );
    });
  });

  describe('getPartialExitManager singleton', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getPartialExitManager();
      const instance2 = getPartialExitManager();

      expect(instance1).toBe(instance2);
    });
  });
});
