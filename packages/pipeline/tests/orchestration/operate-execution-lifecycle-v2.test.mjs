import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  reduceOperatingRuntimeEventsV2,
  scheduleOperatingRuntimeEventsV2,
  transitionOperatingActionLifecycleV2,
  transitionOperatingCycleLifecycleV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { createOperatingGovernedExecutionRuntimeV2 } from '../../lib/operate/governed-execution-v2.mjs';
import { deriveOperatingExecutionLifecycleIdentitiesV2 } from '../../lib/operate/execution-verification-v2.mjs';
import {
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
  createDisposableLocalProjectTargetV2,
} from '../../lib/operate/reference-governed-executors-v2.mjs';
import {
  createGovernedExecutionCheckpointStore,
  governedExecutionScenario,
} from './operate-governed-execution-v2.test.mjs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const AT = '2026-08-10T12:00:00.000Z';

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

test('Action and Cycle traverse the canonical execution and verification lifecycles', () => {
  const originalAction = structuredClone(fixture('authorization-valid.json').action);
  const queued = transitionOperatingActionLifecycleV2(originalAction, 'queued', { updatedAt: AT });
  const started = transitionOperatingActionLifecycleV2(queued, 'in_progress', { updatedAt: AT });
  const completed = transitionOperatingActionLifecycleV2(started, 'completed', { updatedAt: AT });
  assert.deepEqual(
    [originalAction.state, queued.state, started.state, completed.state],
    ['approved', 'queued', 'in_progress', 'completed'],
  );
  assert.equal(completed.actionHash, originalAction.actionHash);
  assert.equal(completed.revisionId, originalAction.revisionId);

  const source = fixture('all-contracts-valid.json')['operating-cycle'];
  const awaiting = { ...structuredClone(source), state: 'awaiting_review' };
  const approved = transitionOperatingCycleLifecycleV2(awaiting, 'approved', { updatedAt: AT });
  const executing = transitionOperatingCycleLifecycleV2(approved, 'executing', { updatedAt: AT });
  const verifying = transitionOperatingCycleLifecycleV2(executing, 'verifying', { updatedAt: AT });
  const closed = transitionOperatingCycleLifecycleV2(verifying, 'closed', { updatedAt: AT });
  assert.deepEqual(
    [awaiting.state, approved.state, executing.state, verifying.state, closed.state],
    ['awaiting_review', 'approved', 'executing', 'verifying', 'closed'],
  );
  assert.equal(closed.activeReviewId, null);
  assert.equal(closed.closedAt, AT);
});

test('terminal Actions cannot be silently reopened', () => {
  const action = structuredClone(fixture('authorization-valid.json').action);
  const queued = transitionOperatingActionLifecycleV2(action, 'queued', { updatedAt: AT });
  const started = transitionOperatingActionLifecycleV2(queued, 'in_progress', { updatedAt: AT });
  const completed = transitionOperatingActionLifecycleV2(started, 'completed', { updatedAt: AT });
  assert.throws(
    () => transitionOperatingActionLifecycleV2(completed, 'in_progress', { updatedAt: AT }),
    (error) => error?.code === 'STATE_TRANSITION_INVALID',
  );
});

test('general checkpoint indexing rejects all six present Action/Cycle/verification-plan scope fields', () => {
  const scenario = governedExecutionScenario({ suffix: '97000003' });
  scenario.initial.verificationPlans = [verificationPlanFor(scenario.action)];
  const foreign = {
    scopeId: 'scope-foreign',
    domainId: scenario.action.domainId === 'business' ? 'software' : 'business',
    domainVersion: '9.9.9',
  };

  for (const collection of ['cycles', 'verificationPlans']) {
    for (const field of ['scopeId', 'domainId', 'domainVersion']) {
      const checkpoint = structuredClone(scenario.initial);
      checkpoint[collection][0][field] = foreign[field];
      assert.throws(
        () => reduceOperatingRuntimeEventsV2([], { initialState: checkpoint }),
        (error) => error?.code === 'OPERATING_SCOPE_INVALID',
        `${collection}.${field}`,
      );
    }
  }

  const legacy = structuredClone(scenario.initial);
  legacy.cycles = [];
  legacy.verificationPlans = [];
  assert.doesNotThrow(() => reduceOperatingRuntimeEventsV2([], { initialState: legacy }));
});

