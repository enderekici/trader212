import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────

function createChainableMock(terminalValue?: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (prop === 'then' || prop === 'catch') return undefined;
      if (!chain[prop]) {
        chain[prop] = vi.fn((..._args: unknown[]) => {
          if (prop === 'get') return terminalValue;
          if (prop === 'all') return terminalValue;
          if (prop === 'run') return terminalValue;
          return new Proxy({}, handler);
        });
      }
      return chain[prop];
    },
  };
  return new Proxy({}, handler);
}

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../src/db/index.js', () => ({
  getDb: () => mockDb,
}));

vi.mock('../../src/db/schema.js', () => ({
  orders: {
    id: 'id',
    tradeId: 'tradeId',
    positionId: 'positionId',
    symbol: 'symbol',
    side: 'side',
    orderType: 'orderType',
    status: 'status',
    requestedQuantity: 'requestedQuantity',
    filledQuantity: 'filledQuantity',
    requestedPrice: 'requestedPrice',
    filledPrice: 'filledPrice',
    stopPrice: 'stopPrice',
    t212OrderId: 't212OrderId',
    cancelReason: 'cancelReason',
    orderTag: 'orderTag',
    replacedByOrderId: 'replacedByOrderId',
    accountType: 'accountType',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    filledAt: 'filledAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => 'eq_condition'),
  and: vi.fn((..._args: unknown[]) => 'and_condition'),
  desc: vi.fn((_col: unknown) => 'desc_condition'),
  inArray: vi.fn((_col: unknown, _vals: unknown[]) => 'in_array_condition'),
  sql: vi.fn(),
}));

// ── Import SUT ───────────────────────────────────────────────────────────

import {
  createOrder,
  updateOrderStatus,
  getOrdersByTrade,
  getOrdersByPosition,
  getOrdersBySymbol,
  getOpenOrders,
  getOrderByT212Id,
  getOrderById,
  cancelOrder,
  getRecentOrders,
  getOrderCount,
  recalcFromOrders,
  type Order,
  type NewOrder,
} from '../../src/db/repositories/orders.js';

describe('db/repositories/orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createOrder ──────────────────────────────────────────────────────

  describe('createOrder', () => {
    it('inserts an order and returns the ID', () => {
      mockDb.insert.mockReturnValue(
        createChainableMock({ lastInsertRowid: 42n, changes: 1 }),
      );

      const order: NewOrder = {
        symbol: 'AAPL',
        side: 'BUY',
        orderType: 'market',
        requestedQuantity: 10,
        requestedPrice: 150,
        orderTag: 'entry',
        accountType: 'INVEST',
      };

      const id = createOrder(order);
      expect(id).toBe(42);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('creates an order with optional fields', () => {
      mockDb.insert.mockReturnValue(
        createChainableMock({ lastInsertRowid: 5n, changes: 1 }),
      );

      const order: NewOrder = {
        tradeId: 1,
        positionId: 2,
        symbol: 'MSFT',
        side: 'SELL',
        orderType: 'limit',
        requestedQuantity: 5,
        requestedPrice: 400,
        stopPrice: 380,
        orderTag: 'exit',
        accountType: 'ISA',
      };

      const id = createOrder(order);
      expect(id).toBe(5);
    });

    it('sets default status to pending via schema default', () => {
      // The status is set to 'pending' in the insert values
      mockDb.insert.mockReturnValue(
        createChainableMock({ lastInsertRowid: 1n, changes: 1 }),
      );

      const id = createOrder({
        symbol: 'AAPL',
        side: 'BUY',
        orderType: 'market',
        requestedQuantity: 10,
        orderTag: 'entry',
        accountType: 'INVEST',
      });

      // Verify insert was called (the status 'pending' is set in the repository code)
      expect(mockDb.insert).toHaveBeenCalled();
      expect(id).toBe(1);
    });
  });

  // ── updateOrderStatus ────────────────────────────────────────────────

  describe('updateOrderStatus', () => {
    it('updates order status', () => {
      mockDb.update.mockReturnValue(createChainableMock());

      updateOrderStatus(1, { status: 'filled' });
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('updates fill information', () => {
      mockDb.update.mockReturnValue(createChainableMock());

      updateOrderStatus(1, {
        status: 'filled',
        filledQuantity: 10,
        filledPrice: 152.5,
        filledAt: '2024-01-15T10:00:00Z',
      });

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('updates t212OrderId', () => {
      mockDb.update.mockReturnValue(createChainableMock());

      updateOrderStatus(1, {
        status: 'open',
        t212OrderId: '12345',
      });

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('updates cancelReason', () => {
      mockDb.update.mockReturnValue(createChainableMock());

      updateOrderStatus(1, {
        status: 'cancelled',
        cancelReason: 'User requested cancellation',
      });

      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  // ── getOrdersByTrade ─────────────────────────────────────────────────

  describe('getOrdersByTrade', () => {
    it('returns orders for a trade ID', () => {
      const orders = [
        { id: 1, tradeId: 10, symbol: 'AAPL' },
        { id: 2, tradeId: 10, symbol: 'AAPL' },
      ];
      mockDb.select.mockReturnValue(createChainableMock(orders));

      const result = getOrdersByTrade(10);
      expect(result).toEqual(orders);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('returns empty array when no orders for trade', () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const result = getOrdersByTrade(999);
      expect(result).toEqual([]);
    });
  });

  // ── getOrdersByPosition ──────────────────────────────────────────────

  describe('getOrdersByPosition', () => {
    it('returns orders for a position ID', () => {
      const orders = [{ id: 1, positionId: 5, symbol: 'MSFT' }];
      mockDb.select.mockReturnValue(createChainableMock(orders));

      const result = getOrdersByPosition(5);
      expect(result).toEqual(orders);
    });
  });

  // ── getOrdersBySymbol ────────────────────────────────────────────────

  describe('getOrdersBySymbol', () => {
    it('returns all orders for a symbol', () => {
      const orders = [
        { id: 1, symbol: 'AAPL', orderTag: 'entry' },
        { id: 2, symbol: 'AAPL', orderTag: 'stoploss' },
        { id: 3, symbol: 'AAPL', orderTag: 'exit' },
      ];
      mockDb.select.mockReturnValue(createChainableMock(orders));

      const result = getOrdersBySymbol('AAPL');
      expect(result).toEqual(orders);
    });
  });

  // ── getOpenOrders ────────────────────────────────────────────────────

  describe('getOpenOrders', () => {
    it('returns orders with open statuses', () => {
      const openOrders = [
        { id: 1, status: 'pending', symbol: 'AAPL' },
        { id: 2, status: 'open', symbol: 'MSFT' },
      ];
      mockDb.select.mockReturnValue(createChainableMock(openOrders));

      const result = getOpenOrders();
      expect(result).toEqual(openOrders);
    });

    it('returns empty array when no open orders', () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const result = getOpenOrders();
      expect(result).toEqual([]);
    });
  });

  // ── getOrderByT212Id ─────────────────────────────────────────────────

  describe('getOrderByT212Id', () => {
    it('returns order by T212 exchange order ID', () => {
      const order = { id: 1, t212OrderId: 'abc123', symbol: 'AAPL' };
      mockDb.select.mockReturnValue(createChainableMock(order));

      const result = getOrderByT212Id('abc123');
      expect(result).toEqual(order);
    });

    it('returns undefined when order not found', () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const result = getOrderByT212Id('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  // ── getOrderById ─────────────────────────────────────────────────────

  describe('getOrderById', () => {
    it('returns order by local ID', () => {
      const order = { id: 42, symbol: 'AAPL', status: 'filled' };
      mockDb.select.mockReturnValue(createChainableMock(order));

      const result = getOrderById(42);
      expect(result).toEqual(order);
    });

    it('returns undefined when order not found', () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const result = getOrderById(999);
      expect(result).toBeUndefined();
    });
  });

  // ── cancelOrder ──────────────────────────────────────────────────────

  describe('cancelOrder', () => {
    it('updates status to cancelled with reason', () => {
      mockDb.update.mockReturnValue(createChainableMock());

      cancelOrder(1, 'Market closed');

      // cancelOrder calls db.update() with status='cancelled' and cancelReason
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  // ── getRecentOrders ──────────────────────────────────────────────────

  describe('getRecentOrders', () => {
    it('returns recent orders with no filters', () => {
      const orders = [{ id: 1, symbol: 'AAPL' }];
      mockDb.select.mockReturnValue(createChainableMock(orders));

      const result = getRecentOrders();
      expect(result).toEqual(orders);
    });

    it('applies symbol filter', () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const result = getRecentOrders({ symbol: 'AAPL' });
      expect(result).toEqual([]);
    });

    it('applies status filter', () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const result = getRecentOrders({ status: 'filled' });
      expect(result).toEqual([]);
    });

    it('applies limit', () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const result = getRecentOrders({ limit: 10 });
      expect(result).toEqual([]);
    });

    it('applies all filters combined', () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const result = getRecentOrders({ symbol: 'TSLA', status: 'open', limit: 5 });
      expect(result).toEqual([]);
    });
  });

  // ── getOrderCount ────────────────────────────────────────────────────

  describe('getOrderCount', () => {
    it('returns order count with no filters', () => {
      mockDb.select.mockReturnValue(createChainableMock({ count: 15 }));

      const result = getOrderCount();
      expect(result).toBe(15);
    });

    it('returns 0 when count result is undefined', () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const result = getOrderCount();
      expect(result).toBe(0);
    });

    it('applies symbol filter', () => {
      mockDb.select.mockReturnValue(createChainableMock({ count: 3 }));

      const result = getOrderCount({ symbol: 'AAPL' });
      expect(result).toBe(3);
    });

    it('applies status filter', () => {
      mockDb.select.mockReturnValue(createChainableMock({ count: 7 }));

      const result = getOrderCount({ status: 'filled' });
      expect(result).toBe(7);
    });
  });

  // ── recalcFromOrders (pure function) ─────────────────────────────────

  describe('recalcFromOrders', () => {
    it('returns zeros for empty orders array', () => {
      const result = recalcFromOrders([]);
      expect(result).toEqual({ avgPrice: 0, totalQuantity: 0, totalStake: 0 });
    });

    it('computes correct values for a single filled order', () => {
      const filledOrders: Order[] = [
        makeFilledOrder({ filledQuantity: 10, filledPrice: 150 }),
      ];

      const result = recalcFromOrders(filledOrders);
      expect(result.avgPrice).toBe(150);
      expect(result.totalQuantity).toBe(10);
      expect(result.totalStake).toBe(1500);
    });

    it('computes volume-weighted average price for DCA orders', () => {
      const filledOrders: Order[] = [
        makeFilledOrder({ filledQuantity: 10, filledPrice: 100 }), // $1000
        makeFilledOrder({ filledQuantity: 20, filledPrice: 110 }), // $2200
      ];

      const result = recalcFromOrders(filledOrders);
      // VWAP: (10*100 + 20*110) / (10+20) = 3200/30 = 106.667
      expect(result.totalQuantity).toBe(30);
      expect(result.totalStake).toBe(3200);
      expect(result.avgPrice).toBeCloseTo(106.667, 2);
    });

    it('computes volume-weighted average for three orders', () => {
      const filledOrders: Order[] = [
        makeFilledOrder({ filledQuantity: 5, filledPrice: 100 }),  // $500
        makeFilledOrder({ filledQuantity: 10, filledPrice: 95 }),  // $950
        makeFilledOrder({ filledQuantity: 15, filledPrice: 90 }),  // $1350
      ];

      const result = recalcFromOrders(filledOrders);
      // VWAP: (500 + 950 + 1350) / 30 = 2800/30 = 93.333
      expect(result.totalQuantity).toBe(30);
      expect(result.totalStake).toBe(2800);
      expect(result.avgPrice).toBeCloseTo(93.333, 2);
    });

    it('handles orders with null filledQuantity (treats as 0)', () => {
      const filledOrders: Order[] = [
        makeFilledOrder({ filledQuantity: null, filledPrice: 100 }),
        makeFilledOrder({ filledQuantity: 10, filledPrice: 150 }),
      ];

      const result = recalcFromOrders(filledOrders);
      expect(result.totalQuantity).toBe(10);
      expect(result.totalStake).toBe(1500);
      expect(result.avgPrice).toBe(150);
    });

    it('handles orders with null filledPrice (treats as 0)', () => {
      const filledOrders: Order[] = [
        makeFilledOrder({ filledQuantity: 10, filledPrice: null }),
        makeFilledOrder({ filledQuantity: 10, filledPrice: 100 }),
      ];

      const result = recalcFromOrders(filledOrders);
      expect(result.totalQuantity).toBe(20);
      expect(result.totalStake).toBe(1000);
      expect(result.avgPrice).toBe(50);
    });

    it('returns avgPrice 0 when total quantity is 0', () => {
      const filledOrders: Order[] = [
        makeFilledOrder({ filledQuantity: 0, filledPrice: 100 }),
      ];

      const result = recalcFromOrders(filledOrders);
      expect(result.avgPrice).toBe(0);
      expect(result.totalQuantity).toBe(0);
      expect(result.totalStake).toBe(0);
    });

    it('handles equal-weight DCA orders', () => {
      const filledOrders: Order[] = [
        makeFilledOrder({ filledQuantity: 10, filledPrice: 100 }),
        makeFilledOrder({ filledQuantity: 10, filledPrice: 200 }),
      ];

      const result = recalcFromOrders(filledOrders);
      // Equal qty: (1000 + 2000) / 20 = 150
      expect(result.avgPrice).toBe(150);
      expect(result.totalQuantity).toBe(20);
      expect(result.totalStake).toBe(3000);
    });
  });
});

// ── Helper ─────────────────────────────────────────────────────────────

function makeFilledOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    tradeId: null,
    positionId: null,
    symbol: 'AAPL',
    side: 'BUY',
    orderType: 'market',
    status: 'filled',
    requestedQuantity: 10,
    filledQuantity: 10,
    requestedPrice: null,
    filledPrice: 150,
    stopPrice: null,
    t212OrderId: null,
    cancelReason: null,
    orderTag: 'entry',
    replacedByOrderId: null,
    accountType: 'INVEST',
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:01Z',
    filledAt: '2024-01-15T10:00:01Z',
    ...overrides,
  };
}
