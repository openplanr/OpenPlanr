import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizeJson, sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { createOperatingGovernedRecoveryRuntimeV2 } from '../../lib/operate/governed-recovery-v2.mjs';
import { OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2 } from '../../lib/operate/reference-governed-executors-v2.mjs';
import {
  computeOperatingRuntimeEventHashV2,
  reduceOperatingRuntimeEventsV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { createGovernedExecutionCheckpointStore } from './operate-governed-execution-v2.test.mjs';
import { governedRollbackScenario } from './operate-governed-rollback-v2.test.mjs';

function rehash(record, field) {
  delete record[field];
  record[field] = sha256Jcs(record);
}

function rehashAction(action) {
  const projection = structuredClone(action);
  for (const field of ['actionHash', 'revisionId', 'state', 'updatedAt']) delete projection[field];
  action.actionHash = sha256Jcs(projection);
  action.revisionId = `actrev_${sha256Jcs({
    actionId: action.actionId,
    revision: action.revision,
    actionHash: action.actionHash,
  }).slice('sha256:'.length)}`;
}

function rehashRollbackResultCustody(state) {
  const result = state.rollbackResults[0];
  rehash(result, 'resultHash');
  const rawHash = sha256Jcs(result);
  const sizeBytes = Buffer.byteLength(canonicalizeJson(result), 'utf8');
  const artifact = state.artifacts.find(({ artifactId }) => artifactId === result.resultArtifactId);
  artifact.rawHash = rawHash;
  artifact.canonicalHash = rawHash;
  artifact.sizeBytes = sizeBytes;
  const submission = state.submissions.find(({ artifactId }) => artifactId === artifact.artifactId);
  submission.rawHash = rawHash;
  submission.canonicalHash = rawHash;
  submission.sizeBytes = sizeBytes;
  submission.responseData.rawHash = rawHash;
  submission.responseData.sizeBytes = sizeBytes;
  const replay = state.submissionReplayIndex.find(
    ({ artifactId }) => artifactId === artifact.artifactId,
  );
  replay.rawHash = rawHash;
  replay.canonicalHash = rawHash;
  replay.sizeBytes = sizeBytes;
  replay.responseData.rawHash = rawHash;
  replay.responseData.sizeBytes = sizeBytes;
}

function rechain(events, initialState) {
  let previousHash = initialState.eventHead.hash;
  let sequence = initialState.eventHead.sequence;
  return events.map((source) => {
    const event = structuredClone(source);
    sequence += 1;
    event.sequence = sequence;
    event.previousEventHash = previousHash;
    delete event.eventHash;
    event.eventHash = computeOperatingRuntimeEventHashV2(event);
    previousHash = event.eventHash;
    return event;
  });
}

test('randomized exact rollback identities restore one baseline and preserve one original history', async () => {
  for (let seed = 1; seed <= 10; seed += 1) {
    const executeSuffix = `76${String(seed).padStart(6, '0')}`;
    const rollbackSuffix = `77${String(seed).padStart(6, '0')}`;
    const scenario = await governedRollbackScenario({ executeSuffix, rollbackSuffix });
    const runtime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: scenario.planned.state,
      checkpointStore: createGovernedExecutionCheckpointStore(scenario.planned.state),
    });
    const result = await runtime.rollback(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter: scenario.targetAdapter,
    });
    assert.equal(result.result.status, 'succeeded', `seed ${seed}`);
    assert.equal(
      result.state.governedOperations.filter(({ operationKind }) => operationKind === 'execute')
        .length,
      1,
      `seed ${seed}`,
    );
    assert.equal(
      result.state.governedOperations.filter(({ operationKind }) => operationKind === 'rollback')
        .length,
      1,
      `seed ${seed}`,
    );
    assert.equal(scenario.targetAdapter.describe().effectCount, 2, `seed ${seed}`);
  }
});

