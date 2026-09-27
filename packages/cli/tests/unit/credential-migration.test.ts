import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real legacy and encrypted-file stores in a temporary directory and a keychain that is never
// available, so no test here reads or writes the developer's home or keychain.
const store = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-credential-migration-'));
  return { directory, legacyFile: join(directory, 'credentials.json') };
});

vi.mock('../../src/services/credential-backends.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/credential-backends.js')>();
  return {
    ...actual,
    keychainBackend: { isAvailable: async () => false },
    encryptedFileBackend: new actual.EncryptedFileBackend(store.directory, {
      passphrase: 'test-only-passphrase-with-32-characters',
    }),
    legacyBackend: new actual.LegacyPlaintextBackend(store.legacyFile),
  };
});

import { _resetMigration, resolveApiKey } from '../../src/services/credentials-service.js';

function writeLegacyFile(entries: Record<string, string>, mode = 0o600): void {
  writeFileSync(store.legacyFile, `${JSON.stringify(entries, null, 2)}\n`, { mode });
}

beforeEach(() => {
  rmSync(store.directory, { recursive: true, force: true });
  mkdirSync(store.directory, { recursive: true });
  _resetMigration();
  vi.stubEnv('PLANR_LINEAR_TOKEN', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(store.directory, { recursive: true, force: true });
});

describe('legacy plaintext credential migration', () => {
  it('a key lookup migrates the CLI entry and leaves the design engine key in the file', async () => {
    writeLegacyFile({ linear: 'lin-legacy', openai_api_key: 'sk-design' }, 0o644);

    await expect(resolveApiKey('linear')).resolves.toBe('lin-legacy');

    expect(JSON.parse(readFileSync(store.legacyFile, 'utf8'))).toEqual({
      openai_api_key: 'sk-design',
    });
    if (process.platform !== 'win32') {
      expect(statSync(store.legacyFile).mode & 0o777).toBe(0o600);
    }
    expect(readdirSync(store.directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    await expect(resolveApiKey('openai_api_key')).resolves.toBeUndefined();
  });

  it("leaves a file that holds only other tools' entries untouched", async () => {
    writeLegacyFile({ openai_api_key: 'sk-design' });
    const before = readFileSync(store.legacyFile, 'utf8');

    await expect(resolveApiKey('linear')).resolves.toBeUndefined();

    expect(readFileSync(store.legacyFile, 'utf8')).toBe(before);
    await expect(resolveApiKey('openai_api_key')).resolves.toBeUndefined();
  });

  it('deletes the file once all of its entries were the CLI’s and have migrated', async () => {
    writeLegacyFile({ linear: 'lin-legacy', anthropic: 'sk-ant-legacy' });

    await expect(resolveApiKey('linear')).resolves.toBe('lin-legacy');

    expect(existsSync(store.legacyFile)).toBe(false);
    await expect(resolveApiKey('anthropic')).resolves.toBe('sk-ant-legacy');
  });
});
