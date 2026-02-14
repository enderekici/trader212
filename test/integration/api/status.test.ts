import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-server.js';

describe('GET /api/status', () => {
  it('returns 200 with status fields', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/status');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('marketStatus');
    expect(res.body).toHaveProperty('dryRun');
    expect(res.body).toHaveProperty('startedAt');
    expect(res.body).toHaveProperty('marketTimes');
    expect(res.body.status).toBe('running');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('returns paused status when bot is paused', async () => {
    const app = createTestApp({
      botCallbacks: {
        getStatus: () => ({ paused: true, startedAt: new Date().toISOString() }),
      },
    });
    const res = await request(app).get('/api/status');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paused');
  });

  it('bypasses auth even when apiKey is set', async () => {
    const app = createTestApp({ apiKey: 'test-key-123' });
    const res = await request(app).get('/api/status');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
  });
});
