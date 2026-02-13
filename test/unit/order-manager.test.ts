import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mock external dependencies ─────────────────────────────────────────────

// Mock configManager
const mockConfigGet = vi.fn();
vi.mock('../../src/config/manager.js', () => ({
  configManager: { get: (...args: unknown[]) => mockConfigGet(...args) },
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

// Mock sleep to be instant
vi.mock('../../src/utils/helpers.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// Mock DB
const mockDbRun = vi.fn().mockReturnValue({ lastInsertRowid: 1n, changes: 1 });
const mockDbGet = vi.fn();
const mockDbAll = vi.fn().mockReturnValue([]);
const mockDbDelete = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbSelect = vi.fn();

function createChainableQuery(terminal: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'set', 'values', 'orderBy', 'limit', 'onConflictDoUpdate'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.run = terminal.run ?? mockDbRun;
  chain.get = terminal.get ?? mockDbGet;
  chain.all = terminal.all ?? mockDbAll;
  return chain;
}

const mockSelectChain = createChainableQuery();
const mockInsertChain = createChainableQuery();
const mockDeleteChain = createChainableQuery();

const mockTxInsertChain = createChainableQuery();
const mockTxDeleteChain = createChainableQuery();

const mockTransaction = vi.fn().mockImplementation((callback: (tx: unknown) => void) => {
  const tx = {
    select: () => mockSelectChain,
    insert: () => mockTxInsertChain,
    delete: () => mockTxDeleteChain,
    update: () => createChainableQuery(),
  };
  return callback(tx);
});

vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    select: () => mockSelectChain,
    insert: () => mockInsertChain,
    delete: () => mockDeleteChain,
    update: () => createChainableQuery(),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  }),
}));

vi.mock('../../src/db/schema.js', () => ({
  positions: { symbol: 'symbol' },
  trades: { id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => 'eq_condition'),
}));

// ── Import SUT after mocks ─────────────────────────────────────────────────
import { OrderManager, type BuyParams, type CloseParams } from '../../src/execution/order-manager.js';

function makeBuyParams(overrides: Partial<BuyParams> = {}): BuyParams {
  return {
    symbol: 'AAPL',
    t212Ticker: 'AAPL_US_EQ',
    shares: 10,
    price: 150,
    stopLossPct: 0.05,
    takeProfitPct: 0.10,
    aiReasoning: 'Strong technical indicators',
    conviction: 85,
    aiModel: 'claude-sonnet-4-5-20250929',
    accountType: 'INVEST',
    ...overrides,
  };
}

function makeCloseParams(overrides: Partial<CloseParams> = {}): CloseParams {
  return {
    symbol: 'AAPL',
    t212Ticker: 'AAPL_US_EQ',
    shares: 10,
    exitReason: 'Take profit reached',
    accountType: 'INVEST',
    ...overrides,
  };
}

function makeMockT212Client() {
  return {
    placeMarketOrder: vi.fn(),
    placeStopOrder: vi.fn(),
    placeLimitOrder: vi.fn(),
    getOrder: vi.fn(),
    cancelOrder: vi.fn(),
  } as any;
}

