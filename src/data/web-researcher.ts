import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';
import type { ExtractResult, SteerClient } from './steer-client.js';

const log = createLogger('web-researcher');

export interface WebResearchData {
  // From Finviz
  pegRatio: number | null;
  analystTargetPrice: number | null;
  shortInterestPct: number | null;
  institutionalOwnershipPct: number | null;
  perfWeek: number | null;
  perfMonth: number | null;
  perfQuarter: number | null;
  perfYear: number | null;
  relativeVolume: number | null;
  averageVolume: number | null;
  // From StockAnalysis
  analystConsensus: string | null;
  analystCount: number | null;
  epsEstimateNextQ: number | null;
  revenueEstimateNextQ: number | null;
  // Metadata
  fetchedAt: string;
}

interface CacheEntry {
  data: WebResearchData;
  expiresAt: number;
}

export class WebResearcher {
  private steerClient: SteerClient;
  private cache = new Map<string, CacheEntry>();

  constructor(steerClient: SteerClient) {
    this.steerClient = steerClient;
  }

  async getStockResearch(symbol: string): Promise<WebResearchData | null> {
    // Check cache first
    const cached = this.cache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) {
      log.debug({ symbol }, 'Web research cache hit');
      return cached.data;
    }

    // Check if steer is available
    const available = await this.steerClient.isAvailable();
    if (!available) {
      log.debug('Steer not available, skipping web research');
      return null;
    }

    const data: WebResearchData = {
      pegRatio: null,
      analystTargetPrice: null,
      shortInterestPct: null,
      institutionalOwnershipPct: null,
      perfWeek: null,
      perfMonth: null,
      perfQuarter: null,
      perfYear: null,
      relativeVolume: null,
      averageVolume: null,
      analystConsensus: null,
      analystCount: null,
      epsEstimateNextQ: null,
      revenueEstimateNextQ: null,
      fetchedAt: new Date().toISOString(),
    };

    // Scrape Finviz
    const finvizEnabled = configManager.get<boolean>('webResearch.finvizEnabled');
    if (finvizEnabled !== false) {
      try {
        const finvizData = await this.scrapeFinviz(symbol);
        if (finvizData) Object.assign(data, finvizData);
      } catch (err) {
        log.warn({ symbol, err }, 'Finviz scrape failed');
      }
    }

    // Scrape StockAnalysis
    const stockAnalysisEnabled = configManager.get<boolean>('webResearch.stockAnalysisEnabled');
    if (stockAnalysisEnabled !== false) {
      try {
        const saData = await this.scrapeStockAnalysis(symbol);
        if (saData) Object.assign(data, saData);
      } catch (err) {
        log.warn({ symbol, err }, 'StockAnalysis scrape failed');
      }
    }

    // Cache the result
    const cacheTtlHours = configManager.get<number>('webResearch.cacheTtlHours') ?? 4;
    this.cache.set(symbol, {
      data,
      expiresAt: Date.now() + cacheTtlHours * 60 * 60 * 1000,
    });

