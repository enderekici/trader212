/**
 * FOMC meeting date calendar and proximity detection.
 * Used to detect when the market is near an FOMC decision day,
 * which typically causes elevated volatility.
 */

// FOMC meeting dates 2024-2028 (last day of each 2-day meeting)
// Source: Federal Reserve FOMC calendar
const FOMC_DATES: string[] = [
  // 2024
  '2024-01-31',
  '2024-03-20',
  '2024-05-01',
  '2024-06-12',
  '2024-07-31',
  '2024-09-18',
  '2024-11-07',
  '2024-12-18',
  // 2025
  '2025-01-29',
  '2025-03-19',
  '2025-05-07',
  '2025-06-18',
  '2025-07-30',
  '2025-09-17',
  '2025-11-05',
  '2025-12-17',
  // 2026
  '2026-01-28',
  '2026-03-18',
  '2026-04-29',
  '2026-06-17',
  '2026-07-29',
  '2026-09-16',
  '2026-11-04',
  '2026-12-16',
  // 2027
  '2027-01-27',
  '2027-03-17',
  '2027-04-28',
  '2027-06-16',
  '2027-07-28',
  '2027-09-22',
  '2027-11-03',
  '2027-12-15',
  // 2028
  '2028-02-02',
  '2028-03-22',
  '2028-05-03',
  '2028-06-14',
  '2028-07-26',
  '2028-09-20',
  '2028-11-01',
  '2028-12-13',
];

export interface FOMCProximity {
  /** Calendar days until the next FOMC meeting (0 on the meeting day itself) */
  daysToNext: number;
  /** True when within the T-1 / T / T+1 window around a meeting */
  isPreFOMC: boolean;
  /** True when the date is an FOMC meeting day */
  isFOMCDay: boolean;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseFOMCDate(s: string): Date {
  // s is always 'YYYY-MM-DD'
  return new Date(
    Number.parseInt(s.slice(0, 4), 10),
    Number.parseInt(s.slice(5, 7), 10) - 1,
    Number.parseInt(s.slice(8, 10), 10),
  );
}

function diffDays(a: Date, b: Date): number {
  const msPerDay = 86_400_000;
  // Strip time components by using UTC date-only values
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / msPerDay);
}

/**
 * Returns FOMC proximity information for a given date.
 * Pre-FOMC window = T-1, T, T+1 (day before, day of, and day after the meeting).
 */
export function getFOMCProximity(date?: Date): FOMCProximity {
  const d = date ?? new Date();
  const dateStr = formatDate(d);

  const isFOMCDay = FOMC_DATES.includes(dateStr);

  // Find the next FOMC date on or after today
  let daysToNext = Number.MAX_SAFE_INTEGER;
  for (const fomcStr of FOMC_DATES) {
    if (fomcStr < dateStr) continue;
    daysToNext = diffDays(d, parseFOMCDate(fomcStr));
    break;
  }

  // Check if we are within T-1 / T / T+1 of any meeting
  let isPreFOMC = false;
  for (const fomcStr of FOMC_DATES) {
    const diff = Math.abs(diffDays(d, parseFOMCDate(fomcStr)));
    if (diff <= 1) {
      isPreFOMC = true;
      break;
    }
  }

  return { daysToNext, isPreFOMC, isFOMCDay };
}
