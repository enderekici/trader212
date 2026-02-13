import type { FundamentalData } from '../../data/yahoo-finance.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('fundamental-scorer');

export interface FundamentalAnalysis {
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
  earningsSurprise: number | null;
  score: number;
}

export function scoreFundamentals(data: FundamentalData): number {
  const analysis = analyzeFundamentals(data);
  return analysis.score;
}

export function analyzeFundamentals(data: FundamentalData): FundamentalAnalysis {
  let totalWeight = 0;
  let weightedSum = 0;

  const add = (signal: number, weight: number) => {
    totalWeight += weight;
    weightedSum += signal * weight;
  };

  // P/E Ratio (weight 15)
  if (data.peRatio != null && data.peRatio > 0) {
    let peSignal: number;
    if (data.peRatio < 10) peSignal = 85;
    else if (data.peRatio < 15) peSignal = 75;
    else if (data.peRatio < 20) peSignal = 65;
    else if (data.peRatio < 25) peSignal = 55;
    else if (data.peRatio < 35) peSignal = 40;
    else if (data.peRatio < 50) peSignal = 25;
    else peSignal = 15;
    add(peSignal, 15);
  }

  // Forward P/E (weight 10) — same logic but slightly more weight to growth expectation
  if (data.forwardPE != null && data.forwardPE > 0) {
    let fpeSignal: number;
    if (data.forwardPE < 10) fpeSignal = 85;
    else if (data.forwardPE < 15) fpeSignal = 75;
    else if (data.forwardPE < 20) fpeSignal = 65;
    else if (data.forwardPE < 30) fpeSignal = 45;
    else fpeSignal = 20;

    // Improving forward vs trailing is bullish
    if (data.peRatio != null && data.peRatio > 0 && data.forwardPE < data.peRatio) {
      fpeSignal = Math.min(fpeSignal + 10, 100);
    }
    add(fpeSignal, 10);
  }

  // Revenue Growth YoY (weight 20)
  if (data.revenueGrowthYoY != null) {
    let growthSignal: number;
    if (data.revenueGrowthYoY > 0.3) growthSignal = 90;
    else if (data.revenueGrowthYoY > 0.2) growthSignal = 80;
    else if (data.revenueGrowthYoY > 0.1) growthSignal = 70;
    else if (data.revenueGrowthYoY > 0.05) growthSignal = 60;
    else if (data.revenueGrowthYoY > 0) growthSignal = 50;
    else if (data.revenueGrowthYoY > -0.1) growthSignal = 35;
    else growthSignal = 15;
    add(growthSignal, 20);
  }

  // Profit Margin (weight 10)
  if (data.profitMargin != null) {
    let marginSignal: number;
    if (data.profitMargin > 0.25) marginSignal = 85;
    else if (data.profitMargin > 0.15) marginSignal = 70;
    else if (data.profitMargin > 0.08) marginSignal = 55;
    else if (data.profitMargin > 0) marginSignal = 40;
    else marginSignal = 15;
    add(marginSignal, 10);
  }

  // Operating Margin (weight 10)
  if (data.operatingMargin != null) {
    let opMarginSignal: number;
    if (data.operatingMargin > 0.3) opMarginSignal = 85;
    else if (data.operatingMargin > 0.2) opMarginSignal = 70;
    else if (data.operatingMargin > 0.1) opMarginSignal = 55;
    else if (data.operatingMargin > 0) opMarginSignal = 40;
    else opMarginSignal = 15;
    add(opMarginSignal, 10);
  }

  // Debt to Equity (weight 15)
  if (data.debtToEquity != null) {
    let debtSignal: number;
    if (data.debtToEquity < 0.3) debtSignal = 85;
    else if (data.debtToEquity < 0.5) debtSignal = 75;
    else if (data.debtToEquity < 1.0) debtSignal = 60;
    else if (data.debtToEquity < 1.5) debtSignal = 45;
    else if (data.debtToEquity < 2.0) debtSignal = 30;
    else debtSignal = 15;
    add(debtSignal, 15);
  }

  // Current Ratio (weight 10)
  if (data.currentRatio != null) {
    let crSignal: number;
    if (data.currentRatio > 3) crSignal = 70;
    else if (data.currentRatio > 2) crSignal = 80;
    else if (data.currentRatio > 1.5) crSignal = 70;
    else if (data.currentRatio > 1) crSignal = 55;
    else crSignal = 20;
    add(crSignal, 10);
  }

  // Earnings Surprise (weight 10)
  if (data.earningsSurprise != null) {
    let esSignal: number;
    if (data.earningsSurprise > 0.1) esSignal = 85;
    else if (data.earningsSurprise > 0.05) esSignal = 70;
    else if (data.earningsSurprise > 0) esSignal = 60;
    else if (data.earningsSurprise > -0.05) esSignal = 40;
    else esSignal = 20;
    add(esSignal, 10);
  }

  const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;

  log.debug(
    { score, pe: data.peRatio, growth: data.revenueGrowthYoY },
    'Fundamental analysis complete',
  );

  return {
    peRatio: data.peRatio,
    forwardPE: data.forwardPE,
    revenueGrowthYoY: data.revenueGrowthYoY,
    profitMargin: data.profitMargin,
    operatingMargin: data.operatingMargin,
    debtToEquity: data.debtToEquity,
    currentRatio: data.currentRatio,
    marketCap: data.marketCap,
    sector: data.sector,
    beta: data.beta,
    dividendYield: data.dividendYield,
    earningsSurprise: data.earningsSurprise,
    score,
  };
}
