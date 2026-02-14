import { eq } from 'drizzle-orm';
import type { Trading212Client } from '../api/trading212/client.js';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import { positions, trades } from '../db/schema.js';
import { createLogger } from '../utils/logger.js';
import { parseRoiTable, shouldExitByRoi } from './roi-table.js';

const log = createLogger('position-tracker');

export interface ExitCheckResult {
  positionsToClose: string[];
  exitReasons: Record<string, string>;
}

export class PositionTracker {
  async updatePositions(): Promise<void> {
    const db = getDb();
    const allPositions = db.select().from(positions).all();

    if (allPositions.length === 0) return;

    const { YahooFinanceClient } = await import('../data/yahoo-finance.js');
    const yahoo = new YahooFinanceClient();
    const now = new Date().toISOString();

    let updated = 0;
    for (const pos of allPositions) {
      try {
        const quote = await yahoo.getQuote(pos.symbol);
        if (!quote) continue;

        const pnl = (quote.price - pos.entryPrice) * pos.shares;
        const pnlPct = (quote.price - pos.entryPrice) / pos.entryPrice;

        db.update(positions)
          .set({
            currentPrice: quote.price,
            pnl,
            pnlPct,
            updatedAt: now,
          })
          .where(eq(positions.symbol, pos.symbol))
          .run();

        updated++;
      } catch (err) {
        log.error({ symbol: pos.symbol, err }, 'Failed to update position price');
      }
    }

    log.info({ totalPositions: allPositions.length, updated }, 'Positions updated');
  }

  async syncWithT212(t212Client: Trading212Client): Promise<void> {
    const db = getDb();
    const dbPositions = db.select().from(positions).all();
    const dbSymbolMap = new Map(dbPositions.map((p) => [p.t212Ticker, p]));

    try {
      const t212Positions = await t212Client.getPortfolio();
      const getTicker = (p: (typeof t212Positions)[number]) =>
        p.ticker ?? p.instrument?.ticker ?? '';
      const t212TickerSet = new Set(t212Positions.map(getTicker));

      // Check for positions in DB but not in T212 — auto-reconcile
      for (const [ticker, dbPos] of dbSymbolMap) {
        if (!t212TickerSet.has(ticker)) {
          log.warn(
            { symbol: dbPos.symbol, t212Ticker: ticker },
            'Position in DB but not in T212 — auto-reconciling (external close)',
          );
          const exitPrice = dbPos.currentPrice ?? dbPos.entryPrice;
          const pnl = (exitPrice - dbPos.entryPrice) * dbPos.shares;
          const pnlPct = (exitPrice - dbPos.entryPrice) / dbPos.entryPrice;
          const now = new Date().toISOString();

          db.insert(trades)
            .values({
              symbol: dbPos.symbol,
              t212Ticker: dbPos.t212Ticker,
              side: 'SELL',
              shares: dbPos.shares,
              entryPrice: dbPos.entryPrice,
              exitPrice,
              pnl,
              pnlPct,
              entryTime: dbPos.entryTime,
              exitTime: now,
              exitReason: 'External close (T212 sync)',
              accountType: dbPos.accountType ?? 'INVEST',
            })
            .run();

          db.delete(positions).where(eq(positions.symbol, dbPos.symbol)).run();
          log.info({ symbol: dbPos.symbol, pnl, pnlPct }, 'Position auto-reconciled');
        }
      }

      // Check for positions in T212 but not in DB
      for (const t212Pos of t212Positions) {
        const ticker = getTicker(t212Pos);
        if (!dbSymbolMap.has(ticker)) {
          log.warn(
            { t212Ticker: ticker, quantity: t212Pos.quantity },
            'Position in T212 but not tracked in DB — unmanaged position',
          );
        } else {
          // Reconcile quantity differences
          const dbPos = dbSymbolMap.get(ticker);
          if (!dbPos) continue;
          if (Math.abs(dbPos.shares - t212Pos.quantity) > 0.001) {
            log.warn(
              {
                symbol: dbPos.symbol,
                dbShares: dbPos.shares,
                t212Shares: t212Pos.quantity,
              },
              'Position quantity mismatch between DB and T212',
            );
          }
        }
      }

      log.info(
        { dbCount: dbPositions.length, t212Count: t212Positions.length },
        'T212 sync complete',
      );
    } catch (err) {
      log.error({ err }, 'Failed to sync with T212');
    }
  }

