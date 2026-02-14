import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockConfigGet } = vi.hoisted(() => {
  return {
    mockConfigGet: vi.fn(),
  };
});

vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: mockConfigGet,
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { WebResearcher } from '../../src/data/web-researcher.js';
import type { SteerClient, ExtractResult } from '../../src/data/steer-client.js';

function createMockSteerClient(): SteerClient {
  return {
    scrape: vi.fn(),
    isAvailable: vi.fn().mockResolvedValue(true),
  } as unknown as SteerClient;
}

describe('WebResearcher', () => {
  let researcher: WebResearcher;
  let mockClient: SteerClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockSteerClient();
    researcher = new WebResearcher(mockClient);

    // Default config values
    mockConfigGet.mockImplementation((key: string) => {
      switch (key) {
        case 'webResearch.finvizEnabled':
          return true;
        case 'webResearch.stockAnalysisEnabled':
          return true;
        case 'webResearch.cacheTtlHours':
          return 4;
        default:
          return undefined;
      }
    });
  });

  describe('getStockResearch()', () => {
    it('should scrape Finviz and parse metrics', async () => {
      const finvizText = `
        PEG 1.25
        Target Price 185.00
        Short Float 2.50%
        Inst Own 78.50%
        Perf Week 2.30%
        Perf Month 5.10%
        Perf Quarter 12.80%
        Perf Year 28.50%
        Rel Volume 1.15
        Avg Volume 45.2M
      `;

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: finvizText, url: 'https://finviz.com/...', title: 'AAPL' } as ExtractResult)
        .mockResolvedValueOnce({ content: '', url: 'https://stockanalysis.com/...', title: 'AAPL' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');

      expect(result).not.toBeNull();
      expect(result!.pegRatio).toBe(1.25);
      expect(result!.analystTargetPrice).toBe(185.0);
      expect(result!.shortInterestPct).toBeCloseTo(0.025, 4);
      expect(result!.institutionalOwnershipPct).toBeCloseTo(0.785, 4);
      expect(result!.perfWeek).toBeCloseTo(0.023, 4);
      expect(result!.perfMonth).toBeCloseTo(0.051, 4);
      expect(result!.perfQuarter).toBeCloseTo(0.128, 4);
      expect(result!.perfYear).toBeCloseTo(0.285, 4);
      expect(result!.relativeVolume).toBe(1.15);
      expect(result!.averageVolume).toBe(45200000);
      expect(result!.fetchedAt).toBeDefined();
    });

    it('should parse StockAnalysis analyst consensus', async () => {
      const finvizText = 'PEG 1.50';
      const saText = `
        Based on 15 analyst ratings.
        The analyst consensus is Strong Buy.
        EPS estimate: $1.82
        Revenue forecast: $24.5B
      `;

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: finvizText, url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: saText, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');

      expect(result).not.toBeNull();
      expect(result!.analystConsensus).toBe('Strong Buy');
      expect(result!.analystCount).toBe(15);
      expect(result!.epsEstimateNextQ).toBe(1.82);
      expect(result!.revenueEstimateNextQ).toBe(24500000000);
    });

    it('should return cached data on cache hit', async () => {
      const scrapeMock = vi.fn()
        .mockResolvedValue({ content: 'PEG 2.00', url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      // First call - populates cache
      const result1 = await researcher.getStockResearch('MSFT');
      expect(result1).not.toBeNull();

      // Reset spy call count
      const callCountAfterFirst = scrapeMock.mock.calls.length;

      // Second call - should use cache
      const result2 = await researcher.getStockResearch('MSFT');
      expect(result2).not.toBeNull();
      expect(result2!.pegRatio).toBe(result1!.pegRatio);

      // No additional scrape calls
      expect(scrapeMock.mock.calls.length).toBe(callCountAfterFirst);
    });

    it('should return null when steer is unavailable', async () => {
      (mockClient.isAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const result = await researcher.getStockResearch('AAPL');
      expect(result).toBeNull();
    });

    it('should return partial data on Finviz scrape failure', async () => {
      const scrapeMock = vi.fn()
        .mockRejectedValueOnce(new Error('Finviz blocked'))
        .mockResolvedValueOnce({
          content: '10 analyst Strong Buy',
          url: '', title: '',
        } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');

      expect(result).not.toBeNull();
      // Finviz data should be null
      expect(result!.pegRatio).toBeNull();
      // StockAnalysis data may still be present
      expect(result!.analystConsensus).toBe('Strong Buy');
    });

    it('should return partial data on StockAnalysis scrape failure', async () => {
      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: 'PEG 1.50', url: '', title: '' } as ExtractResult)
        .mockRejectedValueOnce(new Error('StockAnalysis unavailable'));

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');

      expect(result).not.toBeNull();
      expect(result!.pegRatio).toBe(1.5);
      expect(result!.analystConsensus).toBeNull();
    });

    it('should skip Finviz when disabled via config', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'webResearch.finvizEnabled') return false;
        if (key === 'webResearch.stockAnalysisEnabled') return true;
        if (key === 'webResearch.cacheTtlHours') return 4;
        return undefined;
      });

      const scrapeMock = vi.fn()
        .mockResolvedValue({ content: '', url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      await researcher.getStockResearch('AAPL');

      // Only StockAnalysis should be called (1 call, not 2)
      expect(scrapeMock).toHaveBeenCalledTimes(1);
    });

    it('should skip StockAnalysis when disabled via config', async () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'webResearch.finvizEnabled') return true;
        if (key === 'webResearch.stockAnalysisEnabled') return false;
        if (key === 'webResearch.cacheTtlHours') return 4;
        return undefined;
      });

      const scrapeMock = vi.fn()
        .mockResolvedValue({ content: 'PEG 2.0', url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      await researcher.getStockResearch('AAPL');

      // Only Finviz should be called (1 call, not 2)
      expect(scrapeMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('searchNews()', () => {
    it('should return parsed DuckDuckGo results', async () => {
      const scrapeMock = vi.fn().mockResolvedValue({
        content: [
          { title: 'AI stocks surge', snippet: 'Top picks for 2026', url: 'https://example.com/1' },
          { title: 'Semiconductor rally', snippet: 'NVDA leads', url: 'https://example.com/2' },
        ],
        url: 'https://html.duckduckgo.com/html/?q=test',
        title: 'DuckDuckGo',
      } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const results = await researcher.searchNews('AI hardware stocks', 5);

      expect(results).toHaveLength(2);
      expect(results[0]).toContain('AI stocks surge');
      expect(results[1]).toContain('Semiconductor rally');
    });

    it('should return empty array when steer is unavailable', async () => {
      (mockClient.isAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const results = await researcher.searchNews('test');
      expect(results).toEqual([]);
    });

    it('should return empty array on search failure', async () => {
      const scrapeMock = vi.fn().mockRejectedValue(new Error('Search failed'));
      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const results = await researcher.searchNews('test');
      expect(results).toEqual([]);
    });

    it('should respect maxResults parameter', async () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        title: `Result ${i}`,
        snippet: `Snippet ${i}`,
        url: `https://example.com/${i}`,
      }));

      const scrapeMock = vi.fn().mockResolvedValue({
        content: items,
        url: 'https://html.duckduckgo.com',
        title: 'DDG',
      } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const results = await researcher.searchNews('test', 3);
      expect(results).toHaveLength(3);
    });
  });

  describe('clearCache()', () => {
    it('should clear cached research data', async () => {
      const scrapeMock = vi.fn()
        .mockResolvedValue({ content: 'PEG 1.00', url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      // Populate cache
      await researcher.getStockResearch('AAPL');
      const callsAfterFirst = scrapeMock.mock.calls.length;

      // Clear cache
      researcher.clearCache();

      // Next call should make fresh requests
      await researcher.getStockResearch('AAPL');
      expect(scrapeMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });
  });

  describe('Finviz parsing edge cases', () => {
    it('should handle negative performance values', async () => {
      const text = 'Perf Week -3.50%\nPerf Month -8.20%';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: text, url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.perfWeek).toBeCloseTo(-0.035, 4);
      expect(result!.perfMonth).toBeCloseTo(-0.082, 4);
    });

    it('should handle volume with K suffix', async () => {
      const text = 'Avg Volume 850K';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: text, url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.averageVolume).toBe(850000);
    });

    it('should handle volume with B suffix', async () => {
      const text = 'Avg Volume 1.5B';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: text, url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.averageVolume).toBe(1500000000);
    });

    it('should handle plain numeric volume without suffix', async () => {
      const text = 'Avg Volume 12345';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: text, url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.averageVolume).toBe(12345);
    });

    it('should handle commas in numeric values', async () => {
      const text = 'PEG 1,234.56\nAvg Volume 48,510,000';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: text, url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.pegRatio).toBe(1234.56);
      expect(result!.averageVolume).toBe(48510000);
    });

    it('should parse newline-separated Finviz metrics', async () => {
      const text = 'PEG\n  2.50\nTarget Price\n  200.00\nShort Float\n  3.10%\nInst Own\n  80.00%\nPerf Week\n  1.50%';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: text, url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.pegRatio).toBe(2.5);
      expect(result!.analystTargetPrice).toBe(200);
      expect(result!.shortInterestPct).toBeCloseTo(0.031, 4);
      expect(result!.institutionalOwnershipPct).toBeCloseTo(0.8, 4);
      expect(result!.perfWeek).toBeCloseTo(0.015, 4);
    });

    it('should return null for non-matching content', async () => {
      const text = 'No financial data here, just random text.';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: text, url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: text, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.pegRatio).toBeNull();
      expect(result!.analystTargetPrice).toBeNull();
      expect(result!.analystConsensus).toBeNull();
      expect(result!.analystCount).toBeNull();
    });
  });

  describe('StockAnalysis parsing edge cases', () => {
    it('should parse Hold/Neutral consensus', async () => {
      const saText = '5 analyst ratings. The analyst consensus is Hold.';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: saText, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.analystConsensus).toBe('Hold');
    });

    it('should parse Sell consensus', async () => {
      const saText = 'The analyst consensus is Sell.';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: saText, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.analystConsensus).toBe('Sell');
    });

    it('should parse Strong Sell consensus', async () => {
      const saText = 'Strong Sell rating from analysts.';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: saText, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.analystConsensus).toBe('Strong Sell');
    });

    it('should parse Underperform consensus as Sell', async () => {
      const saText = 'The analyst consensus is Underperform.';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: saText, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.analystConsensus).toBe('Sell');
    });

    it('should parse Neutral consensus as Hold', async () => {
      const saText = 'The analyst consensus is Neutral.';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: saText, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.analystConsensus).toBe('Hold');
    });

    it('should return null for unrecognized consensus', async () => {
      const saText = 'The analyst consensus is Accumulate.';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: saText, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.analystConsensus).toBeNull();
    });

    it('should parse analyst count with "wall street" prefix', async () => {
      const saText = '30 wall street analysts cover this stock.';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: saText, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.analystCount).toBe(30);
    });

    it('should parse analyst count with "based on" prefix', async () => {
      const saText = 'based on 22 analyst estimates';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: saText, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.analystCount).toBe(22);
    });

    it('should parse EPS with alternate pattern', async () => {
      const saText = 'EPS: $2.15 est for next quarter';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: saText, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.epsEstimateNextQ).toBe(2.15);
    });

    it('should parse revenue estimate with M suffix', async () => {
      const saText = 'Revenue estimate: $850.5M';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: saText, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.revenueEstimateNextQ).toBe(850500000);
    });

    it('should parse revenue estimate with T suffix', async () => {
      const saText = 'Revenue estimate: $1.2T';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: saText, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.revenueEstimateNextQ).toBe(1200000000000);
    });

    it('should parse revenue with plain number (no suffix)', async () => {
      const saText = 'Revenue estimate: $500000';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: saText, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.revenueEstimateNextQ).toBe(500000);
    });

    it('should parse revenue with "forecast" keyword', async () => {
      const saText = 'Revenue forecast: $12.5B';

      const scrapeMock = vi.fn()
        .mockResolvedValueOnce({ content: '', url: '', title: '' } as ExtractResult)
        .mockResolvedValueOnce({ content: saText, url: '', title: '' } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const result = await researcher.getStockResearch('AAPL');
      expect(result!.revenueEstimateNextQ).toBe(12500000000);
    });
  });

  describe('searchNews() edge cases', () => {
    it('should handle non-array content from scrape', async () => {
      const scrapeMock = vi.fn().mockResolvedValue({
        content: 'just a string, not an array',
        url: 'https://html.duckduckgo.com',
        title: 'DDG',
      } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const results = await researcher.searchNews('test');
      expect(results).toEqual([]);
    });

    it('should filter empty titles and snippets', async () => {
      const scrapeMock = vi.fn().mockResolvedValue({
        content: [
          { title: '', snippet: '', url: '' },
          { title: 'Real result', snippet: 'Has content', url: 'https://example.com' },
        ],
        url: 'https://html.duckduckgo.com',
        title: 'DDG',
      } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const results = await researcher.searchNews('test');
      expect(results).toHaveLength(1);
      expect(results[0]).toContain('Real result');
    });

    it('should handle items with only snippet, no title', async () => {
      const scrapeMock = vi.fn().mockResolvedValue({
        content: [
          { title: '', snippet: 'Just a snippet', url: '' },
        ],
        url: 'https://html.duckduckgo.com',
        title: 'DDG',
      } as ExtractResult);

      (mockClient as unknown as { scrape: typeof scrapeMock }).scrape = scrapeMock;

      const results = await researcher.searchNews('test');
      expect(results).toHaveLength(1);
      expect(results[0]).toBe('Just a snippet');
    });
  });
});
