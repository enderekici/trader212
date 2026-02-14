import { describe, it, expect, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import * as schema from '../../../src/db/schema.js';
import { insertTradePlan } from '../helpers/fixtures.js';

vi.mock('../../../src/ai/agent.js', () => ({
  getActiveModelName: () => 'test-model',
}));

const { TradePlanner } = await import('../../../src/execution/trade-planner.js');

function makeDecision() {
  return {
    decision: 'BUY' as const,
    conviction: 80,
    reasoning: 'Test reasoning',
    suggestedStopLossPct: 0.05,
    suggestedTakeProfitPct: 0.1,
    suggestedPositionSizePct: 0.1,
    risks: ['market risk'],
    urgency: 'medium' as const,
    exitConditions: 'stop hit',
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

describe('Trade plan rejection', () => {
  it('rejectPlan sets status to rejected', () => {
    const planner = new TradePlanner();
    const plan = planner.createPlan({
      symbol: 'AAPL',
      t212Ticker: 'AAPL_US_EQ',
      price: 150,
      decision: makeDecision(),
      portfolio: makePortfolio(),
    });

    planner.rejectPlan(plan!.id);

    const rejected = planner.getPlan(plan!.id);
    expect(rejected!.status).toBe('rejected');
  });

  it('plan stays pending without approval or rejection', () => {
    const planner = new TradePlanner();
    const plan = planner.createPlan({
      symbol: 'MSFT',
      t212Ticker: 'MSFT_US_EQ',
      price: 350,
      decision: makeDecision(),
      portfolio: makePortfolio(),
    });

    // Re-fetch without approving or rejecting
    const fetched = planner.getPlan(plan!.id);
    expect(fetched!.status).toBe('pending');
    expect(fetched!.approvedAt).toBeNull();
    expect(fetched!.approvedBy).toBeNull();
  });

  it('rejected plan appears in recent plans with correct status', () => {
    const planner = new TradePlanner();
    const plan = planner.createPlan({
      symbol: 'TSLA',
      t212Ticker: 'TSLA_US_EQ',
      price: 250,
      decision: makeDecision(),
      portfolio: makePortfolio(),
    });

    planner.rejectPlan(plan!.id);

    const recent = planner.getRecentPlans();
    const found = recent.find((p) => p.id === plan!.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe('rejected');
  });
});
