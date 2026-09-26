import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  assertOperatingIntelligencePlanV2,
  planOperatingIntelligenceBoardV2,
} from '../../lib/operate/intelligence-router-v2.mjs';
import {
  claimOperatingAssignmentV2,
  createNoModelReplayHookV2,
  createOperatingRuntimeEventV2,
  deriveOperatingRuntimeDeltaV2,
  deriveOperatingSnapshotRuntimeHashV2,
  planOperatingRuntimeIntelligenceBoardV2,
  reduceOperatingRuntimeEventsV2,
  scheduleOperatingRuntimeEventsV2,
} from '../../lib/operate/runtime-foundation.mjs';
import {
  deriveOperatingAssignmentReleaseIntentsV2,
  resolveOperatingAssignmentInputAbsencesV2,
  resolveOperatingAssignmentInputArtifactIdsV2,
  validateOperatingIntelligenceAssignmentGraphV2,
} from '../../lib/operate/scheduler-v2.mjs';
import { validateProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { checkpoint } from './operate-operating-intelligence-state-v2.test-support.mjs';

const DELTA_TIME = '2026-08-09T12:01:00.000Z';
const PLAN_TIME = '2026-08-09T12:02:00.000Z';
const EXECUTIVE_ADVISOR_IDS = [
  'growth-market',
  'operations-customer',
  'product-activation',
  'strategy-finance',
  'technology-risk',
];
const BUSINESS_BOARD_ROLE_IDS = [...EXECUTIVE_ADVISOR_IDS, 'independent-challenge', 'chair'];
const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const clone = (value) => structuredClone(value);

function deltaCheckpoint(seed = '001') {
  const base = checkpoint();
  const request = {
    cycleId: base.result.state.cycles[0].cycleId,
    snapshotId: base.result.snapshot.snapshotId,
    stateId: base.result.operatingState.stateId,
  };
  const derived = deriveOperatingRuntimeDeltaV2(
    request,
    {
      deltaId: `dlt_router_${seed}`,
      eventId: `evt_router_delta_${seed}`,
      timestamp: DELTA_TIME,
      correlationId: `corr_router_delta_${seed}`,
    },
    { initialState: base.result.state },
  );
  return { base, request, derived };
}

function pureInput(seed = '001', overrides = {}) {
  const value = deltaCheckpoint(seed);
  return {
    value,
    input: {
      cycleId: value.request.cycleId,
      delta: value.derived.delta,
      snapshot: value.base.result.snapshot,
      operatingState: value.base.result.operatingState,
      evidenceRefs: value.base.result.state.evidenceRefs,
      evidenceArtifacts: value.base.result.state.artifacts,
      focus: ['all'],
      domainDescriptor: fixture('business-domain-valid.json'),
      decisionOwnerActorId: 'owner-router-001',
      createdAt: PLAN_TIME,
      ...overrides,
    },
  };
}

function acceptedProofRecords(target, seed = 'router_001') {
  const artifact = {
    kind: 'operating-artifact',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    artifactId: `art_${seed}`,
    artifactType: 'advisor-result',
    assignmentId: target.assignmentId,
    cycleId: target.cycleId,
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    schemaId: target.outputContract.schemaId,
    artifactSchemaVersion: target.outputContract.schemaVersion,
    mediaType: target.outputContract.mediaType,
    encoding: target.outputContract.encoding,
    rawHash: `sha256:${'a'.repeat(64)}`,
    canonicalHash: null,
    sizeBytes: 2,
    storageClass: 'machine-local',
    sensitivity: 'internal',
    retentionClass: 'project',
    producer: { actorId: 'agent-001', roleId: target.roleId, runtime: 'portable' },
    inputArtifactIds: [...target.inputArtifactIds],
    createdAt: PLAN_TIME,
  };
  const submission = {
    kind: 'operating-submission',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    submissionId: `sub_${seed}`,
    assignmentId: target.assignmentId,
    cycleId: target.cycleId,
    state: 'accepted',
    rawHash: artifact.rawHash,
    canonicalHash: artifact.canonicalHash,
    sizeBytes: artifact.sizeBytes,
    artifactId: artifact.artifactId,
    acceptanceEventIds: [`evt_submitted_${seed}`, `evt_artifact_${seed}`, `evt_validated_${seed}`],
    responseData: {
      accepted: true,
      artifactId: artifact.artifactId,
      rawHash: artifact.rawHash,
      sizeBytes: artifact.sizeBytes,
      assignmentState: 'validated',
    },
    issuedAt: PLAN_TIME,
    resolvedAt: PLAN_TIME,
  };
  const replay = {
    submissionId: submission.submissionId,
    assignmentId: submission.assignmentId,
    rawHash: submission.rawHash,
    canonicalHash: submission.canonicalHash,
    sizeBytes: submission.sizeBytes,
    artifactId: submission.artifactId,
    acceptanceEventIds: [...submission.acceptanceEventIds],
    responseData: structuredClone(submission.responseData),
  };
  return { artifact, submission, replay };
}

test('intelligence plan fixtures and semantic minimum-board validation fail closed', () => {
  const valid = fixture('intelligence-plan-valid.json');
  const invalid = fixture('intelligence-plan-invalid.json');
  assert.deepEqual(
    validateProtocolArtifact('operating-intelligence-plan', valid, { protocolVersion: '2.0.0' }),
    [],
  );
  assert.ok(
    validateProtocolArtifact('operating-intelligence-plan', invalid, { protocolVersion: '2.0.0' })
      .length > 0,
  );
  assert.doesNotThrow(() => assertOperatingIntelligencePlanV2(valid));
  const overlap = clone(valid);
  overlap.omittedRoles.push({
    roleId: 'advisor',
    roleKind: 'advisor',
    roleVersion: '2.0.0',
    reason: 'not-selected: Hostile duplicate.',
  });
  assert.throws(() => assertOperatingIntelligencePlanV2(overlap), {
    code: 'RESULT_CONTRACT_INVALID',
  });
});

test('pure routing produces one stable minimum useful board with explicit inputs, outputs, reasons, and dependencies', () => {
  const { input } = pureInput('stable_001');
  const before = sha256Jcs(input);
  const first = planOperatingIntelligenceBoardV2(input);
  const second = planOperatingIntelligenceBoardV2(clone(input));
  assert.deepEqual(first, second);
  assert.equal(sha256Jcs(input), before, 'routing does not mutate its validated inputs');
  assert.deepEqual(
    first.plan.selectedRoles.map(({ roleId }) => roleId),
    BUSINESS_BOARD_ROLE_IDS,
  );
  assert.deepEqual(
    first.plan.selectedRoles.find(({ roleId }) => roleId === 'independent-challenge')
      .dependsOnRoleIds,
    [...EXECUTIVE_ADVISOR_IDS],
  );
  assert.deepEqual(
    [...first.plan.selectedRoles.find(({ roleId }) => roleId === 'chair').dependsOnRoleIds].sort(),
    [...EXECUTIVE_ADVISOR_IDS, 'independent-challenge'].sort(),
  );
  assert.equal(first.assignments.length, 7);
  assert.deepEqual(
    first.assignments.map(({ assignmentKind }) => assignmentKind).sort(),
    [...Array(EXECUTIVE_ADVISOR_IDS.length).fill('advisor'), 'chair', 'challenger'].sort(),
  );
  assert.equal(
    first.assignments.every(
      (assignment) =>
        assignment.inputArtifactIds.includes(
          assignment.intelligenceContext.inputBundle.bundleArtifactId,
        ) &&
        assignment.inputArtifactIds.every(
          (artifactId) =>
            artifactId === assignment.intelligenceContext.inputBundle.bundleArtifactId ||
            assignment.intelligenceContext.inputBundle.issuedEvidence.some(
              ({ evidenceArtifactId }) => evidenceArtifactId === artifactId,
            ),
        ),
    ),
    true,
    'each role receives only its role-scoped bundle and authorized materialized Evidence',
  );
  assert.equal(
    first.assignments.every(
      (assignment) =>
        sha256Jcs(assignment.intelligenceContext.sourceArtifactIds) ===
        sha256Jcs(input.snapshot.sourceArtifactIds),
    ),
    true,
    'snapshot sources remain provenance without becoming readable inputs',
  );
  const outputSchemaByRoleKind = {
    advisor: 'operating-advisor-result',
    challenger: 'operating-challenger-review',
    chair: 'operating-decision-ledger',
  };
  assert.equal(
    first.assignments.every(
      ({ assignmentKind, outputContract }) =>
        outputContract.schemaId === outputSchemaByRoleKind[assignmentKind] &&
        outputContract.schemaVersion === '2.0.0' &&
        outputContract.encoding === 'utf-8',
    ),
    true,
  );
  assert.equal(
    first.assignments.every(({ roleVersion }) => roleVersion === '2.0.0'),
    true,
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.plan.selectedRoles[0]), true);
  assert.doesNotMatch(
    first.plan.selectedRoles.map(({ reason }) => reason).join(' '),
    /\b(?:business|software)\b/iu,
  );
});

