/**
 * Global non-interactive state.
 *
 * Centralises the check so prompt-service doesn't need
 * a reference to the Commander program instance.
 */

import { logger } from '../utils/logger.js';

let nonInteractive = false;

export function setNonInteractive(value: boolean): void {
  nonInteractive = value;
}

export function isNonInteractive(): boolean {
  return nonInteractive || !process.stdin.isTTY;
}

/**
 * Exit early if --manual is used in a non-interactive environment.
 * Call this at the top of any command action that supports --manual.
 */
export function requireInteractiveForManual(manual: boolean | undefined): void {
  if (manual && isNonInteractive()) {
    logger.error('Manual mode requires an interactive terminal.');
    process.exit(1);
  }
}
