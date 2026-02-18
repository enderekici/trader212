import { describe, expect, it } from 'vitest';
import { generateSummary, generateSymbolBreakdown, formatEquityCurve } from '../../src/backtest/reporter.js';
import type { BacktestResult } from '../../src/backtest/types.js';

function makeResult(overrides: Partial<BacktestResult['metrics']> = {}, trades: BacktestResult['trades'] = []): BacktestResult {
  return {
    config: {
      symbols: ['AAPL', 'MSFT'],
      startDate: '2024-01-01',
      endDate: '2024-03-31',
      initialCapital: 10000,
      maxPositions: 5,
      maxPositionSizePct: 10,
      stopLossPct: 2,
      trailingStop: false,
      commission: 0,
      entryThreshold: 60,
    },
    trades,
    metrics: {
      totalTrades: trades.length,
      winCount: 0,
      lossCount: 0,
      winRate: 0,
      totalPnl: 0,
      totalPnlPct: 0,
      avgWin: null,
      avgLoss: null,
      maxDrawdown: 0,
      maxDrawdownPct: 5,
      currentDrawdown: 0,
      sharpeRatio: null,
      sortinoRatio: null,
      calmarRatio: null,
      sqn: null,
      expectancy: null,
      profitFactor: null,
      avgHoldMinutes: 0,
      bestTrade: null,
      worstTrade: null,
      finalEquity: 10200,
      returnPct: 2,
      ...overrides,
    },
    equityCurve: [
      { date: '2024-01-01', equity: 10000 },
      { date: '2024-03-31', equity: 10200 },
    ],
    dailyReturns: [0.01, -0.005, 0.02],
  };
}

function makeTrade(symbol: string, pnl: number, pnlPct: number): BacktestResult['trades'][0] {
  return {
    symbol,
    side: 'BUY',
    entryPrice: 100,
    exitPrice: pnl > 0 ? 110 : 90,
    shares: 10,
    entryTime: '2024-01-10T10:00:00.000Z',
    exitTime: '2024-01-15T10:00:00.000Z',
    pnl,
    pnlPct,
    exitReason: 'take_profit',
    holdMinutes: 7200,
    technicalScore: 75,
  };
}

describe('backtest/reporter', () => {
  describe('generateSummary()', () => {
    it('generates a summary with null metrics showing N/A', () => {
      const result = makeResult();
      const summary = generateSummary(result);

      expect(summary).toContain('=== Backtest Results ===');
      expect(summary).toContain('AAPL, MSFT');
      expect(summary).toContain('$10,000.00');
      expect(summary).toContain('N/A'); // sharpe etc null
    });

    it('generates a summary with numeric metrics', () => {
      const result = makeResult({
        sharpeRatio: 1.5,
        sortinoRatio: 2.0,
        calmarRatio: 0.8,
        sqn: 2.5,
        profitFactor: 1.8,
        avgWin: 250,
        avgLoss: -100,
        expectancy: 50,
        avgHoldMinutes: 90,
        bestTrade: { symbol: 'AAPL', pnlPct: 12.5 },
        worstTrade: { symbol: 'MSFT', pnlPct: -5.0 },
      });
      const summary = generateSummary(result);

      expect(summary).toContain('1.5');
      expect(summary).toContain('Best Trade: AAPL');
      expect(summary).toContain('Worst Trade: MSFT');
      expect(summary).toContain('$250.00'); // avgWin
    });

    it('shows hold time in minutes when < 60', () => {
      const result = makeResult({ avgHoldMinutes: 45 });
      const summary = generateSummary(result);
      expect(summary).toContain('45m');
    });

    it('shows hold time in hours when >= 60 and < 1440', () => {
      const result = makeResult({ avgHoldMinutes: 90 });
      const summary = generateSummary(result);
      expect(summary).toContain('1h 30m');
    });

    it('shows hold time in days when >= 1440', () => {
      const result = makeResult({ avgHoldMinutes: 2880 });
      const summary = generateSummary(result);
      expect(summary).toContain('2d');
    });

    it('shows bestTrade only when present', () => {
      const withBest = makeResult({ bestTrade: { symbol: 'NVDA', pnlPct: 20 } });
      const withoutBest = makeResult({ bestTrade: null });

      expect(generateSummary(withBest)).toContain('Best Trade: NVDA');
      expect(generateSummary(withoutBest)).not.toContain('Best Trade');
    });

    it('shows worstTrade only when present', () => {
      const withWorst = makeResult({ worstTrade: { symbol: 'TSLA', pnlPct: -10 } });
      const withoutWorst = makeResult({ worstTrade: null });

      expect(generateSummary(withWorst)).toContain('Worst Trade: TSLA');
      expect(generateSummary(withoutWorst)).not.toContain('Worst Trade');
    });
  });

  describe('generateSymbolBreakdown()', () => {
    it('returns message when there are no trades', () => {
      const result = makeResult({}, []);
      expect(generateSymbolBreakdown(result)).toBe('No trades to analyze.');
    });

    it('groups trades by symbol and shows win rate', () => {
      const trades = [
        makeTrade('AAPL', 100, 10),
        makeTrade('AAPL', -50, -5),
        makeTrade('MSFT', 200, 15),
      ];
      const result = makeResult({}, trades);
      const breakdown = generateSymbolBreakdown(result);

      expect(breakdown).toContain('=== Per-Symbol Breakdown ===');
      expect(breakdown).toContain('AAPL');
      expect(breakdown).toContain('MSFT');
      expect(breakdown).toContain('2 trades');
      expect(breakdown).toContain('1 trades');
    });

    it('sorts symbols by total P&L descending', () => {
      const trades = [
        makeTrade('AAPL', 50, 5),
        makeTrade('MSFT', 500, 20),
      ];
      const result = makeResult({}, trades);
      const breakdown = generateSymbolBreakdown(result);

      const msftPos = breakdown.indexOf('MSFT');
      const aaplPos = breakdown.indexOf('AAPL');
      expect(msftPos).toBeLessThan(aaplPos);
    });
  });

  describe('formatEquityCurve()', () => {
    it('formats equity curve into dates and values arrays', () => {
      const result = makeResult();
      const formatted = formatEquityCurve(result);

      expect(formatted.dates).toEqual(['2024-01-01', '2024-03-31']);
      expect(formatted.values).toEqual([10000, 10200]);
      expect(formatted.initialCapital).toBe(10000);
    });

    it('rounds equity values to 2 decimal places', () => {
      const result = {
        ...makeResult(),
        equityCurve: [{ date: '2024-01-01', equity: 10000.1234567 }],
      };
      const formatted = formatEquityCurve(result);
      expect(formatted.values[0]).toBe(10000.12);
    });
  });
});
