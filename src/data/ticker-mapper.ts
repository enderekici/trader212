import { createLogger } from '../utils/logger.js';

const log = createLogger('ticker-mapper');

export interface StockInfo {
  symbol: string;
  t212Ticker: string;
  name: string;
  minTradeQuantity?: number;
}

/** Minimal interface for the Trading212 client — avoids hard dependency on the implementation. */
export interface Trading212ClientLike {
  getInstruments(): Promise<
    Array<{
      ticker: string;
      name: string;
      shortName?: string;
      minTradeQuantity?: number;
      type?: string;
    }>
  >;
}

export class TickerMapper {
  private symbolToT212 = new Map<string, string>();
  private t212ToSymbol = new Map<string, string>();
  private stockInfoMap = new Map<string, StockInfo>();
  private loaded = false;

  constructor(private t212Client: Trading212ClientLike) {}

  async load(): Promise<void> {
    try {
      const instruments = await this.t212Client.getInstruments();

      this.symbolToT212.clear();
      this.t212ToSymbol.clear();
      this.stockInfoMap.clear();

      for (const inst of instruments) {
        if (!inst.ticker.endsWith('_US_EQ')) continue;

        const symbol = inst.ticker.replace(/_US_EQ$/, '');

        this.symbolToT212.set(symbol, inst.ticker);
        this.t212ToSymbol.set(inst.ticker, symbol);
        this.stockInfoMap.set(symbol, {
          symbol,
          t212Ticker: inst.ticker,
          name: inst.name ?? inst.shortName ?? symbol,
          minTradeQuantity: inst.minTradeQuantity,
        });
      }

      this.loaded = true;
      log.info({ count: this.stockInfoMap.size }, 'Ticker map loaded');
    } catch (err) {
      log.error({ err }, 'Failed to load instruments — will retry on next pairlist refresh');
      // Don't throw — bot should start even if T212 is temporarily unavailable
    }
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      log.warn('TickerMapper not loaded yet — returning empty results');
    }
  }

  toT212Ticker(symbol: string): string | null {
    this.ensureLoaded();
    return this.symbolToT212.get(symbol) ?? null;
  }

  toSymbol(t212Ticker: string): string | null {
    this.ensureLoaded();
    return this.t212ToSymbol.get(t212Ticker) ?? null;
  }

  isAvailable(symbol: string): boolean {
    this.ensureLoaded();
    return this.symbolToT212.has(symbol);
  }

  getUSEquities(): StockInfo[] {
    this.ensureLoaded();
    return Array.from(this.stockInfoMap.values());
  }

  getStockInfo(symbol: string): StockInfo | null {
    this.ensureLoaded();
    return this.stockInfoMap.get(symbol) ?? null;
  }
}
