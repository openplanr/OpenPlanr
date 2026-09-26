import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runOperatingIntelligenceJourneyV2 } from '../../conformance/verify-operate-v2-operating-intelligence.mjs';
import { assertOperateExperienceTransportView } from '../../lib/dashboard/operate-experience-reader.mjs';
import { createOperatingApprovalRequirementV2 } from '../../lib/operate/approvals-v2.mjs';
import {
  applyOperateExperienceLivePatchV2,
  buildOperateExperienceLivePatchV2,
  buildOperateExperienceViewV2,
  createOperateExperiencePreviewV1,
  createOperateExperienceReplayCheckpointV2,
  rankOperateAttentionV2,
} from '../../lib/operate/experience-projection-v2.mjs';
import { createOperatingGovernedExecutionRuntimeV2 } from '../../lib/operate/governed-execution-v2.mjs';
import {
  buildOperatingRollbackPlanV2,
  createOperatingGovernedRecoveryRuntimeV2,
  reconcileOperatingGovernedDispatchV2,
  recordOperatingRollbackPlanV2,
} from '../../lib/operate/governed-recovery-v2.mjs';
import {
  deriveOperatingChairLedgerIdV2,
  deriveOperatingRoleLocalClaimIdV2,
} from '../../lib/operate/intelligence-output-identities-v2.mjs';
import {
  derivePersistentOperatingActionRevisionHashV2,
  promotePersistentOperatingActionAuthorityV2,
} from '../../lib/operate/persistent-work-v2.mjs';
import {
  assertOperatingDeliveryRouteRevisionV1,
  buildOperatingDeliveryEvidenceV1,
  buildOperatingPlanningProposalV1,
  confirmOperatingPlanningProposalV1,
  createOperatingDeliveryRouteV1,
  createOperatingOriginV1,
} from '../../lib/operate/planning-bridge-v2.mjs';
import { evaluateOperatingActionPolicyV2 } from '../../lib/operate/policy-v2.mjs';
import {
  createDisposableLocalProjectTargetV2,
  OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
} from '../../lib/operate/reference-governed-executors-v2.mjs';
import {
  computeOperatingRuntimeEventHashV2,
  deriveOperatingSnapshotRuntimeHashV2,
  OPERATING_EXECUTION_EFFECT_SUMMARIES_V2,
  readOperatingArtifactRawBytesV2,
  readOperatingReviewV2,
  reconstructOperatingVerificationPlanActionV2,
  submitOperatingReviewV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { assertProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  readOperateExperienceViewV1,
  readOperatingDeliveryEvidenceV1,
  readOperatingOriginV1,
  readOperatingPlanningProposalV1,
} from '../../lib/protocol/loader.mjs';
import { intelligenceAssignmentFieldsV2 } from '../helpers/intelligence-assignment-fixture.mjs';
import {
  createGovernedExecutionCheckpointStore,
  governedExecutionScenario,
  reduceDirectResultTransaction,
} from './operate-governed-execution-v2.test.mjs';
import { governedRollbackDraft } from './operate-governed-rollback-v2.test.mjs';

const root = new URL('../../conformance/fixtures/operating-runtime-v2/', import.meta.url);
const base = JSON.parse(await readFile(new URL('all-contracts-valid.json', root), 'utf8'));
const persistent = JSON.parse(await readFile(new URL('persistent-work-valid.json', root), 'utf8'));
const authorization = JSON.parse(await readFile(new URL('authorization-valid.json', root), 'utf8'));
const verification = JSON.parse(
  await readFile(new URL('action-verification-valid.json', root), 'utf8'),
);
const evidenceFixture = JSON.parse(
  await readFile(new URL('evidence-contracts-valid.json', root), 'utf8'),
);

function clone(value) {
  return structuredClone(value);
}
function makeEvent(
  {
    eventId,
    timestamp,
    cycleId,
    type,
    entityId,
    actor,
    causationId = null,
    correlationId,
    requestHash = undefined,
    payload,
  },
  previous = null,
) {
  const event = {
    kind: 'operating-event',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    eventId,
    sequence: previous ? previous.sequence + 1 : 1,
    timestamp,
    cycleId,
    type,
    entityId,
    actor: clone(actor),
    causationId,
    correlationId,
    previousEventHash: previous?.eventHash ?? null,
    ...(requestHash === undefined ? {} : { requestHash }),
    payload: clone(payload),
  };
  event.eventHash = computeOperatingRuntimeEventHashV2(event);
  assertProtocolArtifact('operating-event', event, { protocolVersion: '2.0.0' });
  return event;
}
function replayEntry(event) {
  return {
    eventId: event.eventId,
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
    ...(event.requestHash === undefined ? {} : { requestHash: event.requestHash }),
    ...(event.type === 'review.submitted'
      ? {
          receiptProjection: clone(event.payload.receiptProjection),
        }
      : {}),
  };
}
function bindEvents(state, events) {
  state.eventReplayIndex = events.map(replayEntry);
  state.eventHead =
    events.length > 0
      ? { sequence: events.at(-1).sequence, hash: events.at(-1).eventHash }
      : { sequence: 0, hash: null };
}
function rechainEvents(state, sourceEvents) {
  const events = clone(sourceEvents);
  for (let index = 0; index < events.length; index += 1) {
    events[index].sequence = index + 1;
    events[index].previousEventHash = index === 0 ? null : events[index - 1].eventHash;
    events[index].eventHash = computeOperatingRuntimeEventHashV2(events[index]);
  }
  bindEvents(state, events);
  return events;
}
function seedExecutionAuthorityEvents(scenario) {
  const finalAction = scenario.initial.actions[0];
  finalAction.updatedAt = '2026-08-10T08:02:00Z';
  const before = clone(finalAction);
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
  const promoted = { ...clone(finalAction), state: 'proposed', updatedAt: before.createdAt };
  const authority = {
    actionKind: clone(finalAction.actionKind),
    requestedCapability: clone(finalAction.requestedCapability),
    targetBinding: clone(finalAction.targetBinding),
    effectClass: finalAction.effectClass,
    preconditionArtifactIds: clone(finalAction.preconditionArtifactIds),
    executionBinding: clone(finalAction.executionBinding),
    updatedAt: promoted.updatedAt,
  };
  const changeSet = {
    ...clone(persistent.changeSet),
    cycleId: finalAction.sourceCycleId,
    scopeId: finalAction.scopeId,
    domainId: finalAction.domainId,
    domainVersion: finalAction.domainVersion,
    findings: [],
    decisions: [],
    actions: [],
  };
  const events = [];
  const append = (input) => {
    const event = makeEvent(input, events.at(-1) ?? null);
    events.push(event);
    return event;
  };
  const work = append({
    eventId: `evt_${scenario.draft.operationId.slice(3)}_work`,
    timestamp: before.createdAt,
    cycleId: finalAction.sourceCycleId,
    type: 'work-change-set.materialized',
    entityId: finalAction.sourceArtifactId,
    actor: { kind: 'engine', id: 'openplanr' },
    correlationId: scenario.draft.correlationId,
    payload: {
      artifactId: finalAction.sourceArtifactId,
      canonicalHash: sha256Jcs(changeSet),
      changeSet,
      findings: [],
      decisions: [],
      actions: [before],
    },
  });
  const promotion = append({
    eventId: `evt_${scenario.draft.operationId.slice(3)}_promotion`,
    timestamp: promoted.updatedAt,
    cycleId: finalAction.sourceCycleId,
    type: 'action.authority-promoted',
    entityId: finalAction.actionId,
    actor: { kind: 'engine', id: 'openplanr' },
    causationId: work.eventId,
    correlationId: scenario.draft.correlationId,
    requestHash: sha256Jcs({
      contract: 'operating-action-authority-promotion-v2',
      before,
      authority,
    }),
    payload: { before, authority, action: promoted },
  });
  const evaluation = [...scenario.initial.policyEvaluations]
    .filter(
      (candidate) =>
        candidate.action.actionId === finalAction.actionId &&
        candidate.action.revision === finalAction.revision &&
        candidate.action.actionHash === finalAction.actionHash,
    )
    .sort(
      (left, right) =>
        left.evaluatedAt.localeCompare(right.evaluatedAt) ||
        left.evaluationId.localeCompare(right.evaluationId),
    )
    .at(-1);
  const policy = append({
    eventId: `evt_${scenario.draft.operationId.slice(3)}_policy`,
    timestamp: evaluation.evaluatedAt,
    cycleId: finalAction.sourceCycleId,
    type: 'policy.evaluated',
    entityId: evaluation.evaluationId,
    actor: { kind: 'runtime', id: 'openplanr' },
    causationId: promotion.eventId,
    correlationId: scenario.draft.correlationId,
    requestHash: evaluation.inputHash,
    payload: evaluation,
  });
  let previous = policy;
  const approval = scenario.initial.approvalRecords.find(
    (candidate) => candidate.evaluationId === evaluation.evaluationId,
  );
  if (approval) {
    previous = append({
      eventId: `evt_${scenario.draft.operationId.slice(3)}_approval`,
      timestamp: approval.issuedAt,
      cycleId: finalAction.sourceCycleId,
      type: 'approval.recorded',
      entityId: approval.approvalId,
      actor: { kind: approval.actor.kind, id: approval.actor.actorId },
      causationId: policy.eventId,
      correlationId: scenario.draft.correlationId,
      payload: approval,
    });
  }
  append({
    eventId: `evt_${scenario.draft.operationId.slice(3)}_approved`,
    timestamp: finalAction.updatedAt,
    cycleId: finalAction.sourceCycleId,
    type: 'action.approved',
    entityId: finalAction.actionId,
    actor: { kind: 'engine', id: 'openplanr' },
    causationId: previous.eventId,
    correlationId: scenario.draft.correlationId,
    payload: {
      action: {
        actionId: finalAction.actionId,
        revision: finalAction.revision,
        actionHash: finalAction.actionHash,
      },
      from: 'proposed',
      to: 'approved',
      operationId: null,
      resultId: null,
      reasonCode: null,
    },
  });
  bindEvents(scenario.initial, events);
  return events;
}
function confirmationFor(proposal, confirmedAt, overrides = {}) {
  return {
    actorId: proposal.actor.actorId,
    proposalRevision: proposal.revision,
    proposalHash: proposal.proposalHash,
    eventHead: clone(proposal.eventHead),
    previewDigest: proposal.preview.digest,
    confirmedAt,
    ...overrides,
  };
}

function makeArtifact(
  artifactId,
  assignmentId,
  roleId,
  schemaId,
  rawHash,
  domainId,
  canonicalHash = rawHash,
  inputArtifactIds = [],
) {
  return {
    ...clone(base['operating-artifact']),
    artifactId,
    assignmentId,
    domainId,
    artifactType: `${roleId}-result`,
    schemaId,
    artifactSchemaVersion: '2.0.0',
    rawHash,
    canonicalHash,
    sizeBytes: 1024,
    producer: { actorId: `${roleId}-agent`, roleId, runtime: 'codex' },
    inputArtifactIds,
  };
}

function makeState(domainId = 'business') {
  const state = clone(base['operating-runtime-state']);
  const cycle = { ...clone(base['operating-cycle']), domainId, state: 'approved' };
  const scope = { scopeId: cycle.scopeId, domainId, domainVersion: cycle.domainVersion };
  const contextArtifactId = 'art_context_00000001';
  const snapshotId = 'snp_planning_00000001';
  const planId = 'ipl_planning_00000001';
  const roleRows = [
    ['advisor', 'advisor', 'asg_00000011', 'art_00000011'],
    ['challenger', 'challenger', 'asg_00000012', 'art_00000012'],
    ['chair', 'chair', 'asg_00000013', 'art_00000013'],
  ];
  const outputSchemaByKind = {
    advisor: 'operating-advisor-result',
    challenger: 'operating-challenger-review',
    chair: 'operating-decision-ledger',
  };
  const chairArtifactId = roleRows[2][3];
  const decision = {
    ...clone(persistent.decision),
    domainId,
    sourceArtifactId: chairArtifactId,
    state: 'approved',
    outcome: 'Create Planning work for the accepted retention priority.',
    reopenConditions: [...persistent.decision.revisitConditions],
  };
  const evidenceRefId = evidenceFixture['operating-evidence-ref'].evidenceRefId;
  const advisorValue = {
    kind: 'operating-advisor-result',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    intelligencePlanId: planId,
    snapshotId,
    ...scope,
    claimIds: [deriveOperatingRoleLocalClaimIdV2(roleRows[0][2])],
    evidenceRefIds: [evidenceRefId],
    alternatives: ['Create a bounded retention workflow.'],
    assumptionIds: [],
    uncertainty: 'Adoption remains uncertain.',
    downside: 'The workflow adds operating overhead.',
    reversibility: 'The workflow can be retired after the measurement window.',
  };
  const challengerValue = {
    kind: 'operating-challenger-review',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    intelligencePlanId: planId,
    snapshotId,
    ...scope,
    advisorArtifactIds: [roleRows[0][3]],
    reviewedClaimIds: [...advisorValue.claimIds],
    independentClaimIds: [deriveOperatingRoleLocalClaimIdV2(roleRows[1][2])],
    supportingEvidenceRefIds: [],
    contradictingEvidenceRefIds: [evidenceRefId],
    missingAlternatives: ['Observe retention before automating.'],
    uncertainty: 'The available observation window is narrow.',
    downside: 'Automation can hide weak adoption.',
    reversibility: 'Keep the first workflow reversible.',
    dissent: ['Challenge retention assumptions before delivery.'],
  };
  const chairDecision = {
    title: decision.title,
    question: decision.question,
    outcome: decision.outcome,
    rationale: decision.rationale,
    evidenceRefIds: [...decision.evidenceRefIds],
    alternatives: [...decision.alternatives],
    confidence: decision.confidence,
    assumptionIds: [...decision.assumptionIds],
    upside: decision.expectedUpside,
    downside: decision.expectedDownside,
    uncertainty: 'Retention evidence remains bounded.',
    reversibility: 'Revisit after the declared verification window.',
    ownerActorId: decision.ownerActorId,
    revisitConditions: [...decision.revisitConditions],
    actionHypotheses: [],
  };
  const chairValue = {
    kind: 'operating-decision-ledger',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    ledgerId: deriveOperatingChairLedgerIdV2(roleRows[2][2]),
    ...scope,
    snapshotId,
    intelligencePlanId: planId,
    advisorArtifactIds: [roleRows[0][3]],
    challengerArtifactId: roleRows[1][3],
    advisorAbsenceGaps: [],
    decisions: [chairDecision],
    dissent: [...decision.dissent],
    sourceArtifactId: contextArtifactId,
    createdAt: '2026-08-11T07:59:00Z',
  };
  const roleValues = [advisorValue, challengerValue, chairValue];
  const acceptedOutputs = roleRows.map(([roleKind, roleId, assignmentId, artifactId], index) => ({
    assignmentId,
    artifactId,
    roleId,
    roleKind,
    sourceArtifactValue: roleValues[index],
  }));
  const assignments = roleRows.map(([kind, roleId, assignmentId], index) => ({
    ...clone(base['operating-assignment']),
    assignmentId,
    assignmentKind: kind,
    roleId,
    cycleId: cycle.cycleId,
    ...intelligenceAssignmentFieldsV2(),
    state: 'validated',
    dependsOn: index === 0 ? [] : roleRows.slice(0, index).map(([, , id]) => id),
    dependencyPolicy: index === 0 ? { kind: 'none' } : { kind: 'all-required' },
    completedAt: '2026-08-11T07:59:00Z',
    inputArtifactIds: [
      contextArtifactId,
      ...roleRows.slice(0, index).map(([, , , artifactId]) => artifactId),
    ],
    inputAbsences: [],
    outputContract: {
      schemaId: outputSchemaByKind[kind],
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262144,
    },
    capabilityGrantId: null,
    governedOperationId: null,
    intelligenceContext: {
      intelligencePlanId: planId,
      snapshotId,
      ...scope,
      sourceArtifactId: contextArtifactId,
      sourceArtifactIds: [contextArtifactId],
      evidenceRefIds: [evidenceRefId],
      decisionOwnerActorId: 'owner-001',
      inputBundle: {
        bundleId: `ibd_experience_${roleId}_0001`,
        bundleArtifactId: contextArtifactId,
        bundleRawHash: `sha256:${'1'.repeat(64)}`,
        bundleCanonicalHash: `sha256:${'1'.repeat(64)}`,
        sourceArtifactIds: [contextArtifactId],
        issuedEvidence: [],
      },
    },
    claim: {
      actorId: `${roleId}-agent`,
      actorKind: 'agent',
      runtime: 'codex',
      claimId: `claim-${roleId}`,
    },
  }));
  const artifacts = roleRows.map(([kind, roleId, assignmentId, artifactId], index) => {
    const hash = sha256Jcs(roleValues[index]);
    return makeArtifact(
      artifactId,
      assignmentId,
      roleId,
      outputSchemaByKind[kind],
      hash,
      domainId,
      hash,
      [
        contextArtifactId,
        ...roleRows.slice(0, index).map(([, , , priorArtifactId]) => priorArtifactId),
      ],
    );
  });
  const submissions = roleRows.map(([, , assignmentId, artifactId], index) => ({
    ...clone(base['operating-submission']),
    submissionId: `sub_0000001${index + 1}`,
    assignmentId,
    cycleId: cycle.cycleId,
    state: 'accepted',
    rawHash: artifacts[index].rawHash,
    canonicalHash: artifacts[index].canonicalHash,
    artifactId,
    sizeBytes: artifacts[index].sizeBytes,
    responseData: { accepted: true, artifactId },
    acceptanceEventIds: [`evt-accepted-01${index + 1}`],
  }));
  const chair = artifacts[2];
  const contextArtifact = {
    ...clone(base['operating-artifact']),
    artifactId: contextArtifactId,
    assignmentId: 'asg_context_00000001',
    cycleId: cycle.cycleId,
    ...scope,
    rawHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    canonicalHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  };
  const evidenceArtifact = artifacts[0];
  const action = {
    ...clone(authorization.action),
    domainId,
    sourceArtifactId: chair.artifactId,
    sourceDecisionId: decision.decisionId,
    verificationPlanId: 'vfy_verify_00000001',
    metricId: 'met_00000001',
    state: 'approved',
  };
  action.actionHash = derivePersistentOperatingActionRevisionHashV2(action);
  const evidenceRef = {
    ...clone(evidenceFixture['operating-evidence-ref']),
    domainId,
    sourceArtifactId: chair.artifactId,
    evidenceArtifactId: evidenceArtifact.artifactId,
    evidenceArtifactRawHash: evidenceArtifact.rawHash,
    evidenceArtifactCanonicalHash: evidenceArtifact.canonicalHash,
  };
  const snapshot = {
    ...clone(base['operating-snapshot']),
    ...scope,
    snapshotId,
    stateId: 'oms_planning_00000001',
    sourceArtifactIds: [contextArtifactId],
    evidenceRefIds: [evidenceRef.evidenceRefId],
    sourceRevisions: [
      {
        sourceArtifactId: contextArtifactId,
        revision: contextArtifact.rawHash,
        evidenceRefIds: [evidenceRef.evidenceRefId],
      },
    ],
    createdAt: '2026-08-11T07:57:00Z',
  };
  snapshot.runtimeHash = deriveOperatingSnapshotRuntimeHashV2(snapshot);
  const intelligencePlan = {
    ...clone(base['operating-intelligence-plan']),
    ...scope,
    planId,
    snapshotId,
    sourceArtifactId: contextArtifactId,
    decisionOwnerActorId: 'owner-001',
    selectedRoles: roleRows.map(([roleKind, roleId], index) => ({
      roleId,
      roleKind,
      roleVersion: '2.0.0',
      inputArtifactIds: [contextArtifactId],
      outputContract: { schemaId: outputSchemaByKind[roleKind], schemaVersion: '2.0.0' },
      dependsOnRoleIds: index === 0 ? [] : roleRows.slice(0, index).map(([prior]) => prior),
      reason: 'Required planning context.',
    })),
    omittedRoles: [],
    challengerRequired: true,
  };
  const verificationPlan = {
    ...clone(verification.verificationPlan),
    domainId,
    actionId: action.actionId,
    sourceArtifactId: chair.artifactId,
    baseline: action.baseline,
    target: action.target,
    window: action.verificationWindow,
  };
  Object.assign(state, {
    generatedAt: '2026-08-11T08:00:00Z',
    cycles: [cycle],
    assignments,
    submissions,
    decisions: [decision],
    actions: [action],
    artifacts: [...artifacts, contextArtifact],
    evidenceRefs: [evidenceRef],
    evidenceResolutions: [],
    evidenceEdges: [],
    evidenceResolutionReplayIndex: [],
    operatingSnapshots: [snapshot],
    intelligencePlans: [intelligencePlan],
    inputBindings: [
      {
        ...clone(base['operating-cycle-input-binding']),
        cycleId: cycle.cycleId,
        scopeId: cycle.scopeId,
        domainId,
        domainVersion: cycle.domainVersion,
        sourceArtifactIds: [chair.artifactId],
      },
    ],
    metrics: [{ ...clone(base['operating-metric']), domainId, metricId: action.metricId }],
    verificationPlans: [verificationPlan],
    outcomes: [],
    learnings: [],
    claims: [],
  });
  const inputBinding = state.inputBindings[0];
  const events = [
    makeEvent({
      eventId: 'evt-001',
      timestamp: inputBinding.capturedAt,
      cycleId: cycle.cycleId,
      type: 'cycle.input-bound',
      entityId: inputBinding.inputBindingId,
      actor: { kind: 'engine', id: 'openplanr' },
      correlationId: 'corr-001',
      payload: {
        inputBindingId: inputBinding.inputBindingId,
        scopeId: cycle.scopeId,
        domainId: cycle.domainId,
        domainVersion: cycle.domainVersion,
        contractVersions: clone(cycle.contractVersions),
      },
    }),
  ];
  bindEvents(state, events);
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: '2.0.0' });
  return {
    state,
    events,
    cycle,
    chair,
    evidenceArtifact,
    decision,
    action,
    evidenceRef,
    verificationPlan,
    acceptedOutputs,
  };
}

