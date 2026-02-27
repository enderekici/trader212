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
  and: vi.fn((...args: unknown[]) => ({ args, type: 'and' })),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, type: 'sql' }),
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
      run: vi.fn().mockReturnValue({ lastInsertRowid: 1, changes: 1 }),
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

    it('should trigger DCA when last trade exists but enough time has passed', () => {
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

      // Mock DB to return an old trade (120 minutes ago — well past the 60-min min)
      const oldTrade = {
        id: 1,
        symbol: 'AAPL',
        side: 'BUY',
        entryTime: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
      };
      mockDbInstance.all.mockReturnValue([oldTrade]);

      // Round 1 needs 5% drop (to 142.50), current price 140 → should trigger
      const result = manager.evaluatePosition('AAPL', 140, position, portfolio);

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
        version: 1,
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
        version: 1,
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
        version: 1,
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
        version: 1,
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
        version: 1,
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
        version: 1,
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

    it('should use dcaCount 0 when position.dcaCount is null', async () => {
      const manager = new DCAManager();

      const position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date().toISOString(),
        dcaCount: null, // null → ?? 0 → dcaRound = 1
        totalInvested: 1500,
        version: 1,
      };

      mockDbInstance.get.mockReturnValue(position);

      await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST');

      expect(mockDbInstance.set).toHaveBeenCalledWith(
        expect.objectContaining({
          dcaCount: 1,
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

    it('should execute live DCA successfully when order fills', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'execution.dryRun') return false;
        if (key === 'execution.orderTimeoutSeconds') return 10;
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
        version: 1,
      };
      mockDbInstance.get.mockReturnValue(position);

      const t212Client: any = {
        placeMarketOrder: vi.fn().mockResolvedValue({ id: 999 }),
        getOrder: vi.fn().mockResolvedValue({
          status: 'FILLED',
          filledValue: 1400,
          filledQuantity: 10,
        }),
        cancelOrder: vi.fn(),
      };

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST', t212Client);

      expect(result.success).toBe(true);
      expect(t212Client.placeMarketOrder).toHaveBeenCalledWith({
        ticker: 'AAPL_US_EQ',
        quantity: 10,
      });
      expect(mockDbInstance.set).toHaveBeenCalledWith(
        expect.objectContaining({
          dcaCount: 1,
          shares: 20,
        }),
      );
    });

    it('should use value/quantity fallback when filledValue/filledQuantity unavailable', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'execution.dryRun') return false;
        if (key === 'execution.orderTimeoutSeconds') return 10;
        return true;
      });

      const manager = new DCAManager();
      const position = {
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 150,
        entryTime: new Date().toISOString(),
        dcaCount: 0,
        totalInvested: null,
        version: 1,
      };
      mockDbInstance.get.mockReturnValue(position);

      const t212Client: any = {
        placeMarketOrder: vi.fn().mockResolvedValue({ id: 1001 }),
        getOrder: vi.fn().mockResolvedValue({
          status: 'FILLED',
          filledValue: null,
          filledQuantity: null,
          value: 1400,
          quantity: 10,
        }),
        cancelOrder: vi.fn(),
      };

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST', t212Client);

      expect(result.success).toBe(true);
    });

    it('should return error when order fill times out', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'execution.dryRun') return false;
        if (key === 'execution.orderTimeoutSeconds') return 1; // 2 poll attempts
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

      const t212Client: any = {
        placeMarketOrder: vi.fn().mockResolvedValue({ id: 1002 }),
        // Always return PENDING — will time out
        getOrder: vi.fn().mockResolvedValue({ status: 'PENDING' }),
        cancelOrder: vi.fn().mockResolvedValue(undefined),
      };

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST', t212Client);

      expect(result.success).toBe(false);
      expect(result.error).toContain('DCA order fill timeout');
      expect(t212Client.cancelOrder).toHaveBeenCalledWith(1002);
    });

    it('should return error when order is CANCELLED', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'execution.dryRun') return false;
        if (key === 'execution.orderTimeoutSeconds') return 10;
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

      const t212Client: any = {
        placeMarketOrder: vi.fn().mockResolvedValue({ id: 1003 }),
        getOrder: vi.fn().mockResolvedValue({ status: 'CANCELLED' }),
        cancelOrder: vi.fn(),
      };

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST', t212Client);

      expect(result.success).toBe(false);
      expect(result.error).toContain('DCA order fill timeout');
    });

    it('should return error when order is REJECTED', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'execution.dryRun') return false;
        if (key === 'execution.orderTimeoutSeconds') return 10;
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

      const t212Client: any = {
        placeMarketOrder: vi.fn().mockResolvedValue({ id: 1004 }),
        getOrder: vi.fn().mockResolvedValue({ status: 'REJECTED' }),
        cancelOrder: vi.fn(),
      };

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST', t212Client);

      expect(result.success).toBe(false);
    });

    it('should return null fill price when FILLED order has no price data', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'execution.dryRun') return false;
        if (key === 'execution.orderTimeoutSeconds') return 10;
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

      const t212Client: any = {
        placeMarketOrder: vi.fn().mockResolvedValue({ id: 1005 }),
        getOrder: vi.fn().mockResolvedValue({
          status: 'FILLED',
          filledValue: null,
          filledQuantity: null,
          value: null,
          quantity: null,
        }),
        cancelOrder: vi.fn(),
      };

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST', t212Client);

      expect(result.success).toBe(false);
      expect(result.error).toContain('DCA order fill timeout');
    });

    it('should handle cancel failure and recover if final check shows FILLED', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'execution.dryRun') return false;
        if (key === 'execution.orderTimeoutSeconds') return 1; // force timeout quickly
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
        version: 1,
      };
      mockDbInstance.get.mockReturnValue(position);

      const t212Client: any = {
        placeMarketOrder: vi.fn().mockResolvedValue({ id: 1006 }),
        // All poll attempts: PENDING → times out
        getOrder: vi.fn()
          .mockResolvedValueOnce({ status: 'PENDING' })
          .mockResolvedValueOnce({ status: 'PENDING' })
          // final check after cancel failure: FILLED with price data
          .mockResolvedValue({
            status: 'FILLED',
            filledValue: 1400,
            filledQuantity: 10,
          }),
        // Cancel throws → triggers the cancel-error branch
        cancelOrder: vi.fn().mockRejectedValue(new Error('cancel failed')),
      };

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST', t212Client);

      // After cancel failure, final getOrder shows FILLED → fill price recovered → success
      expect(result.success).toBe(true);
    });

    it('should handle cancel failure with final FILLED order having no price data', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'execution.dryRun') return false;
        if (key === 'execution.orderTimeoutSeconds') return 1;
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

      const t212Client: any = {
        placeMarketOrder: vi.fn().mockResolvedValue({ id: 1007 }),
        getOrder: vi.fn()
          .mockResolvedValueOnce({ status: 'PENDING' })
          .mockResolvedValueOnce({ status: 'PENDING' })
          // final check: FILLED but no price data
          .mockResolvedValue({
            status: 'FILLED',
            filledValue: null,
            filledQuantity: null,
          }),
        cancelOrder: vi.fn().mockRejectedValue(new Error('cancel failed')),
      };

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST', t212Client);

      expect(result.success).toBe(false);
    });

    it('should handle cancel failure with statusErr during final check', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'execution.dryRun') return false;
        if (key === 'execution.orderTimeoutSeconds') return 1;
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

      const t212Client: any = {
        placeMarketOrder: vi.fn().mockResolvedValue({ id: 1008 }),
        getOrder: vi.fn()
          .mockResolvedValueOnce({ status: 'PENDING' })
          .mockResolvedValueOnce({ status: 'PENDING' })
          // final check throws too
          .mockRejectedValue(new Error('status check failed')),
        cancelOrder: vi.fn().mockRejectedValue(new Error('cancel failed')),
      };

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST', t212Client);

      expect(result.success).toBe(false);
    });

    it('should handle cancel failure with final order not FILLED (PENDING)', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'execution.dryRun') return false;
        if (key === 'execution.orderTimeoutSeconds') return 1;
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

      const t212Client: any = {
        placeMarketOrder: vi.fn().mockResolvedValue({ id: 1009 }),
        getOrder: vi.fn()
          .mockResolvedValueOnce({ status: 'PENDING' })
          .mockResolvedValueOnce({ status: 'PENDING' })
          // final check: order is PENDING (not FILLED) → returns null
          .mockResolvedValue({ status: 'PENDING' }),
        cancelOrder: vi.fn().mockRejectedValue(new Error('cancel failed')),
      };

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST', t212Client);

      expect(result.success).toBe(false);
    });

    it('should handle placeMarketOrder throwing an error', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'execution.dryRun') return false;
        if (key === 'execution.orderTimeoutSeconds') return 10;
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

      const t212Client: any = {
        placeMarketOrder: vi.fn().mockRejectedValue(new Error('Order rejected by broker')),
        getOrder: vi.fn(),
        cancelOrder: vi.fn(),
      };

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST', t212Client);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Order rejected by broker');
    });

    it('should handle non-Error thrown in live execution', async () => {
      vi.mocked(configManager.get).mockImplementation((key: string) => {
        if (key === 'execution.dryRun') return false;
        if (key === 'execution.orderTimeoutSeconds') return 10;
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

      const t212Client: any = {
        placeMarketOrder: vi.fn().mockRejectedValue('string error'),
        getOrder: vi.fn(),
        cancelOrder: vi.fn(),
      };

      const result = await manager.executeDCA('AAPL', 'AAPL_US_EQ', 10, 140, 'INVEST', t212Client);

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
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
