import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the backends so tests don't depend on real keychain/files
vi.mock('../../src/services/credential-backends.js', () => ({
  keychainBackend: {
    isAvailable: vi.fn().mockResolvedValue(false),
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(false),
  },
  encryptedFileBackend: {
    isAvailable: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(false),
  },
  legacyBackend: {
    exists: vi.fn().mockResolvedValue(false),
    loadAll: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

import { encryptedFileBackend, keychainBackend } from '../../src/services/credential-backends.js';
import {
  _resetMigration,
  resolveApiKey,
  resolveApiKeySource,
  saveCredential,
} from '../../src/services/credentials-service.js';

beforeEach(() => {
  _resetMigration();
  vi.clearAllMocks();
  // Default: keychain unavailable, encrypted file returns nothing
  vi.mocked(keychainBackend.isAvailable).mockResolvedValue(false);
  vi.mocked(keychainBackend.get).mockResolvedValue(undefined);
  vi.mocked(encryptedFileBackend.get).mockResolvedValue(undefined);
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
    vi.mocked(keychainBackend.isAvailable).mockResolvedValue(true);
    vi.mocked(keychainBackend.get).mockResolvedValue('sk-keychain');
    const key = await resolveApiKey('anthropic');
    expect(key).toBe('sk-env');
  });

  it('returns undefined for unknown provider with no stored credential', async () => {
    const key = await resolveApiKey('unknown-provider');
    expect(key).toBeUndefined();
  });

  it('falls back to keychain when env is not set', async () => {
    vi.mocked(keychainBackend.isAvailable).mockResolvedValue(true);
    vi.mocked(keychainBackend.get).mockResolvedValue('sk-from-keychain');
    const key = await resolveApiKey('anthropic');
    expect(key).toBe('sk-from-keychain');
  });

  it('falls back to encrypted file when keychain is unavailable', async () => {
    vi.mocked(encryptedFileBackend.get).mockResolvedValue('sk-from-enc');
    const key = await resolveApiKey('anthropic');
    expect(key).toBe('sk-from-enc');
  });
});

describe('resolveApiKeySource', () => {
  it('returns env source when env var is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env-test');
    const result = await resolveApiKeySource('anthropic');
    expect(result).toEqual({ key: 'sk-env-test', source: 'env' });
  });

  it('returns keychain source when key is in keychain', async () => {
    vi.mocked(keychainBackend.isAvailable).mockResolvedValue(true);
    vi.mocked(keychainBackend.get).mockResolvedValue('sk-kc');
    const result = await resolveApiKeySource('anthropic');
    expect(result).toEqual({ key: 'sk-kc', source: 'keychain' });
  });

  it('returns encrypted-file source as fallback', async () => {
    vi.mocked(encryptedFileBackend.get).mockResolvedValue('sk-enc');
    const result = await resolveApiKeySource('openai');
    expect(result).toEqual({ key: 'sk-enc', source: 'encrypted-file' });
  });

  it('returns undefined when no key is available anywhere', async () => {
    const result = await resolveApiKeySource('unknown-provider');
    expect(result).toBeUndefined();
  });
});

describe('saveCredential', () => {
  it('saves to keychain when available', async () => {
    vi.mocked(keychainBackend.isAvailable).mockResolvedValue(true);
    const source = await saveCredential('anthropic', 'sk-test');
    expect(source).toBe('keychain');
    expect(keychainBackend.set).toHaveBeenCalledWith('anthropic', 'sk-test');
  });

  it('falls back to encrypted file when keychain unavailable', async () => {
    const source = await saveCredential('anthropic', 'sk-test');
    expect(source).toBe('encrypted-file');
    expect(encryptedFileBackend.set).toHaveBeenCalledWith('anthropic', 'sk-test');
  });

  it('falls back to encrypted file when keychain write throws', async () => {
    vi.mocked(keychainBackend.isAvailable).mockResolvedValue(true);
    vi.mocked(keychainBackend.set).mockRejectedValue(new Error('Keychain locked'));
    const source = await saveCredential('anthropic', 'sk-test');
    expect(source).toBe('encrypted-file');
    expect(encryptedFileBackend.set).toHaveBeenCalledWith('anthropic', 'sk-test');
  });
});
