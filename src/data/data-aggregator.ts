import { configManager } from '../config/manager.js';
import { getFundamentals, setFundamentals } from '../db/repositories/cache.js';
import { createLogger } from '../utils/logger.js';
import type { AlpacaClient, AlpacaNewsArticle } from './alpaca.js';
import type { EarningsEvent, FinnhubClient, FinnhubNews, InsiderTx } from './finnhub.js';
import { getFinraClient } from './finra.js';
import type { MarketauxArticle, MarketauxClient } from './marketaux.js';
import type {
  FundamentalData,
  MarketContext,
  OHLCVCandle,
  YahooFinanceClient,
} from './yahoo-finance.js';

const log = createLogger('data-aggregator');

export interface StockData {
  symbol: string;
  candles: OHLCVCandle[];
  quote: {
    price: number;
    change: number;
    changePercent: number;
    dayHigh: number | null;
    dayLow: number | null;
    volume: number | null;
    avgVolume: number | null;
  } | null;
  fundamentals: FundamentalData | null;
  finnhubNews: FinnhubNews[];
  marketauxNews: MarketauxArticle[];
  earnings: EarningsEvent[];
  insiderTransactions: InsiderTx[];
  marketContext: MarketContext;
  finraShortVolume: {
    shortVolumePct: number;
    shortVolume: number;
    totalVolume: number;
    date: string;
  } | null;
  alpacaNews?: AlpacaNewsArticle[];
}

/** Lighter data bundle for research — skips Marketaux to conserve daily budget */
export interface ResearchStockData {
  symbol: string;
  candles: OHLCVCandle[];
  quote: { price: number; change: number; changePercent: number } | null;
  fundamentals: FundamentalData | null;
  finnhubNews: FinnhubNews[];
  earnings: EarningsEvent[];
  insiderTransactions: InsiderTx[];
}

export interface ResearchDataOptions {
  /** Pre-fetched earnings calendar to share across symbols */
  sharedEarnings?: EarningsEvent[];
  /** Skip news fetch */
  skipNews?: boolean;
  /** Skip insider transaction fetch */
  skipInsiders?: boolean;
}

export class DataAggregator {
  private alpaca?: AlpacaClient;

  constructor(
    private yahoo: YahooFinanceClient,
    private finnhub: FinnhubClient,
    private marketaux: MarketauxClient,
    alpaca?: AlpacaClient,
  ) {
    this.alpaca = alpaca;
  }

  private isAlpacaEnabled(): boolean {
    if (!this.alpaca) return false;
    try {
      return configManager.get<boolean>('data.alpaca.enabled');
    } catch {
      return false;
    }
  }

  private isAlpacaNewsEnabled(): boolean {
    if (!this.isAlpacaEnabled()) return false;
    try {
      return configManager.get<boolean>('data.alpaca.newsEnabled');
    } catch {
      return true;
    }
  }

