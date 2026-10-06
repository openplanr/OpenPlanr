import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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
    prepareHome: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    loadAllPrepared: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
    keepOnly: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  encryptedFileBackend,
  keychainBackend,
  legacyBackend,
} from '../../src/services/credential-backends.js';
import {
  _resetMigration,
  migrateCredentials,
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
  vi.mocked(encryptedFileBackend.isAvailable).mockResolvedValue(true);
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

  it('fails closed when neither a keychain nor an explicit encrypted-file secret is available', async () => {
    vi.mocked(encryptedFileBackend.isAvailable).mockResolvedValue(false);
    await expect(saveCredential('linear', 'lin-first')).rejects.toThrow(
      'PLANR_CREDENTIAL_FILE_PASSPHRASE',
    );
    expect(encryptedFileBackend.set).not.toHaveBeenCalled();
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

describe('legacy plaintext migration', () => {
  it('keeps a legacy file it cannot read instead of deleting it as empty', async () => {
    vi.mocked(legacyBackend.exists).mockResolvedValueOnce(true);
    vi.mocked(legacyBackend.loadAllPrepared).mockRejectedValueOnce(
      new Error('credentials.json has an unexpected shape'),
    );
    await expect(migrateCredentials()).resolves.toBe(false);
    expect(legacyBackend.remove).not.toHaveBeenCalled();
  });
});

it('serializes CLI migration with another legacy credential writer without losing either owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'planr-credential-race-'));
  await chmod(directory, 0o700);
  const credentials = join(directory, 'credentials.json');
  await writeFile(
    credentials,
    JSON.stringify({ linear: 'mock-linear', openai_api_key: 'sk-old-fixture', retained: 'keep' }),
    { mode: 0o600 },
  );
  vi.stubEnv('PLANR_HOME', directory);
  vi.mocked(legacyBackend.exists).mockResolvedValueOnce(true);
  vi.mocked(legacyBackend.loadAllPrepared).mockImplementationOnce(async () =>
    JSON.parse(await readFile(credentials, 'utf8')),
  );
  vi.mocked(legacyBackend.keepOnly).mockImplementationOnce(async (value) => {
    await writeFile(credentials, JSON.stringify(value), { mode: 0o600 });
  });
  let child: ReturnType<typeof spawn> | undefined;
  let completion: Promise<number | null> | undefined;
  vi.mocked(encryptedFileBackend.set).mockImplementationOnce(async () => {
    child = spawn(
      process.execPath,
      [
        resolve('tests/fixtures/legacy-credential-writer.mjs'),
        'openai_api_key',
        'sk-test-owner-only',
      ],
      {
        env: { ...process.env, PLANR_HOME: directory },
        stdio: 'ignore',
      },
    );
    completion = new Promise((resolveExit, reject) => {
      child?.once('error', reject);
      child?.once('close', resolveExit);
    });
    const writerDirectory = join(directory, '.legacy-credential-writers');
    const deadline = Date.now() + 4000;
    while (
      !(await readdir(writerDirectory)).some(
        (name) => name.startsWith(`${child?.pid}-`) && name.endsWith('.json'),
      )
    ) {
      if (Date.now() >= deadline)
        throw new Error('The other writer did not join the shared credential queue.');
      await delay(20);
    }
    // Keep migration suspended while the other process attempts its full read/modify/write.
    await delay(80);
    expect(child.exitCode).toBeNull();
    expect(JSON.parse(await readFile(credentials, 'utf8')).openai_api_key).toBe('sk-old-fixture');
  });
  try {
    expect(await migrateCredentials()).toBe(true);
    expect(await completion).toBe(0);
    expect(JSON.parse(await readFile(credentials, 'utf8'))).toEqual({
      openai_api_key: 'sk-test-owner-only',
      retained: 'keep',
    });
    expect((await stat(credentials)).mode & 0o777).toBe(0o600);
    expect(encryptedFileBackend.set).toHaveBeenCalledWith('linear', 'mock-linear');
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await completion?.catch(() => {});
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