    log.info({ symbol }, 'Web research completed');
    return data;
  }

  async searchNews(query: string, maxResults = 10): Promise<string[]> {
    const available = await this.steerClient.isAvailable();
    if (!available) return [];

    try {
      const encodedQuery = encodeURIComponent(query);
      const result = await this.steerClient.scrape(
        `https://html.duckduckgo.com/html/?q=${encodedQuery}`,
        {
          mode: 'structured',
          selector: '.result',
          schema: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                snippet: { type: 'string' },
                url: { type: 'string' },
              },
            },
          },
          maxLength: 8000,
        },
      );

      const items = Array.isArray(result.content) ? result.content : [];
      return items
        .slice(0, maxResults)
        .map((item: unknown) => {
          const r = item as Record<string, unknown>;
          const title = String(r.title ?? '').trim();
          const snippet = String(r.snippet ?? '').trim();
          return title ? `${title}: ${snippet}` : snippet;
        })
        .filter(Boolean);
    } catch (err) {
      log.warn({ query, err }, 'DuckDuckGo search failed');
      return [];
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async scrapeFinviz(symbol: string): Promise<Partial<WebResearchData> | null> {
    const url = `https://finviz.com/quote.ashx?t=${symbol}&p=d`;
    let result: ExtractResult;
    try {
      result = await this.steerClient.scrape(url, {
        mode: 'text',
        selector: 'table.snapshot-table2',
        maxLength: 8000,
      });
    } catch (err) {
      log.warn({ symbol, err }, 'Finviz navigation/extract failed');
      return null;
    }

    const text = typeof result.content === 'string' ? result.content : '';
    if (!text) return null;

    return {
      pegRatio: this.extractFinvizMetric(text, 'PEG'),
      analystTargetPrice: this.extractFinvizMetric(text, 'Target Price'),
      shortInterestPct: this.extractFinvizPercent(text, 'Short Float'),
      institutionalOwnershipPct: this.extractFinvizPercent(text, 'Inst Own'),
      perfWeek: this.extractFinvizPercent(text, 'Perf Week'),
      perfMonth: this.extractFinvizPercent(text, 'Perf Month'),
      perfQuarter: this.extractFinvizPercent(text, 'Perf Quarter'),
      perfYear: this.extractFinvizPercent(text, 'Perf Year'),
      relativeVolume: this.extractFinvizMetric(text, 'Rel Volume'),
      averageVolume: this.extractFinvizVolume(text, 'Avg Volume'),
    };
  }

  private async scrapeStockAnalysis(symbol: string): Promise<Partial<WebResearchData> | null> {
    const url = `https://stockanalysis.com/stocks/${symbol.toLowerCase()}/forecast/`;
    let result: ExtractResult;
    try {
      result = await this.steerClient.scrape(url, {
        mode: 'text',
        maxLength: 8000,
      });
    } catch (err) {
      log.warn({ symbol, err }, 'StockAnalysis navigation/extract failed');
      return null;
    }

    const text = typeof result.content === 'string' ? result.content : '';
    if (!text) return null;

    return {
      analystConsensus: this.extractConsensus(text),
      analystCount: this.extractAnalystCount(text),
      epsEstimateNextQ: this.extractEstimate(text, 'EPS'),
      revenueEstimateNextQ: this.extractRevenueEstimate(text),
    };
  }

  // ─── Finviz Parsers ───────────────────────────────────

  private extractFinvizMetric(text: string, label: string): number | null {
    // Pattern: "Label\nValue" or "Label Value" in the table text
    const patterns = [
      new RegExp(`${this.escapeRegex(label)}\\s+([\\d.,-]+)`, 'i'),
      new RegExp(`${this.escapeRegex(label)}\\s*\\n\\s*([\\d.,-]+)`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const val = Number.parseFloat(match[1].replace(/,/g, ''));
        if (!Number.isNaN(val)) return val;
      }
    }
    return null;
  }

  private extractFinvizPercent(text: string, label: string): number | null {
    const patterns = [
      new RegExp(`${this.escapeRegex(label)}\\s+(-?[\\d.]+)%`, 'i'),
      new RegExp(`${this.escapeRegex(label)}\\s*\\n\\s*(-?[\\d.]+)%`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const val = Number.parseFloat(match[1]);
        if (!Number.isNaN(val)) return val / 100;
      }
    }
    return null;
  }

  private extractFinvizVolume(text: string, label: string): number | null {
    const patterns = [
      new RegExp(`${this.escapeRegex(label)}\\s+([\\d.,]+[KMB]?)`, 'i'),
      new RegExp(`${this.escapeRegex(label)}\\s*\\n\\s*([\\d.,]+[KMB]?)`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return this.parseVolume(match[1]);
      }
    }
    return null;
  }

  private parseVolume(raw: string): number | null {
    const clean = raw.replace(/,/g, '');
    const multipliers: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };
    const suffix = clean.slice(-1).toUpperCase();
    if (multipliers[suffix]) {
      const val = Number.parseFloat(clean.slice(0, -1));
      return Number.isNaN(val) ? null : val * multipliers[suffix];
    }
    const val = Number.parseFloat(clean);
    return Number.isNaN(val) ? null : val;
  }

  // ─── StockAnalysis Parsers ────────────────────────────

  private extractConsensus(text: string): string | null {
    const patterns = [
      /analyst\s+consensus[:\s]+(\w[\w\s]*\w)/i,
      /(Strong Buy|Buy|Hold|Sell|Strong Sell)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const consensus = match[1].trim();
        const normalized = this.normalizeConsensus(consensus);
        if (normalized) return normalized;
      }
    }
    return null;
  }

  private normalizeConsensus(raw: string): string | null {
    const lower = raw.toLowerCase();
    if (lower.includes('strong buy')) return 'Strong Buy';
    if (lower.includes('buy')) return 'Buy';
    if (lower.includes('hold') || lower.includes('neutral')) return 'Hold';
    if (lower.includes('strong sell')) return 'Strong Sell';
    if (lower.includes('sell') || lower.includes('underperform')) return 'Sell';
    return null;
  }

  private extractAnalystCount(text: string): number | null {
    const patterns = [/(\d+)\s+(?:wall\s+street\s+)?analyst/i, /based\s+on\s+(\d+)\s+analyst/i];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const val = Number.parseInt(match[1], 10);
        if (!Number.isNaN(val)) return val;
      }
    }
    return null;
  }

  private extractEstimate(text: string, label: string): number | null {
    const patterns = [
      new RegExp(`${label}\\s+estimate[:\\s]+\\$?([\\d.,-]+)`, 'i'),
      new RegExp(`${label}[:\\s]+\\$?([\\d.,-]+)\\s+(?:est|estimate)`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const val = Number.parseFloat(match[1].replace(/,/g, ''));
        if (!Number.isNaN(val)) return val;
      }
    }
    return null;
  }

  private extractRevenueEstimate(text: string): number | null {
    const patterns = [
      /revenue\s+estimate[:\s]+\$?([\d.,]+[KMBTkmbt]?)/i,
      /revenue\s+forecast[:\s]+\$?([\d.,]+[KMBTkmbt]?)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return this.parseLargeNumber(match[1]);
      }
    }
    return null;
  }

  private parseLargeNumber(raw: string): number | null {
    const clean = raw.replace(/,/g, '');
    const multipliers: Record<string, number> = {
      K: 1e3,
      M: 1e6,
      B: 1e9,
      T: 1e12,
    };
    const suffix = clean.slice(-1).toUpperCase();
    if (multipliers[suffix]) {
      const val = Number.parseFloat(clean.slice(0, -1));
      return Number.isNaN(val) ? null : val * multipliers[suffix];
    }
    const val = Number.parseFloat(clean);
    return Number.isNaN(val) ? null : val;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
