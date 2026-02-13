import { desc, eq } from 'drizzle-orm';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import { positions, priceCache } from '../db/schema.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('correlation');

export interface CorrelationResult {
  symbol1: string;
  symbol2: string;
  correlation: number;
  isHighlyCorrelated: boolean;
}

export class CorrelationAnalyzer {
  /** Calculate Pearson correlation between two price series */
  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 5) return 0; // Need at least 5 data points

    const xSlice = x.slice(-n);
    const ySlice = y.slice(-n);

    const meanX = xSlice.reduce((a, b) => a + b, 0) / n;
    const meanY = ySlice.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < n; i++) {
      const dx = xSlice[i] - meanX;
      const dy = ySlice[i] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }

    const denom = Math.sqrt(denomX * denomY);
    return denom > 0 ? numerator / denom : 0;
  }

  /** Get price returns for a symbol from the price cache */
  private getReturns(symbol: string, lookbackDays: number): number[] {
    const db = getDb();
    const prices = db
      .select()
      .from(priceCache)
      .where(eq(priceCache.symbol, symbol))
      .orderBy(desc(priceCache.timestamp))
      .limit(lookbackDays + 1)
      .all()
      .reverse();

    if (prices.length < 2) return [];

    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const prev = prices[i - 1].close;
      const curr = prices[i].close;
      if (prev && curr && prev > 0) {
        returns.push((curr - prev) / prev);
      }
    }

    return returns;
  }

  /** Check correlation between a new stock and all existing positions */
  checkCorrelationWithPortfolio(newSymbol: string): CorrelationResult[] {
    const db = getDb();
    const allPositions = db.select().from(positions).all();
    const maxCorrelation = configManager.get<number>('risk.maxCorrelation');
    const lookbackDays = configManager.get<number>('risk.correlationLookbackDays');

    const newReturns = this.getReturns(newSymbol, lookbackDays);
    if (newReturns.length < 5) {
      log.debug({ symbol: newSymbol }, 'Insufficient price data for correlation check');
      return [];
    }

    const results: CorrelationResult[] = [];

    for (const pos of allPositions) {
      if (pos.symbol === newSymbol) continue;

      const posReturns = this.getReturns(pos.symbol, lookbackDays);
      if (posReturns.length < 5) continue;

      const correlation = this.pearsonCorrelation(newReturns, posReturns);

      results.push({
        symbol1: newSymbol,
        symbol2: pos.symbol,
        correlation,
        isHighlyCorrelated: Math.abs(correlation) > maxCorrelation,
      });
    }

    const highCorrelation = results.filter((r) => r.isHighlyCorrelated);
    if (highCorrelation.length > 0) {
      log.warn(
        {
          symbol: newSymbol,
          highCorrelationWith: highCorrelation.map(
            (r) => `${r.symbol2}(${r.correlation.toFixed(2)})`,
          ),
        },
        'High correlation detected with existing positions',
      );
    }

    return results;
  }

  /** Get full correlation matrix for all positions */
  getPortfolioCorrelationMatrix(): { symbols: string[]; matrix: number[][] } {
    const db = getDb();
    const allPositions = db.select().from(positions).all();
    const lookbackDays = configManager.get<number>('risk.correlationLookbackDays');

    const symbols = allPositions.map((p) => p.symbol);
    const returnsBySymbol = new Map<string, number[]>();

    for (const symbol of symbols) {
      returnsBySymbol.set(symbol, this.getReturns(symbol, lookbackDays));
    }

    const matrix: number[][] = [];
    for (let i = 0; i < symbols.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < symbols.length; j++) {
        if (i === j) {
          matrix[i][j] = 1;
        } else {
          const r1 = returnsBySymbol.get(symbols[i]) ?? [];
          const r2 = returnsBySymbol.get(symbols[j]) ?? [];
          matrix[i][j] = this.pearsonCorrelation(r1, r2);
        }
      }
    }

    return { symbols, matrix };
  }
}
