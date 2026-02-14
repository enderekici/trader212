import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '../index.js';
import { taxLots } from '../schema.js';

export interface TaxLotInsert {
  symbol: string;
  shares: number;
  costBasis: number;
  purchaseDate: string;
  accountType: 'INVEST' | 'ISA';
}

export interface TaxLotClose {
  saleDate: string;
  salePrice: number;
  pnl: number;
  holdingPeriod: 'short' | 'long';
}

export interface TaxLot {
  id: number;
  symbol: string;
  shares: number;
  costBasis: number;
  purchaseDate: string;
  saleDate: string | null;
  salePrice: number | null;
  pnl: number | null;
  holdingPeriod: 'short' | 'long' | null;
  accountType: 'INVEST' | 'ISA';
  createdAt: string;
}

export interface YearSummary {
  year: number;
  shortTermGains: number;
  longTermGains: number;
  shortTermLosses: number;
  longTermLosses: number;
}

export async function createTaxLot(data: TaxLotInsert): Promise<TaxLot> {
  const db = getDb();
  const now = new Date().toISOString();

  const result = db
    .insert(taxLots)
    .values({
      ...data,
      createdAt: now,
    })
    .returning()
    .get();

  return result as TaxLot;
}

export async function getOpenLots(symbol?: string): Promise<TaxLot[]> {
  const db = getDb();

  if (symbol) {
    return db
      .select()
      .from(taxLots)
      .where(and(eq(taxLots.symbol, symbol), isNull(taxLots.saleDate)))
      .orderBy(taxLots.purchaseDate)
      .all() as TaxLot[];
  }

  return db
    .select()
    .from(taxLots)
    .where(isNull(taxLots.saleDate))
    .orderBy(taxLots.purchaseDate)
    .all() as TaxLot[];
}

export async function closeLot(id: number, closeData: TaxLotClose): Promise<void> {
  const db = getDb();

  db.update(taxLots)
    .set({
      saleDate: closeData.saleDate,
      salePrice: closeData.salePrice,
      pnl: closeData.pnl,
      holdingPeriod: closeData.holdingPeriod,
    })
    .where(eq(taxLots.id, id))
    .run();
}

export async function getClosedLots(from?: string, to?: string): Promise<TaxLot[]> {
  const db = getDb();

  const conditions = [sql`${taxLots.saleDate} IS NOT NULL`];

  if (from) {
    conditions.push(sql`${taxLots.saleDate} >= ${from}`);
  }

  if (to) {
    conditions.push(sql`${taxLots.saleDate} <= ${to}`);
  }

  return db
    .select()
    .from(taxLots)
    .where(and(...conditions))
    .orderBy(taxLots.saleDate)
    .all() as TaxLot[];
}

export async function getLotsBySymbol(symbol: string): Promise<TaxLot[]> {
  const db = getDb();

  return db
    .select()
    .from(taxLots)
    .where(eq(taxLots.symbol, symbol))
    .orderBy(taxLots.purchaseDate)
    .all() as TaxLot[];
}

export async function getYearSummary(year: number): Promise<YearSummary> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const lots = await getClosedLots(startDate, endDate);

  const summary: YearSummary = {
    year,
    shortTermGains: 0,
    longTermGains: 0,
    shortTermLosses: 0,
    longTermLosses: 0,
  };

  for (const lot of lots) {
    if (lot.pnl === null || lot.holdingPeriod === null) continue;

    if (lot.holdingPeriod === 'short') {
      if (lot.pnl > 0) {
        summary.shortTermGains += lot.pnl;
      } else {
        summary.shortTermLosses += Math.abs(lot.pnl);
      }
    } else {
      if (lot.pnl > 0) {
        summary.longTermGains += lot.pnl;
      } else {
        summary.longTermLosses += Math.abs(lot.pnl);
      }
    }
  }

  return summary;
}
