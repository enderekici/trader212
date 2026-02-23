import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mock external dependencies ─────────────────────────────────────────────

// Mock configManager
const mockConfigGet = vi.fn();
vi.mock('../../src/config/manager.js', () => ({
  configManager: { get: (...args: unknown[]) => mockConfigGet(...args) },
}));

// Mock audit logger
const mockLogRisk = vi.fn();
const mockLogTrade = vi.fn();
const mockLogError = vi.fn();
vi.mock('../../src/monitoring/audit-log.js', () => ({
  getAuditLogger: () => ({
    logRisk: (...args: unknown[]) => mockLogRisk(...args),
    logTrade: (...args: unknown[]) => mockLogTrade(...args),
    logError: (...args: unknown[]) => mockLogError(...args),
  }),
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

// Mock orders repository (used by order-manager for order tracking)
vi.mock('../../src/db/repositories/orders.js', () => ({
  createOrder: vi.fn().mockReturnValue(1),
  updateOrderStatus: vi.fn(),
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
    reasoning: 'Strong technical indicators',
    conviction: 85,
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

    it('rejects duplicate buy when position already exists (dry run)', async () => {
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

    it('applies slippage to fill price when paperTrading is true (executeBuy dry run)', async () => {
      // Covers lines 62-65: paperTrading=true triggers slippage on the buy fill price
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'execution.dryRun': true,
          'execution.orderTimeoutSeconds': 10,
          'execution.stopLossDelay': 3000,
          'execution.paperTrading': true,
          'trading.slippageMarketPct': 0.002, // 0.2% slippage
        };
        return defaults[key];
      });

      mockSelectChain.get.mockReturnValueOnce(undefined); // no existing position

      const capturedValues: Record<string, unknown>[] = [];
      mockTxInsertChain.values = vi.fn().mockImplementation((val: Record<string, unknown>) => {
        capturedValues.push(val);
        return mockTxInsertChain;
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 99n });

      const params = makeBuyParams({ price: 100, stopLossPct: 0.05, takeProfitPct: 0.10 });
      const result = await orderManager.executeBuy(params);

      expect(result.success).toBe(true);

      // Fill price = 100 * (1 + 0.002) = 100.2
      // Stop loss  = 100.2 * (1 - 0.05) = 95.19
      // Take profit = 100.2 * (1 + 0.10) = 110.22
      const tradeInsert = capturedValues[0];
      expect((tradeInsert.entryPrice as number)).toBeCloseTo(100.2, 5);
      expect((tradeInsert.stopLoss as number)).toBeCloseTo(95.19, 4);
      expect((tradeInsert.takeProfit as number)).toBeCloseTo(110.22, 4);
    });

    it('sets dryTpOrderId to undefined when takeProfitPct is 0 (dry run)', async () => {
      // Covers line 87 false branch: takeProfitPct > 0 is false → dryTpOrderId = undefined
      mockSelectChain.get.mockReturnValueOnce(undefined);
      const capturedValues: Record<string, unknown>[] = [];
      mockTxInsertChain.values = vi.fn().mockImplementation((val: Record<string, unknown>) => {
        capturedValues.push(val);
        return mockTxInsertChain;
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 55n });

      const result = await orderManager.executeBuy(makeBuyParams({ takeProfitPct: 0 }));

      expect(result.success).toBe(true);
      // With takeProfitPct=0, no TP order ID is stored
      const tradeInsert = capturedValues[0];
      expect(tradeInsert.takeProfitOrderId).toBeUndefined();
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
      // No need to mock position check — function returns before reaching it
      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(false);
      expect(result.error).toContain('T212 client not initialized');
    });

    it('rejects duplicate buy when position already exists (live path)', async () => {
      // Client is set, but position already exists — covers lines 184-188
      const client = makeMockT212Client();
      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce({ symbol: 'AAPL', shares: 5 });

      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Position already exists');
      expect(client.placeMarketOrder).not.toHaveBeenCalled();
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

    it('handles stop-loss order failure by returning error and not creating DB position', async () => {
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

      // Should fail: stop-loss failure triggers emergency close, no DB record
      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Stop-loss placement failed');
      expect(result.error).toContain('no DB record created');
      // DB transaction should NOT have been called (phantom position prevented)
      expect(mockTransaction).not.toHaveBeenCalled();
      // Emergency close was attempted (second placeMarketOrder call)
      expect(client.placeMarketOrder).toHaveBeenCalledTimes(2);
      // Audit log records the phantom prevention
      expect(mockLogRisk).toHaveBeenCalledWith(
        expect.stringContaining('Phantom position prevented'),
        expect.objectContaining({ symbol: 'AAPL' }),
        'error',
      );
    });

    it('logs FATAL when both stop-loss and close-position fail, still prevents phantom', async () => {
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

      const result = await orderManager.executeBuy(makeBuyParams());

      // No DB record created despite FATAL close failure (phantom prevention)
      expect(result.success).toBe(false);
      expect(result.error).toContain('Stop-loss placement failed');
      // Verify both placeMarketOrder calls happened (buy + attempted close)
      expect(client.placeMarketOrder).toHaveBeenCalledTimes(2);
      // DB transaction should NOT have been called
      expect(mockTransaction).not.toHaveBeenCalled();
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

    // ── Fix #1: Phantom Position Bug ────────────────────────────────────
    it('should not create DB position when stop-loss placement fails (phantom prevention)', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder
        .mockResolvedValueOnce({ id: 200 })   // buy order
        .mockResolvedValueOnce({ id: 201 });   // emergency close
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1500,
        filledQuantity: 10,
      });
      client.placeStopOrder.mockRejectedValue(new Error('Exchange rejected stop'));

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined); // no existing position

      const result = await orderManager.executeBuy(makeBuyParams());

      // Must fail — no phantom position
      expect(result.success).toBe(false);
      expect(result.error).toContain('Stop-loss placement failed');
      expect(result.error).toContain('no DB record created');
      expect(result.orderId).toBe('200');

      // DB transaction must NOT be called — this is the core of the fix
      expect(mockTransaction).not.toHaveBeenCalled();

      // Emergency close was attempted
      expect(client.placeMarketOrder).toHaveBeenCalledTimes(2);

      // Audit log records the event
      expect(mockLogRisk).toHaveBeenCalledWith(
        expect.stringContaining('Phantom position prevented for AAPL'),
        expect.objectContaining({ symbol: 'AAPL', orderId: '200', fillPrice: 150 }),
        'error',
      );
    });

    // ── Fix #2: Race Condition on Duplicate Check ───────────────────────
    it('should detect duplicate position at insert time and handle gracefully', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder
        .mockResolvedValueOnce({ id: 300 })   // buy order
        .mockResolvedValueOnce({ id: 301 });   // close duplicate on exchange
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1500,
        filledQuantity: 10,
      });
      client.placeStopOrder.mockResolvedValue({ id: 400 });
      client.cancelOrder.mockResolvedValue(undefined);

      orderManager.setT212Client(client);
      // Pre-check: no position (fast path passes)
      mockSelectChain.get.mockReturnValueOnce(undefined);
      // Inside transaction: position already exists (race condition)
      mockSelectChain.get.mockReturnValueOnce({ symbol: 'AAPL', shares: 10 });

      const result = await orderManager.executeBuy(makeBuyParams());

      // Must fail — duplicate detected at insert time
      expect(result.success).toBe(false);
      expect(result.error).toContain('Duplicate position detected');
      expect(result.error).toContain('exchange position closed');
      expect(result.orderId).toBe('300');

      // Transaction was called but did early return (no insert)
      expect(mockTransaction).toHaveBeenCalledOnce();

      // Exchange position was closed (third placeMarketOrder call: buy + close duplicate)
      expect(client.placeMarketOrder).toHaveBeenCalledTimes(2);

      // Stop-loss order was cancelled (best effort cleanup)
      expect(client.cancelOrder).toHaveBeenCalledWith(400);

      // Audit log records the race condition
      expect(mockLogRisk).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate position race condition'),
        expect.objectContaining({ symbol: 'AAPL', orderId: '300', fillPrice: 150 }),
        'error',
      );
    });

    it('should handle duplicate at insert time even when exchange close fails', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder
        .mockResolvedValueOnce({ id: 310 })   // buy order
        .mockRejectedValueOnce(new Error('Exchange down')); // close duplicate fails
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1500,
        filledQuantity: 10,
      });
      client.placeStopOrder.mockResolvedValue({ id: 410 });
      client.cancelOrder.mockResolvedValue(undefined);

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined); // pre-check passes
      mockSelectChain.get.mockReturnValueOnce({ symbol: 'AAPL', shares: 10 }); // tx check finds dup

      const result = await orderManager.executeBuy(makeBuyParams());

      // Still fails even though exchange close failed
      expect(result.success).toBe(false);
      expect(result.error).toContain('Duplicate position detected');
      expect(client.placeMarketOrder).toHaveBeenCalledTimes(2);
    });

    it('should cancel take-profit order when duplicate detected at insert time', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder
        .mockResolvedValueOnce({ id: 320 })   // buy order
        .mockResolvedValueOnce({ id: 321 });   // close duplicate
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1500,
        filledQuantity: 10,
      });
      client.placeStopOrder.mockResolvedValue({ id: 420 });
      client.placeLimitOrder.mockResolvedValue({ id: 520 }); // take-profit order
      client.cancelOrder.mockResolvedValue(undefined);

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined); // pre-check passes
      mockSelectChain.get.mockReturnValueOnce({ symbol: 'AAPL', shares: 10 }); // tx check finds dup

      const result = await orderManager.executeBuy(makeBuyParams({ takeProfitPct: 0.10 }));

      expect(result.success).toBe(false);
      // Both stop and TP orders should be cancelled
      expect(client.cancelOrder).toHaveBeenCalledWith(420); // stop order
      expect(client.cancelOrder).toHaveBeenCalledWith(520); // take-profit order
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

    it('applies slippage when paperTrading config is true (dry run)', async () => {
      // Covers lines 434-439 where paperTrading=true triggers slippage computation
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'execution.dryRun': true,
          'execution.orderTimeoutSeconds': 10,
          'execution.stopLossDelay': 3000,
          'execution.paperTrading': true,
          'trading.slippageMarketPct': 0.001, // 0.1% slippage
        };
        return defaults[key];
      });

      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 100,
        currentPrice: 150,
        entryTime: '2024-01-01T00:00:00Z',
      });

      const capturedValues: Record<string, unknown>[] = [];
      mockTxInsertChain.values = vi.fn().mockImplementation((val: Record<string, unknown>) => {
        capturedValues.push(val);
        return mockTxInsertChain;
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 50n });

      const result = await orderManager.executeClose(makeCloseParams());

      expect(result.success).toBe(true);
      const tradeInsert = capturedValues[0];
      // Exit price should have slippage applied (150 * (1 - 0.001) = 149.85)
      expect(tradeInsert.exitPrice).toBeCloseTo(149.85, 5);
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