  async getStockData(symbol: string): Promise<StockData> {
    const result: StockData = {
      symbol,
      candles: [],
      quote: null,
      fundamentals: null,
      finnhubNews: [],
      marketauxNews: [],
      earnings: [],
      insiderTransactions: [],
      marketContext: {
        spyPrice: null,
        spyChange1d: null,
        vixLevel: null,
        marketTrend: 'neutral',
        vixTermStructure: null,
      },
      finraShortVolume: null,
    };

    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const thirtyDaysAhead = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const useAlpaca = this.isAlpacaEnabled();
    // Safe reference — isAlpacaEnabled() guarantees alpaca is defined when useAlpaca is true
    const alpacaRef = this.alpaca;

    // Core data fetches (same as before, with Alpaca candle fallback)
    const candlePromise =
      useAlpaca && alpacaRef
        ? alpacaRef
            .getHistoricalBars(
              symbol,
              new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              today,
            )
            .catch((err) => {
              log.warn({ symbol, err }, 'Alpaca candles failed, falling back to Yahoo');
              return this.yahoo.getHistoricalData(symbol);
            })
        : this.yahoo.getHistoricalData(symbol);

    const [
      candlesResult,
      finnhubQuoteResult,
      fundamentalsResult,
      finnhubNewsResult,
      marketauxNewsResult,
      earningsResult,
      insiderResult,
      marketCtxResult,
      yahooQuoteResult,
      finraShortVolumeResult,
    ] = await Promise.allSettled([
      candlePromise,
      this.finnhub.getQuote(symbol),
      this.getCachedFundamentals(symbol),
      this.finnhub.getCompanyNews(symbol, thirtyDaysAgo, today),
      this.marketaux.getNews([symbol]),
      this.finnhub.getEarningsCalendar(today, thirtyDaysAhead),
      this.finnhub.getInsiderTransactions(symbol),
      this.yahoo.getMarketContext(),
      this.yahoo.getQuote(symbol),
      getFinraClient().getShortData([symbol]),
    ]);

    // Fetch Alpaca snapshot + news in parallel (separate to keep core types clean)
    let alpacaSnapshot: import('./alpaca.js').AlpacaSnapshot | undefined;
    let alpacaNews: AlpacaNewsArticle[] | undefined;

    if ((useAlpaca || this.isAlpacaNewsEnabled()) && alpacaRef) {
      const [snapResult, newsResult] = await Promise.allSettled([
        useAlpaca ? alpacaRef.getSnapshots([symbol]) : Promise.resolve(new Map()),
        this.isAlpacaNewsEnabled() ? alpacaRef.getNews([symbol]) : Promise.resolve([]),
      ]);

      if (useAlpaca && snapResult.status === 'fulfilled') {
        alpacaSnapshot = snapResult.value.get(symbol);
      }
      if (newsResult.status === 'fulfilled' && newsResult.value.length > 0) {
        alpacaNews = newsResult.value;
      }
    }

    // Historical candles
    if (candlesResult.status === 'fulfilled') {
      result.candles = candlesResult.value;
    } else {
      log.warn({ symbol, err: candlesResult.reason }, 'Failed to get candles');
    }

    // Build quote: Alpaca snapshot → Finnhub → Yahoo fallback chain
    let dayHigh: number | null = null;
    let dayLow: number | null = null;
    let volume: number | null = null;
    let avgVolume: number | null = null;

    // Yahoo quote provides volume + day range (available even when others are primary)
    const yahooQ = yahooQuoteResult.status === 'fulfilled' ? yahooQuoteResult.value : null;
    if (yahooQ) {
      dayHigh = yahooQ.dayHigh;
      dayLow = yahooQ.dayLow;
      volume = yahooQ.volume;
      avgVolume = yahooQ.avgVolume;
    }

    // Try Alpaca snapshot first
    let alpacaQuoteUsed = false;
    if (alpacaSnapshot?.dailyBar && alpacaSnapshot.latestTrade) {
      const price = alpacaSnapshot.latestTrade.p;
      const prevClose = alpacaSnapshot.prevDailyBar?.c ?? alpacaSnapshot.dailyBar.o;
      const change = price - prevClose;
      result.quote = {
        price,
        change,
        changePercent: prevClose !== 0 ? (change / prevClose) * 100 : 0,
        dayHigh: alpacaSnapshot.dailyBar.h || dayHigh,
        dayLow: alpacaSnapshot.dailyBar.l || dayLow,
        volume: alpacaSnapshot.dailyBar.v || volume,
        avgVolume,
      };
      alpacaQuoteUsed = true;
    }

    if (!alpacaQuoteUsed && finnhubQuoteResult.status === 'fulfilled' && finnhubQuoteResult.value) {
      const fq = finnhubQuoteResult.value;
      const change = fq.c - fq.pc;
      result.quote = {
        price: fq.c,
        change,
        changePercent: fq.pc !== 0 ? (change / fq.pc) * 100 : 0,
        dayHigh: fq.h || dayHigh,
        dayLow: fq.l || dayLow,
        volume,
        avgVolume,
      };
    } else if (!alpacaQuoteUsed && yahooQ) {
      result.quote = {
        price: yahooQ.price,
        change: yahooQ.change,
        changePercent: yahooQ.changePercent,
        dayHigh,
        dayLow,
        volume,
        avgVolume,
      };
    } else if (!alpacaQuoteUsed) {
      log.warn({ symbol }, 'All quote sources failed');
    }

    // FINRA short volume
    if (finraShortVolumeResult.status === 'fulfilled') {
      const finraMap = finraShortVolumeResult.value;
      const finraEntry = finraMap.get(symbol);
      if (finraEntry) {
        result.finraShortVolume = {
          shortVolumePct: finraEntry.shortVolumePct,
          shortVolume: finraEntry.shortVolume,
          totalVolume: finraEntry.totalVolume,
          date: finraEntry.date,
        };
      }
    }

    // Fundamentals
    if (fundamentalsResult.status === 'fulfilled') {
      result.fundamentals = fundamentalsResult.value;
    } else {
      log.warn({ symbol, err: fundamentalsResult.reason }, 'Failed to get fundamentals');
    }

    // Finnhub news
    if (finnhubNewsResult.status === 'fulfilled') {
      result.finnhubNews = finnhubNewsResult.value;
    }

    // Marketaux news
    if (marketauxNewsResult.status === 'fulfilled') {
      result.marketauxNews = marketauxNewsResult.value;
    }

    // Alpaca news (additive — extra source alongside Finnhub/Marketaux)
    if (alpacaNews) {
      result.alpacaNews = alpacaNews;
    }

    // Earnings
    if (earningsResult.status === 'fulfilled') {
      result.earnings = earningsResult.value.filter((e) => e.symbol === symbol);
    }

    // Insider transactions
    if (insiderResult.status === 'fulfilled') {
      result.insiderTransactions = insiderResult.value;
    }

    // Market context
    if (marketCtxResult.status === 'fulfilled') {
      result.marketContext = marketCtxResult.value;
    }

    log.info(
      {
        symbol,
        candles: result.candles.length,
        hasQuote: !!result.quote,
        hasFundamentals: !!result.fundamentals,
        finnhubNews: result.finnhubNews.length,
        marketauxNews: result.marketauxNews.length,
        earnings: result.earnings.length,
        insiders: result.insiderTransactions.length,
        finraShortVolume: !!result.finraShortVolume,
      },
      'Stock data aggregated',
    );

    return result;
  }

