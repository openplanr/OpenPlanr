/**
 * Pure plan-building for `planr linear push --dry-run`. Takes loaded scopes
 * and returns `LinearPushPlan` objects with per-kind row counts. No Linear
 * API calls; no mutations. Epic-scope plans cascade rows for linked QT/BL.
 */
import type { Epic, Feature, OpenPlanrConfig, UserStory } from '../../models/types.js';
import { type ScopedFeature, type ScopedTaskFile } from './scope-loaders.js';
export type LinearPushItemKind = 'project' | 'feature' | 'story' | 'taskList' | 'quickTask' | 'backlogItem';
export type LinearPushAction = 'create' | 'update' | 'skip';
/** Scope of a granular push — what subtree `runLinearPush(artifactId)` touches. */
export type LinearPushScope = 'epic' | 'feature' | 'story' | 'taskFile' | 'quick' | 'backlog';
export interface LinearPushPlanRow {
    kind: LinearPushItemKind;
    /** Epic id, feature id, story id, or task-file id for this row. */
    artifactId: string;
    title: string;
    action: LinearPushAction;
    detail?: string;
}
export interface LinearPushPlan {
    /** The artifact the user pointed `planr linear push` at (any supported prefix). */
    rootArtifactId: string;
    /** The epic that owns this push's subtree; `undefined` for standalone QT/BL pushes. */
    epicId?: string;
    scope: LinearPushScope;
    rows: LinearPushPlanRow[];
    /** Counts by kind for non-`skip` rows. Missing kinds are 0. */
    counts: {
        project: number;
        features: number;
        stories: number;
        taskLists: number;
        quickTasks: number;
        backlogItems: number;
        total: number;
    };
}
/**
 * Extract the linked epic id from QT / BL frontmatter. Canonical field is
 * `epicId`; `parentEpic` is accepted as a compat alias for hand-authored
 * files. Empty strings are normalised to `undefined`.
 */
export declare function getLinkedEpicId(fm: Record<string, unknown>): string | undefined;
export declare function projectRow(epic: Epic): LinearPushPlanRow;
export declare function featureRow(f: Feature): LinearPushPlanRow;
export declare function storyRow(s: UserStory): LinearPushPlanRow;
export declare function taskListPlanRow(featureId: string, taskFiles: ScopedTaskFile[], hasBody: boolean, hadIssue: boolean): LinearPushPlanRow;
export declare function applyUpdateOnly(rows: LinearPushPlanRow[], updateOnly: boolean): LinearPushPlanRow[];
export declare function summarizePlan(rootArtifactId: string, epicId: string | undefined, scope: LinearPushScope, rows: LinearPushPlanRow[]): LinearPushPlan;
export declare function buildFeaturePlanRows(projectDir: string, config: OpenPlanrConfig, sf: ScopedFeature, noCascade?: boolean): Promise<LinearPushPlanRow[]>;
export declare function buildEpicPlanRows(projectDir: string, config: OpenPlanrConfig, epicScope: {
    epic: Epic;
    features: ScopedFeature[];
}, noCascade?: boolean): Promise<LinearPushPlanRow[]>;
/**
 * Build a push preview (and counts) for `planr linear push --dry-run` at any
 * granularity. Accepts any supported artifact id prefix (EPIC/FEAT/US/TASK/
 * QT/BL); returns `null` when the artifact can't be resolved or is not
 * pushable (ADR/SPRINT/checklist).
 */
export declare function buildLinearPushPlan(projectDir: string, config: OpenPlanrConfig, artifactId: string, options?: {
    updateOnly?: boolean;
    noCascade?: boolean;
}): Promise<LinearPushPlan | null>;
//# sourceMappingURL=plan-builders.d.ts.map