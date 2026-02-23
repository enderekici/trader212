export const HELP: Record<string, string> = {
  // Trading212 connection
  't212.apiKey': 'Your Trading212 API key. Found in T212 app under Settings → API.',
  't212.dryRun': 'Dry run mode simulates trades without real money. Recommended for testing.',

  // Analysis settings
  'analysis.historicalDays': 'Number of days of historical price data to fetch for technical analysis.',
  'analysis.rsiOversold': 'RSI value below which a stock is considered oversold (potential buy signal). Default: 30.',
  'analysis.rsiOverbought': 'RSI value above which a stock is considered overbought (potential sell signal). Default: 70.',
  'analysis.minTechnicalScore': 'Minimum technical analysis score (0-100) required before considering a trade.',
  'analysis.minFundamentalScore': 'Minimum fundamental analysis score (0-100) required before considering a trade.',

  // Risk management
  'risk.maxPositionSizePct': 'Maximum percentage of portfolio value for any single position.',
  'risk.maxPortfolioRisk': 'Maximum total portfolio at risk at any time.',
  'risk.dailyLossLimitPct': 'Bot pauses trading if daily losses exceed this percentage of portfolio.',
  'risk.maxDrawdownPct': 'Bot pauses if portfolio drawdown from peak exceeds this percentage.',
  'risk.maxOpenPositions': 'Maximum number of positions the bot can hold simultaneously.',
  'risk.maxCorrelation': 'Maximum allowed correlation between a new position and existing positions.',

  // Execution settings
  'execution.requireApproval': 'If enabled, all trade plans require manual approval before execution.',
  'execution.approvalTimeoutMinutes': 'Minutes before a pending trade plan auto-expires.',
  'execution.approvalAutoExecute': 'If true, expired plans are auto-executed. If false, they are rejected.',
  'execution.reEvaluatePositions': 'If enabled, AI periodically re-analyzes open positions for exit signals.',

  // Pairlist settings
  'pairlist.mode': 'Dynamic: auto-discover stocks via filters. Static: only trade specified symbols. Hybrid: both.',
  'pairlist.maxPairs': 'Maximum number of stocks in the active pairlist.',
  'pairlist.minVolume': 'Minimum average daily volume (shares) for a stock to be included.',
  'pairlist.minPrice': 'Minimum stock price in USD.',
  'pairlist.maxPrice': 'Maximum stock price in USD.',
  'pairlist.minMarketCap': 'Minimum market capitalization in USD.',
  'pairlist.blacklist': 'Comma-separated list of symbols to always exclude from trading.',

  // Data sources
  'data.finnhub.enabled': 'Enable Finnhub for real-time quotes and news.',
  'data.marketaux.enabled': 'Enable Marketaux for news sentiment analysis.',
  'data.marketaux.maxCallsPerDay': 'Daily API call budget for Marketaux.',

  // Notifications
  'telegram.enabled': 'Enable Telegram notifications for trades and alerts.',
  'telegram.botToken': 'Your Telegram bot token from @BotFather.',
  'telegram.chatId': 'Your Telegram chat ID where notifications will be sent.',

  // Strategy
  'strategy.profile': 'Pre-configured strategy profiles: conservative, balanced, aggressive, scalper, swing.',

  // Page sections
  'page.overview': 'Real-time overview of bot status, portfolio value, and recent activity.',
  'page.positions': 'All currently open positions with P&L, stop losses, and trailing stops.',
  'page.trades': 'Complete history of all executed trades with entry/exit details.',
  'page.signals': 'Analysis signals generated for each stock, including scores and AI decisions.',
  'page.analytics': 'Performance metrics including win rate, Sharpe ratio, and drawdown.',
  'page.pairlist': 'Manage the list of stocks the bot monitors and trades.',
  'page.audit': 'Detailed activity log of all bot actions, errors, and system events.',
  'page.settings': 'Configure all bot parameters. Changes take effect immediately.',

  // Dashboard widgets
  'widget.portfolioValue': 'Total value of all open positions plus available cash.',
  'widget.todayPnl': 'Profit and loss for today including unrealized gains/losses.',
  'widget.openPositions': 'Number of currently open stock positions.',
  'widget.winRate': 'Percentage of closed trades that were profitable.',
  'widget.marketStatus': 'Current NYSE market status: open, pre-market, after-hours, or closed.',
  'widget.botStatus': 'Whether the bot is actively running, paused, or stopped.',

  // Signals page
  'signals.technicalScore': 'Score from 0-100 based on 25+ technical indicators.',
  'signals.fundamentalScore': 'Score from 0-100 based on company financials.',
  'signals.sentimentScore': 'Score from 0-100 based on news and social media sentiment.',
  'signals.decision': 'AI decision: BUY, SELL, or HOLD, with conviction percentage.',

  // Analytics
  'analytics.sharpe': 'Sharpe ratio: risk-adjusted return. Higher is better (>1 is good, >2 is excellent).',
  'analytics.maxDrawdown': 'Largest peak-to-trough decline. Lower is better.',
  'analytics.profitFactor': 'Gross profit divided by gross loss. >1.5 is considered good.',

  // Protections
  'protections.cooldown': 'Minimum time between trades on the same symbol.',
  'protections.maxLosingSteakTrades': 'Bot pauses after this many consecutive losing trades.',
};
