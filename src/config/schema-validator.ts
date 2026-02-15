import { z } from 'zod';

// ── Trading212 ───────────────────────────────────────────────────────────────
const t212Schemas = new Map<string, z.ZodType>([
  ['t212.environment', z.enum(['demo', 'live'])],
  ['t212.accountType', z.enum(['INVEST', 'ISA'])],
]);

// ── Pairlist ─────────────────────────────────────────────────────────────────
const pairlistFilterEnum = z.enum([
  'volume',
  'price',
  'marketCap',
  'volatility',
  'blacklist',
  'maxPairs',
]);

const pairlistSchemas = new Map<string, z.ZodType>([
  ['pairlist.enabled', z.boolean()],
  ['pairlist.refreshMinutes', z.number().int().min(1).max(1440)],
  ['pairlist.filters', z.array(pairlistFilterEnum)],
  ['pairlist.volume.minAvgDailyVolume', z.number().int().min(0).max(100_000_000)],
  ['pairlist.volume.topN', z.number().int().min(1).max(1000)],
  ['pairlist.price.min', z.number().min(0).max(100_000)],
  ['pairlist.price.max', z.number().min(0).max(100_000)],
  ['pairlist.marketCap.minBillions', z.number().min(0).max(10_000)],
  ['pairlist.volatility.minDailyPct', z.number().min(0).max(100)],
  ['pairlist.volatility.maxDailyPct', z.number().min(0).max(100)],
  ['pairlist.volatility.lookbackDays', z.number().int().min(1).max(365)],
  ['pairlist.blacklist', z.array(z.string())],
  ['pairlist.maxPairs', z.number().int().min(1).max(500)],
  ['pairlist.mode', z.enum(['dynamic', 'static', 'hybrid'])],
  ['pairlist.staticSymbols', z.array(z.string())],
]);

// ── Data Sources ─────────────────────────────────────────────────────────────
const dataSchemas = new Map<string, z.ZodType>([
  ['data.finnhub.enabled', z.boolean()],
  ['data.finnhub.quotesEnabled', z.boolean()],
  ['data.finnhub.newsEnabled', z.boolean()],
  ['data.finnhub.earningsEnabled', z.boolean()],
  ['data.finnhub.insidersEnabled', z.boolean()],
  ['data.marketaux.enabled', z.boolean()],
  ['data.marketaux.maxCallsPerDay', z.number().int().min(1).max(10_000)],
  ['data.marketaux.priorityStocksCount', z.number().int().min(1).max(100)],
  ['data.yahoo.enabled', z.boolean()],
  ['data.earningsBlackoutDays', z.number().int().min(0).max(30)],
  ['data.newsMonitoring.enabled', z.boolean()],
  ['data.newsMonitoring.offHoursIntervalMinutes', z.number().int().min(1).max(1440)],
]);

// ── Analysis ─────────────────────────────────────────────────────────────────
const analysisSchemas = new Map<string, z.ZodType>([
  ['analysis.intervalMinutes', z.number().int().min(1).max(1440)],
  ['analysis.historicalDays', z.number().int().min(1).max(3650)],
  ['analysis.rsi.period', z.number().int().min(2).max(200)],
  ['analysis.macd.fast', z.number().int().min(2).max(200)],
  ['analysis.macd.slow', z.number().int().min(2).max(200)],
  ['analysis.macd.signal', z.number().int().min(2).max(200)],
  ['analysis.sma.periods', z.array(z.number().int().min(1).max(500))],
  ['analysis.ema.periods', z.array(z.number().int().min(1).max(500))],
  ['analysis.bb.period', z.number().int().min(2).max(200)],
  ['analysis.bb.stdDev', z.number().min(0.1).max(10)],
  ['analysis.atr.period', z.number().int().min(2).max(200)],
  ['analysis.adx.period', z.number().int().min(2).max(200)],
  ['analysis.stochastic.kPeriod', z.number().int().min(2).max(200)],
  ['analysis.stochastic.dPeriod', z.number().int().min(1).max(200)],
  ['analysis.cci.period', z.number().int().min(2).max(200)],
  ['analysis.mfi.period', z.number().int().min(2).max(200)],
  ['analysis.roc.period', z.number().int().min(1).max(200)],
  ['analysis.volumeSpike.threshold', z.number().min(0.1).max(100)],
  ['analysis.supportResistance.lookback', z.number().int().min(1).max(200)],
]);

