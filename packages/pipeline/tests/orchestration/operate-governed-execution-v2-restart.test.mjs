import assert from 'node:assert/strict';
import test from 'node:test';

import { createOperatingGovernedExecutionRuntimeV2 } from '../../lib/operate/governed-execution-v2.mjs';
import { classifyOperatingGovernedRecoveryV2 } from '../../lib/operate/governed-recovery-v2.mjs';
import {
  createDisposableLocalProjectTargetV2,
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
} from '../../lib/operate/reference-governed-executors-v2.mjs';
import {
  createGovernedExecutionCheckpointStore,
  governedExecutionScenario,
} from './operate-governed-execution-v2.test.mjs';

function hostileProxyCasReceipt({ durableState, claimedState, reads }) {
  return new Proxy(
    {
      committed: false,
      state: structuredClone(durableState),
    },
    {
      get(target, property, receiver) {
        if (property === 'committed') {
          reads.count += 1;
          return true;
        }
        if (property === 'state') {
          reads.count += 1;
          return structuredClone(claimedState);
        }
        return Reflect.get(target, property, receiver);
      },
    },
  );
}

function verificationPlanFor(action) {
  return {
    kind: 'operating-action-verification-plan',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    verificationPlanId: action.verificationPlanId,
    actionId: action.actionId,
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    metricId: action.metricId,
    baseline: action.baseline,
    target: action.target,
    window: action.verificationWindow,
    method: 'Compare one accepted observation with the declared target.',
    observationRequest: { kind: 'future-observation', reason: action.expectedResult },
    evaluationRules: ['succeeded: target reached.'],
    revisitDecisionIds: action.sourceDecisionId === null ? [] : [action.sourceDecisionId],
    sourceArtifactId: action.sourceArtifactId,
    createdAt: action.createdAt,
  };
}

test('restart reconstructs a terminal operation and returns lost-ack replay with no host, target, or Event access', async () => {
  const scenario = governedExecutionScenario({ suffix: '71000001' });
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  const firstStore = createGovernedExecutionCheckpointStore(scenario.initial);
  const firstRuntime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore: firstStore,
  });
  const completed = await firstRuntime.execute(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  const restarted = createOperatingGovernedExecutionRuntimeV2({
    initialState: completed.state,
    checkpointStore: createGovernedExecutionCheckpointStore(completed.state),
  });
  const replay = await restarted.execute(scenario.request, scenario.draft, {
    trustedHost: new Proxy(
      {},
      {
        get() {
          throw new Error('restart replay touched host');
        },
      },
    ),
    targetAdapter: new Proxy(
      {},
      {
        get() {
          throw new Error('restart replay touched target');
        },
      },
    ),
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.events.length, 0);
  assert.equal(restarted.dispatchCount, 0);
  assert.deepEqual(replay.result, completed.result);
  assert.deepEqual(replay.state.eventHead, completed.state.eventHead);
  assert.equal(targetAdapter.describe().effectCount, 1);
});

test('a stale runtime refreshes the shared checkpoint and replays before host or target access', async () => {
  const scenario = governedExecutionScenario({ suffix: '71000003' });
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  const checkpointStore = createGovernedExecutionCheckpointStore(scenario.initial);
  const runtimeA = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore,
  });
  const runtimeB = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore,
  });
  const completed = await runtimeA.execute(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  const replay = await runtimeB.execute(scenario.request, scenario.draft, {
    trustedHost: new Proxy(
      {},
      {
        get() {
          throw new Error('stale runtime touched host');
        },
      },
    ),
    targetAdapter: new Proxy(
      {},
      {
        get() {
          throw new Error('stale runtime touched target');
        },
      },
    ),
  });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.events, []);
  assert.deepEqual(replay.result, completed.result);
  assert.equal(replay.dispatchCount, 0);
  assert.equal(replay.effectCount, 0);
  assert.equal(runtimeB.dispatchCount, 0);
  assert.equal(targetAdapter.describe().effectCount, 1);
});

