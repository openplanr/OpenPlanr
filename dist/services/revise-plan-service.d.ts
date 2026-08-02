/**
 * Revise plan parser.
 *
 * A "plan" is a previously-written revise audit log that we replay to disk
 * without any model calls. This service parses a Markdown audit file
 * emitted by `audit-log-service.ts` back into structured `ReviseAuditEntry`
 * records that the CLI's apply-from-audit path can replay.
 *
 * Parsing is deliberately strict about structure but tolerant of
 * whitespace — audit files are written by us and edited by no-one, so we
 * can rely on the heading hierarchy and section markers. If a user has
 * hand-edited the audit, the parser surfaces specific errors so the user
 * can fix or discard the file rather than silently getting bad replays.
 *
 * Future extension: we may emit a sidecar `.plan.json` next to the
 * Markdown audit to carry content hashes and `revisedMarkdown` without
 * parsing overhead. The Markdown path remains supported indefinitely —
 * older audits predate any sidecar format and still need replay support.
 */
import type { ReviseAuditEntry } from '../models/types.js';
export interface ReplayablePlan {
    /** Absolute path of the audit file this plan was parsed from. */
    sourcePath: string;
    /** Scope recorded in the audit header (e.g., "EPIC-001"). */
    scope: string;
    /** When the dry-run was started, from the audit header. */
    startedAt?: string;
    /** All entries, preserving original order. Includes skipped/flagged for the summary. */
    entries: ReviseAuditEntry[];
}
/**
 * Parse a revise Markdown audit log into its constituent entries.
 * Throws if the file cannot be read, is empty, or has no entries.
 */
export declare function readPlanFromAudit(auditPath: string): ReplayablePlan;
/** Entries that can actually be written on replay (have a diff and target path). */
export declare function filterReplayable(plan: ReplayablePlan): ReviseAuditEntry[];
//# sourceMappingURL=revise-plan-service.d.ts.map