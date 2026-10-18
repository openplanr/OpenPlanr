export { reserveNextId as getNextId } from '../../lib/backlog-item.mjs';

/** Parse an artifact ID string (e.g. "FEAT-002", "FEAT-1204") into its prefix and numeric parts. */
export function parseId(id: string): { prefix: string; num: number } | null {
  const match = id.match(/^([A-Z]+)-(\d{3,})$/);
  if (!match) return null;
  return { prefix: match[1], num: parseInt(match[2], 10) };
}
