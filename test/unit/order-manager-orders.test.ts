import { describe, expect, it, vi, beforeEach } from 'vitest';

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

// Mock orders repository
const mockCreateOrder = vi.fn().mockReturnValue(1);
const mockUpdateOrderStatus = vi.fn();

vi.mock('../../src/db/repositories/orders.js', () => ({
  createOrder: (...args: unknown[]) => mockCreateOrder(...args),
  updateOrderStatus: (...args: unknown[]) => mockUpdateOrderStatus(...args),
}));

// Mock DB
const mockDbRun = vi.fn().mockReturnValue({ lastInsertRowid: 1n, changes: 1 });
const mockDbGet = vi.fn();
const mockDbAll = vi.fn().mockReturnValue([]);

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

describe('OrderManager - Order Record Tracking', () => {
  let orderManager: OrderManager;

  beforeEach(() => {
    vi.clearAllMocks();
    orderManager = new OrderManager();
    mockCreateOrder.mockReturnValue(1);
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

  // ── executeBuy: dry run creates order record ──────────────────────────
  describe('executeBuy - dry run order tracking', () => {
    it('creates a pending order record before execution', async () => {
      mockSelectChain.get.mockReturnValueOnce(undefined); // no existing position
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 42n });

      await orderManager.executeBuy(makeBuyParams());

      expect(mockCreateOrder).toHaveBeenCalledOnce();
      expect(mockCreateOrder).toHaveBeenCalledWith({
        symbol: 'AAPL',
        side: 'BUY',
        orderType: 'market',
        requestedQuantity: 10,
        requestedPrice: 150,
        orderTag: 'entry',
        accountType: 'INVEST',
      });
    });

    it('marks order as filled with dry-run T212 ID after execution', async () => {
      mockSelectChain.get.mockReturnValueOnce(undefined);
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 42n });

      await orderManager.executeBuy(makeBuyParams());

      expect(mockUpdateOrderStatus).toHaveBeenCalledOnce();
      const updateCall = mockUpdateOrderStatus.mock.calls[0];
      expect(updateCall[0]).toBe(1); // orderId
      expect(updateCall[1].status).toBe('filled');
      expect(updateCall[1].filledQuantity).toBe(10);
      expect(updateCall[1].filledPrice).toBe(150);
      expect(updateCall[1].t212OrderId).toMatch(/^dry_run_BUY_AAPL_/);
      expect(updateCall[1].filledAt).toBeDefined();
    });

    it('returns localOrderId in result', async () => {
      mockSelectChain.get.mockReturnValueOnce(undefined);
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 42n });

      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(true);
      expect(result.localOrderId).toBe(1);
    });

    it('does not create order when position already exists', async () => {
      mockSelectChain.get.mockReturnValueOnce({ symbol: 'AAPL', shares: 10 });

      await orderManager.executeBuy(makeBuyParams());

      expect(mockCreateOrder).not.toHaveBeenCalled();
    });
  });

  // ── executeBuy: live order lifecycle tracking ─────────────────────────
  describe('executeBuy - live order lifecycle', () => {
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

    it('creates pending order, updates to open, then filled on success', async () => {
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

      let orderCallIndex = 0;
      mockCreateOrder.mockImplementation(() => {
        orderCallIndex++;
        return orderCallIndex;
      });

      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(true);

      // First createOrder: entry order
      expect(mockCreateOrder.mock.calls[0][0].orderTag).toBe('entry');

      // Update calls for entry order:
      // 1. open (with t212OrderId)
      // 2. filled (with fill data)
      const entryUpdates = mockUpdateOrderStatus.mock.calls.filter(
        (call: unknown[]) => call[0] === 1,
      );
      expect(entryUpdates.length).toBe(2);
      expect(entryUpdates[0][1].status).toBe('open');
      expect(entryUpdates[0][1].t212OrderId).toBe('101');
      expect(entryUpdates[1][1].status).toBe('filled');
      expect(entryUpdates[1][1].filledPrice).toBe(150);
    });

    it('creates stop-loss order record when placing on exchange', async () => {
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

      let orderCallIndex = 0;
      mockCreateOrder.mockImplementation(() => {
        orderCallIndex++;
        return orderCallIndex;
      });

      await orderManager.executeBuy(makeBuyParams());

      // Second createOrder: stoploss order
      const slCall = mockCreateOrder.mock.calls.find(
        (call: unknown[]) => (call[0] as any).orderTag === 'stoploss',
      );
      expect(slCall).toBeDefined();
      expect(slCall[0].side).toBe('SELL');
      expect(slCall[0].orderType).toBe('stop');
    });

    it('creates take-profit order record when takeProfitPct > 0', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 101 });
      client.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1500,
        filledQuantity: 10,
      });
      client.placeStopOrder.mockResolvedValue({ id: 201 });
      client.placeLimitOrder.mockResolvedValue({ id: 301 });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 5n });

      let orderCallIndex = 0;
      mockCreateOrder.mockImplementation(() => {
        orderCallIndex++;
        return orderCallIndex;
      });

      await orderManager.executeBuy(makeBuyParams({ takeProfitPct: 0.10 }));

      // Third createOrder: take_profit order
      const tpCall = mockCreateOrder.mock.calls.find(
        (call: unknown[]) => (call[0] as any).orderTag === 'take_profit',
      );
      expect(tpCall).toBeDefined();
      expect(tpCall[0].side).toBe('SELL');
      expect(tpCall[0].orderType).toBe('limit');
    });

    it('marks order as failed when T212 order fill times out', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockResolvedValue({ id: 102 });
      client.getOrder.mockResolvedValue({ status: 'NEW' });

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);

      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(false);
      expect(result.localOrderId).toBe(1);

      // Should have update to open, then to failed
      const failUpdate = mockUpdateOrderStatus.mock.calls.find(
        (call: unknown[]) => (call[1] as any).status === 'failed',
      );
      expect(failUpdate).toBeDefined();
      expect(failUpdate[1].cancelReason).toBe('Order fill timeout');
    });

    it('marks order as failed when placeMarketOrder throws', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockRejectedValue(new Error('API down'));

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);

      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(false);
      expect(result.localOrderId).toBe(1);

      const failUpdate = mockUpdateOrderStatus.mock.calls.find(
        (call: unknown[]) => (call[1] as any).status === 'failed',
      );
      expect(failUpdate).toBeDefined();
      expect(failUpdate[1].cancelReason).toBe('API down');
    });

    it('returns localOrderId even on failure', async () => {
      const client = makeMockT212Client();
      client.placeMarketOrder.mockRejectedValue(new Error('Network error'));

      orderManager.setT212Client(client);
      mockSelectChain.get.mockReturnValueOnce(undefined);

      const result = await orderManager.executeBuy(makeBuyParams());

      expect(result.success).toBe(false);
      expect(result.localOrderId).toBe(1);
    });
  });

  // ── executeClose: dry run creates order record ─────────────────────
  describe('executeClose - dry run order tracking', () => {
    it('creates a pending order record with exit tag', async () => {
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: 155,
        entryTime: '2024-01-01T00:00:00Z',
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 10n });

      await orderManager.executeClose(makeCloseParams());

      expect(mockCreateOrder).toHaveBeenCalledOnce();
      expect(mockCreateOrder).toHaveBeenCalledWith({
        symbol: 'AAPL',
        side: 'SELL',
        orderType: 'market',
        requestedQuantity: 10,
        requestedPrice: 155,
        orderTag: 'take_profit', // "Take profit reached" maps to take_profit
        accountType: 'INVEST',
      });
    });

    it('maps stoploss exit reason to stoploss tag', async () => {
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: 130,
        entryTime: '2024-01-01T00:00:00Z',
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 10n });

      await orderManager.executeClose(
        makeCloseParams({ exitReason: 'Stop-loss triggered' }),
      );

      expect(mockCreateOrder.mock.calls[0][0].orderTag).toBe('stoploss');
    });

    it('maps generic exit reason to exit tag', async () => {
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: 145,
        entryTime: '2024-01-01T00:00:00Z',
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 10n });

      await orderManager.executeClose(
        makeCloseParams({ exitReason: 'AI re-evaluation sell signal' }),
      );

      expect(mockCreateOrder.mock.calls[0][0].orderTag).toBe('exit');
    });

    it('marks order as filled with dry-run T212 ID', async () => {
      mockSelectChain.get.mockReturnValueOnce({
        symbol: 'AAPL',
        shares: 10,
        entryPrice: 140,
        currentPrice: 155,
        entryTime: '2024-01-01T00:00:00Z',
      });
      mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 10n });

      await orderManager.executeClose(makeCloseParams());

      expect(mockUpdateOrderStatus).toHaveBeenCalledOnce();
      const updateCall = mockUpdateOrderStatus.mock.calls[0];
      expect(updateCall[1].status).toBe('filled');
      expect(updateCall[1].t212OrderId).toMatch(/^dry_run_SELL_AAPL_/);
      expect(updateCall[1].filledQuantity).toBe(10);
      expect(updateCall[1].filledPrice).toBe(155);
    });

    it('returns localOrderId in close result', async () => {
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
      expect(result.localOrderId).toBe(1);
    });

    it('does not create order when no position exists', async () => {
      mockSelectChain.get.mockReturnValueOnce(undefined);

      await orderManager.executeClose(makeCloseParams());

      expect(mockCreateOrder).not.toHaveBeenCalled();
    });
  });

  // ── executeClose: live order lifecycle ─────────────────────────────
  describe('executeClose - live order lifecycle', () => {
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

    it('creates pending order, updates to open, then filled', async () => {
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
      expect(result.localOrderId).toBe(1);

      // Verify order lifecycle updates
      const statusUpdates = mockUpdateOrderStatus.mock.calls;
      const openUpdate = statusUpdates.find(
        (call: unknown[]) => (call[1] as any).status === 'open',
      );
      const filledUpdate = statusUpdates.find(
        (call: unknown[]) => (call[1] as any).status === 'filled',
      );

      expect(openUpdate).toBeDefined();
      expect(openUpdate[1].t212OrderId).toBe('301');
      expect(filledUpdate).toBeDefined();
      expect(filledUpdate[1].filledPrice).toBe(155);
    });

    it('marks order as failed when sell times out', async () => {
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
      expect(result.localOrderId).toBe(1);

      const failUpdate = mockUpdateOrderStatus.mock.calls.find(
        (call: unknown[]) => (call[1] as any).status === 'failed',
      );
      expect(failUpdate).toBeDefined();
      expect(failUpdate[1].cancelReason).toBe('Sell order fill timeout');
    });

    it('marks order as failed when placeMarketOrder throws', async () => {
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
      expect(result.localOrderId).toBe(1);

      const failUpdate = mockUpdateOrderStatus.mock.calls.find(
        (call: unknown[]) => (call[1] as any).status === 'failed',
      );
      expect(failUpdate).toBeDefined();
      expect(failUpdate[1].cancelReason).toBe('Exchange closed');
    });
  });

  // ── resolveExitOrderTag mapping ───────────────────────────────────
  describe('exit reason to order tag mapping', () => {
    const testCases = [
      { reason: 'Stop-loss triggered', expected: 'stoploss' },
      { reason: 'Stoploss hit on trailing', expected: 'stoploss' },
      { reason: 'Stop loss protection', expected: 'stoploss' },
      { reason: 'Take profit reached', expected: 'take_profit' },
      { reason: 'Take-profit level hit', expected: 'take_profit' },
      { reason: 'TP target achieved', expected: 'take_profit' },
      { reason: 'Partial exit - reduce exposure', expected: 'partial_exit' },
      { reason: 'AI re-evaluation', expected: 'exit' },
      { reason: 'Emergency stop', expected: 'exit' },
      { reason: 'Manual close', expected: 'exit' },
    ];

    for (const tc of testCases) {
      it(`maps "${tc.reason}" to "${tc.expected}"`, async () => {
        mockSelectChain.get.mockReturnValueOnce({
          symbol: 'AAPL',
          shares: 10,
          entryPrice: 140,
          currentPrice: 150,
          entryTime: '2024-01-01T00:00:00Z',
        });
        mockTxInsertChain.run.mockReturnValue({ lastInsertRowid: 1n });

        await orderManager.executeClose(makeCloseParams({ exitReason: tc.reason }));

        expect(mockCreateOrder.mock.calls[0][0].orderTag).toBe(tc.expected);
      });
    }
  });
});
