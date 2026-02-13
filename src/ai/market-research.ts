import { desc, eq } from 'drizzle-orm';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import { aiResearch } from '../db/schema.js';
import { createLogger } from '../utils/logger.js';
import type { AIAgent } from './agent.js';

const log = createLogger('market-research');

export interface ResearchResult {
  symbol: string;
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  conviction: number; // 0-100
  reasoning: string;
  catalysts: string[];
  risks: string[];
  targetPrice?: number;
  timeHorizon: string; // 'short' | 'medium' | 'long'
  sector: string;
}

export interface MarketResearchReport {
  id: number;
  timestamp: string;
  query: string;
  results: ResearchResult[];
  marketContext: {
    spyTrend: string;
    vixLevel: number;
    sectorRotation: string;
    keyThemes: string[];
  } | null;
  aiModel: string | null;
}

export class MarketResearcher {
  private aiAgent: AIAgent;

  constructor(aiAgent: AIAgent) {
    this.aiAgent = aiAgent;
  }

  async runResearch(options?: {
    sectors?: string[];
    focus?: string;
    symbols?: string[];
  }): Promise<MarketResearchReport> {
    const topCount = configManager.get<number>('ai.research.topStocksCount');

    // Build the research prompt
    const focus = options?.focus ?? 'general market opportunities';
    const sectorFilter = options?.sectors?.length
      ? `Focus on these sectors: ${options.sectors.join(', ')}.`
      : 'Consider all sectors.';
    const symbolFilter = options?.symbols?.length
      ? `Specifically analyze these symbols: ${options.symbols.join(', ')}.`
      : `Identify the top ${topCount} most promising stocks.`;

    const query = `Market Research: ${focus}`;

    const prompt = this.buildResearchPrompt(focus, sectorFilter, symbolFilter, topCount);

    try {
      const systemPrompt =
        'You are a market research analyst. Respond ONLY with valid JSON matching the schema provided. No additional text, explanations, or markdown outside the JSON.';

      const rawResponse = await this.aiAgent.rawChat(systemPrompt, prompt);

      // Parse AI response
      const results = this.parseResearchResponse(rawResponse, options?.symbols);

      // Store in DB
      const db = getDb();
      const now = new Date().toISOString();
      const row = db
        .insert(aiResearch)
        .values({
          timestamp: now,
          query,
          symbols: JSON.stringify(results.map((r) => r.symbol)),
          results: JSON.stringify(results),
          aiModel: configManager.get<string>('ai.model'),
          marketContext: null,
          createdAt: now,
        })
        .run();

      const report: MarketResearchReport = {
        id: Number(row.lastInsertRowid),
        timestamp: now,
        query,
        results,
        marketContext: null,
        aiModel: configManager.get<string>('ai.model'),
      };

      log.info({ resultCount: results.length, query }, 'Market research completed');
      return report;
    } catch (err) {
      log.error({ err, query }, 'Market research failed');
      throw err;
    }
  }

