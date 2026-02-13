import { describe, expect, it, vi, beforeEach } from 'vitest';

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
  positions: { symbol: 'symbol' },
}));

describe('db/repositories/positions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('upsertPosition', () => {
    it('updates an existing position', async () => {
      const existing = { symbol: 'AAPL', shares: 10 };
      const updated = { symbol: 'AAPL', shares: 15 };
      mockDb.select.mockReturnValue(createChainableMock(existing));
      mockDb.update.mockReturnValue(createChainableMock(updated));

      const { upsertPosition } = await import('../../src/db/repositories/positions.js');
      const result = upsertPosition({ symbol: 'AAPL', shares: 15, t212Ticker: 'AAPL', entryPrice: 100, entryTime: '2024-01-01', accountType: 'INVEST' } as any);
      expect(mockDb.update).toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it('inserts a new position when symbol does not exist', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));
      const inserted = { symbol: 'MSFT', shares: 20 };
      mockDb.insert.mockReturnValue(createChainableMock(inserted));

      const { upsertPosition } = await import('../../src/db/repositories/positions.js');
      const result = upsertPosition({ symbol: 'MSFT', shares: 20, t212Ticker: 'MSFT', entryPrice: 300, entryTime: '2024-01-01', accountType: 'INVEST' } as any);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(result).toEqual(inserted);
    });
  });

  describe('updatePosition', () => {
    it('updates a position by symbol', async () => {
      const updated = { symbol: 'AAPL', currentPrice: 160 };
      mockDb.update.mockReturnValue(createChainableMock(updated));

      const { updatePosition } = await import('../../src/db/repositories/positions.js');
      const result = updatePosition('AAPL', { currentPrice: 160 });
      expect(mockDb.update).toHaveBeenCalled();
      expect(result).toEqual(updated);
    });
  });

  describe('removePosition', () => {
    it('deletes a position by symbol', async () => {
      mockDb.delete.mockReturnValue(createChainableMock({ changes: 1 }));

      const { removePosition } = await import('../../src/db/repositories/positions.js');
      const result = removePosition('AAPL');
      expect(mockDb.delete).toHaveBeenCalled();
      expect(result).toEqual({ changes: 1 });
    });
  });

  describe('getAllPositions', () => {
    it('returns all positions', async () => {
      const positions = [
        { symbol: 'AAPL', shares: 10 },
        { symbol: 'MSFT', shares: 20 },
      ];
      mockDb.select.mockReturnValue(createChainableMock(positions));

      const { getAllPositions } = await import('../../src/db/repositories/positions.js');
      const result = getAllPositions();
      expect(result).toEqual(positions);
    });

    it('returns empty array when no positions exist', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getAllPositions } = await import('../../src/db/repositories/positions.js');
      const result = getAllPositions();
      expect(result).toEqual([]);
    });
  });

  describe('getPosition', () => {
    it('returns a position by symbol', async () => {
      const pos = { symbol: 'AAPL', shares: 10 };
      mockDb.select.mockReturnValue(createChainableMock(pos));

      const { getPosition } = await import('../../src/db/repositories/positions.js');
      const result = getPosition('AAPL');
      expect(result).toEqual(pos);
    });

    it('returns undefined when position not found', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const { getPosition } = await import('../../src/db/repositories/positions.js');
      const result = getPosition('XYZ');
      expect(result).toBeUndefined();
    });
  });
});
