import { calcSMA } from '../analysis/technical/indicators.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('market-breadth');

export interface MarketBreadthData {
  above50dPct: number;
  above200dPct: number;
  signal: 'oversold' | 'neutral' | 'overbought';
}

export function computeMarketBreadth(
  symbolCandles: Map<string, { close: number }[]>,
): MarketBreadthData {
  let symbolsWithData = 0;
  let above50 = 0;
  let above200 = 0;

  for (const [_symbol, candles] of symbolCandles) {
    if (candles.length < 50) continue;

    const closes = candles.map((c) => c.close);
    const currentPrice = closes[closes.length - 1];

    const sma50 = calcSMA(closes, 50);
    if (sma50 !== null) {
      symbolsWithData++;
      if (currentPrice > sma50) above50++;
    }

    const sma200 = calcSMA(closes, 200);
    if (sma200 !== null) {
      if (currentPrice > sma200) above200++;
    }
  }

  if (symbolsWithData === 0) {
    logger.debug('No symbols with sufficient data for market breadth');
    return { above50dPct: 50, above200dPct: 50, signal: 'neutral' };
  }

  const above50dPct = (above50 / symbolsWithData) * 100;
  const above200dPct = (above200 / symbolsWithData) * 100;

  let signal: MarketBreadthData['signal'] = 'neutral';
  if (above50dPct < 20) signal = 'oversold';
  else if (above50dPct > 80) signal = 'overbought';

  logger.debug({ above50dPct, above200dPct, signal, symbolsWithData }, 'Market breadth computed');

  return { above50dPct, above200dPct, signal };
}
