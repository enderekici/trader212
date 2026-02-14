import { and, desc, gte, sql } from 'drizzle-orm';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import { modelPerformance } from '../db/schema.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('self-improvement');

export interface PerformanceFeedback {
  overallAccuracy: number;
  buyAccuracy: number;
  sellAccuracy: number;
  holdAccuracy: number;
  avgConvictionCorrect: number;
  avgConvictionIncorrect: number;
  bestPerformingSetups: string[];
  worstPerformingSetups: string[];
  biases: string[];
  suggestions: string[];
  sampleSize: number;
  periodDays: number;
}

export interface ModelComparison {
  models: Array<{
    model: string;
    accuracy: number;
    avgReturn: number;
    sampleSize: number;
    bestDecision: string;
  }>;
  recommendation: string;
}

export interface CalibrationBucket {
  convictionRange: string;
  predictions: number;
  accuracy: number;
  avgConviction: number;
}

interface PredictionRecord {
  id: number;
  aiModel: string;
  symbol: string;
  decision: 'BUY' | 'SELL' | 'HOLD';
  conviction: number;
  signalTimestamp: string;
  priceAtSignal: number;
  priceAfter1d: number | null;
  priceAfter5d: number | null;
  priceAfter10d: number | null;
  actualOutcome: 'correct' | 'incorrect' | 'pending';
  actualReturnPct: number | null;
  evaluatedAt: string | null;
}

export class AISelfImprovement {
  private static instance: AISelfImprovement | null = null;

  private constructor() {}

  static getInstance(): AISelfImprovement {
    if (!AISelfImprovement.instance) {
      AISelfImprovement.instance = new AISelfImprovement();
    }
    return AISelfImprovement.instance;
  }

  /**
   * Generate performance feedback for a specific AI model or all models
   */
  async generateFeedback(aiModel?: string): Promise<PerformanceFeedback | null> {
    const enabled = configManager.get<boolean>('aiSelfImprovement.enabled');
    if (!enabled) {
      logger.debug('AI self-improvement is disabled');
      return null;
    }

    const feedbackWindow = configManager.get<number>('aiSelfImprovement.feedbackWindow');
    const minSamples = configManager.get<number>('aiSelfImprovement.minSamples');

    const db = getDb();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - feedbackWindow);

    // Fetch evaluated predictions within the feedback window
    const whereConditions = [
      gte(modelPerformance.evaluatedAt, cutoffDate.toISOString()),
      sql`${modelPerformance.actualOutcome} != 'pending'`,
    ];

    if (aiModel) {
      whereConditions.push(sql`${modelPerformance.aiModel} = ${aiModel}`);
    }

    const predictions = db
      .select()
      .from(modelPerformance)
      .where(and(...whereConditions))
      .orderBy(desc(modelPerformance.evaluatedAt))
      .all() as PredictionRecord[];

    if (predictions.length < minSamples) {
      logger.info(`Insufficient samples for feedback: ${predictions.length} < ${minSamples}`);
      return null;
    }

    // Calculate accuracy metrics
    const correct = predictions.filter((p) => p.actualOutcome === 'correct');
    const incorrect = predictions.filter((p) => p.actualOutcome === 'incorrect');
    const overallAccuracy = correct.length / predictions.length;

    // Accuracy by decision type
    const buyPreds = predictions.filter((p) => p.decision === 'BUY');
    const sellPreds = predictions.filter((p) => p.decision === 'SELL');
    const holdPreds = predictions.filter((p) => p.decision === 'HOLD');

    const buyAccuracy =
      buyPreds.length > 0
        ? buyPreds.filter((p) => p.actualOutcome === 'correct').length / buyPreds.length
        : 0;
    const sellAccuracy =
      sellPreds.length > 0
        ? sellPreds.filter((p) => p.actualOutcome === 'correct').length / sellPreds.length
        : 0;
    const holdAccuracy =
      holdPreds.length > 0
        ? holdPreds.filter((p) => p.actualOutcome === 'correct').length / holdPreds.length
        : 0;

