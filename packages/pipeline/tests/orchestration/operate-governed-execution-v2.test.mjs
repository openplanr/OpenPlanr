import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  createOperatingApprovalRecordV2,
  createOperatingApprovalRequirementV2,
} from '../../lib/operate/approvals-v2.mjs';
import { createOperatingGovernedExecutionRuntimeV2 } from '../../lib/operate/governed-execution-v2.mjs';
import {
  createOperatingActionPolicyV2,
  evaluateOperatingActionPolicyV2,
} from '../../lib/operate/policy-v2.mjs';
import { derivePersistentOperatingActionRevisionHashV2 } from '../../lib/operate/persistent-work-v2.mjs';
import {
  acceptOperatingAssignmentSubmissionV2,
  assertOperatingExecuteDispatchAuthorityChainV2,
  computeOperatingRuntimeEventHashV2,
  createOperatingRuntimeEventV2,
  createEmptyOperatingRuntimeStateV2,
  OPERATING_EXECUTION_EFFECT_SUMMARIES_V2,
  reduceOperatingRuntimeEventsV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { deriveContainedExecutorRequestFingerprintFromBindingV2 } from '../../lib/operate/governed-extensions-v2.mjs';
import {
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
  createOpenReferenceCapabilityAvailabilityV2,
  createDisposableLocalProjectTargetV2,
} from '../../lib/operate/reference-governed-executors-v2.mjs';
import { canonicalizeJson, sha256Jcs } from '../../lib/protocol/jcs.mjs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const clone = (value) => structuredClone(value);
const registerTests = import.meta.url === pathToFileURL(process.argv[1]).href;

function refreshActionRevision(action) {
  action.actionHash = derivePersistentOperatingActionRevisionHashV2(action);
  action.revisionId = `actrev_${sha256Jcs({
    actionId: action.actionId,
    revision: action.revision,
    actionHash: action.actionHash,
  }).slice('sha256:'.length)}`;
  return action;
}

export function createGovernedExecutionCheckpointStore(
  initialState,
  { beforeCommit, afterCommit } = {},
) {
  let state = clone(initialState);
  const commits = [];
  return {
    readSnapshot: () => clone(state),
    async compareAndSwap(input) {
      if (beforeCommit) {
        const replacement = await beforeCommit(input, clone(state));
        if (replacement !== undefined) state = clone(replacement);
      }
      const matches =
        input.expectedEventHead.sequence === state.eventHead.sequence &&
        input.expectedEventHead.hash === state.eventHead.hash;
      if (matches) {
        state = clone(input.nextState);
        commits.push({ phase: input.phase, state: clone(state) });
        if (afterCommit) await afterCommit(input, clone(state));
      }
      return { committed: matches, state: clone(state) };
    },
    snapshot: () => clone(state),
    commits,
  };
}

export function governedExecutionScenario({
  suffix = '00000001',
  payloadValue = { status: 'after', count: 1 },
  automatic = false,
  actionId = null,
  sourceArtifactId = null,
  targetBinding = null,
  initialValue = { status: 'before', count: 0 },
  dependsOnActionIds = null,
} = {}) {
  const authorization = fixture('authorization-valid.json');
  const contracts = fixture('governed-execution-contracts-valid.json');
  const action = clone(authorization.action);
  if (actionId !== null) action.actionId = actionId;
  if (sourceArtifactId !== null) {
    const priorSourceArtifactId = action.sourceArtifactId;
    action.sourceArtifactId = sourceArtifactId;
    action.preconditionArtifactIds = action.preconditionArtifactIds.map((artifactId) =>
      artifactId === priorSourceArtifactId ? sourceArtifactId : artifactId,
    );
  }
  if (targetBinding !== null) action.targetBinding = clone(targetBinding);
  if (dependsOnActionIds !== null) action.dependsOnActionIds = [...dependsOnActionIds];
  const baselineArtifactId = `art_baseline${suffix}`;
  action.preconditionArtifactIds = [
    ...new Set([...action.preconditionArtifactIds, baselineArtifactId]),
  ].sort();
  refreshActionRevision(action);
  const corePolicy = createOperatingActionPolicyV2({
    policyId: 'core-governed-action-policy',
    policyVersion: '1.0.0',
    domainId: action.domainId,
    actionKind: action.actionKind,
    capability: action.requestedCapability,
    effectClasses: [action.effectClass],
    targetKinds: [action.targetBinding.kind],
    decisionMode: 'automatic',
    approvalRequirementIds: [],
    rollbackRequired: true,
    verificationRequired: true,
    tier: 'core',
    provenance: {
      providerId: 'core-policy-provider',
      providerVersion: '1.0.0',
      sourceHash: `sha256:${'c'.repeat(64)}`,
    },
  });
  const domainPolicy = createOperatingActionPolicyV2({
    ...clone(contracts['operating-action-policy']),
    decisionMode: automatic ? 'automatic' : contracts['operating-action-policy'].decisionMode,
    approvalRequirementIds: automatic ? [] : ['aprq_template01'],
  });
  const evaluation = evaluateOperatingActionPolicyV2({
    action,
    configuredPolicies: [corePolicy, domainPolicy],
    evaluatedAt: '2026-08-10T08:00:00Z',
  });
  const requirement = automatic
    ? null
    : createOperatingApprovalRequirementV2({
        policyRequirementId: 'aprq_template01',
        evaluation,
        action,
        parties: clone(contracts['operating-approval-requirement'].parties),
        expiresAt: '2026-08-11T08:00:00Z',
        consumable: true,
      });
  const party = requirement?.parties[0];
  const approval = automatic
    ? null
    : createOperatingApprovalRecordV2({
        approvalId: `aprv_${suffix}`,
        requirement,
        evaluation,
        action,
        partyId: party.partyId,
        actor: {
          kind: party.actorKind,
          actorId: party.actorId,
          capability: clone(party.requiredCapability),
        },
        decision: 'approved',
        issuedAt: '2026-08-10T08:01:00Z',
        expiresAt: requirement.expiresAt,
      });
  const cycle = {
    ...clone(fixture('all-contracts-valid.json')['operating-cycle']),
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
  };
  const initial = createEmptyOperatingRuntimeStateV2('2026-08-10T08:01:00Z', {
    actionPolicies: [corePolicy, domainPolicy],
    approvalRequirements: requirement ? [requirement] : [],
  });
  initial.cycles = [cycle];
  initial.actions = [action];
  initial.policyEvaluations = [evaluation];
  initial.approvalRecords = approval ? [approval] : [];
  const request = {
    actionId: action.actionId,
    payload: {
      artifactId: action.sourceArtifactId,
      contentHash: sha256Jcs(payloadValue),
      value: clone(payloadValue),
    },
    rollbackBaseline: {
      artifactId: baselineArtifactId,
      contentHash: sha256Jcs(initialValue),
      value: clone(initialValue),
    },
  };
  const draft = {
    assignmentId: `asg_${suffix}`,
    submissionId: `sub_${suffix}`,
    operationId: `op_${suffix}`,
    grantId: `cgr_${suffix}`,
    resultId: `xres_${suffix}`,
    resultArtifactId: `art_result${suffix}`,
    claimId: `claim-${suffix}`,
    preparedAt: '2026-08-10T12:00:00Z',
    completedAt: '2026-08-10T12:01:00Z',
    grantExpiresAt: '2026-08-10T12:05:00Z',
    availabilityExpiresAt: '2026-08-10T12:06:00Z',
    correlationId: `corr-${suffix}`,
    eventIds: Object.fromEntries(
      [
        'assignmentCreated',
        'assignmentClaimed',
        'assignmentStarted',
        'availabilityRecorded',
        'capabilityGranted',
        'intentRecorded',
        'submitted',
        'artifactCreated',
        'validated',
        'resultRecorded',
      ].map((field, index) => [field, `evt_${suffix}_${String(index + 1).padStart(2, '0')}`]),
    ),
    uncertainty: {
      resultId: `xres_uncertain${suffix}`,
      resultArtifactId: `art_uncertain${suffix}`,
      submissionId: `sub_uncertain${suffix}`,
      eventIds: Object.fromEntries(
        ['submitted', 'artifactCreated', 'validated', 'resultRecorded'].map((field, index) => [
          field,
          `evt_${suffix}_uncertain_${String(index + 1).padStart(2, '0')}`,
        ]),
      ),
    },
  };
  return { action, initial, initialValue: clone(initialValue), request, draft };
}

export function rawArtifactStore({ fail = false, writeThenThrow = false } = {}) {
  const entries = new Map();
  return {
    stageRaw({ artifact, rawBytes }) {
      if (fail) throw new Error('raw-stage-failed');
      const next = Buffer.from(rawBytes);
      const prior = entries.get(artifact.artifactId);
      if (prior && (prior.rawHash !== artifact.rawHash || !prior.bytes.equals(next))) {
        throw new Error('artifact-byte-collision');
      }
      entries.set(artifact.artifactId, { rawHash: artifact.rawHash, bytes: next });
      if (writeThenThrow) throw new Error('raw-stage-ack-lost');
      return true;
    },
    readRaw({ artifactId, rawHash }) {
      const entry = entries.get(artifactId);
      if (!entry) throw new Error('artifact-not-found');
      if (entry.rawHash !== rawHash) throw new Error('artifact-hash-mismatch');
      return Buffer.from(entry.bytes);
    },
    read(artifactId) {
      return entries.has(artifactId) ? Buffer.from(entries.get(artifactId).bytes) : null;
    },
  };
}

function withResultHash(result) {
  const next = clone(result);
  delete next.resultHash;
  next.resultHash = sha256Jcs(next);
  return next;
}

function refreshCapabilityAvailabilityIdentity(availability) {
  availability.availabilityId = 'cava_pending000';
  delete availability.availabilityHash;
  availability.availabilityId = `cava_${sha256Jcs(availability).slice('sha256:'.length)}`;
  availability.availabilityHash = sha256Jcs(availability);
  return availability;
}

function rehashCheckpointEventChain(state, sourceEvents) {
  const events = sourceEvents.map(clone).sort((left, right) => left.sequence - right.sequence);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (index > 0) event.previousEventHash = events[index - 1].eventHash;
    event.eventHash = computeOperatingRuntimeEventHashV2(event);
    const replay = state.eventReplayIndex.find(({ eventId }) => eventId === event.eventId);
    assert.ok(replay, `missing replay entry for ${event.eventId}`);
    Object.assign(replay, {
      eventHash: event.eventHash,
      payloadHash: sha256Jcs(event.payload),
      sequence: event.sequence,
      cycleId: event.cycleId,
      type: event.type,
      entityId: event.entityId,
      timestamp: event.timestamp,
      actor: clone(event.actor),
      causationId: event.causationId,
      correlationId: event.correlationId,
      previousEventHash: event.previousEventHash,
    });
    if (Object.hasOwn(event, 'requestHash')) replay.requestHash = event.requestHash;
  }
  const head = events.at(-1);
  state.eventHead = { sequence: head.sequence, hash: head.eventHash };
  return events;
}

