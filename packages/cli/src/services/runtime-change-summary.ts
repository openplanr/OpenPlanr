import path from 'node:path';
import type { ClaudePluginOperation, ClaudePluginOperationKind } from './claude-plugin-service.js';
import type { CodexPluginOperation } from './codex-plugin-service.js';
import type { RuntimeId } from './runtime-manager/inventory.js';

export const RUNTIME_LABELS: Record<RuntimeId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
};

/** The change one setup run makes, or would make, to a single coding agent. */
export interface RuntimeChange {
  runtime: RuntimeId;
  host: string;
  changed: boolean;
  summary: string;
}

interface RuntimePlan {
  runtimes: RuntimeId[];
  actions: Array<{ runtime: string; target: string; operation: string }>;
  runtimeOperations: Array<ClaudePluginOperation | CodexPluginOperation>;
}

function isInside(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function describeOperation(
  operation: ClaudePluginOperation | CodexPluginOperation,
  applied: boolean,
): string {
  const plugin = `${operation.id.split('@')[0]} plugin`;
  const versions = operation.runtime === 'claude-code' ? operation : undefined;
  const { currentVersion, targetVersion } = versions ?? {};
  if (operation.kind === 'update' && currentVersion && targetVersion) {
    // An update to the same version reinstalls a plugin whose files no longer match.
    if (currentVersion === targetVersion) {
      return applied
        ? `${plugin} ${targetVersion} repaired`
        : `repair the ${plugin} ${targetVersion}`;
    }
    return `${plugin} ${currentVersion} → ${targetVersion}`;
  }
  const target = targetVersion ? ` ${targetVersion}` : '';
  const phrases: Record<ClaudePluginOperationKind, [planned: string, done: string]> = {
    update: [`update the ${plugin}`, `${plugin} updated`],
    install: [`install the ${plugin}${target}`, `${plugin}${target} installed`],
    enable: [`enable the ${plugin}`, `${plugin} enabled`],
    remove: [`remove ${operation.id}`, `${operation.id} removed`],
    'add-marketplace': ['add the local plugin marketplace', 'local plugin marketplace added'],
    'refresh-marketplace': [
      'refresh the local plugin marketplace',
      'local plugin marketplace refreshed',
    ],
  };
  return phrases[operation.kind][applied ? 1 : 0];
}

function describeFiles(operations: string[], applied: boolean): string[] {
  const counts = (
    [
      ['update', applied ? 'updated' : 'to update'],
      ['create', applied ? 'added' : 'to add'],
      ['retire', applied ? 'removed' : 'to remove'],
    ] as const
  )
    .map(([operation, verb]) => ({
      count: operations.filter((item) => item === operation).length,
      verb,
    }))
    .filter(({ count }) => count > 0);
  if (counts.length === 0) return [];
  return [
    counts
      .map(({ count, verb }, index) =>
        index === 0 ? `${count} ${count === 1 ? 'file' : 'files'} ${verb}` : `${count} ${verb}`,
      )
      .join(', '),
  ];
}

/**
 * Per-agent summary of a setup preview or result.
 * Files under `bookkeepingRoot` are OpenPlanr's own records and a marketplace refresh
 * is routine, so neither counts as a change.
 */
export function summarizeRuntimeChanges(
  plan: RuntimePlan,
  { bookkeepingRoot, applied }: { bookkeepingRoot: string; applied: boolean },
): RuntimeChange[] {
  return plan.runtimes.map((runtime) => {
    const files = plan.actions
      .filter(
        (action) =>
          action.runtime === runtime &&
          action.operation !== 'unchanged' &&
          !isInside(action.target, bookkeepingRoot),
      )
      .map((action) => action.operation);
    const operations = plan.runtimeOperations.filter(
      (operation) => operation.runtime === runtime && operation.kind !== 'refresh-marketplace',
    );
    const parts = [
      ...operations.map((operation) => describeOperation(operation, applied)),
      ...describeFiles(files, applied),
    ];
    return {
      runtime,
      host: RUNTIME_LABELS[runtime],
      changed: parts.length > 0,
      summary: parts.length > 0 ? parts.join(' · ') : 'already up to date',
    };
  });
}

/** `["A", "B", "C"]` → `"A, B and C"`. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
