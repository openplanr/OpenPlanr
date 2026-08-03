/**
 * Linear → OpenPlanr: sync workflow state names into Feature and Story `status` frontmatter (FEAT-017).
 */
import type { LinearClient } from '@linear/sdk';
import type { OpenPlanrConfig, TaskStatus } from '../models/types.js';
export declare function buildNameToStatusMap(user: Record<string, string> | undefined): Map<string, TaskStatus>;
export declare function mapLinearNameToTaskStatus(stateName: string, byName: Map<string, TaskStatus>): TaskStatus | undefined;
export interface LinearStatusSyncSummary {
    updated: number;
    unchanged: number;
    unmapped: number;
    skippedNoId: number;
    missingFromApi: number;
}
export declare function syncLinearStatusIntoArtifacts(projectDir: string, config: OpenPlanrConfig, client: LinearClient, options?: {
    dryRun?: boolean;
}): Promise<LinearStatusSyncSummary>;
export declare function formatLinearStatusSyncLine(s: LinearStatusSyncSummary): string;
//# sourceMappingURL=linear-status-sync-service.d.ts.map