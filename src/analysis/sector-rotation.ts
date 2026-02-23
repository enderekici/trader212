import { YahooFinanceClient } from '../data/yahoo-finance.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('sector-rotation');

export type SectorStrength = 'leading' | 'lagging' | 'neutral';

export interface SectorAnalysis {
  sector: string;
  etf: string;
  rs1m: number; // 1-month relative strength vs SPY
  rs3m: number; // 3-month relative strength vs SPY
  strength: SectorStrength;
}

export interface SectorRotationData {
  sectors: SectorAnalysis[];
  timestamp: string;
}

const SECTOR_ETFS: Record<string, string> = {
  XLK: 'Technology',
  XLF: 'Financial Services',
  XLV: 'Healthcare',
  XLY: 'Consumer Cyclical',
  XLP: 'Consumer Defensive',
  XLE: 'Energy',
  XLI: 'Industrials',
  XLB: 'Basic Materials',
  XLRE: 'Real Estate',
  XLU: 'Utilities',
  XLC: 'Communication Services',
};

/**
 * Compute percentage return over a given number of trading days.
 * Returns NaN if there are not enough candles.
 */
function pctReturn(closes: number[], tradingDays: number): number {
  if (closes.length < tradingDays + 1) {
    return Number.NaN;
  }
  const startIdx = closes.length - tradingDays - 1;
  const endIdx = closes.length - 1;
  return ((closes[endIdx] - closes[startIdx]) / closes[startIdx]) * 100;
}

function classifyStrength(rs1m: number, rs3m: number): SectorStrength {
  if (rs1m > 2 && rs3m > 3) {
    return 'leading';
  }
  if (rs1m < -2 && rs3m < -3) {
    return 'lagging';
  }
  return 'neutral';
}

export class SectorRotationAnalyzer {
  private yahooClient: YahooFinanceClient;
  private cache: { data: SectorRotationData; expiresAt: number } | null = null;
  private readonly CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

  constructor(yahooClient?: YahooFinanceClient) {
    this.yahooClient = yahooClient ?? new YahooFinanceClient();
  }

  /**
   * Analyze sector rotation by computing relative strength of 11 SPDR sector ETFs vs SPY.
   */
  async analyze(): Promise<SectorRotationData> {
    // Check cache
    if (this.cache && Date.now() < this.cache.expiresAt) {
      log.debug('Returning cached sector rotation data');
      return this.cache.data;
    }

    log.info('Fetching sector rotation data');

    // Fetch SPY benchmark data
    const spyCandles = await this.yahooClient.getHistoricalData('SPY', 90);
    if (spyCandles.length === 0) {
      log.warn('No SPY data available for sector rotation analysis');
      const emptyResult: SectorRotationData = {
        sectors: [],
        timestamp: new Date().toISOString(),
      };
      return emptyResult;
    }

    const spyCloses = spyCandles.map((c) => c.close);

    const spyReturn1m = pctReturn(spyCloses, 22);
    const spyReturn3m = pctReturn(spyCloses, 66);

    const sectors: SectorAnalysis[] = [];

    for (const [etf, sector] of Object.entries(SECTOR_ETFS)) {
      try {
        const candles = await this.yahooClient.getHistoricalData(etf, 90);
        if (candles.length === 0) {
          log.warn({ etf, sector }, 'No data for sector ETF, skipping');
          continue;
        }

        const closes = candles.map((c) => c.close);

        const etfReturn1m = pctReturn(closes, 22);
        const etfReturn3m = pctReturn(closes, 66);

        // Skip if we don't have enough data for either period
        if (Number.isNaN(etfReturn1m) || Number.isNaN(etfReturn3m)) {
          log.warn({ etf, sector }, 'Insufficient data for RS calculation, skipping');
          continue;
        }

        // Also skip if SPY doesn't have enough data
        if (Number.isNaN(spyReturn1m) || Number.isNaN(spyReturn3m)) {
          log.warn('Insufficient SPY data for RS calculation');
          continue;
        }

        const rs1m = etfReturn1m - spyReturn1m;
        const rs3m = etfReturn3m - spyReturn3m;
        const strength = classifyStrength(rs1m, rs3m);

        sectors.push({ sector, etf, rs1m, rs3m, strength });
      } catch (err) {
        log.error({ etf, sector, err }, 'Failed to fetch sector ETF data');
      }
    }

    const result: SectorRotationData = {
      sectors,
      timestamp: new Date().toISOString(),
    };

    // Cache the result
    this.cache = {
      data: result,
      expiresAt: Date.now() + this.CACHE_TTL,
    };

    log.info(
      {
        sectorCount: sectors.length,
        leading: sectors.filter((s) => s.strength === 'leading').length,
        lagging: sectors.filter((s) => s.strength === 'lagging').length,
      },
      'Sector rotation analysis complete',
    );

    return result;
  }

  /**
   * Look up the strength of a sector by name (case-insensitive).
   * Returns 'neutral' if not found or no cached data.
   */
  getSectorStrength(sectorName: string): SectorStrength {
    if (!this.cache) {
      return 'neutral';
    }

    const lower = sectorName.toLowerCase();
    const match = this.cache.data.sectors.find((s) => s.sector.toLowerCase() === lower);

    return match?.strength ?? 'neutral';
  }
}

// Singleton
let instance: SectorRotationAnalyzer | null = null;

export function getSectorRotationAnalyzer(): SectorRotationAnalyzer {
  if (!instance) {
    instance = new SectorRotationAnalyzer();
  }
  return instance;
}