function makePlanningJourney() {
  const journey = runOperatingIntelligenceJourneyV2('business', {
    includeContext: true,
    stopAfterAction: true,
  });
  const { state, artifactStore, action, decision, verificationPlan, verificationPlanEvent } =
    journey.context;
  const approvedDecision = {
    ...clone(decision),
    state: 'approved',
    updatedAt: state.generatedAt,
  };
  const authorityTemplate = authorization.action;
  const governedAction = promotePersistentOperatingActionAuthorityV2(action, {
    actionKind: clone(authorityTemplate.actionKind),
    requestedCapability: clone(authorityTemplate.requestedCapability),
    targetBinding: clone(authorityTemplate.targetBinding),
    effectClass: authorityTemplate.effectClass,
    preconditionArtifactIds: [approvedDecision.sourceArtifactId],
    executionBinding: clone(authorityTemplate.executionBinding),
    updatedAt: state.generatedAt,
  });
  const recoveredPlanningInput = reconstructOperatingVerificationPlanActionV2({
    state,
    event: verificationPlanEvent,
  });
  state.decisions = state.decisions.map((candidate) =>
    candidate.decisionId === approvedDecision.decisionId ? approvedDecision : candidate,
  );
  state.actions = state.actions.map((candidate) =>
    candidate.actionId === governedAction.actionId ? clone(governedAction) : candidate,
  );
  state.metrics = [clone(recoveredPlanningInput.metric)];
  const roleAssignments = state.assignments.filter(
    ({ assignmentKind, state: assignmentState }) =>
      ['advisor', 'challenger', 'chair'].includes(assignmentKind) &&
      assignmentState === 'validated',
  );
  const parseArtifact = (artifact) =>
    JSON.parse(
      Buffer.from(
        readOperatingArtifactRawBytesV2(artifactStore, {
          artifactId: artifact.artifactId,
          rawHash: artifact.rawHash,
        }),
      ).toString('utf8'),
    );
  const acceptedOutputs = roleAssignments.map((assignment) => {
    const submission = state.submissions.find(
      (candidate) =>
        candidate.assignmentId === assignment.assignmentId && candidate.state === 'accepted',
    );
    const artifact = state.artifacts.find(({ artifactId }) => artifactId === submission.artifactId);
    const bundleArtifact = state.artifacts.find(
      ({ artifactId }) =>
        artifactId === assignment.intelligenceContext.inputBundle.bundleArtifactId,
    );
    return {
      assignmentId: assignment.assignmentId,
      artifactId: artifact.artifactId,
      roleId: assignment.roleId,
      roleKind: assignment.assignmentKind,
      sourceArtifactValue: parseArtifact(artifact),
      inputBundleValue: parseArtifact(bundleArtifact),
    };
  });
  return {
    state,
    action: governedAction,
    decision: approvedDecision,
    verificationPlan,
    verificationPlanEvent,
    acceptedOutputs,
    chair: state.artifacts.find(({ artifactId }) => artifactId === decision.sourceArtifactId),
  };
}

function makeFidelityState() {
  const fixture = makeState();
  const scopeFields = {
    scopeId: fixture.cycle.scopeId,
    domainId: fixture.cycle.domainId,
    domainVersion: fixture.cycle.domainVersion,
  };
  const metric = {
    ...clone(base['operating-metric']),
    ...scopeFields,
    metricId: fixture.action.metricId,
    observationIds: ['mob_fidelity_0001', 'mob_fidelity_0002'],
    evidenceRefIds: [fixture.evidenceRef.evidenceRefId],
    sourceArtifactId: fixture.evidenceArtifact.artifactId,
    updatedAt: '2026-08-11T07:59:00Z',
  };
  const priorSnapshot = {
    ...clone(base['operating-snapshot']),
    ...scopeFields,
    snapshotId: 'snp_fidelity_0001',
    stateId: 'oms_fidelity_0001',
    sourceArtifactIds: [fixture.evidenceArtifact.artifactId],
    evidenceRefIds: [fixture.evidenceRef.evidenceRefId],
    createdAt: '2026-08-10T08:00:00Z',
  };
  const currentSnapshot = {
    ...clone(priorSnapshot),
    snapshotId: 'snp_fidelity_0002',
    stateId: 'oms_fidelity_0002',
    previousSnapshotId: priorSnapshot.snapshotId,
    createdAt: '2026-08-11T07:59:00Z',
  };
  const priorObservation = {
    ...clone(base['operating-metric-observation']),
    ...scopeFields,
    observationId: metric.observationIds[0],
    metricId: metric.metricId,
    value: 0.72,
    snapshotId: priorSnapshot.snapshotId,
    evidenceRefIds: [fixture.evidenceRef.evidenceRefId],
    sourceArtifactId: fixture.evidenceArtifact.artifactId,
    observedAt: priorSnapshot.createdAt,
  };
  const currentObservation = {
    ...clone(priorObservation),
    observationId: metric.observationIds[1],
    value: 0.82,
    snapshotId: currentSnapshot.snapshotId,
    observedAt: currentSnapshot.createdAt,
  };
  const delta = {
    ...clone(base['operating-delta']),
    ...scopeFields,
    deltaId: 'dlt_fidelity_0001',
    priorSnapshotId: priorSnapshot.snapshotId,
    currentSnapshotId: currentSnapshot.snapshotId,
    metricChanges: [
      {
        subjectId: metric.metricId,
        kind: 'changed',
        evidenceRefIds: [fixture.evidenceRef.evidenceRefId],
      },
    ],
    sourceArtifactId: fixture.evidenceArtifact.artifactId,
    derivedAt: currentSnapshot.createdAt,
  };
  const claim = {
    ...clone(base['operating-claim']),
    ...scopeFields,
    claimId: 'clm_fidelity_0001',
    statement: 'Retention is below target.',
    supportingEvidenceRefIds: [fixture.evidenceRef.evidenceRefId],
    sourceArtifactId: fixture.evidenceArtifact.artifactId,
  };
  const evidenceResolution = {
    ...clone(base['operating-evidence-resolution']),
    ...scopeFields,
    resolutionId: 'evs_fidelity_0001',
    candidateId: fixture.evidenceRef.candidateId,
    evidenceKind: fixture.evidenceRef.evidenceKind,
    provider: clone(fixture.evidenceRef.provider),
    resolver: clone(fixture.evidenceRef.resolver),
    evidenceRefId: fixture.evidenceRef.evidenceRefId,
    evidenceArtifactId: fixture.evidenceRef.evidenceArtifactId,
    sourceArtifactId: fixture.evidenceRef.sourceArtifactId,
  };
  const evidenceEdge = {
    ...clone(base['operating-evidence-edge']),
    ...scopeFields,
    edgeId: 'eve_fidelity_0001',
    localClaimId: 'local-claim-fidelity-0001',
    evidenceRefId: fixture.evidenceRef.evidenceRefId,
    sourceArtifactId: fixture.evidenceArtifact.artifactId,
  };
  const outcome = {
    ...clone(base['operating-outcome']),
    ...scopeFields,
    outcomeId: 'out_fidelity_0001',
    actionId: fixture.action.actionId,
    verificationPlanId: fixture.verificationPlan.verificationPlanId,
    observationIds: [currentObservation.observationId],
    evidenceRefIds: [fixture.evidenceRef.evidenceRefId],
    sourceArtifactId: fixture.evidenceArtifact.artifactId,
    observedAt: currentObservation.observedAt,
  };
  const learning = {
    ...clone(base['operating-learning']),
    ...scopeFields,
    learningId: 'lrn_fidelity_0001',
    outcomeId: outcome.outcomeId,
    decisionIds: [fixture.decision.decisionId],
    evidenceRefIds: [fixture.evidenceRef.evidenceRefId],
    sourceArtifactId: fixture.evidenceArtifact.artifactId,
  };
  fixture.events.push(
    makeEvent(
      {
        eventId: 'evt-fidelity-002',
        cycleId: fixture.cycle.cycleId,
        type: 'decision.revised',
        entityId: fixture.decision.decisionId,
        timestamp: '2026-08-11T07:59:30Z',
        actor: { kind: 'human', id: 'owner-001' },
        causationId: 'evt-001',
        correlationId: 'corr-fidelity',
        requestHash: sha256Jcs({ kind: 'decision', record: fixture.decision }),
        payload: {
          snapshotId: currentSnapshot.snapshotId,
          stateId: currentSnapshot.stateId,
          record: clone(fixture.decision),
        },
      },
      fixture.events[0],
    ),
  );
  bindEvents(fixture.state, fixture.events);
  fixture.state.metrics = [metric];
  fixture.state.metricObservations = [priorObservation, currentObservation];
  fixture.state.operatingSnapshots = [priorSnapshot, currentSnapshot];
  fixture.state.deltas = [delta];
  fixture.state.claims = [claim];
  fixture.state.evidenceResolutions = [evidenceResolution];
  fixture.state.evidenceEdges = [evidenceEdge];
  fixture.state.outcomes = [outcome];
  fixture.state.learnings = [learning];
  fixture.state.assignments[0] = {
    ...fixture.state.assignments[0],
    state: 'available',
    claim: null,
    inputArtifactIds: [fixture.evidenceArtifact.artifactId],
    availableAt: '2026-08-11T07:58:00Z',
    completedAt: null,
  };
  fixture.state.generatedAt = '2026-08-11T08:00:00Z';
  assertProtocolArtifact('operating-runtime-state', fixture.state, { protocolVersion: '2.0.0' });
  const checkpoint = {
    ...clone(base['operating-checkpoint']),
    createdAt: fixture.state.generatedAt,
    eventHead: { ...clone(fixture.state.eventHead), protocolVersions: ['2.0.0'] },
    runtimeStateHash: sha256Jcs(fixture.state),
    eventReplayIndexHash: sha256Jcs(fixture.state.eventReplayIndex),
  };
  assertProtocolArtifact('operating-checkpoint', checkpoint, { protocolVersion: '2.0.0' });
  return {
    ...fixture,
    metric,
    priorObservation,
    currentObservation,
    priorSnapshot,
    currentSnapshot,
    delta,
    claim,
    outcome,
    learning,
    checkpoint,
  };
}

function makeParityState({
  cycle,
  events,
  reviews = [],
  inputBindings = [],
  approvalRequirements = [],
}) {
  const state = clone(base['operating-runtime-state']);
  for (const [field, value] of Object.entries(state)) {
    if (Array.isArray(value)) state[field] = [];
  }
  Object.assign(state, {
    generatedAt: '2026-08-11T08:05:00Z',
    cycles: [clone(cycle)],
    reviews: clone(reviews),
    inputBindings: clone(inputBindings),
  });
  if (approvalRequirements.length > 0)
    Object.assign(state, {
      actionPolicies: [],
      policyEvaluations: [],
      approvalRequirements: clone(approvalRequirements),
      approvalRecords: [],
      capabilityAvailability: [],
      capabilityGrants: [],
      governedOperations: [],
      executionResults: [],
      rollbackPlans: [],
      rollbackResults: [],
      operationReplayIndex: [],
    });
  bindEvents(state, events);
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: '2.0.0' });
  return state;
}

function projectParityState(
  state,
  events,
  actorId = 'owner-001',
  checkpoint = null,
  checkpointState = null,
) {
  const cycle = state.cycles[0];
  return buildOperateExperienceViewV2(state, {
    scope: { scopeId: cycle.scopeId, domainId: cycle.domainId, domainVersion: cycle.domainVersion },
    actor: { actorId, accessLevel: 'internal' },
    deliveryRoutes: [],
    allowedActions: [],
    events,
    checkpoint,
    checkpointState,
  });
}

