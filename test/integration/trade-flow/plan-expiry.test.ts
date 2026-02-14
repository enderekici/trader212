import { describe, it, expect, vi } from 'vitest';
import { insertTradePlan } from '../helpers/fixtures.js';

vi.mock('../../../src/ai/agent.js', () => ({
  getActiveModelName: () => 'test-model',
}));

const { TradePlanner } = await import('../../../src/execution/trade-planner.js');

describe('Trade plan expiry', () => {
  it('expires plans whose expiresAt is in the past', () => {
    const planner = new TradePlanner();

    // Insert a plan that expired 1 hour ago
    const pastTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const row = insertTradePlan({
      symbol: 'AAPL',
      status: 'pending',
      expiresAt: pastTime,
    });

    const count = planner.expireOldPlans();

    expect(count).toBe(1);

    const plan = planner.getPlan(row.id);
    expect(plan!.status).toBe('expired');
  });

  it('does not expire plans still within their timeout window', () => {
    const planner = new TradePlanner();

    // Insert a plan that expires 1 hour from now
    const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    insertTradePlan({
      symbol: 'MSFT',
      status: 'pending',
      expiresAt: futureTime,
    });

    const count = planner.expireOldPlans();
    expect(count).toBe(0);
  });

  it('only expires pending plans, not approved or rejected ones', () => {
    const planner = new TradePlanner();
    const pastTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // Insert plans with past expiresAt but different statuses
    insertTradePlan({ symbol: 'AAPL', status: 'pending', expiresAt: pastTime });
    insertTradePlan({ symbol: 'MSFT', status: 'approved', expiresAt: pastTime });
    insertTradePlan({ symbol: 'GOOG', status: 'rejected', expiresAt: pastTime });

    const count = planner.expireOldPlans();

    // Only the pending plan should be expired
    expect(count).toBe(1);
  });
});
