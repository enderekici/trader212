import { createLogger } from './logger.js';

const log = createLogger('error-handlers');

export function setupGlobalErrorHandlers(
  onCriticalError?: (error: Error, source: string) => void,
): void {
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    log.error(
      {
        err: error,
        promise: promise.toString(),
      },
      'Unhandled promise rejection',
    );

    if (onCriticalError) {
      try {
        onCriticalError(error, 'unhandledRejection');
      } catch {
        // Ignore errors in the callback
      }
    }
  });

  process.on('uncaughtException', (error: Error) => {
    log.fatal({ err: error }, 'Uncaught exception - process will exit');

    if (onCriticalError) {
      try {
        onCriticalError(error, 'uncaughtException');
      } catch {
        // Ignore errors in the callback
      }
    }

    // Give time for logging/alerting before exit
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  log.info('Global error handlers installed');
}
