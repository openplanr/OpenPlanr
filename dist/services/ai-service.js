/**
 * High-level AI orchestration service.
 *
 * Bridges the gap between CLI commands and the AI provider layer.
 * Handles provider initialization, streaming output, and structured
 * JSON generation with Zod validation and retry logic.
 */
import { AIError } from '../ai/errors.js';
import { ENV_KEY_MAP } from '../ai/types.js';
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
export async function getAIProvider(config, options = {}) {
    if (options.surface === 'operate-structured-provider' && !operateProviderDeprecationPrinted) {
        printDeprecationNotice('operate-structured-provider');
        operateProviderDeprecationPrinted = true;
    }
    if (!config.ai) {
        throw new AIError('AI is not configured. Run `planr init` or `planr config set-provider <name>`.', 'auth');
    }
    const apiKey = await resolveApiKey(config.ai.provider);
    const providerConfig = {
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
export function isAIConfigured(config) {
    return config.ai != null && config.ai.provider != null;
}
/**
 * Preflight the AI provider for a project: confirm a provider is named AND that
 * its API key actually resolves in this environment (env var, OS keychain, or
 * encrypted file). Local providers (Ollama) authenticate against a local
 * endpoint and need no key. Returns an actionable remedy naming the missing key
 * so `run --preview`/readiness can surface it before a cycle starts.
 */
export async function resolveAIProviderReadiness(config) {
    if (!isAIConfigured(config) || config.ai == null) {
        return {
            configured: false,
            keyResolvable: false,
            remedy: 'No AI provider is configured. Run `planr config set-provider <name>` then `planr config set-key <provider>`, or run offline with --offline.',
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
        remedy: `No API key resolved for ${provider}. Run \`planr config set-key ${provider}\`${envVar ? ` or export ${envVar}` : ''}, or run offline with --offline.`,
    };
}
/**
 * Stream AI output to the terminal in real time.
 * Returns the fully accumulated text once streaming completes.
 */
export async function streamToTerminal(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        process.stdout.write(chunk);
        chunks.push(chunk);
    }
    // Ensure a trailing newline after streaming
    process.stdout.write('\n');
    return chunks.join('');
}
// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
/** Throw a descriptive error when the AI response was truncated. */
function throwTruncationError(usage, maxTokens, isRetry = false) {
    const prefix = isRetry ? 'AI retry response' : 'AI response';
    const limit = maxTokens != null ? maxTokens.toLocaleString() : 'default';
    throw new AIError(`${prefix} was truncated at ${usage.outputTokens.toLocaleString()} output tokens (hit max_tokens limit of ${limit}). Try reducing the input scope or increasing the token budget.`, 'invalid_response');
}
/** Check usage for truncation; throw if truncated. */
function checkTruncation(usage, maxTokens, isRetry = false) {
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
async function generateCore(provider, messages, schema, requestOptions, fetchResponse, quiet = false) {
    const totalUsage = { inputTokens: 0, outputTokens: 0 };
    const spinner = quiet
        ? {
            update() { },
            stop() { },
            succeed() { },
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
        const retryMessages = [
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
        throw new AIError(`AI returned invalid JSON after retry: ${retryParsed.error}`, 'invalid_response');
    }
    catch (err) {
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
export async function generateJSON(provider, messages, schema, options) {
    const { quiet = false, ...providerOptions } = options ?? {};
    const requestOptions = {
        temperature: DEFAULT_TEMPERATURE,
        ...providerOptions,
        jsonMode: true,
    };
    return generateCore(provider, messages, schema, requestOptions, () => provider.chatSync(messages, requestOptions), quiet);
}
/**
 * Generate JSON with streaming — shows progress spinner in the terminal
 * while the AI generates, then parses the complete response.
 */
export async function generateStreamingJSON(provider, messages, schema, options) {
    const { quiet = false, ...providerOptions } = options ?? {};
    const requestOptions = {
        temperature: DEFAULT_TEMPERATURE,
        ...providerOptions,
        jsonMode: true,
    };
    return generateCore(provider, messages, schema, requestOptions, async () => {
        const chunks = [];
        const stream = provider.chat(messages, requestOptions);
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return chunks.join('');
    }, quiet);
}
// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------
/** Extract JSON from a response that might contain markdown code fences. */
function extractJSON(raw) {
    // Strip markdown code fences if present
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch)
        return fenceMatch[1].trim();
    return raw.trim();
}
/** Accumulate token usage from a provider call into a running total. */
export function accumulateUsage(total, usage) {
    if (usage) {
        total.inputTokens += usage.inputTokens;
        total.outputTokens += usage.outputTokens;
    }
}
function tryParseAndValidate(raw, schema) {
    try {
        const cleaned = extractJSON(raw);
        const json = JSON.parse(cleaned);
        const result = schema.safeParse(json);
        if (result.success) {
            return { success: true, data: result.data };
        }
        const errors = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
        return { success: false, error: `Validation errors:\n${errors}` };
    }
    catch (err) {
        return { success: false, error: `JSON parse error: ${err.message}` };
    }
}
//# sourceMappingURL=ai-service.js.map