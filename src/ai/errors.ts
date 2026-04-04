/**
 * Unified error class for AI provider failures.
 *
 * Normalizes provider-specific errors (Anthropic 429, OpenAI 401, Ollama ECONNREFUSED)
 * into a consistent format the rest of the application can handle.
 */

export type AIErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'overloaded'
  | 'connection'
  | 'invalid_response'
  | 'unknown';

export class AIError extends Error {
  constructor(
    message: string,
    public readonly code: AIErrorCode,
    public readonly retryable: boolean = false,
    public readonly retryAfterMs?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AIError';
  }

  /** User-friendly description with actionable guidance. */
  get userMessage(): string {
    switch (this.code) {
      case 'auth':
        return 'Invalid API key. Run `planr config set-key <provider>` to update.';
      case 'rate_limit':
        return 'Rate limited. Please wait a moment and try again.';
      case 'overloaded':
        return 'AI provider is overloaded. Please try again in a few seconds.';
      case 'connection':
        return 'Cannot connect to AI provider. Check your network or if Ollama is running.';
      case 'invalid_response':
        return 'AI returned an invalid response. Try again or use --manual mode.';
      default:
        return this.message;
    }
  }
}

/**
 * Wrap any provider-specific error into a normalized AIError.
 * Each provider adapter calls this to unify error handling.
 */
export function wrapProviderError(err: unknown, provider: string): AIError {
  if (err instanceof AIError) return err;

  const error = err as Record<string, unknown>; // Unknown error shape requires index access
  const status = error?.status as number | undefined;
  const code = error?.code as string | undefined;
  const message = (error?.message as string) || String(err);

  // Connection errors (Ollama not running, network down)
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
    const hint =
      provider === 'ollama'
        ? 'Is Ollama running? Start with `ollama serve`.'
        : 'Check your internet connection.';
    return new AIError(`Connection failed: ${hint}`, 'connection', true, 5000, err);
  }

  // HTTP status-based errors
  if (status === 401 || status === 403) {
    return new AIError(`Authentication failed for ${provider}.`, 'auth', false, undefined, err);
  }
  if (status === 429) {
    const retryAfter = (error?.headers as Record<string, string>)?.['retry-after'];
    const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000;
    return new AIError('Rate limited by AI provider.', 'rate_limit', true, retryMs, err);
  }
  if (status === 529 || status === 503) {
    return new AIError('AI provider is overloaded.', 'overloaded', true, 3000, err);
  }

  return new AIError(message, 'unknown', false, undefined, err);
}
