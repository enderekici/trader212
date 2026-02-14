import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('portfolio-optimizer');

export interface PortfolioPosition {
  symbol: string;
  shares: number;
  currentPrice: number;
  weight: number;
}

export interface RebalanceAction {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  currentWeight: number;
  targetWeight: number;
  sharesDelta: number;
  dollarDelta: number;
}

export interface OptimizationResult {
  currentWeights: Record<string, number>;
  targetWeights: Record<string, number>;
  actions: RebalanceAction[];
  expectedReturn: number;
  expectedVolatility: number;
  sharpeRatio: number;
  diversificationRatio: number;
}

export interface OptimizationConstraints {
  maxPositionSize?: number;
  minPositionSize?: number;
  allowShortSelling?: boolean;
}

export interface EfficientFrontierPoint {
  expectedReturn: number;
  expectedVolatility: number;
  weights: Record<string, number>;
}

export class PortfolioOptimizer {
  /**
   * Calculate daily returns from price history
   * @param priceHistory Map of symbol -> array of daily prices (oldest first)
   * @returns Map of symbol -> array of daily returns
   */
  calculateReturns(priceHistory: Map<string, number[]>): Map<string, number[]> {
    const returns = new Map<string, number[]>();

    for (const [symbol, prices] of priceHistory) {
      if (prices.length < 2) {
        returns.set(symbol, []);
        continue;
      }

      const dailyReturns: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        const ret = (prices[i] - prices[i - 1]) / prices[i - 1];
        dailyReturns.push(ret);
      }
      returns.set(symbol, dailyReturns);
    }

