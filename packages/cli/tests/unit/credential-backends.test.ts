import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { EncryptedFileBackend } from '../../src/services/credential-backends.js';
import { withCredentialWriteLock } from '../../src/services/credential-write-lock.js';

/**
 * Test the EncryptedFileBackend in isolation using a temp directory.
 * We can't easily test KeychainBackend in CI (no keychain daemon),
 * so we focus on the encrypted file backend which is the universal fallback.
 */

const testPlanrDir = mkdtempSync(join(tmpdir(), 'openplanr-credentials-test-'));
const backend = new EncryptedFileBackend(testPlanrDir);

afterAll(() => {
  rmSync(testPlanrDir, { recursive: true, force: true });
});

describe('EncryptedFileBackend', () => {
  it('is always available', async () => {
    const backend = new EncryptedFileBackend();
    expect(await backend.isAvailable()).toBe(true);
  });
});

describe('EncryptedFileBackend roundtrip (real file)', () => {
  // Exercise the actual encrypt/decrypt implementation in an isolated Planr
  // directory. Tests must never rewrite a developer's credential ciphertext.
  const TEST_PROVIDER = '__test_provider_roundtrip__';
  const TEST_KEY = 'sk-test-key-12345-roundtrip';

  afterAll(async () => {
    // Clean up
    await backend.delete(TEST_PROVIDER);
  });

  it('returns undefined for non-existent provider', async () => {
    const result = await backend.get('__nonexistent_provider__');
    expect(result).toBeUndefined();
  });

  it('set and get roundtrip works', async () => {
    await backend.set(TEST_PROVIDER, TEST_KEY);
    const result = await backend.get(TEST_PROVIDER);
    expect(result).toBe(TEST_KEY);
  });

  it('overwrite works', async () => {
    const newKey = 'sk-updated-key-67890';
    await backend.set(TEST_PROVIDER, newKey);
    const result = await backend.get(TEST_PROVIDER);
    expect(result).toBe(newKey);
  });

  it('delete removes the credential', async () => {
    const deleted = await backend.delete(TEST_PROVIDER);
    expect(deleted).toBe(true);
    const result = await backend.get(TEST_PROVIDER);
    expect(result).toBeUndefined();
  });

  it('delete returns false for non-existent provider', async () => {
    const deleted = await backend.delete('__nonexistent__');
    expect(deleted).toBe(false);
  });
});

describe('Encrypted file is not plaintext', () => {
  const TEST_PROVIDER = '__plaintext_check__';
  const TEST_KEY = 'sk-secret-should-not-appear-in-file';

  afterAll(async () => {
    await backend.delete(TEST_PROVIDER);
  });

  it('stored file does not contain the plaintext key', async () => {
    await backend.set(TEST_PROVIDER, TEST_KEY);

    // Read the raw encrypted file
    const encPath = join(testPlanrDir, 'credentials.enc');
    const raw = await readFile(encPath, 'utf-8');

    // The raw file should NOT contain the plaintext key
    expect(raw).not.toContain(TEST_KEY);
    expect(raw).not.toContain(TEST_PROVIDER);

    // It should contain hex-encoded encrypted data
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('tag');
    expect(parsed).toHaveProperty('data');
    expect(typeof parsed.iv).toBe('string');
    expect(typeof parsed.tag).toBe('string');
    expect(typeof parsed.data).toBe('string');
  });
});

describe('strict rotating credential storage', () => {
  it('treats removal of an absent credential as idempotent success', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'company-credential-strict-'));
    try {
      const strict = new EncryptedFileBackend(isolated);
      expect(await strict.deleteStrict('absent')).toBe(true);
      await strict.setStrict('company', 'renewed-token');
      expect(await strict.getStrict('company')).toBe('renewed-token');
      expect((await stat(join(isolated, 'credentials.enc'))).mode & 0o777).toBe(0o600);
      expect((await readdir(isolated)).some((name) => name.endsWith('.tmp'))).toBe(false);
      expect(await strict.deleteStrict('company')).toBe(true);
      expect(await strict.deleteStrict('company')).toBe(true);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
  it('fails without rewriting an unreadable existing credential file', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'company-credential-corrupt-'));
    try {
      const file = join(isolated, 'credentials.enc');
      await writeFile(file, 'interrupted ciphertext');
      const strict = new EncryptedFileBackend(isolated);
      await expect(strict.getStrict('company')).rejects.toThrow('preserved');
      await expect(strict.setStrict('company', 'new-token')).rejects.toThrow('preserved');
      await expect(strict.deleteStrict('company')).rejects.toThrow('preserved');
      expect(await readFile(file, 'utf8')).toBe('interrupted ciphertext');
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});

