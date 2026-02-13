import { z } from 'zod';
import { configManager } from '../../config/manager.js';
import { createLogger } from '../../utils/logger.js';
import { ApiError, AuthError, RateLimitError } from './errors.js';
import {
  type AccountCash,
  AccountCashSchema,
  type AccountInfo,
  AccountInfoSchema,
  type AccountSummary,
  AccountSummarySchema,
  type CreatePieRequest,
  type Dividend,
  DividendSchema,
  type Environment,
  type Exchange,
  ExchangeSchema,
  type ExportRequest,
  type HistoricalOrder,
  HistoricalOrderSchema,
  type Instrument,
  InstrumentSchema,
  type LimitOrderRequest,
  type MarketOrderRequest,
  type Order,
  OrderSchema,
  type Pie,
  PieSchema,
  type Position,
  PositionSchema,
  type RateLimitInfo,
  type StopLimitOrderRequest,
  type StopOrderRequest,
  type Transaction,
  TransactionSchema,
} from './types.js';

const log = createLogger('trading212');

export class Trading212Client {
  private baseUrl: string;
  private apiKey: string;
  private lastRateLimitInfo: Map<string, RateLimitInfo> = new Map();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    const environment = configManager.get<Environment>('t212.environment');
    this.baseUrl =
      environment === 'demo'
        ? 'https://demo.trading212.com/api/v0'
        : 'https://live.trading212.com/api/v0';
    log.info({ environment }, 'Trading212 client initialized');
  }

  private getAuthHeaders(): Record<string, string> {
    const raw = this.apiKey.includes(':') ? this.apiKey : `${this.apiKey}:`;
    const credentials = Buffer.from(raw).toString('base64');
    return {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    };
  }

  private extractRateLimitInfo(headers: Headers): RateLimitInfo | null {
    const limit = headers.get('x-ratelimit-limit');
    const period = headers.get('x-ratelimit-period');
    const remaining = headers.get('x-ratelimit-remaining');
    const reset = headers.get('x-ratelimit-reset');
    const used = headers.get('x-ratelimit-used');

    if (!limit || !period || !remaining || !reset || !used) {
      return null;
    }

    return {
      limit: Number.parseInt(limit, 10),
      period: Number.parseInt(period, 10),
      remaining: Number.parseInt(remaining, 10),
      reset: Number.parseInt(reset, 10),
      used: Number.parseInt(used, 10),
    };
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    schema?: z.ZodSchema<T>,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    log.debug({ endpoint, method: options.method ?? 'GET' }, 'API request');

    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getAuthHeaders(),
        ...options.headers,
      },
    });

    // Extract and store rate limit info
    const rateLimitInfo = this.extractRateLimitInfo(response.headers);
    if (rateLimitInfo) {
      this.lastRateLimitInfo.set(endpoint, rateLimitInfo);
      if (rateLimitInfo.remaining <= 2) {
        log.warn({ endpoint, remaining: rateLimitInfo.remaining }, 'Rate limit nearly exhausted');
      }
    }

    if (!response.ok) {
      if (response.status === 429) {
        const headersObj: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headersObj[key] = value;
        });
        const err = RateLimitError.fromHeaders(headersObj);
        log.warn({ endpoint, err }, 'Rate limited');
        throw err;
      }

      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorJson.errorMessage || errorText;
      } catch {
        errorMessage = errorText;
      }

      if (response.status === 401) {
        throw new AuthError(`Trading 212 API Error (401): ${errorMessage}`);
      }

      throw new ApiError(
        `Trading 212 API Error (${response.status}): ${errorMessage}`,
        response.status,
        errorText,
      );
    }

    const data = await response.json();

    if (schema) {
      return schema.parse(data);
    }

    return data as T;
  }

  // Rate limit info getter
  getRateLimitInfo(endpoint: string): RateLimitInfo | null {
    return this.lastRateLimitInfo.get(endpoint) || null;
  }

  // Account Management
  async getAccountInfo(): Promise<AccountInfo> {
    return this.request('/equity/account/info', {}, AccountInfoSchema);
  }

  async getAccountCash(): Promise<AccountCash> {
    return this.request('/equity/account/cash', {}, AccountCashSchema);
  }

  async getAccountSummary(): Promise<AccountSummary> {
    return this.request('/equity/account/summary', {}, AccountSummarySchema);
  }

  // Portfolio/Positions
  async getPortfolio(): Promise<Position[]> {
    return this.request('/equity/portfolio', {}, z.array(PositionSchema));
  }

  async getPosition(ticker: string): Promise<Position> {
    return this.request(`/equity/portfolio/${encodeURIComponent(ticker)}`, {}, PositionSchema);
  }

  // Order Management
  async getOrders(): Promise<Order[]> {
    return this.request('/equity/orders', {}, z.array(OrderSchema));
  }

  async getOrder(orderId: number): Promise<Order> {
    return this.request(`/equity/orders/${orderId}`, {}, OrderSchema);
  }

  async cancelOrder(orderId: number): Promise<void> {
    await this.request(`/equity/orders/${orderId}`, { method: 'DELETE' });
  }

  async placeMarketOrder(order: MarketOrderRequest): Promise<Order> {
    return this.request(
      '/equity/orders/market',
      { method: 'POST', body: JSON.stringify(order) },
      OrderSchema,
    );
  }

  async placeLimitOrder(order: LimitOrderRequest): Promise<Order> {
    return this.request(
      '/equity/orders/limit',
      { method: 'POST', body: JSON.stringify(order) },
      OrderSchema,
    );
  }

  async placeStopOrder(order: StopOrderRequest): Promise<Order> {
    return this.request(
      '/equity/orders/stop',
      { method: 'POST', body: JSON.stringify(order) },
      OrderSchema,
    );
  }

  async placeStopLimitOrder(order: StopLimitOrderRequest): Promise<Order> {
    return this.request(
      '/equity/orders/stop_limit',
      { method: 'POST', body: JSON.stringify(order) },
      OrderSchema,
    );
  }

  // Instruments & Market Data
  async getInstruments(): Promise<Instrument[]> {
    return this.request('/equity/metadata/instruments', {}, z.array(InstrumentSchema));
  }

  async getExchanges(): Promise<Exchange[]> {
    return this.request('/equity/metadata/exchanges', {}, z.array(ExchangeSchema));
  }

  // Pies
  async getPies(): Promise<Pie[]> {
    return this.request('/equity/pies', {}, z.array(PieSchema));
  }

  async getPie(pieId: number): Promise<Pie> {
    return this.request(`/equity/pies/${pieId}`, {}, PieSchema);
  }

  async createPie(pie: CreatePieRequest): Promise<Pie> {
    return this.request('/equity/pies', { method: 'POST', body: JSON.stringify(pie) }, PieSchema);
  }

  async updatePie(pieId: number, pie: Partial<CreatePieRequest>): Promise<Pie> {
    return this.request(
      `/equity/pies/${pieId}`,
      { method: 'POST', body: JSON.stringify(pie) },
      PieSchema,
    );
  }

  async deletePie(pieId: number): Promise<void> {
    await this.request(`/equity/pies/${pieId}`, { method: 'DELETE' });
  }

  // Historical Data
  async getOrderHistory(params?: {
    cursor?: number;
    limit?: number;
    ticker?: string;
  }): Promise<{ items: HistoricalOrder[]; nextPagePath?: string }> {
    const queryParams = new URLSearchParams();
    if (params?.cursor) queryParams.append('cursor', params.cursor.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.ticker) queryParams.append('ticker', params.ticker);

    const qs = queryParams.toString();
    const endpoint = `/equity/history/orders${qs ? `?${qs}` : ''}`;
    const response = await this.request<{ items: unknown[]; nextPagePath?: string }>(endpoint);

    return {
      items: z.array(HistoricalOrderSchema).parse(response.items),
      nextPagePath: response.nextPagePath,
    };
  }

  async getDividends(params?: {
    cursor?: number;
    limit?: number;
    ticker?: string;
  }): Promise<{ items: Dividend[]; nextPagePath?: string }> {
    const queryParams = new URLSearchParams();
    if (params?.cursor) queryParams.append('cursor', params.cursor.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.ticker) queryParams.append('ticker', params.ticker);

    const qs = queryParams.toString();
    const endpoint = `/history/dividends${qs ? `?${qs}` : ''}`;
    const response = await this.request<{ items: unknown[]; nextPagePath?: string }>(endpoint);

    return {
      items: z.array(DividendSchema).parse(response.items),
      nextPagePath: response.nextPagePath,
    };
  }

  async getTransactions(params?: {
    cursor?: number;
    limit?: number;
  }): Promise<{ items: Transaction[]; nextPagePath?: string }> {
    const queryParams = new URLSearchParams();
    if (params?.cursor) queryParams.append('cursor', params.cursor.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());

    const qs = queryParams.toString();
    const endpoint = `/history/transactions${qs ? `?${qs}` : ''}`;
    const response = await this.request<{ items: unknown[]; nextPagePath?: string }>(endpoint);

    return {
      items: z.array(TransactionSchema).parse(response.items),
      nextPagePath: response.nextPagePath,
    };
  }

  async requestExport(exportRequest: ExportRequest): Promise<{ reportId: number }> {
    return this.request('/history/exports', {
      method: 'POST',
      body: JSON.stringify(exportRequest),
    });
  }
}
