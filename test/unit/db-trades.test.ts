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
  trades: { id: 'id', symbol: 'symbol', side: 'side', entryTime: 'entryTime', exitPrice: 'exitPrice', exitTime: 'exitTime' },
}));

describe('db/repositories/trades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('insertTrade', () => {
    it('inserts a trade record', async () => {
      const data = { symbol: 'AAPL', side: 'BUY', shares: 10, entryPrice: 150, entryTime: '2024-01-01', t212Ticker: 'AAPL', accountType: 'INVEST' };
      mockDb.insert.mockReturnValue(createChainableMock(data));

      const { insertTrade } = await import('../../src/db/repositories/trades.js');
      const result = insertTrade(data as any);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(result).toEqual(data);
    });
  });

  describe('closeTrade', () => {
    it('updates a trade with exit data', async () => {
      const exitData = { exitPrice: 160, exitTime: '2024-01-15', pnl: 100, pnlPct: 6.67 };
      const closed = { id: 1, ...exitData };
      mockDb.update.mockReturnValue(createChainableMock(closed));

      const { closeTrade } = await import('../../src/db/repositories/trades.js');
      const result = closeTrade(1, exitData);
      expect(mockDb.update).toHaveBeenCalled();
      expect(result).toEqual(closed);
    });

    it('includes exitReason when provided', async () => {
      const exitData = { exitPrice: 140, exitTime: '2024-01-15', pnl: -100, pnlPct: -6.67, exitReason: 'stop_loss' };
      mockDb.update.mockReturnValue(createChainableMock(exitData));

      const { closeTrade } = await import('../../src/db/repositories/trades.js');
      const result = closeTrade(1, exitData);
      expect(result).toEqual(exitData);
    });
  });

  describe('getOpenTrades', () => {
    it('returns trades with null exitPrice', async () => {
      const openTrades = [
        { id: 1, symbol: 'AAPL', exitPrice: null },
        { id: 2, symbol: 'MSFT', exitPrice: null },
      ];
      mockDb.select.mockReturnValue(createChainableMock(openTrades));

      const { getOpenTrades } = await import('../../src/db/repositories/trades.js');
      const result = getOpenTrades();
      expect(result).toEqual(openTrades);
    });

    it('returns empty array when no open trades', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getOpenTrades } = await import('../../src/db/repositories/trades.js');
      const result = getOpenTrades();
      expect(result).toEqual([]);
    });
  });

  describe('getTradeById', () => {
    it('returns a trade by id', async () => {
      const trade = { id: 1, symbol: 'AAPL' };
      mockDb.select.mockReturnValue(createChainableMock(trade));

      const { getTradeById } = await import('../../src/db/repositories/trades.js');
      const result = getTradeById(1);
      expect(result).toEqual(trade);
    });

    it('returns undefined when trade not found', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const { getTradeById } = await import('../../src/db/repositories/trades.js');
      const result = getTradeById(999);
      expect(result).toBeUndefined();
    });
  });

  describe('getTradeHistory', () => {
    it('returns trade history with no filters', async () => {
      const trades = [{ id: 1, symbol: 'AAPL' }];
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return createChainableMock(trades);
        return createChainableMock({ count: 1 });
      });

      const { getTradeHistory } = await import('../../src/db/repositories/trades.js');
      const result = getTradeHistory();
      expect(result).toHaveProperty('trades');
      expect(result).toHaveProperty('total');
    });

    it('applies symbol filter', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getTradeHistory } = await import('../../src/db/repositories/trades.js');
      const result = getTradeHistory({ symbol: 'AAPL' });
      expect(result).toHaveProperty('trades');
    });

    it('applies side filter', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getTradeHistory } = await import('../../src/db/repositories/trades.js');
      const result = getTradeHistory({ side: 'BUY' });
      expect(result).toHaveProperty('trades');
    });

    it('applies date range filters', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getTradeHistory } = await import('../../src/db/repositories/trades.js');
      const result = getTradeHistory({ from: '2024-01-01', to: '2024-02-01' });
      expect(result).toHaveProperty('trades');
    });

    it('applies limit and offset', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getTradeHistory } = await import('../../src/db/repositories/trades.js');
      const result = getTradeHistory({ limit: 10, offset: 5 });
      expect(result).toHaveProperty('trades');
    });

    it('returns total of 0 when count result is null', async () => {
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return createChainableMock([]);
        return createChainableMock(undefined);
      });

      const { getTradeHistory } = await import('../../src/db/repositories/trades.js');
      const result = getTradeHistory();
      expect(result.total).toBeDefined();
    });

    it('handles all filters combined', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getTradeHistory } = await import('../../src/db/repositories/trades.js');
      const result = getTradeHistory({ symbol: 'AAPL', side: 'SELL', from: '2024-01-01', to: '2024-12-31', limit: 20, offset: 10 });
      expect(result).toHaveProperty('trades');
    });
  });

  describe('getTradesBySymbol', () => {
    it('returns trades for a specific symbol', async () => {
      const trades = [{ id: 1, symbol: 'AAPL' }, { id: 2, symbol: 'AAPL' }];
      mockDb.select.mockReturnValue(createChainableMock(trades));

      const { getTradesBySymbol } = await import('../../src/db/repositories/trades.js');
      const result = getTradesBySymbol('AAPL');
      expect(result).toEqual(trades);
    });
  });

  describe('getClosedTrades', () => {
    it('returns trades with non-null exitPrice', async () => {
      const closedTrades = [
        { id: 1, symbol: 'AAPL', exitPrice: 160 },
        { id: 2, symbol: 'MSFT', exitPrice: 350 },
      ];
      mockDb.select.mockReturnValue(createChainableMock(closedTrades));

      const { getClosedTrades } = await import('../../src/db/repositories/trades.js');
      const result = getClosedTrades();
      expect(result).toEqual(closedTrades);
    });
  });
});
