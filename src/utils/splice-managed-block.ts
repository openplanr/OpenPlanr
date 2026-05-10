const BEGIN_RE = (name: string) => new RegExp(`^<!--\\s*##planr-${name}:begin##[^>]*-->\\s*$`, 'm');
const END_RE = (name: string) => new RegExp(`^<!--\\s*##planr-${name}:end##\\s*-->\\s*$`, 'm');

function beginMarker(name: string): string {
  return `<!-- ##planr-${name}:begin## (managed by planr CLI; preserve hand-edits outside this block) -->`;
}

function endMarker(name: string): string {
  return `<!-- ##planr-${name}:end## -->`;
}

/**
 * Splice `newBlockContent` into `existing` between managed-block markers
 * identified by `markerName`.
 *
 * - Markers exist → replace only the content between them (markers kept).
 * - No markers (or orphan begin without end) → append at end with markers.
 * - Content outside markers is never modified.
 * - Idempotent: splicing the same content twice yields identical output.
 */
export function spliceManagedBlock(
  existing: string,
  markerName: string,
  newBlockContent: string,
): string {
  const beginMatch = BEGIN_RE(markerName).exec(existing);
  const endMatch = END_RE(markerName).exec(existing);

  const wrappedBlock = [
    beginMarker(markerName),
    newBlockContent.trimEnd(),
    endMarker(markerName),
  ].join('\n');

  if (beginMatch && endMatch && endMatch.index > beginMatch.index) {
    const before = existing.slice(0, beginMatch.index);
    const after = existing.slice(endMatch.index + endMatch[0].length);
    return `${before}${wrappedBlock}${after}`;
  }

  const trimmed = existing.trimEnd();
  if (trimmed.length === 0) return `${wrappedBlock}\n`;
  return `${trimmed}\n\n${wrappedBlock}\n`;
}
