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
export function aggregateTaskStatus(statuses: ReadonlyArray<TaskStatus>): TaskStatus | undefined {
  if (statuses.length === 0) return undefined;

  // Escalation: a single blocked task blocks the parent. R6 failure on any
  // child means the parent SPEC/feature can't be shipped without operator
  // intervention — surface that visibly in Linear, not buried under a
  // soothing "in-progress".
  const anyBlocked = statuses.some((s) => s === 'blocked');
  if (anyBlocked) return 'blocked';

  const allDone = statuses.every((s) => s === 'done');
  if (allDone) return 'done';

  const anyInProgress = statuses.some((s) => s === 'in-progress');
  if (anyInProgress) return 'in-progress';

  const anyDone = statuses.some((s) => s === 'done');
  if (anyDone) {
    // Mix of done + pending = work has started, partially shipped.
    return 'in-progress';
  }

  // All pending (the remaining case).
  return 'pending';
}
