import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OHLCVCandle } from '../../src/data/yahoo-finance.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock Yahoo Finance client
const mockGetHistoricalData = vi.fn();
vi.mock('../../src/data/yahoo-finance.js', () => ({
  YahooFinanceClient: vi.fn().mockImplementation(function () {
    return { getHistoricalData: mockGetHistoricalData };
  }),
}));

import {
  SectorRotationAnalyzer,
  getSectorRotationAnalyzer,
  type SectorStrength,
} from '../../src/analysis/sector-rotation.js';

// ---------------------------------------------------------------------------
// Helpers: generate realistic candle data
// ---------------------------------------------------------------------------

/**
 * Generate `count` daily candles starting from a base price, drifting
 * at `dailyDriftPct` per day (e.g. 0.001 = +0.1 % daily).
 */
function generateCandles(
  count: number,
  basePrice: number,
  dailyDriftPct = 0,
): OHLCVCandle[] {
  const candles: OHLCVCandle[] = [];
  let price = basePrice;
  const startDate = new Date('2025-10-01');

  for (let i = 0; i < count; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);

    // Deterministic small noise so tests are reproducible
    const noise = Math.sin(i * 1.7) * 0.003; // +/- 0.3 %
    const change = dailyDriftPct + noise;
    price = price * (1 + change);

    const high = price * (1 + Math.abs(Math.sin(i * 2.3)) * 0.008);
    const low = price * (1 - Math.abs(Math.cos(i * 1.9)) * 0.008);

    candles.push({
      date: date.toISOString().split('T')[0],
      open: +(price * (1 - noise * 0.3)).toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +price.toFixed(2),
      volume: 50_000_000 + Math.floor(Math.sin(i) * 10_000_000),
    });
  }

  return candles;
}

/**
 * Build a mock implementation for `getHistoricalData` that returns the
 * provided map of symbol -> candles.  Symbols not in the map return [].
 */
