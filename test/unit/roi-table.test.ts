import { describe, expect, it } from 'vitest';
import { getRoiThreshold, parseRoiTable, shouldExitByRoi } from '../../src/execution/roi-table.js';

describe('parseRoiTable', () => {
  it('parses valid JSON into an ROI table', () => {
    const json = '{"0": 0.06, "60": 0.04, "240": 0.02, "480": 0.01, "1440": 0.0}';
    const table = parseRoiTable(json);
    expect(table).toEqual({
      '0': 0.06,
      '60': 0.04,
      '240': 0.02,
      '480': 0.01,
      '1440': 0.0,
    });
  });

  it('returns empty object for empty JSON object', () => {
    const table = parseRoiTable('{}');
    expect(table).toEqual({});
  });

  it('returns empty object for single entry', () => {
    const table = parseRoiTable('{"0": 0.05}');
    expect(table).toEqual({ '0': 0.05 });
  });

  it('returns empty object for invalid JSON', () => {
    const table = parseRoiTable('not valid json{{{');
    expect(table).toEqual({});
  });

  it('returns empty object for JSON array', () => {
    const table = parseRoiTable('[1, 2, 3]');
    expect(table).toEqual({});
  });

  it('returns empty object for JSON null', () => {
    const table = parseRoiTable('null');
    expect(table).toEqual({});
  });

  it('returns empty object for JSON string', () => {
    const table = parseRoiTable('"hello"');
    expect(table).toEqual({});
  });

  it('returns empty object for JSON number', () => {
    const table = parseRoiTable('42');
    expect(table).toEqual({});
  });
});

describe('getRoiThreshold', () => {
  const defaultTable = {
    '0': 0.06,
    '60': 0.04,
    '240': 0.02,
    '480': 0.01,
    '1440': 0.0,
  };

  it('returns 0.06 for trade at 0 minutes', () => {
    expect(getRoiThreshold(defaultTable, 0)).toBe(0.06);
  });

  it('returns 0.06 for trade at 30 minutes (between 0 and 60)', () => {
    expect(getRoiThreshold(defaultTable, 30)).toBe(0.06);
  });

  it('returns 0.04 for trade at exactly 60 minutes', () => {
    expect(getRoiThreshold(defaultTable, 60)).toBe(0.04);
  });

  it('returns 0.04 for trade at 100 minutes (between 60 and 240)', () => {
    expect(getRoiThreshold(defaultTable, 100)).toBe(0.04);
  });

  it('returns 0.02 for trade at exactly 240 minutes', () => {
    expect(getRoiThreshold(defaultTable, 240)).toBe(0.02);
  });

  it('returns 0.01 for trade at exactly 480 minutes', () => {
    expect(getRoiThreshold(defaultTable, 480)).toBe(0.01);
  });

  it('returns 0.0 for trade at 1440 minutes', () => {
    expect(getRoiThreshold(defaultTable, 1440)).toBe(0.0);
  });

  it('returns 0.0 for trade at 5000 minutes (beyond all keys)', () => {
    expect(getRoiThreshold(defaultTable, 5000)).toBe(0.0);
  });

  it('returns null for empty table', () => {
    expect(getRoiThreshold({}, 100)).toBeNull();
  });

  it('returns null when trade is younger than smallest key', () => {
    const table = { '60': 0.04, '240': 0.02 };
    expect(getRoiThreshold(table, 30)).toBeNull();
  });

  it('handles single-entry table', () => {
    const table = { '0': 0.05 };
    expect(getRoiThreshold(table, 0)).toBe(0.05);
    expect(getRoiThreshold(table, 100)).toBe(0.05);
    expect(getRoiThreshold(table, 1000)).toBe(0.05);
  });

  it('handles single-entry table with non-zero key', () => {
    const table = { '120': 0.03 };
    expect(getRoiThreshold(table, 60)).toBeNull();
    expect(getRoiThreshold(table, 120)).toBe(0.03);
    expect(getRoiThreshold(table, 500)).toBe(0.03);
  });

  it('handles exact boundary at each key', () => {
    expect(getRoiThreshold(defaultTable, 0)).toBe(0.06);
    expect(getRoiThreshold(defaultTable, 60)).toBe(0.04);
    expect(getRoiThreshold(defaultTable, 240)).toBe(0.02);
    expect(getRoiThreshold(defaultTable, 480)).toBe(0.01);
    expect(getRoiThreshold(defaultTable, 1440)).toBe(0.0);
  });

  it('ignores NaN keys', () => {
    const table = { abc: 0.1, '60': 0.04 } as Record<string, number>;
    expect(getRoiThreshold(table, 30)).toBeNull();
    expect(getRoiThreshold(table, 60)).toBe(0.04);
  });
});

