import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────
const mockConfigGet = vi.fn();
vi.mock('../../src/config/manager.js', () => ({
  configManager: { get: (...args: unknown[]) => mockConfigGet(...args) },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── DB Mock State ──────────────────────────────────────────────────────────
// Each call to getDb().select().from().where().all() or .get() returns from this queue
let selectResultsQueue: Array<unknown[]> = [];
let insertedRows: Array<Record<string, unknown>> = [];

const mockRun = vi.fn();
const mockValues = vi.fn();
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

const mockUpdateWhere = vi.fn().mockReturnValue({ run: mockRun });
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

function createSelectChain() {
  const results = selectResultsQueue.shift() ?? [];
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue(results),
        get: vi.fn().mockReturnValue(results[0] ?? undefined),
      }),
      all: vi.fn().mockReturnValue(results),
    }),
  };
}

const mockSelect = vi.fn().mockImplementation(() => createSelectChain());

vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  }),
}));

vi.mock('../../src/db/schema.js', () => ({
  pairLocks: {
    id: 'id',
    symbol: 'symbol',
    lockEnd: 'lockEnd',
    reason: 'reason',
    side: 'side',
    active: 'active',
    createdAt: 'createdAt',
  },
  trades: {
    symbol: 'symbol',
    exitReason: 'exitReason',
    exitTime: 'exitTime',
    pnlPct: 'pnlPct',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, op: 'eq' })),
  gte: vi.fn((col: unknown, val: unknown) => ({ col, val, op: 'gte' })),
  lte: vi.fn((col: unknown, val: unknown) => ({ col, val, op: 'lte' })),
  isNotNull: vi.fn((col: unknown) => ({ col, op: 'isNotNull' })),
  desc: vi.fn((col: unknown) => col),
}));

// ── Import SUT ──────────────────────────────────────────────────────────────
import { PairLockManager, getPairLockManager } from '../../src/execution/pair-locks.js';
import { ProtectionManager, getProtectionManager } from '../../src/execution/protections.js';

