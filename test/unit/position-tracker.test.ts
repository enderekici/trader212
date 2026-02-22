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
  sql: (strings: TemplateStringsArray, ..._values: unknown[]) => ({ strings, type: 'sql' }),
}));

vi.mock('../../src/db/repositories/positions.js', () => {
  class StaleVersionError extends Error {
    readonly symbol: string;
    readonly expectedVersion: number;
    constructor(symbol: string, expectedVersion: number) {
      super(`Stale version for position ${symbol}: expected version ${expectedVersion}`);
      this.name = 'StaleVersionError';
      this.symbol = symbol;
      this.expectedVersion = expectedVersion;
    }
  }
  return { StaleVersionError };
});

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

// Exit condition DSL mock
const mockParseExitConditionText = vi.fn().mockReturnValue([]);
const mockEvaluateExitCondition = vi.fn().mockReturnValue(false);
vi.mock('../../src/execution/exit-condition-dsl.js', () => ({
  parseExitConditionText: (...args: unknown[]) => mockParseExitConditionText(...args),
  evaluateExitCondition: (...args: unknown[]) => mockEvaluateExitCondition(...args),
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

    it('fetches all quotes concurrently via Promise.allSettled', async () => {
      mockDbAll.mockReturnValueOnce([
        { symbol: 'AAPL', entryPrice: 150, shares: 10 },
        { symbol: 'GOOG', entryPrice: 100, shares: 5 },
        { symbol: 'MSFT', entryPrice: 300, shares: 3 },
      ]);
      mockGetQuote
        .mockResolvedValueOnce({ price: 160 })
        .mockResolvedValueOnce({ price: 110 })
        .mockResolvedValueOnce({ price: 320 });

      await tracker.updatePositions();

      // All three quotes should be requested
      expect(mockGetQuote).toHaveBeenCalledTimes(3);
      expect(mockGetQuote).toHaveBeenCalledWith('AAPL');
      expect(mockGetQuote).toHaveBeenCalledWith('GOOG');
      expect(mockGetQuote).toHaveBeenCalledWith('MSFT');
      // All three DB updates should happen
      expect(mockDbRun).toHaveBeenCalledTimes(3);
    });

    it('continues updating other positions when one quote fetch fails', async () => {
      mockDbAll.mockReturnValueOnce([
        { symbol: 'AAPL', entryPrice: 150, shares: 10 },
        { symbol: 'GOOG', entryPrice: 100, shares: 5 },
        { symbol: 'MSFT', entryPrice: 300, shares: 3 },
      ]);
      mockGetQuote
        .mockResolvedValueOnce({ price: 160 })  // AAPL succeeds
        .mockRejectedValueOnce(new Error('API down'))  // GOOG fails
        .mockResolvedValueOnce({ price: 320 });  // MSFT succeeds

      await tracker.updatePositions();

      // All three quotes requested concurrently
      expect(mockGetQuote).toHaveBeenCalledTimes(3);
      // Only AAPL and MSFT should be updated in DB (GOOG failed)
      expect(mockDbRun).toHaveBeenCalledTimes(2);
    });

    it('skips P&L calculation when entryPrice is 0 to avoid division by zero', async () => {
      mockDbAll.mockReturnValueOnce([
        { symbol: 'AAPL', entryPrice: 0, shares: 10 },
      ]);
      mockGetQuote.mockResolvedValueOnce({ price: 160 });

      await tracker.updatePositions();

      // Quote is fetched but DB update is skipped due to entryPrice === 0
      expect(mockGetQuote).toHaveBeenCalledTimes(1);
      expect(mockDbRun).not.toHaveBeenCalled();
    });

    it('updates valid positions even when some have entryPrice 0', async () => {
      mockDbAll.mockReturnValueOnce([
        { symbol: 'ZERO', entryPrice: 0, shares: 10 },
        { symbol: 'AAPL', entryPrice: 150, shares: 10 },
      ]);
      mockGetQuote
        .mockResolvedValueOnce({ price: 50 })
        .mockResolvedValueOnce({ price: 160 });

      await tracker.updatePositions();

      // Both quotes fetched concurrently
      expect(mockGetQuote).toHaveBeenCalledTimes(2);
      // Only AAPL should be updated (ZERO skipped due to entryPrice === 0)
      expect(mockDbRun).toHaveBeenCalledTimes(1);
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

    it('uses entryPrice as exitPrice when currentPrice is null (line 73)', async () => {
      // Covers line 73: const exitPrice = dbPos.currentPrice ?? dbPos.entryPrice;
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          t212Ticker: 'AAPL_US_EQ',
          shares: 10,
          entryPrice: 150,
          currentPrice: null, // null → falls back to entryPrice
          entryTime: '2024-01-01T00:00:00Z',
        },
      ]);

      const mockClient = {
        getPortfolio: vi.fn().mockResolvedValue([]),
      } as any;

      await tracker.syncWithT212(mockClient);

      // Auto-reconcile should have run using entryPrice (150) as exitPrice
      expect(mockDbRun).toHaveBeenCalled();
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

  // ── Exit condition DSL wiring ──────────────────────────────────────────
  describe('checkExitConditions — DSL wiring', () => {
    it('triggers position close when DSL condition evaluates to true', async () => {
      const entryTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'TSLA',
          entryPrice: 200,
          currentPrice: 230,
          shares: 5,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: 'profit% > 10',
        },
      ]);

      // exit.roiEnabled = false (skip ROI), exit.dslEnabled = true
      mockConfigGet
        .mockReturnValueOnce(false)  // exit.roiEnabled
        .mockReturnValueOnce(true);  // exit.dslEnabled

      const fakeParsedCondition = { type: 'profit', metric: 'pnl_pct', operator: 'gt', value: 0.1 };
      mockParseExitConditionText.mockReturnValueOnce([fakeParsedCondition]);
      mockEvaluateExitCondition.mockReturnValueOnce(true);

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toContain('TSLA');
      expect(result.exitReasons.TSLA).toBe('DSL exit condition triggered');
      expect(mockParseExitConditionText).toHaveBeenCalledWith('profit% > 10');
      expect(mockEvaluateExitCondition).toHaveBeenCalledWith(
        fakeParsedCondition,
        expect.objectContaining({
          currentPrice: 230,
          entryPrice: 200,
          pnlPct: expect.any(Number),
          pnlAbs: expect.any(Number),
          daysHeld: expect.any(Number),
          hoursHeld: expect.any(Number),
          indicators: {},
        }),
      );
    });

    it('does not trigger when DSL condition evaluates to false', async () => {
      const entryTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'TSLA',
          entryPrice: 200,
          currentPrice: 205,
          shares: 5,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: 'profit% > 10',
        },
      ]);

      mockConfigGet
        .mockReturnValueOnce(false)  // exit.roiEnabled
        .mockReturnValueOnce(true);  // exit.dslEnabled

      const fakeParsedCondition = { type: 'profit', metric: 'pnl_pct', operator: 'gt', value: 0.1 };
      mockParseExitConditionText.mockReturnValueOnce([fakeParsedCondition]);
      mockEvaluateExitCondition.mockReturnValueOnce(false);

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).not.toContain('TSLA');
      expect(result.exitReasons.TSLA).toBeUndefined();
    });

    it('skips DSL evaluation when exit.dslEnabled is false', async () => {
      const entryTime = new Date().toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'MSFT',
          entryPrice: 400,
          currentPrice: 420,
          shares: 3,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: 'price above 410',
        },
      ]);

      mockConfigGet
        .mockReturnValueOnce(false)   // exit.roiEnabled
        .mockReturnValueOnce(false);  // exit.dslEnabled

      const result = await tracker.checkExitConditions();

      // DSL functions should never be called
      expect(mockParseExitConditionText).not.toHaveBeenCalled();
      expect(mockEvaluateExitCondition).not.toHaveBeenCalled();
      // aiExitConditions is not valid JSON, so JSON.parse will throw and be caught
      expect(result.positionsToClose).toHaveLength(0);
    });

    it('skips DSL evaluation when aiExitConditions is null', async () => {
      const entryTime = new Date().toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'GOOG',
          entryPrice: 170,
          currentPrice: 175,
          shares: 10,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: null,
        },
      ]);

      mockConfigGet
        .mockReturnValueOnce(false)  // exit.roiEnabled
        .mockReturnValueOnce(true);  // exit.dslEnabled

      const result = await tracker.checkExitConditions();

      expect(mockParseExitConditionText).not.toHaveBeenCalled();
      expect(result.positionsToClose).toHaveLength(0);
    });

    it('skips DSL evaluation when aiExitConditions is empty string', async () => {
      const entryTime = new Date().toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AMZN',
          entryPrice: 180,
          currentPrice: 185,
          shares: 8,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: '',
        },
      ]);

      mockConfigGet
        .mockReturnValueOnce(false)  // exit.roiEnabled
        .mockReturnValueOnce(true);  // exit.dslEnabled

      const result = await tracker.checkExitConditions();

      // Empty string is falsy, so the DSL block (dslEnabled && pos.aiExitConditions) is skipped
      expect(mockParseExitConditionText).not.toHaveBeenCalled();
      expect(result.positionsToClose).toHaveLength(0);
    });

    it('handles DSL parse errors gracefully without crashing', async () => {
      const entryTime = new Date().toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'NVDA',
          entryPrice: 800,
          currentPrice: 850,
          shares: 2,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: 'some unparseable gibberish !@#$',
        },
      ]);

      mockConfigGet
        .mockReturnValueOnce(false)  // exit.roiEnabled
        .mockReturnValueOnce(true);  // exit.dslEnabled

      mockParseExitConditionText.mockImplementationOnce(() => {
        throw new Error('DSL parse error');
      });

      const result = await tracker.checkExitConditions();

      // Should not crash; error is caught and logged
      expect(result.positionsToClose).not.toContain('NVDA');
      expect(result.exitReasons.NVDA).toBeUndefined();
    });

    it('handles evaluateExitCondition throwing an error gracefully', async () => {
      const entryTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'META',
          entryPrice: 500,
          currentPrice: 530,
          shares: 4,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: 'rsi above 70',
        },
      ]);

      mockConfigGet
        .mockReturnValueOnce(false)  // exit.roiEnabled
        .mockReturnValueOnce(true);  // exit.dslEnabled

      const fakeCondition = { type: 'indicator', indicator: 'RSI', operator: 'above', value: 70 };
      mockParseExitConditionText.mockReturnValueOnce([fakeCondition]);
      mockEvaluateExitCondition.mockImplementationOnce(() => {
        throw new Error('Evaluation failed');
      });

      const result = await tracker.checkExitConditions();

      // Error is caught in the outer try/catch, position is not closed
      expect(result.positionsToClose).not.toContain('META');
    });

    it('defaults dslEnabled to true when configManager.get throws', async () => {
      const entryTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AAPL',
          entryPrice: 150,
          currentPrice: 175,
          shares: 10,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: 'profit% > 5',
        },
      ]);

      mockConfigGet
        .mockReturnValueOnce(false)  // exit.roiEnabled
        .mockImplementationOnce(() => { throw new Error('Config key not found'); }); // exit.dslEnabled throws

      const fakeParsedCondition = { type: 'profit', metric: 'pnl_pct', operator: 'gt', value: 0.05 };
      mockParseExitConditionText.mockReturnValueOnce([fakeParsedCondition]);
      mockEvaluateExitCondition.mockReturnValueOnce(true);

      const result = await tracker.checkExitConditions();

      // dslEnabled defaults to true when configManager.get throws, so DSL runs
      expect(mockParseExitConditionText).toHaveBeenCalledWith('profit% > 5');
      expect(result.positionsToClose).toContain('AAPL');
      expect(result.exitReasons.AAPL).toBe('DSL exit condition triggered');
    });

    it('skips DSL when parseExitConditionText returns empty array', async () => {
      const entryTime = new Date().toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'NFLX',
          entryPrice: 600,
          currentPrice: 620,
          shares: 3,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: '{"maxHoldDays": 30}',
        },
      ]);

      mockConfigGet
        .mockReturnValueOnce(false)  // exit.roiEnabled
        .mockReturnValueOnce(true);  // exit.dslEnabled

      // parseExitConditionText returns empty for JSON-like strings
      mockParseExitConditionText.mockReturnValueOnce([]);

      const result = await tracker.checkExitConditions();

      // DSL parse returned empty, so evaluateExitCondition should not be called
      expect(mockEvaluateExitCondition).not.toHaveBeenCalled();
      // Falls through to JSON-based AI exit conditions — maxHoldDays=30, held ~0 days, no exit
      expect(result.positionsToClose).toHaveLength(0);
    });

    it('only triggers first matching DSL condition and breaks', async () => {
      const entryTime = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'AMD',
          entryPrice: 100,
          currentPrice: 120,
          shares: 10,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: 'profit% > 10 and days held > 3',
        },
      ]);

      mockConfigGet
        .mockReturnValueOnce(false)  // exit.roiEnabled
        .mockReturnValueOnce(true);  // exit.dslEnabled

      const cond1 = { type: 'profit', metric: 'pnl_pct', operator: 'gt', value: 0.1 };
      const cond2 = { type: 'time', metric: 'days_held', operator: 'gt', value: 3 };
      const compositeCond = { type: 'all', conditions: [cond1, cond2] };
      mockParseExitConditionText.mockReturnValueOnce([compositeCond]);
      mockEvaluateExitCondition.mockReturnValueOnce(true); // first (composite) condition matches

      const result = await tracker.checkExitConditions();

      expect(result.positionsToClose).toContain('AMD');
      expect(result.exitReasons.AMD).toBe('DSL exit condition triggered');
      // Only called once because the loop breaks after first match
      expect(mockEvaluateExitCondition).toHaveBeenCalledTimes(1);
    });

    it('DSL exit takes priority over JSON AI exit conditions', async () => {
      const entryTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'INTC',
          entryPrice: 30,
          currentPrice: 35,
          shares: 20,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          // This string is both valid DSL and would parse as JSON fail
          aiExitConditions: 'profit% > 5',
        },
      ]);

      mockConfigGet
        .mockReturnValueOnce(false)  // exit.roiEnabled
        .mockReturnValueOnce(true);  // exit.dslEnabled

      const fakeParsedCondition = { type: 'profit', metric: 'pnl_pct', operator: 'gt', value: 0.05 };
      mockParseExitConditionText.mockReturnValueOnce([fakeParsedCondition]);
      mockEvaluateExitCondition.mockReturnValueOnce(true);

      const result = await tracker.checkExitConditions();

      // DSL triggers first, so it's DSL exit reason, not JSON AI condition
      expect(result.positionsToClose).toContain('INTC');
      expect(result.exitReasons.INTC).toBe('DSL exit condition triggered');
    });

    it('correctly computes ExitContext values passed to evaluateExitCondition', async () => {
      const entryTime = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago
      mockDbAll.mockReturnValueOnce([
        {
          symbol: 'SPY',
          entryPrice: 500,
          currentPrice: 525,
          shares: 20,
          entryTime,
          stopLoss: null,
          trailingStop: null,
          takeProfit: null,
          aiExitConditions: 'price above 520',
        },
      ]);

      mockConfigGet
        .mockReturnValueOnce(false)  // exit.roiEnabled
        .mockReturnValueOnce(true);  // exit.dslEnabled

      const fakeCondition = { type: 'price', operator: 'above', value: 520 };
      mockParseExitConditionText.mockReturnValueOnce([fakeCondition]);
      mockEvaluateExitCondition.mockReturnValueOnce(false);

      await tracker.checkExitConditions();

      expect(mockEvaluateExitCondition).toHaveBeenCalledTimes(1);
      const [, context] = mockEvaluateExitCondition.mock.calls[0];

      // Verify context fields
      expect(context.currentPrice).toBe(525);
      expect(context.entryPrice).toBe(500);
      expect(context.pnlPct).toBeCloseTo(0.05, 4);       // (525-500)/500 = 0.05
      expect(context.pnlAbs).toBeCloseTo(500, 0);         // (525-500)*20 = 500
      expect(context.daysHeld).toBeCloseTo(3, 0);          // ~3 days
      expect(context.hoursHeld).toBeCloseTo(72, 0);        // ~72 hours
      expect(context.indicators).toEqual({});
    });
  });
});
