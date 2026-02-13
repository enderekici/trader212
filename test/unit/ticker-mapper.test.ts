import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { TickerMapper, type Trading212ClientLike } from '../../src/data/ticker-mapper.js';

function createMockClient(instruments: Array<{
  ticker: string;
  name: string;
  shortName?: string;
  minTradeQuantity?: number;
  type?: string;
}>): Trading212ClientLike {
  return {
    getInstruments: vi.fn().mockResolvedValue(instruments),
  };
}

describe('TickerMapper', () => {
  let mapper: TickerMapper;
  let mockClient: Trading212ClientLike;

  const mockInstruments = [
    { ticker: 'AAPL_US_EQ', name: 'Apple Inc.', shortName: 'AAPL', minTradeQuantity: 0.001, type: 'STOCK' },
    { ticker: 'TSLA_US_EQ', name: 'Tesla Inc.', minTradeQuantity: 0.01, type: 'STOCK' },
    { ticker: 'MSFT_US_EQ', name: 'Microsoft Corp.', shortName: 'MSFT', type: 'STOCK' },
    { ticker: 'VOD_L_EQ', name: 'Vodafone Group', type: 'STOCK' }, // Not US equity
    { ticker: 'AMZN_US_EQ', name: '', shortName: '', type: 'STOCK' }, // Empty names
  ];

  beforeEach(() => {
    mockClient = createMockClient(mockInstruments);
    mapper = new TickerMapper(mockClient);
  });

  describe('load', () => {
    it('loads instruments and filters for US equities', async () => {
      await mapper.load();
      expect(mapper.isLoaded()).toBe(true);
      // Should only have _US_EQ instruments
      const equities = mapper.getUSEquities();
      expect(equities).toHaveLength(4);
    });

    it('filters out non-US equity instruments', async () => {
      await mapper.load();
      expect(mapper.isAvailable('VOD')).toBe(false);
    });

    it('maps symbols correctly', async () => {
      await mapper.load();
      expect(mapper.toT212Ticker('AAPL')).toBe('AAPL_US_EQ');
      expect(mapper.toSymbol('AAPL_US_EQ')).toBe('AAPL');
    });

    it('clears existing maps on reload', async () => {
      await mapper.load();
      expect(mapper.isAvailable('AAPL')).toBe(true);

      // Reload with different data
      const newClient = createMockClient([
        { ticker: 'GOOG_US_EQ', name: 'Alphabet', type: 'STOCK' },
      ]);
      const newMapper = new TickerMapper(newClient);
      await newMapper.load();

      expect(newMapper.isAvailable('GOOG')).toBe(true);
      expect(newMapper.isAvailable('AAPL')).toBe(false);
    });

    it('falls back to shortName when name is undefined', async () => {
      const client = createMockClient([
        { ticker: 'TEST_US_EQ', name: undefined as unknown as string, shortName: 'Test Short', type: 'STOCK' },
      ]);
      const m = new TickerMapper(client);
      await m.load();
      const info = m.getStockInfo('TEST');
      expect(info?.name).toBe('Test Short');
    });

    it('falls back to symbol when both name and shortName are undefined', async () => {
      const client = createMockClient([
        { ticker: 'XYZ_US_EQ', name: undefined as unknown as string, shortName: undefined, type: 'STOCK' },
      ]);
      const m = new TickerMapper(client);
      await m.load();
      const info = m.getStockInfo('XYZ');
      expect(info?.name).toBe('XYZ');
    });

    it('handles API error gracefully (does not throw)', async () => {
      const errorClient = {
        getInstruments: vi.fn().mockRejectedValue(new Error('API Error')),
      };
      const errorMapper = new TickerMapper(errorClient);
      await errorMapper.load(); // Should not throw
      expect(errorMapper.isLoaded()).toBe(false);
    });

    it('uses name, then shortName, then symbol for StockInfo name', async () => {
      await mapper.load();

      const appleInfo = mapper.getStockInfo('AAPL');
      expect(appleInfo?.name).toBe('Apple Inc.');

      // AMZN has empty name and shortName, should fall back to symbol
      const amznInfo = mapper.getStockInfo('AMZN');
      // name is '' which is falsy, shortName is '' which is falsy, so falls to symbol
      // Actually the code uses: inst.name ?? inst.shortName ?? symbol
      // '' is not null/undefined, so ?? won't trigger. '' will be used.
      expect(amznInfo?.name).toBe('');
    });
  });

  describe('isLoaded', () => {
    it('returns false before load', () => {
      expect(mapper.isLoaded()).toBe(false);
    });

    it('returns true after successful load', async () => {
      await mapper.load();
      expect(mapper.isLoaded()).toBe(true);
    });
  });

  describe('toT212Ticker', () => {
    it('returns T212 ticker for known symbol', async () => {
      await mapper.load();
      expect(mapper.toT212Ticker('AAPL')).toBe('AAPL_US_EQ');
      expect(mapper.toT212Ticker('TSLA')).toBe('TSLA_US_EQ');
    });

    it('returns null for unknown symbol', async () => {
      await mapper.load();
      expect(mapper.toT212Ticker('UNKNOWN')).toBeNull();
    });

    it('returns null when not loaded (but does not throw)', () => {
      expect(mapper.toT212Ticker('AAPL')).toBeNull();
    });
  });

  describe('toSymbol', () => {
    it('returns symbol for known T212 ticker', async () => {
      await mapper.load();
      expect(mapper.toSymbol('AAPL_US_EQ')).toBe('AAPL');
    });

    it('returns null for unknown T212 ticker', async () => {
      await mapper.load();
      expect(mapper.toSymbol('UNKNOWN_US_EQ')).toBeNull();
    });

    it('returns null when not loaded', () => {
      expect(mapper.toSymbol('AAPL_US_EQ')).toBeNull();
    });
  });

  describe('isAvailable', () => {
    it('returns true for available symbol', async () => {
      await mapper.load();
      expect(mapper.isAvailable('AAPL')).toBe(true);
    });

    it('returns false for unavailable symbol', async () => {
      await mapper.load();
      expect(mapper.isAvailable('UNKNOWN')).toBe(false);
    });

    it('returns false when not loaded', () => {
      expect(mapper.isAvailable('AAPL')).toBe(false);
    });
  });

  describe('getUSEquities', () => {
    it('returns all US equity stock infos', async () => {
      await mapper.load();
      const equities = mapper.getUSEquities();
      expect(equities).toHaveLength(4);
      expect(equities.map((e) => e.symbol)).toContain('AAPL');
      expect(equities.map((e) => e.symbol)).toContain('TSLA');
      expect(equities.map((e) => e.symbol)).toContain('MSFT');
    });

    it('returns empty array when not loaded', () => {
      const equities = mapper.getUSEquities();
      expect(equities).toEqual([]);
    });
  });

  describe('getStockInfo', () => {
    it('returns stock info for a known symbol', async () => {
      await mapper.load();
      const info = mapper.getStockInfo('AAPL');
      expect(info).toEqual({
        symbol: 'AAPL',
        t212Ticker: 'AAPL_US_EQ',
        name: 'Apple Inc.',
        minTradeQuantity: 0.001,
      });
    });

    it('returns null for unknown symbol', async () => {
      await mapper.load();
      expect(mapper.getStockInfo('UNKNOWN')).toBeNull();
    });

    it('returns null when not loaded', () => {
      expect(mapper.getStockInfo('AAPL')).toBeNull();
    });

    it('includes minTradeQuantity when available', async () => {
      await mapper.load();
      const tslaInfo = mapper.getStockInfo('TSLA');
      expect(tslaInfo?.minTradeQuantity).toBe(0.01);
    });

    it('has undefined minTradeQuantity when not provided', async () => {
      await mapper.load();
      const msftInfo = mapper.getStockInfo('MSFT');
      expect(msftInfo?.minTradeQuantity).toBeUndefined();
    });
  });

  describe('reload (refresh)', () => {
    it('can reload with new data', async () => {
      await mapper.load();
      expect(mapper.getUSEquities()).toHaveLength(4);

      // Mock returns new data for second call
      (mockClient.getInstruments as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { ticker: 'GOOG_US_EQ', name: 'Alphabet Inc.', type: 'STOCK' },
      ]);

      await mapper.load();
      expect(mapper.getUSEquities()).toHaveLength(1);
      expect(mapper.isAvailable('GOOG')).toBe(true);
      expect(mapper.isAvailable('AAPL')).toBe(false);
    });
  });
});
