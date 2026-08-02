/**
 * Unified error class for AI provider failures.
 *
 * Normalizes provider-specific errors (Anthropic 429, OpenAI 401, Ollama ECONNREFUSED)
 * into a consistent format the rest of the application can handle.
 */
export type AIErrorCode = 'auth' | 'missing_key' | 'rate_limit' | 'overloaded' | 'connection' | 'invalid_response' | 'unknown';
export declare class AIError extends Error {
    readonly code: AIErrorCode;
    readonly retryable: boolean;
    readonly retryAfterMs?: number | undefined;
    readonly cause?: unknown | undefined;
    constructor(message: string, code: AIErrorCode, retryable?: boolean, retryAfterMs?: number | undefined, cause?: unknown | undefined);
    /** User-friendly description with actionable guidance. */
    get userMessage(): string;
}
/**
 * Wrap any provider-specific error into a normalized AIError.
 * Each provider adapter calls this to unify error handling.
 */
export declare function wrapProviderError(err: unknown, provider: string): AIError;
//# sourceMappingURL=errors.d.ts.map