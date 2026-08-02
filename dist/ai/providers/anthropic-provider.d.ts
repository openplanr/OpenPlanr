/**
 * Anthropic Claude provider implementation.
 *
 * Uses the official @anthropic-ai/sdk with streaming support.
 * Lazily imported to avoid loading the SDK until actually needed.
 */
import type { AIMessage, AIProvider, AIProviderName, AIRequestOptions, AIUsage } from '../types.js';
export declare class AnthropicProvider implements AIProvider {
    readonly name: AIProviderName;
    readonly model: string;
    private clientPromise;
    private lastUsageData;
    constructor(apiKey: string, model?: string);
    private initClient;
    chat(messages: AIMessage[], options?: AIRequestOptions): AsyncIterable<string>;
    chatSync(messages: AIMessage[], options?: AIRequestOptions): Promise<string>;
    getLastUsage(): AIUsage | undefined;
    /**
     * Anthropic's API uses a separate `system` parameter rather than
     * a system role in the messages array.
     */
    private splitSystemMessage;
}
//# sourceMappingURL=anthropic-provider.d.ts.map