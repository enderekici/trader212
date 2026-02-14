import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const mockCreateOrder = vi.fn().mockReturnValue(100);
const mockUpdateOrderStatus = vi.fn();
const mockGetOpenOrders = vi.fn().mockReturnValue([]);
const mockGetOrderById = vi.fn();
const mockCancelOrder = vi.fn();
const mockFindOrderReplacedBy = vi.fn().mockReturnValue(undefined);
const mockSetReplacedByOrderId = vi.fn();

vi.mock('../../src/db/repositories/orders.js', () => ({
  createOrder: (...args: unknown[]) => mockCreateOrder(...args),
  updateOrderStatus: (...args: unknown[]) => mockUpdateOrderStatus(...args),
  getOpenOrders: () => mockGetOpenOrders(),
  getOrderById: (...args: unknown[]) => mockGetOrderById(...args),
  cancelOrder: (...args: unknown[]) => mockCancelOrder(...args),
  findOrderReplacedBy: (...args: unknown[]) => mockFindOrderReplacedBy(...args),
  setReplacedByOrderId: (...args: unknown[]) => mockSetReplacedByOrderId(...args),
}));

// Mock DB
const mockDbGet = vi.fn();

function createChainableQuery(terminal: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'set', 'values', 'orderBy', 'limit'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.run = terminal.run ?? vi.fn();
  chain.get = terminal.get ?? mockDbGet;
  chain.all = terminal.all ?? vi.fn().mockReturnValue([]);
  return chain;
}

const mockSelectChain = createChainableQuery();

vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    select: () => mockSelectChain,
    insert: () => createChainableQuery(),
    update: () => createChainableQuery(),
    delete: () => createChainableQuery(),
  }),
}));

vi.mock('../../src/db/schema.js', () => ({
  positions: { symbol: 'symbol', t212Ticker: 't212Ticker' },
  orders: { id: 'id', replacedByOrderId: 'replacedByOrderId' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => 'eq_condition'),
}));

// Mock Yahoo Finance for price fetching
const mockGetQuote = vi.fn();
vi.mock('../../src/data/yahoo-finance.js', () => ({
  YahooFinanceClient: vi.fn().mockImplementation(function () {
    return { getQuote: mockGetQuote };
  }),
}));

// ── Import SUT after mocks ─────────────────────────────────────────────────

import {
  OrderReplacer,
  type ReplaceResult,
  type ReplaceOrderResult,
} from '../../src/execution/order-replacer.js';
import type { Order } from '../../src/db/repositories/orders.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    tradeId: null,
    positionId: null,
    symbol: 'AAPL',
    side: 'BUY',
    orderType: 'limit',
    status: 'open',
    requestedQuantity: 10,
    filledQuantity: 0,
    requestedPrice: 150,
    filledPrice: null,
    stopPrice: null,
    t212OrderId: '5001',
    cancelReason: null,
    orderTag: 'entry',
    replacedByOrderId: null,
    accountType: 'INVEST',
    createdAt: new Date(Date.now() - 120_000).toISOString(), // 2 minutes ago
    updatedAt: new Date().toISOString(),
    filledAt: null,
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

