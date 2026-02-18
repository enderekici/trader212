import { createLogger } from '../utils/logger.js';

const log = createLogger('stocktwits');

export interface StockTwitsData {
  symbol: string;
  bullishCount: number;
  bearishCount: number;
  totalMessages: number;
  watchlistCount: number;
  sentimentRatio: number | null;
  fetchedAt: string;
}

export class StockTwitsClient {
  async getSymbolData(symbol: string): Promise<StockTwitsData | null> {
    try {
      const url = `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(symbol)}.json`;
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });

      if (!response.ok) {
        log.warn({ symbol, status: response.status }, 'StockTwits request failed');
        return null;
      }

      const json = (await response.json()) as {
        messages?: Array<{
          entities?: { sentiment?: { basic?: string } };
        }>;
        symbol?: { watchlist_count?: number };
      };
      const messages = json?.messages ?? [];
      const watchlistCount: number = json?.symbol?.watchlist_count ?? 0;

      let bullish = 0;
      let bearish = 0;
      for (const msg of messages) {
        const sentiment = msg?.entities?.sentiment?.basic;
        if (sentiment === 'Bullish') bullish++;
        else if (sentiment === 'Bearish') bearish++;
      }

      const tagged = bullish + bearish;
      return {
        symbol,
        bullishCount: bullish,
        bearishCount: bearish,
        totalMessages: messages.length,
        watchlistCount,
        sentimentRatio: tagged > 0 ? bullish / tagged : null,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      log.warn({ symbol, err }, 'StockTwits fetch failed');
      return null;
    }
  }

  async getBatch(symbols: string[]): Promise<Map<string, StockTwitsData>> {
    const result = new Map<string, StockTwitsData>();
    for (const sym of symbols) {
      const data = await this.getSymbolData(sym);
      if (data) result.set(sym, data);
      await new Promise((r) => setTimeout(r, 200));
    }
    return result;
  }
}

let instance: StockTwitsClient | null = null;
export function getStockTwitsClient(): StockTwitsClient {
  if (!instance) instance = new StockTwitsClient();
  return instance;
}
