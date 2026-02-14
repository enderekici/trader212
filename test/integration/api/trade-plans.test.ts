import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-server.js';

describe('Trade Plans API', () => {
  describe('GET /api/trade-plans', () => {
    it('returns empty list from default callback', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/trade-plans');

      expect(res.status).toBe(200);
      expect(res.body.plans).toEqual([]);
    });

    it('returns plans from callback', async () => {
      const mockPlans = [
        { id: 1, symbol: 'AAPL', status: 'pending', side: 'BUY' },
        { id: 2, symbol: 'MSFT', status: 'approved', side: 'BUY' },
      ];
      const app = createTestApp({
        botCallbacks: { getTradePlans: () => mockPlans },
      });

      const res = await request(app).get('/api/trade-plans');

      expect(res.status).toBe(200);
      expect(res.body.plans).toHaveLength(2);
      expect(res.body.plans[0].symbol).toBe('AAPL');
    });
  });

  describe('POST /api/trade-plans/:id/approve', () => {
    it('calls approveTradePlan callback and returns plan', async () => {
      let approvedId: number | null = null;
      const app = createTestApp({
        botCallbacks: {
          approveTradePlan: (id) => {
            approvedId = id;
            return { id, status: 'approved', symbol: 'AAPL' };
          },
        },
      });

      const res = await request(app).post('/api/trade-plans/42/approve');

      expect(res.status).toBe(200);
      expect(res.body.plan.status).toBe('approved');
      expect(approvedId).toBe(42);
    });

    it('returns 404 when plan not found', async () => {
      const app = createTestApp({
        botCallbacks: { approveTradePlan: () => null },
      });

      const res = await request(app).post('/api/trade-plans/999/approve');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('POST /api/trade-plans/:id/reject', () => {
    it('calls rejectTradePlan callback', async () => {
      let rejectedId: number | null = null;
      const app = createTestApp({
        botCallbacks: {
          rejectTradePlan: (id) => {
            rejectedId = id;
          },
        },
      });

      const res = await request(app).post('/api/trade-plans/7/reject');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Plan rejected');
      expect(rejectedId).toBe(7);
    });
  });
});
