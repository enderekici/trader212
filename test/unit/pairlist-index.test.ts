import { describe, expect, it, vi, beforeEach } from 'vitest';

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
  getDb: () => ({
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        run: vi.fn(),
      })),
    })),
  }),
}));

vi.mock('../../src/db/schema.js', () => ({
  pairlistHistory: {},
}));

describe('pairlist/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockConfigValues)) {
      delete mockConfigValues[key];
    }
  });

  describe('createPairlistPipeline', () => {
    it('creates a pipeline with configured filters', async () => {
      mockConfigValues['pairlist.filters'] = ['volume', 'price', 'blacklist'];

      const { createPairlistPipeline } = await import('../../src/pairlist/index.js');
      const pipeline = createPairlistPipeline();
      expect(pipeline).toBeDefined();
    });

    it('creates a pipeline with all filter types', async () => {
      mockConfigValues['pairlist.filters'] = [
        'volume', 'price', 'marketCap', 'volatility', 'blacklist', 'maxPairs'
      ];

      const { createPairlistPipeline } = await import('../../src/pairlist/index.js');
      const pipeline = createPairlistPipeline();
      expect(pipeline).toBeDefined();
    });

    it('throws for unknown filter name', async () => {
      mockConfigValues['pairlist.filters'] = ['unknownFilter'];

      const { createPairlistPipeline } = await import('../../src/pairlist/index.js');
      expect(() => createPairlistPipeline()).toThrow('Unknown pairlist filter: unknownFilter');
    });

    it('creates pipeline with empty filter list', async () => {
      mockConfigValues['pairlist.filters'] = [];

      const { createPairlistPipeline } = await import('../../src/pairlist/index.js');
      const pipeline = createPairlistPipeline();
      expect(pipeline).toBeDefined();
    });
  });

  describe('exports', () => {
    it('re-exports PairlistPipeline', async () => {
      const mod = await import('../../src/pairlist/index.js');
      expect(mod.PairlistPipeline).toBeDefined();
    });

    it('re-exports VolumeFilter', async () => {
      const mod = await import('../../src/pairlist/index.js');
      expect(mod.VolumeFilter).toBeDefined();
    });

    it('re-exports PriceFilter', async () => {
      const mod = await import('../../src/pairlist/index.js');
      expect(mod.PriceFilter).toBeDefined();
    });

    it('re-exports MarketCapFilter', async () => {
      const mod = await import('../../src/pairlist/index.js');
      expect(mod.MarketCapFilter).toBeDefined();
    });

    it('re-exports VolatilityFilter', async () => {
      const mod = await import('../../src/pairlist/index.js');
      expect(mod.VolatilityFilter).toBeDefined();
    });

    it('re-exports BlacklistFilter', async () => {
      const mod = await import('../../src/pairlist/index.js');
      expect(mod.BlacklistFilter).toBeDefined();
    });

    it('re-exports MaxPairsFilter', async () => {
      const mod = await import('../../src/pairlist/index.js');
      expect(mod.MaxPairsFilter).toBeDefined();
    });
  });
});
