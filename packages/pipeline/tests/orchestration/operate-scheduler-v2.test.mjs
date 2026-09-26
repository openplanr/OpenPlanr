import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertOperatingValidatedDependencyProofV2,
  deriveOperatingAssignmentReleaseIntentsV2,
  deriveOperatingIntelligenceAssignmentIdV2,
  validateOperatingAssignmentGraphV2,
  validateOperatingIntelligenceAssignmentGraphV2,
} from '../../lib/operate/scheduler-v2.mjs';
import {
  acceptOperatingAssignmentSubmissionV2,
  createEmptyOperatingRuntimeStateV2,
  createOperatingRuntimeEventV2,
  scheduleOperatingRuntimeEventsV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const TIME = '2026-08-08T10:00:00.000Z';

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
import { intelligenceAssignmentFieldsV2 } from '../helpers/intelligence-assignment-fixture.mjs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );

function assignment({
  assignmentId,
  cycleId = 'cyc_00000001',
  state = 'pending',
  dependsOn = [],
  dependencyPolicy = { kind: 'none' },
  terminalOutcome = null,
} = {}) {
  return {
    kind: 'operating-assignment',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    assignmentId,
    cycleId,
    assignmentKind: 'context-capture',
    roleId: `role-${assignmentId}`,
    objective: 'Produce one bounded result.',
    state,
    dependsOn,
    dependencyPolicy,
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
      maxBytes: 1024,
    },
    capabilityGrantId: `grant-${assignmentId}`,
    governedOperationId: null,
    attemptPolicy: { maxAttempts: 2, attempt: state === 'running' ? 1 : 0, timeoutMs: 300000 },
    claim: ['claimed', 'running', 'submitted', 'validated', 'rejected', 'failed'].includes(state)
      ? {
          actorId: 'agent-001',
          actorKind: 'agent',
          runtime: 'portable',
          claimId: `claim-${assignmentId}`,
        }
      : null,
    terminalOutcome,
    createdAt: TIME,
    availableAt: [
      'available',
      'claimed',
      'running',
      'submitted',
      'validated',
      'rejected',
      'abandoned',
      'failed',
    ].includes(state)
      ? TIME
      : null,
    completedAt: ['validated', 'abandoned', 'failed'].includes(state) ? TIME : null,
  };
}

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

function runtimeState(overrides = {}) {
  return { ...createEmptyOperatingRuntimeStateV2(TIME), cycles: [cycle()], ...overrides };
}

