import { describe, expect, it } from 'vitest';
import { getRecentOrders } from '../../../src/db/repositories/orders.js';
import { getPosition } from '../../../src/db/repositories/positions.js';
import { getTradeHistory } from '../../../src/db/repositories/trades.js';
import { OrderManager } from '../../../src/execution/order-manager.js';
import { insertPosition } from '../helpers/fixtures.js';

describe('OrderManager Transactions', () => {
  it('should atomically create trade + position on executeBuy() dry-run', async () => {
    const om = new OrderManager();

    const result = await om.executeBuy({
      symbol: 'TX_BUY_TEST',
      t212Ticker: 'TX_BUY_TEST_US_EQ',
      shares: 10,
      price: 150,
      stopLossPct: 0.05,
      takeProfitPct: 0.1,
      aiReasoning: 'Integration test buy',
      conviction: 80,
      aiModel: 'test-model',
      accountType: 'INVEST',
    });

    expect(result.success).toBe(true);
    expect(result.tradeId).toBeGreaterThan(0);

    // Verify trade was created
    const { trades } = getTradeHistory({ symbol: 'TX_BUY_TEST' });
    expect(trades.length).toBe(1);
    expect(trades[0].side).toBe('BUY');
    expect(trades[0].shares).toBe(10);
    expect(trades[0].entryPrice).toBe(150);
    expect(trades[0].stopLoss).toBeCloseTo(142.5);
    expect(trades[0].takeProfit).toBeCloseTo(165);
    expect(trades[0].aiReasoning).toBe('Integration test buy');
    expect(trades[0].convictionScore).toBe(80);
    expect(trades[0].accountType).toBe('INVEST');
    expect(trades[0].slippage).toBe(0);

    // Verify position was created
    const position = getPosition('TX_BUY_TEST');
    expect(position).toBeDefined();
    expect(position!.shares).toBe(10);
    expect(position!.entryPrice).toBe(150);
    expect(position!.stopLoss).toBeCloseTo(142.5);
    expect(position!.takeProfit).toBeCloseTo(165);
    expect(position!.pnl).toBe(0);
    expect(position!.accountType).toBe('INVEST');

    // Verify order was recorded and marked as filled
    const orders = getRecentOrders({ symbol: 'TX_BUY_TEST' });
    expect(orders.length).toBe(1);
    expect(orders[0].side).toBe('BUY');
    expect(orders[0].status).toBe('filled');
    expect(orders[0].filledQuantity).toBe(10);
    expect(orders[0].filledPrice).toBe(150);
  });

  it('should reject duplicate buy for same symbol', async () => {
    const om = new OrderManager();

    // First buy should succeed
    const first = await om.executeBuy({
      symbol: 'TX_DUP_TEST',
      t212Ticker: 'TX_DUP_TEST_US_EQ',
      shares: 5,
      price: 200,
      stopLossPct: 0.05,
      takeProfitPct: 0.1,
      aiReasoning: 'First buy',
      conviction: 70,
      aiModel: 'test-model',
      accountType: 'INVEST',
    });
    expect(first.success).toBe(true);

    // Second buy for same symbol should fail
    const second = await om.executeBuy({
      symbol: 'TX_DUP_TEST',
      t212Ticker: 'TX_DUP_TEST_US_EQ',
      shares: 10,
      price: 210,
      stopLossPct: 0.05,
      takeProfitPct: 0.1,
      aiReasoning: 'Duplicate buy',
      conviction: 60,
      aiModel: 'test-model',
      accountType: 'INVEST',
    });
    expect(second.success).toBe(false);
    expect(second.error).toContain('already exists');
  });

  it('should atomically create trade + remove position on executeClose() dry-run', async () => {
    const om = new OrderManager();

    // First, set up a position via fixture
    insertPosition({
      symbol: 'TX_CLOSE_TEST',
      t212Ticker: 'TX_CLOSE_TEST_US_EQ',
      shares: 10,
      entryPrice: 100,
      currentPrice: 110,
      pnl: 100,
      pnlPct: 0.1,
      accountType: 'INVEST',
    });

    // Verify position exists
    expect(getPosition('TX_CLOSE_TEST')).toBeDefined();

    const result = await om.executeClose({
      symbol: 'TX_CLOSE_TEST',
      t212Ticker: 'TX_CLOSE_TEST_US_EQ',
      shares: 10,
      exitReason: 'Take profit hit',
      accountType: 'INVEST',
    });

    expect(result.success).toBe(true);

    // Verify SELL trade was created with P&L
    const { trades } = getTradeHistory({ symbol: 'TX_CLOSE_TEST' });
    expect(trades.length).toBe(1);
    expect(trades[0].side).toBe('SELL');
    expect(trades[0].entryPrice).toBe(100);
    expect(trades[0].exitPrice).toBe(110);
    expect(trades[0].pnl).toBe(100); // (110 - 100) * 10
    expect(trades[0].exitReason).toBe('Take profit hit');

    // Verify position was removed
    const position = getPosition('TX_CLOSE_TEST');
    expect(position).toBeUndefined();

    // Verify sell order was recorded
    const orders = getRecentOrders({ symbol: 'TX_CLOSE_TEST' });
    expect(orders.length).toBe(1);
    expect(orders[0].side).toBe('SELL');
    expect(orders[0].status).toBe('filled');
    expect(orders[0].orderTag).toBe('take_profit'); // resolved from "Take profit hit"
  });

  it('should fail to close a non-existent position', async () => {
    const om = new OrderManager();

    const result = await om.executeClose({
      symbol: 'NONEXISTENT_POS',
      t212Ticker: 'NONEXISTENT_US_EQ',
      shares: 10,
      exitReason: 'Test close',
      accountType: 'INVEST',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No position');
  });

  it('should handle full buy-then-close lifecycle', async () => {
    const om = new OrderManager();

    // Buy
    const buyResult = await om.executeBuy({
      symbol: 'LIFECYCLE_TEST',
      t212Ticker: 'LIFECYCLE_TEST_US_EQ',
      shares: 20,
      price: 50,
      stopLossPct: 0.1,
      takeProfitPct: 0.2,
      aiReasoning: 'Lifecycle test',
      conviction: 85,
      aiModel: 'test-model',
      accountType: 'ISA',
    });
    expect(buyResult.success).toBe(true);

    // Verify position exists
    const pos = getPosition('LIFECYCLE_TEST');
    expect(pos).toBeDefined();
    expect(pos!.shares).toBe(20);
    expect(pos!.accountType).toBe('ISA');

    // Close
    const closeResult = await om.executeClose({
      symbol: 'LIFECYCLE_TEST',
      t212Ticker: 'LIFECYCLE_TEST_US_EQ',
      shares: 20,
      exitReason: 'Stop loss triggered',
      accountType: 'ISA',
    });
    expect(closeResult.success).toBe(true);

    // Position gone
    expect(getPosition('LIFECYCLE_TEST')).toBeUndefined();

    // Two trades: BUY + SELL
    const { trades } = getTradeHistory({ symbol: 'LIFECYCLE_TEST' });
    expect(trades.length).toBe(2);
    const buySide = trades.find((t) => t.side === 'BUY');
    const sellSide = trades.find((t) => t.side === 'SELL');
    expect(buySide).toBeDefined();
    expect(sellSide).toBeDefined();
    expect(sellSide!.exitReason).toBe('Stop loss triggered');
  });

  it('should fail executeBuy without T212 client when not in dry-run', async () => {
    const om = new OrderManager();
    const { configManager } = await import('../../../src/config/manager.js');

    // Temporarily disable dry-run
    await configManager.set('execution.dryRun', false);
    configManager.invalidateCache();

    try {
      const result = await om.executeBuy({
        symbol: 'NO_CLIENT_TEST',
        t212Ticker: 'NO_CLIENT_US_EQ',
        shares: 5,
        price: 100,
        stopLossPct: 0.05,
        takeProfitPct: 0.1,
        aiReasoning: 'test',
        conviction: 70,
        aiModel: 'test',
        accountType: 'INVEST',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('T212 client not initialized');
    } finally {
      // Restore dry-run mode
      await configManager.set('execution.dryRun', true);
      configManager.invalidateCache();
    }
  });
});
