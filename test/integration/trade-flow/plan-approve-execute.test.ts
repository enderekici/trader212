import { describe, it, expect, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import * as schema from '../../../src/db/schema.js';

vi.mock('../../../src/ai/agent.js', () => ({
  getActiveModelName: () => 'test-model',
}));

// Import after mock is set up
const { TradePlanner } = await import('../../../src/execution/trade-planner.js');
const { OrderManager } = await import('../../../src/execution/order-manager.js');
const { getAuditLogger } = await import('../../../src/monitoring/audit-log.js');

function makeDecision() {
  return {
    decision: 'BUY' as const,
    conviction: 80,
    reasoning: 'Strong technical setup',
    suggestedStopLossPct: 0.05,
    suggestedTakeProfitPct: 0.1,
    suggestedPositionSizePct: 0.1,
    risks: ['market risk'],
    urgency: 'medium' as const,
    exitConditions: 'stop hit or target reached',
  };
}

function makePortfolio() {
  return {
    cashAvailable: 10000,
    portfolioValue: 10000,
    openPositions: 0,
    todayPnl: 0,
    todayPnlPct: 0,
    sectorExposure: {} as Record<string, number>,
    sectorExposureValue: {} as Record<string, number>,
    peakValue: 10000,
  };
}

describe('Trade plan → approve → execute', () => {
  it('creates a pending trade plan in the database', () => {
    const planner = new TradePlanner();
    const plan = planner.createPlan({
      symbol: 'AAPL',
      t212Ticker: 'AAPL_US_EQ',
      price: 150,
      decision: makeDecision(),
      portfolio: makePortfolio(),
    });

    expect(plan).not.toBeNull();
    expect(plan!.status).toBe('pending');
    expect(plan!.symbol).toBe('AAPL');
    expect(plan!.side).toBe('BUY');
    expect(plan!.shares).toBeGreaterThan(0);
    expect(plan!.aiModel).toBe('test-model');
  });

  it('approves a pending plan and records approval metadata', () => {
    const planner = new TradePlanner();
    const plan = planner.createPlan({
      symbol: 'MSFT',
      t212Ticker: 'MSFT_US_EQ',
      price: 350,
      decision: makeDecision(),
      portfolio: makePortfolio(),
    });

    const approved = planner.approvePlan(plan!.id, 'dashboard-user');

    expect(approved).not.toBeNull();
    expect(approved!.status).toBe('approved');
    expect(approved!.approvedBy).toBe('dashboard-user');
    expect(approved!.approvedAt).toBeDefined();
  });

  it('full flow: create plan → approve → execute buy in dry-run', async () => {
    const planner = new TradePlanner();
    const orderManager = new OrderManager();

    const plan = planner.createPlan({
      symbol: 'NVDA',
      t212Ticker: 'NVDA_US_EQ',
      price: 500,
      decision: makeDecision(),
      portfolio: makePortfolio(),
    });
    expect(plan).not.toBeNull();

    // Approve the plan
    planner.approvePlan(plan!.id, 'auto');

    // Execute buy in dry-run mode (default from setup.ts)
    const result = await orderManager.executeBuy({
      symbol: plan!.symbol,
      t212Ticker: plan!.t212Ticker,
      shares: plan!.shares,
      price: plan!.entryPrice,
      stopLossPct: plan!.stopLossPct,
      takeProfitPct: plan!.takeProfitPct,
      aiReasoning: plan!.aiReasoning ?? '',
      conviction: plan!.aiConviction,
      aiModel: plan!.aiModel ?? 'test-model',
      accountType: plan!.accountType,
    });

    expect(result.success).toBe(true);
    expect(result.tradeId).toBeGreaterThan(0);

    // Mark plan as executed
    planner.markExecuted(plan!.id);

    // Verify trade in DB
    const db = getDb();
    const tradeRows = db.select().from(schema.trades).all();
    expect(tradeRows.length).toBe(1);
    expect(tradeRows[0].symbol).toBe('NVDA');
    expect(tradeRows[0].side).toBe('BUY');

    // Verify position in DB
    const posRows = db.select().from(schema.positions).all();
    expect(posRows.length).toBe(1);
    expect(posRows[0].symbol).toBe('NVDA');

    // Verify plan status is executed
    const updatedPlan = planner.getPlan(plan!.id);
    expect(updatedPlan!.status).toBe('executed');
  });

  it('logs to audit log when using AuditLogger', () => {
    const audit = getAuditLogger();
    audit.logTrade('AAPL', 'BUY executed', { shares: 10, price: 150 });

    const db = getDb();
    const entries = db.select().from(schema.auditLog).all();
    expect(entries.length).toBe(1);
    expect(entries[0].eventType).toBe('trade');
    expect(entries[0].symbol).toBe('AAPL');
    expect(entries[0].summary).toBe('BUY executed');
  });

  it('rejects duplicate buy for same symbol', async () => {
    const orderManager = new OrderManager();
    const buyParams = {
      symbol: 'GOOG',
      t212Ticker: 'GOOG_US_EQ',
      shares: 5,
      price: 170,
      stopLossPct: 0.05,
      takeProfitPct: 0.1,
      aiReasoning: 'test',
      conviction: 80,
      aiModel: 'test-model',
      accountType: 'INVEST' as const,
    };

    // First buy succeeds
    const first = await orderManager.executeBuy(buyParams);
    expect(first.success).toBe(true);

    // Second buy for same symbol is rejected (position already exists)
    const second = await orderManager.executeBuy(buyParams);
    expect(second.success).toBe(false);
    expect(second.error).toContain('Position already exists');
  });
});
