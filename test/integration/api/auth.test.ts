import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-server.js';

describe('Auth middleware', () => {
  const API_KEY = 'test-secret-key-abc';

  it('returns 200 with valid Bearer token', async () => {
    const app = createTestApp({ apiKey: API_KEY });
    const res = await request(app)
      .get('/api/portfolio')
      .set('Authorization', `Bearer ${API_KEY}`);

    expect(res.status).toBe(200);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const app = createTestApp({ apiKey: API_KEY });
    const res = await request(app).get('/api/portfolio');

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('missing Bearer token');
  });

  it('returns 401 with wrong token', async () => {
    const app = createTestApp({ apiKey: API_KEY });
    const res = await request(app)
      .get('/api/portfolio')
      .set('Authorization', 'Bearer wrong-token');

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('invalid token');
  });

  it('/api/status bypasses auth', async () => {
    const app = createTestApp({ apiKey: API_KEY });
    const res = await request(app).get('/api/status');

    expect(res.status).toBe(200);
  });

  it('auth is disabled when no API_SECRET_KEY is set', async () => {
    const app = createTestApp(); // no apiKey
    const res = await request(app).get('/api/portfolio');

    expect(res.status).toBe(200);
  });
});