function replaceScenarioApprovalAuthority(
  state,
  { requirementExpiresAt, approvalExpiresAt, consumedByOperationId = null } = {},
) {
  const action = state.actions[0];
  const evaluation = state.policyEvaluations[0];
  const priorRequirement = state.approvalRequirements[0];
  const priorApproval = state.approvalRecords[0];
  const requirement = createOperatingApprovalRequirementV2({
    policyRequirementId: 'aprq_template01',
    evaluation,
    action,
    parties: clone(priorRequirement.parties),
    expiresAt: requirementExpiresAt,
    consumable: true,
  });
  let approval = createOperatingApprovalRecordV2({
    approvalId: priorApproval.approvalId,
    requirement,
    evaluation,
    action,
    partyId: priorApproval.partyId,
    actor: clone(priorApproval.actor),
    decision: 'approved',
    issuedAt: priorApproval.issuedAt,
    expiresAt: approvalExpiresAt,
  });
  if (consumedByOperationId !== null) {
    approval = { ...clone(approval), consumedByOperationId };
    delete approval.recordHash;
    approval.recordHash = sha256Jcs(approval);
  }
  state.approvalRequirements = [clone(requirement)];
  state.approvalRecords = [clone(approval)];
  return { requirement, approval };
}

function configureThresholdApprovalAuthority(state, suffix) {
  const action = state.actions[0];
  const corePolicy = state.actionPolicies.find(({ tier }) => tier === 'core');
  const priorDomainPolicy = state.actionPolicies.find(({ tier }) => tier === 'domain');
  const domainPolicy = createOperatingActionPolicyV2({
    ...clone(priorDomainPolicy),
    decisionMode: 'threshold',
    approvalRequirementIds: ['aprq_threshold01'],
  });
  const evaluation = evaluateOperatingActionPolicyV2({
    action,
    configuredPolicies: [corePolicy, domainPolicy],
    evaluatedAt: '2026-08-10T08:00:00Z',
  });
  const parties = [1, 2, 3].map((index) => ({
    partyId: `threshold-party-${index}`,
    actorKind: 'human',
    actorId: `threshold-owner-000${index}`,
    requiredCapability: { id: 'action-approve', version: '1.0.0' },
  }));
  const requirement = createOperatingApprovalRequirementV2({
    policyRequirementId: 'aprq_threshold01',
    evaluation,
    action,
    parties,
    threshold: 2,
    expiresAt: '2026-08-11T08:00:00Z',
    consumable: true,
  });
  const records = parties.map((party, index) =>
    createOperatingApprovalRecordV2({
      approvalId: `aprv_${suffix}_threshold_${index + 1}`,
      requirement,
      evaluation,
      action,
      partyId: party.partyId,
      actor: {
        kind: party.actorKind,
        actorId: party.actorId,
        capability: clone(party.requiredCapability),
      },
      decision: index === 2 ? 'rejected' : 'approved',
      issuedAt: '2026-08-10T08:01:00Z',
      expiresAt: requirement.expiresAt,
    }),
  );
  state.actionPolicies = [clone(corePolicy), clone(domainPolicy)];
  state.policyEvaluations = [clone(evaluation)];
  state.approvalRequirements = [clone(requirement)];
  state.approvalRecords = records.slice(0, 2).map(clone);
  return { evaluation, requirement, approved: records.slice(0, 2), rejected: records[2] };
}

function rehashEventArray(events) {
  for (let index = 0; index < events.length; index += 1) {
    if (index > 0) events[index].previousEventHash = events[index - 1].eventHash;
    events[index].eventHash = computeOperatingRuntimeEventHashV2(events[index]);
  }
  return events;
}

export function reduceDirectResultTransaction(dispatchState, scenario, result, receipt = null) {
  const terminal = ['succeeded', 'partial'].includes(result.status)
    ? {
        resultId: scenario.draft.resultId,
        resultArtifactId: scenario.draft.resultArtifactId,
        submissionId: scenario.draft.submissionId,
        eventIds: scenario.draft.eventIds,
      }
    : scenario.draft.uncertainty;
  const resultBytes = Buffer.from(canonicalizeJson(result), 'utf8');
  const claimedAssignment = dispatchState.assignments.find(
    ({ assignmentId }) => assignmentId === scenario.draft.assignmentId,
  );
  const accepted = acceptOperatingAssignmentSubmissionV2(
    {
      assignmentId: scenario.draft.assignmentId,
      submissionId: terminal.submissionId,
      actor: {
        actorId: claimedAssignment.claim.actorId,
        kind: claimedAssignment.claim.actorKind,
        runtime: claimedAssignment.claim.runtime,
      },
      contentBase64: resultBytes.toString('base64'),
      mediaType: 'application/json',
      encoding: 'utf-8',
    },
    {
      artifactId: terminal.resultArtifactId,
      artifactType: 'operating-execution-result',
      storageClass: 'machine-local',
      sensitivity: 'internal',
      retentionClass: 'project',
      inputArtifactIds: result.inputArtifactIds,
      timestamp: result.completedAt,
      validatorVersion: 'operate-governed-execution-v2@1.0.0',
      eventIds: {
        submitted: terminal.eventIds.submitted,
        artifactCreated: terminal.eventIds.artifactCreated,
        validated: terminal.eventIds.validated,
      },
      correlationId: scenario.draft.correlationId,
    },
    { initialState: dispatchState },
  );
  const head = accepted.state.eventReplayIndex.find(
    ({ sequence }) => sequence === accepted.state.eventHead.sequence,
  );
  const resultEvent = createOperatingRuntimeEventV2(
    {
      eventId: terminal.eventIds.resultRecorded,
      timestamp: result.completedAt,
      cycleId: scenario.action.sourceCycleId,
      type: 'execution.result-recorded',
      entityId: result.resultId,
      actor: { kind: 'engine', id: 'operate-runtime-v2' },
      causationId: head.eventId,
      correlationId: scenario.draft.correlationId,
      payload: { result, receipt },
    },
    { previousEvent: { sequence: head.sequence, eventHash: head.eventHash } },
  );
  const events = [...accepted.events, resultEvent];
  return {
    state: reduceOperatingRuntimeEventsV2(events, { initialState: dispatchState }),
    events,
  };
}

function reduceDirectResult(dispatchState, scenario, result, receipt = null) {
  return reduceDirectResultTransaction(dispatchState, scenario, result, receipt).state;
}