    return returns;
  }

  /**
   * Calculate covariance matrix from returns
   * @param returns Map of symbol -> array of daily returns
   * @returns Covariance matrix as Map<string, Map<string, number>>
   */
  calculateCovarianceMatrix(returns: Map<string, number[]>): Map<string, Map<string, number>> {
    const symbols = Array.from(returns.keys());
    const covMatrix = new Map<string, Map<string, number>>();

    // Calculate means
    const means = new Map<string, number>();
    for (const [symbol, rets] of returns) {
      if (rets.length === 0) {
        means.set(symbol, 0);
      } else {
        const mean = rets.reduce((sum, r) => sum + r, 0) / rets.length;
        means.set(symbol, mean);
      }
    }

    // Calculate covariances
    for (const sym1 of symbols) {
      const row = new Map<string, number>();
      const rets1 = returns.get(sym1) || [];
      const mean1 = means.get(sym1) || 0;

      for (const sym2 of symbols) {
        const rets2 = returns.get(sym2) || [];
        const mean2 = means.get(sym2) || 0;

        if (rets1.length === 0 || rets2.length === 0) {
          row.set(sym2, 0);
          continue;
        }

        const n = Math.min(rets1.length, rets2.length);
        let cov = 0;
        for (let i = 0; i < n; i++) {
          cov += (rets1[i] - mean1) * (rets2[i] - mean2);
        }
        cov /= n - 1; // Sample covariance
        row.set(sym2, cov);
      }
      covMatrix.set(sym1, row);
    }

    return covMatrix;
  }

  /**
   * Calculate correlation matrix from returns
   * @param returns Map of symbol -> array of daily returns
   * @returns Correlation matrix as Map<string, Map<string, number>>
   */
  calculateCorrelationMatrix(returns: Map<string, number[]>): Map<string, Map<string, number>> {
    const covMatrix = this.calculateCovarianceMatrix(returns);
    const symbols = Array.from(returns.keys());
    const corrMatrix = new Map<string, Map<string, number>>();

    for (const sym1 of symbols) {
      const row = new Map<string, number>();
      const cov1 = covMatrix.get(sym1);
      const var1 = cov1?.get(sym1) || 0;
      const std1 = Math.sqrt(Math.max(0, var1));

      for (const sym2 of symbols) {
        const cov2 = covMatrix.get(sym2);
        const var2 = cov2?.get(sym2) || 0;
        const std2 = Math.sqrt(Math.max(0, var2));

        const cov12 = cov1?.get(sym2) || 0;

        if (std1 === 0 || std2 === 0) {
          row.set(sym2, sym1 === sym2 ? 1 : 0);
        } else {
          const corr = cov12 / (std1 * std2);
          row.set(sym2, corr);
        }
      }
      corrMatrix.set(sym1, row);
    }

    return corrMatrix;
  }

  /**
   * Calculate portfolio variance given weights and covariance matrix
   */
  private calculatePortfolioVariance(
    weights: Record<string, number>,
    covMatrix: Map<string, Map<string, number>>,
  ): number {
    const symbols = Object.keys(weights);
    let variance = 0;

    for (const sym1 of symbols) {
      const w1 = weights[sym1];
      const row = covMatrix.get(sym1);
      if (!row) continue;

      for (const sym2 of symbols) {
        const w2 = weights[sym2];
        const cov = row.get(sym2) || 0;
        variance += w1 * w2 * cov;
      }
    }

    return variance;
  }

  /**
   * Calculate portfolio expected return given weights and historical returns
   */
  private calculatePortfolioReturn(
    weights: Record<string, number>,
    returns: Map<string, number[]>,
  ): number {
    let portfolioReturn = 0;

    for (const [symbol, weight] of Object.entries(weights)) {
      const rets = returns.get(symbol) || [];
      if (rets.length === 0) continue;

      const meanReturn = rets.reduce((sum, r) => sum + r, 0) / rets.length;
      portfolioReturn += weight * meanReturn;
    }

    return portfolioReturn;
  }

  /**
   * Normalize weights to sum to 1
   */
  private normalizeWeights(weights: Record<string, number>): Record<string, number> {
    const sum = Object.values(weights).reduce((s, w) => s + w, 0);
    if (sum === 0) return weights;

    const normalized: Record<string, number> = {};
    for (const [symbol, weight] of Object.entries(weights)) {
      normalized[symbol] = weight / sum;
    }
    return normalized;
  }

  /**
   * Optimize for minimum variance portfolio
   * Uses iterative gradient descent approach
   */
  optimizeMinVariance(
    returns: Map<string, number[]>,
    constraints?: OptimizationConstraints,
  ): Record<string, number> {
    const symbols = Array.from(returns.keys());
    if (symbols.length === 0) return {};
    if (symbols.length === 1) return { [symbols[0]]: 1.0 };

    const maxPos =
      constraints?.maxPositionSize || configManager.get<number>('risk.maxPositionSizePct') || 0.15;
    const minPos = constraints?.minPositionSize || 0;
    const allowShort = constraints?.allowShortSelling || false;

    const covMatrix = this.calculateCovarianceMatrix(returns);

    // Start with equal weights
    let weights: Record<string, number> = {};
    for (const symbol of symbols) {
      weights[symbol] = 1 / symbols.length;
    }

    // Iterative optimization (gradient descent)
    const iterations = 100;
    const learningRate = 0.01;

    for (let iter = 0; iter < iterations; iter++) {
      const gradients: Record<string, number> = {};

      // Calculate gradient of variance with respect to each weight
      for (const sym1 of symbols) {
        let grad = 0;
        const row = covMatrix.get(sym1);
        if (!row) continue;

        for (const sym2 of symbols) {
          const cov = row.get(sym2) || 0;
          grad += 2 * weights[sym2] * cov;
        }
        gradients[sym1] = grad;
      }

      // Update weights
      for (const symbol of symbols) {
        weights[symbol] -= learningRate * gradients[symbol];

        // Apply constraints
        if (!allowShort && weights[symbol] < minPos) {
          weights[symbol] = minPos;
        }
        if (weights[symbol] > maxPos) {
          weights[symbol] = maxPos;
        }
      }

      // Normalize
      weights = this.normalizeWeights(weights);
    }

    return weights;
  }

  /**
   * Optimize for maximum Sharpe ratio
   * Uses grid search over weight combinations
   */
  optimizeMaxSharpe(
    returns: Map<string, number[]>,
    riskFreeRate = 0.02 / 252, // 2% annual, converted to daily
    constraints?: OptimizationConstraints,
  ): Record<string, number> {
    const symbols = Array.from(returns.keys());
    if (symbols.length === 0) return {};
    if (symbols.length === 1) return { [symbols[0]]: 1.0 };

    const maxPos =
      constraints?.maxPositionSize || configManager.get<number>('risk.maxPositionSizePct') || 0.15;
    const minPos = constraints?.minPositionSize || 0;
    const allowShort = constraints?.allowShortSelling || false;

    const covMatrix = this.calculateCovarianceMatrix(returns);

    let bestWeights: Record<string, number> = {};
    let bestSharpe = -Infinity;

    // Grid search (coarse then fine)
    const gridPoints = symbols.length <= 3 ? 20 : 10;

    // Generate weight combinations
    const generateWeights = (numAssets: number, points: number): number[][] => {
      if (numAssets === 1) return [[1]];
      if (numAssets === 2) {
        const combinations: number[][] = [];
        for (let i = 0; i <= points; i++) {
          const w1 = i / points;
          combinations.push([w1, 1 - w1]);
        }
        return combinations;
      }

      // For 3+ assets, use random sampling
      const combinations: number[][] = [];
      const samples = 1000;
      for (let i = 0; i < samples; i++) {
        const weights: number[] = [];
        let remaining = 1.0;

        for (let j = 0; j < numAssets - 1; j++) {
          const maxWeight = Math.min(maxPos, remaining);
          const w = Math.random() * maxWeight;
          weights.push(w);
          remaining -= w;
        }
        weights.push(Math.max(0, remaining));

        // Normalize if needed
        const sum = weights.reduce((s, w) => s + w, 0);
        if (sum > 0) {
          for (let j = 0; j < weights.length; j++) {
            weights[j] /= sum;
          }
        }

        combinations.push(weights);
      }
      return combinations;
    };

    const weightCombinations = generateWeights(symbols.length, gridPoints);

    for (const weightArray of weightCombinations) {
      const weights: Record<string, number> = {};
      let valid = true;

      for (let i = 0; i < symbols.length; i++) {
        const w = weightArray[i];
        if (!allowShort && w < minPos) {
          valid = false;
          break;
        }
        if (w > maxPos) {
          valid = false;
          break;
        }
        weights[symbols[i]] = w;
      }

      if (!valid) continue;

      const portfolioReturn = this.calculatePortfolioReturn(weights, returns);
      const portfolioVariance = this.calculatePortfolioVariance(weights, covMatrix);
      const portfolioStd = Math.sqrt(Math.max(0, portfolioVariance));

      if (portfolioStd === 0) continue;

      const sharpe = (portfolioReturn - riskFreeRate) / portfolioStd;

      if (sharpe > bestSharpe) {
        bestSharpe = sharpe;
        bestWeights = { ...weights };
      }
    }

    if (Object.keys(bestWeights).length === 0) {
      // Fallback to equal weights
      for (const symbol of symbols) {
        bestWeights[symbol] = 1 / symbols.length;
      }
    }

    return this.normalizeWeights(bestWeights);
  }

  /**
   * Optimize for risk parity (equal risk contribution)
   * Uses iterative approach to equalize marginal risk contributions
   */
  optimizeRiskParity(returns: Map<string, number[]>): Record<string, number> {
    const symbols = Array.from(returns.keys());
    if (symbols.length === 0) return {};
    if (symbols.length === 1) return { [symbols[0]]: 1.0 };

    const covMatrix = this.calculateCovarianceMatrix(returns);

    // Start with equal weights
    let weights: Record<string, number> = {};
    for (const symbol of symbols) {
      weights[symbol] = 1 / symbols.length;
    }

    // Iterative risk parity
    const iterations = 100;

    for (let iter = 0; iter < iterations; iter++) {
      const riskContributions: Record<string, number> = {};

      // Calculate marginal risk contribution for each asset
      for (const sym1 of symbols) {
        const row = covMatrix.get(sym1);
        if (!row) continue;

        let marginalRisk = 0;
        for (const sym2 of symbols) {
          const cov = row.get(sym2) || 0;
          marginalRisk += weights[sym2] * cov;
        }

        riskContributions[sym1] = weights[sym1] * marginalRisk;
      }

      // Calculate target risk contribution (equal for all assets)
      const totalRisk = Object.values(riskContributions).reduce((s, r) => s + r, 0);
      const targetRisk = totalRisk / symbols.length;

      // Adjust weights based on risk contribution deviation
      const newWeights: Record<string, number> = {};
      for (const symbol of symbols) {
        const currentRisk = riskContributions[symbol];
        const ratio = currentRisk > 0 ? targetRisk / currentRisk : 1;
        newWeights[symbol] = weights[symbol] * ratio;
      }

      // Normalize
      weights = this.normalizeWeights(newWeights);
    }

    return weights;
  }

  /**
   * Calculate diversification ratio
   * Higher ratio = better diversification
   */
  getDiversificationRatio(
    weights: Record<string, number>,
    covMatrix: Map<string, Map<string, number>>,
  ): number {
    const symbols = Object.keys(weights);
    if (symbols.length === 0) return 0;

    // Weighted average volatility
    let weightedAvgVol = 0;
    for (const symbol of symbols) {
      const row = covMatrix.get(symbol);
      const variance = row?.get(symbol) || 0;
      const vol = Math.sqrt(Math.max(0, variance));
      weightedAvgVol += weights[symbol] * vol;
    }

    // Portfolio volatility
    const portfolioVariance = this.calculatePortfolioVariance(weights, covMatrix);
    const portfolioVol = Math.sqrt(Math.max(0, portfolioVariance));

    if (portfolioVol === 0) return 0;

    return weightedAvgVol / portfolioVol;
  }

  /**
   * Generate efficient frontier points
   */
  getEfficientFrontier(returns: Map<string, number[]>, points = 20): EfficientFrontierPoint[] {
    const symbols = Array.from(returns.keys());
    if (symbols.length === 0) return [];

    const covMatrix = this.calculateCovarianceMatrix(returns);
    const frontier: EfficientFrontierPoint[] = [];

    // Calculate min and max return portfolios
    const minVarWeights = this.optimizeMinVariance(returns);
    const maxSharpeWeights = this.optimizeMaxSharpe(returns);

    // Generate points along the frontier
    for (let i = 0; i < points; i++) {
      // Simplified: interpolate between min variance and max Sharpe
      const alpha = i / (points - 1);
      const weights: Record<string, number> = {};

      for (const symbol of symbols) {
        const w1 = minVarWeights[symbol] || 0;
        const w2 = maxSharpeWeights[symbol] || 0;
        weights[symbol] = (1 - alpha) * w1 + alpha * w2;
      }

      const normalizedWeights = this.normalizeWeights(weights);
      const expectedReturn = this.calculatePortfolioReturn(normalizedWeights, returns);
      const variance = this.calculatePortfolioVariance(normalizedWeights, covMatrix);
      const volatility = Math.sqrt(Math.max(0, variance));

      frontier.push({
        expectedReturn,
        expectedVolatility: volatility,
        weights: normalizedWeights,
      });
    }

    return frontier;
  }

  /**
   * Suggest rebalancing actions based on current positions
   */
  suggestRebalance(
    positions: PortfolioPosition[],
    priceHistory: Map<string, number[]>,
    portfolioValue: number,
  ): OptimizationResult {
    const enabled = configManager.get<boolean>('portfolioOptimization.enabled');
    if (!enabled) {
      logger.info('Portfolio optimization disabled');
      const currentWeights: Record<string, number> = {};
      for (const pos of positions) {
        currentWeights[pos.symbol] = pos.weight;
      }
      return {
        currentWeights,
        targetWeights: currentWeights,
        actions: positions.map((pos) => ({
          symbol: pos.symbol,
          action: 'hold' as const,
          currentWeight: pos.weight,
          targetWeight: pos.weight,
          sharesDelta: 0,
          dollarDelta: 0,
        })),
        expectedReturn: 0,
        expectedVolatility: 0,
        sharpeRatio: 0,
        diversificationRatio: 1,
      };
    }

    if (positions.length === 0) {
      return {
        currentWeights: {},
        targetWeights: {},
        actions: [],
        expectedReturn: 0,
        expectedVolatility: 0,
        sharpeRatio: 0,
        diversificationRatio: 0,
      };
    }

    // Filter price history to only include current positions
    const relevantHistory = new Map<string, number[]>();
    for (const pos of positions) {
      const history = priceHistory.get(pos.symbol);
      if (history && history.length > 0) {
        relevantHistory.set(pos.symbol, history);
      }
    }

    if (relevantHistory.size === 0) {
      logger.warn('No price history available for rebalancing');
      const currentWeights: Record<string, number> = {};
      for (const pos of positions) {
        currentWeights[pos.symbol] = pos.weight;
      }
      return {
        currentWeights,
        targetWeights: currentWeights,
        actions: positions.map((pos) => ({
          symbol: pos.symbol,
          action: 'hold' as const,
          currentWeight: pos.weight,
          targetWeight: pos.weight,
          sharesDelta: 0,
          dollarDelta: 0,
        })),
        expectedReturn: 0,
        expectedVolatility: 0,
        sharpeRatio: 0,
        diversificationRatio: 1,
      };
    }

    const returns = this.calculateReturns(relevantHistory);
    const covMatrix = this.calculateCovarianceMatrix(returns);

    // Optimize for max Sharpe ratio
    const targetWeights = this.optimizeMaxSharpe(returns);

    // Current weights
    const currentWeights: Record<string, number> = {};
    for (const pos of positions) {
      currentWeights[pos.symbol] = pos.weight;
    }

    // Generate rebalance actions
    const actions: RebalanceAction[] = [];
    const allSymbols = new Set([...Object.keys(currentWeights), ...Object.keys(targetWeights)]);

    for (const symbol of allSymbols) {
      const currentWeight = currentWeights[symbol] || 0;
      const targetWeight = targetWeights[symbol] || 0;
      const weightDelta = targetWeight - currentWeight;

      const position = positions.find((p) => p.symbol === symbol);
      const currentPrice = position?.currentPrice || 0;

      let action: 'buy' | 'sell' | 'hold' = 'hold';
      let sharesDelta = 0;
      let dollarDelta = 0;

      if (Math.abs(weightDelta) > 0.01) {
        // Only rebalance if difference > 1%
        dollarDelta = weightDelta * portfolioValue;
        if (currentPrice > 0) {
          sharesDelta = Math.round(dollarDelta / currentPrice);
        }

        if (sharesDelta > 0) {
          action = 'buy';
        } else if (sharesDelta < 0) {
          action = 'sell';
        }
      }

      actions.push({
        symbol,
        action,
        currentWeight,
        targetWeight,
        sharesDelta,
        dollarDelta,
      });
    }

    // Calculate portfolio metrics
    const expectedReturn = this.calculatePortfolioReturn(targetWeights, returns);
    const portfolioVariance = this.calculatePortfolioVariance(targetWeights, covMatrix);
    const expectedVolatility = Math.sqrt(Math.max(0, portfolioVariance));
    const riskFreeRate = 0.02 / 252; // 2% annual, daily
    const sharpeRatio =
      expectedVolatility > 0 ? (expectedReturn - riskFreeRate) / expectedVolatility : 0;
    const diversificationRatio = this.getDiversificationRatio(targetWeights, covMatrix);

    logger.info(
      {
        actions: actions.length,
        expectedReturn: expectedReturn * 252,
        expectedVolatility: expectedVolatility * Math.sqrt(252),
        sharpeRatio,
        diversificationRatio,
      },
      'Rebalance suggestion generated',
    );

    return {
      currentWeights,
      targetWeights,
      actions,
      expectedReturn: expectedReturn * 252, // Annualized
      expectedVolatility: expectedVolatility * Math.sqrt(252), // Annualized
      sharpeRatio,
      diversificationRatio,
    };
  }
}

let optimizerInstance: PortfolioOptimizer | null = null;

export function getPortfolioOptimizer(): PortfolioOptimizer {
  if (!optimizerInstance) {
    optimizerInstance = new PortfolioOptimizer();
  }
  return optimizerInstance;
}
