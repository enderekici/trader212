import type { Server } from 'node:http';
import { type WebSocket, WebSocketServer } from 'ws';
import { createLogger } from '../utils/logger.js';

const log = createLogger('websocket');

export type WSEvent =
  | 'price_update'
  | 'trade_executed'
  | 'signal_generated'
  | 'pairlist_updated'
  | 'bot_status'
  | 'config_changed'
  | 'position_update'
  | 'alert'
  | 'trade_plan_created'
  | 'research_completed';

export class WebSocketManager {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      log.info({ clientCount: this.clients.size }, 'WebSocket client connected');

      ws.on('close', () => {
        this.clients.delete(ws);
        log.debug({ clientCount: this.clients.size }, 'WebSocket client disconnected');
      });

      ws.on('error', (err) => {
        log.error({ err }, 'WebSocket error');
        this.clients.delete(ws);
      });
    });
  }

  broadcast(event: WSEvent, data: unknown): void {
    const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }

  close(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.wss.close();
  }

  getClientCount(): number {
    return this.clients.size;
  }
}
