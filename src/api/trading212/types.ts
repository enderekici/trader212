import { z } from 'zod';

// Environment configuration
export type Environment = 'demo' | 'live';

// Account schemas
export const AccountInfoSchema = z
  .object({
    currencyCode: z.string().optional(),
    currency: z.string().optional(),
    id: z.number(),
  })
  .passthrough();

export const AccountCashSchema = z
  .object({
    free: z.number().optional(),
    total: z.number().optional(),
    availableToTrade: z.number().optional(),
    inPies: z.number().optional(),
    reservedForOrders: z.number().optional(),
    ppl: z.number().optional(),
    result: z.number().optional(),
    invested: z.number().optional(),
    pieCash: z.number().optional(),
    blocked: z.number().optional(),
  })
  .passthrough();

export const AccountSummarySchema = z
  .object({
    id: z.number().optional(),
    currency: z.string().optional(),
    cash: z
      .object({
        availableToTrade: z.number().optional(),
        inPies: z.number().optional(),
        reservedForOrders: z.number().optional(),
      })
      .passthrough()
      .optional(),
    investments: z
      .object({
        currentValue: z.number().optional(),
        totalCost: z.number().optional(),
        unrealizedProfitLoss: z.number().optional(),
        realizedProfitLoss: z.number().optional(),
      })
      .passthrough()
      .optional(),
    totalValue: z.number().optional(),
  })
  .passthrough();

// Embedded instrument (used in positions, orders, etc.)
const EmbeddedInstrumentSchema = z
  .object({
    ticker: z.string(),
    name: z.string().optional(),
    currency: z.string().optional(),
    currencyCode: z.string().optional(),
    isin: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

// Tradable instrument (from /metadata/instruments)
export const InstrumentSchema = z
  .object({
    ticker: z.string(),
    name: z.string(),
    shortName: z.string().optional(),
    type: z.string(),
    currencyCode: z.string().optional(),
    currency: z.string().optional(),
    isin: z.string().optional(),
    addedOn: z.string().optional(),
    workingScheduleId: z.number().optional(),
    maxOpenQuantity: z.number().optional(),
    minTradeQuantity: z.number().optional(),
    extendedHours: z.boolean().optional(),
  })
  .passthrough();

export const ExchangeSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    workingSchedules: z.array(
      z.object({
        id: z.number(),
        timeEvents: z.array(
          z
            .object({
              date: z.string(),
              type: z.string(),
            })
            .passthrough(),
        ),
      }),
    ),
  })
  .passthrough();

// Position schemas
export const PositionSchema = z
  .object({
    ticker: z.string().optional(),
    quantity: z.number(),
    currentPrice: z.number(),
    instrument: EmbeddedInstrumentSchema.optional(),
    averagePricePaid: z.number().optional(),
    createdAt: z.string().optional(),
    quantityAvailableForTrading: z.number().optional(),
    quantityInPies: z.number().optional(),
    walletImpact: z
      .object({
        currency: z.string().optional(),
        totalCost: z.number().optional(),
        currentValue: z.number().optional(),
        unrealizedProfitLoss: z.number().optional(),
        fxImpact: z.number().optional(),
      })
      .passthrough()
      .optional(),
    averagePrice: z.number().optional(),
    initialFillDate: z.string().optional(),
    maxBuy: z.number().nullable().optional(),
    maxSell: z.number().nullable().optional(),
    pieQuantity: z.number().optional(),
    ppl: z.number().optional(),
    frontend: z.string().optional(),
  })
  .passthrough();

// Order schemas
export const OrderTypeSchema = z.enum(['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT']);
export const OrderSideSchema = z.enum(['BUY', 'SELL']);
export const OrderStatusSchema = z.string();
export const TimeInForceSchema = z.enum(['DAY', 'GTC']);

export const OrderSchema = z
  .object({
    id: z.number(),
    ticker: z.string().optional(),
    instrument: EmbeddedInstrumentSchema.optional(),
    quantity: z.number().optional(),
    filledQuantity: z.number().optional(),
    value: z.number().optional(),
    filledValue: z.number().optional(),
    side: OrderSideSchema,
    type: OrderTypeSchema,
    limitPrice: z.number().optional(),
    stopPrice: z.number().optional(),
    status: z.string(),
    createdAt: z.string().optional(),
    createdOn: z.string().optional(),
    currency: z.string().optional(),
    strategy: z.string().optional(),
    timeInForce: z.string().optional(),
    timeValidity: z.string().optional(),
    extendedHours: z.boolean().optional(),
    initiatedFrom: z.string().optional(),
  })
  .passthrough();

// Market order request
export const MarketOrderRequestSchema = z.object({
  quantity: z.number().positive(),
  ticker: z.string(),
  timeValidity: TimeInForceSchema.default('DAY'),
});

// Limit order request
export const LimitOrderRequestSchema = z.object({
  limitPrice: z.number().positive(),
  quantity: z.number().positive(),
  ticker: z.string(),
  timeValidity: TimeInForceSchema.default('DAY'),
});

