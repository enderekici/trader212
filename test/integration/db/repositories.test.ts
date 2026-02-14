import { describe, expect, it } from 'vitest';
import {
  createOrder,
  getOrderById,
  getOrdersBySymbol,
  getRecentOrders,
  updateOrderStatus,
} from '../../../src/db/repositories/orders.js';
import {
  getAllPositions,
  getPosition,
  removePosition,
  upsertPosition,
} from '../../../src/db/repositories/positions.js';
import {
  getTradeById,
  getTradeHistory,
  insertTrade,
} from '../../../src/db/repositories/trades.js';
import { getAuditLogger } from '../../../src/monitoring/audit-log.js';
import {
  insertOrder,
  insertPosition,
  insertSignal,
  insertTrade as insertTradeFixture,
} from '../helpers/fixtures.js';

describe('Trade Repository', () => {
  it('should insert and retrieve a trade', () => {
    const trade = insertTrade({
      symbol: 'AAPL',
      t212Ticker: 'AAPL_US_EQ',
      side: 'BUY',
      shares: 10,
      entryPrice: 150,
      entryTime: new Date().toISOString(),
      intendedPrice: 150,
      slippage: 0,
      accountType: 'INVEST',
    });

    expect(trade).toBeDefined();
    expect(trade.id).toBeGreaterThan(0);
    expect(trade.symbol).toBe('AAPL');
    expect(trade.side).toBe('BUY');

    const retrieved = getTradeById(trade.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.symbol).toBe('AAPL');
  });

  it('should filter trades by symbol', () => {
    insertTradeFixture({ symbol: 'AAPL' });
    insertTradeFixture({ symbol: 'MSFT', t212Ticker: 'MSFT_US_EQ' });
    insertTradeFixture({ symbol: 'AAPL' });

    const { trades, total } = getTradeHistory({ symbol: 'AAPL' });
    expect(trades.length).toBe(2);
    expect(total).toBe(2);
    for (const t of trades) {
      expect(t.symbol).toBe('AAPL');
    }
  });

  it('should filter trades by side', () => {
    insertTradeFixture({ symbol: 'GOOG', t212Ticker: 'GOOG_US_EQ', side: 'BUY' });
    insertTradeFixture({ symbol: 'GOOG', t212Ticker: 'GOOG_US_EQ', side: 'SELL' });

    const { trades } = getTradeHistory({ side: 'BUY' });
    for (const t of trades) {
      expect(t.side).toBe('BUY');
    }
  });

  it('should support pagination with limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      insertTradeFixture({ symbol: `PAGE${i}`, t212Ticker: `PAGE${i}_US_EQ` });
    }

    const { trades: page1 } = getTradeHistory({ limit: 2, offset: 0 });
    const { trades: page2 } = getTradeHistory({ limit: 2, offset: 2 });

    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    // Pages should not overlap
    const ids1 = page1.map((t) => t.id);
    const ids2 = page2.map((t) => t.id);
    for (const id of ids2) {
      expect(ids1).not.toContain(id);
    }
  });
});

describe('Position Repository', () => {
  it('should insert and retrieve a position', () => {
    const pos = insertPosition({ symbol: 'TSLA', t212Ticker: 'TSLA_US_EQ' });
    expect(pos).toBeDefined();
    expect(pos.symbol).toBe('TSLA');

    const retrieved = getPosition('TSLA');
    expect(retrieved).toBeDefined();
    expect(retrieved!.entryPrice).toBe(pos.entryPrice);
  });

  it('should enforce unique symbol constraint', () => {
    insertPosition({ symbol: 'UNIQUE_POS' });
    expect(() => insertPosition({ symbol: 'UNIQUE_POS' })).toThrow();
  });

  it('should upsert position (update existing)', () => {
    const initial = upsertPosition({
      symbol: 'UPSERT_TEST',
      t212Ticker: 'UPSERT_US_EQ',
      shares: 10,
      entryPrice: 100,
      entryTime: new Date().toISOString(),
      accountType: 'INVEST',
    });
    expect(initial!.shares).toBe(10);

    const updated = upsertPosition({
      symbol: 'UPSERT_TEST',
      t212Ticker: 'UPSERT_US_EQ',
      shares: 20,
      entryPrice: 100,
      entryTime: new Date().toISOString(),
      accountType: 'INVEST',
    });
    expect(updated!.shares).toBe(20);

    // Should still be one position
    const all = getAllPositions();
    const matching = all.filter((p) => p.symbol === 'UPSERT_TEST');
    expect(matching.length).toBe(1);
  });

  it('should remove a position', () => {
    insertPosition({ symbol: 'TO_REMOVE' });
    expect(getPosition('TO_REMOVE')).toBeDefined();

    removePosition('TO_REMOVE');
    expect(getPosition('TO_REMOVE')).toBeUndefined();
  });

  it('should list all positions', () => {
    insertPosition({ symbol: 'POS_A' });
    insertPosition({ symbol: 'POS_B' });

    const all = getAllPositions();
    const symbols = all.map((p) => p.symbol);
    expect(symbols).toContain('POS_A');
    expect(symbols).toContain('POS_B');
  });
});

