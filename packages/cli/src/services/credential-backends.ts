/**
 * Credential storage backends.
 *
 * Three backends in order of preference:
 * 1. OS Keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
 * 2. Encrypted file (~/.planr/credentials.enc) using AES-256-GCM
 * 3. Legacy plaintext file (~/.planr/credentials.json) — read-only, for migration
 */

import crypto from 'node:crypto';
import { access, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { parseExternalJson } from '../utils/external-json.js';
import { logger } from '../utils/logger.js';
import { withCredentialWriteLock } from './credential-write-lock.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CredentialSource = 'env' | 'keychain' | 'encrypted-file';

export interface CredentialBackend {
  readonly name: CredentialSource;
  get(provider: string): Promise<string | undefined>;
  set(provider: string, value: string): Promise<void>;
  delete(provider: string): Promise<boolean>;
  isAvailable(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLANR_DIR = path.join(os.homedir(), '.planr');
const KEYCHAIN_SERVICE = 'planr';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  return access(p)
    .then(() => true)
    .catch(() => false);
}

// ---------------------------------------------------------------------------
// 1. OS Keychain Backend
// ---------------------------------------------------------------------------

/** Cache keychain availability to avoid repeated probes. */
let keychainAvailable: boolean | null = null;

export class KeychainBackend implements CredentialBackend {
  readonly name = 'keychain' as const;

  async isAvailable(): Promise<boolean> {
    if (keychainAvailable !== null) return keychainAvailable;

    try {
      const mod = await import('@napi-rs/keyring');
      // Probe: write and immediately delete a test entry
      const testEntry = new mod.Entry(KEYCHAIN_SERVICE, '__planr_probe__');
      testEntry.setPassword('probe');
      testEntry.deleteCredential();
      keychainAvailable = true;
    } catch (err) {
      logger.debug('Keychain availability probe failed', err);
      keychainAvailable = false;
    }

    return keychainAvailable;
  }

  async get(provider: string): Promise<string | undefined> {
    try {
      const mod = await import('@napi-rs/keyring');
      const entry = new mod.Entry(KEYCHAIN_SERVICE, provider);
      return entry.getPassword() ?? undefined;
    } catch (err) {
      logger.debug('Keychain read failed', err);
      return undefined;
    }
  }

  async getStrict(provider: string): Promise<string | undefined> {
    const mod = await import('@napi-rs/keyring');
    return new mod.Entry(KEYCHAIN_SERVICE, provider).getPassword() ?? undefined;
  }

  async deleteStrict(provider: string): Promise<boolean> {
    const mod = await import('@napi-rs/keyring');
    // The native method returns false for an absent entry and throws on failure.
    new mod.Entry(KEYCHAIN_SERVICE, provider).deleteCredential();
    return true;
  }

  async set(provider: string, value: string): Promise<void> {
    const mod = await import('@napi-rs/keyring');
    const entry = new mod.Entry(KEYCHAIN_SERVICE, provider);
    entry.setPassword(value);
  }

  async delete(provider: string): Promise<boolean> {
    try {
      const mod = await import('@napi-rs/keyring');
      const entry = new mod.Entry(KEYCHAIN_SERVICE, provider);
      return entry.deleteCredential();
    } catch (err) {
      logger.debug('Keychain delete failed', err);
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Encrypted File Backend
// ---------------------------------------------------------------------------

const CREDENTIAL_PASSPHRASE_ENV = 'PLANR_CREDENTIAL_FILE_PASSPHRASE';
const MINIMUM_PASSPHRASE_LENGTH = 20;

/** Derive a 256-bit key only from an explicit operator secret and installation salt. */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
}

/** Read legacy ciphertext without continuing to use machine identity for new writes. */
function deriveLegacyKey(salt: Buffer): Buffer {
  const machineId = `${os.hostname()}:${os.userInfo().username}`;
  return crypto.scryptSync(machineId, salt, 32, { N: 16384, r: 8, p: 1 });
}

/** Get or create the per-installation salt. */
async function getSalt(planrDir: string, saltFile: string): Promise<Buffer> {
  await mkdir(planrDir, { recursive: true });

  if (await pathExists(saltFile)) {
    const hex = await readFile(saltFile, 'utf-8');
    return Buffer.from(hex.trim(), 'hex');
  }

  const salt = crypto.randomBytes(16);
  await writeFile(saltFile, salt.toString('hex'), { encoding: 'utf-8', mode: 0o600 });
  return salt;
}

const envelopeSchema = z.object({
  version: z.literal([1, 2]).optional(),
  kdf: z.literal('scrypt').optional(),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});

type EncryptedEnvelope = z.infer<typeof envelopeSchema>;

const credentialsSchema = z.record(z.string(), z.string());

function encrypt(plaintext: string, key: Buffer): EncryptedEnvelope {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 2,
    kdf: 'scrypt',
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  };
}

function decrypt(envelope: EncryptedEnvelope, key: Buffer): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf-8');
}

export class EncryptedFileBackend implements CredentialBackend {
  readonly name = 'encrypted-file' as const;
  private readonly planrDir: string;
  private readonly encryptedFile: string;
  private readonly saltFile: string;
  private readonly configuredPassphrase: string | undefined;

  constructor(planrDir = PLANR_DIR, options: { passphrase?: string } = {}) {
    this.planrDir = planrDir;
    this.encryptedFile = path.join(planrDir, 'credentials.enc');
    this.saltFile = path.join(planrDir, '.credential-salt');
    this.configuredPassphrase = options.passphrase;
  }

  private passphrase(): string | undefined {
    const value = this.configuredPassphrase ?? process.env[CREDENTIAL_PASSPHRASE_ENV];
    return typeof value === 'string' && value.length >= MINIMUM_PASSPHRASE_LENGTH
      ? value
      : undefined;
  }

  async isAvailable(): Promise<boolean> {
    return this.passphrase() !== undefined;
  }

  private requirePassphrase(): string {
    const value = this.passphrase();
    if (!value) {
      throw new Error(
        `${CREDENTIAL_PASSPHRASE_ENV} must contain at least ${MINIMUM_PASSPHRASE_LENGTH} characters when the OS keychain is unavailable.`,
      );
    }
    return value;
  }

  private async loadAll(strict = false): Promise<Record<string, string>> {
    if (!(await pathExists(this.encryptedFile))) return {};

    try {
      const raw = await readFile(this.encryptedFile, 'utf-8');
      const envelope = parseExternalJson(raw, envelopeSchema, this.encryptedFile);
      const salt = await getSalt(this.planrDir, this.saltFile);
      const key =
        envelope.version === 2 ? deriveKey(this.requirePassphrase(), salt) : deriveLegacyKey(salt);
      return parseExternalJson(
        decrypt(envelope, key),
        credentialsSchema,
        `The decrypted payload of ${this.encryptedFile}`,
        { secret: true },
      );
    } catch (err) {
      if (strict)
        throw new Error(
          'The encrypted credential store cannot be read. Existing contents were preserved.',
          { cause: err },
        );
      logger.debug('Failed to decrypt credentials file', err);
      // Backup corrupted/unreadable file before it gets overwritten by a
      // subsequent set() call — avoids silent credential loss.
      try {
        const backupPath = `${this.encryptedFile}.bak`;
        const raw = await readFile(this.encryptedFile);
        await writeFile(backupPath, raw, { mode: 0o600 });
      } catch (err) {
        logger.debug('Failed to backup corrupted credentials file', err);
        // Best-effort backup; ignore if it fails too
      }
      return {};
    }
  }

  private async saveAll(credentials: Record<string, string>): Promise<void> {
    await mkdir(this.planrDir, { recursive: true });
    const salt = await getSalt(this.planrDir, this.saltFile);
    const key = deriveKey(this.requirePassphrase(), salt);
    const envelope = encrypt(JSON.stringify(credentials), key);
    const temporary = `${this.encryptedFile}.${crypto.randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(envelope, null, 2), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.encryptedFile);
      if (process.platform !== 'win32') {
        const directory = await open(this.planrDir, 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  async getStrict(provider: string): Promise<string | undefined> {
    return (await this.loadAll(true))[provider];
  }

  async setStrict(provider: string, value: string): Promise<void> {
    return withCredentialWriteLock(this.planrDir, async () => {
      const all = await this.loadAll(true);
      all[provider] = value;
      await this.saveAll(all);
    });
  }

  async deleteStrict(provider: string): Promise<boolean> {
    return withCredentialWriteLock(this.planrDir, async () => {
      const all = await this.loadAll(true);
      if (!Object.hasOwn(all, provider)) return true;
      delete all[provider];
      await this.saveAll(all);
      return true;
    });
  }

  async get(provider: string): Promise<string | undefined> {
    const all = await this.loadAll();
    return all[provider];
  }

  async set(provider: string, value: string): Promise<void> {
    return withCredentialWriteLock(this.planrDir, async () => {
      const all = await this.loadAll(true);
      all[provider] = value;
      await this.saveAll(all);
    });
  }

  async delete(provider: string): Promise<boolean> {
    return withCredentialWriteLock(this.planrDir, async () => {
      const all = await this.loadAll(true);
      if (!Object.hasOwn(all, provider)) return false;
      delete all[provider];
      await this.saveAll(all);
      return true;
    });
  }
}

// ---------------------------------------------------------------------------
// 3. Legacy Plaintext Backend (read-only, for migration)
// ---------------------------------------------------------------------------

const LEGACY_FILE = path.join(PLANR_DIR, 'credentials.json');

export class LegacyPlaintextBackend {
  private readonly file: string;

  constructor(file = LEGACY_FILE) {
    this.file = file;
  }

  async exists(): Promise<boolean> {
    return pathExists(this.file);
  }

  /** Throws on unreadable or off-schema content so migration keeps the file instead of deleting it. */
  async loadAll(): Promise<Record<string, string>> {
    if (!(await pathExists(this.file))) return {};
    return parseExternalJson(await readFile(this.file, 'utf-8'), credentialsSchema, this.file, {
      secret: true,
    });
  }

  async remove(): Promise<void> {
    try {
      await unlink(this.file);
    } catch (err) {
      logger.debug('Failed to remove legacy credentials file', err);
      // Ignore if already gone
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instances
// ---------------------------------------------------------------------------

export const keychainBackend = new KeychainBackend();
export const encryptedFileBackend = new EncryptedFileBackend();
export const legacyBackend = new LegacyPlaintextBackend();
