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

/** Token usage returned by AI providers after a call. */
export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
  /** Whether the response was truncated because it hit the max_tokens limit. */
  truncated?: boolean;
}

// ---------------------------------------------------------------------------
// Token budget constants
// ---------------------------------------------------------------------------

/** Default max output tokens when no command-specific budget is set. */
export const DEFAULT_MAX_TOKENS = 8192;

/**
 * Per-command token budgets tuned to typical output sizes.
 * Commands producing larger outputs get higher budgets.
 */
export const TOKEN_BUDGETS = {
  epic: 4096,
  feature: 8192,
  story: 8192,
  task: 16384,
  taskFeature: 32768,
  refine: 8192,
  plan: 16384,
} as const;

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

export const DEFAULT_MODELS: Record<AIProviderName, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  ollama: 'llama3.1',
} as const;

export const ENV_KEY_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
} as const;
