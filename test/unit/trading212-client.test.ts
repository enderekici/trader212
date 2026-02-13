import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { mockConfigGet } = vi.hoisted(() => ({
  mockConfigGet: vi.fn(),
}));

vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: mockConfigGet,
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { Trading212Client } from '../../src/api/trading212/client.js';
import { ApiError, AuthError, RateLimitError } from '../../src/api/trading212/errors.js';

function createMockResponse(options: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}) {
  const headers = new Map(Object.entries(options.headers ?? {}));
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: vi.fn().mockResolvedValue(options.json ?? {}),
    text: vi.fn().mockResolvedValue(options.text ?? ''),
    headers: {
      get: (key: string) => headers.get(key) ?? null,
      forEach: (cb: (value: string, key: string) => void) => {
        headers.forEach((value, key) => cb(value, key));
      },
    },
  };
}

describe('Trading212Client', () => {
  let client: Trading212Client;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigGet.mockImplementation((key: string) => {
      if (key === 't212.environment') return 'demo';
      return null;
    });
    originalFetch = global.fetch;
    global.fetch = vi.fn();
    client = new Trading212Client('test-api-key');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockFetch = () => vi.mocked(global.fetch);

  describe('constructor', () => {
    it('uses demo URL for demo environment', () => {
      expect(client).toBeDefined();
    });

    it('uses live URL for live environment', () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 't212.environment') return 'live';
        return null;
      });
      const liveClient = new Trading212Client('key');
      expect(liveClient).toBeDefined();
    });
  });

  describe('getAuthHeaders', () => {
    it('adds Basic auth header with base64 encoded key (appends colon)', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: { id: 1 } }) as unknown as Response,
      );
      await client.getAccountInfo();

      const call = mockFetch().mock.calls[0];
      const requestInit = call[1] as RequestInit;
      const headers = requestInit.headers as Record<string, string>;
      const expectedCreds = Buffer.from('test-api-key:').toString('base64');
      expect(headers.Authorization).toBe(`Basic ${expectedCreds}`);
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('does not add extra colon when key already contains colon', async () => {
      const colonClient = new Trading212Client('user:pass');
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: { id: 1 } }) as unknown as Response,
      );
      await colonClient.getAccountInfo();

      const call = mockFetch().mock.calls[0];
      const requestInit = call[1] as RequestInit;
      const headers = requestInit.headers as Record<string, string>;
      const expectedCreds = Buffer.from('user:pass').toString('base64');
      expect(headers.Authorization).toBe(`Basic ${expectedCreds}`);
    });
  });

  describe('error handling', () => {
    it('throws RateLimitError on 429', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 429,
          headers: {
            'x-ratelimit-reset': '1700000000',
            'x-ratelimit-limit': '30',
            'x-ratelimit-remaining': '0',
          },
        }) as unknown as Response,
      );

      await expect(client.getAccountInfo()).rejects.toThrow(RateLimitError);
    });

    it('throws AuthError on 401', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 401,
          text: JSON.stringify({ message: 'Unauthorized' }),
        }) as unknown as Response,
      );

      await expect(client.getAccountInfo()).rejects.toThrow(AuthError);
    });

    it('throws ApiError on other error statuses', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 500,
          text: JSON.stringify({ message: 'Internal Server Error' }),
        }) as unknown as Response,
      );

      await expect(client.getAccountInfo()).rejects.toThrow(ApiError);
    });

    it('parses error JSON with message field', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 400,
          text: JSON.stringify({ message: 'Bad request details' }),
        }) as unknown as Response,
      );

      try {
        await client.getAccountInfo();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).message).toContain('Bad request details');
      }
    });

    it('parses error JSON with errorMessage field', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 400,
          text: JSON.stringify({ errorMessage: 'Error detail' }),
        }) as unknown as Response,
      );

      try {
        await client.getAccountInfo();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).message).toContain('Error detail');
      }
    });

    it('uses raw text when error is not valid JSON', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 502,
          text: 'Bad Gateway',
        }) as unknown as Response,
      );

      try {
        await client.getAccountInfo();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).message).toContain('Bad Gateway');
      }
    });

    it('uses errorText as fallback when JSON has neither message nor errorMessage', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 400,
          text: JSON.stringify({ other: 'field' }),
        }) as unknown as Response,
      );

      try {
        await client.getAccountInfo();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        // Falls through to errorText since message and errorMessage are falsy
        expect((err as ApiError).message).toContain('other');
      }
    });
  });

  describe('rate limit tracking', () => {
    it('stores rate limit info from response headers', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({
          json: { id: 1 },
          headers: {
            'x-ratelimit-limit': '30',
            'x-ratelimit-period': '10',
            'x-ratelimit-remaining': '28',
            'x-ratelimit-reset': '1700000010',
            'x-ratelimit-used': '2',
          },
        }) as unknown as Response,
      );

      await client.getAccountInfo();

      const info = client.getRateLimitInfo('/equity/account/info');
      expect(info).toEqual({
        limit: 30,
        period: 10,
        remaining: 28,
        reset: 1700000010,
        used: 2,
      });
    });

    it('returns null when rate limit headers are incomplete', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({
          json: { id: 1 },
          headers: {
            'x-ratelimit-limit': '30',
            // Missing other required headers
          },
        }) as unknown as Response,
      );

      await client.getAccountInfo();

      const info = client.getRateLimitInfo('/equity/account/info');
      expect(info).toBeNull();
    });

    it('returns null when no rate limit headers', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: { id: 1 } }) as unknown as Response,
      );

      await client.getAccountInfo();

      const info = client.getRateLimitInfo('/equity/account/info');
      expect(info).toBeNull();
    });

    it('returns null for unknown endpoints', () => {
      expect(client.getRateLimitInfo('/unknown')).toBeNull();
    });

    it('warns when rate limit is nearly exhausted (remaining <= 2)', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({
          json: { id: 1 },
          headers: {
            'x-ratelimit-limit': '30',
            'x-ratelimit-period': '10',
            'x-ratelimit-remaining': '1',
            'x-ratelimit-reset': '1700000010',
            'x-ratelimit-used': '29',
          },
        }) as unknown as Response,
      );

      await client.getAccountInfo();
      const info = client.getRateLimitInfo('/equity/account/info');
      expect(info?.remaining).toBe(1);
    });
  });

  describe('Account endpoints', () => {
    it('getAccountInfo', async () => {
      const data = { id: 123, currencyCode: 'USD' };
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: data }) as unknown as Response,
      );

      const result = await client.getAccountInfo();
      expect(result.id).toBe(123);
      expect(mockFetch()).toHaveBeenCalledWith(
        'https://demo.trading212.com/api/v0/equity/account/info',
        expect.any(Object),
      );
    });

    it('getAccountCash', async () => {
      const data = { free: 1000, total: 5000 };
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: data }) as unknown as Response,
      );

      const result = await client.getAccountCash();
      expect(result.free).toBe(1000);
    });

    it('getAccountSummary', async () => {
      const data = { id: 1, totalValue: 10000 };
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: data }) as unknown as Response,
      );

      const result = await client.getAccountSummary();
      expect(result.totalValue).toBe(10000);
    });
  });

  describe('Portfolio endpoints', () => {
    it('getPortfolio', async () => {
      const data = [{ ticker: 'AAPL_US_EQ', quantity: 10, currentPrice: 150 }];
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: data }) as unknown as Response,
      );

      const result = await client.getPortfolio();
      expect(result).toHaveLength(1);
      expect(result[0].quantity).toBe(10);
    });

    it('getPosition', async () => {
      const data = { ticker: 'AAPL_US_EQ', quantity: 10, currentPrice: 150 };
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: data }) as unknown as Response,
      );

      const result = await client.getPosition('AAPL_US_EQ');
      expect(result.ticker).toBe('AAPL_US_EQ');
      expect(mockFetch()).toHaveBeenCalledWith(
        expect.stringContaining('AAPL_US_EQ'),
        expect.any(Object),
      );
    });
  });

  describe('Order endpoints', () => {
    const validOrder = {
      id: 1,
      side: 'BUY',
      type: 'MARKET',
      status: 'FILLED',
      quantity: 10,
    };

    it('getOrders', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: [validOrder] }) as unknown as Response,
      );

      const result = await client.getOrders();
      expect(result).toHaveLength(1);
    });

    it('getOrder', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: validOrder }) as unknown as Response,
      );

      const result = await client.getOrder(1);
      expect(result.id).toBe(1);
    });

    it('cancelOrder', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({}) as unknown as Response,
      );

      await expect(client.cancelOrder(1)).resolves.not.toThrow();
      const call = mockFetch().mock.calls[0];
      expect(call[1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
    });

    it('placeMarketOrder', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: validOrder }) as unknown as Response,
      );

      const result = await client.placeMarketOrder({
        quantity: 10,
        ticker: 'AAPL_US_EQ',
        timeValidity: 'DAY',
      });
      expect(result.id).toBe(1);
      const call = mockFetch().mock.calls[0];
      expect(call[1]).toEqual(expect.objectContaining({ method: 'POST' }));
    });

    it('placeLimitOrder', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: validOrder }) as unknown as Response,
      );

      const result = await client.placeLimitOrder({
        limitPrice: 150,
        quantity: 10,
        ticker: 'AAPL_US_EQ',
        timeValidity: 'DAY',
      });
      expect(result.id).toBe(1);
    });

    it('placeStopOrder', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: validOrder }) as unknown as Response,
      );

      const result = await client.placeStopOrder({
        quantity: 10,
        stopPrice: 140,
        ticker: 'AAPL_US_EQ',
        timeValidity: 'DAY',
      });
      expect(result.id).toBe(1);
    });

    it('placeStopLimitOrder', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: validOrder }) as unknown as Response,
      );

      const result = await client.placeStopLimitOrder({
        limitPrice: 145,
        quantity: 10,
        stopPrice: 140,
        ticker: 'AAPL_US_EQ',
        timeValidity: 'DAY',
      });
      expect(result.id).toBe(1);
    });
  });

  describe('Instruments & Market Data endpoints', () => {
    it('getInstruments', async () => {
      const data = [
        { ticker: 'AAPL_US_EQ', name: 'Apple Inc.', type: 'STOCK' },
        { ticker: 'TSLA_US_EQ', name: 'Tesla Inc.', type: 'STOCK' },
      ];
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: data }) as unknown as Response,
      );

      const result = await client.getInstruments();
      expect(result).toHaveLength(2);
    });

    it('getExchanges', async () => {
      const data = [
        {
          id: 1,
          name: 'NYSE',
          workingSchedules: [
            { id: 1, timeEvents: [{ date: '2024-01-01', type: 'OPEN' }] },
          ],
        },
      ];
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: data }) as unknown as Response,
      );

      const result = await client.getExchanges();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('NYSE');
    });
  });

  describe('Pie endpoints', () => {
    const validPie = {
      id: 1,
      name: 'My Pie',
      icon: 'star',
    };

    it('getPies', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: [validPie] }) as unknown as Response,
      );

      const result = await client.getPies();
      expect(result).toHaveLength(1);
    });

    it('getPie', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: validPie }) as unknown as Response,
      );

      const result = await client.getPie(1);
      expect(result.name).toBe('My Pie');
    });

    it('createPie', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: validPie }) as unknown as Response,
      );

      const result = await client.createPie({
        dividendCashAction: 'REINVEST',
        icon: 'star',
        instrumentShares: { 'AAPL_US_EQ': 0.5 },
        name: 'My Pie',
      });
      expect(result.name).toBe('My Pie');
    });

    it('updatePie', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: validPie }) as unknown as Response,
      );

      const result = await client.updatePie(1, { name: 'Updated Pie' });
      expect(result).toBeDefined();
    });

    it('deletePie', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({}) as unknown as Response,
      );

      await expect(client.deletePie(1)).resolves.not.toThrow();
    });
  });

  describe('Historical data endpoints', () => {
    it('getOrderHistory without params', async () => {
      const data = { items: [], nextPagePath: undefined };
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: data }) as unknown as Response,
      );

      const result = await client.getOrderHistory();
      expect(result.items).toEqual([]);
    });

    it('getOrderHistory with all params', async () => {
      const data = {
        items: [{ id: 1, ticker: 'AAPL_US_EQ', status: 'FILLED' }],
        nextPagePath: '/next',
      };
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: data }) as unknown as Response,
      );

      const result = await client.getOrderHistory({ cursor: 100, limit: 50, ticker: 'AAPL_US_EQ' });
      expect(result.items).toHaveLength(1);
      expect(result.nextPagePath).toBe('/next');
      expect(mockFetch()).toHaveBeenCalledWith(
        expect.stringContaining('cursor=100'),
        expect.any(Object),
      );
    });

    it('getDividends without params', async () => {
      const data = { items: [], nextPagePath: undefined };
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: data }) as unknown as Response,
      );

      const result = await client.getDividends();
      expect(result.items).toEqual([]);
    });

    it('getDividends with params', async () => {
      const data = {
        items: [
          { amount: 5, ticker: 'AAPL_US_EQ', paidOn: '2024-01-01', quantity: 10, type: 'ORDINARY' },
        ],
        nextPagePath: '/next',
      };
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: data }) as unknown as Response,
      );

      const result = await client.getDividends({ cursor: 1, limit: 10, ticker: 'AAPL_US_EQ' });
      expect(result.items).toHaveLength(1);
    });

    it('getTransactions without params', async () => {
      const data = { items: [], nextPagePath: undefined };
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: data }) as unknown as Response,
      );

      const result = await client.getTransactions();
      expect(result.items).toEqual([]);
    });

    it('getTransactions with params', async () => {
      const data = {
        items: [
          { amount: 100, dateTime: '2024-01-01T00:00:00Z', type: 'DEPOSIT' },
        ],
        nextPagePath: '/next',
      };
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: data }) as unknown as Response,
      );

      const result = await client.getTransactions({ cursor: 1, limit: 10 });
      expect(result.items).toHaveLength(1);
    });

    it('requestExport', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: { reportId: 42 } }) as unknown as Response,
      );

      const result = await client.requestExport({
        dataIncluded: {
          includeDividends: true,
          includeInterest: false,
          includeOrders: true,
          includeTransactions: true,
        },
        timeFrom: '2024-01-01',
        timeTo: '2024-12-31',
      });
      expect(result.reportId).toBe(42);
    });
  });

  describe('Zod schema validation', () => {
    it('validates response data with Zod schema on success', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: { id: 123, currencyCode: 'USD' } }) as unknown as Response,
      );

      const result = await client.getAccountInfo();
      expect(result.id).toBe(123);
    });

    it('throws ZodError when response does not match schema', async () => {
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: { id: 'not-a-number' } }) as unknown as Response,
      );

      await expect(client.getAccountInfo()).rejects.toThrow();
    });

    it('returns raw data when no schema is provided', async () => {
      // requestExport has no schema on the request
      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: { reportId: 42 } }) as unknown as Response,
      );

      const result = await client.requestExport({
        dataIncluded: {
          includeDividends: true,
          includeInterest: false,
          includeOrders: true,
          includeTransactions: true,
        },
        timeFrom: '2024-01-01',
        timeTo: '2024-12-31',
      });
      expect(result.reportId).toBe(42);
    });
  });

  describe('Live environment URL', () => {
    it('uses live.trading212.com for live environment', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 't212.environment') return 'live';
        return null;
      });
      const liveClient = new Trading212Client('live-key');

      mockFetch().mockResolvedValueOnce(
        createMockResponse({ json: { id: 1 } }) as unknown as Response,
      );
      await liveClient.getAccountInfo();

      expect(mockFetch()).toHaveBeenCalledWith(
        'https://live.trading212.com/api/v0/equity/account/info',
        expect.any(Object),
      );
    });
  });
});
