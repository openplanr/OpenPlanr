import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  OPERATE_GUARD_TABLE_V2,
  computeOperatingRuntimeEventHashV2,
  acceptOperatingAssignmentSubmissionV2,
  claimOperatingAssignmentV2,
  createOperatingArtifactByteStoreV2,
  createOperateFailureEnvelopeV2,
  createEmptyOperatingRuntimeStateV2,
  createNoModelReplayHookV2,
  createOperatingRuntimeEventV2,
  deriveOperateAllowedActionsV2,
  evaluateOperateGuardV2,
  promoteOperatingActionAuthorityV2,
  readOperatingArtifactV2,
  reduceOperatingRuntimeEventsV2,
  transitionOperatingAssignmentV2,
  verifyOperatingRuntimeEventChainV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { assertProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { deriveOperatingAssignmentReleaseIntentsV2 } from '../../lib/operate/scheduler-v2.mjs';
import {
  consumeOperatingApprovalRecordsV2,
  createOperatingApprovalRecordV2,
  createOperatingApprovalRequirementV2,
} from '../../lib/operate/approvals-v2.mjs';
import {
  createOperatingActionPolicyV2,
  evaluateOperatingActionPolicyV2,
} from '../../lib/operate/policy-v2.mjs';
import { derivePersistentOperatingActionRevisionHashV2 } from '../../lib/operate/persistent-work-v2.mjs';

const TIME = '2026-08-08T08:00:00.000Z';
const NEXT_TIME = '2026-08-08T08:01:00.000Z';
const RAW_HASH = `sha256:${'a'.repeat(64)}`;
const INPUT_HASH = `sha256:${'b'.repeat(64)}`;
const RETRY_HASH = `sha256:${'c'.repeat(64)}`;

function intelligenceSubmissionBase64(assignmentKind) {
  if (assignmentKind === 'context-capture') {
    return Buffer.from(
      JSON.stringify({
        kind: 'operating-context-capture',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        contextKind: 'cycle-evidence',
        scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
        focus: ['strategy'],
        trigger: { kind: 'manual' },
      }),
      'utf8',
    ).toString('base64');
  }
  const kindByAssignment = {
    advisor: 'operating-advisor-result',
    challenger: 'operating-challenger-review',
    chair: 'operating-decision-ledger',
  };
  return Buffer.from(
    JSON.stringify({
      kind: kindByAssignment[assignmentKind],
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
    }),
    'utf8',
  ).toString('base64');
}
const AUTHORIZATION = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/authorization-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

function expectedEventReplayEntry(event) {
  return {
    eventId: event.eventId,
    eventHash: event.eventHash,
    payloadHash: sha256Jcs(event.payload),
    sequence: event.sequence,
    cycleId: event.cycleId,
    type: event.type,
    entityId: event.entityId,
    timestamp: event.timestamp,
    actor: structuredClone(event.actor),
    causationId: event.causationId,
    correlationId: event.correlationId,
    previousEventHash: event.previousEventHash,
    ...(event.requestHash === undefined ? {} : { requestHash: event.requestHash }),
  };
}

test('Phase 6 governed tools are compiler-owned rows with no authority-free default', () => {
  assert.deepEqual(
    Object.keys(OPERATE_GUARD_TABLE_V2)
      .filter((operation) => operation.startsWith('operate.action.'))
      .sort(),
    ['operate.action.approve', 'operate.action.execute', 'operate.action.rollback'],
  );
  const context = {
    actor: { actorId: 'runtime-001', kind: 'engine' },
    capabilities: [{ id: 'operate-action-execute', version: '2.0.0' }],
  };
  assert.equal(
    evaluateOperateGuardV2('operate.action.execute', context).error.code,
    'ACTION_NOT_FOUND',
  );
  assert.deepEqual(deriveOperateAllowedActionsV2(context), []);
});

function cycle() {
  return {
    kind: 'operating-cycle',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    cycleId: 'cyc_00000001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    state: 'advising',
    inputBindingId: 'inb_00000001',
    contractVersions: { 'advisor-result': '1.0.0' },
    trigger: { kind: 'manual' },
    focus: ['strategy'],
    health: 'normal',
    activeReviewId: null,
    createdAt: TIME,
    updatedAt: TIME,
  };
}

function inputBinding() {
  return {
    kind: 'operating-cycle-input-binding',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    inputBindingId: 'inb_00000001',
    cycleId: 'cyc_00000001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    sourceArtifactIds: [],
    runtimeBinding: { runtime: 'codex', adapterVersion: '1.0.0' },
    capturedAt: TIME,
  };
}

function assignment(state = 'pending') {
  return {
    kind: 'operating-assignment',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    assignmentId: 'asg_00000001',
    cycleId: 'cyc_00000001',
    assignmentKind: 'context-capture',
    roleId: 'context-evidence',
    objective: 'Review the exact bound evidence.',
    state,
    dependsOn: [],
    dependencyPolicy: { kind: 'none' },
    inputArtifactIds: [],
    inputAbsences: [],
    intelligenceContext: null,
    mandate: null,
    analysisRubric: null,
    outputContract: {
      schemaId: 'operating-context-capture',
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 65536,
    },
    capabilityGrantId: 'grant-001',
    governedOperationId: null,
    attemptPolicy: { maxAttempts: 3, attempt: 0, timeoutMs: 300000 },
    claim: null,
    terminalOutcome: null,
    createdAt: TIME,
    availableAt: state === 'available' ? TIME : null,
    completedAt: null,
  };
}

function submissionRecord(overrides = {}) {
  return {
    kind: 'operating-submission',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    submissionId: 'sub_00000001',
    assignmentId: 'asg_00000001',
    cycleId: 'cyc_00000001',
    state: 'issued',
    rawHash: null,
    canonicalHash: null,
    sizeBytes: null,
    artifactId: null,
    acceptanceEventIds: [],
    responseData: null,
    issuedAt: TIME,
    resolvedAt: null,
    ...overrides,
  };
}

function baseState() {
  return {
    ...createEmptyOperatingRuntimeStateV2(TIME),
    cycles: [cycle()],
    inputBindings: [inputBinding()],
  };
}

function rehashWithout(record, field) {
  const next = structuredClone(record);
  delete next[field];
  next[field] = sha256Jcs(next);
  return next;
}

test('Phase 5 intelligence plans are an explicit empty, rebuildable runtime projection', () => {
  const state = createEmptyOperatingRuntimeStateV2(TIME);
  assert.deepEqual(state.intelligencePlans, []);
  assert.doesNotThrow(() =>
    assertProtocolArtifact('operating-runtime-state', state, {
      protocolVersion: '2.0.0',
    }),
  );
});

test('Action authority promotion is one exact replayable engine Event with no caller revision identity', () => {
  const governed = structuredClone(AUTHORIZATION.action);
  const before = structuredClone(governed);
  for (const field of [
    'revisionId',
    'revision',
    'predecessorRevisionId',
    'actionHash',
    'actionKind',
    'requestedCapability',
    'targetBinding',
    'effectClass',
    'preconditionArtifactIds',
    'executionBinding',
  ])
    delete before[field];
  before.state = 'proposed';
  before.updatedAt = before.createdAt;
  const authority = {
    actionKind: governed.actionKind,
    requestedCapability: governed.requestedCapability,
    targetBinding: governed.targetBinding,
    effectClass: governed.effectClass,
    preconditionArtifactIds: governed.preconditionArtifactIds,
    executionBinding: governed.executionBinding,
    updatedAt: '2026-08-10T08:02:00.000Z',
  };
  const initial = {
    ...createEmptyOperatingRuntimeStateV2(before.createdAt),
    cycles: [
      {
        ...cycle(),
        cycleId: before.sourceCycleId,
        scopeId: before.scopeId,
        domainId: before.domainId,
        domainVersion: before.domainVersion,
        createdAt: before.createdAt,
        updatedAt: before.createdAt,
      },
    ],
    actions: [before],
  };
  const request = { action: before, authority };
  const draft = {
    eventId: 'evt-authority-promoted-001',
    timestamp: authority.updatedAt,
    correlationId: 'corr-authority-promoted-001',
  };
  const promoted = promoteOperatingActionAuthorityV2(request, draft, { initialState: initial });
  assert.equal(promoted.replayed, false);
  assert.equal(promoted.events.length, 1);
  assert.equal(promoted.events[0].type, 'action.authority-promoted');
  assert.equal(promoted.events[0].actor.kind, 'engine');
  assert.equal(promoted.action.state, 'proposed');
  assert.equal(
    promoted.action.actionHash,
    derivePersistentOperatingActionRevisionHashV2(promoted.action),
  );
  assert.doesNotThrow(() =>
    assertProtocolArtifact('operating-event', promoted.events[0], {
      protocolVersion: '2.0.0',
    }),
  );
  assert.deepEqual(
    reduceOperatingRuntimeEventsV2(promoted.events, { initialState: initial }),
    promoted.state,
  );

  const replayed = promoteOperatingActionAuthorityV2(request, draft, {
    initialState: promoted.state,
  });
  assert.equal(replayed.replayed, true);
  assert.deepEqual(replayed.events, []);
  assert.equal(replayed.action.actionHash, promoted.action.actionHash);

  const divergent = structuredClone(request);
  divergent.authority.targetBinding.id = 'foreign-target';
  assert.throws(
    () => promoteOperatingActionAuthorityV2(divergent, draft, { initialState: promoted.state }),
    ({ code }) => code === 'CONCURRENT_MODIFICATION',
  );
  const forged = structuredClone(promoted.events[0]);
  forged.payload.action.targetBinding.id = 'foreign-target';
  forged.eventHash = computeOperatingRuntimeEventHashV2(forged);
  assert.throws(
    () => reduceOperatingRuntimeEventsV2([forged], { initialState: initial }),
    ({ code }) => code === 'ACTION_REVISION_MISMATCH',
  );
});

test('versioned policy and exact approval history survive replay into one canonical Action disposition', () => {
  const action = structuredClone(AUTHORIZATION.action);
  action.state = 'proposed';
  action.actionHash = derivePersistentOperatingActionRevisionHashV2(action);
  action.revisionId = `actrev_${sha256Jcs({
    actionId: action.actionId,
    revision: action.revision,
    actionHash: action.actionHash,
  }).slice('sha256:'.length)}`;
  const policy = createOperatingActionPolicyV2({
    policyId: action.executionBinding.policyId,
    policyVersion: action.executionBinding.policyVersion,
    domainId: action.domainId,
    actionKind: action.actionKind,
    capability: action.requestedCapability,
    effectClasses: [action.effectClass],
    targetKinds: [action.targetBinding.kind],
    decisionMode: 'named-single-party',
    approvalRequirementIds: ['aprq_runtime01'],
    rollbackRequired: true,
    verificationRequired: true,
    tier: 'domain',
    provenance: {
      providerId: 'bounded-policy-provider',
      providerVersion: '1.0.0',
      sourceHash: `sha256:${'d'.repeat(64)}`,
    },
  });
  const corePolicy = createOperatingActionPolicyV2({
    policyId: 'core-runtime-policy',
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
  const evaluation = evaluateOperatingActionPolicyV2({
    action,
    configuredPolicies: [corePolicy, policy],
    evaluatedAt: '2026-08-10T08:00:00Z',
  });
  const party = {
    partyId: 'owner-party',
    actorKind: 'human',
    actorId: 'owner-0001',
    requiredCapability: { id: 'action-approve', version: '1.0.0' },
  };
  const requirement = createOperatingApprovalRequirementV2({
    policyRequirementId: 'aprq_runtime01',
    evaluation,
    action,
    parties: [party],
    expiresAt: '2026-08-11T08:00:00Z',
    consumable: true,
  });
  const approval = createOperatingApprovalRecordV2({
    approvalId: 'aprv_runtime001',
    requirement,
    evaluation,
    action,
    partyId: party.partyId,
    actor: { kind: party.actorKind, actorId: party.actorId, capability: party.requiredCapability },
    decision: 'approved',
    issuedAt: '2026-08-10T08:01:00Z',
    expiresAt: '2026-08-11T08:00:00Z',
  });
  let state = {
    ...createEmptyOperatingRuntimeStateV2('2026-08-10T08:00:00Z', {
      actionPolicies: [corePolicy, policy],
      approvalRequirements: [requirement],
    }),
    cycles: [
      {
        ...cycle(),
        domainId: action.domainId,
        domainVersion: action.domainVersion,
        scopeId: action.scopeId,
        updatedAt: '2026-08-10T08:00:00Z',
      },
    ],
    actions: [action],
  };
  const forgedCheckpoint = structuredClone(state);
  forgedCheckpoint.approvalRequirements[0].parties[0].actorId = null;
  forgedCheckpoint.approvalRequirements[0] = rehashWithout(
    forgedCheckpoint.approvalRequirements[0],
    'scopeHash',
  );
  assert.doesNotThrow(() =>
    assertProtocolArtifact('operating-runtime-state', forgedCheckpoint, {
      protocolVersion: '2.0.0',
    }),
  );
  assert.throws(
    () => reduceOperatingRuntimeEventsV2([], { initialState: forgedCheckpoint }),
    ({ code }) => code === 'APPROVAL_INVALID',
  );
  const nextEvent = ({ eventId, timestamp, type, entityId, actor, requestHash, payload }) =>
    createOperatingRuntimeEventV2(
      {
        eventId,
        timestamp,
        cycleId: action.sourceCycleId,
        type,
        entityId,
        actor,
        causationId: null,
        correlationId: 'corr-governance-001',
        requestHash,
        payload,
      },
      {
        previousEvent:
          state.eventHead.sequence === 0
            ? null
            : {
                sequence: state.eventHead.sequence,
                eventHash: state.eventHead.hash,
              },
      },
    );
  const policyEvent = nextEvent({
    eventId: 'evt-policy-001',
    timestamp: evaluation.evaluatedAt,
    type: 'policy.evaluated',
    entityId: evaluation.evaluationId,
    actor: { kind: 'runtime', id: 'openplanr' },
    requestHash: evaluation.inputHash,
    payload: evaluation,
  });
  state = reduceOperatingRuntimeEventsV2([policyEvent], { initialState: state });
  const outsiderApproval = structuredClone(approval);
  outsiderApproval.actor.actorId = 'outsider-0001';
  const signedOutsiderApproval = rehashWithout(outsiderApproval, 'recordHash');
  assert.doesNotThrow(() =>
    assertProtocolArtifact('operating-approval-record', signedOutsiderApproval, {
      protocolVersion: '2.0.0',
    }),
  );
  const outsiderEvent = nextEvent({
    eventId: 'evt-approval-outsider-001',
    timestamp: signedOutsiderApproval.issuedAt,
    type: 'approval.recorded',
    entityId: signedOutsiderApproval.approvalId,
    actor: { kind: 'human', id: 'outsider-0001' },
    payload: signedOutsiderApproval,
  });
  assert.throws(
    () => reduceOperatingRuntimeEventsV2([outsiderEvent], { initialState: state }),
    ({ code }) => code === 'APPROVAL_INVALID',
  );
  const approvalEvent = nextEvent({
    eventId: 'evt-approval-001',
    timestamp: approval.issuedAt,
    type: 'approval.recorded',
    entityId: approval.approvalId,
    actor: { kind: 'human', id: 'owner-0001' },
    payload: approval,
  });
  state = reduceOperatingRuntimeEventsV2([approvalEvent], { initialState: state });
  const approvedEvent = nextEvent({
    eventId: 'evt-action-approved-001',
    timestamp: '2026-08-10T08:02:00Z',
    type: 'action.approved',
    entityId: action.actionId,
    actor: { kind: 'engine', id: 'openplanr' },
    payload: {
      action: {
        actionId: action.actionId,
        revision: action.revision,
        actionHash: action.actionHash,
      },
      from: 'proposed',
      to: 'approved',
      operationId: null,
      resultId: null,
      reasonCode: null,
    },
  });
  const approved = reduceOperatingRuntimeEventsV2([approvedEvent], { initialState: state });
  assert.equal(approved.actions[0].state, 'approved');
  assert.deepEqual(approved.policyEvaluations, [evaluation]);
  assert.deepEqual(approved.approvalRecords, [approval]);
  assert.equal(approved.eventReplayIndex.length, 3);
  assert.equal(
    reduceOperatingRuntimeEventsV2([approvedEvent], { initialState: state }).actions[0].state,
    'approved',
  );

  const nextEvaluation = evaluateOperatingActionPolicyV2({
    action,
    configuredPolicies: [corePolicy, policy],
    evaluatedAt: '2026-08-10T08:03:00Z',
  });
  const reevaluationEvent = createOperatingRuntimeEventV2(
    {
      eventId: 'evt-policy-reevaluated-001',
      timestamp: nextEvaluation.evaluatedAt,
      cycleId: action.sourceCycleId,
      type: 'policy.evaluated',
      entityId: nextEvaluation.evaluationId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId: approvedEvent.eventId,
      correlationId: 'corr-governance-001',
      requestHash: nextEvaluation.inputHash,
      payload: nextEvaluation,
    },
    {
      previousEvent: { sequence: approved.eventHead.sequence, eventHash: approved.eventHead.hash },
    },
  );
  const consumedAuthority = consumeOperatingApprovalRecordsV2({
    approvals: approved.approvalRecords,
    requirements: approved.approvalRequirements,
    approvalIds: [approval.approvalId],
    operationId: 'op_history001',
  });
  const consumedCheckpoint = {
    ...approved,
    approvalRecords: structuredClone(consumedAuthority.records),
  };
  const reevaluated = reduceOperatingRuntimeEventsV2([reevaluationEvent], {
    initialState: consumedCheckpoint,
  });
  assert.deepEqual(
    reevaluated.policyEvaluations,
    [evaluation, nextEvaluation].sort((left, right) =>
      left.evaluationId.localeCompare(right.evaluationId),
    ),
  );
  assert.equal(reevaluated.approvalRequirements.length, 2);
  assert.equal(reevaluated.approvalRecords.length, 1);
  assert.equal(reevaluated.approvalRecords[0].consumedByOperationId, 'op_history001');
  assert.notEqual(
    reevaluated.approvalRequirements[0].requirementId,
    reevaluated.approvalRequirements[1].requirementId,
  );
});

function append(events, type, entityId, payload, timestamp = TIME) {
  const previousEvent = events.at(-1) ?? null;
  events.push(
    createOperatingRuntimeEventV2(
      {
        eventId: `evt-${String(events.length + 1).padStart(3, '0')}`,
        timestamp,
        cycleId: 'cyc_00000001',
        type,
        entityId,
        actor: { kind: 'engine', id: 'openplanr' },
        causationId: previousEvent?.eventId ?? null,
        correlationId: 'corr-001',
        payload,
      },
      { previousEvent },
    ),
  );
}

function eventAfterState(state, type, entityId, payload, eventId = 'evt-tail-001') {
  return createOperatingRuntimeEventV2(
    {
      eventId,
      timestamp: NEXT_TIME,
      cycleId: 'cyc_00000001',
      type,
      entityId,
      actor: { kind: 'engine', id: 'openplanr' },
      causationId: null,
      correlationId: 'corr-tail-001',
      payload,
    },
    {
      previousEvent: {
        sequence: state.eventHead.sequence,
        eventHash: state.eventHead.hash,
      },
    },
  );
}

function releasePayload(
  {
    assignments,
    submissions = [],
    artifacts = [],
    submissionReplayIndex = [],
    intelligencePlans = [],
  },
  assignmentId,
) {
  const intent = deriveOperatingAssignmentReleaseIntentsV2({
    assignments,
    submissions,
    artifacts,
    submissionReplayIndex,
    intelligencePlans,
  }).find((candidate) => candidate.assignmentId === assignmentId);
  assert.ok(intent, `missing scheduler release intent for ${assignmentId}`);
  return {
    assignmentId: intent.assignmentId,
    releaseId: intent.releaseId,
    dependencyProofs: structuredClone(intent.dependencyProofs),
    dependencyEventIds: structuredClone(intent.dependencyEventIds),
  };
}

function happyPathEvents() {
  const events = [];
  append(events, 'cycle.input-bound', 'inb_00000001', {
    inputBindingId: 'inb_00000001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    contractVersions: { 'advisor-result': '1.0.0' },
  });
  append(events, 'assignment.created', 'asg_00000001', assignment());
  append(
    events,
    'assignment.available',
    'asg_00000001',
    releasePayload({ assignments: [assignment()] }, 'asg_00000001'),
  );
  append(events, 'assignment.claimed', 'asg_00000001', {
    assignmentId: 'asg_00000001',
    actorId: 'agent-001',
    actorKind: 'agent',
    runtime: 'codex',
    claimId: 'claim-001',
    submissionId: 'sub_00000001',
  });
  append(events, 'assignment.started', 'asg_00000001', {
    assignmentId: 'asg_00000001',
    attempt: 1,
  });
  append(
    events,
    'assignment.submitted',
    'asg_00000001',
    {
      assignmentId: 'asg_00000001',
      submissionId: 'sub_00000001',
      rawHash: RAW_HASH,
      canonicalHash: null,
      sizeBytes: 21,
      mediaType: 'application/json',
      encoding: 'utf-8',
    },
    NEXT_TIME,
  );
  append(
    events,
    'artifact.created',
    'art_00000001',
    {
      kind: 'operating-artifact',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      artifactId: 'art_00000001',
      artifactType: 'cycle-evidence',
      assignmentId: 'asg_00000001',
      cycleId: 'cyc_00000001',
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      schemaId: 'operating-context-capture',
      artifactSchemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      rawHash: RAW_HASH,
      canonicalHash: null,
      sizeBytes: 21,
      storageClass: 'machine-local',
      sensitivity: 'internal',
      retentionClass: 'project',
      producer: { actorId: 'agent-001', roleId: 'context-evidence', runtime: 'codex' },
      inputArtifactIds: [],
      createdAt: NEXT_TIME,
    },
    NEXT_TIME,
  );
  append(
    events,
    'assignment.validated',
    'asg_00000001',
    {
      assignmentId: 'asg_00000001',
      submissionId: 'sub_00000001',
      artifactId: 'art_00000001',
      validatorVersion: '1.0.0',
    },
    NEXT_TIME,
  );
  return events;
}

function fullActor() {
  return { actorId: 'agent-001', kind: 'agent', runtime: 'codex' };
}

test('claim returns the complete runtime-issued Assignment and Artifact reads stay actor-, scope-, and custody-bound', () => {
  const available = { ...assignment('available'), inputArtifactIds: ['art_00000001'] };
  const initialState = { ...baseState(), cycles: [cycle()], assignments: [available] };
  const request = { assignmentId: available.assignmentId, actor: fullActor() };
  const draft = {
    claimId: 'claim-authority-001',
    submissionId: 'sub_authority_001',
    eventIds: { claimed: 'evt-authority-claimed-001', started: 'evt-authority-started-001' },
    timestamp: TIME,
    correlationId: 'corr-authority-001',
  };
  const claimed = claimOperatingAssignmentV2(request, draft, {
    initialState,
    capabilities: ['operate.assignment.claim'],
  });
  assert.equal(claimed.replayed, false);
  assert.equal(claimed.response.assignment.state, 'running');
  assert.deepEqual(claimed.response.assignment.outputContract, available.outputContract);
  assert.equal(claimed.response.assignment.analysisRubric, null);
  assert.equal(claimed.response.assignment.mandate, null);
  assert.deepEqual(claimed.response.assignment.inputArtifactIds, available.inputArtifactIds);
  assert.deepEqual(claimed.response.assignment.inputAbsences, available.inputAbsences);
  assert.equal(claimed.response.submissionId, draft.submissionId);
  assert.deepEqual(claimed.response.capabilities, ['artifact.submit']);
  assert.equal(JSON.stringify(claimed.response).includes('privatePath'), false);

  const replay = claimOperatingAssignmentV2(request, draft, { initialState: claimed.state });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.events, []);
  assert.deepEqual(replay.response, claimed.response);
  assert.throws(
    () =>
      claimOperatingAssignmentV2(
        {
          ...request,
          actor: { actorId: 'agent-foreign', kind: 'agent', runtime: 'codex' },
        },
        draft,
        { initialState: claimed.state },
      ),
    { code: 'ASSIGNMENT_ALREADY_CLAIMED' },
  );

  const artifact = {
    kind: 'operating-artifact',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    artifactId: 'art_00000001',
    artifactType: 'advisor-result',
    assignmentId: available.assignmentId,
    cycleId: available.cycleId,
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    schemaId: 'advisor-result',
    artifactSchemaVersion: '1.0.0',
    mediaType: 'application/json',
    encoding: 'utf-8',
    rawHash: RAW_HASH,
    canonicalHash: null,
    sizeBytes: 21,
    storageClass: 'machine-local',
    sensitivity: 'internal',
    retentionClass: 'project',
    producer: { actorId: 'agent-001', roleId: available.roleId, runtime: 'codex' },
    inputArtifactIds: [],
    createdAt: TIME,
  };
  const scope = {
    scopeId: artifact.scopeId,
    domainId: artifact.domainId,
    domainVersion: artifact.domainVersion,
  };
  const agentRead = {
    artifactId: artifact.artifactId,
    representation: 'metadata',
    actor: fullActor(),
    scope,
    assignmentId: available.assignmentId,
  };
  const readContext = {
    capabilities: ['operate.artifact.get'],
    actor: fullActor(),
    artifact,
    assignment: claimed.response.assignment,
    artifactRequest: agentRead,
  };
  assert.equal(evaluateOperateGuardV2('operate.artifact.get', readContext).allowed, true);
  assert.equal(
    evaluateOperateGuardV2('operate.artifact.get', {
      ...readContext,
      actor: { actorId: 'agent-foreign', kind: 'agent', runtime: 'codex' },
    }).error.code,
    'CAPABILITY_DENIED',
  );
  assert.equal(
    evaluateOperateGuardV2('operate.artifact.get', {
      ...readContext,
      artifactRequest: { ...agentRead, assignmentId: 'asg_foreign_001' },
    }).error.code,
    'ASSIGNMENT_NOT_AVAILABLE',
  );
  assert.equal(
    evaluateOperateGuardV2('operate.artifact.get', {
      ...readContext,
      artifact: { ...artifact, forgedField: true },
    }).error.code,
    'CAPABILITY_DENIED',
  );
  assert.equal(
    evaluateOperateGuardV2('operate.artifact.get', {
      ...readContext,
      assignment: { ...claimed.response.assignment, forgedField: true },
    }).error.code,
    'CAPABILITY_DENIED',
  );

  const human = { actorId: 'owner-001', kind: 'human', runtime: 'web' };
  const humanRequest = { ...agentRead, actor: human, assignmentId: null };
  const humanContext = {
    capabilities: ['operate.artifact.get'],
    actor: human,
    artifact,
    artifactRequest: humanRequest,
    scopeMembership: { active: true, actorId: human.actorId, ...scope },
  };
  assert.equal(evaluateOperateGuardV2('operate.artifact.get', humanContext).allowed, true);
  assert.equal(
    evaluateOperateGuardV2('operate.artifact.get', {
      ...humanContext,
      scopeMembership: { ...humanContext.scopeMembership, active: false },
    }).error.code,
    'CAPABILITY_DENIED',
  );
});

test('decoded-json reads are exact UTF-8, canonical-hash, scope, actor, and Assignment-custody bound', () => {
  const inputArtifactId = 'art_decoded_json_001';
  const available = { ...assignment('available'), inputArtifactIds: [inputArtifactId] };
  const claimed = claimOperatingAssignmentV2(
    { assignmentId: available.assignmentId, actor: fullActor() },
    {
      claimId: 'claim-decoded-json-001',
      submissionId: 'sub_decoded_json_001',
      eventIds: {
        claimed: 'evt-decoded-json-claimed-001',
        started: 'evt-decoded-json-started-001',
      },
      timestamp: TIME,
      correlationId: 'corr-decoded-json-001',
    },
    {
      initialState: { ...baseState(), assignments: [available] },
      capabilities: ['operate.assignment.claim'],
    },
  );
  const content = { nested: { value: 7 }, list: ['exact', 'json'] };
  const rawBytes = Buffer.from(` {"nested":{"value":7},"list":["exact","json"]}\n`, 'utf8');
  const artifact = {
    kind: 'operating-artifact',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    artifactId: inputArtifactId,
    artifactType: 'cycle-evidence',
    assignmentId: available.assignmentId,
    cycleId: available.cycleId,
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    schemaId: 'operating-context-capture',
    artifactSchemaVersion: '2.0.0',
    mediaType: 'application/json',
    encoding: 'utf-8',
    rawHash: `sha256:${createHash('sha256').update(rawBytes).digest('hex')}`,
    canonicalHash: sha256Jcs(content),
    sizeBytes: rawBytes.byteLength,
    storageClass: 'machine-local',
    sensitivity: 'internal',
    retentionClass: 'project',
    producer: { actorId: 'context-capture-agent', roleId: 'context-evidence', runtime: 'codex' },
    inputArtifactIds: [],
    createdAt: TIME,
  };
  const state = { ...claimed.state, artifacts: [artifact] };
  const store = createOperatingArtifactByteStoreV2();
  store.stageRaw({ artifact, rawBytes });
  const request = {
    artifactId: artifact.artifactId,
    representation: 'decoded-json',
    actor: fullActor(),
    assignmentId: available.assignmentId,
    scope: {
      scopeId: artifact.scopeId,
      domainId: artifact.domainId,
      domainVersion: artifact.domainVersion,
    },
  };
  const decoded = readOperatingArtifactV2(request, {
    initialState: state,
    artifactStore: store,
    capabilities: ['operate.artifact.get'],
  });
  assert.deepEqual(decoded.data, {
    metadata: artifact,
    representation: 'decoded-json',
    contentJson: content,
  });
  assert.equal(Object.hasOwn(decoded.data, 'contentBase64'), false);

  let deniedReads = 0;
  assert.throws(
    () =>
      readOperatingArtifactV2(
        {
          ...request,
          actor: { actorId: 'agent-foreign', kind: 'agent', runtime: 'codex' },
        },
        {
          initialState: state,
          capabilities: ['operate.artifact.get'],
          artifactStore: {
            readRaw: () => {
              deniedReads += 1;
              return rawBytes;
            },
          },
        },
      ),
    { code: 'CAPABILITY_DENIED' },
  );
  assert.equal(deniedReads, 0, 'authorization refuses before private byte access');

  const refusesBytes = (bytes, patch, expectedCode) => {
    const hostileArtifact = {
      ...artifact,
      artifactId: `art_decoded_hostile_${bytes.toString('hex').slice(0, 12) || 'empty'}_${expectedCode.toLowerCase()}`,
      rawHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      sizeBytes: bytes.byteLength,
      ...patch,
    };
    const hostileState = {
      ...claimed.state,
      assignments: claimed.state.assignments.map((candidate) =>
        candidate.assignmentId === available.assignmentId
          ? { ...candidate, inputArtifactIds: [hostileArtifact.artifactId] }
          : candidate,
      ),
      artifacts: [hostileArtifact],
    };
    const hostileStore = createOperatingArtifactByteStoreV2();
    hostileStore.stageRaw({ artifact: hostileArtifact, rawBytes: bytes });
    assert.throws(
      () =>
        readOperatingArtifactV2(
          {
            ...request,
            artifactId: hostileArtifact.artifactId,
          },
          {
            initialState: hostileState,
            artifactStore: hostileStore,
            capabilities: ['operate.artifact.get'],
          },
        ),
      { code: expectedCode },
    );
  };
  refusesBytes(Buffer.from([0xff, 0xfe, 0xfd]), {}, 'RESULT_CONTRACT_INVALID');
  refusesBytes(Buffer.from('{"broken":', 'utf8'), {}, 'RESULT_CONTRACT_INVALID');
  refusesBytes(
    Buffer.from('{"nested":{"value":8},"list":["exact","json"]}', 'utf8'),
    {},
    'ARTIFACT_HASH_MISMATCH',
  );
  refusesBytes(
    Buffer.from('not json', 'utf8'),
    { mediaType: 'text/plain', encoding: 'binary', canonicalHash: null },
    'RESULT_CONTRACT_INVALID',
  );
});

test('pre-intelligence context capture claims and submits one exact runtime-owned DTO', () => {
  const contextAssignment = {
    kind: 'operating-assignment',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    assignmentId: 'asg_context_001',
    cycleId: 'cyc_00000001',
    assignmentKind: 'context-capture',
    roleId: 'context-evidence',
    objective: 'Capture the exact Cycle evidence request.',
    state: 'available',
    dependsOn: [],
    dependencyPolicy: { kind: 'none' },
    inputArtifactIds: [],
    inputAbsences: [],
    intelligenceContext: null,
    outputContract: {
      schemaId: 'operating-context-capture',
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262144,
    },
    capabilityGrantId: 'grant-context-001',
    governedOperationId: null,
    attemptPolicy: { maxAttempts: 3, attempt: 0, timeoutMs: 300000 },
    claim: null,
    terminalOutcome: null,
    createdAt: TIME,
    availableAt: TIME,
    completedAt: null,
    mandate: null,
    analysisRubric: null,
  };
  const claimed = claimOperatingAssignmentV2(
    {
      assignmentId: contextAssignment.assignmentId,
      actor: fullActor(),
    },
    {
      claimId: 'claim-context-001',
      submissionId: 'sub_context_001',
      eventIds: { claimed: 'evt-context-claimed-001', started: 'evt-context-started-001' },
      timestamp: TIME,
      correlationId: 'corr-context-001',
    },
    {
      initialState: { ...baseState(), assignments: [contextAssignment] },
      capabilities: ['operate.assignment.claim'],
    },
  );
  assert.equal(claimed.response.assignment.assignmentKind, 'context-capture');
  assert.deepEqual(claimed.response.capabilities, ['artifact.submit']);

  const capture = {
    kind: 'operating-context-capture',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    contextKind: 'cycle-evidence',
    scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
    focus: ['strategy'],
    trigger: { kind: 'manual' },
  };
  const request = {
    assignmentId: contextAssignment.assignmentId,
    submissionId: claimed.response.submissionId,
    actor: fullActor(),
    mediaType: 'application/json',
    encoding: 'utf-8',
    contentBase64: Buffer.from(JSON.stringify(capture), 'utf8').toString('base64'),
  };
  const acceptance = {
    artifactId: 'art_context_001',
    artifactType: 'cycle-evidence',
    inputArtifactIds: [],
    timestamp: NEXT_TIME,
    validatorVersion: '1.0.0',
    correlationId: 'corr-context-001',
    eventIds: {
      submitted: 'evt-context-submitted-001',
      artifactCreated: 'evt-context-artifact-001',
      validated: 'evt-context-validated-001',
    },
  };
  const staged = [];
  assert.throws(
    () =>
      acceptOperatingAssignmentSubmissionV2(
        {
          ...request,
          contentBase64: Buffer.from(
            JSON.stringify({ ...capture, invented: true }),
            'utf8',
          ).toString('base64'),
        },
        acceptance,
        {
          initialState: claimed.state,
          artifactStore: { stageRaw: (entry) => staged.push(entry) },
        },
      ),
    { code: 'RESULT_CONTRACT_INVALID' },
  );
  assert.deepEqual(staged, [], 'an invalid capture stages no bytes and emits no Events');

  const accepted = acceptOperatingAssignmentSubmissionV2(request, acceptance, {
    initialState: claimed.state,
  });
  assert.equal(accepted.response.accepted, true);
  assert.equal(accepted.artifact.schemaId, 'operating-context-capture');
  assert.equal(accepted.artifact.artifactType, 'cycle-evidence');
  assert.equal(accepted.artifact.producer.roleId, 'context-evidence');
});

test('OP-05/06 and INV-GUIDE-001..005: one guard table owns refusals and complete allowed actions', () => {
  const running = {
    ...assignment('running'),
    claim: { actorId: 'agent-001', actorKind: 'agent', runtime: 'codex', claimId: 'claim-001' },
    attemptPolicy: { maxAttempts: 3, attempt: 1, timeoutMs: 300000 },
  };
  const context = {
    capabilities: ['operate.cycle.get', 'operate.cycle.resume', 'operate.assignment.submit'],
    cycle: cycle(),
    assignment: running,
    submission: submissionRecord(),
    actor: fullActor(),
  };
  assert.equal(evaluateOperateGuardV2('operate.assignment.submit', context).allowed, false);
  assert.equal(
    deriveOperateAllowedActionsV2(context).some(({ tool }) => tool === 'operate.assignment.submit'),
    false,
    'a submit action is omitted until its complete content body is known',
  );

  context.submitRequest = {
    assignmentId: running.assignmentId,
    submissionId: 'sub_00000001',
    mediaType: 'application/json',
    encoding: 'utf-8',
    contentBase64: intelligenceSubmissionBase64('context-capture'),
    actor: fullActor(),
  };
  const tools = deriveOperateAllowedActionsV2(context).map(({ tool }) => tool);
  assert.deepEqual(tools, [
    'operate.assignment.submit',
    'operate.cycle.get',
    'operate.cycle.resume',
  ]);
  for (const tool of tools) assert.equal(evaluateOperateGuardV2(tool, context).allowed, true);

  const submitViolations = [
    {
      label: 'alternate valid submission ID',
      request: { ...context.submitRequest, submissionId: 'sub_00000002' },
      code: 'SUBMISSION_ID_CONFLICT',
    },
    {
      label: 'alternate valid assignment ID',
      request: { ...context.submitRequest, assignmentId: 'asg_00000002' },
      code: 'SUBMISSION_ID_CONFLICT',
    },
    {
      label: 'media contract mismatch',
      request: { ...context.submitRequest, mediaType: 'text/plain' },
      code: 'RESULT_CONTRACT_INVALID',
    },
    {
      label: 'encoding contract mismatch',
      request: { ...context.submitRequest, encoding: 'binary' },
      code: 'RESULT_CONTRACT_INVALID',
    },
    {
      label: 'malformed base64',
      request: { ...context.submitRequest, contentBase64: 'not base64' },
      code: 'RESULT_CONTRACT_INVALID',
    },
    {
      label: 'empty intelligence JSON body',
      request: { ...context.submitRequest, contentBase64: 'e30=' },
      code: 'RESULT_CONTRACT_INVALID',
    },
    {
      label: 'oversized decoded body',
      request: { ...context.submitRequest, contentBase64: Buffer.alloc(65537).toString('base64') },
      code: 'RESULT_CONTRACT_INVALID',
    },
  ];
  for (const { label, request, code } of submitViolations) {
    const invalidContext = { ...context, submitRequest: request };
    assert.equal(
      evaluateOperateGuardV2('operate.assignment.submit', invalidContext).error.code,
      code,
      label,
    );
    assert.equal(
      deriveOperateAllowedActionsV2(invalidContext).some(
        ({ tool }) => tool === 'operate.assignment.submit',
      ),
      false,
      label,
    );
  }
  const resolvedContext = {
    ...context,
    submission: submissionRecord({
      state: 'rejected',
      rawHash: RAW_HASH,
      canonicalHash: null,
      sizeBytes: 2,
      acceptanceEventIds: ['evt-rejected'],
      responseData: { accepted: false },
      resolvedAt: NEXT_TIME,
    }),
  };
  assert.equal(
    evaluateOperateGuardV2('operate.assignment.submit', resolvedContext).error.code,
    'ASSIGNMENT_ALREADY_SUBMITTED',
  );

  const available = assignment('available');
  const claimContext = {
    capabilities: ['operate.assignment.claim'],
    assignment: available,
    actor: fullActor(),
  };
  assert.deepEqual(
    deriveOperateAllowedActionsV2(claimContext).map(({ tool }) => tool),
    ['operate.assignment.claim'],
  );
  assert.equal(
    evaluateOperateGuardV2('operate.assignment.claim', { ...claimContext, capabilities: [] }).error
      .code,
    'CAPABILITY_DENIED',
  );
  const failure = createOperateFailureEnvelopeV2('operate.assignment.claim', {
    ...claimContext,
    capabilities: ['operate.cycle.get'],
    cycle: cycle(),
  });
  assert.equal(failure.error.code, 'CAPABILITY_DENIED');
  assert.deepEqual(
    failure.allowedActions.map(({ tool }) => tool),
    ['operate.cycle.get'],
  );

  const placeholderContext = {
    capabilities: ['operate.cycle.start'],
    startRequest: {
      scope: { scopeId: '<scope-id>', domainId: 'business', domainVersion: '1.0.0' },
      focus: [],
      trigger: { kind: 'manual' },
      mode: 'standard',
      ownerActorId: 'owner-placeholder-001',
      deliveryRoute: 'observe-only',
    },
  };
  assert.deepEqual(deriveOperateAllowedActionsV2(placeholderContext), []);
});

test('INV-OBS-001: strict provenance and base-plus-tail reduction are deterministic and no-model', () => {
  const events = happyPathEvents();
  const base = baseState();
  const replayHook = createNoModelReplayHookV2();
  const first = reduceOperatingRuntimeEventsV2(events, { initialState: base, replayHook });
  const second = reduceOperatingRuntimeEventsV2(structuredClone(events), {
    initialState: structuredClone(base),
  });
  assert.equal(replayHook.dispatchCount, 0);
  assert.equal(sha256Jcs(first), sha256Jcs(second));
  assert.equal(first.assignments[0].state, 'validated');
  assert.equal(first.submissions[0].state, 'accepted');
  assert.equal(first.submissionReplayIndex[0].artifactId, 'art_00000001');
  assert.deepEqual(first.submissionReplayIndex[0].acceptanceEventIds, [
    'evt-006',
    'evt-007',
    'evt-008',
  ]);
});

test('OP-01/07, AC-09, and INV-ART-001..006: direct submission stages exact bytes and commits one replayable acceptance', () => {
  const beforeAcceptance = reduceOperatingRuntimeEventsV2(happyPathEvents().slice(0, 5), {
    initialState: baseState(),
  });
  const beforeHash = sha256Jcs(beforeAcceptance);
  const rawBytes = Buffer.from(
    '{\n  "kind": "operating-context-capture",\n  "schemaVersion": "1.0.0",\n  "protocolVersion": "2.0.0",\n  "contextKind": "cycle-evidence",\n  "scope": {"scopeId":"scope-acme","domainId":"business","domainVersion":"1.0.0"},\n  "focus": ["café Δ"],\n  "trigger": {"kind":"manual"}\n}\n',
    'utf8',
  );
  const request = {
    assignmentId: 'asg_00000001',
    submissionId: 'sub_00000001',
    mediaType: 'application/json',
    encoding: 'utf-8',
    contentBase64: rawBytes.toString('base64'),
    actor: fullActor(),
  };
  const draft = {
    artifactId: 'art_00000001',
    artifactType: 'cycle-evidence',
    inputArtifactIds: [],
    timestamp: NEXT_TIME,
    validatorVersion: '1.0.0',
    correlationId: 'corr-submit-001',
    eventIds: { submitted: 'evt-006', artifactCreated: 'evt-007', validated: 'evt-008' },
  };
  const replayHook = createNoModelReplayHookV2();
  const foreignStages = [];
  assert.throws(
    () =>
      acceptOperatingAssignmentSubmissionV2(
        {
          ...request,
          actor: { actorId: 'agent-foreign', kind: 'agent', runtime: 'codex' },
        },
        draft,
        {
          initialState: beforeAcceptance,
          artifactStore: { stageRaw: (entry) => foreignStages.push(entry) },
        },
      ),
    { code: 'CAPABILITY_DENIED' },
    'a foreign claimant fails before staging bytes or emitting Events',
  );
  assert.deepEqual(foreignStages, []);
  assert.equal(sha256Jcs(beforeAcceptance), beforeHash);
  const first = acceptOperatingAssignmentSubmissionV2(request, draft, {
    initialState: beforeAcceptance,
    replayHook,
  });
  assert.equal(
    sha256Jcs(beforeAcceptance),
    beforeHash,
    'the pure transaction never mutates its input projection',
  );
  assert.equal(replayHook.dispatchCount, 0, 'acceptance/replay never dispatches a model');
  assert.equal(first.replayed, false);
  assert.deepEqual(
    first.stagedRawBytes,
    rawBytes,
    'Unicode and whitespace bytes are retained exactly for durable staging',
  );
  assert.equal(
    first.events.length,
    3,
    'submission, Artifact, and validation are one ordered transaction',
  );
  assert.equal(first.state.assignments[0].state, 'validated');
  assert.equal(first.state.submissions[0].state, 'accepted');
  assert.equal(first.response.accepted, true);
  assert.equal(first.artifact.rawHash, first.state.submissions[0].rawHash);
  assert.equal(first.artifact.canonicalHash, first.state.submissions[0].canonicalHash);
  assert.deepEqual(
    first.artifact.producer,
    {
      actorId: beforeAcceptance.assignments[0].claim.actorId,
      roleId: beforeAcceptance.assignments[0].roleId,
      runtime: beforeAcceptance.assignments[0].claim.runtime,
    },
    'live acceptance derives producer identity only from the retained Assignment claim and role',
  );
  assert.notEqual(
    first.artifact.rawHash,
    first.artifact.canonicalHash,
    'semantic canonical form never replaces exact-byte identity',
  );

  const exactReplayContext = {
    capabilities: ['operate.assignment.submit'],
    assignment: first.state.assignments[0],
    submission: first.state.submissions[0],
    artifact: first.state.artifacts[0],
    submissionReplay: first.state.submissionReplayIndex[0],
    actor: fullActor(),
    submitRequest: request,
  };
  assert.equal(
    evaluateOperateGuardV2('operate.assignment.submit', exactReplayContext).allowed,
    true,
    'public authorization permits the exact retained accepted replay',
  );
  const sameCanonicalDifferentBytes = Buffer.from(
    '{"kind":"operating-context-capture","schemaVersion":"1.0.0","protocolVersion":"2.0.0","contextKind":"cycle-evidence","scope":{"scopeId":"scope-acme","domainId":"business","domainVersion":"1.0.0"},"focus":["café Δ"],"trigger":{"kind":"manual"}}',
    'utf8',
  );
  for (const [label, mutate] of [
    [
      'actor',
      (context) => {
        context.actor.actorId = 'agent-foreign';
        context.submitRequest.actor.actorId = 'agent-foreign';
      },
    ],
    [
      'submission',
      (context) => {
        context.submitRequest.submissionId = 'sub_foreign_0001';
      },
    ],
    [
      'body',
      (context) => {
        context.submitRequest.contentBase64 = sameCanonicalDifferentBytes.toString('base64');
      },
    ],
    [
      'media type',
      (context) => {
        context.submitRequest.mediaType = 'text/plain';
      },
    ],
    [
      'encoding',
      (context) => {
        context.submitRequest.encoding = 'binary';
      },
    ],
    [
      'custody',
      (context) => {
        context.artifact.inputArtifactIds = ['art_foreign_input'];
      },
    ],
  ]) {
    const hostile = structuredClone(exactReplayContext);
    mutate(hostile);
    assert.equal(
      evaluateOperateGuardV2('operate.assignment.submit', hostile).allowed,
      false,
      `public authorization refuses replay ${label} substitution`,
    );
  }

  const replay = acceptOperatingAssignmentSubmissionV2(
    request,
    {
      ...draft,
      artifactId: 'art_unused_0001',
      eventIds: {
        submitted: 'evt-unused-001',
        artifactCreated: 'evt-unused-002',
        validated: 'evt-unused-003',
      },
    },
    { initialState: first.state },
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(
    replay.response,
    first.response,
    'same runtime-issued submission ID and bytes returns the original acknowledgement',
  );
  assert.deepEqual(replay.events, [], 'same-byte retry appends no duplicate effects');
  for (const [label, requestPatch] of [
    ['media type', { mediaType: 'text/plain' }],
    ['encoding', { encoding: 'binary' }],
  ]) {
    assert.throws(
      () =>
        acceptOperatingAssignmentSubmissionV2({ ...request, ...requestPatch }, draft, {
          initialState: first.state,
        }),
      { code: 'RESULT_CONTRACT_INVALID' },
      `same-byte retry cannot substitute ${label}`,
    );
  }

  for (const [label, initialState, hostileDraft] of [
    [
      'live byte ceiling',
      (() => {
        const state = structuredClone(beforeAcceptance);
        state.assignments[0].outputContract.maxBytes = rawBytes.byteLength - 1;
        return state;
      })(),
      draft,
    ],
    [
      'live undeclared input',
      beforeAcceptance,
      { ...draft, inputArtifactIds: ['art_foreign_input'] },
    ],
    [
      'live missing issued input',
      (() => {
        const state = structuredClone(beforeAcceptance);
        state.assignments[0].inputArtifactIds = ['art_issued_input_0001', 'art_issued_input_0002'];
        return state;
      })(),
      { ...draft, inputArtifactIds: ['art_issued_input_0001'] },
    ],
    [
      'live reordered issued inputs',
      (() => {
        const state = structuredClone(beforeAcceptance);
        state.assignments[0].inputArtifactIds = ['art_issued_input_0001', 'art_issued_input_0002'];
        return state;
      })(),
      { ...draft, inputArtifactIds: ['art_issued_input_0002', 'art_issued_input_0001'] },
    ],
  ]) {
    const initialHash = sha256Jcs(initialState);
    const staged = [];
    assert.throws(
      () =>
        acceptOperatingAssignmentSubmissionV2(request, hostileDraft, {
          initialState,
          artifactStore: { stageRaw: (entry) => staged.push(entry) },
        }),
      (error) => error.code === 'RESULT_CONTRACT_INVALID',
      label,
    );
    assert.deepEqual(staged, [], `${label} fails before raw-byte staging`);
    assert.equal(sha256Jcs(initialState), initialHash, `${label} fails before state mutation`);
  }

  assert.throws(
    () =>
      acceptOperatingAssignmentSubmissionV2(
        request,
        { ...draft, inputArtifactIds: ['art_foreign_input'] },
        {
          initialState: first.state,
        },
      ),
    (error) => error.code === 'STATE_TRANSITION_INVALID',
    'an exact-byte retry cannot substitute a different Artifact input set',
  );

  for (const [label, mutate] of [
    [
      'checkpoint byte ceiling',
      (state) => {
        const sizeBytes = state.assignments[0].outputContract.maxBytes + 1;
        state.artifacts[0].sizeBytes = sizeBytes;
        state.submissions[0].sizeBytes = sizeBytes;
        state.submissions[0].responseData.sizeBytes = sizeBytes;
        state.submissionReplayIndex[0].sizeBytes = sizeBytes;
        state.submissionReplayIndex[0].responseData.sizeBytes = sizeBytes;
      },
    ],
    [
      'checkpoint undeclared input',
      (state) => {
        state.artifacts[0].inputArtifactIds = ['art_foreign_input'];
      },
    ],
    [
      'checkpoint domain version',
      (state) => {
        state.artifacts[0].domainVersion = '9.9.9';
      },
    ],
    [
      'checkpoint producer actor',
      (state) => {
        state.artifacts[0].producer.actorId = 'agent-foreign';
      },
    ],
    [
      'checkpoint producer runtime',
      (state) => {
        state.artifacts[0].producer.runtime = 'runtime-foreign';
      },
    ],
  ]) {
    const hostile = structuredClone(first.state);
    mutate(hostile);
    const hostileHash = sha256Jcs(hostile);
    assert.throws(
      () => reduceOperatingRuntimeEventsV2([], { initialState: hostile }),
      (error) => error.code === 'STATE_TRANSITION_INVALID',
      `${label} is rejected during hostile restart`,
    );
    assert.throws(
      () => acceptOperatingAssignmentSubmissionV2(request, draft, { initialState: hostile }),
      (error) => error.code === 'STATE_TRANSITION_INVALID',
      `${label} is rejected during exact retry replay`,
    );
    assert.equal(sha256Jcs(hostile), hostileHash, `${label} cannot mutate the hostile checkpoint`);
  }

  const acceptedHash = sha256Jcs(first.state);
  assert.throws(
    () =>
      acceptOperatingAssignmentSubmissionV2(
        { ...request, contentBase64: sameCanonicalDifferentBytes.toString('base64') },
        draft,
        {
          initialState: first.state,
        },
      ),
    (error) => error.code === 'SUBMISSION_ID_CONFLICT' && error.details.retryable === false,
    'formatting-equivalent JSON is still different exact submitted bytes',
  );
  assert.equal(
    sha256Jcs(first.state),
    acceptedHash,
    'different-byte retry cannot mutate accepted state',
  );

  const invalidJson = Buffer.from('{', 'utf8');
  assert.throws(
    () =>
      acceptOperatingAssignmentSubmissionV2(
        { ...request, contentBase64: invalidJson.toString('base64') },
        draft,
        {
          initialState: beforeAcceptance,
        },
      ),
    (error) => error.code === 'RESULT_CONTRACT_INVALID',
  );
  assert.equal(
    sha256Jcs(beforeAcceptance),
    beforeHash,
    'validation failure exposes no partial Artifact or projection',
  );

  const tampered = structuredClone(first.events);
  tampered[1].payload.canonicalHash = tampered[1].payload.rawHash;
  tampered[1].eventHash = computeOperatingRuntimeEventHashV2(tampered[1]);
  tampered[2].previousEventHash = tampered[1].eventHash;
  tampered[2].eventHash = computeOperatingRuntimeEventHashV2(tampered[2]);
  assert.throws(
    () => reduceOperatingRuntimeEventsV2(tampered, { initialState: beforeAcceptance }),
    (error) => error.code === 'RESULT_CONTRACT_INVALID',
    'tampering cannot substitute a raw hash for a canonical hash',
  );
  const scopeTampered = structuredClone(first.events);
  scopeTampered[1].payload.domainVersion = '9.9.9';
  scopeTampered[1].eventHash = computeOperatingRuntimeEventHashV2(scopeTampered[1]);
  scopeTampered[2].previousEventHash = scopeTampered[1].eventHash;
  scopeTampered[2].eventHash = computeOperatingRuntimeEventHashV2(scopeTampered[2]);
  assert.throws(
    () => reduceOperatingRuntimeEventsV2(scopeTampered, { initialState: beforeAcceptance }),
    (error) => error.code === 'RESULT_CONTRACT_INVALID',
    'live Artifact reduction binds the exact Cycle domain version',
  );
});

test('OP-01: binary direct submission remains byte-safe and has no canonical-hash substitute', () => {
  const beforeAcceptance = reduceOperatingRuntimeEventsV2(happyPathEvents().slice(0, 5), {
    initialState: baseState(),
  });
  beforeAcceptance.assignments[0].assignmentKind = 'execution';
  beforeAcceptance.assignments[0].roleId = 'binary-executor';
  beforeAcceptance.assignments[0].capabilityGrantId = 'cgr_00000001';
  beforeAcceptance.assignments[0].governedOperationId = 'op_00000001';
  beforeAcceptance.assignments[0].intelligenceContext = null;
  beforeAcceptance.assignments[0].outputContract = {
    ...beforeAcceptance.assignments[0].outputContract,
    mediaType: 'application/octet-stream',
    encoding: 'binary',
    maxBytes: 64,
  };
  const rawBytes = Buffer.from([0x00, 0xff, 0x20, 0x0a, 0x80, 0x41]);
  const result = acceptOperatingAssignmentSubmissionV2(
    {
      assignmentId: 'asg_00000001',
      submissionId: 'sub_00000001',
      mediaType: 'application/octet-stream',
      encoding: 'binary',
      contentBase64: rawBytes.toString('base64'),
      actor: fullActor(),
    },
    {
      artifactId: 'art_00000002',
      artifactType: 'advisor-result',
      inputArtifactIds: [],
      timestamp: NEXT_TIME,
      validatorVersion: '1.0.0',
      correlationId: 'corr-binary-001',
      eventIds: { submitted: 'evt-006', artifactCreated: 'evt-007', validated: 'evt-008' },
    },
    { initialState: beforeAcceptance },
  );
  assert.deepEqual(result.stagedRawBytes, rawBytes);
  assert.equal(result.artifact.canonicalHash, null);
  assert.equal(result.state.submissions[0].canonicalHash, null);
});

test('O2-P1-001 / OP-07 / INV-OBS-001..003: Event identity survives checkpoint recovery and restart', () => {
  const events = happyPathEvents();
  const checkpointState = reduceOperatingRuntimeEventsV2(events.slice(0, 2), {
    initialState: baseState(),
  });
  const checkpoint = {
    kind: 'operating-checkpoint',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    createdAt: NEXT_TIME,
    eventHead: { ...checkpointState.eventHead, protocolVersions: ['2.0.0'] },
    runtimeStateHash: sha256Jcs(checkpointState),
    eventReplayIndexHash: sha256Jcs(checkpointState.eventReplayIndex),
    recordDigests: [],
    blobHashes: [],
    recoveryVersion: '1.0.0',
  };
  assert.doesNotThrow(() =>
    assertProtocolArtifact('operating-checkpoint', checkpoint, { protocolVersion: '2.0.0' }),
  );
  assert.deepEqual(
    checkpointState.eventReplayIndex,
    events.slice(0, 2).map(expectedEventReplayEntry),
  );

  const replayed = reduceOperatingRuntimeEventsV2([structuredClone(events[0])], {
    initialState: structuredClone(checkpointState),
  });
  assert.equal(
    sha256Jcs(replayed),
    sha256Jcs(checkpointState),
    'same Event content replays without an append',
  );

  const recoveredWithRetryAndTail = reduceOperatingRuntimeEventsV2(
    [structuredClone(events[0]), ...structuredClone(events.slice(2))],
    { initialState: structuredClone(checkpointState) },
  );
  const recoveredWithTailOnly = reduceOperatingRuntimeEventsV2(events.slice(2), {
    initialState: structuredClone(checkpointState),
  });
  assert.equal(
    sha256Jcs(recoveredWithRetryAndTail),
    sha256Jcs(recoveredWithTailOnly),
    'a retry preceding a valid checkpoint tail produces no duplicate Event',
  );

  const restartedState = JSON.parse(JSON.stringify(checkpointState));
  const before = sha256Jcs(restartedState);
  const conflictingReuse = eventAfterState(
    restartedState,
    'assignment.available',
    'asg_00000001',
    releasePayload({ assignments: [assignment()] }, 'asg_00000001'),
    'evt-001',
  );
  assert.throws(
    () => reduceOperatingRuntimeEventsV2([conflictingReuse], { initialState: restartedState }),
    (error) =>
      error.code === 'STATE_TRANSITION_INVALID' &&
      error.details.retryable === false &&
      error.details.context.eventId === 'evt-001',
  );
  assert.equal(
    sha256Jcs(restartedState),
    before,
    'a divergent retry fails before checkpoint state mutation',
  );
});

test('O2-P1-002: assignment availability is evented exactly once with dependency proof and replay provenance', () => {
  const zeroDependencyEvents = [];
  append(zeroDependencyEvents, 'cycle.input-bound', 'inb_00000001', {
    inputBindingId: 'inb_00000001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    contractVersions: { 'advisor-result': '1.0.0' },
  });
  append(zeroDependencyEvents, 'assignment.created', 'asg_00000001', assignment());
  const pending = reduceOperatingRuntimeEventsV2(zeroDependencyEvents, {
    initialState: baseState(),
  });
  const release = eventAfterState(
    pending,
    'assignment.available',
    'asg_00000001',
    releasePayload(pending, 'asg_00000001'),
    'evt-zero-release-001',
  );
  const zeroDependencyAvailable = reduceOperatingRuntimeEventsV2([release], {
    initialState: pending,
  });
  assert.equal(zeroDependencyAvailable.assignments[0].state, 'available');
  assert.deepEqual(
    zeroDependencyAvailable.eventReplayIndex.at(-1),
    expectedEventReplayEntry(release),
    'the zero-dependency release has durable Event provenance',
  );
  assert.equal(
    sha256Jcs(
      reduceOperatingRuntimeEventsV2([structuredClone(release)], {
        initialState: structuredClone(zeroDependencyAvailable),
      }),
    ),
    sha256Jcs(zeroDependencyAvailable),
    'a replayed availability Event appends no duplicate transition',
  );
  const beforeDuplicate = sha256Jcs(zeroDependencyAvailable);
  const duplicate = eventAfterState(
    zeroDependencyAvailable,
    'assignment.available',
    'asg_00000001',
    releasePayload({ assignments: [assignment()] }, 'asg_00000001'),
    'evt-zero-release-002',
  );
  assert.throws(
    () => reduceOperatingRuntimeEventsV2([duplicate], { initialState: zeroDependencyAvailable }),
    (error) => error.code === 'STATE_TRANSITION_INVALID',
  );
  assert.equal(
    sha256Jcs(zeroDependencyAvailable),
    beforeDuplicate,
    'a second availability Event cannot mutate the checkpoint',
  );

  const checkpointBase = reduceOperatingRuntimeEventsV2(happyPathEvents(), {
    initialState: baseState(),
  });
  const dependent = {
    ...assignment(),
    assignmentId: 'asg_00000002',
    roleId: 'context-dependent',
    assignmentKind: 'context-capture',
    dependsOn: ['asg_00000001'],
    dependencyPolicy: { kind: 'all-required' },
  };
  checkpointBase.assignments.push(dependent);
  const validPayload = releasePayload(checkpointBase, dependent.assignmentId);
  const valid = eventAfterState(
    checkpointBase,
    'assignment.available',
    dependent.assignmentId,
    validPayload,
  );
  const available = reduceOperatingRuntimeEventsV2([valid], { initialState: checkpointBase });
  assert.equal(
    available.assignments.find(({ assignmentId }) => assignmentId === dependent.assignmentId).state,
    'available',
  );

  for (const [label, payload] of [
    ['missing dependency proof', { ...validPayload, dependencyProofs: [] }],
    [
      'extra dependency proof',
      {
        ...validPayload,
        dependencyProofs: [
          ...validPayload.dependencyProofs,
          {
            ...validPayload.dependencyProofs[0],
            assignmentId: 'asg_00000003',
            eventId: 'evt-extra-001',
            artifactId: 'art_00000003',
          },
        ],
      },
    ],
    ['missing validation event', { ...validPayload, dependencyEventIds: [] }],
    [
      'nonexistent validation event',
      { ...validPayload, dependencyEventIds: ['evt-does-not-exist'] },
    ],
  ]) {
    const initial = structuredClone(checkpointBase);
    const before = sha256Jcs(initial);
    const invalid = eventAfterState(
      initial,
      'assignment.available',
      dependent.assignmentId,
      payload,
    );
    assert.throws(
      () => reduceOperatingRuntimeEventsV2([invalid], { initialState: initial }),
      (error) => error.code === 'STATE_TRANSITION_INVALID',
      label,
    );
    assert.equal(sha256Jcs(initial), before, label);
  }

  for (const [label, mutate] of [
    [
      'foreign Artifact Assignment binding',
      (state) => {
        state.artifacts[0].assignmentId = 'asg_foreign_0001';
      },
    ],
    [
      'foreign Artifact Cycle binding',
      (state) => {
        state.artifacts[0].cycleId = 'cyc_foreign_0001';
      },
    ],
    [
      'Artifact raw-hash mismatch',
      (state) => {
        state.artifacts[0].rawHash = `sha256:${'d'.repeat(64)}`;
      },
    ],
    [
      'Artifact canonical-hash mismatch',
      (state) => {
        state.artifacts[0].canonicalHash = `sha256:${'e'.repeat(64)}`;
      },
    ],
    [
      'Artifact byte ceiling mismatch',
      (state) => {
        const sizeBytes = state.assignments[0].outputContract.maxBytes + 1;
        state.artifacts[0].sizeBytes = sizeBytes;
        state.submissions[0].sizeBytes = sizeBytes;
        state.submissions[0].responseData.sizeBytes = sizeBytes;
        state.submissionReplayIndex[0].sizeBytes = sizeBytes;
        state.submissionReplayIndex[0].responseData.sizeBytes = sizeBytes;
      },
    ],
    [
      'Artifact undeclared input',
      (state) => {
        state.artifacts[0].inputArtifactIds = ['art_foreign_input'];
      },
    ],
    [
      'Artifact producer actor mismatch',
      (state) => {
        state.artifacts[0].producer.actorId = 'agent-foreign';
      },
    ],
    [
      'Artifact producer runtime mismatch',
      (state) => {
        state.artifacts[0].producer.runtime = 'runtime-foreign';
      },
    ],
    [
      'Artifact producer role mismatch',
      (state) => {
        state.artifacts[0].producer.roleId = 'role-foreign';
      },
    ],
    [
      'submission replay mismatch',
      (state) => {
        state.submissionReplayIndex[0].artifactId = 'art_foreign_replay';
      },
    ],
  ]) {
    const hostile = structuredClone(checkpointBase);
    mutate(hostile);
    const before = sha256Jcs(hostile);
    const invalid = eventAfterState(
      hostile,
      'assignment.available',
      dependent.assignmentId,
      validPayload,
      `evt-hostile-${label.replaceAll(' ', '-').toLowerCase()}`,
    );
    assert.throws(
      () => reduceOperatingRuntimeEventsV2([invalid], { initialState: hostile }),
      (error) => error.code === 'STATE_TRANSITION_INVALID',
      label,
    );
    assert.equal(sha256Jcs(hostile), before, label);
  }

  const unknownBase = structuredClone(checkpointBase);
  const unknown = unknownBase.assignments.find(
    ({ assignmentId }) => assignmentId === dependent.assignmentId,
  );
  unknown.dependsOn = ['asg_00000003'];
  const unknownEvent = eventAfterState(
    unknownBase,
    'assignment.available',
    dependent.assignmentId,
    validPayload,
  );
  assert.throws(
    () => reduceOperatingRuntimeEventsV2([unknownEvent], { initialState: unknownBase }),
    (error) => error.code === 'STATE_TRANSITION_INVALID',
  );

  const crossCycleBase = structuredClone(checkpointBase);
  crossCycleBase.assignments.find(({ assignmentId }) => assignmentId === 'asg_00000001').cycleId =
    'cyc_00000002';
  const crossCycle = eventAfterState(
    crossCycleBase,
    'assignment.available',
    dependent.assignmentId,
    validPayload,
  );
  assert.throws(
    () => reduceOperatingRuntimeEventsV2([crossCycle], { initialState: crossCycleBase }),
    (error) => error.code === 'STATE_TRANSITION_INVALID',
  );

  for (const [label, createdAssignment] of [
    [
      'zero-dependency pre-available creation bypass',
      {
        ...assignment('available'),
        availableAt: NEXT_TIME,
      },
    ],
    [
      'pre-available creation bypass',
      {
        ...dependent,
        state: 'available',
        availableAt: NEXT_TIME,
      },
    ],
  ]) {
    const bypassEvents = happyPathEvents();
    assert.throws(
      () =>
        append(
          bypassEvents,
          'assignment.created',
          createdAssignment.assignmentId,
          createdAssignment,
          NEXT_TIME,
        ),
      (error) => error.code === 'E_PROTOCOL_ARTIFACT_INVALID',
      label,
    );
  }

  for (const [label, createdAssignment] of [
    [
      'creation attempt-counter bypass',
      {
        ...assignment(),
        assignmentId: 'asg_00000003',
        attemptPolicy: { ...assignment().attemptPolicy, attempt: 1 },
      },
    ],
    [
      'dependency policy bypass',
      {
        ...dependent,
        dependencyPolicy: { kind: 'none' },
      },
    ],
  ]) {
    const bypassEvents = happyPathEvents();
    append(
      bypassEvents,
      'assignment.created',
      createdAssignment.assignmentId,
      createdAssignment,
      NEXT_TIME,
    );
    assert.throws(
      () => reduceOperatingRuntimeEventsV2(bypassEvents, { initialState: baseState() }),
      (error) => error.code === 'STATE_TRANSITION_INVALID',
      label,
    );
  }

  const fullTail = happyPathEvents();
  append(fullTail, 'assignment.created', dependent.assignmentId, dependent, NEXT_TIME);
  append(fullTail, 'assignment.available', dependent.assignmentId, validPayload, NEXT_TIME);
  const rebuilt = reduceOperatingRuntimeEventsV2(fullTail, { initialState: baseState() });
  assert.equal(
    rebuilt.assignments.find(({ assignmentId }) => assignmentId === dependent.assignmentId).state,
    'available',
    'a validation event processed in the same tail is accepted as dependency proof',
  );
});

function appendSubmittedAttempt(events, attempt, rawHash) {
  append(
    events,
    'assignment.submitted',
    'asg_00000001',
    {
      assignmentId: 'asg_00000001',
      submissionId: 'sub_00000001',
      rawHash,
      canonicalHash: null,
      sizeBytes: 21,
      mediaType: 'application/json',
      encoding: 'utf-8',
    },
    NEXT_TIME,
  );
  append(
    events,
    'assignment.rejected',
    'asg_00000001',
    {
      assignmentId: 'asg_00000001',
      submissionId: 'sub_00000001',
      violations: [
        { path: '$.result', code: 'invalid', message: 'The result contract is invalid.' },
      ],
      attempt,
      attemptsRemaining: 3 - attempt,
    },
    NEXT_TIME,
  );
}

function firstRejectedAttemptEvents() {
  const events = happyPathEvents().slice(0, 6);
  append(
    events,
    'assignment.rejected',
    'asg_00000001',
    {
      assignmentId: 'asg_00000001',
      submissionId: 'sub_00000001',
      violations: [
        { path: '$.result', code: 'invalid', message: 'The result contract is invalid.' },
      ],
      attempt: 1,
      attemptsRemaining: 2,
    },
    NEXT_TIME,
  );
  return events;
}

test('rejected attempts reopen the same issued identity only on the next bounded attempt', () => {
  const events = firstRejectedAttemptEvents();
  append(
    events,
    'assignment.started',
    'asg_00000001',
    { assignmentId: 'asg_00000001', attempt: 2 },
    NEXT_TIME,
  );
  let state = reduceOperatingRuntimeEventsV2(events, { initialState: baseState() });
  assert.equal(state.assignments[0].state, 'running');
  assert.equal(state.assignments[0].attemptPolicy.attempt, 2);
  assert.deepEqual(state.submissions[0], {
    ...submissionRecord(),
    issuedAt: TIME,
  });
  assert.equal(state.submissions[0].submissionId, 'sub_00000001');
  assert.deepEqual(state.submissionReplayIndex, []);

  append(
    events,
    'assignment.submitted',
    'asg_00000001',
    {
      assignmentId: 'asg_00000001',
      submissionId: 'sub_00000001',
      rawHash: RETRY_HASH,
      canonicalHash: null,
      sizeBytes: 21,
      mediaType: 'application/json',
      encoding: 'utf-8',
    },
    NEXT_TIME,
  );
  append(
    events,
    'artifact.created',
    'art_00000002',
    {
      kind: 'operating-artifact',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      artifactId: 'art_00000002',
      artifactType: 'cycle-evidence',
      assignmentId: 'asg_00000001',
      cycleId: 'cyc_00000001',
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      schemaId: 'operating-context-capture',
      artifactSchemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      rawHash: RETRY_HASH,
      canonicalHash: null,
      sizeBytes: 21,
      storageClass: 'machine-local',
      sensitivity: 'internal',
      retentionClass: 'project',
      producer: { actorId: 'agent-001', roleId: 'context-evidence', runtime: 'codex' },
      inputArtifactIds: [],
      createdAt: NEXT_TIME,
    },
    NEXT_TIME,
  );
  append(
    events,
    'assignment.validated',
    'asg_00000001',
    {
      assignmentId: 'asg_00000001',
      submissionId: 'sub_00000001',
      artifactId: 'art_00000002',
      validatorVersion: '1.0.0',
    },
    NEXT_TIME,
  );
  state = reduceOperatingRuntimeEventsV2(events, { initialState: baseState() });
  assert.equal(state.assignments[0].state, 'validated');
  assert.equal(state.submissions[0].rawHash, RETRY_HASH);
  assert.deepEqual(state.submissionReplayIndex[0].acceptanceEventIds, [
    'evt-009',
    'evt-010',
    'evt-011',
  ]);
});

test('final rejection is durable but cannot reopen, and attempt counters fail closed', () => {
  const events = firstRejectedAttemptEvents();
  append(
    events,
    'assignment.started',
    'asg_00000001',
    { assignmentId: 'asg_00000001', attempt: 2 },
    NEXT_TIME,
  );
  appendSubmittedAttempt(events, 2, RETRY_HASH);
  append(
    events,
    'assignment.started',
    'asg_00000001',
    { assignmentId: 'asg_00000001', attempt: 3 },
    NEXT_TIME,
  );
  appendSubmittedAttempt(events, 3, INPUT_HASH);
  const finalRejected = reduceOperatingRuntimeEventsV2(events, { initialState: baseState() });
  assert.equal(finalRejected.assignments[0].state, 'rejected');
  assert.equal(finalRejected.assignments[0].attemptPolicy.attempt, 3);
  assert.equal(finalRejected.submissions[0].responseData.attemptsRemaining, 0);

  const reopen = eventAfterState(
    finalRejected,
    'assignment.started',
    'asg_00000001',
    {
      assignmentId: 'asg_00000001',
      attempt: 4,
    },
    'evt-reopen-final',
  );
  assert.throws(
    () => reduceOperatingRuntimeEventsV2([reopen], { initialState: finalRejected }),
    (error) => error.code === 'STATE_TRANSITION_INVALID',
  );

  const inconsistent = firstRejectedAttemptEvents();
  inconsistent.at(-1).payload.attemptsRemaining = 1;
  inconsistent.at(-1).eventHash = computeOperatingRuntimeEventHashV2(inconsistent.at(-1));
  assert.throws(
    () => reduceOperatingRuntimeEventsV2(inconsistent, { initialState: baseState() }),
    (error) => error.code === 'STATE_TRANSITION_INVALID',
  );

  const rejectedBase = reduceOperatingRuntimeEventsV2(firstRejectedAttemptEvents(), {
    initialState: baseState(),
  });
  rejectedBase.submissionReplayIndex.push({
    submissionId: 'sub_00000001',
    assignmentId: 'asg_00000001',
    rawHash: RAW_HASH,
    canonicalHash: null,
    sizeBytes: 21,
    artifactId: 'art_00000009',
    acceptanceEventIds: ['evt-accepted-existing'],
    responseData: { accepted: true },
  });
  const before = sha256Jcs(rejectedBase);
  const blocked = eventAfterState(
    rejectedBase,
    'assignment.started',
    'asg_00000001',
    {
      assignmentId: 'asg_00000001',
      attempt: 2,
    },
    'evt-blocked-reopen',
  );
  assert.throws(
    () => reduceOperatingRuntimeEventsV2([blocked], { initialState: rejectedBase }),
    (error) => error.code === 'STATE_TRANSITION_INVALID',
  );
  assert.equal(sha256Jcs(rejectedBase), before);
});

test('strict chain and semantic failures preserve the input projection', () => {
  const base = baseState();
  const before = sha256Jcs(base);
  const tampered = happyPathEvents();
  tampered[2].actor.id = 'tampered';
  assert.throws(
    () => verifyOperatingRuntimeEventChainV2(tampered),
    (error) => error.code === 'STATE_TRANSITION_INVALID',
  );
  assert.equal(sha256Jcs(base), before);

  const wrongVersion = structuredClone(happyPathEvents()[0]);
  wrongVersion.protocolVersion = '1.4.0';
  assert.throws(
    () => verifyOperatingRuntimeEventChainV2([wrongVersion]),
    (error) => error.code === 'CONTRACT_VERSION_UNSUPPORTED',
  );

  for (const requiredField of ['actor', 'causationId', 'correlationId', 'entityId', 'payload']) {
    const invalid = structuredClone(happyPathEvents()[0]);
    delete invalid[requiredField];
    invalid.eventHash = computeOperatingRuntimeEventHashV2(invalid);
    assert.throws(
      () => verifyOperatingRuntimeEventChainV2([invalid]),
      (error) => error.code === 'STATE_TRANSITION_INVALID',
      requiredField,
    );
  }

  const missingBase = createEmptyOperatingRuntimeStateV2(TIME);
  assert.throws(
    () => reduceOperatingRuntimeEventsV2([happyPathEvents()[0]], { initialState: missingBase }),
    (error) => error.code === 'CYCLE_NOT_FOUND',
  );
  assert.throws(
    () => {
      const altered = structuredClone(happyPathEvents()[0]);
      altered.previousEventHash = INPUT_HASH;
      altered.eventHash = computeOperatingRuntimeEventHashV2(altered);
      reduceOperatingRuntimeEventsV2([altered], { initialState: base });
    },
    (error) => error.code === 'CONCURRENT_MODIFICATION',
  );
  assert.equal(sha256Jcs(base), before);
});

test('illegal assignment transitions use a stable code and never mutate the source', () => {
  const source = assignment('available');
  const before = structuredClone(source);
  assert.throws(
    () => transitionOperatingAssignmentV2(source, 'validated'),
    (error) =>
      error.code === 'STATE_TRANSITION_INVALID' &&
      error.details.context.from === 'available' &&
      error.details.context.to === 'validated',
  );
  assert.deepEqual(source, before);

  for (const [field, value] of Object.entries({
    assignmentId: 'asg_00000002',
    cycleId: 'cyc_00000002',
    roleId: 'technology-risk',
    objective: 'Mutated objective.',
    outputContract: { ...source.outputContract, mediaType: 'text/plain' },
    capabilityGrantId: 'grant-002',
  })) {
    assert.throws(
      () =>
        transitionOperatingAssignmentV2(source, 'claimed', {
          claim: {
            actorId: 'agent-001',
            actorKind: 'agent',
            runtime: 'codex',
            claimId: 'claim-001',
          },
          [field]: value,
        }),
      (error) => error.code === 'STATE_TRANSITION_INVALID',
      field,
    );
    assert.deepEqual(source, before, field);
  }
});