test('Event-only replay remains readable but cannot overclaim byte-exact current-state parity', () => {
  const reviewCreatedAt = '2026-08-11T08:01:00Z';
  const reviewSubmittedAt = '2026-08-11T08:02:00Z';
  const approvedAt = '2026-08-11T08:03:00Z';
  const approvedCycle = {
    ...clone(base['operating-cycle']),
    state: 'approved',
    activeReviewId: null,
    updatedAt: approvedAt,
  };
  const createdReview = {
    ...clone(base['operating-review']),
    createdAt: reviewCreatedAt,
    updatedAt: reviewCreatedAt,
  };
  const reviewCreatedEvent = makeEvent({
    eventId: 'evt-parity-review-created',
    timestamp: reviewCreatedAt,
    cycleId: approvedCycle.cycleId,
    type: 'review.created',
    entityId: createdReview.reviewId,
    actor: { kind: 'engine', id: 'openplanr' },
    correlationId: 'corr-parity-complete',
    payload: createdReview,
  });
  const awaitingCycle = {
    ...clone(base['operating-cycle']),
    state: 'awaiting_review',
    activeReviewId: createdReview.reviewId,
    updatedAt: reviewCreatedAt,
  };
  const preSubmitState = makeParityState({
    cycle: awaitingCycle,
    events: [reviewCreatedEvent],
    reviews: [createdReview],
  });
  const reviewReadRequest = {
    reviewId: createdReview.reviewId,
    cycleId: awaitingCycle.cycleId,
    actor: { actorId: createdReview.ownerActorId, kind: 'human', runtime: 'portable' },
    scope: {
      scopeId: awaitingCycle.scopeId,
      domainId: awaitingCycle.domainId,
      domainVersion: awaitingCycle.domainVersion,
    },
  };
  const reviewRead = readOperatingReviewV2(reviewReadRequest, {
    initialState: preSubmitState,
    capabilities: ['operate.review.get'],
    readAt: reviewSubmittedAt,
  });
  const rejectedChoice = reviewRead.data.dispositionChoices.find(
    ({ submitArguments }) => submitArguments.disposition === 'rejected',
  );
  const reviewSubmission = submitOperatingReviewV2(
    rejectedChoice.submitArguments,
    {
      eventId: 'evt-parity-review-submitted',
      timestamp: reviewSubmittedAt,
      correlationId: 'corr-parity-complete',
    },
    {
      initialState: preSubmitState,
      capabilities: [{ id: 'operate-review-submit', version: '2.0.0' }],
    },
  );
  const [reviewSubmittedEvent] = reviewSubmission.events;
  const approvedEvent = makeEvent(
    {
      eventId: 'evt-parity-cycle-approved',
      timestamp: approvedAt,
      cycleId: approvedCycle.cycleId,
      type: 'cycle.approved',
      entityId: approvedCycle.cycleId,
      actor: { kind: 'engine', id: 'openplanr' },
      causationId: reviewSubmittedEvent.eventId,
      correlationId: 'corr-parity-complete',
      payload: {
        cycleId: approvedCycle.cycleId,
        from: 'awaiting_review',
        to: 'approved',
        actionId: null,
        operationId: null,
        resultId: null,
        reasonCode: null,
      },
    },
    reviewSubmittedEvent,
  );

  const coveredReview = clone(reviewSubmission.state.reviews[0]);
  const fullyCoveredEvents = [reviewCreatedEvent, reviewSubmittedEvent, approvedEvent];
  const fullyCovered = makeParityState({
    cycle: approvedCycle,
    events: fullyCoveredEvents,
    reviews: [coveredReview],
  });
  assert.equal(
    projectParityState(fullyCovered, fullyCoveredEvents).replay.parityProof.stateParityVerified,
    false,
    'Cycle lifecycle Events do not bind every Cycle byte or runtime-state generatedAt',
  );

  const exactCheckpoint = {
    ...clone(base['operating-checkpoint']),
    createdAt: fullyCovered.generatedAt,
    eventHead: { ...clone(fullyCovered.eventHead), protocolVersions: ['2.0.0'] },
    runtimeStateHash: sha256Jcs(fullyCovered),
    eventReplayIndexHash: sha256Jcs(fullyCovered.eventReplayIndex),
  };
  assertProtocolArtifact('operating-checkpoint', exactCheckpoint, { protocolVersion: '2.0.0' });
  assert.equal(
    projectParityState(fullyCovered, fullyCoveredEvents, 'owner-001', exactCheckpoint).replay
      .parityProof.stateParityVerified,
    true,
    'only an exact validated checkpoint proves current-state parity',
  );
  const forgedCheckpoint = {
    ...clone(exactCheckpoint),
    runtimeStateHash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  };
  assert.throws(
    () => projectParityState(fullyCovered, fullyCoveredEvents, 'owner-001', forgedCheckpoint),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );

  const retainedCheckpoint = createOperateExperienceReplayCheckpointV2(preSubmitState);
  const exactBaseView = projectParityState(
    preSubmitState,
    [],
    'owner-001',
    retainedCheckpoint,
    preSubmitState,
  );
  assert.equal(exactBaseView.eventHead.sequence, preSubmitState.eventHead.sequence);
  assert.equal(exactBaseView.replay.parityProof.stateParityVerified, true);
  const retainedTailView = projectParityState(
    fullyCovered,
    [reviewSubmittedEvent, approvedEvent],
    'owner-001',
    retainedCheckpoint,
    preSubmitState,
  );
  assert.equal(retainedTailView.eventHead.sequence, fullyCovered.eventHead.sequence);
  assert.equal(retainedTailView.replay.tail.eventCount, 2);
  assert.equal(
    retainedTailView.replay.parityProof.stateParityVerified,
    false,
    'a contiguous retained tail remains readable without overclaiming byte-exact final-state parity',
  );
  const relabeledTailState = clone(fullyCovered);
  relabeledTailState.generatedAt = '2026-08-11T08:06:30Z';
  const relabeledTailView = projectParityState(
    relabeledTailState,
    [reviewSubmittedEvent, approvedEvent],
    'owner-001',
    retainedCheckpoint,
    preSubmitState,
  );
  assert.equal(
    relabeledTailView.replay.parityProof.stateParityVerified,
    false,
    'a retained base never certifies caller-relabeled final-state bytes',
  );
  assert.throws(
    () => projectParityState(fullyCovered, [], 'owner-001', retainedCheckpoint, preSubmitState),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
    'a checkpoint may not erase a retained tail',
  );
  assert.throws(
    () =>
      projectParityState(
        fullyCovered,
        [approvedEvent],
        'owner-001',
        retainedCheckpoint,
        preSubmitState,
      ),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
    'a retained tail must start immediately after the checkpoint',
  );
  const substitutedBase = clone(preSubmitState);
  substitutedBase.generatedAt = '2026-08-11T08:01:30Z';
  assert.throws(
    () =>
      projectParityState(
        fullyCovered,
        [reviewSubmittedEvent, approvedEvent],
        'owner-001',
        retainedCheckpoint,
        substitutedBase,
      ),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
    'checkpoint hash must bind the exact retained base bytes',
  );

  const unprovedFieldMutations = [
    [
      'inputBindingId',
      (state) => {
        state.cycles[0].inputBindingId = 'inb_substituted_0001';
      },
    ],
    [
      'contractVersions',
      (state) => {
        state.cycles[0].contractVersions = { 'advisor-result': '9.9.9' };
      },
    ],
    [
      'focus',
      (state) => {
        state.cycles[0].focus = ['substituted-focus'];
      },
    ],
    [
      'health',
      (state) => {
        state.cycles[0].health = 'quiet';
      },
    ],
    [
      'activeReviewId',
      (state) => {
        state.cycles[0].activeReviewId = 'rev_substituted_0001';
      },
    ],
    [
      'createdAt',
      (state) => {
        state.cycles[0].createdAt = '2026-08-10T07:00:00Z';
      },
    ],
    [
      'closedAt',
      (state) => {
        state.cycles[0].closedAt = '2026-08-11T08:03:00Z';
      },
    ],
    [
      'generatedAt',
      (state) => {
        state.generatedAt = '2026-08-11T08:06:00Z';
      },
    ],
  ];
  for (const [field, mutate] of unprovedFieldMutations) {
    const changed = clone(fullyCovered);
    mutate(changed);
    const readable = projectParityState(changed, fullyCoveredEvents);
    assert.equal(readable.cycles.length, 1, `${field} remains readable`);
    assert.equal(
      readable.replay.parityProof.stateParityVerified,
      false,
      `${field} is not Event-proven`,
    );
  }
  for (const [field, mutate] of [
    [
      'scopeId',
      (state) => {
        state.cycles[0].scopeId = 'scope-substituted';
      },
    ],
    [
      'domainId',
      (state) => {
        state.cycles[0].domainId = 'business-substituted';
      },
    ],
    [
      'domainVersion',
      (state) => {
        state.cycles[0].domainVersion = '2.0.0';
      },
    ],
  ]) {
    const changed = clone(fullyCovered);
    mutate(changed);
    assert.throws(
      () => projectParityState(changed, fullyCoveredEvents),
      { code: 'OPERATING_SCOPE_INVALID' },
      `${field} is now proven by the exact owner Review receipt projection`,
    );
  }

  const conflictingReview = clone(fullyCovered);
  conflictingReview.reviews[0].ownerActorId = 'owner-substituted';
  assert.throws(() => projectParityState(conflictingReview, fullyCoveredEvents), {
    code: 'E_OPERATE_BINDING_MISMATCH',
  });
  const conflictingCycleState = clone(fullyCovered);
  conflictingCycleState.cycles[0].state = 'executing';
  assert.throws(() => projectParityState(conflictingCycleState, fullyCoveredEvents), {
    code: 'E_OPERATE_BINDING_MISMATCH',
  });
  const conflictingCycle = clone(fullyCovered);
  conflictingCycle.cycles[0].updatedAt = '2026-08-11T08:04:00Z';
  assert.throws(() => projectParityState(conflictingCycle, fullyCoveredEvents), {
    code: 'E_OPERATE_BINDING_MISMATCH',
  });

  const cycleOnlyApprovedEvent = makeEvent({
    eventId: 'evt-parity-cycle-only-approved',
    timestamp: approvedAt,
    cycleId: approvedCycle.cycleId,
    type: 'cycle.approved',
    entityId: approvedCycle.cycleId,
    actor: { kind: 'engine', id: 'openplanr' },
    correlationId: 'corr-parity-cycle-only',
    payload: {
      cycleId: approvedCycle.cycleId,
      from: 'awaiting_review',
      to: 'approved',
      actionId: null,
      operationId: null,
      resultId: null,
      reasonCode: null,
    },
  });

  const pendingReview = clone(base['operating-review']);
  const missingReviewCreation = makeParityState({
    cycle: approvedCycle,
    events: [cycleOnlyApprovedEvent],
    reviews: [pendingReview],
  });
  assert.equal(
    projectParityState(missingReviewCreation, [cycleOnlyApprovedEvent]).replay.parityProof
      .stateParityVerified,
    false,
    'a pending Review without review.created coverage cannot claim parity',
  );

  const binding = clone(base['operating-cycle-input-binding']);
  const inputOnlyCycle = { ...approvedCycle, inputBindingId: binding.inputBindingId };
  const inputOnlyReview = { ...pendingReview, cycleId: inputOnlyCycle.cycleId };
  const inputEvent = makeEvent({
    eventId: 'evt-parity-input-only',
    timestamp: binding.capturedAt,
    cycleId: inputOnlyCycle.cycleId,
    type: 'cycle.input-bound',
    entityId: binding.inputBindingId,
    actor: { kind: 'engine', id: 'openplanr' },
    correlationId: 'corr-parity-input-only',
    payload: {
      inputBindingId: binding.inputBindingId,
      scopeId: inputOnlyCycle.scopeId,
      domainId: inputOnlyCycle.domainId,
      domainVersion: inputOnlyCycle.domainVersion,
      contractVersions: clone(inputOnlyCycle.contractVersions),
    },
  });
  const inputOnly = makeParityState({
    cycle: inputOnlyCycle,
    events: [inputEvent],
    reviews: [inputOnlyReview],
    inputBindings: [binding],
  });
  assert.equal(
    projectParityState(inputOnly, [inputEvent]).replay.parityProof.stateParityVerified,
    false,
    'cycle.input-bound alone cannot prove an approved Cycle or its pending Review',
  );

  const requirement = {
    ...clone(base['operating-approval-requirement']),
    scopeId: approvedCycle.scopeId,
    domainId: approvedCycle.domainId,
    domainVersion: approvedCycle.domainVersion,
    expiresAt: '2026-08-12T08:00:00Z',
  };
  const orphanRequirement = makeParityState({
    cycle: approvedCycle,
    events: [cycleOnlyApprovedEvent],
    approvalRequirements: [requirement],
  });
  const orphanView = projectParityState(orphanRequirement, [cycleOnlyApprovedEvent], 'owner-0001');
  assert.equal(
    orphanView.inbox.some(({ itemId }) => itemId === `approval:${requirement.requirementId}`),
    true,
  );
  assert.equal(
    orphanView.replay.parityProof.stateParityVerified,
    false,
    'an approval requirement without canonical Event coverage cannot claim parity',
  );

  const empty = clone(base['operating-runtime-state']);
  for (const [field, value] of Object.entries(empty)) if (Array.isArray(value)) empty[field] = [];
  empty.generatedAt = '2026-08-11T08:07:00Z';
  bindEvents(empty, []);
  assertProtocolArtifact('operating-runtime-state', empty, { protocolVersion: '2.0.0' });
  const emptyView = buildOperateExperienceViewV2(empty, {
    scope: { scopeId: 'scope-empty', domainId: 'business', domainVersion: '1.0.0' },
    actor: { actorId: 'owner-001', accessLevel: 'internal' },
    deliveryRoutes: [],
    allowedActions: [],
    events: [],
    checkpoint: null,
  });
  assert.deepEqual(emptyView.cycles, []);
  assert.equal(
    emptyView.replay.parityProof.stateParityVerified,
    false,
    'genesis replay has no Event that proves runtime-state generatedAt',
  );
});

