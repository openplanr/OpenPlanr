/**
 * Credential storage backends.
 *
 * Three backends in order of preference:
 * 1. OS Keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
 * 2. Encrypted file (~/.planr/credentials.enc) using AES-256-GCM
 * 3. Legacy plaintext file (~/.planr/credentials.json) — read-only, for migration
 */
import crypto from 'node:crypto';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../utils/logger.js';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PLANR_DIR = path.join(os.homedir(), '.planr');
const KEYCHAIN_SERVICE = 'planr';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function pathExists(p) {
    return access(p)
        .then(() => true)
        .catch(() => false);
}
// ---------------------------------------------------------------------------
// 1. OS Keychain Backend
// ---------------------------------------------------------------------------
/** Cache keychain availability to avoid repeated probes. */
let keychainAvailable = null;
export class KeychainBackend {
    name = 'keychain';
    async isAvailable() {
        if (keychainAvailable !== null)
            return keychainAvailable;
        try {
            const mod = await import('@napi-rs/keyring');
            // Probe: write and immediately delete a test entry
            const testEntry = new mod.Entry(KEYCHAIN_SERVICE, '__planr_probe__');
            testEntry.setPassword('probe');
            testEntry.deleteCredential();
            keychainAvailable = true;
        }
        catch (err) {
            logger.debug('Keychain availability probe failed', err);
            keychainAvailable = false;
        }
        return keychainAvailable;
    }
    async get(provider) {
        try {
            const mod = await import('@napi-rs/keyring');
            const entry = new mod.Entry(KEYCHAIN_SERVICE, provider);
            return entry.getPassword() ?? undefined;
        }
        catch (err) {
            logger.debug('Keychain read failed', err);
            return undefined;
        }
    }
    async set(provider, value) {
        const mod = await import('@napi-rs/keyring');
        const entry = new mod.Entry(KEYCHAIN_SERVICE, provider);
        entry.setPassword(value);
    }
    async delete(provider) {
        try {
            const mod = await import('@napi-rs/keyring');
            const entry = new mod.Entry(KEYCHAIN_SERVICE, provider);
            return entry.deleteCredential();
        }
        catch (err) {
            logger.debug('Keychain delete failed', err);
            return false;
        }
    }
}
// ---------------------------------------------------------------------------
// 2. Encrypted File Backend
// ---------------------------------------------------------------------------
/** Derive a 256-bit key from machine identity + per-installation salt. */
function deriveKey(salt) {
    const machineId = `${os.hostname()}:${os.userInfo().username}`;
    return crypto.scryptSync(machineId, salt, 32, { N: 16384, r: 8, p: 1 });
}
/** Get or create the per-installation salt. */
async function getSalt(planrDir, saltFile) {
    await mkdir(planrDir, { recursive: true });
    if (await pathExists(saltFile)) {
        const hex = await readFile(saltFile, 'utf-8');
        return Buffer.from(hex.trim(), 'hex');
    }
    const salt = crypto.randomBytes(16);
    await writeFile(saltFile, salt.toString('hex'), { encoding: 'utf-8', mode: 0o600 });
    return salt;
}
function encrypt(plaintext, key) {
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
function decrypt(envelope, key) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(envelope.data, 'hex')),
        decipher.final(),
    ]);
    return decrypted.toString('utf-8');
}
export class EncryptedFileBackend {
    name = 'encrypted-file';
    planrDir;
    encryptedFile;
    saltFile;
    constructor(planrDir = PLANR_DIR) {
        this.planrDir = planrDir;
        this.encryptedFile = path.join(planrDir, 'credentials.enc');
        this.saltFile = path.join(planrDir, '.credential-salt');
    }
    async isAvailable() {
        return true; // Always available as the universal fallback
    }
    async loadAll() {
        if (!(await pathExists(this.encryptedFile)))
            return {};
        try {
            const raw = await readFile(this.encryptedFile, 'utf-8');
            const envelope = JSON.parse(raw);
            const salt = await getSalt(this.planrDir, this.saltFile);
            const key = deriveKey(salt);
            const json = decrypt(envelope, key);
            return JSON.parse(json);
        }
        catch (err) {
            logger.debug('Failed to decrypt credentials file', err);
            // Backup corrupted/unreadable file before it gets overwritten by a
            // subsequent set() call — avoids silent credential loss.
            try {
                const backupPath = `${this.encryptedFile}.bak`;
                const raw = await readFile(this.encryptedFile);
                await writeFile(backupPath, raw, { mode: 0o600 });
            }
            catch (err) {
                logger.debug('Failed to backup corrupted credentials file', err);
                // Best-effort backup; ignore if it fails too
            }
            return {};
        }
    }
    async saveAll(credentials) {
        await mkdir(this.planrDir, { recursive: true });
        const salt = await getSalt(this.planrDir, this.saltFile);
        const key = deriveKey(salt);
        const envelope = encrypt(JSON.stringify(credentials), key);
        await writeFile(this.encryptedFile, JSON.stringify(envelope, null, 2), {
            encoding: 'utf-8',
            mode: 0o600,
        });
    }
    async get(provider) {
        const all = await this.loadAll();
        return all[provider];
    }
    async set(provider, value) {
        const all = await this.loadAll();
        all[provider] = value;
        await this.saveAll(all);
    }
    async delete(provider) {
        const all = await this.loadAll();
        if (!(provider in all))
            return false;
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
    async exists() {
        return pathExists(LEGACY_FILE);
    }
    async loadAll() {
        if (!(await pathExists(LEGACY_FILE)))
            return {};
        try {
            const raw = await readFile(LEGACY_FILE, 'utf-8');
            return JSON.parse(raw);
        }
        catch (err) {
            logger.debug('Failed to parse legacy credentials file', err);
            return {};
        }
    }
    async remove() {
        try {
            await unlink(LEGACY_FILE);
        }
        catch (err) {
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
//# sourceMappingURL=credential-backends.js.map