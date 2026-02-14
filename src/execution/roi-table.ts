import { createLogger } from '../utils/logger.js';

const log = createLogger('roi-table');

export interface RoiTable {
  [minutesStr: string]: number;
}

/**
 * Parse ROI table from config JSON string.
 * Returns empty object on invalid input.
 */
export function parseRoiTable(json: string): RoiTable {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      log.warn({ json }, 'ROI table is not an object, using empty table');
      return {};
    }
    return parsed as RoiTable;
  } catch {
    log.warn({ json }, 'Failed to parse ROI table JSON, using empty table');
    return {};
  }
}

/**
 * Get the current ROI threshold for a given trade duration.
 * Finds the highest key <= tradeMinutes, returns that threshold.
 * Returns null if trade age is less than the smallest key or table is empty.
 */
export function getRoiThreshold(table: RoiTable, tradeMinutes: number): number | null {
  const keys = Object.keys(table)
    .map(Number)
    .filter((k) => !Number.isNaN(k))
    .sort((a, b) => a - b);

  if (keys.length === 0) return null;

  // If trade is younger than the smallest key, no ROI exit applies
  if (tradeMinutes < keys[0]) return null;

  // Find the largest key <= tradeMinutes
  let threshold: number | null = null;
  for (const key of keys) {
    if (key <= tradeMinutes) {
      threshold = table[String(key)];
    } else {
      break;
    }
  }

  return threshold;
}

/**
 * Check if a trade should exit based on ROI table.
 * Trade exits when current profit ratio >= threshold for its age.
 */
export function shouldExitByRoi(
  table: RoiTable,
  entryTime: string,
  currentProfitPct: number,
  now?: Date,
): { shouldExit: boolean; threshold: number | null; tradeMinutes: number } {
  const nowMs = (now ?? new Date()).getTime();
  const entryMs = new Date(entryTime).getTime();
  const tradeMinutes = (nowMs - entryMs) / 60000;

  const threshold = getRoiThreshold(table, tradeMinutes);

  if (threshold === null) {
    return { shouldExit: false, threshold: null, tradeMinutes };
  }

  return {
    shouldExit: currentProfitPct >= threshold,
    threshold,
    tradeMinutes,
  };
}
