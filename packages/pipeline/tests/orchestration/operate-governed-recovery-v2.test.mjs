import assert from 'node:assert/strict';
import test from 'node:test';

import { createOperatingGovernedExecutionRuntimeV2 } from '../../lib/operate/governed-execution-v2.mjs';
import {
  classifyOperatingGovernedRecoveryV2,
  createOperatingGovernedRecoveryRuntimeV2,
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

test('durable terminal history classifies recovery without host, connector, executor, or target access', async () => {
  const scenario = governedExecutionScenario({ suffix: '73000001', automatic: true });
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  const store = createGovernedExecutionCheckpointStore(scenario.initial);
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore: store,
  });
  const completed = await runtime.execute(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  const proof = classifyOperatingGovernedRecoveryV2({
    state: completed.state,
    operationId: completed.operation.operationId,
  });
  assert.equal(proof.classification, 'applied');
  assert.equal(proof.source, 'durable-history');
  assert.equal(proof.operationId, completed.operation.operationId);
  assert.match(proof.reconciliationHash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(targetAdapter.describe().effectCount, 1);
});

test('runtime reconciliation is bound to its current checkpoint and configured registry', async () => {
  const scenario = governedExecutionScenario({ suffix: '73000004', automatic: true });
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  const executionStore = createGovernedExecutionCheckpointStore(scenario.initial);
  const execution = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore: executionStore,
  });
  const completed = await execution.execute(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  const recovery = createOperatingGovernedRecoveryRuntimeV2({
    initialState: completed.state,
    checkpointStore: createGovernedExecutionCheckpointStore(completed.state),
  });
  const reconcileRequest = {
    payload: scenario.request.payload,
    rollbackBaseline: scenario.request.rollbackBaseline,
  };
  const proof = await recovery.reconcile({
    operationId: completed.operation.operationId,
    request: reconcileRequest,
  });
  assert.equal(proof.classification, 'applied');
  await assert.rejects(
    recovery.reconcile({
      operationId: completed.operation.operationId,
      request: reconcileRequest,
      state: scenario.initial,
    }),
    { code: 'RESULT_CONTRACT_INVALID' },
  );
  await assert.rejects(
    recovery.reconcile({
      operationId: completed.operation.operationId,
      request: reconcileRequest,
      registry: { executors: [] },
    }),
    { code: 'RESULT_CONTRACT_INVALID' },
  );
  assert.equal(targetAdapter.describe().effectCount, 1);
});

test('deterministic reconciliation proves no prior effect before one safe restart redispatch', async () => {
  const scenario = governedExecutionScenario({ suffix: '73000002', automatic: true });
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  let releaseIntent;
  let observeIntent;
  const intentSeen = new Promise((resolve) => {
    observeIntent = resolve;
  });
  const intentHold = new Promise((resolve) => {
    releaseIntent = resolve;
  });
  const store = createGovernedExecutionCheckpointStore(scenario.initial, {
    async afterCommit({ phase }) {
      if (phase !== 'dispatch-intent') return;
      observeIntent();
      await intentHold;
    },
  });
  const original = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore: store,
  });
  const delayed = original.execute(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  await intentSeen;
  const intentState = store.snapshot();
  const proof = await reconcileOperatingGovernedDispatchV2({
    state: intentState,
    operationId: scenario.draft.operationId,
    request: scenario.request,
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
    observedAt: scenario.draft.completedAt,
  });
  assert.equal(proof.classification, 'not-applied');
  assert.equal(proof.receipt, null);
  assert.equal(targetAdapter.describe().effectCount, 0);

  const restarted = createOperatingGovernedExecutionRuntimeV2({
    initialState: intentState,
    checkpointStore: createGovernedExecutionCheckpointStore(intentState),
  });
  const recovered = await restarted.execute(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  assert.equal(recovered.result.status, 'succeeded');
  assert.equal(restarted.dispatchCount, 1);
  assert.equal(targetAdapter.describe().effectCount, 1);

  releaseIntent();
  const originalCompletion = await delayed;
  assert.equal(originalCompletion.result.status, 'succeeded');
  assert.equal(
    targetAdapter.describe().effectCount,
    1,
    'the original host call replays the same idempotent receipt',
  );
});

test('unsupported reconciliation remains unknown and cannot imply redispatch authority', async () => {
  const scenario = governedExecutionScenario({ suffix: '73000003', automatic: true });
  const initial = structuredClone(scenario.initial);
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  let snapshot;
  const store = createGovernedExecutionCheckpointStore(initial, {
    async afterCommit({ phase }, state) {
      if (phase !== 'dispatch-intent') return;
      snapshot = state;
      throw Object.assign(new Error('intent-ack-lost'), { code: 'INTENT_ACK_LOST' });
    },
  });
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: initial,
    checkpointStore: store,
  });
  await assert.rejects(
    runtime.execute(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    }),
    { code: 'OPERATION_UNCERTAIN' },
  );
  const proof = await reconcileOperatingGovernedDispatchV2({
    state: snapshot,
    operationId: scenario.draft.operationId,
    request: scenario.request,
    trustedHost: {},
    targetAdapter,
    observedAt: scenario.draft.completedAt,
  });
  assert.equal(proof.classification, 'unknown');
  assert.equal(targetAdapter.describe().effectCount, 0);
});
