import { configManager } from '../config/manager.js';
import type { TickerMapper } from '../data/ticker-mapper.js';
import type { PairlistFilter } from './filters.js';
import {
  BlacklistFilter,
  MarketCapFilter,
  MaxPairsFilter,
  PerformanceFilter,
  PriceFilter,
  SectorFilter,
  T212Filter,
  VolatilityFilter,
  VolumeFilter,
} from './filters.js';
import { PairlistPipeline } from './pipeline.js';

export function createPairlistPipeline(tickerMapper?: TickerMapper): PairlistPipeline {
  const filterMap: Record<string, () => PairlistFilter> = {
    volume: () => new VolumeFilter(),
    price: () => new PriceFilter(),
    marketCap: () => new MarketCapFilter(),
    volatility: () => new VolatilityFilter(),
    blacklist: () => new BlacklistFilter(),
    maxPairs: () => new MaxPairsFilter(),
    performance: () => new PerformanceFilter(),
    sector: () => new SectorFilter(),
    ...(tickerMapper ? { t212: () => new T212Filter(tickerMapper) } : {}),
  };

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

export type { PairlistFilter, StockInfo } from './filters.js';
export {
  BlacklistFilter,
  MarketCapFilter,
  MaxPairsFilter,
  PerformanceFilter,
  PriceFilter,
  SectorFilter,
  T212Filter,
  VolatilityFilter,
  VolumeFilter,
} from './filters.js';
export { PairlistPipeline } from './pipeline.js';
