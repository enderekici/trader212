import { describe, expect, it, vi, beforeEach } from 'vitest';

// Build a chainable mock for drizzle query builder
function createChainableMock(terminalValue?: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (prop === 'then' || prop === 'catch') return undefined;
      if (!chain[prop]) {
        chain[prop] = vi.fn((..._args: unknown[]) => {
          if (prop === 'get') return terminalValue;
          if (prop === 'all') return terminalValue;
          if (prop === 'run') return terminalValue;
          return new Proxy({}, handler);
        });
      }
      return chain[prop];
    },
  };
  return new Proxy({}, handler);
}

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../src/db/index.js', () => ({
  getDb: () => mockDb,
}));

vi.mock('../../src/db/schema.js', () => ({
  config: { key: 'key', value: 'value', category: 'category', description: 'description' },
}));

describe('db/repositories/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getConfig', () => {
    it('returns parsed config when row exists', async () => {
      const row = { key: 'test.key', value: '{"foo":"bar"}', category: 'test', description: 'desc' };
      mockDb.select.mockReturnValue(createChainableMock(row));

      const { getConfig } = await import('../../src/db/repositories/config.js');
      const result = getConfig('test.key');
      expect(result).toEqual({ ...row, value: { foo: 'bar' } });
    });

    it('returns undefined when row does not exist', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const { getConfig } = await import('../../src/db/repositories/config.js');
      const result = getConfig('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('setConfig', () => {
    it('updates existing config row', async () => {
      const existing = { key: 'k', value: '"old"', category: 'c' };
      mockDb.select.mockReturnValue(createChainableMock(existing));
      const updated = { key: 'k', value: '"new"', category: 'c' };
      mockDb.update.mockReturnValue(createChainableMock(updated));

      const { setConfig } = await import('../../src/db/repositories/config.js');
      const result = setConfig('k', 'new');
      expect(mockDb.update).toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it('inserts new config row when key does not exist', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));
      const inserted = { key: 'new.key', value: '"val"', category: 'custom' };
      mockDb.insert.mockReturnValue(createChainableMock(inserted));

      const { setConfig } = await import('../../src/db/repositories/config.js');
      const result = setConfig('new.key', 'val');
      expect(mockDb.insert).toHaveBeenCalled();
      expect(result).toEqual(inserted);
    });

    it('uses provided category and description for new keys', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));
      mockDb.insert.mockReturnValue(createChainableMock({ key: 'k' }));

      const { setConfig } = await import('../../src/db/repositories/config.js');
      setConfig('k', 'v', 'mycat', 'mydesc');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('defaults category to "custom" and description to null when not provided', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));
      mockDb.insert.mockReturnValue(createChainableMock({ key: 'k' }));

      const { setConfig } = await import('../../src/db/repositories/config.js');
      setConfig('k', 'v');
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('getAllConfig', () => {
    it('returns all config rows with parsed values', async () => {
      const rows = [
        { key: 'a', value: '1', category: 'c1', description: null },
        { key: 'b', value: '"hello"', category: 'c2', description: 'desc' },
      ];
      mockDb.select.mockReturnValue(createChainableMock(rows));

      const { getAllConfig } = await import('../../src/db/repositories/config.js');
      const result = getAllConfig();
      expect(result).toEqual([
        { key: 'a', value: 1, category: 'c1', description: null },
        { key: 'b', value: 'hello', category: 'c2', description: 'desc' },
      ]);
    });

    it('returns empty array when no config exists', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getAllConfig } = await import('../../src/db/repositories/config.js');
      const result = getAllConfig();
      expect(result).toEqual([]);
    });
  });

  describe('getConfigByCategory', () => {
    it('returns config rows filtered by category with parsed values', async () => {
      const rows = [{ key: 'a', value: 'true', category: 'risk', description: null }];
      mockDb.select.mockReturnValue(createChainableMock(rows));

      const { getConfigByCategory } = await import('../../src/db/repositories/config.js');
      const result = getConfigByCategory('risk');
      expect(result).toEqual([{ key: 'a', value: true, category: 'risk', description: null }]);
    });
  });

  describe('deleteConfig', () => {
    it('calls delete on the config table', async () => {
      mockDb.delete.mockReturnValue(createChainableMock({ changes: 1 }));

      const { deleteConfig } = await import('../../src/db/repositories/config.js');
      const result = deleteConfig('someKey');
      expect(mockDb.delete).toHaveBeenCalled();
      expect(result).toEqual({ changes: 1 });
    });
  });
});
