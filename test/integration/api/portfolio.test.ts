import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { insertDailyMetrics, insertPosition } from '../helpers/fixtures.js';
import { createTestApp } from '../helpers/test-server.js';

describe('GET /api/portfolio', () => {
  it('returns empty portfolio when no positions', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/portfolio');

    expect(res.status).toBe(200);
    expect(res.body.positions).toHaveLength(0);
    expect(res.body.pnl).toBe(0);
    expect(res.body.cashAvailable).toBe(0);
  });

  it('returns positions with P&L', async () => {
    const app = createTestApp();
    insertPosition({ symbol: 'AAPL', shares: 10, entryPrice: 150, currentPrice: 160, pnl: 100 });
    insertPosition({ symbol: 'MSFT', shares: 5, entryPrice: 300, currentPrice: 310, pnl: 50 });

    const res = await request(app).get('/api/portfolio');

    expect(res.status).toBe(200);
    expect(res.body.positions).toHaveLength(2);
    expect(res.body.pnl).toBe(150);
    const symbols = res.body.positions.map((p: { symbol: string }) => p.symbol);
    expect(symbols).toContain('AAPL');
    expect(symbols).toContain('MSFT');
  });

  it('includes cash from dailyMetrics', async () => {
    const app = createTestApp();
    insertDailyMetrics({ cashBalance: 7500 });

    const res = await request(app).get('/api/portfolio');

    expect(res.status).toBe(200);
    expect(res.body.cashAvailable).toBe(7500);
  });

  it('computes totalValue as positions + cash', async () => {
    const app = createTestApp();
    insertPosition({ symbol: 'AAPL', shares: 10, currentPrice: 100 });
    insertDailyMetrics({ cashBalance: 5000 });

    const res = await request(app).get('/api/portfolio');

    expect(res.status).toBe(200);
    // 10 shares * 100 = 1000 + 5000 cash
    expect(res.body.totalValue).toBe(6000);
  });
});
