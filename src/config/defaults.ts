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
