import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { insertSignal } from '../helpers/fixtures.js';
import { createTestApp } from '../helpers/test-server.js';

describe('Signals API', () => {
  describe('GET /api/signals', () => {
    it('returns empty list when no signals', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/signals');

      expect(res.status).toBe(200);
      expect(res.body.signals).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('returns signals and supports symbol filter', async () => {
      const app = createTestApp();
      insertSignal({ symbol: 'AAPL' });
      insertSignal({ symbol: 'MSFT' });

      const all = await request(app).get('/api/signals');
      expect(all.body.signals).toHaveLength(2);

      const filtered = await request(app).get('/api/signals?symbol=AAPL');
      expect(filtered.body.signals).toHaveLength(1);
      expect(filtered.body.signals[0].symbol).toBe('AAPL');
    });

    it('supports date range filters', async () => {
      const app = createTestApp();
      insertSignal({ symbol: 'AAPL', timestamp: '2025-01-10T10:00:00Z' });
      insertSignal({ symbol: 'MSFT', timestamp: '2025-06-15T10:00:00Z' });

      const res = await request(app).get(
        '/api/signals?from=2025-06-01T00:00:00Z&to=2025-12-31T23:59:59Z',
      );

      expect(res.status).toBe(200);
      expect(res.body.signals).toHaveLength(1);
      expect(res.body.signals[0].symbol).toBe('MSFT');
    });
  });

  describe('GET /api/signals/:symbol/latest', () => {
    it('returns the latest signal for a symbol', async () => {
      const app = createTestApp();
      insertSignal({ symbol: 'AAPL', timestamp: '2025-01-01T10:00:00Z', decision: 'HOLD' });
      insertSignal({ symbol: 'AAPL', timestamp: '2025-06-01T10:00:00Z', decision: 'BUY' });

      const res = await request(app).get('/api/signals/AAPL/latest');

      expect(res.status).toBe(200);
      expect(res.body.symbol).toBe('AAPL');
      expect(res.body.decision).toBe('BUY');
    });

    it('returns 404 when no signals exist for symbol', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/signals/NVDA/latest');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('No signals found');
    });
  });

  describe('GET /api/signals/:symbol/history', () => {
    it('returns signal history for a symbol', async () => {
      const app = createTestApp();
      insertSignal({ symbol: 'AAPL', timestamp: '2025-01-01T10:00:00Z' });
      insertSignal({ symbol: 'AAPL', timestamp: '2025-02-01T10:00:00Z' });
      insertSignal({ symbol: 'MSFT', timestamp: '2025-03-01T10:00:00Z' });

      const res = await request(app).get('/api/signals/AAPL/history');

      expect(res.status).toBe(200);
      expect(res.body.signals).toHaveLength(2);
      expect(res.body.signals.every((s: { symbol: string }) => s.symbol === 'AAPL')).toBe(true);
    });
  });
});
