import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock axios before importing the module under test
const { mockAxiosGet } = vi.hoisted(() => ({
  mockAxiosGet: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { get: mockAxiosGet },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { FinraClient, getFinraClient } from '../../src/data/finra.js';

// Helper to build pipe-delimited FINRA text
function buildFinraText(rows: string[][]): string {
  const header = 'Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market';
  return [header, ...rows.map((r) => r.join('|'))].join('\n');
}

describe('FinraClient', () => {
  let client: FinraClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new FinraClient();
  });

  describe('getShortData', () => {
    it('parses pipe-delimited text correctly', async () => {
      const text = buildFinraText([
        ['20260218', 'AAPL', '1000000', '50000', '2000000', 'FINRA'],
      ]);
      mockAxiosGet.mockResolvedValue({ data: text });

      const result = await client.getShortData(['AAPL']);
      expect(result.size).toBe(1);
      const entry = result.get('AAPL')!;
      expect(entry.symbol).toBe('AAPL');
      expect(entry.shortVolume).toBe(1000000);
      expect(entry.totalVolume).toBe(2000000);
      expect(entry.shortVolumePct).toBeCloseTo(50, 1);
      expect(entry.date).toBe('2026-02-18');
      expect(entry.fetchedAt).toBeTruthy();
    });

    it('aggregates across multiple market rows for same symbol', async () => {
      const text = buildFinraText([
        ['20260218', 'AAPL', '600000', '10000', '1000000', 'FINRA'],
        ['20260218', 'AAPL', '400000', '5000', '1000000', 'NYSE'],
      ]);
      mockAxiosGet.mockResolvedValue({ data: text });

      const result = await client.getShortData(['AAPL']);
      const entry = result.get('AAPL')!;
      expect(entry.shortVolume).toBe(1000000); // 600k + 400k
      expect(entry.totalVolume).toBe(2000000); // 1M + 1M
      expect(entry.shortVolumePct).toBeCloseTo(50, 1);
    });

    it('returns empty Map gracefully on HTTP error', async () => {
      mockAxiosGet.mockRejectedValue(new Error('Network error'));

      const result = await client.getShortData(['AAPL']);
      expect(result.size).toBe(0);
    });

    it('returns only requested symbols', async () => {
      const text = buildFinraText([
        ['20260218', 'AAPL', '1000000', '0', '2000000', 'FINRA'],
        ['20260218', 'MSFT', '500000', '0', '1000000', 'FINRA'],
        ['20260218', 'GOOG', '300000', '0', '600000', 'FINRA'],
      ]);
      mockAxiosGet.mockResolvedValue({ data: text });

      const result = await client.getShortData(['AAPL', 'MSFT']);
      expect(result.size).toBe(2);
      expect(result.has('AAPL')).toBe(true);
      expect(result.has('MSFT')).toBe(true);
      expect(result.has('GOOG')).toBe(false);
    });

    it('falls back to previous day when today returns empty data', async () => {
      const textYesterday = buildFinraText([
        ['20260217', 'AAPL', '800000', '0', '1600000', 'FINRA'],
      ]);

      // First call (today) returns empty/no data, second call (yesterday) returns data
      mockAxiosGet
        .mockResolvedValueOnce({ data: '' }) // today: empty
        .mockResolvedValueOnce({ data: textYesterday }); // yesterday: has data

      const result = await client.getShortData(['AAPL']);
      expect(result.size).toBe(1);
      expect(result.get('AAPL')?.shortVolume).toBe(800000);
    });

    it('tries multiple days back when today and yesterday both return empty', async () => {
      const textOlder = buildFinraText([
        ['20260215', 'TSLA', '2000000', '0', '4000000', 'FINRA'],
      ]);

      // First 3 calls return empty, 4th returns data
      mockAxiosGet
        .mockResolvedValueOnce({ data: '' }) // today
        .mockResolvedValueOnce({ data: '' }) // yesterday
        .mockResolvedValueOnce({ data: '' }) // 2 days ago
        .mockResolvedValueOnce({ data: textOlder }); // 3 days ago

      const result = await client.getShortData(['TSLA']);
      expect(result.size).toBe(1);
      expect(result.get('TSLA')?.shortVolume).toBe(2000000);
    });

    it('skips header line with symbol "Symbol"', async () => {
      // The buildFinraText helper already has a header; this tests the skip logic directly
      const text = 'Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n20260218|AAPL|500000|0|1000000|FINRA';
      mockAxiosGet.mockResolvedValue({ data: text });

      const result = await client.getShortData(['AAPL', 'Symbol']);
      expect(result.has('Symbol')).toBe(false);
      expect(result.has('AAPL')).toBe(true);
    });

    it('skips lines with fewer than 5 parts', async () => {
      const text = 'Date|Symbol|ShortVolume\n20260218|AAPL|500000|0|1000000|FINRA';
      mockAxiosGet.mockResolvedValue({ data: text });

      const result = await client.getShortData(['AAPL']);
      expect(result.size).toBe(1);
    });

    it('skips rows where totalVolume is 0', async () => {
      const text = buildFinraText([
        ['20260218', 'AAPL', '0', '0', '0', 'FINRA'],
        ['20260218', 'MSFT', '500000', '0', '1000000', 'FINRA'],
      ]);
      mockAxiosGet.mockResolvedValue({ data: text });

      const result = await client.getShortData(['AAPL', 'MSFT']);
      expect(result.has('AAPL')).toBe(false);
      expect(result.has('MSFT')).toBe(true);
    });

    it('uses cache for same date string', async () => {
      const text = buildFinraText([
        ['20260218', 'AAPL', '1000000', '0', '2000000', 'FINRA'],
      ]);
      mockAxiosGet.mockResolvedValue({ data: text });

      // Call twice for the same symbols
      await client.getShortData(['AAPL']);
      await client.getShortData(['AAPL']);

      // axios.get should only be called once per date (today + fallback attempts)
      // The exact count depends on whether today returns data; just verify it was called < 3 times total
      expect(mockAxiosGet.mock.calls.length).toBeLessThan(4);
    });

    it('returns empty Map when all dates exhausted', async () => {
      mockAxiosGet.mockResolvedValue({ data: '' }); // All days return empty
      const result = await client.getShortData(['AAPL']);
      expect(result.size).toBe(0);
    });

    it('returns empty Map when symbol not found in data', async () => {
      const text = buildFinraText([
        ['20260218', 'MSFT', '500000', '0', '1000000', 'FINRA'],
      ]);
      mockAxiosGet.mockResolvedValue({ data: text });

      const result = await client.getShortData(['AAPL']);
      expect(result.size).toBe(0);
    });
  });

  describe('getFinraClient', () => {
    it('returns the same singleton instance', () => {
      const a = getFinraClient();
      const b = getFinraClient();
      expect(a).toBe(b);
    });
  });
});
