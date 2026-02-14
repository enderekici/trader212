import { describe, it, expect } from 'vitest';
import { RiskGuard, type PortfolioState, type TradeProposal } from '../../../src/execution/risk-guard.js';
import { getPairLockManager } from '../../../src/execution/pair-locks.js';
import { insertPosition } from '../helpers/fixtures.js';
import { configManager } from '../../../src/config/manager.js';

function makeProposal(overrides: Partial<TradeProposal> = {}): TradeProposal {
  return {
    symbol: 'AAPL',
    side: 'BUY',
    shares: 10,
    price: 150,
    stopLossPct: 0.05,
    positionSizePct: 0.15,
    ...overrides,
  };
}

function makePortfolio(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    cashAvailable: 50000,
    portfolioValue: 100000,
    openPositions: 0,
    todayPnl: 0,
    todayPnlPct: 0,
    sectorExposure: {},
    sectorExposureValue: {},
    peakValue: 100000,
    ...overrides,
  };
}

describe('RiskGuard integration', () => {
  it('blocks trade when pair is locked', () => {
    const guard = new RiskGuard();
    const lockManager = getPairLockManager();

    lockManager.lockPair('AAPL', 60, 'test lock');

    const result = guard.validateTrade(makeProposal(), makePortfolio());

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Pair locked');
  });

  it('blocks trade when max positions reached', async () => {
    const guard = new RiskGuard();
    const maxPositions = configManager.get<number>('risk.maxPositions');

    // Insert positions up to the max
    for (let i = 0; i < maxPositions; i++) {
      insertPosition({ symbol: `SYM${i}`, t212Ticker: `SYM${i}_US_EQ` });
    }

    const result = guard.validateTrade(
      makeProposal({ symbol: 'NEWSTOCK' }),
      makePortfolio({ openPositions: maxPositions }),
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Max positions');
  });

  it('blocks trade when insufficient cash', () => {
    const guard = new RiskGuard();

    // Position value = 10 shares * $150 = $1500, but only $100 cash
    const result = guard.validateTrade(
      makeProposal({ shares: 10, price: 150 }),
      makePortfolio({ cashAvailable: 100 }),
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Insufficient cash');
  });

  it('allows a valid trade with sufficient cash and room', () => {
    const guard = new RiskGuard();

    // Position value = 10 * $150 = $1500, plenty of cash and room
    const result = guard.validateTrade(
      makeProposal({ shares: 10, price: 150 }),
      makePortfolio({ cashAvailable: 50000, portfolioValue: 100000, openPositions: 0 }),
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
