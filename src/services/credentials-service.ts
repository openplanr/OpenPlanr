/**
 * Manages API key storage with a secure fallback chain.
 *
 * Resolution order:
 * 1. Environment variable (ANTHROPIC_API_KEY, OPENAI_API_KEY)
 * 2. OS Keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
 * 3. Encrypted file (~/.planr/credentials.enc) with AES-256-GCM
 * 4. undefined (caller decides how to handle)
 *
 * Keys are automatically migrated from the legacy plaintext
 * ~/.planr/credentials.json on first access.
 */

import { ENV_KEY_MAP } from '../ai/types.js';
import type { CredentialSource } from './credential-backends.js';
import {
  keychainBackend,
  encryptedFileBackend,
  legacyBackend,
} from './credential-backends.js';

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

let migrationDone = false;

/**
 * Migrate credentials from legacy plaintext file to the preferred backend.
 * Runs once per process, transparently on first key resolution.
 */
export async function migrateCredentials(): Promise<boolean> {
  if (migrationDone) return false;
  migrationDone = true;

  if (!(await legacyBackend.exists())) return false;

  const credentials = await legacyBackend.loadAll();
  const providers = Object.keys(credentials);
  if (providers.length === 0) {
    await legacyBackend.remove();
    return false;
  }

  // Migrate each key to the best available backend
  for (const provider of providers) {
    await saveCredential(provider, credentials[provider]);
  }

  // Remove the plaintext file
  await legacyBackend.remove();
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve API key for a provider using the secure fallback chain:
 * 1. Environment variable (ANTHROPIC_API_KEY, OPENAI_API_KEY)
 * 2. OS Keychain
 * 3. Encrypted file (~/.planr/credentials.enc)
 * 4. undefined
 */
export async function resolveApiKey(provider: string): Promise<string | undefined> {
  // Run one-time migration from legacy plaintext file
  await migrateCredentials();

  // 1. Environment variable
  const envVar = ENV_KEY_MAP[provider];
  if (envVar && process.env[envVar]) {
    return process.env[envVar];
  }

  // 2. OS Keychain
  if (await keychainBackend.isAvailable()) {
    const key = await keychainBackend.get(provider);
    if (key) return key;
  }

  // 3. Encrypted file
  const key = await encryptedFileBackend.get(provider);
  if (key) return key;

  return undefined;
}

/** Resolve the source where the API key is stored. */
export async function resolveApiKeySource(
  provider: string
): Promise<{ key: string; source: CredentialSource } | undefined> {
  // 1. Environment variable
  const envVar = ENV_KEY_MAP[provider];
  if (envVar && process.env[envVar]) {
    return { key: process.env[envVar]!, source: 'env' };
  }

  // 2. OS Keychain
  if (await keychainBackend.isAvailable()) {
    const key = await keychainBackend.get(provider);
    if (key) return { key, source: 'keychain' };
  }

  // 3. Encrypted file
  const key = await encryptedFileBackend.get(provider);
  if (key) return { key, source: 'encrypted-file' };

  return undefined;
}

/**
 * Save an API key to the best available secure backend.
 * Prefers OS keychain; falls back to encrypted file.
 */
export async function saveCredential(provider: string, apiKey: string): Promise<CredentialSource> {
  if (await keychainBackend.isAvailable()) {
    await keychainBackend.set(provider, apiKey);
    return 'keychain';
  }

  await encryptedFileBackend.set(provider, apiKey);
  return 'encrypted-file';
}

/** Delete a stored credential from all backends. */
export async function clearCredential(provider: string): Promise<void> {
  await keychainBackend.delete(provider);
  await encryptedFileBackend.delete(provider);
}

/**
 * Load all stored credentials (for display/diagnostic purposes).
 * Aggregates from keychain and encrypted file.
 */
export async function loadCredentials(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  // Load from encrypted file first
  for (const provider of ['anthropic', 'openai']) {
    const key = await encryptedFileBackend.get(provider);
    if (key) result[provider] = key;
  }

  // Keychain entries override (they're the preferred backend)
  if (await keychainBackend.isAvailable()) {
    for (const provider of ['anthropic', 'openai']) {
      const key = await keychainBackend.get(provider);
      if (key) result[provider] = key;
    }
  }

  return result;
}

/** Reset migration flag — only used in tests. */
export function _resetMigration(): void {
  migrationDone = false;
}