registerTests &&
  test('one approved Action becomes one Assignment, grant, operation, exact result Artifact, and contained effect', async () => {
    const scenario = governedExecutionScenario();
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

    assert.equal(completed.replayed, false);
    assert.equal(completed.dispatchCount, 1);
    assert.equal(completed.effectCount, 1);
    assert.equal(targetAdapter.describe().effectCount, 1);
    assert.equal(completed.state.assignments.length, 1);
    assert.equal(completed.state.assignments[0].assignmentKind, 'execution');
    assert.equal(completed.state.assignments[0].state, 'validated');
    assert.equal(completed.state.capabilityGrants.length, 1);
    assert.equal(completed.state.capabilityGrants[0].consumedAt, scenario.draft.preparedAt);
    assert.deepEqual(
      checkpointStore.commits.map(({ phase }) => phase),
      ['dispatch-intent', 'terminal-result'],
    );
    assert.equal(completed.state.governedOperations.length, 1);
    assert.equal(completed.state.governedOperations[0].state, 'succeeded');
    assert.equal(completed.state.executionResults.length, 1);
    assert.equal(completed.artifact.canonicalHash, sha256Jcs(completed.result));
    assert.equal(completed.result.targetBeforeHash, scenario.request.rollbackBaseline.contentHash);
    assert.equal(completed.result.targetAfterHash, sha256Jcs(scenario.request.payload.value));
    assert.deepEqual(completed.result.inputArtifactIds, [
      ...new Set([scenario.action.sourceArtifactId, ...scenario.action.preconditionArtifactIds]),
    ]);
    assert.deepEqual(completed.result.outputArtifactIds, [scenario.draft.resultArtifactId]);
    assert.equal(
      completed.events.filter(({ type }) => type === 'operation.intent-recorded').length,
      1,
    );
    assert.equal(
      completed.events.filter(({ type }) => type === 'execution.result-recorded').length,
      1,
    );
    assert.equal(completed.state.operationReplayIndex[0].terminalResultId, scenario.draft.resultId);
    assert.equal(
      completed.state.approvalRecords[0].consumedByOperationId,
      scenario.draft.operationId,
    );
    const dispatchProof = assertOperatingExecuteDispatchAuthorityChainV2({
      state: checkpointStore.commits[0].state,
      operationId: scenario.draft.operationId,
    });
    assert.equal(dispatchProof.operation.operationId, scenario.draft.operationId);
    assert.equal(dispatchProof.assignment.assignmentId, scenario.draft.assignmentId);
    assert.equal(dispatchProof.grant.grantId, scenario.draft.grantId);
    assert.equal(dispatchProof.replayEntry.intentEventId, scenario.draft.eventIds.intentRecorded);
    const missingLifecycle = clone(checkpointStore.commits[0].state);
    missingLifecycle.eventReplayIndex = missingLifecycle.eventReplayIndex.filter(
      ({ type }) => type !== 'assignment.available',
    );
    assert.throws(
      () =>
        assertOperatingExecuteDispatchAuthorityChainV2({
          state: missingLifecycle,
          operationId: scenario.draft.operationId,
        }),
      ({ code }) => code === 'OPERATION_CONFLICT' || code === 'STATE_TRANSITION_INVALID',
    );
  });

registerTests &&
  test('governed execution canonicalizes arbitrary lexical Artifact IDs before dispatch', async () => {
    const scenario = governedExecutionScenario({
      suffix: '00000032',
      sourceArtifactId: 'art_z_source00000032',
    });
    const operationInputArtifactIds = [
      scenario.action.sourceArtifactId,
      ...scenario.action.preconditionArtifactIds,
    ].filter((artifactId, index, values) => values.indexOf(artifactId) === index);
    const expectedInputArtifactIds = [...operationInputArtifactIds].sort();
    assert.notDeepEqual(operationInputArtifactIds, expectedInputArtifactIds);

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

    assert.deepEqual(completed.operation.inputArtifactIds, expectedInputArtifactIds);
    assert.deepEqual(completed.result.inputArtifactIds, expectedInputArtifactIds);
    assert.deepEqual(completed.state.assignments[0].inputArtifactIds, expectedInputArtifactIds);
    assert.deepEqual(completed.artifact.inputArtifactIds, expectedInputArtifactIds);
    assert.equal(targetAdapter.describe().effectCount, 1);
  });

registerTests &&
  test('raw Artifact staging failure after a proved effect remains explicitly proven-terminal and never redispatches', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000011' });
    const targetAdapter = createDisposableLocalProjectTargetV2({
      target: scenario.action.targetBinding,
      initialValue: scenario.initialValue,
    });
    const checkpointStore = createGovernedExecutionCheckpointStore(scenario.initial);
    const artifactStore = rawArtifactStore({ fail: true });
    const runtime = createOperatingGovernedExecutionRuntimeV2({
      initialState: scenario.initial,
      checkpointStore,
      artifactStore,
    });
    await assert.rejects(
      runtime.execute(scenario.request, scenario.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter,
      }),
      (error) =>
        error.code === 'OPERATION_UNCERTAIN' && error.details.context.provenTerminal === true,
    );
    const durable = checkpointStore.snapshot();
    assert.equal(durable.governedOperations[0].state, 'dispatching');
    assert.equal(durable.governedOperations[0].resultId, null);
    assert.equal(durable.executionResults.length, 0);
    assert.equal(artifactStore.read(scenario.draft.resultArtifactId), null);
    assert.equal(artifactStore.read(scenario.draft.uncertainty.resultArtifactId), null);
    assert.equal(targetAdapter.describe().effectCount, 1);
    await assert.rejects(
      runtime.execute(scenario.request, scenario.draft, {
        trustedHost: new Proxy(
          {},
          {
            get() {
              throw new Error('retry touched host');
            },
          },
        ),
        targetAdapter: new Proxy(
          {},
          {
            get() {
              throw new Error('retry touched target');
            },
          },
        ),
      }),
      (error) =>
        error.code === 'OPERATION_UNCERTAIN' && error.details.context.provenTerminal === true,
    );
    assert.equal(targetAdapter.describe().effectCount, 1);
  });

registerTests &&
  test('write-then-throw byte-store acknowledgement loss proves exact success and never reuses its Artifact identity', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000018' });
    const targetAdapter = createDisposableLocalProjectTargetV2({
      target: scenario.action.targetBinding,
      initialValue: scenario.initialValue,
    });
    const checkpointStore = createGovernedExecutionCheckpointStore(scenario.initial);
    const artifactStore = rawArtifactStore({ writeThenThrow: true });
    const runtime = createOperatingGovernedExecutionRuntimeV2({
      initialState: scenario.initial,
      checkpointStore,
      artifactStore,
    });
    const completed = await runtime.execute(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    });
    assert.equal(completed.result.status, 'succeeded');
    assert.equal(completed.result.resultArtifactId, scenario.draft.resultArtifactId);
    assert.deepEqual(
      artifactStore.read(scenario.draft.resultArtifactId),
      Buffer.from(canonicalizeJson(completed.result), 'utf8'),
    );
    assert.equal(artifactStore.read(scenario.draft.uncertainty.resultArtifactId), null);

    const replay = await runtime.execute(scenario.request, scenario.draft, {
      trustedHost: new Proxy(
        {},
        {
          get() {
            throw new Error('retry touched host');
          },
        },
      ),
      targetAdapter: new Proxy(
        {},
        {
          get() {
            throw new Error('retry touched target');
          },
        },
      ),
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.dispatchCount, 0);

    const restarted = createOperatingGovernedExecutionRuntimeV2({
      initialState: scenario.initial,
      checkpointStore,
      artifactStore,
    });
    const restartedReplay = await restarted.execute(scenario.request, scenario.draft, {
      trustedHost: new Proxy(
        {},
        {
          get() {
            throw new Error('restart touched host');
          },
        },
      ),
      targetAdapter: new Proxy(
        {},
        {
          get() {
            throw new Error('restart touched target');
          },
        },
      ),
    });
    assert.equal(restartedReplay.replayed, true);
    assert.equal(restarted.dispatchCount, 0);
    assert.equal(targetAdapter.describe().effectCount, 1);
  });

registerTests &&
  test('terminal reservation families are collision-free before target access', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000019' });
    scenario.draft.uncertainty.eventIds.submitted = scenario.draft.eventIds.submitted;
    let targetReads = 0;
    const targetAdapter = new Proxy(
      {},
      {
        get() {
          targetReads += 1;
          throw new Error('collision reached target');
        },
      },
    );
    const runtime = createOperatingGovernedExecutionRuntimeV2({
      initialState: scenario.initial,
      checkpointStore: createGovernedExecutionCheckpointStore(scenario.initial),
    });
    await assert.rejects(
      runtime.execute(scenario.request, scenario.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter,
      }),
      { code: 'RESULT_CONTRACT_INVALID' },
    );
    assert.equal(targetReads, 0);
    assert.equal(runtime.dispatchCount, 0);
  });

