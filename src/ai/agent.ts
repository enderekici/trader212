import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';
import { AnthropicAdapter } from './adapters/anthropic.js';
import { OllamaAdapter } from './adapters/ollama.js';
import { OpenAICompatibleAdapter } from './adapters/openai-compat.js';

const log = createLogger('ai-agent');

export interface AIContext {
  symbol: string;
  currentPrice: number;
  priceChange1d: number;
  priceChange5d: number;
  priceChange1m: number;
  technical: {
    rsi: number | null;
    macdValue: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    ema12: number | null;
    ema26: number | null;
    bollingerUpper: number | null;
    bollingerMiddle: number | null;
    bollingerLower: number | null;
    atr: number | null;
    adx: number | null;
    stochasticK: number | null;
    stochasticD: number | null;
    williamsR: number | null;
    mfi: number | null;
    cci: number | null;
    obv: number | null;
    vwap: number | null;
    parabolicSar: number | null;
    roc: number | null;
    forceIndex: number | null;
    volumeRatio: number | null;
    support: number | null;
    resistance: number | null;
    score: number;
  };
  fundamental: {
    peRatio: number | null;
    forwardPE: number | null;
    revenueGrowthYoY: number | null;
    profitMargin: number | null;
    operatingMargin: number | null;
    debtToEquity: number | null;
    currentRatio: number | null;
    marketCap: number | null;
    sector: string | null;
    beta: number | null;
    dividendYield: number | null;
    score: number;
  };
  sentiment: {
    headlines: Array<{ title: string; score: number; source: string }>;
    insiderNetBuying: number;
    daysToEarnings: number | null;
    score: number;
  };
  historicalSignals: Array<{
    timestamp: string;
    technicalScore: number;
    sentimentScore: number;
    fundamentalScore: number;
    decision: string;
    rsi: number | null;
    macdHistogram: number | null;
  }>;
  portfolio: {
    cashAvailable: number;
    portfolioValue: number;
    openPositions: number;
    maxPositions: number;
    todayPnl: number;
    todayPnlPct: number;
    sectorExposure: Record<string, number>;
    existingPositions: Array<{
      symbol: string;
      pnlPct: number;
      entryPrice: number;
      currentPrice: number;
    }>;
  };
  marketContext: {
    spyPrice: number;
    spyChange1d: number;
    vixLevel: number;
    marketTrend: string;
  };
  riskConstraints: {
    maxPositionSizePct: number;
    maxStopLossPct: number;
    minStopLossPct: number;
    maxRiskPerTradePct: number;
    dailyLossLimitPct: number;
  };
  correlationWarnings?: string[];
}

export interface AIDecision {
  decision: 'BUY' | 'SELL' | 'HOLD';
  conviction: number;
  reasoning: string;
  risks: string[];
  suggestedStopLossPct: number;
  suggestedPositionSizePct: number;
  suggestedTakeProfitPct: number;
  urgency: 'immediate' | 'wait_for_dip' | 'no_rush';
  exitConditions: string;
}

export interface AIAgent {
  analyze(context: AIContext): Promise<AIDecision>;
  rawChat(system: string, user: string): Promise<string>;
}

export function createAIAgent(): AIAgent {
  const provider = configManager.get<string>('ai.provider');
  log.info({ provider }, 'Creating AI agent');
  switch (provider) {
    case 'ollama':
      return new OllamaAdapter();
    case 'openai-compatible':
      return new OpenAICompatibleAdapter();
    default:
      return new AnthropicAdapter();
  }
}
