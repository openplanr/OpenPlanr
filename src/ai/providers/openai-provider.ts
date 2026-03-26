/**
 * OpenAI provider implementation.
 *
 * Uses the official openai SDK with streaming and JSON mode support.
 * Also serves as the base for the Ollama provider (OpenAI-compatible API).
 */

import type { AIProvider, AIMessage, AIRequestOptions, AIProviderName } from '../types.js';
import { wrapProviderError } from '../errors.js';

export class OpenAIProvider implements AIProvider {
  readonly name: AIProviderName = 'openai';
  readonly model: string;

  protected clientPromise: Promise<InstanceType<typeof import('openai').default>>;

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
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens || 4096,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        ...(options?.jsonMode && { response_format: { type: 'json_object' as const } }),
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
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
        max_tokens: options?.maxTokens || 4096,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        ...(options?.jsonMode && { response_format: { type: 'json_object' as const } }),
      });

      return response.choices[0]?.message?.content || '';
    } catch (err) {
      throw wrapProviderError(err, this.name);
    }
  }
}
