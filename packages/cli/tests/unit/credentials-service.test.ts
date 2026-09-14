import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/credential-backends.js', () => ({
  keychainBackend: {
    isAvailable: vi.fn().mockResolvedValue(false),
    get: vi.fn().mockResolvedValue(undefined),
    getStrict: vi.fn().mockResolvedValue(undefined),
    setStrict: vi.fn().mockResolvedValue(undefined),
    deleteStrict: vi.fn().mockResolvedValue(false),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(false),
  },
  encryptedFileBackend: {
    isAvailable: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockResolvedValue(undefined),
    getStrict: vi.fn().mockResolvedValue(undefined),
    setStrict: vi.fn().mockResolvedValue(undefined),
    deleteStrict: vi.fn().mockResolvedValue(false),
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
  readStoredCredential,
  removeStoredCredential,
  resolveApiKey,
  resolveApiKeySource,
  saveCredential,
  saveRecordedCredential,
} from '../../src/services/credentials-service.js';

beforeEach(() => {
  _resetMigration();
  vi.clearAllMocks();
  vi.mocked(keychainBackend.isAvailable).mockResolvedValue(false);
  vi.mocked(keychainBackend.get).mockResolvedValue(undefined);
  vi.mocked(encryptedFileBackend.get).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('deterministic integration credentials', () => {
  it('resolves only the Linear token from the environment', async () => {
    vi.stubEnv('PLANR_LINEAR_TOKEN', 'lin-env');
    vi.stubEnv('ANTHROPIC_API_KEY', 'must-not-be-read');
    vi.stubEnv('OPENAI_API_KEY', 'must-not-be-read');
    await expect(resolveApiKey('linear')).resolves.toBe('lin-env');
    await expect(resolveApiKey('anthropic')).resolves.toBeUndefined();
    await expect(resolveApiKey('openai')).resolves.toBeUndefined();
  });

  it('prefers the Linear environment token over stored credentials', async () => {
    vi.stubEnv('PLANR_LINEAR_TOKEN', 'lin-env');
    vi.mocked(keychainBackend.isAvailable).mockResolvedValue(true);
    vi.mocked(keychainBackend.get).mockResolvedValue('lin-keychain');
    await expect(resolveApiKeySource('linear')).resolves.toEqual({ key: 'lin-env', source: 'env' });
  });

  it('falls back to keychain and then encrypted storage', async () => {
    vi.mocked(keychainBackend.isAvailable).mockResolvedValue(true);
    vi.mocked(keychainBackend.get).mockResolvedValue('lin-keychain');
    await expect(resolveApiKeySource('linear')).resolves.toEqual({
      key: 'lin-keychain',
      source: 'keychain',
    });

    vi.mocked(keychainBackend.isAvailable).mockResolvedValue(false);
    vi.mocked(encryptedFileBackend.get).mockResolvedValue('lin-encrypted');
    await expect(resolveApiKeySource('linear')).resolves.toEqual({
      key: 'lin-encrypted',
      source: 'encrypted-file',
    });
  });

  it('stores integration credentials in keychain when available', async () => {
    vi.mocked(keychainBackend.isAvailable).mockResolvedValue(true);
    await expect(saveCredential('linear', 'lin-test')).resolves.toBe('keychain');
    expect(keychainBackend.set).toHaveBeenCalledWith('linear', 'lin-test');
  });

  it('falls back to encrypted storage when keychain is unavailable or fails', async () => {
    await expect(saveCredential('linear', 'lin-first')).resolves.toBe('encrypted-file');
    vi.mocked(keychainBackend.isAvailable).mockResolvedValue(true);
    vi.mocked(keychainBackend.set).mockRejectedValue(new Error('Keychain locked'));
    await expect(saveCredential('linear', 'lin-second')).resolves.toBe('encrypted-file');
    expect(encryptedFileBackend.set).toHaveBeenCalledWith('linear', 'lin-second');
  });
});

describe('recorded company credential backends', () => {
  it('reads only the recorded backend, preserving rotated credentials after a fallback write', async () => {
    vi.mocked(keychainBackend.getStrict).mockResolvedValue('stale-keychain');
    vi.mocked(encryptedFileBackend.getStrict).mockResolvedValue('current-encrypted');
    expect(await readStoredCredential('company-oauth:fixture', 'encrypted-file')).toBe(
      'current-encrypted',
    );
    expect(keychainBackend.getStrict).not.toHaveBeenCalled();
    expect(await readStoredCredential('company-oauth:fixture', 'keychain')).toBe('stale-keychain');
  });
  it('reports whether the recorded credential removal was confirmed', async () => {
    vi.mocked(keychainBackend.deleteStrict).mockResolvedValue(false);
    vi.mocked(encryptedFileBackend.deleteStrict).mockResolvedValue(true);
    expect(await removeStoredCredential('company-oauth:fixture', 'keychain')).toBe(false);
    expect(await removeStoredCredential('company-oauth:fixture', 'encrypted-file')).toBe(true);
  });
});

describe('rotating credential writes', () => {
  it('uses strict fallback storage and preserves unreadable encrypted files', async () => {
    vi.mocked(encryptedFileBackend.setStrict).mockRejectedValueOnce(
      new Error('encrypted store unavailable'),
    );
    await expect(saveRecordedCredential('company-oauth:fixture', 'rotated')).rejects.toThrow(
      'unavailable',
    );
    expect(encryptedFileBackend.set).not.toHaveBeenCalled();
    await expect(saveRecordedCredential('company-oauth:fixture', 'rotated')).resolves.toBe(
      'encrypted-file',
    );
  });
});
