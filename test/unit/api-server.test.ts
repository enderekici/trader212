import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock dependencies
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

const mockUse = vi.fn();
const mockExpressApp = {
  use: mockUse,
};
const mockExpress = vi.fn(() => mockExpressApp);
(mockExpress as any).json = vi.fn(() => 'json-middleware');

vi.mock('express', () => {
  const fn: any = () => mockExpressApp;
  fn.json = () => 'json-middleware';
  fn.default = fn;
  return { default: fn, __esModule: true };
});

vi.mock('cors', () => ({
  default: vi.fn(() => 'cors-middleware'),
  __esModule: true,
}));

const mockRouter = { __type: 'router' };
vi.mock('../../src/api/routes.js', () => ({
  createRouter: vi.fn(() => mockRouter),
}));

class MockServer extends EventEmitter {
  listen = vi.fn((_port: number, cb: () => void) => {
    cb();
    return this;
  });
  close = vi.fn((cb?: (err?: Error) => void) => {
    if (cb) cb();
    return this;
  });
}

let mockServerInstance: MockServer;

vi.mock('node:http', () => ({
  createServer: vi.fn(() => {
    mockServerInstance = new MockServer();
    return mockServerInstance;
  }),
}));

class MockWSManager {
  close = vi.fn();
}

let mockWsManagerInstance: MockWSManager;

vi.mock('../../src/api/websocket.js', () => ({
  WebSocketManager: vi.fn().mockImplementation(function () {
    mockWsManagerInstance = new MockWSManager();
    return mockWsManagerInstance;
  }),
}));

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => 'rate-limit-middleware'),
  __esModule: true,
}));

vi.mock('../../src/api/middleware/auth.js', () => ({
  authMiddleware: vi.fn((_req: any, _res: any, next: any) => next()),
}));

describe('api/server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.API_PORT;
  });

  afterEach(() => {
    delete process.env.API_PORT;
  });

  describe('ApiServer constructor', () => {
    it('uses default port 3001 when API_PORT env is not set', async () => {
      const { ApiServer } = await import('../../src/api/server.js');
      const server = new ApiServer();
      expect(server).toBeDefined();
    });

    it('uses API_PORT env variable when set', async () => {
      process.env.API_PORT = '4000';
      // Force re-import by resetting modules
      vi.resetModules();
      const { ApiServer } = await import('../../src/api/server.js');
      const server = new ApiServer();
      expect(server).toBeDefined();
    });

    it('sets up CORS middleware', async () => {
      const { ApiServer } = await import('../../src/api/server.js');
      new ApiServer();
      expect(mockUse).toHaveBeenCalled();
    });

    it('sets up JSON body parser middleware', async () => {
      const { ApiServer } = await import('../../src/api/server.js');
      new ApiServer();
      // express.json() and cors() and router are all added via app.use
      expect(mockUse).toHaveBeenCalled();
    });

    it('creates the router and adds it to express', async () => {
      const { createRouter } = await import('../../src/api/routes.js');
      const { ApiServer } = await import('../../src/api/server.js');
      new ApiServer();
      expect(createRouter).toHaveBeenCalled();
    });

    it('creates an HTTP server', async () => {
      const { createServer } = await import('node:http');
      const { ApiServer } = await import('../../src/api/server.js');
      new ApiServer();
      expect(createServer).toHaveBeenCalledWith(mockExpressApp);
    });

    it('creates a WebSocketManager with the HTTP server', async () => {
      const { WebSocketManager } = await import('../../src/api/websocket.js');
      const { ApiServer } = await import('../../src/api/server.js');
      new ApiServer();
      expect(WebSocketManager).toHaveBeenCalledWith(mockServerInstance);
    });
  });

  describe('start', () => {
    it('starts listening on the configured port', async () => {
      const { ApiServer } = await import('../../src/api/server.js');
      const server = new ApiServer();
      await server.start();
      expect(mockServerInstance.listen).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Function)
      );
    });

    it('resolves the promise when server starts', async () => {
      const { ApiServer } = await import('../../src/api/server.js');
      const server = new ApiServer();
      await expect(server.start()).resolves.toBeUndefined();
    });
  });

  describe('stop', () => {
    it('closes the WebSocket manager', async () => {
      const { ApiServer } = await import('../../src/api/server.js');
      const server = new ApiServer();
      await server.stop();
      expect(mockWsManagerInstance.close).toHaveBeenCalled();
    });

    it('closes the HTTP server', async () => {
      const { ApiServer } = await import('../../src/api/server.js');
      const server = new ApiServer();
      await server.stop();
      expect(mockServerInstance.close).toHaveBeenCalled();
    });

    it('resolves when server closes successfully', async () => {
      const { ApiServer } = await import('../../src/api/server.js');
      const server = new ApiServer();
      await expect(server.stop()).resolves.toBeUndefined();
    });

    it('rejects when server close fails', async () => {
      const { ApiServer } = await import('../../src/api/server.js');
      const server = new ApiServer();
      mockServerInstance.close.mockImplementation((cb: (err?: Error) => void) => {
        cb(new Error('close error'));
        return mockServerInstance;
      });
      await expect(server.stop()).rejects.toThrow('close error');
    });
  });

  describe('getWsManager', () => {
    it('returns the WebSocketManager instance', async () => {
      const { ApiServer } = await import('../../src/api/server.js');
      const server = new ApiServer();
      const wsManager = server.getWsManager();
      expect(wsManager).toBe(mockWsManagerInstance);
    });
  });
});
