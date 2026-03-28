/**
 * Manages API key storage in the user's home directory.
 *
 * Keys are stored in ~/.planr/credentials.json with restricted
 * file permissions (0o600). Environment variables take precedence
 * over stored credentials.
 */

import path from 'node:path';
import os from 'node:os';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { ENV_KEY_MAP } from '../ai/types.js';

const CREDENTIALS_DIR = path.join(os.homedir(), '.planr');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');

interface Credentials {
  [provider: string]: string;
}

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(() => true).catch(() => false);
}

export async function loadCredentials(): Promise<Credentials> {
  if (!(await pathExists(CREDENTIALS_FILE))) return {};

  try {
    const raw = await readFile(CREDENTIALS_FILE, 'utf-8');
    return JSON.parse(raw) as Credentials;
  } catch {
    return {};
  }
}

export async function saveCredential(provider: string, apiKey: string): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });

  const credentials = await loadCredentials();
  credentials[provider] = apiKey;

  await writeFile(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export async function clearCredential(provider: string): Promise<void> {
  const credentials = await loadCredentials();
  delete credentials[provider];

  await writeFile(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

/**
 * Resolve API key for a provider using the fallback chain:
 * 1. Environment variable (ANTHROPIC_API_KEY, OPENAI_API_KEY)
 * 2. ~/.planr/credentials.json
 * 3. undefined (caller decides how to handle)
 */
export async function resolveApiKey(provider: string): Promise<string | undefined> {
  // Check environment variable first
  const envVar = ENV_KEY_MAP[provider];
  if (envVar && process.env[envVar]) {
    return process.env[envVar];
  }

  // Fall back to stored credentials
  const credentials = await loadCredentials();
  return credentials[provider];
}