function setDefaultConfig() {
  mockConfigGet.mockImplementation((key: string) => {
    const defaults: Record<string, unknown> = {
      'execution.dryRun': false,
      'execution.orderReplacement.enabled': true,
      'execution.orderReplacement.checkIntervalSeconds': 30,
      'execution.orderReplacement.replaceAfterSeconds': 60,
      'execution.orderReplacement.priceDeviationPct': 0.005,
      'execution.orderReplacement.maxReplacements': 3,
    };
    return defaults[key];
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('OrderReplacer', () => {
  let replacer: OrderReplacer;
  let mockClient: ReturnType<typeof makeMockT212Client>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = makeMockT212Client();
    replacer = new OrderReplacer(mockClient);
    setDefaultConfig();
    mockCreateOrder.mockReturnValue(100);
    mockFindOrderReplacedBy.mockReturnValue(undefined);
  });

  // ── shouldReplace ───────────────────────────────────────────────────

  describe('shouldReplace', () => {
    it('returns true when price deviation exceeds threshold', () => {
      const order = makeOrder({ requestedPrice: 100 });
      // 1% deviation > 0.5% threshold
      expect(replacer.shouldReplace(order, 101)).toBe(true);
    });

    it('returns true when price drops below threshold', () => {
      const order = makeOrder({ requestedPrice: 100 });
      // 1% deviation below
      expect(replacer.shouldReplace(order, 99)).toBe(true);
    });

    it('returns false when price deviation is below threshold', () => {
      const order = makeOrder({ requestedPrice: 100 });
      // 0.3% deviation < 0.5% threshold
      expect(replacer.shouldReplace(order, 100.3)).toBe(false);
    });

    it('returns false when price deviation equals threshold exactly', () => {
      const order = makeOrder({ requestedPrice: 100 });
      // Exactly 0.5% — not greater than
      expect(replacer.shouldReplace(order, 100.5)).toBe(false);
    });

    it('returns false when requestedPrice is null', () => {
      const order = makeOrder({ requestedPrice: null });
      expect(replacer.shouldReplace(order, 100)).toBe(false);
    });

    it('returns false when requestedPrice is zero', () => {
      const order = makeOrder({ requestedPrice: 0 });
      expect(replacer.shouldReplace(order, 100)).toBe(false);
    });

    it('returns false when currentPrice is zero', () => {
      const order = makeOrder({ requestedPrice: 100 });
      expect(replacer.shouldReplace(order, 0)).toBe(false);
    });

    it('returns false when currentPrice is negative', () => {
      const order = makeOrder({ requestedPrice: 100 });
      expect(replacer.shouldReplace(order, -5)).toBe(false);
    });

    it('uses configurable deviation threshold', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'execution.orderReplacement.priceDeviationPct') return 0.02; // 2%
        return 0;
      });
      const order = makeOrder({ requestedPrice: 100 });
      // 1.5% deviation < 2% threshold
      expect(replacer.shouldReplace(order, 101.5)).toBe(false);
      // 2.5% deviation > 2% threshold
      expect(replacer.shouldReplace(order, 102.5)).toBe(true);
    });
  });

  // ── processOpenOrders ───────────────────────────────────────────────

  describe('processOpenOrders', () => {
    it('returns empty result when no open orders', async () => {
      mockGetOpenOrders.mockReturnValue([]);
      const result = await replacer.processOpenOrders();
      expect(result.checked).toBe(0);
      expect(result.replaced).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it('skips stoploss orders', async () => {
      mockGetOpenOrders.mockReturnValue([makeOrder({ orderTag: 'stoploss' })]);
      const result = await replacer.processOpenOrders();
      expect(result.checked).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.replaced).toBe(0);
    });

    it('skips take_profit orders', async () => {
      mockGetOpenOrders.mockReturnValue([makeOrder({ orderTag: 'take_profit' })]);
      const result = await replacer.processOpenOrders();
      expect(result.checked).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('skips market orders', async () => {
      mockGetOpenOrders.mockReturnValue([makeOrder({ orderType: 'market' })]);
      const result = await replacer.processOpenOrders();
      expect(result.checked).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('skips orders that are not old enough', async () => {
      const freshOrder = makeOrder({
        createdAt: new Date().toISOString(), // just created
      });
      mockGetOpenOrders.mockReturnValue([freshOrder]);
      const result = await replacer.processOpenOrders();
      expect(result.checked).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('skips orders when price has not deviated enough', async () => {
      const order = makeOrder({ requestedPrice: 150 });
      mockGetOpenOrders.mockReturnValue([order]);
      mockGetQuote.mockResolvedValue({ price: 150.5 }); // 0.33% deviation < 0.5%

      const result = await replacer.processOpenOrders();
      expect(result.checked).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('replaces stale orders with significant price deviation', async () => {
      const order = makeOrder({
        id: 10,
        requestedPrice: 150,
        orderType: 'limit',
        createdAt: new Date(Date.now() - 120_000).toISOString(),
      });
      mockGetOpenOrders.mockReturnValue([order]);
      mockGetOrderById.mockReturnValue(order);
      mockGetQuote.mockResolvedValue({ price: 155 }); // 3.33% deviation > 0.5%

      // Dry-run mode for simplicity
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'execution.dryRun': true,
          'execution.orderReplacement.replaceAfterSeconds': 60,
          'execution.orderReplacement.priceDeviationPct': 0.005,
          'execution.orderReplacement.maxReplacements': 3,
        };
        return defaults[key];
      });

      const result = await replacer.processOpenOrders();
      expect(result.replaced).toBe(1);
      expect(result.checked).toBe(1);
    });

    it('skips when current price cannot be fetched', async () => {
      const order = makeOrder({
        requestedPrice: 150,
        createdAt: new Date(Date.now() - 120_000).toISOString(),
      });
      mockGetOpenOrders.mockReturnValue([order]);
      mockGetQuote.mockResolvedValue(null);

      const result = await replacer.processOpenOrders();
      expect(result.checked).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('records errors when replacement fails', async () => {
      const order = makeOrder({
        id: 42,
        requestedPrice: 150,
        createdAt: new Date(Date.now() - 120_000).toISOString(),
      });
      mockGetOpenOrders.mockReturnValue([order]);
      mockGetOrderById.mockReturnValue(order);
      mockGetQuote.mockResolvedValue({ price: 160 });

      // Live mode, client cancel throws
      mockClient.cancelOrder.mockRejectedValue(new Error('Network error'));
      mockClient.getOrder.mockRejectedValue(new Error('Network error'));

      const result = await replacer.processOpenOrders();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('counts filledDuringCancel correctly', async () => {
      const order = makeOrder({
        id: 10,
        requestedPrice: 150,
        createdAt: new Date(Date.now() - 120_000).toISOString(),
      });
      mockGetOpenOrders.mockReturnValue([order]);
      mockGetOrderById.mockReturnValue(order);
      mockGetQuote.mockResolvedValue({ price: 160 });

      // Cancel fails, but order is filled
      mockClient.cancelOrder.mockRejectedValue(new Error('Cannot cancel'));
      mockClient.getOrder.mockResolvedValue({
        status: 'FILLED',
        filledValue: 1500,
        filledQuantity: 10,
      });

      const result = await replacer.processOpenOrders();
      expect(result.filledDuringCancel).toBe(1);
      expect(result.replaced).toBe(0);
    });
  });

  // ── replaceOrder ────────────────────────────────────────────────────

  describe('replaceOrder', () => {
    it('returns error when order not found', async () => {
      mockGetOrderById.mockReturnValue(undefined);
      const result = await replacer.replaceOrder(999, 155);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('refuses to replace stoploss orders', async () => {
      mockGetOrderById.mockReturnValue(makeOrder({ orderTag: 'stoploss' }));
      const result = await replacer.replaceOrder(1, 155);
      expect(result.success).toBe(false);
      expect(result.error).toContain('stoploss');
    });

    it('refuses to replace take_profit orders', async () => {
      mockGetOrderById.mockReturnValue(makeOrder({ orderTag: 'take_profit' }));
      const result = await replacer.replaceOrder(1, 155);
      expect(result.success).toBe(false);
      expect(result.error).toContain('take_profit');
    });

    // ── Dry-run replacement ───────────────────────────────────────────

    describe('dry-run mode', () => {
      beforeEach(() => {
        mockConfigGet.mockImplementation((key: string) => {
          const defaults: Record<string, unknown> = {
            'execution.dryRun': true,
            'execution.orderReplacement.priceDeviationPct': 0.005,
            'execution.orderReplacement.maxReplacements': 3,
          };
          return defaults[key];
        });
      });

      it('cancels old order and creates new one at new price', async () => {
        const order = makeOrder({ id: 5, requestedPrice: 150 });
        mockGetOrderById.mockReturnValue(order);
        mockCreateOrder.mockReturnValue(50);

        const result = await replacer.replaceOrder(5, 155);

        expect(result.success).toBe(true);
        expect(result.newOrderId).toBe(50);

        // Old order cancelled
        expect(mockCancelOrder).toHaveBeenCalledWith(5, 'replaced');

        // New order created at new price
        expect(mockCreateOrder).toHaveBeenCalledWith(
          expect.objectContaining({
            symbol: 'AAPL',
            side: 'BUY',
            orderType: 'limit',
            requestedQuantity: 10,
            requestedPrice: 155,
            orderTag: 'entry',
            accountType: 'INVEST',
          }),
        );

        // Replacement chain linked
        expect(mockSetReplacedByOrderId).toHaveBeenCalledWith(5, 50);
      });

      it('fills new order immediately in dry-run', async () => {
        const order = makeOrder({ id: 5 });
        mockGetOrderById.mockReturnValue(order);
        mockCreateOrder.mockReturnValue(50);

        await replacer.replaceOrder(5, 155);

        // New order marked as filled
        const fillCall = mockUpdateOrderStatus.mock.calls.find(
          (call: unknown[]) =>
            call[0] === 50 && (call[1] as any).status === 'filled',
        );
        expect(fillCall).toBeDefined();
        expect(fillCall[1].filledQuantity).toBe(10);
        expect(fillCall[1].filledPrice).toBe(155);
        expect(fillCall[1].t212OrderId).toMatch(/^dry_run_replace_BUY_AAPL_/);
      });

      it('uses synthetic dry-run T212 ID', async () => {
        const order = makeOrder({ id: 5, side: 'SELL', symbol: 'MSFT' });
        mockGetOrderById.mockReturnValue(order);
        mockCreateOrder.mockReturnValue(50);

        await replacer.replaceOrder(5, 300);

        const fillCall = mockUpdateOrderStatus.mock.calls.find(
          (call: unknown[]) =>
            call[0] === 50 && (call[1] as any).status === 'filled',
        );
        expect(fillCall[1].t212OrderId).toMatch(/^dry_run_replace_SELL_MSFT_/);
      });
    });

    // ── Live replacement ──────────────────────────────────────────────

    describe('live mode', () => {
      it('returns error when T212 client is null', async () => {
        const replacerNoClient = new OrderReplacer(null);
        mockGetOrderById.mockReturnValue(makeOrder());

        const result = await replacerNoClient.replaceOrder(1, 155);
        expect(result.success).toBe(false);
        expect(result.error).toContain('T212 client not initialized');
      });

      it('returns error when order has no T212 ID', async () => {
        mockGetOrderById.mockReturnValue(makeOrder({ t212OrderId: null }));
        const result = await replacer.replaceOrder(1, 155);
        expect(result.success).toBe(false);
        expect(result.error).toContain('no T212 ID');
      });

      it('returns error for dry-run T212 IDs in live mode', async () => {
        mockGetOrderById.mockReturnValue(
          makeOrder({ t212OrderId: 'dry_run_BUY_AAPL_12345' }),
        );
        const result = await replacer.replaceOrder(1, 155);
        expect(result.success).toBe(false);
        expect(result.error).toContain('dry-run');
      });

      it('successfully cancels and replaces a limit order', async () => {
        const order = makeOrder({
          id: 10,
          t212OrderId: '5001',
          orderType: 'limit',
          requestedPrice: 150,
        });
        mockGetOrderById.mockReturnValue(order);
        mockCreateOrder.mockReturnValue(200);

        // Cancel succeeds
        mockClient.cancelOrder.mockResolvedValue(undefined);
        // Verify cancel: order is cancelled
        mockClient.getOrder.mockResolvedValue({
          id: 5001,
          status: 'CANCELLED',
          ticker: 'AAPL_US_EQ',
        });
        // Place new limit order
        mockClient.placeLimitOrder.mockResolvedValue({ id: 6001 });

        const result = await replacer.replaceOrder(10, 155);

        expect(result.success).toBe(true);
        expect(result.newOrderId).toBe(200);

        // Verify cancel was called
        expect(mockClient.cancelOrder).toHaveBeenCalledWith(5001);

        // Verify new limit order placed
        expect(mockClient.placeLimitOrder).toHaveBeenCalledWith({
          ticker: 'AAPL_US_EQ',
          quantity: 10,
          limitPrice: 155,
          timeValidity: 'DAY',
        });

        // Verify old order cancelled in DB
        expect(mockCancelOrder).toHaveBeenCalledWith(10, 'replaced');

        // Verify replacement chain
        expect(mockSetReplacedByOrderId).toHaveBeenCalledWith(10, 200);

        // Verify new order updated with T212 ID
        const openUpdate = mockUpdateOrderStatus.mock.calls.find(
          (call: unknown[]) =>
            call[0] === 200 && (call[1] as any).status === 'open',
        );
        expect(openUpdate).toBeDefined();
        expect(openUpdate[1].t212OrderId).toBe('6001');
      });

      it('places stop order for stop orderType', async () => {
        const order = makeOrder({
          id: 10,
          t212OrderId: '5001',
          orderType: 'stop',
          requestedPrice: 140,
          stopPrice: 140,
        });
        mockGetOrderById.mockReturnValue(order);
        mockCreateOrder.mockReturnValue(200);

        mockClient.cancelOrder.mockResolvedValue(undefined);
        mockClient.getOrder.mockResolvedValue({
          id: 5001,
          status: 'CANCELLED',
          ticker: 'AAPL_US_EQ',
        });
        mockClient.placeStopOrder.mockResolvedValue({ id: 6001 });

        const result = await replacer.replaceOrder(10, 138);

        expect(result.success).toBe(true);
        expect(mockClient.placeStopOrder).toHaveBeenCalledWith({
          ticker: 'AAPL_US_EQ',
          quantity: 10,
          stopPrice: 138,
          timeValidity: 'DAY',
        });
      });

      it('detects order filled during cancel attempt', async () => {
        const order = makeOrder({ id: 10, t212OrderId: '5001' });
        mockGetOrderById.mockReturnValue(order);

        // Cancel fails
        mockClient.cancelOrder.mockRejectedValue(new Error('Cannot cancel'));
        // Order was filled
        mockClient.getOrder.mockResolvedValue({
          status: 'FILLED',
          filledValue: 1500,
          filledQuantity: 10,
        });

        const result = await replacer.replaceOrder(10, 155);

        expect(result.success).toBe(false);
        expect(result.filledDuringCancel).toBe(true);

        // Local record updated as filled
        expect(mockUpdateOrderStatus).toHaveBeenCalledWith(
          10,
          expect.objectContaining({
            status: 'filled',
            filledQuantity: 10,
            filledPrice: 150,
          }),
        );

        // No new order placed
        expect(mockClient.placeLimitOrder).not.toHaveBeenCalled();
      });

      it('detects order filled during verification step', async () => {
        const order = makeOrder({ id: 10, t212OrderId: '5001' });
        mockGetOrderById.mockReturnValue(order);

        // Cancel succeeds
        mockClient.cancelOrder.mockResolvedValue(undefined);
        // But verification shows filled (race condition)
        mockClient.getOrder.mockResolvedValue({
          status: 'FILLED',
          filledValue: 1550,
          filledQuantity: 10,
        });

        const result = await replacer.replaceOrder(10, 155);

        expect(result.success).toBe(false);
        expect(result.filledDuringCancel).toBe(true);

        // Updated as filled
        expect(mockUpdateOrderStatus).toHaveBeenCalledWith(
          10,
          expect.objectContaining({
            status: 'filled',
            filledPrice: 155,
          }),
        );
      });

      it('retries cancel up to 3 times', async () => {
        const order = makeOrder({ id: 10, t212OrderId: '5001' });
        mockGetOrderById.mockReturnValue(order);

        // Cancel fails 3 times
        mockClient.cancelOrder.mockRejectedValue(new Error('Fail'));
        // Status check shows order is still open
        mockClient.getOrder.mockResolvedValue({
          status: 'NEW',
          ticker: 'AAPL_US_EQ',
        });

        const result = await replacer.replaceOrder(10, 155);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to cancel');
        expect(mockClient.cancelOrder).toHaveBeenCalledTimes(3);
      });

      it('succeeds when cancel fails but order is already cancelled', async () => {
        const order = makeOrder({ id: 10, t212OrderId: '5001' });
        mockGetOrderById.mockReturnValue(order);
        mockCreateOrder.mockReturnValue(200);

        // First cancel fails, status shows already cancelled
        mockClient.cancelOrder.mockRejectedValueOnce(new Error('Fail'));
        mockClient.getOrder
          .mockResolvedValueOnce({
            status: 'CANCELLED',
            ticker: 'AAPL_US_EQ',
          })
          .mockResolvedValue({
            status: 'CANCELLED',
            ticker: 'AAPL_US_EQ',
          });

        mockClient.placeLimitOrder.mockResolvedValue({ id: 6001 });

        const result = await replacer.replaceOrder(10, 155);
        expect(result.success).toBe(true);
      });

      it('fails when replacement order placement throws', async () => {
        const order = makeOrder({ id: 10, t212OrderId: '5001' });
        mockGetOrderById.mockReturnValue(order);

        mockClient.cancelOrder.mockResolvedValue(undefined);
        mockClient.getOrder.mockResolvedValue({
          status: 'CANCELLED',
          ticker: 'AAPL_US_EQ',
        });
        mockClient.placeLimitOrder.mockRejectedValue(
          new Error('Exchange closed'),
        );

        const result = await replacer.replaceOrder(10, 155);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Exchange closed');
      });

      it('fails when order status is not CANCELLED after cancel', async () => {
        const order = makeOrder({ id: 10, t212OrderId: '5001' });
        mockGetOrderById.mockReturnValue(order);

        mockClient.cancelOrder.mockResolvedValue(undefined);
        // Verification shows order is still WORKING
        mockClient.getOrder.mockResolvedValue({
          status: 'WORKING',
          ticker: 'AAPL_US_EQ',
        });

        const result = await replacer.replaceOrder(10, 155);

        expect(result.success).toBe(false);
        expect(result.error).toContain("'WORKING'");
      });

      it('proceeds when verification fetch fails (cancel accepted)', async () => {
        const order = makeOrder({ id: 10, t212OrderId: '5001' });
        mockGetOrderById.mockReturnValue(order);
        mockCreateOrder.mockReturnValue(200);

        mockClient.cancelOrder.mockResolvedValue(undefined);
        // Verification throws (API transient error)
        mockClient.getOrder
          .mockRejectedValueOnce(new Error('Network timeout'))
          // Ticker lookup also fails
          .mockRejectedValueOnce(new Error('Network timeout'));

        // But fallback ticker lookup from DB works
        mockDbGet.mockReturnValue({ t212Ticker: 'AAPL_US_EQ' });

        mockClient.placeLimitOrder.mockResolvedValue({ id: 6001 });

        const result = await replacer.replaceOrder(10, 155);

        // Should succeed because cancel was accepted
        expect(result.success).toBe(true);
      });

      it('resolves ticker from positions table as fallback', async () => {
        const order = makeOrder({ id: 10, t212OrderId: '5001' });
        mockGetOrderById.mockReturnValue(order);
        mockCreateOrder.mockReturnValue(200);

        mockClient.cancelOrder.mockResolvedValue(undefined);
        // Verification: cancelled, but no ticker
        mockClient.getOrder.mockResolvedValue({
          status: 'CANCELLED',
          // No ticker field
        });
        // Fallback: positions table
        mockDbGet.mockReturnValue({ t212Ticker: 'AAPL_US_EQ' });

        mockClient.placeLimitOrder.mockResolvedValue({ id: 6001 });

        const result = await replacer.replaceOrder(10, 155);
        expect(result.success).toBe(true);
      });

      it('fails when ticker cannot be resolved', async () => {
        const order = makeOrder({ id: 10, t212OrderId: '5001' });
        mockGetOrderById.mockReturnValue(order);

        mockClient.cancelOrder.mockResolvedValue(undefined);
        mockClient.getOrder.mockResolvedValue({ status: 'CANCELLED' });
        // No ticker from T212 or DB
        mockDbGet.mockReturnValue(undefined);

        const result = await replacer.replaceOrder(10, 155);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Could not resolve T212 ticker');
      });
    });
  });

  // ── Max replacements limit ──────────────────────────────────────────

  describe('max replacements limit', () => {
    it('skips orders that have reached max replacement depth', async () => {
      const order = makeOrder({
        id: 4,
        requestedPrice: 150,
        createdAt: new Date(Date.now() - 120_000).toISOString(),
      });
      mockGetOpenOrders.mockReturnValue([order]);
      mockGetQuote.mockResolvedValue({ price: 160 });

      // maxReplacements is 3
      // Simulate chain: order 1 -> 2 -> 3 -> 4 (current)
      // findOrderReplacedBy(4) -> order 3
      // findOrderReplacedBy(3) -> order 2
      // findOrderReplacedBy(2) -> order 1
      // findOrderReplacedBy(1) -> undefined
      mockFindOrderReplacedBy
        .mockReturnValueOnce(makeOrder({ id: 3 })) // parent of 4
        .mockReturnValueOnce(makeOrder({ id: 2 })) // parent of 3
        .mockReturnValueOnce(makeOrder({ id: 1 })) // parent of 2
        .mockReturnValueOnce(undefined); // no parent of 1

      const result = await replacer.processOpenOrders();
      expect(result.skipped).toBe(1);
      expect(result.replaced).toBe(0);
    });

    it('allows replacement when chain depth is below max', async () => {
      const order = makeOrder({
        id: 2,
        requestedPrice: 150,
        createdAt: new Date(Date.now() - 120_000).toISOString(),
      });
      mockGetOpenOrders.mockReturnValue([order]);
      mockGetOrderById.mockReturnValue(order);
      mockGetQuote.mockResolvedValue({ price: 160 });

      // Chain depth = 1 (one parent), max = 3
      mockFindOrderReplacedBy
        .mockReturnValueOnce(makeOrder({ id: 1 }))
        .mockReturnValueOnce(undefined);

      // Dry-run for simplicity
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'execution.dryRun': true,
          'execution.orderReplacement.replaceAfterSeconds': 60,
          'execution.orderReplacement.priceDeviationPct': 0.005,
          'execution.orderReplacement.maxReplacements': 3,
        };
        return defaults[key];
      });

      const result = await replacer.processOpenOrders();
      expect(result.replaced).toBe(1);
    });
  });

  // ── Replacement chain verification ──────────────────────────────────

  describe('replacement chain', () => {
    it('links old order to new order via replacedByOrderId', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'execution.dryRun': true,
          'execution.orderReplacement.priceDeviationPct': 0.005,
          'execution.orderReplacement.maxReplacements': 3,
        };
        return defaults[key];
      });

      const order = makeOrder({ id: 7 });
      mockGetOrderById.mockReturnValue(order);
      mockCreateOrder.mockReturnValue(42);

      await replacer.replaceOrder(7, 155);

      expect(mockSetReplacedByOrderId).toHaveBeenCalledWith(7, 42);
    });

    it('preserves order properties in replacement', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'execution.dryRun': true,
          'execution.orderReplacement.priceDeviationPct': 0.005,
          'execution.orderReplacement.maxReplacements': 3,
        };
        return defaults[key];
      });

      const order = makeOrder({
        id: 7,
        symbol: 'TSLA',
        side: 'BUY',
        orderType: 'limit',
        requestedQuantity: 5,
        orderTag: 'entry',
        accountType: 'ISA',
        stopPrice: 180,
      });
      mockGetOrderById.mockReturnValue(order);

      await replacer.replaceOrder(7, 200);

      expect(mockCreateOrder).toHaveBeenCalledWith({
        symbol: 'TSLA',
        side: 'BUY',
        orderType: 'limit',
        requestedQuantity: 5,
        requestedPrice: 200,
        stopPrice: 180,
        orderTag: 'entry',
        accountType: 'ISA',
      });
    });
  });

  // ── getCurrentPrice ─────────────────────────────────────────────────

  describe('getCurrentPrice', () => {
    it('returns price from Yahoo Finance', async () => {
      mockGetQuote.mockResolvedValue({ price: 155.50 });
      const price = await replacer.getCurrentPrice('AAPL');
      expect(price).toBe(155.50);
    });

    it('returns null when quote has no price', async () => {
      mockGetQuote.mockResolvedValue({});
      const price = await replacer.getCurrentPrice('AAPL');
      expect(price).toBeNull();
    });

    it('returns null when quote is null', async () => {
      mockGetQuote.mockResolvedValue(null);
      const price = await replacer.getCurrentPrice('AAPL');
      expect(price).toBeNull();
    });

    it('returns null on error', async () => {
      mockGetQuote.mockRejectedValue(new Error('API error'));
      const price = await replacer.getCurrentPrice('AAPL');
      expect(price).toBeNull();
    });
  });

  // ── Error handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('handles T212 API failure during cancel gracefully', async () => {
      const order = makeOrder({ id: 10, t212OrderId: '5001' });
      mockGetOrderById.mockReturnValue(order);

      mockClient.cancelOrder.mockRejectedValue(new Error('Service unavailable'));
      mockClient.getOrder.mockRejectedValue(new Error('Service unavailable'));

      const result = await replacer.replaceOrder(10, 155);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to cancel');
    });

    it('handles exception in processOpenOrders for individual orders', async () => {
      const order1 = makeOrder({
        id: 1,
        requestedPrice: 150,
        createdAt: new Date(Date.now() - 120_000).toISOString(),
      });
      const order2 = makeOrder({
        id: 2,
        symbol: 'MSFT',
        requestedPrice: 300,
        createdAt: new Date(Date.now() - 120_000).toISOString(),
      });
      mockGetOpenOrders.mockReturnValue([order1, order2]);
      mockGetQuote.mockResolvedValue({ price: 200 }); // big deviation for both

      // First order: getOrderById throws
      mockGetOrderById
        .mockImplementationOnce(() => {
          throw new Error('DB corruption');
        })
        .mockReturnValueOnce(order2);

      // Second order: dry-run replacement
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'execution.dryRun': true,
          'execution.orderReplacement.replaceAfterSeconds': 60,
          'execution.orderReplacement.priceDeviationPct': 0.005,
          'execution.orderReplacement.maxReplacements': 3,
        };
        return defaults[key];
      });

      const result = await replacer.processOpenOrders();

      // First order errored, second replaced
      expect(result.errors.length).toBe(1);
      expect(result.replaced).toBe(1);
    });
  });

  // ── Multiple orders processing ──────────────────────────────────────

  describe('multiple orders', () => {
    it('processes mix of replaceable and skippable orders', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'execution.dryRun': true,
          'execution.orderReplacement.replaceAfterSeconds': 60,
          'execution.orderReplacement.priceDeviationPct': 0.005,
          'execution.orderReplacement.maxReplacements': 3,
        };
        return defaults[key];
      });

      const stale = new Date(Date.now() - 120_000).toISOString();
      const fresh = new Date().toISOString();

      const orders = [
        makeOrder({ id: 1, orderTag: 'stoploss', createdAt: stale }), // skip: protected
        makeOrder({ id: 2, orderType: 'market', createdAt: stale }), // skip: market
        makeOrder({ id: 3, requestedPrice: 150, createdAt: fresh }), // skip: too fresh
        makeOrder({
          id: 4,
          requestedPrice: 150,
          createdAt: stale,
          orderTag: 'entry',
        }), // replace: stale + deviated
      ];

      mockGetOpenOrders.mockReturnValue(orders);
      mockGetOrderById.mockReturnValue(orders[3]);
      // Price deviated for all checks
      mockGetQuote.mockResolvedValue({ price: 160 });

      const result = await replacer.processOpenOrders();

      expect(result.checked).toBe(4);
      expect(result.skipped).toBe(3);
      expect(result.replaced).toBe(1);
    });
  });
});
