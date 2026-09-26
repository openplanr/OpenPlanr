import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  createEmptyOperatingRuntimeStateV2,
  createOperatingRuntimeEventV2,
  materializeValidatedOperatingWorkV2,
  reduceOperatingRuntimeEventsV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { deriveOperatingIntelligenceAssignmentIdV2 } from '../../lib/operate/scheduler-v2.mjs';
import {
  assertPersistentWorkMaterializationPayloadV2,
  buildPersistentWorkMaterializationPayloadV2,
  promotePersistentOperatingActionAuthorityV2,
} from '../../lib/operate/persistent-work-v2.mjs';
import { chairAssignmentFieldsV2 } from '../helpers/intelligence-assignment-fixture.mjs';

const TIME = '2026-08-08T10:00:00.000Z';
const NEXT = '2026-08-08T10:01:00.000Z';
const INTELLIGENCE_PLAN_ID = 'ipl_persistent_work_001';
const CHAIR_ASSIGNMENT_ID = deriveOperatingIntelligenceAssignmentIdV2(
  INTELLIGENCE_PLAN_ID,
  'chair',
  '2.0.0',
);
const CHAIR_CLAIM_ID = `claim:${CHAIR_ASSIGNMENT_ID}:1`;
const CHAIR_SUBMISSION_ID = 'sub_chair_0001';
const CHAIR_ARTIFACT_ID = 'art_workset_001';
const CHAIR_INPUT_ARTIFACT_IDS = Object.freeze(['art_persistent_source_001']);

function changeSet(overrides = {}) {
  return {
    kind: 'operating-work-change-set',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    cycleId: 'cyc_00000001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    findings: [
      {
        draftRef: 'draft_find_0001',
        title: 'Revenue risk',
        statement: 'Revenue is below plan.',
        state: 'open',
        ownerActorId: 'owner-001',
        revisitAt: null,
      },
    ],
    decisions: [
      {
        draftRef: 'draft_decision_01',
        title: 'Prioritize retention',
        question: 'What should we prioritize?',
        rationale: 'Retention is the largest current risk.',
        evidenceRefIds: ['evr_00000001'],
        alternatives: ['Prioritize acquisition'],
        confidence: 0.8,
        assumptionIds: [],
        expectedUpside: 'Retention improves.',
        expectedDownside: 'Acquisition learning slows.',
        dissent: [],
        reopenConditions: ['Retention evidence changes materially.'],
        revisitConditions: ['Metric changes.'],
        ownerActorId: 'owner-001',
        revisitAt: null,
      },
    ],
    actions: [
      {
        draftRef: 'draft_action_001',
        title: 'Interview customers',
        ownerActorId: 'owner-001',
        accountabilityDisposition: null,
        sourceDecisionDraftRef: 'draft_decision_01',
        sourceFindingDraftRefs: ['draft_find_0001'],
        dependsOnActionDraftRefs: [],
        objectiveId: 'obj_retention_001',
        expectedResult: 'Customer interviews reveal retention friction.',
        metricId: 'met_retention_001',
        baseline: 0.4,
        target: 0.6,
        verificationWindow: 'next 30-day window',
        verificationPlanId: 'vfy_retention_001',
      },
    ],
    ...overrides,
  };
}

function chairAssignment(state = 'pending') {
  return {
    kind: 'operating-assignment',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    assignmentId: CHAIR_ASSIGNMENT_ID,
    cycleId: 'cyc_00000001',
    assignmentKind: 'chair',
    roleId: 'chair',
    ...chairAssignmentFieldsV2(),
    intelligenceContext: {
      intelligencePlanId: INTELLIGENCE_PLAN_ID,
      snapshotId: 'snp_persistent_work_001',
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      sourceArtifactId: 'art_persistent_source_001',
      sourceArtifactIds: ['art_persistent_source_001'],
      evidenceRefIds: ['evr_00000001'],
      inputBundle: {
        bundleId: 'ibd_persistent_work_001',
        bundleArtifactId: 'art_persistent_source_001',
        bundleRawHash: `sha256:${'a'.repeat(64)}`,
        bundleCanonicalHash: null,
        sourceArtifactIds: ['art_persistent_source_001'],
        issuedEvidence: [],
      },
      decisionOwnerActorId: 'owner-001',
    },
    objective: 'Synthesize operating work.',
    state,
    dependsOn: [],
    dependencyPolicy: { kind: 'none' },
    inputArtifactIds: [...CHAIR_INPUT_ARTIFACT_IDS],
    outputContract: {
      schemaId: 'operating-decision-ledger',
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 65536,
    },
    capabilityGrantId: 'grant-chair-001',
    attemptPolicy: { maxAttempts: 1, attempt: state === 'running' ? 1 : 0, timeoutMs: 300000 },
    claim:
      state === 'running'
        ? { actorId: 'chair-001', actorKind: 'agent', runtime: 'codex', claimId: CHAIR_CLAIM_ID }
        : null,
    terminalOutcome: null,
    createdAt: TIME,
    availableAt: state === 'pending' ? null : TIME,
    completedAt: null,
  };
}

