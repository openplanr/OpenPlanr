/**
 * OpenAI provider implementation.
 *
 * Uses the official openai SDK with streaming and JSON mode support.
 * Also serves as the base for the Ollama provider (OpenAI-compatible API).
 */

import type { AIProvider, AIMessage, AIRequestOptions, AIProviderName, AIUsage } from '../types.js';
import { DEFAULT_MAX_TOKENS } from '../types.js';
import { wrapProviderError } from '../errors.js';

export class OpenAIProvider implements AIProvider {
  readonly name: AIProviderName = 'openai';
  readonly model: string;

  protected clientPromise: Promise<InstanceType<typeof import('openai').default>>;
  private lastUsageData: AIUsage | undefined;

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.model = model || 'gpt-4o';
    this.clientPromise = this.initClient(apiKey, baseUrl);
  }

  private async initClient(apiKey: string, baseUrl?: string) {
    const { default: OpenAI } = await import('openai');
    return new OpenAI({ apiKey, baseURL: baseUrl });
  }

  async *chat(messages: AIMessage[], options?: AIRequestOptions): AsyncIterable<string> {
    const client = await this.clientPromise;

    try {
      const stream = await client.chat.completions.create({
        model: this.model,
        stream: true,
        stream_options: { include_usage: true },
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        ...(options?.jsonMode && { response_format: { type: 'json_object' as const } }),
      });

      let lastFinishReason: string | null = null;
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
        if (chunk.choices[0]?.finish_reason) {
          lastFinishReason = chunk.choices[0].finish_reason;
        }
        // Capture usage from the final chunk (OpenAI includes it when stream ends)
        if (chunk.usage) {
          this.lastUsageData = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            truncated: lastFinishReason === 'length',
          };
        }
      }
    } catch (err) {
      throw wrapProviderError(err, this.name);
    }
  }

  async chatSync(messages: AIMessage[], options?: AIRequestOptions): Promise<string> {
    const client = await this.clientPromise;

    try {
      const response = await client.chat.completions.create({
        model: this.model,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        ...(options?.jsonMode && { response_format: { type: 'json_object' as const } }),
      });

      const finishReason = response.choices[0]?.finish_reason;
      if (response.usage) {
        this.lastUsageData = {
          inputTokens: response.usage.prompt_tokens ?? 0,
          outputTokens: response.usage.completion_tokens ?? 0,
          truncated: finishReason === 'length',
        };
      }

      return response.choices[0]?.message?.content || '';
    } catch (err) {
      throw wrapProviderError(err, this.name);
    }
  }

  getLastUsage(): AIUsage | undefined {
    return this.lastUsageData;
  }
}
