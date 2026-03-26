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
export type CodingAgentName = 'claude' | 'cursor' | 'codex';

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
}

export const DEFAULT_MODELS: Record<AIProviderName, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  ollama: 'llama3.1',
} as const;

export const ENV_KEY_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
} as const;
