import {
  getNYSECloseMinutes,
  getNextTradingDay,
  isNYSEEarlyClose,
  isNYSEHoliday,
} from './holidays.js';

export type MarketStatus = 'open' | 'pre' | 'after' | 'closed';

export interface MarketTimes {
  currentTimeET: string;
  currentTimeUTC: string;
  marketStatus: MarketStatus;
  nextOpen: string;
  nextClose: string | null;
  countdownMinutes: number;
  isHoliday: boolean;
  isEarlyClose: boolean;
}

function getETTime(): Date {
  const now = new Date();
  const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  return new Date(etString);
}

function getETHours(): { hours: number; minutes: number; day: number } {
  const et = getETTime();
  return { hours: et.getHours(), minutes: et.getMinutes(), day: et.getDay() };
}

function timeInMinutes(hours: number, minutes: number): number {
  return hours * 60 + minutes;
}

export function isWeekday(): boolean {
  const { day } = getETHours();
  const etDate = getETTime();
  return day >= 1 && day <= 5 && !isNYSEHoliday(etDate);
}

export function isUSMarketOpen(): boolean {
  if (!isWeekday()) return false;
  const { hours, minutes } = getETHours();
  const t = timeInMinutes(hours, minutes);
  const etDate = getETTime();
  const closeMinutes = getNYSECloseMinutes(etDate);
  return t >= timeInMinutes(9, 30) && t < closeMinutes;
}

export function isPreMarket(): boolean {
  if (!isWeekday()) return false;
  const { hours, minutes } = getETHours();
  const t = timeInMinutes(hours, minutes);
  return t >= timeInMinutes(4, 0) && t < timeInMinutes(9, 30);
}

export function isAfterHours(): boolean {
  if (!isWeekday()) return false;
  const { hours, minutes } = getETHours();
  const t = timeInMinutes(hours, minutes);
  const etDate = getETTime();
  const closeMinutes = getNYSECloseMinutes(etDate);
  return t >= closeMinutes && t < timeInMinutes(20, 0);
}

export function getMarketStatus(): MarketStatus {
  if (isUSMarketOpen()) return 'open';
  if (isPreMarket()) return 'pre';
  if (isAfterHours()) return 'after';
  return 'closed';
}

export function getNextMarketOpen(): Date {
  const now = new Date();
  const et = getETTime();
  const { hours, minutes, day } = getETHours();
  const t = timeInMinutes(hours, minutes);

  let daysToAdd = 0;

  if (day === 0 || day === 6 || isNYSEHoliday(et)) {
    // Weekend or holiday: find next trading day
    const nextTrading = getNextTradingDay(et);
    const diffDays = Math.round(
      (nextTrading.getTime() - new Date(et.getFullYear(), et.getMonth(), et.getDate()).getTime()) /
        (24 * 60 * 60 * 1000),
    );
    daysToAdd = diffDays;
  } else if (t >= timeInMinutes(16, 0)) {
    // After market close: find next trading day
    const nextTrading = getNextTradingDay(et);
    const diffDays = Math.round(
      (nextTrading.getTime() - new Date(et.getFullYear(), et.getMonth(), et.getDate()).getTime()) /
        (24 * 60 * 60 * 1000),
    );
    daysToAdd = diffDays;
  }

  const etNext = new Date(et.getFullYear(), et.getMonth(), et.getDate() + daysToAdd, 9, 30, 0, 0);

  const diffMs = etNext.getTime() - et.getTime();
  return new Date(now.getTime() + diffMs);
}

export function getNextMarketClose(): Date | null {
  const now = new Date();
  const et = getETTime();
  const { hours, minutes } = getETHours();
  const t = timeInMinutes(hours, minutes);
  const closeMinutes = getNYSECloseMinutes(et);

  if (!isWeekday()) return null;

  // If market is currently open, close is today
  if (t >= timeInMinutes(9, 30) && t < closeMinutes) {
    const closeHour = Math.floor(closeMinutes / 60);
    const closeMin = closeMinutes % 60;
    const etClose = new Date(
      et.getFullYear(),
      et.getMonth(),
      et.getDate(),
      closeHour,
      closeMin,
      0,
      0,
    );
    const diffMs = etClose.getTime() - et.getTime();
    return new Date(now.getTime() + diffMs);
  }

  // If before market open, close is later today
  if (t < timeInMinutes(9, 30)) {
    const closeHour = Math.floor(closeMinutes / 60);
    const closeMin = closeMinutes % 60;
    const etClose = new Date(
      et.getFullYear(),
      et.getMonth(),
      et.getDate(),
      closeHour,
      closeMin,
      0,
      0,
    );
    const diffMs = etClose.getTime() - et.getTime();
    return new Date(now.getTime() + diffMs);
  }

  // After close, find next trading day's close
  const nextTrading = getNextTradingDay(et);
  const nextCloseMinutes = getNYSECloseMinutes(nextTrading);
  const closeHour = Math.floor(nextCloseMinutes / 60);
  const closeMin = nextCloseMinutes % 60;
  const etClose = new Date(
    nextTrading.getFullYear(),
    nextTrading.getMonth(),
    nextTrading.getDate(),
    closeHour,
    closeMin,
    0,
    0,
  );
  const diffMs = etClose.getTime() - et.getTime();
  return new Date(now.getTime() + diffMs);
}

export function getMarketTimes(): MarketTimes {
  const now = new Date();
  const et = getETTime();
  const status = getMarketStatus();
  const nextOpen = getNextMarketOpen();
  const nextClose = getNextMarketClose();

  let countdownMinutes: number;
  if (status === 'open' && nextClose) {
    countdownMinutes = Math.round((nextClose.getTime() - now.getTime()) / 60_000);
  } else {
    countdownMinutes = Math.round((nextOpen.getTime() - now.getTime()) / 60_000);
  }

  return {
    currentTimeET: et.toLocaleString('en-US', { timeZone: 'America/New_York' }),
    currentTimeUTC: now.toISOString(),
    marketStatus: status,
    nextOpen: nextOpen.toISOString(),
    nextClose: nextClose ? nextClose.toISOString() : null,
    countdownMinutes,
    isHoliday: isNYSEHoliday(et),
    isEarlyClose: isNYSEEarlyClose(et),
  };
}
