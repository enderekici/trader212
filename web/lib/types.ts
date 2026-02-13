export interface Position {
  id: number;
  symbol: string;
  t212Ticker: string;
  shares: number;
  entryPrice: number;
  entryTime: string;
  currentPrice?: number;
  pnl?: number;
  pnlPct?: number;
  stopLoss?: number;
  trailingStop?: number;
  takeProfit?: number;
  convictionScore?: number;
  stopOrderId?: string;
  aiExitConditions?: string;
  accountType: string;
  updatedAt?: string;
}

export interface Trade {
  id: number;
  symbol: string;
  t212Ticker: string;
  side: 'BUY' | 'SELL';
  shares: number;
  entryPrice: number;
  exitPrice?: number;
  pnl?: number;
  pnlPct?: number;
  entryTime: string;
  exitTime?: string;
  stopLoss?: number;
  takeProfit?: number;
  exitReason?: string;
  aiReasoning?: string;
  convictionScore?: number;
  aiModel?: string;
  accountType: string;
  createdAt?: string;
}

export interface Signal {
  id: number;
  timestamp: string;
  symbol: string;
  rsi?: number;
  macdValue?: number;
  macdSignal?: number;
  macdHistogram?: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  ema12?: number;
  ema26?: number;
  bollingerUpper?: number;
  bollingerMiddle?: number;
  bollingerLower?: number;
  atr?: number;
  adx?: number;
  stochasticK?: number;
  stochasticD?: number;
  williamsR?: number;
  mfi?: number;
  cci?: number;
  obv?: number;
  vwap?: number;
  parabolicSar?: number;
  roc?: number;
  forceIndex?: number;
  volumeRatio?: number;
  supportLevel?: number;
  resistanceLevel?: number;
  technicalScore?: number;
  sentimentScore?: number;
  fundamentalScore?: number;
  aiScore?: number;
  convictionTotal?: number;
  decision?: 'BUY' | 'SELL' | 'HOLD';
  executed?: boolean;
  aiReasoning?: string;
  aiModel?: string;
  suggestedStopLossPct?: number;
  suggestedPositionSizePct?: number;
  suggestedTakeProfitPct?: number;
  extraIndicators?: string;
  newsHeadlines?: string;
}

export interface DailyMetrics {
  id: number;
  date: string;
  totalPnl?: number;
  tradesCount?: number;
  winCount?: number;
  lossCount?: number;
  winRate?: number;
  maxDrawdown?: number;
  sharpeRatio?: number;
  profitFactor?: number;
  portfolioValue?: number;
  cashBalance?: number;
  accountType?: string;
}

export interface PortfolioResponse {
  positions: Position[];
  cashAvailable: number;
  totalValue: number;
  pnl: number;
}

export interface TradesResponse {
  trades: Trade[];
  total: number;
}

export interface SignalsResponse {
  signals: Signal[];
  total: number;
}

export interface PerformanceResponse {
  winRate: number;
  avgReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  totalTrades: number;
  totalPnl: number;
}

export interface DailyMetricsResponse {
  metrics: DailyMetrics[];
}

export interface StatusResponse {
  status: 'running' | 'paused';
  uptime: number;
  startedAt: string;
  marketStatus: 'open' | 'pre' | 'after' | 'closed';
  accountType: string;
  environment: string;
  dryRun: boolean;
  marketTimes: MarketTimes;
}

export interface ConfigItem {
  key: string;
  value: unknown;
  description: string | null;
}

export type ConfigResponse = Record<string, ConfigItem[]>;

export interface PairlistResponse {
  stocks: string[];
  lastRefreshed: string | null;
}

export interface TradePlan {
  id: number;
  symbol: string;
  t212Ticker: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'expired';
  side: 'BUY' | 'SELL';
  entryPrice: number;
  shares: number;
  positionValue: number;
  positionSizePct: number;
  stopLossPrice: number;
  stopLossPct: number;
  takeProfitPrice: number;
  takeProfitPct: number;
  maxLossDollars: number;
  riskRewardRatio: number;
  maxHoldDays: number | null;
  aiConviction: number;
  aiReasoning: string | null;
  aiModel: string | null;
  risks: string[];
  urgency: string | null;
  exitConditions: string | null;
  technicalScore: number | null;
  fundamentalScore: number | null;
  sentimentScore: number | null;
  accountType: string;
  approvedAt: string | null;
  approvedBy: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ResearchResult {
  symbol: string;
  recommendation: string;
  conviction: number;
  reasoning: string;
  catalysts: string[];
  risks: string[];
  targetPrice?: number;
  timeHorizon: string;
  sector: string;
}

export interface ResearchReport {
  id: number;
  timestamp: string;
  query: string;
  results: ResearchResult[];
  marketContext: Record<string, unknown> | null;
  aiModel: string | null;
}

export interface AuditEntry {
  id: number;
  timestamp: string;
  eventType: string;
  category: string;
  symbol: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  severity: 'info' | 'warn' | 'error';
}

export interface MarketTimes {
  currentTimeET: string;
  currentTimeUTC: string;
  marketStatus: 'open' | 'pre' | 'after' | 'closed';
  nextOpen: string;
  nextClose: string | null;
  countdownMinutes: number;
  isHoliday: boolean;
  isEarlyClose: boolean;
}

export interface WSMessage {
  event: string;
  data: unknown;
  timestamp: string;
}