test('a crafted required-Challenger plan cannot remove the Chair-to-Challenger edge', () => {
  const { input, value } = pureInput('topology_001');
  const board = planOperatingIntelligenceBoardV2(input);
  const craftedPlan = clone(board.plan);
  craftedPlan.selectedRoles.find(({ roleId }) => roleId === 'chair').dependsOnRoleIds = [
    'strategy-finance',
  ];
  const craftedAssignments = clone(board.assignments);
  craftedAssignments.find(({ roleId }) => roleId === 'chair').dependsOn = [
    craftedAssignments.find(({ roleId }) => roleId === 'strategy-finance').assignmentId,
  ];
  assert.throws(() => assertOperatingIntelligencePlanV2(craftedPlan), {
    code: 'RESULT_CONTRACT_INVALID',
  });
  assert.throws(
    () => validateOperatingIntelligenceAssignmentGraphV2(craftedPlan, craftedAssignments),
    {
      code: 'STATE_TRANSITION_INVALID',
    },
  );
  const sourceSubmission = value.derived.state.submissions.find(
    ({ artifactId }) => artifactId === craftedPlan.sourceArtifactId,
  );
  const craftedEvent = createOperatingRuntimeEventV2(
    {
      eventId: 'evt_crafted_topology_001',
      timestamp: PLAN_TIME,
      cycleId: value.request.cycleId,
      type: 'intelligence.plan-recorded',
      entityId: craftedPlan.planId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId: sourceSubmission.acceptanceEventIds.at(-1),
      correlationId: 'corr_crafted_topology_001',
      payload: craftedPlan,
    },
    {
      previousEvent: {
        sequence: value.derived.state.eventHead.sequence,
        eventHash: value.derived.state.eventHead.hash,
      },
    },
  );
  assert.throws(
    () =>
      reduceOperatingRuntimeEventsV2([craftedEvent], {
        initialState: value.derived.state,
      }),
    { code: 'RESULT_CONTRACT_INVALID' },
  );
});