  async getResearchData(symbol: string, options?: ResearchDataOptions): Promise<ResearchStockData> {
    const result: ResearchStockData = {
      symbol,
      candles: [],
      quote: null,
      fundamentals: null,
      finnhubNews: [],
      earnings: [],
      insiderTransactions: [],
    };

    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const thirtyDaysAhead = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const useAlpaca = this.isAlpacaEnabled();
    const alpacaRef = this.alpaca;

    // Build fetch list based on options
    const fetches: Promise<unknown>[] = [
      useAlpaca && alpacaRef
        ? alpacaRef
            .getHistoricalBars(
              symbol,
              new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              today,
            )
            .catch(() => this.yahoo.getHistoricalData(symbol))
        : this.yahoo.getHistoricalData(symbol),
      this.finnhub.getQuote(symbol),
      this.getCachedFundamentals(symbol),
    ];

    const fetchNews = !options?.skipNews;
    const fetchInsiders = !options?.skipInsiders;
    const useSharedEarnings = !!options?.sharedEarnings;

    if (fetchNews) fetches.push(this.finnhub.getCompanyNews(symbol, thirtyDaysAgo, today));
    if (!useSharedEarnings) fetches.push(this.finnhub.getEarningsCalendar(today, thirtyDaysAhead));
    if (fetchInsiders) fetches.push(this.finnhub.getInsiderTransactions(symbol));

    const results = await Promise.allSettled(fetches);

    let idx = 0;

    // Candles
    const candlesResult = results[idx++];
    if (candlesResult.status === 'fulfilled') {
      result.candles = candlesResult.value as OHLCVCandle[];
    } else {
      log.warn({ symbol, err: candlesResult.reason }, 'Research: failed to get candles');
    }

    // Quote: prefer Finnhub, fallback to Yahoo
    const quoteResult = results[idx++];
    if (quoteResult.status === 'fulfilled' && quoteResult.value) {
      const fq = quoteResult.value as { c: number; pc: number };
      const change = fq.c - fq.pc;
      result.quote = {
        price: fq.c,
        change,
        changePercent: fq.pc !== 0 ? (change / fq.pc) * 100 : 0,
      };
    } else {
      try {
        const yahooQuote = await this.yahoo.getQuote(symbol);
        if (yahooQuote) {
          result.quote = {
            price: yahooQuote.price,
            change: yahooQuote.change,
            changePercent: yahooQuote.changePercent,
          };
        }
      } catch (err) {
        log.warn({ symbol, err }, 'Research: Yahoo quote fallback also failed');
      }
    }

    // Fundamentals
    const fundResult = results[idx++];
    if (fundResult.status === 'fulfilled') {
      result.fundamentals = fundResult.value as FundamentalData | null;
    }

    // News
    if (fetchNews) {
      const newsResult = results[idx++];
      if (newsResult.status === 'fulfilled') {
        result.finnhubNews = newsResult.value as FinnhubNews[];
      }
    }

    // Earnings
    if (useSharedEarnings) {
      result.earnings = (options?.sharedEarnings ?? []).filter((e) => e.symbol === symbol);
    } else {
      const earningsResult = results[idx++];
      if (earningsResult.status === 'fulfilled') {
        result.earnings = (earningsResult.value as EarningsEvent[]).filter(
          (e) => e.symbol === symbol,
        );
      }
    }

    // Insiders
    if (fetchInsiders) {
      const insiderResult = results[idx++];
      if (insiderResult.status === 'fulfilled') {
        result.insiderTransactions = insiderResult.value as InsiderTx[];
      }
    }

    log.debug(
      {
        symbol,
        candles: result.candles.length,
        hasQuote: !!result.quote,
        hasFundamentals: !!result.fundamentals,
        news: result.finnhubNews.length,
        earnings: result.earnings.length,
        insiders: result.insiderTransactions.length,
      },
      'Research data aggregated',
    );

    return result;
  }

