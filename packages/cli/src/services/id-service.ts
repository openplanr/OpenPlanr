import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { escapeRegExp } from '../utils/escape-regexp.js';
import { ensureDir } from '../utils/fs.js';

/** Holds one empty file per issued ID, so the ID of a removed artifact is never issued again. */
const ISSUED_IDS_DIR = '.issued-ids';

/**
 * Reserve the next sequential ID (e.g. "FEAT-004") for `prefix` in `dir`, one past the highest
 * artifact file or reservation. Reserving is an exclusive create, so concurrent callers never share an ID.
 */
export async function getNextId(dir: string, prefix: string): Promise<string> {
  const issuedDir = path.join(dir, ISSUED_IDS_DIR);
  await ensureDir(issuedDir);
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d{3,})`);
  let next = 1;
  for (const directory of [dir, issuedDir]) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const match = entry.isDirectory() ? null : pattern.exec(entry.name);
      if (match) next = Math.max(next, Number.parseInt(match[1], 10) + 1);
    }
  }
  for (; ; next++) {
    const id = `${prefix}-${String(next).padStart(3, '0')}`;
    try {
      await writeFile(path.join(issuedDir, id), '', { flag: 'wx' });
      return id;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** Parse an artifact ID string (e.g. "FEAT-002", "FEAT-1204") into its prefix and numeric parts. */
export function parseId(id: string): { prefix: string; num: number } | null {
  const match = id.match(/^([A-Z]+)-(\d{3,})$/);
  if (!match) return null;
  return { prefix: match[1], num: parseInt(match[2], 10) };
}