function baseState() {
  return {
    ...createEmptyOperatingRuntimeStateV2(TIME),
    cycles: [
      {
        kind: 'operating-cycle',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        cycleId: 'cyc_00000001',
        scopeId: 'scope-acme',
        domainId: 'business',
        domainVersion: '1.0.0',
        state: 'advising',
        inputBindingId: 'inb_00000001',
        contractVersions: { 'operating-work-change-set': '2.0.0' },
        trigger: { kind: 'manual' },
        focus: ['strategy'],
        health: 'normal',
        activeReviewId: null,
        createdAt: TIME,
        updatedAt: TIME,
      },
    ],
    inputBindings: [
      {
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
      },
    ],
  };
}

function eventAfter(state, type, entityId, payload, eventId, causationId = null) {
  return createOperatingRuntimeEventV2(
    {
      eventId,
      timestamp: TIME,
      cycleId: 'cyc_00000001',
      type,
      entityId,
      actor: { kind: 'engine', id: 'openplanr' },
      causationId,
      correlationId: 'corr-chair-001',
      payload,
    },
    { previousEvent: { sequence: state.eventHead.sequence, eventHash: state.eventHead.hash } },
  );
}

function acceptedChairState(work = changeSet()) {
  let state = { ...baseState(), assignments: [chairAssignment('available')] };
  const claimed = eventAfter(
    state,
    'assignment.claimed',
    CHAIR_ASSIGNMENT_ID,
    {
      assignmentId: CHAIR_ASSIGNMENT_ID,
      actorId: 'chair-001',
      actorKind: 'agent',
      runtime: 'codex',
      claimId: CHAIR_CLAIM_ID,
      submissionId: CHAIR_SUBMISSION_ID,
    },
    'evt-chair-003',
  );
  state = reduceOperatingRuntimeEventsV2([claimed], { initialState: state });
  const started = eventAfter(
    state,
    'assignment.started',
    CHAIR_ASSIGNMENT_ID,
    {
      assignmentId: CHAIR_ASSIGNMENT_ID,
      attempt: 1,
    },
    'evt-chair-004',
    claimed.eventId,
  );
  state = reduceOperatingRuntimeEventsV2([started], { initialState: state });
  const canonicalHash = sha256Jcs({ assignmentId: CHAIR_ASSIGNMENT_ID, work });
  const submitted = eventAfter(
    state,
    'assignment.submitted',
    CHAIR_ASSIGNMENT_ID,
    {
      assignmentId: CHAIR_ASSIGNMENT_ID,
      submissionId: CHAIR_SUBMISSION_ID,
      rawHash: canonicalHash,
      canonicalHash,
      sizeBytes: Buffer.byteLength(JSON.stringify(work)),
      mediaType: 'application/json',
      encoding: 'utf-8',
    },
    'evt-chair-005',
    started.eventId,
  );
  state = reduceOperatingRuntimeEventsV2([submitted], { initialState: state });
  const artifactCreated = eventAfter(
    state,
    'artifact.created',
    CHAIR_ARTIFACT_ID,
    {
      kind: 'operating-artifact',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      artifactId: CHAIR_ARTIFACT_ID,
      artifactType: 'chair-result',
      assignmentId: CHAIR_ASSIGNMENT_ID,
      cycleId: 'cyc_00000001',
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      schemaId: 'operating-decision-ledger',
      artifactSchemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      rawHash: canonicalHash,
      canonicalHash,
      sizeBytes: Buffer.byteLength(JSON.stringify(work)),
      storageClass: 'machine-local',
      sensitivity: 'internal',
      retentionClass: 'project',
      producer: { actorId: 'chair-001', roleId: 'chair', runtime: 'codex' },
      inputArtifactIds: [...CHAIR_INPUT_ARTIFACT_IDS],
      createdAt: NEXT,
    },
    'evt-chair-006',
    submitted.eventId,
  );
  state = reduceOperatingRuntimeEventsV2([artifactCreated], { initialState: state });
  const validated = eventAfter(
    state,
    'assignment.validated',
    CHAIR_ASSIGNMENT_ID,
    {
      assignmentId: CHAIR_ASSIGNMENT_ID,
      submissionId: CHAIR_SUBMISSION_ID,
      artifactId: CHAIR_ARTIFACT_ID,
      validatorVersion: '2.0.0',
    },
    'evt-chair-007',
    artifactCreated.eventId,
  );
  return reduceOperatingRuntimeEventsV2([validated], { initialState: state });
}

