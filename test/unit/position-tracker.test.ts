import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mock dependencies ──────────────────────────────────────────────────────

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../src/config/manager.js', () => ({
  configManager: { get: vi.fn().mockReturnValue(false) },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => 'eq_condition'),
}));

// DB mock
const mockDbRun = vi.fn().mockReturnValue({ lastInsertRowid: 1n, changes: 1 });
const mockDbGet = vi.fn();
const mockDbAll = vi.fn().mockReturnValue([]);

function createChain() {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'set', 'values', 'orderBy', 'limit', 'onConflictDoUpdate'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.run = mockDbRun;
  chain.get = mockDbGet;
  chain.all = mockDbAll;
  return chain;
}

const mockChain = createChain();

vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    select: () => mockChain,
    insert: () => mockChain,
    update: () => mockChain,
    delete: () => mockChain,
  }),
}));

vi.mock('../../src/db/schema.js', () => ({
  positions: { symbol: 'symbol' },
  trades: { id: 'id' },
}));

// Yahoo Finance mock
const mockGetQuote = vi.fn();
vi.mock('../../src/data/yahoo-finance.js', () => ({
  YahooFinanceClient: vi.fn().mockImplementation(function () {
    return { getQuote: mockGetQuote };
  }),
}));

// ── Import SUT ─────────────────────────────────────────────────────────────
import { configManager } from '../../src/config/manager.js';
import { PositionTracker } from '../../src/execution/position-tracker.js';

const mockConfigGet = vi.mocked(configManager.get);