registerTests &&
  test('proven success rebases after an unrelated checkpoint append and retains exact staged bytes', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000012' });
    const targetAdapter = createDisposableLocalProjectTargetV2({
      target: scenario.action.targetBinding,
      initialValue: scenario.initialValue,
    });
    const artifactStore = rawArtifactStore();
    let interleaved = false;
    const checkpointStore = createGovernedExecutionCheckpointStore(scenario.initial, {
      beforeCommit(input, durable) {
        if (
          input.phase !== 'terminal-result' ||
          durable.capabilityAvailability.some(
            ({ availabilityId }) => availabilityId === 'cava_unrelated00000012',
          )
        )
          return;
        interleaved = true;
        const prior = durable.eventReplayIndex.find(
          ({ sequence }) => sequence === durable.eventHead.sequence,
        );
        const availability = clone(durable.capabilityAvailability[0]);
        availability.availabilityId = 'cava_unrelated00000012';
        availability.checkedAt = scenario.draft.completedAt;
        delete availability.availabilityHash;
        availability.availabilityHash = sha256Jcs(availability);
        const event = createOperatingRuntimeEventV2(
          {
            eventId: 'evt_unrelated00000012',
            timestamp: scenario.draft.completedAt,
            cycleId: scenario.action.sourceCycleId,
            type: 'capability.availability-recorded',
            entityId: availability.availabilityId,
            actor: { kind: 'engine', id: 'operate-runtime-v2' },
            causationId: prior.eventId,
            correlationId: 'corr-unrelated-00000012',
            payload: availability,
          },
          { previousEvent: { sequence: prior.sequence, eventHash: prior.eventHash } },
        );
        const external = reduceOperatingRuntimeEventsV2([event], { initialState: durable });
        assert.equal(external.eventHead.sequence, durable.eventHead.sequence + 1);
        assert.equal(external.capabilityAvailability.length, 2);
        return external;
      },
    });
    const runtime = createOperatingGovernedExecutionRuntimeV2({
      initialState: scenario.initial,
      checkpointStore,
      artifactStore,
    });
    const completed = await runtime.execute(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    });
    assert.equal(completed.result.status, 'succeeded');
    assert.equal(interleaved, true);
    assert.equal(targetAdapter.describe().effectCount, 1);
    assert.equal(checkpointStore.snapshot().capabilityAvailability.length, 2);
    assert.deepEqual(
      artifactStore.read(scenario.draft.resultArtifactId),
      Buffer.from(canonicalizeJson(completed.result), 'utf8'),
    );
    assert.deepEqual(
      checkpointStore.commits.map(({ phase }) => phase),
      ['dispatch-intent', 'terminal-result'],
    );
  });

registerTests &&
  test('two approved Actions may evolve one target sequentially while each receipt remains operation-local', async () => {
    const first = governedExecutionScenario({ suffix: '00000016' });
    const targetAdapter = createDisposableLocalProjectTargetV2({
      target: first.action.targetBinding,
      initialValue: first.initialValue,
    });
    const firstRuntime = createOperatingGovernedExecutionRuntimeV2({
      initialState: first.initial,
      checkpointStore: createGovernedExecutionCheckpointStore(first.initial),
    });
    const firstResult = await firstRuntime.execute(first.request, first.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    });
    const evolvedTarget = targetAdapter.describe().target;
    const second = governedExecutionScenario({
      suffix: '00000017',
      actionId: 'act_sequential00000017',
      targetBinding: evolvedTarget,
      initialValue: first.request.payload.value,
      payloadValue: { status: 'after-second', count: 2 },
    });
    const secondRuntime = createOperatingGovernedExecutionRuntimeV2({
      initialState: second.initial,
      checkpointStore: createGovernedExecutionCheckpointStore(second.initial),
    });
    const secondResult = await secondRuntime.execute(second.request, second.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    });
    assert.equal(firstResult.receipt.effectCount, 1);
    assert.equal(secondResult.receipt.effectCount, 1);
    assert.equal(firstResult.result.status, 'succeeded');
    assert.equal(secondResult.result.status, 'succeeded');
    assert.equal(targetAdapter.describe().effectCount, 2);
    assert.equal(secondResult.result.targetBeforeHash, firstResult.result.targetAfterHash);
  });

registerTests &&
  test('exact completed retry returns the accepted chain without another target call or Event', async () => {
    const scenario = governedExecutionScenario();
    const targetAdapter = createDisposableLocalProjectTargetV2({
      target: scenario.action.targetBinding,
      initialValue: scenario.initialValue,
    });
    const runtime = createOperatingGovernedExecutionRuntimeV2({
      initialState: scenario.initial,
      checkpointStore: createGovernedExecutionCheckpointStore(scenario.initial),
    });
    const first = await runtime.execute(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    });
    const eventHead = clone(first.state.eventHead);
    const replay = await runtime.execute(scenario.request, scenario.draft, {
      trustedHost: new Proxy(
        {},
        {
          get() {
            throw new Error('replay touched host');
          },
        },
      ),
      targetAdapter: new Proxy(
        {},
        {
          get() {
            throw new Error('replay touched target');
          },
        },
      ),
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.dispatchCount, 0);
    assert.equal(replay.effectCount, 0);
    assert.deepEqual(replay.events, []);
    assert.deepEqual(replay.state.eventHead, eventHead);
    assert.equal(targetAdapter.describe().effectCount, 1);
    assert.deepEqual(replay.result, first.result);
  });

registerTests &&
  test('tampered payload, baseline, or result identity fails closed without accepting another chain', async () => {
    const scenario = governedExecutionScenario();
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
    divergent.payload.value.count = 2;
    divergent.payload.contentHash = sha256Jcs(divergent.payload.value);
    await assert.rejects(
      runtime.execute(divergent, scenario.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter,
      }),
      { code: 'OPERATION_CONFLICT' },
    );
    for (const [field, value, code = 'RESULT_CONTRACT_INVALID'] of [
      ['assignmentId', 'asg_99999999', 'OPERATION_CONFLICT'],
      ['submissionId', 'sub_99999999', 'OPERATION_CONFLICT'],
      ['grantId', 'cgr_99999999', 'OPERATION_CONFLICT'],
      ['resultId', 'xres_99999999'],
      ['resultArtifactId', 'art_result99999999'],
      ['completedAt', '2026-08-10T12:02:00Z'],
    ]) {
      const divergentDraft = clone(scenario.draft);
      divergentDraft[field] = value;
      await assert.rejects(
        runtime.execute(scenario.request, divergentDraft, {
          trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
          targetAdapter,
        }),
        {
          code: ['resultId', 'resultArtifactId', 'completedAt'].includes(field)
            ? 'OPERATION_CONFLICT'
            : code,
        },
      );
    }
    for (const field of ['submitted', 'artifactCreated', 'validated', 'resultRecorded']) {
      const divergentDraft = clone(scenario.draft);
      divergentDraft.eventIds[field] = `evt_99999999_${field}`;
      await assert.rejects(
        runtime.execute(scenario.request, divergentDraft, {
          trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
          targetAdapter,
        }),
        { code: 'OPERATION_CONFLICT' },
      );
    }
    assert.equal(targetAdapter.describe().effectCount, 1);
    assert.equal(runtime.getState().executionResults.length, 1);
  });

registerTests &&
  test('canonical incomplete-dependency denial precedes contained target inspection', async () => {
    const dependencyId = 'act_dependency00000020';
    const scenario = governedExecutionScenario({
      suffix: '00000020',
      dependsOnActionIds: [dependencyId],
    });
    const dependency = clone(scenario.action);
    dependency.actionId = dependencyId;
    dependency.state = 'approved';
    dependency.dependsOnActionIds = [];
    refreshActionRevision(dependency);
    scenario.initial.actions = [scenario.action, dependency];
    let targetReads = 0;
    const targetAdapter = new Proxy(
      {},
      {
        get() {
          targetReads += 1;
          throw new Error('authority denial touched target');
        },
      },
    );
    const runtime = createOperatingGovernedExecutionRuntimeV2({
      initialState: scenario.initial,
      checkpointStore: createGovernedExecutionCheckpointStore(scenario.initial),
    });
    await assert.rejects(
      runtime.execute(scenario.request, scenario.draft, {
        trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
        targetAdapter,
      }),
      { code: 'STATE_TRANSITION_INVALID' },
    );
    assert.equal(targetReads, 0);
    assert.equal(runtime.dispatchCount, 0);
    assert.equal(runtime.getState().governedOperations.length, 0);
  });

