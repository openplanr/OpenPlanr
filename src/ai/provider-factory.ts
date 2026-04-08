/**
 * Factory for creating AI provider instances.
 *
 * Uses dynamic imports to lazy-load SDK dependencies — the heavy
 * @anthropic-ai/sdk and openai packages are only loaded when AI
 * features are actually invoked.
 */

import { AIError } from './errors.js';
import type { AIProvider, AIProviderConfig } from './types.js';
import { ENV_KEY_MAP, PROVIDER_LABELS } from './types.js';

function throwMissingKeyError(provider: string): never {
  const label = PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] ?? provider;
  const envVar = ENV_KEY_MAP[provider];

  const lines = [
    '',
    `  API key not configured for ${label}.`,
    '',
    '  Set it up with one of these options:',
    '',
    `    planr config set-key ${provider}`,
    ...(envVar ? [`    export ${envVar}=<your-key>`] : []),
    '',
    '  Your key is stored securely in the OS keychain or encrypted file.',
    '',
  ];

  throw new AIError(lines.join('\n'), 'missing_key');
}

export async function createAIProvider(config: AIProviderConfig): Promise<AIProvider> {
  switch (config.provider) {
    case 'anthropic': {
      if (!config.apiKey) throwMissingKeyError(config.provider);
      const { AnthropicProvider } = await import('./providers/anthropic-provider.js');
      return new AnthropicProvider(config.apiKey, config.model);
    }

    case 'openai': {
      if (!config.apiKey) throwMissingKeyError(config.provider);
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
        'unknown',
      );
  }
}
