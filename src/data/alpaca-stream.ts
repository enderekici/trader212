import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { createLogger } from '../utils/logger.js';

const log = createLogger('alpaca-stream');

const IEX_STREAM_URL = 'wss://stream.data.alpaca.markets/v2/iex';
const SIP_STREAM_URL = 'wss://stream.data.alpaca.markets/v2/sip';

export interface AlpacaTradeEvent {
  symbol: string;
  price: number;
  size: number;
  timestamp: string;
}

export interface AlpacaQuoteEvent {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  timestamp: string;
}

export interface AlpacaBarEvent {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string;
}

export interface AlpacaStreamEvents {
  trade: [AlpacaTradeEvent];
  quote: [AlpacaQuoteEvent];
  bar: [AlpacaBarEvent];
  error: [Error];
  connected: [];
  disconnected: [];
}

const MAX_RECONNECT_DELAY = 30_000;

export class AlpacaStream extends EventEmitter<AlpacaStreamEvents> {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private apiSecret: string;
  private feed: 'iex' | 'sip';
  private reconnectDelay = 1000;
  private reconnecting = false;
  private intentionalClose = false;
  private subscribedSymbols = new Set<string>();
  private authenticated = false;

  constructor(feed: 'iex' | 'sip' = 'iex') {
    super();
    this.apiKey = process.env.ALPACA_API_KEY ?? '';
    this.apiSecret = process.env.ALPACA_API_SECRET ?? '';
    this.feed = feed;

    if (!this.apiKey || !this.apiSecret) {
      throw new Error(
        'ALPACA_API_KEY and ALPACA_API_SECRET environment variables are required',
      );
    }
  }

  /** Open WebSocket connection and authenticate */
  connect(): void {
    if (this.ws) {
      log.warn('Already connected or connecting');
      return;
    }

    this.intentionalClose = false;
    const url = this.feed === 'sip' ? SIP_STREAM_URL : IEX_STREAM_URL;

    log.info({ feed: this.feed, url }, 'Connecting to Alpaca stream');
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      log.info('WebSocket connected, authenticating...');
      this.send({
        action: 'auth',
        key: this.apiKey,
        secret: this.apiSecret,
      });
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const messages = JSON.parse(data.toString());
        if (Array.isArray(messages)) {
          for (const msg of messages) {
            this.handleMessage(msg);
          }
        }
      } catch (err) {
        log.error({ err }, 'Failed to parse WebSocket message');
      }
    });

    this.ws.on('close', (code, reason) => {
      log.info({ code, reason: reason.toString() }, 'WebSocket closed');
      this.authenticated = false;
      this.ws = null;
      this.emit('disconnected');

      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      log.error({ err }, 'WebSocket error');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });

    this.ws.on('pong', () => {
      log.debug('Received pong');
    });
  }

  /** Subscribe to trade, quote, and bar channels for the given symbols */
  subscribe(symbols: string[]): void {
    if (symbols.length === 0) return;

    for (const s of symbols) {
      this.subscribedSymbols.add(s);
    }

    if (this.authenticated && this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        action: 'subscribe',
        trades: symbols,
        quotes: symbols,
        bars: symbols,
      });
      log.info({ symbols, total: this.subscribedSymbols.size }, 'Subscribed to symbols');
    }
  }

  /** Unsubscribe from channels for the given symbols */
  unsubscribe(symbols: string[]): void {
    if (symbols.length === 0) return;

    for (const s of symbols) {
      this.subscribedSymbols.delete(s);
    }

    if (this.authenticated && this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        action: 'unsubscribe',
        trades: symbols,
        quotes: symbols,
        bars: symbols,
      });
      log.info({ symbols, remaining: this.subscribedSymbols.size }, 'Unsubscribed from symbols');
    }
  }

  /** Gracefully close the WebSocket connection */
  disconnect(): void {
    this.intentionalClose = true;
    this.authenticated = false;
    this.subscribedSymbols.clear();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    log.info('Alpaca stream disconnected');
  }

  /** Check if the stream is connected and authenticated */
  isConnected(): boolean {
    return this.authenticated && this.ws?.readyState === WebSocket.OPEN;
  }

  private handleMessage(msg: { T: string; [key: string]: unknown }): void {
    switch (msg.T) {
      case 'success':
        if (msg.msg === 'authenticated') {
          log.info('Authenticated successfully');
          this.authenticated = true;
          this.reconnectDelay = 1000; // reset backoff
          this.emit('connected');

          // Re-subscribe to any symbols we were tracking
          if (this.subscribedSymbols.size > 0) {
            const symbols = [...this.subscribedSymbols];
            this.send({
              action: 'subscribe',
              trades: symbols,
              quotes: symbols,
              bars: symbols,
            });
            log.info({ count: symbols.length }, 'Re-subscribed after reconnect');
          }
        } else if (msg.msg === 'connected') {
          log.debug('Initial connection message received');
        }
        break;

      case 'error':
        log.error({ code: msg.code, msg: msg.msg }, 'Stream error');
        this.emit('error', new Error(`Alpaca stream error: ${msg.msg} (code: ${msg.code})`));
        break;

      case 't': // trade
        this.emit('trade', {
          symbol: msg.S as string,
          price: msg.p as number,
          size: msg.s as number,
          timestamp: msg.t as string,
        });
        break;

      case 'q': // quote
        this.emit('quote', {
          symbol: msg.S as string,
          bidPrice: msg.bp as number,
          askPrice: msg.ap as number,
          bidSize: msg.bs as number,
          askSize: msg.as as number,
          timestamp: msg.t as string,
        });
        break;

      case 'b': // bar
        this.emit('bar', {
          symbol: msg.S as string,
          open: msg.o as number,
          high: msg.h as number,
          low: msg.l as number,
          close: msg.c as number,
          volume: msg.v as number,
          timestamp: msg.t as string,
        });
        break;

      default:
        log.debug({ type: msg.T }, 'Unhandled message type');
    }
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;

    log.info({ delayMs: this.reconnectDelay }, 'Scheduling reconnect');

    setTimeout(() => {
      this.reconnecting = false;
      if (!this.intentionalClose) {
        this.connect();
      }
    }, this.reconnectDelay);

    // Exponential backoff: 1s → 2s → 4s → ... → max 30s
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }
}
