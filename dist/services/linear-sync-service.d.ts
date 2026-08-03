/**
 * Bidirectional task checkbox sync between Linear TaskList issue descriptions and local `.md` files (FEAT-018).
 */
import type { LinearClient } from '@linear/sdk';
import type { ParsedSubtask } from '../agents/task-parser.js';
import type { OpenPlanrConfig } from '../models/types.js';
export type TaskCheckboxConflictStrategy = 'prompt' | 'local' | 'linear';
export interface LinearTaskCheckboxSyncSummary {
    filesProcessed: number;
    filesUpdatedLocal: number;
    linearIssuesUpdated: number;
    /** Number of per-id decisions for divergent local vs Linear (includes non-interactive defaults). */
    conflictDecisions: number;
    skippedNoIssue: number;
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
 * Three-way merge for checkbox `id -> done` and presence. A key is **absent** in a version when the task line is not in that side’s parse.
 * Exported for unit tests.
 */
export declare function resolveTaskCheckboxFinalStates(local: Map<string, boolean>, remote: Map<string, boolean>, base: Map<string, boolean>, strategy: TaskCheckboxConflictStrategy, label: string): Promise<{
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
//# sourceMappingURL=linear-sync-service.d.ts.map