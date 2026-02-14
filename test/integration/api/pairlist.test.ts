import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { insertPairlistHistory } from '../helpers/fixtures.js';
import { createTestApp } from '../helpers/test-server.js';

describe('Pairlist API', () => {
  describe('GET /api/pairlist', () => {
    it('returns empty pairlist when no history exists', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/pairlist');

      expect(res.status).toBe(200);
      expect(res.body.stocks).toEqual([]);
      expect(res.body.lastRefreshed).toBeNull();
    });

    it('returns current pairlist from latest history entry', async () => {
      const app = createTestApp();
      insertPairlistHistory(['AAPL', 'MSFT', 'GOOGL']);

      const res = await request(app).get('/api/pairlist');

      expect(res.status).toBe(200);
      expect(res.body.stocks).toEqual(['AAPL', 'MSFT', 'GOOGL']);
      expect(res.body.lastRefreshed).toBeDefined();
    });
  });

  describe('POST /api/pairlist/static', () => {
    it('adds a symbol to static pairlist', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/pairlist/static')
        .send({ symbol: 'NVDA' });

      expect(res.status).toBe(200);
      expect(res.body.symbols).toContain('NVDA');
    });

    it('rejects invalid symbol format (Zod validation)', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/pairlist/static')
        .send({ symbol: '123!@#' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects empty symbol', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/pairlist/static')
        .send({ symbol: '' });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/pairlist/static/:symbol', () => {
    it('removes a symbol from static pairlist', async () => {
      const app = createTestApp();
      // First add the symbol
      await request(app).post('/api/pairlist/static').send({ symbol: 'AAPL' });

      // Then remove it
      const res = await request(app).delete('/api/pairlist/static/AAPL');

      expect(res.status).toBe(200);
      expect(res.body.symbols).not.toContain('AAPL');
    });
  });
});
