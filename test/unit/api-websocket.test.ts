import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Create a mock WebSocketServer that emits events
class MockWebSocketServer extends EventEmitter {
  close = vi.fn();
}

let mockWssInstance: MockWebSocketServer;
let capturedOptions: any;

vi.mock('ws', () => {
  return {
    WebSocketServer: vi.fn().mockImplementation(function (opts: any) {
      capturedOptions = opts;
      mockWssInstance = new MockWebSocketServer();
      return mockWssInstance;
    }),
  };
});

describe('api/websocket', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.API_SECRET_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('WebSocketManager', () => {
    it('creates a WebSocketServer with the correct path', async () => {
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      const { WebSocketServer } = await import('ws');
      const mockServer = {} as any;

      new WebSocketManager(mockServer);

      expect(WebSocketServer).toHaveBeenCalledWith(
        expect.objectContaining({ server: mockServer, path: '/ws' }),
      );
    });

    it('tracks connected clients', async () => {
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      const mockServer = {} as any;
      const wsManager = new WebSocketManager(mockServer);

      // Simulate client connection
      const mockClient = new EventEmitter() as any;
      mockClient.readyState = 1;
      mockClient.send = vi.fn();
      mockClient.close = vi.fn();

      mockWssInstance.emit('connection', mockClient);

      expect(wsManager.getClientCount()).toBe(1);
    });

    it('removes client on close', async () => {
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      const mockServer = {} as any;
      const wsManager = new WebSocketManager(mockServer);

      const mockClient = new EventEmitter() as any;
      mockClient.readyState = 1;
      mockClient.send = vi.fn();
      mockClient.close = vi.fn();

      mockWssInstance.emit('connection', mockClient);
      expect(wsManager.getClientCount()).toBe(1);

      mockClient.emit('close');
      expect(wsManager.getClientCount()).toBe(0);
    });

    it('removes client on error', async () => {
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      const mockServer = {} as any;
      const wsManager = new WebSocketManager(mockServer);

      const mockClient = new EventEmitter() as any;
      mockClient.readyState = 1;
      mockClient.send = vi.fn();
      mockClient.close = vi.fn();

      mockWssInstance.emit('connection', mockClient);
      expect(wsManager.getClientCount()).toBe(1);

      mockClient.emit('error', new Error('connection error'));
      expect(wsManager.getClientCount()).toBe(0);
    });

    it('broadcasts messages to all open clients', async () => {
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      const mockServer = {} as any;
      const wsManager = new WebSocketManager(mockServer);

      const client1 = new EventEmitter() as any;
      client1.readyState = 1; // OPEN
      client1.send = vi.fn();
      client1.close = vi.fn();

      const client2 = new EventEmitter() as any;
      client2.readyState = 1; // OPEN
      client2.send = vi.fn();
      client2.close = vi.fn();

      mockWssInstance.emit('connection', client1);
      mockWssInstance.emit('connection', client2);

      wsManager.broadcast('price_update', { symbol: 'AAPL', price: 150 });

      expect(client1.send).toHaveBeenCalledTimes(1);
      expect(client2.send).toHaveBeenCalledTimes(1);

      const sent1 = JSON.parse(client1.send.mock.calls[0][0]);
      expect(sent1.event).toBe('price_update');
      expect(sent1.data).toEqual({ symbol: 'AAPL', price: 150 });
      expect(sent1.timestamp).toBeDefined();
    });

    it('skips clients that are not in OPEN state', async () => {
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      const mockServer = {} as any;
      const wsManager = new WebSocketManager(mockServer);

      const openClient = new EventEmitter() as any;
      openClient.readyState = 1; // OPEN
      openClient.send = vi.fn();
      openClient.close = vi.fn();

      const closingClient = new EventEmitter() as any;
      closingClient.readyState = 2; // CLOSING
      closingClient.send = vi.fn();
      closingClient.close = vi.fn();

      mockWssInstance.emit('connection', openClient);
      mockWssInstance.emit('connection', closingClient);

      wsManager.broadcast('bot_status', { status: 'running' });

      expect(openClient.send).toHaveBeenCalledTimes(1);
      expect(closingClient.send).not.toHaveBeenCalled();
    });

    it('close method closes all clients and the server', async () => {
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      const mockServer = {} as any;
      const wsManager = new WebSocketManager(mockServer);

      const client1 = new EventEmitter() as any;
      client1.readyState = 1;
      client1.send = vi.fn();
      client1.close = vi.fn();

      const client2 = new EventEmitter() as any;
      client2.readyState = 1;
      client2.send = vi.fn();
      client2.close = vi.fn();

      mockWssInstance.emit('connection', client1);
      mockWssInstance.emit('connection', client2);

      wsManager.close();

      expect(client1.close).toHaveBeenCalled();
      expect(client2.close).toHaveBeenCalled();
      expect(mockWssInstance.close).toHaveBeenCalled();
    });

    it('getClientCount returns 0 when no clients connected', async () => {
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      const mockServer = {} as any;
      const wsManager = new WebSocketManager(mockServer);

      expect(wsManager.getClientCount()).toBe(0);
    });

    it('handles multiple client connections and disconnections', async () => {
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      const mockServer = {} as any;
      const wsManager = new WebSocketManager(mockServer);

      const clients: any[] = [];
      for (let i = 0; i < 5; i++) {
        const client = new EventEmitter() as any;
        client.readyState = 1;
        client.send = vi.fn();
        client.close = vi.fn();
        clients.push(client);
        mockWssInstance.emit('connection', client);
      }

      expect(wsManager.getClientCount()).toBe(5);

      // Disconnect 3 clients
      clients[0].emit('close');
      clients[2].emit('close');
      clients[4].emit('error', new Error('err'));

      expect(wsManager.getClientCount()).toBe(2);
    });

    it('broadcasts different event types', async () => {
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      const mockServer = {} as any;
      const wsManager = new WebSocketManager(mockServer);

      const client = new EventEmitter() as any;
      client.readyState = 1;
      client.send = vi.fn();
      client.close = vi.fn();

      mockWssInstance.emit('connection', client);

      wsManager.broadcast('trade_executed', { id: 1 });
      wsManager.broadcast('signal_generated', { symbol: 'AAPL' });
      wsManager.broadcast('alert', { message: 'test' });

      expect(client.send).toHaveBeenCalledTimes(3);

      const msg1 = JSON.parse(client.send.mock.calls[0][0]);
      const msg2 = JSON.parse(client.send.mock.calls[1][0]);
      const msg3 = JSON.parse(client.send.mock.calls[2][0]);

      expect(msg1.event).toBe('trade_executed');
      expect(msg2.event).toBe('signal_generated');
      expect(msg3.event).toBe('alert');
    });
  });

  describe('WebSocket authentication', () => {
    function createMockReq(url: string) {
      return {
        url,
        headers: { host: 'localhost:3001' },
        socket: { remoteAddress: '127.0.0.1' },
      };
    }

    it('allows connection when no API_SECRET_KEY is configured', async () => {
      delete process.env.API_SECRET_KEY;
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      new WebSocketManager({} as any);

      const verifyClient = capturedOptions.verifyClient;
      expect(verifyClient).toBeDefined();

      const callback = vi.fn();
      verifyClient({ req: createMockReq('/ws') }, callback);

      expect(callback).toHaveBeenCalledWith(true);
    });

    it('allows connection when API_SECRET_KEY is empty string', async () => {
      process.env.API_SECRET_KEY = '   ';
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      new WebSocketManager({} as any);

      const verifyClient = capturedOptions.verifyClient;
      const callback = vi.fn();
      verifyClient({ req: createMockReq('/ws') }, callback);

      expect(callback).toHaveBeenCalledWith(true);
    });

    it('rejects connection when token is missing', async () => {
      process.env.API_SECRET_KEY = 'my-secret-key';
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      new WebSocketManager({} as any);

      const verifyClient = capturedOptions.verifyClient;
      const callback = vi.fn();
      verifyClient({ req: createMockReq('/ws') }, callback);

      expect(callback).toHaveBeenCalledWith(false, 4401, 'Unauthorized');
    });

    it('rejects connection with wrong token', async () => {
      process.env.API_SECRET_KEY = 'my-secret-key';
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      new WebSocketManager({} as any);

      const verifyClient = capturedOptions.verifyClient;
      const callback = vi.fn();
      verifyClient({ req: createMockReq('/ws?token=wrong-key') }, callback);

      expect(callback).toHaveBeenCalledWith(false, 4401, 'Unauthorized');
    });

    it('allows connection with correct token in query parameter', async () => {
      process.env.API_SECRET_KEY = 'my-secret-key';
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      new WebSocketManager({} as any);

      const verifyClient = capturedOptions.verifyClient;
      const callback = vi.fn();
      verifyClient({ req: createMockReq('/ws?token=my-secret-key') }, callback);

      expect(callback).toHaveBeenCalledWith(true);
    });

    it('trims whitespace from both API key and token for comparison', async () => {
      process.env.API_SECRET_KEY = '  my-secret-key  ';
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      new WebSocketManager({} as any);

      const verifyClient = capturedOptions.verifyClient;
      const callback = vi.fn();
      verifyClient({ req: createMockReq('/ws?token=my-secret-key') }, callback);

      expect(callback).toHaveBeenCalledWith(true);
    });

    it('rejects connection when URL parsing fails', async () => {
      process.env.API_SECRET_KEY = 'my-secret-key';
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      new WebSocketManager({} as any);

      const verifyClient = capturedOptions.verifyClient;
      const callback = vi.fn();
      // Missing req.url simulates parsing difficulty
      verifyClient(
        { req: { url: undefined, headers: {}, socket: { remoteAddress: '127.0.0.1' } } },
        callback,
      );

      // With url undefined, URL constructor gets '' which is parseable, but no token param
      expect(callback).toHaveBeenCalledWith(false, 4401, 'Unauthorized');
    });
  });
});