describe('shared encrypted credential mutation lock', () => {
  it('preserves independent strict and legacy updates, including concurrent deletes', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'credential-concurrency-'));
    try {
      const first = new EncryptedFileBackend(isolated);
      const second = new EncryptedFileBackend(isolated);
      await first.setStrict('old-token', 'old');
      await Promise.all([
        first.setStrict('company-token', 'renewed'),
        second.set('linear', 'linear-token'),
        second.delete('old-token'),
      ]);
      expect(await first.getStrict('company-token')).toBe('renewed');
      expect(await first.getStrict('linear')).toBe('linear-token');
      expect(await first.getStrict('old-token')).toBeUndefined();
      await Promise.all([first.deleteStrict('company-token'), second.set('linear', 'new-linear')]);
      expect(await first.getStrict('company-token')).toBeUndefined();
      expect(await first.getStrict('linear')).toBe('new-linear');
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
  it('preserves credentials written by independent CLI processes', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'credential-processes-'));
    try {
      const source = new URL('../../src/services/credential-backends.ts', import.meta.url).href;
      const code = `const {EncryptedFileBackend}=await import(process.argv[1]);
        const backend=new EncryptedFileBackend(process.argv[2]);
        for(let i=0;i<3;i++)await backend[process.argv[3]==='strict'?'setStrict':'set'](process.argv[3]+i,'fixture'+i);`;
      await Promise.all(
        ['strict', 'legacy'].map((mode) =>
          promisify(execFile)(process.execPath, [
            '--import',
            createRequire(import.meta.url).resolve('tsx'),
            '--input-type=module',
            '-e',
            code,
            source,
            isolated,
            mode,
          ]),
        ),
      );
      const read = new EncryptedFileBackend(isolated);
      for (const mode of ['strict', 'legacy'])
        for (let i = 0; i < 3; i++) expect(await read.getStrict(mode + i)).toBe('fixture' + i);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
  it('waits for a live writer without removing its ownership record', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'credential-live-lock-'));
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = withCredentialWriteLock(isolated, async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    try {
      await ready;
      await expect(
        withCredentialWriteLock(
          isolated,
          async () => {
            throw new Error('unsafe entry');
          },
          25,
        ),
      ).rejects.toThrow('still running');
      expect(
        (await readdir(join(isolated, '.credential-writers'))).filter((name) =>
          name.endsWith('.json'),
        ),
      ).toHaveLength(1);
      release();
      await held;
      expect(await withCredentialWriteLock(isolated, async () => 'next')).toBe('next');
    } finally {
      release?.();
      await held;
      rmSync(isolated, { recursive: true, force: true });
    }
  });
  it('recovers after an owner is killed without requiring a shared stale-recovery lock', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'credential-dead-lock-'));
    const source = new URL('../../src/services/credential-write-lock.ts', import.meta.url).href;
    const code = `const {withCredentialWriteLock}=await import(process.argv[1]);
      await withCredentialWriteLock(process.argv[2],async()=>{process.stdout.write('locked');await new Promise(()=>{});});`;
    // Keep the child alive until killed even though its deliberate pending promise has no handles.
    const child = spawn(
      process.execPath,
      [
        '--import',
        createRequire(import.meta.url).resolve('tsx'),
        '--input-type=module',
        '-e',
        'setInterval(()=>{},1000);' + code,
        source,
        isolated,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.once('data', () => resolve());
        child.once('error', reject);
        child.once('exit', (code) => {
          if (code !== null) reject(new Error('Writer exited before acquiring'));
        });
      });
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await exited;
      const results = await Promise.all([
        withCredentialWriteLock(isolated, async () => 'first'),
        withCredentialWriteLock(isolated, async () => 'second'),
      ]);
      expect(results).toEqual(['first', 'second']);
      expect(
        (await readdir(join(isolated, '.credential-writers'))).filter((name) =>
          name.endsWith('.json'),
        ),
      ).toEqual([]);
    } finally {
      child.kill('SIGKILL');
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});
