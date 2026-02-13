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
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
}));

// DB mock
const mockDbRun = vi.fn().mockReturnValue({ lastInsertRowid: 1n, changes: 1 });
const mockDbGet = vi.fn();
const mockDbAll = vi.fn().mockReturnValue([]);

function createChain() {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'set', 'values', 'orderBy', 'limit'];
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
  modelPerformance: { id: 'id', actualOutcome: 'actualOutcome' },
  signals: { id: 'id' },
}));

// Yahoo Finance mock
const mockGetQuote = vi.fn();
vi.mock('../../src/data/yahoo-finance.js', () => ({
  YahooFinanceClient: vi.fn().mockImplementation(function () {
    return { getQuote: mockGetQuote };
  }),
}));

// ── Import SUT ──────────────────────────────────────────────────────────────
import { ModelTracker } from '../../src/monitoring/model-tracker.js';

describe('ModelTracker', () => {
  let tracker: ModelTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    tracker = new ModelTracker();
  });

  // ── recordPrediction ───────────────────────────────────────────────────
  describe('recordPrediction', () => {
    it('inserts a new prediction into DB', () => {
      tracker.recordPrediction({
        aiModel: 'claude-sonnet-4-5-20250929',
        symbol: 'AAPL',
        decision: 'BUY',
        conviction: 85,
        priceAtSignal: 150,
      });

      expect(mockDbRun).toHaveBeenCalled();
    });

    it('sets actualOutcome to pending', () => {
      const capturedValues: Record<string, unknown>[] = [];
      (mockChain.values as ReturnType<typeof vi.fn>).mockImplementation((val: Record<string, unknown>) => {
        capturedValues.push(val);
        return mockChain;
      });

      tracker.recordPrediction({
        aiModel: 'test-model',
        symbol: 'GOOG',
        decision: 'SELL',
        conviction: 70,
        priceAtSignal: 2800,
      });

      expect(capturedValues[0].actualOutcome).toBe('pending');
    });
  });

  // ── evaluatePendingPredictions ─────────────────────────────────────────
  describe('evaluatePendingPredictions', () => {
    it('returns 0 when no pending predictions', async () => {
      mockDbAll.mockReturnValueOnce([]);

      const result = await tracker.evaluatePendingPredictions();
      expect(result).toBe(0);
    });

    it('evaluates BUY prediction as correct when price went up', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          id: 1,
          aiModel: 'test',
          symbol: 'AAPL',
          decision: 'BUY',
          conviction: 80,
          signalTimestamp: twoDaysAgo,
          priceAtSignal: 100,
          priceAfter1d: null,
          priceAfter5d: null,
          priceAfter10d: null,
          actualOutcome: 'pending',
        },
      ]);
      mockGetQuote.mockResolvedValueOnce({ price: 105 }); // +5%

      const result = await tracker.evaluatePendingPredictions();
      expect(result).toBe(1);
      expect(mockDbRun).toHaveBeenCalled();
    });

    it('evaluates BUY prediction as incorrect when price went down', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          id: 2,
          aiModel: 'test',
          symbol: 'AAPL',
          decision: 'BUY',
          conviction: 80,
          signalTimestamp: twoDaysAgo,
          priceAtSignal: 100,
          priceAfter1d: null,
          priceAfter5d: null,
          priceAfter10d: null,
          actualOutcome: 'pending',
        },
      ]);
      mockGetQuote.mockResolvedValueOnce({ price: 95 }); // -5%

      const result = await tracker.evaluatePendingPredictions();
      expect(result).toBe(1);
    });

    it('evaluates SELL prediction as correct when price went down', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          id: 3,
          aiModel: 'test',
          symbol: 'AAPL',
          decision: 'SELL',
          conviction: 80,
          signalTimestamp: twoDaysAgo,
          priceAtSignal: 100,
          priceAfter1d: null,
          priceAfter5d: null,
          priceAfter10d: null,
          actualOutcome: 'pending',
        },
      ]);
      mockGetQuote.mockResolvedValueOnce({ price: 95 }); // -5%

      const result = await tracker.evaluatePendingPredictions();
      expect(result).toBe(1);
    });

    it('evaluates HOLD prediction as correct when price barely moved', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          id: 4,
          aiModel: 'test',
          symbol: 'AAPL',
          decision: 'HOLD',
          conviction: 50,
          signalTimestamp: twoDaysAgo,
          priceAtSignal: 100,
          priceAfter1d: null,
          priceAfter5d: null,
          priceAfter10d: null,
          actualOutcome: 'pending',
        },
      ]);
      mockGetQuote.mockResolvedValueOnce({ price: 101 }); // +1% < 2% threshold

      const result = await tracker.evaluatePendingPredictions();
      expect(result).toBe(1);
    });

    it('evaluates HOLD prediction as incorrect when price moved significantly', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          id: 5,
          aiModel: 'test',
          symbol: 'AAPL',
          decision: 'HOLD',
          conviction: 50,
          signalTimestamp: twoDaysAgo,
          priceAtSignal: 100,
          priceAfter1d: null,
          priceAfter5d: null,
          priceAfter10d: null,
          actualOutcome: 'pending',
        },
      ]);
      mockGetQuote.mockResolvedValueOnce({ price: 110 }); // +10%

      const result = await tracker.evaluatePendingPredictions();
      expect(result).toBe(1);
    });

    it('skips predictions less than 1 day old', async () => {
      const justNow = new Date().toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          id: 6,
          aiModel: 'test',
          symbol: 'AAPL',
          decision: 'BUY',
          conviction: 80,
          signalTimestamp: justNow,
          priceAtSignal: 100,
          priceAfter1d: null,
          priceAfter5d: null,
          priceAfter10d: null,
          actualOutcome: 'pending',
        },
      ]);

      const result = await tracker.evaluatePendingPredictions();
      expect(result).toBe(0);
      expect(mockGetQuote).not.toHaveBeenCalled();
    });

    it('skips when getQuote returns null', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          id: 7,
          aiModel: 'test',
          symbol: 'XYZ',
          decision: 'BUY',
          conviction: 80,
          signalTimestamp: twoDaysAgo,
          priceAtSignal: 100,
          priceAfter1d: null,
          priceAfter5d: null,
          priceAfter10d: null,
          actualOutcome: 'pending',
        },
      ]);
      mockGetQuote.mockResolvedValueOnce(null);

      const result = await tracker.evaluatePendingPredictions();
      expect(result).toBe(0);
    });

    it('handles getQuote errors without crashing', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          id: 8,
          aiModel: 'test',
          symbol: 'XYZ',
          decision: 'BUY',
          conviction: 80,
          signalTimestamp: twoDaysAgo,
          priceAtSignal: 100,
          priceAfter1d: null,
          priceAfter5d: null,
          priceAfter10d: null,
          actualOutcome: 'pending',
        },
      ]);
      mockGetQuote.mockRejectedValueOnce(new Error('API down'));

      const result = await tracker.evaluatePendingPredictions();
      expect(result).toBe(0);
    });

    it('sets priceAfter5d and priceAfter10d when enough days have passed', async () => {
      const elevenDaysAgo = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          id: 9,
          aiModel: 'test',
          symbol: 'AAPL',
          decision: 'BUY',
          conviction: 80,
          signalTimestamp: elevenDaysAgo,
          priceAtSignal: 100,
          priceAfter1d: null,
          priceAfter5d: null,
          priceAfter10d: null,
          actualOutcome: 'pending',
        },
      ]);
      mockGetQuote.mockResolvedValueOnce({ price: 110 });

      const result = await tracker.evaluatePendingPredictions();
      expect(result).toBe(1);
    });

    it('does not overwrite existing priceAfter values', async () => {
      const elevenDaysAgo = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString();
      mockDbAll.mockReturnValueOnce([
        {
          id: 10,
          aiModel: 'test',
          symbol: 'AAPL',
          decision: 'BUY',
          conviction: 80,
          signalTimestamp: elevenDaysAgo,
          priceAtSignal: 100,
          priceAfter1d: 102,
          priceAfter5d: 105,
          priceAfter10d: 108,
          actualOutcome: 'pending',
        },
      ]);
      mockGetQuote.mockResolvedValueOnce({ price: 110 });

      const result = await tracker.evaluatePendingPredictions();
      expect(result).toBe(1);
    });
  });

  // ── getModelStats ──────────────────────────────────────────────────────
  describe('getModelStats', () => {
    it('returns empty array when no data', () => {
      mockDbAll.mockReturnValueOnce([]);

      const stats = tracker.getModelStats();
      expect(stats).toEqual([]);
    });

    it('calculates stats for a single model', () => {
      mockDbAll.mockReturnValueOnce([
        { aiModel: 'claude', decision: 'BUY', conviction: 80, actualOutcome: 'correct', actualReturnPct: 0.05 },
        { aiModel: 'claude', decision: 'BUY', conviction: 70, actualOutcome: 'incorrect', actualReturnPct: -0.03 },
        { aiModel: 'claude', decision: 'SELL', conviction: 60, actualOutcome: 'correct', actualReturnPct: -0.04 },
        { aiModel: 'claude', decision: 'HOLD', conviction: 50, actualOutcome: 'pending', actualReturnPct: null },
      ]);

      const stats = tracker.getModelStats();

      expect(stats).toHaveLength(1);
      expect(stats[0].model).toBe('claude');
      expect(stats[0].totalPredictions).toBe(4);
      expect(stats[0].correctPredictions).toBe(2);
      // 3 evaluated (non-pending), 2 correct => 2/3
      expect(stats[0].accuracy).toBeCloseTo(2 / 3, 4);
      expect(stats[0].avgConviction).toBe(65); // (80+70+60+50)/4
      expect(stats[0].buyAccuracy).toBe(0.5); // 1/2
      expect(stats[0].sellAccuracy).toBe(1); // 1/1
      expect(stats[0].holdAccuracy).toBe(0); // 0 evaluated holds
    });

    it('calculates stats for multiple models', () => {
      mockDbAll.mockReturnValueOnce([
        { aiModel: 'modelA', decision: 'BUY', conviction: 80, actualOutcome: 'correct', actualReturnPct: 0.05 },
        { aiModel: 'modelB', decision: 'SELL', conviction: 70, actualOutcome: 'incorrect', actualReturnPct: 0.02 },
      ]);

      const stats = tracker.getModelStats();

      expect(stats).toHaveLength(2);
      // Sorted by accuracy desc
      expect(stats[0].model).toBe('modelA');
      expect(stats[0].accuracy).toBe(1);
      expect(stats[1].model).toBe('modelB');
      expect(stats[1].accuracy).toBe(0);
    });

    it('handles model with zero evaluated predictions', () => {
      mockDbAll.mockReturnValueOnce([
        { aiModel: 'claude', decision: 'BUY', conviction: 80, actualOutcome: 'pending', actualReturnPct: null },
      ]);

      const stats = tracker.getModelStats();

      expect(stats).toHaveLength(1);
      expect(stats[0].accuracy).toBe(0);
      expect(stats[0].buyAccuracy).toBe(0);
      expect(stats[0].avgReturnOnBuy).toBe(0);
    });

    it('calculates avgReturnOnBuy and avgReturnOnSell correctly', () => {
      mockDbAll.mockReturnValueOnce([
        { aiModel: 'claude', decision: 'BUY', conviction: 80, actualOutcome: 'correct', actualReturnPct: 0.10 },
        { aiModel: 'claude', decision: 'BUY', conviction: 70, actualOutcome: 'incorrect', actualReturnPct: -0.05 },
        { aiModel: 'claude', decision: 'SELL', conviction: 60, actualOutcome: 'correct', actualReturnPct: -0.08 },
      ]);

      const stats = tracker.getModelStats();

      expect(stats[0].avgReturnOnBuy).toBeCloseTo(0.025, 4); // (0.10 + -0.05)/2
      expect(stats[0].avgReturnOnSell).toBeCloseTo(-0.08, 4); // -0.08/1
    });

    it('handles null actualReturnPct gracefully', () => {
      mockDbAll.mockReturnValueOnce([
        { aiModel: 'claude', decision: 'BUY', conviction: 80, actualOutcome: 'correct', actualReturnPct: null },
      ]);

      const stats = tracker.getModelStats();

      expect(stats[0].avgReturnOnBuy).toBe(0);
    });
  });
});
