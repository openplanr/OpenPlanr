/**
 * High-level AI orchestration service.
 *
 * Bridges the gap between CLI commands and the AI provider layer.
 * Handles provider initialization, streaming output, and structured
 * JSON generation with Zod validation and retry logic.
 */
import type { ZodSchema } from 'zod';
import type { AIMessage, AIProvider, AIRequestOptions, AIUsage } from '../ai/types.js';
import type { OpenPlanrConfig } from '../models/types.js';
export declare function getAIProvider(config: OpenPlanrConfig, options?: {
    surface?: 'operate-structured-provider';
}): Promise<AIProvider>;
/**
 * Check whether AI is configured and available for a given project config.
 *
 * This is the cheap synchronous "a provider is named" check. It intentionally
 * does NOT resolve the API key — a named provider whose key is unreachable in
 * the current (possibly sandboxed) process still returns `true` here. Use
 * {@link resolveAIProviderReadiness} for the key-resolvability preflight before
 * a run so a missing key is named up front instead of crashing mid-cycle.
 */
export declare function isAIConfigured(config: OpenPlanrConfig): boolean;
/** Outcome of the AI provider readiness preflight. */
export interface AIProviderReadiness {
    /** A provider is named in the project config. */
    configured: boolean;
    /** The provider's credential could be resolved (or the provider needs none). */
    keyResolvable: boolean;
    /** The named provider, when one is configured. */
    provider?: string;
    /** Actionable remedy text when the provider is not ready. */
    remedy?: string;
}
/**
 * Preflight the AI provider for a project: confirm a provider is named AND that
 * its API key actually resolves in this environment (env var, OS keychain, or
 * encrypted file). Local providers (Ollama) authenticate against a local
 * endpoint and need no key. Returns an actionable remedy naming the missing key
 * so `run --preview`/readiness can surface it before a cycle starts.
 */
export declare function resolveAIProviderReadiness(config: OpenPlanrConfig): Promise<AIProviderReadiness>;
/**
 * Stream AI output to the terminal in real time.
 * Returns the fully accumulated text once streaming completes.
 */
export declare function streamToTerminal(stream: AsyncIterable<string>): Promise<string>;
/** Result from AI generation including the parsed data and optional token usage. */
export interface AIGenerateResult<T> {
    result: T;
    usage?: AIUsage;
}
export interface AIGenerateOptions extends AIRequestOptions {
    /**
     * Suppress all progress output. Machine-readable commands must enable this
     * so stdout remains a single protocol document.
     */
    quiet?: boolean;
}
/**
 * Generate a validated JSON response from the AI (non-streaming).
 *
 * Flow:
 * 1. Send messages with JSON mode hint
 * 2. Parse response as JSON
 * 3. Validate with Zod schema
 * 4. On failure, retry once with error feedback
 */
export declare function generateJSON<T>(provider: AIProvider, messages: AIMessage[], schema: ZodSchema<T>, options?: AIGenerateOptions): Promise<AIGenerateResult<T>>;
/**
 * Generate JSON with streaming — shows progress spinner in the terminal
 * while the AI generates, then parses the complete response.
 */
export declare function generateStreamingJSON<T>(provider: AIProvider, messages: AIMessage[], schema: ZodSchema<T>, options?: AIGenerateOptions): Promise<AIGenerateResult<T>>;
/** Accumulate token usage from a provider call into a running total. */
export declare function accumulateUsage(total: AIUsage, usage?: AIUsage): void;
//# sourceMappingURL=ai-service.d.ts.map