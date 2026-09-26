import assert from 'node:assert/strict';
import test from 'node:test';

import { createOperatingGovernedExecutionRuntimeV2 } from '../../lib/operate/governed-execution-v2.mjs';
import {
  createDisposableLocalProjectTargetV2,
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
} from '../../lib/operate/reference-governed-executors-v2.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  createGovernedExecutionCheckpointStore,
  governedExecutionScenario,
} from './operate-governed-execution-v2.test.mjs';

const clone = (value) => structuredClone(value);

test('O2-P6-001: 64 seeded contained operations preserve one fingerprint, dispatch, effect, result, and terminal replay', async () => {
  for (let seed = 1; seed <= 64; seed += 1) {
    const suffix = String(seed).padStart(8, '0');
    const payloadValue = {
      status: seed % 2 === 0 ? 'even' : 'odd',
      count: seed,
      enabled: seed % 3 === 0,
    };
    const scenario = governedExecutionScenario({ suffix, payloadValue });
    const targetAdapter = createDisposableLocalProjectTargetV2({
      target: scenario.action.targetBinding,
      initialValue: scenario.initialValue,
    });
    const runtime = createOperatingGovernedExecutionRuntimeV2({
      initialState: scenario.initial,
      checkpointStore: createGovernedExecutionCheckpointStore(scenario.initial),
    });
    const completed = await runtime.execute(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    });
    const replay = await runtime.execute(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    });
    assert.equal(
      completed.result.requestFingerprint,
      completed.operation.requestFingerprint,
      `seed ${seed}`,
    );
    assert.equal(
      completed.result.resultHash,
      sha256Jcs(
        Object.fromEntries(
          Object.entries(completed.result).filter(([key]) => key !== 'resultHash'),
        ),
      ),
      `seed ${seed}`,
    );
    assert.equal(completed.artifact.canonicalHash, sha256Jcs(completed.result), `seed ${seed}`);
    assert.equal(
      completed.events.filter(({ type }) => type === 'operation.intent-recorded').length,
      1,
      `seed ${seed}`,
    );
    assert.equal(
      completed.events.filter(({ type }) => type === 'execution.result-recorded').length,
      1,
      `seed ${seed}`,
    );
    assert.equal(targetAdapter.describe().effectCount, 1, `seed ${seed}`);
    assert.equal(runtime.dispatchCount, 1, `seed ${seed}`);
    assert.equal(replay.replayed, true, `seed ${seed}`);
    assert.equal(replay.events.length, 0, `seed ${seed}`);

    const divergent = clone(scenario.request);
    divergent.payload.value.count += 1000;
    divergent.payload.contentHash = sha256Jcs(divergent.payload.value);
    await assert.rejects(
      runtime.execute(divergent, scenario.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter,
      }),
      { code: 'OPERATION_CONFLICT' },
      `seed ${seed}`,
    );
    assert.equal(targetAdapter.describe().effectCount, 1, `seed ${seed} divergent retry`);
  }
});

test('O2-P6-002: every fingerprint input dimension rejects same-operation reuse after completion', async () => {
  const mutations = [
    (request) => {
      request.payload.value.count += 1;
      request.payload.contentHash = sha256Jcs(request.payload.value);
    },
    (request) => {
      request.rollbackBaseline.value.count += 1;
      request.rollbackBaseline.contentHash = sha256Jcs(request.rollbackBaseline.value);
    },
    (request) => {
      request.actionId = 'act_divergent01';
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const scenario = governedExecutionScenario({ suffix: `9000000${index + 1}` });
    const targetAdapter = createDisposableLocalProjectTargetV2({
      target: scenario.action.targetBinding,
      initialValue: scenario.initialValue,
    });
    const runtime = createOperatingGovernedExecutionRuntimeV2({
      initialState: scenario.initial,
      checkpointStore: createGovernedExecutionCheckpointStore(scenario.initial),
    });
    await runtime.execute(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    });
    const divergent = clone(scenario.request);
    mutate(divergent);
    await assert.rejects(
      runtime.execute(divergent, scenario.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter,
      }),
      { code: 'OPERATION_CONFLICT' },
    );
    assert.equal(targetAdapter.describe().effectCount, 1);
  }
});
