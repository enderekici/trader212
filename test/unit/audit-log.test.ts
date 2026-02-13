import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: unknown) => col),
  eq: vi.fn(),
  gte: vi.fn(),
}));

// DB mock
const mockDbRun = vi.fn().mockReturnValue({ lastInsertRowid: 1n, changes: 1 });
const mockDbGet = vi.fn();
const mockDbAll = vi.fn().mockReturnValue([]);

function createChain() {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'set', 'values', 'orderBy', 'limit', 'onConflictDoUpdate'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.run = mockDbRun;
  chain.get = mockDbGet;
  chain.all = mockDbAll;
  return chain;
}

const mockChain = createChain();

vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    select: () => mockChain,
    insert: () => mockChain,
    update: () => mockChain,
  }),
}));

vi.mock('../../src/db/schema.js', () => ({
  auditLog: {
    timestamp: 'timestamp',
    eventType: 'eventType',
    symbol: 'symbol',
  },
}));

// ── Import SUT ──────────────────────────────────────────────────────────────
import { AuditLogger, getAuditLogger } from '../../src/monitoring/audit-log.js';

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new AuditLogger();
  });

  // ── log ────────────────────────────────────────────────────────────────
  describe('log', () => {
    it('inserts audit entry with all fields', () => {
      logger.log({
        eventType: 'trade',
        category: 'execution',
        symbol: 'AAPL',
        summary: 'BUY order placed',
        details: { shares: 10, price: 150 },
        severity: 'info',
      });

      expect(mockDbRun).toHaveBeenCalled();
    });

    it('handles missing optional fields', () => {
      logger.log({
        eventType: 'error',
        category: 'system',
        summary: 'Something happened',
      });

      expect(mockDbRun).toHaveBeenCalled();
    });

    it('defaults severity to info', () => {
      const capturedValues: Record<string, unknown>[] = [];
      (mockChain.values as ReturnType<typeof vi.fn>).mockImplementation((val: Record<string, unknown>) => {
        capturedValues.push(val);
        return mockChain;
      });

      logger.log({
        eventType: 'config',
        category: 'system',
        summary: 'Config changed',
      });

      expect(capturedValues[0].severity).toBe('info');
    });

    it('serializes details as JSON', () => {
      const capturedValues: Record<string, unknown>[] = [];
      (mockChain.values as ReturnType<typeof vi.fn>).mockImplementation((val: Record<string, unknown>) => {
        capturedValues.push(val);
        return mockChain;
      });

      logger.log({
        eventType: 'trade',
        category: 'execution',
        summary: 'test',
        details: { key: 'value' },
      });

      expect(capturedValues[0].details).toBe('{"key":"value"}');
    });

    it('sets details to null when not provided', () => {
      const capturedValues: Record<string, unknown>[] = [];
      (mockChain.values as ReturnType<typeof vi.fn>).mockImplementation((val: Record<string, unknown>) => {
        capturedValues.push(val);
        return mockChain;
      });

      logger.log({
        eventType: 'trade',
        category: 'execution',
        summary: 'test',
      });

      expect(capturedValues[0].details).toBeNull();
    });

    it('handles DB error without crashing', () => {
      (mockChain.run as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('DB write failure');
      });

      expect(() => {
        logger.log({
          eventType: 'error',
          category: 'system',
          summary: 'test',
        });
      }).not.toThrow();
    });
  });

  // ── Convenience methods ────────────────────────────────────────────────
  describe('logTrade', () => {
    it('logs with trade event type and execution category', () => {
      const spy = vi.spyOn(logger, 'log');

      logger.logTrade('AAPL', 'BUY 10 shares', { shares: 10 });

      expect(spy).toHaveBeenCalledWith({
        eventType: 'trade',
        category: 'execution',
        symbol: 'AAPL',
        summary: 'BUY 10 shares',
        details: { shares: 10 },
      });
    });
  });

  describe('logSignal', () => {
    it('logs with signal event type and analysis category', () => {
      const spy = vi.spyOn(logger, 'log');

      logger.logSignal('AAPL', 'Bullish signal detected');

      expect(spy).toHaveBeenCalledWith({
        eventType: 'signal',
        category: 'analysis',
        symbol: 'AAPL',
        summary: 'Bullish signal detected',
        details: undefined,
      });
    });
  });

  describe('logRisk', () => {
    it('logs with control event type, risk category, and default warn severity', () => {
      const spy = vi.spyOn(logger, 'log');

      logger.logRisk('Max drawdown breached');

      expect(spy).toHaveBeenCalledWith({
        eventType: 'control',
        category: 'risk',
        summary: 'Max drawdown breached',
        details: undefined,
        severity: 'warn',
      });
    });

    it('accepts custom severity', () => {
      const spy = vi.spyOn(logger, 'log');

      logger.logRisk('Critical risk', { value: 0.15 }, 'error');

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      );
    });
  });

  describe('logConfig', () => {
    it('logs with config event type and system category', () => {
      const spy = vi.spyOn(logger, 'log');

      logger.logConfig('Config updated', { key: 'risk.maxPositions', value: 5 });

      expect(spy).toHaveBeenCalledWith({
        eventType: 'config',
        category: 'system',
        summary: 'Config updated',
        details: { key: 'risk.maxPositions', value: 5 },
      });
    });
  });

  describe('logError', () => {
    it('logs with error event type and error severity', () => {
      const spy = vi.spyOn(logger, 'log');

      logger.logError('API failure');

      expect(spy).toHaveBeenCalledWith({
        eventType: 'error',
        category: 'system',
        summary: 'API failure',
        details: undefined,
        severity: 'error',
      });
    });
  });

  describe('logControl', () => {
    it('logs with control event type and user category', () => {
      const spy = vi.spyOn(logger, 'log');

      logger.logControl('Bot paused');

      expect(spy).toHaveBeenCalledWith({
        eventType: 'control',
        category: 'user',
        summary: 'Bot paused',
        details: undefined,
      });
    });
  });

  describe('logResearch', () => {
    it('logs with research event type and analysis category', () => {
      const spy = vi.spyOn(logger, 'log');

      logger.logResearch('Market research complete');

      expect(spy).toHaveBeenCalledWith({
        eventType: 'research',
        category: 'analysis',
        summary: 'Market research complete',
        details: undefined,
      });
    });
  });

  // ── getEntriesForDate ──────────────────────────────────────────────────
  describe('getEntriesForDate', () => {
    it('returns entries for a specific date', () => {
      mockDbAll.mockReturnValueOnce([
        {
          id: 1,
          timestamp: '2025-01-15T10:00:00.000Z',
          eventType: 'trade',
          category: 'execution',
          symbol: 'AAPL',
          summary: 'BUY',
          details: '{"shares":10}',
          severity: 'info',
        },
        {
          id: 2,
          timestamp: '2025-01-16T08:00:00.000Z',
          eventType: 'signal',
          category: 'analysis',
          symbol: 'GOOG',
          summary: 'Signal',
          details: null,
          severity: 'info',
        },
      ]);

      const entries = logger.getEntriesForDate('2025-01-15');

      // Only the first entry should match (before 2025-01-16)
      expect(entries).toHaveLength(1);
      expect(entries[0].symbol).toBe('AAPL');
      expect(entries[0].details).toEqual({ shares: 10 });
    });

    it('returns empty array when no entries', () => {
      mockDbAll.mockReturnValueOnce([]);

      const entries = logger.getEntriesForDate('2025-01-15');
      expect(entries).toEqual([]);
    });
  });

  // ── getRecent ──────────────────────────────────────────────────────────
  describe('getRecent', () => {
    it('returns recent entries with default limit', () => {
      mockDbAll.mockReturnValueOnce([
        {
          id: 1,
          timestamp: '2025-01-15T10:00:00Z',
          eventType: 'trade',
          category: 'execution',
          symbol: 'AAPL',
          summary: 'BUY',
          details: null,
          severity: 'info',
        },
      ]);

      const entries = logger.getRecent();
      expect(entries).toHaveLength(1);
    });

    it('accepts custom limit', () => {
      mockDbAll.mockReturnValueOnce([]);

      const entries = logger.getRecent(10);
      expect(entries).toEqual([]);
    });
  });

  // ── getByType ──────────────────────────────────────────────────────────
  describe('getByType', () => {
    it('returns entries filtered by event type', () => {
      mockDbAll.mockReturnValueOnce([
        {
          id: 1,
          timestamp: '2025-01-15T10:00:00Z',
          eventType: 'trade',
          category: 'execution',
          symbol: 'AAPL',
          summary: 'BUY',
          details: null,
          severity: 'info',
        },
      ]);

      const entries = logger.getByType('trade');
      expect(entries).toHaveLength(1);
    });

    it('accepts custom limit', () => {
      mockDbAll.mockReturnValueOnce([]);

      const entries = logger.getByType('error', 10);
      expect(entries).toEqual([]);
    });
  });

  // ── getBySymbol ────────────────────────────────────────────────────────
  describe('getBySymbol', () => {
    it('returns entries filtered by symbol', () => {
      mockDbAll.mockReturnValueOnce([
        {
          id: 1,
          timestamp: '2025-01-15T10:00:00Z',
          eventType: 'trade',
          category: 'execution',
          symbol: 'AAPL',
          summary: 'BUY',
          details: null,
          severity: 'info',
        },
      ]);

      const entries = logger.getBySymbol('AAPL');
      expect(entries).toHaveLength(1);
    });

    it('accepts custom limit', () => {
      mockDbAll.mockReturnValueOnce([]);

      const entries = logger.getBySymbol('GOOG', 5);
      expect(entries).toEqual([]);
    });
  });

  // ── generateDailyReport ────────────────────────────────────────────────
  describe('generateDailyReport', () => {
    it('generates report with all sections', () => {
      mockDbAll.mockReturnValueOnce([
        {
          id: 1,
          timestamp: '2025-01-15T10:30:00.000Z',
          eventType: 'trade',
          category: 'execution',
          symbol: 'AAPL',
          summary: 'BUY 10 shares',
          details: null,
          severity: 'info',
        },
        {
          id: 2,
          timestamp: '2025-01-15T11:00:00.000Z',
          eventType: 'signal',
          category: 'analysis',
          symbol: 'GOOG',
          summary: 'Bullish signal',
          details: null,
          severity: 'info',
        },
        {
          id: 3,
          timestamp: '2025-01-15T12:00:00.000Z',
          eventType: 'error',
          category: 'system',
          symbol: null,
          summary: 'API timeout',
          details: null,
          severity: 'error',
        },
        {
          id: 4,
          timestamp: '2025-01-15T13:00:00.000Z',
          eventType: 'control',
          category: 'risk',
          symbol: null,
          summary: 'Drawdown alert',
          details: null,
          severity: 'warn',
        },
      ]);

      const report = logger.generateDailyReport('2025-01-15');

      expect(report).toContain('Bot Activity Report: 2025-01-15');
      expect(report).toContain('Total Events: 4');
      expect(report).toContain('Trades: 1');
      expect(report).toContain('Signals Analyzed: 1');
      expect(report).toContain('Errors: 1');
      expect(report).toContain('Risk Alerts: 1');
      expect(report).toContain('AAPL');
      expect(report).toContain('API timeout');
      expect(report).toContain('Drawdown alert');
    });

    it('generates minimal report when no events', () => {
      mockDbAll.mockReturnValueOnce([]);

      const report = logger.generateDailyReport('2025-01-15');

      expect(report).toContain('Total Events: 0');
      // Summary has "Trades: 0" but the detailed "Trades:" section with entries should not exist
      // When there are 0 trades, the detailed list section (which appears as a bare "Trades:\n  ...")
      // is not present. We verify the report has no timestamped trade entries.
      const lines = report.split('\n');
      const tradeDetailLine = lines.find((l: string) => l.startsWith('  ') && l.includes(' - '));
      expect(tradeDetailLine).toBeUndefined();
    });
  });

  // ── getAuditLogger singleton ───────────────────────────────────────────
  describe('getAuditLogger', () => {
    it('returns same instance on repeated calls', () => {
      const a = getAuditLogger();
      const b = getAuditLogger();
      expect(a).toBe(b);
    });

    it('returns an AuditLogger instance', () => {
      const instance = getAuditLogger();
      expect(instance).toBeInstanceOf(AuditLogger);
    });
  });
});