describe('Order Repository', () => {
  it('should create and retrieve an order', () => {
    const orderId = createOrder({
      symbol: 'AAPL',
      side: 'BUY',
      orderType: 'market',
      requestedQuantity: 10,
      requestedPrice: 150,
      orderTag: 'entry',
      accountType: 'INVEST',
    });

    expect(orderId).toBeGreaterThan(0);

    const order = getOrderById(orderId);
    expect(order).toBeDefined();
    expect(order!.symbol).toBe('AAPL');
    expect(order!.status).toBe('pending');
    expect(order!.side).toBe('BUY');
  });

  it('should update order status', () => {
    const orderId = createOrder({
      symbol: 'MSFT',
      side: 'SELL',
      orderType: 'market',
      requestedQuantity: 5,
      orderTag: 'exit',
      accountType: 'INVEST',
    });

    updateOrderStatus(orderId, {
      status: 'filled',
      filledQuantity: 5,
      filledPrice: 300,
      filledAt: new Date().toISOString(),
    });

    const order = getOrderById(orderId);
    expect(order!.status).toBe('filled');
    expect(order!.filledQuantity).toBe(5);
    expect(order!.filledPrice).toBe(300);
  });

  it('should get orders by symbol', () => {
    insertOrder({ symbol: 'NVDA', side: 'BUY' });
    insertOrder({ symbol: 'NVDA', side: 'SELL' });
    insertOrder({ symbol: 'AMD', side: 'BUY' });

    const nvdaOrders = getOrdersBySymbol('NVDA');
    expect(nvdaOrders.length).toBe(2);
    for (const o of nvdaOrders) {
      expect(o.symbol).toBe('NVDA');
    }
  });

  it('should get recent orders with filters', () => {
    insertOrder({ symbol: 'FILTER_A', status: 'filled' });
    insertOrder({ symbol: 'FILTER_B', status: 'pending' });

    const filled = getRecentOrders({ status: 'filled' });
    for (const o of filled) {
      expect(o.status).toBe('filled');
    }
  });
});

describe('AuditLogger', () => {
  it('should log a trade and retrieve by type', () => {
    const logger = getAuditLogger();

    logger.logTrade('AAPL', 'Bought 10 shares of AAPL', { price: 150, shares: 10 });
    logger.logTrade('MSFT', 'Sold 5 shares of MSFT', { price: 300, shares: 5 });

    const tradeEntries = logger.getByType('trade');
    expect(tradeEntries.length).toBe(2);
    expect(tradeEntries[0].eventType).toBe('trade');
    expect(tradeEntries[0].category).toBe('execution');
  });

  it('should log different event types', () => {
    const logger = getAuditLogger();

    logger.logTrade('AAPL', 'Buy trade');
    logger.logSignal('AAPL', 'Signal generated');
    logger.logRisk('Daily loss limit warning', { loss: -500 });
    logger.logError('Connection failed', { service: 'yahoo' });
    logger.logControl('Bot paused');
    logger.logResearch('Market research completed');

    const recent = logger.getRecent(10);
    expect(recent.length).toBe(6);
  });

  it('should retrieve entries by symbol', () => {
    const logger = getAuditLogger();

    logger.logTrade('GOOG', 'Bought GOOG');
    logger.logSignal('GOOG', 'GOOG signal');
    logger.logTrade('META', 'Bought META');

    const googEntries = logger.getBySymbol('GOOG');
    expect(googEntries.length).toBe(2);
    for (const entry of googEntries) {
      expect(entry.symbol).toBe('GOOG');
    }
  });

  it('should parse details JSON correctly', () => {
    const logger = getAuditLogger();
    const details = { price: 150, reason: 'test', nested: { a: 1 } };

    logger.logTrade('AAPL', 'Test with details', details);

    const entries = logger.getByType('trade');
    expect(entries[0].details).toBeDefined();
    expect(entries[0].details!.price).toBe(150);
    expect(entries[0].details!.reason).toBe('test');
  });

  it('should generate daily report', () => {
    const logger = getAuditLogger();
    const today = new Date().toISOString().split('T')[0];

    logger.logTrade('AAPL', 'Trade test');
    logger.logError('Error test');
    logger.logRisk('Risk test');

    const report = logger.generateDailyReport(today);
    expect(report).toContain('Bot Activity Report');
    expect(report).toContain('Total Events:');
  });

  it('should respect severity levels', () => {
    const logger = getAuditLogger();

    logger.logRisk('Risk warning', undefined, 'warn');
    logger.logError('Critical error');

    const entries = logger.getRecent(10);
    const riskEntry = entries.find((e) => e.summary === 'Risk warning');
    const errorEntry = entries.find((e) => e.summary === 'Critical error');

    expect(riskEntry!.severity).toBe('warn');
    expect(errorEntry!.severity).toBe('error');
  });
});

describe('Fixtures', () => {
  it('should create signal fixtures', () => {
    const signal = insertSignal({ symbol: 'TSLA', decision: 'BUY' });
    expect(signal).toBeDefined();
    expect(signal.symbol).toBe('TSLA');
    expect(signal.decision).toBe('BUY');
  });
});
