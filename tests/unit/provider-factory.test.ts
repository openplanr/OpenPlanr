import { describe, expect, it, vi } from 'vitest';
import { AIError } from '../../src/ai/errors.js';

// Mock the provider modules with proper class constructors
vi.mock('../../src/ai/providers/anthropic-provider.js', () => ({
  AnthropicProvider: class {
    name = 'anthropic';
    model: string;
    constructor(_apiKey: string, model?: string) {
      this.model = model || 'claude-sonnet-4-20250514';
    }
  },
}));

vi.mock('../../src/ai/providers/openai-provider.js', () => ({
  OpenAIProvider: class {
    name = 'openai';
    model: string;
    constructor(_apiKey: string, model?: string) {
      this.model = model || 'gpt-4o';
    }
  },
}));

vi.mock('../../src/ai/providers/ollama-provider.js', () => ({
  OllamaProvider: class {
    name = 'ollama';
    model: string;
    constructor(model?: string) {
      this.model = model || 'llama3.1';
    }
  },
}));

const { createAIProvider } = await import('../../src/ai/provider-factory.js');

describe('createAIProvider', () => {
  it('creates anthropic provider with API key', async () => {
    const provider = await createAIProvider({
      provider: 'anthropic',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-20250514',
    });
    expect(provider.name).toBe('anthropic');
  });

  it('throws auth error for anthropic without API key', async () => {
    try {
      await createAIProvider({ provider: 'anthropic' });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AIError);
      expect((err as AIError).code).toBe('auth');
      expect((err as AIError).message).toContain('Anthropic');
    }
  });

  it('creates openai provider with API key', async () => {
    const provider = await createAIProvider({
      provider: 'openai',
      apiKey: 'sk-test',
    });
    expect(provider.name).toBe('openai');
  });

  it('throws auth error for openai without API key', async () => {
    try {
      await createAIProvider({ provider: 'openai' });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AIError);
      expect((err as AIError).code).toBe('auth');
      expect((err as AIError).message).toContain('OpenAI');
    }
  });

  it('creates ollama provider without API key', async () => {
    const provider = await createAIProvider({ provider: 'ollama' });
    expect(provider.name).toBe('ollama');
  });

  it('throws for unknown provider', async () => {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input intentionally
      await createAIProvider({ provider: 'unknown' as any });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AIError);
    }
  });
});
