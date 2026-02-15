import { createLogger } from '../utils/logger.js';

const log = createLogger('exit-condition');

// ── Condition Types ──────────────────────────────────────────────

export interface PriceCondition {
  type: 'price';
  operator: 'above' | 'below' | 'crosses_above' | 'crosses_below';
  value: number;
}

export interface IndicatorCondition {
  type: 'indicator';
  indicator:
    | 'RSI'
    | 'SMA20'
    | 'SMA50'
    | 'SMA200'
    | 'EMA12'
    | 'EMA26'
    | 'MACD'
    | 'MACD_SIGNAL'
    | 'MACD_HISTOGRAM'
    | 'ADX'
    | 'ATR'
    | 'VWAP'
    | 'BB_UPPER'
    | 'BB_LOWER'
    | 'STOCH_K'
    | 'STOCH_D'
    | 'CCI'
    | 'MFI';
  operator: 'above' | 'below' | 'crosses_above' | 'crosses_below';
  value: number;
}

export interface TimeCondition {
  type: 'time';
  metric: 'days_held' | 'hours_held';
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  value: number;
}

export interface ProfitCondition {
  type: 'profit';
  metric: 'pnl_pct' | 'pnl_abs';
  operator: 'gt' | 'lt' | 'gte' | 'lte';
  value: number;
}

export interface VolumeCondition {
  type: 'volume';
  metric: 'current_volume' | 'volume_ratio';
  operator: 'gt' | 'lt' | 'gte' | 'lte';
  value: number;
}

export interface CompositeCondition {
  type: 'all' | 'any';
  conditions: ExitCondition[];
}

export type ExitCondition =
  | PriceCondition
  | IndicatorCondition
  | TimeCondition
  | ProfitCondition
  | VolumeCondition
  | CompositeCondition;

// ── Evaluation Context ───────────────────────────────────────────

export interface ExitContext {
  currentPrice: number;
  previousPrice?: number;
  entryPrice: number;
  pnlPct: number;
  pnlAbs: number;
  daysHeld: number;
  hoursHeld: number;
  indicators: Partial<Record<IndicatorCondition['indicator'], number>>;
  volume?: number;
  avgVolume?: number;
}

// ── Functions ────────────────────────────────────────────────────

export function evaluateExitCondition(condition: ExitCondition, context: ExitContext): boolean {
  switch (condition.type) {
    case 'price':
      return evaluatePrice(condition, context);
    case 'indicator':
      return evaluateIndicator(condition, context);
    case 'time':
      return evaluateTime(condition, context);
    case 'profit':
      return evaluateProfit(condition, context);
    case 'volume':
      return evaluateVolume(condition, context);
    case 'all':
      return condition.conditions.every((c) => evaluateExitCondition(c, context));
    case 'any':
      return condition.conditions.some((c) => evaluateExitCondition(c, context));
    default:
      log.warn({ condition }, 'Unknown condition type');
      return false;
  }
}

export function evaluateExitConditions(
  conditions: ExitCondition[],
  context: ExitContext,
): { shouldExit: boolean; triggeredConditions: string[] } {
  const triggered: string[] = [];
  for (const cond of conditions) {
    if (evaluateExitCondition(cond, context)) {
      triggered.push(formatExitCondition(cond));
    }
  }
  return { shouldExit: triggered.length > 0, triggeredConditions: triggered };
}

