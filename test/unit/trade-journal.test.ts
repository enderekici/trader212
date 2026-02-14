import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';

// Mock dependencies
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../src/db/index.js', () => ({
  getDb: vi.fn(),
}));

// Import after mocks
import * as journalRepo from '../../src/db/repositories/journal.js';
import {
  TradeJournalManager,
  getTradeJournalManager,
} from '../../src/monitoring/trade-journal.js';
import { getDb } from '../../src/db/index.js';

// Mock database responses
const mockDb = {
  insert: vi.fn(),
  select: vi.fn(),
  delete: vi.fn(),
};

const createMockDbChain = (returnValue: unknown) => ({
  values: vi.fn().mockReturnValue({
    returning: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(returnValue),
    }),
  }),
});

const createMockSelectChain = (returnValue: unknown) => ({
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  all: vi.fn().mockReturnValue(returnValue),
  get: vi.fn().mockReturnValue(returnValue),
});

describe('Journal Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDb as Mock).mockReturnValue(mockDb);
  });

  describe('addJournalEntry', () => {
    it('should add a journal entry with all fields', () => {
      const mockEntry = {
        id: 1,
        tradeId: 100,
        positionId: 50,
        symbol: 'AAPL',
        note: 'Test note',
        tags: JSON.stringify(['tag1', 'tag2']),
        createdAt: new Date().toISOString(),
      };

      mockDb.insert.mockReturnValue(createMockDbChain(mockEntry));

      const result = journalRepo.addJournalEntry({
        tradeId: 100,
        positionId: 50,
        symbol: 'AAPL',
        note: 'Test note',
        tags: ['tag1', 'tag2'],
      });

      expect(result.id).toBe(1);
      expect(result.symbol).toBe('AAPL');
      expect(result.tags).toEqual(['tag1', 'tag2']);
    });

    it('should add entry without optional fields', () => {
      const mockEntry = {
        id: 2,
        tradeId: null,
        positionId: null,
        symbol: 'TSLA',
        note: 'Simple note',
        tags: null,
        createdAt: new Date().toISOString(),
      };

      mockDb.insert.mockReturnValue(createMockDbChain(mockEntry));

      const result = journalRepo.addJournalEntry({
        symbol: 'TSLA',
        note: 'Simple note',
      });

      expect(result.tradeId).toBeNull();
      expect(result.positionId).toBeNull();
      expect(result.tags).toBeNull();
    });

    it('should handle special characters in note', () => {
      const mockEntry = {
        id: 3,
        tradeId: null,
        positionId: null,
        symbol: 'MSFT',
        note: 'Note with "quotes" and \\backslashes',
        tags: null,
        createdAt: new Date().toISOString(),
      };

      mockDb.insert.mockReturnValue(createMockDbChain(mockEntry));

      const result = journalRepo.addJournalEntry({
        symbol: 'MSFT',
        note: 'Note with "quotes" and \\backslashes',
      });

      expect(result.note).toBe('Note with "quotes" and \\backslashes');
    });
  });

  describe('getEntriesForTrade', () => {
    it('should return entries for a specific trade', () => {
      const mockEntries = [
        {
          id: 1,
          tradeId: 100,
          positionId: 50,
          symbol: 'AAPL',
          note: 'Entry 1',
          tags: JSON.stringify(['tag1']),
          createdAt: '2024-01-01T10:00:00Z',
        },
        {
          id: 2,
          tradeId: 100,
          positionId: 50,
          symbol: 'AAPL',
          note: 'Entry 2',
          tags: JSON.stringify(['tag2']),
          createdAt: '2024-01-01T11:00:00Z',
        },
      ];

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const results = journalRepo.getEntriesForTrade(100);

      expect(results).toHaveLength(2);
      expect(results[0].tags).toEqual(['tag1']);
      expect(results[1].tags).toEqual(['tag2']);
    });

    it('should return empty array for trade with no entries', () => {
      mockDb.select.mockReturnValue(createMockSelectChain([]));

      const results = journalRepo.getEntriesForTrade(999);

      expect(results).toHaveLength(0);
    });
  });

  describe('getEntriesForSymbol', () => {
    it('should return entries for a symbol with default limit', () => {
      const mockEntries = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        tradeId: null,
        positionId: null,
        symbol: 'AAPL',
        note: `Note ${i + 1}`,
        tags: null,
        createdAt: new Date().toISOString(),
      }));

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const results = journalRepo.getEntriesForSymbol('AAPL');

      expect(results).toHaveLength(50);
    });

    it('should respect custom limit', () => {
      const mockEntries = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        tradeId: null,
        positionId: null,
        symbol: 'TSLA',
        note: `Note ${i + 1}`,
        tags: null,
        createdAt: new Date().toISOString(),
      }));

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const results = journalRepo.getEntriesForSymbol('TSLA', 10);

      expect(results).toHaveLength(10);
    });
  });

  describe('getRecentEntries', () => {
    it('should return recent entries with default limit', () => {
      const mockEntries = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        tradeId: null,
        positionId: null,
        symbol: 'AAPL',
        note: `Note ${i + 1}`,
        tags: null,
        createdAt: new Date().toISOString(),
      }));

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const results = journalRepo.getRecentEntries();

      expect(results).toHaveLength(100);
    });

    it('should respect custom limit', () => {
      const mockEntries = Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        tradeId: null,
        positionId: null,
        symbol: 'AAPL',
        note: `Note ${i + 1}`,
        tags: null,
        createdAt: new Date().toISOString(),
      }));

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const results = journalRepo.getRecentEntries(25);

      expect(results).toHaveLength(25);
    });
  });

  describe('searchEntries', () => {
    it('should find entries matching search query', () => {
      const mockEntries = [
        {
          id: 1,
          tradeId: null,
          positionId: null,
          symbol: 'AAPL',
          note: 'Earnings beat expectations',
          tags: null,
          createdAt: new Date().toISOString(),
        },
        {
          id: 2,
          tradeId: null,
          positionId: null,
          symbol: 'TSLA',
          note: 'Strong earnings report',
          tags: null,
          createdAt: new Date().toISOString(),
        },
      ];

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const results = journalRepo.searchEntries('earnings');

      expect(results).toHaveLength(2);
    });

    it('should return empty array for no matches', () => {
      mockDb.select.mockReturnValue(createMockSelectChain([]));

      const results = journalRepo.searchEntries('nonexistent');

      expect(results).toHaveLength(0);
    });
  });

  describe('getEntriesByTag', () => {
    it('should find entries with specific tag', () => {
      const mockEntries = [
        {
          id: 1,
          tradeId: null,
          positionId: null,
          symbol: 'AAPL',
          note: 'Entry with winner tag',
          tags: JSON.stringify(['winner', 'exit']),
          createdAt: new Date().toISOString(),
        },
        {
          id: 2,
          tradeId: null,
          positionId: null,
          symbol: 'TSLA',
          note: 'Another winner',
          tags: JSON.stringify(['winner', 'take_profit']),
          createdAt: new Date().toISOString(),
        },
      ];

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const results = journalRepo.getEntriesByTag('winner');

      expect(results).toHaveLength(2);
      expect(results[0].tags).toContain('winner');
    });

    it('should return empty array if tag not found', () => {
      mockDb.select.mockReturnValue(createMockSelectChain([]));

      const results = journalRepo.getEntriesByTag('nonexistent');

      expect(results).toHaveLength(0);
    });
  });

  describe('deleteEntry', () => {
    it('should delete an entry and return true', () => {
      mockDb.delete.mockReturnValue({
        where: vi.fn().mockReturnValue({
          run: vi.fn(),
        }),
      });

      const result = journalRepo.deleteEntry(1);

      expect(result).toBe(true);
    });

    it('should return false on error', () => {
      mockDb.delete.mockReturnValue({
        where: vi.fn().mockReturnValue({
          run: vi.fn().mockImplementation(() => {
            throw new Error('Delete failed');
          }),
        }),
      });

      const result = journalRepo.deleteEntry(999);

      expect(result).toBe(false);
    });
  });

  describe('getTagSummary', () => {
    it('should return tag frequency counts', () => {
      const mockEntries = [
        {
          id: 1,
          tradeId: null,
          positionId: null,
          symbol: 'AAPL',
          note: 'Note 1',
          tags: JSON.stringify(['winner', 'exit']),
          createdAt: new Date().toISOString(),
        },
        {
          id: 2,
          tradeId: null,
          positionId: null,
          symbol: 'TSLA',
          note: 'Note 2',
          tags: JSON.stringify(['winner', 'take_profit']),
          createdAt: new Date().toISOString(),
        },
        {
          id: 3,
          tradeId: null,
          positionId: null,
          symbol: 'MSFT',
          note: 'Note 3',
          tags: JSON.stringify(['loser', 'exit']),
          createdAt: new Date().toISOString(),
        },
      ];

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const results = journalRepo.getTagSummary();

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('tag');
      expect(results[0]).toHaveProperty('count');
    });

    it('should handle entries with no tags', () => {
      const mockEntries = [
        {
          id: 1,
          tradeId: null,
          positionId: null,
          symbol: 'AAPL',
          note: 'Note 1',
          tags: null,
          createdAt: new Date().toISOString(),
        },
      ];

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const results = journalRepo.getTagSummary();

      expect(results).toHaveLength(0);
    });

    it('should handle invalid JSON in tags', () => {
      const mockEntries = [
        {
          id: 1,
          tradeId: null,
          positionId: null,
          symbol: 'AAPL',
          note: 'Note 1',
          tags: 'invalid json',
          createdAt: new Date().toISOString(),
        },
      ];

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const results = journalRepo.getTagSummary();

      expect(results).toHaveLength(0);
    });
  });
});

