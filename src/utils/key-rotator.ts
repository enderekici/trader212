import { createLogger } from './logger.js';

const log = createLogger('key-rotator');

export class KeyRotator {
  private keys: string[];
  private currentIndex = 0;
  private callCounts: Map<string, { count: number; resetAt: number }> = new Map();
  private rateLimit: number;
  private ratePeriodMs: number;

  constructor(keys: string[], rateLimit: number, ratePeriodMs: number) {
    this.keys = keys.filter((k) => k.length > 0);
    this.rateLimit = rateLimit;
    this.ratePeriodMs = ratePeriodMs;

    if (this.keys.length === 0) {
      log.warn('No API keys provided for rotation');
    }
  }

  getKey(): string | null {
    if (this.keys.length === 0) return null;

    const now = Date.now();

    // Try to find a key that hasn't exhausted its rate limit
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      const key = this.keys[idx];
      const usage = this.callCounts.get(key);

      if (!usage || now > usage.resetAt) {
        this.callCounts.set(key, { count: 1, resetAt: now + this.ratePeriodMs });
        this.currentIndex = (idx + 1) % this.keys.length;
        return key;
      }

      if (usage.count < this.rateLimit) {
        usage.count++;
        this.currentIndex = (idx + 1) % this.keys.length;
        return key;
      }
    }

    // All keys exhausted, return current key (will hit rate limit)
    log.warn(
      { keyCount: this.keys.length, rateLimit: this.rateLimit },
      'All API keys at rate limit',
    );
    return this.keys[this.currentIndex];
  }

  getEffectiveRateLimit(): number {
    return this.rateLimit * Math.max(this.keys.length, 1);
  }

  getKeyCount(): number {
    return this.keys.length;
  }

  getUsageStats(): Array<{ keyIndex: number; calls: number; resetsIn: number }> {
    const now = Date.now();
    return this.keys.map((key, i) => {
      const usage = this.callCounts.get(key);
      return {
        keyIndex: i,
        calls: usage?.count ?? 0,
        resetsIn: usage ? Math.max(0, usage.resetAt - now) : 0,
      };
    });
  }
}

// Factory functions — single env var, comma-separated for multiple keys
export function createFinnhubRotator(): KeyRotator {
  const raw = process.env.FINNHUB_API_KEY ?? '';
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  // 60 calls/minute per key
  return new KeyRotator(keys, 60, 60_000);
}

export function createMarketauxRotator(): KeyRotator {
  const raw = process.env.MARKETAUX_API_TOKEN ?? '';
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  // 100 calls/day per key (86400000ms = 24h)
  return new KeyRotator(keys, 100, 86_400_000);
}