describe('shouldExitByRoi', () => {
  const defaultTable = {
    '0': 0.06,
    '60': 0.04,
    '240': 0.02,
    '480': 0.01,
    '1440': 0.0,
  };

  it('should exit when profit is above threshold', () => {
    // Trade entered 30 min ago, threshold is 0.06 (6%), profit is 7%
    const entryTime = new Date(Date.now() - 30 * 60000).toISOString();
    const result = shouldExitByRoi(defaultTable, entryTime, 0.07);
    expect(result.shouldExit).toBe(true);
    expect(result.threshold).toBe(0.06);
    expect(result.tradeMinutes).toBeCloseTo(30, 0);
  });

  it('should not exit when profit is below threshold', () => {
    // Trade entered 30 min ago, threshold is 0.06 (6%), profit is 3%
    const entryTime = new Date(Date.now() - 30 * 60000).toISOString();
    const result = shouldExitByRoi(defaultTable, entryTime, 0.03);
    expect(result.shouldExit).toBe(false);
    expect(result.threshold).toBe(0.06);
  });

  it('should exit when profit exactly equals threshold (>=)', () => {
    // Trade entered 100 min ago, threshold is 0.04, profit is exactly 0.04
    const entryTime = new Date(Date.now() - 100 * 60000).toISOString();
    const result = shouldExitByRoi(defaultTable, entryTime, 0.04);
    expect(result.shouldExit).toBe(true);
    expect(result.threshold).toBe(0.04);
  });

  it('should not exit for very young trade with no applicable threshold', () => {
    const table = { '60': 0.04, '240': 0.02 };
    const entryTime = new Date(Date.now() - 10 * 60000).toISOString();
    const result = shouldExitByRoi(table, entryTime, 0.10);
    expect(result.shouldExit).toBe(false);
    expect(result.threshold).toBeNull();
  });

  it('never exits with empty table', () => {
    const entryTime = new Date(Date.now() - 10000 * 60000).toISOString();
    const result = shouldExitByRoi({}, entryTime, 1.0);
    expect(result.shouldExit).toBe(false);
    expect(result.threshold).toBeNull();
  });

  it('should exit at breakeven (0%) for old trades when threshold is 0', () => {
    // Trade entered 1500 min ago, threshold is 0.0, profit is 0.001 (0.1%)
    const entryTime = new Date(Date.now() - 1500 * 60000).toISOString();
    const result = shouldExitByRoi(defaultTable, entryTime, 0.001);
    expect(result.shouldExit).toBe(true);
    expect(result.threshold).toBe(0.0);
  });

  it('should exit at exactly 0% when threshold is 0', () => {
    const entryTime = new Date(Date.now() - 1500 * 60000).toISOString();
    const result = shouldExitByRoi(defaultTable, entryTime, 0.0);
    expect(result.shouldExit).toBe(true);
    expect(result.threshold).toBe(0.0);
  });

  it('should not exit for negative profit even with 0 threshold', () => {
    const entryTime = new Date(Date.now() - 1500 * 60000).toISOString();
    const result = shouldExitByRoi(defaultTable, entryTime, -0.01);
    expect(result.shouldExit).toBe(false);
    expect(result.threshold).toBe(0.0);
  });

  it('uses custom now parameter for time calculation', () => {
    const entryTime = '2024-01-01T10:00:00Z';
    const now = new Date('2024-01-01T11:00:00Z'); // 60 minutes later
    const result = shouldExitByRoi(defaultTable, entryTime, 0.05, now);
    expect(result.tradeMinutes).toBeCloseTo(60, 0);
    expect(result.threshold).toBe(0.04);
    expect(result.shouldExit).toBe(true);
  });

  it('uses current time when now is not provided', () => {
    const entryTime = new Date(Date.now() - 120 * 60000).toISOString();
    const result = shouldExitByRoi(defaultTable, entryTime, 0.07);
    expect(result.tradeMinutes).toBeCloseTo(120, 0);
    expect(result.shouldExit).toBe(true);
  });

  it('calculates trade minutes correctly', () => {
    const now = new Date('2024-06-15T14:00:00Z');
    const entryTime = '2024-06-15T10:00:00Z'; // 4 hours = 240 minutes
    const result = shouldExitByRoi(defaultTable, entryTime, 0.03, now);
    expect(result.tradeMinutes).toBeCloseTo(240, 0);
    expect(result.threshold).toBe(0.02);
    expect(result.shouldExit).toBe(true); // 3% >= 2%
  });
});

