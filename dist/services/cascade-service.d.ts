/**
 * Cascade execution for `planr revise`.
 *
 * Responsibilities:
 *
 *   1. **Build cascade order** — top-down: epic → features → stories → tasks.
 *      The artifact hierarchy is a strict tree; no cycle detection is needed.
 *   2. **Execute the cascade** — for each artifact in order, call the
 *      caller-provided `processOne` closure. The cascade stops on
 *      SIGINT, `[q]uit`, or an unrecoverable agent error, and always
 *      flushes audit entries immediately so an interrupted run leaves an
 *      accurate record.
 *   3. **Progress tracking** — emits a `CascadeProgress` snapshot before
 *      each artifact, with a rolling ETA.
 *
 * This service owns NO rollback logic. Partial cascades that break the
 * artifact graph are the concern of the post-flight rollback.
 */
import type { ArtifactType, CascadeLevel, CascadePlan, CascadeProgress, OpenPlanrConfig } from '../models/types.js';
/**
 * Resolve the cascade plan for a root artifact, walking its descendants in
 * top-down order. For an epic root, the plan is:
 *   EPIC → [features under epic] → [stories under those features] → [tasks under those stories]
 * For a feature root, the EPIC level is empty and features contain only the root, etc.
 */
export declare function buildCascadeOrder(projectDir: string, config: OpenPlanrConfig, rootType: ArtifactType, rootId: string): Promise<CascadePlan>;
export interface CascadeProcessOutcome {
    /** Set to `false` when the processor wants the cascade to stop cleanly
     *  (e.g., user pressed `q` at a diff prompt). `true` for normal continuation. */
    continue: boolean;
    /** When `continue === false`, the cascade records this reason in the interrupted state. */
    stopReason?: 'q' | 'agent_error' | 'graph_rollback';
}
export type CascadeProcessor = (args: {
    artifactId: string;
    levelLabel: CascadeLevel['label'];
    progress: CascadeProgress;
}) => Promise<CascadeProcessOutcome>;
export interface CascadeExecuteOptions {
    plan: CascadePlan;
    processor: CascadeProcessor;
    /** Called with every progress snapshot; typically wires into a spinner. */
    onProgress?: (p: CascadeProgress) => void;
    /** Overrides the process-level SIGINT handler for tests; default uses `process`. */
    signalTarget?: NodeJS.Process;
}
export interface CascadeResult {
    completed: number;
    total: number;
    interrupted?: {
        reason: 'q' | 'sigint' | 'agent_error';
        atArtifactId: string;
    };
}
/**
 * Drive the cascade plan through the provided processor. Installs a SIGINT
 * handler for the duration of the run; on Ctrl+C it waits for the current
 * artifact to finish (so no half-written files) and then stops. The SIGINT
 * handler is removed on completion whether or not it fired.
 */
export declare function executeCascade(options: CascadeExecuteOptions): Promise<CascadeResult>;
//# sourceMappingURL=cascade-service.d.ts.map