import axios from 'axios';
import yahooFinance from 'yahoo-finance2';
import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('yahoo-finance');

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

export interface OHLCVCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FundamentalData {
  peRatio: number | null;
  forwardPE: number | null;
  revenueGrowthYoY: number | null;
  profitMargin: number | null;
  operatingMargin: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  marketCap: number | null;
  sector: string | null;
  industry: string | null;
  earningsSurprise: number | null;
  dividendYield: number | null;
  beta: number | null;
  analystTargetPrice: number | null;
  analystConsensus: string | null;
  analystCount: number | null;
  shortInterestPct: number | null;
  institutionalOwnershipPct: number | null;
  pegRatio: number | null;
  roe: number | null;
  roa: number | null;
  freeCashflow: number | null;
  analystBuy: number | null;
  analystSell: number | null;
}

export interface MarketContext {
  spyPrice: number | null;
  spyChange1d: number | null;
  vixLevel: number | null;
  marketTrend: 'bullish' | 'bearish' | 'neutral';
}

export interface QuoteData {
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  marketCap: number | null;
  dayHigh: number | null;
  dayLow: number | null;
}

// Common headers for Yahoo Finance REST calls
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
};

const yf = new yahooFinance();

export class YahooFinanceClient {
  async getHistoricalData(symbol: string, days?: number): Promise<OHLCVCandle[]> {
    try {
      const lookback = days ?? configManager.get<number>('analysis.historicalDays');
      const period1 = Math.floor((Date.now() - lookback * 24 * 60 * 60 * 1000) / 1000);
      const period2 = Math.floor(Date.now() / 1000);

      const { data } = await axios.get(`${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}`, {
        params: {
          period1,
          period2,
          interval: '1d',
          includePrePost: false,
        },
        headers: YF_HEADERS,
        timeout: 15_000,
      });

      const result = data?.chart?.result?.[0];
      if (!result?.timestamp || !result?.indicators?.quote?.[0]) {
        log.warn(
          { symbol, data: JSON.stringify(data).substring(0, 500) },
          'No historical data returned - Unexpected structure',
        );
        return [];
      }

      const timestamps: number[] = result.timestamp;
      const quote = result.indicators.quote[0];
      const candles: OHLCVCandle[] = [];

      for (let i = 0; i < timestamps.length; i++) {
        const o = quote.open?.[i];
        const h = quote.high?.[i];
        const l = quote.low?.[i];
        const c = quote.close?.[i];
        const v = quote.volume?.[i];

        if (o == null || c == null) continue;

        candles.push({
          date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
          open: o,
          high: h ?? o,
          low: l ?? o,
          close: c,
          volume: v ?? 0,
        });
      }

      return candles;
    } catch (err) {
      log.error({ symbol, err }, 'Failed to fetch historical data');
      return [];
    }
  }

  async getFundamentals(symbol: string): Promise<FundamentalData | null> {
    try {
      const result = await yf.quoteSummary(symbol, {
        modules: [
          'summaryProfile',
          'financialData',
          'defaultKeyStatistics',
          'earningsHistory',
          'summaryDetail',
          'recommendationTrend',
        ],
      });

      if (!result) {
        log.warn({ symbol }, 'No fundamentals data returned');
        return null;
      }

      const financial = result.financialData;
      const stats = result.defaultKeyStatistics;
      const profile = result.summaryProfile;
      const earnings = result.earningsHistory;
      const summary = result.summaryDetail;
      const recTrend = result.recommendationTrend;

      const rawVal = (obj: Record<string, unknown> | undefined, key: string): number | null => {
        if (!obj) return null;
        const v = obj[key];
        if (v == null) return null;
        if (typeof v === 'number') return v;
        if (typeof v === 'object' && v !== null && 'raw' in v) return (v as { raw: number }).raw;
        return null;
      };

      let earningsSurprise: number | null = null;
      if (earnings?.history && Array.isArray(earnings.history) && earnings.history.length > 0) {
        const latest = earnings.history[0];
        earningsSurprise = rawVal(latest, 'surprisePercent');
      }

      // Analyst buy/sell counts from recommendation trend (most recent period)
      let analystBuy: number | null = null;
      let analystSell: number | null = null;
      const trendArr = (recTrend as { trend?: Array<Record<string, unknown>> } | undefined)?.trend;
      if (Array.isArray(trendArr) && trendArr.length > 0) {
        const latest = trendArr[0];
        const strongBuy = (latest.strongBuy as number) ?? 0;
        const buy = (latest.buy as number) ?? 0;
        const strongSell = (latest.strongSell as number) ?? 0;
        const sell = (latest.sell as number) ?? 0;
        analystBuy = strongBuy + buy;
        analystSell = strongSell + sell;
      }

      const shortPct = rawVal(stats as Record<string, unknown> | undefined, 'shortPercentOfFloat');
      const instPct = rawVal(
        stats as Record<string, unknown> | undefined,
        'heldPercentInstitutions',
      );
      const roe = rawVal(financial as Record<string, unknown> | undefined, 'returnOnEquity');
      const roa = rawVal(financial as Record<string, unknown> | undefined, 'returnOnAssets');

      return {
        peRatio: rawVal(summary as Record<string, unknown> | undefined, 'trailingPE'),
        forwardPE: rawVal(stats as Record<string, unknown> | undefined, 'forwardPE'),
        revenueGrowthYoY: rawVal(financial as Record<string, unknown> | undefined, 'revenueGrowth'),
        profitMargin: rawVal(financial as Record<string, unknown> | undefined, 'profitMargins'),
        operatingMargin: rawVal(
          financial as Record<string, unknown> | undefined,
          'operatingMargins',
        ),
        debtToEquity: rawVal(financial as Record<string, unknown> | undefined, 'debtToEquity'),
        currentRatio: rawVal(financial as Record<string, unknown> | undefined, 'currentRatio'),
        marketCap:
          rawVal(summary as Record<string, unknown> | undefined, 'marketCap') ??
          rawVal(result.price as Record<string, unknown> | undefined, 'marketCap'),
        sector: profile?.sector ?? null,
        industry: profile?.industry ?? null,
        earningsSurprise,
        dividendYield: rawVal(stats as Record<string, unknown> | undefined, 'dividendYield'),
        beta: rawVal(stats as Record<string, unknown> | undefined, 'beta'),
        analystTargetPrice: rawVal(
          financial as Record<string, unknown> | undefined,
          'targetMeanPrice',
        ),
        analystConsensus:
          ((financial as Record<string, unknown> | undefined)?.recommendationKey as
            | string
            | null) ?? null,
        analystCount: rawVal(
          financial as Record<string, unknown> | undefined,
          'numberOfAnalystOpinions',
        ),
        shortInterestPct: shortPct != null ? shortPct * 100 : null,
        institutionalOwnershipPct: instPct != null ? instPct * 100 : null,
        pegRatio: rawVal(stats as Record<string, unknown> | undefined, 'pegRatio'),
        roe: roe != null ? roe * 100 : null,
        roa: roa != null ? roa * 100 : null,
        freeCashflow: rawVal(financial as Record<string, unknown> | undefined, 'freeCashflow'),
        analystBuy,
        analystSell,
      };
    } catch (err) {
      log.error({ symbol, err }, 'Failed to fetch fundamentals');
      return null;
    }
  }

