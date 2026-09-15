import assert from 'node:assert/strict';
import test from 'node:test';

import { createOperatingGovernedExecutionRuntimeV2 } from '../../lib/operate/governed-execution-v2.mjs';
import {
  classifyOperatingGovernedRecoveryV2,
  reconcileOperatingGovernedDispatchV2,
} from '../../lib/operate/governed-recovery-v2.mjs';
import {
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
  createDisposableLocalProjectTargetV2,
} from '../../lib/operate/reference-governed-executors-v2.mjs';
import {
  createGovernedExecutionCheckpointStore,
  governedExecutionScenario,
} from './operate-governed-execution-v2.test.mjs';

test('terminal replay classifications stay exact across deterministic scenario seeds', async () => {
  for (let seed = 1; seed <= 12; seed += 1) {
    const suffix = `74${String(seed).padStart(6, '0')}`;
    const scenario = governedExecutionScenario({ suffix, automatic: true, payloadValue: { seed, applied: true } });
    const targetAdapter = createDisposableLocalProjectTargetV2({
      target: scenario.action.targetBinding,
      initialValue: scenario.initialValue,
    });
    const store = createGovernedExecutionCheckpointStore(scenario.initial);
    const runtime = createOperatingGovernedExecutionRuntimeV2({ initialState: scenario.initial, checkpointStore: store });
    const completed = await runtime.execute(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    });
    const first = classifyOperatingGovernedRecoveryV2({ state: completed.state, operationId: completed.operation.operationId });
    const second = classifyOperatingGovernedRecoveryV2({ state: structuredClone(completed.state), operationId: completed.operation.operationId });
    assert.deepEqual(first, second, `seed ${seed}`);
    assert.equal(first.classification, 'applied', `seed ${seed}`);
    assert.equal(targetAdapter.describe().effectCount, 1, `seed ${seed}`);
  }
});

test('divergent reconciliation envelopes fail closed without a target effect', async () => {
  const scenario = governedExecutionScenario({ suffix: '74000020', automatic: true });
  const targetAdapter = createDisposableLocalProjectTargetV2({ target: scenario.action.targetBinding, initialValue: scenario.initialValue });
  let intentState;
  const store = createGovernedExecutionCheckpointStore(scenario.initial, {
    afterCommit({ phase }, state) {
      if (phase === 'dispatch-intent') {
        intentState = state;
        throw Object.assign(new Error('stop-after-intent'), { code: 'STOP_AFTER_INTENT' });
      }
    },
  });
  const runtime = createOperatingGovernedExecutionRuntimeV2({ initialState: scenario.initial, checkpointStore: store });
  await assert.rejects(runtime.execute(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2, targetAdapter,
  }), { code: 'OPERATION_UNCERTAIN' });
  for (const mutate of [
    (request) => { request.payload.contentHash = `sha256:${'f'.repeat(64)}`; },
    (request) => { request.rollbackBaseline.artifactId = 'art_divergent74000020'; },
    (request) => { request.payload.value = { divergent: true }; },
  ]) {
    const request = structuredClone(scenario.request);
    mutate(request);
    await assert.rejects(reconcileOperatingGovernedDispatchV2({
      state: intentState, operationId: scenario.draft.operationId, request,
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2, targetAdapter,
    }), { code: 'OPERATION_CONFLICT' });
  }
  assert.equal(targetAdapter.describe().effectCount, 0);
});