export function formatExitCondition(condition: ExitCondition): string {
  switch (condition.type) {
    case 'price':
      return `Price ${formatOperator(condition.operator)} $${condition.value.toFixed(2)}`;
    case 'indicator':
      return `${condition.indicator} ${formatOperator(condition.operator)} ${condition.value}`;
    case 'time':
      return `${formatTimeMetric(condition.metric)} ${formatComparisonOp(condition.operator)} ${condition.value}`;
    case 'profit': {
      const suffix = condition.metric === 'pnl_pct' ? '%' : '';
      const prefix = condition.metric === 'pnl_abs' ? '$' : '';
      return `P&L${condition.metric === 'pnl_pct' ? '%' : ''} ${formatComparisonOp(condition.operator)} ${prefix}${condition.value}${suffix}`;
    }
    case 'volume':
      return `${formatVolumeMetric(condition.metric)} ${formatComparisonOp(condition.operator)} ${condition.value}`;
    case 'all':
      return `ALL: [${condition.conditions.map(formatExitCondition).join(', ')}]`;
    case 'any':
      return `ANY: [${condition.conditions.map(formatExitCondition).join(', ')}]`;
    default:
      return 'Unknown condition';
  }
}

export function parseExitConditionText(text: string): ExitCondition[] {
  const normalized = text.trim();
  if (!normalized) return [];

  const andParts = splitOnAnd(normalized);
  if (andParts.length > 1) {
    const parsed = andParts.map(parseSingleCondition).filter(notNull);
    if (parsed.length > 1) return [{ type: 'all', conditions: parsed }];
    if (parsed.length === 1) return parsed;
    return [];
  }

  const orParts = splitOnOr(normalized);
  if (orParts.length > 1) {
    const parsed = orParts.map(parseSingleCondition).filter(notNull);
    if (parsed.length > 1) return [{ type: 'any', conditions: parsed }];
    if (parsed.length === 1) return parsed;
    return [];
  }

  const single = parseSingleCondition(normalized);
  return single ? [single] : [];
}

// ── Internal helpers ─────────────────────────────────────────────

function evaluatePrice(cond: PriceCondition, ctx: ExitContext): boolean {
  const price = ctx.currentPrice;
  switch (cond.operator) {
    case 'above':
      return price > cond.value;
    case 'below':
      return price < cond.value;
    case 'crosses_above':
      return (
        ctx.previousPrice !== undefined && ctx.previousPrice <= cond.value && price > cond.value
      );
    case 'crosses_below':
      return (
        ctx.previousPrice !== undefined && ctx.previousPrice >= cond.value && price < cond.value
      );
  }
}

function evaluateIndicator(cond: IndicatorCondition, ctx: ExitContext): boolean {
  const indicatorValue = ctx.indicators[cond.indicator];
  if (indicatorValue === undefined) {
    log.debug({ indicator: cond.indicator }, 'Indicator not available in context');
    return false;
  }
  switch (cond.operator) {
    case 'above':
      return indicatorValue > cond.value;
    case 'below':
      return indicatorValue < cond.value;
    case 'crosses_above':
      return indicatorValue > cond.value;
    case 'crosses_below':
      return indicatorValue < cond.value;
  }
}

function evaluateTime(cond: TimeCondition, ctx: ExitContext): boolean {
  const actual = cond.metric === 'days_held' ? ctx.daysHeld : ctx.hoursHeld;
  return compareValue(actual, cond.operator, cond.value);
}

function evaluateProfit(cond: ProfitCondition, ctx: ExitContext): boolean {
  const actual = cond.metric === 'pnl_pct' ? ctx.pnlPct : ctx.pnlAbs;
  return compareValue(actual, cond.operator, cond.value);
}

function evaluateVolume(cond: VolumeCondition, ctx: ExitContext): boolean {
  let actual: number | undefined;
  if (cond.metric === 'current_volume') {
    actual = ctx.volume;
  } else if (cond.metric === 'volume_ratio') {
    if (ctx.volume !== undefined && ctx.avgVolume !== undefined && ctx.avgVolume > 0) {
      actual = ctx.volume / ctx.avgVolume;
    }
  }
  if (actual === undefined) {
    log.debug({ metric: cond.metric }, 'Volume data not available in context');
    return false;
  }
  return compareValue(actual, cond.operator, cond.value);
}

