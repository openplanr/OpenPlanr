import { describe, it, expect } from 'vitest';
import { AIError, wrapProviderError } from '../../src/ai/errors.js';

describe('AIError', () => {
  it('creates error with correct properties', () => {
    const err = new AIError('test', 'auth', false, undefined, 'cause');
    expect(err.message).toBe('test');
    expect(err.code).toBe('auth');
    expect(err.retryable).toBe(false);
    expect(err.cause).toBe('cause');
    expect(err.name).toBe('AIError');
  });

  it('defaults retryable to false', () => {
    const err = new AIError('test', 'unknown');
    expect(err.retryable).toBe(false);
  });

  it('stores retryAfterMs', () => {
    const err = new AIError('test', 'rate_limit', true, 5000);
    expect(err.retryAfterMs).toBe(5000);
  });

  describe('userMessage', () => {
    it('returns auth guidance', () => {
      const err = new AIError('test', 'auth');
      expect(err.userMessage).toContain('Invalid API key');
      expect(err.userMessage).toContain('planr config set-key');
    });

    it('returns rate limit guidance', () => {
      const err = new AIError('test', 'rate_limit');
      expect(err.userMessage).toContain('Rate limited');
    });

    it('returns overloaded guidance', () => {
      const err = new AIError('test', 'overloaded');
      expect(err.userMessage).toContain('overloaded');
    });

    it('returns connection guidance', () => {
      const err = new AIError('test', 'connection');
      expect(err.userMessage).toContain('Cannot connect');
    });

    it('returns invalid_response guidance', () => {
      const err = new AIError('test', 'invalid_response');
      expect(err.userMessage).toContain('invalid response');
    });

    it('returns raw message for unknown', () => {
      const err = new AIError('Something broke', 'unknown');
      expect(err.userMessage).toBe('Something broke');
    });
  });
});

describe('wrapProviderError', () => {
  it('returns existing AIError unchanged', () => {
    const original = new AIError('test', 'auth');
    const wrapped = wrapProviderError(original, 'anthropic');
    expect(wrapped).toBe(original);
  });

  it('wraps ECONNREFUSED as connection error', () => {
    const err = wrapProviderError({ code: 'ECONNREFUSED', message: 'fail' }, 'openai');
    expect(err.code).toBe('connection');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(5000);
  });

  it('wraps ENOTFOUND as connection error', () => {
    const err = wrapProviderError({ code: 'ENOTFOUND', message: 'fail' }, 'anthropic');
    expect(err.code).toBe('connection');
  });

  it('wraps ETIMEDOUT as connection error', () => {
    const err = wrapProviderError({ code: 'ETIMEDOUT', message: 'fail' }, 'anthropic');
    expect(err.code).toBe('connection');
  });

  it('includes Ollama hint for connection errors', () => {
    const err = wrapProviderError({ code: 'ECONNREFUSED', message: 'fail' }, 'ollama');
    expect(err.message).toContain('Ollama');
  });

  it('wraps 401 as auth error (non-retryable)', () => {
    const err = wrapProviderError({ status: 401, message: 'Unauthorized' }, 'anthropic');
    expect(err.code).toBe('auth');
    expect(err.retryable).toBe(false);
  });

  it('wraps 403 as auth error', () => {
    const err = wrapProviderError({ status: 403, message: 'Forbidden' }, 'openai');
    expect(err.code).toBe('auth');
  });

  it('wraps 429 as rate_limit with retry-after', () => {
    const err = wrapProviderError(
      { status: 429, message: 'Too Many Requests', headers: { 'retry-after': '10' } },
      'anthropic'
    );
    expect(err.code).toBe('rate_limit');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(10000);
  });

  it('wraps 429 with default retry when no header', () => {
    const err = wrapProviderError({ status: 429, message: 'Too Many Requests' }, 'anthropic');
    expect(err.code).toBe('rate_limit');
    expect(err.retryAfterMs).toBe(2000);
  });

  it('wraps 529 as overloaded', () => {
    const err = wrapProviderError({ status: 529, message: 'Overloaded' }, 'anthropic');
    expect(err.code).toBe('overloaded');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(3000);
  });

  it('wraps 503 as overloaded', () => {
    const err = wrapProviderError({ status: 503, message: 'Service Unavailable' }, 'openai');
    expect(err.code).toBe('overloaded');
  });

  it('wraps unknown errors', () => {
    const err = wrapProviderError({ status: 500, message: 'Internal Server Error' }, 'anthropic');
    expect(err.code).toBe('unknown');
    expect(err.retryable).toBe(false);
  });

  it('handles non-object errors', () => {
    const err = wrapProviderError('string error', 'anthropic');
    expect(err.code).toBe('unknown');
    expect(err.message).toContain('string error');
  });
});