test('divergent rollback plan, baseline, payload, and identity vectors never dispatch', async () => {
  const mutations = [
    (request) => {
      request.rollbackPlanId = 'rbp_divergent78000001';
    },
    (request) => {
      request.rollbackBaseline.contentHash = `sha256:${'f'.repeat(64)}`;
    },
    (request) => {
      request.rollbackBaseline.value = { forged: true };
    },
    (request) => {
      request.payload.artifactId = 'art_divergent78000001';
    },
    (request) => {
      request.originalOperationId = 'op_divergent78000001';
    },
  ];
  for (let index = 0; index < mutations.length; index += 1) {
    const scenario = await governedRollbackScenario({
      executeSuffix: `78${String(index + 1).padStart(6, '0')}`,
      rollbackSuffix: `79${String(index + 1).padStart(6, '0')}`,
    });
    const request = structuredClone(scenario.request);
    mutations[index](request);
    const runtime = createOperatingGovernedRecoveryRuntimeV2({
      initialState: scenario.planned.state,
      checkpointStore: createGovernedExecutionCheckpointStore(scenario.planned.state),
    });
    await assert.rejects(
      runtime.rollback(request, scenario.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter: scenario.targetAdapter,
      }),
      (error) => ['RESULT_CONTRACT_INVALID', 'ROLLBACK_NOT_ELIGIBLE'].includes(error.code),
    );
    assert.equal(runtime.dispatchCount, 0);
    assert.equal(scenario.targetAdapter.describe().effectCount, 1, `mutation ${index}`);
  }
});

test('Promise-concurrent identical rollback attempts elect one dispatcher and one restoration', async () => {
  const scenario = await governedRollbackScenario({
    executeSuffix: '78000020',
    rollbackSuffix: '79000020',
  });
  const runtime = createOperatingGovernedRecoveryRuntimeV2({
    initialState: scenario.planned.state,
    checkpointStore: createGovernedExecutionCheckpointStore(scenario.planned.state),
  });
  const environment = {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter: scenario.targetAdapter,
  };
  const attempts = await Promise.allSettled([
    runtime.rollback(scenario.request, scenario.draft, environment),
    runtime.rollback(scenario.request, scenario.draft, environment),
  ]);
  assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 2);
  assert.equal(runtime.dispatchCount, 1);
  assert.equal(scenario.targetAdapter.describe().effectCount, 2);
  assert.equal(runtime.getState().rollbackResults.length, 1);
});

test('independent runtimes sharing one checkpoint cannot both own the rollback dispatch', async () => {
  const scenario = await governedRollbackScenario({
    executeSuffix: '78000030',
    rollbackSuffix: '79000030',
  });
  const store = createGovernedExecutionCheckpointStore(scenario.planned.state);
  const runtimeA = createOperatingGovernedRecoveryRuntimeV2({
    initialState: scenario.planned.state,
    checkpointStore: store,
  });
  const runtimeB = createOperatingGovernedRecoveryRuntimeV2({
    initialState: scenario.planned.state,
    checkpointStore: store,
  });
  const environment = {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter: scenario.targetAdapter,
  };
  const attempts = await Promise.allSettled([
    runtimeA.rollback(scenario.request, scenario.draft, environment),
    runtimeB.rollback(scenario.request, scenario.draft, environment),
  ]);
  assert.ok(attempts.some(({ status }) => status === 'fulfilled'));
  for (const attempt of attempts.filter(({ status }) => status === 'rejected')) {
    assert.ok(['OPERATION_CONFLICT', 'OPERATION_UNCERTAIN'].includes(attempt.reason.code));
  }
  assert.equal(runtimeA.dispatchCount + runtimeB.dispatchCount, 1);
  assert.equal(scenario.targetAdapter.describe().effectCount, 2);
  assert.equal(store.snapshot().rollbackResults.length, 1);
  assert.equal(
    store.snapshot().governedOperations.filter(({ operationKind }) => operationKind === 'rollback')
      .length,
    1,
  );
});