registerTests &&
  test('direct intent reduction rejects every fully rehashed caller-defined execute authority field', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000024' });
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
    const intentOffset = completed.events.findIndex(
      ({ type }) => type === 'operation.intent-recorded',
    );
    const preIntentState = reduceOperatingRuntimeEventsV2(completed.events.slice(0, intentOffset), {
      initialState: scenario.initial,
    });
    const intent = completed.events[intentOffset];
    const vectors = [
      [
        'cross target',
        (operation) => {
          operation.target = {
            kind: 'project-record',
            id: 'other-target',
            revision: 'rev-other01',
          };
        },
      ],
      [
        'capability',
        (operation) => {
          operation.capability = { id: 'synthetic-contained-write', version: '1.0.0' };
        },
      ],
      [
        'effect',
        (operation) => {
          operation.effectClass = 'machine-local-write';
        },
      ],
      [
        'preconditions',
        (operation) => {
          operation.preconditionArtifactIds = [];
        },
      ],
      [
        'undeclared input',
        (operation) => {
          operation.inputArtifactIds.push('art_undeclared00000024');
        },
      ],
      [
        'verification',
        (operation) => {
          operation.verificationPlanId = 'vfy_forged00000024';
        },
      ],
      [
        'executor',
        (operation) => {
          operation.executor = {
            executorId: 'open-reference-containment-executor',
            executorVersion: '1.0.0',
          };
        },
      ],
      [
        'connector',
        (operation) => {
          operation.connector = { id: 'synthetic-no-network-connector', version: '1.0.0' };
        },
      ],
      [
        'rollback class',
        (operation) => {
          operation.rollbackClass = 'manual';
        },
      ],
      [
        'rollback plan',
        (operation) => {
          operation.rollbackPlanId = 'rbp_forged00000024';
        },
      ],
      [
        'parent operation',
        (operation) => {
          operation.parentOperationId = 'op_parent00000024';
        },
      ],
      [
        'dispatch timestamp',
        (operation, event) => {
          operation.createdAt = '2026-08-10T12:00:01Z';
          operation.updatedAt = operation.createdAt;
          event.timestamp = operation.createdAt;
        },
      ],
    ];
    for (const [label, mutate] of vectors) {
      const forged = clone(intent);
      const operation = forged.payload.operation;
      mutate(operation, forged);
      operation.requestFingerprint = deriveContainedExecutorRequestFingerprintFromBindingV2({
        operation,
        payload: forged.payload.request.payload,
        rollbackBaseline: forged.payload.request.rollbackBaseline,
      });
      delete operation.operationHash;
      operation.operationHash = sha256Jcs(operation);
      forged.requestHash = operation.requestFingerprint;
      forged.eventHash = computeOperatingRuntimeEventHashV2(forged);
      assert.throws(
        () => reduceOperatingRuntimeEventsV2([forged], { initialState: preIntentState }),
        (error) => ['OPERATION_CONFLICT', 'STATE_TRANSITION_INVALID'].includes(error.code),
        label,
      );
    }
  });

registerTests &&
  test('Action revision hashing is immutable-content exact and lifecycle-stable in direct and checkpoint paths', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000026' });
    const lifecycleOnly = clone(scenario.action);
    lifecycleOnly.state = 'completed';
    lifecycleOnly.updatedAt = '2026-08-10T12:01:00Z';
    assert.equal(
      derivePersistentOperatingActionRevisionHashV2(lifecycleOnly),
      scenario.action.actionHash,
    );
    const contentChange = clone(scenario.action);
    contentChange.title = 'Forged retained-hash Action content';
    assert.notEqual(
      derivePersistentOperatingActionRevisionHashV2(contentChange),
      scenario.action.actionHash,
    );

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
    const intentOffset = completed.events.findIndex(
      ({ type }) => type === 'operation.intent-recorded',
    );
    const intent = completed.events[intentOffset];
    const preIntentState = reduceOperatingRuntimeEventsV2(completed.events.slice(0, intentOffset), {
      initialState: scenario.initial,
    });

    const forgedCheckpoint = clone(completed.state);
    forgedCheckpoint.actions[0].title = contentChange.title;
    assert.throws(() => reduceOperatingRuntimeEventsV2([], { initialState: forgedCheckpoint }), {
      code: 'ACTION_REVISION_MISMATCH',
    });

    const forgedDirect = clone(preIntentState);
    forgedDirect.actions[0].title = contentChange.title;
    assert.throws(() => reduceOperatingRuntimeEventsV2([intent], { initialState: forgedDirect }), {
      code: 'ACTION_REVISION_MISMATCH',
    });
  });

registerTests &&
  test('deterministic policy output rejects a fully rehashed reason rewrite in direct and checkpoint paths', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000027' });
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
    const intentOffset = completed.events.findIndex(
      ({ type }) => type === 'operation.intent-recorded',
    );
    const intent = completed.events[intentOffset];
    const preIntentState = reduceOperatingRuntimeEventsV2(completed.events.slice(0, intentOffset), {
      initialState: scenario.initial,
    });
    const forgeEvaluation = (state) => {
      const evaluation = state.policyEvaluations[0];
      evaluation.reasonCodes = [...evaluation.reasonCodes, 'forged-policy-reason'].sort();
      delete evaluation.evaluationHash;
      evaluation.evaluationHash = sha256Jcs(evaluation);
    };

    const forgedCheckpoint = clone(completed.state);
    forgeEvaluation(forgedCheckpoint);
    assert.throws(() => reduceOperatingRuntimeEventsV2([], { initialState: forgedCheckpoint }), {
      code: 'POLICY_EVALUATION_REJECTED',
    });

    const forgedDirect = clone(preIntentState);
    forgeEvaluation(forgedDirect);
    assert.throws(() => reduceOperatingRuntimeEventsV2([intent], { initialState: forgedDirect }), {
      code: 'POLICY_EVALUATION_REJECTED',
    });
  });

registerTests &&
  test('execute authority rejects a stale evaluation when a newer deterministic revision is effective', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000030' });
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
    const newerEvaluation = evaluateOperatingActionPolicyV2({
      action: scenario.action,
      configuredPolicies: scenario.initial.actionPolicies,
      evaluatedAt: '2026-08-10T11:00:00Z',
    });
    const newerRequirement = createOperatingApprovalRequirementV2({
      policyRequirementId: 'aprq_template01',
      evaluation: newerEvaluation,
      action: scenario.action,
      parties: clone(scenario.initial.approvalRequirements[0].parties),
      expiresAt: '2026-08-11T08:00:00Z',
      consumable: true,
    });
    const addNewerAuthority = (state) => {
      state.policyEvaluations.push(clone(newerEvaluation));
      state.approvalRequirements.push(clone(newerRequirement));
    };

    const forgedCheckpoint = clone(completed.state);
    addNewerAuthority(forgedCheckpoint);
    assert.throws(() => reduceOperatingRuntimeEventsV2([], { initialState: forgedCheckpoint }), {
      code: 'OPERATION_CONFLICT',
    });

    const intentOffset = completed.events.findIndex(
      ({ type }) => type === 'operation.intent-recorded',
    );
    const forgedInitial = clone(scenario.initial);
    addNewerAuthority(forgedInitial);
    const preIntent = reduceOperatingRuntimeEventsV2(completed.events.slice(0, intentOffset), {
      initialState: forgedInitial,
    });
    assert.throws(
      () =>
        reduceOperatingRuntimeEventsV2([completed.events[intentOffset]], {
          initialState: preIntent,
        }),
      { code: 'OPERATION_CONFLICT' },
    );
  });

registerTests &&
  test('grant expiry cannot exceed availability, requirement, or approval ceilings in direct or checkpoint paths', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000031' });
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
    const intentOffset = completed.events.findIndex(
      ({ type }) => type === 'operation.intent-recorded',
    );
    const availabilityOffset = completed.events.findIndex(
      ({ type }) => type === 'capability.availability-recorded',
    );
    const grantOffset = completed.events.findIndex(({ type }) => type === 'capability.granted');
    const vectors = [
      ['availability', { availabilityExpiresAt: '2026-08-10T12:04:00Z' }],
      [
        'requirement',
        {
          requirementExpiresAt: '2026-08-10T12:04:00Z',
          approvalExpiresAt: null,
        },
      ],
      [
        'approval',
        {
          requirementExpiresAt: '2026-08-10T12:06:00Z',
          approvalExpiresAt: '2026-08-10T12:04:00Z',
        },
      ],
    ];
    for (const [label, ceiling] of vectors) {
      const forgedCheckpoint = clone(completed.state);
      const checkpointEvents = completed.events.map(clone);
      let replacement = null;
      if (ceiling.requirementExpiresAt) {
        replacement = replaceScenarioApprovalAuthority(forgedCheckpoint, {
          ...ceiling,
          consumedByOperationId: scenario.draft.operationId,
        });
      }
      if (ceiling.availabilityExpiresAt) {
        const availability = forgedCheckpoint.capabilityAvailability[0];
        availability.expiresAt = ceiling.availabilityExpiresAt;
        refreshCapabilityAvailabilityIdentity(availability);
        checkpointEvents[availabilityOffset].entityId = availability.availabilityId;
        checkpointEvents[availabilityOffset].payload = clone(availability);
      }
      const checkpointGrant = forgedCheckpoint.capabilityGrants[0];
      if (replacement) checkpointGrant.scopeHash = replacement.requirement.scopeHash;
      delete checkpointGrant.grantHash;
      checkpointGrant.grantHash = sha256Jcs(checkpointGrant);
      checkpointEvents[grantOffset].payload = {
        ...clone(checkpointGrant),
        consumedAt: null,
      };
      checkpointEvents[grantOffset].payload.grantHash = sha256Jcs(
        Object.fromEntries(
          Object.entries(checkpointEvents[grantOffset].payload).filter(
            ([key]) => key !== 'grantHash',
          ),
        ),
      );
      rehashCheckpointEventChain(forgedCheckpoint, checkpointEvents);
      assert.throws(
        () => reduceOperatingRuntimeEventsV2([], { initialState: forgedCheckpoint }),
        { code: 'OPERATION_CONFLICT' },
        `${label} checkpoint`,
      );

      const forgedInitial = clone(scenario.initial);
      let directReplacement = null;
      if (ceiling.requirementExpiresAt) {
        directReplacement = replaceScenarioApprovalAuthority(forgedInitial, ceiling);
      }
      const prefix = completed.events.slice(0, intentOffset).map(clone);
      if (ceiling.availabilityExpiresAt) {
        prefix[availabilityOffset].payload.expiresAt = ceiling.availabilityExpiresAt;
        refreshCapabilityAvailabilityIdentity(prefix[availabilityOffset].payload);
        prefix[availabilityOffset].entityId = prefix[availabilityOffset].payload.availabilityId;
      }
      if (directReplacement) {
        prefix[grantOffset].payload.scopeHash = directReplacement.requirement.scopeHash;
        delete prefix[grantOffset].payload.grantHash;
        prefix[grantOffset].payload.grantHash = sha256Jcs(prefix[grantOffset].payload);
      }
      rehashEventArray(prefix);
      const preIntent = reduceOperatingRuntimeEventsV2(prefix, { initialState: forgedInitial });
      const intent = clone(completed.events[intentOffset]);
      intent.previousEventHash = prefix.at(-1).eventHash;
      intent.eventHash = computeOperatingRuntimeEventHashV2(intent);
      assert.throws(
        () => reduceOperatingRuntimeEventsV2([intent], { initialState: preIntent }),
        { code: 'OPERATION_CONFLICT' },
        `${label} direct`,
      );
    }
  });