test('a no-material-change routine omits Challenger explicitly while retaining advisor and Chair', () => {
  const { input } = pureInput('quiet_001');
  input.delta = {
    ...clone(input.delta),
    sourceRevisionChanges: [],
    metricChanges: [],
    staleEvidenceRefIds: [],
    conflictingEvidenceRefIds: [],
    invalidatedAssumptionIds: [],
    exposedRiskIds: [],
    decisionRevisitIds: [],
  };
  input.focus = ['routine'];
  const result = planOperatingIntelligenceBoardV2(input);
  assert.deepEqual(
    result.plan.selectedRoles.map(({ roleId }) => roleId),
    [...EXECUTIVE_ADVISOR_IDS, 'chair'],
  );
  assert.deepEqual(
    result.plan.omittedRoles.map(({ roleId }) => roleId),
    ['independent-challenge'],
  );
  assert.equal(result.plan.challengerRequired, false);
  assert.equal(result.plan.scenarioRequest.requested, false);
  assert.deepEqual(
    [...result.assignments.find(({ roleId }) => roleId === 'chair').dependsOn].sort(),
    result.assignments
      .filter(({ assignmentKind }) => assignmentKind === 'advisor')
      .map(({ assignmentId }) => assignmentId)
      .sort(),
  );
  const chair = result.assignments.find(({ roleId }) => roleId === 'chair');
  const absences = resolveOperatingAssignmentInputAbsencesV2(chair, {
    assignments: result.assignments,
    intelligencePlans: [result.plan],
  });
  assert.deepEqual(
    absences.map(({ roleId, roleKind, absenceCode, sourceAssignmentId, sourceEventId }) => ({
      roleId,
      roleKind,
      absenceCode,
      sourceAssignmentId,
      sourceEventId,
    })),
    [
      {
        roleId: 'independent-challenge',
        roleKind: 'challenger',
        absenceCode: 'not-selected',
        sourceAssignmentId: null,
        sourceEventId: null,
      },
    ],
    'optional Challenger absence is an explicit Chair input and cannot be silently dropped by the ledger',
  );
});

