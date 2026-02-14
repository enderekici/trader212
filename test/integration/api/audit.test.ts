import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { insertAuditEntry } from '../helpers/fixtures.js';
import { createTestApp } from '../helpers/test-server.js';

describe('Audit API', () => {
  describe('GET /api/audit', () => {
    it('returns recent audit entries', async () => {
      const app = createTestApp();
      insertAuditEntry({ summary: 'Trade executed', eventType: 'trade' });
      insertAuditEntry({ summary: 'Signal generated', eventType: 'signal' });

      const res = await request(app).get('/api/audit');

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(2);
    });

    it('filters by event type', async () => {
      const app = createTestApp();
      insertAuditEntry({ summary: 'Trade executed', eventType: 'trade' });
      insertAuditEntry({ summary: 'Config changed', eventType: 'config' });
      insertAuditEntry({ summary: 'Another trade', eventType: 'trade' });

      const res = await request(app).get('/api/audit?type=trade');

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(2);
      expect(res.body.entries.every((e: { eventType: string }) => e.eventType === 'trade')).toBe(
        true,
      );
    });

    it('filters by date', async () => {
      const app = createTestApp();
      insertAuditEntry({ summary: 'Today entry', timestamp: '2025-03-15T10:00:00Z' });
      insertAuditEntry({ summary: 'Yesterday entry', timestamp: '2025-03-14T10:00:00Z' });

      const res = await request(app).get('/api/audit?date=2025-03-15');

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0].summary).toBe('Today entry');
    });

    it('respects limit parameter', async () => {
      const app = createTestApp();
      for (let i = 0; i < 10; i++) {
        insertAuditEntry({ summary: `Entry ${i}` });
      }

      const res = await request(app).get('/api/audit?limit=3');

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(3);
    });
  });
});