// ── AI ───────────────────────────────────────────────────────────────────────
const aiSchemas = new Map<string, z.ZodType>([
  ['ai.enabled', z.boolean()],
  ['ai.provider', z.enum(['anthropic', 'ollama', 'openai-compatible'])],
  ['ai.model', z.string().min(1).max(200)],
  ['ai.ollama.baseUrl', z.string().url()],
  ['ai.ollama.model', z.string().min(1).max(200)],
  ['ai.openaiCompat.baseUrl', z.string().min(1).max(500)],
  ['ai.openaiCompat.model', z.string().min(1).max(200)],
  ['ai.openaiCompat.apiKey', z.string().max(500)],
  ['ai.maxConcurrentCalls', z.number().int().min(1).max(20)],
  ['ai.timeoutSeconds', z.number().int().min(5).max(600)],
  ['ai.includeHistoricalSignals', z.boolean()],
  ['ai.historicalSignalCount', z.number().int().min(1).max(100)],
  ['ai.temperature', z.number().min(0).max(2)],
  ['ai.research.enabled', z.boolean()],
  ['ai.research.intervalMinutes', z.number().int().min(1).max(1440)],
  ['ai.research.topStocksCount', z.number().int().min(1).max(500)],
]);

// ── Risk ─────────────────────────────────────────────────────────────────────
const riskSchemas = new Map<string, z.ZodType>([
  ['risk.maxPositions', z.number().int().min(1).max(100)],
  ['risk.maxPositionSizePct', z.number().min(0.01).max(1)],
  ['risk.minStopLossPct', z.number().min(0.001).max(1)],
  ['risk.maxStopLossPct', z.number().min(0.001).max(1)],
  ['risk.maxRiskPerTradePct', z.number().min(0.001).max(1)],
  ['risk.dailyLossLimitPct', z.number().min(0.001).max(1)],
  ['risk.maxDrawdownAlertPct', z.number().min(0.001).max(1)],
  ['risk.maxSectorConcentration', z.number().int().min(1).max(50)],
  ['risk.maxDailyTrades', z.number().int().min(1).max(1000)],
  ['risk.maxSectorValuePct', z.number().min(0.01).max(1)],
  ['risk.lossCooldownMinutes', z.number().int().min(0).max(1440)],
  ['risk.lossCooldownSizeFactor', z.number().min(0).max(1)],
  ['risk.streakReductionThreshold', z.number().int().min(1).max(50)],
  ['risk.streakReductionFactor', z.number().min(0).max(1)],
  ['risk.maxCorrelation', z.number().min(0).max(1)],
  ['risk.correlationLookbackDays', z.number().int().min(1).max(365)],
]);

// ── Execution ────────────────────────────────────────────────────────────────
const executionSchemas = new Map<string, z.ZodType>([
  ['execution.dryRun', z.boolean()],
  ['execution.positionMonitorMinutes', z.number().int().min(1).max(1440)],
  ['execution.t212SyncMinutes', z.number().int().min(1).max(1440)],
  ['execution.orderTimeoutSeconds', z.number().int().min(1).max(300)],
  ['execution.stopLossDelay', z.number().int().min(0).max(60_000)],
  ['execution.requireApproval', z.boolean()],
  ['execution.approvalTimeoutMinutes', z.number().int().min(1).max(1440)],
  ['execution.approvalAutoExecute', z.boolean()],
  ['execution.minRiskRewardRatio', z.number().min(0.1).max(100)],
  ['execution.maxHoldDays', z.number().int().min(1).max(3650)],
  ['execution.reEvaluatePositions', z.boolean()],
  ['execution.reEvalIntervalMinutes', z.number().int().min(1).max(1440)],
  ['execution.orderReplacement.enabled', z.boolean()],
  ['execution.orderReplacement.checkIntervalSeconds', z.number().int().min(1).max(600)],
  ['execution.orderReplacement.replaceAfterSeconds', z.number().int().min(1).max(600)],
  ['execution.orderReplacement.priceDeviationPct', z.number().min(0.0001).max(0.1)],
  ['execution.orderReplacement.maxReplacements', z.number().int().min(1).max(20)],
]);