// Stop order request
export const StopOrderRequestSchema = z.object({
  quantity: z.number().positive(),
  stopPrice: z.number().positive(),
  ticker: z.string(),
  timeValidity: TimeInForceSchema.default('DAY'),
});

// Stop-limit order request
export const StopLimitOrderRequestSchema = z.object({
  limitPrice: z.number().positive(),
  quantity: z.number().positive(),
  stopPrice: z.number().positive(),
  ticker: z.string(),
  timeValidity: TimeInForceSchema.default('DAY'),
});

// Pie schemas
export const PieInstrumentSchema = z
  .object({
    expectedShare: z.number().optional(),
    ticker: z.string(),
  })
  .passthrough();

export const PieSchema = z
  .object({
    id: z.number().optional(),
    name: z.string().optional(),
    icon: z.string().optional(),
    cash: z.number().optional(),
    dividendCashAction: z.string().optional(),
    goal: z.number().nullable().optional(),
    endDate: z.string().nullable().optional(),
    creationDate: z.string().optional(),
    initialInvestment: z.number().optional(),
    instruments: z.array(PieInstrumentSchema).optional(),
    instrumentShares: z.record(z.string(), z.number()).optional(),
    publicUrl: z.string().optional(),
    progress: z.number().nullable().optional(),
    status: z.string().nullable().optional(),
    result: z.union([z.number(), z.object({}).passthrough()]).optional(),
    dividendDetails: z.object({}).passthrough().optional(),
  })
  .passthrough();

export const CreatePieRequestSchema = z.object({
  dividendCashAction: z.enum(['REINVEST', 'TO_ACCOUNT_CASH']),
  goal: z.number().positive().optional(),
  icon: z.string(),
  instrumentShares: z.record(z.string(), z.number()),
  name: z.string().min(1).max(50),
});

// Historical data schemas
export const HistoricalOrderSchema = z
  .object({
    order: z.object({}).passthrough().optional(),
    fill: z.object({}).passthrough().optional(),
    id: z.number().optional(),
    dateCreated: z.string().optional(),
    dateExecuted: z.string().optional(),
    dateModified: z.string().optional(),
    executor: z.string().optional(),
    fillCost: z.number().optional(),
    fillId: z.number().optional(),
    fillPrice: z.number().optional(),
    fillResult: z.number().optional(),
    fillType: z.string().optional(),
    filledQuantity: z.number().optional(),
    filledValue: z.number().optional(),
    limitPrice: z.number().optional(),
    orderedQuantity: z.number().optional(),
    orderedValue: z.number().optional(),
    parentOrder: z.number().optional(),
    status: z.string().optional(),
    stopPrice: z.number().optional(),
    taxes: z.object({}).passthrough().optional(),
    ticker: z.string().optional(),
    timeValidity: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

export const DividendSchema = z
  .object({
    amount: z.number(),
    ticker: z.string(),
    paidOn: z.string(),
    quantity: z.number(),
    instrument: EmbeddedInstrumentSchema.optional(),
    tickerCurrency: z.string().optional(),
    currency: z.string().optional(),
    amountInEuro: z.number().optional(),
    grossAmountPerShare: z.number().optional(),
    reference: z.string().optional(),
    type: z.string(),
  })
  .passthrough();

export const TransactionSchema = z
  .object({
    amount: z.number(),
    dateTime: z.string(),
    type: z.string(),
    currency: z.string().optional(),
    reference: z.string().optional(),
  })
  .passthrough();

export const ExportRequestSchema = z.object({
  dataIncluded: z.object({
    includeDividends: z.boolean(),
    includeInterest: z.boolean(),
    includeOrders: z.boolean(),
    includeTransactions: z.boolean(),
  }),
  timeFrom: z.string(),
  timeTo: z.string(),
});

// Rate limit info
export interface RateLimitInfo {
  limit: number;
  period: number;
  remaining: number;
  reset: number;
  used: number;
}

// Export types
export type AccountInfo = z.infer<typeof AccountInfoSchema>;
export type AccountCash = z.infer<typeof AccountCashSchema>;
export type AccountSummary = z.infer<typeof AccountSummarySchema>;
export type Instrument = z.infer<typeof InstrumentSchema>;
export type Exchange = z.infer<typeof ExchangeSchema>;
export type Position = z.infer<typeof PositionSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type MarketOrderRequest = z.infer<typeof MarketOrderRequestSchema>;
export type LimitOrderRequest = z.infer<typeof LimitOrderRequestSchema>;
export type StopOrderRequest = z.infer<typeof StopOrderRequestSchema>;
export type StopLimitOrderRequest = z.infer<typeof StopLimitOrderRequestSchema>;
export type Pie = z.infer<typeof PieSchema>;
export type CreatePieRequest = z.infer<typeof CreatePieRequestSchema>;
export type HistoricalOrder = z.infer<typeof HistoricalOrderSchema>;
export type Dividend = z.infer<typeof DividendSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
