export interface ConfigDefault {
  key: string;
  value: string;
  category: string;
  description: string;
}

export const CONFIG_DEFAULTS: ConfigDefault[] = [
  // Trading212
  { key: 't212.environment', value: '"demo"', category: 'trading212', description: 'demo | live' },
  {
    key: 't212.accountType',
    value: '"INVEST"',
    category: 'trading212',
    description: 'INVEST | ISA',
  },

  // Pairlist
  {
    key: 'pairlist.enabled',
    value: 'true',
    category: 'pairlist',
    description: 'Enable pairlist pipeline',
  },
  {
    key: 'pairlist.refreshMinutes',
    value: '30',
    category: 'pairlist',
    description: 'Pairlist refresh interval',
  },
  {
    key: 'pairlist.filters',
    value: '["volume","price","marketCap","volatility","blacklist","maxPairs"]',
    category: 'pairlist',
    description: 'Active filter chain',
  },
  {
    key: 'pairlist.volume.minAvgDailyVolume',
    value: '500000',
    category: 'pairlist',
    description: 'Min avg daily volume (shares)',
  },
  {
    key: 'pairlist.volume.topN',
    value: '100',
    category: 'pairlist',
    description: 'Top N by volume',
  },
  {
    key: 'pairlist.price.min',
    value: '5',
    category: 'pairlist',
    description: 'Min stock price USD',
  },
  {
    key: 'pairlist.price.max',
    value: '1500',
    category: 'pairlist',
    description: 'Max stock price USD',
  },
  {
    key: 'pairlist.marketCap.minBillions',
    value: '2',
    category: 'pairlist',
    description: 'Min market cap in billions',
  },
  {
    key: 'pairlist.volatility.minDailyPct',
    value: '0.5',
    category: 'pairlist',
    description: 'Min daily volatility %',
  },
  {
    key: 'pairlist.volatility.maxDailyPct',
    value: '10',
    category: 'pairlist',
    description: 'Max daily volatility %',
  },
  {
    key: 'pairlist.volatility.lookbackDays',
    value: '20',
    category: 'pairlist',
    description: 'Volatility lookback period',
  },
  {
    key: 'pairlist.blacklist',
    value: '[]',
    category: 'pairlist',
    description: 'Blacklisted symbols',
  },
  {
    key: 'pairlist.maxPairs',
    value: '30',
    category: 'pairlist',
    description: 'Max stocks in pairlist',
  },

  // Data Sources
  {
    key: 'data.finnhub.enabled',
    value: 'true',
    category: 'dataSources',
    description: 'Enable Finnhub data',
  },
  {
    key: 'data.finnhub.quotesEnabled',
    value: 'true',
    category: 'dataSources',
    description: 'Enable real-time quotes',
  },
  {
    key: 'data.finnhub.newsEnabled',
    value: 'true',
    category: 'dataSources',
    description: 'Enable company news',
  },
  {
    key: 'data.finnhub.earningsEnabled',
    value: 'true',
    category: 'dataSources',
    description: 'Enable earnings calendar',
  },
  {
    key: 'data.finnhub.insidersEnabled',
    value: 'true',
    category: 'dataSources',
    description: 'Enable insider transactions',
  },
  {
    key: 'data.marketaux.enabled',
    value: 'true',
    category: 'dataSources',
    description: 'Enable Marketaux data',
  },
  {
    key: 'data.marketaux.maxCallsPerDay',
    value: '100',
    category: 'dataSources',
    description: 'Marketaux daily call budget',
  },
  {
    key: 'data.marketaux.priorityStocksCount',
    value: '10',
    category: 'dataSources',
    description: 'Top N stocks get Marketaux news',
  },
  {
    key: 'data.yahoo.enabled',
    value: 'true',
    category: 'dataSources',
    description: 'Enable Yahoo Finance data',
  },
  {
    key: 'data.earningsBlackoutDays',
    value: '3',
    category: 'dataSources',
    description: 'Avoid trading N days before earnings',
  },

  // Analysis
  {
    key: 'analysis.intervalMinutes',
    value: '15',
    category: 'analysis',
    description: 'Analysis loop interval',
  },
  {
    key: 'analysis.historicalDays',
    value: '365',
    category: 'analysis',
    description: 'OHLCV lookback days',
  },
  { key: 'analysis.rsi.period', value: '14', category: 'analysis', description: 'RSI period' },
  { key: 'analysis.macd.fast', value: '12', category: 'analysis', description: 'MACD fast period' },
  { key: 'analysis.macd.slow', value: '26', category: 'analysis', description: 'MACD slow period' },
  {
    key: 'analysis.macd.signal',
    value: '9',
    category: 'analysis',
    description: 'MACD signal period',
  },
  {
    key: 'analysis.sma.periods',
    value: '[20, 50, 200]',
    category: 'analysis',
    description: 'SMA periods',
  },
  {
    key: 'analysis.ema.periods',
    value: '[12, 26]',
    category: 'analysis',
    description: 'EMA periods',
  },
  {
    key: 'analysis.bb.period',
    value: '20',
    category: 'analysis',
    description: 'Bollinger Bands period',
  },
  {
    key: 'analysis.bb.stdDev',
    value: '2',
    category: 'analysis',
    description: 'Bollinger Bands std dev',
  },
  { key: 'analysis.atr.period', value: '14', category: 'analysis', description: 'ATR period' },
  { key: 'analysis.adx.period', value: '14', category: 'analysis', description: 'ADX period' },
  {
    key: 'analysis.stochastic.kPeriod',
    value: '14',
    category: 'analysis',
    description: 'Stochastic K period',
  },
  {
    key: 'analysis.stochastic.dPeriod',
    value: '3',
    category: 'analysis',
    description: 'Stochastic D period',
  },
  { key: 'analysis.cci.period', value: '20', category: 'analysis', description: 'CCI period' },
  { key: 'analysis.mfi.period', value: '14', category: 'analysis', description: 'MFI period' },
  { key: 'analysis.roc.period', value: '12', category: 'analysis', description: 'ROC period' },
  {
    key: 'analysis.volumeSpike.threshold',
    value: '1.5',
    category: 'analysis',
    description: 'Volume spike multiplier',
  },
  {
    key: 'analysis.supportResistance.lookback',
    value: '20',
    category: 'analysis',
    description: 'S/R lookback bars',
  },

  // AI
  { key: 'ai.enabled', value: 'true', category: 'ai', description: 'Enable AI analysis' },
  {
    key: 'ai.provider',
    value: '"anthropic"',
    category: 'ai',
    description: 'anthropic | ollama | openai-compatible',
  },
  {
    key: 'ai.model',
    value: '"claude-sonnet-4-5-20250929"',
    category: 'ai',
    description: 'AI model identifier',
  },
  {
    key: 'ai.ollama.baseUrl',
    value: '"http://localhost:11434"',
    category: 'ai',
    description: 'Ollama base URL',
  },
  {
    key: 'ai.ollama.model',
    value: '"palmyra-fin"',
    category: 'ai',
    description: 'Ollama model name',
  },
  {
    key: 'ai.openaiCompat.baseUrl',
    value: '"http://localhost:8317/v1"',
    category: 'ai',
    description: 'OpenAI-compatible base URL',
  },
  {
    key: 'ai.openaiCompat.model',
    value: '"claude-sonnet-4-5-20250929"',
    category: 'ai',
    description: 'OpenAI-compatible model name',
  },
  {
    key: 'ai.openaiCompat.apiKey',
    value: '""',
    category: 'ai',
    description: 'OpenAI-compatible API key',
  },
  {
    key: 'ai.maxConcurrentCalls',
    value: '2',
    category: 'ai',
    description: 'Max concurrent AI calls',
  },
  { key: 'ai.timeoutSeconds', value: '60', category: 'ai', description: 'AI call timeout' },
  {
    key: 'ai.includeHistoricalSignals',
    value: 'false',
    category: 'ai',
    description: 'Include historical signals in prompt',
  },
  {
    key: 'ai.historicalSignalCount',
    value: '5',
    category: 'ai',
    description: 'Previous signals sent to AI',
  },
  { key: 'ai.temperature', value: '0.1', category: 'ai', description: 'AI temperature' },

  // Risk
  { key: 'risk.maxPositions', value: '5', category: 'risk', description: 'Max open positions' },
  {
    key: 'risk.maxPositionSizePct',
    value: '0.15',
    category: 'risk',
    description: 'Max position size (% of portfolio)',
  },
  {
    key: 'risk.minStopLossPct',
    value: '0.01',
    category: 'risk',
    description: 'Min stop-loss (1%)',
  },
  {
    key: 'risk.maxStopLossPct',
    value: '0.10',
    category: 'risk',
    description: 'Max stop-loss (10%)',
  },
  {
    key: 'risk.maxRiskPerTradePct',
    value: '0.02',
    category: 'risk',
    description: 'Max risk per trade (2%)',
  },
  {
    key: 'risk.dailyLossLimitPct',
    value: '0.05',
    category: 'risk',
    description: 'Auto-pause at daily loss (5%)',
  },
  {
    key: 'risk.maxDrawdownAlertPct',
    value: '0.10',
    category: 'risk',
    description: 'Alert at drawdown (10%)',
  },
  {
    key: 'risk.maxSectorConcentration',
    value: '3',
    category: 'risk',
    description: 'Max positions per sector',
  },
  {
    key: 'risk.maxDailyTrades',
    value: '10',
    category: 'risk',
    description: 'Max trades per day (overtrading protection)',
  },
  {
    key: 'risk.maxSectorValuePct',
    value: '0.35',
    category: 'risk',
    description: 'Max sector exposure as % of portfolio value',
  },

  // Execution
  {
    key: 'execution.dryRun',
    value: 'true',
    category: 'execution',
    description: 'Dry-run mode (no real trades)',
  },
  {
    key: 'execution.positionMonitorMinutes',
    value: '5',
    category: 'execution',
    description: 'Position monitor interval',
  },
  {
    key: 'execution.t212SyncMinutes',
    value: '10',
    category: 'execution',
    description: 'T212 sync interval',
  },
  {
    key: 'execution.orderTimeoutSeconds',
    value: '10',
    category: 'execution',
    description: 'Order fill timeout',
  },
  {
    key: 'execution.stopLossDelay',
    value: '3000',
    category: 'execution',
    description: 'ms delay before placing stop after buy',
  },

  // Pairlist modes
  {
    key: 'pairlist.mode',
    value: '"dynamic"',
    category: 'pairlist',
    description: 'dynamic | static | hybrid',
  },
  {
    key: 'pairlist.staticSymbols',
    value: '[]',
    category: 'pairlist',
    description: 'Manual stock list for static/hybrid mode',
  },

  // 24/7 news monitoring
  {
    key: 'data.newsMonitoring.enabled',
    value: 'true',
    category: 'dataSources',
    description: 'Monitor news outside market hours',
  },
  {
    key: 'data.newsMonitoring.offHoursIntervalMinutes',
    value: '60',
    category: 'dataSources',
    description: 'News check interval outside market hours',
  },

  // Trade planning
  {
    key: 'execution.requireApproval',
    value: 'false',
    category: 'execution',
    description: 'Require manual approval before executing trades',
  },
  {
    key: 'execution.approvalTimeoutMinutes',
    value: '5',
    category: 'execution',
    description: 'Auto-reject trade plan if not approved within N minutes',
  },
  {
    key: 'execution.approvalAutoExecute',
    value: 'false',
    category: 'execution',
    description: 'Auto-execute if no response within timeout',
  },
  {
    key: 'execution.minRiskRewardRatio',
    value: '1.5',
    category: 'execution',
    description: 'Minimum risk/reward ratio for trade plans',
  },
  {
    key: 'execution.maxHoldDays',
    value: '30',
    category: 'execution',
    description: 'Default max hold days for positions',
  },

  // Dynamic position re-evaluation
  {
    key: 'execution.reEvaluatePositions',
    value: 'true',
    category: 'execution',
    description: 'AI re-evaluates open positions each cycle',
  },
  {
    key: 'execution.reEvalIntervalMinutes',
    value: '30',
    category: 'execution',
    description: 'Position re-evaluation interval',
  },

  // AI market research
  {
    key: 'ai.research.enabled',
    value: 'true',
    category: 'ai',
    description: 'Enable AI market research feature',
  },
  {
    key: 'ai.research.intervalMinutes',
    value: '120',
    category: 'ai',
    description: 'Market research interval',
  },
  {
    key: 'ai.research.topStocksCount',
    value: '50',
    category: 'ai',
    description: 'Number of top stocks to analyze in research',
  },

  // Risk - loss cool-down recovery
  {
    key: 'risk.lossCooldownMinutes',
    value: '60',
    category: 'risk',
    description: 'Cool-down duration (minutes) after daily loss limit breach',
  },
  {
    key: 'risk.lossCooldownSizeFactor',
    value: '0.5',
    category: 'risk',
    description: 'Position size multiplier during cool-down (0-1)',
  },

  // Risk - streak-based position sizing
  {
    key: 'risk.streakReductionThreshold',
    value: '3',
    category: 'risk',
    description: 'Consecutive losses before reducing position size',
  },
  {
    key: 'risk.streakReductionFactor',
    value: '0.5',
    category: 'risk',
    description: 'Position size multiplier per streak threshold',
  },

  // Risk - correlation
  {
    key: 'risk.maxCorrelation',
    value: '0.85',
    category: 'risk',
    description: 'Max correlation between positions (0-1)',
  },
  {
    key: 'risk.correlationLookbackDays',
    value: '30',
    category: 'risk',
    description: 'Lookback period for correlation calculation',
  },

  // Protections (pair locks)
  {
    key: 'protection.cooldownMinutes',
    value: '30',
    category: 'protection',
    description: 'Lock pair for N minutes after closing a trade on it',
  },
  {
    key: 'protection.stoplossGuard.enabled',
    value: 'true',
    category: 'protection',
    description: 'Lock trading after N stoploss exits in lookback period',
  },
  {
    key: 'protection.stoplossGuard.tradeLimit',
    value: '3',
    category: 'protection',
    description: 'Number of stoploss exits before locking',
  },
  {
    key: 'protection.stoplossGuard.lookbackMinutes',
    value: '120',
    category: 'protection',
    description: 'Lookback period for stoploss guard',
  },
  {
    key: 'protection.stoplossGuard.lockMinutes',
    value: '60',
    category: 'protection',
    description: 'Lock duration after stoploss guard triggers',
  },
  {
    key: 'protection.stoplossGuard.onlyPerPair',
    value: 'false',
    category: 'protection',
    description: 'Only lock the specific pair (false = global lock)',
  },
  {
    key: 'protection.maxDrawdownLock.enabled',
    value: 'true',
    category: 'protection',
    description: 'Lock all trading when drawdown exceeds threshold',
  },
  {
    key: 'protection.maxDrawdownLock.maxDrawdownPct',
    value: '0.10',
    category: 'protection',
    description: 'Drawdown threshold to trigger lock (10%)',
  },
  {
    key: 'protection.maxDrawdownLock.lookbackMinutes',
    value: '1440',
    category: 'protection',
    description: 'Lookback period for drawdown calculation (24h)',
  },
  {
    key: 'protection.maxDrawdownLock.lockMinutes',
    value: '120',
    category: 'protection',
    description: 'Lock duration after drawdown lock triggers',
  },
  {
    key: 'protection.lowProfitPair.enabled',
    value: 'true',
    category: 'protection',
    description: 'Lock pairs with consistently low profit',
  },
  {
    key: 'protection.lowProfitPair.minProfit',
    value: '-0.05',
    category: 'protection',
    description: 'Min cumulative profit threshold per pair',
  },
  {
    key: 'protection.lowProfitPair.tradeLimit',
    value: '3',
    category: 'protection',
    description: 'Min trades before evaluating pair profit',
  },
  {
    key: 'protection.lowProfitPair.lookbackMinutes',
    value: '10080',
    category: 'protection',
    description: 'Lookback period for pair profit (7 days)',
  },
  {
    key: 'protection.lowProfitPair.lockMinutes',
    value: '1440',
    category: 'protection',
    description: 'Lock duration for low profit pairs (24h)',
  },

  // Execution - Order replacement (repricing unfilled limit orders)
  {
    key: 'execution.orderReplacement.enabled',
    value: 'false',
    category: 'execution',
    description: 'Enable automatic order repricing for unfilled limit orders',
  },
  {
    key: 'execution.orderReplacement.checkIntervalSeconds',
    value: '30',
    category: 'execution',
    description: 'How often to check for stale orders',
  },
  {
    key: 'execution.orderReplacement.replaceAfterSeconds',
    value: '60',
    category: 'execution',
    description: 'Replace orders unfilled after N seconds',
  },
  {
    key: 'execution.orderReplacement.priceDeviationPct',
    value: '0.005',
    category: 'execution',
    description: 'Min price change (0.5%) to trigger replacement',
  },
  {
    key: 'execution.orderReplacement.maxReplacements',
    value: '3',
    category: 'execution',
    description: 'Max replacement attempts per original order',
  },

  // Exit - Time-based ROI table
  {
    key: 'exit.roiEnabled',
    value: 'false',
    category: 'exit',
    description: 'Enable time-based ROI auto-exit',
  },
  {
    key: 'exit.roiTable',
    value: '{"0": 0.06, "60": 0.04, "240": 0.02, "480": 0.01, "1440": 0.0}',
    category: 'exit',
    description:
      'ROI table: {minutes: minProfitRatio}. Trade exits when profit exceeds threshold for its age.',
  },

  // DCA (Dollar Cost Averaging)
  {
    key: 'dca.enabled',
    value: 'false',
    category: 'dca',
    description: 'Enable DCA / position scaling',
  },
  { key: 'dca.maxRounds', value: '3', category: 'dca', description: 'Max DCA rounds per position' },
  {
    key: 'dca.dropPctPerRound',
    value: '0.05',
    category: 'dca',
    description: 'Price drop % to trigger next DCA round',
  },
  {
    key: 'dca.sizeMultiplier',
    value: '1.0',
    category: 'dca',
    description: 'Multiplier for each subsequent DCA round (1.0 = same size)',
  },
  {
    key: 'dca.minTimeBetweenMinutes',
    value: '60',
    category: 'dca',
    description: 'Min time between DCA rounds',
  },

  // Partial Exits (Scale-Out)
  {
    key: 'partialExit.enabled',
    value: 'false',
    category: 'partialExit',
    description: 'Enable partial exit / scale-out',
  },
  {
    key: 'partialExit.tiers',
    value: '[{"pctGain": 0.05, "sellPct": 0.5}, {"pctGain": 0.10, "sellPct": 0.25}]',
    category: 'partialExit',
    description: 'Scale-out tiers: sell X% of position at Y% gain',
  },
  {
    key: 'partialExit.moveStopToBreakeven',
    value: 'true',
    category: 'partialExit',
    description: 'Move stop to breakeven after first partial exit',
  },

  // Multi-Timeframe Analysis
  {
    key: 'multiTimeframe.enabled',
    value: 'false',
    category: 'multiTimeframe',
    description: 'Enable multi-timeframe analysis',
  },
  {
    key: 'multiTimeframe.timeframes',
    value: '["1d", "4h", "1h"]',
    category: 'multiTimeframe',
    description: 'Timeframes to analyze (primary first)',
  },
  {
    key: 'multiTimeframe.weights',
    value: '{"1d": 0.5, "4h": 0.3, "1h": 0.2}',
    category: 'multiTimeframe',
    description: 'Weight per timeframe for composite score',
  },

  // Market Regime Detection
  {
    key: 'regime.enabled',
    value: 'false',
    category: 'regime',
    description: 'Enable market regime detection',
  },
  {
    key: 'regime.lookbackDays',
    value: '50',
    category: 'regime',
    description: 'Lookback days for regime classification',
  },
  {
    key: 'regime.vixThresholdHigh',
    value: '25',
    category: 'regime',
    description: 'VIX level above which market is high-volatility',
  },
  {
    key: 'regime.trendMaLength',
    value: '50',
    category: 'regime',
    description: 'MA length for trend detection',
  },
  {
    key: 'regime.volatilityWindow',
    value: '20',
    category: 'regime',
    description: 'Window for volatility regime calculation',
  },

  // Webhooks
  {
    key: 'webhook.enabled',
    value: 'false',
    category: 'webhook',
    description: 'Enable webhook system (inbound + outbound)',
  },
  {
    key: 'webhook.secret',
    value: '""',
    category: 'webhook',
    description: 'Shared secret for webhook signature verification',
  },
  {
    key: 'webhook.maxRetries',
    value: '3',
    category: 'webhook',
    description: 'Max retries for outbound webhook delivery',
  },

  // Performance Attribution
  {
    key: 'attribution.enabled',
    value: 'false',
    category: 'attribution',
    description: 'Enable P&L attribution by factor',
  },

  // Risk Parity Sizing
  {
    key: 'riskParity.enabled',
    value: 'false',
    category: 'riskParity',
    description: 'Enable volatility-adjusted position sizing',
  },
  {
    key: 'riskParity.targetVolatility',
    value: '0.15',
    category: 'riskParity',
    description: 'Target annualized portfolio volatility (15%)',
  },
  {
    key: 'riskParity.lookbackDays',
    value: '20',
    category: 'riskParity',
    description: 'Lookback days for volatility estimation',
  },

  // Tax Awareness
  {
    key: 'tax.enabled',
    value: 'false',
    category: 'tax',
    description: 'Enable tax-lot tracking and harvesting suggestions',
  },
  {
    key: 'tax.shortTermRate',
    value: '0.37',
    category: 'tax',
    description: 'Short-term capital gains rate (37%)',
  },
  {
    key: 'tax.longTermRate',
    value: '0.20',
    category: 'tax',
    description: 'Long-term capital gains rate (20%)',
  },
  {
    key: 'tax.harvestThreshold',
    value: '-500',
    category: 'tax',
    description: 'Min unrealized loss ($) to suggest tax-loss harvest',
  },

  // Monte Carlo Simulation
  {
    key: 'monteCarlo.simulations',
    value: '10000',
    category: 'monteCarlo',
    description: 'Number of Monte Carlo simulation runs',
  },
  {
    key: 'monteCarlo.confidenceLevels',
    value: '[0.05, 0.25, 0.50, 0.75, 0.95]',
    category: 'monteCarlo',
    description: 'Percentile levels for simulation output',
  },

  // Portfolio Optimization
  {
    key: 'portfolioOptimization.enabled',
    value: 'false',
    category: 'portfolioOptimization',
    description: 'Enable portfolio optimization suggestions',
  },
  {
    key: 'portfolioOptimization.rebalanceIntervalDays',
    value: '30',
    category: 'portfolioOptimization',
    description: 'Days between rebalance suggestions',
  },

  // Social Sentiment
  {
    key: 'socialSentiment.enabled',
    value: 'false',
    category: 'socialSentiment',
    description: 'Enable social media sentiment analysis',
  },
  {
    key: 'socialSentiment.redditEnabled',
    value: 'true',
    category: 'socialSentiment',
    description: 'Include Reddit sentiment',
  },
  {
    key: 'socialSentiment.twitterEnabled',
    value: 'true',
    category: 'socialSentiment',
    description: 'Include Twitter/X sentiment',
  },
  {
    key: 'socialSentiment.weight',
    value: '0.1',
    category: 'socialSentiment',
    description: 'Weight of social sentiment in composite score (0-1)',
  },

  // Conditional / OCO Orders
  {
    key: 'conditionalOrders.enabled',
    value: 'false',
    category: 'conditionalOrders',
    description: 'Enable conditional and OCO orders',
  },
  {
    key: 'conditionalOrders.maxActive',
    value: '20',
    category: 'conditionalOrders',
    description: 'Max active conditional orders',
  },
  {
    key: 'conditionalOrders.checkIntervalSeconds',
    value: '30',
    category: 'conditionalOrders',
    description: 'How often to check trigger conditions',
  },

  // AI Self-Improvement
  {
    key: 'aiSelfImprovement.enabled',
    value: 'false',
    category: 'aiSelfImprovement',
    description: 'Feed accuracy stats back into AI prompts',
  },
  {
    key: 'aiSelfImprovement.feedbackWindow',
    value: '30',
    category: 'aiSelfImprovement',
    description: 'Days of history to include in feedback',
  },
  {
    key: 'aiSelfImprovement.minSamples',
    value: '10',
    category: 'aiSelfImprovement',
    description: 'Min predictions before generating feedback',
  },

  // Scheduled Reports
  {
    key: 'reports.enabled',
    value: 'false',
    category: 'reports',
    description: 'Enable scheduled PDF/text report generation',
  },
  {
    key: 'reports.schedule',
    value: '"daily"',
    category: 'reports',
    description: 'Report schedule: daily | weekly | both',
  },
  {
    key: 'reports.includeEquityCurve',
    value: 'true',
    category: 'reports',
    description: 'Include equity curve chart in reports',
  },

  // Web Research (steer integration)
  {
    key: 'webResearch.enabled',
    value: 'false',
    category: 'webResearch',
    description: 'Enable web research via steer headless browser',
  },
  {
    key: 'webResearch.cacheTtlHours',
    value: '4',
    category: 'webResearch',
    description: 'Cache TTL for web research data (hours)',
  },
  {
    key: 'webResearch.finvizEnabled',
    value: 'true',
    category: 'webResearch',
    description: 'Scrape Finviz for analyst data',
  },
  {
    key: 'webResearch.stockAnalysisEnabled',
    value: 'true',
    category: 'webResearch',
    description: 'Scrape StockAnalysis for estimates',
  },

  // Monitoring
  {
    key: 'monitoring.dailySummaryTime',
    value: '"16:30"',
    category: 'monitoring',
    description: 'Daily summary time (ET)',
  },
  {
    key: 'monitoring.preMarketAlertTime',
    value: '"09:00"',
    category: 'monitoring',
    description: 'Pre-market alert time (ET)',
  },
  {
    key: 'monitoring.weeklyReportDay',
    value: '"friday"',
    category: 'monitoring',
    description: 'Weekly report day',
  },
];
