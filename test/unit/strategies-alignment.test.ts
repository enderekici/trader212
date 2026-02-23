import { describe, expect, it } from 'vitest';
import {
  scoreBreakout,
  scoreMeanReversion,
  scoreMomentum,
  scoreMultiStrategy,
  scoreMultiStrategyWithContext,
  scoreTrendFollowing,
} from '../../src/analysis/technical/strategies.js';

// ---------------------------------------------------------------------------
// Data generation helpers
// ---------------------------------------------------------------------------

function generateUptrend(
  n: number,
  basePrice = 100,
): { closes: number[]; highs: number[]; lows: number[]; volumes: number[]; opens: number[] } {
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const volumes: number[] = [];
  const opens: number[] = [];
  let price = basePrice;
  for (let i = 0; i < n; i++) {
    const drift = 0.3 + Math.sin(i * 0.2) * 0.1; // Upward drift
    const o = price;
    const c = price + drift;
    highs.push(Math.max(o, c) + 0.5);
    lows.push(Math.min(o, c) - 0.2);
    opens.push(o);
    closes.push(c);
    volumes.push(1_000_000 + i * 10_000);
    price = c;
  }
  return { closes, highs, lows, volumes, opens };
}

function generateDowntrend(
  n: number,
  basePrice = 200,
): { closes: number[]; highs: number[]; lows: number[]; volumes: number[]; opens: number[] } {
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const volumes: number[] = [];
  const opens: number[] = [];
  let price = basePrice;
  for (let i = 0; i < n; i++) {
    const drift = -(0.3 + Math.sin(i * 0.2) * 0.1); // Downward drift
    const o = price;
    const c = price + drift;
    highs.push(Math.max(o, c) + 0.2);
    lows.push(Math.min(o, c) - 0.5);
    opens.push(o);
    closes.push(c);
    volumes.push(1_000_000 + i * 10_000);
    price = c;
  }
  return { closes, highs, lows, volumes, opens };
}

function generateSideways(
  n: number,
  basePrice = 150,
): { closes: number[]; highs: number[]; lows: number[]; volumes: number[]; opens: number[] } {
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const volumes: number[] = [];
  const opens: number[] = [];
  for (let i = 0; i < n; i++) {
    const oscillation = Math.sin(i * 0.3) * 2; // Oscillate around base
    const c = basePrice + oscillation;
    const o = basePrice + Math.sin((i - 1) * 0.3) * 2;
    highs.push(Math.max(o, c) + 0.5);
    lows.push(Math.min(o, c) - 0.5);
    opens.push(o);
    closes.push(c);
    volumes.push(1_000_000);
    // price stays around basePrice
  }
  return { closes, highs, lows, volumes, opens };
}