test('fully rehashed rollback authority and terminal projection mutations all fail checkpoint loading', async () => {
  const scenario = await governedRollbackScenario({
    executeSuffix: '78000040',
    rollbackSuffix: '79000040',
  });
  const runtime = createOperatingGovernedRecoveryRuntimeV2({
    initialState: scenario.planned.state,
    checkpointStore: createGovernedExecutionCheckpointStore(scenario.planned.state),
  });
  const completed = await runtime.rollback(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter: scenario.targetAdapter,
  });
  const rollbackOperationIndex = completed.state.governedOperations.findIndex(
    ({ operationKind }) => operationKind === 'rollback',
  );
  const rollbackGrantIndex = completed.state.capabilityGrants.findIndex(
    ({ operationId }) => operationId === scenario.draft.operationId,
  );
  const rollbackAvailabilityIndex = completed.state.capabilityAvailability.findIndex(
    ({ checkedAt }) => checkedAt === scenario.draft.preparedAt,
  );
  const rollbackAssignmentIndex = completed.state.assignments.findIndex(
    ({ assignmentId }) => assignmentId === scenario.draft.assignmentId,
  );
  const mutations = [
    [
      'action',
      (state) => {
        state.actions[0].requestedCapability.version = '1.0.1';
        rehashAction(state.actions[0]);
      },
    ],
    [
      'evaluation',
      (state) => {
        state.policyEvaluations[0].target.revision = 'rev-foreign';
        rehash(state.policyEvaluations[0], 'evaluationHash');
      },
    ],
    [
      'complete approval disposition',
      (state) => {
        const operation = state.governedOperations[rollbackOperationIndex];
        const grant = state.capabilityGrants[rollbackGrantIndex];
        operation.approvalIds = ['aprv_foreign79000040'];
        grant.approvalIds = ['aprv_foreign79000040'];
        rehash(operation, 'operationHash');
        rehash(grant, 'grantHash');
        state.rollbackResults[0].approvalIds = ['aprv_foreign79000040'];
        rehashRollbackResultCustody(state);
      },
    ],
    [
      'grant action',
      (state) => {
        state.capabilityGrants[rollbackGrantIndex].action.actionHash = `sha256:${'a'.repeat(64)}`;
        rehash(state.capabilityGrants[rollbackGrantIndex], 'grantHash');
      },
    ],
    [
      'capability',
      (state) => {
        state.capabilityAvailability[rollbackAvailabilityIndex].capability.version = '1.0.1';
        rehash(state.capabilityAvailability[rollbackAvailabilityIndex], 'availabilityHash');
      },
    ],
    [
      'target',
      (state) => {
        state.capabilityAvailability[rollbackAvailabilityIndex].target.id = 'record-foreign';
        rehash(state.capabilityAvailability[rollbackAvailabilityIndex], 'availabilityHash');
      },
    ],
    [
      'effect',
      (state) => {
        state.capabilityGrants[rollbackGrantIndex].effectClass = 'external-effect';
        rehash(state.capabilityGrants[rollbackGrantIndex], 'grantHash');
      },
    ],
    [
      'assignment',
      (state) => {
        state.assignments[rollbackAssignmentIndex].roleId = 'operate-foreign-executor';
      },
    ],
    [
      'operation identity',
      (state) => {
        state.governedOperations[rollbackOperationIndex].connector.id = 'foreign-connector';
        rehash(state.governedOperations[rollbackOperationIndex], 'operationHash');
      },
    ],
    [
      'expiry',
      (state) => {
        state.capabilityGrants[rollbackGrantIndex].expiresAt = scenario.draft.preparedAt;
        rehash(state.capabilityGrants[rollbackGrantIndex], 'grantHash');
      },
    ],
    [
      'consumption',
      (state) => {
        state.capabilityGrants[rollbackGrantIndex].consumedAt = null;
        rehash(state.capabilityGrants[rollbackGrantIndex], 'grantHash');
      },
    ],
    [
      'operation capability',
      (state) => {
        state.governedOperations[rollbackOperationIndex].capability.version = '1.0.1';
        rehash(state.governedOperations[rollbackOperationIndex], 'operationHash');
      },
    ],
    [
      'plan',
      (state) => {
        state.rollbackPlans[0].executor.executorVersion = '1.0.1';
        rehash(state.rollbackPlans[0], 'planHash');
      },
    ],
    [
      'result',
      (state) => {
        state.rollbackResults[0].effectSummary.summary = 'Forged successful compensation.';
        rehashRollbackResultCustody(state);
      },
    ],
  ];
  for (const [label, mutate] of mutations) {
    const state = structuredClone(completed.state);
    mutate(state);
    assert.throws(
      () => reduceOperatingRuntimeEventsV2([], { initialState: state }),
      (error) =>
        [
          'ACTION_REVISION_MISMATCH',
          'APPROVAL_INVALID',
          'CAPABILITY_GRANT_INVALID',
          'OPERATION_CONFLICT',
          'POLICY_EVALUATION_REJECTED',
          'RESULT_CONTRACT_INVALID',
          'STATE_TRANSITION_INVALID',
        ].includes(error.code),
      label,
    );
  }
});