test('approved Today, Cycle, Evidence, Outcome, and History fidelity is canonical and replay-safe', () => {
  const fixture = makeFidelityState();
  const scope = { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' };
  const route = createOperatingDeliveryRouteV1({
    state: fixture.state,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const assignmentAction = {
    tool: 'operate.assignment.claim',
    arguments: {
      assignmentId: fixture.state.assignments[0].assignmentId,
      actor: { actorId: 'owner-001', kind: 'human', runtime: 'codex' },
    },
    label: 'Claim the advisor Assignment',
    effect: 'machine-local-write',
  };
  const options = {
    scope,
    actor: { actorId: 'owner-001', accessLevel: 'internal' },
    deliveryRoutes: [route],
    events: fixture.events,
    checkpoint: fixture.checkpoint,
    allowedActions: [
      { subjectId: fixture.state.assignments[0].assignmentId, action: assignmentAction },
    ],
  };
  const view = buildOperateExperienceViewV2(fixture.state, options);
  assert.deepEqual(view.domainMetrics[0], {
    metricId: fixture.metric.metricId,
    title: fixture.metric.title,
    value: 0.82,
    unit: 'percent',
    change: {
      kind: 'changed',
      priorValue: 0.72,
      currentValue: 0.82,
      deltaValue: 0.09999999999999998,
      deltaId: fixture.delta.deltaId,
    },
    window: fixture.metric.window,
    freshness: 'current',
    state: 'current',
    target: fixture.metric.target,
    threshold: fixture.metric.threshold,
    evidenceRefIds: [fixture.evidenceRef.evidenceRefId],
    snapshot: {
      snapshotId: fixture.currentSnapshot.snapshotId,
      createdAt: fixture.currentSnapshot.createdAt,
    },
    delta: {
      deltaId: fixture.delta.deltaId,
      priorSnapshotId: fixture.priorSnapshot.snapshotId,
      currentSnapshotId: fixture.currentSnapshot.snapshotId,
      derivedAt: fixture.delta.derivedAt,
    },
    dueVerification: [
      {
        verificationPlanId: fixture.verificationPlan.verificationPlanId,
        actionId: fixture.action.actionId,
        state: fixture.outcome.status,
        dueAt: null,
        window: fixture.verificationPlan.window,
        deepLink: `#/operate/actions/${fixture.action.actionId}`,
      },
    ],
    accessReason: null,
  });
  const assignment = view.cycles[0].assignments.find(
    ({ assignmentId }) => assignmentId === fixture.state.assignments[0].assignmentId,
  );
  assert.deepEqual(assignment.next, { label: assignmentAction.label, tool: assignmentAction.tool });
  assert.equal(assignment.role, fixture.state.assignments[0].roleId);
  assert.ok(
    view.cycles[0].stages
      .find(({ id }) => id === 'understand')
      .outputArtifactIds.includes(fixture.evidenceArtifact.artifactId),
  );
  assert.deepEqual(view.cycles[0].persistentActionIds, [fixture.action.actionId]);
  assert.deepEqual(view.cycles[0].replayCheckpoint, view.replay.checkpoint);
  assert.equal(view.evidence[0].claimStatus, 'supported');
  assert.equal(view.evidence[0].source.provider.id, fixture.evidenceRef.provider.id);
  assert.equal(view.evidence[0].producer.roleId, fixture.evidenceArtifact.producer.roleId);
  assert.equal(view.evidence[0].provenance.rawHash, fixture.evidenceRef.evidenceArtifactRawHash);
  assert.equal(view.evidence[0].confidence, 0.9);
  assert.equal(view.claims[0].statement, fixture.claim.statement);
  assert.equal(view.claims[0].status, 'supported');
  assert.equal(view.outcomes[0].metric.observed, fixture.currentObservation.value);
  assert.equal(view.outcomes[0].metric.metricHash, sha256Jcs(fixture.metric));
  assert.equal(
    view.outcomes[0].verification.verificationPlanHash,
    sha256Jcs(fixture.verificationPlan),
  );
  assert.equal(view.outcomes[0].decision.decisionId, fixture.decision.decisionId);
  assert.deepEqual(view.outcomes[0].nextObservation, {
    ...fixture.verificationPlan.observationRequest,
    dueAt: null,
  });
  const decisionHistory = view.history.find(
    ({ entityId }) => entityId === fixture.decision.decisionId,
  );
  assert.equal(decisionHistory.change.summary, fixture.decision.title);
  assert.equal(decisionHistory.why, fixture.decision.rationale);
  assert.deepEqual(decisionHistory.prior, {
    previousEventHash: fixture.state.eventReplayIndex[0].eventHash,
    causationId: 'evt-001',
  });
  assert.equal(view.replay.liveAccessUsed, false);
  assert.equal(view.replay.parityProof.checkpointVerified, true);
  assert.equal(view.replay.parityProof.finalEventHashMatches, true);
  assert.equal(view.replay.parityProof.stateParityVerified, true);

  const permuted = clone(fixture.state);
  for (const key of [
    'assignments',
    'artifacts',
    'metrics',
    'metricObservations',
    'operatingSnapshots',
    'deltas',
    'claims',
    'evidenceRefs',
    'evidenceResolutions',
    'evidenceEdges',
    'outcomes',
    'learnings',
    'eventReplayIndex',
  ])
    permuted[key].reverse();
  permuted.eventReplayIndex.sort((left, right) => left.sequence - right.sequence);
  const permutedCheckpoint = {
    ...clone(fixture.checkpoint),
    runtimeStateHash: sha256Jcs(permuted),
    eventReplayIndexHash: sha256Jcs(permuted.eventReplayIndex),
  };
  const permutedRoute = createOperatingDeliveryRouteV1({
    state: permuted,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const permutedView = buildOperateExperienceViewV2(permuted, {
    ...options,
    deliveryRoutes: [permutedRoute],
    checkpoint: permutedCheckpoint,
  });
  for (const field of [
    'attention',
    'domainMetrics',
    'cycles',
    'inbox',
    'actions',
    'evidence',
    'claims',
    'rationale',
    'outcomes',
    'learnings',
    'history',
    'allowedActions',
    'omissions',
    'export',
  ]) {
    const normalized = (value) =>
      field === 'cycles' ? value.map((cycle) => ({ ...cycle, replayCheckpoint: null })) : value;
    assert.deepEqual(
      normalized(permutedView[field]),
      normalized(view[field]),
      `${field} must be invariant to valid source collection order`,
    );
  }

  const forgedCheckpoint = {
    ...clone(fixture.checkpoint),
    runtimeStateHash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  };
  assert.throws(
    () => buildOperateExperienceViewV2(fixture.state, { ...options, checkpoint: forgedCheckpoint }),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );
  for (const [collection, identity] of [
    ['metrics', 'Metric'],
    ['metricObservations', 'metric observation'],
    ['claims', 'Claim'],
    ['evidenceRefs', 'evidence reference'],
  ]) {
    const duplicate = clone(fixture.state);
    duplicate[collection].push(clone(duplicate[collection][0]));
    assert.throws(
      () => buildOperateExperienceViewV2(duplicate, { ...options, checkpoint: null }),
      (error) => error.code === 'RESULT_CONTRACT_INVALID' && error.message.includes(identity),
    );
  }

  const restricted = clone(fixture.state);
  const restrictedSentinels = [
    'PRIVATE-METRIC-TITLE',
    'PRIVATE-CLAIM',
    'PRIVATE-VERIFICATION-METHOD',
    'PRIVATE-HISTORY-RATIONALE',
  ];
  restricted.metrics[0].title = restrictedSentinels[0];
  restricted.claims[0].statement = restrictedSentinels[1];
  restricted.verificationPlans[0].method = restrictedSentinels[2];
  restricted.decisions[0].rationale = restrictedSentinels[3];
  const restrictedEvents = [
    clone(fixture.events[0]),
    makeEvent(
      {
        ...fixture.events[1],
        payload: { ...clone(fixture.events[1].payload), record: clone(restricted.decisions[0]) },
      },
      fixture.events[0],
    ),
  ];
  bindEvents(restricted, restrictedEvents);
  const restrictedRoute = createOperatingDeliveryRouteV1({
    state: restricted,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const publicView = buildOperateExperienceViewV2(restricted, {
    ...options,
    actor: { actorId: 'owner-001', accessLevel: 'public' },
    deliveryRoutes: [restrictedRoute],
    events: restrictedEvents,
    checkpoint: null,
  });
  const serialized = JSON.stringify(publicView);
  for (const sentinel of restrictedSentinels)
    assert.equal(serialized.includes(sentinel), false, sentinel);
  assert.equal(
    serialized.includes('lib/operate/runtime-foundation.mjs'),
    false,
    'raw evidence locators never cross the experience boundary',
  );
  assert.equal(publicView.domainMetrics[0].value, null);
  assert.equal(publicView.claims[0].statement, null);
  assert.equal(publicView.outcomes[0].verification.method, null);
  assert.equal(
    publicView.history.find(({ entityId }) => entityId === fixture.decision.decisionId).why,
    null,
  );
  assert.equal(
    publicView.history.find(({ entityId }) => entityId === fixture.decision.decisionId).actorId,
    null,
  );

  const withoutCheckpoint = makeFidelityState();
  const withoutCheckpointRoute = createOperatingDeliveryRouteV1({
    state: withoutCheckpoint.state,
    action: withoutCheckpoint.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const withoutCheckpointView = buildOperateExperienceViewV2(withoutCheckpoint.state, {
    ...options,
    events: withoutCheckpoint.events,
    deliveryRoutes: [withoutCheckpointRoute],
    checkpoint: null,
  });
  assert.equal(
    withoutCheckpointView.cycles[0].replayCheckpoint,
    null,
    'Snapshots are not replay checkpoints',
  );
  assert.equal(
    withoutCheckpointView.replay.parityProof.stateParityVerified,
    false,
    'partial Event coverage must not claim current-state parity',
  );

  const projectTampered = (state, events = fixture.events) => {
    const currentAction = state.actions.find(
      ({ actionId }) => actionId === fixture.action.actionId,
    );
    const currentRoute = createOperatingDeliveryRouteV1({
      state,
      action: currentAction,
      route: 'planning-work',
      rationale: 'Planning is required.',
    });
    return buildOperateExperienceViewV2(state, {
      ...options,
      events,
      deliveryRoutes: [currentRoute],
      checkpoint: null,
    });
  };
  for (const mutate of [
    (state) => {
      state.eventReplayIndex[1].actor.id = 'forged-private-actor';
    },
    (state) => {
      state.eventReplayIndex[1].entityId = 'dec_forged_entity';
    },
    (state) => {
      state.eventReplayIndex[1].payloadHash =
        'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    },
    (state) => {
      state.eventReplayIndex[1].previousEventHash =
        'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    },
    (state) => {
      state.eventHead.hash =
        'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    },
  ]) {
    const tampered = clone(fixture.state);
    mutate(tampered);
    assert.throws(() => projectTampered(tampered), { code: 'E_OPERATE_BINDING_MISMATCH' });
  }
  const forgedEvent = clone(fixture.events);
  forgedEvent[1].actor.id = 'forged-private-actor';
  assert.throws(() => projectTampered(fixture.state, forgedEvent), {
    code: 'E_OPERATE_BINDING_MISMATCH',
  });
  const forgedEntityEvents = [
    clone(fixture.events[0]),
    makeEvent(
      {
        ...fixture.events[1],
        entityId: 'dec_forged_entity',
      },
      fixture.events[0],
    ),
  ];
  const forgedEntityState = clone(fixture.state);
  bindEvents(forgedEntityState, forgedEntityEvents);
  assert.throws(() => projectTampered(forgedEntityState, forgedEntityEvents), {
    code: 'E_OPERATE_BINDING_MISMATCH',
  });
  const foreignPayloadEvents = [
    clone(fixture.events[0]),
    makeEvent(
      {
        ...fixture.events[1],
        payload: {
          ...clone(fixture.events[1].payload),
          record: { ...clone(fixture.events[1].payload.record), scopeId: 'scope-foreign' },
        },
      },
      fixture.events[0],
    ),
  ];
  const foreignPayloadState = clone(fixture.state);
  bindEvents(foreignPayloadState, foreignPayloadEvents);
  assert.throws(() => projectTampered(foreignPayloadState, foreignPayloadEvents), {
    code: 'OPERATING_SCOPE_INVALID',
  });

  for (const mutate of [
    (state) => {
      state.verificationPlans[0].metricId = 'met_substitute_0001';
      state.metrics.push({ ...clone(state.metrics[0]), metricId: 'met_substitute_0001' });
    },
    (state) => {
      state.verificationPlans[0].baseline += 0.01;
    },
    (state) => {
      state.metricObservations[1].metricId = 'met_substitute_0001';
      state.metrics.push({
        ...clone(state.metrics[0]),
        metricId: 'met_substitute_0001',
        observationIds: [state.metricObservations[1].observationId],
      });
    },
  ]) {
    const substituted = clone(fixture.state);
    mutate(substituted);
    assert.throws(() => projectTampered(substituted), { code: 'E_OPERATE_BINDING_MISMATCH' });
  }
  for (const mutate of [
    (state) => {
      state.evidenceRefs[0].sourceArtifactId = 'art_forged_source_0001';
    },
    (state) => {
      state.evidenceRefs[0].evidenceArtifactId = 'art_forged_evidence_001';
    },
    (state) => {
      state.evidenceRefs[0].evidenceArtifactRawHash =
        'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    },
    (state) => {
      state.evidenceRefs[0].evidenceArtifactCanonicalHash =
        'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    },
    (state) => {
      state.evidenceRefs[0].classification = 'public';
    },
  ]) {
    const substituted = clone(fixture.state);
    mutate(substituted);
    assert.throws(() => projectTampered(substituted), { code: 'E_OPERATE_BINDING_MISMATCH' });
  }
});

test('experience projection is deterministic, scope-bound, access-safe, and domain-neutral', () => {
  const business = makeState('business');
  const route = createOperatingDeliveryRouteV1({
    state: business.state,
    action: business.action,
    route: 'planning-work',
    rationale: 'Repository Planning work is required.',
  });
  const options = {
    scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
    actor: { actorId: 'owner-001', accessLevel: 'public' },
    deliveryRoutes: [route],
    events: business.events,
    allowedActions: [{ subjectId: business.cycle.cycleId, action: base['operate-allowed-action'] }],
  };
  const first = buildOperateExperienceViewV2(business.state, options);
  const second = buildOperateExperienceViewV2(business.state, options);
  assert.deepEqual(first, second);
  assert.equal(readOperateExperienceViewV1(first, { protocolVersion: '2.0.0' }), first);
  assert.throws(
    () =>
      readOperateExperienceViewV1({ ...first, status: 'partial' }, { protocolVersion: '2.0.0' }),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );
  assert.equal(first.evidence[0].accessState, 'restricted');
  assert.equal(first.evidence[0].evidenceKind, null);
  assert.equal(first.omissions[0].reason, 'access-denied');
  assert.equal(first.actions[0].deliveryRoute.route, 'planning-work');

  const software = makeState('software');
  const softwareRoute = createOperatingDeliveryRouteV1({
    state: software.state,
    action: software.action,
    route: 'planning-work',
    rationale: 'Repository Planning work is required.',
  });
  const softwareView = buildOperateExperienceViewV2(software.state, {
    ...options,
    scope: { ...options.scope, domainId: 'software' },
    deliveryRoutes: [softwareRoute],
    events: software.events,
  });
  assert.deepEqual(
    first.actions.map(({ title, state }) => ({ title, state })),
    softwareView.actions.map(({ title, state }) => ({ title, state })),
  );
});

test('restricted source Artifacts cannot leak through any user-visible projection string', () => {
  const fixture = makeState();
  const sentinels = {
    focus: 'LEAK-CYCLE-FOCUS',
    decisionTitle: 'LEAK-DECISION-TITLE',
    decisionConsequence: 'LEAK-DECISION-CONSEQUENCE',
    rationale: 'LEAK-DECISION-RATIONALE',
    actionTitle: 'LEAK-ACTION-TITLE',
    expectedResult: 'LEAK-ACTION-RESULT',
    route: 'LEAK-ROUTE-RATIONALE',
    learning: 'LEAK-LEARNING',
    allowedAction: 'LEAK-ALLOWED-ACTION',
  };
  fixture.chair.sensitivity = 'restricted';
  fixture.cycle.focus = [sentinels.focus];
  fixture.state.inputBindings[0] = {
    ...fixture.state.inputBindings[0],
    cycleId: fixture.cycle.cycleId,
    domainId: 'business',
    sourceArtifactIds: [fixture.chair.artifactId],
  };
  Object.assign(fixture.decision, {
    state: 'proposed',
    title: sentinels.decisionTitle,
    expectedDownside: sentinels.decisionConsequence,
    rationale: sentinels.rationale,
  });
  Object.assign(fixture.action, {
    title: sentinels.actionTitle,
    expectedResult: sentinels.expectedResult,
  });
  fixture.action.actionHash = derivePersistentOperatingActionRevisionHashV2(fixture.action);
  fixture.state.learnings = [
    {
      ...clone(base['operating-learning']),
      sourceArtifactId: fixture.chair.artifactId,
      statement: sentinels.learning,
    },
  ];
  const route = createOperatingDeliveryRouteV1({
    state: fixture.state,
    action: fixture.action,
    route: 'planning-work',
    rationale: sentinels.route,
  });
  const view = buildOperateExperienceViewV2(fixture.state, {
    scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
    actor: { actorId: 'owner-001', accessLevel: 'public' },
    deliveryRoutes: [route],
    events: fixture.events,
    allowedActions: [
      {
        subjectId: fixture.cycle.cycleId,
        action: { ...base['operate-allowed-action'], label: sentinels.allowedAction },
      },
    ],
  });
  const serialized = JSON.stringify(view);
  for (const sentinel of Object.values(sentinels))
    assert.equal(serialized.includes(sentinel), false, sentinel);
  assert.equal(view.cycles[0].focus[0], 'Restricted cycle focus');
  assert.equal(view.inbox.find(({ kind }) => kind === 'decision').title, 'Restricted Decision');
  assert.equal(
    view.inbox.find(({ kind }) => kind === 'decision').consequence,
    'Decision details are unavailable at this access level.',
  );
  assert.equal(view.actions[0].title, 'Restricted Action');
  assert.equal(
    view.actions[0].expectedResult,
    'Action details are unavailable at this access level.',
  );
  assert.equal(view.actions[0].ownerActorId, null);
  assert.equal(
    view.actions[0].deliveryRoute.rationale,
    'Route details are unavailable at this access level.',
  );
  assert.equal(
    view.learnings[0].statement,
    'Learning details are unavailable at this access level.',
  );
  assert.equal(view.allowedActions[0].action.label, 'Restricted action');
  assert.equal(
    view.rationale.some(({ artifactId }) => artifactId === fixture.chair.artifactId),
    false,
  );
  assert.ok(
    view.omissions.some(
      ({ classification, reason }) =>
        classification === 'restricted' && reason === 'body-never-projected',
    ),
  );
  assert.equal(view.history[0].actorId, null);
});

test('Cycle approval gates require exact complete scope-bound approval records', () => {
  const fixture = makeState();
  const scope = {
    scopeId: fixture.cycle.scopeId,
    domainId: fixture.cycle.domainId,
    domainVersion: fixture.cycle.domainVersion,
  };
  const actionIdentity = {
    actionId: fixture.action.actionId,
    revision: fixture.action.revision,
    actionHash: fixture.action.actionHash,
  };
  const evaluation = {
    ...clone(base['operating-policy-evaluation']),
    action: actionIdentity,
    capability: clone(fixture.action.requestedCapability),
    target: clone(fixture.action.targetBinding),
    effectClass: fixture.action.effectClass,
    outcome: 'named-single-party',
    approvalRequirementIds: [base['operating-approval-requirement'].requirementId],
    evaluatedAt: '2026-08-10T08:00:00Z',
  };
  const requirement = {
    ...clone(base['operating-approval-requirement']),
    ...scope,
    evaluationId: evaluation.evaluationId,
    policy: clone(evaluation.policy),
    action: actionIdentity,
    capability: clone(fixture.action.requestedCapability),
    target: clone(fixture.action.targetBinding),
    effectClass: fixture.action.effectClass,
    mode: evaluation.outcome,
    expiresAt: '2026-08-12T08:00:00Z',
    consumable: true,
    parties: [
      {
        partyId: 'owner-party',
        actorKind: 'human',
        actorId: 'owner-001',
        requiredCapability: { id: 'action-approve', version: '1.0.0' },
      },
    ],
    namedActorIds: ['owner-001'],
    requiredActorKinds: ['human'],
    threshold: 1,
  };
  delete requirement.scopeHash;
  requirement.scopeHash = sha256Jcs(requirement);
  const approval = {
    ...clone(base['operating-approval-record']),
    ...scope,
    requirementId: requirement.requirementId,
    evaluationId: requirement.evaluationId,
    policy: clone(requirement.policy),
    action: actionIdentity,
    capability: clone(requirement.capability),
    target: clone(requirement.target),
    effectClass: requirement.effectClass,
    partyId: 'owner-party',
    actor: {
      kind: 'human',
      actorId: 'owner-001',
      capability: { id: 'action-approve', version: '1.0.0' },
    },
    decision: 'approved',
    scopeHash: requirement.scopeHash,
    issuedAt: '2026-08-10T08:01:00Z',
    expiresAt: requirement.expiresAt,
    consumedByOperationId: null,
  };
  delete approval.recordHash;
  approval.recordHash = sha256Jcs(approval);
  Object.assign(fixture.state, {
    actionPolicies: [],
    policyEvaluations: [evaluation],
    approvalRequirements: [requirement],
    approvalRecords: [approval],
    capabilityAvailability: [],
    capabilityGrants: [],
    governedOperations: [],
    executionResults: [],
    rollbackPlans: [],
    rollbackResults: [],
    operationReplayIndex: [],
  });
  const route = createOperatingDeliveryRouteV1({
    state: fixture.state,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const options = {
    scope,
    actor: { actorId: 'owner-001', accessLevel: 'internal' },
    events: fixture.events,
    deliveryRoutes: [route],
  };
  const complete = buildOperateExperienceViewV2(fixture.state, options);
  assert.equal(
    complete.cycles[0].stages.find(({ id }) => id === 'govern').gates[0].state,
    'complete',
  );
  assert.equal(
    complete.inbox.some(({ kind }) => kind === 'approval'),
    false,
  );

  const wrongScope = clone(fixture.state);
  wrongScope.approvalRecords[0].scopeId = 'scope-foreign';
  const wrongScopeRoute = createOperatingDeliveryRouteV1({
    state: wrongScope,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const waiting = buildOperateExperienceViewV2(wrongScope, {
    ...options,
    deliveryRoutes: [wrongScopeRoute],
  });
  assert.equal(
    waiting.cycles[0].stages.find(({ id }) => id === 'govern').gates[0].state,
    'waiting',
  );
  assert.equal(
    waiting.inbox.some(({ kind }) => kind === 'approval'),
    true,
  );

  for (const mutate of [
    (state) => {
      state.approvalRequirements[0].expiresAt = '2026-08-11T07:59:00Z';
      delete state.approvalRequirements[0].scopeHash;
      state.approvalRequirements[0].scopeHash = sha256Jcs(state.approvalRequirements[0]);
      state.approvalRecords[0].expiresAt = '2026-08-11T07:59:00Z';
      state.approvalRecords[0].scopeHash = state.approvalRequirements[0].scopeHash;
      delete state.approvalRecords[0].recordHash;
      state.approvalRecords[0].recordHash = sha256Jcs(state.approvalRecords[0]);
    },
    (state) => {
      state.approvalRecords[0].consumedByOperationId = 'op_consumed_0001';
      delete state.approvalRecords[0].recordHash;
      state.approvalRecords[0].recordHash = sha256Jcs(state.approvalRecords[0]);
    },
    (state) => {
      state.approvalRequirements[0].target = {
        ...state.approvalRequirements[0].target,
        id: 'record-substitute',
      };
      delete state.approvalRequirements[0].scopeHash;
      state.approvalRequirements[0].scopeHash = sha256Jcs(state.approvalRequirements[0]);
      state.approvalRecords[0].target = clone(state.approvalRequirements[0].target);
      state.approvalRecords[0].scopeHash = state.approvalRequirements[0].scopeHash;
      delete state.approvalRecords[0].recordHash;
      state.approvalRecords[0].recordHash = sha256Jcs(state.approvalRecords[0]);
    },
  ]) {
    const invalid = clone(fixture.state);
    mutate(invalid);
    const invalidRoute = createOperatingDeliveryRouteV1({
      state: invalid,
      action: fixture.action,
      route: 'planning-work',
      rationale: 'Planning is required.',
    });
    const invalidView = buildOperateExperienceViewV2(invalid, {
      ...options,
      deliveryRoutes: [invalidRoute],
    });
    assert.equal(
      invalidView.cycles[0].stages.find(({ id }) => id === 'govern').gates[0].state,
      'waiting',
    );
    assert.equal(
      invalidView.inbox.some(({ kind }) => kind === 'approval'),
      true,
    );
  }
});

test('operation intent reuses canonical approval/execution authority and rejects custody substitution', async () => {
  const scenario = governedExecutionScenario({ suffix: 'custody01' });
  const authorityEvents = seedExecutionAuthorityEvents(scenario);
  const store = createGovernedExecutionCheckpointStore(scenario.initial);
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore: store,
  });
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: scenario.action.targetBinding,
    initialValue: scenario.initialValue,
  });
  const completed = await runtime.execute(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  const state = clone(store.commits.find(({ phase }) => phase === 'dispatch-intent').state);
  const eventIds = new Set(state.eventReplayIndex.map(({ eventId }) => eventId));
  const events = [...authorityEvents, ...completed.events]
    .filter(({ eventId }) => eventIds.has(eventId))
    .sort((left, right) => left.sequence - right.sequence);
  const scope = {
    scopeId: scenario.action.scopeId,
    domainId: scenario.action.domainId,
    domainVersion: scenario.action.domainVersion,
  };
  const optionsFor = (candidateState, candidateEvents) => ({
    scope,
    actor: { actorId: scenario.action.ownerActorId, accessLevel: 'internal' },
    events: candidateEvents,
    deliveryRoutes: [
      createOperatingDeliveryRouteV1({
        state: candidateState,
        action: candidateState.actions[0],
        route: 'planning-work',
        rationale: 'Planning is required.',
      }),
    ],
  });
  const view = buildOperateExperienceViewV2(state, optionsFor(state, events));
  assert.equal(view.replay.parityProof.stateParityVerified, false);
  assert.equal(state.approvalRecords[0].consumedByOperationId, scenario.draft.operationId);
  const reconciliation = await reconcileOperatingGovernedDispatchV2({
    state,
    operationId: scenario.draft.operationId,
    request: scenario.request,
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
    observedAt: scenario.draft.completedAt,
  });
  assert.equal(reconciliation.classification, 'applied');

  const terminalState = clone(completed.state);
  const terminalEventIds = new Set(terminalState.eventReplayIndex.map(({ eventId }) => eventId));
  const terminalEvents = [...authorityEvents, ...completed.events]
    .filter(({ eventId }) => terminalEventIds.has(eventId))
    .sort((left, right) => left.sequence - right.sequence);
  const terminalView = buildOperateExperienceViewV2(
    terminalState,
    optionsFor(terminalState, terminalEvents),
  );
  assert.equal(terminalView.replay.parityProof.stateParityVerified, false);
  assert.equal(terminalState.governedOperations[0].state, 'succeeded');
  assert.equal(terminalState.operationReplayIndex[0].terminalResultId, scenario.draft.resultId);

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
    const unhashedResult = clone(result);
    delete unhashedResult.resultHash;
    result.resultHash = sha256Jcs(unhashedResult);
    const terminal = reduceDirectResultTransaction(state, scenario, result, receipt);
    const statusEvents = [...events, ...terminal.events];
    assert.doesNotThrow(
      () => buildOperateExperienceViewV2(terminal.state, optionsFor(terminal.state, statusEvents)),
      status,
    );
  }

  const reject = (candidateState, candidateEvents = events, label = 'mutation') =>
    assert.throws(
      () =>
        buildOperateExperienceViewV2(candidateState, optionsFor(candidateState, candidateEvents)),
      (error) =>
        error.code ===
        (label === 'wrong scope' ? 'ACTION_REVISION_MISMATCH' : 'E_OPERATE_BINDING_MISMATCH'),
      label,
    );
  for (const [label, mutate] of [
    [
      'approval decision',
      (candidate) => {
        candidate.approvalRecords[0].decision = 'rejected';
      },
    ],
    [
      'approval actor',
      (candidate) => {
        candidate.approvalRecords[0].actor.actorId = 'owner-substituted';
      },
    ],
    [
      'approval party',
      (candidate) => {
        candidate.approvalRecords[0].partyId = 'party-substituted';
      },
    ],
    [
      'approval expiry',
      (candidate) => {
        candidate.approvalRecords[0].expiresAt = '2026-08-13T08:00:00Z';
      },
    ],
    [
      'approval hash',
      (candidate) => {
        candidate.approvalRecords[0].recordHash = `sha256:${'f'.repeat(64)}`;
      },
    ],
    [
      'prior consumed',
      (candidate) => {
        candidate.approvalRecords[0].consumedByOperationId = 'op_priorcustody01';
      },
    ],
    [
      'wrong evaluation',
      (candidate) => {
        candidate.governedOperations[0].evaluationId = 'pevl_substituted01';
      },
    ],
    [
      'wrong Action',
      (candidate) => {
        candidate.governedOperations[0].action.actionId = 'act_substituted01';
      },
    ],
    [
      'wrong capability',
      (candidate) => {
        candidate.governedOperations[0].capability.id = 'substituted-capability';
      },
    ],
    [
      'wrong target',
      (candidate) => {
        candidate.governedOperations[0].target.id = 'target-substituted';
      },
    ],
    [
      'wrong effect',
      (candidate) => {
        candidate.governedOperations[0].effectClass = 'external-effect';
      },
    ],
    [
      'wrong scope',
      (candidate) => {
        candidate.actions[0].scopeId = 'scope-substituted';
      },
    ],
    [
      'wrong Cycle',
      (candidate) => {
        candidate.assignments[0].cycleId = 'cyc_substituted01';
      },
    ],
    [
      'wrong assignment',
      (candidate) => {
        candidate.governedOperations[0].assignmentId = 'asg_substituted01';
      },
    ],
    [
      'wrong grant',
      (candidate) => {
        candidate.governedOperations[0].grantId = 'cgr_substituted01';
      },
    ],
    [
      'wrong availability',
      (candidate) => {
        candidate.capabilityAvailability[0].target.id = 'target-substituted';
      },
    ],
    [
      'wrong replay',
      (candidate) => {
        candidate.operationReplayIndex[0].operationHash = `sha256:${'e'.repeat(64)}`;
      },
    ],
    [
      'duplicate operation owner',
      (candidate) => {
        candidate.governedOperations.push({
          ...clone(candidate.governedOperations[0]),
          operationId: 'op_duplicatecustody01',
        });
      },
    ],
  ]) {
    const candidate = clone(state);
    mutate(candidate);
    reject(candidate, events, label);
  }

  const approvalEvent = authorityEvents.find(({ type }) => type === 'approval.recorded');
  const duplicateApproval = clone(approvalEvent);
  duplicateApproval.eventId = 'evt_custody01_approval_duplicate';
  const intentIndex = events.findIndex(({ type }) => type === 'operation.intent-recorded');
  const duplicateEvents = clone([
    ...events.slice(0, intentIndex),
    duplicateApproval,
    ...events.slice(intentIndex),
  ]);
  for (let index = 0; index < duplicateEvents.length; index += 1) {
    duplicateEvents[index].sequence = index + 1;
    duplicateEvents[index].previousEventHash =
      index === 0 ? null : duplicateEvents[index - 1].eventHash;
    duplicateEvents[index].eventHash = computeOperatingRuntimeEventHashV2(duplicateEvents[index]);
  }
  const duplicateState = clone(state);
  bindEvents(duplicateState, duplicateEvents);
  reject(duplicateState, duplicateEvents, 'duplicate immutable approval Event');

  const causalTypes = [
    'action.authority-promoted',
    'policy.evaluated',
    'approval.recorded',
    'action.approved',
    'assignment.created',
    'assignment.available',
    'assignment.claimed',
    'assignment.started',
    'capability.availability-recorded',
    'capability.granted',
  ];
  for (const type of causalTypes) {
    const missingState = clone(state);
    const missingEvents = rechainEvents(
      missingState,
      events.filter((event) => event.type !== type),
    );
    reject(missingState, missingEvents, `missing/current-only ${type}`);

    const target = events.find((event) => event.type === type);
    const reordered = events.filter((event) => event !== target);
    const intentOffset = reordered.findIndex((event) => event.type === 'operation.intent-recorded');
    reordered.splice(intentOffset + 1, 0, target);
    const postIntentState = clone(state);
    const postIntentEvents = rechainEvents(postIntentState, reordered);
    reject(postIntentState, postIntentEvents, `post-intent/reordered ${type}`);
  }
  for (const [label, mutate] of [
    [
      'missing terminal result Event',
      (candidateEvents) =>
        candidateEvents.filter(({ type }) => type !== 'execution.result-recorded'),
    ],
    [
      'reordered terminal result Event',
      (candidateEvents) => {
        const resultIndex = candidateEvents.findIndex(
          ({ type }) => type === 'execution.result-recorded',
        );
        const [resultEvent] = candidateEvents.splice(resultIndex, 1);
        const validationIndex = candidateEvents.findIndex(
          ({ type }) => type === 'assignment.validated',
        );
        candidateEvents.splice(validationIndex, 0, resultEvent);
        return candidateEvents;
      },
    ],
    [
      'duplicate terminal result Event',
      (candidateEvents) => {
        const resultEvent = clone(
          candidateEvents.find(({ type }) => type === 'execution.result-recorded'),
        );
        resultEvent.eventId = 'evt_custody01_terminal_duplicate';
        candidateEvents.push(resultEvent);
        return candidateEvents;
      },
    ],
    [
      'mutated terminal result Event',
      (candidateEvents) => {
        const resultEvent = candidateEvents.find(
          ({ type }) => type === 'execution.result-recorded',
        );
        resultEvent.payload.result.effectSummary.summary = 'Caller-authored terminal effect.';
        const unhashed = clone(resultEvent.payload.result);
        delete unhashed.resultHash;
        resultEvent.payload.result.resultHash = sha256Jcs(unhashed);
        return candidateEvents;
      },
    ],
    [
      'execute intent routed as rollback',
      (candidateEvents) => {
        candidateEvents.find(
          ({ type }) => type === 'operation.intent-recorded',
        ).payload.operation.operationKind = 'rollback';
        return candidateEvents;
      },
    ],
  ]) {
    const candidateState = clone(terminalState);
    const candidateEvents = rechainEvents(candidateState, mutate(clone(terminalEvents)));
    reject(candidateState, candidateEvents, label);
  }
  const missingRequirement = clone(state);
  missingRequirement.approvalRequirements = [];
  reject(missingRequirement, events, 'missing/current-only approval requirement template');
});

test('canonical automatic execution needs no synthetic approval consumption', async () => {
  const scenario = governedExecutionScenario({ suffix: 'automatic01', automatic: true });
  const authorityEvents = seedExecutionAuthorityEvents(scenario);
  const store = createGovernedExecutionCheckpointStore(scenario.initial);
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: scenario.initial,
    checkpointStore: store,
  });
  const completed = await runtime.execute(scenario.request, scenario.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter: createDisposableLocalProjectTargetV2({
      target: scenario.action.targetBinding,
      initialValue: scenario.initialValue,
    }),
  });
  const state = clone(store.commits.find(({ phase }) => phase === 'dispatch-intent').state);
  const eventIds = new Set(state.eventReplayIndex.map(({ eventId }) => eventId));
  const events = [...authorityEvents, ...completed.events]
    .filter(({ eventId }) => eventIds.has(eventId))
    .sort((left, right) => left.sequence - right.sequence);
  const scope = {
    scopeId: scenario.action.scopeId,
    domainId: scenario.action.domainId,
    domainVersion: scenario.action.domainVersion,
  };
  const view = buildOperateExperienceViewV2(state, {
    scope,
    actor: { actorId: scenario.action.ownerActorId, accessLevel: 'internal' },
    events,
    deliveryRoutes: [
      createOperatingDeliveryRouteV1({
        state,
        action: state.actions[0],
        route: 'planning-work',
        rationale: 'Planning is required.',
      }),
    ],
  });
  assert.equal(view.replay.parityProof.stateParityVerified, false);
  assert.deepEqual(state.approvalRecords, []);
  assert.deepEqual(state.governedOperations[0].approvalIds, []);
});

test('real terminal rollback history projects from its exact execute and rollback intent snapshots', async () => {
  const execution = governedExecutionScenario({ suffix: 'temporalexec01', automatic: true });
  const authorityEvents = seedExecutionAuthorityEvents(execution);
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: execution.action.targetBinding,
    initialValue: execution.initialValue,
  });
  const executeRuntime = createOperatingGovernedExecutionRuntimeV2({
    initialState: execution.initial,
    checkpointStore: createGovernedExecutionCheckpointStore(execution.initial),
  });
  const completed = await executeRuntime.execute(execution.request, execution.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  const plan = buildOperatingRollbackPlanV2({
    operation: completed.operation,
    result: completed.result,
    baseline: execution.request.rollbackBaseline,
    expiresAt: '2026-08-11T12:00:00Z',
  });
  const planned = recordOperatingRollbackPlanV2({
    state: completed.state,
    plan,
    eventId: 'evt_temporal_rollback_plan_01',
  });
  const draft = governedRollbackDraft('temporalrb01');
  const rollbackRuntime = createOperatingGovernedRecoveryRuntimeV2({
    initialState: planned.state,
    checkpointStore: createGovernedExecutionCheckpointStore(planned.state),
  });
  const rolledBack = await rollbackRuntime.rollback(
    {
      actionId: execution.action.actionId,
      originalOperationId: completed.operation.operationId,
      rollbackPlanId: plan.rollbackPlanId,
      payload: execution.request.payload,
      rollbackBaseline: execution.request.rollbackBaseline,
    },
    draft,
    { trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2, targetAdapter },
  );
  const events = [
    ...authorityEvents,
    ...completed.events,
    planned.event,
    ...rolledBack.events,
  ].sort((left, right) => left.sequence - right.sequence);
  const scope = {
    scopeId: execution.action.scopeId,
    domainId: execution.action.domainId,
    domainVersion: execution.action.domainVersion,
  };
  const view = buildOperateExperienceViewV2(rolledBack.state, {
    scope,
    actor: { actorId: execution.action.ownerActorId, accessLevel: 'internal' },
    events,
    deliveryRoutes: [
      createOperatingDeliveryRouteV1({
        state: rolledBack.state,
        action: rolledBack.state.actions[0],
        route: 'planning-work',
        rationale: 'Planning is required.',
      }),
    ],
  });
  assert.equal(view.replay.parityProof.stateParityVerified, false);
  assert.equal(
    rolledBack.state.governedOperations.find(({ operationKind }) => operationKind === 'rollback')
      .state,
    'succeeded',
  );
  assert.equal(rolledBack.state.rollbackResults.length, 1);
  const substitutedState = clone(rolledBack.state);
  const substitutedEvents = clone(events);
  substitutedEvents.find(
    ({ type, entityId }) => type === 'operation.intent-recorded' && entityId === draft.operationId,
  ).payload.operation.operationKind = 'execute';
  rechainEvents(substitutedState, substitutedEvents);
  assert.throws(
    () =>
      buildOperateExperienceViewV2(substitutedState, {
        scope,
        actor: { actorId: execution.action.ownerActorId, accessLevel: 'internal' },
        events: substitutedEvents,
        deliveryRoutes: [
          createOperatingDeliveryRouteV1({
            state: substitutedState,
            action: substitutedState.actions[0],
            route: 'planning-work',
            rationale: 'Planning is required.',
          }),
        ],
      }),
    (error) => error.code === 'E_OPERATE_BINDING_MISMATCH',
  );
});

test('rollback approval binds the exact latest Action template, human party, threshold, plan, operation, and result', async () => {
  const execution = governedExecutionScenario({ suffix: 'rollbacktemplate01' });
  const currentEvaluation = execution.initial.policyEvaluations[0];
  const currentRequirement = execution.initial.approvalRequirements[0];
  const staleEvaluation = evaluateOperatingActionPolicyV2({
    action: execution.action,
    configuredPolicies: execution.initial.actionPolicies,
    evaluatedAt: '2026-08-10T07:59:00Z',
    evaluationId: 'pevl_rollback_template_stale_01',
  });
  const staleRequirement = createOperatingApprovalRequirementV2({
    policyRequirementId: 'aprq_template01',
    evaluation: staleEvaluation,
    action: execution.action,
    parties: clone(currentRequirement.parties),
    threshold: currentRequirement.threshold,
    expiresAt: currentRequirement.expiresAt,
    consumable: true,
  });
  const unrelatedAction = clone(execution.action);
  unrelatedAction.actionId = 'act_rollback_unrelated_01';
  unrelatedAction.actionHash = derivePersistentOperatingActionRevisionHashV2(unrelatedAction);
  execution.initial.policyEvaluations = [staleEvaluation, currentEvaluation];
  execution.initial.approvalRequirements = [staleRequirement, currentRequirement];
  const authorityEvents = seedExecutionAuthorityEvents(execution);
  const targetAdapter = createDisposableLocalProjectTargetV2({
    target: execution.action.targetBinding,
    initialValue: execution.initialValue,
  });
  const runtime = createOperatingGovernedExecutionRuntimeV2({
    initialState: execution.initial,
    checkpointStore: createGovernedExecutionCheckpointStore(execution.initial),
  });
  const completed = await runtime.execute(execution.request, execution.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter,
  });
  const plan = buildOperatingRollbackPlanV2({
    operation: completed.operation,
    result: completed.result,
    baseline: execution.request.rollbackBaseline,
    expiresAt: '2026-08-11T12:00:00Z',
  });
  const planned = recordOperatingRollbackPlanV2({
    state: completed.state,
    plan,
    eventId: 'evt_rollback_template_plan_01',
  });
  const action = planned.state.actions[0];
  const scope = {
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
  };
  const actor = { actorId: action.ownerActorId, accessLevel: 'internal' };
  const events = [...authorityEvents, ...completed.events, planned.event].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const rollback = {
    rollbackPlanId: plan.rollbackPlanId,
    planHash: plan.planHash,
    originalOperationId: completed.operation.operationId,
    executionResultId: completed.result.resultId,
    expectedTargetHash: plan.steps[0].expectedTargetHash,
  };
  const allowedAction = {
    tool: 'operate.action.approve',
    arguments: {
      action: {
        actionId: action.actionId,
        revision: action.revision,
        actionHash: action.actionHash,
      },
      decision: 'approved',
      rollback,
    },
    label: 'Approve this exact rollback plan',
    effect: action.effectClass,
  };
  const optionsFor = (state) => ({
    scope,
    actor,
    events,
    deliveryRoutes: [
      createOperatingDeliveryRouteV1({
        state,
        action: state.actions[0],
        route: 'planning-work',
        rationale: 'Planning is required.',
      }),
    ],
    allowedActions: [{ subjectId: action.actionId, action: allowedAction }],
  });

  const view = buildOperateExperienceViewV2(planned.state, optionsFor(planned.state));
  const inbox = view.inbox.find(
    ({ itemId }) => itemId === `approval:rollback:${plan.rollbackPlanId}`,
  );
  const issuedAction = view.allowedActions.find(
    ({ subjectId }) => subjectId === action.actionId,
  ).action;
  assert.deepEqual(inbox.actionLocator, {
    subjectId: action.actionId,
    actionDigest: sha256Jcs(issuedAction),
  });
  const preview = createOperateExperiencePreviewV1(planned.state, {
    scope,
    view,
    actionDigest: inbox.actionLocator.actionDigest,
    authority: 'allowed',
    issuedAt: planned.state.generatedAt,
    expiresAt: '2026-08-11T08:05:00Z',
  });
  const exactRequirement = planned.state.approvalRequirements.find(({ requirementId }) =>
    currentEvaluation.approvalRequirementIds.includes(requirementId),
  );
  assert.deepEqual(preview.transition.threshold, {
    required: exactRequirement.threshold,
    recorded: 1,
    remaining: Math.max(0, exactRequirement.threshold - 1),
    parties: inbox.requiredParties,
  });

  const rejectRequirement = (label, mutate, codes = ['E_OPERATE_BINDING_MISMATCH']) => {
    const candidate = clone(planned.state);
    const requirement = candidate.approvalRequirements.find(({ requirementId }) =>
      currentEvaluation.approvalRequirementIds.includes(requirementId),
    );
    mutate(requirement);
    delete requirement.scopeHash;
    requirement.scopeHash = sha256Jcs(requirement);
    assert.throws(
      () => buildOperateExperienceViewV2(candidate, optionsFor(candidate)),
      (error) => codes.includes(error.code),
      label,
    );
  };
  rejectRequirement('wrong Action', (requirement) => {
    requirement.action.actionId = unrelatedAction.actionId;
  });
  rejectRequirement('wrong party kind', (requirement) => {
    requirement.parties[0].actorKind = 'engine';
    requirement.requiredActorKinds = ['engine'];
  });
  rejectRequirement('wrong party', (requirement) => {
    requirement.parties[0].actorId = 'owner-substituted';
    requirement.namedActorIds = ['owner-substituted'];
  });
  rejectRequirement('wrong approval capability', (requirement) => {
    requirement.parties[0].requiredCapability.id = 'action-execute';
  });
  rejectRequirement('wrong target', (requirement) => {
    requirement.target.id = 'target-substituted';
  });
  rejectRequirement('wrong effect', (requirement) => {
    requirement.effectClass = 'external-effect';
  });
  rejectRequirement(
    'threshold drift',
    (requirement) => {
      requirement.threshold += 1;
    },
    ['E_OPERATE_BINDING_MISMATCH', 'E_PROTOCOL_ARTIFACT_INVALID'],
  );

  for (const [label, mutate] of [
    [
      'operation result link',
      (state) => {
        state.governedOperations[0].resultId = 'xres_substituted';
      },
    ],
    [
      'result operation link',
      (state) => {
        state.executionResults[0].operationId = 'op_substituted';
      },
    ],
    [
      'result Action',
      (state) => {
        state.executionResults[0].action.actionId = unrelatedAction.actionId;
      },
    ],
    [
      'plan target precondition',
      (state) => {
        state.rollbackPlans[0].steps[0].expectedTargetHash = `sha256:${'f'.repeat(64)}`;
      },
    ],
  ]) {
    const candidate = clone(planned.state);
    mutate(candidate);
    assert.throws(
      () => buildOperateExperienceViewV2(candidate, optionsFor(candidate)),
      (error) => error.code === 'E_OPERATE_BINDING_MISMATCH',
      label,
    );
  }
});

test('two unrelated Action owners execute sequentially without temporal authority collision', async () => {
  const first = governedExecutionScenario({
    suffix: 'sequence01',
    automatic: true,
    actionId: 'act_sequence0001',
  });
  const second = governedExecutionScenario({
    suffix: 'sequence02',
    automatic: true,
    actionId: 'act_sequence0002',
    targetBinding: { kind: 'project-record', id: 'target-sequence-2', revision: 'rev-sequence-2' },
  });
  const firstAuthority = seedExecutionAuthorityEvents(first);
  const secondAuthority = seedExecutionAuthorityEvents(second);
  const initial = clone(first.initial);
  initial.actions = [clone(first.initial.actions[0]), clone(second.initial.actions[0])];
  initial.policyEvaluations = [
    clone(first.initial.policyEvaluations[0]),
    clone(second.initial.policyEvaluations[0]),
  ];
  const authorityEvents = rechainEvents(initial, [...firstAuthority, ...secondAuthority]);
  first.initial = initial;
  const firstRuntime = createOperatingGovernedExecutionRuntimeV2({
    initialState: initial,
    checkpointStore: createGovernedExecutionCheckpointStore(initial),
  });
  const firstResult = await firstRuntime.execute(first.request, first.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter: createDisposableLocalProjectTargetV2({
      target: first.action.targetBinding,
      initialValue: first.initialValue,
    }),
  });
  Object.assign(second.draft, {
    preparedAt: '2026-08-10T12:02:00Z',
    completedAt: '2026-08-10T12:03:00Z',
    grantExpiresAt: '2026-08-10T12:06:00Z',
    availabilityExpiresAt: '2026-08-10T12:07:00Z',
  });
  const secondRuntime = createOperatingGovernedExecutionRuntimeV2({
    initialState: firstResult.state,
    checkpointStore: createGovernedExecutionCheckpointStore(firstResult.state),
  });
  const secondResult = await secondRuntime.execute(second.request, second.draft, {
    trustedHost: OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2,
    targetAdapter: createDisposableLocalProjectTargetV2({
      target: second.action.targetBinding,
      initialValue: second.initialValue,
    }),
  });
  const events = [...authorityEvents, ...firstResult.events, ...secondResult.events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const scope = {
    scopeId: first.action.scopeId,
    domainId: first.action.domainId,
    domainVersion: first.action.domainVersion,
  };
  const routes = secondResult.state.actions.map((action) =>
    createOperatingDeliveryRouteV1({
      state: secondResult.state,
      action,
      route: 'planning-work',
      rationale: 'Planning is required.',
    }),
  );
  const view = buildOperateExperienceViewV2(secondResult.state, {
    scope,
    actor: { actorId: first.action.ownerActorId, accessLevel: 'internal' },
    events,
    deliveryRoutes: routes,
  });
  assert.equal(view.replay.parityProof.stateParityVerified, false);
  assert.equal(secondResult.state.governedOperations.length, 2);
  assert.equal(
    new Set(secondResult.state.governedOperations.map(({ action }) => action.actionId)).size,
    2,
  );
});

test('complete immutable Events bind every projection-contributing current collection', () => {
  const fixture = makeState();
  const assignment = {
    ...clone(base['operating-assignment']),
    assignmentId: 'asg_eventcustody01',
    cycleId: fixture.cycle.cycleId,
    state: 'pending',
    availableAt: null,
    completedAt: null,
    claim: null,
  };
  const finding = clone(persistent.finding);
  const modelState = clone(base['operating-model-state']);
  const risk = clone(base['operating-risk']);
  const assumption = clone(base['operating-assumption']);
  const plan = clone(base['operating-intelligence-plan']);
  const ledger = clone(base['operating-decision-ledger']);
  const scenario = clone(base['operating-scenario']);
  const trigger = clone(base['operating-event-trigger']);
  const projection = clone(base['operating-domain-projection']);
  const rollbackPlan = clone(base['operating-rollback-plan']);
  Object.assign(fixture.state, {
    assignments: [...fixture.state.assignments, assignment],
    findings: [finding],
    operatingModelStates: [modelState],
    risks: [risk],
    assumptions: [assumption],
    intelligencePlans: [plan],
    decisionLedgers: [ledger],
    scenarios: [scenario],
    eventTriggers: [trigger],
    domainProjections: [projection],
    actionPolicies: [],
    policyEvaluations: [],
    approvalRequirements: [],
    approvalRecords: [],
    capabilityAvailability: [],
    capabilityGrants: [],
    governedOperations: [],
    executionResults: [],
    rollbackPlans: [rollbackPlan],
    rollbackResults: [],
    operationReplayIndex: [],
  });
  const changeset = clone(persistent.changeSet);
  const records = [
    ['assignments', 'assignmentId', assignment, 'assignment.created', assignment, false],
    [
      'findings',
      'findingId',
      finding,
      'work-change-set.materialized',
      {
        artifactId: fixture.chair.artifactId,
        canonicalHash: sha256Jcs(changeset),
        changeSet: changeset,
        findings: [finding],
        decisions: [fixture.decision],
        actions: [fixture.action],
      },
      false,
    ],
    [
      'operatingModelStates',
      'stateId',
      modelState,
      'operating-state.materialized',
      modelState,
      false,
    ],
    [
      'risks',
      'riskId',
      risk,
      'risk.recorded',
      {
        snapshotId: risk.snapshotId ?? modelState.snapshotId,
        stateId: modelState.stateId,
        record: risk,
      },
      true,
    ],
    [
      'assumptions',
      'assumptionId',
      assumption,
      'assumption.recorded',
      {
        snapshotId: assumption.snapshotId ?? modelState.snapshotId,
        stateId: modelState.stateId,
        record: assumption,
      },
      true,
    ],
    ['intelligencePlans', 'planId', plan, 'intelligence.plan-recorded', plan, false],
    ['decisionLedgers', 'ledgerId', ledger, 'decision-ledger.materialized', ledger, false],
    [
      'scenarios',
      'scenarioId',
      scenario,
      'scenario.recorded',
      { snapshotId: scenario.snapshotId, stateId: modelState.stateId, record: scenario },
      true,
    ],
    [
      'eventTriggers',
      'triggerId',
      trigger,
      'trigger.recorded',
      { snapshotId: trigger.snapshotId, stateId: modelState.stateId, record: trigger },
      true,
    ],
    [
      'domainProjections',
      'projectionId',
      projection,
      'domain-projection.rebuilt',
      projection,
      false,
    ],
    [
      'rollbackPlans',
      'rollbackPlanId',
      rollbackPlan,
      'rollback.plan-recorded',
      rollbackPlan,
      false,
    ],
  ];
  let previous = fixture.events[0];
  for (const [, identityField, record, type, payload, requiresRequest] of records) {
    let event;
    try {
      event = makeEvent(
        {
          eventId: `evt-custody-${type.replaceAll('.', '-')}`,
          timestamp: '2026-08-11T07:59:00Z',
          cycleId: fixture.cycle.cycleId,
          type,
          entityId:
            type === 'work-change-set.materialized'
              ? fixture.chair.artifactId
              : record[identityField],
          actor: { kind: 'engine', id: 'openplanr' },
          causationId: previous.eventId,
          correlationId: 'corr-immutable-custody',
          ...(requiresRequest ? { requestHash: sha256Jcs({ type, payload }) } : {}),
          payload,
        },
        previous,
      );
    } catch (error) {
      assert.fail(`${type}: ${error.message}`);
    }
    fixture.events.push(event);
    previous = event;
  }
  bindEvents(fixture.state, fixture.events);
  const scope = {
    scopeId: fixture.cycle.scopeId,
    domainId: fixture.cycle.domainId,
    domainVersion: fixture.cycle.domainVersion,
  };
  const optionsFor = (state) => ({
    scope,
    actor: { actorId: 'owner-001', accessLevel: 'internal' },
    events: fixture.events,
    deliveryRoutes: [
      createOperatingDeliveryRouteV1({
        state,
        action: state.actions[0],
        route: 'planning-work',
        rationale: 'Planning is required.',
      }),
    ],
  });
  assert.equal(
    buildOperateExperienceViewV2(fixture.state, optionsFor(fixture.state)).replay.parityProof
      .stateParityVerified,
    false,
  );
  for (const [collection, identityField, eventRecord] of records) {
    const candidate = clone(fixture.state);
    const current = candidate[collection].find(
      (record) => record[identityField] === eventRecord[identityField],
    );
    current[identityField] = `${current[identityField]}-substituted`;
    assert.throws(
      () => buildOperateExperienceViewV2(candidate, optionsFor(candidate)),
      (error) =>
        error.code === 'E_OPERATE_BINDING_MISMATCH' &&
        error.details?.context?.collection === collection,
      collection,
    );
  }
});

test('Today ranking uses materiality, expiry, blocked dependencies, due verification, ownership, and stable IDs', () => {
  const fixture = makeState();
  const decision = (decisionId, confidence, revisitAt, ownerActorId = 'owner-001') => ({
    ...clone(fixture.decision),
    decisionId,
    confidence,
    revisitAt,
    ownerActorId,
    state: 'proposed',
    predecessorDecisionId: null,
    historyDecisionIds: [],
  });
  fixture.state.decisions.push(
    decision('dec_rank_material_low', 0.1, null),
    decision('dec_rank_material_high', 0.9, null),
    decision('dec_rank_expiry_far', 0.5, '2026-09-11T08:00:00Z'),
    decision('dec_rank_expiry_near', 0.5, '2026-08-11T08:30:00Z'),
    decision('dec_rank_foreign_owner', 1, '2026-08-11T08:01:00Z', 'owner-foreign'),
  );
  const route = createOperatingDeliveryRouteV1({
    state: fixture.state,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const options = {
    scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
    actor: { actorId: 'owner-001', accessLevel: 'internal' },
    deliveryRoutes: [route],
    events: fixture.events,
  };
  const view = buildOperateExperienceViewV2(fixture.state, options);
  const priorities = new Map(
    view.attention.map(({ subjectId, priority }) => [subjectId, priority]),
  );
  assert.ok(priorities.get('dec_rank_material_high') > priorities.get('dec_rank_material_low'));
  assert.ok(priorities.get('dec_rank_expiry_near') > priorities.get('dec_rank_expiry_far'));
  assert.equal(priorities.has('dec_rank_foreign_owner'), false);

  const blocked = makeState();
  const dependency = {
    ...clone(blocked.action),
    actionId: 'act_rank_dependency',
    actionHash: 'sha256:2525252525252525252525252525252525252525252525252525252525252525',
    state: 'proposed',
    dependsOnActionIds: [],
  };
  Object.assign(blocked.action, { state: 'blocked', dependsOnActionIds: [dependency.actionId] });
  blocked.action.actionHash = derivePersistentOperatingActionRevisionHashV2(blocked.action);
  dependency.actionHash = derivePersistentOperatingActionRevisionHashV2(dependency);
  blocked.state.actions.push(dependency);
  blocked.state.assignments.push({
    ...clone(base['operating-assignment']),
    assignmentId: 'asg_rank_verification',
    cycleId: blocked.cycle.cycleId,
    assignmentKind: 'verification',
    roleId: 'verification',
    objective: 'Verify the due result.',
    state: 'available',
    inputArtifactIds: [blocked.chair.artifactId],
    capabilityGrantId: 'cgr_rank_verification',
    governedOperationId: 'op_rank_verification',
  });
  const blockedRoutes = blocked.state.actions.map((action) =>
    createOperatingDeliveryRouteV1({
      state: blocked.state,
      action,
      route: 'planning-work',
      rationale: 'Planning is required.',
    }),
  );
  const blockedOptions = { ...options, deliveryRoutes: blockedRoutes, events: blocked.events };
  const blockedView = buildOperateExperienceViewV2(blocked.state, blockedOptions);
  const blockedPriority = blockedView.attention.find(
    ({ subjectId }) => subjectId === blocked.action.actionId,
  ).priority;
  const verificationItem = blockedView.attention.find(({ kind }) => kind === 'verification');
  assert.ok(verificationItem.priority >= 300);
  const unblockedState = clone(blocked.state);
  unblockedState.actions.find(
    ({ actionId }) => actionId === blocked.action.actionId,
  ).dependsOnActionIds = [];
  const unblockedAction = unblockedState.actions.find(
    ({ actionId }) => actionId === blocked.action.actionId,
  );
  unblockedAction.actionHash = derivePersistentOperatingActionRevisionHashV2(unblockedAction);
  const unblockedRoutes = unblockedState.actions.map((action) =>
    createOperatingDeliveryRouteV1({
      state: unblockedState,
      action,
      route: 'planning-work',
      rationale: 'Planning is required.',
    }),
  );
  const unblockedView = buildOperateExperienceViewV2(unblockedState, {
    ...blockedOptions,
    deliveryRoutes: unblockedRoutes,
  });
  assert.ok(
    blockedPriority >
      unblockedView.attention.find(({ subjectId }) => subjectId === blocked.action.actionId)
        .priority,
  );

  const tiedAttention = view.attention
    .filter(({ kind }) => kind === 'decision')
    .slice(0, 2)
    .map((entry) => ({ ...entry, priority: 500 }))
    .reverse();
  const tieBase = { ...view, attention: tiedAttention };
  delete tieBase.viewHash;
  const tiedView = { ...tieBase, viewHash: sha256Jcs(tieBase) };
  assert.deepEqual(
    rankOperateAttentionV2(tiedView).map(({ attentionId }) => attentionId),
    [...tiedAttention].map(({ attentionId }) => attentionId).sort(),
  );
});

test('scope-qualified identities make Decision, Action, Outcome, and Artifact projection order-invariant and reject local duplicates', () => {
  const fixture = makeState();
  Object.assign(fixture.decision, {
    state: 'proposed',
    confidence: 0.2,
    ownerActorId: 'owner-001',
    title: 'Local Decision',
  });
  const localOutcome = {
    ...clone(base['operating-outcome']),
    outcomeId: 'out_scope_identity',
    actionId: fixture.action.actionId,
    verificationPlanId: fixture.action.verificationPlanId,
    observationIds: [],
    sourceArtifactId: fixture.chair.artifactId,
  };
  fixture.state.outcomes = [localOutcome];
  const route = createOperatingDeliveryRouteV1({
    state: fixture.state,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const actionControl = {
    tool: 'operate.action.execute',
    arguments: {
      action: {
        actionId: fixture.action.actionId,
        revision: fixture.action.revision,
        actionHash: fixture.action.actionHash,
      },
    },
    label: 'Local Action control',
    effect: 'project-write',
  };
  const scope = { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' };
  const options = {
    scope,
    actor: { actorId: 'owner-001', accessLevel: 'internal' },
    deliveryRoutes: [route],
    events: fixture.events,
    allowedActions: [{ subjectId: fixture.action.actionId, action: actionControl }],
  };
  const localView = buildOperateExperienceViewV2(fixture.state, options);
  const localPriority = new Map(
    localView.attention.map(({ subjectId, priority }) => [subjectId, priority]),
  );

  const foreignArtifact = {
    ...clone(fixture.chair),
    artifactId: 'art_scope_foreign_source',
    scopeId: 'scope-foreign',
    sensitivity: 'restricted',
  };
  const foreignSameArtifactIdentity = {
    ...clone(fixture.chair),
    scopeId: 'scope-foreign',
    sensitivity: 'restricted',
  };
  const foreignDecision = {
    ...clone(fixture.decision),
    scopeId: 'scope-foreign',
    confidence: 1,
    title: 'Foreign Decision',
  };
  const foreignAction = {
    ...clone(fixture.action),
    scopeId: 'scope-foreign',
    sourceArtifactId: foreignArtifact.artifactId,
    baseline: 0,
    target: 1,
    title: 'Foreign Action',
    actionHash: 'sha256:9191919191919191919191919191919191919191919191919191919191919191',
  };
  const foreignOutcome = {
    ...clone(localOutcome),
    scopeId: 'scope-foreign',
    status: 'succeeded',
    sourceArtifactId: foreignArtifact.artifactId,
  };
  const projections = [];
  for (const foreignFirst of [true, false]) {
    const state = clone(fixture.state);
    const ordered = (local, foreign) => (foreignFirst ? [foreign, ...local] : [...local, foreign]);
    state.decisions = ordered(state.decisions, foreignDecision);
    state.actions = ordered(state.actions, foreignAction);
    state.outcomes = ordered(state.outcomes, foreignOutcome);
    state.artifacts = foreignFirst
      ? [foreignArtifact, foreignSameArtifactIdentity, ...state.artifacts]
      : [...state.artifacts, foreignSameArtifactIdentity, foreignArtifact];
    const view = buildOperateExperienceViewV2(state, options);
    projections.push({
      decision: view.inbox.find(({ kind }) => kind === 'decision'),
      action: view.actions.find(({ actionId }) => actionId === fixture.action.actionId),
      outcome: view.outcomes.find(({ outcomeId }) => outcomeId === localOutcome.outcomeId),
      control: view.allowedActions.find(({ subjectId }) => subjectId === fixture.action.actionId),
      priorities: new Map(view.attention.map(({ subjectId, priority }) => [subjectId, priority])),
    });
  }
  assert.equal(projections[0].decision.title, 'Local Decision');
  assert.equal(projections[0].action.title, fixture.action.title);
  assert.equal(projections[0].outcome.status, localOutcome.status);
  assert.equal(projections[0].control.action.label, actionControl.label);
  assert.equal(
    projections[0].priorities.get(fixture.decision.decisionId),
    localPriority.get(fixture.decision.decisionId),
  );
  assert.equal(
    projections[0].priorities.get(fixture.action.actionId),
    localPriority.get(fixture.action.actionId),
  );
  assert.equal(
    projections[0].priorities.get(localOutcome.outcomeId),
    localPriority.get(localOutcome.outcomeId),
  );
  assert.deepEqual(projections[0], projections[1]);

  for (const [collection, identity] of [
    ['decisions', 'Decision'],
    ['actions', 'Action'],
    ['outcomes', 'Outcome'],
    ['artifacts', 'Artifact'],
  ]) {
    const state = clone(fixture.state);
    state[collection].push(clone(state[collection][0]));
    assert.throws(
      () => buildOperateExperienceViewV2(state, options),
      (error) => error.code === 'RESULT_CONTRACT_INVALID' && error.message.includes(identity),
    );
  }
});

test('action-scoped Reviews issue exact approval Inbox work without impersonating Decision disposition', () => {
  const fixture = makeState();
  Object.assign(fixture.action, { state: 'proposed', ownerActorId: 'owner-001' });
  Object.assign(fixture.decision, { state: 'proposed', ownerActorId: 'owner-001' });
  fixture.action.actionHash = derivePersistentOperatingActionRevisionHashV2(fixture.action);
  fixture.state.actions = [fixture.action];
  const review = {
    ...clone(base['operating-review']),
    reviewId: 'rev_action_inbox_0001',
    cycleId: fixture.cycle.cycleId,
    subject: {
      type: 'action',
      actionId: fixture.action.actionId,
      revision: fixture.action.revision,
      actionHash: fixture.action.actionHash,
    },
    ownerActorId: 'owner-001',
    state: 'pending',
    disposition: null,
    workDispositions: [],
  };
  fixture.state.reviews = [review];
  const reviewAction = {
    tool: 'operate.review.submit',
    arguments: {
      reviewId: review.reviewId,
      cycleId: fixture.cycle.cycleId,
      actor: { actorId: 'owner-001', kind: 'human', runtime: 'portable' },
      scope: {
        scopeId: fixture.cycle.scopeId,
        domainId: fixture.cycle.domainId,
        domainVersion: fixture.cycle.domainVersion,
      },
      disposition: 'approved',
      workDispositions: [],
    },
    label: 'Submit Action Review disposition',
    effect: 'project-write',
  };
  const reviewReadAction = {
    tool: 'operate.review.get',
    arguments: {
      reviewId: review.reviewId,
      cycleId: fixture.cycle.cycleId,
      actor: { actorId: 'owner-001', kind: 'human', runtime: 'portable' },
      scope: {
        scopeId: fixture.cycle.scopeId,
        domainId: fixture.cycle.domainId,
        domainVersion: fixture.cycle.domainVersion,
      },
    },
    label: 'Inspect Action Review',
    effect: 'read-only',
  };
  const route = createOperatingDeliveryRouteV1({
    state: fixture.state,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const options = {
    scope: {
      scopeId: fixture.cycle.scopeId,
      domainId: fixture.cycle.domainId,
      domainVersion: fixture.cycle.domainVersion,
    },
    actor: { actorId: 'owner-001', accessLevel: 'internal' },
    deliveryRoutes: [route],
    events: fixture.events,
    allowedActions: [
      { subjectId: review.reviewId, action: reviewReadAction },
      { subjectId: review.reviewId, action: reviewAction },
    ],
  };
  const view = buildOperateExperienceViewV2(fixture.state, options);
  const item = view.inbox.find(({ itemId }) => itemId === `action-review:${review.reviewId}`);
  assert.deepEqual(item.actionLocator, {
    subjectId: review.reviewId,
    actionDigest: sha256Jcs(reviewAction),
  });
  assert.deepEqual(item.navigationLocator, {
    kind: 'review',
    cycleId: fixture.cycle.cycleId,
    reviewId: review.reviewId,
    deepLink: `#/operate/cycles/${fixture.cycle.cycleId}/reviews/${review.reviewId}`,
    readActionDigest: sha256Jcs(reviewReadAction),
  });
  assert.equal(item.kind, 'approval');
  assert.equal(item.subjectId, review.reviewId);
  assert.doesNotThrow(() => assertOperateExperienceTransportView(view));
  assert.equal(
    view.inbox.find(({ kind }) => kind === 'decision').actionLocator,
    null,
    'an Action Review with no work disposition must never become a Decision locator',
  );

  const rejectAction = clone(reviewAction);
  rejectAction.arguments.disposition = 'rejected';
  rejectAction.label = 'Reject Action Review';
  const alternateApproval = clone(reviewAction);
  alternateApproval.label = 'Approve Action Review with alternate presentation';
  const multipleChoices = buildOperateExperienceViewV2(fixture.state, {
    ...options,
    allowedActions: [
      { subjectId: review.reviewId, action: reviewReadAction },
      { subjectId: review.reviewId, action: rejectAction },
      { subjectId: review.reviewId, action: alternateApproval },
      { subjectId: review.reviewId, action: reviewAction },
    ],
  });
  assert.deepEqual(
    multipleChoices.allowedActions.map(({ action }) => sha256Jcs(action)),
    [
      sha256Jcs(reviewReadAction),
      ...[sha256Jcs(rejectAction), sha256Jcs(alternateApproval), sha256Jcs(reviewAction)].sort(),
    ],
    'distinct digest-bound Review choices coexist in canonical order',
  );
  const multipleChoiceItem = multipleChoices.inbox.find(
    ({ itemId }) => itemId === `action-review:${review.reviewId}`,
  );
  assert.equal(multipleChoiceItem.actionLocator, null, 'no Review disposition is preselected');
  assert.equal(
    multipleChoiceItem.unavailableReason,
    null,
    'an exact Review read remains available',
  );
  assert.deepEqual(multipleChoiceItem.navigationLocator, {
    kind: 'review',
    cycleId: fixture.cycle.cycleId,
    reviewId: review.reviewId,
    deepLink: `#/operate/cycles/${fixture.cycle.cycleId}/reviews/${review.reviewId}`,
    readActionDigest: sha256Jcs(reviewReadAction),
  });
  assert.doesNotThrow(() => assertOperateExperienceTransportView(multipleChoices));
  for (const [label, mutate] of [
    [
      'foreign Review',
      (locator) => {
        locator.reviewId = 'rev_foreign_00000001';
      },
    ],
    [
      'foreign Cycle',
      (locator) => {
        locator.cycleId = 'cyc_foreign_00000001';
      },
    ],
    [
      'divergent route',
      (locator) => {
        locator.deepLink = '#/operate/cycles/cyc_foreign_00000001/reviews/rev_foreign_00000001';
      },
    ],
    [
      'divergent read digest',
      (locator) => {
        locator.readActionDigest = `sha256:${'f'.repeat(64)}`;
      },
    ],
  ]) {
    const hostile = clone(multipleChoices);
    const locator = hostile.inbox.find(
      ({ itemId }) => itemId === `action-review:${review.reviewId}`,
    ).navigationLocator;
    mutate(locator);
    delete hostile.viewHash;
    hostile.viewHash = sha256Jcs(hostile);
    assert.throws(
      () => assertOperateExperienceTransportView(hostile),
      undefined,
      `${label} navigation must fail closed`,
    );
  }
  assert.throws(
    () =>
      buildOperateExperienceViewV2(fixture.state, {
        ...options,
        allowedActions: [
          { subjectId: review.reviewId, action: reviewReadAction },
          { subjectId: review.reviewId, action: reviewAction },
          { subjectId: review.reviewId, action: clone(reviewAction) },
        ],
      }),
    { code: 'RESULT_CONTRACT_INVALID' },
  );
  const divergentReadAction = {
    ...clone(reviewReadAction),
    label: 'Inspect the same Review differently',
  };
  assert.throws(
    () =>
      buildOperateExperienceViewV2(fixture.state, {
        ...options,
        allowedActions: [
          { subjectId: review.reviewId, action: reviewReadAction },
          { subjectId: review.reviewId, action: divergentReadAction },
          { subjectId: review.reviewId, action: reviewAction },
        ],
      }),
    { code: 'RESULT_CONTRACT_INVALID' },
  );

  const invalid = clone(reviewAction);
  invalid.arguments.workDispositions = [
    {
      entityType: 'operating-decision',
      entityId: fixture.decision.decisionId,
      disposition: 'approved',
    },
  ];
  const refused = buildOperateExperienceViewV2(fixture.state, {
    ...options,
    allowedActions: [
      { subjectId: review.reviewId, action: reviewReadAction },
      { subjectId: review.reviewId, action: invalid },
    ],
  });
  assert.equal(
    refused.inbox.find(({ itemId }) => itemId === `action-review:${review.reviewId}`).actionLocator,
    null,
  );
  assert.equal(refused.inbox.find(({ kind }) => kind === 'decision').actionLocator, null);
});

test('live patches and previews remain Event-head and actor bound', () => {
  const fixture = makeState();
  const route = createOperatingDeliveryRouteV1({
    state: fixture.state,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Repository Planning work is required.',
  });
  const options = {
    scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
    actor: { actorId: 'owner-001', accessLevel: 'internal' },
    deliveryRoutes: [route],
    events: fixture.events,
  };
  const previous = buildOperateExperienceViewV2(fixture.state, {
    ...options,
    allowedActions: [{ subjectId: fixture.cycle.cycleId, action: base['operate-allowed-action'] }],
  });
  const nextState = clone(fixture.state);
  const nextEvents = [
    ...fixture.events,
    makeEvent(
      {
        eventId: 'evt-live-002',
        timestamp: '2026-08-11T08:01:00Z',
        cycleId: fixture.cycle.cycleId,
        type: fixture.events[0].type,
        entityId: fixture.events[0].entityId,
        actor: fixture.events[0].actor,
        causationId: fixture.events[0].eventId,
        correlationId: 'corr-live',
        payload: fixture.events[0].payload,
      },
      fixture.events[0],
    ),
  ];
  bindEvents(nextState, nextEvents);
  const nextRoute = createOperatingDeliveryRouteV1({
    state: nextState,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Repository Planning work is required.',
  });
  const next = buildOperateExperienceViewV2(nextState, {
    ...options,
    status: 'partial',
    deliveryRoutes: [nextRoute],
    events: nextEvents,
    allowedActions: [{ subjectId: fixture.cycle.cycleId, action: base['operate-allowed-action'] }],
  });
  const patch = buildOperateExperienceLivePatchV2(previous, next);
  assert.equal(applyOperateExperienceLivePatchV2(previous, patch, next), next);
  assert.deepEqual(
    patch.operations.map(({ path }) => path),
    ['/status', '/actions', '/history', '/replay'],
  );
  const preview = createOperateExperiencePreviewV1(fixture.state, {
    scope: options.scope,
    view: previous,
    actionDigest: sha256Jcs(base['operate-allowed-action']),
    authority: 'read-only',
    reasonCodes: ['READ_ONLY'],
    issuedAt: '2026-08-11T08:00:00Z',
    expiresAt: '2026-08-11T08:05:00Z',
  });
  assert.equal(preview.eventHead.hash, fixture.state.eventHead.hash);
  assert.match(preview.consequence, /^Read-only inspection:/);
  assert.throws(
    () =>
      createOperateExperiencePreviewV1(fixture.state, {
        scope: options.scope,
        view: previous,
        actionDigest: `sha256:${'f'.repeat(64)}`,
        authority: 'read-only',
        reasonCodes: ['READ_ONLY'],
        issuedAt: '2026-08-11T08:00:00Z',
        expiresAt: '2026-08-11T08:05:00Z',
      }),
    { code: 'CAPABILITY_DENIED' },
  );
  assert.throws(
    () =>
      buildOperateExperienceLivePatchV2(
        previous,
        buildOperateExperienceViewV2(fixture.state, {
          ...options,
          status: 'partial',
          allowedActions: [
            { subjectId: fixture.cycle.cycleId, action: base['operate-allowed-action'] },
          ],
        }),
      ),
    { code: 'STATE_TRANSITION_INVALID' },
  );

  const initial = makeState();
  bindEvents(initial.state, []);
  initial.events = [];
  const initialRoute = createOperatingDeliveryRouteV1({
    state: initial.state,
    action: initial.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const initialOptions = {
    ...options,
    deliveryRoutes: [initialRoute],
    events: initial.events,
    allowedActions: [],
  };
  const initialView = buildOperateExperienceViewV2(initial.state, initialOptions);
  const sequenceOneState = clone(initial.state);
  const sequenceOneEvents = [clone(fixture.events[0])];
  bindEvents(sequenceOneState, sequenceOneEvents);
  const sequenceOneRoute = createOperatingDeliveryRouteV1({
    state: sequenceOneState,
    action: initial.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const sequenceOneView = buildOperateExperienceViewV2(sequenceOneState, {
    ...initialOptions,
    deliveryRoutes: [sequenceOneRoute],
    events: sequenceOneEvents,
  });
  const initialPatch = buildOperateExperienceLivePatchV2(initialView, sequenceOneView);
  assert.deepEqual(initialPatch.fromEventHead, { sequence: 0, hash: null });
  assert.equal(
    applyOperateExperienceLivePatchV2(initialView, initialPatch, sequenceOneView),
    sequenceOneView,
  );
  const gapState = clone(sequenceOneState);
  const gapEvent2 = makeEvent(
    {
      eventId: 'evt-gap-002',
      timestamp: '2026-08-11T08:01:00Z',
      cycleId: fixture.cycle.cycleId,
      type: fixture.events[0].type,
      entityId: fixture.events[0].entityId,
      actor: fixture.events[0].actor,
      causationId: fixture.events[0].eventId,
      correlationId: 'corr-gap',
      payload: fixture.events[0].payload,
    },
    sequenceOneEvents[0],
  );
  const gapEvent3 = makeEvent(
    {
      eventId: 'evt-gap-003',
      timestamp: '2026-08-11T08:02:00Z',
      cycleId: fixture.cycle.cycleId,
      type: fixture.events[0].type,
      entityId: fixture.events[0].entityId,
      actor: fixture.events[0].actor,
      causationId: gapEvent2.eventId,
      correlationId: 'corr-gap',
      payload: fixture.events[0].payload,
    },
    gapEvent2,
  );
  const gapEvents = [...sequenceOneEvents, gapEvent2, gapEvent3];
  bindEvents(gapState, gapEvents);
  const gapRoute = createOperatingDeliveryRouteV1({
    state: gapState,
    action: initial.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const gapView = buildOperateExperienceViewV2(gapState, {
    ...initialOptions,
    deliveryRoutes: [gapRoute],
    events: gapEvents,
  });
  assert.throws(() => buildOperateExperienceLivePatchV2(sequenceOneView, gapView), {
    code: 'STATE_TRANSITION_INVALID',
  });
  const forkState = clone(sequenceOneState);
  const forkEvents = [
    makeEvent({
      eventId: 'evt-fork-001',
      timestamp: fixture.events[0].timestamp,
      cycleId: fixture.events[0].cycleId,
      type: fixture.events[0].type,
      entityId: fixture.events[0].entityId,
      actor: fixture.events[0].actor,
      correlationId: 'corr-fork',
      payload: fixture.events[0].payload,
    }),
  ];
  bindEvents(forkState, forkEvents);
  const forkRoute = createOperatingDeliveryRouteV1({
    state: forkState,
    action: initial.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const forkView = buildOperateExperienceViewV2(forkState, {
    ...initialOptions,
    deliveryRoutes: [forkRoute],
    events: forkEvents,
  });
  assert.throws(() => buildOperateExperienceLivePatchV2(sequenceOneView, forkView), {
    code: 'STATE_TRANSITION_INVALID',
  });
});

test('Action preview preserves a source-valid 4096-character multiline expected result', () => {
  const fixture = makeState();
  const expectedResult = `First measured outcome\n${'x'.repeat(4096 - 'First measured outcome\n'.length)}`;
  assert.equal(expectedResult.length, 4096);
  const action = { ...clone(fixture.action), expectedResult };
  action.actionHash = derivePersistentOperatingActionRevisionHashV2(action);
  action.revisionId = `actrev_${sha256Jcs({
    actionId: action.actionId,
    revision: action.revision,
    actionHash: action.actionHash,
  }).slice('sha256:'.length)}`;
  fixture.state.actions = [action];
  const route = createOperatingDeliveryRouteV1({
    state: fixture.state,
    action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const scope = {
    scopeId: fixture.cycle.scopeId,
    domainId: fixture.cycle.domainId,
    domainVersion: fixture.cycle.domainVersion,
  };
  const allowedAction = {
    tool: 'operate.action.execute',
    arguments: {
      action: {
        actionId: action.actionId,
        revision: action.revision,
        actionHash: action.actionHash,
      },
    },
    label: 'Execute exact multiline Action',
    effect: 'project-write',
  };
  const view = buildOperateExperienceViewV2(fixture.state, {
    scope,
    actor: { actorId: 'owner-001', accessLevel: 'internal' },
    deliveryRoutes: [route],
    events: fixture.events,
    allowedActions: [{ subjectId: action.actionId, action: allowedAction }],
  });
  const preview = createOperateExperiencePreviewV1(fixture.state, {
    scope,
    view,
    actionDigest: sha256Jcs(allowedAction),
    authority: 'allowed',
    issuedAt: fixture.state.generatedAt,
    expiresAt: '2026-08-11T08:05:00Z',
  });
  assert.ok(preview.consequence.includes(expectedResult));
  assert.equal(preview.consequence.split(expectedResult).length, 2);
});

test('preview rejects foreign review scope and actions not issued in the current actor view', () => {
  const fixture = makeState();
  const foreignCycle = {
    ...clone(fixture.cycle),
    cycleId: 'cyc_foreign_0001',
    scopeId: 'scope-foreign',
  };
  const foreignReview = {
    ...clone(base['operating-review']),
    reviewId: 'rev_foreign_0001',
    cycleId: foreignCycle.cycleId,
  };
  fixture.state.cycles.push(foreignCycle);
  fixture.state.reviews.push(foreignReview);
  const route = createOperatingDeliveryRouteV1({
    state: fixture.state,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const scope = { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' };
  const executeAction = {
    tool: 'operate.action.execute',
    arguments: {
      action: {
        actionId: fixture.action.actionId,
        revision: fixture.action.revision,
        actionHash: fixture.action.actionHash,
      },
    },
    label: 'Execute governed Action',
    effect: 'project-write',
  };
  const view = buildOperateExperienceViewV2(fixture.state, {
    scope,
    actor: { actorId: 'owner-001', accessLevel: 'internal' },
    deliveryRoutes: [route],
    events: fixture.events,
    allowedActions: [
      { subjectId: fixture.cycle.cycleId, action: base['operate-allowed-action'] },
      { subjectId: fixture.action.actionId, action: executeAction },
    ],
  });
  const reviewAction = {
    tool: 'operate.review.get',
    arguments: { reviewId: foreignReview.reviewId },
    label: 'Inspect review',
    effect: 'read-only',
  };
  assert.throws(
    () =>
      createOperateExperiencePreviewV1(fixture.state, {
        scope,
        view,
        actionDigest: sha256Jcs(reviewAction),
        authority: 'read-only',
        issuedAt: '2026-08-11T08:00:00Z',
        expiresAt: '2026-08-11T08:05:00Z',
      }),
    { code: 'CAPABILITY_DENIED' },
  );
  assert.throws(
    () =>
      createOperateExperiencePreviewV1(fixture.state, {
        scope,
        view,
        actionDigest: sha256Jcs({ ...base['operate-allowed-action'], label: 'Forged label' }),
        authority: 'read-only',
        issuedAt: '2026-08-11T08:00:00Z',
        expiresAt: '2026-08-11T08:05:00Z',
      }),
    { code: 'CAPABILITY_DENIED' },
  );
  assert.throws(
    () =>
      createOperateExperiencePreviewV1(fixture.state, {
        scope,
        view,
        actionDigest: sha256Jcs(base['operate-allowed-action']),
        authority: 'read-only',
        consequence: 'Harmless read with no consequence.',
        issuedAt: '2026-08-11T08:00:00Z',
        expiresAt: '2026-08-11T08:05:00Z',
      }),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );
  assert.throws(
    () =>
      createOperateExperiencePreviewV1(fixture.state, {
        scope,
        view,
        actionDigest: sha256Jcs(executeAction),
        authority: 'allowed',
        consequence: 'This is harmless and changes nothing.',
        issuedAt: '2026-08-11T08:00:00Z',
        expiresAt: '2026-08-11T08:05:00Z',
      }),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );
});

test('allowed actions bind operation-specific scope, exact Action tuple, and current actor before projection or preview', () => {
  const fixture = makeState();
  const scope = {
    scopeId: fixture.cycle.scopeId,
    domainId: fixture.cycle.domainId,
    domainVersion: fixture.cycle.domainVersion,
  };
  const actor = { actorId: 'owner-001', accessLevel: 'internal' };
  const localRoute = createOperatingDeliveryRouteV1({
    state: fixture.state,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const execute = {
    tool: 'operate.action.execute',
    arguments: {
      action: {
        actionId: fixture.action.actionId,
        revision: fixture.action.revision,
        actionHash: fixture.action.actionHash,
      },
    },
    label: 'Execute exact local Action',
    effect: 'project-write',
  };
  const claim = {
    tool: 'operate.assignment.claim',
    arguments: {
      assignmentId: fixture.state.assignments[0].assignmentId,
      actor: { actorId: actor.actorId, kind: 'human', runtime: 'codex' },
    },
    label: 'Claim exact local Assignment',
    effect: 'machine-local-write',
  };
  const view = buildOperateExperienceViewV2(fixture.state, {
    scope,
    actor,
    deliveryRoutes: [localRoute],
    events: fixture.events,
    allowedActions: [
      { subjectId: fixture.action.actionId, action: execute },
      { subjectId: fixture.state.assignments[0].assignmentId, action: claim },
    ],
  });
  const issuedClaim = view.allowedActions.find(
    ({ subjectId }) => subjectId === fixture.state.assignments[0].assignmentId,
  ).action;
  assert.doesNotThrow(() =>
    createOperateExperiencePreviewV1(fixture.state, {
      scope,
      view,
      actionDigest: sha256Jcs(issuedClaim),
      authority: 'allowed',
      issuedAt: fixture.state.generatedAt,
      expiresAt: '2026-08-11T08:05:00Z',
    }),
  );

  const foreignActorClaim = {
    ...clone(claim),
    arguments: {
      ...clone(claim.arguments),
      actor: { ...clone(claim.arguments.actor), actorId: 'owner-foreign' },
    },
  };
  assert.throws(
    () =>
      buildOperateExperienceViewV2(fixture.state, {
        scope,
        actor,
        deliveryRoutes: [localRoute],
        events: fixture.events,
        allowedActions: [
          { subjectId: fixture.state.assignments[0].assignmentId, action: foreignActorClaim },
        ],
      }),
    { code: 'CAPABILITY_DENIED' },
  );
  assert.throws(
    () =>
      createOperateExperiencePreviewV1(fixture.state, {
        scope,
        view,
        actionDigest: sha256Jcs(foreignActorClaim),
        authority: 'allowed',
        issuedAt: fixture.state.generatedAt,
        expiresAt: '2026-08-11T08:05:00Z',
      }),
    { code: 'CAPABILITY_DENIED' },
  );

  const foreignCycle = {
    ...clone(fixture.cycle),
    cycleId: 'cyc_foreign_action_001',
    scopeId: 'scope-foreign',
  };
  const foreignAction = {
    ...clone(fixture.action),
    actionId: 'act_foreign_action_001',
    revisionId: 'actrev_foreign_action_001',
    actionHash: 'sha256:9292929292929292929292929292929292929292929292929292929292929292',
    scopeId: 'scope-foreign',
    sourceCycleId: foreignCycle.cycleId,
    state: 'approved',
    updatedAt: '2026-08-11T08:01:00Z',
  };
  const foreignEvent = makeEvent(
    {
      eventId: 'evt-foreign-action-002',
      timestamp: foreignAction.updatedAt,
      cycleId: foreignCycle.cycleId,
      type: 'action.approved',
      entityId: foreignAction.actionId,
      actor: { kind: 'engine', id: 'openplanr' },
      causationId: fixture.events[0].eventId,
      correlationId: 'corr-foreign-action',
      payload: {
        action: {
          actionId: foreignAction.actionId,
          revision: foreignAction.revision,
          actionHash: foreignAction.actionHash,
        },
        from: 'proposed',
        to: 'approved',
        operationId: null,
        resultId: null,
        reasonCode: null,
      },
    },
    fixture.events[0],
  );
  const crossed = clone(fixture.state);
  crossed.cycles.push(foreignCycle);
  crossed.actions.push(foreignAction);
  bindEvents(crossed, [fixture.events[0], foreignEvent]);
  const crossedRoute = createOperatingDeliveryRouteV1({
    state: crossed,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const foreignExecute = {
    ...clone(execute),
    arguments: {
      action: {
        actionId: foreignAction.actionId,
        revision: foreignAction.revision,
        actionHash: foreignAction.actionHash,
      },
    },
  };
  assert.throws(
    () =>
      buildOperateExperienceViewV2(crossed, {
        scope,
        actor,
        deliveryRoutes: [crossedRoute],
        events: [fixture.events[0], foreignEvent],
        allowedActions: [{ subjectId: foreignAction.actionId, action: foreignExecute }],
      }),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );

  const foreignArtifact = {
    ...clone(fixture.evidenceArtifact),
    artifactId: 'art_foreign_read_0001',
    scopeId: 'scope-foreign',
  };
  crossed.artifacts.push(foreignArtifact);
  for (const entry of [
    {
      subjectId: foreignCycle.cycleId,
      action: {
        ...clone(base['operate-allowed-action']),
        arguments: { cycleId: foreignCycle.cycleId },
      },
    },
    {
      subjectId: foreignArtifact.artifactId,
      action: {
        tool: 'operate.artifact.get',
        arguments: {
          artifactId: foreignArtifact.artifactId,
          representation: 'metadata',
          actor: { actorId: actor.actorId, kind: 'human', runtime: 'codex' },
          scope: {
            scopeId: foreignCycle.scopeId,
            domainId: foreignCycle.domainId,
            domainVersion: foreignCycle.domainVersion,
          },
          assignmentId: null,
        },
        label: 'Read foreign Artifact',
        effect: 'read-only',
      },
    },
  ]) {
    assert.throws(
      () =>
        buildOperateExperienceViewV2(crossed, {
          scope,
          actor,
          deliveryRoutes: [crossedRoute],
          events: [fixture.events[0], foreignEvent],
          allowedActions: [entry],
        }),
      { code: 'E_OPERATE_BINDING_MISMATCH' },
    );
  }

  for (const foreignFirst of [true, false]) {
    const collision = clone(fixture.state);
    const sameArtifact = { ...clone(fixture.evidenceArtifact), scopeId: 'scope-foreign' };
    collision.artifacts = foreignFirst
      ? [sameArtifact, ...collision.artifacts]
      : [...collision.artifacts, sameArtifact];
    const artifactRead = {
      tool: 'operate.artifact.get',
      arguments: {
        artifactId: fixture.evidenceArtifact.artifactId,
        representation: 'metadata',
        actor: { actorId: actor.actorId, kind: 'human', runtime: 'codex' },
        scope,
        assignmentId: null,
      },
      label: 'Read local Artifact',
      effect: 'read-only',
    };
    const collisionRoute = createOperatingDeliveryRouteV1({
      state: collision,
      action: fixture.action,
      route: 'planning-work',
      rationale: 'Planning is required.',
    });
    assert.throws(
      () =>
        buildOperateExperienceViewV2(collision, {
          scope,
          actor,
          deliveryRoutes: [collisionRoute],
          events: fixture.events,
          allowedActions: [
            { subjectId: fixture.evidenceArtifact.artifactId, action: artifactRead },
          ],
        }),
      { code: 'E_OPERATE_BINDING_MISMATCH' },
    );

    const actionCollision = clone(fixture.state);
    const sameTuple = { ...clone(fixture.action), scopeId: 'scope-foreign' };
    actionCollision.actions = foreignFirst
      ? [sameTuple, ...actionCollision.actions]
      : [...actionCollision.actions, sameTuple];
    const actionCollisionRoute = createOperatingDeliveryRouteV1({
      state: actionCollision,
      action: fixture.action,
      route: 'planning-work',
      rationale: 'Planning is required.',
    });
    assert.throws(
      () =>
        buildOperateExperienceViewV2(actionCollision, {
          scope,
          actor,
          deliveryRoutes: [actionCollisionRoute],
          events: fixture.events,
          allowedActions: [{ subjectId: fixture.action.actionId, action: execute }],
        }),
      { code: 'E_OPERATE_BINDING_MISMATCH' },
    );
  }
});

test('event-backed Artifact custody and projected record parity reject coordinated access widening and state substitution', () => {
  const fixture = makeState();
  const scope = {
    scopeId: fixture.cycle.scopeId,
    domainId: fixture.cycle.domainId,
    domainVersion: fixture.cycle.domainVersion,
  };
  const artifactEvent = makeEvent(
    {
      eventId: 'evt-artifact-custody-002',
      timestamp: '2026-08-11T07:59:00Z',
      cycleId: fixture.cycle.cycleId,
      type: 'artifact.created',
      entityId: fixture.evidenceArtifact.artifactId,
      actor: { kind: 'engine', id: 'openplanr' },
      causationId: fixture.events[0].eventId,
      correlationId: 'corr-artifact-custody',
      payload: fixture.evidenceArtifact,
    },
    fixture.events[0],
  );
  const state = clone(fixture.state);
  bindEvents(state, [fixture.events[0], artifactEvent]);
  const route = createOperatingDeliveryRouteV1({
    state,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const options = {
    scope,
    actor: { actorId: 'owner-001', accessLevel: 'public' },
    deliveryRoutes: [route],
    events: [fixture.events[0], artifactEvent],
  };
  assert.doesNotThrow(() => buildOperateExperienceViewV2(state, options));
  const widened = clone(state);
  widened.artifacts.find(
    ({ artifactId }) => artifactId === fixture.evidenceArtifact.artifactId,
  ).sensitivity = 'public';
  widened.evidenceRefs.find(
    ({ evidenceRefId }) => evidenceRefId === fixture.evidenceRef.evidenceRefId,
  ).classification = 'public';
  const widenedRoute = createOperatingDeliveryRouteV1({
    state: widened,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  assert.throws(
    () => buildOperateExperienceViewV2(widened, { ...options, deliveryRoutes: [widenedRoute] }),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );

  const fidelity = makeFidelityState();
  const fidelityRoute = createOperatingDeliveryRouteV1({
    state: fidelity.state,
    action: fidelity.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const changedDecision = clone(fidelity.state);
  changedDecision.decisions[0].title = 'Caller-substituted Decision title';
  changedDecision.decisions[0].rationale = 'Caller-substituted rationale.';
  const changedDecisionRoute = createOperatingDeliveryRouteV1({
    state: changedDecision,
    action: fidelity.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  assert.throws(
    () =>
      buildOperateExperienceViewV2(changedDecision, {
        scope,
        actor: { actorId: 'owner-001', accessLevel: 'internal' },
        deliveryRoutes: [changedDecisionRoute],
        events: fidelity.events,
      }),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );

  const outcomeEvent = makeEvent(
    {
      eventId: 'evt-outcome-parity-003',
      timestamp: '2026-08-11T08:00:00Z',
      cycleId: fidelity.cycle.cycleId,
      type: 'outcome.recorded',
      entityId: fidelity.outcome.outcomeId,
      actor: { kind: 'engine', id: 'openplanr' },
      causationId: fidelity.events.at(-1).eventId,
      correlationId: 'corr-outcome-parity',
      payload: fidelity.outcome,
    },
    fidelity.events.at(-1),
  );
  const outcomeState = clone(fidelity.state);
  bindEvents(outcomeState, [...fidelity.events, outcomeEvent]);
  const outcomeRoute = createOperatingDeliveryRouteV1({
    state: outcomeState,
    action: fidelity.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  assert.doesNotThrow(() =>
    buildOperateExperienceViewV2(outcomeState, {
      scope,
      actor: { actorId: 'owner-001', accessLevel: 'internal' },
      deliveryRoutes: [outcomeRoute],
      events: [...fidelity.events, outcomeEvent],
    }),
  );
  const substitutedOutcome = clone(outcomeState);
  substitutedOutcome.outcomes[0].status =
    substitutedOutcome.outcomes[0].status === 'succeeded' ? 'failed' : 'succeeded';
  const substitutedOutcomeRoute = createOperatingDeliveryRouteV1({
    state: substitutedOutcome,
    action: fidelity.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  assert.throws(
    () =>
      buildOperateExperienceViewV2(substitutedOutcome, {
        scope,
        actor: { actorId: 'owner-001', accessLevel: 'internal' },
        deliveryRoutes: [substitutedOutcomeRoute],
        events: [...fidelity.events, outcomeEvent],
      }),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );
  assert.ok(fidelityRoute.routeHash);
});

test('planning proposal preserves attributed accepted summaries and excludes hidden reasoning', () => {
  const fixture = makePlanningJourney();
  const scope = {
    scopeId: fixture.decision.scopeId,
    domainId: fixture.decision.domainId,
    domainVersion: fixture.decision.domainVersion,
  };
  const route = createOperatingDeliveryRouteV1({
    state: fixture.state,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Repository Planning work is required.',
  });
  const input = {
    scope,
    decision: {
      decisionId: fixture.decision.decisionId,
      revision: fixture.decision.revision,
      decisionHash: sha256Jcs(fixture.decision),
    },
    action: {
      actionId: fixture.action.actionId,
      revision: fixture.action.revision,
      actionHash: fixture.action.actionHash,
    },
    deliveryRoute: route,
    sourceVerificationPlanEvent: fixture.verificationPlanEvent,
    acceptedOutputs: fixture.acceptedOutputs,
    framing: {
      title: 'Retention workflow',
      slug: 'retention-workflow',
      problem: 'Retention is below target.',
      objective: 'Improve verified retention.',
      users: ['Operators'],
      scope: ['Repository workflow'],
      nonScope: ['Production deployment'],
      risks: ['Adoption'],
      constraints: ['Reversible changes'],
      requirements: ['Create typed workflow'],
      acceptanceOutcomes: ['Metric reaches target'],
    },
    actor: { actorId: fixture.decision.ownerActorId, kind: 'human', accessLevel: 'internal' },
    createdAt: '2026-08-11T08:00:00Z',
    previewExpiresAt: '2026-08-11T08:05:00Z',
  };
  const proposal = buildOperatingPlanningProposalV1(fixture.state, input);
  assert.equal(
    fixture.acceptedOutputs.find(({ roleKind }) => roleKind === 'chair').sourceArtifactValue
      .sourceArtifactId,
    fixture.state.intelligencePlans[0].sourceArtifactId,
  );
  const foreignFirst = clone(fixture.state);
  foreignFirst.decisions.unshift({ ...clone(fixture.decision), scopeId: 'scope-foreign' });
  foreignFirst.actions.unshift({ ...clone(fixture.action), scopeId: 'scope-foreign' });
  foreignFirst.artifacts.unshift({
    ...clone(fixture.chair),
    scopeId: 'scope-foreign',
    sensitivity: 'restricted',
  });
  foreignFirst.metrics.unshift({
    ...clone(base['operating-metric']),
    metricId: fixture.action.metricId,
    scopeId: 'scope-foreign',
    domainId: scope.domainId,
    domainVersion: scope.domainVersion,
  });
  foreignFirst.verificationPlans.unshift({
    ...clone(fixture.verificationPlan),
    scopeId: 'scope-foreign',
  });
  assert.deepEqual(buildOperatingPlanningProposalV1(foreignFirst, input), proposal);
  const normative = proposal.acceptedPerspectiveSummaries.filter(({ normative }) => normative);
  assert.equal(normative.length, 1);
  assert.equal(normative[0].roleKind, 'chair');
  assert.ok(
    proposal.acceptedPerspectiveSummaries.some(
      ({ roleKind, summary }) =>
        roleKind === 'advisor' &&
        summary === 'A bounded verified observation should precede an operating-course change.',
    ),
  );
  assert.equal(proposal.decision.decisionHash, sha256Jcs(fixture.decision));
  assert.throws(
    () =>
      buildOperatingPlanningProposalV1(fixture.state, {
        ...input,
        perspectives: [{ summary: 'caller injection' }],
      }),
    { code: 'RESULT_CONTRACT_INVALID' },
  );
  const forgedOutputs = clone(fixture.acceptedOutputs);
  forgedOutputs[0].sourceArtifactValue.summary = 'Caller-selected executive summary.';
  assert.throws(
    () =>
      buildOperatingPlanningProposalV1(fixture.state, { ...input, acceptedOutputs: forgedOutputs }),
    { code: 'ARTIFACT_HASH_MISMATCH' },
  );
  const hiddenOutput = clone(fixture.acceptedOutputs);
  hiddenOutput[0].summary = 'Caller-selected summary.';
  assert.throws(
    () =>
      buildOperatingPlanningProposalV1(fixture.state, { ...input, acceptedOutputs: hiddenOutput }),
    { code: 'RESULT_CONTRACT_INVALID' },
  );
  const circularChairState = clone(fixture.state);
  const circularChairOutputs = clone(fixture.acceptedOutputs);
  const circularChairOutput = circularChairOutputs.find(({ roleKind }) => roleKind === 'chair');
  circularChairOutput.sourceArtifactValue.sourceArtifactId = circularChairOutput.artifactId;
  const circularHash = sha256Jcs(circularChairOutput.sourceArtifactValue);
  const circularArtifact = circularChairState.artifacts.find(
    ({ artifactId }) => artifactId === circularChairOutput.artifactId,
  );
  const circularSubmission = circularChairState.submissions.find(
    ({ artifactId }) => artifactId === circularChairOutput.artifactId,
  );
  circularArtifact.rawHash = circularHash;
  circularArtifact.canonicalHash = circularHash;
  circularSubmission.rawHash = circularHash;
  circularSubmission.canonicalHash = circularHash;
  assert.throws(
    () =>
      buildOperatingPlanningProposalV1(circularChairState, {
        ...input,
        acceptedOutputs: circularChairOutputs,
      }),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );
  const restricted = makePlanningJourney();
  const restrictedAdvisor = restricted.acceptedOutputs.find(
    ({ roleKind }) => roleKind === 'advisor',
  );
  restricted.state.artifacts.find(
    ({ artifactId }) => artifactId === restrictedAdvisor.artifactId,
  ).sensitivity = 'restricted';
  const restrictedRoute = createOperatingDeliveryRouteV1({
    state: restricted.state,
    action: restricted.action,
    route: 'planning-work',
    rationale: 'Repository Planning work is required.',
  });
  const restrictedInput = {
    ...input,
    decision: {
      decisionId: restricted.decision.decisionId,
      revision: restricted.decision.revision,
      decisionHash: sha256Jcs(restricted.decision),
    },
    action: {
      actionId: restricted.action.actionId,
      revision: restricted.action.revision,
      actionHash: restricted.action.actionHash,
    },
    deliveryRoute: restrictedRoute,
    acceptedOutputs: restricted.acceptedOutputs,
  };
  assert.throws(() => buildOperatingPlanningProposalV1(restricted.state, restrictedInput), {
    code: 'ARTIFACT_HASH_MISMATCH',
  });
  assert.throws(() =>
    confirmOperatingPlanningProposalV1(
      { ...proposal, state: 'approved', revision: 2 },
      confirmationFor(proposal, '2026-08-11T08:01:00Z'),
    ),
  );
  assert.throws(
    () =>
      confirmOperatingPlanningProposalV1(
        proposal,
        confirmationFor(proposal, '2026-08-11T07:59:59Z'),
      ),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  assert.throws(
    () =>
      confirmOperatingPlanningProposalV1(
        proposal,
        confirmationFor(proposal, '2026-08-11T08:06:00Z'),
      ),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  assert.throws(
    () =>
      confirmOperatingPlanningProposalV1(
        proposal,
        confirmationFor(proposal, '2026-08-11T08:01:00Z', {
          eventHead: {
            sequence: 2,
            hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        }),
      ),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );
  const approved = confirmOperatingPlanningProposalV1(
    proposal,
    confirmationFor(proposal, '2026-08-11T08:01:00Z'),
  );
  assert.equal(approved.confirmation.reviewProposalHash, proposal.proposalHash);
  assert.deepEqual(approved.confirmation.eventHead, proposal.eventHead);
  assert.equal(readOperatingPlanningProposalV1(approved, { protocolVersion: '2.0.0' }), approved);
  assert.throws(
    () =>
      confirmOperatingPlanningProposalV1(
        approved,
        confirmationFor(approved, '2026-08-11T08:02:00Z'),
      ),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  const origin = createOperatingOriginV1({
    proposal: approved,
    spec: {
      specId: 'SPEC-020',
      slug: 'retention-workflow',
      contentHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      status: 'shaping',
    },
    actor: { actorId: proposal.actor.actorId, kind: 'human' },
    transaction: {
      transactionId: 'txn-001',
      receiptHash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      planningProvenanceEventId: 'prv-001',
    },
    createdAt: '2026-08-11T08:02:00Z',
  });
  assert.equal(readOperatingOriginV1(origin, { protocolVersion: '2.0.0' }), origin);
  const planRun = {
    runId: 'run-plan-001',
    runtime: 'codex',
    packageVersion: '0.42.0',
    provenanceEventId: 'event-plan-001',
    provenanceEventHash: 'sha256:1212121212121212121212121212121212121212121212121212121212121212',
    status: 'succeeded',
  };
  const shipRun = {
    runId: 'run-ship-001',
    runtime: 'codex',
    packageVersion: '0.42.0',
    manifestHash: 'sha256:1313131313131313131313131313131313131313131313131313131313131313',
    provenanceEventId: 'event-ship-001',
    provenanceEventHash: 'sha256:1414141414141414141414141414141414141414141414141414141414141414',
    status: 'succeeded',
  };
  assert.throws(
    () =>
      buildOperatingDeliveryEvidenceV1({
        origin,
        planRun,
        shipRun: { ...shipRun, verificationPlanId: 'vfy_substitute_001' },
        tasks: [],
        changedSurfaces: ['lib/example.mjs'],
        qa: { status: 'passed', reportHash: null, summary: 'Passed.' },
        summary: 'Delivered.',
        deliveryStatus: 'succeeded',
        createdAt: '2026-08-11T08:03:00Z',
      }),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );
  const delivery = buildOperatingDeliveryEvidenceV1({
    origin,
    planRun,
    shipRun,
    tasks: [],
    changedSurfaces: ['lib/example.mjs'],
    qa: { status: 'passed', reportHash: null, summary: 'Passed.' },
    summary: 'Delivered.',
    deliveryStatus: 'succeeded',
    createdAt: '2026-08-11T08:03:00Z',
  });
  assert.equal(delivery.rollback, null);
  assert.throws(
    () =>
      buildOperatingDeliveryEvidenceV1({
        origin,
        planRun,
        shipRun,
        tasks: [],
        changedSurfaces: [],
        qa: { status: 'passed', reportHash: null, summary: 'Passed.' },
        artifacts: [
          {
            artifactId: 'rollback-private',
            hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            classification: 'restricted',
          },
        ],
        classification: 'public',
        summary: 'Delivered.',
        deliveryStatus: 'succeeded',
        createdAt: '2026-08-11T08:03:00Z',
      }),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );
  assert.throws(
    () =>
      buildOperatingDeliveryEvidenceV1({
        origin,
        planRun,
        shipRun,
        tasks: [],
        changedSurfaces: [],
        qa: { status: 'passed', reportHash: null, summary: 'Passed.' },
        summary: 'Rolled back.',
        deliveryStatus: 'rolled-back',
        createdAt: '2026-08-11T08:03:00Z',
      }),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );
  const rollback = {
    rollbackPlanId: 'rbp_plan_001',
    rollbackPlanArtifactId: 'rollback-plan-artifact',
    rollbackPlanHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    rollbackResultId: 'rbres_result_001',
    rollbackResultArtifactId: 'rollback-result-artifact',
    rollbackResultHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    rollbackReceiptId: 'rollback-receipt-001',
    rollbackReceiptArtifactId: 'rollback-receipt-artifact',
    rollbackReceiptHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    rollbackProvenanceEventId: 'event-rollback-001',
    originalShipRunId: 'run-ship-001',
    rollbackRunId: 'run-rollback-001',
    targetBeforeHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    targetAfterHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    status: 'succeeded',
    completedAt: '2026-08-11T08:04:00Z',
  };
  const rolledBack = buildOperatingDeliveryEvidenceV1({
    origin,
    planRun,
    shipRun,
    tasks: [],
    changedSurfaces: [],
    qa: { status: 'passed', reportHash: null, summary: 'Passed.' },
    summary: 'Rolled back.',
    deliveryStatus: 'rolled-back',
    rollback,
    createdAt: '2026-08-11T08:05:00Z',
  });
  assert.equal(rolledBack.rollback.rollbackPlanId, rollback.rollbackPlanId);
  assert.notEqual(rolledBack.deliveryEvidenceId, delivery.deliveryEvidenceId);
  assert.deepEqual(delivery.verification, origin.verification);
  assert.equal(readOperatingDeliveryEvidenceV1(delivery, { protocolVersion: '2.0.0' }), delivery);
  assert.throws(
    () =>
      readOperatingDeliveryEvidenceV1(
        {
          ...delivery,
          metric: {
            ...delivery.metric,
            metricHash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          },
        },
        { protocolVersion: '2.0.0' },
      ),
    { code: 'E_OPERATE_BINDING_MISMATCH' },
  );
});

test('route changes require a new exact Action revision', () => {
  const fixture = makeState();
  const previous = createOperatingDeliveryRouteV1({
    state: fixture.state,
    action: fixture.action,
    route: 'planning-work',
    rationale: 'Planning is required.',
  });
  const next = createOperatingDeliveryRouteV1({
    state: fixture.state,
    action: fixture.action,
    route: 'observe-only',
    rationale: 'Observe only.',
  });
  assert.throws(() => assertOperatingDeliveryRouteRevisionV1(previous, next), {
    code: 'ACTION_REVISION_MISMATCH',
  });
});
