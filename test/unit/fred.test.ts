import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { mockAxiosGet } = vi.hoisted(() => {
  const mockAxiosGet = vi.fn();
  return { mockAxiosGet };
});

vi.mock('axios', () => ({
  default: {
    get: mockAxiosGet,
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { FredClient, getFredClient } from '../../src/data/fred.js';

function makeFredResponse(value: string) {
  return {
    data: {
      observations: [{ date: '2026-02-20', value }],
    },
  };
}

function makeFredResponseEmpty() {
  return {
    data: {
      observations: [],
    },
  };
}

describe('FredClient', () => {
  let client: FredClient;
  const originalEnv = process.env.FRED_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FRED_API_KEY = 'test-key';
    client = new FredClient();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.FRED_API_KEY = originalEnv;
    } else {
      delete process.env.FRED_API_KEY;
    }
  });

  describe('getMacroData', () => {
    it('returns null when FRED_API_KEY is not set', async () => {
      delete process.env.FRED_API_KEY;
      const noKeyClient = new FredClient();

      const result = await noKeyClient.getMacroData();

      expect(result).toBeNull();
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('fetches and parses all 4 data points correctly', async () => {
      mockAxiosGet
        .mockResolvedValueOnce(makeFredResponse('-0.42')) // T10Y2Y
        .mockResolvedValueOnce(makeFredResponse('4.56')) // BAMLH0A0HYM2
        .mockResolvedValueOnce(makeFredResponse('-0.15')) // NFCI
        .mockResolvedValueOnce(makeFredResponse('8900000')) // WALCL
        .mockResolvedValueOnce(makeFredResponse('500000')) // WTREGEN
        .mockResolvedValueOnce(makeFredResponse('2100000')); // RRPONTSYD

      const result = await client.getMacroData();

      expect(result).not.toBeNull();
      expect(result!.yieldCurve).toBe(-0.42);
      expect(result!.creditSpread).toBe(4.56);
      expect(result!.financialConditions).toBe(-0.15);
      expect(result!.netLiquidity).toBe(8900000 - 500000 - 2100000);
      expect(result!.timestamp).toBeTruthy();
      expect(mockAxiosGet).toHaveBeenCalledTimes(6);
    });

    it('computes net liquidity as WALCL - WTREGEN - RRPONTSYD', async () => {
      mockAxiosGet
        .mockResolvedValueOnce(makeFredResponse('0')) // T10Y2Y
        .mockResolvedValueOnce(makeFredResponse('0')) // BAMLH0A0HYM2
        .mockResolvedValueOnce(makeFredResponse('0')) // NFCI
        .mockResolvedValueOnce(makeFredResponse('10000000')) // WALCL
        .mockResolvedValueOnce(makeFredResponse('1000000')) // WTREGEN
        .mockResolvedValueOnce(makeFredResponse('3000000')); // RRPONTSYD

      const result = await client.getMacroData();

      expect(result!.netLiquidity).toBe(10000000 - 1000000 - 3000000);
      expect(result!.netLiquidity).toBe(6000000);
    });

    it('returns null for netLiquidity when any component fails', async () => {
      mockAxiosGet
        .mockResolvedValueOnce(makeFredResponse('1.0')) // T10Y2Y
        .mockResolvedValueOnce(makeFredResponse('3.0')) // BAMLH0A0HYM2
        .mockResolvedValueOnce(makeFredResponse('0.5')) // NFCI
        .mockResolvedValueOnce(makeFredResponse('8000000')) // WALCL
        .mockRejectedValueOnce(new Error('Network error')) // WTREGEN fails
        .mockResolvedValueOnce(makeFredResponse('2000000')); // RRPONTSYD

      const result = await client.getMacroData();

      expect(result!.yieldCurve).toBe(1.0);
      expect(result!.creditSpread).toBe(3.0);
      expect(result!.financialConditions).toBe(0.5);
      expect(result!.netLiquidity).toBeNull();
    });

    it('caches data for 6 hours', async () => {
      mockAxiosGet
        .mockResolvedValueOnce(makeFredResponse('-0.42'))
        .mockResolvedValueOnce(makeFredResponse('4.56'))
        .mockResolvedValueOnce(makeFredResponse('-0.15'))
        .mockResolvedValueOnce(makeFredResponse('8900000'))
        .mockResolvedValueOnce(makeFredResponse('500000'))
        .mockResolvedValueOnce(makeFredResponse('2100000'));

      const first = await client.getMacroData();
      const second = await client.getMacroData();

      expect(first).toEqual(second);
      // Only 6 calls for the first fetch, none for the second
      expect(mockAxiosGet).toHaveBeenCalledTimes(6);
    });

    it('expires cache after TTL', async () => {
      vi.useFakeTimers();

      mockAxiosGet
        // First batch
        .mockResolvedValueOnce(makeFredResponse('1.0'))
        .mockResolvedValueOnce(makeFredResponse('2.0'))
        .mockResolvedValueOnce(makeFredResponse('3.0'))
        .mockResolvedValueOnce(makeFredResponse('4.0'))
        .mockResolvedValueOnce(makeFredResponse('5.0'))
        .mockResolvedValueOnce(makeFredResponse('6.0'))
        // Second batch after expiry
        .mockResolvedValueOnce(makeFredResponse('10.0'))
        .mockResolvedValueOnce(makeFredResponse('20.0'))
        .mockResolvedValueOnce(makeFredResponse('30.0'))
        .mockResolvedValueOnce(makeFredResponse('40.0'))
        .mockResolvedValueOnce(makeFredResponse('50.0'))
        .mockResolvedValueOnce(makeFredResponse('60.0'));

      const first = await client.getMacroData();
      expect(first!.yieldCurve).toBe(1.0);
      expect(mockAxiosGet).toHaveBeenCalledTimes(6);

      // Advance time past TTL (6 hours + 1ms)
      vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1);

      const second = await client.getMacroData();
      expect(second!.yieldCurve).toBe(10.0);
      expect(mockAxiosGet).toHaveBeenCalledTimes(12);

      vi.useRealTimers();
    });

    it('handles API errors gracefully', async () => {
      mockAxiosGet.mockRejectedValue(new Error('API down'));

      const result = await client.getMacroData();

      expect(result).not.toBeNull();
      expect(result!.yieldCurve).toBeNull();
      expect(result!.creditSpread).toBeNull();
      expect(result!.financialConditions).toBeNull();
      expect(result!.netLiquidity).toBeNull();
    });

    it('handles "." values in observations as null', async () => {
      mockAxiosGet
        .mockResolvedValueOnce(makeFredResponse('.')) // T10Y2Y = "."
        .mockResolvedValueOnce(makeFredResponse('4.56'))
        .mockResolvedValueOnce(makeFredResponse('.')) // NFCI = "."
        .mockResolvedValueOnce(makeFredResponse('8900000'))
        .mockResolvedValueOnce(makeFredResponse('.')) // WTREGEN = "."
        .mockResolvedValueOnce(makeFredResponse('2100000'));

      const result = await client.getMacroData();

      expect(result!.yieldCurve).toBeNull();
      expect(result!.creditSpread).toBe(4.56);
      expect(result!.financialConditions).toBeNull();
      // netLiquidity is null because WTREGEN is null
      expect(result!.netLiquidity).toBeNull();
    });

    it('handles empty observations array', async () => {
      mockAxiosGet.mockResolvedValue(makeFredResponseEmpty());

      const result = await client.getMacroData();

      expect(result!.yieldCurve).toBeNull();
      expect(result!.creditSpread).toBeNull();
      expect(result!.financialConditions).toBeNull();
      expect(result!.netLiquidity).toBeNull();
    });

    it('passes correct params to axios', async () => {
      mockAxiosGet.mockResolvedValue(makeFredResponse('1.0'));

      await client.getMacroData();

      expect(mockAxiosGet).toHaveBeenCalledWith(
        'https://api.stlouisfed.org/fred/series/observations',
        {
          params: {
            series_id: 'T10Y2Y',
            api_key: 'test-key',
            file_type: 'json',
            limit: 1,
            sort_order: 'desc',
          },
          timeout: 10_000,
        },
      );
    });

    it('returns ISO 8601 UTC timestamp', async () => {
      mockAxiosGet.mockResolvedValue(makeFredResponse('1.0'));

      const result = await client.getMacroData();

      // Should be a valid ISO 8601 string ending in Z
      expect(result!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });
  });

  describe('getFredClient', () => {
    it('returns the same singleton instance', () => {
      const a = getFredClient();
      const b = getFredClient();
      expect(a).toBe(b);
    });
  });
});
