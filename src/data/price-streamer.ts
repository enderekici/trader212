import { EventEmitter } from 'node:events';
import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('price-streamer');

export interface PriceUpdate {
  symbol: string;
  price: number;
  previousPrice: number;
  changePct: number;
  timestamp: string;
}

export interface StopTriggered {
  symbol: string;
  currentPrice: number;
  stopPrice: number;
  stopType: 'stop_loss' | 'trailing_stop' | 'take_profit';
}

export interface PositionForStreaming {
  symbol: string;
  entryPrice: number;
  stopLossPrice: number | null;
  trailingStop: number | null;
  takeProfitPrice: number | null;
  currentPrice: number | null;
}

export interface PriceStreamerEvents {
  price_update: [PriceUpdate];
  stop_triggered: [StopTriggered];
  error: [Error];
}

export class PriceStreamer extends EventEmitter<PriceStreamerEvents> {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastPrices = new Map<string, number>();
  private getPositionsFn: (() => PositionForStreaming[]) | null = null;
  private quoteFn: ((symbols: string[]) => Promise<Map<string, number>>) | null = null;
  private running = false;

  setPositionProvider(fn: () => PositionForStreaming[]): void {
    this.getPositionsFn = fn;
  }

  setQuoteProvider(fn: (symbols: string[]) => Promise<Map<string, number>>): void {
    this.quoteFn = fn;
  }

  start(): void {
    if (this.running) return;

    const enabled = configManager.get<boolean>('streaming.enabled');
    if (!enabled) {
      log.info('Price streaming disabled');
      return;
    }

    const intervalSeconds = configManager.get<number>('streaming.intervalSeconds');
    this.running = true;

    this.pollPrices();
    this.intervalHandle = setInterval(() => this.pollPrices(), intervalSeconds * 1000);
    log.info({ intervalSeconds }, 'Price streamer started');
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.running = false;
    this.lastPrices.clear();
    log.info('Price streamer stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private async pollPrices(): Promise<void> {
    if (!this.getPositionsFn || !this.quoteFn) return;

    try {
      const positions = this.getPositionsFn();
      if (positions.length === 0) return;

      const symbols = positions.map((p) => p.symbol);
      const quotes = await this.quoteFn(symbols);

      for (const pos of positions) {
        const price = quotes.get(pos.symbol);
        if (price === undefined) continue;

        const previousPrice = this.lastPrices.get(pos.symbol) ?? pos.currentPrice ?? pos.entryPrice;
        const changePct = previousPrice > 0 ? (price - previousPrice) / previousPrice : 0;

        this.lastPrices.set(pos.symbol, price);

        this.emit('price_update', {
          symbol: pos.symbol,
          price,
          previousPrice,
          changePct,
          timestamp: new Date().toISOString(),
        });

        if (pos.stopLossPrice != null && price <= pos.stopLossPrice) {
          this.emit('stop_triggered', {
            symbol: pos.symbol,
            currentPrice: price,
            stopPrice: pos.stopLossPrice,
            stopType: 'stop_loss',
          });
        }

        if (pos.trailingStop != null && price <= pos.trailingStop) {
          this.emit('stop_triggered', {
            symbol: pos.symbol,
            currentPrice: price,
            stopPrice: pos.trailingStop,
            stopType: 'trailing_stop',
          });
        }

        if (pos.takeProfitPrice != null && price >= pos.takeProfitPrice) {
          this.emit('stop_triggered', {
            symbol: pos.symbol,
            currentPrice: price,
            stopPrice: pos.takeProfitPrice,
            stopType: 'take_profit',
          });
        }
      }
    } catch (err) {
      log.error({ err }, 'Price poll failed');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }
}

let instance: PriceStreamer | null = null;

export function getPriceStreamer(): PriceStreamer {
  if (!instance) instance = new PriceStreamer();
  return instance;
}