describe('PairLockManager', () => {
  let manager: PairLockManager;

  beforeEach(() => {
    vi.clearAllMocks();
    selectResultsQueue = [];
    insertedRows = [];
    manager = new PairLockManager();

    // Track inserted values
    mockValues.mockImplementation((val: Record<string, unknown>) => {
      insertedRows.push(val);
      return { run: mockRun };
    });
  });

  describe('lockPair', () => {
    it('inserts a lock record into the database', () => {
      manager.lockPair('AAPL', 30, 'cooldown');

      expect(mockInsert).toHaveBeenCalled();
      expect(insertedRows.length).toBe(1);
      expect(insertedRows[0].symbol).toBe('AAPL');
      expect(insertedRows[0].reason).toBe('cooldown');
      expect(insertedRows[0].side).toBe('*');
      expect(insertedRows[0].active).toBe(true);
    });

    it('sets the lockEnd to the correct future time', () => {
      const before = Date.now();
      manager.lockPair('TSLA', 60, 'stoploss_guard');
      const after = Date.now();

      const lockEnd = new Date(insertedRows[0].lockEnd as string).getTime();
      expect(lockEnd).toBeGreaterThanOrEqual(before + 60 * 60_000 - 1000);
      expect(lockEnd).toBeLessThanOrEqual(after + 60 * 60_000 + 1000);
    });

    it('respects the side parameter', () => {
      manager.lockPair('GOOGL', 15, 'test', 'long');
      expect(insertedRows[0].side).toBe('long');
    });

    it('defaults side to * when not specified', () => {
      manager.lockPair('MSFT', 10, 'test');
      expect(insertedRows[0].side).toBe('*');
    });
  });

  describe('lockGlobal', () => {
    it('creates a lock with symbol *', () => {
      manager.lockGlobal(120, 'max_drawdown');

      expect(insertedRows.length).toBe(1);
      expect(insertedRows[0].symbol).toBe('*');
      expect(insertedRows[0].reason).toBe('max_drawdown');
    });
  });

  describe('isPairLocked', () => {
    it('returns locked=false when no active locks exist', () => {
      // First select: symbol-specific locks (empty)
      selectResultsQueue.push([]);
      // Second select: global locks (empty)
      selectResultsQueue.push([]);

      const result = manager.isPairLocked('AAPL');
      expect(result.locked).toBe(false);
    });

    it('returns locked=true when symbol has an active lock', () => {
      const futureDate = new Date(Date.now() + 60 * 60_000).toISOString();
      // Symbol-specific locks
      selectResultsQueue.push([
        { symbol: 'AAPL', lockEnd: futureDate, reason: 'cooldown', side: '*', active: true },
      ]);
      // Global locks (not checked because we found a match)

      const result = manager.isPairLocked('AAPL');
      expect(result.locked).toBe(true);
      expect(result.reason).toBe('cooldown');
    });

    it('returns locked=true when global lock is active', () => {
      const futureDate = new Date(Date.now() + 60 * 60_000).toISOString();
      // Symbol-specific locks (empty)
      selectResultsQueue.push([]);
      // Global locks
      selectResultsQueue.push([
        { symbol: '*', lockEnd: futureDate, reason: 'stoploss_guard', side: '*', active: true },
      ]);

      const result = manager.isPairLocked('AAPL');
      expect(result.locked).toBe(true);
      expect(result.reason).toBe('stoploss_guard');
    });

    it('returns locked=true when side-specific lock matches', () => {
      const futureDate = new Date(Date.now() + 60 * 60_000).toISOString();
      selectResultsQueue.push([
        { symbol: 'AAPL', lockEnd: futureDate, reason: 'cooldown', side: 'long', active: true },
      ]);

      const result = manager.isPairLocked('AAPL', 'long');
      expect(result.locked).toBe(true);
    });

    it('returns locked=false when side-specific lock does not match', () => {
      const futureDate = new Date(Date.now() + 60 * 60_000).toISOString();
      // Symbol locks: only 'short' side locked
      selectResultsQueue.push([
        { symbol: 'AAPL', lockEnd: futureDate, reason: 'cooldown', side: 'short', active: true },
      ]);
      // Global locks: empty
      selectResultsQueue.push([]);

      const result = manager.isPairLocked('AAPL', 'long');
      expect(result.locked).toBe(false);
    });

    it('returns locked=true when lock side is * and query side is specific', () => {
      const futureDate = new Date(Date.now() + 60 * 60_000).toISOString();
      selectResultsQueue.push([
        { symbol: 'AAPL', lockEnd: futureDate, reason: 'cooldown', side: '*', active: true },
      ]);

      const result = manager.isPairLocked('AAPL', 'long');
      expect(result.locked).toBe(true);
    });

    it('uses default reason when lock reason is null', () => {
      const futureDate = new Date(Date.now() + 60 * 60_000).toISOString();
      selectResultsQueue.push([
        { symbol: 'AAPL', lockEnd: futureDate, reason: null, side: '*', active: true },
      ]);

      const result = manager.isPairLocked('AAPL');
      expect(result.locked).toBe(true);
      expect(result.reason).toBe('Pair locked');
    });
  });

  describe('isGlobalLocked', () => {
    it('returns locked=false when no global locks', () => {
      selectResultsQueue.push([]);

      const result = manager.isGlobalLocked();
      expect(result.locked).toBe(false);
    });

    it('returns locked=true when global lock exists', () => {
      const futureDate = new Date(Date.now() + 60 * 60_000).toISOString();
      selectResultsQueue.push([
        { symbol: '*', lockEnd: futureDate, reason: 'max_drawdown', side: '*', active: true },
      ]);

      const result = manager.isGlobalLocked();
      expect(result.locked).toBe(true);
      expect(result.reason).toBe('max_drawdown');
    });

    it('uses default reason when global lock reason is null', () => {
      const futureDate = new Date(Date.now() + 60 * 60_000).toISOString();
      selectResultsQueue.push([
        { symbol: '*', lockEnd: futureDate, reason: null, side: '*', active: true },
      ]);

      const result = manager.isGlobalLocked();
      expect(result.locked).toBe(true);
      expect(result.reason).toBe('Global lock active');
    });
  });

  describe('getActiveLocks', () => {
    it('returns empty array when no active locks', () => {
      selectResultsQueue.push([]);

      const locks = manager.getActiveLocks();
      expect(locks).toEqual([]);
    });

    it('returns all active unexpired locks', () => {
      const futureDate = new Date(Date.now() + 60 * 60_000).toISOString();
      const expected = [
        { id: 1, symbol: 'AAPL', lockEnd: futureDate, reason: 'cooldown', side: '*', active: true, createdAt: '2026-01-01' },
        { id: 2, symbol: '*', lockEnd: futureDate, reason: 'stoploss_guard', side: '*', active: true, createdAt: '2026-01-01' },
      ];
      selectResultsQueue.push(expected);

      const locks = manager.getActiveLocks();
      expect(locks).toHaveLength(2);
      expect(locks[0].symbol).toBe('AAPL');
      expect(locks[1].symbol).toBe('*');
    });
  });

  describe('unlockPair', () => {
    it('calls update to deactivate locks for the symbol', () => {
      manager.unlockPair('AAPL');

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockUpdateSet).toHaveBeenCalledWith({ active: false });
    });
  });

  describe('cleanupExpired', () => {
    it('returns 0 when no expired locks exist', () => {
      selectResultsQueue.push([]);

      const count = manager.cleanupExpired();
      expect(count).toBe(0);
    });

    it('deactivates expired locks and returns count', () => {
      selectResultsQueue.push([{ id: 1 }, { id: 2 }]);

      const count = manager.cleanupExpired();
      expect(count).toBe(2);
      // update should have been called for each expired lock
      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });

    it('returns 0 when all locks are still active and not expired', () => {
      // The query uses lte(lockEnd, now), so if nothing matches it returns []
      selectResultsQueue.push([]);

      const count = manager.cleanupExpired();
      expect(count).toBe(0);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('getPairLockManager (singleton)', () => {
    it('returns a PairLockManager instance', () => {
      const instance = getPairLockManager();
      expect(instance).toBeInstanceOf(PairLockManager);
    });

    it('returns the same instance on subsequent calls', () => {
      const first = getPairLockManager();
      const second = getPairLockManager();
      expect(first).toBe(second);
    });
  });
});

describe('ProtectionManager', () => {
  let protectionManager: ProtectionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    selectResultsQueue = [];
    insertedRows = [];
    protectionManager = new ProtectionManager();

    // Track inserted values for lockPair calls
    mockValues.mockImplementation((val: Record<string, unknown>) => {
      insertedRows.push(val);
      return { run: mockRun };
    });

    // Default config values
    mockConfigGet.mockImplementation((key: string) => {
      const defaults: Record<string, unknown> = {
        'protection.cooldownMinutes': 30,
        'protection.stoplossGuard.enabled': true,
        'protection.stoplossGuard.tradeLimit': 3,
        'protection.stoplossGuard.lookbackMinutes': 120,
        'protection.stoplossGuard.lockMinutes': 60,
        'protection.stoplossGuard.onlyPerPair': false,
        'protection.maxDrawdownLock.enabled': true,
        'protection.maxDrawdownLock.maxDrawdownPct': 0.10,
        'protection.maxDrawdownLock.lookbackMinutes': 1440,
        'protection.maxDrawdownLock.lockMinutes': 120,
        'protection.lowProfitPair.enabled': true,
        'protection.lowProfitPair.minProfit': -0.05,
        'protection.lowProfitPair.tradeLimit': 3,
        'protection.lowProfitPair.lookbackMinutes': 10080,
        'protection.lowProfitPair.lockMinutes': 1440,
      };
      return defaults[key];
    });
  });

  describe('canTrade', () => {
    it('returns allowed=true when no locks exist', () => {
      // isPairLocked: symbol locks, global locks
      selectResultsQueue.push([]);
      selectResultsQueue.push([]);

      const result = protectionManager.canTrade('AAPL');
      expect(result.allowed).toBe(true);
    });

    it('returns allowed=false when pair is locked', () => {
      const futureDate = new Date(Date.now() + 60 * 60_000).toISOString();
      selectResultsQueue.push([
        { symbol: 'AAPL', lockEnd: futureDate, reason: 'cooldown', side: '*', active: true },
      ]);

      const result = protectionManager.canTrade('AAPL');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('cooldown');
    });
  });

  describe('evaluateAfterClose - Cooldown', () => {
    it('creates a cooldown lock after any trade close', () => {
      // Stoploss guard queries trades
      selectResultsQueue.push([]);
      // Max drawdown queries trades
      selectResultsQueue.push([]);
      // Low profit queries trades
      selectResultsQueue.push([]);

      protectionManager.evaluateAfterClose('AAPL', 'AI sell signal', 0.05);

      // Should have inserted a cooldown lock
      const cooldownLock = insertedRows.find((r) => r.reason === 'cooldown');
      expect(cooldownLock).toBeDefined();
      expect(cooldownLock?.symbol).toBe('AAPL');
    });

    it('does not create cooldown lock when cooldownMinutes is 0', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'protection.cooldownMinutes') return 0;
        if (key === 'protection.stoplossGuard.enabled') return false;
        if (key === 'protection.maxDrawdownLock.enabled') return false;
        if (key === 'protection.lowProfitPair.enabled') return false;
        return undefined;
      });

      protectionManager.evaluateAfterClose('AAPL', 'AI sell signal', 0);

      const cooldownLock = insertedRows.find((r) => r.reason === 'cooldown');
      expect(cooldownLock).toBeUndefined();
    });
  });

  describe('evaluateAfterClose - StoplossGuard', () => {
    it('triggers global lock when stoploss exits reach the limit', () => {
      // Stoploss guard queries recent trades
      selectResultsQueue.push([
        { symbol: 'AAPL', exitReason: 'Stop-loss triggered', exitTime: new Date().toISOString() },
        { symbol: 'TSLA', exitReason: 'stoploss hit', exitTime: new Date().toISOString() },
        { symbol: 'GOOGL', exitReason: 'Stop loss', exitTime: new Date().toISOString() },
      ]);
      // Max drawdown queries trades
      selectResultsQueue.push([]);
      // Low profit queries trades
      selectResultsQueue.push([]);

      protectionManager.evaluateAfterClose('AAPL', 'Stop-loss triggered', -0.05);

      const guardLock = insertedRows.find((r) => r.reason === 'stoploss_guard');
      expect(guardLock).toBeDefined();
      expect(guardLock?.symbol).toBe('*'); // Global lock
    });

    it('does not trigger when exit reason is not stoploss-related', () => {
      // Stoploss guard skips non-stoploss exits, but still queries for other protections
      // Max drawdown queries trades
      selectResultsQueue.push([]);
      // Low profit queries trades
      selectResultsQueue.push([]);

      protectionManager.evaluateAfterClose('AAPL', 'AI sell signal', 0.05);

      const guardLock = insertedRows.find((r) => r.reason === 'stoploss_guard');
      expect(guardLock).toBeUndefined();
    });

    it('triggers per-pair lock when onlyPerPair is true', () => {
      mockConfigGet.mockImplementation((key: string) => {
        const defaults: Record<string, unknown> = {
          'protection.cooldownMinutes': 30,
          'protection.stoplossGuard.enabled': true,
          'protection.stoplossGuard.tradeLimit': 2,
          'protection.stoplossGuard.lookbackMinutes': 120,
          'protection.stoplossGuard.lockMinutes': 60,
          'protection.stoplossGuard.onlyPerPair': true,
          'protection.maxDrawdownLock.enabled': false,
          'protection.lowProfitPair.enabled': false,
        };
        return defaults[key];
      });

      // Stoploss guard trades query
      selectResultsQueue.push([
        { symbol: 'AAPL', exitReason: 'Stop-loss triggered', exitTime: new Date().toISOString() },
        { symbol: 'AAPL', exitReason: 'stoploss', exitTime: new Date().toISOString() },
      ]);

      protectionManager.evaluateAfterClose('AAPL', 'Stop-loss triggered', -0.05);

      const guardLock = insertedRows.find((r) => r.reason === 'stoploss_guard');
      expect(guardLock).toBeDefined();
      expect(guardLock?.symbol).toBe('AAPL'); // Per-pair lock, not global
    });

    it('does not trigger when stoploss guard is disabled', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'protection.cooldownMinutes') return 0;
        if (key === 'protection.stoplossGuard.enabled') return false;
        if (key === 'protection.maxDrawdownLock.enabled') return false;
        if (key === 'protection.lowProfitPair.enabled') return false;
        return undefined;
      });

      protectionManager.evaluateAfterClose('AAPL', 'Stop-loss triggered', -0.05);

      const guardLock = insertedRows.find((r) => r.reason === 'stoploss_guard');
      expect(guardLock).toBeUndefined();
    });

    it('does not trigger when stoploss count is below limit', () => {
      // Stoploss guard: only 1 stoploss exit
      selectResultsQueue.push([
        { symbol: 'AAPL', exitReason: 'Stop-loss triggered', exitTime: new Date().toISOString() },
        { symbol: 'TSLA', exitReason: 'AI sell', exitTime: new Date().toISOString() },
      ]);
      // Max drawdown
      selectResultsQueue.push([]);
      // Low profit
      selectResultsQueue.push([]);

      protectionManager.evaluateAfterClose('AAPL', 'Stop-loss triggered', -0.05);

      // Only 1 stoploss exit, limit is 3
      const guardLock = insertedRows.find((r) => r.reason === 'stoploss_guard');
      expect(guardLock).toBeUndefined();
    });

    it('recognizes multiple stoploss exit reason variations', () => {
      selectResultsQueue.push([
        { symbol: 'AAPL', exitReason: 'Stop-loss', exitTime: new Date().toISOString() },
        { symbol: 'TSLA', exitReason: 'stop_loss hit', exitTime: new Date().toISOString() },
        { symbol: 'GOOGL', exitReason: 'Stoploss triggered', exitTime: new Date().toISOString() },
      ]);
      selectResultsQueue.push([]);
      selectResultsQueue.push([]);

      protectionManager.evaluateAfterClose('AAPL', 'Stop-loss', -0.05);

      const guardLock = insertedRows.find((r) => r.reason === 'stoploss_guard');
      expect(guardLock).toBeDefined();
    });
  });

  describe('evaluateAfterClose - MaxDrawdownLock', () => {
    it('triggers global lock when drawdown exceeds threshold', () => {
      // Stoploss guard (exit reason = 'AI sell', not stoploss) - skipped
      // Max drawdown trades query
      selectResultsQueue.push([
        { pnlPct: 0.03, exitTime: '2026-02-14T10:00:00Z' },
        { pnlPct: -0.05, exitTime: '2026-02-14T11:00:00Z' },
        { pnlPct: -0.04, exitTime: '2026-02-14T12:00:00Z' },
        { pnlPct: -0.06, exitTime: '2026-02-14T13:00:00Z' },
      ]);
      // Low profit
      selectResultsQueue.push([]);

      // Cumulative: 0.03, -0.02, -0.06, -0.12
      // Peak: 0.03, max drawdown: 0.03 - (-0.12) = 0.15 > 0.10

      protectionManager.evaluateAfterClose('AAPL', 'AI sell', 0);

      const drawdownLock = insertedRows.find((r) => r.reason === 'max_drawdown');
      expect(drawdownLock).toBeDefined();
      expect(drawdownLock?.symbol).toBe('*');
    });

    it('does not trigger when drawdown is within threshold', () => {
      selectResultsQueue.push([
        { pnlPct: 0.05, exitTime: '2026-02-14T10:00:00Z' },
        { pnlPct: -0.02, exitTime: '2026-02-14T11:00:00Z' },
        { pnlPct: 0.01, exitTime: '2026-02-14T12:00:00Z' },
      ]);
      selectResultsQueue.push([]);

      protectionManager.evaluateAfterClose('AAPL', 'AI sell', 0);

      const drawdownLock = insertedRows.find((r) => r.reason === 'max_drawdown');
      expect(drawdownLock).toBeUndefined();
    });

    it('does not trigger when disabled', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'protection.cooldownMinutes') return 0;
        if (key === 'protection.stoplossGuard.enabled') return false;
        if (key === 'protection.maxDrawdownLock.enabled') return false;
        if (key === 'protection.lowProfitPair.enabled') return false;
        return undefined;
      });

      protectionManager.evaluateAfterClose('AAPL', 'AI sell', -0.20);

      const drawdownLock = insertedRows.find((r) => r.reason === 'max_drawdown');
      expect(drawdownLock).toBeUndefined();
    });

    it('does not trigger when no recent trades exist', () => {
      selectResultsQueue.push([]);
      selectResultsQueue.push([]);

      protectionManager.evaluateAfterClose('AAPL', 'AI sell', 0);

      const drawdownLock = insertedRows.find((r) => r.reason === 'max_drawdown');
      expect(drawdownLock).toBeUndefined();
    });
  });

  describe('evaluateAfterClose - LowProfitPair', () => {
    it('locks pair when cumulative profit is below threshold', () => {
      // Max drawdown
      selectResultsQueue.push([]);
      // Low profit pair trades
      selectResultsQueue.push([
        { pnlPct: -0.02 },
        { pnlPct: -0.01 },
        { pnlPct: -0.03 },
      ]);

      // Total: -0.06 < -0.05 (minProfit) with 3 trades >= 3 (tradeLimit)
      protectionManager.evaluateAfterClose('AAPL', 'AI sell', -0.02);

      const lowProfitLock = insertedRows.find((r) => r.reason === 'low_profit');
      expect(lowProfitLock).toBeDefined();
      expect(lowProfitLock?.symbol).toBe('AAPL');
    });

    it('does not lock when trade count is below limit', () => {
      selectResultsQueue.push([]);
      selectResultsQueue.push([
        { pnlPct: -0.10 },
        { pnlPct: -0.10 },
      ]);

      // Only 2 trades < 3 (tradeLimit)
      protectionManager.evaluateAfterClose('AAPL', 'AI sell', -0.10);

      const lowProfitLock = insertedRows.find((r) => r.reason === 'low_profit');
      expect(lowProfitLock).toBeUndefined();
    });

    it('does not lock when cumulative profit is above threshold', () => {
      selectResultsQueue.push([]);
      selectResultsQueue.push([
        { pnlPct: 0.02 },
        { pnlPct: -0.01 },
        { pnlPct: 0.03 },
      ]);

      // Total: 0.04 > -0.05
      protectionManager.evaluateAfterClose('AAPL', 'AI sell', 0.02);

      const lowProfitLock = insertedRows.find((r) => r.reason === 'low_profit');
      expect(lowProfitLock).toBeUndefined();
    });

    it('does not trigger when disabled', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'protection.cooldownMinutes') return 0;
        if (key === 'protection.stoplossGuard.enabled') return false;
        if (key === 'protection.maxDrawdownLock.enabled') return false;
        if (key === 'protection.lowProfitPair.enabled') return false;
        return undefined;
      });

      protectionManager.evaluateAfterClose('AAPL', 'AI sell', -0.10);

      const lowProfitLock = insertedRows.find((r) => r.reason === 'low_profit');
      expect(lowProfitLock).toBeUndefined();
    });
  });

  describe('evaluateAfterClose - error handling', () => {
    it('does not throw when DB access fails', () => {
      mockSelect.mockImplementationOnce(() => {
        throw new Error('DB error');
      });

      expect(() => {
        protectionManager.evaluateAfterClose('AAPL', 'stoploss', -0.05);
      }).not.toThrow();
    });
  });

  describe('getProtectionManager (singleton)', () => {
    it('returns a ProtectionManager instance', () => {
      const instance = getProtectionManager();
      expect(instance).toBeInstanceOf(ProtectionManager);
    });

    it('returns the same instance on subsequent calls', () => {
      const first = getProtectionManager();
      const second = getProtectionManager();
      expect(first).toBe(second);
    });
  });
});

