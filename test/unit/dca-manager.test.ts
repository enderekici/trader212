import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DCAEvaluation, Position, PortfolioState } from '../../src/execution/dca-manager.js';

// Mock dependencies
vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../src/utils/helpers.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
}));

let mockDbInstance: any;

vi.mock('../../src/db/index.js', () => ({
  getDb: vi.fn(() => mockDbInstance),
}));

vi.mock('../../src/db/repositories/orders.js', () => ({
  createOrder: vi.fn().mockReturnValue(1),
  updateOrderStatus: vi.fn(),
}));

vi.mock('../../src/db/schema.js', () => ({
  positions: { symbol: 'symbol' },
  trades: { symbol: 'symbol', id: 'id', side: 'side' },
}));

describe('DCAManager', () => {
  let DCAManager: any;
  let getDCAManager: any;
  let configManager: any;
  let getDb: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mockDbInstance
    mockDbInstance = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      run: vi.fn().mockReturnValue({ lastInsertRowid: 1 }),
      transaction: vi.fn(function (callback) {
        return callback(this);
      }),
    };

    const dcaModule = await import('../../src/execution/dca-manager.js');
    DCAManager = dcaModule.DCAManager;
    getDCAManager = dcaModule.getDCAManager;

    const configModule = await import('../../src/config/manager.js');
    configManager = configModule.configManager;

    const dbModule = await import('../../src/db/index.js');
    getDb = dbModule.getDb;

    // Default config values
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      const defaults: Record<string, any> = {
        'dca.enabled': true,
        'dca.maxRounds': 3,
        'dca.dropPctPerRound': 0.05,
        'dca.sizeMultiplier': 1.0,
        'dca.minTimeBetweenMinutes': 60,
        'execution.dryRun': true,
        'execution.orderTimeoutSeconds': 10,
      };
      return defaults[key];
    });
  });

  describe('evaluatePosition', () => {
    it('should return false if DCA is disabled', () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'dca.enabled') return false;
        return true;
      });

      const manager = new DCAManager();
      const position: Position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date().toISOString(),
        dcaCount: 0,
        totalInvested: 1500,
      };
      const portfolio: PortfolioState = { cashAvailable: 1000 };

      const result = manager.evaluatePosition('AAPL', 140, position, portfolio);

      expect(result.shouldDCA).toBe(false);
      expect(result.reason).toContain('disabled');
    });

    it('should return false if max rounds reached', () => {
      const manager = new DCAManager();
      const position: Position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date().toISOString(),
        dcaCount: 3,
        totalInvested: 1500,
      };
      const portfolio: PortfolioState = { cashAvailable: 1000 };

      const result = manager.evaluatePosition('AAPL', 100, position, portfolio);

      expect(result.shouldDCA).toBe(false);
      expect(result.reason).toContain('Max DCA rounds reached');
    });

    it('should return false if price has not dropped enough for round 1', () => {
      const manager = new DCAManager();
      const position: Position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date().toISOString(),
        dcaCount: 0,
        totalInvested: 1500,
      };
      const portfolio: PortfolioState = { cashAvailable: 1000 };

      // Round 1 needs 5% drop (to 142.50), current price is 145 (only 3.33% drop)
      const result = manager.evaluatePosition('AAPL', 145, position, portfolio);

      expect(result.shouldDCA).toBe(false);
      expect(result.reason).toContain('Price not low enough');
    });

    it('should return false if price has not dropped enough for round 2', () => {
      const manager = new DCAManager();
      const position: Position = {
        symbol: 'AAPL',
        shares: 20,
        entryPrice: 150,
        entryTime: new Date().toISOString(),
        dcaCount: 1,
        totalInvested: 3000,
      };
      const portfolio: PortfolioState = { cashAvailable: 1000 };

      // Round 2 needs 10% drop (to 135), current price is 140 (only 6.67% drop)
      const result = manager.evaluatePosition('AAPL', 140, position, portfolio);

      expect(result.shouldDCA).toBe(false);
      expect(result.reason).toContain('Price not low enough');
    });

    it('should return false if price has not dropped enough for round 3', () => {
      const manager = new DCAManager();
      const position: Position = {
        symbol: 'AAPL',
        shares: 30,
        entryPrice: 150,
        entryTime: new Date().toISOString(),
        dcaCount: 2,
        totalInvested: 4500,
      };
      const portfolio: PortfolioState = { cashAvailable: 1000 };

      // Round 3 needs 15% drop (to 127.50), current price is 130 (only 13.33% drop)
      const result = manager.evaluatePosition('AAPL', 130, position, portfolio);

      expect(result.shouldDCA).toBe(false);
      expect(result.reason).toContain('Price not low enough');
    });

    it('should return false if too soon since last trade', () => {
      const manager = new DCAManager();
      const position: Position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date().toISOString(),
        dcaCount: 0,
        totalInvested: 1500,
      };
      const portfolio: PortfolioState = { cashAvailable: 10000 }; // Ensure enough cash

      // Mock DB to return a recent trade (30 minutes ago)
      const recentTrade = {
        id: 1,
        symbol: 'AAPL',
        side: 'BUY',
        entryTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      };

      mockDbInstance.all.mockReturnValue([recentTrade]);

      const result = manager.evaluatePosition('AAPL', 142, position, portfolio);

      expect(result.shouldDCA).toBe(false);
      expect(result.reason).toContain('Too soon since last buy');
    });

    it('should return false if calculated shares < 1', () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'dca.sizeMultiplier') return 0.5; // Multiplier 0.5
        const defaults: Record<string, any> = {
          'dca.enabled': true,
          'dca.maxRounds': 3,
          'dca.dropPctPerRound': 0.05,
          'dca.minTimeBetweenMinutes': 60,
        };
        return defaults[key];
      });

      const manager = new DCAManager();
      const position: Position = {
        symbol: 'AAPL',
        shares: 1, // Very small position
        entryPrice: 150,
        entryTime: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
        dcaCount: 1, // Already did 1 DCA, so next will be shares × 0.5^1 = 0.5 → floor = 0
        totalInvested: 150,
      };
      const portfolio: PortfolioState = { cashAvailable: 10000 };

      // Mock DB to return no recent trades
      mockDbInstance.all.mockReturnValue([]);

      // Price needs to drop 10% (round 2) = 135
      const result = manager.evaluatePosition('AAPL', 134, position, portfolio);

      expect(result.shouldDCA).toBe(false);
      expect(result.reason).toContain('Calculated DCA shares < 1');
    });

    it('should return false if insufficient cash', () => {
      const manager = new DCAManager();
      const position: Position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
        dcaCount: 0,
        totalInvested: 1500,
      };
      const portfolio: PortfolioState = { cashAvailable: 100 }; // Not enough for 10 shares @ 142

      // Mock DB to return no recent trades
      mockDbInstance.all.mockReturnValue([]);

      const result = manager.evaluatePosition('AAPL', 142, position, portfolio);

      expect(result.shouldDCA).toBe(false);
      expect(result.reason).toContain('Insufficient cash');
    });

    it('should trigger DCA for round 1 when conditions met', () => {
      const manager = new DCAManager();
      const position: Position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
        dcaCount: 0,
        totalInvested: 1500,
      };
      const portfolio: PortfolioState = { cashAvailable: 2000 };

      // Mock DB to return no recent trades
      mockDbInstance.all.mockReturnValue([]);

      // Round 1 needs 5% drop (to 142.50), current price is 140
      const result = manager.evaluatePosition('AAPL', 140, position, portfolio);

      expect(result.shouldDCA).toBe(true);
      expect(result.shares).toBe(10); // Same size as original (multiplier 1.0)
      expect(result.dcaRound).toBe(1);
      expect(result.newAvgPrice).toBeCloseTo(145, 2); // (1500 + 1400) / 20 = 145
    });

    it('should trigger DCA for round 2 when conditions met', () => {
      const manager = new DCAManager();
      // After round 1 DCA: original 10 shares @ 150, added 10 @ 140
      // Current: 20 shares, avg 145, totalInvested 2900
      const position: Position = {
        symbol: 'AAPL',
        shares: 20,
        entryPrice: 145, // Average entry after round 1
        entryTime: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
        dcaCount: 1,
        totalInvested: 2900, // 150 * 10 + 140 * 10
      };
      const portfolio: PortfolioState = { cashAvailable: 3000 };

      // Mock DB to return no recent trades
      mockDbInstance.all.mockReturnValue([]);

      // Round 2 needs 10% drop below entryPrice (145)
      // 10% drop = 145 * 0.90 = 130.50, current price is 130 (< 130.50, so triggers)
      const result = manager.evaluatePosition('AAPL', 130, position, portfolio);

      expect(result.shouldDCA).toBe(true);
      // estimatedOriginalShares = 2900 / 145 = 20
      // DCA shares = 20 * 1.0^1 = 20
      expect(result.shares).toBe(20);
      expect(result.dcaRound).toBe(2);
    });

    it('should calculate shares correctly with size multiplier', () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'dca.sizeMultiplier') return 1.5;
        const defaults: Record<string, any> = {
          'dca.enabled': true,
          'dca.maxRounds': 3,
          'dca.dropPctPerRound': 0.05,
          'dca.minTimeBetweenMinutes': 60,
        };
        return defaults[key];
      });

      const manager = new DCAManager();
      const position: Position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
        dcaCount: 0,
        totalInvested: 1500,
      };
      const portfolio: PortfolioState = { cashAvailable: 5000 };

      // Mock DB to return no recent trades
      mockDbInstance.all.mockReturnValue([]);

      const result = manager.evaluatePosition('AAPL', 140, position, portfolio);

      expect(result.shouldDCA).toBe(true);
      expect(result.shares).toBe(10); // 10 * 1.5^0 = 10
    });

    it('should calculate shares correctly with size multiplier for round 2', () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'dca.sizeMultiplier') return 1.5;
        const defaults: Record<string, any> = {
          'dca.enabled': true,
          'dca.maxRounds': 3,
          'dca.dropPctPerRound': 0.05,
          'dca.minTimeBetweenMinutes': 60,
        };
        return defaults[key];
      });

      const manager = new DCAManager();
      const position: Position = {
        symbol: 'AAPL',
        shares: 20,
        entryPrice: 145,
        entryTime: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
        dcaCount: 1,
        totalInvested: 2900,
      };
      const portfolio: PortfolioState = { cashAvailable: 5000 };

      // Mock DB to return no recent trades
      mockDbInstance.all.mockReturnValue([]);

      const result = manager.evaluatePosition('AAPL', 130, position, portfolio);

      expect(result.shouldDCA).toBe(true);
      // estimatedOriginalShares = 2900 / 145 = 20
      // DCA shares = 20 * 1.5^1 = 30
      expect(result.shares).toBe(30);
    });

    it('should use position.shares as original if totalInvested is null', () => {
      const manager = new DCAManager();
      const position: Position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
        dcaCount: 0,
        totalInvested: null,
      };
      const portfolio: PortfolioState = { cashAvailable: 2000 };

      // Mock DB to return no recent trades
      mockDbInstance.all.mockReturnValue([]);

      const result = manager.evaluatePosition('AAPL', 140, position, portfolio);

      expect(result.shouldDCA).toBe(true);
      expect(result.shares).toBe(10); // Uses position.shares directly
    });

    it('should calculate new average price correctly', () => {
      const manager = new DCAManager();
      const position: Position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
        dcaCount: 0,
        totalInvested: 1500,
      };
      const portfolio: PortfolioState = { cashAvailable: 2000 };

      // Mock DB to return no recent trades
      mockDbInstance.all.mockReturnValue([]);

      const result = manager.evaluatePosition('AAPL', 140, position, portfolio);

      // Current invested: 1500
      // DCA investment: 10 * 140 = 1400
      // Total invested: 2900
      // Total shares: 20
      // New avg price: 2900 / 20 = 145
      expect(result.newAvgPrice).toBeCloseTo(145, 2);
    });

    it('should respect custom drop percentage per round', () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'dca.dropPctPerRound') return 0.10; // 10% per round
        const defaults: Record<string, any> = {
          'dca.enabled': true,
          'dca.maxRounds': 3,
          'dca.sizeMultiplier': 1.0,
          'dca.minTimeBetweenMinutes': 60,
        };
        return defaults[key];
      });

      const manager = new DCAManager();
      const position: Position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
        dcaCount: 0,
        totalInvested: 1500,
      };
      const portfolio: PortfolioState = { cashAvailable: 2000 };

      // Mock DB to return no recent trades
      mockDbInstance.all.mockReturnValue([]);

      // Round 1 needs 10% drop (to 135), current price is 140 (6.67% drop)
      let result = manager.evaluatePosition('AAPL', 140, position, portfolio);
      expect(result.shouldDCA).toBe(false);

      // Round 1 needs 10% drop (to 135), current price is 134
      result = manager.evaluatePosition('AAPL', 134, position, portfolio);
      expect(result.shouldDCA).toBe(true);
    });
  });

  describe('executeDCA', () => {
    it('should execute dry-run DCA successfully', async () => {
      const manager = new DCAManager();

      const position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date().toISOString(),
        dcaCount: 0,
        totalInvested: 1500,
      };

      mockDbInstance.get.mockReturnValue(position);

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return error if position not found', async () => {
      const manager = new DCAManager();

      mockDbInstance.get.mockReturnValue(null);

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No position found');
    });

    it('should update position with new average price', async () => {
      const manager = new DCAManager();

      const position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date().toISOString(),
        dcaCount: 0,
        totalInvested: 1500,
      };

      mockDbInstance.get.mockReturnValue(position);

      await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST');

      // Check that update was called with correct values
      expect(mockDbInstance.update).toHaveBeenCalled();
      expect(mockDbInstance.set).toHaveBeenCalledWith(
        expect.objectContaining({
          shares: 20,
          entryPrice: 145, // (1500 + 1400) / 20
          dcaCount: 1,
          totalInvested: 2900,
        }),
      );
    });

    it('should increment DCA count', async () => {
      const manager = new DCAManager();

      const position = {
        symbol: 'AAPL',
        shares: 20,
        entryPrice: 145,
        entryTime: new Date().toISOString(),
        dcaCount: 1,
        totalInvested: 2900,
      };

      mockDbInstance.get.mockReturnValue(position);

      await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 130, 'INVEST');

      expect(mockDbInstance.set).toHaveBeenCalledWith(
        expect.objectContaining({
          dcaCount: 2,
        }),
      );
    });

    it('should record trade with dcaRound', async () => {
      const manager = new DCAManager();

      const position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date().toISOString(),
        dcaCount: 0,
        totalInvested: 1500,
      };

      mockDbInstance.get.mockReturnValue(position);

      await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST');

      expect(mockDbInstance.insert).toHaveBeenCalled();
      expect(mockDbInstance.values).toHaveBeenCalledWith(
        expect.objectContaining({
          dcaRound: 1,
          side: 'BUY',
        }),
      );
    });

    it('should use totalInvested when available', async () => {
      const manager = new DCAManager();

      const position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date().toISOString(),
        dcaCount: 0,
        totalInvested: 1500,
      };

      mockDbInstance.get.mockReturnValue(position);

      await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST');

      // totalInvested should be 1500 + 1400 = 2900
      expect(mockDbInstance.set).toHaveBeenCalledWith(
        expect.objectContaining({
          totalInvested: 2900,
        }),
      );
    });

    it('should calculate totalInvested from position when null', async () => {
      const manager = new DCAManager();

      const position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date().toISOString(),
        dcaCount: 0,
        totalInvested: null,
      };

      mockDbInstance.get.mockReturnValue(position);

      await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST');

      // totalInvested should be calculated as (10 * 150) + (10 * 140) = 2900
      expect(mockDbInstance.set).toHaveBeenCalledWith(
        expect.objectContaining({
          totalInvested: 2900,
        }),
      );
    });

    it('should return error if T212 client not initialized in live mode', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'execution.dryRun') return false;
        return true;
      });

      const manager = new DCAManager();

      const position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date().toISOString(),
        dcaCount: 0,
        totalInvested: 1500,
      };

      mockDbInstance.get.mockReturnValue(position);

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST');

      expect(result.success).toBe(false);
      expect(result.error).toContain('T212 client not initialized');
    });
  });

  describe('getDCAManager', () => {
    it('should return singleton instance', () => {
      const instance1 = getDCAManager();
      const instance2 = getDCAManager();

      expect(instance1).toBe(instance2);
    });

    it('should return DCAManager instance', () => {
      const instance = getDCAManager();

      expect(instance).toBeInstanceOf(DCAManager);
    });
  });
});
