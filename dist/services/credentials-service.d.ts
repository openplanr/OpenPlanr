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
import type { CredentialSource } from './credential-backends.js';
/**
 * Migrate credentials from legacy plaintext file to the preferred backend.
 * Runs once per process, transparently on first key resolution.
 */
export declare function migrateCredentials(): Promise<boolean>;
/**
 * Resolve API key for a provider using the secure fallback chain:
 * 1. Environment variable (ANTHROPIC_API_KEY, OPENAI_API_KEY)
 * 2. OS Keychain
 * 3. Encrypted file (~/.planr/credentials.enc)
 * 4. undefined
 */
export declare function resolveApiKey(provider: string): Promise<string | undefined>;
/** Resolve the source where the API key is stored. */
export declare function resolveApiKeySource(provider: string): Promise<{
    key: string;
    source: CredentialSource;
} | undefined>;
/**
 * Save an API key to the best available secure backend.
 * Prefers OS keychain; falls back to encrypted file.
 */
export declare function saveCredential(provider: string, apiKey: string): Promise<CredentialSource>;
/** Delete a stored credential from all backends. */
export declare function clearCredential(provider: string): Promise<void>;
/**
 * Load all stored credentials (for display/diagnostic purposes).
 * Aggregates from keychain and encrypted file.
 */
export declare function loadCredentials(): Promise<Record<string, string>>;
/** Reset migration flag — only used in tests. */
export declare function _resetMigration(): void;
//# sourceMappingURL=credentials-service.d.ts.map