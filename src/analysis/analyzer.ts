import { desc, eq } from 'drizzle-orm';
import { configManager } from '../config/manager.js';
import type { DataAggregator, StockData } from '../data/data-aggregator.js';
import { getDb } from '../db/index.js';
import * as dbSchema from '../db/schema.js';
import { createLogger } from '../utils/logger.js';
import { type FundamentalAnalysis, analyzeFundamentals } from './fundamental/scorer.js';
import {
  type SentimentAnalysis,
  type SentimentInput,
  analyzeSentiment,
} from './sentiment/scorer.js';
import { type TechnicalAnalysis, analyzeTechnicals } from './technical/scorer.js';

const log = createLogger('analyzer');

export interface FullStockAnalysis {
  symbol: string;
  timestamp: string;
  price: number;
  technical: TechnicalAnalysis;
  fundamental: FundamentalAnalysis | null;
  sentiment: SentimentAnalysis;
  historicalSignals: Array<{
    timestamp: string;
    technicalScore: number;
    sentimentScore: number;
    fundamentalScore: number;
    decision: string;
    rsi: number | null;
    macdHistogram: number | null;
  }>;
  data: StockData;
}

export async function analyzeStock(
  symbol: string,
  dataAggregator: DataAggregator,
): Promise<FullStockAnalysis | null> {
  log.info({ symbol }, 'Starting stock analysis');

  const data = await dataAggregator.getStockData(symbol);
  if (!data.quote || data.candles.length === 0) {
    log.warn({ symbol }, 'Insufficient data for analysis');
    return null;
  }

  // Technical analysis
  const technical = analyzeTechnicals(data.candles);

  // Fundamental analysis
  const fundamental = data.fundamentals ? analyzeFundamentals(data.fundamentals) : null;

  // Sentiment analysis
  const sentimentInput: SentimentInput = {
    finnhubNews: data.finnhubNews,
    marketauxNews: data.marketauxNews,
    insiderTransactions: data.insiderTransactions,
    earnings: data.earnings,
  };
  const sentiment = analyzeSentiment(sentimentInput);

  // Fetch historical signals
  const db = getDb();
  const historicalSignalCount = configManager.get<number>('ai.historicalSignalCount');
  const historicalSignals = db
    .select()
    .from(dbSchema.signals)
    .where(eq(dbSchema.signals.symbol, symbol))
    .orderBy(desc(dbSchema.signals.timestamp))
    .limit(historicalSignalCount)
    .all()
    .map((s) => ({
      timestamp: s.timestamp,
      technicalScore: s.technicalScore ?? 0,
      sentimentScore: s.sentimentScore ?? 0,
      fundamentalScore: s.fundamentalScore ?? 0,
      decision: s.decision ?? 'HOLD',
      rsi: s.rsi ?? null,
      macdHistogram: s.macdHistogram ?? null,
    }));

  // Store signal snapshot in DB
  const timestamp = new Date().toISOString();
  db.insert(dbSchema.signals)
    .values({
      timestamp,
      symbol,
      rsi: technical.rsi,
      macdValue: technical.macd?.value ?? null,
      macdSignal: technical.macd?.signal ?? null,
      macdHistogram: technical.macd?.histogram ?? null,
      sma20: technical.sma20,
      sma50: technical.sma50,
      sma200: technical.sma200,
      ema12: technical.ema12,
      ema26: technical.ema26,
      bollingerUpper: technical.bollinger?.upper ?? null,
      bollingerMiddle: technical.bollinger?.middle ?? null,
      bollingerLower: technical.bollinger?.lower ?? null,
      atr: technical.atr,
      adx: technical.adx,
      stochasticK: technical.stochastic?.k ?? null,
      stochasticD: technical.stochastic?.d ?? null,
      williamsR: technical.williamsR,
      mfi: technical.mfi,
      cci: technical.cci,
      obv: technical.obv,
      vwap: technical.vwap,
      parabolicSar: technical.parabolicSar,
      roc: technical.roc,
      forceIndex: technical.forceIndex,
      volumeRatio: technical.volumeRatio,
      supportLevel: technical.supportResistance?.support ?? null,
      resistanceLevel: technical.supportResistance?.resistance ?? null,
      technicalScore: technical.score,
      sentimentScore: sentiment.score,
      fundamentalScore: fundamental?.score ?? null,
    })
    .run();

  log.info(
    {
      symbol,
      technicalScore: technical.score,
      fundamentalScore: fundamental?.score ?? null,
      sentimentScore: sentiment.score,
    },
    'Stock analysis complete',
  );

  return {
    symbol,
    timestamp,
    price: data.quote.price,
    technical,
    fundamental,
    sentiment,
    historicalSignals,
    data,
  };
}
