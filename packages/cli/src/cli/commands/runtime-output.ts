import {
  type RuntimeChange,
  summarizeRuntimeChanges,
} from '../../services/runtime-change-summary.js';
import { type previewSetup, runtimeRoot } from '../../services/runtime-manager-service.js';
import { display, logger } from '../../utils/logger.js';

type SetupPlan = Awaited<ReturnType<typeof previewSetup>>;

/** Prints one line per coding agent: `•` planned, `✓` changed, `·` already up to date. */
export function printRuntimeChanges(plan: SetupPlan, applied: boolean): RuntimeChange[] {
  const changes = summarizeRuntimeChanges(plan, { bookkeepingRoot: runtimeRoot(), applied });
  const width = Math.max(0, ...changes.map((change) => change.host.length));
  for (const change of changes) {
    const mark = !applied ? '•' : change.changed ? '✓' : '·';
    display.line(`  ${mark} ${change.host.padEnd(width)}  ${change.summary}`);
  }
  return changes;
}

/** Every file the plan creates, updates or retires. */
export function printChangedFiles(plan: SetupPlan): void {
  for (const action of plan.actions.filter((item) => item.operation !== 'unchanged')) {
    display.bullet(`${action.operation.padEnd(7)} ${action.target}`);
  }
}

/** Failed runtime checks, each with its fix. */
export function printRuntimeFailures(plan: SetupPlan): void {
  for (const diagnostic of plan.runtimeDiagnostics.filter((item) => item.status === 'fail')) {
    logger.error(diagnostic.fix ? `${diagnostic.message} ${diagnostic.fix}` : diagnostic.message);
  }
}
