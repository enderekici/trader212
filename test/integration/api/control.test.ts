import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { getAuditLogger } from '../../../src/monitoring/audit-log.js';
import { createTestApp } from '../helpers/test-server.js';

describe('Control API', () => {
  it('POST /api/control/pause calls setPaused(true)', async () => {
    let pausedState = false;
    const app = createTestApp({
      botCallbacks: {
        setPaused: (v) => {
          pausedState = v;
        },
      },
    });

    const res = await request(app).post('/api/control/pause');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paused');
    expect(pausedState).toBe(true);
  });

  it('POST /api/control/resume calls setPaused(false)', async () => {
    let pausedState = true;
    const app = createTestApp({
      botCallbacks: {
        setPaused: (v) => {
          pausedState = v;
        },
      },
    });

    const res = await request(app).post('/api/control/resume');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
    expect(pausedState).toBe(false);
  });

  it('POST /api/control/emergency-stop returns success and creates audit entry', async () => {
    const app = createTestApp({
      botCallbacks: {
        emergencyStop: async () => 'All positions closed',
      },
    });

    const res = await request(app).post('/api/control/emergency-stop');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('All positions closed');

    // Verify audit entry was created
    const audit = getAuditLogger();
    const entries = audit.getRecent(10);
    const controlEntry = entries.find(
      (e) => e.eventType === 'control' && e.summary.includes('Emergency stop'),
    );
    expect(controlEntry).toBeDefined();
  });

  it('POST /api/control/close/:symbol calls closePosition callback', async () => {
    let closedSymbol = '';
    const app = createTestApp({
      botCallbacks: {
        closePosition: async (symbol) => {
          closedSymbol = symbol;
          return `Position ${symbol} closed`;
        },
      },
    });

    const res = await request(app).post('/api/control/close/AAPL');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Position AAPL closed');
    expect(closedSymbol).toBe('AAPL');
  });

  it('POST /api/control/analyze/:symbol calls analyzeSymbol callback', async () => {
    let analyzedSymbol = '';
    const app = createTestApp({
      botCallbacks: {
        analyzeSymbol: async (symbol) => {
          analyzedSymbol = symbol;
          return `Analysis complete for ${symbol}`;
        },
      },
    });

    const res = await request(app).post('/api/control/analyze/TSLA');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Analysis complete for TSLA');
    expect(analyzedSymbol).toBe('TSLA');
  });
});
