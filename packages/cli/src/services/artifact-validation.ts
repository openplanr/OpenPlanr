import YAML from 'yaml';
import type { ArtifactType } from '../models/types.js';
import { parseTaskCheckboxLines } from '../utils/markdown.js';

export class ArtifactInvariantError extends Error {
  constructor(
    public readonly artifactId: string,
    public readonly violation: string,
    public readonly diff?: string,
  ) {
    super(`Refusing to write ${artifactId}: ${violation}`);
    this.name = 'ArtifactInvariantError';
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/**
 * Validate structural invariants before writing an artifact to disk.
 * Returns `{ ok: true }` when safe to write, or `{ ok: false, reason }` on violation.
 *
 * Checks (in order):
 * 1. Frontmatter fences present (opens with `---`, has matching close)
 * 2. YAML between fences is parseable
 * 3. Identity field (`id:`) preserved if present in original
 * 4. Checkbox IDs preserved (every N.M id in `before` is still a checkbox in `after`)
 */
export function validateArtifactBytes(
  _type: ArtifactType,
  before: string,
  after: string,
): { ok: true } | { ok: false; reason: string } {
  const fmMatch = FRONTMATTER_RE.exec(after);
  if (!fmMatch) {
    return { ok: false, reason: 'missing or malformed frontmatter fences' };
  }

  let afterData: Record<string, unknown>;
  try {
    afterData = YAML.parse(fmMatch[1]) ?? {};
  } catch (e) {
    return { ok: false, reason: `frontmatter YAML invalid: ${(e as Error).message}` };
  }

  const beforeFmMatch = FRONTMATTER_RE.exec(before);
  if (beforeFmMatch) {
    try {
      const beforeData = YAML.parse(beforeFmMatch[1]) ?? {};
      if (beforeData.id && beforeData.id !== afterData.id) {
        return { ok: false, reason: `id changed from "${beforeData.id}" to "${afterData.id}"` };
      }
    } catch {
      // before was already broken — skip identity check
    }
  }

  const beforeCheckboxes = parseTaskCheckboxLines(before);
  if (beforeCheckboxes.length > 0) {
    const afterCheckboxes = parseTaskCheckboxLines(after);
    const afterIds = new Set(afterCheckboxes.map((t) => t.id));
    const lost = beforeCheckboxes.filter((t) => !afterIds.has(t.id)).map((t) => t.id);
    if (lost.length > 0) {
      return { ok: false, reason: `checkbox ids dropped from body: ${lost.join(', ')}` };
    }
  }

  return { ok: true };
}
