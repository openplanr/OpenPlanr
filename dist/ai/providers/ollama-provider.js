/**
 * Ollama provider implementation.
 *
 * Ollama exposes an OpenAI-compatible REST API, so we extend the OpenAI
 * provider with a custom base URL and a dummy API key.
 */
import { OpenAIProvider } from './openai-provider.js';
const DEFAULT_OLLAMA_URL = 'http://localhost:11434/v1';
export class OllamaProvider extends OpenAIProvider {
    name = 'ollama';
    constructor(model, baseUrl) {
        super('ollama', // Ollama doesn't require an API key
        model || 'llama3.1', baseUrl || DEFAULT_OLLAMA_URL);
    }
}
//# sourceMappingURL=ollama-provider.js.map