  async getQuote(symbol: string): Promise<{ price: number; change: number }> {
    // Try Alpaca first (if enabled)
    if (this.isAlpacaEnabled() && this.alpaca) {
      try {
        const snapshots = await this.alpaca.getSnapshots([symbol]);
        const snap = snapshots.get(symbol);
        if (snap?.latestTrade && snap.prevDailyBar) {
          const price = snap.latestTrade.p;
          return { price, change: price - snap.prevDailyBar.c };
        }
      } catch {
        // fall through to Finnhub
      }
    }

    // Try Finnhub
    try {
      const fq = await this.finnhub.getQuote(symbol);
      if (fq && fq.c > 0) {
        return { price: fq.c, change: fq.c - fq.pc };
      }
    } catch {
      // fall through to Yahoo
    }

    // Fallback to Yahoo
    const yq = await this.yahoo.getQuote(symbol);
    if (yq) {
      return { price: yq.price, change: yq.change };
    }

    throw new Error(`Unable to get quote for ${symbol} from any source`);
  }

  async getMarketContext(): Promise<MarketContext> {
    return this.yahoo.getMarketContext();
  }

  private async getCachedFundamentals(symbol: string): Promise<FundamentalData | null> {
    // Check SQLite fundamental cache first (24h TTL)
    try {
      const cached = getFundamentals(symbol, 24);
      if (cached) return cached;
    } catch {
      // DB may not be initialized yet on first run; fall through to live fetch
    }

    const data = await this.yahoo.getFundamentals(symbol);
    if (data) {
      try {
        setFundamentals(symbol, data, 24);
      } catch {
        // Non-fatal: cache write failure shouldn't block the trade loop
      }
    }

    return data;
  }
}
