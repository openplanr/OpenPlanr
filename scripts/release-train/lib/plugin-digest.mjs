import { createHash } from 'node:crypto';

/**
 * SHA-256 over each file's path and bytes, in path order.
 * Modes are left out because workflow artifacts do not keep them.
 */
export function pluginDigest(entries) {
  const hash = createHash('sha256');
  for (const { path, bytes } of [...entries].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    if (!Buffer.isBuffer(bytes))
      throw new Error(`Cannot digest ${path}: it is not a regular file read in full.`);
    hash.update(`${path}\0${createHash('sha256').update(bytes).digest('hex')}\n`);
  }
  return hash.digest('hex');
}
