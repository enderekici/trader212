import axios from 'axios';
import { configManager } from '../../config/manager.js';
import { createLogger } from '../../utils/logger.js';
import type { AIAgent, AIContext, AIDecision } from '../agent.js';
import { processAIDecision } from '../decision-processor.js';
import { buildAnalysisPrompt } from '../prompt-builder.js';

const log = createLogger('ai-openai-compat');

export class OpenAICompatibleAdapter implements AIAgent {
  async analyze(context: AIContext): Promise<AIDecision> {
    const baseUrl = configManager.get<string>('ai.openaiCompat.baseUrl');
    const model = configManager.get<string>('ai.openaiCompat.model');
    const apiKey = configManager.get<string>('ai.openaiCompat.apiKey');
    const temperature = configManager.get<number>('ai.temperature');
    const timeout = configManager.get<number>('ai.timeoutSeconds') * 1000;

    const { system, user } = buildAnalysisPrompt(context);

    log.info({ symbol: context.symbol, model, baseUrl }, 'Calling OpenAI-compatible API');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
      },
      { headers, timeout },
    );

    const text: string = response.data.choices[0].message.content;

    log.debug(
      { symbol: context.symbol, responseLength: text.length },
      'OpenAI-compatible response received',
    );

    return processAIDecision(text);
  }

  async rawChat(system: string, user: string): Promise<string> {
    const baseUrl = configManager.get<string>('ai.openaiCompat.baseUrl');
    const model = configManager.get<string>('ai.openaiCompat.model');
    const apiKey = configManager.get<string>('ai.openaiCompat.apiKey');
    const timeout = configManager.get<number>('ai.timeoutSeconds') * 1000;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: configManager.get<number>('ai.temperature'),
      },
      { headers, timeout },
    );

    return response.data.choices[0].message.content;
  }
}