  async getMarketContext(): Promise<MarketContext> {
    const ctx: MarketContext = {
      spyPrice: null,
      spyChange1d: null,
      vixLevel: null,
      marketTrend: 'neutral',
    };

    try {
      const [spyResult, vixResult] = await Promise.allSettled([yf.quote('SPY'), yf.quote('^VIX')]);

      if (spyResult.status === 'fulfilled' && spyResult.value) {
        const spy = spyResult.value;
        ctx.spyPrice = spy.regularMarketPrice ?? null;
        ctx.spyChange1d = spy.regularMarketChangePercent ?? null;
      }

      if (vixResult.status === 'fulfilled' && vixResult.value) {
        ctx.vixLevel = vixResult.value.regularMarketPrice ?? null;
      }

      if (ctx.spyChange1d !== null && ctx.vixLevel !== null) {
        if (ctx.spyChange1d > 0.5 && ctx.vixLevel < 20) {
          ctx.marketTrend = 'bullish';
        } else if (ctx.spyChange1d < -0.5 || ctx.vixLevel > 30) {
          ctx.marketTrend = 'bearish';
        }
      }

      return ctx;
    } catch (err) {
      log.error({ err }, 'Failed to fetch market context');
      return ctx;
    }
  }

  async getQuote(symbol: string): Promise<QuoteData | null> {
    try {
      const result = await yf.quote(symbol);
      if (!result) return null;

      return {
        price: result.regularMarketPrice ?? 0,
        change: result.regularMarketChange ?? 0,
        changePercent: result.regularMarketChangePercent ?? 0,
        volume: result.regularMarketVolume ?? 0,
        avgVolume: result.averageDailyVolume3Month ?? 0,
        marketCap: result.marketCap ?? null,
        dayHigh: result.regularMarketDayHigh ?? null,
        dayLow: result.regularMarketDayLow ?? null,
      };
    } catch (err) {
      log.error({ symbol, err }, 'Failed to fetch quote');
      return null;
    }
  }

  async getIntradayCandles(
    symbol: string,
    _intervalMinutes = 5,
    _hours = 6.5,
  ): Promise<OHLCVCandle[]> {
    try {
      const { data } = await axios.get(`${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}`, {
        params: {
          interval: '5m',
          range: '1d',
          includePrePost: false,
        },
        headers: YF_HEADERS,
        timeout: 15_000,
      });

      const result = data?.chart?.result?.[0];
      if (!result?.timestamp || !result?.indicators?.quote?.[0]) {
        log.warn({ symbol }, 'No historical data returned');
        return [];
      }

      const timestamps: number[] = result.timestamp;
      const quote = result.indicators.quote[0];
      const candles: OHLCVCandle[] = [];

      for (let i = 0; i < timestamps.length; i++) {
        const o = quote.open?.[i];
        const h = quote.high?.[i];
        const l = quote.low?.[i];
        const c = quote.close?.[i];
        const v = quote.volume?.[i];

        if (o == null || c == null) continue;

        candles.push({
          date: new Date(timestamps[i] * 1000).toISOString(),
          open: o,
          high: h ?? o,
          low: l ?? o,
          close: c,
          volume: v ?? 0,
        });
      }

      return candles;
    } catch (err) {
      log.error({ symbol, err }, 'Failed to fetch intraday candles');
      return [];
    }
  }
}
