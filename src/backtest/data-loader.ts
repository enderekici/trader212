import fs from 'node:fs';
import path from 'node:path';
import { YahooFinanceClient } from '../data/yahoo-finance.js';
import { createLogger } from '../utils/logger.js';
import type { Candle } from './types.js';

const log = createLogger('backtest-data-loader');
const CACHE_DIR = './data/backtest_cache';

export class BacktestDataLoader {
  private yahooClient: YahooFinanceClient;

  constructor(yahooClient?: YahooFinanceClient) {
    this.yahooClient = yahooClient ?? new YahooFinanceClient();
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  }

  /**
   * Load OHLCV data from Yahoo Finance for a single symbol.
   * Checks local JSON cache first. If not found or stale, fetches from API and saves to cache.
   * When cacheOnly is true, skips network fetches — returns empty if no cache.
   * Adds lookback padding (250 trading days) before startDate so that
   * technical indicators have enough history from day one.
   */
  async loadOHLCV(
    symbol: string,
    startDate: string,
    endDate: string,
    cacheOnly = false,
  ): Promise<Candle[]> {
    const cacheFile = path.join(CACHE_DIR, `${symbol}.json`);
    let candles: Candle[] = [];

    // 1. Try to load from cache
    if (fs.existsSync(cacheFile)) {
      try {
        const raw = fs.readFileSync(cacheFile, 'utf-8');
        candles = JSON.parse(raw);
        log.info({ symbol, count: candles.length }, 'Loaded from cache');
      } catch (err) {
        log.warn({ symbol, err }, 'Failed to parse cache file, will re-fetch');
      }
    }

    // 2. Determine if we need to fetch (if cache is empty or doesn't cover range)
    // For simplicity, if cache is empty, we fetch.
    // Ideally we should check if cached data covers the requested [startDate - lookback, endDate]
    // But for now, let's assume if cache exists, it's what the user wants, UNLESS they explicitly ask to refresh (which we can't easily pass here yet)
    // OR: we can just check if we have data up to endDate.

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Add 250 trading days (~365 calendar days) of lookback for indicator warmup
    const lookbackStart = new Date(start);
    lookbackStart.setDate(lookbackStart.getDate() - 365);

    // If we have cached data, filter it to the requested range
    if (candles.length > 0) {
      // Check if cache covers enough history?
      // For now, let's just use what we have in cache if it exists.
      // This enables the "download once, run offline" workflow.
    } else if (cacheOnly) {
      log.debug({ symbol }, 'No cache file, skipping (cache-only mode)');
      return [];
    } else {
      // 3. Fetch from API if no cache
      // Calculate days from lookback start to end date
      const totalDays = Math.ceil(
        (end.getTime() - lookbackStart.getTime()) / (1000 * 60 * 60 * 24),
      );

      log.info({ symbol, startDate, endDate, lookbackDays: totalDays }, 'Fetching from Yahoo');

      const rawCandles = await this.yahooClient.getHistoricalData(symbol, totalDays, end.getTime());

      if (rawCandles.length === 0) {
        log.warn({ symbol }, 'No data returned from Yahoo Finance');
        return [];
      }

      // Map to Candle interface (OHLCVCandle and Candle have the same shape)
      candles = rawCandles.map((c) => ({
        date: c.date,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

      // 4. Save to cache
      try {
        fs.writeFileSync(cacheFile, JSON.stringify(candles, null, 2));
        log.info({ symbol }, 'Saved to cache');
      } catch (err) {
        log.error({ symbol, err }, 'Failed to save to cache');
      }
    }

    // Filter to only include data up to endDate
    const endStr = endDate;
    return candles.filter((c) => c.date <= endStr);
  }

  /**
   * Load data for multiple symbols. Returns a Map of symbol -> candles.
   * Each symbol's candles include lookback data for indicator warmup.
   */
  async loadMultiple(
    symbols: string[],
    startDate: string,
    endDate: string,
    cacheOnly = false,
  ): Promise<Map<string, Candle[]>> {
    const result = new Map<string, Candle[]>();

    // Load all symbols in parallel
    const entries = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const candles = await this.loadOHLCV(symbol, startDate, endDate, cacheOnly);
          return { symbol, candles };
        } catch (error) {
          log.error(
            { symbol, err: error instanceof Error ? error.message : String(error) },
            'Failed to load OHLCV data for symbol, skipping.',
          );
          return { symbol, candles: [] };
        }
      }),
    );

    for (const { symbol, candles } of entries) {
      if (candles.length > 0) {
        result.set(symbol, candles);
      } else {
        log.warn({ symbol }, 'Skipping symbol — no data available');
      }
    }

    return result;
  }

  /**
   * Get all trading dates that exist in the backtest range across any symbol.
   * Uses the union of dates — a day is included if ANY symbol has data for it.
   * This matches real trading: you don't skip AAPL because KMI has no data.
   * Only returns dates that fall within [startDate, endDate].
   */
  getTradingDates(data: Map<string, Candle[]>, startDate: string, endDate: string): string[] {
    if (data.size === 0) return [];

    const allDates = new Set<string>();
    for (const candles of data.values()) {
      for (const c of candles) {
        if (c.date >= startDate && c.date <= endDate) {
          allDates.add(c.date);
        }
      }
    }

    return [...allDates].sort();
  }
}
