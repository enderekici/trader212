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
  and: vi.fn((...args: unknown[]) => ({ args, type: 'and' })),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, type: 'sql' }),
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
    exitConditions: null,
    accountType: 'INVEST' as const,
    dcaCount: 0,
    totalInvested: null,
    partialExitCount: 0,
    version: 1,
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
      run: vi.fn().mockReturnValue({ changes: 1 }),
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

    it('should treat null partialExitCount as 0 when incrementing (line 420 ?? branch)', async () => {
      const position = createMockPosition({
        shares: 100,
        partialExitCount: null, // triggers (null ?? 0) + 1 = 1
        entryPrice: 100,
        currentPrice: 105,
        stopLoss: 95,
      });

      mockDb.get.mockReturnValue(position);

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(result.success).toBe(true);
      // Verify update was called with partialExitCount = 0 + 1 = 1
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          partialExitCount: 1,
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
      });

      // Should cancel old stop and place new one at breakeven
      expect(mockT212Client.cancelOrder).toHaveBeenCalledWith(Number('old-stop-123'));
      expect(sleep).toHaveBeenCalledWith(3000);
      expect(mockT212Client.placeStopOrder).toHaveBeenCalledWith({
        ticker: 'AAPL_US_EQ',
        quantity: 50, // Remaining shares
        stopPrice: 100,
        timeValidity: 'GOOD_TILL_CANCEL',
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

    it('continues (warns) when cancelling old stop order fails during moveToBreakeven', async () => {
      // Covers line 346: catch block when cancelOrder throws for the old stop
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        const defaults: Record<string, any> = {
          'partialExit.enabled': true,
          'partialExit.moveStopToBreakeven': true,
          'execution.dryRun': false,
          'execution.orderTimeoutSeconds': 10,
          'execution.stopLossDelay': 0,
        };
        return defaults[key];
      });

      const position = createMockPosition({
        shares: 100,
        entryPrice: 100,
        currentPrice: 105,
        partialExitCount: 0,
        stopOrderId: 'old-stop-456',
      });
      mockDb.get.mockReturnValue(position);

      vi.mocked(mockT212Client.placeMarketOrder).mockResolvedValue({ id: 8001 } as any);
      vi.mocked(mockT212Client.getOrder).mockResolvedValue({
        status: 'FILLED',
        filledValue: 5250,
        filledQuantity: 50,
      } as any);
      // cancelOrder throws — should be caught and logged as warn, not propagated
      vi.mocked(mockT212Client.cancelOrder).mockRejectedValue(new Error('Cancel failed'));
      // placeStopOrder succeeds for the new breakeven stop
      vi.mocked(mockT212Client.placeStopOrder).mockResolvedValue({ id: 8002 } as any);

      mockDb.run.mockReturnValue({ lastInsertRowid: 1n });

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      // Should still succeed overall (cancel failure is non-fatal)
      expect(result.success).toBe(true);
      expect(result.newStopLoss).toBe(100); // Moved to breakeven
    });

    it('continues (logs error) when placing new breakeven stop-loss fails', async () => {
      // Covers line 389: catch block when placeStopOrder throws for the new stop
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        const defaults: Record<string, any> = {
          'partialExit.enabled': true,
          'partialExit.moveStopToBreakeven': true,
          'execution.dryRun': false,
          'execution.orderTimeoutSeconds': 10,
          'execution.stopLossDelay': 0,
        };
        return defaults[key];
      });

      const position = createMockPosition({
        shares: 100,
        entryPrice: 100,
        currentPrice: 105,
        partialExitCount: 0,
        stopOrderId: 'old-stop-789',
      });
      mockDb.get.mockReturnValue(position);

      vi.mocked(mockT212Client.placeMarketOrder).mockResolvedValue({ id: 8003 } as any);
      vi.mocked(mockT212Client.getOrder).mockResolvedValue({
        status: 'FILLED',
        filledValue: 5250,
        filledQuantity: 50,
      } as any);
      // cancelOrder succeeds for old stop
      vi.mocked(mockT212Client.cancelOrder).mockResolvedValue(undefined);
      // placeStopOrder throws for new breakeven stop — should be caught, not propagated
      vi.mocked(mockT212Client.placeStopOrder).mockRejectedValue(new Error('Exchange rejected stop'));

      mockDb.run.mockReturnValue({ lastInsertRowid: 1n });

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      // Should still succeed overall (stop placement failure is non-fatal for partial exit)
      expect(result.success).toBe(true);
    });
  });

  describe('getPartialExitManager singleton', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = getPartialExitManager();
      const instance2 = getPartialExitManager();

      expect(instance1).toBe(instance2);
    });
  });

  describe('executePartialExit - waitForFill edge cases', () => {
    beforeEach(() => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        const defaults: Record<string, any> = {
          'partialExit.enabled': true,
          'partialExit.moveStopToBreakeven': false,
          'execution.dryRun': false, // Live mode
          'execution.orderTimeoutSeconds': 1, // 1 second = 2 attempts
          'execution.stopLossDelay': 0,
        };
        return defaults[key];
      });
    });

    it('returns null (timeout) when order is CANCELLED during polling', async () => {
      const position = createMockPosition({ shares: 100 });
      mockDb.get.mockReturnValue(position);

      vi.mocked(mockT212Client.placeMarketOrder).mockResolvedValue({ id: 9001 } as any);
      // Immediately return CANCELLED status
      vi.mocked(mockT212Client.getOrder).mockResolvedValue({ status: 'CANCELLED' } as any);
      vi.mocked(mockT212Client.cancelOrder).mockResolvedValue(undefined);

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Partial exit order fill timeout');
    });

    it('returns null (timeout) when order is REJECTED during polling', async () => {
      const position = createMockPosition({ shares: 100 });
      mockDb.get.mockReturnValue(position);

      vi.mocked(mockT212Client.placeMarketOrder).mockResolvedValue({ id: 9002 } as any);
      vi.mocked(mockT212Client.getOrder).mockResolvedValue({ status: 'REJECTED' } as any);
      vi.mocked(mockT212Client.cancelOrder).mockResolvedValue(undefined);

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Partial exit order fill timeout');
    });

    it('recovers fill price when cancel fails but final status is FILLED', async () => {
      const position = createMockPosition({
        shares: 100,
        entryPrice: 100,
        currentPrice: 105,
        partialExitCount: 0,
        stopOrderId: null,
      });
      mockDb.get.mockReturnValue(position);

      vi.mocked(mockT212Client.placeMarketOrder).mockResolvedValue({ id: 9003 } as any);
      // Polling: 2x NEW (timeout with 1s timeout)
      vi.mocked(mockT212Client.getOrder)
        .mockResolvedValueOnce({ status: 'NEW' } as any)
        .mockResolvedValueOnce({ status: 'NEW' } as any)
        // Final status check after cancel fails: FILLED with price data
        .mockResolvedValueOnce({
          status: 'FILLED',
          filledValue: 5250,
          filledQuantity: 50,
        } as any);

      // Cancel throws, triggering the cancel-fail path
      vi.mocked(mockT212Client.cancelOrder).mockRejectedValue(new Error('Cancel failed'));
      vi.mocked(mockT212Client.placeStopOrder).mockResolvedValue({ id: 9004 } as any);

      mockDb.run.mockReturnValue({ lastInsertRowid: 1n });

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      // Should succeed since we recovered the fill
      expect(result.success).toBe(true);
    });

    it('returns null when cancel fails and final status check also throws', async () => {
      const position = createMockPosition({ shares: 100 });
      mockDb.get.mockReturnValue(position);

      vi.mocked(mockT212Client.placeMarketOrder).mockResolvedValue({ id: 9005 } as any);
      vi.mocked(mockT212Client.getOrder)
        .mockResolvedValueOnce({ status: 'NEW' } as any)
        .mockResolvedValueOnce({ status: 'NEW' } as any)
        // Final status check throws
        .mockRejectedValueOnce(new Error('Status check failed'));

      vi.mocked(mockT212Client.cancelOrder).mockRejectedValue(new Error('Cancel failed'));

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Partial exit order fill timeout');
    });

    it('returns fill price from value/quantity fallback when filledValue/filledQuantity are null', async () => {
      // Covers lines 472-474: waitForFill uses value/quantity when filledValue/filledQuantity are null
      const position = createMockPosition({
        shares: 100,
        entryPrice: 100,
        currentPrice: 105,
        partialExitCount: 0,
        stopOrderId: null,
      });
      mockDb.get.mockReturnValue(position);

      vi.mocked(mockT212Client.placeMarketOrder).mockResolvedValue({ id: 9006 } as any);
      // FILLED but filledValue/filledQuantity are null — only value/quantity set
      vi.mocked(mockT212Client.getOrder).mockResolvedValue({
        status: 'FILLED',
        filledValue: null,
        filledQuantity: null,
        value: 5250,
        quantity: 50,
      } as any);

      mockDb.run.mockReturnValue({ lastInsertRowid: 1n });

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      // Fill price = 5250 / 50 = 105 — should succeed and record the trade
      expect(result.success).toBe(true);
      expect(result.sharesToSell).toBe(50);
    });

    it('returns failure when order is FILLED but all price data is null (waitForFill returns null)', async () => {
      // Covers lines 475-476: all four price fields null → log.warn + return null
      const position = createMockPosition({
        shares: 100,
        entryPrice: 100,
        currentPrice: 105,
        partialExitCount: 0,
        stopOrderId: null,
      });
      mockDb.get.mockReturnValue(position);

      vi.mocked(mockT212Client.placeMarketOrder).mockResolvedValue({ id: 9007 } as any);
      // FILLED but all price fields null → waitForFill returns null
      vi.mocked(mockT212Client.getOrder).mockResolvedValue({
        status: 'FILLED',
        filledValue: null,
        filledQuantity: null,
        value: null,
        quantity: null,
      } as any);

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      // waitForFill returns null → executePartialExit returns failure
      expect(result.success).toBe(false);
      expect(result.error).toBe('Partial exit order fill timeout');
    });

    it('covers line 420 ?? 0 true branch: null partialExitCount in LIVE mode', async () => {
      // In live mode with partialExitCount: null, (null ?? 0) + 1 = 1
      const position = createMockPosition({
        shares: 100,
        entryPrice: 100,
        currentPrice: 105,
        partialExitCount: null, // triggers null ?? 0
        stopOrderId: null,
        stopLoss: 95,
      });
      mockDb.get.mockReturnValue(position);

      vi.mocked(mockT212Client.placeMarketOrder).mockResolvedValue({ id: 9010 } as any);
      vi.mocked(mockT212Client.getOrder).mockResolvedValue({
        status: 'FILLED',
        filledValue: 5250,
        filledQuantity: 50,
      } as any);
      mockDb.run.mockReturnValue({ lastInsertRowid: 1n });

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(result.success).toBe(true);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ partialExitCount: 1 }),
      );
    });

    it('covers line 444 newStopLoss ?? undefined true branch: null stopLoss in LIVE mode', async () => {
      // When stopLoss is null, newStopLoss stays null, and null ?? undefined returns undefined
      const position = createMockPosition({
        shares: 100,
        entryPrice: 100,
        currentPrice: 105,
        partialExitCount: 0,
        stopOrderId: null,
        stopLoss: null, // newStopLoss will be null → null ?? undefined = undefined
      });
      mockDb.get.mockReturnValue(position);

      vi.mocked(mockT212Client.placeMarketOrder).mockResolvedValue({ id: 9011 } as any);
      vi.mocked(mockT212Client.getOrder).mockResolvedValue({
        status: 'FILLED',
        filledValue: 5250,
        filledQuantity: 50,
      } as any);
      mockDb.run.mockReturnValue({ lastInsertRowid: 1n });

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(result.success).toBe(true);
      expect(result.newStopLoss).toBeUndefined(); // null ?? undefined = undefined
    });

    it('covers lines 446-456 catch block: db.transaction throws in LIVE mode', async () => {
      // When db.transaction throws, the catch block returns { success: false, error: ... }
      const position = createMockPosition({
        shares: 100,
        entryPrice: 100,
        currentPrice: 105,
        partialExitCount: 0,
        stopOrderId: null,
        stopLoss: 95,
      });
      mockDb.get.mockReturnValue(position);

      vi.mocked(mockT212Client.placeMarketOrder).mockResolvedValue({ id: 9012 } as any);
      vi.mocked(mockT212Client.getOrder).mockResolvedValue({
        status: 'FILLED',
        filledValue: 5250,
        filledQuantity: 50,
      } as any);

      // Make db.transaction throw
      mockDb.transaction.mockImplementationOnce(() => {
        throw new Error('DB transaction failed');
      });

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB transaction failed');
    });

    it('covers catch block error string path (non-Error thrown)', async () => {
      const position = createMockPosition({
        shares: 100,
        entryPrice: 100,
        currentPrice: 105,
        partialExitCount: 0,
        stopOrderId: null,
        stopLoss: 95,
      });
      mockDb.get.mockReturnValue(position);

      vi.mocked(mockT212Client.placeMarketOrder).mockResolvedValue({ id: 9013 } as any);
      vi.mocked(mockT212Client.getOrder).mockResolvedValue({
        status: 'FILLED',
        filledValue: 5250,
        filledQuantity: 50,
      } as any);

      // Throw a non-Error string
      mockDb.transaction.mockImplementationOnce(() => {
        throw 'string error';
      });

      const result = await manager.executePartialExit('AAPL', 'AAPL_US_EQ', 50, 'Tier 1', 'INVEST');

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });
  });
});
