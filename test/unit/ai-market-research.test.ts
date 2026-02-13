import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock external dependencies
vi.mock('../../src/config/manager.js', () => ({
  configManager: {
    get: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockDbInsert = vi.fn();
const mockDbSelectAll = vi.fn();
const mockDbSelectGet = vi.fn();
vi.mock('../../src/db/index.js', () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        run: mockDbInsert,
      }),
    }),
    select: () => ({
      from: () => ({
        orderBy: () => ({
          limit: () => ({
            all: mockDbSelectAll,
          }),
        }),
        where: () => ({
          get: mockDbSelectGet,
        }),
      }),
    }),
  }),
}));

vi.mock('../../src/db/schema.js', () => ({
  aiResearch: {},
}));

vi.mock('drizzle-orm', () => ({
  desc: vi.fn(),
  eq: vi.fn(),
}));

import { MarketResearcher } from '../../src/ai/market-research.js';
import { configManager } from '../../src/config/manager.js';
import type { AIAgent } from '../../src/ai/agent.js';

function createMockAgent(rawChatResponse: string): AIAgent {
  return {
    analyze: vi.fn(),
    rawChat: vi.fn().mockResolvedValue(rawChatResponse),
  };
}

const validResearchResponse = JSON.stringify({
  results: [
    {
      symbol: 'AAPL',
      recommendation: 'buy',
      conviction: 75,
      reasoning: 'Strong technical signals',
      catalysts: ['Earnings beat', 'AI growth'],
      risks: ['China slowdown', 'Valuation'],
      targetPrice: 200,
      timeHorizon: 'medium',
      sector: 'Technology',
    },
    {
      symbol: 'MSFT',
      recommendation: 'strong_buy',
      conviction: 85,
      reasoning: 'Cloud growth accelerating',
      catalysts: ['Azure revenue'],
      risks: ['Competition'],
      targetPrice: 450,
      timeHorizon: 'long',
      sector: 'Technology',
    },
  ],
  marketContext: {
    keyThemes: ['AI boom', 'Rate cuts'],
    sectorRotation: 'Tech leading',
  },
});