function compareValue(actual: number, operator: string, target: number): boolean {
  switch (operator) {
    case 'gt':
    case 'above':
      return actual > target;
    case 'lt':
    case 'below':
      return actual < target;
    case 'gte':
      return actual >= target;
    case 'lte':
      return actual <= target;
    case 'eq':
      return actual === target;
    default:
      return false;
  }
}

function formatOperator(op: string): string {
  switch (op) {
    case 'crosses_above':
      return 'crosses above';
    case 'crosses_below':
      return 'crosses below';
    default:
      return op;
  }
}

function formatComparisonOp(op: string): string {
  switch (op) {
    case 'gt':
      return '>';
    case 'lt':
      return '<';
    case 'gte':
      return '>=';
    case 'lte':
      return '<=';
    case 'eq':
      return '=';
    default:
      return op;
  }
}

function formatTimeMetric(metric: string): string {
  switch (metric) {
    case 'days_held':
      return 'Days held';
    case 'hours_held':
      return 'Hours held';
    default:
      return metric;
  }
}

function formatVolumeMetric(metric: string): string {
  switch (metric) {
    case 'current_volume':
      return 'Volume';
    case 'volume_ratio':
      return 'Volume ratio';
    default:
      return metric;
  }
}

// ── Parsing helpers ──────────────────────────────────────────────

const INDICATOR_ALIASES: Record<string, IndicatorCondition['indicator']> = {
  rsi: 'RSI',
  sma20: 'SMA20',
  'sma-20': 'SMA20',
  '20-sma': 'SMA20',
  sma50: 'SMA50',
  'sma-50': 'SMA50',
  '50-sma': 'SMA50',
  sma200: 'SMA200',
  'sma-200': 'SMA200',
  '200-sma': 'SMA200',
  ema12: 'EMA12',
  'ema-12': 'EMA12',
  ema26: 'EMA26',
  'ema-26': 'EMA26',
  macd: 'MACD',
  macd_signal: 'MACD_SIGNAL',
  'macd signal': 'MACD_SIGNAL',
  macd_histogram: 'MACD_HISTOGRAM',
  'macd histogram': 'MACD_HISTOGRAM',
  adx: 'ADX',
  atr: 'ATR',
  vwap: 'VWAP',
  bb_upper: 'BB_UPPER',
  'bb upper': 'BB_UPPER',
  'bollinger upper': 'BB_UPPER',
  bb_lower: 'BB_LOWER',
  'bb lower': 'BB_LOWER',
  'bollinger lower': 'BB_LOWER',
  stoch_k: 'STOCH_K',
  'stochastic k': 'STOCH_K',
  stoch_d: 'STOCH_D',
  'stochastic d': 'STOCH_D',
  cci: 'CCI',
  mfi: 'MFI',
};

function resolveIndicator(raw: string): IndicatorCondition['indicator'] | null {
  const lower = raw.toLowerCase().trim();
  return INDICATOR_ALIASES[lower] ?? null;
}

