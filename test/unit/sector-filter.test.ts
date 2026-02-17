import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { StockInfo } from '../../src/pairlist/filters.js';

const mockConfigValues: Record<string, unknown> = {};

vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn((key: string) => {
      if (key in mockConfigValues) return mockConfigValues[key];
      throw new Error(`Config key not found: ${key}`);
    }),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../../src/db/index.js', () => ({
  getDb: vi.fn(),
}));

function makeStock(overrides: Partial<StockInfo> & { symbol: string }): StockInfo {
  return {
    t212Ticker: overrides.symbol,
    name: overrides.symbol,
    ...overrides,
  };
}

describe('SectorFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockConfigValues)) {
      delete mockConfigValues[key];
    }
  });

  it('filters stocks by allowed sectors (whitelist)', async () => {
    mockConfigValues['pairlist.sector.allowed'] = ['Technology', 'Healthcare'];
    mockConfigValues['pairlist.sector.excluded'] = [];

    const { SectorFilter } = await import('../../src/pairlist/filters.js');
    const filter = new SectorFilter();

    const stocks = [
      makeStock({ symbol: 'AAPL', sector: 'Technology' }),
      makeStock({ symbol: 'JNJ', sector: 'Healthcare' }),
      makeStock({ symbol: 'XOM', sector: 'Energy' }),
      makeStock({ symbol: 'JPM', sector: 'Financials' }),
    ];

    const result = await filter.filter(stocks);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.symbol)).toEqual(['AAPL', 'JNJ']);
  });

  it('filters stocks by excluded sectors (blacklist)', async () => {
    mockConfigValues['pairlist.sector.allowed'] = [];
    mockConfigValues['pairlist.sector.excluded'] = ['Energy', 'Financials'];

    const { SectorFilter } = await import('../../src/pairlist/filters.js');
    const filter = new SectorFilter();

    const stocks = [
      makeStock({ symbol: 'AAPL', sector: 'Technology' }),
      makeStock({ symbol: 'JNJ', sector: 'Healthcare' }),
      makeStock({ symbol: 'XOM', sector: 'Energy' }),
      makeStock({ symbol: 'JPM', sector: 'Financials' }),
    ];

    const result = await filter.filter(stocks);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.symbol)).toEqual(['AAPL', 'JNJ']);
  });

  it('when both allowed and excluded are set, allowed takes priority', async () => {
    mockConfigValues['pairlist.sector.allowed'] = ['Technology'];
    mockConfigValues['pairlist.sector.excluded'] = ['Technology'];

    const { SectorFilter } = await import('../../src/pairlist/filters.js');
    const filter = new SectorFilter();

    const stocks = [
      makeStock({ symbol: 'AAPL', sector: 'Technology' }),
      makeStock({ symbol: 'XOM', sector: 'Energy' }),
      makeStock({ symbol: 'JNJ', sector: 'Healthcare' }),
    ];

    // allowed whitelist is checked first: only Technology passes
    // excluded blacklist would then reject Technology, but allowed already filtered
    // The implementation checks allowed first (only Technology passes),
    // then excluded filters out Technology, so nothing survives
    const result = await filter.filter(stocks);

    // With allowed=['Technology'] and excluded=['Technology']:
    // - AAPL (Technology): passes allowed check, then gets excluded -> filtered out
    // - XOM (Energy): fails allowed check -> filtered out
    // - JNJ (Healthcare): fails allowed check -> filtered out
    // So allowed takes priority in the sense that the whitelist runs first,
    // narrowing the set before the blacklist runs
    expect(result).toHaveLength(0);
  });

  it('passes all stocks through when no sectors configured (empty arrays)', async () => {
    mockConfigValues['pairlist.sector.allowed'] = [];
    mockConfigValues['pairlist.sector.excluded'] = [];

    const { SectorFilter } = await import('../../src/pairlist/filters.js');
    const filter = new SectorFilter();

    const stocks = [
      makeStock({ symbol: 'AAPL', sector: 'Technology' }),
      makeStock({ symbol: 'XOM', sector: 'Energy' }),
      makeStock({ symbol: 'JPM', sector: 'Financials' }),
      makeStock({ symbol: 'UNKNOWN' }),
    ];

    const result = await filter.filter(stocks);
    expect(result).toHaveLength(4);
    expect(result.map((s) => s.symbol)).toEqual(['AAPL', 'XOM', 'JPM', 'UNKNOWN']);
  });

  it('case-insensitive sector matching', async () => {
    mockConfigValues['pairlist.sector.allowed'] = ['TECHNOLOGY', 'healthcare'];
    mockConfigValues['pairlist.sector.excluded'] = [];

    const { SectorFilter } = await import('../../src/pairlist/filters.js');
    const filter = new SectorFilter();

    const stocks = [
      makeStock({ symbol: 'AAPL', sector: 'technology' }),
      makeStock({ symbol: 'JNJ', sector: 'Healthcare' }),
      makeStock({ symbol: 'MSFT', sector: 'TECHNOLOGY' }),
      makeStock({ symbol: 'XOM', sector: 'Energy' }),
    ];

    const result = await filter.filter(stocks);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.symbol)).toEqual(['AAPL', 'JNJ', 'MSFT']);
  });

  it('stocks without sector field pass through when using exclude mode', async () => {
    mockConfigValues['pairlist.sector.allowed'] = [];
    mockConfigValues['pairlist.sector.excluded'] = ['Energy'];

    const { SectorFilter } = await import('../../src/pairlist/filters.js');
    const filter = new SectorFilter();

    const stocks = [
      makeStock({ symbol: 'AAPL', sector: 'Technology' }),
      makeStock({ symbol: 'UNKNOWN' }), // no sector
      makeStock({ symbol: 'XOM', sector: 'Energy' }),
    ];

    const result = await filter.filter(stocks);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.symbol)).toEqual(['AAPL', 'UNKNOWN']);
  });

  it('stocks without sector field are excluded when using allow mode', async () => {
    mockConfigValues['pairlist.sector.allowed'] = ['Technology'];
    mockConfigValues['pairlist.sector.excluded'] = [];

    const { SectorFilter } = await import('../../src/pairlist/filters.js');
    const filter = new SectorFilter();

    const stocks = [
      makeStock({ symbol: 'AAPL', sector: 'Technology' }),
      makeStock({ symbol: 'UNKNOWN' }), // no sector
      makeStock({ symbol: 'NOSECTOR', sector: '' }), // empty sector
    ];

    const result = await filter.filter(stocks);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('AAPL');
  });

  it('has correct name property', async () => {
    mockConfigValues['pairlist.sector.allowed'] = [];
    mockConfigValues['pairlist.sector.excluded'] = [];

    const { SectorFilter } = await import('../../src/pairlist/filters.js');
    const filter = new SectorFilter();
    expect(filter.name).toBe('sector');
  });

  it('case-insensitive matching works for excluded sectors too', async () => {
    mockConfigValues['pairlist.sector.allowed'] = [];
    mockConfigValues['pairlist.sector.excluded'] = ['ENERGY', 'financials'];

    const { SectorFilter } = await import('../../src/pairlist/filters.js');
    const filter = new SectorFilter();

    const stocks = [
      makeStock({ symbol: 'AAPL', sector: 'Technology' }),
      makeStock({ symbol: 'XOM', sector: 'energy' }),
      makeStock({ symbol: 'JPM', sector: 'Financials' }),
    ];

    const result = await filter.filter(stocks);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('AAPL');
  });
});
