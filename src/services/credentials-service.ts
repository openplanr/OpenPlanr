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
import { logger } from '../utils/logger.js';
import type { CredentialSource } from './credential-backends.js';
import { encryptedFileBackend, keychainBackend, legacyBackend } from './credential-backends.js';

// ---------------------------------------------------------------------------
// Env-var access (explicit allowlist — avoids dynamic process.env lookups)
// ---------------------------------------------------------------------------

/** Allowed environment variable names for API key resolution. */
const ALLOWED_ENV_VARS = new Set(Object.values(ENV_KEY_MAP));

/**
 * Read an API key from an environment variable.
 * Only reads from the explicit allowlist defined in ENV_KEY_MAP.
 */
function readEnvKey(provider: string): string | undefined {
  const envVar = ENV_KEY_MAP[provider];
  if (!envVar || !ALLOWED_ENV_VARS.has(envVar)) return undefined;
  return process.env[envVar];
}

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

  // Prevent re-entrant calls while migration is in progress
  migrationDone = true;

  try {
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

    // Remove the plaintext file only after all keys migrated successfully
    await legacyBackend.remove();
    return true;
  } catch (err) {
    logger.debug('Credential migration failed', err);
    // Migration failed — reset flag so it retries next time
    migrationDone = false;
    return false;
  }
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

  // 1. Environment variable (explicit allowlist)
  const envKey = readEnvKey(provider);
  if (envKey) return envKey;

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
  provider: string,
): Promise<{ key: string; source: CredentialSource } | undefined> {
  // Run one-time migration from legacy plaintext file
  await migrateCredentials();

  // 1. Environment variable (explicit allowlist)
  const envKey = readEnvKey(provider);
  if (envKey) return { key: envKey, source: 'env' };

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
    try {
      await keychainBackend.set(provider, apiKey);
      return 'keychain';
    } catch (err) {
      logger.debug('Keychain write failed, falling back to encrypted file', err);
      // Keychain write failed (locked, permission error, transient failure).
      // Fall through to encrypted file backend.
    }
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
  for (const provider of ['anthropic', 'openai', 'linear']) {
    const key = await encryptedFileBackend.get(provider);
    if (key) result[provider] = key;
  }

  // Keychain entries override (they're the preferred backend)
  if (await keychainBackend.isAvailable()) {
    for (const provider of ['anthropic', 'openai', 'linear']) {
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
