/**
 * Anthropic Claude provider implementation.
 *
 * Uses the official @anthropic-ai/sdk with streaming support.
 * Lazily imported to avoid loading the SDK until actually needed.
 */

import type { AIProvider, AIMessage, AIRequestOptions, AIProviderName, AIUsage } from '../types.js';
import { DEFAULT_MAX_TOKENS } from '../types.js';
import { wrapProviderError } from '../errors.js';

export class AnthropicProvider implements AIProvider {
  readonly name: AIProviderName = 'anthropic';
  readonly model: string;

  private clientPromise: Promise<InstanceType<typeof import('@anthropic-ai/sdk').default>>;
  private lastUsageData: AIUsage | undefined;

  constructor(apiKey: string, model?: string) {
    this.model = model || 'claude-sonnet-4-20250514';
    this.clientPromise = this.initClient(apiKey);
  }

  private async initClient(apiKey: string) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic({ apiKey });
  }

  async *chat(messages: AIMessage[], options?: AIRequestOptions): AsyncIterable<string> {
    const client = await this.clientPromise;
    const { system, userMessages } = this.splitSystemMessage(messages);

    try {
      const stream = client.messages.stream({
        model: this.model,
        max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options?.temperature ?? 0.7,
        system: system || undefined,
        messages: userMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield event.delta.text;
        }
      }

      const finalMessage = await stream.finalMessage();
      this.lastUsageData = {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
        truncated: finalMessage.stop_reason === 'max_tokens',
      };
    } catch (err) {
      throw wrapProviderError(err, 'anthropic');
    }
  }

  async chatSync(messages: AIMessage[], options?: AIRequestOptions): Promise<string> {
    const client = await this.clientPromise;
    const { system, userMessages } = this.splitSystemMessage(messages);

    try {
      const response = await client.messages.create({
        model: this.model,
        max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options?.temperature ?? 0.7,
        system: system || undefined,
        messages: userMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      });

      this.lastUsageData = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        truncated: response.stop_reason === 'max_tokens',
      };

      return response.content
        .filter((block) => block.type === 'text')
        .map((block) => {
          if (block.type === 'text') return block.text;
          return '';
        })
        .join('');
    } catch (err) {
      throw wrapProviderError(err, 'anthropic');
    }
  }

  getLastUsage(): AIUsage | undefined {
    return this.lastUsageData;
  }

  /**
   * Anthropic's API uses a separate `system` parameter rather than
   * a system role in the messages array.
   */
  private splitSystemMessage(messages: AIMessage[]): {
    system: string | null;
    userMessages: AIMessage[];
  } {
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMessages = messages.filter((m) => m.role !== 'system');
    return { system: systemMsg?.content ?? null, userMessages };
  }
}