describe('TradeJournalManager', () => {
  let manager: TradeJournalManager;

  beforeEach(() => {
    vi.clearAllMocks();
    (getDb as Mock).mockReturnValue(mockDb);
    manager = new TradeJournalManager();
  });

  describe('addNote', () => {
    it('should add a manual note', () => {
      const mockEntry = {
        id: 1,
        tradeId: null,
        positionId: null,
        symbol: 'AAPL',
        note: 'Manual observation',
        tags: null,
        createdAt: new Date().toISOString(),
      };

      mockDb.insert.mockReturnValue(createMockDbChain(mockEntry));

      const result = manager.addNote('AAPL', 'Manual observation');

      expect(result.symbol).toBe('AAPL');
      expect(result.note).toBe('Manual observation');
    });

    it('should add note with options', () => {
      const mockEntry = {
        id: 2,
        tradeId: 100,
        positionId: 50,
        symbol: 'TSLA',
        note: 'Note with options',
        tags: JSON.stringify(['custom']),
        createdAt: new Date().toISOString(),
      };

      mockDb.insert.mockReturnValue(createMockDbChain(mockEntry));

      const result = manager.addNote('TSLA', 'Note with options', {
        tradeId: 100,
        positionId: 50,
        tags: ['custom'],
      });

      expect(result.tradeId).toBe(100);
      expect(result.positionId).toBe(50);
      expect(result.tags).toEqual(['custom']);
    });
  });

  describe('autoAnnotate', () => {
    it('should auto-annotate trade_open event', () => {
      const mockEntry = {
        id: 1,
        tradeId: 100,
        positionId: null,
        symbol: 'AAPL',
        note: 'Opened LONG position: 100 shares @ $150\nReasoning: Strong fundamentals',
        tags: JSON.stringify(['trade_open', 'entry']),
        createdAt: new Date().toISOString(),
      };

      mockDb.insert.mockReturnValue(createMockDbChain(mockEntry));

      const result = manager.autoAnnotate('AAPL', 'trade_open', {
        tradeId: 100,
        side: 'LONG',
        quantity: 100,
        price: 150,
        reasoning: 'Strong fundamentals',
      });

      expect(result.note).toContain('Opened LONG position');
      expect(result.tags).toContain('trade_open');
      expect(result.tags).toContain('entry');
    });

    it('should auto-annotate trade_close event with profit', () => {
      const mockEntry = {
        id: 2,
        tradeId: 100,
        positionId: null,
        symbol: 'AAPL',
        note: 'Closed LONG position: 100 shares @ $160\nP&L: $1000 (6.67%)\nReason: Target reached',
        tags: JSON.stringify(['trade_close', 'exit', 'winner']),
        createdAt: new Date().toISOString(),
      };

      mockDb.insert.mockReturnValue(createMockDbChain(mockEntry));

      const result = manager.autoAnnotate('AAPL', 'trade_close', {
        tradeId: 100,
        side: 'LONG',
        quantity: 100,
        price: 160,
        pnl: 1000,
        pnlPercent: 6.67,
        reason: 'Target reached',
      });

      expect(result.note).toContain('Closed LONG position');
      expect(result.tags).toContain('winner');
    });

    it('should auto-annotate trade_close event with loss', () => {
      const mockEntry = {
        id: 3,
        tradeId: 101,
        positionId: null,
        symbol: 'TSLA',
        note: 'Closed LONG position: 50 shares @ $200\nP&L: -$500 (-5%)',
        tags: JSON.stringify(['trade_close', 'exit', 'loser']),
        createdAt: new Date().toISOString(),
      };

      mockDb.insert.mockReturnValue(createMockDbChain(mockEntry));

      const result = manager.autoAnnotate('TSLA', 'trade_close', {
        tradeId: 101,
        side: 'LONG',
        quantity: 50,
        price: 200,
        pnl: -500,
        pnlPercent: -5,
      });

      expect(result.tags).toContain('loser');
    });

    it('should auto-annotate stop_loss event', () => {
      const mockEntry = {
        id: 4,
        tradeId: 102,
        positionId: null,
        symbol: 'MSFT',
        note: 'Stop-loss triggered @ $300\nLoss: -$200 (-2%)',
        tags: JSON.stringify(['stop_loss', 'exit', 'risk_management', 'loser']),
        createdAt: new Date().toISOString(),
      };

      mockDb.insert.mockReturnValue(createMockDbChain(mockEntry));

      const result = manager.autoAnnotate('MSFT', 'stop_loss', {
        tradeId: 102,
        price: 300,
        loss: -200,
        lossPercent: -2,
      });

      expect(result.note).toContain('Stop-loss triggered');
      expect(result.tags).toContain('risk_management');
    });

    it('should auto-annotate take_profit event', () => {
      const mockEntry = {
        id: 5,
        tradeId: 103,
        positionId: null,
        symbol: 'GOOGL',
        note: 'Take-profit hit @ $140\nProfit: $800 (8%)',
        tags: JSON.stringify(['take_profit', 'exit', 'target_hit', 'winner']),
        createdAt: new Date().toISOString(),
      };

      mockDb.insert.mockReturnValue(createMockDbChain(mockEntry));

      const result = manager.autoAnnotate('GOOGL', 'take_profit', {
        tradeId: 103,
        price: 140,
        profit: 800,
        profitPercent: 8,
      });

      expect(result.note).toContain('Take-profit hit');
      expect(result.tags).toContain('target_hit');
    });

    it('should auto-annotate dca event', () => {
      const mockEntry = {
        id: 6,
        tradeId: 104,
        positionId: null,
        symbol: 'NVDA',
        note: 'DCA round 2: added 50 shares @ $400\nNew avg: $425',
        tags: JSON.stringify(['dca', 'position_sizing', 'averaging_down']),
        createdAt: new Date().toISOString(),
      };

      mockDb.insert.mockReturnValue(createMockDbChain(mockEntry));

      const result = manager.autoAnnotate('NVDA', 'dca', {
        tradeId: 104,
        round: 2,
        quantity: 50,
        price: 400,
        avgPrice: 425,
      });

      expect(result.note).toContain('DCA round 2');
      expect(result.tags).toContain('averaging_down');
    });

    it('should auto-annotate partial_exit event', () => {
      const mockEntry = {
        id: 7,
        tradeId: 105,
        positionId: null,
        symbol: 'AMD',
        note: 'Partial exit: sold 25 shares @ $100\nRemaining: 75 shares\nP&L on exit: $250',
        tags: JSON.stringify(['partial_exit', 'exit', 'partial']),
        createdAt: new Date().toISOString(),
      };

      mockDb.insert.mockReturnValue(createMockDbChain(mockEntry));

      const result = manager.autoAnnotate('AMD', 'partial_exit', {
        tradeId: 105,
        quantity: 25,
        price: 100,
        remaining: 75,
        pnl: 250,
      });

      expect(result.note).toContain('Partial exit');
      expect(result.tags).toContain('partial');
    });

    it('should auto-annotate regime_change event', () => {
      const mockEntry = {
        id: 8,
        tradeId: null,
        positionId: null,
        symbol: 'SPY',
        note: 'Market regime change detected: bullish → bearish\nIndicator: VIX spike',
        tags: JSON.stringify(['regime_change', 'market_regime', 'macro']),
        createdAt: new Date().toISOString(),
      };

      mockDb.insert.mockReturnValue(createMockDbChain(mockEntry));

      const result = manager.autoAnnotate('SPY', 'regime_change', {
        from: 'bullish',
        to: 'bearish',
        indicator: 'VIX spike',
      });

      expect(result.note).toContain('Market regime change');
      expect(result.tags).toContain('macro');
    });
  });

  describe('getTradeTimeline', () => {
    it('should return chronological timeline', () => {
      const mockEntries = [
        {
          id: 2,
          tradeId: 100,
          positionId: null,
          symbol: 'AAPL',
          note: 'Closed position',
          tags: JSON.stringify(['trade_close', 'exit']),
          createdAt: '2024-01-02T10:00:00Z',
        },
        {
          id: 1,
          tradeId: 100,
          positionId: null,
          symbol: 'AAPL',
          note: 'Opened position',
          tags: JSON.stringify(['trade_open', 'entry']),
          createdAt: '2024-01-01T10:00:00Z',
        },
      ];

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const timeline = manager.getTradeTimeline(100);

      expect(timeline).toHaveLength(2);
      expect(timeline[0].event).toBe('trade_open');
      expect(timeline[1].event).toBe('trade_close');
    });

    it('should handle entries without event tags', () => {
      const mockEntries = [
        {
          id: 1,
          tradeId: 100,
          positionId: null,
          symbol: 'AAPL',
          note: 'Manual note',
          tags: JSON.stringify(['custom']),
          createdAt: '2024-01-01T10:00:00Z',
        },
      ];

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const timeline = manager.getTradeTimeline(100);

      expect(timeline).toHaveLength(1);
      expect(timeline[0].event).toBe('note');
    });
  });

  describe('getSymbolHistory', () => {
    it('should return symbol history with default limit', () => {
      const mockEntries = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        tradeId: null,
        positionId: null,
        symbol: 'AAPL',
        note: `Note ${i + 1}`,
        tags: null,
        createdAt: new Date().toISOString(),
      }));

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const history = manager.getSymbolHistory('AAPL');

      expect(history).toHaveLength(50);
    });

    it('should respect custom limit', () => {
      const mockEntries = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        tradeId: null,
        positionId: null,
        symbol: 'TSLA',
        note: `Note ${i + 1}`,
        tags: null,
        createdAt: new Date().toISOString(),
      }));

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const history = manager.getSymbolHistory('TSLA', 10);

      expect(history).toHaveLength(10);
    });
  });

  describe('search', () => {
    it('should search and return matching entries', () => {
      const mockEntries = [
        {
          id: 1,
          tradeId: null,
          positionId: null,
          symbol: 'AAPL',
          note: 'Great earnings',
          tags: null,
          createdAt: new Date().toISOString(),
        },
      ];

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const results = manager.search('earnings');

      expect(results).toHaveLength(1);
      expect(results[0].note).toContain('earnings');
    });
  });

  describe('getInsights', () => {
    it('should generate insights from journal', () => {
      const mockEntries = [
        {
          id: 1,
          tradeId: 100,
          positionId: null,
          symbol: 'AAPL',
          note: 'Closed position\nReason: Take-profit target',
          tags: JSON.stringify(['trade_close', 'exit', 'winner']),
          createdAt: '2024-01-01T10:00:00Z',
        },
        {
          id: 2,
          tradeId: 101,
          positionId: null,
          symbol: 'TSLA',
          note: 'Stop-loss triggered @ $200',
          tags: JSON.stringify(['stop_loss', 'exit', 'loser']),
          createdAt: '2024-01-02T10:00:00Z',
        },
        {
          id: 3,
          tradeId: 102,
          positionId: null,
          symbol: 'AAPL',
          note: 'DCA round 1',
          tags: JSON.stringify(['dca', 'position_sizing']),
          createdAt: '2024-01-03T10:00:00Z',
        },
      ];

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const insights = manager.getInsights();

      expect(insights.totalEntries).toBe(3);
      expect(insights.topTags.length).toBeGreaterThan(0);
      expect(insights.patterns.length).toBeGreaterThan(0);
      expect(insights.mostActiveSymbols.length).toBeGreaterThan(0);
    });

    it('should calculate win rate pattern', () => {
      const mockEntries = [
        {
          id: 1,
          tradeId: 100,
          positionId: null,
          symbol: 'AAPL',
          note: 'Winner',
          tags: JSON.stringify(['winner']),
          createdAt: '2024-01-01T10:00:00Z',
        },
        {
          id: 2,
          tradeId: 101,
          positionId: null,
          symbol: 'TSLA',
          note: 'Winner',
          tags: JSON.stringify(['winner']),
          createdAt: '2024-01-02T10:00:00Z',
        },
        {
          id: 3,
          tradeId: 102,
          positionId: null,
          symbol: 'MSFT',
          note: 'Loser',
          tags: JSON.stringify(['loser']),
          createdAt: '2024-01-03T10:00:00Z',
        },
      ];

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const insights = manager.getInsights();

      const winRatePattern = insights.patterns.find((p) =>
        p.pattern.includes('Win rate'),
      );
      expect(winRatePattern).toBeDefined();
      expect(winRatePattern?.pattern).toContain('66.7%');
    });
  });

  describe('exportJournal', () => {
    it('should export journal as JSON', () => {
      const mockEntries = [
        {
          id: 1,
          tradeId: 100,
          positionId: 50,
          symbol: 'AAPL',
          note: 'Test note',
          tags: JSON.stringify(['tag1']),
          createdAt: '2024-01-01T10:00:00Z',
        },
      ];

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const json = manager.exportJournal('json');
      const parsed = JSON.parse(json);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].symbol).toBe('AAPL');
    });

    it('should export journal as CSV', () => {
      const mockEntries = [
        {
          id: 1,
          tradeId: 100,
          positionId: 50,
          symbol: 'AAPL',
          note: 'Test note',
          tags: JSON.stringify(['tag1']),
          createdAt: '2024-01-01T10:00:00Z',
        },
      ];

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const csv = manager.exportJournal('csv');

      expect(csv).toContain('ID,Symbol,Trade ID,Position ID,Note,Tags,Created At');
      expect(csv).toContain('AAPL');
      expect(csv).toContain('Test note');
    });

    it('should handle quotes in CSV export', () => {
      const mockEntries = [
        {
          id: 1,
          tradeId: null,
          positionId: null,
          symbol: 'AAPL',
          note: 'Note with "quotes"',
          tags: null,
          createdAt: '2024-01-01T10:00:00Z',
        },
      ];

      mockDb.select.mockReturnValue(createMockSelectChain(mockEntries));

      const csv = manager.exportJournal('csv');

      expect(csv).toContain('""quotes""');
    });
  });

  describe('getTradeJournalManager singleton', () => {
    it('should return singleton instance', () => {
      const instance1 = getTradeJournalManager();
      const instance2 = getTradeJournalManager();

      expect(instance1).toBe(instance2);
    });
  });
});
