/**
 * Ollama provider implementation.
 *
 * Ollama exposes an OpenAI-compatible REST API, so we extend the OpenAI
 * provider with a custom base URL and a dummy API key.
 */
import type { AIProviderName } from '../types.js';
import { OpenAIProvider } from './openai-provider.js';
export declare class OllamaProvider extends OpenAIProvider {
    readonly name: AIProviderName;
    constructor(model?: string, baseUrl?: string);
}
//# sourceMappingURL=ollama-provider.d.ts.map