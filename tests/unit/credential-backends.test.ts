import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EncryptedFileBackend } from '../../src/services/credential-backends.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';

/**
 * Test the EncryptedFileBackend in isolation using a temp directory.
 * We can't easily test KeychainBackend in CI (no keychain daemon),
 * so we focus on the encrypted file backend which is the universal fallback.
 */

describe('EncryptedFileBackend', () => {
  it('is always available', async () => {
    const backend = new EncryptedFileBackend();
    expect(await backend.isAvailable()).toBe(true);
  });
});

describe('EncryptedFileBackend roundtrip (real file)', () => {
  // We test the actual encrypt/decrypt logic by using the real backend
  // which writes to ~/.planr/credentials.enc. We use a provider name
  // that won't conflict with real credentials.
  const TEST_PROVIDER = '__test_provider_roundtrip__';
  const TEST_KEY = 'sk-test-key-12345-roundtrip';
  const backend = new EncryptedFileBackend();

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
  const backend = new EncryptedFileBackend();

  afterAll(async () => {
    await backend.delete(TEST_PROVIDER);
  });

  it('stored file does not contain the plaintext key', async () => {
    await backend.set(TEST_PROVIDER, TEST_KEY);

    // Read the raw encrypted file
    const homedir = (await import('node:os')).homedir();
    const encPath = join(homedir, '.planr', 'credentials.enc');
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
