/**
 * Factory for creating AI provider instances.
 *
 * Uses dynamic imports to lazy-load SDK dependencies — the heavy
 * @anthropic-ai/sdk and openai packages are only loaded when AI
 * features are actually invoked.
 */

import type { AIProvider, AIProviderConfig } from './types.js';
import { AIError } from './errors.js';

export async function createAIProvider(config: AIProviderConfig): Promise<AIProvider> {
  switch (config.provider) {
    case 'anthropic': {
      if (!config.apiKey) {
        throw new AIError(
          'Anthropic API key is required. Run `planr config set-key anthropic` or set ANTHROPIC_API_KEY.',
          'auth'
        );
      }
      const { AnthropicProvider } = await import('./providers/anthropic-provider.js');
      return new AnthropicProvider(config.apiKey, config.model);
    }

    case 'openai': {
      if (!config.apiKey) {
        throw new AIError(
          'OpenAI API key is required. Run `planr config set-key openai` or set OPENAI_API_KEY.',
          'auth'
        );
      }
      const { OpenAIProvider } = await import('./providers/openai-provider.js');
      return new OpenAIProvider(config.apiKey, config.model, config.baseUrl);
    }

    case 'ollama': {
      const { OllamaProvider } = await import('./providers/ollama-provider.js');
      return new OllamaProvider(config.model, config.baseUrl);
    }

    default:
      throw new AIError(
        `Unknown AI provider: ${config.provider}. Supported: anthropic, openai, ollama.`,
        'unknown'
      );
  }
}
