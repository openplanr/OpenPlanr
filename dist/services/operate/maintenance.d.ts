import { type AgentNativeAdvisorResponse } from './advisors.js';
import { OperatingEventStore } from './event-store.js';
import { type OperatingAdapterHandoff, type OperatingRoleResult } from './types.js';
/**
 * FR4: purge the board's machine-local advisor sessions (`<localRoot>/advisors/`)
 * and incremental evidence baselines (`<localRoot>/evidence/incremental/`). A
 * committed `operate init` apply calls this so a board re-inited at the same path
 * never inherits a prior generation's sessions or cached baselines, and
 * `operate cache purge` calls it so the doctor's staleness diagnostics have a
 * scoped fix command. Both surfaces are rebuildable machine-local caches, never
 * committed protocol artifacts.
 */
export declare function purgeBoardMachineLocalCaches(input: {
    projectRoot: string;
    localRoot?: string;
}): Promise<{
    removedAdvisorSessions: number;
    removedIncrementalBaselines: number;
}>;
export declare function operatingCacheAction(input: {
    projectRoot: string;
    action: 'status' | 'purge';
    confirmed?: boolean;
    localRoot?: string;
}): Promise<unknown>;
export declare function operatingIntegrityAction(input: {
    projectRoot: string;
    action: 'status' | 'enable';
    confirmed?: boolean;
    localRoot?: string;
}): Promise<unknown>;
export declare function exportOperatingDiagnostics(input: {
    projectRoot: string;
    output?: string;
    localRoot?: string;
}): Promise<{
    path: string;
    digest: `sha256:${string}`;
}>;
export declare function repairOperatingSecurity(input: {
    projectRoot: string;
    confirmed: boolean;
    localRoot?: string;
    faultInjector?: (boundary: 'project-quarantined') => void | Promise<void>;
}): Promise<unknown>;
export declare function readPersistedOperatingRoleResults(store: OperatingEventStore, cycleId: string): Promise<OperatingRoleResult[]>;
/** Read the rich Protocol v1.4 analysis sidecars associated with advisor events. */
export declare function readPersistedOperatingAdvisorReports(store: OperatingEventStore, cycleId: string): Promise<Map<string, AgentNativeAdvisorResponse>>;
export declare function createOperatingAdapterStartHandoff(input: {
    projectRoot: string;
    cycleId: string;
    evidenceDigest: `sha256:${string}`;
    runtime: string;
    phase: 'advisors' | 'chair';
    roles: string[];
    localRoot?: string;
}): Promise<OperatingAdapterHandoff>;
export declare function operateAdapterLifecycle(input: {
    projectRoot: string;
    action: 'prepare' | 'record' | 'resume' | 'finalize' | 'cancel';
    cycleId?: string;
    evidenceDigest?: string;
    lease?: string;
    idempotencyKey?: string;
    role?: string;
    stdin?: string;
    localRoot?: string;
    /**
     * Injectable clock (FR10 / T-008). Defaults to wall-clock. Tests supply a
     * deterministic clock to prove the lease refreshes forward on `record` and that
     * expiry is still enforced once the refreshed window lapses.
     */
    now?: () => Date;
}): Promise<unknown>;
//# sourceMappingURL=maintenance.d.ts.map