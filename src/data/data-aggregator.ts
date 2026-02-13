import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';
import type {
  EarningsEvent,
  FinnhubClient,
  FinnhubNews,
  FinnhubQuote,
  InsiderTx,
} from './finnhub.js';
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
  quote: { price: number; change: number; changePercent: number } | null;
  fundamentals: FundamentalData | null;
  finnhubNews: FinnhubNews[];
  marketauxNews: MarketauxArticle[];
  earnings: EarningsEvent[];
  insiderTransactions: InsiderTx[];
  marketContext: MarketContext;
}

export class DataAggregator {
  private fundamentalCache = new Map<string, { data: FundamentalData; expiresAt: number }>();
  private fundamentalCacheTTL = 4 * 60 * 60 * 1000; // 4 hours

  constructor(
    private yahoo: YahooFinanceClient,
    private finnhub: FinnhubClient,
    private marketaux: MarketauxClient,
  ) {}

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
      marketContext: { spyPrice: null, spyChange1d: null, vixLevel: null, marketTrend: 'neutral' },
    };

    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const thirtyDaysAhead = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const [
      candlesResult,
      finnhubQuoteResult,
      fundamentalsResult,
      finnhubNewsResult,
      marketauxNewsResult,
      earningsResult,
      insiderResult,
      marketCtxResult,
    ] = await Promise.allSettled([
      this.yahoo.getHistoricalData(symbol),
      this.finnhub.getQuote(symbol),
      this.getCachedFundamentals(symbol),
      this.finnhub.getCompanyNews(symbol, thirtyDaysAgo, today),
      this.marketaux.getNews([symbol]),
      this.finnhub.getEarningsCalendar(today, thirtyDaysAhead),
      this.finnhub.getInsiderTransactions(symbol),
      this.yahoo.getMarketContext(),
    ]);

    // Historical candles
    if (candlesResult.status === 'fulfilled') {
      result.candles = candlesResult.value;
    } else {
      log.warn({ symbol, err: candlesResult.reason }, 'Failed to get candles');
    }

    // Quote: prefer Finnhub, fallback to Yahoo
    if (finnhubQuoteResult.status === 'fulfilled' && finnhubQuoteResult.value) {
      const fq = finnhubQuoteResult.value;
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
        log.warn({ symbol, err }, 'Yahoo quote fallback also failed');
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
      },
      'Stock data aggregated',
    );

    return result;
  }

  async getQuote(symbol: string): Promise<{ price: number; change: number }> {
    // Try Finnhub first
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
    const cached = this.fundamentalCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const data = await this.yahoo.getFundamentals(symbol);
    if (data) {
      this.fundamentalCache.set(symbol, {
        data,
        expiresAt: Date.now() + this.fundamentalCacheTTL,
      });
    }

    return data;
  }
}