registerTests &&
  test('execute validation evaluates complete threshold approval history in direct, checkpoint, and replay paths', async () => {
    const suffix = '00000032';
    const scenario = governedExecutionScenario({ suffix });
    const authority = configureThresholdApprovalAuthority(scenario.initial, suffix);
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
    assert.deepEqual(
      completed.operation.approvalIds,
      authority.approved.map(({ approvalId }) => approvalId).sort(),
    );
    assert.equal(completed.state.approvalRecords.length, 2);
    assert.ok(
      completed.state.approvalRecords.every(
        ({ consumedByOperationId }) => consumedByOperationId === scenario.draft.operationId,
      ),
    );

    const intentOffset = completed.events.findIndex(
      ({ type }) => type === 'operation.intent-recorded',
    );
    const preIntent = reduceOperatingRuntimeEventsV2(completed.events.slice(0, intentOffset), {
      initialState: scenario.initial,
    });
    const validDispatch = reduceOperatingRuntimeEventsV2([completed.events[intentOffset]], {
      initialState: preIntent,
    });
    assert.equal(validDispatch.governedOperations[0].operationId, scenario.draft.operationId);
    const rejectedGrantInitial = clone(scenario.initial);
    rejectedGrantInitial.approvalRecords.push(clone(authority.rejected));
    assert.throws(
      () =>
        reduceOperatingRuntimeEventsV2(completed.events.slice(0, intentOffset), {
          initialState: rejectedGrantInitial,
        }),
      { code: 'CAPABILITY_GRANT_INVALID' },
    );
    const rejectedDirect = clone(preIntent);
    rejectedDirect.approvalRecords.push(clone(authority.rejected));
    assert.throws(
      () =>
        reduceOperatingRuntimeEventsV2([completed.events[intentOffset]], {
          initialState: rejectedDirect,
        }),
      { code: 'APPROVAL_REQUIRED' },
    );

    const rejectedCheckpoint = clone(completed.state);
    rejectedCheckpoint.approvalRecords.push(clone(authority.rejected));
    assert.equal(
      authority.rejected.recordHash,
      sha256Jcs(
        Object.fromEntries(
          Object.entries(authority.rejected).filter(([key]) => key !== 'recordHash'),
        ),
      ),
    );
    assert.throws(() => reduceOperatingRuntimeEventsV2([], { initialState: rejectedCheckpoint }), {
      code: 'OPERATION_CONFLICT',
    });

    let replayHostCalls = 0;
    let replayTargetCalls = 0;
    const replayStore = createGovernedExecutionCheckpointStore(completed.state);
    const replayRuntime = createOperatingGovernedExecutionRuntimeV2({
      initialState: completed.state,
      checkpointStore: replayStore,
    });
    const validReplay = await replayRuntime.execute(scenario.request, scenario.draft, {
      trustedHost: new Proxy(
        {},
        {
          get() {
            replayHostCalls += 1;
            throw new Error('replay-host');
          },
        },
      ),
      targetAdapter: new Proxy(
        {},
        {
          get() {
            replayTargetCalls += 1;
            throw new Error('replay-target');
          },
        },
      ),
    });
    assert.equal(validReplay.replayed, true);
    assert.equal(replayHostCalls, 0);
    assert.equal(replayTargetCalls, 0);
    const forged = await replayStore.compareAndSwap({
      expectedEventHead: completed.state.eventHead,
      nextState: rejectedCheckpoint,
      phase: 'qa-rejected-approval-history',
    });
    assert.equal(forged.committed, true);
    await assert.rejects(
      replayRuntime.execute(scenario.request, scenario.draft, {
        trustedHost: new Proxy(
          {},
          {
            get() {
              replayHostCalls += 1;
              throw new Error('replay-host');
            },
          },
        ),
        targetAdapter: new Proxy(
          {},
          {
            get() {
              replayTargetCalls += 1;
              throw new Error('replay-target');
            },
          },
        ),
      }),
      { code: 'OPERATION_CONFLICT' },
    );
    assert.equal(replayHostCalls, 0);
    assert.equal(replayTargetCalls, 0);
  });

registerTests &&
  test('exact capability availability rejects fully rehashed authority rewrites in checkpoint and direct intent paths', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000028' });
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
    const availabilityOffset = completed.events.findIndex(
      ({ type }) => type === 'capability.availability-recorded',
    );
    const intentOffset = completed.events.findIndex(
      ({ type }) => type === 'operation.intent-recorded',
    );
    const vectors = [
      [
        'unavailable status',
        (availability) => {
          availability.status = 'unavailable';
          availability.reasonCode = 'forged-unavailable';
        },
      ],
      [
        'provider selection',
        (availability) => {
          availability.provider.providerVersion = '1.0.1';
        },
      ],
      [
        'capability',
        (availability) => {
          availability.capability.id = 'synthetic-contained-write';
        },
      ],
      [
        'target',
        (availability) => {
          availability.target.id = 'other-target';
        },
      ],
      [
        'effect ceiling',
        (availability) => {
          availability.effectCeiling = 'machine-local-write';
        },
      ],
      [
        'check time',
        (availability) => {
          availability.checkedAt = '2026-08-10T11:59:59Z';
        },
      ],
      [
        'expiry bound',
        (availability) => {
          availability.expiresAt = '2100-01-01T00:00:00Z';
        },
      ],
    ];
    for (const [label, mutate] of vectors) {
      const forged = clone(completed.state);
      const events = completed.events.map(clone);
      const event = events[availabilityOffset];
      mutate(event.payload);
      refreshCapabilityAvailabilityIdentity(event.payload);
      event.entityId = event.payload.availabilityId;
      forged.capabilityAvailability = [clone(event.payload)];
      rehashCheckpointEventChain(forged, events);
      assert.throws(
        () => reduceOperatingRuntimeEventsV2([], { initialState: forged }),
        (error) => ['CAPABILITY_UNAVAILABLE', 'OPERATION_CONFLICT'].includes(error.code),
        label,
      );
    }

    const prefixEvents = completed.events.slice(0, intentOffset).map(clone);
    const forgedAvailability = prefixEvents[availabilityOffset].payload;
    forgedAvailability.status = 'unavailable';
    forgedAvailability.reasonCode = 'forged-unavailable';
    refreshCapabilityAvailabilityIdentity(forgedAvailability);
    prefixEvents[availabilityOffset].entityId = forgedAvailability.availabilityId;
    for (let index = 0; index < prefixEvents.length; index += 1) {
      if (index > 0) prefixEvents[index].previousEventHash = prefixEvents[index - 1].eventHash;
      prefixEvents[index].eventHash = computeOperatingRuntimeEventHashV2(prefixEvents[index]);
    }
    const forgedDirect = reduceOperatingRuntimeEventsV2(prefixEvents, {
      initialState: scenario.initial,
    });
    const forgedIntent = clone(completed.events[intentOffset]);
    forgedIntent.previousEventHash = prefixEvents.at(-1).eventHash;
    forgedIntent.eventHash = computeOperatingRuntimeEventHashV2(forgedIntent);
    assert.throws(
      () => reduceOperatingRuntimeEventsV2([forgedIntent], { initialState: forgedDirect }),
      (error) => ['CAPABILITY_UNAVAILABLE', 'OPERATION_CONFLICT'].includes(error.code),
    );
  });