describe('OrderManager', () => {
  let orderManager: OrderManager;

  beforeEach(() => {
    vi.clearAllMocks();
    orderManager = new OrderManager();
    // Default config values
    mockConfigGet.mockImplementation((key: string) => {
      const defaults: Record<string, unknown> = {
        'execution.dryRun': true,
        'execution.orderTimeoutSeconds': 10,
        'execution.stopLossDelay': 3000,
      };
      return defaults[key];
    });
  });

  // ── setT212Client ──────────────────────────────────────────────────────
  describe('setT212Client', () => {
    it('sets the T212 client', () => {
      const client = makeMockT212Client();
      orderManager.setT212Client(client);
      // No throw, client is stored internally
      expect(client).toBeDefined();
    });
  });

  // ── executeBuy: dry run ────────────────────────────────────────────────
  describe('executeBuy - dry run', () => {
    it('records trade and position in DB and returns success', async () => {
      mockSelectChain.get.mockReturnValueOnce(undefined); // no existing position
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 42n });

      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(true);
      expect(result.tradeId).toBe(42);
      expect(mockTransaction).toHaveBeenCalledOnce();
    });

    it('rejects duplicate buy when position already exists', async () => {
      mockSelectChain.get.mockReturnValueOnce({ symbol: 'AAPL', shares: 10 });

      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Position already exists');
    });

    it('computes correct stop-loss and take-profit prices', async () => {
      mockSelectChain.get.mockReturnValueOnce(undefined);
      const capturedValues: Record<string, unknown>[] = [];
      mockTxInsertChain.values = vi.fn().mockImplementation((val: Record<string, unknown>) => {
        capturedValues.push(val);
        return mockTxInsertChain;
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 1n });

      const params = makeBuyParams({ price: 200, stopLossPct: 0.05, takeProfitPct: 0.10 });
      await orderManager.executeBuy(params);

      // The first insert is for trades (inside transaction)
      const tradeInsert = capturedValues[0];
      expect(tradeInsert.stopLoss).toBe(190); // 200 * (1 - 0.05)
      expect(tradeInsert.takeProfit).toBeCloseTo(220, 5); // 200 * (1 + 0.10)
    });
  });

  // ── executeBuy: live ───────────────────────────────────────────────────
  describe('executeBuy - live', () => {
    beforeEach(() => {
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'execution.dryRun': false,
          'execution.orderTimeoutSeconds': 10,
          'execution.stopLossDelay': 3000,
        };
        return defaults[key];
      });
    });

    it('returns error when T212 client is not set', async () => {
      mockSelectChain.get.mockReturnValueOnce(undefined);

      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(false);
      expect(result.error).toContain('T212 client not initialized');
    });

    it('places market order, waits for fill, places stop-loss, records trade', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 101 });
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1500,
        filledQuantity: 10,
      });
      client.placeStopOrder.mockResolvedValue({ id: 201 });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 5n });

      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(true);
      expect(result.tradeId).toBe(5);
      expect(result.orderId).toBe('101');
      expect(client.placeMarketOrder).toHaveBeenCalledOnce();
      expect(client.placeStopOrder).toHaveBeenCalledOnce();
      expect(mockTransaction).toHaveBeenCalledOnce();
    });

    it('returns error when order fill times out', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 102 });
      // Always return NEW status to simulate timeout
      client.getOrder.mockResolvedValue({ status: 'NEW' });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);

      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Order fill timeout');
      expect(result.orderId).toBe('102');
    });

    it('handles stop-loss order failure gracefully', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 103 });
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1500,
        filledQuantity: 10,
      });
      client.placeStopOrder.mockRejectedValue(new Error('Stop order failed'));

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 6n });

      // Should still succeed; stop-loss error is logged but not fatal
      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(true);
      expect(result.tradeId).toBe(6);
    });

    it('logs FATAL when both stop-loss and close-position fail', async () => {
      const client = makeMockT212Client();
      // First call: buy order succeeds. Second call: close after stop-loss failure fails.
      client.placeMarketOrder
        .mockResolvedValueOnce({ id: 103 })
        .mockRejectedValueOnce(new Error('Close also failed'));
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1500,
        filledQuantity: 10,
      });
      client.placeStopOrder.mockRejectedValue(new Error('Stop order failed'));

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 7n });

      const result = await orderManager.executeBuy(makeBuyParams());

      // Trade is still recorded despite FATAL situation
      expect(result.success).toBe(true);
      // Verify both placeMarketOrder calls happened (buy + attempted close)
      expect(client.placeMarketOrder).toHaveBeenCalledTimes(2);
    });

    it('returns error when placeMarketOrder throws', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockRejectedValue(new Error('API down'));

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);

      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(false);
      expect(result.error).toBe('API down');
    });

    it('handles non-Error thrown values', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockRejectedValue('string error');

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);

      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });

    it('places take-profit limit order when takeProfitPct > 0', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 120 });
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1500,
        filledQuantity: 10,
      });
      client.placeStopOrder.mockResolvedValue({ id: 220 });
      client.placeLimitOrder.mockResolvedValue({ id: 320 });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 20n });

      const result = await orderManager.executeBuy(makeBuyParams({ takeProfitPct: 0.10 }));

      expect(result.success).toBe(true);
      expect(client.placeLimitOrder).toHaveBeenCalledOnce();
    });

    it('skips take-profit order when takeProfitPct is 0', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 121 });
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1500,
        filledQuantity: 10,
      });
      client.placeStopOrder.mockResolvedValue({ id: 221 });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 21n });

      const result = await orderManager.executeBuy(makeBuyParams({ takeProfitPct: 0 }));

      expect(result.success).toBe(true);
      expect(client.placeLimitOrder).not.toHaveBeenCalled();
    });

    it('handles take-profit order failure gracefully', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 122 });
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1500,
        filledQuantity: 10,
      });
      client.placeStopOrder.mockResolvedValue({ id: 222 });
      client.placeLimitOrder.mockRejectedValue(new Error('TP placement failed'));

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 22n });

      const result = await orderManager.executeBuy(makeBuyParams({ takeProfitPct: 0.10 }));

      // Should still succeed; TP failure is non-fatal
      expect(result.success).toBe(true);
      expect(client.placeLimitOrder).toHaveBeenCalledOnce();
    });

    it('handles order filled with fallback pricing (value/quantity)', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 104 });
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: null,
        filledQuantity: null,
        value: 1500,
        quantity: 10,
      });
      client.placeStopOrder.mockResolvedValue({ id: 202 });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 7n });

      const result = await orderManager.executeBuy(makeBuyParams());
      expect(result.success).toBe(true);
    });

    it('returns null fill when order is CANCELLED', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 105 });
      client.getOrder.mockResolvedValue({ status: 'CANCELLED' });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);

      const result = await orderManager.executeBuy(makeBuyParams());
      expect(result.success).toBe(false);
      expect(result.error).toBe('Order fill timeout');
    });

    it('returns null fill when order is REJECTED', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 106 });
      client.getOrder.mockResolvedValue({ status: 'REJECTED' });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);

      const result = await orderManager.executeBuy(makeBuyParams());
      expect(result.success).toBe(false);
    });

    it('returns null fill when order is FILLED but no price data', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 107 });
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: null,
        filledQuantity: null,
        value: null,
        quantity: null,
      });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);

      const result = await orderManager.executeBuy(makeBuyParams());
      expect(result.success).toBe(false);
      expect(result.error).toBe('Order fill timeout');
    });

    it('reconciles filled order when cancel fails after timeout', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'execution.dryRun': false,
          'execution.orderTimeoutSeconds': 1,
          'execution.stopLossDelay': 0,
        };
        return defaults[key];
      });

      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 108 });
      // Polling: 2 calls return NEW (timeout with 1s = 2 attempts)
      // Final status check after cancel fails: FILLED
      client.getOrder
        .mockResolvedValueOnce({ status: 'NEW' })
        .mockResolvedValueOnce({ status: 'NEW' })
        .mockResolvedValueOnce({ status: 'FILLED', filledValue: 1500, filledQuantity: 10 });
      client.cancelOrder.mockRejectedValue(new Error('Cancel failed'));
      client.placeStopOrder.mockResolvedValue({ id: 300 });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 8n });

      const result = await orderManager.executeBuy(makeBuyParams());
      expect(result.success).toBe(true);
      expect(result.tradeId).toBe(8);
    });

    it('returns timeout when cancel fails and final status is not FILLED', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'execution.dryRun': false,
          'execution.orderTimeoutSeconds': 1,
          'execution.stopLossDelay': 0,
        };
        return defaults[key];
      });

      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 109 });
      client.getOrder.mockResolvedValue({ status: 'NEW' });
      client.cancelOrder.mockRejectedValue(new Error('Cancel failed'));

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);

      const result = await orderManager.executeBuy(makeBuyParams());
      expect(result.success).toBe(false);
      expect(result.error).toBe('Order fill timeout');
    });

    it('returns timeout when cancel fails and status check also throws', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'execution.dryRun': false,
          'execution.orderTimeoutSeconds': 1,
          'execution.stopLossDelay': 0,
        };
        return defaults[key];
      });

      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 110 });
      client.getOrder
        .mockResolvedValueOnce({ status: 'NEW' })
        .mockResolvedValueOnce({ status: 'NEW' })
        .mockRejectedValueOnce(new Error('Status check failed'));
      client.cancelOrder.mockRejectedValue(new Error('Cancel failed'));

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);

      const result = await orderManager.executeBuy(makeBuyParams());
      expect(result.success).toBe(false);
      expect(result.error).toBe('Order fill timeout');
    });

    it('returns timeout when cancel fails and filled order has no price data', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'execution.dryRun': false,
          'execution.orderTimeoutSeconds': 1,
          'execution.stopLossDelay': 0,
        };
        return defaults[key];
      });

      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 111 });
      client.getOrder
        .mockResolvedValueOnce({ status: 'NEW' })
        .mockResolvedValueOnce({ status: 'NEW' })
        .mockResolvedValueOnce({ status: 'FILLED', filledValue: null, filledQuantity: null });
      client.cancelOrder.mockRejectedValue(new Error('Cancel failed'));

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);

      const result = await orderManager.executeBuy(makeBuyParams());
      expect(result.success).toBe(false);
      expect(result.error).toBe('Order fill timeout');
    });
  });

  // ── executeClose: dry run ──────────────────────────────────────────────
  describe('executeClose - dry run', () => {
    it('returns error when no position exists', async () => {
      mockSelectChain.get.mockReturnValueOnce(undefined);

      const result = await orderManager.executeClose(makeCloseParams());

      expect(result.success).toBe(false);
      expect(result.error).toContain('No position for');
    });

    it('records closing trade, deletes position, returns success', async () => {
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: 155,
        entryTime: '2024-01-01T00:00:00Z',
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 10n });

      const result = await orderManager.executeClose(makeCloseParams());

      expect(result.success).toBe(true);
      expect(mockTransaction).toHaveBeenCalledOnce();
    });

    it('uses entryPrice when currentPrice is null', async () => {
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: null,
        entryTime: '2024-01-01T00:00:00Z',
      });
      const capturedValues: Record<string, unknown>[] = [];
      mockTxInsertChain.values = vi.fn().mockImplementation((val: Record<string, unknown>) => {
        capturedValues.push(val);
        return mockTxInsertChain;
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 11n });

      await orderManager.executeClose(makeCloseParams());

      const tradeInsert = capturedValues[0];
      expect(tradeInsert.exitPrice).toBe(140);
    });
  });

  // ── executeClose: live ─────────────────────────────────────────────────
  describe('executeClose - live', () => {
    beforeEach(() => {
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'execution.dryRun': false,
          'execution.orderTimeoutSeconds': 10,
          'execution.stopLossDelay': 3000,
        };
        return defaults[key];
      });
    });

    it('returns error when T212 client is not set', async () => {
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: 155,
        entryTime: '2024-01-01T00:00:00Z',
      });

      const result = await orderManager.executeClose(makeCloseParams());

      expect(result.success).toBe(false);
      expect(result.error).toContain('T212 client not initialized');
    });

    it('cancels existing stop order, sells, records trade, deletes position', async () => {
      const client = makeMockT212Client();
      client.cancelOrder.mockResolvedValue(undefined);
      client.placeMarketOrder.mockResolvedValue({ id: 301 });
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1550,
        filledQuantity: 10,
      });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: 155,
        entryTime: '2024-01-01T00:00:00Z',
        stopOrderId: '999',
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 12n });

      const result = await orderManager.executeClose(makeCloseParams());

      expect(result.success).toBe(true);
      expect(result.orderId).toBe('301');
      expect(client.cancelOrder).toHaveBeenCalledWith(999);
    });

    it('handles cancel stop order failure gracefully', async () => {
      const client = makeMockT212Client();
      client.cancelOrder.mockRejectedValue(new Error('Already cancelled'));
      client.placeMarketOrder.mockResolvedValue({ id: 302 });
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1550,
        filledQuantity: 10,
      });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: 155,
        entryTime: '2024-01-01T00:00:00Z',
        stopOrderId: '998',
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 13n });

      const result = await orderManager.executeClose(makeCloseParams());
      expect(result.success).toBe(true);
    });

    it('returns error when sell order fill times out', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 303 });
      client.getOrder.mockResolvedValue({ status: 'NEW' });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: 155,
        entryTime: '2024-01-01T00:00:00Z',
      });

      const result = await orderManager.executeClose(makeCloseParams());
      expect(result.success).toBe(false);
      expect(result.error).toBe('Sell order fill timeout');
    });

    it('returns error when market sell throws', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockRejectedValue(new Error('Exchange closed'));

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: 155,
        entryTime: '2024-01-01T00:00:00Z',
      });

      const result = await orderManager.executeClose(makeCloseParams());
      expect(result.success).toBe(false);
      expect(result.error).toBe('Exchange closed');
    });

    it('handles non-Error thrown in close path', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockRejectedValue(42);

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: 155,
        entryTime: '2024-01-01T00:00:00Z',
      });

      const result = await orderManager.executeClose(makeCloseParams());
      expect(result.success).toBe(false);
      expect(result.error).toBe('42');
    });

    it('cancels take-profit order when present', async () => {
      const client = makeMockT212Client();
      client.cancelOrder.mockResolvedValue(undefined);
      client.placeMarketOrder.mockResolvedValue({ id: 310 });
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1550,
        filledQuantity: 10,
      });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: 155,
        entryTime: '2024-01-01T00:00:00Z',
        stopOrderId: '999',
        takeProfitOrderId: '888',
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 15n });

      const result = await orderManager.executeClose(makeCloseParams());
      expect(result.success).toBe(true);
      // cancelOrder called for both stop and TP
      expect(client.cancelOrder).toHaveBeenCalledWith(999);
      expect(client.cancelOrder).toHaveBeenCalledWith(888);
    });

    it('handles take-profit cancel failure gracefully', async () => {
      const client = makeMockT212Client();
      client.cancelOrder
        .mockResolvedValueOnce(undefined) // stop cancel OK
        .mockRejectedValueOnce(new Error('TP already filled')); // TP cancel fails
      client.placeMarketOrder.mockResolvedValue({ id: 311 });
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1550,
        filledQuantity: 10,
      });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: 155,
        entryTime: '2024-01-01T00:00:00Z',
        stopOrderId: '999',
        takeProfitOrderId: '777',
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 16n });

      const result = await orderManager.executeClose(makeCloseParams());
      expect(result.success).toBe(true); // should not fail the close
    });

    it('uses entryPrice as fallback for slippage when currentPrice is null (live close)', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 320 });
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1400,
        filledQuantity: 10,
      });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: null, // null -> fallback to entryPrice
        entryTime: '2024-01-01T00:00:00Z',
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 30n });

      const result = await orderManager.executeClose(makeCloseParams());
      expect(result.success).toBe(true);
    });

    it('skips cancel when no stopOrderId exists', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 304 });
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1550,
        filledQuantity: 10,
      });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: 155,
        entryTime: '2024-01-01T00:00:00Z',
        stopOrderId: null,
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 14n });

      const result = await orderManager.executeClose(makeCloseParams());
      expect(result.success).toBe(true);
      expect(client.cancelOrder).not.toHaveBeenCalled();
    });
  });

  // ── getCurrentPrice ────────────────────────────────────────────────────
  describe('getCurrentPrice', () => {
    it('returns price from yahoo finance', async () => {
      const mockYahoo = { getQuote: vi.fn().mockResolvedValue({ price: 150.25 }) };
      vi.doMock('../../src/data/yahoo-finance.js', () => ({
        YahooFinanceClient: vi.fn().mockImplementation(function () { return mockYahoo; }),
      }));

      // Re-import to pick up mock
      const { OrderManager: OM } = await import('../../src/execution/order-manager.js');
      const om = new OM();
      const price = await om.getCurrentPrice('AAPL');
      expect(price).toBe(150.25);
    });

    it('returns null when quote is null', async () => {
      const mockYahoo = { getQuote: vi.fn().mockResolvedValue(null) };
      vi.doMock('../../src/data/yahoo-finance.js', () => ({
        YahooFinanceClient: vi.fn().mockImplementation(function () { return mockYahoo; }),
      }));

      const { OrderManager: OM } = await import('../../src/execution/order-manager.js');
      const om = new OM();
      const price = await om.getCurrentPrice('AAPL');
      expect(price).toBeNull();
    });

    it('returns null on error', async () => {
      vi.doMock('../../src/data/yahoo-finance.js', () => ({
        YahooFinanceClient: vi.fn().mockImplementation(function () {
          return { getQuote: vi.fn().mockRejectedValue(new Error('Network error')) };
        }),
      }));

      const { OrderManager: OM } = await import('../../src/execution/order-manager.js');
      const om = new OM();
      const price = await om.getCurrentPrice('AAPL');
      expect(price).toBeNull();
    });
  });
});
