import { EventEmitter } from 'node:events';
import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';
import type { AlpacaStream } from './alpaca-stream.js';

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
  private alpacaStream: AlpacaStream | null = null;
  private alpacaStreamActive = false;

  setPositionProvider(fn: () => PositionForStreaming[]): void {
    this.getPositionsFn = fn;
  }

  setQuoteProvider(fn: (symbols: string[]) => Promise<Map<string, number>>): void {
    this.quoteFn = fn;
  }

  /** Attach an Alpaca WebSocket stream for real-time prices (instead of polling) */
  setAlpacaStream(stream: AlpacaStream): void {
    this.alpacaStream = stream;
  }

  start(): void {
    if (this.running) return;

    const enabled = configManager.get<boolean>('streaming.enabled');
    if (!enabled) {
      log.info('Price streaming disabled');
      return;
    }

    this.running = true;

    // Prefer Alpaca WebSocket streaming if configured
    let useAlpacaStream = false;
    try {
      useAlpacaStream = this.alpacaStream != null && configManager.get<boolean>('data.alpaca.streamEnabled');
    } catch {
      // config not available, use polling
    }

    if (useAlpacaStream && this.alpacaStream) {
      this.startAlpacaStream();
    } else {
      const intervalSeconds = configManager.get<number>('streaming.intervalSeconds');
      this.pollPrices();
      this.intervalHandle = setInterval(() => this.pollPrices(), intervalSeconds * 1000);
      log.info({ intervalSeconds }, 'Price streamer started (polling mode)');
    }
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.alpacaStreamActive && this.alpacaStream) {
      this.alpacaStream.disconnect();
      this.alpacaStreamActive = false;
    }
    this.running = false;
    this.lastPrices.clear();
    log.info('Price streamer stopped');
  }

  /** Update Alpaca stream subscriptions when positions change */
  updateStreamSubscriptions(): void {
    if (!this.alpacaStreamActive || !this.alpacaStream || !this.getPositionsFn) return;

    const positions = this.getPositionsFn();
    const currentSymbols = new Set(positions.map((p) => p.symbol));
    const subscribedSymbols = new Set(this.lastPrices.keys());

    // Subscribe to new symbols
    const toSubscribe = [...currentSymbols].filter((s) => !subscribedSymbols.has(s));
    if (toSubscribe.length > 0) {
      let maxSymbols = 30;
      try {
        maxSymbols = configManager.get<number>('data.alpaca.maxStreamSymbols');
      } catch {
        // use default
      }
      this.alpacaStream.subscribe(toSubscribe.slice(0, maxSymbols));
    }

    // Unsubscribe from symbols no longer held
    const toUnsubscribe = [...subscribedSymbols].filter((s) => !currentSymbols.has(s));
    if (toUnsubscribe.length > 0) {
      this.alpacaStream.unsubscribe(toUnsubscribe);
    }
  }

  private startAlpacaStream(): void {
    if (!this.alpacaStream || !this.getPositionsFn) return;

    this.alpacaStream.connect();
    this.alpacaStreamActive = true;

    this.alpacaStream.on('trade', (trade) => {
      if (!this.getPositionsFn) return;
      const positions = this.getPositionsFn();
      const pos = positions.find((p) => p.symbol === trade.symbol);
      if (!pos) return;

      const previousPrice =
        this.lastPrices.get(trade.symbol) ?? pos.currentPrice ?? pos.entryPrice;
      const changePct = previousPrice > 0 ? (trade.price - previousPrice) / previousPrice : 0;

      this.lastPrices.set(trade.symbol, trade.price);

      this.emit('price_update', {
        symbol: trade.symbol,
        price: trade.price,
        previousPrice,
        changePct,
        timestamp: trade.timestamp,
      });

      // Check stop levels
      if (pos.stopLossPrice != null && trade.price <= pos.stopLossPrice) {
        this.emit('stop_triggered', {
          symbol: trade.symbol,
          currentPrice: trade.price,
          stopPrice: pos.stopLossPrice,
          stopType: 'stop_loss',
        });
      }
      if (pos.trailingStop != null && trade.price <= pos.trailingStop) {
        this.emit('stop_triggered', {
          symbol: trade.symbol,
          currentPrice: trade.price,
          stopPrice: pos.trailingStop,
          stopType: 'trailing_stop',
        });
      }
      if (pos.takeProfitPrice != null && trade.price >= pos.takeProfitPrice) {
        this.emit('stop_triggered', {
          symbol: trade.symbol,
          currentPrice: trade.price,
          stopPrice: pos.takeProfitPrice,
          stopType: 'take_profit',
        });
      }
    });

    this.alpacaStream.on('connected', () => {
      this.updateStreamSubscriptions();
    });

    this.alpacaStream.on('error', (err) => {
      log.error({ err }, 'Alpaca stream error');
      this.emit('error', err);
    });

    log.info('Price streamer started (Alpaca WebSocket mode)');
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
