import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Create mock database functions
const mockGet = vi.fn();
const mockAll = vi.fn();
const mockRun = vi.fn();
const mockInsertValues = vi.fn().mockReturnValue({ run: mockRun });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
const mockUpdateSet = vi.fn().mockReturnValue({
  where: vi.fn().mockReturnValue({ run: mockRun }),
});
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });
const mockSelectWhere = vi.fn().mockReturnValue({ get: mockGet, all: mockAll });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere, all: mockAll, get: mockGet });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
};

// Mock the database module
vi.mock('../../src/db/index.js', () => ({
  getDb: () => mockDb,
}));

// Mock schema validator
vi.mock('../../src/config/schema-validator.js', () => ({
  validateConfigValue: vi.fn().mockReturnValue({ valid: true }),
}));

// Mock drizzle-orm eq function
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
}));

import { ConfigManager, configManager } from '../../src/config/manager.js';
import { CONFIG_DEFAULTS } from '../../src/config/defaults.js';

describe('ConfigManager', () => {
  let manager: ConfigManager;

  beforeEach(() => {
    manager = new ConfigManager();
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockGet.mockReset();
    mockAll.mockReset();
    mockRun.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('seedDefaults', () => {
    it('inserts defaults that do not exist', async () => {
      mockGet.mockReturnValue(undefined); // No existing rows
      await manager.seedDefaults();
      // Should call insert for each default
      expect(mockInsert).toHaveBeenCalledTimes(CONFIG_DEFAULTS.length);
    });

    it('does not insert defaults that already exist', async () => {
      mockGet.mockReturnValue({ key: 'existing', value: '"test"' }); // Row exists
      await manager.seedDefaults();
      // insert should not be called because all defaults "exist"
      expect(mockInsertValues).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('returns value from database', () => {
      mockGet.mockReturnValue({ key: 'test.key', value: '"hello"' });
      const result = manager.get<string>('test.key');
      expect(result).toBe('hello');
    });

    it('returns cached value on second call', () => {
      mockGet.mockReturnValue({ key: 'test.key', value: '42' });
      vi.setSystemTime(new Date(1000));
      const result1 = manager.get<number>('test.key');
      expect(result1).toBe(42);

      // Clear DB mock to ensure it's not called again
      mockGet.mockReturnValue(undefined);
      vi.setSystemTime(new Date(2000)); // Still within 30s TTL
      const result2 = manager.get<number>('test.key');
      expect(result2).toBe(42);
    });

    it('refreshes cache after TTL expires', () => {
      vi.setSystemTime(new Date(1000));
      mockGet.mockReturnValue({ key: 'test.key', value: '42' });
      manager.get<number>('test.key');

      // Advance past the 30s TTL
      vi.setSystemTime(new Date(32000));
      mockGet.mockReturnValue({ key: 'test.key', value: '99' });
      const result = manager.get<number>('test.key');
      expect(result).toBe(99);
    });

    it('falls back to CONFIG_DEFAULTS when not in database', () => {
      mockGet.mockReturnValue(undefined); // Not in DB
      const result = manager.get<string>('t212.environment');
      expect(result).toBe('demo');
    });

    it('throws Error for unknown config key', () => {
      mockGet.mockReturnValue(undefined);
      expect(() => manager.get('nonexistent.key')).toThrow('Config key not found: nonexistent.key');
    });

    it('returns environment variable override as JSON parsed value', () => {
      vi.stubEnv('RISK_MAX_POSITIONS', '10');
      const result = manager.get<number>('risk.maxPositions');
      expect(result).toBe(10);
    });

    it('returns environment variable override as boolean', () => {
      vi.stubEnv('EXECUTION_DRY_RUN', 'false');
      const result = manager.get<boolean>('execution.dryRun');
      expect(result).toBe(false);
    });

    it('returns environment variable override as raw string when not valid JSON', () => {
      vi.stubEnv('T212_ENVIRONMENT', 'live-override');
      const result = manager.get<string>('t212.environment');
      expect(result).toBe('live-override');
    });

    it('prefers env override over database value', () => {
      vi.stubEnv('T212_ENVIRONMENT', '"from-env"');
      mockGet.mockReturnValue({ key: 't212.environment', value: '"from-db"' });
      const result = manager.get<string>('t212.environment');
      expect(result).toBe('from-env');
    });

    it('prefers env override over cache', () => {
      vi.stubEnv('RISK_MAX_POSITIONS', '20');
      // Populate cache
      mockGet.mockReturnValue({ key: 'risk.maxPositions', value: '5' });
      const result = manager.get<number>('risk.maxPositions');
      expect(result).toBe(20); // env wins
    });
  });

  describe('set', () => {
    it('updates existing config in database', async () => {
      mockGet.mockReturnValue({ key: 'test.key', value: '"old"' });
      await manager.set('test.key', 'new');
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('inserts new config if it does not exist', async () => {
      mockGet.mockReturnValue(undefined); // Does not exist
      await manager.set('custom.key', 'value');
      expect(mockInsert).toHaveBeenCalled();
    });

    it('uses category from defaults if available', async () => {
      mockGet.mockReturnValue(undefined);
      await manager.set('t212.environment', 'live');
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'trading212',
        }),
      );
    });

    it('uses "custom" category for unknown keys', async () => {
      mockGet.mockReturnValue(undefined);
      await manager.set('unknown.new.key', 'val');
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'custom',
          description: '',
        }),
      );
    });

    it('invalidates cache for the key after set', async () => {
      // Populate cache
      vi.setSystemTime(new Date(1000));
      mockGet.mockReturnValue({ key: 'test.key', value: '"cached"' });
      manager.get('test.key'); // populates cache

      // Now set a new value
      mockGet.mockReturnValue({ key: 'test.key', value: '"cached"' }); // for the set's select
      await manager.set('test.key', 'updated');

      // Next get should hit DB again
      mockGet.mockReturnValue({ key: 'test.key', value: '"updated"' });
      const result = manager.get('test.key');
      expect(result).toBe('updated');
    });

    it('serializes the value as JSON', async () => {
      mockGet.mockReturnValue({ key: 'test.arr', value: '[]' });
      await manager.set('test.arr', [1, 2, 3]);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          value: '[1,2,3]',
        }),
      );
    });
  });

  describe('getAll', () => {
    it('returns all config as a record', () => {
      mockAll.mockReturnValue([
        { key: 'a', value: '"hello"' },
        { key: 'b', value: '42' },
        { key: 'c', value: 'true' },
      ]);
      const result = manager.getAll();
      expect(result).toEqual({
        a: 'hello',
        b: 42,
        c: true,
      });
    });

    it('returns empty object when no rows', () => {
      mockAll.mockReturnValue([]);
      const result = manager.getAll();
      expect(result).toEqual({});
    });
  });

  describe('getByCategory', () => {
    it('returns config filtered by category', () => {
      mockAll.mockReturnValue([
        { key: 'risk.maxPositions', value: '5' },
        { key: 'risk.maxDrawdownAlertPct', value: '0.10' },
      ]);
      const result = manager.getByCategory('risk');
      expect(result).toEqual({
        'risk.maxPositions': 5,
        'risk.maxDrawdownAlertPct': 0.10,
      });
    });

    it('returns empty object for unknown category', () => {
      mockAll.mockReturnValue([]);
      const result = manager.getByCategory('nonexistent');
      expect(result).toEqual({});
    });
  });

  describe('getAllRaw', () => {
    it('returns raw rows from database', () => {
      const rows = [
        { key: 'a', value: '"hello"', category: 'test', description: 'desc' },
      ];
      mockAll.mockReturnValue(rows);
      const result = manager.getAllRaw();
      expect(result).toEqual(rows);
    });
  });

  describe('invalidateCache', () => {
    it('invalidates a specific key', () => {
      vi.setSystemTime(new Date(1000));
      mockGet.mockReturnValue({ key: 'test.key', value: '"cached"' });
      manager.get('test.key');

      manager.invalidateCache('test.key');

      // Next get should hit DB again
      mockGet.mockReturnValue({ key: 'test.key', value: '"fresh"' });
      const result = manager.get('test.key');
      expect(result).toBe('fresh');
    });

    it('invalidates all cache when no key provided', () => {
      vi.setSystemTime(new Date(1000));
      mockGet.mockReturnValueOnce({ key: 'a', value: '"val1"' });
      manager.get('a');
      mockGet.mockReturnValueOnce({ key: 'b', value: '"val2"' });
      manager.get('b');

      manager.invalidateCache(); // Clear all

      // Both keys should be re-fetched
      mockGet.mockReturnValueOnce({ key: 'a', value: '"new1"' });
      expect(manager.get('a')).toBe('new1');
      mockGet.mockReturnValueOnce({ key: 'b', value: '"new2"' });
      expect(manager.get('b')).toBe('new2');
    });
  });

  describe('configKeyToEnvVar (tested via get with env overrides)', () => {
    it('converts simple dotted key', () => {
      vi.stubEnv('T212_ENVIRONMENT', '"test"');
      const result = manager.get<string>('t212.environment');
      expect(result).toBe('test');
    });

    it('converts camelCase to UPPER_SNAKE_CASE', () => {
      vi.stubEnv('RISK_MAX_POSITIONS', '10');
      const result = manager.get<number>('risk.maxPositions');
      expect(result).toBe(10);
    });

    it('converts deeply nested camelCase key', () => {
      vi.stubEnv('AI_OPENAI_COMPAT_BASE_URL', '"http://test:1234"');
      const result = manager.get<string>('ai.openaiCompat.baseUrl');
      expect(result).toBe('http://test:1234');
    });

    it('converts multi-word camelCase', () => {
      vi.stubEnv('PAIRLIST_VOLUME_MIN_AVG_DAILY_VOLUME', '1000000');
      const result = manager.get<number>('pairlist.volume.minAvgDailyVolume');
      expect(result).toBe(1000000);
    });
  });

  describe('getEnvOverride (tested via get)', () => {
    it('returns undefined when env var is not set', () => {
      // Ensure the env var is not set
      delete process.env.T212_ENVIRONMENT;
      mockGet.mockReturnValue({ key: 't212.environment', value: '"demo"' });
      const result = manager.get<string>('t212.environment');
      expect(result).toBe('demo');
    });

    it('parses valid JSON values from env', () => {
      vi.stubEnv('PAIRLIST_FILTERS', '["a","b"]');
      const result = manager.get<string[]>('pairlist.filters');
      expect(result).toEqual(['a', 'b']);
    });

    it('returns raw string when env value is not valid JSON', () => {
      vi.stubEnv('T212_ENVIRONMENT', 'not-json-value');
      const result = manager.get<string>('t212.environment');
      expect(result).toBe('not-json-value');
    });
  });

  describe('configManager singleton', () => {
    it('exports a singleton instance', () => {
      expect(configManager).toBeInstanceOf(ConfigManager);
    });
  });
});
