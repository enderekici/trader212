import axios, { type AxiosInstance } from 'axios';
import { configManager } from '../config/manager.js';
import { createMarketauxRotator, type KeyRotator } from '../utils/key-rotator.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('marketaux');

const BASE_URL = 'https://api.marketaux.com';

export interface MarketauxArticle {
  title: string;
  description: string;
  source: string;
  url: string;
  publishedAt: string;
  sentimentScore: number | null;
  relevanceScore: number | null;
}

export class MarketauxClient {
  private client: AxiosInstance;
  private callsToday = 0;
  private budgetResetDate: string;
  private keyRotator: KeyRotator;

  constructor() {
    this.keyRotator = createMarketauxRotator();
    if (this.keyRotator.getKeyCount() === 0) {
      log.warn('No Marketaux API tokens configured — requests will fail');
    } else {
      log.info(
        {
          keyCount: this.keyRotator.getKeyCount(),
          effectiveDailyLimit: this.keyRotator.getEffectiveRateLimit(),
        },
        'Marketaux key rotator initialized',
      );
    }

    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 10_000,
    });

    this.budgetResetDate = this.todayUTC();
  }

  private todayUTC(): string {
    return new Date().toISOString().split('T')[0];
  }

  private checkBudget(): boolean {
    const today = this.todayUTC();
    if (today !== this.budgetResetDate) {
      this.callsToday = 0;
      this.budgetResetDate = today;
    }

    const maxCalls =
      configManager.get<number>('data.marketaux.maxCallsPerDay') *
      Math.max(this.keyRotator.getKeyCount(), 1);
    if (this.callsToday >= maxCalls) {
      log.warn({ callsToday: this.callsToday, maxCalls }, 'Daily call budget exhausted');
      return false;
    }

    return true;
  }

  async getNews(symbols: string[], options?: { limit?: number }): Promise<MarketauxArticle[]> {
    if (!configManager.get<boolean>('data.marketaux.enabled')) {
      return [];
    }

    if (!this.checkBudget()) {
      return [];
    }

    try {
      const limit = options?.limit ?? 10;
      const api_token = this.keyRotator.getKey();
      const { data } = await this.client.get('/v1/news/all', {
        params: {
          api_token,
          symbols: symbols.join(','),
          filter_entities: true,
          language: 'en',
          limit,
        },
      });

      this.callsToday++;

      if (!data?.data) return [];

      return data.data.map((article: Record<string, unknown>) => {
        const entities = article.entities as Array<Record<string, unknown>> | undefined;
        let sentimentScore: number | null = null;
        let relevanceScore: number | null = null;

        if (entities && entities.length > 0) {
          sentimentScore = (entities[0].sentiment_score as number) ?? null;
          relevanceScore = (entities[0].match_score as number) ?? null;
        }

        return {
          title: (article.title as string) ?? '',
          description: (article.description as string) ?? '',
          source: (article.source as string) ?? '',
          url: (article.url as string) ?? '',
          publishedAt: (article.published_at as string) ?? '',
          sentimentScore,
          relevanceScore,
        };
      });
    } catch (err) {
      log.error({ symbols, err }, 'Failed to fetch Marketaux news');
      return [];
    }
  }
}
