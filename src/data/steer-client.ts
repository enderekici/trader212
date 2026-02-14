import { createLogger } from '../utils/logger.js';

const log = createLogger('steer-client');

export interface SteerClientOptions {
  baseUrl: string;
  timeoutMs: number;
  blockResources: string[];
}

export interface ExtractResult {
  content: string | Record<string, unknown> | unknown[];
  url: string;
  title: string;
}

const DEFAULT_OPTIONS: SteerClientOptions = {
  baseUrl: 'http://localhost:3010',
  timeoutMs: 30000,
  blockResources: ['image', 'font', 'media', 'stylesheet'],
};

export class SteerClient {
  private options: SteerClientOptions;

  constructor(options?: Partial<SteerClientOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * High-level: navigate + extract + cleanup in one call.
   * Manages full session lifecycle: create → navigate → extract → delete.
   */
  async scrape(
    url: string,
    extractOptions: {
      mode: 'text' | 'markdown' | 'structured';
      selector?: string;
      schema?: Record<string, unknown>;
      waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
      maxLength?: number;
    },
  ): Promise<ExtractResult> {
    let sessionId: string | null = null;

    try {
      // 1. Create session
      const createRes = await this.fetch('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          blockResources: this.options.blockResources,
        }),
      });
      sessionId = createRes.id as string;
      log.debug({ sessionId, url }, 'Session created');

      // 2. Navigate
      await this.fetch(`/sessions/${sessionId}/navigate`, {
        method: 'POST',
        body: JSON.stringify({
          url,
          waitUntil: extractOptions.waitUntil ?? 'domcontentloaded',
        }),
      });

      // 3. Extract
      const extractBody: Record<string, unknown> = {
        mode: extractOptions.mode,
      };
      if (extractOptions.selector) extractBody.selector = extractOptions.selector;
      if (extractOptions.schema) extractBody.schema = extractOptions.schema;
      if (extractOptions.maxLength) extractBody.maxLength = extractOptions.maxLength;

      const result = (await this.fetch(`/sessions/${sessionId}/extract`, {
        method: 'POST',
        body: JSON.stringify(extractBody),
      })) as unknown as ExtractResult;

      return result;
    } finally {
      // 4. Always clean up session
      if (sessionId) {
        try {
          await this.fetch(`/sessions/${sessionId}`, { method: 'DELETE' });
          log.debug({ sessionId }, 'Session cleaned up');
        } catch (cleanupErr) {
          log.warn({ sessionId, err: cleanupErr }, 'Failed to clean up session');
        }
      }
    }
  }

  /** Health check — returns true if steer is reachable and healthy */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.options.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async fetch(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const url = `${this.options.baseUrl}${path}`;
    const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
    if (init.body) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Steer API error ${res.status} ${path}: ${body}`);
    }

    return (await res.json()) as Record<string, unknown>;
  }
}
