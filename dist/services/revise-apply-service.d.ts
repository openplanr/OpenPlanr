/**
 * Replay a previously-written revise audit to disk without any model calls.
 *
 * Implements after `planr revise --dry-run` produces an audit log
 * with the proposed diffs, `planr revise --apply-from <audit>` reads those
 * diffs and writes them to the corresponding artifacts. Zero tokens spent
 * in this mode.
 *
 * Pipeline:
 *   1. Clean-tree gate (same as normal revise)
 *   2. Parse the audit (via `revise-plan-service`) → list of replayable entries
 *   3. Filter to `would-apply` entries that have a diff + artifact path
 *   4. Per entry:
 *      a. Read current artifact content
 *      b. Apply the stored diff; if the diff doesn't land cleanly (the
 *         source has drifted since the dry-run), skip the entry and
 *         record the skip reason in the new audit
 *      c. Atomic write with sidecar backup
 *      d. Append an `applied-from-plan` entry to the new audit log
 *   5. Post-flight graph-integrity check + git rollback on break
 *
 * Safety gates preserved vs. normal apply:
 * - Clean-tree gate ✓
 * - Atomic writes (temp file + rename) ✓
 * - Post-flight graph integrity + git rollback ✓
 * - Per-artifact confirmation (prompt unless `--yes`) ✓
 *
 * Note: sidecar `.bak` files are deliberately NOT written on this path.
 * Rollback already flows through git (clean-tree gate guarantees HEAD is a
 * valid restore point), so per-file backups would be redundant noise in
 * `.planr/reports/`. The atomic-write guarantee covers partial-write
 * crashes; git covers "I wish I hadn't applied that."
 *
 * Deliberately NOT run on replay:
 * - AI model calls (the point of this feature)
 * - Evidence verification (the dry-run already verified; nothing changes
 *   between dry-run and apply that evidence verification would catch that
 *   the diff-apply staleness check doesn't already catch)
 * - `--cascade` / `--all` orchestration (the audit already encodes the
 *   cascade order as entry order)
 */
import type { OpenPlanrConfig } from '../models/types.js';
export interface ApplyFromAuditOptions {
    projectDir: string;
    config: OpenPlanrConfig;
    auditPath: string;
    allowDirty: boolean;
    /** Print the plan without writing — useful to confirm what would replay. */
    dryRun: boolean;
    /** Skip per-artifact confirmation; still requires typed-YES in an interactive TTY. */
    yes: boolean;
}
/** Returns the process exit code. 0 on success, 1 on fatal error, non-zero on partial/rollback. */
export declare function runApplyFromAudit(opts: ApplyFromAuditOptions): Promise<number>;
//# sourceMappingURL=revise-apply-service.d.ts.map