import { YahooFinanceClient } from '../data/yahoo-finance.js';
import { createLogger } from '../utils/logger.js';
import type { Candle } from './types.js';

const log = createLogger('backtest-data-loader');

export class BacktestDataLoader {
  private yahooClient: YahooFinanceClient;

  constructor(yahooClient?: YahooFinanceClient) {
    this.yahooClient = yahooClient ?? new YahooFinanceClient();
  }

  /**
   * Load OHLCV data from Yahoo Finance for a single symbol.
   * Adds lookback padding (250 trading days) before startDate so that
   * technical indicators have enough history from day one.
   */
  async loadOHLCV(symbol: string, startDate: string, endDate: string): Promise<Candle[]> {
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Add 250 trading days (~365 calendar days) of lookback for indicator warmup
    const lookbackStart = new Date(start);
    lookbackStart.setDate(lookbackStart.getDate() - 365);

    const totalDays = Math.ceil((end.getTime() - lookbackStart.getTime()) / (1000 * 60 * 60 * 24));

    log.info({ symbol, startDate, endDate, lookbackDays: totalDays }, 'Loading OHLCV data');

    const rawCandles = await this.yahooClient.getHistoricalData(symbol, totalDays);

    if (rawCandles.length === 0) {
      log.warn({ symbol }, 'No data returned from Yahoo Finance');
      return [];
    }

    // Map to Candle interface (OHLCVCandle and Candle have the same shape)
    const candles: Candle[] = rawCandles.map((c) => ({
      date: c.date,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

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
  ): Promise<Map<string, Candle[]>> {
    const result = new Map<string, Candle[]>();

    // Load all symbols in parallel
    const entries = await Promise.all(
      symbols.map(async (symbol) => {
        const candles = await this.loadOHLCV(symbol, startDate, endDate);
        return { symbol, candles };
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
   * Get the set of dates that exist in the backtest range across all symbols.
   * Only returns dates that fall within [startDate, endDate].
   */
  getCommonDates(data: Map<string, Candle[]>, startDate: string, endDate: string): string[] {
    if (data.size === 0) return [];

    // Collect all dates per symbol that are within the backtest range
    const dateSets: Set<string>[] = [];
    for (const candles of data.values()) {
      const dates = new Set<string>();
      for (const c of candles) {
        if (c.date >= startDate && c.date <= endDate) {
          dates.add(c.date);
        }
      }
      dateSets.push(dates);
    }

    if (dateSets.length === 0) return [];

    // Intersect all date sets
    const commonDates = [...dateSets[0]].filter((d) => dateSets.every((set) => set.has(d)));

    return commonDates.sort();
  }
}
