import { configManager } from '../config/manager.js';
import {
  BlacklistFilter,
  MarketCapFilter,
  MaxPairsFilter,
  PriceFilter,
  VolatilityFilter,
  VolumeFilter,
} from './filters.js';
import type { PairlistFilter } from './filters.js';
import { PairlistPipeline } from './pipeline.js';

const filterMap: Record<string, () => PairlistFilter> = {
  volume: () => new VolumeFilter(),
  price: () => new PriceFilter(),
  marketCap: () => new MarketCapFilter(),
  volatility: () => new VolatilityFilter(),
  blacklist: () => new BlacklistFilter(),
  maxPairs: () => new MaxPairsFilter(),
};

export function createPairlistPipeline(): PairlistPipeline {
  const filterNames = configManager.get<string[]>('pairlist.filters');

  const filters: PairlistFilter[] = [];
  for (const name of filterNames) {
    const factory = filterMap[name];
    if (factory) {
      filters.push(factory());
    } else {
      throw new Error(`Unknown pairlist filter: ${name}`);
    }
  }

  return new PairlistPipeline(filters);
}

export { PairlistPipeline } from './pipeline.js';
export type { StockInfo, PairlistFilter } from './filters.js';
export {
  VolumeFilter,
  PriceFilter,
  MarketCapFilter,
  VolatilityFilter,
  BlacklistFilter,
  MaxPairsFilter,
} from './filters.js';
