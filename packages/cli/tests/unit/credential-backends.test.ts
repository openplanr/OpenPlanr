import { execFile, spawn } from 'node:child_process';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import {
  EncryptedFileBackend,
  LegacyPlaintextBackend,
} from '../../src/services/credential-backends.js';
import { withCredentialWriteLock } from '../../src/services/credential-write-lock.js';

/**
 * Test the EncryptedFileBackend in isolation using a temp directory.
 * We can't easily test KeychainBackend in CI (no keychain daemon),
 * so we focus on the encrypted file backend which is the universal fallback.
 */

const testPlanrDir = mkdtempSync(join(tmpdir(), 'openplanr-credentials-test-'));
const TEST_PASSPHRASE = 'test-only-passphrase-with-32-characters';
const backend = new EncryptedFileBackend(testPlanrDir, { passphrase: TEST_PASSPHRASE });

afterAll(() => {
  rmSync(testPlanrDir, { recursive: true, force: true });
});

describe('EncryptedFileBackend', () => {
  it('fails closed without an explicit strong passphrase', async () => {
    const backend = new EncryptedFileBackend(testPlanrDir, { passphrase: 'short' });
    expect(await backend.isAvailable()).toBe(false);
    await expect(backend.setStrict('provider', 'secret')).rejects.toThrow('at least 20');
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
      const strict = new EncryptedFileBackend(isolated, { passphrase: TEST_PASSPHRASE });
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
      const strict = new EncryptedFileBackend(isolated, { passphrase: TEST_PASSPHRASE });
      await expect(strict.getStrict('company')).rejects.toThrow('preserved');
      await expect(strict.setStrict('company', 'new-token')).rejects.toThrow('preserved');
      await expect(strict.deleteStrict('company')).rejects.toThrow('preserved');
      expect(await readFile(file, 'utf8')).toBe('interrupted ciphertext');
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});

/** Every message along an error's cause chain. */
function messageChain(error: unknown): string {
  const messages: string[] = [];
  for (let current = error; current instanceof Error; current = current.cause) {
    messages.push(current.message);
  }
  return messages.join('\n');
}

/** Encrypt `payload` the way the backend does, so a test can store content the API never writes. */
function writeEncryptedPayload(planrDir: string, payload: string): void {
  const salt = randomBytes(16);
  writeFileSync(join(planrDir, '.credential-salt'), salt.toString('hex'));
  const key = scryptSync(TEST_PASSPHRASE, salt, 32, { N: 16384, r: 8, p: 1 });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  writeFileSync(
    join(planrDir, 'credentials.enc'),
    JSON.stringify({
      version: 2,
      kdf: 'scrypt',
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      data: data.toString('hex'),
    }),
  );
}

describe('credential documents are validated where they are read', () => {
  it('refuses a decrypted payload with a non-string value, naming the field and never the secret', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'credential-payload-shape-'));
    try {
      writeEncryptedPayload(isolated, JSON.stringify({ linear: 42, company: 'secret-token' }));
      const store = new EncryptedFileBackend(isolated, { passphrase: TEST_PASSPHRASE });
      const failure = await store.getStrict('company').then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toMatchObject({
        message: 'The encrypted credential store cannot be read. Existing contents were preserved.',
        cause: {
          code: 'E_EXTERNAL_JSON_INVALID',
          message: `The decrypted payload of ${join(isolated, 'credentials.enc')} has an unexpected shape: linear: Invalid input: expected string, received number`,
        },
      });
      expect(messageChain(failure)).not.toContain('secret-token');
      await expect(store.get('company')).resolves.toBeUndefined();
      expect(existsSync(join(isolated, 'credentials.enc.bak'))).toBe(true);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('refuses an envelope with a missing or mistyped field, naming the file and the field', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'credential-envelope-shape-'));
    try {
      const file = join(isolated, 'credentials.enc');
      writeFileSync(file, JSON.stringify({ version: 2, iv: 5, tag: 'aa' }));
      const store = new EncryptedFileBackend(isolated, { passphrase: TEST_PASSPHRASE });
      await expect(store.getStrict('company')).rejects.toMatchObject({
        cause: {
          message: `${file} has an unexpected shape: iv: Invalid input: expected string, received number; data: Invalid input: expected string, received undefined`,
        },
      });
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('reads a legacy plaintext file and throws, rather than returning nothing, when it is off-schema', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'credential-legacy-shape-'));
    try {
      const file = join(isolated, 'credentials.json');
      const legacy = new LegacyPlaintextBackend(file);
      writeFileSync(file, JSON.stringify({ linear: 'lin-token' }));
      await expect(legacy.loadAll()).resolves.toEqual({ linear: 'lin-token' });

      writeFileSync(file, JSON.stringify({ linear: 42 }));
      await expect(legacy.loadAll()).rejects.toThrow(
        `${file} has an unexpected shape: linear: Invalid input: expected string, received number`,
      );

      writeFileSync(file, '{"linear": lin_api_secret}');
      const failure = await legacy.loadAll().then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toMatchObject({ message: `${file} is not valid JSON.` });
      expect(messageChain(failure)).not.toContain('lin_api_secret');
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});

describe('shared encrypted credential mutation lock', () => {
  it('preserves independent strict and legacy updates, including concurrent deletes', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'credential-concurrency-'));
    try {
      const first = new EncryptedFileBackend(isolated, { passphrase: TEST_PASSPHRASE });
      const second = new EncryptedFileBackend(isolated, { passphrase: TEST_PASSPHRASE });
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
        const backend=new EncryptedFileBackend(process.argv[2],{passphrase:process.argv[4]});
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
            TEST_PASSPHRASE,
          ]),
        ),
      );
      const read = new EncryptedFileBackend(isolated, { passphrase: TEST_PASSPHRASE });
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
