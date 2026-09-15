import type { OperateComposition } from './composition.js';
import type { OperateStore } from './store.js';

type RecoveryAllowedAction = Readonly<{
  tool:
    | 'operate.cycle.get'
    | 'operate.recovery.clear-stale-lock'
    | 'operate.recovery.inspect'
    | 'operate.recovery.restore';
  arguments: Record<string, unknown>;
  label: string;
  effect: 'read-only' | 'machine-local-write';
}>;

function success(operation: string, data: unknown, allowedActions: RecoveryAllowedAction[] = []) {
  return { ok: true as const, operation, data, allowedActions };
}

/** Inspect durable storage and advertise only the exact recovery action proved safe. */
export async function inspectOperateRecovery(input: {
  store: OperateStore;
  composition: OperateComposition;
}): Promise<unknown> {
  const inspection = await input.store.inspect(async ({ baseState, events, artifacts }) =>
    input.composition.replay(baseState, events, artifacts),
  );
  const allowedActions: RecoveryAllowedAction[] =
    inspection.allowedRecovery === 'clear-stale-lock'
      ? [
          {
            tool: 'operate.recovery.clear-stale-lock',
            arguments: {},
            label: 'Archive the stale writer lock and retry safely',
            effect: 'machine-local-write',
          },
        ]
      : inspection.allowedRecovery === 'restore-generation' && inspection.recoverableGeneration
        ? [
            {
              tool: 'operate.recovery.restore',
              arguments: { generation: inspection.recoverableGeneration },
              label: 'Restore the last exactly replayable generation',
              effect: 'machine-local-write',
            },
          ]
        : [];
  return success('operate.recovery.inspect', inspection, allowedActions);
}

/** Restore only a store-verified replayable generation and return to the last Cycle. */
export async function restoreOperateGeneration(input: {
  store: OperateStore;
  composition: OperateComposition;
  generation: string;
}): Promise<unknown> {
  const recovered = await input.store.restore(
    input.generation,
    async ({ baseState, events, artifacts }) =>
      input.composition.replay(baseState, events, artifacts),
  );
  const cycleAction: RecoveryAllowedAction[] = recovered.preferences.lastCycleId
    ? [
        {
          tool: 'operate.cycle.get',
          arguments: { cycleId: recovered.preferences.lastCycleId },
          label: 'Inspect the current cycle',
          effect: 'read-only',
        },
      ]
    : [];
  return success(
    'operate.recovery.restore',
    {
      generation: recovered.generation,
      lastCycleId: recovered.preferences.lastCycleId,
      status: 'restored',
    },
    cycleAction,
  );
}

/** Archive one verified stale lock; no runtime state is interpreted or rewritten here. */
export async function clearOperateStaleLock(store: OperateStore): Promise<unknown> {
  await store.clearStaleLock();
  return success(
    'operate.recovery.clear-stale-lock',
    { status: 'cleared', recovery: 'stale-lock-archived' },
    [
      {
        tool: 'operate.recovery.inspect',
        arguments: {},
        label: 'Inspect safe recovery options',
        effect: 'read-only',
      },
    ],
  );
}
