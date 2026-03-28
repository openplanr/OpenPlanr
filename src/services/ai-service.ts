/**
 * High-level AI orchestration service.
 *
 * Bridges the gap between CLI commands and the AI provider layer.
 * Handles provider initialization, streaming output, and structured
 * JSON generation with Zod validation and retry logic.
 */

import type { ZodSchema } from 'zod';
import type { AIProvider, AIMessage, AIRequestOptions, AIProviderConfig, AIUsage } from '../ai/types.js';
import type { OpenPlanrConfig } from '../models/types.js';
import { AIError } from '../ai/errors.js';
import { resolveApiKey } from './credentials-service.js';
import { createSpinner, formatUsage } from '../utils/logger.js';

/**
 * Initialize an AI provider from project config.
 * Dynamically imports the factory to keep non-AI commands fast.
 */
export async function getAIProvider(config: OpenPlanrConfig): Promise<AIProvider> {
  if (!config.ai) {
    throw new AIError(
      'AI is not configured. Run `planr init` or `planr config set-provider <name>`.',
      'auth'
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
 */
export function isAIConfigured(config: OpenPlanrConfig): boolean {
  return config.ai != null && config.ai.provider != null;
}

/**
 * Stream AI output to the terminal in real time.
 * Returns the fully accumulated text once streaming completes.
 */
export async function streamToTerminal(
  stream: AsyncIterable<string>
): Promise<string> {
  const chunks: string[] = [];

  for await (const chunk of stream) {
    process.stdout.write(chunk);
    chunks.push(chunk);
  }

  // Ensure a trailing newline after streaming
  process.stdout.write('\n');
  return chunks.join('');
}

/**
 * Generate a validated JSON response from the AI.
 *
 * Flow:
 * 1. Send messages with JSON mode hint
 * 2. Parse response as JSON
 * 3. Validate with Zod schema
 * 4. On failure, retry once with error feedback
 */
/** Result from AI generation including the parsed data and optional token usage. */
export interface AIGenerateResult<T> {
  result: T;
  usage?: AIUsage;
}

export async function generateJSON<T>(
  provider: AIProvider,
  messages: AIMessage[],
  schema: ZodSchema<T>,
  options?: AIRequestOptions
): Promise<AIGenerateResult<T>> {
  const requestOptions: AIRequestOptions = {
    temperature: 0.5,
    ...options,
    jsonMode: true,
  };

  let totalUsage: AIUsage = { inputTokens: 0, outputTokens: 0 };

  const spinner = createSpinner('Generating...');
  try {
    let rawResponse = await provider.chatSync(messages, requestOptions);
    accumulateUsage(totalUsage, provider.getLastUsage());
    let parsed = tryParseAndValidate(rawResponse, schema);

    if (parsed.success) {
      spinner.succeed(`Done${formatUsage(totalUsage)}`);
      return { result: parsed.data, usage: totalUsage };
    }

    // Retry once with error feedback
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
    accumulateUsage(totalUsage, provider.getLastUsage());
    spinner.succeed(`Done${formatUsage(totalUsage)}`);
    parsed = tryParseAndValidate(rawResponse, schema);

    if (parsed.success) return { result: parsed.data, usage: totalUsage };

    throw new AIError(
      `AI returned invalid JSON after retry: ${parsed.error}`,
      'invalid_response'
    );
  } catch (err) {
    spinner.stop();
    throw err;
  }
}

/**
 * Generate JSON with streaming — shows progress dots in the terminal
 * while the AI generates, then parses the complete response.
 */
export async function generateStreamingJSON<T>(
  provider: AIProvider,
  messages: AIMessage[],
  schema: ZodSchema<T>,
  options?: AIRequestOptions
): Promise<AIGenerateResult<T>> {
  const requestOptions: AIRequestOptions = {
    temperature: 0.5,
    ...options,
    jsonMode: true,
  };

  let totalUsage: AIUsage = { inputTokens: 0, outputTokens: 0 };

  // Stream the response, showing spinner for progress
  const chunks: string[] = [];
  const spinner = createSpinner('Generating...');
  try {
    const stream = provider.chat(messages, requestOptions);

    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    accumulateUsage(totalUsage, provider.getLastUsage());

    const rawResponse = chunks.join('');
    let parsed = tryParseAndValidate(rawResponse, schema);

    if (parsed.success) {
      spinner.succeed(`Done${formatUsage(totalUsage)}`);
      return { result: parsed.data, usage: totalUsage };
    }

    // Retry once with error feedback (non-streaming for retry)
    spinner.update('Retrying...');
    const retryMessages: AIMessage[] = [
      ...messages,
      { role: 'assistant', content: rawResponse },
      {
        role: 'user',
        content: `Your response was not valid JSON or failed validation:\n${parsed.error}\n\nPlease fix and return valid JSON only.`,
      },
    ];

    const retryResponse = await provider.chatSync(retryMessages, requestOptions);
    accumulateUsage(totalUsage, provider.getLastUsage());
    spinner.succeed(`Done${formatUsage(totalUsage)}`);
    parsed = tryParseAndValidate(retryResponse, schema);

    if (parsed.success) return { result: parsed.data, usage: totalUsage };

    throw new AIError(
      `AI returned invalid JSON after retry: ${parsed.error}`,
      'invalid_response'
    );
  } catch (err) {
    spinner.stop();
    throw err;
  }
}

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
  schema: ZodSchema<T>
): { success: true; data: T } | { success: false; error: string } {
  try {
    const cleaned = extractJSON(raw);
    const json = JSON.parse(cleaned);
    const result = schema.safeParse(json);

    if (result.success) {
      return { success: true, data: result.data };
    }

    const errors = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    return { success: false, error: `Validation errors:\n${errors}` };
  } catch (err) {
    return { success: false, error: `JSON parse error: ${(err as Error).message}` };
  }
}
