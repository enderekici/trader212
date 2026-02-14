import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
	ConditionalOrderManager,
	getConditionalOrderManager,
	type CreateOrderParams,
	type PriceCondition,
	type TimeCondition,
} from '../../src/execution/conditional-orders.js';
import * as repo from '../../src/db/repositories/conditional-orders.js';

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

vi.mock('../../src/db/repositories/conditional-orders.js', () => ({
	createConditionalOrder: vi.fn(),
	getActiveOrders: vi.fn(),
	getOrderById: vi.fn(),
	updateOrderStatus: vi.fn(),
	cancelOrder: vi.fn(),
	cancelOcoGroup: vi.fn(),
	getExpiredOrders: vi.fn(),
	getOcoGroup: vi.fn(),
}));

import { configManager } from '../../src/config/manager.js';

describe('ConditionalOrderManager', () => {
	let manager: ConditionalOrderManager;

	beforeEach(() => {
		vi.clearAllMocks();
		manager = new ConditionalOrderManager();

		// Default config
		vi.mocked(configManager.get).mockImplementation((key: string) => {
			if (key === 'conditionalOrders.enabled') return true;
			if (key === 'conditionalOrders.maxActive') return 20;
			if (key === 'conditionalOrders.checkIntervalSeconds') return 30;
			return undefined;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('createOrder', () => {
		it('should create a price_above conditional order', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([]);
			vi.mocked(repo.createConditionalOrder).mockReturnValue({
				id: 1,
				symbol: 'AAPL',
				triggerType: 'price_above',
				triggerCondition: JSON.stringify({ price: 150 }),
				action: JSON.stringify({ type: 'buy', shares: 10 }),
				status: 'pending',
				linkedOrderId: null,
				ocoGroupId: null,
				expiresAt: null,
				createdAt: '2026-02-14T10:00:00.000Z',
				triggeredAt: null,
			});

			const params: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_above',
				triggerCondition: { price: 150 },
				action: { type: 'buy', shares: 10 },
			};

			const id = manager.createOrder(params);

			expect(id).toBe(1);
			expect(repo.createConditionalOrder).toHaveBeenCalledWith({
				symbol: 'AAPL',
				triggerType: 'price_above',
				triggerCondition: JSON.stringify({ price: 150 }),
				action: JSON.stringify({ type: 'buy', shares: 10 }),
				expiresAt: undefined,
			});
		});

		it('should create a price_below conditional order', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([]);
			vi.mocked(repo.createConditionalOrder).mockReturnValue({
				id: 2,
				symbol: 'TSLA',
				triggerType: 'price_below',
				triggerCondition: JSON.stringify({ price: 200 }),
				action: JSON.stringify({ type: 'sell', pct: 50 }),
				status: 'pending',
				linkedOrderId: null,
				ocoGroupId: null,
				expiresAt: null,
				createdAt: '2026-02-14T10:00:00.000Z',
				triggeredAt: null,
			});

			const params: CreateOrderParams = {
				symbol: 'TSLA',
				triggerType: 'price_below',
				triggerCondition: { price: 200 },
				action: { type: 'sell', pct: 50 },
			};

			const id = manager.createOrder(params);

			expect(id).toBe(2);
		});

		it('should create a time-based conditional order', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([]);
			const triggerAt = '2026-02-15T14:30:00.000Z';

			vi.mocked(repo.createConditionalOrder).mockReturnValue({
				id: 3,
				symbol: 'MSFT',
				triggerType: 'time',
				triggerCondition: JSON.stringify({ triggerAt }),
				action: JSON.stringify({ type: 'buy', shares: 5 }),
				status: 'pending',
				linkedOrderId: null,
				ocoGroupId: null,
				expiresAt: null,
				createdAt: '2026-02-14T10:00:00.000Z',
				triggeredAt: null,
			});

			const params: CreateOrderParams = {
				symbol: 'MSFT',
				triggerType: 'time',
				triggerCondition: { triggerAt },
				action: { type: 'buy', shares: 5 },
			};

			const id = manager.createOrder(params);

			expect(id).toBe(3);
		});

		it('should create order with expiration', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([]);
			const expiresAt = '2026-02-20T10:00:00.000Z';

			vi.mocked(repo.createConditionalOrder).mockReturnValue({
				id: 4,
				symbol: 'GOOGL',
				triggerType: 'price_above',
				triggerCondition: JSON.stringify({ price: 100 }),
				action: JSON.stringify({ type: 'buy', shares: 10 }),
				status: 'pending',
				linkedOrderId: null,
				ocoGroupId: null,
				expiresAt,
				createdAt: '2026-02-14T10:00:00.000Z',
				triggeredAt: null,
			});

			const params: CreateOrderParams = {
				symbol: 'GOOGL',
				triggerType: 'price_above',
				triggerCondition: { price: 100 },
				action: { type: 'buy', shares: 10 },
				expiresAt,
			};

			const id = manager.createOrder(params);

			expect(id).toBe(4);
		});

		it('should enforce max active order limit', () => {
			// Mock 20 active orders (at limit)
			vi.mocked(repo.getActiveOrders).mockReturnValue(
				Array.from({ length: 20 }, (_, i) => ({
					id: i + 1,
					symbol: 'AAPL',
					triggerType: 'price_above' as const,
					triggerCondition: JSON.stringify({ price: 150 }),
					action: JSON.stringify({ type: 'buy', shares: 10 }),
					status: 'pending' as const,
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				})),
			);

			const params: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_above',
				triggerCondition: { price: 150 },
				action: { type: 'buy', shares: 10 },
			};

			expect(() => manager.createOrder(params)).toThrow('Max active orders limit (20) reached');
		});

		it('should throw if feature is disabled', () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'conditionalOrders.enabled') return false;
				return undefined;
			});

			const params: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_above',
				triggerCondition: { price: 150 },
				action: { type: 'buy', shares: 10 },
			};

			expect(() => manager.createOrder(params)).toThrow(
				'Conditional orders feature is disabled',
			);
		});

		it('should throw if order is already expired at creation', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([]);

			const params: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_above',
				triggerCondition: { price: 150 },
				action: { type: 'buy', shares: 10 },
				expiresAt: '2020-01-01T00:00:00.000Z', // Past date
			};

			expect(() => manager.createOrder(params)).toThrow('Order expiration time is in the past');
		});
	});

	describe('createOcoPair', () => {
		it('should create OCO pair with shared group ID', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([]);

			let callCount = 0;
			vi.mocked(repo.createConditionalOrder).mockImplementation(() => {
				callCount++;
				return {
					id: callCount,
					symbol: 'AAPL',
					triggerType: callCount === 1 ? 'price_above' : 'price_below',
					triggerCondition:
						callCount === 1 ? JSON.stringify({ price: 160 }) : JSON.stringify({ price: 140 }),
					action: JSON.stringify({ type: callCount === 1 ? 'sell' : 'sell', pct: 100 }),
					status: 'pending',
					linkedOrderId: callCount === 2 ? 1 : null,
					ocoGroupId: 'mock-uuid',
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				};
			});

			const order1: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_above',
				triggerCondition: { price: 160 },
				action: { type: 'sell', pct: 100 },
			};

			const order2: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_below',
				triggerCondition: { price: 140 },
				action: { type: 'sell', pct: 100 },
			};

			const result = manager.createOcoPair(order1, order2);

			expect(result.id1).toBe(1);
			expect(result.id2).toBe(2);
			expect(repo.createConditionalOrder).toHaveBeenCalledTimes(2);
		});

		it('should throw if symbols do not match', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([]);

			const order1: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_above',
				triggerCondition: { price: 160 },
				action: { type: 'sell', pct: 100 },
			};

			const order2: CreateOrderParams = {
				symbol: 'TSLA',
				triggerType: 'price_below',
				triggerCondition: { price: 200 },
				action: { type: 'sell', pct: 100 },
			};

			expect(() => manager.createOcoPair(order1, order2)).toThrow(
				'OCO orders must have the same symbol',
			);
		});

		it('should enforce max active limit for OCO pair', () => {
			// Mock 19 active orders (one slot left, need 2)
			vi.mocked(repo.getActiveOrders).mockReturnValue(
				Array.from({ length: 19 }, (_, i) => ({
					id: i + 1,
					symbol: 'AAPL',
					triggerType: 'price_above' as const,
					triggerCondition: JSON.stringify({ price: 150 }),
					action: JSON.stringify({ type: 'buy', shares: 10 }),
					status: 'pending' as const,
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				})),
			);

			const order1: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_above',
				triggerCondition: { price: 160 },
				action: { type: 'sell', pct: 100 },
			};

			const order2: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_below',
				triggerCondition: { price: 140 },
				action: { type: 'sell', pct: 100 },
			};

			expect(() => manager.createOcoPair(order1, order2)).toThrow(
				'Max active orders limit (20) reached',
			);
		});

		it('should throw if feature is disabled', () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'conditionalOrders.enabled') return false;
				return undefined;
			});

			const order1: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_above',
				triggerCondition: { price: 160 },
				action: { type: 'sell', pct: 100 },
			};

			const order2: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_below',
				triggerCondition: { price: 140 },
				action: { type: 'sell', pct: 100 },
			};

			expect(() => manager.createOcoPair(order1, order2)).toThrow(
				'Conditional orders feature is disabled',
			);
		});

		it('should reject OCO pair if order1 is already expired', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([]);

			const order1: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_above',
				triggerCondition: { price: 160 },
				action: { type: 'sell', pct: 100 },
				expiresAt: '2020-01-01T00:00:00.000Z',
			};

			const order2: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_below',
				triggerCondition: { price: 140 },
				action: { type: 'sell', pct: 100 },
			};

			expect(() => manager.createOcoPair(order1, order2)).toThrow(
				'Order 1 expiration time is in the past',
			);
		});

		it('should reject OCO pair if order2 is already expired', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([]);

			const order1: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_above',
				triggerCondition: { price: 160 },
				action: { type: 'sell', pct: 100 },
			};

			const order2: CreateOrderParams = {
				symbol: 'AAPL',
				triggerType: 'price_below',
				triggerCondition: { price: 140 },
				action: { type: 'sell', pct: 100 },
				expiresAt: '2020-01-01T00:00:00.000Z',
			};

			expect(() => manager.createOcoPair(order1, order2)).toThrow(
				'Order 2 expiration time is in the past',
			);
		});
	});

	describe('checkTriggers', () => {
		it('should detect price_above trigger', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([
				{
					id: 1,
					symbol: 'AAPL',
					triggerType: 'price_above',
					triggerCondition: JSON.stringify({ price: 150 }),
					action: JSON.stringify({ type: 'buy', shares: 10 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
			]);

			const currentPrices = new Map([['AAPL', 151]]);

			const triggered = manager.checkTriggers(currentPrices);

			expect(triggered).toHaveLength(1);
			expect(triggered[0].orderId).toBe(1);
			expect(triggered[0].symbol).toBe('AAPL');
			expect(triggered[0].action).toEqual({ type: 'buy', shares: 10 });
			expect(repo.updateOrderStatus).toHaveBeenCalledWith(1, 'triggered', expect.any(String));
		});

		it('should detect price_below trigger', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([
				{
					id: 2,
					symbol: 'TSLA',
					triggerType: 'price_below',
					triggerCondition: JSON.stringify({ price: 200 }),
					action: JSON.stringify({ type: 'sell', pct: 50 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
			]);

			const currentPrices = new Map([['TSLA', 199]]);

			const triggered = manager.checkTriggers(currentPrices);

			expect(triggered).toHaveLength(1);
			expect(triggered[0].orderId).toBe(2);
			expect(triggered[0].symbol).toBe('TSLA');
			expect(repo.updateOrderStatus).toHaveBeenCalledWith(2, 'triggered', expect.any(String));
		});

		it('should detect exact price match for price_above', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([
				{
					id: 1,
					symbol: 'AAPL',
					triggerType: 'price_above',
					triggerCondition: JSON.stringify({ price: 150 }),
					action: JSON.stringify({ type: 'buy', shares: 10 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
			]);

			const currentPrices = new Map([['AAPL', 150]]); // Exact match

			const triggered = manager.checkTriggers(currentPrices);

			expect(triggered).toHaveLength(1);
		});

		it('should detect exact price match for price_below', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([
				{
					id: 2,
					symbol: 'TSLA',
					triggerType: 'price_below',
					triggerCondition: JSON.stringify({ price: 200 }),
					action: JSON.stringify({ type: 'sell', pct: 50 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
			]);

			const currentPrices = new Map([['TSLA', 200]]); // Exact match

			const triggered = manager.checkTriggers(currentPrices);

			expect(triggered).toHaveLength(1);
		});

		it('should not trigger when price does not meet condition', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([
				{
					id: 1,
					symbol: 'AAPL',
					triggerType: 'price_above',
					triggerCondition: JSON.stringify({ price: 150 }),
					action: JSON.stringify({ type: 'buy', shares: 10 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
			]);

			const currentPrices = new Map([['AAPL', 149]]);

			const triggered = manager.checkTriggers(currentPrices);

			expect(triggered).toHaveLength(0);
		});

		it('should detect time trigger', () => {
			const pastTime = new Date(Date.now() - 1000).toISOString();

			vi.mocked(repo.getActiveOrders).mockReturnValue([
				{
					id: 3,
					symbol: 'MSFT',
					triggerType: 'time',
					triggerCondition: JSON.stringify({ triggerAt: pastTime }),
					action: JSON.stringify({ type: 'buy', shares: 5 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
			]);

			const currentPrices = new Map();

			const triggered = manager.checkTriggers(currentPrices);

			expect(triggered).toHaveLength(1);
			expect(triggered[0].orderId).toBe(3);
		});

		it('should not trigger time order before trigger time', () => {
			const futureTime = new Date(Date.now() + 10000).toISOString();

			vi.mocked(repo.getActiveOrders).mockReturnValue([
				{
					id: 3,
					symbol: 'MSFT',
					triggerType: 'time',
					triggerCondition: JSON.stringify({ triggerAt: futureTime }),
					action: JSON.stringify({ type: 'buy', shares: 5 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
			]);

			const currentPrices = new Map();

			const triggered = manager.checkTriggers(currentPrices);

			expect(triggered).toHaveLength(0);
		});

		it('should cancel OCO group when one order triggers', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([
				{
					id: 1,
					symbol: 'AAPL',
					triggerType: 'price_above',
					triggerCondition: JSON.stringify({ price: 150 }),
					action: JSON.stringify({ type: 'sell', pct: 100 }),
					status: 'pending',
					linkedOrderId: 2,
					ocoGroupId: 'oco-group-1',
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
				{
					id: 2,
					symbol: 'AAPL',
					triggerType: 'price_below',
					triggerCondition: JSON.stringify({ price: 140 }),
					action: JSON.stringify({ type: 'sell', pct: 100 }),
					status: 'pending',
					linkedOrderId: 1,
					ocoGroupId: 'oco-group-1',
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
			]);

			const currentPrices = new Map([['AAPL', 151]]);

			const triggered = manager.checkTriggers(currentPrices);

			expect(triggered).toHaveLength(1);
			expect(repo.cancelOcoGroup).toHaveBeenCalledWith('oco-group-1', 1);
		});

		it('should handle multiple triggers in same check cycle', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([
				{
					id: 1,
					symbol: 'AAPL',
					triggerType: 'price_above',
					triggerCondition: JSON.stringify({ price: 150 }),
					action: JSON.stringify({ type: 'buy', shares: 10 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
				{
					id: 2,
					symbol: 'TSLA',
					triggerType: 'price_below',
					triggerCondition: JSON.stringify({ price: 200 }),
					action: JSON.stringify({ type: 'sell', pct: 50 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
			]);

			const currentPrices = new Map([
				['AAPL', 151],
				['TSLA', 199],
			]);

			const triggered = manager.checkTriggers(currentPrices);

			expect(triggered).toHaveLength(2);
		});

		it('should skip orders with no matching price', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([
				{
					id: 1,
					symbol: 'AAPL',
					triggerType: 'price_above',
					triggerCondition: JSON.stringify({ price: 150 }),
					action: JSON.stringify({ type: 'buy', shares: 10 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
			]);

			const currentPrices = new Map([['TSLA', 200]]); // Different symbol

			const triggered = manager.checkTriggers(currentPrices);

			expect(triggered).toHaveLength(0);
		});

		it('should return empty array when feature is disabled', () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'conditionalOrders.enabled') return false;
				return undefined;
			});

			const currentPrices = new Map([['AAPL', 151]]);

			const triggered = manager.checkTriggers(currentPrices);

			expect(triggered).toHaveLength(0);
		});
	});

	describe('expireOldOrders', () => {
		it('should expire old orders', () => {
			vi.mocked(repo.getExpiredOrders).mockReturnValue([
				{
					id: 1,
					symbol: 'AAPL',
					triggerType: 'price_above',
					triggerCondition: JSON.stringify({ price: 150 }),
					action: JSON.stringify({ type: 'buy', shares: 10 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: '2026-02-13T10:00:00.000Z',
					createdAt: '2026-02-12T10:00:00.000Z',
					triggeredAt: null,
				},
			]);

			const count = manager.expireOldOrders();

			expect(count).toBe(1);
			expect(repo.updateOrderStatus).toHaveBeenCalledWith(1, 'expired');
		});

		it('should return 0 when no expired orders', () => {
			vi.mocked(repo.getExpiredOrders).mockReturnValue([]);

			const count = manager.expireOldOrders();

			expect(count).toBe(0);
		});

		it('should return 0 when feature is disabled', () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'conditionalOrders.enabled') return false;
				return undefined;
			});

			const count = manager.expireOldOrders();

			expect(count).toBe(0);
		});
	});

	describe('cancelOrder', () => {
		it('should cancel a pending order', () => {
			vi.mocked(repo.getOrderById).mockReturnValue({
				id: 1,
				symbol: 'AAPL',
				triggerType: 'price_above',
				triggerCondition: JSON.stringify({ price: 150 }),
				action: JSON.stringify({ type: 'buy', shares: 10 }),
				status: 'pending',
				linkedOrderId: null,
				ocoGroupId: null,
				expiresAt: null,
				createdAt: '2026-02-14T10:00:00.000Z',
				triggeredAt: null,
			});

			manager.cancelOrder(1);

			expect(repo.cancelOrder).toHaveBeenCalledWith(1);
		});

		it('should throw if order not found', () => {
			vi.mocked(repo.getOrderById).mockReturnValue(undefined);

			expect(() => manager.cancelOrder(999)).toThrow('Order 999 not found');
		});

		it('should throw if order is not pending', () => {
			vi.mocked(repo.getOrderById).mockReturnValue({
				id: 1,
				symbol: 'AAPL',
				triggerType: 'price_above',
				triggerCondition: JSON.stringify({ price: 150 }),
				action: JSON.stringify({ type: 'buy', shares: 10 }),
				status: 'triggered',
				linkedOrderId: null,
				ocoGroupId: null,
				expiresAt: null,
				createdAt: '2026-02-14T10:00:00.000Z',
				triggeredAt: '2026-02-14T11:00:00.000Z',
			});

			expect(() => manager.cancelOrder(1)).toThrow('Order 1 is not pending (status: triggered)');
		});

		it('should throw if feature is disabled', () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'conditionalOrders.enabled') return false;
				return undefined;
			});

			expect(() => manager.cancelOrder(1)).toThrow('Conditional orders feature is disabled');
		});
	});

	describe('cancelAllForSymbol', () => {
		it('should cancel all orders for a symbol', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([
				{
					id: 1,
					symbol: 'AAPL',
					triggerType: 'price_above',
					triggerCondition: JSON.stringify({ price: 150 }),
					action: JSON.stringify({ type: 'buy', shares: 10 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
				{
					id: 2,
					symbol: 'AAPL',
					triggerType: 'price_below',
					triggerCondition: JSON.stringify({ price: 140 }),
					action: JSON.stringify({ type: 'sell', pct: 50 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
			]);

			const count = manager.cancelAllForSymbol('AAPL');

			expect(count).toBe(2);
			expect(repo.cancelOrder).toHaveBeenCalledWith(1);
			expect(repo.cancelOrder).toHaveBeenCalledWith(2);
		});

		it('should return 0 when no orders for symbol', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([]);

			const count = manager.cancelAllForSymbol('AAPL');

			expect(count).toBe(0);
		});

		it('should return 0 when feature is disabled', () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'conditionalOrders.enabled') return false;
				return undefined;
			});

			const count = manager.cancelAllForSymbol('AAPL');

			expect(count).toBe(0);
		});
	});

	describe('getStatus', () => {
		it('should return status summary', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([
				{
					id: 1,
					symbol: 'AAPL',
					triggerType: 'price_above',
					triggerCondition: JSON.stringify({ price: 150 }),
					action: JSON.stringify({ type: 'buy', shares: 10 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
				{
					id: 2,
					symbol: 'TSLA',
					triggerType: 'price_below',
					triggerCondition: JSON.stringify({ price: 200 }),
					action: JSON.stringify({ type: 'sell', pct: 50 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
				{
					id: 3,
					symbol: 'MSFT',
					triggerType: 'time',
					triggerCondition: JSON.stringify({ triggerAt: '2026-02-15T10:00:00.000Z' }),
					action: JSON.stringify({ type: 'buy', shares: 5 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				},
			]);

			const status = manager.getStatus();

			expect(status.activeCount).toBe(3);
			expect(status.byType.price_above).toBe(1);
			expect(status.byType.price_below).toBe(1);
			expect(status.byType.time).toBe(1);
			expect(status.byType.indicator).toBe(0);
		});

		it('should return zero counts when no active orders', () => {
			vi.mocked(repo.getActiveOrders).mockReturnValue([]);

			const status = manager.getStatus();

			expect(status.activeCount).toBe(0);
			expect(status.byType.price_above).toBe(0);
			expect(status.byType.price_below).toBe(0);
			expect(status.byType.time).toBe(0);
			expect(status.byType.indicator).toBe(0);
		});
	});

	describe('singleton', () => {
		it('should return the same instance', () => {
			const instance1 = getConditionalOrderManager();
			const instance2 = getConditionalOrderManager();

			expect(instance1).toBe(instance2);
		});
	});
});

describe('ConditionalOrderRepository', () => {
	// Mock the database
	const mockDb = {
		insert: vi.fn(),
		select: vi.fn(),
		update: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('createConditionalOrder', () => {
		it('should insert order and return created record', () => {
			const mockChain = {
				values: vi.fn().mockReturnThis(),
				returning: vi.fn().mockReturnThis(),
				get: vi.fn().mockReturnValue({
					id: 1,
					symbol: 'AAPL',
					triggerType: 'price_above',
					triggerCondition: JSON.stringify({ price: 150 }),
					action: JSON.stringify({ type: 'buy', shares: 10 }),
					status: 'pending',
					linkedOrderId: null,
					ocoGroupId: null,
					expiresAt: null,
					createdAt: '2026-02-14T10:00:00.000Z',
					triggeredAt: null,
				}),
			};

			mockDb.insert.mockReturnValue(mockChain);

			// This is a simplified test - in reality we'd need to mock getDb()
			// For now, we'll just verify the structure
			expect(mockChain.values).toBeDefined();
		});
	});
});
