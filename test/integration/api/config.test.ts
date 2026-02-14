import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { configManager } from '../../../src/config/manager.js';
import { createTestApp } from '../helpers/test-server.js';

describe('Config API', () => {
  describe('GET /api/config', () => {
    it('returns config grouped by category', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      // Config is seeded during setup, so there should be categories
      const categories = Object.keys(res.body);
      expect(categories.length).toBeGreaterThan(0);
      // Each category should be an array of {key, value, description}
      const firstCategory = res.body[categories[0]];
      expect(Array.isArray(firstCategory)).toBe(true);
      expect(firstCategory[0]).toHaveProperty('key');
      expect(firstCategory[0]).toHaveProperty('value');
    });
  });

  describe('GET /api/config/:category', () => {
    it('returns config for a specific category', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/config/risk');

      expect(res.status).toBe(200);
      // getByCategory returns a Record<string, unknown>
      expect(typeof res.body).toBe('object');
    });

    it('returns empty object for non-existent category', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/config/nonexistent');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });
  });

  describe('PUT /api/config/:key', () => {
    it('updates a config value', async () => {
      const app = createTestApp();
      const res = await request(app)
        .put('/api/config/risk.maxPositions')
        .send({ value: 15 });

      expect(res.status).toBe(200);
      expect(res.body.key).toBe('risk.maxPositions');
      expect(res.body.value).toBe(15);
      expect(res.body.updated).toBe(true);

      // Verify value persisted
      const current = configManager.get<number>('risk.maxPositions');
      expect(current).toBe(15);
    });

    it('rejects request with missing value', async () => {
      const app = createTestApp();
      const res = await request(app)
        .put('/api/config/risk.maxPositions')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });
});