test('routing rejects untyped omission reasons before producing work', () => {
  const { input } = pureInput('untyped_omission_001');
  const hostile = clone(input);
  hostile.focus = ['technology-risk'];
  const planned = planOperatingIntelligenceBoardV2(hostile);
  const tampered = clone(planned.plan);
  tampered.omittedRoles = tampered.omittedRoles.map((role) =>
    role.roleId === 'growth-market' ? { ...role, reason: 'silence' } : role,
  );
  assert.throws(() => assertOperatingIntelligencePlanV2(tampered), {
    code: 'RESULT_CONTRACT_INVALID',
  });
});

test('scoped routing selects one executive lens and records typed absence for the others', () => {
  const { input } = pureInput('scoped_cto_001');
  input.focus = ['technology-risk', 'challenge'];
  const result = planOperatingIntelligenceBoardV2(input);
  assert.deepEqual(
    result.plan.selectedRoles
      .filter(({ roleKind }) => roleKind === 'advisor')
      .map(({ roleId }) => roleId),
    ['technology-risk'],
  );
  assert.deepEqual(
    result.plan.omittedRoles
      .filter(({ roleKind }) => roleKind === 'advisor')
      .map(({ roleId }) => roleId)
      .sort(),
    EXECUTIVE_ADVISOR_IDS.filter((roleId) => roleId !== 'technology-risk').sort(),
  );
  assert.ok(
    result.plan.omittedRoles.every(
      ({ roleKind, reason }) => roleKind !== 'advisor' || reason.startsWith('not-selected:'),
    ),
  );
  assert.equal(result.plan.challengerRequired, true);
  assert.equal(result.assignments.length, 3);
  assert.deepEqual(
    result.assignments.find(({ roleId }) => roleId === 'independent-challenge').dependsOn.sort(),
    [result.assignments.find(({ roleId }) => roleId === 'technology-risk').assignmentId],
  );
});

test('routing rejects cross-scope inputs, authority-bearing domain requests, and undeclared input fields before producing work', () => {
  const { input } = pureInput('invalid_001');
  assert.throws(
    () =>
      planOperatingIntelligenceBoardV2({
        ...input,
        delta: { ...clone(input.delta), scopeId: 'foreign-scope' },
      }),
    { code: 'OPERATING_SCOPE_INVALID' },
  );
  assert.throws(
    () =>
      planOperatingIntelligenceBoardV2({
        ...input,
        domainDescriptor: {
          ...clone(input.domainDescriptor),
          requestedCapabilities: [
            { id: 'repository-read', version: '1.0.0', reason: 'Not authority.' },
          ],
        },
      }),
    { code: 'CAPABILITY_DENIED' },
  );
  assert.throws(() => planOperatingIntelligenceBoardV2({ ...input, provider: { invoke: true } }), {
    code: 'RESULT_CONTRACT_INVALID',
  });
  const hostileDescriptor = clone(input.domainDescriptor);
  hostileDescriptor.roles = hostileDescriptor.roles.map((role) =>
    role.roleId === 'strategy-finance'
      ? {
          ...role,
          roleId: 'finance-strategy',
          analysisRubric: { ...role.analysisRubric, requiredQuestions: ['Hostile rubric.'] },
        }
      : role,
  );
  assert.throws(
    () =>
      planOperatingIntelligenceBoardV2({
        ...input,
        domainDescriptor: hostileDescriptor,
      }),
    { code: 'RESULT_CONTRACT_INVALID' },
  );
});

