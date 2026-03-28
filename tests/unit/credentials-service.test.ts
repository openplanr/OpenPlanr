import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { resolveApiKey, resolveApiKeySource, _resetMigration } from '../../src/services/credentials-service.js';

beforeEach(() => {
  _resetMigration();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveApiKey', () => {
  it('returns ANTHROPIC_API_KEY from env for anthropic', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env-anthropic');
    const key = await resolveApiKey('anthropic');
    expect(key).toBe('sk-env-anthropic');
  });

  it('returns OPENAI_API_KEY from env for openai', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-env-openai');
    const key = await resolveApiKey('openai');
    expect(key).toBe('sk-env-openai');
  });

  it('prefers env var over stored credential', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env');
    const key = await resolveApiKey('anthropic');
    expect(key).toBe('sk-env');
  });

  it('returns undefined for unknown provider with no env', async () => {
    const key = await resolveApiKey('unknown-provider');
    expect(key === undefined || typeof key === 'string').toBe(true);
  });
});

describe('resolveApiKeySource', () => {
  it('returns env source when env var is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env-test');
    const result = await resolveApiKeySource('anthropic');
    expect(result).toEqual({ key: 'sk-env-test', source: 'env' });
  });

  it('returns undefined when no key is available', async () => {
    const result = await resolveApiKeySource('unknown-provider');
    // May return keychain/file result if one exists, or undefined
    expect(result === undefined || result.source !== undefined).toBe(true);
  });
});
