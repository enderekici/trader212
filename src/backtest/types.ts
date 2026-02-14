export interface BacktestConfig {
  symbols: string[];
  startDate: string;
  endDate: string;
  initialCapital: number;
  maxPositions: number;
  maxPositionSizePct: number;
  stopLossPct: number;
  takeProfitPct?: number;
  roiTable?: Record<string, number>;
  trailingStop: boolean;
  commission: number;
  entryThreshold: number;
}

export interface BacktestTrade {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  shares: number;
  entryTime: string;
  exitTime: string;
  pnl: number;
  pnlPct: number;
  exitReason: string;
  holdMinutes: number;
  technicalScore: number;
}

export interface BacktestPosition {
  symbol: string;
  shares: number;
  entryPrice: number;
  entryTime: string;
  stopLoss: number;
  trailingStop?: number;
  takeProfit?: number;
  highWaterMark: number;
  technicalScore: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  equityCurve: { date: string; equity: number }[];
  dailyReturns: number[];
}

export interface BacktestMetrics {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnl: number;
  totalPnlPct: number;
  avgWin: number | null;
  avgLoss: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  currentDrawdown: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  sqn: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  avgHoldMinutes: number;
  bestTrade: { symbol: string; pnlPct: number } | null;
  worstTrade: { symbol: string; pnlPct: number } | null;
  finalEquity: number;
  returnPct: number;
}

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface EntrySignal {
  symbol: string;
  score: number;
  price: number;
}