test('routing rejects an evidence-empty snapshot before creating any Assignment intent', () => {
  const { input } = pureInput('empty_evidence_001');
  const empty = clone(input);
  empty.snapshot.evidenceRefIds = [];
  empty.snapshot.sourceRevisions = empty.snapshot.sourceRevisions.map((revision) => ({
    ...revision,
    evidenceRefIds: [],
  }));
  empty.snapshot.runtimeHash = deriveOperatingSnapshotRuntimeHashV2(empty.snapshot);
  empty.delta.sourceRevisionChanges = empty.delta.sourceRevisionChanges.map((change) => ({
    ...change,
    evidenceRefIds: [],
  }));
  assert.throws(
    () => planOperatingIntelligenceBoardV2(empty),
    (error) =>
      error.code === 'RESULT_CONTRACT_INVALID' && error.message.includes('evidence-empty snapshot'),
  );
});

test('runtime atomically records the plan and graph, releases only Advisor, and replays without dispatch', () => {
  const { base, request, derived } = deltaCheckpoint('runtime_001');
  const runtimeRequest = {
    ...request,
    deltaId: derived.delta.deltaId,
    focus: ['all'],
    domainDescriptor: fixture('business-domain-valid.json'),
    decisionOwnerActorId: 'owner-router-runtime-001',
  };
  const draft = {
    eventId: 'evt_router_plan_runtime_001',
    timestamp: PLAN_TIME,
    correlationId: 'corr_router_plan_runtime_001',
  };
  const hook = createNoModelReplayHookV2();
  const first = planOperatingRuntimeIntelligenceBoardV2(runtimeRequest, draft, {
    initialState: derived.state,
    artifactStore: base.store,
    replayHook: hook,
  });
  assert.equal(hook.dispatchCount, 0);
  assert.deepEqual(
    first.events.map(({ type }) => type),
    [
      ...Array.from({ length: BUSINESS_BOARD_ROLE_IDS.length }, () => [
        'assignment.created',
        'assignment.available',
        'assignment.claimed',
        'assignment.started',
        'assignment.submitted',
        'artifact.created',
        'assignment.validated',
      ]).flat(),
      'intelligence.plan-recorded',
      ...Array(7).fill('assignment.created'),
      ...Array(EXECUTIVE_ADVISOR_IDS.length).fill('assignment.available'),
    ],
  );
  assert.equal(first.state.intelligencePlans.length, 1);
  assert.deepEqual(
    first.assignments
      .filter(({ assignmentKind }) => assignmentKind === 'advisor')
      .map(({ state }) => state),
    Array(EXECUTIVE_ADVISOR_IDS.length).fill('available'),
  );
  assert.equal(
    first.assignments.find(({ roleId }) => roleId === 'independent-challenge').state,
    'pending',
  );
  assert.equal(first.assignments.find(({ roleId }) => roleId === 'chair').state, 'pending');
  assert.equal(first.releaseEvents.length, EXECUTIVE_ADVISOR_IDS.length);
  assert.ok(first.releaseEvents.every(({ payload }) => payload.dependencyProofs.length === 0));
  const replay = planOperatingRuntimeIntelligenceBoardV2(clone(runtimeRequest), clone(draft), {
    initialState: first.state,
    artifactStore: base.store,
  });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.events, []);
  assert.equal(sha256Jcs(replay.state), sha256Jcs(first.state));
  assert.throws(
    () =>
      planOperatingRuntimeIntelligenceBoardV2(
        runtimeRequest,
        {
          ...draft,
          correlationId: 'corr_router_plan_divergent_001',
        },
        { initialState: first.state, artifactStore: base.store },
      ),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  assert.ok(
    base.store.readRaw({
      artifactId: base.sourceArtifactId,
      rawHash: base.result.state.artifacts.find(
        ({ artifactId }) => artifactId === base.sourceArtifactId,
      ).rawHash,
    }).byteLength > 0,
  );
});