registerTests &&
  test('assignment creation binds the exact non-genesis pre-transaction Event head', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000029' });
    const seedAvailability = createOpenReferenceCapabilityAvailabilityV2({
      action: scenario.action,
      runtimeVersion: '0.42.0',
      checkedAt: '2026-08-10T08:01:00Z',
      expiresAt: '2026-08-10T08:02:00Z',
    });
    const seedEvent = createOperatingRuntimeEventV2({
      eventId: 'evt_seed00000029',
      timestamp: seedAvailability.checkedAt,
      cycleId: scenario.action.sourceCycleId,
      type: 'capability.availability-recorded',
      entityId: seedAvailability.availabilityId,
      actor: { kind: 'engine', id: 'operate-runtime-v2' },
      correlationId: 'corr-seed00000029',
      payload: seedAvailability,
    });
    scenario.initial = reduceOperatingRuntimeEventsV2([seedEvent], {
      initialState: scenario.initial,
    });
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
    const created = completed.events.find(({ type }) => type === 'assignment.created');
    assert.equal(created.sequence, 2);
    assert.equal(created.causationId, seedEvent.eventId);
    assert.equal(created.previousEventHash, seedEvent.eventHash);

    const forged = clone(completed.state);
    const events = completed.events.map(clone);
    events[0].causationId = null;
    rehashCheckpointEventChain(forged, events);
    assert.throws(() => reduceOperatingRuntimeEventsV2([], { initialState: forged }), {
      code: 'OPERATION_CONFLICT',
    });
  });

registerTests &&
  test('direct reducer rejects every self-consistent target, baseline, effect, and timestamp forgery', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000009' });
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
    const dispatchState = checkpointStore.commits[0].state;
    const receipt = completed.state.operationReplayIndex[0].terminalReceipt;
    const vectors = [
      [
        'target before',
        (value) => {
          value.targetBeforeHash = `sha256:${'1'.repeat(64)}`;
          value.baselineHash = value.targetBeforeHash;
        },
      ],
      [
        'target after',
        (value) => {
          value.targetAfterHash = `sha256:${'2'.repeat(64)}`;
        },
      ],
      [
        'baseline artifact',
        (value) => {
          value.baselineArtifactId = 'art_forged00000009';
        },
      ],
      [
        'changed flag',
        (value) => {
          value.effectSummary.changed = !value.effectSummary.changed;
        },
      ],
      [
        'affected target',
        (value) => {
          value.effectSummary.affectedTargetIds = ['other-target'];
        },
      ],
      [
        'effect summary',
        (value) => {
          value.effectSummary.summary = 'Unproven effect text.';
        },
      ],
      [
        'causal completion',
        (value) => {
          value.completedAt = '2026-08-10T11:59:59Z';
        },
      ],
      [
        'uncertain postcondition',
        (value) => {
          value.status = 'uncertain';
          value.effectSummary.changed = false;
          value.effectSummary.summary =
            'Contained dispatch outcome is uncertain; reconciliation is required before retry.';
        },
      ],
    ];
    for (const [label, mutate] of vectors) {
      const forged = clone(completed.result);
      mutate(forged);
      assert.throws(
        () => reduceDirectResult(dispatchState, scenario, withResultHash(forged), receipt),
        {
          code: 'RESULT_CONTRACT_INVALID',
        },
        label,
      );
    }
  });

registerTests &&
  test('all terminal statuses enforce closed receipt, postcondition, effect, and affected-target semantics', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000013' });
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
    const dispatchState = checkpointStore.commits[0].state;
    const originalReceipt = completed.state.operationReplayIndex[0].terminalReceipt;
    for (const status of ['succeeded', 'partial', 'failed', 'blocked', 'uncertain']) {
      const result = clone(completed.result);
      let receipt = clone(originalReceipt);
      result.status = status;
      if (status === 'partial') {
        result.targetAfterHash = `sha256:${'9'.repeat(64)}`;
        result.effectSummary = {
          changed: true,
          summary: OPERATING_EXECUTION_EFFECT_SUMMARIES_V2.partial,
          affectedTargetIds: [scenario.action.targetBinding.id],
        };
        receipt.after.stateHash = result.targetAfterHash;
        receipt.changed = true;
      } else if (status !== 'succeeded') {
        receipt = null;
        result.resultId = scenario.draft.uncertainty.resultId;
        result.resultArtifactId = scenario.draft.uncertainty.resultArtifactId;
        result.outputArtifactIds = [scenario.draft.uncertainty.resultArtifactId];
        result.eventIds = [
          scenario.draft.eventIds.intentRecorded,
          scenario.draft.uncertainty.eventIds.submitted,
          scenario.draft.uncertainty.eventIds.artifactCreated,
          scenario.draft.uncertainty.eventIds.validated,
          scenario.draft.uncertainty.eventIds.resultRecorded,
        ];
        result.targetAfterHash = null;
        result.effectSummary = {
          changed: false,
          summary: OPERATING_EXECUTION_EFFECT_SUMMARIES_V2[status],
          affectedTargetIds: ['failed', 'blocked'].includes(status)
            ? []
            : [scenario.action.targetBinding.id],
        };
      }
      const valid = withResultHash(result);
      assert.doesNotThrow(
        () => reduceDirectResult(dispatchState, scenario, valid, receipt),
        status,
      );

      const forged = clone(valid);
      const forgedReceipt = clone(receipt);
      if (status === 'succeeded') {
        forged.targetAfterHash = `sha256:${'8'.repeat(64)}`;
        forgedReceipt.after.stateHash = forged.targetAfterHash;
      } else if (status === 'partial') {
        forged.targetAfterHash = scenario.request.payload.contentHash;
        forgedReceipt.after.stateHash = forged.targetAfterHash;
      } else {
        forged.targetAfterHash = `sha256:${'7'.repeat(64)}`;
      }
      assert.throws(
        () => reduceDirectResult(dispatchState, scenario, withResultHash(forged), forgedReceipt),
        { code: 'RESULT_CONTRACT_INVALID' },
        status,
      );
    }
  });

registerTests &&
  test('checkpoint loading rejects cloned Action ownership and missing or mismatched intent proof', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000014' });
    const targetAdapter = createDisposableLocalProjectTargetV2({
      target: scenario.action.targetBinding,
      initialValue: scenario.initialValue,
    });
    const checkpointStore = createGovernedExecutionCheckpointStore(scenario.initial);
    const runtime = createOperatingGovernedExecutionRuntimeV2({
      initialState: scenario.initial,
      checkpointStore,
    });
    await runtime.execute(scenario.request, scenario.draft, {
      trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
      targetAdapter,
    });
    const dispatchState = checkpointStore.commits[0].state;

    const duplicateOwner = clone(dispatchState);
    const secondOperation = clone(duplicateOwner.governedOperations[0]);
    secondOperation.operationId = 'op_cloned00000014';
    delete secondOperation.operationHash;
    secondOperation.operationHash = sha256Jcs(secondOperation);
    const secondReplay = clone(duplicateOwner.operationReplayIndex[0]);
    secondReplay.operationId = secondOperation.operationId;
    secondReplay.operationHash = secondOperation.operationHash;
    duplicateOwner.governedOperations.push(secondOperation);
    duplicateOwner.operationReplayIndex.push(secondReplay);
    assert.throws(() => reduceOperatingRuntimeEventsV2([], { initialState: duplicateOwner }), {
      code: 'OPERATION_CONFLICT',
    });

    const missingIntent = clone(dispatchState);
    const missingOperation = missingIntent.governedOperations[0];
    missingOperation.intentEventId = 'evt_missing00000014';
    delete missingOperation.operationHash;
    missingOperation.operationHash = sha256Jcs(missingOperation);
    missingIntent.operationReplayIndex[0].intentEventId = missingOperation.intentEventId;
    missingIntent.operationReplayIndex[0].operationHash = missingOperation.operationHash;
    assert.throws(() => reduceOperatingRuntimeEventsV2([], { initialState: missingIntent }), {
      code: 'OPERATION_CONFLICT',
    });

    const mismatchedIntent = clone(dispatchState);
    const intentEntry = mismatchedIntent.eventReplayIndex.find(
      ({ eventId }) => eventId === mismatchedIntent.governedOperations[0].intentEventId,
    );
    intentEntry.requestHash = `sha256:${'f'.repeat(64)}`;
    assert.throws(() => reduceOperatingRuntimeEventsV2([], { initialState: mismatchedIntent }), {
      code: 'OPERATION_CONFLICT',
    });
  });

