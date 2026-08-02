/**
 * Task implementation bridge.
 *
 * Orchestrates the full flow:
 * 1. Read and parse the task artifact
 * 2. Resolve target subtask(s)
 * 3. Gather parent chain context (story → feature → epic)
 * 4. Build codebase context
 * 5. Compose the implementation prompt
 * 6. Dispatch to the configured coding agent
 */
import type { OpenPlanrConfig } from '../models/types.js';
export interface ImplementOptions {
    subtask?: string;
    next?: boolean;
    agent?: string;
    dryRun?: boolean;
    markDone?: boolean;
}
export declare function executeImplementation(projectDir: string, config: OpenPlanrConfig, taskId: string, opts: ImplementOptions): Promise<void>;
export interface FollowUpOptions {
    agent?: string;
}
/**
 * Send a follow-up message to the coding agent, continuing the
 * previous session. This is the feedback loop for fixing issues
 * found after implementation.
 */
export declare function executeFollowUp(projectDir: string, config: OpenPlanrConfig, message: string, opts: FollowUpOptions): Promise<void>;
//# sourceMappingURL=implementation-bridge.d.ts.map