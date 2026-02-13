import { describe, expect, it } from 'vitest';
import {
  AccountCashSchema,
  AccountInfoSchema,
  AccountSummarySchema,
  CreatePieRequestSchema,
  DividendSchema,
  ExchangeSchema,
  ExportRequestSchema,
  HistoricalOrderSchema,
  InstrumentSchema,
  LimitOrderRequestSchema,
  MarketOrderRequestSchema,
  OrderSchema,
  OrderSideSchema,
  OrderStatusSchema,
  OrderTypeSchema,
  PieInstrumentSchema,
  PieSchema,
  PositionSchema,
  StopLimitOrderRequestSchema,
  StopOrderRequestSchema,
  TimeInForceSchema,
  TransactionSchema,
} from '../../src/api/trading212/types.js';

describe('Zod Schemas', () => {
  describe('AccountInfoSchema', () => {
    it('parses valid data', () => {
      const result = AccountInfoSchema.parse({ id: 123, currencyCode: 'USD' });
      expect(result.id).toBe(123);
      expect(result.currencyCode).toBe('USD');
    });

    it('parses with optional fields missing', () => {
      const result = AccountInfoSchema.parse({ id: 1 });
      expect(result.id).toBe(1);
      expect(result.currencyCode).toBeUndefined();
    });

    it('allows passthrough of extra fields', () => {
      const result = AccountInfoSchema.parse({ id: 1, extra: 'field' });
      expect((result as Record<string, unknown>).extra).toBe('field');
    });

    it('rejects missing required fields', () => {
      expect(() => AccountInfoSchema.parse({})).toThrow();
    });

    it('rejects invalid id type', () => {
      expect(() => AccountInfoSchema.parse({ id: 'not-a-number' })).toThrow();
    });
  });

  describe('AccountCashSchema', () => {
    it('parses valid data with all fields', () => {
      const data = {
        free: 1000,
        total: 5000,
        availableToTrade: 900,
        inPies: 100,
        reservedForOrders: 50,
        ppl: 200,
        result: 300,
        invested: 4000,
        pieCash: 10,
        blocked: 5,
      };
      const result = AccountCashSchema.parse(data);
      expect(result.free).toBe(1000);
      expect(result.total).toBe(5000);
    });

    it('parses with all fields optional', () => {
      const result = AccountCashSchema.parse({});
      expect(result.free).toBeUndefined();
    });

    it('rejects invalid field types', () => {
      expect(() => AccountCashSchema.parse({ free: 'not-a-number' })).toThrow();
    });
  });

  describe('AccountSummarySchema', () => {
    it('parses valid data', () => {
      const data = {
        id: 1,
        currency: 'USD',
        cash: { availableToTrade: 100, inPies: 50, reservedForOrders: 25 },
        investments: {
          currentValue: 1000,
          totalCost: 800,
          unrealizedProfitLoss: 200,
          realizedProfitLoss: 50,
        },
        totalValue: 1100,
      };
      const result = AccountSummarySchema.parse(data);
      expect(result.id).toBe(1);
      expect(result.cash?.availableToTrade).toBe(100);
    });

    it('parses with all optional fields missing', () => {
      const result = AccountSummarySchema.parse({});
      expect(result.id).toBeUndefined();
    });
  });

  describe('InstrumentSchema', () => {
    it('parses valid instrument', () => {
      const data = { ticker: 'AAPL_US_EQ', name: 'Apple Inc.', type: 'STOCK' };
      const result = InstrumentSchema.parse(data);
      expect(result.ticker).toBe('AAPL_US_EQ');
      expect(result.name).toBe('Apple Inc.');
    });

    it('parses with all optional fields', () => {
      const data = {
        ticker: 'AAPL_US_EQ',
        name: 'Apple',
        type: 'STOCK',
        shortName: 'AAPL',
        currencyCode: 'USD',
        isin: 'US0378331005',
        minTradeQuantity: 0.001,
        maxOpenQuantity: 1000,
        extendedHours: true,
        addedOn: '2020-01-01',
        workingScheduleId: 1,
      };
      const result = InstrumentSchema.parse(data);
      expect(result.shortName).toBe('AAPL');
      expect(result.minTradeQuantity).toBe(0.001);
    });

    it('rejects missing required fields', () => {
      expect(() => InstrumentSchema.parse({ ticker: 'AAPL' })).toThrow();
      expect(() => InstrumentSchema.parse({ name: 'Apple', type: 'STOCK' })).toThrow();
    });
  });

  describe('ExchangeSchema', () => {
    it('parses valid exchange', () => {
      const data = {
        id: 1,
        name: 'NYSE',
        workingSchedules: [
          {
            id: 1,
            timeEvents: [{ date: '2024-01-01', type: 'OPEN' }],
          },
        ],
      };
      const result = ExchangeSchema.parse(data);
      expect(result.name).toBe('NYSE');
    });

    it('rejects missing required fields', () => {
      expect(() => ExchangeSchema.parse({ id: 1 })).toThrow();
    });
  });

  describe('PositionSchema', () => {
    it('parses valid position', () => {
      const data = {
        ticker: 'AAPL_US_EQ',
        quantity: 10,
        currentPrice: 150.0,
        averagePricePaid: 140.0,
      };
      const result = PositionSchema.parse(data);
      expect(result.quantity).toBe(10);
      expect(result.currentPrice).toBe(150.0);
    });

    it('parses with embedded instrument', () => {
      const data = {
        quantity: 5,
        currentPrice: 100,
        instrument: { ticker: 'AAPL_US_EQ', name: 'Apple' },
      };
      const result = PositionSchema.parse(data);
      expect(result.instrument?.ticker).toBe('AAPL_US_EQ');
    });

    it('parses with walletImpact', () => {
      const data = {
        quantity: 5,
        currentPrice: 100,
        walletImpact: {
          currency: 'USD',
          totalCost: 500,
          currentValue: 600,
          unrealizedProfitLoss: 100,
          fxImpact: 0,
        },
      };
      const result = PositionSchema.parse(data);
      expect(result.walletImpact?.totalCost).toBe(500);
    });

    it('rejects missing required fields', () => {
      expect(() => PositionSchema.parse({ ticker: 'AAPL' })).toThrow();
    });

    it('allows nullable maxBuy and maxSell', () => {
      const data = { quantity: 5, currentPrice: 100, maxBuy: null, maxSell: null };
      const result = PositionSchema.parse(data);
      expect(result.maxBuy).toBeNull();
      expect(result.maxSell).toBeNull();
    });
  });

  describe('OrderSchema', () => {
    it('parses valid order', () => {
      const data = {
        id: 1,
        side: 'BUY',
        type: 'MARKET',
        status: 'FILLED',
        quantity: 10,
      };
      const result = OrderSchema.parse(data);
      expect(result.id).toBe(1);
      expect(result.side).toBe('BUY');
      expect(result.type).toBe('MARKET');
    });

    it('parses all order types', () => {
      for (const type of ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT']) {
        const data = { id: 1, side: 'BUY', type, status: 'PENDING' };
        expect(() => OrderSchema.parse(data)).not.toThrow();
      }
    });

    it('parses BUY and SELL sides', () => {
      for (const side of ['BUY', 'SELL']) {
        const data = { id: 1, side, type: 'MARKET', status: 'PENDING' };
        expect(() => OrderSchema.parse(data)).not.toThrow();
      }
    });

    it('rejects invalid side', () => {
      expect(() => OrderSchema.parse({ id: 1, side: 'HOLD', type: 'MARKET', status: 'OK' })).toThrow();
    });

    it('rejects invalid type', () => {
      expect(() => OrderSchema.parse({ id: 1, side: 'BUY', type: 'INVALID', status: 'OK' })).toThrow();
    });

    it('parses with optional fields', () => {
      const data = {
        id: 1,
        side: 'BUY',
        type: 'LIMIT',
        status: 'PENDING',
        ticker: 'AAPL_US_EQ',
        limitPrice: 150,
        stopPrice: 140,
        createdAt: '2024-01-01T00:00:00Z',
        extendedHours: true,
      };
      const result = OrderSchema.parse(data);
      expect(result.limitPrice).toBe(150);
      expect(result.extendedHours).toBe(true);
    });
  });

  describe('OrderTypeSchema', () => {
    it('accepts valid types', () => {
      expect(OrderTypeSchema.parse('MARKET')).toBe('MARKET');
      expect(OrderTypeSchema.parse('LIMIT')).toBe('LIMIT');
      expect(OrderTypeSchema.parse('STOP')).toBe('STOP');
      expect(OrderTypeSchema.parse('STOP_LIMIT')).toBe('STOP_LIMIT');
    });

    it('rejects invalid types', () => {
      expect(() => OrderTypeSchema.parse('TRAILING_STOP')).toThrow();
    });
  });

  describe('OrderSideSchema', () => {
    it('accepts BUY and SELL', () => {
      expect(OrderSideSchema.parse('BUY')).toBe('BUY');
      expect(OrderSideSchema.parse('SELL')).toBe('SELL');
    });

    it('rejects invalid values', () => {
      expect(() => OrderSideSchema.parse('HOLD')).toThrow();
    });
  });

  describe('OrderStatusSchema', () => {
    it('accepts any string', () => {
      expect(OrderStatusSchema.parse('FILLED')).toBe('FILLED');
      expect(OrderStatusSchema.parse('CANCELLED')).toBe('CANCELLED');
      expect(OrderStatusSchema.parse('anything')).toBe('anything');
    });
  });

  describe('TimeInForceSchema', () => {
    it('accepts DAY and GTC', () => {
      expect(TimeInForceSchema.parse('DAY')).toBe('DAY');
      expect(TimeInForceSchema.parse('GTC')).toBe('GTC');
    });

    it('rejects invalid values', () => {
      expect(() => TimeInForceSchema.parse('IOC')).toThrow();
    });
  });

  describe('MarketOrderRequestSchema', () => {
    it('parses valid market order', () => {
      const result = MarketOrderRequestSchema.parse({
        quantity: 10,
        ticker: 'AAPL_US_EQ',
      });
      expect(result.quantity).toBe(10);
      expect(result.ticker).toBe('AAPL_US_EQ');
      expect(result.timeValidity).toBe('DAY');
    });

    it('accepts custom timeValidity', () => {
      const result = MarketOrderRequestSchema.parse({
        quantity: 1,
        ticker: 'TSLA_US_EQ',
        timeValidity: 'GTC',
      });
      expect(result.timeValidity).toBe('GTC');
    });

    it('rejects non-positive quantity', () => {
      expect(() =>
        MarketOrderRequestSchema.parse({ quantity: 0, ticker: 'AAPL_US_EQ' }),
      ).toThrow();
      expect(() =>
        MarketOrderRequestSchema.parse({ quantity: -1, ticker: 'AAPL_US_EQ' }),
      ).toThrow();
    });

    it('rejects missing ticker', () => {
      expect(() => MarketOrderRequestSchema.parse({ quantity: 1 })).toThrow();
    });
  });

  describe('LimitOrderRequestSchema', () => {
    it('parses valid limit order', () => {
      const result = LimitOrderRequestSchema.parse({
        limitPrice: 150,
        quantity: 5,
        ticker: 'AAPL_US_EQ',
      });
      expect(result.limitPrice).toBe(150);
      expect(result.timeValidity).toBe('DAY');
    });

    it('rejects non-positive limitPrice', () => {
      expect(() =>
        LimitOrderRequestSchema.parse({ limitPrice: 0, quantity: 1, ticker: 'T' }),
      ).toThrow();
    });
  });

  describe('StopOrderRequestSchema', () => {
    it('parses valid stop order', () => {
      const result = StopOrderRequestSchema.parse({
        quantity: 5,
        stopPrice: 140,
        ticker: 'AAPL_US_EQ',
      });
      expect(result.stopPrice).toBe(140);
    });

    it('rejects non-positive stopPrice', () => {
      expect(() =>
        StopOrderRequestSchema.parse({ quantity: 1, stopPrice: -1, ticker: 'T' }),
      ).toThrow();
    });
  });

  describe('StopLimitOrderRequestSchema', () => {
    it('parses valid stop-limit order', () => {
      const result = StopLimitOrderRequestSchema.parse({
        limitPrice: 145,
        quantity: 5,
        stopPrice: 140,
        ticker: 'AAPL_US_EQ',
      });
      expect(result.limitPrice).toBe(145);
      expect(result.stopPrice).toBe(140);
    });

    it('rejects when limitPrice is missing', () => {
      expect(() =>
        StopLimitOrderRequestSchema.parse({ quantity: 1, stopPrice: 10, ticker: 'T' }),
      ).toThrow();
    });
  });

  describe('PieInstrumentSchema', () => {
    it('parses valid pie instrument', () => {
      const result = PieInstrumentSchema.parse({ ticker: 'AAPL_US_EQ', expectedShare: 0.5 });
      expect(result.ticker).toBe('AAPL_US_EQ');
    });

    it('allows extra fields (passthrough)', () => {
      const result = PieInstrumentSchema.parse({ ticker: 'T', extra: true });
      expect((result as Record<string, unknown>).extra).toBe(true);
    });
  });

  describe('PieSchema', () => {
    it('parses valid pie', () => {
      const data = {
        id: 1,
        name: 'My Pie',
        icon: 'star',
        cash: 100,
        dividendCashAction: 'REINVEST',
        instruments: [{ ticker: 'AAPL_US_EQ', expectedShare: 0.5 }],
      };
      const result = PieSchema.parse(data);
      expect(result.name).toBe('My Pie');
    });

    it('parses with nullable fields', () => {
      const data = { goal: null, endDate: null, progress: null, status: null };
      const result = PieSchema.parse(data);
      expect(result.goal).toBeNull();
    });

    it('parses with instrumentShares', () => {
      const data = { instrumentShares: { 'AAPL_US_EQ': 0.5, 'TSLA_US_EQ': 0.5 } };
      const result = PieSchema.parse(data);
      expect(result.instrumentShares?.['AAPL_US_EQ']).toBe(0.5);
    });

    it('parses with result as number or object', () => {
      expect(() => PieSchema.parse({ result: 100 })).not.toThrow();
      expect(() => PieSchema.parse({ result: { value: 100 } })).not.toThrow();
    });

    it('parses empty pie', () => {
      const result = PieSchema.parse({});
      expect(result.id).toBeUndefined();
    });
  });

  describe('CreatePieRequestSchema', () => {
    it('parses valid create pie request', () => {
      const data = {
        dividendCashAction: 'REINVEST',
        icon: 'star',
        instrumentShares: { 'AAPL_US_EQ': 0.5, 'TSLA_US_EQ': 0.5 },
        name: 'My Pie',
      };
      const result = CreatePieRequestSchema.parse(data);
      expect(result.name).toBe('My Pie');
    });

    it('rejects invalid dividendCashAction', () => {
      expect(() =>
        CreatePieRequestSchema.parse({
          dividendCashAction: 'BURN',
          icon: 'star',
          instrumentShares: {},
          name: 'Pie',
        }),
      ).toThrow();
    });

    it('accepts TO_ACCOUNT_CASH', () => {
      const result = CreatePieRequestSchema.parse({
        dividendCashAction: 'TO_ACCOUNT_CASH',
        icon: 'star',
        instrumentShares: {},
        name: 'Pie',
      });
      expect(result.dividendCashAction).toBe('TO_ACCOUNT_CASH');
    });

    it('rejects empty name', () => {
      expect(() =>
        CreatePieRequestSchema.parse({
          dividendCashAction: 'REINVEST',
          icon: 'star',
          instrumentShares: {},
          name: '',
        }),
      ).toThrow();
    });

    it('rejects name longer than 50 chars', () => {
      expect(() =>
        CreatePieRequestSchema.parse({
          dividendCashAction: 'REINVEST',
          icon: 'star',
          instrumentShares: {},
          name: 'A'.repeat(51),
        }),
      ).toThrow();
    });

    it('accepts optional goal', () => {
      const result = CreatePieRequestSchema.parse({
        dividendCashAction: 'REINVEST',
        goal: 10000,
        icon: 'star',
        instrumentShares: {},
        name: 'Pie',
      });
      expect(result.goal).toBe(10000);
    });
  });

  describe('HistoricalOrderSchema', () => {
    it('parses valid historical order', () => {
      const data = {
        id: 1,
        ticker: 'AAPL_US_EQ',
        status: 'FILLED',
        type: 'MARKET',
        filledQuantity: 10,
        fillPrice: 150,
      };
      const result = HistoricalOrderSchema.parse(data);
      expect(result.id).toBe(1);
    });

    it('parses empty object', () => {
      const result = HistoricalOrderSchema.parse({});
      expect(result.id).toBeUndefined();
    });

    it('allows passthrough', () => {
      const result = HistoricalOrderSchema.parse({ customField: 'value' });
      expect((result as Record<string, unknown>).customField).toBe('value');
    });
  });

  describe('DividendSchema', () => {
    it('parses valid dividend', () => {
      const data = {
        amount: 5.0,
        ticker: 'AAPL_US_EQ',
        paidOn: '2024-01-01',
        quantity: 10,
        type: 'ORDINARY',
      };
      const result = DividendSchema.parse(data);
      expect(result.amount).toBe(5.0);
      expect(result.type).toBe('ORDINARY');
    });

    it('rejects missing required fields', () => {
      expect(() => DividendSchema.parse({ amount: 5 })).toThrow();
      expect(() => DividendSchema.parse({ ticker: 'T', paidOn: '2024', quantity: 1 })).toThrow();
    });

    it('parses with optional fields', () => {
      const data = {
        amount: 5,
        ticker: 'AAPL_US_EQ',
        paidOn: '2024-01-01',
        quantity: 10,
        type: 'ORDINARY',
        currency: 'USD',
        amountInEuro: 4.5,
        grossAmountPerShare: 0.5,
        reference: 'ref123',
        instrument: { ticker: 'AAPL_US_EQ' },
      };
      const result = DividendSchema.parse(data);
      expect(result.currency).toBe('USD');
    });
  });

  describe('TransactionSchema', () => {
    it('parses valid transaction', () => {
      const data = {
        amount: 100,
        dateTime: '2024-01-01T00:00:00Z',
        type: 'DEPOSIT',
      };
      const result = TransactionSchema.parse(data);
      expect(result.amount).toBe(100);
      expect(result.type).toBe('DEPOSIT');
    });

    it('rejects missing required fields', () => {
      expect(() => TransactionSchema.parse({ amount: 100 })).toThrow();
    });

    it('parses with optional fields', () => {
      const data = {
        amount: 50,
        dateTime: '2024-01-01',
        type: 'WITHDRAWAL',
        currency: 'EUR',
        reference: 'ref456',
      };
      const result = TransactionSchema.parse(data);
      expect(result.currency).toBe('EUR');
    });
  });

  describe('ExportRequestSchema', () => {
    it('parses valid export request', () => {
      const data = {
        dataIncluded: {
          includeDividends: true,
          includeInterest: false,
          includeOrders: true,
          includeTransactions: true,
        },
        timeFrom: '2024-01-01',
        timeTo: '2024-12-31',
      };
      const result = ExportRequestSchema.parse(data);
      expect(result.dataIncluded.includeDividends).toBe(true);
    });

    it('rejects missing dataIncluded fields', () => {
      expect(() =>
        ExportRequestSchema.parse({
          dataIncluded: { includeDividends: true },
          timeFrom: '2024-01-01',
          timeTo: '2024-12-31',
        }),
      ).toThrow();
    });

    it('rejects missing timeFrom', () => {
      expect(() =>
        ExportRequestSchema.parse({
          dataIncluded: {
            includeDividends: true,
            includeInterest: true,
            includeOrders: true,
            includeTransactions: true,
          },
          timeTo: '2024-12-31',
        }),
      ).toThrow();
    });
  });
});
