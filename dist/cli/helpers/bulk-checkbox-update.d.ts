/**
 * Shared helpers for `--all-done` / `--all-pending` flags on `planr <type>
 * update` commands. The flag flips every `N.M` task checkbox in the
 * artifact body to one canonical state and sets the matching frontmatter
 * `status` value, in a single user-facing operation.
 *
 * BL-015 — closes the gap where shipping a feature meant manually ticking
 * every subtask checkbox after `planr <type> update --status done`.
 */
import type { ArtifactType, OpenPlanrConfig } from '../../models/types.js';
export interface BulkCheckboxApplyResult {
    /** The status value written to frontmatter (derived from the flag). */
    status: 'done' | 'pending';
    /** True when the body actually contained any checkboxes that flipped. */
    flippedAny: boolean;
}
/**
 * Validate that `--status`, `--all-done`, and `--all-pending` aren't
 * combined in mutually-exclusive ways. Returns the resolved status value
 * to write (or `null` to use the explicit `--status` path), or throws a
 * user-friendly error.
 */
export declare function resolveBulkStatusIntent(opts: {
    status?: string;
    allDone?: boolean;
    allPending?: boolean;
}): {
    useBulk: false;
    status?: string;
} | {
    useBulk: true;
    bulkStatus: 'done' | 'pending';
};
/**
 * Apply the bulk-checkbox flag to one artifact: rewrite the body (flip every
 * `N.M` checkbox) and set the matching frontmatter status. Atomic per write
 * (body + frontmatter are two separate atomic-write calls; a failure between
 * them leaves the body flipped but status untouched — recoverable).
 */
export declare function applyBulkCheckboxes(projectDir: string, config: OpenPlanrConfig, type: ArtifactType, id: string, bulkStatus: 'done' | 'pending'): Promise<BulkCheckboxApplyResult>;
//# sourceMappingURL=bulk-checkbox-update.d.ts.map