test('Chair release accepts only validated Artifact proofs or descriptor-permitted typed terminal absences', () => {
  const { input } = pureInput('absence_001');
  const board = planOperatingIntelligenceBoardV2(input);
  const absence = (assignment, seed) => ({
    ...clone(assignment),
    state: 'failed',
    availableAt: PLAN_TIME,
    completedAt: PLAN_TIME,
    terminalOutcome: {
      outcome: 'failed',
      eventId: `evt_${seed}_failed_001`,
      code: 'role-unavailable',
      reason: 'The selected role was explicitly unavailable.',
      recoveryDisposition: 'continue-partial',
    },
  });
  const advisorAssignments = board.assignments.filter(
    ({ assignmentKind }) => assignmentKind === 'advisor',
  );
  const advisor = {
    ...clone(advisorAssignments[0]),
    state: 'validated',
    availableAt: PLAN_TIME,
    completedAt: PLAN_TIME,
    claim: {
      actorId: 'agent-001',
      actorKind: 'agent',
      runtime: 'portable',
      claimId: 'claim-advisor-router-001',
    },
  };
  const otherAdvisors = advisorAssignments
    .slice(1)
    .map((assignment, index) => absence(assignment, `advisor_${index + 2}`));
  const challenger = absence(
    board.assignments.find(({ roleId }) => roleId === 'independent-challenge'),
    'challenger',
  );
  const chair = board.assignments.find(({ roleId }) => roleId === 'chair');
  const proof = acceptedProofRecords(advisor, 'advisor_router_001');
  const challengerProofs = [
    {
      assignmentId: advisor.assignmentId,
      outcome: 'validated',
      eventId: proof.submission.acceptanceEventIds.at(-1),
      artifactId: proof.artifact.artifactId,
    },
    ...otherAdvisors.map((assignment) => ({
      assignmentId: assignment.assignmentId,
      outcome: 'failed',
      eventId: assignment.terminalOutcome.eventId,
      absence: {
        code: assignment.terminalOutcome.code,
        reason: assignment.terminalOutcome.reason,
        recoveryDisposition: assignment.terminalOutcome.recoveryDisposition,
      },
    })),
  ];
  challenger.inputArtifactIds = [
    ...resolveOperatingAssignmentInputArtifactIdsV2(challenger, challengerProofs),
  ];
  challenger.inputAbsences = [
    ...resolveOperatingAssignmentInputAbsencesV2(challenger, {
      dependencyProofs: challengerProofs,
      assignments: [advisor, ...otherAdvisors, challenger, chair],
      intelligencePlans: [board.plan],
    }),
  ];
  const submissions = [proof.submission];
  const [intent] = deriveOperatingAssignmentReleaseIntentsV2({
    assignments: [advisor, ...otherAdvisors, challenger, chair],
    submissions,
    artifacts: [proof.artifact],
    submissionReplayIndex: [proof.replay],
    intelligencePlans: [board.plan],
  });
  assert.equal(intent.assignmentId, chair.assignmentId);
  assert.equal(intent.dependencyProofs.filter(({ outcome }) => outcome === 'validated').length, 1);
  assert.equal(
    intent.dependencyProofs.filter(({ outcome }) => outcome === 'failed').length,
    otherAdvisors.length + 1,
  );
  assert.equal(
    intent.dependencyProofs.find(({ outcome }) => outcome === 'validated').artifactId,
    proof.artifact.artifactId,
  );
  assert.equal(
    intent.dependencyProofs.find(({ assignmentId }) => assignmentId === challenger.assignmentId)
      .absence.code,
    'role-unavailable',
  );
  assert.deepEqual(
    deriveOperatingAssignmentReleaseIntentsV2({
      assignments: [
        advisor,
        ...otherAdvisors,
        { ...challenger, state: 'running', terminalOutcome: null },
        chair,
      ],
      submissions,
      artifacts: [proof.artifact],
      submissionReplayIndex: [proof.replay],
      intelligencePlans: [board.plan],
    }),
    [],
    'Chair remains pending until every dependency has a validated result or explicit permitted absence',
  );
});