// ── Protection ───────────────────────────────────────────────────────────────
const protectionSchemas = new Map<string, z.ZodType>([
  ['protection.cooldownMinutes', z.number().int().min(0).max(10_080)],
  ['protection.stoplossGuard.enabled', z.boolean()],
  ['protection.stoplossGuard.tradeLimit', z.number().int().min(1).max(100)],
  ['protection.stoplossGuard.lookbackMinutes', z.number().int().min(1).max(10_080)],
  ['protection.stoplossGuard.lockMinutes', z.number().int().min(1).max(10_080)],
  ['protection.stoplossGuard.onlyPerPair', z.boolean()],
  ['protection.maxDrawdownLock.enabled', z.boolean()],
  ['protection.maxDrawdownLock.maxDrawdownPct', z.number().min(0.001).max(1)],
  ['protection.maxDrawdownLock.lookbackMinutes', z.number().int().min(1).max(100_000)],
  ['protection.maxDrawdownLock.lockMinutes', z.number().int().min(1).max(100_000)],
  ['protection.lowProfitPair.enabled', z.boolean()],
  ['protection.lowProfitPair.minProfit', z.number().min(-1).max(1)],
  ['protection.lowProfitPair.tradeLimit', z.number().int().min(1).max(100)],
  ['protection.lowProfitPair.lookbackMinutes', z.number().int().min(1).max(100_000)],
  ['protection.lowProfitPair.lockMinutes', z.number().int().min(1).max(100_000)],
]);

// ── Exit ─────────────────────────────────────────────────────────────────────
const exitSchemas = new Map<string, z.ZodType>([
  ['exit.roiEnabled', z.boolean()],
  ['exit.roiTable', z.record(z.string(), z.number().min(-1).max(10))],
]);

// ── DCA ──────────────────────────────────────────────────────────────────────
const dcaSchemas = new Map<string, z.ZodType>([
  ['dca.enabled', z.boolean()],
  ['dca.maxRounds', z.number().int().min(1).max(20)],
  ['dca.dropPctPerRound', z.number().min(0.001).max(1)],
  ['dca.sizeMultiplier', z.number().min(0.1).max(10)],
  ['dca.minTimeBetweenMinutes', z.number().int().min(1).max(10_080)],
]);

// ── Partial Exit ─────────────────────────────────────────────────────────────
const partialExitTierSchema = z.object({
  pctGain: z.number().min(0).max(10),
  sellPct: z.number().min(0.01).max(1),
});

const partialExitSchemas = new Map<string, z.ZodType>([
  ['partialExit.enabled', z.boolean()],
  ['partialExit.tiers', z.array(partialExitTierSchema).min(1).max(20)],
  ['partialExit.moveStopToBreakeven', z.boolean()],
]);

// ── Multi-Timeframe ──────────────────────────────────────────────────────────
const multiTimeframeSchemas = new Map<string, z.ZodType>([
  ['multiTimeframe.enabled', z.boolean()],
  ['multiTimeframe.timeframes', z.array(z.string().min(1).max(10))],
  ['multiTimeframe.weights', z.record(z.string(), z.number().min(0).max(1))],
]);

// ── Regime ────────────────────────────────────────────────────────────────────
const regimeSchemas = new Map<string, z.ZodType>([
  ['regime.enabled', z.boolean()],
  ['regime.lookbackDays', z.number().int().min(1).max(365)],
  ['regime.vixThresholdHigh', z.number().min(1).max(100)],
  ['regime.trendMaLength', z.number().int().min(2).max(500)],
  ['regime.volatilityWindow', z.number().int().min(2).max(365)],
]);

// ── Webhooks ─────────────────────────────────────────────────────────────────
const webhookSchemas = new Map<string, z.ZodType>([
  ['webhook.enabled', z.boolean()],
  ['webhook.secret', z.string().max(500)],
  ['webhook.maxRetries', z.number().int().min(0).max(20)],
]);

// ── Attribution ──────────────────────────────────────────────────────────────
const attributionSchemas = new Map<string, z.ZodType>([['attribution.enabled', z.boolean()]]);

// ── Risk Parity ──────────────────────────────────────────────────────────────
const riskParitySchemas = new Map<string, z.ZodType>([
  ['riskParity.enabled', z.boolean()],
  ['riskParity.targetVolatility', z.number().min(0.01).max(1)],
  ['riskParity.lookbackDays', z.number().int().min(1).max(365)],
]);

// ── Tax ──────────────────────────────────────────────────────────────────────
const taxSchemas = new Map<string, z.ZodType>([
  ['tax.enabled', z.boolean()],
  ['tax.shortTermRate', z.number().min(0).max(1)],
  ['tax.longTermRate', z.number().min(0).max(1)],
  ['tax.harvestThreshold', z.number().min(-1_000_000).max(0)],
]);

// ── Monte Carlo ──────────────────────────────────────────────────────────────
const monteCarloSchemas = new Map<string, z.ZodType>([
  ['monteCarlo.simulations', z.number().int().min(100).max(1_000_000)],
  ['monteCarlo.confidenceLevels', z.array(z.number().min(0).max(1))],
]);

