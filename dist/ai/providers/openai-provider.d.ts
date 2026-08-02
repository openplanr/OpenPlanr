/**
 * OpenAI provider implementation.
 *
 * Uses the official openai SDK with streaming and JSON mode support.
 * Also serves as the base for the Ollama provider (OpenAI-compatible API).
 */
import type { AIMessage, AIProvider, AIProviderName, AIRequestOptions, AIUsage } from '../types.js';
export declare class OpenAIProvider implements AIProvider {
    readonly name: AIProviderName;
    readonly model: string;
    protected clientPromise: Promise<InstanceType<typeof import('openai').default>>;
    private lastUsageData;
    constructor(apiKey: string, model?: string, baseUrl?: string);
    private initClient;
    chat(messages: AIMessage[], options?: AIRequestOptions): AsyncIterable<string>;
    chatSync(messages: AIMessage[], options?: AIRequestOptions): Promise<string>;
    getLastUsage(): AIUsage | undefined;
}
//# sourceMappingURL=openai-provider.d.ts.map