test('all unavailable Advisors terminalize an impossible Challenger and release Chair with typed absences only', () => {
  const { base, request, derived } = deltaCheckpoint('zero_valid_advisors_001');
  const planned = planOperatingRuntimeIntelligenceBoardV2(
    {
      ...request,
      deltaId: derived.delta.deltaId,
      focus: ['all'],
      domainDescriptor: fixture('business-domain-valid.json'),
      decisionOwnerActorId: 'owner-zero-valid-advisors-001',
    },
    {
      eventId: 'evt_zero_valid_advisors_plan',
      timestamp: PLAN_TIME,
      correlationId: 'corr_zero_valid_advisors_plan',
    },
    { initialState: derived.state, artifactStore: base.store },
  );
  const advisors = planned.state.assignments.filter(
    ({ assignmentKind }) => assignmentKind === 'advisor',
  );
  let previousEvent = {
    sequence: planned.state.eventHead.sequence,
    eventHash: planned.state.eventHead.hash,
  };
  let causationId = planned.state.eventReplayIndex.at(-1).eventId;
  const unavailableEvents = advisors.map((advisor, position) => {
    const event = createOperatingRuntimeEventV2(
      {
        eventId: `evt_zero_valid_advisor_${position + 1}`,
        timestamp: PLAN_TIME,
        cycleId: advisor.cycleId,
        type: 'assignment.abandoned',
        entityId: advisor.assignmentId,
        actor: { kind: 'engine', id: 'openplanr-scheduler-test' },
        causationId,
        correlationId: 'corr_zero_valid_advisors_terminal',
        payload: {
          assignmentId: advisor.assignmentId,
          reasonCode: 'role-unavailable',
          reason: 'The selected Advisor runtime is unavailable.',
          recoveryDisposition: 'continue-partial',
        },
      },
      { previousEvent },
    );
    previousEvent = event;
    causationId = event.eventId;
    return event;
  });
  const scheduled = scheduleOperatingRuntimeEventsV2(unavailableEvents, {
    initialState: planned.state,
  });
  const challenger = scheduled.state.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'challenger',
  );
  const chair = scheduled.state.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'chair',
  );
  assert.equal(challenger.state, 'failed');
  assert.equal(challenger.terminalOutcome.code, 'role-unavailable');
  assert.equal(
    scheduled.events.some(
      (event) =>
        event.type === 'assignment.available' && event.entityId === challenger.assignmentId,
    ),
    false,
    'the impossible Challenger is never released as executable work',
  );
  assert.equal(chair.state, 'available');
  const roleAbsences = chair.inputAbsences.filter(({ kind }) => kind === 'role');
  const evidenceAbsences = chair.inputAbsences.filter(({ kind }) => kind === 'evidence');
  assert.equal(roleAbsences.length, advisors.length + 1);
  assert.ok(evidenceAbsences.length > 0);
  assert.ok(evidenceAbsences.every(({ sourceContracts }) => sourceContracts.length > 0));
  assert.deepEqual(
    roleAbsences.map(({ roleKind }) => roleKind).sort(),
    [...advisors.map(() => 'advisor'), 'challenger'].sort(),
  );
  assert.deepEqual(
    scheduled.state.artifacts,
    planned.state.artifacts,
    'scheduler invents no Advisor or Challenger result row',
  );
});

