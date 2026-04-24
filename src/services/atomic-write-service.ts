/**
 * Atomic artifact writes with sidecar backup.
 *
 * Atomicity = temp file → fsync → rename. If any step fails mid-write, the
 * original file was never modified and the temp file is removed. There is
 * nothing to "roll back" at the file level — atomicity is the guarantee.
 * The word "rollback" is reserved for the post-flight git mechanism.
 *
 * The sidecar backup copy is for *manual* recovery (e.g., if a user wants
 * to diff an already-written artifact against what was there before). It is
 * not consulted by any automated rollback path.
 */

import { close, constants, copyFile, fsync, open, rename, unlink, writeFile } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ensureDir } from '../utils/fs.js';

const copyFileAsync = promisify(copyFile);
const fsyncAsync = promisify(fsync);
const renameAsync = promisify(rename);
const unlinkAsync = promisify(unlink);
const writeFileAsync = promisify(writeFile);
const openAsync = promisify(open);
const closeAsync = promisify(close);

export interface AtomicWriteOptions {
  /**
   * If provided, the original file is copied here before the write. A
   * typical value is `.planr/reports/revise-<scope>-<date>/backup/<name>.bak`.
   * Missing originals (first write) silently skip the backup step — there
   * is nothing to back up.
   */
  backupPath?: string;
}

export interface AtomicWriteResult {
  /** Absolute path of the file that now holds the new content. */
  targetPath: string;
  /** Absolute path of the sidecar backup, if one was created. */
  backupPath?: string;
}

/**
 * Replace `targetPath` atomically with `content`. Creates the target's
 * parent directory if needed. When `options.backupPath` is set, the
 * existing file (if any) is copied there before the new content is written.
 */
export async function atomicWriteFile(
  targetPath: string,
  content: string,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  await ensureDir(path.dirname(targetPath));

  let backupCreated: string | undefined;
  if (options.backupPath) {
    backupCreated = await backupIfPresent(targetPath, options.backupPath);
  }

  // Temp file in the same directory as the target — required for rename to
  // be atomic (cross-device renames fall back to copy + delete on some fs).
  const tmpName = `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`;
  const tmpPath = path.join(path.dirname(targetPath), tmpName);

  try {
    await writeFileAsync(tmpPath, content, 'utf-8');
    // fsync the temp file so the new content is durable before the rename.
    const fd = await openAsync(tmpPath, constants.O_RDONLY);
    try {
      await fsyncAsync(fd);
    } finally {
      await closeAsync(fd);
    }
    await renameAsync(tmpPath, targetPath);
    return { targetPath, backupPath: backupCreated };
  } catch (err) {
    // Best-effort cleanup of the temp file; the original is already safe.
    await unlinkAsync(tmpPath).catch(() => {
      // ignore — temp file may not exist if write never started
    });
    throw err;
  }
}

/**
 * Copy `targetPath` to `backupPath` when the original exists. Returns the
 * backup path on success, or `undefined` when there was nothing to back up
 * (original absent). Throws on unexpected I/O errors so callers do not
 * silently proceed with a missing safety copy.
 */
export async function backupIfPresent(
  targetPath: string,
  backupPath: string,
): Promise<string | undefined> {
  await ensureDir(path.dirname(backupPath));
  try {
    await copyFileAsync(targetPath, backupPath, constants.COPYFILE_EXCL);
    return backupPath;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // Original file doesn't exist — not a real error, nothing to back up.
      return undefined;
    }
    if (code === 'EEXIST') {
      // Backup slot already taken (possible on re-run against same scope/date).
      // Fall back to non-exclusive copy so re-runs remain idempotent.
      await copyFileAsync(targetPath, backupPath);
      return backupPath;
    }
    throw err;
  }
}