test('restart from durable dispatch intent records explicit uncertainty and never blindly redispatches', async () => {
  const scenario = governedExecutionScenario({ suffix: '71000002' });
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  let releaseCommittedIntent;
  let observeCommittedIntent;
  const committedIntent = new Promise((resolve) => {
    observeCommittedIntent = resolve;
  });
  const intentRelease = new Promise((resolve) => {
    releaseCommittedIntent = resolve;
  });
  const firstStore = createGovernedExecutionCheckpointStore(scenario.initial, {
    async afterCommit({ phase }) {
      if (phase !== 'dispatch-intent') return;
      observeCommittedIntent();
      await intentRelease;
    },
  });
  const firstRuntime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore: firstStore,
  });
  const delayedCompletion = firstRuntime.execute(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  await committedIntent;
  const dispatchCheckpoint = firstStore.snapshot();
  assert.equal(dispatchCheckpoint.governedOperations[0].state, 'dispatching');
  assert.equal(dispatchCheckpoint.executionResults.length, 0);
  assert.equal(dispatchCheckpoint.capabilityGrants[0].consumedAt, scenario.draft.preparedAt);
  assert.equal(
    targetAdapter.describe().effectCount,
    0,
    'durable CAS commit completes before the host can touch the target',
  );
  const recovery = classifyOperatingGovernedRecoveryV2({
    state: dispatchCheckpoint,
    operationId: scenario.draft.operationId,
    observedAt: scenario.draft.completedAt,
  });
  assert.equal(recovery.classification, 'unknown');
  assert.equal(recovery.source, 'durable-history');

  const restarted = createOperatingGovernedExecutionRuntimeV2({
    initialState: dispatchCheckpoint,
    checkpointStore: createGovernedExecutionCheckpointStore(dispatchCheckpoint),
  });
  await assert.rejects(
    restarted.execute(scenario.request, scenario.draft, {
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
    }),
    (error) =>
      error.code === 'OPERATION_UNCERTAIN' &&
      error.details.context.recoveryDisposition === 'reconcile-before-retry',
  );
  assert.equal(restarted.dispatchCount, 0);
  assert.equal(restarted.getState().executionResults.length, 1);
  assert.equal(restarted.getState().executionResults[0].status, 'uncertain');
  assert.equal(targetAdapter.describe().effectCount, 0);

  releaseCommittedIntent();
  const completed = await delayedCompletion;
  assert.equal(completed.state.executionResults.length, 1);
  assert.equal(targetAdapter.describe().effectCount, 1);
});

test('restart rejects a foreign present pre-terminal relationship before commit, dispatch, or effect', async () => {
  const scenario = governedExecutionScenario({ suffix: '71000006' });
  scenario.initial.cycles[0] = {
    ...scenario.initial.cycles[0],
    state: 'approved',
    activeReviewId: null,
  };
  scenario.initial.verificationPlans = [verificationPlanFor(scenario.action)];
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  let releaseCommittedIntent;
  let observeCommittedIntent;
  const committedIntent = new Promise((resolve) => {
    observeCommittedIntent = resolve;
  });
  const intentRelease = new Promise((resolve) => {
    releaseCommittedIntent = resolve;
  });
  const firstStore = createGovernedExecutionCheckpointStore(scenario.initial, {
    async afterCommit({ phase }) {
      if (phase !== 'dispatch-intent') return;
      observeCommittedIntent();
      await intentRelease;
    },
  });
  const firstRuntime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore: firstStore,
  });
  const delayedCompletion = firstRuntime.execute(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  await committedIntent;
  const dispatchCheckpoint = firstStore.snapshot();
  assert.equal(dispatchCheckpoint.governedOperations[0].state, 'dispatching');
  assert.equal(targetAdapter.describe().effectCount, 0);

  const foreign = {
    scopeId: 'scope-foreign',
    domainId: scenario.action.domainId === 'business' ? 'software' : 'business',
    domainVersion: '9.9.9',
  };
  try {
    for (const collection of ['cycles', 'verificationPlans']) {
      for (const field of ['scopeId', 'domainId', 'domainVersion']) {
        const durable = structuredClone(dispatchCheckpoint);
        durable[collection][0][field] = foreign[field];
        const commits = [];
        const restartedStore = {
          readSnapshot: () => structuredClone(durable),
          compareAndSwap(input) {
            commits.push(input.phase);
            return { committed: false, state: structuredClone(durable) };
          },
        };
        const restarted = createOperatingGovernedExecutionRuntimeV2({
          initialState: dispatchCheckpoint,
          checkpointStore: restartedStore,
        });
        await assert.rejects(
          () =>
            restarted.execute(scenario.request, scenario.draft, {
              trustedHost: new Proxy(
                {},
                {
                  get() {
                    throw new Error('foreign restart touched host');
                  },
                },
              ),
              targetAdapter: new Proxy(targetAdapter, {
                get() {
                  throw new Error('foreign restart touched target');
                },
              }),
            }),
          (error) => error?.code === 'OPERATING_SCOPE_INVALID',
          `${collection}.${field}`,
        );
        assert.deepEqual(commits, [], `${collection}.${field} commit count`);
        assert.equal(restarted.dispatchCount, 0, `${collection}.${field} dispatch count`);
        assert.equal(
          restarted.getState().executionResults.length,
          0,
          `${collection}.${field} result count`,
        );
        assert.equal(
          targetAdapter.describe().effectCount,
          0,
          `${collection}.${field} effect count`,
        );
      }
    }
  } finally {
    releaseCommittedIntent();
  }
  const completed = await delayedCompletion;
  assert.equal(completed.state.executionResults.length, 1);
  assert.equal(targetAdapter.describe().effectCount, 1);
});

