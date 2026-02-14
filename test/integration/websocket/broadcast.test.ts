import { createServer, type Server } from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../../../src/api/websocket.js';

let server: Server;
let wsManager: WebSocketManager;
let port: number;

function wsUrl(path = '/ws'): string {
  return `ws://127.0.0.1:${port}${path}`;
}

function connectClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl());
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.on('message', (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

beforeEach(async () => {
  // Remove API_SECRET_KEY so auth is disabled
  delete process.env.API_SECRET_KEY;

  server = createServer();
  wsManager = new WebSocketManager(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterEach(async () => {
  wsManager.close();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('WebSocket broadcast', () => {
  it('sends broadcast to a single connected client', async () => {
    const client = await connectClient();
    const msgPromise = waitForMessage(client);

    wsManager.broadcast('trade_executed', { symbol: 'AAPL', price: 150 });

    const msg = await msgPromise;
    expect(msg.event).toBe('trade_executed');
    expect(msg.data).toEqual({ symbol: 'AAPL', price: 150 });
    expect(msg.timestamp).toBeDefined();

    client.close();
  });

  it('sends broadcast to multiple connected clients', async () => {
    const client1 = await connectClient();
    const client2 = await connectClient();

    const msg1 = waitForMessage(client1);
    const msg2 = waitForMessage(client2);

    wsManager.broadcast('signal_generated', { symbol: 'MSFT' });

    const [result1, result2] = await Promise.all([msg1, msg2]);
    expect(result1.event).toBe('signal_generated');
    expect(result2.event).toBe('signal_generated');
    expect(result1.data).toEqual({ symbol: 'MSFT' });
    expect(result2.data).toEqual({ symbol: 'MSFT' });

    client1.close();
    client2.close();
  });

  it('tracks client count on connect and disconnect', async () => {
    expect(wsManager.getClientCount()).toBe(0);

    const client1 = await connectClient();
    expect(wsManager.getClientCount()).toBe(1);

    const client2 = await connectClient();
    expect(wsManager.getClientCount()).toBe(2);

    client1.close();
    // Wait for close event to propagate
    await new Promise((r) => setTimeout(r, 100));
    expect(wsManager.getClientCount()).toBe(1);

    client2.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(wsManager.getClientCount()).toBe(0);
  });

  it('includes ISO 8601 timestamp in broadcast messages', async () => {
    const client = await connectClient();
    const msgPromise = waitForMessage(client);

    wsManager.broadcast('bot_status', { status: 'running' });

    const msg = await msgPromise;
    // Verify it's a valid ISO timestamp
    const ts = new Date(msg.timestamp as string);
    expect(ts.getTime()).not.toBeNaN();

    client.close();
  });

  it('does not throw when broadcasting with no clients', () => {
    expect(wsManager.getClientCount()).toBe(0);
    expect(() => {
      wsManager.broadcast('price_update', { symbol: 'TSLA', price: 200 });
    }).not.toThrow();
  });
});