test('fresh execution rejects a foreign present verification relationship before commit, dispatch, or effect', async () => {
  const scenario = governedExecutionScenario({ suffix: '97000004' });
  scenario.initial.cycles[0] = {
    ...scenario.initial.cycles[0],
    state: 'approved',
    activeReviewId: null,
  };
  scenario.initial.verificationPlans = [verificationPlanFor(scenario.action)];
  let durable = structuredClone(scenario.initial);
  const commits = [];
  const checkpointStore = {
    readSnapshot: () => structuredClone(durable),
    compareAndSwap(input) {
      commits.push(input.phase);
      return { committed: false, state: structuredClone(durable) };
    },
  };
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore,
  });
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  durable.verificationPlans[0].domainVersion = '9.9.9';

  await assert.rejects(
    () =>
      runtime.execute(scenario.request, scenario.draft, {
        trustedHost: new Proxy(
          {},
          {
            get() {
              throw new Error('foreign checkpoint touched host');
            },
          },
        ),
        targetAdapter: new Proxy(targetAdapter, {
          get() {
            throw new Error('foreign checkpoint touched target');
          },
        }),
      }),
    (error) => error?.code === 'OPERATING_SCOPE_INVALID',
  );
  assert.deepEqual(commits, []);
  assert.equal(runtime.dispatchCount, 0);
  assert.equal(runtime.getState().governedOperations.length, 0);
  assert.equal(targetAdapter.describe().effectCount, 0);
});

test('governed execution atomically records the lifecycle around one result and replays without effects', async () => {
  const scenario = governedExecutionScenario({ suffix: '97000001' });
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
  const checkpointStore = createGovernedExecutionCheckpointStore(scenario.initial);
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore,
  });
  const completed = await runtime.execute(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  const identities = deriveOperatingExecutionLifecycleIdentitiesV2({
    operationId: completed.operation.operationId,
    resultId: completed.result.resultId,
  });
  const lifecycleEvents = completed.events.filter(({ eventId }) =>
    Object.values(identities.eventIds).includes(eventId),
  );
  assert.deepEqual(
    lifecycleEvents.map(({ type }) => type),
    [
      'action.queued',
      'action.started',
      'cycle.executing',
      'action.completed',
      'assignment.created',
      'cycle.verifying',
    ],
  );
  const resultPosition = completed.events.findIndex(
    ({ type }) => type === 'execution.result-recorded',
  );
  assert.ok(
    completed.events.findIndex(({ eventId }) => eventId === identities.eventIds.cycleExecuting) <
      resultPosition,
  );
  assert.ok(
    completed.events.findIndex(({ eventId }) => eventId === identities.eventIds.actionTerminal) >
      resultPosition,
  );
  assert.equal(
    completed.state.actions.find(({ actionId }) => actionId === scenario.action.actionId).state,
    'completed',
  );
  assert.equal(
    completed.state.cycles.find(({ cycleId }) => cycleId === scenario.action.sourceCycleId).state,
    'verifying',
  );
  const verificationAssignment = completed.state.assignments.find(
    ({ assignmentId }) => assignmentId === identities.assignmentId,
  );
  assert.equal(verificationAssignment.assignmentKind, 'verification');
  assert.equal(verificationAssignment.governedOperationId, completed.operation.operationId);
  assert.equal(verificationAssignment.outputContract.schemaId, 'operating-outcome');
  assert.equal(targetAdapter.describe().effectCount, 1);

  const replay = await runtime.execute(scenario.request, scenario.draft, {
    trustedHost: new Proxy(
      {},
      {
        get() {
          throw new Error('lifecycle replay touched host');
        },
      },
    ),
    targetAdapter: new Proxy(
      {},
      {
        get() {
          throw new Error('lifecycle replay touched target');
        },
      },
    ),
  });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.events, []);
  assert.deepEqual(replay.state, completed.state);
  assert.equal(targetAdapter.describe().effectCount, 1);
});

test('terminal verification Assignment scheduling is durable and rejects non-Event-backed lifecycle changes', async () => {
  const scenario = governedExecutionScenario({ suffix: '97000005' });
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
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore: createGovernedExecutionCheckpointStore(scenario.initial),
  });
  const completed = await runtime.execute(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  const verificationCreated = completed.events.find(
    ({ type, payload }) =>
      type === 'assignment.created' && payload.assignmentKind === 'verification',
  );
  assert.ok(verificationCreated);

  const verificationCreatedIndex = completed.events.findIndex(
    ({ eventId }) => eventId === verificationCreated.eventId,
  );
  const preCreation = reduceOperatingRuntimeEventsV2(
    completed.events.slice(0, verificationCreatedIndex),
    { initialState: scenario.initial },
  );
  const creationSuffix = completed.events.slice(verificationCreatedIndex);
  assert.deepEqual(
    creationSuffix.map(({ type }) => type),
    ['assignment.created', 'cycle.verifying'],
  );
  const firstScheduled = scheduleOperatingRuntimeEventsV2(creationSuffix, {
    initialState: preCreation,
  });
  assert.deepEqual(
    firstScheduled.releaseEvents.map(({ type }) => type),
    ['assignment.available'],
  );
  assert.equal(
    firstScheduled.state.assignments.find(({ assignmentKind }) => assignmentKind === 'verification')
      .state,
    'available',
  );

  const scheduled = scheduleOperatingRuntimeEventsV2([verificationCreated], {
    initialState: completed.state,
  });
  const verificationAssignment = scheduled.state.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'verification',
  );
  assert.equal(verificationAssignment.state, 'available');
  assert.equal(verificationAssignment.availableAt, verificationCreated.timestamp);
  assert.deepEqual(
    scheduled.releaseEvents.map(({ type }) => type),
    ['assignment.available'],
  );
  assert.doesNotThrow(() => reduceOperatingRuntimeEventsV2([], { initialState: scheduled.state }));

  const forgedWithoutEvent = structuredClone(completed.state);
  const pendingIndex = forgedWithoutEvent.assignments.findIndex(
    ({ assignmentKind }) => assignmentKind === 'verification',
  );
  forgedWithoutEvent.assignments[pendingIndex].state = 'available';
  forgedWithoutEvent.assignments[pendingIndex].availableAt = verificationCreated.timestamp;
  assert.throws(
    () => reduceOperatingRuntimeEventsV2([], { initialState: forgedWithoutEvent }),
    (error) => error?.code === 'RESULT_CONTRACT_INVALID',
  );

  const forgedTimestamp = structuredClone(scheduled.state);
  const availableIndex = forgedTimestamp.assignments.findIndex(
    ({ assignmentKind }) => assignmentKind === 'verification',
  );
  forgedTimestamp.assignments[availableIndex].availableAt = '2026-08-10T12:00:01.000Z';
  assert.throws(
    () => reduceOperatingRuntimeEventsV2([], { initialState: forgedTimestamp }),
    (error) => error?.code === 'RESULT_CONTRACT_INVALID',
  );
  assert.equal(targetAdapter.describe().effectCount, 1);
});