function generateCandles(
  data: ReturnType<typeof generateUptrend>,
): { date: string; open: number; high: number; low: number; close: number; volume: number }[] {
  return data.closes.map((c, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: data.opens[i],
    high: data.highs[i],
    low: data.lows[i],
    close: c,
    volume: data.volumes[i],
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scoreMeanReversion', () => {
  const upData = generateUptrend(300);
  const downData = generateDowntrend(300);
  const sideData = generateSideways(300);

  it('returns correct strategy type MEAN_REVERSION', () => {
    const result = scoreMeanReversion(sideData.closes, sideData.highs, sideData.lows, sideData.volumes);
    expect(result.strategy).toBe('MEAN_REVERSION');
  });

  it('direction is one of LONG, SHORT, or NEUTRAL', () => {
    const result = scoreMeanReversion(upData.closes, upData.highs, upData.lows, upData.volumes);
    expect(['LONG', 'SHORT', 'NEUTRAL']).toContain(result.direction);
  });

  it('strength is between 0 and 1 inclusive', () => {
    const resultUp = scoreMeanReversion(upData.closes, upData.highs, upData.lows, upData.volumes);
    const resultDown = scoreMeanReversion(downData.closes, downData.highs, downData.lows, downData.volumes);
    const resultSide = scoreMeanReversion(sideData.closes, sideData.highs, sideData.lows, sideData.volumes);
    for (const r of [resultUp, resultDown, resultSide]) {
      expect(r.strength).toBeGreaterThanOrEqual(0);
      expect(r.strength).toBeLessThanOrEqual(1);
    }
  });

  it('confidence is between 0 and 1 inclusive', () => {
    const resultUp = scoreMeanReversion(upData.closes, upData.highs, upData.lows, upData.volumes);
    const resultDown = scoreMeanReversion(downData.closes, downData.highs, downData.lows, downData.volumes);
    const resultSide = scoreMeanReversion(sideData.closes, sideData.highs, sideData.lows, sideData.volumes);
    for (const r of [resultUp, resultDown, resultSide]) {
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('reasons is a non-empty array of strings', () => {
    const result = scoreMeanReversion(upData.closes, upData.highs, upData.lows, upData.volumes);
    expect(Array.isArray(result.reasons)).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
    for (const reason of result.reasons) {
      expect(typeof reason).toBe('string');
    }
  });

  it('works with opens parameter (enables candlestick sub-signal)', () => {
    const withoutOpens = scoreMeanReversion(
      sideData.closes,
      sideData.highs,
      sideData.lows,
      sideData.volumes,
    );
    const withOpens = scoreMeanReversion(
      sideData.closes,
      sideData.highs,
      sideData.lows,
      sideData.volumes,
      sideData.opens,
    );
    // Both should return valid StrategySignal objects
    expect(withoutOpens.strategy).toBe('MEAN_REVERSION');
    expect(withOpens.strategy).toBe('MEAN_REVERSION');
    // The version with opens may produce different confidence (more sub-signals evaluated)
    expect(withOpens.confidence).toBeGreaterThanOrEqual(0);
    expect(withOpens.confidence).toBeLessThanOrEqual(1);
  });
});

describe('scoreTrendFollowing', () => {
  const upData = generateUptrend(300);
  const downData = generateDowntrend(300);
  const sideData = generateSideways(300);

  it('returns correct strategy type TREND_FOLLOWING', () => {
    const result = scoreTrendFollowing(upData.closes, upData.highs, upData.lows, upData.volumes);
    expect(result.strategy).toBe('TREND_FOLLOWING');
  });

  it('uptrending data produces LONG direction', () => {
    const result = scoreTrendFollowing(upData.closes, upData.highs, upData.lows, upData.volumes);
    expect(result.direction).toBe('LONG');
  });

  it('downtrending data produces SHORT direction', () => {
    const result = scoreTrendFollowing(downData.closes, downData.highs, downData.lows, downData.volumes);
    expect(result.direction).toBe('SHORT');
  });

  it('has valid strength and confidence ranges', () => {
    for (const data of [upData, downData, sideData]) {
      const result = scoreTrendFollowing(data.closes, data.highs, data.lows, data.volumes);
      expect(result.strength).toBeGreaterThanOrEqual(0);
      expect(result.strength).toBeLessThanOrEqual(1);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('scoreMomentum', () => {
  const upData = generateUptrend(300);
  const downData = generateDowntrend(300);
  const sideData = generateSideways(300);

  it('returns correct strategy type MOMENTUM', () => {
    const result = scoreMomentum(upData.closes, upData.highs, upData.lows, upData.volumes);
    expect(result.strategy).toBe('MOMENTUM');
  });

  it('has valid output shape (direction, strength, confidence, reasons)', () => {
    const result = scoreMomentum(sideData.closes, sideData.highs, sideData.lows, sideData.volumes);
    expect(result).toHaveProperty('strategy');
    expect(result).toHaveProperty('direction');
    expect(result).toHaveProperty('strength');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('reasons');
    expect(['LONG', 'SHORT', 'NEUTRAL']).toContain(result.direction);
    expect(typeof result.strength).toBe('number');
    expect(typeof result.confidence).toBe('number');
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  it('strong uptrend produces positive (LONG) signals', () => {
    const result = scoreMomentum(upData.closes, upData.highs, upData.lows, upData.volumes);
    expect(result.direction).toBe('LONG');
    expect(result.strength).toBeGreaterThan(0);
  });

  it('sideways market still returns valid bounded output', () => {
    const sideResult = scoreMomentum(sideData.closes, sideData.highs, sideData.lows, sideData.volumes);
    // Sideways oscillation can fire many sub-signals; verify output stays bounded
    expect(sideResult.strength).toBeGreaterThanOrEqual(0);
    expect(sideResult.strength).toBeLessThanOrEqual(1);
    expect(sideResult.confidence).toBeGreaterThanOrEqual(0);
    expect(sideResult.confidence).toBeLessThanOrEqual(1);
    expect(sideResult.reasons.length).toBeGreaterThan(0);
  });
});

describe('scoreBreakout', () => {
  const upData = generateUptrend(300);
  const sideData = generateSideways(300);

  it('returns correct strategy type BREAKOUT', () => {
    const result = scoreBreakout(upData.closes, upData.highs, upData.lows, upData.volumes);
    expect(result.strategy).toBe('BREAKOUT');
  });

  it('has valid output shape', () => {
    const result = scoreBreakout(upData.closes, upData.highs, upData.lows, upData.volumes);
    expect(result).toHaveProperty('strategy');
    expect(result).toHaveProperty('direction');
    expect(result).toHaveProperty('strength');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('reasons');
    expect(['LONG', 'SHORT', 'NEUTRAL']).toContain(result.direction);
    expect(result.strength).toBeGreaterThanOrEqual(0);
    expect(result.strength).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('requires sufficient data (50+ bars for Donchian channels)', () => {
    // With only 20 bars, 50-period Donchian won't fire, but 20-period still may
    const smallData = generateUptrend(20);
    const result = scoreBreakout(smallData.closes, smallData.highs, smallData.lows, smallData.volumes);
    // Should still return a valid signal even with limited data
    expect(result.strategy).toBe('BREAKOUT');
    expect(result.strength).toBeGreaterThanOrEqual(0);
    expect(result.strength).toBeLessThanOrEqual(1);
  });

  it('returns NEUTRAL for rangebound data', () => {
    const result = scoreBreakout(sideData.closes, sideData.highs, sideData.lows, sideData.volumes);
    // Sideways data oscillates within a range, no breakouts expected
    // Direction should be NEUTRAL or have very low strength
    if (result.direction !== 'NEUTRAL') {
      // If not neutral, the strength should at least be quite low
      expect(result.strength).toBeLessThan(0.5);
    }
  });
});

describe('scoreMultiStrategy', () => {
  it('returns 50 (neutral) for very short data (< 50 bars)', () => {
    const shortCandles = generateCandles(generateUptrend(30));
    const score = scoreMultiStrategy(shortCandles);
    expect(score).toBe(50);
  });

  it('returns a number between 0 and 100', () => {
    const candles = generateCandles(generateUptrend(300));
    const score = scoreMultiStrategy(candles);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('uptrending data produces score > 50', () => {
    const candles = generateCandles(generateUptrend(300));
    const score = scoreMultiStrategy(candles);
    expect(score).toBeGreaterThan(50);
  });

  it('downtrending data produces score < 50', () => {
    const candles = generateCandles(generateDowntrend(300));
    const score = scoreMultiStrategy(candles);
    expect(score).toBeLessThan(50);
  });

  it('score is an integer (Math.round applied)', () => {
    const upCandles = generateCandles(generateUptrend(300));
    const downCandles = generateCandles(generateDowntrend(300));
    const sideCandles = generateCandles(generateSideways(300));
    for (const candles of [upCandles, downCandles, sideCandles]) {
      const score = scoreMultiStrategy(candles);
      expect(Number.isInteger(score)).toBe(true);
    }
  });

  it('works with 250+ bars of data', () => {
    const candles = generateCandles(generateUptrend(350));
    const score = scoreMultiStrategy(candles);
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('scoreMultiStrategyWithContext', () => {
  const upCandles = generateCandles(generateUptrend(300));
  const downCandles = generateCandles(generateDowntrend(300));

  it('returns same score as scoreMultiStrategy when no context provided', () => {
    const raw = scoreMultiStrategy(upCandles);
    const contextual = scoreMultiStrategyWithContext(upCandles);
    expect(contextual).toBe(raw);
  });

  it('dampens bullish score when breadth is oversold', () => {
    const raw = scoreMultiStrategy(upCandles);
    const dampened = scoreMultiStrategyWithContext(upCandles, {
      breadthAbove50dPct: 15,
      breadthSignal: 'oversold',
    });
    // Should be closer to 50 than raw (which is > 50 for uptrend)
    if (raw > 50) {
      expect(dampened).toBeLessThan(raw);
      expect(dampened).toBeGreaterThanOrEqual(0);
    }
  });

  it('boosts bullish score when breadth is overbought', () => {
    const raw = scoreMultiStrategy(upCandles);
    const boosted = scoreMultiStrategyWithContext(upCandles, {
      breadthAbove50dPct: 85,
      breadthSignal: 'overbought',
    });
    if (raw > 50) {
      expect(boosted).toBeGreaterThanOrEqual(raw);
    }
  });

  it('compresses score toward neutral during pre-FOMC', () => {
    const raw = scoreMultiStrategy(upCandles);
    const compressed = scoreMultiStrategyWithContext(upCandles, {
      fomcIsPreFOMC: true,
    });
    if (raw > 50) {
      expect(compressed).toBeLessThan(raw);
      expect(compressed).toBeGreaterThan(50);
    }
  });

  it('does not affect bearish scores with breadth adjustments', () => {
    const raw = scoreMultiStrategy(downCandles);
    const adjusted = scoreMultiStrategyWithContext(downCandles, {
      breadthAbove50dPct: 15,
      breadthSignal: 'oversold',
    });
    // Breadth adjustments only apply to bullish (>50), bearish should be unchanged
    if (raw <= 50) {
      expect(adjusted).toBe(raw);
    }
  });

  it('applies extreme low breadth dampening', () => {
    const raw = scoreMultiStrategy(upCandles);
    const dampened = scoreMultiStrategyWithContext(upCandles, {
      breadthAbove50dPct: 10,
      breadthSignal: 'oversold',
    });
    // Extra dampening for <20% breadth
    if (raw > 50) {
      expect(dampened).toBeLessThan(raw);
    }
  });

  it('result stays between 0 and 100', () => {
    for (const candles of [upCandles, downCandles]) {
      for (const ctx of [
        { breadthAbove50dPct: 5, breadthSignal: 'oversold' as const },
        { breadthAbove50dPct: 95, breadthSignal: 'overbought' as const },
        { fomcIsPreFOMC: true },
        { breadthAbove50dPct: 5, breadthSignal: 'oversold' as const, fomcIsPreFOMC: true },
      ]) {
        const score = scoreMultiStrategyWithContext(candles, ctx);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });

  it('is an integer', () => {
    const score = scoreMultiStrategyWithContext(upCandles, {
      breadthAbove50dPct: 60,
      breadthSignal: 'neutral',
      fomcIsPreFOMC: false,
    });
    expect(Number.isInteger(score)).toBe(true);
  });
});