describe('RiskGuard integration with pair locks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResultsQueue = [];

    mockConfigGet.mockImplementation((key: string) => {
      const defaults: Record<string, unknown> = {
        'risk.maxPositions': 5,
        'risk.maxPositionSizePct': 0.15,
        'risk.maxRiskPerTradePct': 0.02,
        'risk.maxSectorConcentration': 3,
        'risk.dailyLossLimitPct': 0.05,
        'risk.maxDrawdownAlertPct': 0.10,
        'risk.maxSectorValuePct': 0.35,
      };
      return defaults[key];
    });
  });

  it('rejects trade when pair is locked', async () => {
    const { RiskGuard } = await import('../../src/execution/risk-guard.js');
    const guard = new RiskGuard();

    const futureDate = new Date(Date.now() + 60 * 60_000).toISOString();
    // isPairLocked: symbol locks
    selectResultsQueue.push([
      { symbol: 'AAPL', lockEnd: futureDate, reason: 'cooldown', side: '*', active: true },
    ]);

    const result = guard.validateTrade(
      {
        symbol: 'AAPL',
        side: 'BUY',
        shares: 10,
        price: 150,
        stopLossPct: 0.05,
        positionSizePct: 0.03,
      },
      {
        cashAvailable: 10000,
        portfolioValue: 50000,
        openPositions: 2,
        todayPnl: 0,
        todayPnlPct: 0,
        sectorExposure: {},
        sectorExposureValue: {},
        peakValue: 50000,
      },
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Pair locked');
    expect(result.reason).toContain('cooldown');
  });

  it('allows trade when pair is not locked', async () => {
    const { RiskGuard } = await import('../../src/execution/risk-guard.js');
    const guard = new RiskGuard();

    // isPairLocked: no symbol locks, no global locks
    selectResultsQueue.push([]);
    selectResultsQueue.push([]);

    const result = guard.validateTrade(
      {
        symbol: 'AAPL',
        side: 'BUY',
        shares: 10,
        price: 150,
        stopLossPct: 0.05,
        positionSizePct: 0.03,
      },
      {
        cashAvailable: 10000,
        portfolioValue: 50000,
        openPositions: 2,
        todayPnl: 0,
        todayPnlPct: 0,
        sectorExposure: {},
        sectorExposureValue: {},
        peakValue: 50000,
      },
    );

    expect(result.allowed).toBe(true);
  });

  it('still allows SELL trades even when pair is locked', async () => {
    const { RiskGuard } = await import('../../src/execution/risk-guard.js');
    const guard = new RiskGuard();

    const futureDate = new Date(Date.now() + 60 * 60_000).toISOString();
    // isPairLocked: symbol is locked
    selectResultsQueue.push([
      { symbol: 'AAPL', lockEnd: futureDate, reason: 'cooldown', side: '*', active: true },
    ]);

    const result = guard.validateTrade(
      {
        symbol: 'AAPL',
        side: 'SELL',
        shares: 10,
        price: 150,
        stopLossPct: 0.05,
        positionSizePct: 0.03,
      },
      {
        cashAvailable: 10000,
        portfolioValue: 50000,
        openPositions: 2,
        todayPnl: 0,
        todayPnlPct: 0,
        sectorExposure: {},
        sectorExposureValue: {},
        peakValue: 50000,
      },
    );

    // Pair lock blocks both BUY and SELL currently
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Pair locked');
  });
});
