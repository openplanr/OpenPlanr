/**
 * Aggregate the status of N task-files-under-one-feature into a single
 * canonical OpenPlanr `TaskStatus`, used to set the merged TaskList Linear
 * issue's `stateId` on push (via the existing resolver pipeline).
 *
 * BL-014. Closes the deferred-since-BL-007 gap where pushing a TASK file
 * never propagated workflow state — Linear TaskList issues sat in
 * Backlog while local files said `done`.
 *
 * Aggregation rule (precedence top-down — first match wins):
 *   - Any `blocked`           → 'blocked' (escalation: one stuck task blocks the parent)
 *   - All `done`              → 'done'
 *   - Any `in-progress`       → 'in-progress'
 *   - Mix of `done`+`pending` → 'in-progress' (work has started)
 *   - All `pending`           → 'pending'
 *   - Empty input             → undefined (no aggregation possible)
 */
import type { TaskStatus } from '../../models/types.js';
/**
 * Pure aggregation: array of task statuses → single canonical TaskStatus.
 *
 * Returns `undefined` when the input is empty so callers can short-circuit
 * the stateId resolution.
 */
export declare function aggregateTaskStatus(statuses: ReadonlyArray<TaskStatus>): TaskStatus | undefined;
//# sourceMappingURL=task-status-aggregation.d.ts.map