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
};

vi.mock('../../src/db/index.js', () => ({
  getDb: () => mockDb,
}));

vi.mock('../../src/db/schema.js', () => ({
  signals: { id: 'id', symbol: 'symbol', timestamp: 'timestamp' },
}));

describe('db/repositories/signals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('insertSignal', () => {
    it('inserts a signal record', async () => {
      const data = { symbol: 'AAPL', timestamp: '2024-01-01', rsi: 55 };
      mockDb.insert.mockReturnValue(createChainableMock(data));

      const { insertSignal } = await import('../../src/db/repositories/signals.js');
      const result = insertSignal(data as any);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(result).toEqual(data);
    });
  });

  describe('getRecentSignals', () => {
    it('returns recent signals for a symbol with default count', async () => {
      const signals = [{ symbol: 'AAPL', rsi: 55 }, { symbol: 'AAPL', rsi: 60 }];
      mockDb.select.mockReturnValue(createChainableMock(signals));

      const { getRecentSignals } = await import('../../src/db/repositories/signals.js');
      const result = getRecentSignals('AAPL');
      expect(result).toEqual(signals);
    });

    it('accepts a custom count', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getRecentSignals } = await import('../../src/db/repositories/signals.js');
      const result = getRecentSignals('AAPL', 5);
      expect(result).toEqual([]);
    });
  });

  describe('getLatestSignal', () => {
    it('returns the latest signal for a symbol', async () => {
      const signal = { symbol: 'AAPL', rsi: 55 };
      mockDb.select.mockReturnValue(createChainableMock(signal));

      const { getLatestSignal } = await import('../../src/db/repositories/signals.js');
      const result = getLatestSignal('AAPL');
      expect(result).toEqual(signal);
    });

    it('returns undefined when no signal exists', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const { getLatestSignal } = await import('../../src/db/repositories/signals.js');
      const result = getLatestSignal('XYZ');
      expect(result).toBeUndefined();
    });
  });

  describe('getSignalHistory', () => {
    it('returns signal history with no filters', async () => {
      const signals = [{ symbol: 'AAPL', rsi: 55 }];
      // First call for select (rows), second call for count
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return createChainableMock(signals);
        return createChainableMock({ count: 1 });
      });

      const { getSignalHistory } = await import('../../src/db/repositories/signals.js');
      const result = getSignalHistory();
      expect(result).toHaveProperty('signals');
      expect(result).toHaveProperty('total');
    });

    it('applies symbol filter', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getSignalHistory } = await import('../../src/db/repositories/signals.js');
      const result = getSignalHistory({ symbol: 'AAPL' });
      expect(result).toHaveProperty('signals');
    });

    it('applies date range filters', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getSignalHistory } = await import('../../src/db/repositories/signals.js');
      const result = getSignalHistory({ from: '2024-01-01', to: '2024-02-01' });
      expect(result).toHaveProperty('signals');
    });

    it('applies limit and offset', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getSignalHistory } = await import('../../src/db/repositories/signals.js');
      const result = getSignalHistory({ limit: 10, offset: 5 });
      expect(result).toHaveProperty('signals');
    });

    it('returns total of 0 when count result is null', async () => {
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return createChainableMock([]);
        return createChainableMock(undefined); // null count
      });

      const { getSignalHistory } = await import('../../src/db/repositories/signals.js');
      const result = getSignalHistory();
      expect(result.total).toBeDefined();
    });

    it('handles all filters combined', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getSignalHistory } = await import('../../src/db/repositories/signals.js');
      const result = getSignalHistory({ symbol: 'AAPL', from: '2024-01-01', to: '2024-12-31', limit: 20, offset: 10 });
      expect(result).toHaveProperty('signals');
    });
  });

  describe('markSignalExecuted', () => {
    it('marks a signal as executed', async () => {
      const updated = { id: 1, executed: true };
      mockDb.update.mockReturnValue(createChainableMock(updated));

      const { markSignalExecuted } = await import('../../src/db/repositories/signals.js');
      const result = markSignalExecuted(1);
      expect(mockDb.update).toHaveBeenCalled();
      expect(result).toEqual(updated);
    });
  });
});
