import assert from 'node:assert/strict';
import test from 'node:test';

import { createOperatingGovernedExecutionRuntimeV2 } from '../../lib/operate/governed-execution-v2.mjs';
import { reconcileOperatingGovernedDispatchV2 } from '../../lib/operate/governed-recovery-v2.mjs';
import {
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
  createDisposableLocalProjectTargetV2,
} from '../../lib/operate/reference-governed-executors-v2.mjs';
import {
  createGovernedExecutionCheckpointStore,
  governedExecutionScenario,
} from './operate-governed-execution-v2.test.mjs';

function redraft(source, suffix) {
  const draft = structuredClone(source);
  for (const [field, prefix] of Object.entries({
    assignmentId: 'asg',
    submissionId: 'sub',
    operationId: 'op',
    grantId: 'cgr',
    resultId: 'xres',
    resultArtifactId: 'art_result',
    claimId: 'claim',
    correlationId: 'corr',
  }))
    draft[field] = `${prefix}_${suffix}`;
  draft.eventIds = Object.fromEntries(
    Object.keys(draft.eventIds).map((field, index) => [
      field,
      `evt_${suffix}_${String(index + 1).padStart(2, '0')}`,
    ]),
  );
  draft.uncertainty = {
    resultId: `xres_uncertain${suffix}`,
    resultArtifactId: `art_uncertain${suffix}`,
    submissionId: `sub_uncertain${suffix}`,
    eventIds: Object.fromEntries(
      Object.keys(draft.uncertainty.eventIds).map((field, index) => [
        field,
        `evt_${suffix}_uncertain_${String(index + 1).padStart(2, '0')}`,
      ]),
    ),
  };
  return draft;
}

test('Promise-concurrent attempts elect one durable dispatcher and one contained effect', async () => {
  const scenario = governedExecutionScenario({ suffix: '72000001' });
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore: createGovernedExecutionCheckpointStore(scenario.initial),
  });
  const environment = { trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2, targetAdapter };
  const attempts = await Promise.allSettled([
    runtime.execute(scenario.request, scenario.draft, environment),
    runtime.execute(scenario.request, scenario.draft, environment),
  ]);
  const fulfilled = attempts.filter(({ status }) => status === 'fulfilled');
  const rejected = attempts.filter(({ status }) => status === 'rejected');
  assert.equal(fulfilled.length, 2);
  assert.equal(rejected.length, 0);
  assert.equal(runtime.dispatchCount, 1);
  assert.equal(targetAdapter.describe().effectCount, 1);
  assert.equal(runtime.getState().governedOperations.length, 1);
  assert.equal(runtime.getState().executionResults.length, 1);
  assert.equal(runtime.getState().operationReplayIndex.length, 1);
  const dispatcher = fulfilled.find(({ value }) => !value.replayed).value;
  const replay = fulfilled.find(({ value }) => value.replayed).value;
  assert.equal(
    dispatcher.events.filter(({ type }) => type === 'operation.intent-recorded').length,
    1,
  );
  assert.equal(
    dispatcher.events.filter(({ type }) => type === 'execution.result-recorded').length,
    1,
  );
  assert.deepEqual(replay.events, []);
  const reconciliations = await Promise.all([
    reconcileOperatingGovernedDispatchV2({
      state: runtime.getState(),
      operationId: dispatcher.operation.operationId,
    }),
    reconcileOperatingGovernedDispatchV2({
      state: runtime.getState(),
      operationId: dispatcher.operation.operationId,
    }),
  ]);
  assert.deepEqual(reconciliations[0], reconciliations[1]);
  assert.equal(reconciliations[0].classification, 'applied');
  assert.equal(
    targetAdapter.describe().effectCount,
    1,
    'read-only concurrent reconciliation never repeats the effect',
  );
});

test('concurrent divergent reuse cannot steal the dispatch identity or mutate the target', async () => {
  const scenario = governedExecutionScenario({ suffix: '72000002' });
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore: createGovernedExecutionCheckpointStore(scenario.initial),
  });
  const divergent = structuredClone(scenario.request);
  divergent.payload.value.count = 99;
  divergent.payload.contentHash = `sha256:${'f'.repeat(64)}`;
  const environment = { trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2, targetAdapter };
  const first = runtime.execute(scenario.request, scenario.draft, environment);
  await assert.rejects(runtime.execute(divergent, scenario.draft, environment), {
    code: 'OPERATION_CONFLICT',
  });
  const completed = await first;
  assert.equal(completed.result.status, 'succeeded');
  assert.equal(runtime.dispatchCount, 1);
  assert.equal(targetAdapter.describe().effectCount, 1);
});

test('automatic authority still elects one operation owner for one exact Action revision', async () => {
  const scenario = governedExecutionScenario({ suffix: '72000003', automatic: true });
  const secondDraft = redraft(scenario.draft, '72000004');
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore: createGovernedExecutionCheckpointStore(scenario.initial),
  });
  const environment = { trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2, targetAdapter };
  const attempts = await Promise.allSettled([
    runtime.execute(scenario.request, scenario.draft, environment),
    runtime.execute(scenario.request, secondDraft, environment),
  ]);
  assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejected = attempts.find(({ status }) => status === 'rejected');
  assert.equal(rejected.reason.code, 'OPERATION_CONFLICT');
  assert.equal(runtime.getState().assignments.length, 1);
  assert.equal(runtime.getState().capabilityGrants.length, 1);
  assert.equal(runtime.getState().governedOperations.length, 1);
  assert.equal(runtime.getState().executionResults.length, 1);
  assert.equal(targetAdapter.describe().effectCount, 1);
});

test('a post-intent target race commits one terminal uncertain result and never redispatches', async () => {
  const scenario = governedExecutionScenario({ suffix: '72000005' });
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  const checkpointStore = createGovernedExecutionCheckpointStore(scenario.initial, {
    afterCommit({ phase }) {
      if (phase !== 'dispatch-intent') return;
      targetAdapter.apply({
        operationId: 'op_external72000005',
        requestFingerprint: `sha256:${'e'.repeat(64)}`,
        expectedRevision: scenario.action.targetBinding.revision,
        nextValue: { raced: true },
      });
    },
  });
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore,
  });
  await assert.rejects(
    runtime.execute(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    }),
    (error) =>
      error.code === 'OPERATION_UNCERTAIN' &&
      error.details.context.resultId === scenario.draft.uncertainty.resultId,
  );
  const state = checkpointStore.snapshot();
  assert.equal(state.governedOperations[0].state, 'uncertain');
  assert.equal(state.executionResults[0].status, 'uncertain');
  assert.equal(state.executionResults[0].targetAfterHash, null);
  assert.equal(state.executionResults[0].effectSummary.changed, false);
  assert.equal(state.capabilityGrants[0].consumedAt, scenario.draft.preparedAt);
  assert.deepEqual(
    checkpointStore.commits.map(({ phase }) => phase),
    ['dispatch-intent', 'terminal-result'],
  );

  const replay = await runtime.execute(scenario.request, scenario.draft, {
    trustedHost: new Proxy(
      {},
      {
        get() {
          throw new Error('uncertain replay touched host');
        },
      },
    ),
    targetAdapter: new Proxy(
      {},
      {
        get() {
          throw new Error('uncertain replay touched target');
        },
      },
    ),
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.status, 'uncertain');
  assert.equal(runtime.dispatchCount, 1);
  assert.equal(
    targetAdapter.describe().effectCount,
    1,
    'only the external race changed the target',
  );
});
