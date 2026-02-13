import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('logger', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('in development mode (NODE_ENV != production)', () => {
    it('exports a logger object with pino-pretty transport', async () => {
      vi.stubEnv('NODE_ENV', 'development');

      const mockChild = vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      });

      const mockPinoFn = vi.fn().mockReturnValue({
        child: mockChild,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        level: 'info',
      });
      (mockPinoFn as Record<string, unknown>).stdSerializers = { err: vi.fn() };

      vi.doMock('pino', () => ({ default: mockPinoFn }));

      const { logger } = await import('../../src/utils/logger.js');
      expect(logger).toBeDefined();

      // Pino should have been called with transport (pino-pretty) config
      expect(mockPinoFn).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            target: 'pino-pretty',
          }),
        }),
      );
    });

    it('createLogger returns a child logger with module name', async () => {
      vi.stubEnv('NODE_ENV', 'development');

      const mockChild = vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      });

      const mockPinoFn = vi.fn().mockReturnValue({
        child: mockChild,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        level: 'info',
      });
      (mockPinoFn as Record<string, unknown>).stdSerializers = { err: vi.fn() };

      vi.doMock('pino', () => ({ default: mockPinoFn }));

      const { createLogger } = await import('../../src/utils/logger.js');
      const childLogger = createLogger('test-module');
      expect(mockChild).toHaveBeenCalledWith({ module: 'test-module' });
      expect(childLogger).toBeDefined();
    });

    it('creates different child loggers for different module names', async () => {
      vi.stubEnv('NODE_ENV', 'development');

      const mockChild = vi.fn().mockReturnValue({
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      });

      const mockPinoFn = vi.fn().mockReturnValue({
        child: mockChild,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        level: 'info',
      });
      (mockPinoFn as Record<string, unknown>).stdSerializers = { err: vi.fn() };

      vi.doMock('pino', () => ({ default: mockPinoFn }));

      const { createLogger } = await import('../../src/utils/logger.js');
      createLogger('module-a');
      createLogger('module-b');
      expect(mockChild).toHaveBeenCalledWith({ module: 'module-a' });
      expect(mockChild).toHaveBeenCalledWith({ module: 'module-b' });
    });

    it('uses LOG_LEVEL from environment', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('LOG_LEVEL', 'debug');

      const mockPinoFn = vi.fn().mockReturnValue({
        child: vi.fn().mockReturnValue({}),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        level: 'debug',
      });
      (mockPinoFn as Record<string, unknown>).stdSerializers = { err: vi.fn() };

      vi.doMock('pino', () => ({ default: mockPinoFn }));

      await import('../../src/utils/logger.js');
      expect(mockPinoFn).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug',
        }),
      );
    });
  });

  describe('in production mode (NODE_ENV = production)', () => {
    it('exports a logger without pino-pretty transport', async () => {
      vi.stubEnv('NODE_ENV', 'production');

      const mockChild = vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      });

      const mockPinoFn = vi.fn().mockReturnValue({
        child: mockChild,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        level: 'info',
      });
      (mockPinoFn as Record<string, unknown>).stdSerializers = { err: vi.fn() };

      vi.doMock('pino', () => ({ default: mockPinoFn }));

      const { logger } = await import('../../src/utils/logger.js');
      expect(logger).toBeDefined();

      // In production mode, transport should be undefined
      expect(mockPinoFn).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: undefined,
        }),
      );
    });

    it('createLogger still works in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');

      const mockChild = vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      });

      const mockPinoFn = vi.fn().mockReturnValue({
        child: mockChild,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        level: 'info',
      });
      (mockPinoFn as Record<string, unknown>).stdSerializers = { err: vi.fn() };

      vi.doMock('pino', () => ({ default: mockPinoFn }));

      const { createLogger } = await import('../../src/utils/logger.js');
      const childLogger = createLogger('prod-module');
      expect(mockChild).toHaveBeenCalledWith({ module: 'prod-module' });
      expect(childLogger).toBeDefined();
    });
  });

  describe('default LOG_LEVEL', () => {
    it('uses "info" when LOG_LEVEL is not set', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      delete process.env.LOG_LEVEL;

      const mockPinoFn = vi.fn().mockReturnValue({
        child: vi.fn().mockReturnValue({}),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        level: 'info',
      });
      (mockPinoFn as Record<string, unknown>).stdSerializers = { err: vi.fn() };

      vi.doMock('pino', () => ({ default: mockPinoFn }));

      await import('../../src/utils/logger.js');
      expect(mockPinoFn).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
        }),
      );
    });
  });
});