  async updateTrailingStops(): Promise<void> {
    const db = getDb();
    const allPositions = db.select().from(positions).all();

    for (const pos of allPositions) {
      if (pos.currentPrice == null || pos.stopLoss == null) continue;

      const pnlPct = (pos.currentPrice - pos.entryPrice) / pos.entryPrice;

      // Only trail for profitable positions
      if (pnlPct <= 0) continue;

      // Trail by the original stop distance as a percentage
      const originalStopPct = (pos.entryPrice - pos.stopLoss) / pos.entryPrice;
      const newTrailingStop = pos.currentPrice * (1 - originalStopPct);

      // Only move stop up, never down
      const currentStop = pos.trailingStop ?? pos.stopLoss;
      if (newTrailingStop > currentStop) {
        db.update(positions)
          .set({
            trailingStop: newTrailingStop,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(positions.symbol, pos.symbol))
          .run();

        log.info(
          {
            symbol: pos.symbol,
            oldStop: currentStop,
            newStop: newTrailingStop,
            currentPrice: pos.currentPrice,
            pnlPct: `${(pnlPct * 100).toFixed(2)}%`,
          },
          'Trailing stop updated',
        );
      }
    }
  }

  async checkExitConditions(): Promise<ExitCheckResult> {
    const db = getDb();
    const allPositions = db.select().from(positions).all();
    const positionsToClose: string[] = [];
    const exitReasons: Record<string, string> = {};

    for (const pos of allPositions) {
      if (pos.currentPrice == null) continue;

      const effectiveStop = pos.trailingStop ?? pos.stopLoss;

      // Check stop-loss / trailing stop (highest priority)
      if (effectiveStop != null && pos.currentPrice <= effectiveStop) {
        log.warn(
          {
            symbol: pos.symbol,
            currentPrice: pos.currentPrice,
            stopLevel: effectiveStop,
          },
          'Stop-loss triggered',
        );
        positionsToClose.push(pos.symbol);
        exitReasons[pos.symbol] = 'Stop-loss triggered';
        continue;
      }

      // Check take-profit
      if (pos.takeProfit != null && pos.currentPrice >= pos.takeProfit) {
        log.info(
          {
            symbol: pos.symbol,
            currentPrice: pos.currentPrice,
            takeProfit: pos.takeProfit,
          },
          'Take-profit triggered',
        );
        positionsToClose.push(pos.symbol);
        exitReasons[pos.symbol] = 'Take-profit triggered';
        continue;
      }

      // Check ROI table exit (after stop-loss/take-profit, before AI conditions)
      const roiEnabled = configManager.get<boolean>('exit.roiEnabled');
      if (roiEnabled) {
        const roiTableJson = configManager.get<string>('exit.roiTable');
        const roiTable = parseRoiTable(
          typeof roiTableJson === 'string' ? roiTableJson : JSON.stringify(roiTableJson),
        );
        const pnlPct = (pos.currentPrice - pos.entryPrice) / pos.entryPrice;
        const roiResult = shouldExitByRoi(roiTable, pos.entryTime, pnlPct);

        if (roiResult.shouldExit) {
          log.info(
            {
              symbol: pos.symbol,
              pnlPct: `${(pnlPct * 100).toFixed(2)}%`,
              threshold: `${((roiResult.threshold ?? 0) * 100).toFixed(2)}%`,
              tradeMinutes: Math.round(roiResult.tradeMinutes),
            },
            'ROI exit triggered',
          );
          positionsToClose.push(pos.symbol);
          exitReasons[pos.symbol] = 'roi_table';
          continue;
        }
      }

      // Check AI-defined exit conditions (stored as JSON)
      if (pos.aiExitConditions) {
        try {
          const conditions = JSON.parse(pos.aiExitConditions) as {
            maxHoldDays?: number;
            priceTarget?: number;
            stopOnReversal?: boolean;
          };

          // Max hold duration check
          if (conditions.maxHoldDays) {
            const entryDate = new Date(pos.entryTime).getTime();
            const holdDays = (Date.now() - entryDate) / (1000 * 60 * 60 * 24);
            if (holdDays >= conditions.maxHoldDays) {
              log.info(
                {
                  symbol: pos.symbol,
                  holdDays: holdDays.toFixed(1),
                  maxHoldDays: conditions.maxHoldDays,
                },
                'Max hold duration reached',
              );
              positionsToClose.push(pos.symbol);
              exitReasons[pos.symbol] = 'Max hold duration reached';
              continue;
            }
          }

          // AI-specified price target (distinct from take-profit)
          if (conditions.priceTarget && pos.currentPrice >= conditions.priceTarget) {
            log.info(
              {
                symbol: pos.symbol,
                currentPrice: pos.currentPrice,
                priceTarget: conditions.priceTarget,
              },
              'AI price target reached',
            );
            positionsToClose.push(pos.symbol);
            exitReasons[pos.symbol] = 'AI price target reached';
          }
        } catch {
          log.warn({ symbol: pos.symbol }, 'Failed to parse AI exit conditions');
        }
      }
    }

    if (positionsToClose.length > 0) {
      log.info({ positionsToClose }, 'Exit conditions triggered');
    }

    return { positionsToClose, exitReasons };
  }
}
