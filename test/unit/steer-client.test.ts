import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { SteerClient } from '../../src/data/steer-client.js';

describe('SteerClient', () => {
  let client: SteerClient;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new SteerClient({ baseUrl: 'http://localhost:3010', timeoutMs: 5000 });
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchSequence(...responses: Array<{ status: number; body: unknown }>) {
    for (const res of responses) {
      fetchSpy.mockResolvedValueOnce({
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        json: () => Promise.resolve(res.body),
        text: () => Promise.resolve(JSON.stringify(res.body)),
      } as Response);
    }
  }

  describe('scrape()', () => {
    it('should create session, navigate, extract, and delete', async () => {
      mockFetchSequence(
        { status: 201, body: { id: 'sess-123' } },
        { status: 200, body: { url: 'https://example.com', title: 'Example' } },
        { status: 200, body: { content: 'Hello World', url: 'https://example.com', title: 'Example' } },
        { status: 200, body: { success: true } },
      );

      const result = await client.scrape('https://example.com', { mode: 'text' });

      expect(result.content).toBe('Hello World');
      expect(result.url).toBe('https://example.com');
      expect(fetchSpy).toHaveBeenCalledTimes(4);

      // Verify session creation
      expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:3010/sessions');

      // Verify navigation
      expect(fetchSpy.mock.calls[1][0]).toBe('http://localhost:3010/sessions/sess-123/navigate');

      // Verify extraction
      expect(fetchSpy.mock.calls[2][0]).toBe('http://localhost:3010/sessions/sess-123/extract');

      // Verify cleanup
      expect(fetchSpy.mock.calls[3][0]).toBe('http://localhost:3010/sessions/sess-123');
      expect((fetchSpy.mock.calls[3][1] as RequestInit).method).toBe('DELETE');
    });

    it('should pass extract options correctly', async () => {
      mockFetchSequence(
        { status: 201, body: { id: 'sess-456' } },
        { status: 200, body: { url: 'https://example.com', title: 'Test' } },
        { status: 200, body: { content: { name: 'Test' }, url: 'https://example.com', title: 'Test' } },
        { status: 200, body: { success: true } },
      );

      await client.scrape('https://example.com', {
        mode: 'structured',
        selector: '.main',
        schema: { type: 'object', properties: { name: { type: 'string' } } },
        maxLength: 4000,
        waitUntil: 'networkidle',
      });

      // Check navigation body includes waitUntil
      const navBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
      expect(navBody.waitUntil).toBe('networkidle');

      // Check extract body includes all options
      const extractBody = JSON.parse((fetchSpy.mock.calls[2][1] as RequestInit).body as string);
      expect(extractBody.mode).toBe('structured');
      expect(extractBody.selector).toBe('.main');
      expect(extractBody.schema).toBeDefined();
      expect(extractBody.maxLength).toBe(4000);
    });

    it('should clean up session on navigation failure', async () => {
      mockFetchSequence(
        { status: 201, body: { id: 'sess-fail' } },
        { status: 502, body: { error: { code: 'NAVIGATION_FAILED' } } },
        { status: 200, body: { success: true } },
      );

      await expect(client.scrape('https://bad.example.com', { mode: 'text' })).rejects.toThrow(
        'Steer API error 502',
      );

      // Verify session was still cleaned up
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(fetchSpy.mock.calls[2][0]).toBe('http://localhost:3010/sessions/sess-fail');
      expect((fetchSpy.mock.calls[2][1] as RequestInit).method).toBe('DELETE');
    });

    it('should clean up session on extract failure', async () => {
      mockFetchSequence(
        { status: 201, body: { id: 'sess-ext-fail' } },
        { status: 200, body: { url: 'https://example.com', title: 'Test' } },
        { status: 400, body: { error: { code: 'VALIDATION_ERROR' } } },
        { status: 200, body: { success: true } },
      );

      await expect(
        client.scrape('https://example.com', { mode: 'structured', schema: {} }),
      ).rejects.toThrow('Steer API error 400');

      // Verify cleanup still happened
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(fetchSpy.mock.calls[3][0]).toBe('http://localhost:3010/sessions/sess-ext-fail');
    });

    it('should handle cleanup failure gracefully', async () => {
      mockFetchSequence(
        { status: 201, body: { id: 'sess-cleanup-fail' } },
        { status: 200, body: { url: 'https://example.com', title: 'Test' } },
        { status: 200, body: { content: 'data', url: 'https://example.com', title: 'Test' } },
      );
      // Delete will reject
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      // Should still return the result despite cleanup failure
      const result = await client.scrape('https://example.com', { mode: 'text' });
      expect(result.content).toBe('data');
    });

    it('should use default blockResources', async () => {
      const defaultClient = new SteerClient();
      mockFetchSequence(
        { status: 201, body: { id: 'sess-default' } },
        { status: 200, body: { url: 'https://example.com', title: 'Test' } },
        { status: 200, body: { content: 'ok', url: 'https://example.com', title: 'Test' } },
        { status: 200, body: { success: true } },
      );

      await defaultClient.scrape('https://example.com', { mode: 'text' });

      const createBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(createBody.blockResources).toEqual(['image', 'font', 'media', 'stylesheet']);
    });

    it('should default waitUntil to domcontentloaded', async () => {
      mockFetchSequence(
        { status: 201, body: { id: 'sess-wai' } },
        { status: 200, body: { url: 'https://example.com', title: 'Test' } },
        { status: 200, body: { content: 'ok', url: 'https://example.com', title: 'Test' } },
        { status: 200, body: { success: true } },
      );

      await client.scrape('https://example.com', { mode: 'text' });

      const navBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
      expect(navBody.waitUntil).toBe('domcontentloaded');
    });
  });

  describe('isAvailable()', () => {
    it('should return true when health endpoint responds ok', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

      expect(await client.isAvailable()).toBe(true);
      expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:3010/health');
    });

    it('should return false when health endpoint fails', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      expect(await client.isAvailable()).toBe(false);
    });

    it('should return false on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Connection refused'));

      expect(await client.isAvailable()).toBe(false);
    });
  });
});
