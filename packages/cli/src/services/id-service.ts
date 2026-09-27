import { escapeRegExp } from '../utils/escape-regexp.js';
import { listFiles } from '../utils/fs.js';

/** Return the next available sequential ID (e.g. "FEAT-004") for the given prefix in a directory. */
export async function getNextId(dir: string, prefix: string): Promise<string> {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d{3})`);
  const files = await listFiles(dir, pattern);
  const usedNums = new Set<number>();
  for (const file of files) {
    const match = file.match(pattern);
    if (match) {
      usedNums.add(parseInt(match[1], 10));
    }
  }
  // Find the first available gap starting from 1
  let next = 1;
  while (usedNums.has(next)) {
    next++;
  }
  const nextNum = next.toString().padStart(3, '0');
  return `${prefix}-${nextNum}`;
}

/** Parse an artifact ID string (e.g. "FEAT-002", "FEAT-1204") into its prefix and numeric parts. */
export function parseId(id: string): { prefix: string; num: number } | null {
  const match = id.match(/^([A-Z]+)-(\d{3,})$/);
  if (!match) return null;
  return { prefix: match[1], num: parseInt(match[2], 10) };
}
