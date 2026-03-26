/**
 * Ollama provider implementation.
 *
 * Ollama exposes an OpenAI-compatible REST API, so we extend the OpenAI
 * provider with a custom base URL and a dummy API key.
 */

import type { AIProviderName } from '../types.js';
import { OpenAIProvider } from './openai-provider.js';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434/v1';

export class OllamaProvider extends OpenAIProvider {
  override readonly name: AIProviderName = 'ollama';

  constructor(model?: string, baseUrl?: string) {
    super(
      'ollama', // Ollama doesn't require an API key
      model || 'llama3.1',
      baseUrl || DEFAULT_OLLAMA_URL
    );
  }
}
