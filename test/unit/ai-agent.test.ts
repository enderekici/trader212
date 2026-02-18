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

vi.mock('../../src/ai/rules-engine.js', () => ({
  RulesEngine: vi.fn().mockImplementation(function () {
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

import { createAIAgent, getActiveModelName, safeParseJson } from '../../src/ai/agent.js';
import { configManager } from '../../src/config/manager.js';
import { AnthropicAdapter } from '../../src/ai/adapters/anthropic.js';
import { OllamaAdapter } from '../../src/ai/adapters/ollama.js';
import { OpenAICompatibleAdapter } from '../../src/ai/adapters/openai-compat.js';
import { ConsensusEngine } from '../../src/ai/consensus.js';
import { RulesEngine } from '../../src/ai/rules-engine.js';

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

  it('returns RulesEngine when provider is "rules" (legacy path)', () => {
    mockLegacyProvider('rules');
    const agent = createAIAgent();
    expect(RulesEngine).toHaveBeenCalledOnce();
    expect(agent).toBeDefined();
  });

  it('falls back to AnthropicAdapter when primaryId set but no matching enabled profile', () => {
    const profiles = [
      { id: 'other', baseUrl: 'http://x/v1', model: 'gpt-4', apiKey: 'k', weight: 1, enabled: true },
    ];
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'ai.provider') return 'anthropic';
      if (key === 'ai.primaryModel') return 'nonexistent-id';
      if (key === 'ai.models') return JSON.stringify(profiles);
      if (key === 'ai.consensus.enabled') return false;
      return undefined;
    });
    const agent = createAIAgent();
    // falls through to legacy path -> AnthropicAdapter
    expect(AnthropicAdapter).toHaveBeenCalledOnce();
    expect(agent).toBeDefined();
  });
});

describe('getActiveModelName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns profile id/model when primaryId matches an enabled profile', () => {
    const profile = { id: 'my-model', baseUrl: 'http://x/v1', model: 'gpt-4', apiKey: 'k', weight: 1, enabled: true };
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'ai.provider') return 'openai-compatible';
      if (key === 'ai.primaryModel') return 'my-model';
      if (key === 'ai.models') return JSON.stringify([profile]);
      return undefined;
    });
    expect(getActiveModelName()).toBe('my-model/gpt-4');
  });

  it('falls through to switch when primaryId set but no matching enabled profile', () => {
    const profile = { id: 'other', baseUrl: 'http://x/v1', model: 'gpt-4', apiKey: 'k', weight: 1, enabled: true };
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'ai.provider') return 'ollama';
      if (key === 'ai.primaryModel') return 'nonexistent';
      if (key === 'ai.models') return JSON.stringify([profile]);
      if (key === 'ai.ollama.model') return 'llama3';
      return undefined;
    });
    expect(getActiveModelName()).toBe('llama3');
  });

  it('returns ollama model name when provider is ollama', () => {
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'ai.provider') return 'ollama';
      if (key === 'ai.primaryModel') return '';
      if (key === 'ai.models') return '[]';
      if (key === 'ai.ollama.model') return 'llama3.2';
      return undefined;
    });
    expect(getActiveModelName()).toBe('llama3.2');
  });

  it('returns openai-compat model name when provider is openai-compatible', () => {
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'ai.provider') return 'openai-compatible';
      if (key === 'ai.primaryModel') return '';
      if (key === 'ai.models') return '[]';
      if (key === 'ai.openaiCompat.model') return 'gpt-4o';
      return undefined;
    });
    expect(getActiveModelName()).toBe('gpt-4o');
  });

  it('returns "rules-engine" when provider is rules', () => {
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'ai.provider') return 'rules';
      if (key === 'ai.primaryModel') return '';
      if (key === 'ai.models') return '[]';
      return undefined;
    });
    expect(getActiveModelName()).toBe('rules-engine');
  });

  it('returns anthropic model name as default', () => {
    vi.mocked(configManager.get).mockImplementation((key: string) => {
      if (key === 'ai.provider') return 'anthropic';
      if (key === 'ai.primaryModel') return '';
      if (key === 'ai.models') return '[]';
      if (key === 'ai.model') return 'claude-opus-4-5';
      return undefined;
    });
    expect(getActiveModelName()).toBe('claude-opus-4-5');
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

