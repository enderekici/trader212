import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { modelPerformance } from '../db/schema.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('model-tracker');

export interface ModelStats {
  model: string;
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  convictionWeightedAccuracy: number;
  avgConviction: number;
  buyAccuracy: number;
  sellAccuracy: number;
  holdAccuracy: number;
  avgReturnOnBuy: number;
  avgReturnOnSell: number;
}

export class ModelTracker {
  /** Record a new prediction for future evaluation */
  recordPrediction(params: {
    aiModel: string;
    symbol: string;
    decision: 'BUY' | 'SELL' | 'HOLD';
    conviction: number;
    priceAtSignal: number;
  }): void {
    const db = getDb();
    db.insert(modelPerformance)
      .values({
        aiModel: params.aiModel,
        symbol: params.symbol,
        decision: params.decision,
        conviction: params.conviction,
        signalTimestamp: new Date().toISOString(),
        priceAtSignal: params.priceAtSignal,
        actualOutcome: 'pending',
      })
      .run();
  }

  /** Evaluate pending predictions against actual price movements */
  async evaluatePendingPredictions(): Promise<number> {
    const db = getDb();
    const pending = db
      .select()
      .from(modelPerformance)
      .where(eq(modelPerformance.actualOutcome, 'pending'))
      .all();

    if (pending.length === 0) return 0;

    let evaluated = 0;
    const { YahooFinanceClient } = await import('../data/yahoo-finance.js');
    const yahoo = new YahooFinanceClient();

    for (const pred of pending) {
      const signalTime = new Date(pred.signalTimestamp).getTime();
      const daysSince = (Date.now() - signalTime) / (1000 * 60 * 60 * 24);

      // Only evaluate after enough time has passed
      if (daysSince < 1) continue;

      try {
        const quote = await yahoo.getQuote(pred.symbol);
        if (!quote) continue;

        const currentPrice = quote.price;
        const returnPct = (currentPrice - pred.priceAtSignal) / pred.priceAtSignal;

        // Determine if prediction was correct (require meaningful moves)
        let outcome: 'correct' | 'incorrect' = 'incorrect';
        if (pred.decision === 'BUY' && returnPct > 0.01) outcome = 'correct';
        else if (pred.decision === 'SELL' && returnPct < -0.01) outcome = 'correct';
        else if (pred.decision === 'HOLD' && Math.abs(returnPct) < 0.01) outcome = 'correct';

        const updates: Record<string, string | number | null> = {
          actualOutcome: outcome,
          actualReturnPct: returnPct,
          evaluatedAt: new Date().toISOString(),
        };

        if (daysSince >= 1 && pred.priceAfter1d == null) updates.priceAfter1d = currentPrice;
        if (daysSince >= 5 && pred.priceAfter5d == null) updates.priceAfter5d = currentPrice;
        if (daysSince >= 10 && pred.priceAfter10d == null) updates.priceAfter10d = currentPrice;

        db.update(modelPerformance).set(updates).where(eq(modelPerformance.id, pred.id)).run();

        evaluated++;
      } catch (err) {
        log.error({ symbol: pred.symbol, err }, 'Failed to evaluate prediction');
      }
    }

    log.info({ evaluated, total: pending.length }, 'Evaluated pending predictions');
    return evaluated;
  }

  /** Get performance stats for all AI models */
  getModelStats(): ModelStats[] {
    const db = getDb();
    const all = db.select().from(modelPerformance).all();

    const byModel = new Map<string, typeof all>();
    for (const row of all) {
      const existing = byModel.get(row.aiModel) ?? [];
      existing.push(row);
      byModel.set(row.aiModel, existing);
    }

    const stats: ModelStats[] = [];
    for (const [model, rows] of byModel) {
      const evaluated = rows.filter((r) => r.actualOutcome && r.actualOutcome !== 'pending');
      const correct = evaluated.filter((r) => r.actualOutcome === 'correct');
      const buys = evaluated.filter((r) => r.decision === 'BUY');
      const sells = evaluated.filter((r) => r.decision === 'SELL');
      const holds = evaluated.filter((r) => r.decision === 'HOLD');

      const weightedCorrect = correct.reduce((sum, r) => sum + r.conviction, 0);
      const totalConviction = evaluated.reduce((sum, r) => sum + r.conviction, 0);

      stats.push({
        model,
        totalPredictions: rows.length,
        correctPredictions: correct.length,
        accuracy: evaluated.length > 0 ? correct.length / evaluated.length : 0,
        convictionWeightedAccuracy: totalConviction > 0 ? weightedCorrect / totalConviction : 0,
        avgConviction: rows.reduce((s, r) => s + r.conviction, 0) / rows.length,
        buyAccuracy:
          buys.length > 0
            ? buys.filter((b) => b.actualOutcome === 'correct').length / buys.length
            : 0,
        sellAccuracy:
          sells.length > 0
            ? sells.filter((s) => s.actualOutcome === 'correct').length / sells.length
            : 0,
        holdAccuracy:
          holds.length > 0
            ? holds.filter((h) => h.actualOutcome === 'correct').length / holds.length
            : 0,
        avgReturnOnBuy:
          buys.length > 0
            ? buys.reduce((s, b) => s + (b.actualReturnPct ?? 0), 0) / buys.length
            : 0,
        avgReturnOnSell:
          sells.length > 0
            ? sells.reduce((s, s2) => s + (s2.actualReturnPct ?? 0), 0) / sells.length
            : 0,
      });
    }

    return stats.sort((a, b) => b.accuracy - a.accuracy);
  }
}
