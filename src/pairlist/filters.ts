import { and, isNotNull } from 'drizzle-orm';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import { trades } from '../db/schema.js';
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

export class PerformanceFilter implements PairlistFilter {
  readonly name = 'performance';

  async filter(stocks: StockInfo[]): Promise<StockInfo[]> {
    const enabled = configManager.get<boolean>('pairlist.performance.enabled');
    if (!enabled) {
      return stocks;
    }

    const minWinRate = configManager.get<number>('pairlist.performance.minWinRate');
    const minTrades = configManager.get<number>('pairlist.performance.minTrades');
    const db = getDb();

    // Get all closed trades within lookback period
    const allTrades = db
      .select({
        symbol: trades.symbol,
        pnlPct: trades.pnlPct,
      })
      .from(trades)
      .where(and(isNotNull(trades.exitTime), isNotNull(trades.pnlPct)))
      .all();

    // Group by symbol and calculate performance metrics
    const performanceBySymbol = new Map<string, { wins: number; total: number; cumPnl: number }>();

    for (const trade of allTrades) {
      const symbol = trade.symbol;
      const pnl = trade.pnlPct ?? 0;

      if (!performanceBySymbol.has(symbol)) {
        performanceBySymbol.set(symbol, { wins: 0, total: 0, cumPnl: 0 });
      }

      const stats = performanceBySymbol.get(symbol);
      if (stats) {
        stats.total += 1;
        stats.cumPnl += pnl;
        if (pnl > 0) {
          stats.wins += 1;
        }
      }
    }

    const filtered = stocks.filter((stock) => {
      const stats = performanceBySymbol.get(stock.symbol);

      // If no trade history, allow it
      if (!stats || stats.total < minTrades) {
        return true;
      }

      const winRate = stats.wins / stats.total;

      // Filter out if win rate is below threshold
      return winRate >= minWinRate;
    });

    const removed = stocks.length - filtered.length;
    if (removed > 0) {
      log.info(
        { removed, minWinRate, minTrades, remaining: filtered.length },
        'PerformanceFilter applied',
      );
    }

    return filtered;
  }
}

export class SectorFilter implements PairlistFilter {
  readonly name = 'sector';

  async filter(stocks: StockInfo[]): Promise<StockInfo[]> {
    const allowed = configManager.get<string[]>('pairlist.sector.allowed');
    const excluded = configManager.get<string[]>('pairlist.sector.excluded');

    const allowedSet = new Set(allowed.map((s) => s.toLowerCase()));
    const excludedSet = new Set(excluded.map((s) => s.toLowerCase()));

    const filtered = stocks.filter((stock) => {
      const sector = (stock.sector ?? '').toLowerCase();

      // If whitelist is set, only allow those sectors
      if (allowedSet.size > 0) {
        if (!sector || !allowedSet.has(sector)) return false;
      }

      // If blacklist is set, exclude those sectors
      if (excludedSet.size > 0) {
        if (sector && excludedSet.has(sector)) return false;
      }

      return true;
    });

    const removed = stocks.length - filtered.length;
    if (removed > 0) {
      log.info(
        {
          removed,
          allowedCount: allowed.length,
          excludedCount: excluded.length,
          remaining: filtered.length,
        },
        'SectorFilter applied',
      );
    }
    return filtered;
  }
}
