import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the adapters before importing the module under test
vi.mock('../../src/ai/adapters/anthropic.js', () => ({
  AnthropicAdapter: vi.fn().mockImplementation(() => ({
    analyze: vi.fn(),
    rawChat: vi.fn(),
  })),
}));

vi.mock('../../src/ai/adapters/ollama.js', () => ({
  OllamaAdapter: vi.fn().mockImplementation(() => ({
    analyze: vi.fn(),
    rawChat: vi.fn(),
  })),
}));

vi.mock('../../src/ai/adapters/openai-compat.js', () => ({
  OpenAICompatibleAdapter: vi.fn().mockImplementation(() => ({
    analyze: vi.fn(),
    rawChat: vi.fn(),
  })),
}));

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

import { createAIAgent } from '../../src/ai/agent.js';
import { configManager } from '../../src/config/manager.js';
import { AnthropicAdapter } from '../../src/ai/adapters/anthropic.js';
import { OllamaAdapter } from '../../src/ai/adapters/ollama.js';
import { OpenAICompatibleAdapter } from '../../src/ai/adapters/openai-compat.js';

describe('createAIAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns OllamaAdapter when provider is "ollama"', () => {
    vi.mocked(configManager.get).mockReturnValue('ollama');
    const agent = createAIAgent();
    expect(OllamaAdapter).toHaveBeenCalledOnce();
    expect(agent).toBeDefined();
    expect(agent.analyze).toBeDefined();
    expect(agent.rawChat).toBeDefined();
  });

  it('returns OpenAICompatibleAdapter when provider is "openai-compatible"', () => {
    vi.mocked(configManager.get).mockReturnValue('openai-compatible');
    const agent = createAIAgent();
    expect(OpenAICompatibleAdapter).toHaveBeenCalledOnce();
    expect(agent).toBeDefined();
  });

  it('returns AnthropicAdapter as default when provider is "anthropic"', () => {
    vi.mocked(configManager.get).mockReturnValue('anthropic');
    const agent = createAIAgent();
    expect(AnthropicAdapter).toHaveBeenCalledOnce();
    expect(agent).toBeDefined();
  });

  it('returns AnthropicAdapter as default for unknown provider', () => {
    vi.mocked(configManager.get).mockReturnValue('some-unknown-provider');
    const agent = createAIAgent();
    expect(AnthropicAdapter).toHaveBeenCalledOnce();
    expect(agent).toBeDefined();
  });

  it('returns AnthropicAdapter as default when provider is undefined', () => {
    vi.mocked(configManager.get).mockReturnValue(undefined);
    const agent = createAIAgent();
    expect(AnthropicAdapter).toHaveBeenCalledOnce();
  });
});
