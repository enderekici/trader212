import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import { pairlistHistory } from '../db/schema.js';
import { createLogger } from '../utils/logger.js';
import type { PairlistFilter, StockInfo } from './filters.js';

const log = createLogger('pairlist-pipeline');

type PairlistMode = 'dynamic' | 'static' | 'hybrid';

export class PairlistPipeline {
  private filters: PairlistFilter[];
  private cache: { stocks: StockInfo[]; timestamp: number } | null = null;
  private lastFilterStats: Record<string, number> = {};

  constructor(filters: PairlistFilter[]) {
    this.filters = filters;
  }

  /** Read pairlist mode from config (default: dynamic) */
  private getMode(): PairlistMode {
    try {
      return configManager.get<PairlistMode>('pairlist.mode');
    } catch {
      return 'dynamic';
    }
  }

  /** Read static symbols from config (default: empty array) */
  private getStaticSymbols(): string[] {
    try {
      return configManager.get<string[]>('pairlist.staticSymbols');
    } catch {
      return [];
    }
  }

  /** Convert a symbol string into a minimal StockInfo object */
  private symbolToStockInfo(symbol: string): StockInfo {
    return {
      symbol: symbol.toUpperCase(),
      t212Ticker: symbol.toUpperCase(),
      name: symbol.toUpperCase(),
    };
  }

  async run(stocks: StockInfo[]): Promise<StockInfo[]> {
    const mode = this.getMode();
    log.info(
      { inputCount: stocks.length, filterCount: this.filters.length, mode },
      'Running pairlist pipeline',
    );

    let result: StockInfo[];

    switch (mode) {
      case 'static':
        result = this.runStatic();
        break;
      case 'hybrid':
        result = await this.runHybrid(stocks);
        break;
      default:
        result = await this.runDynamic(stocks);
        break;
    }

    this.cache = { stocks: result, timestamp: Date.now() };

    log.info(
      {
        outputCount: result.length,
        stats: this.lastFilterStats,
        symbols: result.map((s) => s.symbol),
        mode,
      },
      'Pairlist pipeline complete',
    );

    this.saveToDB(result, this.lastFilterStats);

    return result;
  }

  /** Static mode: use only the configured static symbols, skip all filters */
  private runStatic(): StockInfo[] {
    const symbols = this.getStaticSymbols();
    this.lastFilterStats = { static: 0 };

    log.info({ symbols }, 'Static mode: using configured symbols only');

    return symbols.map((s) => this.symbolToStockInfo(s));
  }

  /** Dynamic mode: current behavior - run all filters on the input */
  private async runDynamic(stocks: StockInfo[]): Promise<StockInfo[]> {
    let current = [...stocks];
    const stats: Record<string, number> = {};

    for (const filter of this.filters) {
      const before = current.length;
      try {
        current = await filter.filter(current);
      } catch (err) {
        log.error({ filter: filter.name, err }, 'Filter threw an error, skipping');
        continue;
      }
      stats[filter.name] = before - current.length;
    }

    this.lastFilterStats = stats;
    return current;
  }

  /** Hybrid mode: static symbols always included + filtered dynamic symbols up to maxPairs */
  private async runHybrid(stocks: StockInfo[]): Promise<StockInfo[]> {
    const staticSymbols = this.getStaticSymbols();
    const staticSet = new Set(staticSymbols.map((s) => s.toUpperCase()));

    // Build StockInfo objects for static symbols.
    // Prefer existing StockInfo from the input if available (richer data).
    const staticStocks: StockInfo[] = staticSymbols.map((sym) => {
      const upper = sym.toUpperCase();
      const existing = stocks.find((s) => s.symbol.toUpperCase() === upper);
      return existing ?? this.symbolToStockInfo(sym);
    });

    // Remove static symbols from the dynamic pool before filtering
    const dynamicPool = stocks.filter((s) => !staticSet.has(s.symbol.toUpperCase()));

    // Run filters on the dynamic pool only
    let filteredDynamic = [...dynamicPool];
    const stats: Record<string, number> = {};

    for (const filter of this.filters) {
      const before = filteredDynamic.length;
      try {
        filteredDynamic = await filter.filter(filteredDynamic);
      } catch (err) {
        log.error({ filter: filter.name, err }, 'Filter threw an error, skipping');
        continue;
      }
      stats[filter.name] = before - filteredDynamic.length;
    }

    stats.static_protected = staticStocks.length;
    this.lastFilterStats = stats;

    // Determine maxPairs to cap total output
    let maxPairs: number;
    try {
      maxPairs = configManager.get<number>('pairlist.maxPairs');
    } catch {
      maxPairs = Number.POSITIVE_INFINITY;
    }

    // Merge: static symbols first (always included), then dynamic up to maxPairs total
    const dynamicSlots = Math.max(0, maxPairs - staticStocks.length);
    const mergedDynamic = filteredDynamic.slice(0, dynamicSlots);

    log.info(
      { staticCount: staticStocks.length, dynamicCount: mergedDynamic.length, maxPairs },
      'Hybrid mode: merged static + filtered dynamic',
    );

    return [...staticStocks, ...mergedDynamic];
  }

  getActiveStocks(): StockInfo[] | null {
    if (!this.cache) return null;

    const refreshMinutes = configManager.get<number>('pairlist.refreshMinutes');
    const maxAge = refreshMinutes * 60 * 1000;

    if (Date.now() - this.cache.timestamp > maxAge) {
      log.debug('Pairlist cache expired');
      return null;
    }

    return this.cache.stocks;
  }

  getFilterStats(): Record<string, number> {
    return { ...this.lastFilterStats };
  }

  private saveToDB(stocks: StockInfo[], stats: Record<string, number>): void {
    try {
      const db = getDb();
      db.insert(pairlistHistory)
        .values({
          timestamp: new Date().toISOString(),
          symbols: JSON.stringify(stocks.map((s) => s.symbol)),
          filterStats: JSON.stringify(stats),
        })
        .run();
    } catch (err) {
      log.error({ err }, 'Failed to save pairlist history');
    }
  }
}
