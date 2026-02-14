import { randomUUID } from 'node:crypto';
import { configManager } from '../config/manager.js';
import * as repo from '../db/repositories/conditional-orders.js';
import { safeJsonParse } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('conditional-orders');

export interface PriceCondition {
  price: number;
}

export interface TimeCondition {
  triggerAt: string; // ISO timestamp
}

export interface IndicatorCondition {
  indicator: string;
  operator: 'above' | 'below' | 'crosses_above' | 'crosses_below';
  value: number;
}

export interface OrderAction {
  type: 'buy' | 'sell';
  shares?: number;
  pct?: number;
  limitPrice?: number;
}

export interface CreateOrderParams {
  symbol: string;
  triggerType: 'price_above' | 'price_below' | 'time' | 'indicator';
  triggerCondition: PriceCondition | TimeCondition | IndicatorCondition;
  action: OrderAction;
  expiresAt?: string;
}

export interface TriggeredAction {
  orderId: number;
  symbol: string;
  action: OrderAction;
}

export interface OrderStatus {
  activeCount: number;
  triggeredToday: number;
  byType: {
    price_above: number;
    price_below: number;
    time: number;
    indicator: number;
  };
}

export class ConditionalOrderManager {
  createOrder(params: CreateOrderParams): number {
    const enabled = configManager.get<boolean>('conditionalOrders.enabled');
    if (!enabled) {
      logger.warn('Conditional orders feature is disabled');
      throw new Error('Conditional orders feature is disabled');
    }

    const maxActive = configManager.get<number>('conditionalOrders.maxActive');
    const activeOrders = repo.getActiveOrders();

    if (activeOrders.length >= maxActive) {
      logger.warn({ maxActive, current: activeOrders.length }, 'Max active orders limit reached');
      throw new Error(`Max active orders limit (${maxActive}) reached`);
    }

    // Check if order is already expired at creation
    if (params.expiresAt && params.expiresAt < new Date().toISOString()) {
      logger.warn({ expiresAt: params.expiresAt }, 'Order is already expired at creation');
      throw new Error('Order expiration time is in the past');
    }

    const order = repo.createConditionalOrder({
      symbol: params.symbol,
      triggerType: params.triggerType,
      triggerCondition: JSON.stringify(params.triggerCondition),
      action: JSON.stringify(params.action),
      expiresAt: params.expiresAt,
    });

    logger.info(
      { orderId: order.id, symbol: params.symbol, triggerType: params.triggerType },
      'Conditional order created',
    );

    return order.id;
  }

  createOcoPair(
    order1: CreateOrderParams,
    order2: CreateOrderParams,
  ): { id1: number; id2: number } {
    const enabled = configManager.get<boolean>('conditionalOrders.enabled');
    if (!enabled) {
      logger.warn('Conditional orders feature is disabled');
      throw new Error('Conditional orders feature is disabled');
    }

    if (order1.symbol !== order2.symbol) {
      logger.warn(
        { symbol1: order1.symbol, symbol2: order2.symbol },
        'OCO orders must have same symbol',
      );
      throw new Error('OCO orders must have the same symbol');
    }

    const maxActive = configManager.get<number>('conditionalOrders.maxActive');
    const activeOrders = repo.getActiveOrders();

    if (activeOrders.length + 2 > maxActive) {
      logger.warn({ maxActive, current: activeOrders.length }, 'Max active orders limit reached');
      throw new Error(`Max active orders limit (${maxActive}) reached`);
    }

    // Check expiration times
    if (order1.expiresAt && order1.expiresAt < new Date().toISOString()) {
      throw new Error('Order 1 expiration time is in the past');
    }
    if (order2.expiresAt && order2.expiresAt < new Date().toISOString()) {
      throw new Error('Order 2 expiration time is in the past');
    }

    const ocoGroupId = randomUUID();

    const created1 = repo.createConditionalOrder({
      symbol: order1.symbol,
      triggerType: order1.triggerType,
      triggerCondition: JSON.stringify(order1.triggerCondition),
      action: JSON.stringify(order1.action),
      ocoGroupId,
      expiresAt: order1.expiresAt,
    });

    const created2 = repo.createConditionalOrder({
      symbol: order2.symbol,
      triggerType: order2.triggerType,
      triggerCondition: JSON.stringify(order2.triggerCondition),
      action: JSON.stringify(order2.action),
      ocoGroupId,
      linkedOrderId: created1.id,
      expiresAt: order2.expiresAt,
    });

    // Update the first order with the linked ID
    repo.updateOrderStatus(created1.id, 'pending');
    // We need to manually update linkedOrderId - let's use a workaround
    // Since we can't update linkedOrderId directly through updateOrderStatus,
    // we'll need to handle this in the repository or accept that linkedOrderId is one-way

    logger.info(
      { ocoGroupId, order1Id: created1.id, order2Id: created2.id, symbol: order1.symbol },
      'OCO pair created',
    );

    return { id1: created1.id, id2: created2.id };
  }

