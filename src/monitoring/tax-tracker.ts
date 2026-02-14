import { configManager } from '../config/manager.js';
import {
  closeLot,
  createTaxLot,
  getClosedLots,
  getOpenLots,
  getYearSummary,
} from '../db/repositories/tax-lots.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('tax-tracker');

export interface HarvestCandidate {
  symbol: string;
  shares: number;
  costBasis: number;
  currentPrice: number;
  unrealizedLoss: number;
  holdingPeriod: 'short' | 'long';
  taxSavings: number;
}

export interface YearlyTaxSummary {
  shortTermGains: number;
  longTermGains: number;
  shortTermLosses: number;
  longTermLosses: number;
  netTaxLiability: number;
  harvestOpportunities: number;
}

export interface TaxImpactEstimate {
  totalPnL: number;
  shortTermPnL: number;
  longTermPnL: number;
  estimatedTax: number;
  effectiveTaxRate: number;
}

export interface WashSaleWarning {
  symbol: string;
  saleDate: string;
  daysUntilSafe: number;
  message: string;
}

export class TaxTracker {
  async recordPurchase(
    symbol: string,
    shares: number,
    costBasis: number,
    accountType: 'INVEST' | 'ISA',
  ): Promise<void> {
    const enabled = configManager.get<boolean>('tax.enabled');
    if (!enabled) {
      logger.debug('Tax tracking disabled, skipping purchase record');
      return;
    }

    const purchaseDate = new Date().toISOString();

    await createTaxLot({
      symbol,
      shares,
      costBasis,
      purchaseDate,
      accountType,
    });

    logger.info({ symbol, shares, costBasis, accountType }, 'Recorded tax lot for purchase');
  }

  async recordSale(
    symbol: string,
    shares: number,
    salePrice: number,
    saleDate?: string,
  ): Promise<void> {
    const enabled = configManager.get<boolean>('tax.enabled');
    if (!enabled) {
      logger.debug('Tax tracking disabled, skipping sale record');
      return;
    }

    const saleDateIso = saleDate || new Date().toISOString();
    const openLots = await getOpenLots(symbol);

    if (openLots.length === 0) {
      logger.warn({ symbol }, 'No open tax lots found for sale');
      return;
    }

    // FIFO: close lots in order of purchase date
    let remainingShares = shares;

    for (const lot of openLots) {
      if (remainingShares <= 0) break;

      const sharesToClose = Math.min(remainingShares, lot.shares);
      const pnl = sharesToClose * (salePrice - lot.costBasis);
      const holdingPeriod = this.determineHoldingPeriod(lot.purchaseDate, saleDateIso);

      // Close the entire lot (or mark it sold if partial)
      await closeLot(lot.id, {
        saleDate: saleDateIso,
        salePrice,
        pnl,
        holdingPeriod,
      });

      logger.info(
        { symbol, lotId: lot.id, shares: sharesToClose, pnl, holdingPeriod },
        'Closed tax lot',
      );

      // If partial lot, create a new lot for the remaining shares
      if (sharesToClose < lot.shares) {
        await createTaxLot({
          symbol: lot.symbol,
          shares: lot.shares - sharesToClose,
          costBasis: lot.costBasis,
          purchaseDate: lot.purchaseDate,
          accountType: lot.accountType,
        });

        logger.info(
          {
            symbol,
            shares: lot.shares - sharesToClose,
            costBasis: lot.costBasis,
          },
          'Created new lot for remaining shares',
        );
      }

      remainingShares -= sharesToClose;
    }

    if (remainingShares > 0) {
      logger.warn({ symbol, remainingShares }, 'Not enough open lots to cover sale');
    }
  }

  async getHarvestCandidates(currentPrices: Map<string, number>): Promise<HarvestCandidate[]> {
    const enabled = configManager.get<boolean>('tax.enabled');
    if (!enabled) {
      return [];
    }

    const threshold = configManager.get<number>('tax.harvestThreshold');
    const shortTermRate = configManager.get<number>('tax.shortTermRate');
    const longTermRate = configManager.get<number>('tax.longTermRate');

    const openLots = await getOpenLots();
    const candidates: HarvestCandidate[] = [];

    for (const lot of openLots) {
      const currentPrice = currentPrices.get(lot.symbol);
      if (!currentPrice) continue;

      const unrealizedLoss = lot.shares * (currentPrice - lot.costBasis);

      if (unrealizedLoss < threshold) {
        const holdingPeriod = this.determineHoldingPeriod(
          lot.purchaseDate,
          new Date().toISOString(),
        );
        const taxRate = holdingPeriod === 'short' ? shortTermRate : longTermRate;
        const taxSavings = Math.abs(unrealizedLoss) * taxRate;

        candidates.push({
          symbol: lot.symbol,
          shares: lot.shares,
          costBasis: lot.costBasis,
          currentPrice,
          unrealizedLoss,
          holdingPeriod,
          taxSavings,
        });
      }
    }

    return candidates.sort((a, b) => a.unrealizedLoss - b.unrealizedLoss);
  }

