import axios from 'axios';
import { configManager } from '../../config/manager.js';
import { createLogger } from '../../utils/logger.js';
import type { AIAgent, AIContext, AIDecision } from '../agent.js';
import { processAIDecision } from '../decision-processor.js';
import { buildAnalysisPrompt } from '../prompt-builder.js';

const log = createLogger('ai-ollama');

export class OllamaAdapter implements AIAgent {
  async analyze(context: AIContext): Promise<AIDecision | null> {
    const baseUrl = configManager.get<string>('ai.ollama.baseUrl');
    const model = configManager.get<string>('ai.ollama.model');
    const timeout = configManager.get<number>('ai.timeoutSeconds') * 1000;

    const { system, user } = buildAnalysisPrompt(context);

    log.info({ symbol: context.symbol, model, baseUrl }, 'Calling Ollama API');

    const response = await axios.post(
      `${baseUrl}/api/chat`,
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: false,
        format: 'json',
      },
      { timeout },
    );

    const text: string = response.data.message.content;

    log.debug({ symbol: context.symbol, responseLength: text.length }, 'Ollama response received');

    return processAIDecision(text);
  }

  async rawChat(system: string, user: string): Promise<string> {
    const baseUrl = configManager.get<string>('ai.ollama.baseUrl');
    const model = configManager.get<string>('ai.ollama.model');
    const timeout = configManager.get<number>('ai.timeoutSeconds') * 1000;

    const response = await axios.post(
      `${baseUrl}/api/chat`,
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: false,
      },
      { timeout },
    );

    return response.data.message.content;
  }
}