test('intelligence board replay rejects arbitrary lifecycle input expansion without durable dependency proof', () => {
  const { base, request, derived } = deltaCheckpoint('input_expand_001');
  const runtimeRequest = {
    ...request,
    deltaId: derived.delta.deltaId,
    focus: ['all'],
    domainDescriptor: fixture('business-domain-valid.json'),
    decisionOwnerActorId: 'owner-input-expand-001',
  };
  const draft = {
    eventId: 'evt_input_expand_plan',
    timestamp: PLAN_TIME,
    correlationId: 'corr_input_expand_plan',
  };
  const first = planOperatingRuntimeIntelligenceBoardV2(runtimeRequest, draft, {
    initialState: derived.state,
    artifactStore: base.store,
  });
  const expanded = structuredClone(first.state);
  const challenger = expanded.assignments.find(({ roleId }) => roleId === 'independent-challenge');
  challenger.inputArtifactIds = [...challenger.inputArtifactIds, 'art_expanded_predecessor_001'];
  assert.throws(
    () =>
      planOperatingRuntimeIntelligenceBoardV2(clone(runtimeRequest), clone(draft), {
        initialState: expanded,
        artifactStore: base.store,
      }),
    { code: 'STATE_TRANSITION_INVALID' },
  );
});

test('intelligence board replay rejects tampered role versions and rubrics', () => {
  const { base, request, derived } = deltaCheckpoint('tamper_replay_001');
  const runtimeRequest = {
    ...request,
    deltaId: derived.delta.deltaId,
    focus: ['all'],
    domainDescriptor: fixture('business-domain-valid.json'),
    decisionOwnerActorId: 'owner-tamper-replay-001',
  };
  const draft = {
    eventId: 'evt_tamper_replay_plan',
    timestamp: PLAN_TIME,
    correlationId: 'corr_tamper_replay_plan',
  };
  const first = planOperatingRuntimeIntelligenceBoardV2(runtimeRequest, draft, {
    initialState: derived.state,
    artifactStore: base.store,
  });
  const tamperedVersion = structuredClone(first.state);
  tamperedVersion.assignments[0].roleVersion = '9.9.9';
  assert.throws(
    () =>
      planOperatingRuntimeIntelligenceBoardV2(clone(runtimeRequest), clone(draft), {
        initialState: tamperedVersion,
        artifactStore: base.store,
      }),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  const tamperedRubric = structuredClone(first.state);
  tamperedRubric.assignments[0].analysisRubric = {
    ...tamperedRubric.assignments[0].analysisRubric,
    requiredQuestions: ['Hostile rubric rewrite.'],
  };
  assert.throws(
    () =>
      planOperatingRuntimeIntelligenceBoardV2(clone(runtimeRequest), clone(draft), {
        initialState: tamperedRubric,
        artifactStore: base.store,
      }),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  const claimTarget = first.state.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'advisor',
  );
  const claimRequest = {
    assignmentId: claimTarget.assignmentId,
    actor: { actorId: 'agent-checkpoint-001', kind: 'agent', runtime: 'codex' },
  };
  const claimDraft = {
    claimId: 'claim_checkpoint_tamper_001',
    submissionId: 'sub_checkpoint_tamper_001',
    eventIds: {
      claimed: 'evt_checkpoint_tamper_claimed',
      started: 'evt_checkpoint_tamper_started',
    },
    timestamp: PLAN_TIME,
    correlationId: 'corr_checkpoint_tamper_001',
  };
  assert.throws(
    () =>
      claimOperatingAssignmentV2(claimRequest, claimDraft, {
        initialState: tamperedRubric,
        capabilities: ['operate.assignment.claim'],
      }),
    { code: 'STATE_TRANSITION_INVALID' },
    'checkpoint rubric tampering is refused before claim',
  );
  const tamperedMandate = structuredClone(first.state);
  const mandateTarget = tamperedMandate.assignments.find(
    ({ assignmentId }) => assignmentId === claimTarget.assignmentId,
  );
  mandateTarget.mandate = {
    ...mandateTarget.mandate,
    scope: 'Hostile schema-valid mandate rewrite.',
  };
  assert.throws(
    () =>
      claimOperatingAssignmentV2(claimRequest, claimDraft, {
        initialState: tamperedMandate,
        capabilities: ['operate.assignment.claim'],
      }),
    { code: 'STATE_TRANSITION_INVALID' },
    'checkpoint mandate tampering is refused before claim',
  );
});
