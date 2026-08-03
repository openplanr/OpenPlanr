import type { ArtifactType } from '../models/types.js';
export declare class ArtifactInvariantError extends Error {
    readonly artifactId: string;
    readonly violation: string;
    readonly diff?: string | undefined;
    constructor(artifactId: string, violation: string, diff?: string | undefined);
}
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
export declare function validateArtifactBytes(_type: ArtifactType, before: string, after: string): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
//# sourceMappingURL=artifact-validation.d.ts.map