    // Conviction analysis
    const avgConvictionCorrect =
      correct.length > 0 ? correct.reduce((sum, p) => sum + p.conviction, 0) / correct.length : 0;
    const avgConvictionIncorrect =
      incorrect.length > 0
        ? incorrect.reduce((sum, p) => sum + p.conviction, 0) / incorrect.length
        : 0;

    // Detect biases
    const biases = this.detectBiases(predictions);

    // Identify best/worst performing setups
    const { bestPerformingSetups, worstPerformingSetups } = this.identifySetups(predictions);

    // Generate suggestions
    const feedback: PerformanceFeedback = {
      overallAccuracy,
      buyAccuracy,
      sellAccuracy,
      holdAccuracy,
      avgConvictionCorrect,
      avgConvictionIncorrect,
      bestPerformingSetups,
      worstPerformingSetups,
      biases,
      suggestions: [],
      sampleSize: predictions.length,
      periodDays: feedbackWindow,
    };

    feedback.suggestions = this.generateSuggestions(feedback);

    logger.info(
      {
        model: aiModel || 'all',
        sampleSize: predictions.length,
        overallAccuracy: (overallAccuracy * 100).toFixed(1),
      },
      'Generated performance feedback',
    );

    return feedback;
  }

  /**
   * Detect biases in predictions
   */
  detectBiases(predictions: PredictionRecord[]): string[] {
    const biases: string[] = [];

    if (predictions.length === 0) return biases;

    // 1. Overconfidence bias
    const highConviction = predictions.filter((p) => p.conviction >= 80);
    if (highConviction.length >= 5) {
      const highConvictionAccuracy =
        highConviction.filter((p) => p.actualOutcome === 'correct').length / highConviction.length;
      if (highConvictionAccuracy < 0.7) {
        biases.push(
          `Overconfidence: High conviction (≥80) predictions have ${(highConvictionAccuracy * 100).toFixed(0)}% accuracy`,
        );
      }
    }

    // 2. Direction bias
    const buyCount = predictions.filter((p) => p.decision === 'BUY').length;
    const sellCount = predictions.filter((p) => p.decision === 'SELL').length;
    const holdCount = predictions.filter((p) => p.decision === 'HOLD').length;
    const total = predictions.length;

    if (buyCount / total > 0.6) {
      biases.push(
        `Direction bias: Favoring BUY (${((buyCount / total) * 100).toFixed(0)}% of decisions)`,
      );
    } else if (sellCount / total > 0.6) {
      biases.push(
        `Direction bias: Favoring SELL (${((sellCount / total) * 100).toFixed(0)}% of decisions)`,
      );
    } else if (holdCount / total > 0.6) {
      biases.push(
        `Direction bias: Favoring HOLD (${((holdCount / total) * 100).toFixed(0)}% of decisions)`,
      );
    }

    // 3. Conviction calibration
    const lowConviction = predictions.filter((p) => p.conviction < 50);
    const highConvictionCheck = predictions.filter((p) => p.conviction >= 80);

    if (lowConviction.length >= 5 && highConvictionCheck.length >= 5) {
      const lowAcc =
        lowConviction.filter((p) => p.actualOutcome === 'correct').length / lowConviction.length;
      const highAcc =
        highConvictionCheck.filter((p) => p.actualOutcome === 'correct').length /
        highConvictionCheck.length;

      if (Math.abs(highAcc - lowAcc) < 0.1) {
        biases.push('Conviction calibration: Conviction levels not predictive of accuracy');
      }
    }

    // 4. Sector bias (if we have sector data in signals)
    const symbolGroups = this.groupBySymbol(predictions);
    const symbolAccuracies = Object.entries(symbolGroups)
      .filter(([, preds]) => preds.length >= 3)
      .map(([symbol, preds]) => ({
        symbol,
        accuracy: preds.filter((p) => p.actualOutcome === 'correct').length / preds.length,
      }));

    if (symbolAccuracies.length >= 3) {
      const avgAccuracy =
        symbolAccuracies.reduce((sum, s) => sum + s.accuracy, 0) / symbolAccuracies.length;
      const worst = symbolAccuracies.filter((s) => s.accuracy < avgAccuracy - 0.2);
      if (worst.length > 0) {
        biases.push(
          `Stock-specific weakness: Poor performance on ${worst.map((w) => w.symbol).join(', ')}`,
        );
      }
    }

    // 5. Timing bias (market conditions)
    const recentPreds = predictions.slice(0, Math.floor(predictions.length / 3));
    const olderPreds = predictions.slice(Math.floor(predictions.length / 3));

    if (recentPreds.length >= 5 && olderPreds.length >= 5) {
      const recentAcc =
        recentPreds.filter((p) => p.actualOutcome === 'correct').length / recentPreds.length;
      const olderAcc =
        olderPreds.filter((p) => p.actualOutcome === 'correct').length / olderPreds.length;

      if (recentAcc < olderAcc - 0.15) {
        biases.push(
          `Timing bias: Recent predictions (${(recentAcc * 100).toFixed(0)}%) underperforming vs earlier period (${(olderAcc * 100).toFixed(0)}%)`,
        );
      } else if (recentAcc > olderAcc + 0.15) {
        biases.push(
          `Timing bias: Recent predictions (${(recentAcc * 100).toFixed(0)}%) improving vs earlier period (${(olderAcc * 100).toFixed(0)}%)`,
        );
      }
    }

    return biases;
  }

  /**
   * Identify best and worst performing setups
   */
  private identifySetups(predictions: PredictionRecord[]): {
    bestPerformingSetups: string[];
    worstPerformingSetups: string[];
  } {
    const bestPerformingSetups: string[] = [];
    const worstPerformingSetups: string[] = [];

    if (predictions.length === 0) return { bestPerformingSetups, worstPerformingSetups };

    // Analyze by decision + conviction level
    const highConvictionBuy = predictions.filter((p) => p.decision === 'BUY' && p.conviction >= 80);
    const highConvictionSell = predictions.filter(
      (p) => p.decision === 'SELL' && p.conviction >= 80,
    );

    if (highConvictionBuy.length >= 3) {
      const accuracy =
        highConvictionBuy.filter((p) => p.actualOutcome === 'correct').length /
        highConvictionBuy.length;
      if (accuracy >= 0.75) {
        bestPerformingSetups.push(
          `High-conviction BUY signals (${(accuracy * 100).toFixed(0)}% accurate, n=${highConvictionBuy.length})`,
        );
      } else if (accuracy < 0.5) {
        worstPerformingSetups.push(
          `High-conviction BUY signals (${(accuracy * 100).toFixed(0)}% accurate, n=${highConvictionBuy.length})`,
        );
      }
    }

    if (highConvictionSell.length >= 3) {
      const accuracy =
        highConvictionSell.filter((p) => p.actualOutcome === 'correct').length /
        highConvictionSell.length;
      if (accuracy >= 0.75) {
        bestPerformingSetups.push(
          `High-conviction SELL signals (${(accuracy * 100).toFixed(0)}% accurate, n=${highConvictionSell.length})`,
        );
      } else if (accuracy < 0.5) {
        worstPerformingSetups.push(
          `High-conviction SELL signals (${(accuracy * 100).toFixed(0)}% accurate, n=${highConvictionSell.length})`,
        );
      }
    }

    // Analyze by return magnitude
    const withReturns = predictions.filter(
      (p) => p.actualReturnPct !== null && p.actualOutcome === 'correct',
    );
    if (withReturns.length >= 5) {
      const avgReturn =
        withReturns.reduce((sum, p) => sum + (p.actualReturnPct || 0), 0) / withReturns.length;
      const bigWinners = withReturns.filter((p) => (p.actualReturnPct || 0) > avgReturn * 2);
      if (bigWinners.length >= 2) {
        const commonDecision = this.getMostCommonDecision(bigWinners);
        if (commonDecision) {
          bestPerformingSetups.push(
            `${commonDecision} signals with strong returns (avg ${avgReturn.toFixed(1)}%)`,
          );
        }
      }
    }

    return { bestPerformingSetups, worstPerformingSetups };
  }

  /**
   * Generate actionable suggestions based on feedback
   */
  generateSuggestions(feedback: PerformanceFeedback): string[] {
    const suggestions: string[] = [];

    // Overall accuracy suggestions
    if (feedback.overallAccuracy < 0.55) {
      suggestions.push(
        'Overall accuracy is below 55%. Consider requiring higher conviction thresholds before acting.',
      );
    } else if (feedback.overallAccuracy > 0.7) {
      suggestions.push(
        'Strong overall performance. Continue current approach with minor refinements.',
      );
    }

    // Decision-type specific suggestions
    if (feedback.buyAccuracy < 0.5 && feedback.buyAccuracy > 0) {
      suggestions.push(
        `BUY accuracy is ${(feedback.buyAccuracy * 100).toFixed(0)}%. Be more conservative with BUY signals.`,
      );
    }
    if (feedback.sellAccuracy < 0.5 && feedback.sellAccuracy > 0) {
      suggestions.push(
        `SELL accuracy is ${(feedback.sellAccuracy * 100).toFixed(0)}%. Be more conservative with SELL signals.`,
      );
    }
    if (feedback.holdAccuracy < 0.5 && feedback.holdAccuracy > 0) {
      suggestions.push(
        `HOLD accuracy is ${(feedback.holdAccuracy * 100).toFixed(0)}%. Reconsider HOLD criteria.`,
      );
    }

    // Best decision type
    const bestDecision = this.findBestDecision(feedback);
    if (bestDecision) {
      suggestions.push(
        `Your ${bestDecision.type} signals are most accurate (${(bestDecision.accuracy * 100).toFixed(0)}%). Prioritize similar setups.`,
      );
    }

    // Conviction calibration
    if (feedback.avgConvictionCorrect > 0 && feedback.avgConvictionIncorrect > 0) {
      const convictionDiff = feedback.avgConvictionCorrect - feedback.avgConvictionIncorrect;
      if (convictionDiff < 5) {
        suggestions.push(
          'Conviction levels are poorly calibrated. High conviction does not correlate with accuracy.',
        );
      } else if (convictionDiff > 20) {
        suggestions.push(
          `Well-calibrated conviction (${convictionDiff.toFixed(0)} point spread). Trust high-conviction calls.`,
        );
      }
    }

    // Bias-based suggestions
    if (feedback.biases.length > 0) {
      for (const bias of feedback.biases) {
        if (bias.includes('Overconfidence')) {
          suggestions.push('Reduce conviction on uncertain signals to improve calibration.');
        }
        if (bias.includes('Direction bias: Favoring BUY')) {
          suggestions.push('You may be too bullish. Increase threshold for BUY signals.');
        }
        if (bias.includes('Direction bias: Favoring SELL')) {
          suggestions.push('You may be too bearish. Increase threshold for SELL signals.');
        }
      }
    }

    // Setup-based suggestions
    if (feedback.worstPerformingSetups.length > 0) {
      suggestions.push(`Avoid or reduce exposure to: ${feedback.worstPerformingSetups[0]}`);
    }
    if (feedback.bestPerformingSetups.length > 0) {
      suggestions.push(`Double down on: ${feedback.bestPerformingSetups[0]}`);
    }

    return suggestions;
  }

  /**
   * Build feedback section for AI prompt
   */
  async buildFeedbackPromptSection(aiModel?: string): Promise<string> {
    const feedback = await this.generateFeedback(aiModel);

    if (!feedback) {
      return '';
    }

    const lines: string[] = [
      '## Your Recent Performance',
      `- Overall accuracy: ${(feedback.overallAccuracy * 100).toFixed(0)}% (last ${feedback.periodDays} days, ${feedback.sampleSize} predictions)`,
      `- BUY accuracy: ${(feedback.buyAccuracy * 100).toFixed(0)}%, SELL accuracy: ${(feedback.sellAccuracy * 100).toFixed(0)}%, HOLD accuracy: ${(feedback.holdAccuracy * 100).toFixed(0)}%`,
    ];

    if (feedback.avgConvictionCorrect > 0) {
      lines.push(
        `- Your high-conviction (≥80) calls are ${((feedback.avgConvictionCorrect / 100) * 100).toFixed(0)}% accurate on average`,
      );
    }

    if (feedback.biases.length > 0) {
      lines.push(`- Detected biases: ${feedback.biases[0]}`);
    }

    if (feedback.suggestions.length > 0) {
      lines.push(`- Suggestion: ${feedback.suggestions[0]}`);
    }

    if (feedback.bestPerformingSetups.length > 0) {
      lines.push(`- Best setup: ${feedback.bestPerformingSetups[0]}`);
    }

    return lines.join('\n');
  }

  /**
   * Compare performance across different AI models
   */
  async compareModels(): Promise<ModelComparison> {
    const enabled = configManager.get<boolean>('aiSelfImprovement.enabled');
    if (!enabled) {
      return { models: [], recommendation: 'AI self-improvement is disabled' };
    }

    const feedbackWindow = configManager.get<number>('aiSelfImprovement.feedbackWindow');
    const db = getDb();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - feedbackWindow);

    const predictions = db
      .select()
      .from(modelPerformance)
      .where(
        and(
          gte(modelPerformance.evaluatedAt, cutoffDate.toISOString()),
          sql`${modelPerformance.actualOutcome} != 'pending'`,
        ),
      )
      .all() as PredictionRecord[];

    // Group by model
    const modelGroups = predictions.reduce(
      (acc, pred) => {
        if (!acc[pred.aiModel]) {
          acc[pred.aiModel] = [];
        }
        acc[pred.aiModel].push(pred);
        return acc;
      },
      {} as Record<string, PredictionRecord[]>,
    );

    const models = Object.entries(modelGroups)
      .filter(([, preds]) => preds.length >= 5)
      .map(([model, preds]) => {
        const correct = preds.filter((p) => p.actualOutcome === 'correct');
        const accuracy = correct.length / preds.length;

        const withReturns = preds.filter((p) => p.actualReturnPct !== null);
        const avgReturn =
          withReturns.length > 0
            ? withReturns.reduce((sum, p) => sum + (p.actualReturnPct || 0), 0) / withReturns.length
            : 0;

        const buyAcc =
          preds.filter((p) => p.decision === 'BUY').length > 0
            ? preds.filter((p) => p.decision === 'BUY').filter((p) => p.actualOutcome === 'correct')
                .length / preds.filter((p) => p.decision === 'BUY').length
            : 0;
        const sellAcc =
          preds.filter((p) => p.decision === 'SELL').length > 0
            ? preds
                .filter((p) => p.decision === 'SELL')
                .filter((p) => p.actualOutcome === 'correct').length /
              preds.filter((p) => p.decision === 'SELL').length
            : 0;
        const holdAcc =
          preds.filter((p) => p.decision === 'HOLD').length > 0
            ? preds
                .filter((p) => p.decision === 'HOLD')
                .filter((p) => p.actualOutcome === 'correct').length /
              preds.filter((p) => p.decision === 'HOLD').length
            : 0;

        const bestDecisionType =
          buyAcc >= sellAcc && buyAcc >= holdAcc ? 'BUY' : sellAcc >= holdAcc ? 'SELL' : 'HOLD';

        return {
          model,
          accuracy,
          avgReturn,
          sampleSize: preds.length,
          bestDecision: bestDecisionType,
        };
      })
      .sort((a, b) => b.accuracy - a.accuracy);

    let recommendation = '';
    if (models.length === 0) {
      recommendation = 'Insufficient data to compare models';
    } else if (models.length === 1) {
      recommendation = `Only one model evaluated: ${models[0].model}`;
    } else {
      const best = models[0];
      const diff = best.accuracy - models[1].accuracy;
      if (diff > 0.1) {
        recommendation = `${best.model} significantly outperforms others (+${(diff * 100).toFixed(0)}% accuracy). Recommend using ${best.model} for all decisions.`;
      } else if (diff > 0.05) {
        recommendation = `${best.model} moderately outperforms others (+${(diff * 100).toFixed(0)}% accuracy). Consider favoring ${best.model}.`;
      } else {
        recommendation = `Models perform similarly. Use ${best.model} for ${best.bestDecision} signals, evaluate others for specific scenarios.`;
      }
    }

    return { models, recommendation };
  }

  /**
   * Get calibration curve (conviction vs actual accuracy)
   */
  async getCalibrationCurve(aiModel?: string): Promise<CalibrationBucket[]> {
    const enabled = configManager.get<boolean>('aiSelfImprovement.enabled');
    if (!enabled) {
      return [];
    }

    const feedbackWindow = configManager.get<number>('aiSelfImprovement.feedbackWindow');
    const db = getDb();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - feedbackWindow);

    const whereConditions = [
      gte(modelPerformance.evaluatedAt, cutoffDate.toISOString()),
      sql`${modelPerformance.actualOutcome} != 'pending'`,
    ];

    if (aiModel) {
      whereConditions.push(sql`${modelPerformance.aiModel} = ${aiModel}`);
    }

    const predictions = db
      .select()
      .from(modelPerformance)
      .where(and(...whereConditions))
      .all() as PredictionRecord[];

    // Group into buckets: 0-20, 20-40, 40-60, 60-80, 80-100
    const buckets = [
      { range: '0-20', min: 0, max: 20 },
      { range: '20-40', min: 20, max: 40 },
      { range: '40-60', min: 40, max: 60 },
      { range: '60-80', min: 60, max: 80 },
      { range: '80-100', min: 80, max: 100 },
    ];

    return buckets
      .map(({ range, min, max }) => {
        const bucketPreds = predictions.filter((p) => p.conviction >= min && p.conviction < max);
        if (bucketPreds.length === 0) {
          return null;
        }

        const accuracy =
          bucketPreds.filter((p) => p.actualOutcome === 'correct').length / bucketPreds.length;
        const avgConviction =
          bucketPreds.reduce((sum, p) => sum + p.conviction, 0) / bucketPreds.length;

        return {
          convictionRange: range,
          predictions: bucketPreds.length,
          accuracy,
          avgConviction,
        };
      })
      .filter((b): b is CalibrationBucket => b !== null);
  }

  /**
   * Helper: Group predictions by symbol
   */
  private groupBySymbol(predictions: PredictionRecord[]): Record<string, PredictionRecord[]> {
    return predictions.reduce(
      (acc, pred) => {
        if (!acc[pred.symbol]) {
          acc[pred.symbol] = [];
        }
        acc[pred.symbol].push(pred);
        return acc;
      },
      {} as Record<string, PredictionRecord[]>,
    );
  }

  /**
   * Helper: Find most common decision in a list
   */
  private getMostCommonDecision(predictions: PredictionRecord[]): string | null {
    if (predictions.length === 0) return null;

    const counts = predictions.reduce(
      (acc, p) => {
        acc[p.decision] = (acc[p.decision] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0][0];
  }

  /**
   * Helper: Find best performing decision type
   */
  private findBestDecision(feedback: PerformanceFeedback): {
    type: string;
    accuracy: number;
  } | null {
    const decisions = [
      { type: 'BUY', accuracy: feedback.buyAccuracy },
      { type: 'SELL', accuracy: feedback.sellAccuracy },
      { type: 'HOLD', accuracy: feedback.holdAccuracy },
    ].filter((d) => d.accuracy > 0);

    if (decisions.length === 0) return null;

    return decisions.reduce((best, current) => (current.accuracy > best.accuracy ? current : best));
  }
}

/**
 * Singleton factory
 */
export function getAISelfImprovement(): AISelfImprovement {
  return AISelfImprovement.getInstance();
}
