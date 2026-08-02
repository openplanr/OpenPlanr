/**
 * Delivery-status aggregation — the deterministic core behind `planr status`
 * (no slug → whole-project delivery report). Rolls up every Spec / Backlog /
 * Quick Task (or the agile tree) by status and OPTIONALLY cross-references
 * GitHub PRs and Linear issue state.
 *
 * Reuses existing services (no new auth, no new sources):
 *   listSpecs            (spec-service)        — spec rows + status + counts
 *   listArtifacts/readArtifact/readArtifactRaw (artifact-service) — frontmatter
 *   fetchRecentPullRequests/getIssue           (github-service)   — PR/issue state (gh CLI)
 *   createLinearClient/fetchLinearIssueStateNames (linear-service) — live issue state
 *
 * Pure aggregation + a typed result so the command layer can render it as
 * terminal / markdown / json without re-querying.
 */
import type { OpenPlanrConfig } from '../models/types.js';
export interface DeliveryItem {
    id: string;
    title: string;
    type: 'spec' | 'epic' | 'feature' | 'story' | 'task' | 'quick' | 'backlog';
    status: string;
    done: boolean;
    /**
     * Resolved without being "done": `promoted` (backlog graduated into a
     * spec/QT/story) or `superseded` (split/replaced). Addressed items are NOT
     * outstanding work, but they also don't inflate the done count.
     */
    addressed: boolean;
    /** subtask completion, when the artifact is a checklist */
    progress?: {
        done: number;
        total: number;
    };
    priority?: string;
    linear?: {
        identifier: string;
        url?: string;
        state?: string;
    };
    github?: {
        issue?: number;
        issueState?: string;
        pr?: {
            number: number;
            merged: boolean;
        };
    };
}
export interface DeliveryStatus {
    projectName: string;
    mode: 'spec-driven' | 'agile';
    groups: Record<string, DeliveryItem[]>;
    order: string[];
    summary: {
        label: string;
        done: number;
        addressed: number;
        total: number;
    }[];
    /** Items that are neither done nor addressed — the real open work. */
    outstanding: DeliveryItem[];
    warnings: string[];
}
export interface CollectOptions {
    scope?: string;
    github?: boolean;
    linear?: boolean;
}
/** Collect the full delivery status (optionally scoped, optionally live-enriched). */
export declare function collectDeliveryStatus(projectDir: string, config: OpenPlanrConfig, opts?: CollectOptions): Promise<DeliveryStatus>;
//# sourceMappingURL=delivery-status-service.d.ts.map