function splitOnAnd(text: string): string[] {
  return text
    .split(/\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitOnOr(text: string): string[] {
  return text
    .split(/\s+or\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function notNull<T>(val: T | null): val is T {
  return val !== null;
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,%]/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseSingleCondition(text: string): ExitCondition | null {
  const lower = text.toLowerCase().trim();

  // "stop at $45"
  const stopMatch = lower.match(/^stop\s+at\s+\$?([\d.]+)$/);
  if (stopMatch) {
    const value = parseNumber(stopMatch[1]);
    if (value !== null) return { type: 'price', operator: 'below', value };
  }

  // "price above $150", "price below 50"
  const priceMatch = lower.match(
    /^price\s+(above|below|crosses?\s*above|crosses?\s*below)\s+\$?([\d.]+)$/,
  );
  if (priceMatch) {
    const op = extractPriceOperator(priceMatch[1]);
    const value = parseNumber(priceMatch[2]);
    if (op && value !== null) return { type: 'price', operator: op, value };
  }

  // "profit > 10%", "pnl > $500"
  const profitMatch = lower.match(/^(?:profit|pnl|p&l)(%?)\s*([><=]+)\s*\$?([\d.]+)(%?)$/);
  if (profitMatch) {
    const isPct = profitMatch[1] === '%' || profitMatch[4] === '%';
    const op = parseComparisonOperator(profitMatch[2]);
    const value = parseNumber(profitMatch[3]);
    if (op && value !== null) {
      return {
        type: 'profit',
        metric: isPct ? 'pnl_pct' : 'pnl_abs',
        operator: op as ProfitCondition['operator'],
        value,
      };
    }
  }

  // "hold for 30 days", "hold 30 days"
  const holdMatch = lower.match(/^hold\s+(?:for\s+)?([\d.]+)\s*(days?|hours?)$/);
  if (holdMatch) {
    const value = parseNumber(holdMatch[1]);
    const metric = holdMatch[2].startsWith('hour') ? 'hours_held' : 'days_held';
    if (value !== null) return { type: 'time', metric, operator: 'gt', value };
  }

  // "days held > 30", "hours held >= 48"
  const daysHeldMatch = lower.match(/^(days?\s*held|hours?\s*held)\s*([><=]+)\s*([\d.]+)$/);
  if (daysHeldMatch) {
    const metric = daysHeldMatch[1].startsWith('hour') ? 'hours_held' : 'days_held';
    const op = parseComparisonOperator(daysHeldMatch[2]);
    const value = parseNumber(daysHeldMatch[3]);
    if (op && value !== null) {
      return { type: 'time', metric, operator: op as TimeCondition['operator'], value };
    }
  }

  // "close above 200-SMA", "close above SMA200"
  const closeMatch = lower.match(
    /^close\s+(above|below|crosses?\s*above|crosses?\s*below)\s+(.+)$/,
  );
  if (closeMatch) {
    const indicator = resolveIndicator(closeMatch[2]);
    const op = extractPriceOperator(closeMatch[1]);
    if (indicator && op) {
      return { type: 'indicator', indicator, operator: op, value: 0 };
    }
  }

  // "volume > 1000000", "volume ratio > 2"
  const volumeMatch = lower.match(/^(volume\s*ratio|volume)\s*([><=]+)\s*([\d.]+)$/);
  if (volumeMatch) {
    const metric = volumeMatch[1].includes('ratio') ? 'volume_ratio' : 'current_volume';
    const op = parseComparisonOperator(volumeMatch[2]);
    const value = parseNumber(volumeMatch[3]);
    if (op && value !== null) {
      return {
        type: 'volume',
        metric: metric as VolumeCondition['metric'],
        operator: op as VolumeCondition['operator'],
        value,
      };
    }
  }

  // "RSI below 30", "ADX above 25"
  const indicatorMatch = lower.match(
    /^(.+?)\s+(above|below|crosses?\s*above|crosses?\s*below)\s+([\d.]+)$/,
  );
  if (indicatorMatch) {
    const indicator = resolveIndicator(indicatorMatch[1]);
    const op = extractPriceOperator(indicatorMatch[2]);
    const value = parseNumber(indicatorMatch[3]);
    if (indicator && op && value !== null) {
      return { type: 'indicator', indicator, operator: op, value };
    }
  }

  return null;
}

function extractPriceOperator(text: string): PriceCondition['operator'] | null {
  const lower = text.toLowerCase();
  if (/crosses?\s*above/.test(lower)) return 'crosses_above';
  if (/crosses?\s*below/.test(lower)) return 'crosses_below';
  if (/above/.test(lower)) return 'above';
  if (/below/.test(lower)) return 'below';
  return null;
}

function parseComparisonOperator(op: string): string | null {
  switch (op.trim()) {
    case '>':
      return 'gt';
    case '<':
      return 'lt';
    case '>=':
      return 'gte';
    case '<=':
      return 'lte';
    case '=':
    case '==':
      return 'eq';
    default:
      return null;
  }
}
