/**
 * Core type definitions for the AI provider abstraction layer.
 *
 * All AI providers (Anthropic, OpenAI, Ollama) implement the `AIProvider`
 * interface, enabling seamless switching between backends.
 */
export interface AIMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface AIRequestOptions {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
}
export interface AIProviderConfig {
    provider: AIProviderName;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
}
export type AIProviderName = 'anthropic' | 'openai' | 'ollama';
export type { CodingAgentName } from '../models/types.js';
/** Token usage returned by AI providers after a call. */
export interface AIUsage {
    inputTokens: number;
    outputTokens: number;
    /** Whether the response was truncated because it hit the max_tokens limit. */
    truncated?: boolean;
}
/** Default max output tokens when no command-specific budget is set. */
export declare const DEFAULT_MAX_TOKENS = 8192;
/**
 * Per-command token budgets tuned to typical output sizes.
 * Commands producing larger outputs get higher budgets.
 */
export declare const TOKEN_BUDGETS: {
    readonly epic: 8192;
    readonly feature: 8192;
    readonly story: 8192;
    readonly task: 16384;
    readonly taskFeature: 32768;
    readonly refine: 8192;
    /** Used by the `planr plan` pipeline for task generation per story. */
    readonly plan: 16384;
    readonly estimate: 4096;
    readonly backlogPrioritize: 8192;
    readonly sprintAutoSelect: 8192;
    /** `planr revise` — decision JSON is small, but revisedMarkdown may rewrite a full artifact. */
    readonly revise: 16384;
};
export interface AIProvider {
    readonly name: AIProviderName;
    readonly model: string;
    /**
     * Stream a chat completion, yielding text chunks as they arrive.
     * Use this for real-time terminal output during generation.
     */
    chat(messages: AIMessage[], options?: AIRequestOptions): AsyncIterable<string>;
    /**
     * Get a complete chat response (non-streaming).
     * Use this when you need the full response before processing (e.g., JSON parsing).
     */
    chatSync(messages: AIMessage[], options?: AIRequestOptions): Promise<string>;
    /**
     * Get token usage from the most recent call (chat or chatSync).
     * Returns undefined if the provider doesn't support usage reporting.
     */
    getLastUsage(): AIUsage | undefined;
}
export declare const DEFAULT_MODELS: Record<AIProviderName, string>;
/** Environment variable names for API keys. Only cloud providers have entries; Ollama needs no key. */
export declare const ENV_KEY_MAP: Record<string, string>;
/** Human-readable display names for AI providers. */
export declare const PROVIDER_LABELS: Record<AIProviderName, string>;
//# sourceMappingURL=types.d.ts.map