import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { insertOrder } from '../helpers/fixtures.js';
import { createTestApp } from '../helpers/test-server.js';

describe('Orders API', () => {
  describe('GET /api/orders', () => {
    it('returns empty list when no orders', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/orders');

      expect(res.status).toBe(200);
      expect(res.body.orders).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('returns orders list', async () => {
      const app = createTestApp();
      insertOrder({ symbol: 'AAPL' });
      insertOrder({ symbol: 'MSFT' });

      const res = await request(app).get('/api/orders');

      expect(res.status).toBe(200);
      expect(res.body.orders).toHaveLength(2);
      expect(res.body.total).toBe(2);
    });

    it('filters by symbol', async () => {
      const app = createTestApp();
      insertOrder({ symbol: 'AAPL' });
      insertOrder({ symbol: 'MSFT' });

      const res = await request(app).get('/api/orders?symbol=AAPL');

      expect(res.status).toBe(200);
      expect(res.body.orders).toHaveLength(1);
      expect(res.body.orders[0].symbol).toBe('AAPL');
    });
  });

  describe('GET /api/orders/:id', () => {
    it('returns a single order by id', async () => {
      const app = createTestApp();
      const order = insertOrder({ symbol: 'AAPL', side: 'BUY' });

      const res = await request(app).get(`/api/orders/${order.id}`);

      expect(res.status).toBe(200);
      expect(res.body.symbol).toBe('AAPL');
      expect(res.body.side).toBe('BUY');
    });

    it('returns 404 for non-existent order', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/orders/99999');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Order not found');
    });
  });

  describe('GET /api/positions/:symbol/orders', () => {
    it('returns orders for a specific symbol', async () => {
      const app = createTestApp();
      insertOrder({ symbol: 'AAPL', orderTag: 'entry' });
      insertOrder({ symbol: 'AAPL', orderTag: 'exit' });
      insertOrder({ symbol: 'MSFT', orderTag: 'entry' });

      const res = await request(app).get('/api/positions/AAPL/orders');

      expect(res.status).toBe(200);
      expect(res.body.orders).toHaveLength(2);
      expect(res.body.orders.every((o: { symbol: string }) => o.symbol === 'AAPL')).toBe(true);
    });

    it('returns empty list when no orders for symbol', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/positions/NVDA/orders');

      expect(res.status).toBe(200);
      expect(res.body.orders).toHaveLength(0);
    });
  });
});