test('Event reduction, checkpoint loading, and replay reject foreign or ambiguous verification ownership', async () => {
  const scenario = governedExecutionScenario({ suffix: '97000002' });
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
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore: createGovernedExecutionCheckpointStore(scenario.initial),
  });
  const completed = await runtime.execute(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  const assignmentIndex = completed.events.findIndex(
    ({ type, payload }) =>
      type === 'assignment.created' && payload.assignmentKind === 'verification',
  );
  const beforeAssignment = reduceOperatingRuntimeEventsV2(
    completed.events.slice(0, assignmentIndex),
    { initialState: scenario.initial },
  );
  const foreignEventState = structuredClone(beforeAssignment);
  foreignEventState.verificationPlans[0].domainVersion = '9.9.9';
  assert.throws(
    () =>
      reduceOperatingRuntimeEventsV2([completed.events[assignmentIndex]], {
        initialState: foreignEventState,
      }),
    (error) => error?.code === 'OPERATING_SCOPE_INVALID',
  );

  const foreign = {
    scopeId: 'scope-foreign',
    domainId: scenario.action.domainId === 'business' ? 'software' : 'business',
    domainVersion: '9.9.9',
  };
  for (const field of ['scopeId', 'domainId', 'domainVersion']) {
    const checkpoint = structuredClone(completed.state);
    checkpoint.verificationPlans[0][field] = foreign[field];
    assert.throws(
      () => reduceOperatingRuntimeEventsV2([], { initialState: checkpoint }),
      (error) => error?.code === 'OPERATING_SCOPE_INVALID',
    );
  }
  const canonicalAssignment = completed.state.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'verification',
  );
  const forgedAssignment = {
    ...structuredClone(canonicalAssignment),
    assignmentId: 'asg_vfy_forged_checkpoint_0001',
  };
  for (const verificationAssignments of [
    [forgedAssignment, canonicalAssignment],
    [canonicalAssignment, forgedAssignment],
  ]) {
    const checkpoint = structuredClone(completed.state);
    checkpoint.assignments = [
      ...checkpoint.assignments.filter(({ assignmentKind }) => assignmentKind !== 'verification'),
      ...structuredClone(verificationAssignments),
    ];
    assert.throws(
      () => reduceOperatingRuntimeEventsV2([], { initialState: checkpoint }),
      (error) => error?.code === 'RESULT_CONTRACT_INVALID',
    );
  }

  let durable = structuredClone(completed.state);
  const replayStore = {
    readSnapshot: () => structuredClone(durable),
    compareAndSwap: async () => {
      throw new Error('foreign replay attempted a commit');
    },
  };
  const replayRuntime = createOperatingGovernedExecutionRuntimeV2({
    initialState: completed.state,
    checkpointStore: replayStore,
  });
  durable.verificationPlans[0].scopeId = foreign.scopeId;
  await assert.rejects(
    () =>
      replayRuntime.execute(scenario.request, scenario.draft, {
        trustedHost: new Proxy(
          {},
          {
            get() {
              throw new Error('foreign replay touched host');
            },
          },
        ),
        targetAdapter: new Proxy(
          {},
          {
            get() {
              throw new Error('foreign replay touched target');
            },
          },
        ),
      }),
    (error) => error?.code === 'OPERATING_SCOPE_INVALID',
  );
  assert.equal(targetAdapter.describe().effectCount, 1);
});
