import axios, { type AxiosInstance } from 'axios';
import { configManager } from '../config/manager.js';
import { sleep } from '../utils/helpers.js';
import { type KeyRotator, createFinnhubRotator } from '../utils/key-rotator.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('finnhub');

const BASE_URL = 'https://finnhub.io/api/v1';
const RATE_LIMIT_PER_MINUTE = 60;

export interface FinnhubQuote {
  c: number; // current price
  h: number; // high
  l: number; // low
  o: number; // open
  pc: number; // previous close
  t: number; // timestamp
}

export interface FinnhubNews {
  id: number;
  category: string;
  datetime: number;
  headline: string;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export interface EarningsEvent {
  symbol: string;
  date: string;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  hour: string;
  quarter: number;
  year: number;
}

export interface InsiderTx {
  symbol: string;
  name: string;
  share: number;
  change: number;
  filingDate: string;
  transactionDate: string;
  transactionCode: string;
  transactionPrice: number;
}

export class FinnhubClient {
  private client: AxiosInstance;
  private callTimestamps: number[] = [];
  private keyRotator: KeyRotator;

  constructor() {
    this.keyRotator = createFinnhubRotator();
    if (this.keyRotator.getKeyCount() === 0) {
      log.warn('No Finnhub API keys configured — requests will fail');
    } else {
      log.info(
        {
          keyCount: this.keyRotator.getKeyCount(),
          effectiveRateLimit: this.keyRotator.getEffectiveRateLimit(),
        },
        'Finnhub key rotator initialized',
      );
    }

    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 10_000,
    });
  }

  private async rateLimit(): Promise<string | null> {
    const now = Date.now();
    const effectiveLimit = this.keyRotator.getEffectiveRateLimit() || RATE_LIMIT_PER_MINUTE;
    this.callTimestamps = this.callTimestamps.filter((ts) => now - ts < 60_000);

    if (this.callTimestamps.length >= effectiveLimit) {
      const oldest = this.callTimestamps[0];
      const waitMs = 60_000 - (now - oldest) + 100;
      log.debug({ waitMs }, 'Rate limit reached, waiting');
      await sleep(waitMs);
    }

    this.callTimestamps.push(Date.now());
    return this.keyRotator.getKey();
  }

  async getQuote(symbol: string): Promise<FinnhubQuote | null> {
    if (!configManager.get<boolean>('data.finnhub.quotesEnabled')) {
      return null;
    }

    try {
      const token = await this.rateLimit();
      const { data } = await this.client.get<FinnhubQuote>('/quote', {
        params: { symbol, token },
      });

      if (!data || data.c === 0) {
        log.warn({ symbol }, 'Empty quote response');
        return null;
      }

      return data;
    } catch (err) {
      log.error({ symbol, err }, 'Failed to fetch Finnhub quote');
      return null;
    }
  }

  async getCompanyNews(symbol: string, from: string, to: string): Promise<FinnhubNews[]> {
    if (!configManager.get<boolean>('data.finnhub.newsEnabled')) {
      return [];
    }

    try {
      const token = await this.rateLimit();
      const { data } = await this.client.get<FinnhubNews[]>('/company-news', {
        params: { symbol, from, to, token },
      });

      return data ?? [];
    } catch (err) {
      log.error({ symbol, err }, 'Failed to fetch company news');
      return [];
    }
  }

  async getEarningsCalendar(from: string, to: string): Promise<EarningsEvent[]> {
    if (!configManager.get<boolean>('data.finnhub.earningsEnabled')) {
      return [];
    }

    try {
      const token = await this.rateLimit();
      const { data } = await this.client.get('/calendar/earnings', {
        params: { from, to, token },
      });

      if (!data?.earningsCalendar) return [];

      return data.earningsCalendar.map((e: Record<string, unknown>) => ({
        symbol: (e.symbol as string) ?? '',
        date: (e.date as string) ?? '',
        epsEstimate: (e.epsEstimate as number) ?? null,
        epsActual: (e.epsActual as number) ?? null,
        revenueEstimate: (e.revenueEstimate as number) ?? null,
        revenueActual: (e.revenueActual as number) ?? null,
        hour: (e.hour as string) ?? '',
        quarter: (e.quarter as number) ?? 0,
        year: (e.year as number) ?? 0,
      }));
    } catch (err) {
      log.error({ err }, 'Failed to fetch earnings calendar');
      return [];
    }
  }

  async getInsiderTransactions(symbol: string): Promise<InsiderTx[]> {
    if (!configManager.get<boolean>('data.finnhub.insidersEnabled')) {
      return [];
    }

    try {
      const token = await this.rateLimit();
      const { data } = await this.client.get('/stock/insider-transactions', {
        params: { symbol, token },
      });

      if (!data?.data) return [];

      return data.data.map((tx: Record<string, unknown>) => ({
        symbol: (tx.symbol as string) ?? symbol,
        name: (tx.name as string) ?? '',
        share: (tx.share as number) ?? 0,
        change: (tx.change as number) ?? 0,
        filingDate: (tx.filingDate as string) ?? '',
        transactionDate: (tx.transactionDate as string) ?? '',
        transactionCode: (tx.transactionCode as string) ?? '',
        transactionPrice: (tx.transactionPrice as number) ?? 0,
      }));
    } catch (err) {
      log.error({ symbol, err }, 'Failed to fetch insider transactions');
      return [];
    }
  }
}