test('a hostile Proxy CAS receipt cannot fabricate durable dispatch intent before an effect', async () => {
  const scenario = governedExecutionScenario({ suffix: '71000004' });
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  const reads = { count: 0 };
  const checkpointStore = {
    readSnapshot: () => structuredClone(scenario.initial),
    compareAndSwap(input) {
      return hostileProxyCasReceipt({
        durableState: scenario.initial,
        claimedState: input.nextState,
        reads,
      });
    },
    snapshot: () => structuredClone(scenario.initial),
  };
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore,
  });
  await assert.rejects(
    runtime.execute(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    }),
    { code: 'CONCURRENT_MODIFICATION' },
  );
  assert.equal(
    reads.count,
    0,
    'CAS receipt values are consumed from descriptors, never Proxy get traps',
  );
  assert.equal(runtime.dispatchCount, 0);
  assert.equal(targetAdapter.describe().effectCount, 0);
  assert.equal(checkpointStore.snapshot().governedOperations.length, 0);
  assert.equal(checkpointStore.snapshot().executionResults.length, 0);
});

test('a hostile Proxy terminal CAS receipt cannot fabricate result ownership after a proved effect', async () => {
  const scenario = governedExecutionScenario({ suffix: '71000005' });
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  const durableStore = createGovernedExecutionCheckpointStore(scenario.initial);
  const reads = { count: 0 };
  const checkpointStore = {
    readSnapshot: durableStore.readSnapshot,
    async compareAndSwap(input) {
      if (input.phase !== 'terminal-result') return durableStore.compareAndSwap(input);
      return hostileProxyCasReceipt({
        durableState: durableStore.snapshot(),
        claimedState: input.nextState,
        reads,
      });
    },
    snapshot: durableStore.snapshot,
  };
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
      error.code === 'CONCURRENT_MODIFICATION' && error.details.context.provenTerminal === true,
  );
  const durable = checkpointStore.snapshot();
  assert.equal(reads.count, 0, 'terminal receipt values are snapshotted without Proxy get traps');
  assert.equal(runtime.dispatchCount, 1);
  assert.equal(targetAdapter.describe().effectCount, 1);
  assert.equal(durable.governedOperations.length, 1);
  assert.equal(durable.governedOperations[0].state, 'dispatching');
  assert.equal(durable.governedOperations[0].resultId, null);
  assert.equal(durable.executionResults.length, 0);
  assert.equal(
    durable.artifacts.some(
      ({ artifactId }) => artifactId === scenario.draft.uncertainty.resultArtifactId,
    ),
    false,
  );
});