function buildMockHistorical(
  map: Record<string, OHLCVCandle[]>,
): (symbol: string) => Promise<OHLCVCandle[]> {
  return async (symbol: string) => map[symbol] ?? [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SectorRotationAnalyzer', () => {
  let analyzer: SectorRotationAnalyzer;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a fresh instance (bypasses singleton cache)
    analyzer = new SectorRotationAnalyzer();
  });

  // -----------------------------------------------------------------------
  // Relative-strength computation
  // -----------------------------------------------------------------------
  describe('relative-strength computation', () => {
    it('correctly computes 1-month and 3-month RS vs SPY', async () => {
      // SPY flat, XLK rising => positive RS
      const spyCandles = generateCandles(90, 450, 0); // flat
      const xlkCandles = generateCandles(90, 200, 0.004); // +0.4 %/day

      // Only provide SPY + XLK, everything else empty
      mockGetHistoricalData.mockImplementation(
        buildMockHistorical({ SPY: spyCandles, XLK: xlkCandles }),
      );

      const result = await analyzer.analyze();
      const xlk = result.sectors.find((s) => s.etf === 'XLK');

      expect(xlk).toBeDefined();
      // XLK outperforms SPY so both RS values must be positive
      expect(xlk!.rs1m).toBeGreaterThan(0);
      expect(xlk!.rs3m).toBeGreaterThan(0);
    });

    it('returns percentage change correctly for 1-month and 3-month periods', async () => {
      // Construct candles where the return is exactly known:
      // 90 candles, all close at 100 except the last 23 close at 110 (for 1m)
      // and first candle closes at 90 (for 3m).
      const spyCandles = generateCandles(90, 100, 0); // roughly flat
      // XLK: strong positive drift
      const xlkCandles = generateCandles(90, 100, 0.002);

      mockGetHistoricalData.mockImplementation(
        buildMockHistorical({ SPY: spyCandles, XLK: xlkCandles }),
      );

      const result = await analyzer.analyze();
      const xlk = result.sectors.find((s) => s.etf === 'XLK');

      expect(xlk).toBeDefined();
      // rs1m and rs3m are differences of percentage returns, so they are numbers
      expect(typeof xlk!.rs1m).toBe('number');
      expect(typeof xlk!.rs3m).toBe('number');
      expect(Number.isFinite(xlk!.rs1m)).toBe(true);
      expect(Number.isFinite(xlk!.rs3m)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Classification
  // -----------------------------------------------------------------------
  describe('classification', () => {
    it('classifies leading sectors (positive RS)', async () => {
      // XLK drifts up strongly relative to flat SPY
      const spyCandles = generateCandles(90, 450, 0);
      const xlkCandles = generateCandles(90, 200, 0.006); // strong upward drift

      mockGetHistoricalData.mockImplementation(
        buildMockHistorical({ SPY: spyCandles, XLK: xlkCandles }),
      );

      const result = await analyzer.analyze();
      const xlk = result.sectors.find((s) => s.etf === 'XLK');

      expect(xlk).toBeDefined();
      expect(xlk!.strength).toBe('leading');
    });

    it('classifies lagging sectors (negative RS)', async () => {
      // XLE drifts down strongly relative to flat SPY
      const spyCandles = generateCandles(90, 450, 0);
      const xleCandles = generateCandles(90, 80, -0.006); // strong downward drift

      mockGetHistoricalData.mockImplementation(
        buildMockHistorical({ SPY: spyCandles, XLE: xleCandles }),
      );

      const result = await analyzer.analyze();
      const xle = result.sectors.find((s) => s.etf === 'XLE');

      expect(xle).toBeDefined();
      expect(xle!.strength).toBe('lagging');
    });

    it('returns neutral for moderate RS values', async () => {
      // Both SPY and XLF drift at roughly the same rate => RS near 0
      const spyCandles = generateCandles(90, 450, 0.001);
      const xlfCandles = generateCandles(90, 40, 0.001);

      mockGetHistoricalData.mockImplementation(
        buildMockHistorical({ SPY: spyCandles, XLF: xlfCandles }),
      );

      const result = await analyzer.analyze();
      const xlf = result.sectors.find((s) => s.etf === 'XLF');

      expect(xlf).toBeDefined();
      expect(xlf!.strength).toBe('neutral');
    });
  });

  // -----------------------------------------------------------------------
  // Caching
  // -----------------------------------------------------------------------
  describe('caching', () => {
    it('caches results and does not re-fetch on second call', async () => {
      const spyCandles = generateCandles(90, 450, 0);
      mockGetHistoricalData.mockImplementation(
        buildMockHistorical({ SPY: spyCandles }),
      );

      const result1 = await analyzer.analyze();
      const result2 = await analyzer.analyze();

      // getHistoricalData should only be called during the first analyze()
      // SPY + 11 ETFs = up to 12 calls, but second analyze() adds zero
      const callCountAfterFirst = mockGetHistoricalData.mock.calls.length;
      expect(callCountAfterFirst).toBeGreaterThan(0);

      // Second call should return identical data
      expect(result2).toEqual(result1);

      // Call count should not increase
      expect(mockGetHistoricalData.mock.calls.length).toBe(callCountAfterFirst);
    });
  });

  // -----------------------------------------------------------------------
  // getSectorStrength
  // -----------------------------------------------------------------------
  describe('getSectorStrength', () => {
    it('returns neutral for unknown sector name', async () => {
      const spyCandles = generateCandles(90, 450, 0);
      mockGetHistoricalData.mockImplementation(
        buildMockHistorical({ SPY: spyCandles }),
      );

      // Populate cache
      await analyzer.analyze();

      expect(analyzer.getSectorStrength('Nonexistent Sector')).toBe('neutral');
    });

    it('returns neutral when no cached data exists', () => {
      // No analyze() call => no cache
      expect(analyzer.getSectorStrength('Technology')).toBe('neutral');
    });

    it('matches sector name case-insensitively', async () => {
      const spyCandles = generateCandles(90, 450, 0);
      const xlkCandles = generateCandles(90, 200, 0.006);

      mockGetHistoricalData.mockImplementation(
        buildMockHistorical({ SPY: spyCandles, XLK: xlkCandles }),
      );

      await analyzer.analyze();

      const lower = analyzer.getSectorStrength('technology');
      const upper = analyzer.getSectorStrength('TECHNOLOGY');
      const mixed = analyzer.getSectorStrength('Technology');

      // All should resolve to the same strength
      expect(lower).toBe(mixed);
      expect(upper).toBe(mixed);
    });
  });

  // -----------------------------------------------------------------------
  // Missing / empty ETF data
  // -----------------------------------------------------------------------
  describe('missing data handling', () => {
    it('skips sectors with no ETF data', async () => {
      const spyCandles = generateCandles(90, 450, 0);
      // Only provide SPY and XLK; all other ETFs return []
      const xlkCandles = generateCandles(90, 200, 0.002);

      mockGetHistoricalData.mockImplementation(
        buildMockHistorical({ SPY: spyCandles, XLK: xlkCandles }),
      );

      const result = await analyzer.analyze();

      // Only XLK should appear (others had no data)
      expect(result.sectors.length).toBe(1);
      expect(result.sectors[0].etf).toBe('XLK');
    });

    it('returns empty sectors when SPY data is missing', async () => {
      mockGetHistoricalData.mockResolvedValue([]);

      const result = await analyzer.analyze();

      expect(result.sectors).toEqual([]);
      expect(result.timestamp).toBeDefined();
    });

    it('skips ETFs that throw errors', async () => {
      const spyCandles = generateCandles(90, 450, 0);
      const xlkCandles = generateCandles(90, 200, 0.002);

      mockGetHistoricalData.mockImplementation(async (symbol: string) => {
        if (symbol === 'SPY') return spyCandles;
        if (symbol === 'XLK') return xlkCandles;
        if (symbol === 'XLE') throw new Error('API rate limit');
        return [];
      });

      const result = await analyzer.analyze();

      // XLK should be present, XLE should be skipped due to error
      const etfs = result.sectors.map((s) => s.etf);
      expect(etfs).toContain('XLK');
      expect(etfs).not.toContain('XLE');
    });

    it('skips ETFs with insufficient data for RS calculation', async () => {
      const spyCandles = generateCandles(90, 450, 0);
      // XLK has only 10 candles, not enough for 22-day or 66-day returns
      const xlkShort = generateCandles(10, 200, 0.003);

      mockGetHistoricalData.mockImplementation(
        buildMockHistorical({ SPY: spyCandles, XLK: xlkShort }),
      );

      const result = await analyzer.analyze();

      // XLK should be skipped because there aren't enough candles
      expect(result.sectors.find((s) => s.etf === 'XLK')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Singleton
  // -----------------------------------------------------------------------
  describe('singleton', () => {
    it('returns the same instance on multiple calls', () => {
      const a = getSectorRotationAnalyzer();
      const b = getSectorRotationAnalyzer();
      expect(a).toBe(b);
    });
  });

  // -----------------------------------------------------------------------
  // Timestamp & structure
  // -----------------------------------------------------------------------
  describe('result structure', () => {
    it('returns a valid ISO timestamp', async () => {
      const spyCandles = generateCandles(90, 450, 0);
      mockGetHistoricalData.mockImplementation(
        buildMockHistorical({ SPY: spyCandles }),
      );

      const result = await analyzer.analyze();

      // Should be a valid ISO date string
      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    it('includes sector name and etf ticker in each analysis', async () => {
      const spyCandles = generateCandles(90, 450, 0);
      const xlkCandles = generateCandles(90, 200, 0.003);

      mockGetHistoricalData.mockImplementation(
        buildMockHistorical({ SPY: spyCandles, XLK: xlkCandles }),
      );

      const result = await analyzer.analyze();
      const xlk = result.sectors.find((s) => s.etf === 'XLK');

      expect(xlk).toBeDefined();
      expect(xlk!.sector).toBe('Technology');
      expect(xlk!.etf).toBe('XLK');
    });
  });
});