test('fully rehashed direct intent and terminal Events cannot bypass the shared rollback authority validator', async () => {
  const scenario = await governedRollbackScenario({
    executeSuffix: '78000041',
    rollbackSuffix: '79000041',
  });
  const runtime = createOperatingGovernedRecoveryRuntimeV2({
    initialState: scenario.planned.state,
    checkpointStore: createGovernedExecutionCheckpointStore(scenario.planned.state),
  });
  const completed = await runtime.rollback(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter: scenario.targetAdapter,
  });
  const intentIndex = completed.events.findIndex(
    ({ type }) => type === 'operation.intent-recorded',
  );
  const forgedIntentEvents = structuredClone(completed.events.slice(0, intentIndex + 1));
  forgedIntentEvents[0].payload.objective = 'Forged rollback Assignment objective.';
  assert.throws(
    () =>
      reduceOperatingRuntimeEventsV2(rechain(forgedIntentEvents, scenario.planned.state), {
        initialState: scenario.planned.state,
      }),
    { code: 'OPERATION_CONFLICT' },
  );

  const forgedRuntimeEvents = structuredClone(completed.events.slice(0, intentIndex + 1));
  forgedRuntimeEvents.find(({ type }) => type === 'assignment.claimed').payload.runtime =
    'planr-pipeline@9.9.9';
  assert.throws(
    () =>
      reduceOperatingRuntimeEventsV2(rechain(forgedRuntimeEvents, scenario.planned.state), {
        initialState: scenario.planned.state,
      }),
    { code: 'OPERATION_CONFLICT' },
  );

  const intentState = reduceOperatingRuntimeEventsV2(completed.events.slice(0, intentIndex + 1), {
    initialState: scenario.planned.state,
  });
  const terminalEvents = structuredClone(completed.events.slice(intentIndex + 1));
  const resultEvent = terminalEvents.find(({ type }) => type === 'rollback.result-recorded');
  resultEvent.payload.effectSummary.summary = 'Forged successful compensation.';
  rehash(resultEvent.payload, 'resultHash');
  const rawHash = sha256Jcs(resultEvent.payload);
  const sizeBytes = Buffer.byteLength(canonicalizeJson(resultEvent.payload), 'utf8');
  const submittedEvent = terminalEvents.find(({ type }) => type === 'assignment.submitted');
  submittedEvent.payload.rawHash = rawHash;
  submittedEvent.payload.canonicalHash = rawHash;
  submittedEvent.payload.sizeBytes = sizeBytes;
  const artifactEvent = terminalEvents.find(({ type }) => type === 'artifact.created');
  artifactEvent.payload.rawHash = rawHash;
  artifactEvent.payload.canonicalHash = rawHash;
  artifactEvent.payload.sizeBytes = sizeBytes;
  assert.throws(
    () =>
      reduceOperatingRuntimeEventsV2(rechain(terminalEvents, intentState), {
        initialState: intentState,
      }),
    { code: 'RESULT_CONTRACT_INVALID' },
  );
});