  getRecentResearch(limit = 10): MarketResearchReport[] {
    const db = getDb();
    const rows = db
      .select()
      .from(aiResearch)
      .orderBy(desc(aiResearch.timestamp))
      .limit(limit)
      .all();

    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      query: r.query,
      results: JSON.parse(r.results) as ResearchResult[],
      marketContext: r.marketContext ? JSON.parse(r.marketContext) : null,
      aiModel: r.aiModel,
    }));
  }

  getResearchById(id: number): MarketResearchReport | null {
    const db = getDb();
    const row = db.select().from(aiResearch).where(eq(aiResearch.id, id)).get();

    if (!row) return null;

    return {
      id: row.id,
      timestamp: row.timestamp,
      query: row.query,
      results: JSON.parse(row.results) as ResearchResult[],
      marketContext: row.marketContext ? JSON.parse(row.marketContext) : null,
      aiModel: row.aiModel,
    };
  }

  private buildResearchPrompt(
    focus: string,
    sectorFilter: string,
    symbolFilter: string,
    _topCount: number,
  ): string {
    return `You are a market research analyst. Your task: ${focus}

${sectorFilter}
${symbolFilter}

For each stock, provide your analysis in this JSON format:
{
  "results": [
    {
      "symbol": "TICKER",
      "recommendation": "strong_buy|buy|hold|sell|strong_sell",
      "conviction": 0-100,
      "reasoning": "2-3 sentence analysis",
      "catalysts": ["catalyst1", "catalyst2"],
      "risks": ["risk1", "risk2"],
      "targetPrice": 123.45,
      "timeHorizon": "short|medium|long",
      "sector": "Technology"
    }
  ],
  "marketContext": {
    "keyThemes": ["theme1", "theme2"],
    "sectorRotation": "description of sector trends"
  }
}

Focus on actionable opportunities with clear catalysts. Consider:
- Technical momentum and trend strength
- Fundamental valuation relative to growth
- Recent news and sentiment catalysts
- Earnings expectations and surprises
- Sector rotation and market regime
- Risk/reward profile

Return ONLY the JSON, no other text.`;
  }

  private parseResearchResponse(rawText: string, _requestedSymbols?: string[]): ResearchResult[] {
    // Strip <think>...</think> tags from thinking models (e.g. Qwen3)
    let text = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // Strip markdown code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) text = codeBlockMatch[1].trim();

    // Try to repair common JSON issues from small models
    const repaired = text
      .replace(/,\s*([}\]])/g, '$1') // trailing commas
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":') // unquoted keys
      .replace(/:\s*'([^']*)'/g, ': "$1"'); // single-quoted strings

    const attempts = [text, repaired];
    for (const candidate of attempts) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed.results && Array.isArray(parsed.results)) {
          return this.mapResults(parsed.results);
        }
      } catch {
        // try next candidate
      }
    }

    // Last resort: try to extract individual result objects
    try {
      const resultBlocks = text.match(/\{[^{}]*"symbol"\s*:\s*"[A-Z]+[^{}]*\}/g);
      if (resultBlocks && resultBlocks.length > 0) {
        const results: ResearchResult[] = [];
        for (const block of resultBlocks) {
          try {
            const repaired2 = block.replace(/,\s*([}\]])/g, '$1');
            const obj = JSON.parse(repaired2);
            results.push({
              symbol: String(obj.symbol ?? ''),
              recommendation: obj.recommendation ?? 'hold',
              conviction: Number(obj.conviction ?? 50),
              reasoning: String(obj.reasoning ?? ''),
              catalysts: Array.isArray(obj.catalysts) ? obj.catalysts : [],
              risks: Array.isArray(obj.risks) ? obj.risks : [],
              targetPrice: obj.targetPrice ? Number(obj.targetPrice) : undefined,
              timeHorizon: obj.timeHorizon ?? 'medium',
              sector: String(obj.sector ?? 'Unknown'),
            });
          } catch {
            // skip malformed block
          }
        }
        if (results.length > 0) {
          log.info(
            { count: results.length },
            'Extracted research results via individual block parsing',
          );
          return results;
        }
      }
    } catch {
      // fall through
    }

    log.warn(
      { rawLength: rawText.length, cleanedLength: text.length, sample: text.slice(0, 500) },
      'Could not parse AI research response',
    );
    return [];
  }

  private mapResults(results: Record<string, unknown>[]): ResearchResult[] {
    return results.map((r: Record<string, unknown>) => ({
      symbol: String(r.symbol ?? ''),
      recommendation: String(r.recommendation ?? 'hold') as ResearchResult['recommendation'],
      conviction: Number(r.conviction ?? 50),
      reasoning: String(r.reasoning ?? ''),
      catalysts: Array.isArray(r.catalysts) ? (r.catalysts as string[]) : [],
      risks: Array.isArray(r.risks) ? (r.risks as string[]) : [],
      targetPrice: r.targetPrice ? Number(r.targetPrice) : undefined,
      timeHorizon: String(r.timeHorizon ?? 'medium') as ResearchResult['timeHorizon'],
      sector: String(r.sector ?? 'Unknown'),
    }));
  }
}