registerTests &&
  test('terminal checkpoint rejects rehashed execute authority and runtime-owned projection matrices', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000025' });
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
    const authorityVectors = [
      [
        'cross target',
        (operation) => {
          operation.target = {
            kind: 'project-record',
            id: 'other-target',
            revision: 'rev-other01',
          };
        },
      ],
      [
        'undeclared input',
        (operation) => {
          operation.inputArtifactIds.push('art_undeclared00000025');
        },
      ],
      [
        'executor',
        (operation) => {
          operation.executor = {
            executorId: 'open-reference-containment-executor',
            executorVersion: '1.0.0',
          };
        },
      ],
      [
        'connector',
        (operation) => {
          operation.connector = { id: 'synthetic-no-network-connector', version: '1.0.0' };
        },
      ],
      [
        'rollback class',
        (operation) => {
          operation.rollbackClass = 'manual';
        },
      ],
      [
        'rollback plan',
        (operation) => {
          operation.rollbackPlanId = 'rbp_forged00000025';
        },
      ],
      [
        'parent operation',
        (operation) => {
          operation.parentOperationId = 'op_parent00000025';
        },
      ],
    ];
    for (const [label, mutate] of authorityVectors) {
      const forged = clone(completed.state);
      const operation = forged.governedOperations[0];
      const replay = forged.operationReplayIndex[0];
      const historical = {
        ...clone(operation),
        state: 'dispatching',
        resultId: null,
        updatedAt: operation.createdAt,
        operationHash: replay.operationHash,
      };
      mutate(historical);
      historical.requestFingerprint = deriveContainedExecutorRequestFingerprintFromBindingV2({
        operation: historical,
        payload: { artifactId: replay.payloadArtifactId, contentHash: replay.payloadHash },
        rollbackBaseline: {
          artifactId: replay.baselineArtifactId,
          contentHash: replay.baselineHash,
        },
      });
      delete historical.operationHash;
      historical.operationHash = sha256Jcs(historical);
      Object.assign(operation, clone(historical), {
        state: completed.operation.state,
        resultId: completed.operation.resultId,
        updatedAt: completed.operation.updatedAt,
      });
      delete operation.operationHash;
      operation.operationHash = sha256Jcs(operation);
      replay.requestFingerprint = historical.requestFingerprint;
      replay.operationHash = historical.operationHash;
      assert.throws(
        () => reduceOperatingRuntimeEventsV2([], { initialState: forged }),
        undefined,
        label,
      );
    }

    const projectionVectors = [
      [
        'assignment createdAt',
        (state) => {
          state.assignments[0].createdAt = '2026-08-10T11:59:59Z';
        },
      ],
      [
        'assignment availableAt',
        (state) => {
          state.assignments[0].availableAt = '2026-08-10T12:00:01Z';
        },
      ],
      [
        'assignment completedAt',
        (state) => {
          state.assignments[0].completedAt = '2026-08-10T12:01:01Z';
        },
      ],
      [
        'assignment attempts',
        (state) => {
          state.assignments[0].attemptPolicy.maxAttempts = 2;
        },
      ],
      [
        'assignment timeout',
        (state) => {
          state.assignments[0].attemptPolicy.timeoutMs = 30001;
        },
      ],
      [
        'accepted submission issuedAt',
        (state) => {
          state.submissions[0].issuedAt = '2026-08-10T12:00:01Z';
        },
      ],
      [
        'accepted submission resolvedAt',
        (state) => {
          state.submissions[0].resolvedAt = '2026-08-10T12:01:01Z';
        },
      ],
      [
        'unused reservation resolved',
        (state) => {
          const unused = state.submissions.find(
            ({ state: submissionState }) => submissionState === 'issued',
          );
          unused.resolvedAt = '2026-08-10T12:01:00Z';
        },
      ],
      [
        'artifact createdAt',
        (state) => {
          state.artifacts[0].createdAt = '2026-08-10T12:01:01Z';
        },
      ],
      [
        'artifact sensitivity',
        (state) => {
          state.artifacts[0].sensitivity = 'confidential';
        },
      ],
      [
        'artifact retention',
        (state) => {
          state.artifacts[0].retentionClass = 'temporary';
        },
      ],
    ];
    for (const [label, mutate] of projectionVectors) {
      const forged = clone(completed.state);
      mutate(forged);
      assert.throws(
        () => reduceOperatingRuntimeEventsV2([], { initialState: forged }),
        undefined,
        label,
      );
    }
  });

registerTests &&
  test('checkpoint terminal loading rejects a fully rehashed failed-result poststate forgery', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000015' });
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
    const forgedState = clone(completed.state);
    const result = forgedState.executionResults[0];
    result.status = 'failed';
    result.targetAfterHash = `sha256:${'6'.repeat(64)}`;
    result.effectSummary = {
      changed: false,
      summary: OPERATING_EXECUTION_EFFECT_SUMMARIES_V2.failed,
      affectedTargetIds: [],
    };
    delete result.resultHash;
    result.resultHash = sha256Jcs(result);
    const resultBytes = Buffer.from(canonicalizeJson(result), 'utf8');
    const resultHash = sha256Jcs(result);
    const artifact = forgedState.artifacts[0];
    artifact.rawHash = resultHash;
    artifact.canonicalHash = resultHash;
    artifact.sizeBytes = resultBytes.byteLength;
    const submission = forgedState.submissions[0];
    submission.rawHash = resultHash;
    submission.canonicalHash = resultHash;
    submission.sizeBytes = resultBytes.byteLength;
    submission.responseData.rawHash = resultHash;
    submission.responseData.sizeBytes = resultBytes.byteLength;
    const submissionReplay = forgedState.submissionReplayIndex[0];
    submissionReplay.rawHash = resultHash;
    submissionReplay.canonicalHash = resultHash;
    submissionReplay.sizeBytes = resultBytes.byteLength;
    submissionReplay.responseData.rawHash = resultHash;
    submissionReplay.responseData.sizeBytes = resultBytes.byteLength;
    const operation = forgedState.governedOperations[0];
    operation.state = 'failed';
    delete operation.operationHash;
    operation.operationHash = sha256Jcs(operation);
    forgedState.operationReplayIndex[0].terminalReceipt = null;

    const terminalEvents = completed.events
      .filter(({ type }) =>
        [
          'assignment.submitted',
          'artifact.created',
          'assignment.validated',
          'execution.result-recorded',
        ].includes(type),
      )
      .map(clone);
    const [submitted, artifactCreated, validated, recorded] = terminalEvents;
    submitted.payload.rawHash = resultHash;
    submitted.payload.canonicalHash = resultHash;
    submitted.payload.sizeBytes = resultBytes.byteLength;
    submitted.eventHash = computeOperatingRuntimeEventHashV2(submitted);
    artifactCreated.previousEventHash = submitted.eventHash;
    artifactCreated.payload = clone(artifact);
    artifactCreated.eventHash = computeOperatingRuntimeEventHashV2(artifactCreated);
    validated.previousEventHash = artifactCreated.eventHash;
    validated.eventHash = computeOperatingRuntimeEventHashV2(validated);
    recorded.previousEventHash = validated.eventHash;
    recorded.payload = { result: clone(result), receipt: null };
    recorded.eventHash = computeOperatingRuntimeEventHashV2(recorded);
    for (const event of terminalEvents) {
      const entry = forgedState.eventReplayIndex.find(({ eventId }) => eventId === event.eventId);
      entry.eventHash = event.eventHash;
      entry.payloadHash = sha256Jcs(event.payload);
      entry.previousEventHash = event.previousEventHash;
    }
    forgedState.eventHead.hash = recorded.eventHash;
    assert.throws(
      () => reduceOperatingRuntimeEventsV2([], { initialState: forgedState }),
      (error) => ['RESULT_CONTRACT_INVALID', 'OPERATION_CONFLICT'].includes(error.code),
    );
  });

registerTests &&
  test('terminal checkpoint and direct reduction reject a tampered historical intent operation hash', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000021' });
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
    const forgedTerminal = clone(completed.state);
    forgedTerminal.operationReplayIndex[0].operationHash = `sha256:${'e'.repeat(64)}`;
    assert.throws(() => reduceOperatingRuntimeEventsV2([], { initialState: forgedTerminal }), {
      code: 'OPERATION_CONFLICT',
    });

    const forgedDispatch = clone(checkpointStore.commits[0].state);
    forgedDispatch.operationReplayIndex[0].operationHash = `sha256:${'e'.repeat(64)}`;
    assert.throws(
      () =>
        reduceDirectResult(
          forgedDispatch,
          scenario,
          completed.result,
          completed.state.operationReplayIndex[0].terminalReceipt,
        ),
      { code: 'OPERATION_CONFLICT' },
    );
  });

registerTests &&
  test('terminal checkpoint rejects a rehashed operation timestamp divergent from its result and Event chain', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000022' });
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
    const forged = clone(completed.state);
    const operation = forged.governedOperations[0];
    operation.updatedAt = '2026-08-10T12:02:00Z';
    delete operation.operationHash;
    operation.operationHash = sha256Jcs(operation);
    assert.throws(() => reduceOperatingRuntimeEventsV2([], { initialState: forged }), {
      code: 'RESULT_CONTRACT_INVALID',
    });
  });

registerTests &&
  test('completion after grant expiry is valid only because the one-use grant was consumed at durable dispatch', async () => {
    const scenario = governedExecutionScenario({ suffix: '00000010' });
    scenario.draft.completedAt = '2026-08-10T12:10:00Z';
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
    assert.equal(completed.result.completedAt, scenario.draft.completedAt);
    assert.equal(completed.state.capabilityGrants[0].consumedAt, scenario.draft.preparedAt);
    assert.ok(
      Date.parse(completed.state.capabilityGrants[0].consumedAt) <
        Date.parse(completed.state.capabilityGrants[0].expiresAt),
    );
  });
