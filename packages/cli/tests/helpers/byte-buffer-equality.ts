import { Buffer } from 'node:buffer';

/** Preserve exact Buffer byte equality; let Vitest handle every other value. */
export function byteBufferEquality(left: unknown, right: unknown): boolean | undefined {
  if (Buffer.isBuffer(left) && Buffer.isBuffer(right)) return left.equals(right);
  return undefined;
}
