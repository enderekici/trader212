import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { insertTrade } from '../helpers/fixtures.js';
import { createTestApp } from '../helpers/test-server.js';

describe('Trades API', () => {
  describe('GET /api/trades', () => {
    it('returns empty list when no trades', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/trades');

      expect(res.status).toBe(200);
      expect(res.body.trades).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('returns populated trades list', async () => {
      const app = createTestApp();
      insertTrade({ symbol: 'AAPL' });
      insertTrade({ symbol: 'MSFT' });

      const res = await request(app).get('/api/trades');

      expect(res.status).toBe(200);
      expect(res.body.trades).toHaveLength(2);
      expect(res.body.total).toBe(2);
    });

    it('filters by symbol', async () => {
      const app = createTestApp();
      insertTrade({ symbol: 'AAPL' });
      insertTrade({ symbol: 'MSFT' });

      const res = await request(app).get('/api/trades?symbol=AAPL');

      expect(res.status).toBe(200);
      expect(res.body.trades).toHaveLength(1);
      expect(res.body.trades[0].symbol).toBe('AAPL');
      expect(res.body.total).toBe(1);
    });

    it('filters by side', async () => {
      const app = createTestApp();
      insertTrade({ symbol: 'AAPL', side: 'BUY' });
      insertTrade({ symbol: 'MSFT', side: 'SELL' });

      const res = await request(app).get('/api/trades?side=SELL');

      expect(res.status).toBe(200);
      expect(res.body.trades).toHaveLength(1);
      expect(res.body.trades[0].side).toBe('SELL');
    });

    it('filters by date range (from/to)', async () => {
      const app = createTestApp();
      insertTrade({ symbol: 'AAPL', entryTime: '2025-01-01T10:00:00Z' });
      insertTrade({ symbol: 'MSFT', entryTime: '2025-06-15T10:00:00Z' });

      const res = await request(app).get(
        '/api/trades?from=2025-06-01T00:00:00Z&to=2025-12-31T23:59:59Z',
      );

      expect(res.status).toBe(200);
      expect(res.body.trades).toHaveLength(1);
      expect(res.body.trades[0].symbol).toBe('MSFT');
    });

    it('supports pagination with limit and offset', async () => {
      const app = createTestApp();
      for (let i = 0; i < 5; i++) {
        insertTrade({ symbol: `SYM${i}` });
      }

      const res = await request(app).get('/api/trades?limit=2&offset=2');

      expect(res.status).toBe(200);
      expect(res.body.trades).toHaveLength(2);
      expect(res.body.total).toBe(5);
    });
  });

  describe('GET /api/trades/:id', () => {
    it('returns a single trade by id', async () => {
      const app = createTestApp();
      const trade = insertTrade({ symbol: 'AAPL' });

      const res = await request(app).get(`/api/trades/${trade.id}`);

      expect(res.status).toBe(200);
      expect(res.body.symbol).toBe('AAPL');
      expect(res.body.id).toBe(trade.id);
    });

    it('returns 404 for non-existent trade', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/trades/99999');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Trade not found');
    });
  });
});
