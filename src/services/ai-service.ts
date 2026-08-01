/**
 * High-level AI orchestration service.
 *
 * Bridges the gap between CLI commands and the AI provider layer.
 * Handles provider initialization, streaming output, and structured
 * JSON generation with Zod validation and retry logic.
 */

import type { ZodSchema } from 'zod';
import { AIError } from '../ai/errors.js';
import type {
  AIMessage,
  AIProvider,
  AIProviderConfig,
  AIRequestOptions,
  AIUsage,
} from '../ai/types.js';
import { ENV_KEY_MAP } from '../ai/types.js';
import type { OpenPlanrConfig } from '../models/types.js';
import { createSpinner, formatUsage } from '../utils/logger.js';
import { resolveApiKey } from './credentials-service.js';
import { printDeprecationNotice } from './deprecation-notices.js';

/**
 * Default AI temperature for structured JSON generation.
 * 0.5 balances creativity with consistency — low enough for reliable JSON,
 * high enough for varied feature/story/task descriptions.
 */
const DEFAULT_TEMPERATURE = 0.5;

/**
 * Initialize an AI provider from project config.
 * Dynamically imports the factory to keep non-AI commands fast.
 */
let operateProviderDeprecationPrinted = false;

export async function getAIProvider(
  config: OpenPlanrConfig,
  options: { surface?: 'operate-structured-provider' } = {},
): Promise<AIProvider> {
  if (options.surface === 'operate-structured-provider' && !operateProviderDeprecationPrinted) {
    printDeprecationNotice('operate-structured-provider');
    operateProviderDeprecationPrinted = true;
  }
  if (!config.ai) {
    throw new AIError(
      'AI is not configured. Run `planr init` or `planr config set-provider <name>`.',
      'auth',
    );
  }

  const apiKey = await resolveApiKey(config.ai.provider);

  const providerConfig: AIProviderConfig = {
    provider: config.ai.provider,
    model: config.ai.model,
    apiKey,
    baseUrl: config.ai.ollamaBaseUrl,
  };

  const { createAIProvider } = await import('../ai/provider-factory.js');
  return createAIProvider(providerConfig);
}

/**
 * Check whether AI is configured and available for a given project config.
 *
 * This is the cheap synchronous "a provider is named" check. It intentionally
 * does NOT resolve the API key — a named provider whose key is unreachable in
 * the current (possibly sandboxed) process still returns `true` here. Use
 * {@link resolveAIProviderReadiness} for the key-resolvability preflight before
 * a run so a missing key is named up front instead of crashing mid-cycle.
 */
export function isAIConfigured(config: OpenPlanrConfig): boolean {
  return config.ai != null && config.ai.provider != null;
}

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
export async function resolveAIProviderReadiness(
  config: OpenPlanrConfig,
): Promise<AIProviderReadiness> {
  if (!isAIConfigured(config) || config.ai == null) {
    return {
      configured: false,
      keyResolvable: false,
      remedy:
        'No AI provider is configured. Run `planr config set-provider <name>` then `planr config set-key <provider>`, or run offline with --offline.',
    };
  }
  const provider = config.ai.provider;
  if (provider === 'ollama') {
    return { configured: true, keyResolvable: true, provider };
  }
  const apiKey = await resolveApiKey(provider);
  if (apiKey) {
    return { configured: true, keyResolvable: true, provider };
  }
  const envVar = ENV_KEY_MAP[provider];
  return {
    configured: true,
    keyResolvable: false,
    provider,
    remedy: `No API key resolved for ${provider}. Run \`planr config set-key ${provider}\`${
      envVar ? ` or export ${envVar}` : ''
    }, or run offline with --offline.`,
  };
}

/**
 * Stream AI output to the terminal in real time.
 * Returns the fully accumulated text once streaming completes.
 */
export async function streamToTerminal(stream: AsyncIterable<string>): Promise<string> {
  const chunks: string[] = [];

  for await (const chunk of stream) {
    process.stdout.write(chunk);
    chunks.push(chunk);
  }

  // Ensure a trailing newline after streaming
  process.stdout.write('\n');
  return chunks.join('');
}

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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Throw a descriptive error when the AI response was truncated. */
function throwTruncationError(usage: AIUsage, maxTokens?: number, isRetry = false): never {
  const prefix = isRetry ? 'AI retry response' : 'AI response';
  const limit = maxTokens != null ? maxTokens.toLocaleString() : 'default';
  throw new AIError(
    `${prefix} was truncated at ${usage.outputTokens.toLocaleString()} output tokens (hit max_tokens limit of ${limit}). Try reducing the input scope or increasing the token budget.`,
    'invalid_response',
  );
}

/** Check usage for truncation; throw if truncated. */
function checkTruncation(usage: AIUsage | undefined, maxTokens?: number, isRetry = false): void {
  if (usage?.truncated) {
    throwTruncationError(usage, maxTokens, isRetry);
  }
}