describe('PositionTracker', () => {
  let tracker: PositionTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    tracker = new PositionTracker();
  });

  // ── updatePositions ────────────────────────────────────────────────────
  describe('updatePositions', () => {
    it('returns immediately when no positions exist', async () => {
      mockDbAll.mockReturnValueOnce([]);

      await tracker.updatePositions();

      expect(mockGetQuote).not.toHaveBeenCalled();
    });

    it('updates prices, pnl, and pnlPct for each position', async () => {
      mockDbAll.mockReturnValueOnce([
        { symbol: 'AAPL', entryPrice: 150, shares: 10 },
        { symbol: 'GOOG', entryPrice: 100, shares: 5 },
      ]);
      mockGetQuote
        .mockResolvedValueOnce({ price: 160 })
        .mockResolvedValueOnce({ price: 110 });

      await tracker.updatePositions();

      expect(mockGetQuote).toHaveBeenCalledTimes(2);
      expect(mockDbRun).toHaveBeenCalled();
    });

    it('skips position when getQuote returns null', async () => {
      mockDbAll.mockReturnValueOnce([
        { symbol: 'AAPL', entryPrice: 150, shares: 10 },
      ]);
      mockGetQuote.mockResolvedValueOnce(null);

      await tracker.updatePositions();

      // update.run should not be called since quote is null
      expect(mockDbRun).not.toHaveBeenCalled();
    });

    it('handles getQuote errors without crashing', async () => {
      mockDbAll.mockReturnValueOnce([
        { symbol: 'AAPL', entryPrice: 150, shares: 10 },
      ]);
      mockGetQuote.mockRejectedValueOnce(new Error('API down'));

      await expect(tracker.updatePositions()).resolves.not.toThrow();
    });
  });

  // ── syncWithT212 ──────────────────────────────────────────────────────
  describe('syncWithT212', () => {
    it('logs warnings for DB positions not in T212', async () => {
      mockDbAll.mockReturnValueOnce([
        { symbol: 'AAPL', t212Ticker: 'AAPL_US_EQ', shares: 10, entryPrice: 150, currentPrice: 160, entryTime: '2024-01-01T00:00:00Z' },
      ]);

      const mockClient = {
        getPortfolio: vi.fn().mockResolvedValue([]),
      } as any;

      await tracker.syncWithT212(mockClient);

      // Auto-reconciles the position (insert trade + delete position)
      expect(mockClient.getPortfolio).toHaveBeenCalledOnce();
      expect(mockDbRun).toHaveBeenCalled();
    });

    it('auto-reconciles with accountType when defined', async () => {
      mockDbAll.mockReturnValueOnce([
        { symbol: 'AAPL', t212Ticker: 'AAPL_US_EQ', shares: 10, entryPrice: 150, currentPrice: 160, entryTime: '2024-01-01T00:00:00Z', accountType: 'CFD' },
      ]);

      const mockClient = {
        getPortfolio: vi.fn().mockResolvedValue([]),
      } as any;

      await tracker.syncWithT212(mockClient);
      expect(mockDbRun).toHaveBeenCalled();
    });

    it('logs warnings for T212 positions not in DB', async () => {
      mockDbAll.mockReturnValueOnce([]);

      const mockClient = {
        getPortfolio: vi.fn().mockResolvedValue([
          { ticker: 'GOOG_US_EQ', quantity: 5, currentPrice: 100 },
        ]),
      } as any;

      await tracker.syncWithT212(mockClient);
      expect(mockClient.getPortfolio).toHaveBeenCalledOnce();
    });

    it('logs warnings for quantity mismatches', async () => {
      mockDbAll.mockReturnValueOnce([
        { symbol: 'AAPL', t212Ticker: 'AAPL_US_EQ', shares: 10 },
      ]);

      const mockClient = {
        getPortfolio: vi.fn().mockResolvedValue([
          { ticker: 'AAPL_US_EQ', quantity: 7, currentPrice: 150 },
        ]),
      } as any;

      await tracker.syncWithT212(mockClient);
      expect(mockClient.getPortfolio).toHaveBeenCalledOnce();
    });

    it('matches positions using instrument.ticker fallback', async () => {
      mockDbAll.mockReturnValueOnce([
        { symbol: 'AAPL', t212Ticker: 'AAPL_US_EQ', shares: 10 },
      ]);

      const mockClient = {
        getPortfolio: vi.fn().mockResolvedValue([
          { instrument: { ticker: 'AAPL_US_EQ' }, quantity: 10, currentPrice: 150 },
        ]),
      } as any;

      await tracker.syncWithT212(mockClient);
      expect(mockClient.getPortfolio).toHaveBeenCalledOnce();
    });

    it('falls back to empty string when T212 position has no ticker', async () => {
      mockDbAll.mockReturnValueOnce([]);

      const mockClient = {
        getPortfolio: vi.fn().mockResolvedValue([
          { quantity: 5, currentPrice: 100 },
        ]),
      } as any;

      await tracker.syncWithT212(mockClient);
      expect(mockClient.getPortfolio).toHaveBeenCalledOnce();
    });

    it('handles getPortfolio error without crashing', async () => {
      mockDbAll.mockReturnValueOnce([]);

      const mockClient = {
        getPortfolio: vi.fn().mockRejectedValue(new Error('API error')),
      } as any;

      await expect(tracker.syncWithT212(mockClient)).resolves.not.toThrow();
    });

    it('does not warn for exact quantity match', async () => {
      mockDbAll.mockReturnValueOnce([
        { symbol: 'AAPL', t212Ticker: 'AAPL_US_EQ', shares: 10 },
      ]);

      const mockClient = {
        getPortfolio: vi.fn().mockResolvedValue([
          { ticker: 'AAPL_US_EQ', quantity: 10, currentPrice: 150 },
        ]),
      } as any;

      await tracker.syncWithT212(mockClient);
      expect(mockClient.getPortfolio).toHaveBeenCalledOnce();
    });
  });

  // ── updateTrailingStops ────────────────────────────────────────────────
  describe('updateTrailingStops', () => {
    it('updates trailing stop for profitable positions', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          entryPrice: 100,
          currentPrice: 120,
          stopLoss: 95,
          trailingStop: null,
        },
      ]);

      await tracker.updateTrailingStops();

      // originalStopPct = (100-95)/100 = 0.05
      // newTrailingStop = 120 * (1-0.05) = 114
      // 114 > 95 (currentStop) => should update
      expect(mockDbRun).toHaveBeenCalled();
    });

    it('does not trail for losing positions', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          entryPrice: 100,
          currentPrice: 90,
          stopLoss: 95,
          trailingStop: null,
        },
      ]);

      await tracker.updateTrailingStops();

      expect(mockDbRun).not.toHaveBeenCalled();
    });

    it('does not move stop down', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          entryPrice: 100,
          currentPrice: 105,
          stopLoss: 95,
          trailingStop: 103, // already higher than new trailing stop
        },
      ]);

      await tracker.updateTrailingStops();

      // originalStopPct = 0.05, newTrailingStop = 105 * 0.95 = 99.75
      // 99.75 < 103 (current trailing stop) => should NOT update
      expect(mockDbRun).not.toHaveBeenCalled();
    });

    it('skips positions with null currentPrice', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          entryPrice: 100,
          currentPrice: null,
          stopLoss: 95,
          trailingStop: null,
        },
      ]);

      await tracker.updateTrailingStops();

      expect(mockDbRun).not.toHaveBeenCalled();
    });

    it('skips positions with null stopLoss', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          entryPrice: 100,
          currentPrice: 120,
          stopLoss: null,
          trailingStop: null,
        },
      ]);

      await tracker.updateTrailingStops();

      expect(mockDbRun).not.toHaveBeenCalled();
    });
  });

  // ── checkExitConditions ────────────────────────────────────────────────
  describe('checkExitConditions', () => {
    it('returns empty array when no positions', async () => {
      mockDbAll.mockReturnValueOnce([]);

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toHaveLength(0);
    });

    it('triggers stop-loss exit', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          currentPrice: 90,
          stopLoss: 95,
          trailingStop: null,
          takeProfit: 200,
          aiExitConditions: null,
        },
      ]);

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toContain('AAPL');
    });

    it('triggers trailing stop exit', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          currentPrice: 108,
          stopLoss: 95,
          trailingStop: 110,
          takeProfit: 200,
          aiExitConditions: null,
        },
      ]);

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toContain('AAPL');
    });

    it('triggers take-profit exit', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          currentPrice: 200,
          stopLoss: 95,
          trailingStop: null,
          takeProfit: 180,
          aiExitConditions: null,
        },
      ]);

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toContain('AAPL');
    });

    it('triggers max hold duration exit', async () => {
      const longAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          currentPrice: 150,
          entryTime: longAgo,
          stopLoss: 95,
          trailingStop: null,
          takeProfit: 200,
          aiExitConditions: JSON.stringify({ maxHoldDays: 30 }),
        },
      ]);

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toContain('AAPL');
    });

    it('triggers AI price target exit', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          currentPrice: 200,
          entryTime: new Date().toISOString(),
          stopLoss: 95,
          trailingStop: null,
          takeProfit: 250,
          aiExitConditions: JSON.stringify({ priceTarget: 190 }),
        },
      ]);

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toContain('AAPL');
    });

    it('skips positions with null currentPrice', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          currentPrice: null,
          stopLoss: 95,
          trailingStop: null,
          takeProfit: 200,
          aiExitConditions: null,
        },
      ]);

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toHaveLength(0);
    });

    it('handles malformed aiExitConditions JSON gracefully', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          currentPrice: 150,
          entryTime: new Date().toISOString(),
          stopLoss: 95,
          trailingStop: null,
          takeProfit: 200,
          aiExitConditions: 'not valid json{{{',
        },
      ]);

      const result = await tracker.checkExitConditions();

      // Should not crash; malformed JSON is caught
      expect(result.positionsToClose).toHaveLength(0);
    });

    it('does not trigger when conditions are not met', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          currentPrice: 150,
          entryTime: new Date().toISOString(),
          stopLoss: 95,
          trailingStop: null,
          takeProfit: 200,
          aiExitConditions: JSON.stringify({ maxHoldDays: 30, priceTarget: 300 }),
        },
      ]);

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toHaveLength(0);
    });

    it('does not trigger when no stop/tp values are set', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          currentPrice: 150,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: null,
        },
      ]);

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toHaveLength(0);
    });

    it('returns exitReasons for stop-loss triggered positions', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          currentPrice: 90,
          stopLoss: 95,
          trailingStop: null,
          takeProfit: 200,
          aiExitConditions: null,
        },
      ]);

      const result = await tracker.checkExitConditions();

      expect(result.exitReasons.AAPL).toBe('Stop-loss triggered');
    });

    it('returns exitReasons for take-profit triggered positions', async () => {
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          currentPrice: 200,
          stopLoss: 95,
          trailingStop: null,
          takeProfit: 180,
          aiExitConditions: null,
        },
      ]);

      const result = await tracker.checkExitConditions();

      expect(result.exitReasons.AAPL).toBe('Take-profit triggered');
    });

    it('triggers ROI exit when enabled and profit exceeds threshold', async () => {
      // Position entered 100 min ago, entry price 100, current price 107 (7% profit)
      // ROI table: at 60 min, threshold is 4%. 7% > 4% -> should exit
      const entryTime = new Date(Date.now() - 100 * 60000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          entryPrice: 100,
          currentPrice: 107,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: null,
        },
      ]);

      mockConfigGet
        .mockReturnValueOnce(true) // exit.roiEnabled
        .mockReturnValueOnce('{"0": 0.06, "60": 0.04, "240": 0.02}'); // exit.roiTable

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toContain('AAPL');
      expect(result.exitReasons.AAPL).toBe('roi_table');
    });

    it('does not trigger ROI exit when disabled', async () => {
      const entryTime = new Date(Date.now() - 100 * 60000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          entryPrice: 100,
          currentPrice: 107,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: null,
        },
      ]);

      mockConfigGet.mockReturnValueOnce(false); // exit.roiEnabled = false

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toHaveLength(0);
    });

    it('does not trigger ROI exit when profit is below threshold', async () => {
      // Position entered 30 min ago, entry 100, current 102 (2% profit)
      // ROI table: at 0 min, threshold is 6%. 2% < 6% -> no exit
      const entryTime = new Date(Date.now() - 30 * 60000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          entryPrice: 100,
          currentPrice: 102,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: null,
        },
      ]);

      mockConfigGet
        .mockReturnValueOnce(true) // exit.roiEnabled
        .mockReturnValueOnce('{"0": 0.06, "60": 0.04}'); // exit.roiTable

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toHaveLength(0);
    });

    it('stop-loss takes priority over ROI exit', async () => {
      // Position with stop-loss triggered — ROI check never reached due to continue
      const entryTime = new Date(Date.now() - 1500 * 60000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          entryPrice: 100,
          currentPrice: 90, // below stop-loss
          entryTime,
          stopLoss: 95,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: null,
        },
      ]);

      // No ROI mock needed — stop-loss triggers before ROI check is reached

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toContain('AAPL');
      expect(result.exitReasons.AAPL).toBe('Stop-loss triggered'); // NOT roi_table
    });

    it('handles ROI table as already-parsed object from configManager', async () => {
      const entryTime = new Date(Date.now() - 500 * 60000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          entryPrice: 100,
          currentPrice: 102,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: null,
        },
      ]);

      // configManager may return already-parsed object
      mockConfigGet
        .mockReturnValueOnce(true) // exit.roiEnabled
        .mockReturnValueOnce({ '0': 0.06, '480': 0.01 }); // exit.roiTable (already parsed)

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toContain('AAPL');
      expect(result.exitReasons.AAPL).toBe('roi_table');
    });
  });
});
