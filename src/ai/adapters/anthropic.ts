import Anthropic from '@anthropic-ai/sdk';
import { configManager } from '../../config/manager.js';
import { createLogger } from '../../utils/logger.js';
import type { AIAgent, AIContext, AIDecision } from '../agent.js';
import { processAIDecision } from '../decision-processor.js';
import { buildAnalysisPrompt } from '../prompt-builder.js';

const log = createLogger('ai-anthropic');

export class AnthropicAdapter implements AIAgent {
  async analyze(context: AIContext): Promise<AIDecision> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const client = new Anthropic({ apiKey });
    const model = configManager.get<string>('ai.model');
    const temperature = configManager.get<number>('ai.temperature');

    const { system, user } = buildAnalysisPrompt(context);

    log.info({ symbol: context.symbol, model }, 'Calling Anthropic API');

    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      temperature,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    log.debug(
      { symbol: context.symbol, responseLength: text.length },
      'Anthropic response received',
    );

    return processAIDecision(text);
  }

  async rawChat(system: string, user: string): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const client = new Anthropic({ apiKey });
    const model = configManager.get<string>('ai.model');
    const temperature = configManager.get<number>('ai.temperature');

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      temperature,
      system,
      messages: [{ role: 'user', content: user }],
    });

    return response.content[0].type === 'text' ? response.content[0].text : '';
  }
}
