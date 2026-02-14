import { createServer, type Server } from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../../../src/api/websocket.js';

let server: Server;
let wsManager: WebSocketManager;
let port: number;

function wsUrl(query = ''): string {
  return `ws://127.0.0.1:${port}/ws${query}`;
}

async function startServer(): Promise<void> {
  // Must create WebSocketManager AFTER setting env vars (verifyClient reads it at construction)
  server = createServer();
  wsManager = new WebSocketManager(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
}

async function stopServer(): Promise<void> {
  wsManager.close();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

beforeEach(() => {
  delete process.env.API_SECRET_KEY;
});

afterEach(async () => {
  await stopServer();
  delete process.env.API_SECRET_KEY;
});

describe('WebSocket auth', () => {
  it('rejects connection without token when API_SECRET_KEY is set', async () => {
    process.env.API_SECRET_KEY = 'test-secret-key';
    await startServer();

    const ws = new WebSocket(wsUrl());

    // The server sends HTTP 4401 (non-standard) which ws can't parse,
    // so we may get an error, unexpected-response, or close event
    const rejected = await new Promise<boolean>((resolve) => {
      ws.on('error', () => resolve(true));
      ws.on('close', () => resolve(true));
      ws.on('unexpected-response', () => resolve(true));
      ws.on('open', () => resolve(false));
    });

    expect(rejected).toBe(true);
    // Should never have connected
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });

  it('accepts connection with valid token query parameter', async () => {
    process.env.API_SECRET_KEY = 'test-secret-key';
    await startServer();

    const ws = new WebSocket(wsUrl('?token=test-secret-key'));

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
      ws.on('unexpected-response', () => reject(new Error('Rejected')));
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('allows all connections when API_SECRET_KEY is not set', async () => {
    // API_SECRET_KEY is already deleted in beforeEach
    await startServer();

    const ws = new WebSocket(wsUrl());

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
      ws.on('unexpected-response', () => reject(new Error('Rejected')));
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