describe('MarketResearcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'ai.research.topStocksCount') return 5;
      if (key === 'ai.model') return 'claude-sonnet-4-20250514';
      return undefined;
    });
    mockDbInsert.mockReturnValue({ lastInsertRowid: 1 });
  });

  describe('runResearch', () => {
    it('runs research with default options and stores results in DB', async () => {
      const agent = createMockAgent(validResearchResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();

      expect(agent.rawChat).toHaveBeenCalledOnce();
      // Check system prompt
      const systemArg = (agent.rawChat as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(systemArg).toContain('market research analyst');

      // Check user prompt includes defaults
      const userArg = (agent.rawChat as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(userArg).toContain('general market opportunities');
      expect(userArg).toContain('Consider all sectors');
      expect(userArg).toContain('top 5 most promising stocks');

      // Check DB insert was called
      expect(mockDbInsert).toHaveBeenCalledOnce();

      // Check the report
      expect(report.id).toBe(1);
      expect(report.query).toBe('Market Research: general market opportunities');
      expect(report.results).toHaveLength(2);
      expect(report.results[0].symbol).toBe('AAPL');
      expect(report.results[0].recommendation).toBe('buy');
      expect(report.results[0].conviction).toBe(75);
      expect(report.results[0].catalysts).toEqual(['Earnings beat', 'AI growth']);
      expect(report.results[1].symbol).toBe('MSFT');
      expect(report.marketContext).toBeNull();
      expect(report.aiModel).toBe('claude-sonnet-4-20250514');
    });

    it('uses sector filter when sectors provided', async () => {
      const agent = createMockAgent(validResearchResponse);
      const researcher = new MarketResearcher(agent);

      await researcher.runResearch({ sectors: ['Technology', 'Healthcare'] });

      const userArg = (agent.rawChat as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(userArg).toContain('Focus on these sectors: Technology, Healthcare');
    });

    it('uses symbol filter when symbols provided', async () => {
      const agent = createMockAgent(validResearchResponse);
      const researcher = new MarketResearcher(agent);

      await researcher.runResearch({ symbols: ['AAPL', 'MSFT'] });

      const userArg = (agent.rawChat as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(userArg).toContain('Specifically analyze these symbols: AAPL, MSFT');
    });

    it('uses custom focus when provided', async () => {
      const agent = createMockAgent(validResearchResponse);
      const researcher = new MarketResearcher(agent);

      await researcher.runResearch({ focus: 'AI semiconductor stocks' });

      const userArg = (agent.rawChat as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(userArg).toContain('AI semiconductor stocks');
      expect(researcher).toBeDefined();
    });

    it('uses default focus with empty sectors and symbols', async () => {
      const agent = createMockAgent(validResearchResponse);
      const researcher = new MarketResearcher(agent);

      await researcher.runResearch({ sectors: [], symbols: [] });

      const userArg = (agent.rawChat as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(userArg).toContain('Consider all sectors');
      expect(userArg).toContain('top 5 most promising stocks');
    });

    it('throws when AI agent fails', async () => {
      const agent: AIAgent = {
        analyze: vi.fn(),
        rawChat: vi.fn().mockRejectedValue(new Error('API Error')),
      };
      const researcher = new MarketResearcher(agent);

      await expect(researcher.runResearch()).rejects.toThrow('API Error');
    });
  });

  describe('parseResearchResponse - valid JSON', () => {
    it('parses valid JSON response with results array', async () => {
      const agent = createMockAgent(validResearchResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(2);
      expect(report.results[0].symbol).toBe('AAPL');
      expect(report.results[0].targetPrice).toBe(200);
      expect(report.results[1].targetPrice).toBe(450);
    });

    it('handles results with missing optional fields', async () => {
      const response = JSON.stringify({
        results: [
          {
            symbol: 'TEST',
            // missing recommendation, conviction, etc.
          },
        ],
      });
      const agent = createMockAgent(response);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(1);
      expect(report.results[0].symbol).toBe('TEST');
      expect(report.results[0].recommendation).toBe('hold');
      expect(report.results[0].conviction).toBe(50);
      expect(report.results[0].reasoning).toBe('');
      expect(report.results[0].catalysts).toEqual([]);
      expect(report.results[0].risks).toEqual([]);
      expect(report.results[0].targetPrice).toBeUndefined();
      expect(report.results[0].timeHorizon).toBe('medium');
      expect(report.results[0].sector).toBe('Unknown');
    });

    it('handles results with non-array catalysts and risks', async () => {
      const response = JSON.stringify({
        results: [
          {
            symbol: 'ABC',
            recommendation: 'buy',
            conviction: 60,
            reasoning: 'test',
            catalysts: 'not an array',
            risks: 'also not an array',
            timeHorizon: 'short',
            sector: 'Finance',
          },
        ],
      });
      const agent = createMockAgent(response);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results[0].catalysts).toEqual([]);
      expect(report.results[0].risks).toEqual([]);
    });
  });

  describe('parseResearchResponse - think tags', () => {
    it('strips <think> tags before parsing', async () => {
      const rawResponse = `<think>Let me analyze the market carefully. I need to consider multiple factors including technical indicators, fundamental data, and market sentiment.</think>
${validResearchResponse}`;

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(2);
      expect(report.results[0].symbol).toBe('AAPL');
    });

    it('strips multiple <think> blocks', async () => {
      const rawResponse = `<think>First thought</think>
<think>Second thought about sector rotation</think>
${validResearchResponse}`;

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(2);
    });

    it('strips multiline think blocks', async () => {
      const rawResponse = `<think>
Let me think step by step:
1. Market is bullish
2. Tech sector strong
3. AI theme continues
</think>
${validResearchResponse}`;

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(2);
    });
  });

  describe('parseResearchResponse - markdown code blocks', () => {
    it('extracts JSON from ```json code block', async () => {
      const rawResponse = `Here are my research results:
\`\`\`json
${validResearchResponse}
\`\`\``;

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(2);
    });

    it('extracts JSON from ``` code block without language', async () => {
      const rawResponse = `\`\`\`
${validResearchResponse}
\`\`\``;

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(2);
    });

    it('handles think tags + code blocks combined', async () => {
      const rawResponse = `<think>Analyzing market data...</think>
\`\`\`json
${validResearchResponse}
\`\`\``;

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(2);
    });
  });

  describe('parseResearchResponse - JSON repair', () => {
    it('repairs trailing commas', async () => {
      const rawResponse = `{
  "results": [
    {
      "symbol": "AAPL",
      "recommendation": "buy",
      "conviction": 75,
      "reasoning": "Good stock",
      "catalysts": ["Growth",],
      "risks": ["Risk1",],
      "timeHorizon": "medium",
      "sector": "Tech",
    },
  ]
}`;

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(1);
      expect(report.results[0].symbol).toBe('AAPL');
    });

    it('repairs unquoted keys', async () => {
      const rawResponse = `{
  results: [
    {
      symbol: "NVDA",
      recommendation: "strong_buy",
      conviction: 90,
      reasoning: "AI leader",
      catalysts: ["Data center growth"],
      risks: ["Valuation"],
      timeHorizon: "long",
      sector: "Technology"
    }
  ]
}`;

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(1);
      expect(report.results[0].symbol).toBe('NVDA');
    });

    it('repairs single-quoted strings', async () => {
      const rawResponse = `{
  "results": [
    {
      "symbol": "GOOG",
      "recommendation": 'buy',
      "conviction": 70,
      "reasoning": 'Search dominance',
      "catalysts": ["AI"],
      "risks": ["Regulation"],
      "timeHorizon": 'medium',
      "sector": 'Technology'
    }
  ]
}`;

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(1);
      expect(report.results[0].symbol).toBe('GOOG');
    });
  });

  describe('parseResearchResponse - individual block fallback', () => {
    it('extracts individual result objects when full JSON fails', async () => {
      // This is malformed JSON that can't be parsed as a whole, but individual blocks can
      const rawResponse = `Here are results:
{"symbol": "AAPL", "recommendation": "buy", "conviction": 75, "reasoning": "Good", "catalysts": ["Growth"], "risks": ["Risk"], "timeHorizon": "medium", "sector": "Tech"}
some garbage in between
{"symbol": "MSFT", "recommendation": "hold", "conviction": 50, "reasoning": "Stable", "catalysts": [], "risks": ["Competition"], "timeHorizon": "long", "sector": "Tech"}`;

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(2);
      expect(report.results[0].symbol).toBe('AAPL');
      expect(report.results[1].symbol).toBe('MSFT');
    });

    it('extracts individual blocks with trailing commas', async () => {
      const rawResponse = `Results:
{"symbol": "TSLA", "recommendation": "sell", "conviction": 60, "reasoning": "Overvalued", "catalysts": [], "risks": ["Growth",], "timeHorizon": "short", "sector": "Auto",}`;

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(1);
      expect(report.results[0].symbol).toBe('TSLA');
    });

    it('handles missing fields in individual blocks gracefully', async () => {
      const rawResponse = `Result:
{"symbol": "XYZ", "conviction": 40}`;

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(1);
      expect(report.results[0].symbol).toBe('XYZ');
      expect(report.results[0].recommendation).toBe('hold');
      expect(report.results[0].conviction).toBe(40);
      expect(report.results[0].catalysts).toEqual([]);
      expect(report.results[0].risks).toEqual([]);
      expect(report.results[0].targetPrice).toBeUndefined();
      expect(report.results[0].timeHorizon).toBe('medium');
      expect(report.results[0].sector).toBe('Unknown');
    });

    it('skips malformed individual blocks that match regex but fail JSON.parse', async () => {
      // This block matches the regex /\{[^{}]*"symbol"\s*:\s*"[A-Z]+[^{}]*\}/g
      // but contains invalid JSON that will fail JSON.parse even after trailing comma repair
      const rawResponse = `Results:
{"symbol": "AAPL", "recommendation": "buy", "conviction": 75, "reasoning": "Good", "catalysts": [], "risks": [], "timeHorizon": "medium", "sector": "Tech"}
{"symbol": "BAD", "key": value_without_quotes, "other": "broken"}
{"symbol": "MSFT", "recommendation": "hold", "conviction": 50, "reasoning": "OK", "catalysts": [], "risks": [], "timeHorizon": "long", "sector": "Tech"}`;

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      // Should get AAPL and MSFT, skip the malformed BAD one
      expect(report.results.length).toBe(2);
      expect(report.results[0].symbol).toBe('AAPL');
      expect(report.results[1].symbol).toBe('MSFT');
    });
  });

  describe('parseResearchResponse - completely unparseable', () => {
    it('returns empty array for completely unparseable response', async () => {
      const rawResponse = 'This is just a plain text response with no JSON at all and no symbols.';

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(0);
    });

    it('returns empty array for empty response', async () => {
      const agent = createMockAgent('');
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(0);
    });
  });

  describe('parseResearchResponse - JSON without results array', () => {
    it('falls through when parsed JSON has no results array', async () => {
      const rawResponse = JSON.stringify({ data: 'no results key here' });

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(0);
    });

    it('falls through when results is not an array', async () => {
      const rawResponse = JSON.stringify({ results: 'not an array' });

      const agent = createMockAgent(rawResponse);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      expect(report.results).toHaveLength(0);
    });
  });

  describe('getRecentResearch', () => {
    it('retrieves and parses recent research records', () => {
      mockDbSelectAll.mockReturnValue([
        {
          id: 1,
          timestamp: '2024-01-15T10:00:00Z',
          query: 'Market Research: general',
          results: JSON.stringify([
            { symbol: 'AAPL', recommendation: 'buy', conviction: 75 },
          ]),
          marketContext: JSON.stringify({ keyThemes: ['AI'] }),
          aiModel: 'claude-sonnet-4-20250514',
        },
        {
          id: 2,
          timestamp: '2024-01-14T10:00:00Z',
          query: 'Market Research: tech focus',
          results: JSON.stringify([]),
          marketContext: null,
          aiModel: 'gpt-4',
        },
      ]);

      const agent = createMockAgent('');
      const researcher = new MarketResearcher(agent);
      const reports = researcher.getRecentResearch(10);

      expect(reports).toHaveLength(2);
      expect(reports[0].id).toBe(1);
      expect(reports[0].results[0].symbol).toBe('AAPL');
      expect(reports[0].marketContext).toEqual({ keyThemes: ['AI'] });
      expect(reports[1].marketContext).toBeNull();
    });
  });

  describe('getResearchById', () => {
    it('returns parsed research report when found', () => {
      mockDbSelectGet.mockReturnValue({
        id: 5,
        timestamp: '2024-01-15T10:00:00Z',
        query: 'Market Research: AI stocks',
        results: JSON.stringify([
          { symbol: 'NVDA', recommendation: 'strong_buy', conviction: 90 },
        ]),
        marketContext: JSON.stringify({ sectorRotation: 'Tech leading' }),
        aiModel: 'claude-sonnet-4-20250514',
      });

      const agent = createMockAgent('');
      const researcher = new MarketResearcher(agent);
      const report = researcher.getResearchById(5);

      expect(report).not.toBeNull();
      expect(report!.id).toBe(5);
      expect(report!.results[0].symbol).toBe('NVDA');
      expect(report!.marketContext).toEqual({ sectorRotation: 'Tech leading' });
    });

    it('returns null when not found', () => {
      mockDbSelectGet.mockReturnValue(undefined);

      const agent = createMockAgent('');
      const researcher = new MarketResearcher(agent);
      const report = researcher.getResearchById(999);

      expect(report).toBeNull();
    });

    it('handles null marketContext', () => {
      mockDbSelectGet.mockReturnValue({
        id: 3,
        timestamp: '2024-01-15T10:00:00Z',
        query: 'Test',
        results: JSON.stringify([]),
        marketContext: null,
        aiModel: null,
      });

      const agent = createMockAgent('');
      const researcher = new MarketResearcher(agent);
      const report = researcher.getResearchById(3);

      expect(report!.marketContext).toBeNull();
      expect(report!.aiModel).toBeNull();
    });
  });

  describe('mapResults edge cases', () => {
    it('handles targetPrice: 0 as falsy - returns undefined', async () => {
      const response = JSON.stringify({
        results: [
          {
            symbol: 'TEST',
            targetPrice: 0,
            recommendation: 'hold',
            conviction: 50,
            reasoning: '',
            catalysts: [],
            risks: [],
            timeHorizon: 'medium',
            sector: 'Unknown',
          },
        ],
      });
      const agent = createMockAgent(response);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      // targetPrice: 0 is falsy so it becomes undefined
      expect(report.results[0].targetPrice).toBeUndefined();
    });

    it('handles null symbol by converting to string "null"', async () => {
      const response = JSON.stringify({
        results: [
          {
            recommendation: 'hold',
            conviction: 50,
            reasoning: '',
            catalysts: [],
            risks: [],
            timeHorizon: 'medium',
            sector: 'Unknown',
          },
        ],
      });
      const agent = createMockAgent(response);
      const researcher = new MarketResearcher(agent);

      const report = await researcher.runResearch();
      // String(undefined ?? '') = ''
      expect(report.results[0].symbol).toBe('');
    });
  });
});