describe('ROI table integration - position aging through thresholds', () => {
  const table = {
    '0': 0.06,
    '60': 0.04,
    '240': 0.02,
    '480': 0.01,
    '1440': 0.0,
  };

  const entryTime = '2024-01-01T00:00:00Z';

  it('simulates a position aging through all ROI thresholds', () => {
    // At 0 min: needs 6% profit
    const at0 = shouldExitByRoi(table, entryTime, 0.05, new Date('2024-01-01T00:00:00Z'));
    expect(at0.shouldExit).toBe(false); // 5% < 6%
    expect(at0.threshold).toBe(0.06);

    const at0_exit = shouldExitByRoi(table, entryTime, 0.06, new Date('2024-01-01T00:00:00Z'));
    expect(at0_exit.shouldExit).toBe(true); // 6% >= 6%

    // At 60 min: needs 4% profit
    const at60 = shouldExitByRoi(table, entryTime, 0.03, new Date('2024-01-01T01:00:00Z'));
    expect(at60.shouldExit).toBe(false); // 3% < 4%
    expect(at60.threshold).toBe(0.04);

    const at60_exit = shouldExitByRoi(table, entryTime, 0.04, new Date('2024-01-01T01:00:00Z'));
    expect(at60_exit.shouldExit).toBe(true); // 4% >= 4%

    // At 240 min (4h): needs 2% profit
    const at240 = shouldExitByRoi(table, entryTime, 0.015, new Date('2024-01-01T04:00:00Z'));
    expect(at240.shouldExit).toBe(false); // 1.5% < 2%
    expect(at240.threshold).toBe(0.02);

    const at240_exit = shouldExitByRoi(table, entryTime, 0.02, new Date('2024-01-01T04:00:00Z'));
    expect(at240_exit.shouldExit).toBe(true); // 2% >= 2%

    // At 480 min (8h): needs 1% profit
    const at480 = shouldExitByRoi(table, entryTime, 0.005, new Date('2024-01-01T08:00:00Z'));
    expect(at480.shouldExit).toBe(false); // 0.5% < 1%

    const at480_exit = shouldExitByRoi(table, entryTime, 0.01, new Date('2024-01-01T08:00:00Z'));
    expect(at480_exit.shouldExit).toBe(true); // 1% >= 1%

    // At 1440 min (24h): needs 0% profit (breakeven)
    const at1440 = shouldExitByRoi(table, entryTime, -0.001, new Date('2024-01-02T00:00:00Z'));
    expect(at1440.shouldExit).toBe(false); // -0.1% < 0%

    const at1440_exit = shouldExitByRoi(table, entryTime, 0.0, new Date('2024-01-02T00:00:00Z'));
    expect(at1440_exit.shouldExit).toBe(true); // 0% >= 0%
  });

  it('shows that the same profit amount triggers exit at different ages', () => {
    const profit = 0.03; // 3%

    // At 0 min: 3% < 6% -> no exit
    const early = shouldExitByRoi(table, entryTime, profit, new Date('2024-01-01T00:00:00Z'));
    expect(early.shouldExit).toBe(false);

    // At 60 min: 3% < 4% -> no exit
    const mid = shouldExitByRoi(table, entryTime, profit, new Date('2024-01-01T01:00:00Z'));
    expect(mid.shouldExit).toBe(false);

    // At 240 min: 3% >= 2% -> exit!
    const later = shouldExitByRoi(table, entryTime, profit, new Date('2024-01-01T04:00:00Z'));
    expect(later.shouldExit).toBe(true);
  });
});
