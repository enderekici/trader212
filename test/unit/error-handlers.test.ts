import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupGlobalErrorHandlers } from '../../src/utils/error-handlers.js';

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    error: vi.fn(),
    fatal: vi.fn(),
    info: vi.fn(),
  }),
}));

describe('setupGlobalErrorHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Remove existing listeners to avoid interference
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
  });

  it('should install handlers without errors', () => {
    expect(() => setupGlobalErrorHandlers()).not.toThrow();
  });

  it('should call callback on unhandledRejection', async () => {
    const mockCallback = vi.fn();
    setupGlobalErrorHandlers(mockCallback);

    const testError = new Error('Test rejection');
    process.emit('unhandledRejection', testError, Promise.resolve());

    // Give time for async handler
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockCallback).toHaveBeenCalledWith(testError, 'unhandledRejection');
  });

  it('should call callback on uncaughtException and exit', async () => {
    const mockCallback = vi.fn();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    setupGlobalErrorHandlers(mockCallback);

    const testError = new Error('Test exception');
    process.emit('uncaughtException', testError);

    // Give time for async handler and setTimeout
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(mockCallback).toHaveBeenCalledWith(testError, 'uncaughtException');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it('should handle non-Error rejections', async () => {
    const mockCallback = vi.fn();
    setupGlobalErrorHandlers(mockCallback);

    process.emit('unhandledRejection', 'string error', Promise.resolve());

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'string error',
      }),
      'unhandledRejection',
    );
  });

  it('should not crash if callback throws', async () => {
    const mockCallback = vi.fn().mockImplementation(() => {
      throw new Error('Callback error');
    });

    setupGlobalErrorHandlers(mockCallback);

    const testError = new Error('Test rejection');

    // Emit should not throw (error is caught in handler)
    process.emit('unhandledRejection', testError, Promise.resolve());

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Callback was called despite throwing
    expect(mockCallback).toHaveBeenCalledWith(testError, 'unhandledRejection');
  });
});