function workChangeSetArtifact(work = changeSet()) {
  const canonicalHash = sha256Jcs(work);
  return {
    kind: 'operating-artifact',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    artifactId: CHAIR_ARTIFACT_ID,
    artifactType: 'work-change-set',
    assignmentId: 'asg_legacy_work_materializer_001',
    cycleId: 'cyc_00000001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    schemaId: 'operating-work-change-set',
    artifactSchemaVersion: '2.0.0',
    mediaType: 'application/json',
    encoding: 'utf-8',
    rawHash: canonicalHash,
    canonicalHash,
    sizeBytes: Buffer.byteLength(JSON.stringify(work)),
    storageClass: 'machine-local',
    sensitivity: 'internal',
    retentionClass: 'project',
    producer: { actorId: 'openplanr', roleId: 'work-materializer', runtime: 'portable' },
    inputArtifactIds: [],
    createdAt: NEXT,
  };
}

function buildPersistentPayload(work = changeSet()) {
  return buildPersistentWorkMaterializationPayloadV2({
    artifact: workChangeSetArtifact(work),
    changeSet: work,
    timestamp: NEXT,
  });
}

test('exact current Chair Artifact cannot enter the superseded work-change-set materializer', () => {
  const work = changeSet();
  const before = acceptedChairState(work);
  const beforeHash = sha256Jcs(before);
  assert.throws(
    () =>
      materializeValidatedOperatingWorkV2(
        { artifactId: CHAIR_ARTIFACT_ID, changeSet: work },
        {
          eventId: 'evt-work-001',
          timestamp: NEXT,
          correlationId: 'corr-work-001',
        },
        { initialState: before },
      ),
    ({ code }) => code === 'RESULT_CONTRACT_INVALID',
  );
  assert.equal(
    sha256Jcs(before),
    beforeHash,
    'rejected compatibility materialization is effect-free',
  );
});

test('pure persistent-work builder derives canonical records and rejects forged bytes or local references', () => {
  const work = changeSet();
  const payload = buildPersistentPayload(work);
  assert.match(payload.findings[0].findingId, /^fnd_/);
  assert.match(payload.decisions[0].decisionId, /^dec_/);
  assert.match(payload.actions[0].actionId, /^act_/);
  assert.equal(payload.actions[0].sourceDecisionId, payload.decisions[0].decisionId);
  assert.deepEqual(payload.actions[0].sourceFindingIds, [payload.findings[0].findingId]);
  assert.throws(
    () =>
      buildPersistentWorkMaterializationPayloadV2({
        artifact: workChangeSetArtifact(work),
        changeSet: { ...work, findings: [{ ...work.findings[0], title: 'Changed title' }] },
        timestamp: NEXT,
      }),
    ({ code }) => code === 'RESULT_CONTRACT_INVALID',
  );
  const invalidWork = changeSet({
    actions: [{ ...work.actions[0], sourceFindingDraftRefs: ['draft_missing_1'] }],
  });
  assert.throws(
    () => buildPersistentPayload(invalidWork),
    ({ code }) => code === 'STATE_TRANSITION_INVALID',
  );
});

test('pure persistent-work payload verification rejects forged runtime identities', () => {
  const work = changeSet();
  const artifact = workChangeSetArtifact(work);
  const payload = buildPersistentWorkMaterializationPayloadV2({
    artifact,
    changeSet: work,
    timestamp: NEXT,
  });
  const replay = buildPersistentWorkMaterializationPayloadV2({
    artifact: structuredClone(artifact),
    changeSet: structuredClone(work),
    timestamp: NEXT,
  });
  assert.deepEqual(replay, payload);
  const forged = structuredClone(payload);
  forged.actions[0].actionId = 'act_forged_001';
  assert.throws(
    () =>
      assertPersistentWorkMaterializationPayloadV2(forged, {
        artifact,
        changeSet: work,
        timestamp: NEXT,
      }),
    ({ code }) => code === 'STATE_TRANSITION_INVALID',
  );
});

test('Phase 3 proposed work receives one deterministic complete governed Action authority tuple', () => {
  const source = buildPersistentPayload().actions[0];
  const input = {
    actionKind: { id: 'business-operating-hypothesis', version: '1.0.0' },
    requestedCapability: { id: 'bounded-project-write', version: '1.0.0' },
    targetBinding: { kind: 'project-record', id: source.actionId, revision: source.updatedAt },
    effectClass: 'project-write',
    preconditionArtifactIds: ['art_workset_001'],
    executionBinding: {
      policyId: 'bounded-project-write-policy',
      policyVersion: '1.0.0',
      rollbackRequired: true,
      verificationRequired: true,
    },
    updatedAt: '2026-08-08T10:02:00.000Z',
  };
  const first = promotePersistentOperatingActionAuthorityV2(source, input);
  const second = promotePersistentOperatingActionAuthorityV2(
    structuredClone(source),
    structuredClone(input),
  );
  assert.deepEqual(second, first);
  assert.equal(first.revision, 1);
  assert.equal(first.predecessorRevisionId, null);
  assert.match(first.revisionId, /^actrev_[a-f0-9]{64}$/u);
  assert.match(first.actionHash, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(first.preconditionArtifactIds, ['art_workset_001']);
  assert.throws(
    () => promotePersistentOperatingActionAuthorityV2(first, input),
    ({ code }) => code === 'CONCURRENT_MODIFICATION',
  );
});
