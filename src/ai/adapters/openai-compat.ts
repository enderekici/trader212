import axios from 'axios';
import { configManager } from '../../config/manager.js';
import { createLogger } from '../../utils/logger.js';
import type { AIAgent, AIContext, AIDecision } from '../agent.js';
import { processAIDecision } from '../decision-processor.js';
import { buildAnalysisPrompt } from '../prompt-builder.js';

const log = createLogger('ai-openai-compat');

export interface ModelProfile {
  id: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  weight: number;
  enabled: boolean;
  timeoutSeconds?: number;
}

export class OpenAICompatibleAdapter implements AIAgent {
  private profile: ModelProfile | null;

  constructor(profile?: ModelProfile) {
    this.profile = profile ?? null;
  }

  private getConfig(): { baseUrl: string; model: string; apiKey: string | null; timeout: number } {
    if (this.profile) {
      return {
        baseUrl: this.profile.baseUrl,
        model: this.profile.model,
        apiKey: this.profile.apiKey || null,
        timeout:
          (this.profile.timeoutSeconds ?? configManager.get<number>('ai.timeoutSeconds')) * 1000,
      };
    }
    return {
      baseUrl: configManager.get<string>('ai.openaiCompat.baseUrl'),
      model: configManager.get<string>('ai.openaiCompat.model'),
      apiKey: configManager.get<string>('ai.openaiCompat.apiKey') || null,
      timeout: configManager.get<number>('ai.timeoutSeconds') * 1000,
    };
  }

  private async postChat(
    baseUrl: string,
    payload: Record<string, unknown>,
    headers: Record<string, string>,
    timeout: number,
    allowJsonMode = true,
  ) {
    try {
      return await axios.post(`${baseUrl}/chat/completions`, payload, { headers, timeout });
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (allowJsonMode && status === 400 && payload.response_format) {
        const fallbackPayload = { ...payload } as Record<string, unknown>;
        delete fallbackPayload.response_format;
        return await axios.post(`${baseUrl}/chat/completions`, fallbackPayload, {
          headers,
          timeout,
        });
      }
      throw err;
    }
  }

  private async repairDecisionToJson(
    baseUrl: string,
    model: string,
    apiKey: string | null,
    timeout: number,
    rawText: string,
  ): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const system =
      'You are a formatter. Convert the input to valid JSON matching the schema. Output ONLY JSON.';
    const user = `Schema:\n{\n  "decision": "BUY|SELL|HOLD",\n  "conviction": 0-100,\n  "reasoning": "string",\n  "risks": ["string"],\n  "suggestedStopLossPct": 0.01-0.10,\n  "suggestedPositionSizePct": 0.03-0.15,\n  "suggestedTakeProfitPct": 0.05-0.30,\n  "urgency": "immediate|wait_for_dip|no_rush",\n  "exitConditions": "string"\n}\n\nInput:\n${rawText}`;
    const response = await this.postChat(
      baseUrl,
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      },
      headers,
      timeout,
      true,
    );
    return response.data.choices[0].message.content;
  }

  async analyze(context: AIContext): Promise<AIDecision | null> {
    const { baseUrl, model, apiKey, timeout } = this.getConfig();
    const temperature = configManager.get<number>('ai.temperature');

    const { system, user } = buildAnalysisPrompt(context);

    log.info({ symbol: context.symbol, model, baseUrl }, 'Calling OpenAI-compatible API');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await this.postChat(
      baseUrl,
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        response_format: { type: 'json_object' },
      },
      headers,
      timeout,
      true,
    );

    const text: string = response.data.choices[0].message.content;

    log.debug(
      { symbol: context.symbol, responseLength: text.length },
      'OpenAI-compatible response received',
    );

    const decision = processAIDecision(text);
    if (decision) return decision;

    try {
      const repaired = await this.repairDecisionToJson(baseUrl, model, apiKey, timeout, text);
      return processAIDecision(repaired);
    } catch (err) {
      log.warn({ err }, 'Decision repair failed');
      return null;
    }
  }

  async rawChat(system: string, user: string): Promise<string> {
    const { baseUrl, model, apiKey, timeout } = this.getConfig();

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await this.postChat(
      baseUrl,
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: configManager.get<number>('ai.temperature'),
      },
      headers,
      timeout,
      false,
    );

    return response.data.choices[0].message.content;
  }
}
