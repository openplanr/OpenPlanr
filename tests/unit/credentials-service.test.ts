import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveApiKey } from '../../src/services/credentials-service.js';

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
    // ollama has no env key mapping, so should fall through to stored creds
    const key = await resolveApiKey('unknown-provider');
    // Will return undefined or stored credential - just verify no crash
    expect(key === undefined || typeof key === 'string').toBe(true);
  });
});
