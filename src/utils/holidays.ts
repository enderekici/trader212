/**
 * NYSE holiday calendar. Used by market-hours to detect when markets are closed
 * even on weekdays.
 */

// Fixed and observed holidays for 2024-2028 (covers typical bot lifetime)
// Source: NYSE holiday schedule
const NYSE_HOLIDAYS: Record<number, string[]> = {
  2024: [
    '2024-01-01',
    '2024-01-15',
    '2024-02-19',
    '2024-03-29',
    '2024-05-27',
    '2024-06-19',
    '2024-07-04',
    '2024-09-02',
    '2024-11-28',
    '2024-12-25',
  ],
  2025: [
    '2025-01-01',
    '2025-01-20',
    '2025-02-17',
    '2025-04-18',
    '2025-05-26',
    '2025-06-19',
    '2025-07-04',
    '2025-09-01',
    '2025-11-27',
    '2025-12-25',
  ],
  2026: [
    '2026-01-01',
    '2026-01-19',
    '2026-02-16',
    '2026-04-03',
    '2026-05-25',
    '2026-06-19',
    '2026-07-03',
    '2026-09-07',
    '2026-11-26',
    '2026-12-25',
  ],
  2027: [
    '2027-01-01',
    '2027-01-18',
    '2027-02-15',
    '2027-03-26',
    '2027-05-31',
    '2027-06-18',
    '2027-07-05',
    '2027-09-06',
    '2027-11-25',
    '2027-12-24',
  ],
  2028: [
    '2028-01-17',
    '2028-02-21',
    '2028-04-14',
    '2028-05-29',
    '2028-06-19',
    '2028-07-04',
    '2028-09-04',
    '2028-11-23',
    '2028-12-25',
  ],
};

// Early close days (1:00 PM ET)
const NYSE_EARLY_CLOSE: Record<number, string[]> = {
  2024: ['2024-07-03', '2024-11-29', '2024-12-24'],
  2025: ['2025-07-03', '2025-11-28', '2025-12-24'],
  2026: ['2026-11-27', '2026-12-24'],
  2027: ['2027-11-26'],
  2028: ['2028-07-03', '2028-11-24'],
};

export function isNYSEHoliday(dateET: Date): boolean {
  const year = dateET.getFullYear();
  const dateStr = formatDate(dateET);
  const holidays = NYSE_HOLIDAYS[year];
  if (!holidays) return false;
  return holidays.includes(dateStr);
}

export function isNYSEEarlyClose(dateET: Date): boolean {
  const year = dateET.getFullYear();
  const dateStr = formatDate(dateET);
  const earlys = NYSE_EARLY_CLOSE[year];
  if (!earlys) return false;
  return earlys.includes(dateStr);
}

/** Get the NYSE close time in minutes from midnight (ET) */
export function getNYSECloseMinutes(dateET: Date): number {
  if (isNYSEEarlyClose(dateET)) return 13 * 60; // 1:00 PM ET
  return 16 * 60; // 4:00 PM ET
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getNextTradingDay(dateET: Date): Date {
  const next = new Date(dateET);
  do {
    next.setDate(next.getDate() + 1);
  } while (next.getDay() === 0 || next.getDay() === 6 || isNYSEHoliday(next));
  return next;
}
