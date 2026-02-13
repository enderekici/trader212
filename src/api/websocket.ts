import type { Server } from 'node:http';
import { URL } from 'node:url';
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
    this.wss = new WebSocketServer({
      server,
      path: '/ws',
      verifyClient: (info, callback) => {
        const apiKey = process.env.API_SECRET_KEY?.trim();
        if (!apiKey) {
          // No key configured — auth disabled, allow all connections
          callback(true);
          return;
        }

        // Extract token from query parameter ?token=<key>
        let token: string | null = null;
        try {
          const url = new URL(info.req.url ?? '', `http://${info.req.headers.host ?? 'localhost'}`);
          token = url.searchParams.get('token');
        } catch {
          // URL parsing failed
        }

        if (!token || token.trim() !== apiKey) {
          log.warn(
            { ip: info.req.socket.remoteAddress },
            'WebSocket connection rejected — unauthorized',
          );
          callback(false, 4401, 'Unauthorized');
          return;
        }

        callback(true);
      },
    });

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
