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
