import axios from 'axios';
import { createLogger } from '../utils/logger.js';

const log = createLogger('fred');

const BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

export interface FredMacroData {
  yieldCurve: number | null; // T10Y2Y spread (negative = inverted)
  creditSpread: number | null; // BAMLH0A0HYM2 (HY spread)
  financialConditions: number | null; // NFCI index
  netLiquidity: number | null; // WALCL - WTREGEN - RRPONTSYD (millions USD)
  timestamp: string; // ISO 8601 UTC
}

export class FredClient {
  private apiKey: string | null;
  private cache: { data: FredMacroData; expiresAt: number } | null = null;
  private readonly CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

  constructor() {
    this.apiKey = process.env.FRED_API_KEY || null;
  }

  async getMacroData(): Promise<FredMacroData | null> {
    if (!this.apiKey) {
      log.debug('FRED_API_KEY not set, skipping macro data');
      return null;
    }

    if (this.cache && Date.now() < this.cache.expiresAt) {
      return this.cache.data;
    }

    const [yieldCurve, creditSpread, financialConditions, walcl, wtregen, rrpontsyd] =
      await Promise.all([
        this.fetchSeries('T10Y2Y'),
        this.fetchSeries('BAMLH0A0HYM2'),
        this.fetchSeries('NFCI'),
        this.fetchSeries('WALCL'),
        this.fetchSeries('WTREGEN'),
        this.fetchSeries('RRPONTSYD'),
      ]);

    const netLiquidity =
      walcl !== null && wtregen !== null && rrpontsyd !== null ? walcl - wtregen - rrpontsyd : null;

    const data: FredMacroData = {
      yieldCurve,
      creditSpread,
      financialConditions,
      netLiquidity,
      timestamp: new Date().toISOString(),
    };

    this.cache = {
      data,
      expiresAt: Date.now() + this.CACHE_TTL,
    };

    log.info(
      {
        yieldCurve,
        creditSpread,
        financialConditions,
        netLiquidity: netLiquidity !== null ? `${netLiquidity}M` : null,
      },
      'FRED macro data fetched',
    );

    return data;
  }

  private async fetchSeries(seriesId: string): Promise<number | null> {
    try {
      const response = await axios.get(BASE_URL, {
        params: {
          series_id: seriesId,
          api_key: this.apiKey,
          file_type: 'json',
          limit: 1,
          sort_order: 'desc',
        },
        timeout: 10_000,
      });

      const observations = response.data?.observations;
      if (!observations || observations.length === 0) {
        log.warn({ seriesId }, 'No observations returned from FRED');
        return null;
      }

      const value = observations[0].value;
      if (value === '.' || value === undefined || value === null) {
        log.debug({ seriesId }, 'FRED observation value is missing (".")');
        return null;
      }

      const parsed = Number.parseFloat(value);
      if (Number.isNaN(parsed)) {
        log.warn({ seriesId, value }, 'FRED observation value is not a number');
        return null;
      }

      return parsed;
    } catch (err) {
      log.warn({ seriesId, err }, 'FRED series fetch failed');
      return null;
    }
  }
}

let instance: FredClient | null = null;
export function getFredClient(): FredClient {
  if (!instance) {
    instance = new FredClient();
  }
  return instance;
}
