/**
 * Utility functions for the agents module.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

/**
 * Check if a command exists on the system PATH.
 * Returns the path to the command or null.
 */
export async function which(command: string): Promise<string | null> {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execFileAsync(cmd, [command]);
    return stdout.trim() || null;
  } catch (err) {
    logger.debug('Command lookup failed', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Retry helpers (shared across agent adapters)
// ---------------------------------------------------------------------------

export const MAX_RETRIES = 2;
export const RETRY_DELAY_MS = 3000;

/** Patterns in stderr that indicate a transient/retryable API error */
const RETRYABLE_PATTERNS = [
  'tool use concurrency',
  'overloaded',
  '429',
  '500',
  '503',
  'rate limit',
  'econnreset',
  'socket hang up',
];

export function isRetryableError(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return RETRYABLE_PATTERNS.some((p) => lower.includes(p));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
