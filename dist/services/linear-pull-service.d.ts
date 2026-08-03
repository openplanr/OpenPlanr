/**
 * Linear → OpenPlanr pull-direction sync.
 *
 * Two concerns consolidated here because both are strictly pull and share
 * the same client lifecycle and auth surface:
 *
 *   1. **Workflow-status sync**: for Features and Stories with a stored
 *      `linearIssueId`, fetch the current Linear workflow state name and
 *      write OpenPlanr `status` frontmatter when mapped.
 *
 *   2. **Task checkbox sync**: bidirectional 3-way merge between local
 *      TASK markdown and Linear TaskList issue description bodies.
 *      Pull-side lives here; push-side lives in `linear-push-service.ts`.
 *
 * Keeping them in one module reduces call-site noise for
 * `planr linear sync` and gives the next reader one file to understand
 * everything that pulls state from Linear.
 */
import type { LinearClient } from '@linear/sdk';
import type { ParsedSubtask } from '../agents/task-parser.js';
import type { BacklogStatus, OpenPlanrConfig, TaskStatus } from '../models/types.js';
export declare function buildNameToStatusMap(user: Record<string, string> | undefined): Map<string, TaskStatus>;
export declare function mapLinearNameToTaskStatus(stateName: string, byName: Map<string, TaskStatus>): TaskStatus | undefined;
export declare function buildNameToBacklogStatusMap(user: Record<string, string> | undefined): Map<string, BacklogStatus>;
export declare function mapLinearNameToBacklogStatus(stateName: string, byName: Map<string, BacklogStatus>): BacklogStatus | undefined;
export interface LinearStatusSyncSummary {
    /** Local artifacts overwritten with Linear's state (the pull direction). */
    updated: number;
    /** Linear issues updated from local state (the push-on-sync direction). */
    pushedToLinear: number;
    /** Local and Linear already agree — no write either direction. */
    unchanged: number;
    /** Per-artifact conflicts resolved via `--on-conflict` (includes non-interactive defaults). */
    conflictDecisions: number;
    /** Linear returned a state name we don't know how to map. */
    unmapped: number;
    /** Artifact had no `linearIssueId` or an unparseable one. */
    skippedNoId: number;
    /** Linear didn't return the issue (deleted / no access). */
    missingFromApi: number;
    /** Push-back to Linear failed (API error); local frontmatter left unchanged. */
    pushFailures: number;
}
/**
 * Shared three-way merge strategy — governs how both checkbox sync and
 * status sync resolve conflicts. Reused from the existing checkbox merge
 * so users get one flag (`--on-conflict`) for both.
 */
export type ConflictStrategy = 'prompt' | 'local' | 'linear';
/**
 * One side of a three-way status decision. Analogous to the `CheckboxConflict`
 * record used by the task-checkbox merge, but scalar (single `status` value
 * per artifact, not per-checkbox).
 */
export interface StatusConflict {
    base: string | undefined;
    local: string;
    remote: string;
}
/**
 * Pure three-way merge decision for a single artifact's workflow status.
 *
 * Mirrors `resolveTaskCheckboxFinalStates` but on a scalar. Returns
 * `side='unchanged'` when local and remote already agree (counter path),
 * `side='linear'` when the remote changed and should be pulled, `side='local'`
 * when the local changed and should be pushed back to Linear. True
 * conflicts (both diverged from base, or no base and they disagree) are
 * resolved per `strategy`.
 */
export declare function resolveStatusFinalState(c: StatusConflict, strategy: ConflictStrategy): {
    final: string;
    side: 'unchanged' | 'local' | 'linear';
    conflictDecisions: number;
    isTrueConflict: boolean;
};
export declare function syncLinearStatusIntoArtifacts(projectDir: string, config: OpenPlanrConfig, client: LinearClient, options?: {
    dryRun?: boolean;
    onConflict?: ConflictStrategy;
}): Promise<LinearStatusSyncSummary>;
export declare function formatLinearStatusSyncLine(s: LinearStatusSyncSummary): string;
export type TaskCheckboxConflictStrategy = 'prompt' | 'local' | 'linear';
export interface LinearTaskCheckboxSyncSummary {
    filesProcessed: number;
    filesUpdatedLocal: number;
    linearIssuesUpdated: number;
    /** Number of per-id decisions for divergent local vs Linear (includes non-interactive defaults). */
    conflictDecisions: number;
    skippedNoIssue: number;
    /** Artifacts whose `linearIssueId` frontmatter was present but malformed (H1). */
    skippedStaleId: number;
}
/**
 * Rebuild a `ParsedSubtask` list in document order: local file order, then any ids only in remote, then apply `final` done flags.
 */
export declare function mergeByIdForFormat(local: ParsedSubtask[], remote: ParsedSubtask[], final: ReadonlyMap<string, boolean>): ParsedSubtask[];
/** Merged issue body: return text for an artifact’s section, or the whole body when a single file owns the issue. */
export declare function extractTaskSectionFromMergedDescription(merged: string, taskFileId: string, siblingFileCount: number): string;
export declare function replaceTaskSectionInMergedDescription(merged: string, taskFileId: string, newSectionBody: string): string;
export interface CheckboxConflict {
    id: string;
    base: boolean | undefined;
    local: boolean | undefined;
    remote: boolean | undefined;
}
/**
 * One auto-resolved conflict entry (M4). Captured when a non-interactive
 * default picks the Linear or local side so the user can review decisions
 * after the fact in `.planr/reports/linear-sync-conflicts-<date>.md`.
 */
export interface AutoResolvedConflict {
    label: string;
    id: string;
    base: boolean | undefined;
    local: boolean | undefined;
    remote: boolean | undefined;
    chosen: 'local' | 'linear';
    timestamp: string;
}
/**
 * Three-way merge for checkbox `id -> done` and presence. A key is **absent** in a version when the task line is not in that side’s parse.
 * Exported for unit tests.
 */
export declare function resolveTaskCheckboxFinalStates(local: Map<string, boolean>, remote: Map<string, boolean>, base: Map<string, boolean>, strategy: TaskCheckboxConflictStrategy, label: string, onAutoResolve?: (entry: AutoResolvedConflict) => void): Promise<{
    final: Map<string, boolean>;
    conflictDecisions: number;
}>;
/** Drop checkbox lines for ids that should be absent, apply done states, append new lines for ids in `rebuilt` that are still missing. */
export declare function applyCheckboxMergeToLocalBody(body: string, final: ReadonlyMap<string, boolean>, rebuilt: ParsedSubtask[]): string;
/**
 * For each `task` artifact with `linearIssueId`, load the shared Linear description (once per issue id),
 * reconcile checkboxes with the local file using three-way merge, then write back local and/or Linear.
 */
export declare function runLinearTaskCheckboxSync(projectDir: string, config: OpenPlanrConfig, client: LinearClient, opts?: {
    onConflict?: TaskCheckboxConflictStrategy;
    dryRun?: boolean;
}): Promise<LinearTaskCheckboxSyncSummary>;
//# sourceMappingURL=linear-pull-service.d.ts.map