// ── Portfolio Optimization ───────────────────────────────────────────────────
const portfolioOptSchemas = new Map<string, z.ZodType>([
  ['portfolioOptimization.enabled', z.boolean()],
  ['portfolioOptimization.rebalanceIntervalDays', z.number().int().min(1).max(365)],
]);

// ── Social Sentiment ─────────────────────────────────────────────────────────
const socialSentimentSchemas = new Map<string, z.ZodType>([
  ['socialSentiment.enabled', z.boolean()],
  ['socialSentiment.redditEnabled', z.boolean()],
  ['socialSentiment.twitterEnabled', z.boolean()],
  ['socialSentiment.weight', z.number().min(0).max(1)],
]);

// ── Conditional Orders ───────────────────────────────────────────────────────
const conditionalOrderSchemas = new Map<string, z.ZodType>([
  ['conditionalOrders.enabled', z.boolean()],
  ['conditionalOrders.maxActive', z.number().int().min(1).max(500)],
  ['conditionalOrders.checkIntervalSeconds', z.number().int().min(1).max(600)],
]);

// ── AI Self-Improvement ──────────────────────────────────────────────────────
const aiSelfImprovementSchemas = new Map<string, z.ZodType>([
  ['aiSelfImprovement.enabled', z.boolean()],
  ['aiSelfImprovement.feedbackWindow', z.number().int().min(1).max(365)],
  ['aiSelfImprovement.minSamples', z.number().int().min(1).max(1000)],
]);

// ── Reports ──────────────────────────────────────────────────────────────────
const reportsSchemas = new Map<string, z.ZodType>([
  ['reports.enabled', z.boolean()],
  ['reports.schedule', z.enum(['daily', 'weekly', 'both'])],
  ['reports.includeEquityCurve', z.boolean()],
]);

// ── Web Research ─────────────────────────────────────────────────────────────
const webResearchSchemas = new Map<string, z.ZodType>([
  ['webResearch.enabled', z.boolean()],
  ['webResearch.cacheTtlHours', z.number().int().min(1).max(168)],
  ['webResearch.finvizEnabled', z.boolean()],
  ['webResearch.stockAnalysisEnabled', z.boolean()],
]);

// ── Streaming ────────────────────────────────────────────────────────────────
const streamingSchemas = new Map<string, z.ZodType>([
  ['streaming.enabled', z.boolean()],
  ['streaming.intervalSeconds', z.number().int().min(5).max(300)],
]);

// ── Monitoring ───────────────────────────────────────────────────────────────
const timeRegex = /^\d{2}:\d{2}$/;
const monitoringSchemas = new Map<string, z.ZodType>([
  ['monitoring.dailySummaryTime', z.string().regex(timeRegex, 'Must be HH:MM format')],
  ['monitoring.preMarketAlertTime', z.string().regex(timeRegex, 'Must be HH:MM format')],
  [
    'monitoring.weeklyReportDay',
    z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
  ],
]);

// ── Merged schema map ────────────────────────────────────────────────────────
export const configSchemas: Map<string, z.ZodType> = new Map([
  ...t212Schemas,
  ...pairlistSchemas,
  ...dataSchemas,
  ...analysisSchemas,
  ...aiSchemas,
  ...riskSchemas,
  ...executionSchemas,
  ...protectionSchemas,
  ...exitSchemas,
  ...dcaSchemas,
  ...partialExitSchemas,
  ...multiTimeframeSchemas,
  ...regimeSchemas,
  ...webhookSchemas,
  ...attributionSchemas,
  ...riskParitySchemas,
  ...taxSchemas,
  ...monteCarloSchemas,
  ...portfolioOptSchemas,
  ...socialSentimentSchemas,
  ...conditionalOrderSchemas,
  ...aiSelfImprovementSchemas,
  ...reportsSchemas,
  ...webResearchSchemas,
  ...streamingSchemas,
  ...monitoringSchemas,
]);

/**
 * Look up the Zod schema for a given config key.
 * Returns undefined for unknown keys.
 */
export function getConfigSchema(key: string): z.ZodType | undefined {
  return configSchemas.get(key);
}

/**
 * Validate a value against the schema for the given config key.
 * Unknown keys are considered valid (forward-compatibility).
 */
export function validateConfigValue(
  key: string,
  value: unknown,
): { valid: boolean; error?: string } {
  const schema = configSchemas.get(key);
  if (!schema) {
    return { valid: true };
  }

  const result = schema.safeParse(value);
  if (result.success) {
    return { valid: true };
  }

  const messages = result.error.issues.map((i) => i.message).join('; ');
  return { valid: false, error: messages };
}