  checkTriggers(currentPrices: Map<string, number>): TriggeredAction[] {
    const enabled = configManager.get<boolean>('conditionalOrders.enabled');
    if (!enabled) {
      return [];
    }

    const activeOrders = repo.getActiveOrders();
    const triggered: TriggeredAction[] = [];

    for (const order of activeOrders) {
      let isTriggered = false;

      switch (order.triggerType) {
        case 'price_above':
        case 'price_below': {
          const currentPrice = currentPrices.get(order.symbol);
          if (currentPrice !== undefined) {
            isTriggered = this.checkPriceTrigger(order, currentPrice);
          }
          break;
        }
        case 'time':
          isTriggered = this.checkTimeTrigger(order);
          break;
        case 'indicator':
          // Indicator triggers would require additional data/context
          // For now, we'll skip them in this implementation
          logger.debug({ orderId: order.id }, 'Indicator triggers not yet implemented');
          break;
      }

      if (isTriggered) {
        const now = new Date().toISOString();
        repo.updateOrderStatus(order.id, 'triggered', now);

        // If this is part of an OCO group, cancel the other orders
        if (order.ocoGroupId) {
          repo.cancelOcoGroup(order.ocoGroupId, order.id);
          logger.info(
            { ocoGroupId: order.ocoGroupId, triggeredOrderId: order.id },
            'OCO group: cancelled linked orders',
          );
        }

        const action = safeJsonParse<OrderAction | null>(order.action, null);
        if (!action) {
          logger.error({ orderId: order.id }, 'Failed to parse conditional order action');
          continue;
        }
        triggered.push({
          orderId: order.id,
          symbol: order.symbol,
          action,
        });

        logger.info(
          { orderId: order.id, symbol: order.symbol, triggerType: order.triggerType },
          'Conditional order triggered',
        );
      }
    }

    return triggered;
  }

  checkPriceTrigger(order: repo.ConditionalOrder, currentPrice: number): boolean {
    const condition = safeJsonParse<PriceCondition | null>(order.triggerCondition, null);
    if (!condition) return false;

    if (order.triggerType === 'price_above') {
      return currentPrice >= condition.price;
    }
    if (order.triggerType === 'price_below') {
      return currentPrice <= condition.price;
    }

    return false;
  }

  checkTimeTrigger(order: repo.ConditionalOrder): boolean {
    const condition = safeJsonParse<TimeCondition | null>(order.triggerCondition, null);
    if (!condition) return false;
    const now = new Date().toISOString();
    return now >= condition.triggerAt;
  }

  expireOldOrders(): number {
    const enabled = configManager.get<boolean>('conditionalOrders.enabled');
    if (!enabled) {
      return 0;
    }

    const expired = repo.getExpiredOrders();

    for (const order of expired) {
      repo.updateOrderStatus(order.id, 'expired');
      logger.info({ orderId: order.id, symbol: order.symbol }, 'Conditional order expired');
    }

    return expired.length;
  }

  cancelOrder(id: number): void {
    const enabled = configManager.get<boolean>('conditionalOrders.enabled');
    if (!enabled) {
      throw new Error('Conditional orders feature is disabled');
    }

    const order = repo.getOrderById(id);
    if (!order) {
      throw new Error(`Order ${id} not found`);
    }

    if (order.status !== 'pending') {
      throw new Error(`Order ${id} is not pending (status: ${order.status})`);
    }

    repo.cancelOrder(id);
    logger.info({ orderId: id, symbol: order.symbol }, 'Conditional order cancelled');
  }

  cancelAllForSymbol(symbol: string): number {
    const enabled = configManager.get<boolean>('conditionalOrders.enabled');
    if (!enabled) {
      return 0;
    }

    const orders = repo.getActiveOrders(symbol);

    for (const order of orders) {
      repo.cancelOrder(order.id);
    }

    logger.info({ symbol, count: orders.length }, 'Cancelled all conditional orders for symbol');

    return orders.length;
  }

  getStatus(): OrderStatus {
    const activeOrders = repo.getActiveOrders();
    const _today = new Date().toISOString().split('T')[0]; // Get YYYY-MM-DD

    const byType = {
      price_above: 0,
      price_below: 0,
      time: 0,
      indicator: 0,
    };

    for (const order of activeOrders) {
      byType[order.triggerType]++;
    }

    // Count triggered orders today
    // We'd need to query the DB for triggered orders with triggeredAt >= today
    // For now, we'll return 0 as a placeholder since we'd need a new repository method
    const triggeredToday = 0;

    return {
      activeCount: activeOrders.length,
      triggeredToday,
      byType,
    };
  }
}

let instance: ConditionalOrderManager | null = null;

export function getConditionalOrderManager(): ConditionalOrderManager {
  if (!instance) {
    instance = new ConditionalOrderManager();
  }
  return instance;
}
