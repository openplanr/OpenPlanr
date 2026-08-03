/**
 * Minimal DEV retry simulation (Tier-2): mocks an "LLM" as a synchronous predicate with no network.
 * After maxIterations exhausted for a task, writes `T-{id}-error-report.md`; never emits `.pipeline-shipped`.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const reportTemplate = `# Task error report (simulated)\nIterations exhausted.\n`;

/**
 * @param {object} opts
 * @param {string} opts.specDir
 * @param {string[]} opts.taskIds e.g. ['T-001']
 * @param {number} [opts.maxIterations=3]
 * @param {(taskId: string, iterationZeroBased: number) => boolean} opts.llmSucceedsOnIteration mock "LLM" — return true when work would succeed
 */
export function simulateDevLoopWithRetries({ specDir, taskIds, maxIterations = 3, llmSucceedsOnIteration }) {
  const tasksDir = join(specDir, 'tasks');
  if (!existsSync(tasksDir)) mkdirSync(tasksDir, { recursive: true });

  /** @type {Record<string, 'done'|'failed'>} */
  const status = {};

  for (const taskId of taskIds) {
    let finished = false;
    for (let i = 0; i < maxIterations; i++) {
      if (llmSucceedsOnIteration(taskId, i)) {
        finished = true;
        status[taskId] = 'done';
        break;
      }
    }
    if (!finished) {
      status[taskId] = 'failed';
      writeFileSync(join(tasksDir, `${taskId}-error-report.md`), reportTemplate);
    }
  }

  const allSucceeded = taskIds.every((id) => status[id] === 'done');
  if (allSucceeded) {
    writeFileSync(join(specDir, '.pipeline-shipped'), 'shipped_at: simulated\n');
  }

  return status;
}