  async getYearlyTaxSummary(year?: number): Promise<YearlyTaxSummary> {
    const enabled = configManager.get<boolean>('tax.enabled');
    if (!enabled) {
      return {
        shortTermGains: 0,
        longTermGains: 0,
        shortTermLosses: 0,
        longTermLosses: 0,
        netTaxLiability: 0,
        harvestOpportunities: 0,
      };
    }

    const targetYear = year || new Date().getFullYear();
    const summary = await getYearSummary(targetYear);

    const shortTermRate = configManager.get<number>('tax.shortTermRate');
    const longTermRate = configManager.get<number>('tax.longTermRate');

    const shortTermNet = summary.shortTermGains - summary.shortTermLosses;
    const longTermNet = summary.longTermGains - summary.longTermLosses;

    const shortTermTax = Math.max(0, shortTermNet * shortTermRate);
    const longTermTax = Math.max(0, longTermNet * longTermRate);

    const netTaxLiability = shortTermTax + longTermTax;

    // Count current harvest opportunities
    const harvestCandidates = await this.getHarvestCandidates(new Map());
    const harvestOpportunities = harvestCandidates.length;

    return {
      shortTermGains: summary.shortTermGains,
      longTermGains: summary.longTermGains,
      shortTermLosses: summary.shortTermLosses,
      longTermLosses: summary.longTermLosses,
      netTaxLiability,
      harvestOpportunities,
    };
  }

  async getWashSaleWarnings(symbol: string): Promise<WashSaleWarning[]> {
    const enabled = configManager.get<boolean>('tax.enabled');
    if (!enabled) {
      return [];
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();

    const recentSales = await getClosedLots(thirtyDaysAgoIso);
    const symbolSales = recentSales.filter((lot) => lot.symbol === symbol && (lot.pnl ?? 0) < 0);

    const warnings: WashSaleWarning[] = [];
    const now = new Date();

    for (const sale of symbolSales) {
      if (!sale.saleDate) continue;

      const saleDate = new Date(sale.saleDate);
      const safeDate = new Date(saleDate);
      safeDate.setDate(safeDate.getDate() + 30);

      const daysUntilSafe = Math.ceil((safeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysUntilSafe > 0) {
        warnings.push({
          symbol,
          saleDate: sale.saleDate,
          daysUntilSafe,
          message: `Wash sale risk: ${symbol} sold at loss on ${sale.saleDate}. Wait ${daysUntilSafe} more days before repurchasing to avoid wash sale rule.`,
        });
      }
    }

    return warnings;
  }

  async estimateTaxImpact(
    symbol: string,
    shares: number,
    salePrice: number,
  ): Promise<TaxImpactEstimate> {
    const enabled = configManager.get<boolean>('tax.enabled');
    if (!enabled) {
      return {
        totalPnL: 0,
        shortTermPnL: 0,
        longTermPnL: 0,
        estimatedTax: 0,
        effectiveTaxRate: 0,
      };
    }

    const openLots = await getOpenLots(symbol);
    const shortTermRate = configManager.get<number>('tax.shortTermRate');
    const longTermRate = configManager.get<number>('tax.longTermRate');

    let remainingShares = shares;
    let shortTermPnL = 0;
    let longTermPnL = 0;
    const now = new Date().toISOString();

    for (const lot of openLots) {
      if (remainingShares <= 0) break;

      const sharesToSell = Math.min(remainingShares, lot.shares);
      const pnl = sharesToSell * (salePrice - lot.costBasis);
      const holdingPeriod = this.determineHoldingPeriod(lot.purchaseDate, now);

      if (holdingPeriod === 'short') {
        shortTermPnL += pnl;
      } else {
        longTermPnL += pnl;
      }

      remainingShares -= sharesToSell;
    }

    const totalPnL = shortTermPnL + longTermPnL;

    const shortTermTax = Math.max(0, shortTermPnL * shortTermRate);
    const longTermTax = Math.max(0, longTermPnL * longTermRate);
    const estimatedTax = shortTermTax + longTermTax;

    const effectiveTaxRate = totalPnL > 0 ? estimatedTax / totalPnL : 0;

    return {
      totalPnL,
      shortTermPnL,
      longTermPnL,
      estimatedTax,
      effectiveTaxRate,
    };
  }

  private determineHoldingPeriod(purchaseDate: string, saleDate: string): 'short' | 'long' {
    const purchase = new Date(purchaseDate);
    const sale = new Date(saleDate);

    const oneYearLater = new Date(purchase);
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

    return sale >= oneYearLater ? 'long' : 'short';
  }
}

let instance: TaxTracker | null = null;

export function getTaxTracker(): TaxTracker {
  if (!instance) {
    instance = new TaxTracker();
  }
  return instance;
}
