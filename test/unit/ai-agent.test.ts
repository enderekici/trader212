import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the adapters before importing the module under test
vi.mock('../../src/ai/adapters/anthropic.js', () => ({
  AnthropicAdapter: vi.fn().mockImplementation(function () {
    return { analyze: vi.fn(), rawChat: vi.fn() };
  }),
}));

vi.mock('../../src/ai/adapters/ollama.js', () => ({
  OllamaAdapter: vi.fn().mockImplementation(function () {
    return { analyze: vi.fn(), rawChat: vi.fn() };
  }),
}));

vi.mock('../../src/ai/adapters/openai-compat.js', () => ({
  OpenAICompatibleAdapter: vi.fn().mockImplementation(function () {
    return { analyze: vi.fn(), rawChat: vi.fn() };
  }),
}));

vi.mock('../../src/ai/consensus.js', () => ({
  ConsensusEngine: vi.fn().mockImplementation(function () {
    return { analyze: vi.fn(), rawChat: vi.fn() };
  }),
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

import { createAIAgent, safeParseJson } from '../../src/ai/agent.js';
import { configManager } from '../../src/config/manager.js';
import { AnthropicAdapter } from '../../src/ai/adapters/anthropic.js';
import { OllamaAdapter } from '../../src/ai/adapters/ollama.js';
import { OpenAICompatibleAdapter } from '../../src/ai/adapters/openai-compat.js';
import { ConsensusEngine } from '../../src/ai/consensus.js';

describe('createAIAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockLegacyProvider(provider: string) {
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'ai.provider') return provider;
      if (key === 'ai.primaryModel') return '';
      if (key === 'ai.models') return '"[]"';
      if (key === 'ai.consensus.enabled') return false;
      return undefined;
    });
  }

  it('returns OllamaAdapter when provider is "ollama"', () => {
    mockLegacyProvider('ollama');
    const agent = createAIAgent();
    expect(OllamaAdapter).toHaveBeenCalledOnce();
    expect(agent).toBeDefined();
    expect(agent.analyze).toBeDefined();
    expect(agent.rawChat).toBeDefined();
  });

  it('returns OpenAICompatibleAdapter when provider is "openai-compatible"', () => {
    mockLegacyProvider('openai-compatible');
    const agent = createAIAgent();
    expect(OpenAICompatibleAdapter).toHaveBeenCalledOnce();
    expect(agent).toBeDefined();
  });

  it('returns AnthropicAdapter as default when provider is "anthropic"', () => {
    mockLegacyProvider('anthropic');
    const agent = createAIAgent();
    expect(AnthropicAdapter).toHaveBeenCalledOnce();
    expect(agent).toBeDefined();
  });

  it('returns AnthropicAdapter as default for unknown provider', () => {
    mockLegacyProvider('some-unknown-provider');
    const agent = createAIAgent();
    expect(AnthropicAdapter).toHaveBeenCalledOnce();
    expect(agent).toBeDefined();
  });

  it('returns OpenAICompatibleAdapter with profile when primaryModel is set', () => {
    const profile = { id: 'my-model', baseUrl: 'http://x/v1', model: 'gpt-4', apiKey: 'k', weight: 1, enabled: true };
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'ai.provider') return 'anthropic';
      if (key === 'ai.primaryModel') return 'my-model';
      if (key === 'ai.models') return JSON.stringify([profile]);
      if (key === 'ai.consensus.enabled') return false;
      return undefined;
    });
    const agent = createAIAgent();
    expect(OpenAICompatibleAdapter).toHaveBeenCalledWith(profile);
    expect(agent).toBeDefined();
  });

  it('creates ConsensusEngine when consensus is enabled with multiple profiles', () => {
    const profiles = [
      { id: 'a', baseUrl: 'http://a/v1', model: 'gpt-4', apiKey: 'k1', weight: 1, enabled: true },
      { id: 'b', baseUrl: 'http://b/v1', model: 'gpt-3.5', apiKey: 'k2', weight: 1, enabled: true },
    ];
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'ai.provider') return 'anthropic';
      if (key === 'ai.primaryModel') return '';
      if (key === 'ai.models') return JSON.stringify(profiles);
      if (key === 'ai.consensus.enabled') return true;
      if (key === 'ai.consensus.mode') return 'weighted';
      if (key === 'ai.consensus.minAgree') return 2;
      return undefined;
    });
    const agent = createAIAgent();
    expect(ConsensusEngine).toHaveBeenCalledOnce();
    expect(agent).toBeDefined();
  });
});

describe('safeParseJson', () => {
  it('parses valid JSON and returns the value', () => {
    expect(safeParseJson('{"a":1}', {})).toEqual({ a: 1 });
    expect(safeParseJson('[1,2,3]', [])).toEqual([1, 2, 3]);
  });

  it('returns the fallback for invalid JSON', () => {
    expect(safeParseJson('not-json', 42)).toBe(42);
    expect(safeParseJson('', [])).toEqual([]);
  });

  it('returns the fallback for empty/null-like strings', () => {
    expect(safeParseJson('""', [])).toBe('');
    expect(safeParseJson('"[]"', [])).toBe('[]');
  });
});

