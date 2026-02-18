import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────

const mockRun = vi.fn(() => ({ changes: 1 }));
const mockGet = vi.fn();
const mockAll = vi.fn(() => []);
const mockReturning = vi.fn(() => ({ get: mockGet }));

function chain() {
  const proxy: Record<string, unknown> = {};
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      if (prop === 'then' || prop === 'catch') return undefined;
      if (prop === 'run') return mockRun;
      if (prop === 'all') return mockAll;
      if (prop === 'returning') return mockReturning;
      if (!(prop in proxy)) {
        proxy[prop] = vi.fn(() => new Proxy({}, handler));
      }
      return proxy[prop];
    },
  };
  return new Proxy({}, handler);
}

const mockDb = {
  select: vi.fn(() => chain()),
  insert: vi.fn(() => chain()),
  delete: vi.fn(() => chain()),
};

vi.mock('../../src/db/index.js', () => ({
  getDb: () => mockDb,
}));

vi.mock('../../src/db/schema.js', () => ({
  researchWatchlist: {
    id: 'id',
    symbol: 'symbol',
    notes: 'notes',
    addedAt: 'addedAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: unknown) => ({ col, val })),
}));

// ── Tests ────────────────────────────────────────────────────────────────

describe('ResearchWatchlistRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module cache so singleton is re-created per test
    vi.resetModules();
  });

  describe('getAll()', () => {
    it('returns empty array when no entries exist', async () => {
      mockAll.mockReturnValue([]);
      mockDb.select.mockReturnValue(chain());

      const { ResearchWatchlistRepository } = await import(
        '../../src/db/repositories/research-watchlist.js'
      );
      const repo = new ResearchWatchlistRepository();
      const result = repo.getAll();
      expect(result).toEqual([]);
    });

    it('maps db rows to WatchlistEntry objects', async () => {
      const rows = [
        { id: 1, symbol: 'AAPL', notes: 'test note', addedAt: '2024-01-01T00:00:00.000Z' },
        { id: 2, symbol: 'MSFT', notes: null, addedAt: '2024-01-02T00:00:00.000Z' },
      ];
      mockAll.mockReturnValue(rows);

      const { ResearchWatchlistRepository } = await import(
        '../../src/db/repositories/research-watchlist.js'
      );
      const repo = new ResearchWatchlistRepository();
      const result = repo.getAll();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 1,
        symbol: 'AAPL',
        notes: 'test note',
        addedAt: '2024-01-01T00:00:00.000Z',
      });
      expect(result[1]).toEqual({
        id: 2,
        symbol: 'MSFT',
        notes: null,
        addedAt: '2024-01-02T00:00:00.000Z',
      });
    });

    it('converts undefined notes to null', async () => {
      const rows = [{ id: 3, symbol: 'TSLA', notes: undefined, addedAt: '2024-01-03T00:00:00.000Z' }];
      mockAll.mockReturnValue(rows);

      const { ResearchWatchlistRepository } = await import(
        '../../src/db/repositories/research-watchlist.js'
      );
      const repo = new ResearchWatchlistRepository();
      const [entry] = repo.getAll();
      expect(entry.notes).toBeNull();
    });
  });

  describe('add()', () => {
    it('inserts a new entry and returns it', async () => {
      const insertedRow = { id: 10, symbol: 'NVDA', notes: 'strong momentum', addedAt: '2024-01-10T00:00:00.000Z' };
      mockGet.mockReturnValue(insertedRow);

      const { ResearchWatchlistRepository } = await import(
        '../../src/db/repositories/research-watchlist.js'
      );
      const repo = new ResearchWatchlistRepository();
      const result = repo.add('NVDA', 'strong momentum');

      expect(result).toEqual({
        id: 10,
        symbol: 'NVDA',
        notes: 'strong momentum',
        addedAt: '2024-01-10T00:00:00.000Z',
      });
    });

    it('converts symbol to uppercase', async () => {
      const insertedRow = { id: 11, symbol: 'AAPL', notes: null, addedAt: '2024-01-11T00:00:00.000Z' };
      mockGet.mockReturnValue(insertedRow);

      const { ResearchWatchlistRepository } = await import(
        '../../src/db/repositories/research-watchlist.js'
      );
      const repo = new ResearchWatchlistRepository();
      const result = repo.add('aapl');
      expect(result.symbol).toBe('AAPL');
    });

    it('handles null notes when not provided', async () => {
      const insertedRow = { id: 12, symbol: 'GOOG', notes: null, addedAt: '2024-01-12T00:00:00.000Z' };
      mockGet.mockReturnValue(insertedRow);

      const { ResearchWatchlistRepository } = await import(
        '../../src/db/repositories/research-watchlist.js'
      );
      const repo = new ResearchWatchlistRepository();
      const result = repo.add('GOOG');
      expect(result.notes).toBeNull();
    });
  });

  describe('remove()', () => {
    it('returns true when symbol was deleted', async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const { ResearchWatchlistRepository } = await import(
        '../../src/db/repositories/research-watchlist.js'
      );
      const repo = new ResearchWatchlistRepository();
      const result = repo.remove('AAPL');
      expect(result).toBe(true);
    });

    it('returns false when symbol was not found', async () => {
      mockRun.mockReturnValue({ changes: 0 });

      const { ResearchWatchlistRepository } = await import(
        '../../src/db/repositories/research-watchlist.js'
      );
      const repo = new ResearchWatchlistRepository();
      const result = repo.remove('NOTEXIST');
      expect(result).toBe(false);
    });
  });

  describe('getResearchWatchlistRepo()', () => {
    it('returns a singleton instance', async () => {
      const { getResearchWatchlistRepo } = await import(
        '../../src/db/repositories/research-watchlist.js'
      );
      const a = getResearchWatchlistRepo();
      const b = getResearchWatchlistRepo();
      expect(a).toBe(b);
    });
  });
});
