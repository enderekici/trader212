import axios, { type AxiosInstance } from 'axios';
import { configManager } from '../config/manager.js';
import { sleep } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';
import type { OHLCVCandle } from './yahoo-finance.js';

const log = createLogger('alpaca');

const DATA_BASE_URL = 'https://data.alpaca.markets';
const RATE_LIMIT_PER_MINUTE = 200;

export interface AlpacaBar {
  t: string; // timestamp ISO 8601
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
  n: number; // number of trades
  vw: number; // volume-weighted avg price
}

export interface AlpacaSnapshot {
  latestTrade: { t: string; p: number; s: number } | null;
  latestQuote: {
    bp: number; // bid price
    ap: number; // ask price
    bs: number; // bid size
    as: number; // ask size
    t: string;
  } | null;
  minuteBar: AlpacaBar | null;
  dailyBar: AlpacaBar | null;
  prevDailyBar: AlpacaBar | null;
}

export interface AlpacaQuote {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  timestamp: string;
}

export interface AlpacaNewsArticle {
  id: number;
  headline: string;
  summary: string;
  url: string;
  source: string;
  symbols: string[];
  createdAt: string;
}

// Shared across all AlpacaClient instances
const sharedCallTimestamps: number[] = [];

export class AlpacaClient {
  private client: AxiosInstance;

  constructor() {
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;

    if (!apiKey || !apiSecret) {
      throw new Error(
        'ALPACA_API_KEY and ALPACA_API_SECRET environment variables are required',
      );
    }

    this.client = axios.create({
      baseURL: DATA_BASE_URL,
      timeout: 15_000,
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
      },
    });

    log.info('Alpaca client initialized');
  }

  /**
   * Get historical bars for a symbol.
   * Handles pagination via next_page_token.
   */
  async getHistoricalBars(
    symbol: string,
    start: string,
    end: string,
    timeframe = '1Day',
  ): Promise<OHLCVCandle[]> {
    const allCandles: OHLCVCandle[] = [];
    let pageToken: string | undefined;

    const feed = this.getFeed();

    do {
      await this.rateLimit();

      const params: Record<string, string> = {
        start,
        end,
        timeframe,
        feed,
        limit: '10000',
        adjustment: 'split',
      };
      if (pageToken) params.page_token = pageToken;

      const resp = await this.client.get(`/v2/stocks/${symbol}/bars`, { params });
      const bars: AlpacaBar[] = resp.data.bars ?? [];

      for (const bar of bars) {
        allCandles.push({
          date: bar.t.split('T')[0],
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v,
        });
      }

      pageToken = resp.data.next_page_token ?? undefined;
    } while (pageToken);

    log.debug({ symbol, count: allCandles.length, start, end }, 'Historical bars fetched');
    return allCandles;
  }

  /**
   * Get snapshots for multiple symbols in one request (up to 50 per batch).
   */
  async getSnapshots(symbols: string[]): Promise<Map<string, AlpacaSnapshot>> {
    const result = new Map<string, AlpacaSnapshot>();
    const feed = this.getFeed();

    // Alpaca allows up to ~200 symbols per request; batch in 50s to be safe
    for (let i = 0; i < symbols.length; i += 50) {
      const batch = symbols.slice(i, i + 50);
      await this.rateLimit();

      const resp = await this.client.get('/v2/stocks/snapshots', {
        params: { symbols: batch.join(','), feed },
      });

      const data = resp.data as Record<string, AlpacaSnapshot>;
      for (const [sym, snapshot] of Object.entries(data)) {
        result.set(sym, snapshot);
      }
    }

    log.debug({ symbolCount: symbols.length, found: result.size }, 'Snapshots fetched');
    return result;
  }

  /**
   * Get latest quotes for multiple symbols.
   */
  async getLatestQuotes(symbols: string[]): Promise<Map<string, AlpacaQuote>> {
    const result = new Map<string, AlpacaQuote>();
    const feed = this.getFeed();

    await this.rateLimit();

    const resp = await this.client.get('/v2/stocks/quotes/latest', {
      params: { symbols: symbols.join(','), feed },
    });

    const quotes = resp.data.quotes as Record<
      string,
      { bp: number; ap: number; bs: number; as: number; t: string }
    >;

    if (quotes) {
      for (const [sym, q] of Object.entries(quotes)) {
        result.set(sym, {
          symbol: sym,
          bidPrice: q.bp,
          askPrice: q.ap,
          bidSize: q.bs,
          askSize: q.as,
          timestamp: q.t,
        });
      }
    }

    return result;
  }

  /**
   * Get latest news articles, optionally filtered by symbols.
   */
  async getNews(symbols?: string[], limit = 50): Promise<AlpacaNewsArticle[]> {
    await this.rateLimit();

    const params: Record<string, string | number> = { limit };
    if (symbols && symbols.length > 0) {
      params.symbols = symbols.join(',');
    }

    const resp = await this.client.get('/v1beta1/news', { params });
    const articles = resp.data.news ?? [];

    return articles.map(
      (a: {
        id: number;
        headline: string;
        summary: string;
        url: string;
        source: string;
        symbols: string[];
        created_at: string;
      }) => ({
        id: a.id,
        headline: a.headline,
        summary: a.summary,
        url: a.url,
        source: a.source,
        symbols: a.symbols ?? [],
        createdAt: a.created_at,
      }),
    );
  }

  /**
   * Get latest bars for multiple symbols.
   */
  async getLatestBars(symbols: string[]): Promise<Map<string, AlpacaBar>> {
    const result = new Map<string, AlpacaBar>();
    const feed = this.getFeed();

    await this.rateLimit();

    const resp = await this.client.get('/v2/stocks/bars/latest', {
      params: { symbols: symbols.join(','), feed },
    });

    const bars = resp.data.bars as Record<string, AlpacaBar>;
    if (bars) {
      for (const [sym, bar] of Object.entries(bars)) {
        result.set(sym, bar);
      }
    }

    return result;
  }

  /** Read feed config (iex or sip) */
  private getFeed(): string {
    try {
      return configManager.get<string>('data.alpaca.feed');
    } catch {
      return 'iex';
    }
  }

  /** Simple sliding-window rate limiter (200 req/min) */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const windowStart = now - 60_000;

    // Remove timestamps older than 1 minute
    while (sharedCallTimestamps.length > 0 && sharedCallTimestamps[0] < windowStart) {
      sharedCallTimestamps.shift();
    }

    if (sharedCallTimestamps.length >= RATE_LIMIT_PER_MINUTE) {
      const oldestInWindow = sharedCallTimestamps[0];
      const waitMs = oldestInWindow + 60_000 - now + 50;
      log.debug({ waitMs }, 'Alpaca rate limit reached, waiting');
      await sleep(waitMs);
    }

    sharedCallTimestamps.push(Date.now());
  }
}
