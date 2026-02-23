#!/usr/bin/env tsx
/**
 * Fetch historical OHLCV data for ALL Trading212 US equities back to 2018.
 *
 * Usage:
 *   npx tsx scripts/fetch-t212-universe.ts [--concurrency 5] [--from 2018-01-01] [--force]
 *
 * - Fetches the full T212 instrument list via API
 * - Filters to _US_EQ instruments
 * - Fetches Yahoo Finance daily candles from --from to today
 * - Saves to data/backtest_cache/{SYMBOL}.json
 * - Skips symbols already cached with data covering the target start date (unless --force)
 * - Retries with exponential backoff on rate limits
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const CACHE_DIR = './data/backtest_cache';
const YF_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
};

// ---------- CLI args ----------
const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const CONCURRENCY = Number(getArg('concurrency', '5'));
const FROM_DATE = getArg('from', '2018-01-01');
const FORCE = args.includes('--force');

// ---------- T212 instrument fetch ----------
interface T212Instrument {
  ticker: string;
  name: string;
  shortName?: string;
  type?: string;
}

async function fetchT212Symbols(): Promise<string[]> {
  const key = process.env.TRADING212_API_KEY ?? '';
  if (!key) {
    console.error('TRADING212_API_KEY not set in .env');
    process.exit(1);
  }
  const raw = key.includes(':') ? key : `${key}:`;
  const creds = Buffer.from(raw).toString('base64');

  const res = await fetch('https://demo.trading212.com/api/v0/equity/metadata/instruments', {
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    console.error(`T212 API error: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const instruments: T212Instrument[] = await res.json();
  const usEquities = instruments
    .filter((i) => i.ticker.endsWith('_US_EQ'))
    .map((i) => i.ticker.replace(/_US_EQ$/, ''));

  console.log(`Found ${usEquities.length} US equities on Trading212`);
  return usEquities.sort();
}

// ---------- Yahoo Finance fetch ----------
interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchYahooCandles(
  symbol: string,
  fromDate: string,
  retries = 3,
): Promise<Candle[] | null> {
  const period1 = Math.floor(new Date(fromDate).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const url = `${YF_CHART_URL}/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`;
      const res = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(20_000) });

      if (res.status === 429) {
        const wait = 2 ** (attempt + 2) * 1000; // 4s, 8s, 16s
        console.warn(`  [${symbol}] Rate limited, waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        if (res.status === 404 || res.status === 400) {
          // Symbol not available on Yahoo Finance
          return null;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result?.timestamp || !result?.indicators?.quote?.[0]) {
        return null;
      }

      const timestamps: number[] = result.timestamp;
      const quote = result.indicators.quote[0];
      const candles: Candle[] = [];

      for (let i = 0; i < timestamps.length; i++) {
        const o = quote.open?.[i];
        const h = quote.high?.[i];
        const l = quote.low?.[i];
        const c = quote.close?.[i];
        const v = quote.volume?.[i];
        if (o == null || c == null) continue;

        candles.push({
          date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
          open: o,
          high: h ?? o,
          low: l ?? o,
          close: c,
          volume: v ?? 0,
        });
      }

      return candles;
    } catch (err: unknown) {
      if (attempt < retries) {
        const wait = 2 ** (attempt + 1) * 1000;
        await sleep(wait);
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${symbol}] Failed after ${retries + 1} attempts: ${msg}`);
      return null;
    }
  }
  return null;
}

// ---------- Cache helpers ----------
function isCacheFresh(symbol: string, targetStart: string): boolean {
  const cacheFile = path.join(CACHE_DIR, `${symbol}.json`);
  if (!fs.existsSync(cacheFile)) return false;

  try {
    const raw = fs.readFileSync(cacheFile, 'utf-8');
    const candles: Candle[] = JSON.parse(raw);
    if (candles.length === 0) return false;

    // Check if first candle date is on or before target start
    // Allow 1 week slack for market holidays at year start
    const firstDate = new Date(candles[0].date);
    const target = new Date(targetStart);
    target.setDate(target.getDate() + 7); // 7 day slack
    return firstDate <= target;
  } catch {
    return false;
  }
}

function saveCache(symbol: string, candles: Candle[]): void {
  const cacheFile = path.join(CACHE_DIR, `${symbol}.json`);
  fs.writeFileSync(cacheFile, JSON.stringify(candles));
}

// ---------- Concurrency pool ----------
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processWithPool(
  symbols: string[],
  concurrency: number,
  fn: (symbol: string, idx: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const total = symbols.length;

  async function next(): Promise<void> {
    while (cursor < total) {
      const idx = cursor++;
      await fn(symbols[idx], idx);
      // Small delay between requests per worker to avoid burst
      await sleep(200);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => next());
  await Promise.all(workers);
}

// ---------- Main ----------
async function main(): Promise<void> {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  console.log(`Fetching T212 US equity universe...`);
  const symbols = await fetchT212Symbols();

  // Determine which symbols need fetching
  const toFetch: string[] = [];
  const skipped: string[] = [];

  for (const symbol of symbols) {
    if (!FORCE && isCacheFresh(symbol, FROM_DATE)) {
      skipped.push(symbol);
    } else {
      toFetch.push(symbol);
    }
  }

  console.log(`\nCache status:`);
  console.log(`  Already cached (back to ${FROM_DATE}): ${skipped.length}`);
  console.log(`  Need to fetch: ${toFetch.length}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Date range: ${FROM_DATE} → today\n`);

  if (toFetch.length === 0) {
    console.log('Nothing to fetch — all symbols already cached!');
    return;
  }

  let fetched = 0;
  let failed = 0;
  let noData = 0;
  const startTime = Date.now();

  // Save symbol list for reference
  const symbolListFile = path.join(CACHE_DIR, '_t212_symbols.json');
  fs.writeFileSync(symbolListFile, JSON.stringify(symbols, null, 2));
  console.log(`Saved symbol list to ${symbolListFile}\n`);

  await processWithPool(toFetch, CONCURRENCY, async (symbol, idx) => {
    const candles = await fetchYahooCandles(symbol, FROM_DATE);

    if (candles && candles.length > 0) {
      saveCache(symbol, candles);
      fetched++;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (fetched / ((Date.now() - startTime) / 1000)).toFixed(1);
      const pct = (((idx + 1) / toFetch.length) * 100).toFixed(1);
      console.log(
        `  ✓ ${symbol}: ${candles.length} candles (${candles[0].date} → ${candles[candles.length - 1].date}) [${pct}% | ${rate}/s | ${elapsed}s]`,
      );
    } else if (candles !== null) {
      noData++;
      console.log(`  - ${symbol}: no data`);
    } else {
      failed++;
      console.log(`  ✗ ${symbol}: failed`);
    }
  });

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Done in ${totalTime}s ===`);
  console.log(`  Fetched: ${fetched}`);
  console.log(`  No data: ${noData}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Skipped: ${skipped.length}`);
  console.log(`  Total cached: ${fetched + skipped.length}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
