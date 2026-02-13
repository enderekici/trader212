import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('pairlist-filters');

export interface StockInfo {
  symbol: string;
  t212Ticker: string;
  name: string;
  price?: number;
  volume?: number;
  marketCap?: number;
  volatility?: number;
  sector?: string;
}

export interface PairlistFilter {
  name: string;
  filter(stocks: StockInfo[]): Promise<StockInfo[]>;
}

export class VolumeFilter implements PairlistFilter {
  readonly name = 'volume';

  async filter(stocks: StockInfo[]): Promise<StockInfo[]> {
    const minVolume = configManager.get<number>('pairlist.volume.minAvgDailyVolume');
    const topN = configManager.get<number>('pairlist.volume.topN');

    const filtered = stocks
      .filter((s) => s.volume != null && s.volume >= minVolume)
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, topN);

    const removed = stocks.length - filtered.length;
    log.info({ removed, minVolume, topN, remaining: filtered.length }, 'VolumeFilter applied');
    return filtered;
  }
}

export class PriceFilter implements PairlistFilter {
  readonly name = 'price';

  async filter(stocks: StockInfo[]): Promise<StockInfo[]> {
    const min = configManager.get<number>('pairlist.price.min');
    const max = configManager.get<number>('pairlist.price.max');

    const filtered = stocks.filter((s) => {
      if (s.price == null) return false;
      return s.price >= min && s.price <= max;
    });

    const removed = stocks.length - filtered.length;
    log.info({ removed, min, max, remaining: filtered.length }, 'PriceFilter applied');
    return filtered;
  }
}

export class MarketCapFilter implements PairlistFilter {
  readonly name = 'marketCap';

  async filter(stocks: StockInfo[]): Promise<StockInfo[]> {
    const minBillions = configManager.get<number>('pairlist.marketCap.minBillions');
    const minCap = minBillions * 1e9;

    const filtered = stocks.filter((s) => {
      if (s.marketCap == null) return false;
      return s.marketCap >= minCap;
    });

    const removed = stocks.length - filtered.length;
    log.info({ removed, minBillions, remaining: filtered.length }, 'MarketCapFilter applied');
    return filtered;
  }
}

export class VolatilityFilter implements PairlistFilter {
  readonly name = 'volatility';

  async filter(stocks: StockInfo[]): Promise<StockInfo[]> {
    const minPct = configManager.get<number>('pairlist.volatility.minDailyPct');
    const maxPct = configManager.get<number>('pairlist.volatility.maxDailyPct');

    const filtered = stocks.filter((s) => {
      if (s.volatility == null) return false;
      return s.volatility >= minPct && s.volatility <= maxPct;
    });

    const removed = stocks.length - filtered.length;
    log.info({ removed, minPct, maxPct, remaining: filtered.length }, 'VolatilityFilter applied');
    return filtered;
  }
}

export class BlacklistFilter implements PairlistFilter {
  readonly name = 'blacklist';

  async filter(stocks: StockInfo[]): Promise<StockInfo[]> {
    const blacklist = configManager.get<string[]>('pairlist.blacklist');
    const blacklistSet = new Set(blacklist.map((s) => s.toUpperCase()));

    const filtered = stocks.filter((s) => !blacklistSet.has(s.symbol.toUpperCase()));

    const removed = stocks.length - filtered.length;
    if (removed > 0) {
      log.info(
        { removed, blacklisted: blacklist, remaining: filtered.length },
        'BlacklistFilter applied',
      );
    }
    return filtered;
  }
}

export class MaxPairsFilter implements PairlistFilter {
  readonly name = 'maxPairs';

  async filter(stocks: StockInfo[]): Promise<StockInfo[]> {
    const maxPairs = configManager.get<number>('pairlist.maxPairs');

    const filtered = stocks.slice(0, maxPairs);

    const removed = stocks.length - filtered.length;
    log.info({ removed, maxPairs, remaining: filtered.length }, 'MaxPairsFilter applied');
    return filtered;
  }
}