/**
 * Core generation logic shared by generateJSON and generateStreamingJSON.
 *
 * Accepts a `fetchResponse` callback that performs the initial AI call
 * (sync or streaming), then handles validation, retry, truncation, and spinner.
 */
async function generateCore<T>(
  provider: AIProvider,
  messages: AIMessage[],
  schema: ZodSchema<T>,
  requestOptions: AIRequestOptions,
  fetchResponse: () => Promise<string>,
  quiet = false,
): Promise<AIGenerateResult<T>> {
  const totalUsage: AIUsage = { inputTokens: 0, outputTokens: 0 };

  const spinner = quiet
    ? {
        update() {},
        stop() {},
        succeed() {},
      }
    : createSpinner('Generating...');
  try {
    // --- First attempt ---
    let rawResponse = await fetchResponse();
    let lastUsage = provider.getLastUsage();
    accumulateUsage(totalUsage, lastUsage);
    checkTruncation(lastUsage, requestOptions.maxTokens);

    const parsed = tryParseAndValidate(rawResponse, schema);
    if (parsed.success) {
      spinner.succeed(`Done${formatUsage(totalUsage)}`);
      return { result: parsed.data, usage: totalUsage };
    }

    // --- Retry once with error feedback ---
    spinner.update('Retrying...');
    const retryMessages: AIMessage[] = [
      ...messages,
      { role: 'assistant', content: rawResponse },
      {
        role: 'user',
        content: `Your response was not valid JSON or failed validation:\n${parsed.error}\n\nPlease fix and return valid JSON only.`,
      },
    ];

    rawResponse = await provider.chatSync(retryMessages, requestOptions);
    lastUsage = provider.getLastUsage();
    accumulateUsage(totalUsage, lastUsage);
    checkTruncation(lastUsage, requestOptions.maxTokens, true);

    const retryParsed = tryParseAndValidate(rawResponse, schema);
    if (retryParsed.success) {
      spinner.succeed(`Done${formatUsage(totalUsage)}`);
      return { result: retryParsed.data, usage: totalUsage };
    }

    spinner.stop();
    throw new AIError(
      `AI returned invalid JSON after retry: ${retryParsed.error}`,
      'invalid_response',
    );
  } catch (err) {
    spinner.stop();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public generation functions
// ---------------------------------------------------------------------------

/**
 * Generate a validated JSON response from the AI (non-streaming).
 *
 * Flow:
 * 1. Send messages with JSON mode hint
 * 2. Parse response as JSON
 * 3. Validate with Zod schema
 * 4. On failure, retry once with error feedback
 */
export async function generateJSON<T>(
  provider: AIProvider,
  messages: AIMessage[],
  schema: ZodSchema<T>,
  options?: AIGenerateOptions,
): Promise<AIGenerateResult<T>> {
  const { quiet = false, ...providerOptions } = options ?? {};
  const requestOptions: AIRequestOptions = {
    temperature: DEFAULT_TEMPERATURE,
    ...providerOptions,
    jsonMode: true,
  };

  return generateCore(
    provider,
    messages,
    schema,
    requestOptions,
    () => provider.chatSync(messages, requestOptions),
    quiet,
  );
}

/**
 * Generate JSON with streaming — shows progress spinner in the terminal
 * while the AI generates, then parses the complete response.
 */
export async function generateStreamingJSON<T>(
  provider: AIProvider,
  messages: AIMessage[],
  schema: ZodSchema<T>,
  options?: AIGenerateOptions,
): Promise<AIGenerateResult<T>> {
  const { quiet = false, ...providerOptions } = options ?? {};
  const requestOptions: AIRequestOptions = {
    temperature: DEFAULT_TEMPERATURE,
    ...providerOptions,
    jsonMode: true,
  };

  return generateCore(
    provider,
    messages,
    schema,
    requestOptions,
    async () => {
      const chunks: string[] = [];
      const stream = provider.chat(messages, requestOptions);
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      return chunks.join('');
    },
    quiet,
  );
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/** Extract JSON from a response that might contain markdown code fences. */
function extractJSON(raw: string): string {
  // Strip markdown code fences if present
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) return fenceMatch[1].trim();
  return raw.trim();
}

/** Accumulate token usage from a provider call into a running total. */
export function accumulateUsage(total: AIUsage, usage?: AIUsage): void {
  if (usage) {
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
  }
}

function tryParseAndValidate<T>(
  raw: string,
  schema: ZodSchema<T>,
): { success: true; data: T } | { success: false; error: string } {
  try {
    const cleaned = extractJSON(raw);
    const json = JSON.parse(cleaned);
    const result = schema.safeParse(json);

    if (result.success) {
      return { success: true, data: result.data };
    }

    const errors = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    return { success: false, error: `Validation errors:\n${errors}` };
  } catch (err) {
    return { success: false, error: `JSON parse error: ${(err as Error).message}` };
  }
}
