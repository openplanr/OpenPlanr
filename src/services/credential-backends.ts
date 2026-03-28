/**
 * Credential storage backends.
 *
 * Three backends in order of preference:
 * 1. OS Keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
 * 2. Encrypted file (~/.planr/credentials.enc) using AES-256-GCM
 * 3. Legacy plaintext file (~/.planr/credentials.json) — read-only, for migration
 */

import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { mkdir, writeFile, readFile, access, unlink } from 'node:fs/promises';

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
    } catch {
      keychainAvailable = false;
    }

    return keychainAvailable;
  }

  async get(provider: string): Promise<string | undefined> {
    try {
      const mod = await import('@napi-rs/keyring');
      const entry = new mod.Entry(KEYCHAIN_SERVICE, provider);
      return entry.getPassword() ?? undefined;
    } catch {
      return undefined;
    }
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
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Encrypted File Backend
// ---------------------------------------------------------------------------

const ENC_FILE = path.join(PLANR_DIR, 'credentials.enc');
const SALT_FILE = path.join(PLANR_DIR, '.credential-salt');

/** Derive a 256-bit key from machine identity + per-installation salt. */
function deriveKey(salt: Buffer): Buffer {
  const machineId = `${os.hostname()}:${os.userInfo().username}`;
  return crypto.scryptSync(machineId, salt, 32, { N: 16384, r: 8, p: 1 });
}

/** Get or create the per-installation salt. */
async function getSalt(): Promise<Buffer> {
  await mkdir(PLANR_DIR, { recursive: true });

  if (await pathExists(SALT_FILE)) {
    const hex = await readFile(SALT_FILE, 'utf-8');
    return Buffer.from(hex.trim(), 'hex');
  }

  const salt = crypto.randomBytes(16);
  await writeFile(SALT_FILE, salt.toString('hex'), { encoding: 'utf-8', mode: 0o600 });
  return salt;
}

interface EncryptedEnvelope {
  iv: string;
  tag: string;
  data: string;
}

function encrypt(plaintext: string, key: Buffer): EncryptedEnvelope {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  };
}

function decrypt(envelope: EncryptedEnvelope, key: Buffer): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf-8');
}

export class EncryptedFileBackend implements CredentialBackend {
  readonly name = 'encrypted-file' as const;

  async isAvailable(): Promise<boolean> {
    return true; // Always available as the universal fallback
  }

  private async loadAll(): Promise<Record<string, string>> {
    if (!(await pathExists(ENC_FILE))) return {};

    try {
      const raw = await readFile(ENC_FILE, 'utf-8');
      const envelope: EncryptedEnvelope = JSON.parse(raw);
      const salt = await getSalt();
      const key = deriveKey(salt);
      const json = decrypt(envelope, key);
      return JSON.parse(json) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private async saveAll(credentials: Record<string, string>): Promise<void> {
    await mkdir(PLANR_DIR, { recursive: true });
    const salt = await getSalt();
    const key = deriveKey(salt);
    const envelope = encrypt(JSON.stringify(credentials), key);
    await writeFile(ENC_FILE, JSON.stringify(envelope, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }

  async get(provider: string): Promise<string | undefined> {
    const all = await this.loadAll();
    return all[provider];
  }

  async set(provider: string, value: string): Promise<void> {
    const all = await this.loadAll();
    all[provider] = value;
    await this.saveAll(all);
  }

  async delete(provider: string): Promise<boolean> {
    const all = await this.loadAll();
    if (!(provider in all)) return false;
    delete all[provider];
    await this.saveAll(all);
    return true;
  }
}

// ---------------------------------------------------------------------------
// 3. Legacy Plaintext Backend (read-only, for migration)
// ---------------------------------------------------------------------------

const LEGACY_FILE = path.join(PLANR_DIR, 'credentials.json');

export class LegacyPlaintextBackend {
  async exists(): Promise<boolean> {
    return pathExists(LEGACY_FILE);
  }

  async loadAll(): Promise<Record<string, string>> {
    if (!(await pathExists(LEGACY_FILE))) return {};

    try {
      const raw = await readFile(LEGACY_FILE, 'utf-8');
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }

  async remove(): Promise<void> {
    try {
      await unlink(LEGACY_FILE);
    } catch {
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