function acceptedProofRecords(target, seed = '001') {
  const artifact = {
    kind: 'operating-artifact',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    artifactId: `art_scheduler_${seed}`,
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
    createdAt: TIME,
  };
  const submission = {
    kind: 'operating-submission',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    submissionId: `sub_scheduler_${seed}`,
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
    issuedAt: TIME,
    resolvedAt: TIME,
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

test('OP-12/INV-WF-005: scheduler validates a graph and releases pending work in stable Assignment-ID order', () => {
  const assignments = [
    assignment({ assignmentId: 'asg_00000003' }),
    assignment({ assignmentId: 'asg_00000001' }),
    assignment({ assignmentId: 'asg_00000002' }),
  ];
  assert.equal(validateOperatingAssignmentGraphV2(assignments).size, 3);
  const intents = deriveOperatingAssignmentReleaseIntentsV2({ assignments });
  assert.deepEqual(
    intents.map(({ assignmentId }) => assignmentId),
    ['asg_00000001', 'asg_00000002', 'asg_00000003'],
  );
  assert.deepEqual(
    intents.map(({ dependencyProofs }) => dependencyProofs),
    [[], [], []],
  );
  assert.equal(new Set(intents.map(({ releaseId }) => releaseId)).size, 3);
});

test('LIVE-EVIDENCE: scheduler admits only the Protocol 2.0 ingestion exception to ordinary verification Outcomes', () => {
  const verification = {
    ...assignment({ assignmentId: 'asg_liveevidence00000001' }),
    assignmentKind: 'verification',
    capabilityGrantId: 'cgr_liveevidence00000001',
    governedOperationId: 'op_liveevidence00000001',
    outputContract: {
      schemaId: 'operating-live-evidence-ingestion',
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 65_536,
    },
  };
  assert.equal(validateOperatingAssignmentGraphV2([verification]).size, 1);
  assert.throws(() =>
    validateOperatingAssignmentGraphV2([
      {
        ...verification,
        outputContract: { ...verification.outputContract, schemaVersion: '1.0.0' },
      },
    ]),
  );
  assert.throws(() =>
    validateOperatingAssignmentGraphV2([
      {
        ...verification,
        outputContract: {
          ...verification.outputContract,
          schemaId: 'operating-evidence-observation',
        },
      },
    ]),
  );
});

test('INV-WF-005/006: an intelligence plan compiles to one exact ordinary Assignment per selected role', () => {
  const plan = fixture('intelligence-plan-valid.json');
  const ids = Object.fromEntries(
    plan.selectedRoles.map((role) => [
      role.roleId,
      deriveOperatingIntelligenceAssignmentIdV2(plan.planId, role.roleId, role.roleVersion),
    ]),
  );
  const assignments = plan.selectedRoles.map((role) => ({
    ...assignment({
      assignmentId: ids[role.roleId],
      dependsOn: role.dependsOnRoleIds.map((roleId) => ids[roleId]).sort(),
      dependencyPolicy:
        role.dependsOnRoleIds.length === 0 ? { kind: 'none' } : { kind: 'all-required' },
    }),
    assignmentKind: role.roleKind,
    roleId: role.roleId,
    roleVersion: role.roleVersion,
    ...intelligenceAssignmentFieldsV2(),
    inputArtifactIds: [...role.inputArtifactIds],
    intelligenceContext: {
      intelligencePlanId: plan.planId,
      snapshotId: plan.snapshotId,
      scopeId: plan.scopeId,
      domainId: plan.domainId,
      domainVersion: plan.domainVersion,
      sourceArtifactId: plan.sourceArtifactId,
      sourceArtifactIds: [...role.inputArtifactIds].sort(),
      evidenceRefIds: [],
      inputBundle: {
        bundleId: `ibd_scheduler_${role.roleId}_0001`,
        bundleArtifactId: role.inputArtifactIds[0],
        bundleRawHash: `sha256:${'1'.repeat(64)}`,
        bundleCanonicalHash: `sha256:${'2'.repeat(64)}`,
        sourceArtifactIds: [...role.inputArtifactIds].sort(),
        issuedEvidence: [],
      },
      decisionOwnerActorId: plan.decisionOwnerActorId,
    },
    outputContract: {
      schemaId: role.outputContract.schemaId,
      schemaVersion: role.outputContract.schemaVersion,
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262144,
    },
  }));
  assert.equal(validateOperatingIntelligenceAssignmentGraphV2(plan, assignments).size, 3);
  const missingChairInput = structuredClone(assignments);
  missingChairInput.find(({ roleId }) => roleId === 'chair').inputArtifactIds = [];
  assert.throws(() => validateOperatingIntelligenceAssignmentGraphV2(plan, missingChairInput), {
    code: 'STATE_TRANSITION_INVALID',
  });

  const craftedPlan = structuredClone(plan);
  craftedPlan.selectedRoles.find(({ roleId }) => roleId === 'chair').dependsOnRoleIds = ['advisor'];
  const craftedAssignments = structuredClone(assignments);
  craftedAssignments.find(({ roleId }) => roleId === 'chair').dependsOn = [ids.advisor];
  assert.throws(
    () => validateOperatingIntelligenceAssignmentGraphV2(craftedPlan, craftedAssignments),
    {
      code: 'STATE_TRANSITION_INVALID',
    },
  );

  const advisor = {
    ...structuredClone(assignments[0]),
    state: 'validated',
    availableAt: TIME,
    completedAt: TIME,
  };
  const proof = acceptedProofRecords(advisor, 'topology');
  assert.throws(
    () =>
      deriveOperatingAssignmentReleaseIntentsV2({
        assignments: [advisor, assignments[1], craftedAssignments[2]],
        submissions: [proof.submission],
        artifacts: [proof.artifact],
        submissionReplayIndex: [proof.replay],
        intelligencePlans: [plan],
      }),
    { code: 'STATE_TRANSITION_INVALID' },
    'persisted plan validation prevents an early Chair release',
  );
});

test('OP-12/13: threshold accepts only declared terminal absences and carries exact Artifact/absence proofs', () => {
  const validated = assignment({ assignmentId: 'asg_00000001', state: 'validated' });
  const abandoned = assignment({
    assignmentId: 'asg_00000002',
    state: 'abandoned',
    terminalOutcome: {
      outcome: 'abandoned',
      eventId: 'evt-abandoned-001',
      code: 'timeout',
      reason: 'The bounded advisor window elapsed.',
      recoveryDisposition: 'continue-partial',
    },
  });
  const chair = assignment({
    assignmentId: 'asg_00000003',
    dependsOn: [validated.assignmentId, abandoned.assignmentId],
    dependencyPolicy: {
      kind: 'threshold',
      minimumSatisfied: 2,
      allowedTerminalOutcomes: ['abandoned'],
    },
  });
  const proof = acceptedProofRecords(validated);
  const submissions = [proof.submission];
  const artifacts = [proof.artifact];
  const submissionReplayIndex = [proof.replay];
  const [intent] = deriveOperatingAssignmentReleaseIntentsV2({
    assignments: [chair, abandoned, validated],
    submissions,
    artifacts,
    submissionReplayIndex,
  });
  assert.equal(intent.assignmentId, chair.assignmentId);
  assert.deepEqual(
    intent.dependencyProofs.map(({ outcome }) => outcome),
    ['validated', 'abandoned'],
  );
  assert.equal(intent.dependencyProofs[0].artifactId, proof.artifact.artifactId);
  assert.equal(intent.dependencyProofs[1].absence.code, 'timeout');

  chair.dependencyPolicy.allowedTerminalOutcomes = [];
  assert.deepEqual(
    deriveOperatingAssignmentReleaseIntentsV2({
      assignments: [validated, abandoned, chair],
      submissions,
      artifacts,
      submissionReplayIndex,
    }),
    [],
  );
});

test('OP-12/13: exact durable proof binding rejects foreign identity, contract, claim, hash, and replay mismatches', () => {
  const validated = {
    ...assignment({ assignmentId: 'asg_proof_target', state: 'validated' }),
    assignmentKind: 'advisor',
    roleId: 'strategy-finance',
    ...intelligenceAssignmentFieldsV2(),
    inputArtifactIds: ['art_proof_input_0001', 'art_proof_input_0002'],
    intelligenceContext: {
      intelligencePlanId: 'ipl_proof_target_0001',
      snapshotId: 'snp_proof_target_0001',
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      sourceArtifactId: 'art_proof_input_0001',
      sourceArtifactIds: ['art_proof_input_0001'],
      evidenceRefIds: ['evr_proof_target_0001'],
      inputBundle: {
        bundleId: 'ibd_proof_target_0001',
        bundleArtifactId: 'art_proof_input_0001',
        bundleRawHash: `sha256:${'1'.repeat(64)}`,
        bundleCanonicalHash: `sha256:${'2'.repeat(64)}`,
        sourceArtifactIds: ['art_proof_input_0001'],
        issuedEvidence: [
          {
            requirementId: 'test-evidence-requirement',
            evidenceRefId: 'evr_proof_target_0001',
            evidenceArtifactId: 'art_proof_input_0002',
            rawHash: `sha256:${'3'.repeat(64)}`,
            canonicalHash: null,
            classification: 'internal',
            freshness: 'current',
          },
        ],
      },
      decisionOwnerActorId: 'owner-proof-target-001',
    },
    outputContract: {
      schemaId: 'operating-advisor-result',
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262144,
    },
  };
  const proof = acceptedProofRecords(validated, 'adversarial');
  assert.deepEqual(assertOperatingValidatedDependencyProofV2({ assignment: validated, ...proof }), {
    assignmentId: validated.assignmentId,
    outcome: 'validated',
    eventId: proof.submission.acceptanceEventIds.at(-1),
    artifactId: proof.artifact.artifactId,
  });
  for (const [label, mutate] of [
    [
      'foreign Artifact Assignment',
      (value) => {
        value.artifact.assignmentId = 'asg_foreign_0001';
      },
    ],
    [
      'foreign Artifact Cycle',
      (value) => {
        value.artifact.cycleId = 'cyc_foreign_0001';
      },
    ],
    [
      'raw-hash mismatch',
      (value) => {
        value.artifact.rawHash = `sha256:${'b'.repeat(64)}`;
      },
    ],
    [
      'canonical-hash mismatch',
      (value) => {
        value.artifact.canonicalHash = `sha256:${'c'.repeat(64)}`;
      },
    ],
    [
      'byte ceiling mismatch',
      (value) => {
        value.artifact.sizeBytes = validated.outputContract.maxBytes + 1;
        value.submission.sizeBytes = value.artifact.sizeBytes;
        value.submission.responseData.sizeBytes = value.artifact.sizeBytes;
        value.replay.sizeBytes = value.artifact.sizeBytes;
        value.replay.responseData.sizeBytes = value.artifact.sizeBytes;
      },
    ],
    [
      'missing issued Artifact input',
      (value) => {
        value.artifact.inputArtifactIds = ['art_proof_input_0001'];
      },
    ],
    [
      'reordered issued Artifact inputs',
      (value) => {
        value.artifact.inputArtifactIds.reverse();
      },
    ],
    [
      'foreign Artifact scope',
      (value) => {
        value.artifact.scopeId = 'scope-foreign';
      },
    ],
    [
      'foreign Artifact domain',
      (value) => {
        value.artifact.domainId = 'software';
      },
    ],
    [
      'foreign Artifact domain version',
      (value) => {
        value.artifact.domainVersion = '9.9.9';
      },
    ],
    [
      'missing retained claim',
      (value) => {
        value.assignment = { ...validated, claim: null };
      },
    ],
    [
      'producer actor mismatch',
      (value) => {
        value.artifact.producer.actorId = 'agent-foreign';
      },
    ],
    [
      'producer runtime mismatch',
      (value) => {
        value.artifact.producer.runtime = 'runtime-foreign';
      },
    ],
    [
      'producer role mismatch',
      (value) => {
        value.artifact.producer.roleId = 'role-foreign';
      },
    ],
    [
      'replay mismatch',
      (value) => {
        value.replay.artifactId = 'art_foreign_replay';
      },
    ],
  ]) {
    const hostile = structuredClone(proof);
    mutate(hostile);
    assert.throws(
      () => assertOperatingValidatedDependencyProofV2({ assignment: validated, ...hostile }),
      {
        code: 'STATE_TRANSITION_INVALID',
      },
      label,
    );
  }
});

test('INV-WF-005/006: duplicate, unknown, cross-cycle, self, cyclic, and malformed policies fail before a transaction can return state', () => {
  const base = assignment({ assignmentId: 'asg_00000001' });
  const invalidGraphs = [
    [base, structuredClone(base)],
    [
      assignment({
        assignmentId: 'asg_00000002',
        dependsOn: ['asg_missing01'],
        dependencyPolicy: { kind: 'all-required' },
      }),
    ],
    [
      base,
      assignment({
        assignmentId: 'asg_00000002',
        cycleId: 'cyc_other0001',
        dependsOn: [base.assignmentId],
        dependencyPolicy: { kind: 'all-required' },
      }),
    ],
    [
      assignment({
        assignmentId: 'asg_00000003',
        dependsOn: ['asg_00000003'],
        dependencyPolicy: { kind: 'all-required' },
      }),
    ],
    [
      assignment({
        assignmentId: 'asg_00000004',
        dependsOn: ['asg_00000005'],
        dependencyPolicy: { kind: 'all-required' },
      }),
      assignment({
        assignmentId: 'asg_00000005',
        dependsOn: ['asg_00000004'],
        dependencyPolicy: { kind: 'all-required' },
      }),
    ],
    [
      assignment({
        assignmentId: 'asg_00000006',
        dependsOn: ['asg_00000007'],
        dependencyPolicy: { kind: 'threshold', minimumSatisfied: 2, allowedTerminalOutcomes: [] },
      }),
      assignment({ assignmentId: 'asg_00000007' }),
    ],
  ];
  for (const graph of invalidGraphs) assert.throws(() => validateOperatingAssignmentGraphV2(graph));

  const initial = runtimeState();
  const before = sha256Jcs(initial);
  const malformed = assignment({
    assignmentId: 'asg_00000008',
    dependsOn: ['asg_missing02'],
    dependencyPolicy: { kind: 'all-required' },
  });
  const source = createOperatingRuntimeEventV2({
    eventId: 'evt-create-invalid',
    timestamp: TIME,
    cycleId: malformed.cycleId,
    type: 'assignment.created',
    entityId: malformed.assignmentId,
    actor: { kind: 'engine', id: 'openplanr' },
    causationId: null,
    correlationId: 'corr-invalid',
    payload: malformed,
  });
  assert.throws(() => scheduleOperatingRuntimeEventsV2([source], { initialState: initial }));
  assert.equal(sha256Jcs(initial), before);
});

test('OP-12/13: a scheduler transaction appends its one deterministic release Event and identical retry is effect-free', () => {
  const initial = runtimeState();
  const created = assignment({ assignmentId: 'asg_00000001' });
  const source = createOperatingRuntimeEventV2({
    eventId: 'evt-create-001',
    timestamp: TIME,
    cycleId: created.cycleId,
    type: 'assignment.created',
    entityId: created.assignmentId,
    actor: { kind: 'engine', id: 'openplanr' },
    causationId: null,
    correlationId: 'corr-create',
    payload: created,
  });
  const first = scheduleOperatingRuntimeEventsV2([source], { initialState: initial });
  assert.equal(first.releaseEvents.length, 1);
  assert.equal(first.events.length, 2);
  assert.equal(first.state.assignments[0].state, 'available');
  assert.equal(first.releaseEvents[0].payload.releaseId.startsWith('rel_'), true);

  const retry = scheduleOperatingRuntimeEventsV2([structuredClone(source)], {
    initialState: first.state,
  });
  assert.equal(retry.releaseEvents.length, 0);
  assert.equal(sha256Jcs(retry.state), sha256Jcs(first.state));
  assert.throws(() =>
    scheduleOperatingRuntimeEventsV2([first.releaseEvents[0]], { initialState: initial }),
  );
});

test('OP-13: accepted submission atomically commits the source truth and every newly-ready dependency release', () => {
  const source = assignment({ assignmentId: 'asg_00000001', state: 'running' });
  const dependent = assignment({
    assignmentId: 'asg_00000002',
    dependsOn: [source.assignmentId],
    dependencyPolicy: { kind: 'all-required' },
  });
  const submission = {
    kind: 'operating-submission',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    submissionId: 'sub_00000001',
    assignmentId: source.assignmentId,
    cycleId: source.cycleId,
    state: 'issued',
    rawHash: null,
    canonicalHash: null,
    sizeBytes: null,
    artifactId: null,
    acceptanceEventIds: [],
    responseData: null,
    issuedAt: TIME,
    resolvedAt: null,
  };
  const initial = runtimeState({ assignments: [source, dependent], submissions: [submission] });
  const request = {
    assignmentId: source.assignmentId,
    submissionId: submission.submissionId,
    mediaType: 'application/json',
    encoding: 'utf-8',
    contentBase64: intelligenceSubmissionBase64('context-capture'),
    actor: { actorId: 'agent-001', kind: 'agent', runtime: 'portable' },
  };
  const draft = {
    artifactId: 'art_00000001',
    artifactType: 'cycle-evidence',
    inputArtifactIds: [],
    timestamp: TIME,
    validatorVersion: '1.0.0',
    correlationId: 'corr-submit',
    eventIds: {
      submitted: 'evt-submit-001',
      artifactCreated: 'evt-artifact-001',
      validated: 'evt-validated-001',
    },
  };
  const accepted = acceptOperatingAssignmentSubmissionV2(request, draft, { initialState: initial });
  assert.equal(accepted.events.length, 4);
  assert.equal(accepted.events.at(-1).type, 'assignment.available');
  assert.equal(accepted.events.at(-1).payload.assignmentId, dependent.assignmentId);
  assert.equal(
    accepted.state.assignments.find(({ assignmentId }) => assignmentId === dependent.assignmentId)
      .state,
    'available',
  );
  assert.equal(Object.hasOwn(accepted.response, 'releasedAssignmentIds'), false);
  const replay = acceptOperatingAssignmentSubmissionV2(request, draft, {
    initialState: accepted.state,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.events.length, 0);
});
