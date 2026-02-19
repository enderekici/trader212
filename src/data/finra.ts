import axios from 'axios';
import { createLogger } from '../utils/logger.js';

const log = createLogger('finra');

export interface FinraShortData {
  symbol: string;
  shortVolume: number;
  totalVolume: number;
  shortVolumePct: number;
  date: string;
  fetchedAt: string;
}

const BASE_URL = 'https://cdn.finra.org/equity/regsho/daily';

export class FinraClient {
  private cache = new Map<string, Map<string, FinraShortData>>();

  private formatDate(d: Date): string {
    // Return YYYYMMDD
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }

  private async fetchForDate(dateStr: string): Promise<Map<string, FinraShortData>> {
    const cached = this.cache.get(dateStr);
    if (cached) return cached;

    const url = `${BASE_URL}/CNMSshvol${dateStr}.txt`;
    try {
      const response = await axios.get(url, { timeout: 15_000, responseType: 'text' });
      const lines: string[] = response.data.split('\n');
      const map = new Map<string, FinraShortData>();

      for (const line of lines) {
        const parts = line.trim().split('|');
        // Format: Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market
        if (parts.length < 5) continue;
        const sym = parts[1];
        if (!sym || sym === 'Symbol') continue;
        const shortVol = parseInt(parts[2], 10) || 0;
        const totalVol = parseInt(parts[4], 10) || 0;
        if (totalVol === 0) continue;

        if (map.has(sym)) {
          // aggregate across markets
          const existing = map.get(sym);
          if (!existing) continue;
          existing.shortVolume += shortVol;
          existing.totalVolume += totalVol;
          existing.shortVolumePct = (existing.shortVolume / existing.totalVolume) * 100;
        } else {
          map.set(sym, {
            symbol: sym,
            shortVolume: shortVol,
            totalVolume: totalVol,
            shortVolumePct: (shortVol / totalVol) * 100,
            date: `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`,
            fetchedAt: new Date().toISOString(),
          });
        }
      }

      if (map.size > 0) this.cache.set(dateStr, map);
      return map;
    } catch (err) {
      log.warn({ dateStr, err }, 'Failed to fetch FINRA data');
      return new Map();
    }
  }

  async getShortData(symbols: string[]): Promise<Map<string, FinraShortData>> {
    const today = new Date();
    const todayStr = this.formatDate(today);

    let data = await this.fetchForDate(todayStr);

    if (data.size === 0) {
      // Try yesterday (pre-market or weekend)
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      data = await this.fetchForDate(this.formatDate(yesterday));
    }

    // Try up to 3 more days back (weekends)
    if (data.size === 0) {
      for (let i = 2; i <= 4; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        data = await this.fetchForDate(this.formatDate(d));
        if (data.size > 0) break;
      }
    }

    const result = new Map<string, FinraShortData>();
    for (const sym of symbols) {
      const entry = data.get(sym);
      if (entry) result.set(sym, entry);
    }
    return result;
  }
}

let instance: FinraClient | null = null;
export function getFinraClient(): FinraClient {
  if (!instance) instance = new FinraClient();
  return instance;
}
