import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import {
  assertOperateExperienceArtifactV2,
  assertProtocolArtifact,
} from '@openplanr/protocol/contracts';
import { PipelineError } from '@openplanr/protocol/errors';
import { buildOperateExperienceLivePatchV2 } from '@openplanr/protocol/operate-experience-live-patch';
import {
  assertOperatingApprovalRequirementIntegrityV2,
  consumeOperatingApprovalRecordsV2,
  evaluateOperatingApprovalSetV2,
} from './approvals-v2.mjs';
import { applyOperatingReviewWorkDispositionsV2 } from './cycle-closure-v2.mjs';
import { readOperatingExecutiveBoardV2 } from './executive-board-compatibility-v2.mjs';
import { buildExecutiveBoardForCycle } from './executive-board-projection-v2.mjs';
import { OPERATING_INTELLIGENCE_NOT_SELECTED_ABSENCE } from './intelligence-router-v2.mjs';
import { promotePersistentOperatingActionAuthorityV2 } from './persistent-work-v2.mjs';
import {
  assertOperatingExecuteDispatchAuthorityChainV2,
  assertOperatingExecuteOperationV2,
  assertOperatingRollbackAuthorityChainV2,
  computeOperatingRuntimeEventHashV2,
  reconstructOperatingVerificationPlanActionV2,
  resolveOperatingLatestActionEvaluationV2,
  verifyOperatingRuntimeEventChainV2,
} from './runtime-foundation.mjs';
import {
  deriveOperatingIntelligenceAssignmentIdV2,
  resolveOperatingAssignmentInputAbsencesV2,
  resolveOperatingAssignmentInputArtifactIdsV2,
} from './scheduler-v2.mjs';
import { assertOperatingTraceMatrixV2 } from './trace-matrix-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';
const ACTION_APPROVE_CAPABILITY = Object.freeze({ id: 'action-approve', version: '1.0.0' });
const ACCESS_ORDER = Object.freeze(['public', 'internal', 'confidential', 'restricted']);
const STAGES = Object.freeze([
  'observe',
  'understand',
  'decide',
  'govern',
  'act',
  'verify',
  'learn',
]);
const CYCLE_STAGE = Object.freeze({
  created: 0,
  observing: 0,
  advising: 1,
  challenging: 1,
  synthesizing: 1,
  awaiting_review: 2,
  approved: 3,
  executing: 4,
  verifying: 5,
  closed: 6,
  blocked: 0,
  failed: 0,
  cancelled: 0,
});

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', { retryable: false, context });
}

function assignmentAbsence(assignment) {
  const terminal = assignment?.terminalOutcome;
  if (!terminal || !['abandoned', 'failed'].includes(assignment.state)) return null;
  return Object.freeze({
    outcome: terminal.outcome,
    code: terminal.code,
    reason: terminal.reason,
    recoveryDisposition: terminal.recoveryDisposition,
  });
}

function intelligencePlanForCycle(indexes, cycleAssignments) {
  const plans = indexes.intelligencePlans?.values?.() ?? [];
  const assignmentIds = new Set(cycleAssignments.map(({ assignmentId }) => assignmentId));
  for (const plan of plans) {
    if (
      plan.selectedRoles.some(({ roleId, roleVersion }) =>
        assignmentIds.has(
          deriveOperatingIntelligenceAssignmentIdV2(plan.planId, roleId, roleVersion),
        ),
      )
    )
      return plan;
  }
  return null;
}

function lensAbsencesForPlan(plan) {
  if (!plan) return [];
  return [...plan.omittedRoles]
    .sort((left, right) => left.roleId.localeCompare(right.roleId))
    .map((role) => {
      if (
        typeof role.reason !== 'string' ||
        !role.reason.startsWith(`${OPERATING_INTELLIGENCE_NOT_SELECTED_ABSENCE}:`)
      ) {
        fail(
          'RESULT_CONTRACT_INVALID',
          'Omitted intelligence roles must declare a typed absence reason.',
          {
            roleId: role.roleId,
            reason: role.reason ?? null,
          },
        );
      }
      return Object.freeze({
        roleId: role.roleId,
        roleKind: role.roleKind,
        absenceCode: OPERATING_INTELLIGENCE_NOT_SELECTED_ABSENCE,
        reason: role.reason,
      });
    });
}

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function without(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

function stableId(prefix, value) {
  return `${prefix}_${sha256Jcs(value).slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

function assertCanonicalView(view) {
  assertOperateExperienceArtifactV2('operate-experience-view', view);
  if (view.viewHash !== sha256Jcs(without(view, 'viewHash')))
    fail('E_OPERATE_BINDING_MISMATCH', 'Experience viewHash does not equal its canonical content.');
  return view;
}

function validInstant(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
    fail('RESULT_CONTRACT_INVALID', `${field} must be an RFC 3339 instant.`);
  return value;
}

function assertBinding(binding, field) {
  if (
    !binding ||
    typeof binding !== 'object' ||
    ['scopeId', 'domainId', 'domainVersion'].some(
      (key) => typeof binding[key] !== 'string' || binding[key].length === 0,
    )
  ) {
    fail('OPERATING_SCOPE_INVALID', `${field} requires one explicit scope/domain/version binding.`);
  }
}

function sameScope(value, scope) {
  return (
    value?.scopeId === scope.scopeId &&
    value?.domainId === scope.domainId &&
    value?.domainVersion === scope.domainVersion
  );
}

function uniqueIdentityIndex(records, identityField, entityName) {
  const index = new Map();
  for (const record of records) {
    const identity = record?.[identityField];
    if (typeof identity !== 'string' || identity.length === 0 || index.has(identity)) {
      fail(
        'RESULT_CONTRACT_INVALID',
        `Experience projection requires unique scope-local ${entityName} identities.`,
        { identity: identity ?? null },
      );
    }
    index.set(identity, record);
  }
  return index;
}

function buildScopeIdentityIndexes(state, scope) {
  const scoped = (records) => (records ?? []).filter((record) => sameScope(record, scope));
  const cycles = uniqueIdentityIndex(scoped(state.cycles), 'cycleId', 'Cycle');
  const cycleIds = new Set(cycles.keys());
  for (const cycleId of cycleIds) {
    if (state.cycles.filter((record) => record.cycleId === cycleId).length !== 1) {
      fail(
        'RESULT_CONTRACT_INVALID',
        'Experience projection requires globally unambiguous Cycle identities for scope-less dependent records.',
        { cycleId },
      );
    }
  }
  const actions = uniqueIdentityIndex(scoped(state.actions), 'actionId', 'Action');
  const actionMatches = (record) => {
    const action = actions.get(record?.action?.actionId ?? record?.actionId);
    const binding = record?.action;
    return (
      Boolean(action) &&
      (!binding ||
        (binding.revision === action.revision && binding.actionHash === action.actionHash))
    );
  };
  return {
    cycles,
    inputBindings: uniqueIdentityIndex(
      scoped(state.inputBindings).filter(({ cycleId }) => cycleIds.has(cycleId)),
      'cycleId',
      'cycle input binding',
    ),
    assignments: uniqueIdentityIndex(
      state.assignments.filter(({ cycleId }) => cycleIds.has(cycleId)),
      'assignmentId',
      'Assignment',
    ),
    reviews: uniqueIdentityIndex(
      state.reviews.filter(({ cycleId }) => cycleIds.has(cycleId)),
      'reviewId',
      'Review',
    ),
    executiveBoards: uniqueIdentityIndex(
      scoped(state.executiveBoards ?? []),
      'boardId',
      'Executive Board',
    ),
    artifacts: uniqueIdentityIndex(scoped(state.artifacts), 'artifactId', 'Artifact'),
    decisions: uniqueIdentityIndex(scoped(state.decisions), 'decisionId', 'Decision'),
    actions,
    actionPolicies: [...(state.actionPolicies ?? [])],
    outcomes: uniqueIdentityIndex(scoped(state.outcomes), 'outcomeId', 'Outcome'),
    learnings: uniqueIdentityIndex(scoped(state.learnings), 'learningId', 'Learning'),
    policyEvaluations: uniqueIdentityIndex(
      (state.policyEvaluations ?? []).filter((record) => {
        const action = actions.get(record?.action?.actionId);
        return (
          Boolean(action) &&
          record.action.revision === action.revision &&
          record.action.actionHash === action.actionHash
        );
      }),
      'evaluationId',
      'policy evaluation',
    ),
    approvalRequirements: uniqueIdentityIndex(
      scoped(state.approvalRequirements),
      'requirementId',
      'approval requirement',
    ),
    approvalRecords: uniqueIdentityIndex(
      scoped(state.approvalRecords),
      'approvalId',
      'approval record',
    ),
    metrics: uniqueIdentityIndex(scoped(state.metrics), 'metricId', 'Metric'),
    metricObservations: uniqueIdentityIndex(
      scoped(state.metricObservations),
      'observationId',
      'metric observation',
    ),
    snapshots: uniqueIdentityIndex(scoped(state.operatingSnapshots), 'snapshotId', 'Snapshot'),
    deltas: uniqueIdentityIndex(scoped(state.deltas), 'deltaId', 'Delta'),
    claims: uniqueIdentityIndex(scoped(state.claims), 'claimId', 'Claim'),
    findings: uniqueIdentityIndex(scoped(state.findings), 'findingId', 'Finding'),
    verificationPlans: uniqueIdentityIndex(
      scoped(state.verificationPlans),
      'verificationPlanId',
      'verification plan',
    ),
    evidenceRefs: uniqueIdentityIndex(
      scoped(state.evidenceRefs),
      'evidenceRefId',
      'evidence reference',
    ),
    evidenceResolutions: uniqueIdentityIndex(
      scoped(state.evidenceResolutions),
      'resolutionId',
      'evidence resolution',
    ),
    evidenceEdges: uniqueIdentityIndex(scoped(state.evidenceEdges), 'edgeId', 'evidence edge'),
    intelligencePlans: uniqueIdentityIndex(
      scoped(state.intelligencePlans ?? []),
      'planId',
      'intelligence plan',
    ),
    decisionLedgers: uniqueIdentityIndex(
      scoped(state.decisionLedgers ?? []),
      'ledgerId',
      'decision ledger',
    ),
    governedOperations: uniqueIdentityIndex(
      (state.governedOperations ?? []).filter(actionMatches),
      'operationId',
      'governed operation',
    ),
    executionResults: uniqueIdentityIndex(
      (state.executionResults ?? []).filter(actionMatches),
      'resultId',
      'execution result',
    ),
    rollbackPlans: uniqueIdentityIndex(
      (state.rollbackPlans ?? []).filter(actionMatches),
      'rollbackPlanId',
      'rollback plan',
    ),
    rollbackResults: uniqueIdentityIndex(
      (state.rollbackResults ?? []).filter(actionMatches),
      'rollbackResultId',
      'rollback result',
    ),
    stateEvents: state.eventReplayIndex,
  };
}

function compareLatest(left, right) {
  return right.updatedAt.localeCompare(left.updatedAt) || left.cycleId.localeCompare(right.cycleId);
}

function cycleStages(cycle) {
  const current = CYCLE_STAGE[cycle.state];
  return STAGES.map((id, index) => {
    let state = index < current ? 'complete' : index === current ? 'current' : 'waiting';
    if (cycle.state === 'closed') state = 'complete';
    if (index === current && ['blocked', 'failed'].includes(cycle.state)) state = cycle.state;
    if (index === current && cycle.state === 'cancelled') state = 'skipped';
    return {
      id,
      state,
      reason:
        state === 'blocked' || state === 'failed' || state === 'skipped'
          ? `Cycle is ${cycle.state}.`
          : null,
    };
  });
}

function routeFor(action, routes, scope, eventHead) {
  const candidates = routes.filter((route) => route.action.actionId === action.actionId);
  if (candidates.length !== 1)
    fail('RESULT_CONTRACT_INVALID', 'Every current Action requires exactly one delivery route.', {
      actionId: action.actionId,
      candidates: candidates.length,
    });
  const route = candidates[0];
  assertOperateExperienceArtifactV2('operating-delivery-route', route);
  if (
    !sameScope(route, scope) ||
    route.action.revision !== action.revision ||
    route.action.actionHash !== action.actionHash ||
    route.eventHead.sequence !== eventHead.sequence ||
    route.eventHead.hash !== eventHead.hash ||
    route.routeHash !== sha256Jcs(without(route, 'routeHash'))
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Delivery route does not bind the exact Action revision, scope, domain, and Event head.',
      { actionId: action.actionId },
    );
  }
  return route;
}

function approvalComplete(requirement, indexes, now) {
  const action = indexes.actions.get(requirement.action.actionId) ?? null;
  const evaluation = indexes.policyEvaluations.get(requirement.evaluationId) ?? null;
  if (!action || !evaluation) return false;
  const requirements = evaluation.approvalRequirementIds.map(
    (requirementId) => indexes.approvalRequirements.get(requirementId) ?? null,
  );
  if (
    requirements.some((entry) => entry === null) ||
    !requirements.some(({ requirementId }) => requirementId === requirement.requirementId)
  )
    return false;
  const approvals = [...indexes.approvalRecords.values()].filter(
    ({ evaluationId }) => evaluationId === evaluation.evaluationId,
  );
  try {
    const result = evaluateOperatingApprovalSetV2({
      evaluation,
      action,
      requirements,
      approvals,
      now,
    });
    return result.complete === true && result.disposition === 'approved';
  } catch {
    return false;
  }
}

function currentApprovalRequirement(requirement, indexes) {
  const evaluations = [...indexes.policyEvaluations.values()]
    .filter(
      (entry) =>
        entry.action.actionId === requirement.action.actionId &&
        entry.action.revision === requirement.action.revision &&
        entry.action.actionHash === requirement.action.actionHash,
    )
    .sort(
      (left, right) =>
        left.evaluatedAt.localeCompare(right.evaluatedAt) ||
        left.evaluationId.localeCompare(right.evaluationId),
    );
  const current = evaluations.at(-1);
  if (!current) return !indexes.policyEvaluations.has(requirement.evaluationId);
  return (
    current.evaluationId === requirement.evaluationId &&
    current.approvalRequirementIds.includes(requirement.requirementId)
  );
}

function approvalRequirementConsumed(requirement, indexes) {
  return [...indexes.approvalRecords.values()].some((entry) => {
    if (entry.requirementId !== requirement.requirementId || entry.consumedByOperationId === null)
      return false;
    const operation = indexes.governedOperations.get(entry.consumedByOperationId);
    return (
      operation?.evaluationId === requirement.evaluationId &&
      operation.action.actionId === requirement.action.actionId &&
      operation.action.revision === requirement.action.revision &&
      operation.action.actionHash === requirement.action.actionHash &&
      operation.approvalIds.includes(entry.approvalId)
    );
  });
}

function sameCanonicalValue(left, right) {
  return sha256Jcs(left) === sha256Jcs(right);
}

function sameActionIdentity(left, right) {
  return (
    left?.actionId === right?.actionId &&
    left?.revision === right?.revision &&
    left?.actionHash === right?.actionHash
  );
}

function exactRollbackApprovalTemplate(indexes, action, actorId, at) {
  let evaluation = null;
  try {
    evaluation = resolveOperatingLatestActionEvaluationV2({
      evaluations: [...indexes.policyEvaluations.values()],
      action,
      configuredPolicies: indexes.actionPolicies,
      at,
    });
  } catch {
    evaluation = null;
  }
  if (
    !evaluation ||
    !sameActionIdentity(evaluation.action, action) ||
    !sameCanonicalValue(evaluation.capability, action.requestedCapability) ||
    !sameCanonicalValue(evaluation.target, action.targetBinding) ||
    evaluation.effectClass !== action.effectClass ||
    !['named-single-party', 'named-multi-party', 'threshold'].includes(evaluation.outcome)
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Rollback approval requires one exact current Action policy evaluation.',
    );
  }
  const policies = indexes.actionPolicies.filter(
    (policy) =>
      policy.policyId === evaluation.policy.policyId &&
      policy.policyVersion === evaluation.policy.policyVersion &&
      policy.policyHash === evaluation.policy.policyHash &&
      policy.domainId === action.domainId &&
      sameCanonicalValue(policy.actionKind, action.actionKind) &&
      sameCanonicalValue(policy.capability, action.requestedCapability) &&
      policy.effectClasses.includes(action.effectClass) &&
      policy.targetKinds.includes(action.targetBinding.kind) &&
      policy.decisionMode === evaluation.outcome &&
      policy.rollbackRequired === true,
  );
  if (policies.length !== 1) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Rollback approval requires one exact current Action policy.',
    );
  }
  const eligible = evaluation.approvalRequirementIds.flatMap((requirementId) => {
    const candidate = indexes.approvalRequirements.get(requirementId);
    let requirement = null;
    try {
      requirement = candidate ? assertOperatingApprovalRequirementIntegrityV2(candidate) : null;
    } catch {
      requirement = null;
    }
    if (
      !requirement ||
      requirement.evaluationId !== evaluation.evaluationId ||
      !sameActionIdentity(requirement.action, action) ||
      !sameScope(requirement, action) ||
      !sameCanonicalValue(requirement.policy, evaluation.policy) ||
      !sameCanonicalValue(requirement.capability, action.requestedCapability) ||
      !sameCanonicalValue(requirement.target, action.targetBinding) ||
      requirement.effectClass !== action.effectClass ||
      requirement.mode !== evaluation.outcome ||
      requirement.consumable !== true ||
      requirement.scopeHash !== sha256Jcs(without(requirement, 'scopeHash'))
    )
      return [];
    return requirement.parties
      .filter(
        (party) =>
          party.actorKind === 'human' &&
          party.actorId === actorId &&
          sameCanonicalValue(party.requiredCapability, ACTION_APPROVE_CAPABILITY),
      )
      .map((party) => ({ evaluation, policy: policies[0], requirement, party }));
  });
  if (eligible.length !== 1) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Rollback approval requires one exact human actor party and approval template.',
    );
  }
  return eligible[0];
}

function exactRollbackApprovalContext(indexes, action, rollback, actorId, at) {
  const plan = indexes.rollbackPlans.get(rollback?.rollbackPlanId);
  const operation = indexes.governedOperations.get(rollback?.originalOperationId);
  const result = indexes.executionResults.get(rollback?.executionResultId);
  if (
    !plan ||
    !operation ||
    !result ||
    operation.operationKind !== 'execute' ||
    result.operationKind !== 'execute' ||
    operation.state !== result.status ||
    !['succeeded', 'partial'].includes(result.status) ||
    operation.rollbackClass !== 'reversible' ||
    operation.rollbackPlanId !== null ||
    operation.parentOperationId !== null ||
    result.rollbackPlanId !== null ||
    operation.resultId !== result.resultId ||
    result.operationId !== operation.operationId ||
    operation.requestFingerprint !== result.requestFingerprint ||
    operation.assignmentId !== result.assignmentId ||
    operation.evaluationId !== result.evaluationId ||
    operation.grantId !== result.grantId ||
    plan.operationId !== operation.operationId ||
    plan.executionResultId !== result.resultId ||
    plan.planHash !== rollback.planHash ||
    plan.planHash !== sha256Jcs(without(plan, 'planHash')) ||
    operation.operationHash !== sha256Jcs(without(operation, 'operationHash')) ||
    result.resultHash !== sha256Jcs(without(result, 'resultHash')) ||
    !sameActionIdentity(operation.action, action) ||
    !sameActionIdentity(result.action, action) ||
    !sameActionIdentity(plan.action, action) ||
    !sameCanonicalValue(operation.approvalIds, result.approvalIds) ||
    !sameCanonicalValue(operation.capability, action.requestedCapability) ||
    !sameCanonicalValue(result.capability, action.requestedCapability) ||
    !sameCanonicalValue(plan.capability, action.requestedCapability) ||
    !sameCanonicalValue(operation.target, action.targetBinding) ||
    !sameCanonicalValue(result.target, action.targetBinding) ||
    !sameCanonicalValue(operation.executor, result.executor) ||
    !sameCanonicalValue(operation.connector, result.connector) ||
    !sameCanonicalValue(operation.inputArtifactIds, result.inputArtifactIds) ||
    operation.effectClass !== action.effectClass ||
    result.effectClass !== action.effectClass ||
    plan.effectClass !== action.effectClass ||
    operation.verificationPlanId !== action.verificationPlanId ||
    result.verificationPlanId !== action.verificationPlanId ||
    plan.verificationPlanId !== action.verificationPlanId ||
    result.baselineArtifactId !== plan.baselineArtifactId ||
    result.baselineHash !== plan.baselineHash ||
    result.targetAfterHash === null ||
    result.targetAfterHash !== plan.steps[0]?.expectedTargetHash ||
    plan.steps[0]?.expectedTargetHash !== rollback.expectedTargetHash
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Rollback approval requires one exact current plan, operation, result, Action, target, and effect binding.',
    );
  }
  return {
    plan,
    operation,
    result,
    template: exactRollbackApprovalTemplate(indexes, action, actorId, at),
  };
}

function openApprovalRequirement(requirement, indexes, now) {
  return (
    currentApprovalRequirement(requirement, indexes) &&
    !approvalRequirementConsumed(requirement, indexes) &&
    !approvalComplete(requirement, indexes, now)
  );
}

export function createOperateExperienceReplayCheckpointV2(
  state,
  { createdAt = state?.generatedAt, recoveryVersion = '1.0.0' } = {},
) {
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
  validInstant(createdAt, 'checkpoint.createdAt');
  const checkpoint = {
    kind: 'operating-checkpoint',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    createdAt,
    eventHead: { ...clone(state.eventHead), protocolVersions: [PROTOCOL_VERSION] },
    runtimeStateHash: sha256Jcs(state),
    eventReplayIndexHash: sha256Jcs(state.eventReplayIndex),
    recordDigests: [],
    blobHashes: [],
    recoveryVersion,
  };
  assertProtocolArtifact('operating-checkpoint', checkpoint, { protocolVersion: PROTOCOL_VERSION });
  return freeze(checkpoint);
}

function validateReplayCheckpoint(state, checkpoint, checkpointState) {
  if (checkpoint === null) {
    if (checkpointState !== null) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'A retained replay base requires its exact checkpoint contract.',
      );
    }
    return null;
  }
  assertProtocolArtifact('operating-checkpoint', checkpoint, { protocolVersion: PROTOCOL_VERSION });
  const baseState = checkpointState ?? state;
  assertProtocolArtifact('operating-runtime-state', baseState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  const eventReplayIndexHash = sha256Jcs(baseState.eventReplayIndex);
  const runtimeStateHash = sha256Jcs(baseState);
  const baseSequence = checkpoint.eventHead.sequence;
  if (
    checkpoint.runtimeStateHash !== runtimeStateHash ||
    checkpoint.eventReplayIndexHash !== eventReplayIndexHash ||
    baseSequence !== baseState.eventHead.sequence ||
    checkpoint.eventHead.hash !== baseState.eventHead.hash ||
    baseSequence > state.eventHead.sequence ||
    baseState.eventReplayIndex.length !== baseSequence ||
    state.eventReplayIndex.length !== state.eventHead.sequence ||
    sha256Jcs(state.eventReplayIndex.slice(0, baseSequence)) !==
      sha256Jcs(baseState.eventReplayIndex)
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Replay checkpoint does not bind the exact retained base, replay prefix, and Event head.',
    );
  }
  const projection = freeze({
    createdAt: checkpoint.createdAt,
    eventHead: { sequence: checkpoint.eventHead.sequence, hash: checkpoint.eventHead.hash },
    runtimeStateHash: checkpoint.runtimeStateHash,
    eventReplayIndexHash: checkpoint.eventReplayIndexHash,
    recoveryVersion: checkpoint.recoveryVersion,
  });
  return freeze({ projection, state: clone(baseState) });
}

function exactReplayEntry(event) {
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

function expectedEventEntityId(event) {
  const payload = event.payload;
  if (event.type === 'planning-delivery.ingested')
    return payload.deliveryEvidence.deliveryEvidenceId;
  if (event.type === 'cycle.input-bound') return payload.inputBindingId;
  if (event.type === 'executive-board.materialized') return payload.boardId;
  if (event.type.startsWith('assignment.')) return payload.assignmentId;
  if (event.type === 'artifact.created') return payload.artifactId;
  if (event.type.startsWith('review.')) return payload.reviewId;
  if (event.type === 'work-change-set.materialized') return payload.artifactId;
  if (event.type === 'evidence.resolved') return payload.evidenceRef.evidenceRefId;
  if (event.type === 'evidence.rejected') return payload.resolution.resolutionId;
  if (event.type === 'operating-state.materialized') return payload.stateId;
  if (event.type === 'snapshot.materialized') return payload.snapshotId;
  if (
    [
      'metric.observed',
      'claim.recorded',
      'finding.recorded',
      'risk.recorded',
      'assumption.recorded',
      'decision.revised',
      'delta.derived',
      'scenario.recorded',
      'trigger.recorded',
    ].includes(event.type)
  ) {
    const field = {
      'metric.observed': 'observationId',
      'claim.recorded': 'claimId',
      'finding.recorded': 'findingId',
      'risk.recorded': 'riskId',
      'assumption.recorded': 'assumptionId',
      'decision.revised': 'decisionId',
      'delta.derived': 'deltaId',
      'scenario.recorded': 'scenarioId',
      'trigger.recorded': 'triggerId',
    }[event.type];
    return payload.record[field];
  }
  if (event.type === 'intelligence.plan-recorded') return payload.planId;
  if (event.type === 'decision-ledger.materialized') return payload.ledgerId;
  if (event.type === 'verification.plan-recorded') return payload.verificationPlanId;
  if (event.type === 'outcome.recorded') return payload.outcomeId;
  if (event.type === 'learning.recorded') return payload.learningId;
  if (event.type === 'domain-projection.rebuilt') return payload.projectionId;
  if (event.type === 'policy.evaluated') return payload.evaluationId;
  if (event.type === 'approval.recorded') return payload.approvalId;
  if (event.type === 'capability.availability-recorded') return payload.availabilityId;
  if (event.type === 'capability.granted') return payload.grantId;
  if (event.type === 'operation.intent-recorded') return payload.operation.operationId;
  if (event.type === 'execution.result-recorded') return payload.result.resultId;
  if (event.type === 'rollback.plan-recorded') return payload.rollbackPlanId;
  if (event.type === 'rollback.result-recorded') return payload.rollbackResultId;
  if (event.type.startsWith('action.')) return payload.action.actionId;
  if (event.type.startsWith('cycle.')) return payload.cycleId;
  return null;
}

function scopedEventPayloadRecords(value, records = []) {
  if (Array.isArray(value)) {
    for (const entry of value) scopedEventPayloadRecords(entry, records);
    return records;
  }
  if (!value || typeof value !== 'object') return records;
  if (['scopeId', 'domainId', 'domainVersion'].some((field) => Object.hasOwn(value, field)))
    records.push(value);
  for (const entry of Object.values(value)) scopedEventPayloadRecords(entry, records);
  return records;
}

const EVENT_PARITY_COLLECTIONS = Object.freeze({
  assignments: ['assignments', 'assignmentId'],
  artifacts: ['artifacts', 'artifactId'],
  findings: ['findings', 'findingId'],
  decisions: ['decisions', 'decisionId'],
  actions: ['actions', 'actionId'],
  executiveBoards: ['executiveBoards', 'boardId'],
  operatingModelStates: ['operatingModelStates', 'stateId'],
  risks: ['risks', 'riskId'],
  assumptions: ['assumptions', 'assumptionId'],
  intelligencePlans: ['intelligencePlans', 'planId'],
  decisionLedgers: ['decisionLedgers', 'ledgerId'],
  scenarios: ['scenarios', 'scenarioId'],
  eventTriggers: ['eventTriggers', 'triggerId'],
  domainProjections: ['domainProjections', 'projectionId'],
  policyEvaluations: ['policyEvaluations', 'evaluationId'],
  approvalRecords: ['approvalRecords', 'approvalId'],
  capabilityAvailability: ['capabilityAvailability', 'availabilityId'],
  capabilityGrants: ['capabilityGrants', 'grantId'],
  governedOperations: ['governedOperations', 'operationId'],
  rollbackPlans: ['rollbackPlans', 'rollbackPlanId'],
  evidenceRefs: ['evidenceRefs', 'evidenceRefId'],
  evidenceResolutions: ['evidenceResolutions', 'resolutionId'],
  evidenceEdges: ['evidenceEdges', 'edgeId'],
  snapshots: ['operatingSnapshots', 'snapshotId'],
  metricObservations: ['metricObservations', 'observationId'],
  claims: ['claims', 'claimId'],
  deltas: ['deltas', 'deltaId'],
  verificationPlans: ['verificationPlans', 'verificationPlanId'],
  outcomes: ['outcomes', 'outcomeId'],
  learnings: ['learnings', 'learningId'],
  executionResults: ['executionResults', 'resultId'],
  rollbackResults: ['rollbackResults', 'rollbackResultId'],
});

function scopedRecordKey(record, identityField) {
  return `${record.scopeId}\u0000${record.domainId}\u0000${record.domainVersion}\u0000${record[identityField]}`;
}

function uniqueStateRecord(records, identityField, identity, collection) {
  const matches = (records ?? []).filter((record) => record?.[identityField] === identity);
  if (matches.length !== 1)
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Operation authority requires one exact current-state owner.',
      { collection, identity, matches: matches.length },
    );
  return matches[0];
}

function intentOperationReplayBinding(state, event) {
  const { operation, request, terminal } = event.payload;
  const replay = uniqueStateRecord(
    state.operationReplayIndex,
    'operationId',
    operation.operationId,
    'operationReplayIndex',
  );
  const exact = {
    operationId: operation.operationId,
    operationKind: operation.operationKind,
    requestFingerprint: operation.requestFingerprint,
    actionId: operation.action.actionId,
    actionRevision: operation.action.revision,
    actionHash: operation.action.actionHash,
    payloadArtifactId: request.payload.artifactId,
    payloadHash: request.payload.contentHash,
    baselineArtifactId: request.rollbackBaseline?.artifactId ?? null,
    baselineHash: request.rollbackBaseline?.contentHash ?? null,
    targetBeforeHash: request.targetBeforeHash,
    intentEventId: event.eventId,
    operationHash: operation.operationHash,
    reservedResultId: terminal.resultId,
    reservedResultArtifactId: terminal.resultArtifactId,
    reservedSubmissionId: terminal.submissionId,
    reservedTerminalEventIds: clone(terminal.eventIds),
    reservedCompletedAt: terminal.completedAt,
    reservedCorrelationId: terminal.correlationId,
    reservedUncertaintyResultId: terminal.uncertainty.resultId,
    reservedUncertaintyResultArtifactId: terminal.uncertainty.resultArtifactId,
    reservedUncertaintySubmissionId: terminal.uncertainty.submissionId,
    reservedUncertaintyTerminalEventIds: clone(terminal.uncertainty.eventIds),
  };
  for (const [field, value] of Object.entries(exact)) {
    if (sha256Jcs(replay[field]) !== sha256Jcs(value))
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Operation replay ownership diverges from the exact intent Event.',
        { operationId: operation.operationId, field },
      );
  }
  return { ...clone(replay), terminalResultId: null, terminalReceipt: null };
}

function validateOperationIntentAuthority(state, event, derived, promotedActionKeys) {
  const { operation, request } = event.payload;
  const cycle = uniqueStateRecord(state.cycles, 'cycleId', event.cycleId, 'cycles');
  const actions = [...derived.actions.values()].filter(
    (candidate) => candidate.actionId === operation.action.actionId && sameScope(candidate, cycle),
  );
  const assignments = [...derived.assignments.values()].filter(
    (candidate) => candidate.assignmentId === operation.assignmentId,
  );
  const evaluations = [...derived.policyEvaluations.values()].filter(
    (candidate) => candidate.evaluationId === operation.evaluationId,
  );
  const grants = [...derived.capabilityGrants.values()].filter(
    (candidate) => candidate.grantId === operation.grantId,
  );
  const availability = [...derived.capabilityAvailability.values()].filter(
    (candidate) =>
      candidate.checkedAt === event.timestamp &&
      candidate.capability?.id === operation.capability.id &&
      candidate.capability?.version === operation.capability.version &&
      candidate.target?.kind === operation.target.kind &&
      candidate.target?.id === operation.target.id &&
      candidate.target?.revision === operation.target.revision,
  );
  if (
    actions.length !== 1 ||
    assignments.length !== 1 ||
    evaluations.length !== 1 ||
    grants.length !== 1 ||
    availability.length !== 1
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Operation intent authority must have one exact prior canonical Event owner.',
      { operationId: operation.operationId },
    );
  }
  const [action] = actions;
  const [assignment] = assignments;
  const [evaluation] = evaluations;
  const [grant] = grants;
  if (
    !sameScope(action, cycle) ||
    action.sourceCycleId !== cycle.cycleId ||
    assignment.cycleId !== cycle.cycleId
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Operation authority crosses its exact Action scope or Cycle binding.',
      { operationId: operation.operationId, cycleId: cycle.cycleId },
    );
  }
  const actionKey = scopedRecordKey(action, 'actionId');
  const sameActionOwners = [...derived.governedOperations.values()].filter(
    (candidate) =>
      candidate.action?.actionId === operation.action.actionId &&
      candidate.action?.revision === operation.action.revision &&
      candidate.action?.actionHash === operation.action.actionHash,
  );
  const duplicateOperation = [...derived.governedOperations.values()].some(
    (candidate) => candidate.operationId === operation.operationId,
  );
  const parent =
    operation.operationKind === 'rollback'
      ? derived.governedOperations.get(
          [...derived.governedOperations.keys()].find(
            (key) =>
              derived.governedOperations.get(key).operationId === operation.parentOperationId,
          ),
        )
      : null;
  const ownerValid =
    operation.operationKind === 'execute'
      ? sameActionOwners.length === 0
      : parent &&
        parent.operationKind === 'execute' &&
        parent.operationId === operation.parentOperationId &&
        sameActionOwners.filter((candidate) => candidate.operationKind === 'rollback').length === 0;
  if (
    !promotedActionKeys.has(actionKey) ||
    duplicateOperation ||
    !ownerValid ||
    operation.action.revision !== action.revision ||
    operation.action.actionHash !== action.actionHash ||
    assignment.state !== 'running' ||
    grant.consumedAt !== null
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Operation intent authority must exist in exact prior canonical Event-derived state.',
      { operationId: operation.operationId },
    );
  }
  const requirements = evaluation.approvalRequirementIds.map((requirementId) =>
    uniqueStateRecord(
      state.approvalRequirements,
      'requirementId',
      requirementId,
      'approvalRequirements',
    ),
  );
  const eventApprovals = [...derived.approvalRecords.values()].filter(
    (record) => record.evaluationId === evaluation.evaluationId,
  );
  const intentReplayEntry = intentOperationReplayBinding(state, event);
  try {
    const dispatchProof =
      operation.operationKind === 'execute'
        ? assertOperatingExecuteDispatchAuthorityChainV2({
            state,
            operationId: operation.operationId,
          })
        : assertOperatingRollbackAuthorityChainV2({ state, operationId: operation.operationId });
    if (
      sha256Jcs(dispatchProof.intentOperation) !== sha256Jcs(operation) ||
      sha256Jcs(dispatchProof.intentAssignment) !== sha256Jcs(assignment) ||
      sha256Jcs(dispatchProof.intentGrant) !== sha256Jcs(grant) ||
      sha256Jcs(dispatchProof.availability) !== sha256Jcs(availability[0]) ||
      sha256Jcs(dispatchProof.intentReplayEntry) !== sha256Jcs(intentReplayEntry)
    ) {
      throw new Error('dispatch-chain-divergence');
    }
    const disposition = evaluateOperatingApprovalSetV2({
      evaluation,
      action,
      requirements,
      approvals: eventApprovals,
      now: event.timestamp,
    });
    if (
      disposition.complete !== true ||
      disposition.disposition !== 'approved' ||
      sha256Jcs(disposition.approvalIds) !== sha256Jcs(operation.approvalIds)
    )
      throw new Error('approval-set-divergence');
    if (operation.operationKind === 'execute') {
      assertOperatingExecuteOperationV2({
        operation,
        action,
        assignment,
        evaluation,
        evaluations: [...derived.policyEvaluations.values()],
        configuredPolicies: state.actionPolicies,
        grant,
        requirements,
        approvals: eventApprovals,
        capabilityAvailability: availability[0],
        request: {
          payload: {
            artifactId: request.payload.artifactId,
            contentHash: request.payload.contentHash,
          },
          rollbackBaseline:
            request.rollbackBaseline === null
              ? null
              : {
                  artifactId: request.rollbackBaseline.artifactId,
                  contentHash: request.rollbackBaseline.contentHash,
                },
        },
        timestamp: event.timestamp,
      });
    }
    if (operation.approvalIds.length > 0) {
      const consumed = consumeOperatingApprovalRecordsV2({
        approvals: eventApprovals,
        requirements,
        approvalIds: operation.approvalIds,
        operationId: operation.operationId,
      });
      for (const record of consumed.records) {
        const key = scopedRecordKey(record, 'approvalId');
        derived.approvalRecords.set(key, clone(record));
      }
    }
  } catch (error) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Operation intent does not satisfy the canonical execution-authority chain.',
      { operationId: operation.operationId, cause: error.code ?? error.message },
    );
  }
  return intentReplayEntry;
}

function validateProjectedStateEventParity(state, events, cycles, baseState = null) {
  const derived = Object.fromEntries(
    Object.keys(EVENT_PARITY_COLLECTIONS).map((name) => [name, new Map()]),
  );
  const canonicalMetrics = new Map();
  const submissions = new Map();
  const submissionReplay = new Map();
  const operationReplay = new Map();
  const actionTransitions = new Map();
  const cycleTransitions = new Map();
  const reviews = new Map();
  const promotedActionKeys = new Set();
  const put = (name, record) => {
    const [, identityField] = EVENT_PARITY_COLLECTIONS[name];
    const key = scopedRecordKey(record, identityField);
    if (derived[name].has(key))
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Canonical Event history duplicates one immutable full-record identity.',
        { collection: EVENT_PARITY_COLLECTIONS[name][0], identity: record[identityField] },
      );
    derived[name].set(key, clone(record));
  };
  const putGlobal = (index, identity, record, collection) => {
    if (index.has(identity))
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Canonical Event history duplicates one runtime-owned identity.',
        { collection, identity },
      );
    index.set(identity, clone(record));
  };
  const putCanonicalMetric = (metric) => {
    const key = scopedRecordKey(metric, 'metricId');
    const prior = canonicalMetrics.get(key);
    if (prior && sha256Jcs(prior) !== sha256Jcs(metric)) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Verification-plan Events resolve one Metric identity to conflicting immutable model states.',
        {
          metricId: metric.metricId,
        },
      );
    }
    if (!prior) canonicalMetrics.set(key, clone(metric));
  };
  if (baseState !== null) {
    for (const [name, [stateField, identityField]] of Object.entries(EVENT_PARITY_COLLECTIONS)) {
      for (const record of baseState[stateField] ?? []) {
        const key = scopedRecordKey(record, identityField);
        if (derived[name].has(key)) {
          fail(
            'E_OPERATE_BINDING_MISMATCH',
            'Retained replay base duplicates one canonical record identity.',
            {
              collection: stateField,
              identity: record[identityField],
            },
          );
        }
        derived[name].set(key, clone(record));
      }
    }
    for (const record of baseState.submissions ?? []) {
      putGlobal(submissions, record.submissionId, record, 'submissions');
    }
    for (const record of baseState.submissionReplayIndex ?? []) {
      putGlobal(submissionReplay, record.submissionId, record, 'submissionReplayIndex');
    }
    for (const record of baseState.operationReplayIndex ?? []) {
      putGlobal(operationReplay, record.operationId, record, 'operationReplayIndex');
    }
    for (const action of baseState.actions ?? []) {
      const key = scopedRecordKey(action, 'actionId');
      actionTransitions.set(key, {
        actionId: action.actionId,
        revision: action.revision,
        actionHash: action.actionHash,
        state: action.state,
        updatedAt: action.updatedAt,
      });
      if (Object.hasOwn(action, 'revisionId')) promotedActionKeys.add(key);
    }
    for (const cycle of baseState.cycles ?? []) {
      cycleTransitions.set(cycle.cycleId, { state: cycle.state, updatedAt: cycle.updatedAt });
    }
    for (const review of baseState.reviews ?? []) {
      reviews.set(`${review.cycleId}\u0000${review.reviewId}`, clone(review));
    }
  }
  for (const event of events) {
    const cycle = cycles.get(event.cycleId);
    const payload = event.payload;
    if (event.type === 'planning-delivery.ingested') {
      let reconstructed;
      try {
        reconstructed = reconstructOperatingVerificationPlanActionV2({
          state,
          event: payload.verificationPlanEvent,
        });
      } catch (error) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Planning delivery evidence cannot reconstruct its original canonical verification plan.',
          {
            deliveryEvidenceId: payload.deliveryEvidence?.deliveryEvidenceId ?? null,
            cause: error.code ?? error.message,
          },
        );
      }
      const action = state.actions.find(({ actionId }) => actionId === payload.origin.action.id);
      const decision = state.decisions.find(
        ({ decisionId }) => decisionId === payload.origin.decision.id,
      );
      if (
        event.actor.kind !== 'runtime' ||
        event.actor.id !== 'openplanr' ||
        event.entityId !== payload.deliveryEvidence.deliveryEvidenceId ||
        event.causationId !== payload.verificationPlanEvent.eventId ||
        payload.deliveryEvidence.deliveryEvidenceHash !==
          sha256Jcs(without(payload.deliveryEvidence, 'deliveryEvidenceHash')) ||
        payload.artifact.canonicalHash !== sha256Jcs(payload.deliveryEvidence) ||
        payload.evidenceRef.evidenceArtifactId !== payload.artifact.artifactId ||
        !payload.assignment.inputArtifactIds.includes(payload.artifact.artifactId) ||
        payload.assignment.assignmentKind !== 'verification' ||
        payload.assignment.governedOperationId !== null ||
        payload.assignment.capabilityGrantId !== null ||
        !action ||
        action.revision !== payload.origin.action.revision ||
        action.actionHash !== payload.origin.action.hash ||
        !decision ||
        decision.revision !== payload.origin.decision.revision ||
        sha256Jcs(decision) !== payload.origin.decision.hash ||
        reconstructed.action.actionId !== action.actionId ||
        reconstructed.verificationPlan.verificationPlanId !==
          payload.origin.verification.verificationPlanId ||
        sha256Jcs(reconstructed.verificationPlan) !==
          payload.origin.verification.verificationPlanHash ||
        reconstructed.metric.metricId !== payload.origin.metric.metricId ||
        sha256Jcs(reconstructed.metric) !== payload.origin.metric.metricHash
      ) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Planning delivery Event lost its exact Action, Decision, metric, verification, evidence, or Assignment custody.',
          {
            deliveryEvidenceId: payload.deliveryEvidence?.deliveryEvidenceId ?? null,
          },
        );
      }
      put('assignments', payload.assignment);
      put('artifacts', payload.artifact);
      put('evidenceRefs', payload.evidenceRef);
    }
    if (event.type === 'assignment.created') put('assignments', payload);
    if (event.type.startsWith('assignment.') && event.type !== 'assignment.created') {
      const assignmentKey = [...derived.assignments.keys()].find(
        (key) => derived.assignments.get(key).assignmentId === payload.assignmentId,
      );
      const assignment = assignmentKey ? derived.assignments.get(assignmentKey) : null;
      if (assignment) {
        const patches = {
          'assignment.available': {
            state: 'available',
            availableAt: event.timestamp,
            inputArtifactIds: resolveOperatingAssignmentInputArtifactIdsV2(
              assignment,
              payload.dependencyProofs ?? [],
            ),
            inputAbsences: resolveOperatingAssignmentInputAbsencesV2(assignment, {
              dependencyProofs: payload.dependencyProofs ?? [],
              assignments: [...derived.assignments.values()],
              intelligencePlans: [...derived.intelligencePlans.values()],
            }),
          },
          'assignment.claimed': {
            state: 'claimed',
            claim: {
              actorId: payload.actorId,
              actorKind: payload.actorKind,
              runtime: payload.runtime,
              claimId: payload.claimId,
            },
          },
          'assignment.started': {
            state: 'running',
            attemptPolicy: { ...assignment.attemptPolicy, attempt: payload.attempt },
          },
          'assignment.submitted': { state: 'submitted' },
          'assignment.validated': { state: 'validated', completedAt: event.timestamp },
          'assignment.rejected': { state: 'rejected' },
          'assignment.abandoned': {
            state: 'abandoned',
            completedAt: event.timestamp,
            terminalOutcome: {
              outcome: 'abandoned',
              eventId: event.eventId,
              code: payload.reasonCode,
              reason: payload.reason,
              recoveryDisposition: payload.recoveryDisposition,
            },
          },
          'assignment.failed': {
            state: 'failed',
            completedAt: event.timestamp,
            terminalOutcome: {
              outcome: 'failed',
              eventId: event.eventId,
              code: payload.errorCode,
              reason: payload.reason,
              recoveryDisposition: payload.recoveryStatus,
            },
          },
        };
        if (patches[event.type])
          derived.assignments.set(assignmentKey, { ...assignment, ...patches[event.type] });
        if (event.type === 'assignment.claimed') {
          putGlobal(
            submissions,
            payload.submissionId,
            {
              kind: 'operating-submission',
              schemaVersion: '1.0.0',
              protocolVersion: PROTOCOL_VERSION,
              submissionId: payload.submissionId,
              assignmentId: assignment.assignmentId,
              cycleId: assignment.cycleId,
              state: 'issued',
              rawHash: null,
              canonicalHash: null,
              sizeBytes: null,
              artifactId: null,
              acceptanceEventIds: [],
              responseData: null,
              issuedAt: event.timestamp,
              resolvedAt: null,
            },
            'submissions',
          );
        }
        if (event.type === 'assignment.submitted') {
          const submission = submissions.get(payload.submissionId);
          if (
            !submission ||
            submission.assignmentId !== assignment.assignmentId ||
            submission.state !== 'issued'
          ) {
            fail(
              'E_OPERATE_BINDING_MISMATCH',
              'Assignment submission lacks one prior runtime-issued Submission.',
              { submissionId: payload.submissionId },
            );
          }
          submissions.set(payload.submissionId, {
            ...submission,
            rawHash: payload.rawHash,
            canonicalHash: payload.canonicalHash,
            sizeBytes: payload.sizeBytes,
            acceptanceEventIds: [event.eventId],
          });
        }
        if (event.type === 'assignment.validated') {
          const submission = submissions.get(payload.submissionId);
          const artifact = [...derived.artifacts.values()].find(
            ({ artifactId }) => artifactId === payload.artifactId,
          );
          if (!submission || !artifact || submission.assignmentId !== assignment.assignmentId) {
            fail(
              'E_OPERATE_BINDING_MISMATCH',
              'Assignment validation lacks its prior Submission and Artifact.',
              { submissionId: payload.submissionId, artifactId: payload.artifactId },
            );
          }
          const responseData = {
            accepted: true,
            artifactId: artifact.artifactId,
            rawHash: artifact.rawHash,
            sizeBytes: artifact.sizeBytes,
            assignmentState: 'validated',
          };
          const acceptanceEventIds = [...submission.acceptanceEventIds, event.eventId];
          submissions.set(payload.submissionId, {
            ...submission,
            state: 'accepted',
            artifactId: artifact.artifactId,
            acceptanceEventIds,
            responseData,
            resolvedAt: event.timestamp,
          });
          putGlobal(
            submissionReplay,
            payload.submissionId,
            {
              submissionId: payload.submissionId,
              assignmentId: assignment.assignmentId,
              rawHash: artifact.rawHash,
              canonicalHash: artifact.canonicalHash,
              sizeBytes: artifact.sizeBytes,
              artifactId: artifact.artifactId,
              acceptanceEventIds,
              responseData,
            },
            'submissionReplayIndex',
          );
        }
        if (event.type === 'assignment.rejected') {
          const submission = submissions.get(payload.submissionId);
          if (!submission || submission.assignmentId !== assignment.assignmentId) {
            fail('E_OPERATE_BINDING_MISMATCH', 'Assignment rejection lacks its prior Submission.', {
              submissionId: payload.submissionId,
            });
          }
          submissions.set(payload.submissionId, {
            ...submission,
            state: 'rejected',
            acceptanceEventIds: [event.eventId],
            responseData: {
              accepted: false,
              violations: clone(payload.violations),
              attemptsRemaining: payload.attemptsRemaining,
            },
            resolvedAt: event.timestamp,
          });
        }
      }
    }
    if (event.type === 'artifact.created') {
      put('artifacts', payload);
      const matchingSubmissions = [...submissions.values()].filter(
        (candidate) =>
          candidate.assignmentId === payload.assignmentId &&
          candidate.rawHash === payload.rawHash &&
          candidate.canonicalHash === payload.canonicalHash &&
          candidate.sizeBytes === payload.sizeBytes &&
          candidate.acceptanceEventIds.at(-1) === event.causationId,
      );
      if (matchingSubmissions.length > 1) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Artifact creation has ambiguous prior Submission custody.',
          { assignmentId: payload.assignmentId, artifactId: payload.artifactId },
        );
      }
      if (matchingSubmissions.length === 1) {
        const [submission] = matchingSubmissions;
        submissions.set(submission.submissionId, {
          ...submission,
          acceptanceEventIds: [...submission.acceptanceEventIds, event.eventId],
        });
      }
    }
    if (event.type === 'executive-board.materialized') {
      put('executiveBoards', payload);
      cycleTransitions.set(event.cycleId, { state: 'awaiting_review', updatedAt: event.timestamp });
    }
    if (event.type === 'work-change-set.materialized') {
      for (const record of payload.findings) put('findings', record);
      for (const record of payload.decisions) put('decisions', record);
      for (const record of payload.actions) put('actions', record);
    }
    if (event.type === 'action.authority-promoted') {
      const key = scopedRecordKey(payload.action, 'actionId');
      const prior = derived.actions.get(key);
      let expectedPromotion = null;
      try {
        expectedPromotion = promotePersistentOperatingActionAuthorityV2(
          payload.before,
          payload.authority,
        );
      } catch {
        expectedPromotion = null;
      }
      if (
        !prior ||
        sha256Jcs(prior) !== sha256Jcs(payload.before) ||
        Object.hasOwn(prior, 'revisionId') ||
        payload.action.revision !== 1 ||
        payload.action.predecessorRevisionId !== null ||
        !expectedPromotion ||
        sha256Jcs(expectedPromotion) !== sha256Jcs(payload.action) ||
        event.requestHash !==
          sha256Jcs({
            contract: 'operating-action-authority-promotion-v2',
            before: payload.before,
            authority: payload.authority,
          }) ||
        event.actor.kind !== 'engine' ||
        event.actor.id !== 'openplanr'
      ) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Action authority promotion requires one exact prior Event-backed ungoverned Action.',
          { actionId: payload.action.actionId },
        );
      }
      derived.actions.set(key, clone(payload.action));
      promotedActionKeys.add(key);
    }
    if (event.type === 'evidence.resolved') {
      put('evidenceResolutions', payload.resolution);
      put('evidenceRefs', payload.evidenceRef);
      put('artifacts', payload.evidenceArtifact);
      for (const record of payload.edges) put('evidenceEdges', record);
    }
    if (event.type === 'evidence.rejected') put('evidenceResolutions', payload.resolution);
    if (event.type === 'operating-state.materialized') put('operatingModelStates', payload);
    if (event.type === 'snapshot.materialized') put('snapshots', payload);
    if (event.type === 'metric.observed') put('metricObservations', payload.record);
    if (event.type === 'claim.recorded') put('claims', payload.record);
    if (event.type === 'finding.recorded') put('findings', payload.record);
    if (event.type === 'risk.recorded') put('risks', payload.record);
    if (event.type === 'assumption.recorded') put('assumptions', payload.record);
    if (event.type === 'decision.revised') put('decisions', payload.record);
    if (event.type === 'delta.derived') put('deltas', payload.record);
    if (event.type === 'intelligence.plan-recorded') put('intelligencePlans', payload);
    if (event.type === 'decision-ledger.materialized') put('decisionLedgers', payload);
    if (event.type === 'verification.plan-recorded') {
      let reconstructed;
      try {
        reconstructed = reconstructOperatingVerificationPlanActionV2({ state, event });
      } catch (error) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Verification-plan Event cannot reconstruct its exact ledger-derived Action.',
          {
            verificationPlanId: payload?.verificationPlanId ?? null,
            cause: error.code ?? error.message,
          },
        );
      }
      put('verificationPlans', payload);
      putCanonicalMetric(reconstructed.metric);
      const actionKey = scopedRecordKey(reconstructed.action, 'actionId');
      const prior = derived.actions.get(actionKey);
      if (prior && sha256Jcs(prior) !== sha256Jcs(reconstructed.action)) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Verification-plan Event Action conflicts with an earlier Event owner.',
          {
            actionId: reconstructed.action.actionId,
            verificationPlanId: payload.verificationPlanId,
          },
        );
      }
      if (!prior) derived.actions.set(actionKey, clone(reconstructed.action));
    }
    if (event.type === 'outcome.recorded') {
      const sourceArtifact =
        [...derived.artifacts.values()].find(
          ({ artifactId }) => artifactId === payload.sourceArtifactId,
        ) ?? null;
      const sourceAssignment = sourceArtifact
        ? ([...derived.assignments.values()].find(
            ({ assignmentId }) => assignmentId === sourceArtifact.assignmentId,
          ) ?? null)
        : null;
      if (
        payload.status === 'insufficient-evidence' &&
        sourceAssignment?.assignmentKind === 'verification'
      ) {
        const plan =
          [...derived.verificationPlans.values()].find(
            ({ verificationPlanId }) => verificationPlanId === payload.verificationPlanId,
          ) ?? null;
        const action =
          [...derived.actions.values()].find(({ actionId }) => actionId === payload.actionId) ??
          null;
        const source = exactInsufficientEvidenceChain(derived, plan, action, payload);
        const submission =
          [...submissions.values()].find(
            (candidate) => candidate.artifactId === source.artifact.artifactId,
          ) ?? null;
        if (
          event.actor.kind !== 'runtime' ||
          event.actor.id !== 'openplanr' ||
          !submission ||
          submission.state !== 'accepted' ||
          event.causationId !== submission.acceptanceEventIds.at(-1)
        ) {
          fail(
            'E_OPERATE_BINDING_MISMATCH',
            'Insufficient-evidence Outcome lacks its exact accepted terminal verification Event chain.',
            {
              outcomeId: payload.outcomeId,
            },
          );
        }
      }
      put('outcomes', payload);
    }
    if (event.type === 'learning.recorded') {
      const outcome =
        [...derived.outcomes.values()].find(({ outcomeId }) => outcomeId === payload.outcomeId) ??
        null;
      const sourceArtifact = outcome
        ? ([...derived.artifacts.values()].find(
            ({ artifactId }) => artifactId === outcome.sourceArtifactId,
          ) ?? null)
        : null;
      const sourceAssignment = sourceArtifact
        ? ([...derived.assignments.values()].find(
            ({ assignmentId }) => assignmentId === sourceArtifact.assignmentId,
          ) ?? null)
        : null;
      if (
        outcome?.status === 'insufficient-evidence' &&
        sourceAssignment?.assignmentKind === 'verification'
      ) {
        const plan =
          [...derived.verificationPlans.values()].find(
            ({ verificationPlanId }) => verificationPlanId === outcome.verificationPlanId,
          ) ?? null;
        const action =
          [...derived.actions.values()].find(({ actionId }) => actionId === outcome.actionId) ??
          null;
        const source = exactInsufficientEvidenceChain(derived, plan, action, outcome);
        const submission =
          [...submissions.values()].find(
            (candidate) => candidate.artifactId === source.artifact.artifactId,
          ) ?? null;
        if (
          event.actor.kind !== 'runtime' ||
          event.actor.id !== 'openplanr' ||
          !submission ||
          submission.state !== 'accepted' ||
          event.causationId !== submission.acceptanceEventIds.at(-1) ||
          payload.sourceArtifactId !== outcome.sourceArtifactId ||
          payload.createdAt !== event.timestamp ||
          payload.evidenceRefIds.length !== 0 ||
          payload.assumptionIds.length !== 0 ||
          payload.decisionIds.length !== 1 ||
          payload.decisionIds[0] !== action.sourceDecisionId
        ) {
          fail(
            'E_OPERATE_BINDING_MISMATCH',
            'Insufficient-evidence Learning lacks its exact accepted Outcome and terminal verification Event chain.',
            {
              learningId: payload.learningId,
            },
          );
        }
      }
      put('learnings', payload);
    }
    if (event.type === 'scenario.recorded') put('scenarios', payload.record);
    if (event.type === 'trigger.recorded') put('eventTriggers', payload.record);
    if (event.type === 'domain-projection.rebuilt') put('domainProjections', payload);
    if (event.type === 'policy.evaluated') {
      if (
        event.actor.kind !== 'runtime' ||
        event.actor.id !== 'openplanr' ||
        event.requestHash !== payload.inputHash ||
        event.timestamp !== payload.evaluatedAt
      ) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Policy evaluation authority requires its exact prior runtime Event.',
          { evaluationId: payload.evaluationId },
        );
      }
      put('policyEvaluations', payload);
    }
    if (event.type === 'approval.recorded') {
      if (
        event.actor.kind !== payload.actor.kind ||
        event.actor.id !== payload.actor.actorId ||
        event.timestamp !== payload.issuedAt
      ) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Approval authority requires its exact prior actor and issuance Event.',
          { approvalId: payload.approvalId },
        );
      }
      put('approvalRecords', payload);
    }
    if (event.type === 'capability.availability-recorded') put('capabilityAvailability', payload);
    if (event.type === 'capability.granted') put('capabilityGrants', payload);
    if (event.type === 'operation.intent-recorded') {
      const intentReplayEntry = validateOperationIntentAuthority(
        state,
        event,
        derived,
        promotedActionKeys,
      );
      put('governedOperations', payload.operation);
      putGlobal(
        operationReplay,
        payload.operation.operationId,
        intentReplayEntry,
        'operationReplayIndex',
      );
      const successSubmission = submissions.get(payload.terminal.submissionId);
      if (
        !successSubmission ||
        successSubmission.assignmentId !== payload.operation.assignmentId ||
        successSubmission.state !== 'issued'
      ) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Operation intent lacks its exact runtime-issued success Submission.',
          { operationId: payload.operation.operationId },
        );
      }
      putGlobal(
        submissions,
        payload.terminal.uncertainty.submissionId,
        {
          kind: 'operating-submission',
          schemaVersion: '1.0.0',
          protocolVersion: PROTOCOL_VERSION,
          submissionId: payload.terminal.uncertainty.submissionId,
          assignmentId: payload.operation.assignmentId,
          cycleId: event.cycleId,
          state: 'issued',
          rawHash: null,
          canonicalHash: null,
          sizeBytes: null,
          artifactId: null,
          acceptanceEventIds: [],
          responseData: null,
          issuedAt: event.timestamp,
          resolvedAt: null,
        },
        'submissions',
      );
      const grantKey = [...derived.capabilityGrants.keys()].find(
        (key) => derived.capabilityGrants.get(key).grantId === payload.operation.grantId,
      );
      if (!grantKey)
        fail('E_OPERATE_BINDING_MISMATCH', 'Operation intent lacks one prior exact grant Event.', {
          operationId: payload.operation.operationId,
        });
      const consumedGrant = {
        ...derived.capabilityGrants.get(grantKey),
        consumedAt: event.timestamp,
      };
      consumedGrant.grantHash = sha256Jcs(without(consumedGrant, 'grantHash'));
      derived.capabilityGrants.set(grantKey, consumedGrant);
    }
    if (event.type === 'execution.result-recorded') {
      put('executionResults', payload.result);
      const operationKey = [...derived.governedOperations.keys()].find(
        (key) => derived.governedOperations.get(key).operationId === payload.result.operationId,
      );
      const operation = operationKey ? derived.governedOperations.get(operationKey) : null;
      const replay = operationReplay.get(payload.result.operationId);
      const terminalReservation = ['succeeded', 'partial'].includes(payload.result.status)
        ? {
            resultId: replay?.reservedResultId,
            artifactId: replay?.reservedResultArtifactId,
            submissionId: replay?.reservedSubmissionId,
          }
        : {
            resultId: replay?.reservedUncertaintyResultId,
            artifactId: replay?.reservedUncertaintyResultArtifactId,
            submissionId: replay?.reservedUncertaintySubmissionId,
          };
      const assignment = operation
        ? [...derived.assignments.values()].find(
            ({ assignmentId }) => assignmentId === operation.assignmentId,
          )
        : null;
      const submission = submissions.get(terminalReservation.submissionId);
      const artifact = [...derived.artifacts.values()].find(
        ({ artifactId }) => artifactId === terminalReservation.artifactId,
      );
      if (
        !operation ||
        !replay ||
        operation.state !== 'dispatching' ||
        operation.resultId !== null
      ) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Execution result lacks one prior dispatching operation and replay owner.',
          { resultId: payload.result.resultId },
        );
      }
      if (
        !assignment ||
        assignment.state !== 'validated' ||
        !submission ||
        submission.state !== 'accepted' ||
        !artifact ||
        payload.result.resultId !== terminalReservation.resultId ||
        payload.result.resultArtifactId !== terminalReservation.artifactId
      ) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Execution result precedes or diverges from its canonical terminal Assignment, Submission, and Artifact.',
          { resultId: payload.result.resultId },
        );
      }
      const next = {
        ...operation,
        state: payload.result.status,
        resultId: payload.result.resultId,
        updatedAt: payload.result.completedAt,
      };
      next.operationHash = sha256Jcs(without(next, 'operationHash'));
      derived.governedOperations.set(operationKey, next);
      operationReplay.set(operation.operationId, {
        ...replay,
        terminalResultId: payload.result.resultId,
        terminalReceipt: clone(payload.receipt),
      });
    }
    if (event.type === 'rollback.plan-recorded') put('rollbackPlans', payload);
    if (event.type === 'rollback.result-recorded') {
      put('rollbackResults', payload);
      const operationKey = [...derived.governedOperations.keys()].find(
        (key) => derived.governedOperations.get(key).operationId === payload.rollbackOperationId,
      );
      const operation = operationKey ? derived.governedOperations.get(operationKey) : null;
      const replay = operationReplay.get(payload.rollbackOperationId);
      const terminalReservation = ['succeeded', 'partial'].includes(payload.status)
        ? {
            resultId: replay?.reservedResultId,
            artifactId: replay?.reservedResultArtifactId,
            submissionId: replay?.reservedSubmissionId,
          }
        : {
            resultId: replay?.reservedUncertaintyResultId,
            artifactId: replay?.reservedUncertaintyResultArtifactId,
            submissionId: replay?.reservedUncertaintySubmissionId,
          };
      const assignment = operation
        ? [...derived.assignments.values()].find(
            ({ assignmentId }) => assignmentId === operation.assignmentId,
          )
        : null;
      const submission = submissions.get(terminalReservation.submissionId);
      const artifact = [...derived.artifacts.values()].find(
        ({ artifactId }) => artifactId === terminalReservation.artifactId,
      );
      if (
        !operation ||
        !replay ||
        operation.operationKind !== 'rollback' ||
        operation.state !== 'dispatching' ||
        operation.resultId !== null
      ) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Rollback result lacks one prior dispatching rollback operation and replay owner.',
          { rollbackResultId: payload.rollbackResultId },
        );
      }
      if (
        !assignment ||
        assignment.state !== 'validated' ||
        !submission ||
        submission.state !== 'accepted' ||
        !artifact ||
        payload.rollbackResultId !== terminalReservation.resultId ||
        payload.resultArtifactId !== terminalReservation.artifactId
      ) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Rollback result precedes or diverges from its canonical terminal Assignment, Submission, and Artifact.',
          { rollbackResultId: payload.rollbackResultId },
        );
      }
      const next = {
        ...operation,
        state: payload.status,
        resultId: payload.rollbackResultId,
        updatedAt: payload.completedAt,
      };
      next.operationHash = sha256Jcs(without(next, 'operationHash'));
      derived.governedOperations.set(operationKey, next);
      operationReplay.set(operation.operationId, {
        ...replay,
        terminalResultId: payload.rollbackResultId,
        terminalReceipt: null,
      });
    }
    if (event.type === 'review.created') {
      const key = `${event.cycleId}\u0000${payload.reviewId}`;
      if (reviews.has(key))
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Review lifecycle contains duplicate canonical creation Events.',
          { reviewId: payload.reviewId },
        );
      reviews.set(key, clone(payload));
    }
    if (event.type === 'review.submitted') {
      const key = `${event.cycleId}\u0000${payload.reviewId}`;
      const record = reviews.get(key);
      if (record) {
        if (record.state !== 'pending')
          fail(
            'E_OPERATE_BINDING_MISMATCH',
            'Review lifecycle contains a non-contiguous canonical submission Event.',
            { reviewId: payload.reviewId },
          );
        reviews.set(key, {
          ...record,
          state: payload.disposition,
          disposition: payload.disposition,
          workDispositions: clone(payload.workDispositions),
          updatedAt: event.timestamp,
        });
        if (payload.disposition === 'approved' && record.subject?.type === 'cycle') {
          let projected;
          try {
            projected = applyOperatingReviewWorkDispositionsV2({
              cycle,
              findings: [...derived.findings.values()],
              decisions: [...derived.decisions.values()],
              actions: [...derived.actions.values()],
              workDispositions: payload.workDispositions,
              timestamp: event.timestamp,
              reviewOwnerActorId: event.actor.id,
            });
          } catch (error) {
            fail(
              'E_OPERATE_BINDING_MISMATCH',
              'Approved Review work dispositions do not match canonical Cycle closure semantics.',
              {
                reviewId: payload.reviewId,
                cause: error.code ?? error.message,
              },
            );
          }
          derived.findings = new Map(
            projected.findings.map((entry) => [scopedRecordKey(entry, 'findingId'), entry]),
          );
          derived.decisions = new Map(
            projected.decisions.map((entry) => [scopedRecordKey(entry, 'decisionId'), entry]),
          );
          derived.actions = new Map(
            projected.actions.map((entry) => [scopedRecordKey(entry, 'actionId'), entry]),
          );
        }
        if (record.subject?.type === 'cycle') {
          const priorCycle = cycleTransitions.get(event.cycleId);
          if (!priorCycle || priorCycle.state !== 'awaiting_review') {
            fail(
              'E_OPERATE_BINDING_MISMATCH',
              'Cycle Review submission lacks one canonical awaiting-review predecessor.',
              {
                reviewId: payload.reviewId,
                cycleId: event.cycleId,
              },
            );
          }
          cycleTransitions.set(event.cycleId, {
            state: payload.disposition === 'approved' ? 'closed' : priorCycle.state,
            updatedAt: event.timestamp,
          });
        }
      }
    }
    if (event.type.startsWith('action.') && event.type !== 'action.authority-promoted') {
      if (
        event.type === 'action.approved' &&
        (event.actor.kind !== 'engine' || event.actor.id !== 'openplanr')
      ) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Action approval requires its exact prior governance Event.',
          { actionId: payload.action.actionId },
        );
      }
      const key = `${cycle.scopeId}\u0000${cycle.domainId}\u0000${cycle.domainVersion}\u0000${payload.action.actionId}`;
      const current = derived.actions.get(key);
      if (current) {
        if (
          current.revision !== payload.action.revision ||
          current.actionHash !== payload.action.actionHash ||
          current.state !== payload.from
        ) {
          fail(
            'E_OPERATE_BINDING_MISMATCH',
            'Action Event lineage diverges from its canonical projected record.',
            { eventId: event.eventId, actionId: payload.action.actionId },
          );
        }
        derived.actions.set(key, { ...current, state: payload.to, updatedAt: event.timestamp });
      }
      const previous = actionTransitions.get(key);
      if (previous && previous.state !== payload.from)
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Action lifecycle contains non-contiguous canonical transition Events.',
          { actionId: payload.action.actionId, eventId: event.eventId },
        );
      actionTransitions.set(key, {
        ...clone(payload.action),
        state: payload.to,
        updatedAt: event.timestamp,
      });
    }
    if (event.type.startsWith('cycle.') && event.type !== 'cycle.input-bound') {
      const previous = cycleTransitions.get(event.cycleId);
      if (previous && previous.state !== payload.from)
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Cycle lifecycle contains non-contiguous canonical transition Events.',
          { cycleId: event.cycleId, eventId: event.eventId },
        );
      cycleTransitions.set(event.cycleId, { state: payload.to, updatedAt: event.timestamp });
    }
  }
  for (const [name, [stateField, identityField]] of Object.entries(EVENT_PARITY_COLLECTIONS)) {
    const records = state[stateField] ?? [];
    if (baseState !== null && records.length !== derived[name].size) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Retained checkpoint and tail do not own the exact final record membership.',
        {
          collection: stateField,
        },
      );
    }
    for (const [key, expected] of derived[name]) {
      const candidates = records.filter((record) => scopedRecordKey(record, identityField) === key);
      if (candidates.length !== 1 || sha256Jcs(candidates[0]) !== sha256Jcs(expected)) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Current projection state diverges from its canonical Event-backed record.',
          { collection: stateField, identity: expected[identityField] },
        );
      }
    }
  }
  if (
    baseState !== null &&
    (state.submissions.length !== submissions.size ||
      state.submissionReplayIndex.length !== submissionReplay.size ||
      (state.operationReplayIndex ?? []).length !== operationReplay.size ||
      state.reviews.length !== reviews.size)
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Retained checkpoint and tail do not own the exact final lifecycle membership.',
    );
  }
  for (const [identity, expected] of submissions) {
    const candidates = state.submissions.filter(({ submissionId }) => submissionId === identity);
    if (candidates.length !== 1 || sha256Jcs(candidates[0]) !== sha256Jcs(expected)) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Current Submission diverges from its canonical Event-derived lifecycle.',
        { submissionId: identity },
      );
    }
  }
  for (const [identity, expected] of submissionReplay) {
    const candidates = state.submissionReplayIndex.filter(
      ({ submissionId }) => submissionId === identity,
    );
    if (candidates.length !== 1 || sha256Jcs(candidates[0]) !== sha256Jcs(expected)) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Current Submission replay diverges from its canonical Event-derived lifecycle.',
        { submissionId: identity },
      );
    }
  }
  for (const [identity, expected] of operationReplay) {
    const candidates = state.operationReplayIndex.filter(
      ({ operationId }) => operationId === identity,
    );
    if (candidates.length !== 1 || sha256Jcs(candidates[0]) !== sha256Jcs(expected)) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Current operation replay diverges from its canonical Event-derived lifecycle.',
        { operationId: identity },
      );
    }
  }
  for (const [key, expected] of actionTransitions) {
    const candidates = state.actions.filter(
      (record) => scopedRecordKey(record, 'actionId') === key,
    );
    const current = candidates[0];
    if (
      candidates.length !== 1 ||
      current.revision !== expected.revision ||
      current.actionHash !== expected.actionHash ||
      current.state !== expected.state ||
      current.updatedAt !== expected.updatedAt
    ) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Current Action does not equal its final canonical lifecycle Event.',
        { actionId: expected.actionId },
      );
    }
  }
  for (const [cycleId, expected] of cycleTransitions) {
    const current = state.cycles.find((record) => record.cycleId === cycleId);
    if (!current || current.state !== expected.state || current.updatedAt !== expected.updatedAt) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Current Cycle does not equal its final canonical lifecycle Event.',
        { cycleId },
      );
    }
  }
  for (const [key, expected] of reviews) {
    const [cycleId, reviewId] = key.split('\u0000');
    const candidates = state.reviews.filter(
      (record) => record.cycleId === cycleId && record.reviewId === reviewId,
    );
    if (candidates.length !== 1 || sha256Jcs(candidates[0]) !== sha256Jcs(expected)) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Current Review diverges from its canonical Event-backed record.',
        { reviewId },
      );
    }
  }
  // The current Event vocabulary has no record that binds runtime-state generatedAt
  // or every byte of a Cycle. Events still reject exact record/lifecycle conflicts
  // above, but Event-only replay cannot prove byte-exact current-state parity.
  return {
    stateParityVerified: baseState !== null,
    canonicalMetrics: [...canonicalMetrics.values()].map(clone),
  };
}

function validateEventReplayIndex(state, events, checkpointValidation) {
  if (!Array.isArray(events)) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Experience projection requires a bounded canonical Event suffix.',
    );
  }
  const checkpoint = checkpointValidation?.projection ?? null;
  const checkpointState = checkpointValidation?.state ?? null;
  if (events.length === 0) {
    const genesis =
      state.eventHead.sequence === 0 &&
      state.eventHead.hash === null &&
      state.eventReplayIndex.length === 0 &&
      checkpoint === null;
    const exactCheckpointBase =
      checkpoint !== null &&
      checkpoint.eventHead.sequence === state.eventHead.sequence &&
      checkpoint.eventHead.hash === state.eventHead.hash &&
      checkpoint.runtimeStateHash === sha256Jcs(state) &&
      checkpoint.eventReplayIndexHash === sha256Jcs(state.eventReplayIndex) &&
      sha256Jcs(checkpointState) === sha256Jcs(state);
    if (!genesis && !exactCheckpointBase) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'An empty retained Event suffix requires genesis or one exact validated checkpoint base.',
      );
    }
    return { events: [], stateParityVerified: exactCheckpointBase, canonicalMetrics: [] };
  }
  const first = events[0];
  const startsAtGenesis = first?.sequence === 1;
  const startsAfterCheckpoint =
    checkpoint !== null && first?.sequence === checkpoint.eventHead.sequence + 1;
  if (!startsAtGenesis && !startsAfterCheckpoint)
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Event replay must start at genesis or immediately after the validated checkpoint.',
    );
  const expectedEventCount = startsAtGenesis
    ? state.eventReplayIndex.length
    : state.eventHead.sequence - checkpoint.eventHead.sequence;
  if (events.length !== expectedEventCount) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Experience projection Event suffix does not cover its exact retained replay interval.',
    );
  }
  let finalHead;
  try {
    finalHead = verifyOperatingRuntimeEventChainV2(events, {
      startingSequence: startsAtGenesis ? 0 : checkpoint.eventHead.sequence,
      startingHash: startsAtGenesis ? null : checkpoint.eventHead.hash,
    });
  } catch (error) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Experience Event replay is not one exact canonical contiguous chain.',
      { cause: error.code ?? 'STATE_TRANSITION_INVALID' },
    );
  }
  const cycles = uniqueIdentityIndex(state.cycles, 'cycleId', 'global Cycle');
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const replay = state.eventReplayIndex[event.sequence - 1];
    assertProtocolArtifact('operating-event', event, { protocolVersion: PROTOCOL_VERSION });
    if (
      event.eventHash !== computeOperatingRuntimeEventHashV2(event) ||
      sha256Jcs(replay) !== sha256Jcs(exactReplayEntry(event))
    ) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Replay metadata does not equal its indexed canonical Event.',
        { eventId: event.eventId },
      );
    }
    const cycle = cycles.get(event.cycleId);
    if (!cycle)
      fail('E_OPERATE_BINDING_MISMATCH', 'Canonical Event references an unknown Cycle.', {
        eventId: event.eventId,
        cycleId: event.cycleId,
      });
    if (expectedEventEntityId(event) !== event.entityId)
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Canonical Event entity metadata does not equal its validated payload.',
        { eventId: event.eventId, entityId: event.entityId },
      );
    if (scopedEventPayloadRecords(event.payload).some((record) => !sameScope(record, cycle))) {
      fail(
        'OPERATING_SCOPE_INVALID',
        'Canonical Event payload has a foreign scope/domain/version binding.',
        { eventId: event.eventId },
      );
    }
  }
  if (finalHead.sequence !== state.eventHead.sequence || finalHead.hash !== state.eventHead.hash) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Canonical Event replay does not equal the runtime final Event head.',
    );
  }
  const parity = validateProjectedStateEventParity(
    state,
    events,
    cycles,
    startsAfterCheckpoint ? checkpointState : null,
  );
  if (startsAtGenesis && checkpoint?.runtimeStateHash === sha256Jcs(state)) {
    parity.stateParityVerified = true;
  }
  if (startsAfterCheckpoint) parity.stateParityVerified = false;
  return { events: events.map(clone), ...parity };
}

function createAccessScreen(artifacts, accessLevel) {
  const maximum = ACCESS_ORDER.indexOf(accessLevel);
  const omissions = new Map();
  const omit = (classification, reason, count = 1) => {
    const key = `${classification}:${reason}`;
    omissions.set(key, { classification, reason, count: (omissions.get(key)?.count ?? 0) + count });
  };
  const inspect = (artifactIds) => {
    const ids = [
      ...new Set((artifactIds ?? []).filter((id) => typeof id === 'string' && id.length > 0)),
    ];
    if (ids.length === 0) return { visible: true, classification: 'public' };
    let classification = 'public';
    for (const id of ids) {
      const artifact = artifacts.get(id);
      if (!artifact) return { visible: false, classification: 'restricted' };
      if (ACCESS_ORDER.indexOf(artifact.sensitivity) > ACCESS_ORDER.indexOf(classification))
        classification = artifact.sensitivity;
    }
    return { visible: ACCESS_ORDER.indexOf(classification) <= maximum, classification };
  };
  const text = (value, replacement, artifactIds) => {
    const result = inspect(artifactIds);
    if (result.visible) return value;
    omit(result.classification, 'body-never-projected');
    return replacement;
  };
  const identity = (value, artifactIds) => {
    const result = inspect(artifactIds);
    if (result.visible) return value;
    omit(result.classification, 'identity-redacted');
    return null;
  };
  const route = (value, artifactIds) => {
    const result = inspect(artifactIds);
    if (result.visible) return clone(value);
    omit(result.classification, 'body-never-projected');
    const base = {
      ...without(value, 'routeHash'),
      rationale: 'Route details are unavailable at this access level.',
    };
    return { ...base, routeHash: sha256Jcs(base) };
  };
  const artifactIds = (values) =>
    (values ?? []).filter((id) => {
      const result = inspect([id]);
      if (result.visible) return true;
      omit(result.classification, 'identity-redacted');
      return false;
    });
  return {
    inspect,
    omit,
    text,
    identity,
    route,
    artifactIds,
    omissions: () => [...omissions.values()],
  };
}

function inboxEvidence(evidence, evidenceRefIds) {
  const selected = new Set(evidenceRefIds);
  return evidence
    .filter(({ evidenceRefId }) => selected.has(evidenceRefId))
    .map((entry) => ({
      evidenceRefId: entry.evidenceRefId,
      classification: entry.classification,
      accessState: entry.accessState,
      relation:
        entry.claimStatus === 'contradicted'
          ? 'contradiction'
          : entry.claimStatus === 'supported'
            ? 'support'
            : 'informs',
    }));
}

function inboxParty(party, indexes, actorId, requirementId) {
  const recorded = [...indexes.approvalRecords.values()].some(
    (entry) =>
      entry.requirementId === requirementId &&
      entry.partyId === party.partyId &&
      entry.decision === 'approved' &&
      entry.consumedByOperationId === null,
  );
  const redacted = party.actorId !== null && party.actorId !== actorId;
  return {
    partyId: party.partyId,
    actorKind: party.actorKind,
    actorId: redacted ? null : party.actorId,
    requiredCapability: clone(party.requiredCapability),
    state: redacted ? 'redacted' : recorded ? 'recorded' : 'required',
    redacted,
  };
}

function inboxUnrecordedParty(party, actorId) {
  const redacted = party.actorId !== null && party.actorId !== actorId;
  return {
    partyId: party.partyId,
    actorKind: party.actorKind,
    actorId: redacted ? null : party.actorId,
    requiredCapability: clone(party.requiredCapability),
    state: redacted ? 'redacted' : 'required',
    redacted,
  };
}

function inboxLocator(candidates, unavailableCode = 'OPERATE_ACTION_NOT_AVAILABLE') {
  if (candidates.length > 1) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'An Inbox item maps to more than one exact runtime-issued action digest.',
    );
  }
  if (candidates.length === 1) {
    return {
      actionLocator: {
        subjectId: candidates[0].subjectId,
        actionDigest: sha256Jcs(candidates[0].action),
      },
      navigationLocator: null,
      unavailableReason: null,
    };
  }
  return {
    actionLocator: null,
    navigationLocator: null,
    unavailableReason: {
      code: unavailableCode,
      message:
        unavailableCode === 'OPERATE_APPROVAL_EXPIRED'
          ? 'This approval expired. Refresh current operating state.'
          : 'No exact runtime-issued action is available for this item.',
    },
  };
}

function inboxReviewLocators(submitCandidates, readCandidates, cycleId) {
  if (readCandidates.length > 1) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'A Review Inbox item maps to more than one exact runtime-issued read action.',
    );
  }
  const reviewIds = new Set(
    [
      ...submitCandidates.map(({ action }) => action.arguments?.reviewId),
      ...readCandidates.map(({ action }) => action.arguments?.reviewId),
    ].filter((value) => typeof value === 'string'),
  );
  if (reviewIds.size > 1) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'A Review Inbox item cannot combine actions for different Reviews.',
    );
  }
  const navigationLocator =
    readCandidates.length === 1
      ? (() => {
          const [{ subjectId, action }] = readCandidates;
          const reviewId = action.arguments?.reviewId;
          if (
            action.tool !== 'operate.review.get' ||
            action.effect !== 'read-only' ||
            subjectId !== reviewId ||
            action.arguments?.cycleId !== cycleId
          ) {
            fail(
              'E_OPERATE_BINDING_MISMATCH',
              'Review Inbox navigation requires one exact read-only Review action.',
            );
          }
          return {
            kind: 'review',
            cycleId,
            reviewId,
            deepLink: deepLink('review', reviewId, cycleId),
            readActionDigest: sha256Jcs(action),
          };
        })()
      : null;
  if (submitCandidates.length > 1) {
    if (navigationLocator === null) {
      fail(
        'RESULT_CONTRACT_INVALID',
        'Multiple Review choices require one exact read-only Review navigation action.',
      );
    }
    return { actionLocator: null, navigationLocator, unavailableReason: null };
  }
  const mutation = inboxLocator(submitCandidates);
  if (submitCandidates.length === 0 && navigationLocator !== null) {
    return { actionLocator: null, navigationLocator, unavailableReason: null };
  }
  return { ...mutation, navigationLocator };
}

function buildInbox(indexes, cycles, actorId, screen, generatedAt, evidence, allowedActions) {
  const cycleIds = new Set(cycles.map(({ cycleId }) => cycleId));
  const items = [];
  for (const decision of [...indexes.decisions.values()].filter(
    (entry) => entry.ownerActorId === actorId && ['proposed', 'deferred'].includes(entry.state),
  )) {
    const sources = [decision.sourceArtifactId];
    const reviewCandidates = allowedActions.filter(({ action }) => {
      if (action.tool !== 'operate.review.submit') return false;
      const args = action.arguments;
      const review = indexes.reviews.get(args.reviewId);
      return (
        review?.state === 'pending' &&
        review.subject?.type !== 'action' &&
        review.cycleId === decision.sourceCycleId &&
        args.disposition === 'approved' &&
        Array.isArray(args.workDispositions) &&
        args.workDispositions.some(
          (entry) =>
            entry?.entityType === 'operating-decision' && entry.entityId === decision.decisionId,
        )
      );
    });
    const reviewIds = new Set(reviewCandidates.map(({ action }) => action.arguments.reviewId));
    const reviewReadCandidates = allowedActions.filter(
      ({ action }) =>
        action.tool === 'operate.review.get' && reviewIds.has(action.arguments?.reviewId),
    );
    items.push({
      itemId: `decision:${decision.decisionId}`,
      kind: 'decision',
      subjectId: decision.decisionId,
      ownerActorId: actorId,
      state: decision.state,
      title: screen.text(decision.title, 'Restricted Decision', sources),
      consequence: screen.text(
        decision.expectedDownside,
        'Decision details are unavailable at this access level.',
        sources,
      ),
      expiresAt: decision.revisitAt,
      blocking: decision.state === 'proposed',
      evidence: inboxEvidence(evidence, decision.evidenceRefIds),
      requiredParties: [
        {
          partyId: `review-owner:${actorId}`,
          actorKind: 'human',
          actorId,
          requiredCapability: { id: 'review-submit-authorized', version: '1.0.0' },
          state: 'required',
          redacted: false,
        },
      ],
      redactions: inboxEvidence(evidence, decision.evidenceRefIds)
        .filter(({ accessState }) => accessState === 'restricted')
        .map(({ classification }) => ({ classification, count: 1, reason: 'access-denied' })),
      ...inboxReviewLocators(reviewCandidates, reviewReadCandidates, decision.sourceCycleId),
    });
  }
  for (const review of [...indexes.reviews.values()].filter(
    (entry) =>
      entry.ownerActorId === actorId &&
      entry.state === 'pending' &&
      entry.subject?.type === 'action',
  )) {
    const subject = review.subject;
    const action = indexes.actions.get(subject.actionId);
    if (
      !action ||
      action.sourceCycleId !== review.cycleId ||
      action.revision !== subject.revision ||
      action.actionHash !== subject.actionHash
    ) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Action Review Inbox work requires one exact current Action subject.',
      );
    }
    const candidates = allowedActions.filter(
      ({ subjectId, action: candidate }) =>
        subjectId === review.reviewId &&
        candidate.tool === 'operate.review.submit' &&
        candidate.arguments?.reviewId === review.reviewId &&
        candidate.arguments?.disposition === 'approved' &&
        Array.isArray(candidate.arguments?.workDispositions) &&
        candidate.arguments.workDispositions.length === 0,
    );
    const readCandidates = allowedActions.filter(
      ({ subjectId, action: candidate }) =>
        subjectId === review.reviewId &&
        candidate.tool === 'operate.review.get' &&
        candidate.arguments?.reviewId === review.reviewId,
    );
    const decision =
      action.sourceDecisionId === null ? null : indexes.decisions.get(action.sourceDecisionId);
    const evidenceRefIds = decision?.evidenceRefIds ?? [];
    const safeEvidence = inboxEvidence(evidence, evidenceRefIds);
    items.push({
      itemId: `action-review:${review.reviewId}`,
      kind: 'approval',
      subjectId: review.reviewId,
      ownerActorId: actorId,
      state: review.state,
      title: screen.text(`Review ${action.title}`, 'Restricted Action Review', [
        action.sourceArtifactId,
      ]),
      consequence: screen.text(
        action.expectedResult,
        'Action Review details are unavailable at this access level.',
        [action.sourceArtifactId],
      ),
      expiresAt: null,
      blocking: true,
      evidence: safeEvidence,
      requiredParties: [
        {
          partyId: `action-review-owner:${actorId}`,
          actorKind: 'human',
          actorId,
          requiredCapability: { id: 'review-submit-authorized', version: '1.0.0' },
          state: 'required',
          redacted: false,
        },
      ],
      redactions: safeEvidence
        .filter(({ accessState }) => accessState === 'restricted')
        .map(({ classification }) => ({ classification, count: 1, reason: 'access-denied' })),
      ...inboxReviewLocators(candidates, readCandidates, review.cycleId),
    });
  }
  const approvalRequirements = [...indexes.approvalRequirements.values()].filter(
    (entry) =>
      (entry.namedActorIds.includes(actorId) ||
        entry.parties.some((party) => party.actorId === actorId)) &&
      openApprovalRequirement(entry, indexes, generatedAt),
  );
  const approvalActionKeys = new Set();
  for (const requirement of approvalRequirements) {
    const candidates = allowedActions.filter(
      ({ action }) =>
        action.tool === 'operate.action.approve' &&
        action.arguments?.decision === 'approved' &&
        action.arguments?.action?.actionId === requirement.action.actionId &&
        action.arguments.action.revision === requirement.action.revision &&
        action.arguments.action.actionHash === requirement.action.actionHash,
    );
    if (candidates.length === 1) {
      const key = `${candidates[0].subjectId}:${sha256Jcs(candidates[0].action)}`;
      if (approvalActionKeys.has(key)) {
        fail(
          'RESULT_CONTRACT_INVALID',
          'Distinct Inbox approvals cannot share one ambiguous action digest.',
        );
      }
      approvalActionKeys.add(key);
    }
    const parties = requirement.parties.map((party) =>
      inboxParty(party, indexes, actorId, requirement.requirementId),
    );
    const expired =
      requirement.expiresAt !== null &&
      Date.parse(requirement.expiresAt) <= Date.parse(generatedAt);
    items.push({
      itemId: `approval:${requirement.requirementId}`,
      kind: 'approval',
      subjectId: requirement.action.actionId,
      ownerActorId: actorId,
      state: expired ? 'expired' : 'waiting',
      title: `Approval for ${requirement.action.actionId}`,
      consequence: `${requirement.effectClass} requires ${requirement.threshold} approval${requirement.threshold === 1 ? '' : 's'}.`,
      expiresAt: requirement.expiresAt,
      blocking: true,
      evidence: [],
      requiredParties: parties,
      redactions: parties
        .filter(({ redacted }) => redacted)
        .map(() => ({ classification: 'restricted', count: 1, reason: 'identity-redacted' })),
      ...inboxLocator(expired ? [] : candidates, expired ? 'OPERATE_APPROVAL_EXPIRED' : undefined),
    });
  }
  for (const candidate of allowedActions.filter(
    ({ action }) =>
      action.tool === 'operate.action.approve' &&
      action.arguments?.decision === 'approved' &&
      action.arguments?.rollback !== undefined,
  )) {
    const identity = candidate.action.arguments.action;
    const rollback = candidate.action.arguments.rollback;
    const action = indexes.actions.get(identity.actionId);
    if (
      !action ||
      candidate.subjectId !== action.actionId ||
      identity.revision !== action.revision ||
      identity.actionHash !== action.actionHash
    ) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Rollback approval Inbox work requires one exact current plan and terminal result binding.',
      );
    }
    const { plan, template } = exactRollbackApprovalContext(
      indexes,
      action,
      rollback,
      actorId,
      generatedAt,
    );
    const key = `${candidate.subjectId}:${sha256Jcs(candidate.action)}`;
    if (approvalActionKeys.has(key)) {
      fail(
        'RESULT_CONTRACT_INVALID',
        'Distinct Inbox approvals cannot share one ambiguous action digest.',
      );
    }
    approvalActionKeys.add(key);
    const parties = template.requirement.parties.map((party) =>
      inboxUnrecordedParty(party, actorId),
    );
    const decision =
      action.sourceDecisionId === null ? null : indexes.decisions.get(action.sourceDecisionId);
    const safeEvidence = inboxEvidence(evidence, decision?.evidenceRefIds ?? []);
    const expired = Date.parse(plan.expiresAt) <= Date.parse(generatedAt);
    items.push({
      itemId: `approval:rollback:${plan.rollbackPlanId}`,
      kind: 'approval',
      subjectId: action.actionId,
      ownerActorId: actorId,
      state: expired ? 'expired' : 'waiting',
      title: screen.text(`Rollback approval for ${action.title}`, 'Restricted rollback approval', [
        action.sourceArtifactId,
      ]),
      consequence: screen.text(
        `Approve the exact rollback plan before reversing ${action.effectClass}.`,
        'Rollback approval details are unavailable at this access level.',
        [action.sourceArtifactId],
      ),
      expiresAt: plan.expiresAt,
      blocking: true,
      evidence: safeEvidence,
      requiredParties: parties,
      redactions: parties
        .filter(({ redacted }) => redacted)
        .map(() => ({ classification: 'restricted', count: 1, reason: 'identity-redacted' })),
      ...inboxLocator(expired ? [] : [candidate], expired ? 'OPERATE_APPROVAL_EXPIRED' : undefined),
    });
  }
  for (const assignment of [...indexes.assignments.values()].filter(
    (entry) =>
      cycleIds.has(entry.cycleId) &&
      entry.assignmentKind === 'verification' &&
      ['available', 'claimed', 'running'].includes(entry.state),
  )) {
    if (assignment.claim?.actorId === actorId || assignment.state === 'available') {
      const candidates = allowedActions.filter(
        ({ action }) =>
          action.tool === 'operate.assignment.submit' &&
          action.arguments?.assignmentId === assignment.assignmentId,
      );
      items.push({
        itemId: `verification:${assignment.assignmentId}`,
        kind: 'verification',
        subjectId: assignment.assignmentId,
        ownerActorId: actorId,
        state: assignment.state,
        title: screen.text(
          assignment.objective,
          'Restricted verification work',
          assignment.inputArtifactIds,
        ),
        consequence: 'The expected outcome remains unverified.',
        expiresAt: null,
        blocking: false,
        evidence: [],
        requiredParties: [
          {
            partyId: `verification-owner:${actorId}`,
            actorKind: 'human',
            actorId,
            requiredCapability: { id: 'assignment-submit', version: '1.0.0' },
            state: 'required',
            redacted: false,
          },
        ],
        redactions: [],
        ...inboxLocator(candidates),
      });
    }
  }
  return items.sort(
    (left, right) =>
      Number(right.blocking) - Number(left.blocking) || left.itemId.localeCompare(right.itemId),
  );
}

function expiryProximityScore(dueAt, generatedAt) {
  if (dueAt === null) return 0;
  const remaining = Date.parse(dueAt) - Date.parse(generatedAt);
  if (remaining <= 0) return 180;
  if (remaining <= 60 * 60 * 1000) return 160;
  if (remaining <= 24 * 60 * 60 * 1000) return 130;
  if (remaining <= 7 * 24 * 60 * 60 * 1000) return 80;
  return 25;
}

function attentionPriority(indexes, item, actorId, generatedAt) {
  const decision = item.kind === 'decision' ? indexes.decisions.get(item.subjectId) : null;
  const approval =
    item.kind === 'approval'
      ? indexes.approvalRequirements.get(item.inboxItemId.slice('approval:'.length))
      : null;
  const action = ['action', 'uncertainty'].includes(item.kind)
    ? indexes.actions.get(item.subjectId)
    : null;
  const outcome = item.kind === 'outcome' ? indexes.outcomes.get(item.subjectId) : null;
  const effectMateriality = {
    'read-only': 0,
    'machine-local-write': 40,
    'project-write': 100,
    'provider-call': 125,
    'external-effect': 180,
    destructive: 240,
  };
  const materiality = decision
    ? Math.round(decision.confidence * 160) + Math.min(decision.evidenceRefIds.length, 4) * 20
    : approval
      ? (effectMateriality[approval.effectClass] ?? 0)
      : action
        ? Math.min(220, Math.round(Math.abs(action.target - action.baseline) * 220)) +
          (action.state === 'blocked' ? 60 : 0)
        : outcome
          ? 140
          : item.kind === 'verification'
            ? 100
            : 0;
  const urgency =
    {
      blocked: 170,
      uncertain: 170,
      failed: 150,
      pending: 110,
      proposed: 105,
      waiting: 100,
      claimed: 90,
      running: 90,
      in_progress: 80,
      queued: 65,
      approved: 55,
      available: 45,
    }[item.state] ?? 25;
  const owned =
    decision?.ownerActorId === actorId || item.kind === 'approval'
      ? 110
      : action?.ownerActorId === actorId
        ? 90
        : item.kind === 'verification'
          ? 70
          : 0;
  const unresolvedDependencies = action
    ? action.dependsOnActionIds.filter(
        (dependencyId) => indexes.actions.get(dependencyId)?.state !== 'completed',
      ).length
    : 0;
  const dependencyBlocking = Math.min(
    200,
    unresolvedDependencies * 70 + (item.state === 'blocked' || item.blocking ? 90 : 0),
  );
  const expiry = expiryProximityScore(item.dueAt, generatedAt);
  const uncertainty =
    item.kind === 'uncertainty' || ['uncertain', 'partial', 'failed'].includes(item.state)
      ? 150
      : 0;
  const dueVerification =
    item.kind === 'verification' || item.kind === 'outcome'
      ? 150
      : action?.state === 'completed' &&
          ![...indexes.outcomes.values()].some(
            (entry) => entry.actionId === action.actionId && entry.status === 'succeeded',
          )
        ? 120
        : 0;
  return Math.min(
    1000,
    materiality + urgency + owned + dependencyBlocking + expiry + uncertainty + dueVerification,
  );
}

function sortAttention(items) {
  return items.sort(
    (left, right) =>
      right.priority - left.priority || left.attentionId.localeCompare(right.attentionId),
  );
}

function buildAttention(indexes, inbox, actions, outcomes, actorId, generatedAt) {
  const items = inbox.map((item) => {
    const base = {
      attentionId: `attention:${item.itemId}`,
      inboxItemId: item.itemId,
      kind: item.kind,
      subjectId: item.subjectId,
      title: item.title,
      whyNow: item.expiresAt
        ? `This item expires at ${item.expiresAt}.`
        : item.blocking
          ? 'Other work is waiting on this item.'
          : 'This work is ready for attention.',
      consequence: item.consequence,
      state: item.state,
      dueAt: item.expiresAt,
      evidenceRefIds: [],
      blocking: item.blocking,
    };
    return {
      ...without(without(base, 'blocking'), 'inboxItemId'),
      priority: attentionPriority(indexes, base, actorId, generatedAt),
    };
  });
  for (const action of actions) {
    if (!['blocked', 'approved', 'queued', 'in_progress'].includes(action.state)) continue;
    const base = {
      attentionId: `attention:action:${action.actionId}`,
      kind: action.state === 'blocked' ? 'uncertainty' : 'action',
      subjectId: action.actionId,
      title: action.title,
      whyNow:
        action.state === 'blocked'
          ? 'The Action cannot continue safely.'
          : 'The Action has current operating work.',
      consequence: action.expectedResult,
      state: action.state,
      dueAt: null,
      evidenceRefIds: [],
    };
    items.push({ ...base, priority: attentionPriority(indexes, base, actorId, generatedAt) });
  }
  for (const outcome of outcomes.filter(({ status }) => status !== 'succeeded')) {
    const base = {
      attentionId: `attention:outcome:${outcome.outcomeId}`,
      kind: 'outcome',
      subjectId: outcome.outcomeId,
      title: `Outcome ${outcome.status}`,
      whyNow: 'The expected result is not confirmed.',
      consequence: 'Inspect verification evidence before closing the work.',
      state: outcome.status,
      dueAt: null,
      evidenceRefIds: [...outcome.evidenceRefIds],
    };
    items.push({ ...base, priority: attentionPriority(indexes, base, actorId, generatedAt) });
  }
  return sortAttention(items);
}

function accessSafeEvidence(indexes, scope, accessLevel) {
  const maximum = ACCESS_ORDER.indexOf(accessLevel);
  if (maximum < 0) fail('RESULT_CONTRACT_INVALID', 'Experience accessLevel is not recognized.');
  const evidence = [];
  const omitted = new Map();
  for (const item of [...indexes.evidenceRefs.values()].sort((a, b) =>
    a.evidenceRefId.localeCompare(b.evidenceRefId),
  )) {
    const allowed = ACCESS_ORDER.indexOf(item.classification) <= maximum;
    const artifact = indexes.artifacts.get(item.evidenceArtifactId) ?? null;
    const sourceArtifact = indexes.artifacts.get(item.sourceArtifactId) ?? null;
    if (
      !sourceArtifact ||
      !artifact ||
      item.evidenceArtifactRawHash !== artifact.rawHash ||
      item.evidenceArtifactCanonicalHash !== artifact.canonicalHash ||
      item.classification !== artifact.sensitivity
    ) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'EvidenceRef does not bind the exact Artifact identity, hashes, media, size, and access classification.',
        { evidenceRefId: item.evidenceRefId },
      );
    }
    const resolutions = [...indexes.evidenceResolutions.values()].filter(
      ({ candidateId }) => candidateId === item.candidateId,
    );
    const edges = [...indexes.evidenceEdges.values()].filter(
      ({ evidenceRefId, classification }) =>
        evidenceRefId === item.evidenceRefId && ACCESS_ORDER.indexOf(classification) <= maximum,
    );
    const claims = [...indexes.claims.values()];
    const supportingClaimIds = claims
      .filter(({ supportingEvidenceRefIds }) =>
        supportingEvidenceRefIds.includes(item.evidenceRefId),
      )
      .map(({ claimId }) => claimId)
      .sort();
    const contradictingClaimIds = claims
      .filter(({ contradictingEvidenceRefIds }) =>
        contradictingEvidenceRefIds.includes(item.evidenceRefId),
      )
      .map(({ claimId }) => claimId)
      .sort();
    const claimStatus =
      contradictingClaimIds.length > 0 && supportingClaimIds.length > 0
        ? 'uncertain'
        : contradictingClaimIds.length > 0
          ? 'contradicted'
          : supportingClaimIds.length > 0
            ? 'supported'
            : 'unknown';
    evidence.push({
      evidenceRefId: item.evidenceRefId,
      classification: item.classification,
      accessState: allowed ? 'available' : 'restricted',
      freshness: item.freshness,
      evidenceKind: allowed ? item.evidenceKind : null,
      resolvedAt: allowed ? item.resolvedAt : null,
      claimStatus: allowed ? claimStatus : 'restricted',
      supportClaimIds: allowed ? supportingClaimIds : [],
      contradictClaimIds: allowed ? contradictingClaimIds : [],
      source: allowed
        ? {
            evidenceKind: item.evidenceKind,
            provider: clone(item.provider),
            resolver: clone(item.resolver),
          }
        : null,
      producer: allowed && artifact ? clone(artifact.producer) : null,
      observedAt: allowed ? item.resolvedAt : null,
      scope: clone(scope),
      sensitivity: item.classification,
      provenance: allowed
        ? {
            sourceArtifactId: item.sourceArtifactId,
            evidenceArtifactId: artifact.artifactId,
            rawHash: artifact.rawHash,
            canonicalHash: artifact.canonicalHash,
            sizeBytes: artifact.sizeBytes,
            mediaType: artifact.mediaType,
            accessLevel: artifact.sensitivity,
          }
        : null,
      confidence:
        allowed && edges.length > 0 ? Math.max(...edges.map(({ confidence }) => confidence)) : null,
      gaps: [],
      errors: allowed
        ? resolutions
            .filter(({ outcome }) => outcome === 'rejected')
            .map(({ resolutionId, error, resolvedAt }) => ({
              resolutionId,
              error: clone(error),
              resolvedAt,
            }))
        : [],
      accessReason: allowed ? null : 'access-denied',
      causalLinks: allowed
        ? [
            ...supportingClaimIds.map((claimId) => ({
              kind: 'claim',
              subjectId: claimId,
              relation: 'support',
              deepLink: deepLink('evidence', item.evidenceRefId),
            })),
            ...contradictingClaimIds.map((claimId) => ({
              kind: 'claim',
              subjectId: claimId,
              relation: 'contradiction',
              deepLink: deepLink('evidence', item.evidenceRefId),
            })),
            ...edges.map(({ localClaimId, relation }) => ({
              kind: 'local-claim',
              subjectId: localClaimId,
              relation: relation === 'supportedBy' ? 'support' : 'contradiction',
              deepLink: deepLink('evidence', item.evidenceRefId),
            })),
          ].sort(
            (left, right) =>
              left.subjectId.localeCompare(right.subjectId) ||
              left.relation.localeCompare(right.relation),
          )
        : [],
      deepLink: deepLink('evidence', item.evidenceRefId),
    });
    if (!allowed) omitted.set(item.classification, (omitted.get(item.classification) ?? 0) + 1);
  }
  return {
    evidence,
    omissions: [...omitted].map(([classification, count]) => ({
      classification,
      count,
      reason: 'access-denied',
    })),
  };
}

function buildClaims(indexes, evidence, scope, screen) {
  const evidenceAccess = new Map(evidence.map((entry) => [entry.evidenceRefId, entry]));
  return [...indexes.claims.values()]
    .map((claim) => {
      const source = accessSafeArtifactMetadata(indexes, screen, claim.sourceArtifactId);
      const support = claim.supportingEvidenceRefIds
        .filter((id) => evidenceAccess.get(id)?.accessState === 'available')
        .sort();
      const contradiction = claim.contradictingEvidenceRefIds
        .filter((id) => evidenceAccess.get(id)?.accessState === 'available')
        .sort();
      const verifiedSupport = support.filter((id) => evidenceAccess.get(id)?.freshness !== 'stale');
      const verifiedContradiction = contradiction.filter(
        (id) => evidenceAccess.get(id)?.freshness !== 'stale',
      );
      const status = !source.access.visible
        ? 'restricted'
        : verifiedContradiction.length > 0 && verifiedSupport.length > 0
          ? 'uncertain'
          : verifiedContradiction.length > 0
            ? 'contradicted'
            : verifiedSupport.length > 0
              ? 'supported'
              : claim.epistemicStatus === 'unknown'
                ? 'unknown'
                : 'uncertain';
      const decisions = [...indexes.decisions.values()].filter((decision) =>
        decision.evidenceRefIds.some((id) => support.includes(id) || contradiction.includes(id)),
      );
      const actions = [...indexes.actions.values()].filter((action) =>
        decisions.some(({ decisionId }) => decisionId === action.sourceDecisionId),
      );
      const outcomes = [...indexes.outcomes.values()].filter((outcome) =>
        actions.some(({ actionId }) => actionId === outcome.actionId),
      );
      const errors = [...new Set([...support, ...contradiction])].flatMap(
        (id) => evidence.find(({ evidenceRefId }) => evidenceRefId === id)?.errors ?? [],
      );
      return {
        claimId: claim.claimId,
        status,
        epistemicStatus: claim.epistemicStatus,
        statement: source.access.visible ? claim.statement : null,
        supportEvidenceRefIds: support,
        contradictEvidenceRefIds: contradiction,
        source: source.artifact,
        producer: source.artifact?.producer ?? null,
        observedAt: claim.createdAt,
        scope: clone(scope),
        sensitivity: source.access.classification,
        provenance: source.artifact
          ? {
              artifactId: source.artifact.artifactId,
              rawHash: source.artifact.rawHash,
              canonicalHash: source.artifact.canonicalHash,
            }
          : null,
        confidence: source.access.visible ? claim.confidence : null,
        gaps: source.access.visible ? [...claim.assumptionIds].sort() : [],
        errors,
        accessReason: source.access.visible ? null : 'access-denied',
        causalLinks: source.access.visible
          ? [
              ...decisions.map(({ decisionId }) => ({
                kind: 'decision',
                subjectId: decisionId,
                relation: 'informs',
                deepLink: deepLink('decision', decisionId),
              })),
              ...actions.map(({ actionId }) => ({
                kind: 'action',
                subjectId: actionId,
                relation: 'informs',
                deepLink: deepLink('action', actionId),
              })),
              ...outcomes.map(({ outcomeId }) => ({
                kind: 'outcome',
                subjectId: outcomeId,
                relation: 'evaluates',
                deepLink: deepLink('outcome', outcomeId),
              })),
            ].sort(
              (left, right) =>
                left.kind.localeCompare(right.kind) ||
                left.subjectId.localeCompare(right.subjectId),
            )
          : [],
        deepLink: deepLink('evidence', claim.claimId),
      };
    })
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
}

function safeRationale(state, indexes, scope, screen) {
  const nodes = [];
  const add = (node) => {
    const result = screen.inspect(node.artifactId === null ? [] : [node.artifactId]);
    if (!result.visible) {
      screen.omit(result.classification, 'body-never-projected');
      return;
    }
    nodes.push(node);
  };
  for (const claim of (state.claims ?? []).filter((entry) => sameScope(entry, scope)))
    add({
      nodeId: `claim:${claim.claimId}`,
      kind: 'claim',
      subjectId: claim.claimId,
      summary: claim.statement,
      artifactId: claim.sourceArtifactId,
      evidenceRefIds: [
        ...claim.supportingEvidenceRefIds,
        ...claim.contradictingEvidenceRefIds,
      ].sort(),
    });
  for (const decision of indexes.decisions.values())
    add({
      nodeId: `decision:${decision.decisionId}`,
      kind: 'decision',
      subjectId: decision.decisionId,
      summary: decision.rationale,
      artifactId: decision.sourceArtifactId,
      evidenceRefIds: [...decision.evidenceRefIds].sort(),
    });
  for (const action of indexes.actions.values())
    add({
      nodeId: `action:${action.actionId}`,
      kind: 'action',
      subjectId: action.actionId,
      summary: action.expectedResult,
      artifactId: action.sourceArtifactId,
      evidenceRefIds: [],
    });
  for (const outcome of indexes.outcomes.values())
    add({
      nodeId: `outcome:${outcome.outcomeId}`,
      kind: 'outcome',
      subjectId: outcome.outcomeId,
      summary: `Verification status: ${outcome.status}.`,
      artifactId: outcome.sourceArtifactId,
      evidenceRefIds: [...outcome.evidenceRefIds].sort(),
    });
  for (const learning of indexes.learnings.values())
    add({
      nodeId: `learning:${learning.learningId}`,
      kind: 'learning',
      subjectId: learning.learningId,
      summary: learning.statement,
      artifactId: learning.sourceArtifactId,
      evidenceRefIds: [...learning.evidenceRefIds].sort(),
    });
  return nodes.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

function resultProjection(result, screen, idField) {
  const access = screen.inspect([result.resultArtifactId]);
  return {
    resultId: result[idField],
    operationId: result.operationId ?? result.rollbackOperationId,
    status: result.status,
    completedAt: result.completedAt,
    effectSummary: access.visible ? clone(result.effectSummary) : null,
    targetBeforeHash: access.visible ? result.targetBeforeHash : null,
    targetAfterHash: access.visible ? result.targetAfterHash : null,
    accessReason: access.visible ? null : 'access-denied',
    deepLink: deepLink('history', result.operationId ?? result.rollbackOperationId),
  };
}

function exactInsufficientEvidenceChain(indexes, plan, action, outcome) {
  const artifact = outcome
    ? ([...indexes.artifacts.values()].find(
        ({ artifactId }) => artifactId === outcome.sourceArtifactId,
      ) ?? null)
    : null;
  const assignment = artifact
    ? ([...indexes.assignments.values()].find(
        ({ assignmentId }) => assignmentId === artifact.assignmentId,
      ) ?? null)
    : null;
  const operation = assignment
    ? ([...indexes.governedOperations.values()].find(
        ({ operationId }) => operationId === assignment.governedOperationId,
      ) ?? null)
    : null;
  const result =
    operation?.operationKind === 'rollback'
      ? ([...indexes.rollbackResults.values()].find(
          ({ rollbackResultId }) => rollbackResultId === operation.resultId,
        ) ?? null)
      : ([...indexes.executionResults.values()].find(
          ({ resultId }) => resultId === operation?.resultId,
        ) ?? null);
  if (
    !plan ||
    !action ||
    !artifact ||
    !assignment ||
    !operation ||
    !result ||
    outcome.status !== 'insufficient-evidence' ||
    outcome.observationIds.length !== 0 ||
    outcome.evidenceRefIds.length !== 0 ||
    assignment.assignmentKind !== 'verification' ||
    assignment.state !== 'validated' ||
    assignment.cycleId !== action.sourceCycleId ||
    assignment.outputContract?.schemaId !== 'operating-outcome' ||
    assignment.outputContract?.schemaVersion !== PROTOCOL_VERSION ||
    artifact.assignmentId !== assignment.assignmentId ||
    operation.state !== 'succeeded' ||
    operation.action.actionId !== action.actionId ||
    operation.action.revision !== action.revision ||
    operation.action.actionHash !== action.actionHash ||
    operation.verificationPlanId !== plan.verificationPlanId ||
    operation.resultId !== (result.resultId ?? result.rollbackResultId) ||
    result.action.actionId !== action.actionId ||
    result.action.revision !== action.revision ||
    result.action.actionHash !== action.actionHash ||
    outcome.actionId !== action.actionId ||
    outcome.verificationPlanId !== plan.verificationPlanId ||
    !sameScope(action, plan) ||
    !sameScope(action, outcome) ||
    !sameScope(action, artifact)
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Insufficient-evidence Outcome requires one exact accepted terminal verification Assignment, Artifact, operation result, Action, and plan.',
      {
        outcomeId: outcome?.outcomeId ?? null,
        verificationPlanId: plan?.verificationPlanId ?? null,
      },
    );
  }
  return { artifact, assignment, operation, result };
}

function exactVerificationChain(indexes, plan, outcome = null) {
  const action = plan ? (indexes.actions.get(plan.actionId) ?? null) : null;
  const metric = plan ? (indexes.metrics.get(plan.metricId) ?? null) : null;
  if (
    !plan ||
    !action ||
    !metric ||
    action.verificationPlanId !== plan.verificationPlanId ||
    action.metricId !== plan.metricId ||
    plan.baseline !== action.baseline ||
    plan.target !== action.target ||
    plan.window !== action.verificationWindow ||
    (outcome !== null &&
      (outcome.actionId !== action.actionId ||
        outcome.verificationPlanId !== plan.verificationPlanId))
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Outcome verification must bind the exact Action, verification plan, Metric, baseline, target, and window.',
      {
        outcomeId: outcome?.outcomeId ?? null,
        verificationPlanId: plan?.verificationPlanId ?? null,
      },
    );
  }
  if (outcome?.status === 'insufficient-evidence') {
    const artifact =
      [...indexes.artifacts.values()].find(
        ({ artifactId }) => artifactId === outcome.sourceArtifactId,
      ) ?? null;
    const assignment = artifact
      ? ([...indexes.assignments.values()].find(
          ({ assignmentId }) => assignmentId === artifact.assignmentId,
        ) ?? null)
      : null;
    if (assignment?.assignmentKind === 'verification') {
      exactInsufficientEvidenceChain(indexes, plan, action, outcome);
    }
  }
  const observations =
    outcome === null
      ? []
      : outcome.observationIds.map((observationId) => {
          const observation = indexes.metricObservations.get(observationId);
          if (
            !observation ||
            observation.metricId !== metric.metricId ||
            !metric.observationIds.includes(observationId)
          ) {
            fail(
              'E_OPERATE_BINDING_MISMATCH',
              'Outcome observation does not bind the exact verified Metric.',
              { outcomeId: outcome.outcomeId, observationId },
            );
          }
          return observation;
        });
  return {
    action,
    metric,
    observations,
    metricHash: sha256Jcs(metric),
    verificationPlanHash: sha256Jcs(plan),
  };
}

function buildOutcomes(indexes, screen) {
  return [...indexes.outcomes.values()]
    .map((outcome) => {
      const plan = indexes.verificationPlans.get(outcome.verificationPlanId) ?? null;
      const exact = exactVerificationChain(indexes, plan, outcome);
      const {
        action,
        metric,
        observations: matchedObservations,
        metricHash,
        verificationPlanHash,
      } = exact;
      const observed = newest(matchedObservations, 'observedAt');
      const snapshot = observed ? (indexes.snapshots.get(observed.snapshotId) ?? null) : null;
      const delta = snapshot
        ? newest(
            [...indexes.deltas.values()].filter(
              (entry) => entry.currentSnapshotId === snapshot.snapshotId,
            ),
            'derivedAt',
          )
        : null;
      const decision = action?.sourceDecisionId
        ? (indexes.decisions.get(action.sourceDecisionId) ?? null)
        : null;
      const planAccess = plan
        ? screen.inspect([plan.sourceArtifactId])
        : { visible: true, classification: 'public' };
      const execution = [...indexes.executionResults.values()]
        .filter((entry) => entry.action.actionId === outcome.actionId)
        .map((entry) => resultProjection(entry, screen, 'resultId'))
        .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
      const rollback = [...indexes.rollbackResults.values()]
        .filter((entry) => entry.action.actionId === outcome.actionId)
        .map((entry) => resultProjection(entry, screen, 'rollbackResultId'))
        .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
      return {
        outcomeId: outcome.outcomeId,
        actionId: outcome.actionId,
        verificationPlanId: outcome.verificationPlanId,
        status: outcome.status,
        metric: metric
          ? {
              metricId: metric.metricId,
              metricHash,
              baseline: planAccess.visible ? (plan?.baseline ?? action?.baseline ?? null) : null,
              target: planAccess.visible ? (plan?.target ?? action?.target ?? null) : null,
              observed: planAccess.visible ? (observed?.value ?? null) : null,
              unit: planAccess.visible ? (observed?.unit ?? metric.unit) : null,
              window: planAccess.visible ? (plan?.window ?? metric.window) : null,
              dueAt: null,
              freshness: metric.freshness,
              confidence: null,
            }
          : null,
        observationIds: planAccess.visible ? [...outcome.observationIds].sort() : [],
        evidenceRefIds: planAccess.visible
          ? outcome.evidenceRefIds
              .filter((id) => {
                const evidence = indexes.evidenceRefs.get(id);
                return evidence ? screen.inspect([evidence.evidenceArtifactId]).visible : false;
              })
              .sort()
          : [],
        observedAt: outcome.observedAt,
        decision: decision
          ? {
              decisionId: decision.decisionId,
              revision: decision.revision,
              state: decision.state,
              deepLink: deepLink('decision', decision.decisionId),
            }
          : null,
        execution,
        rollback,
        verification: plan
          ? {
              verificationPlanId: plan.verificationPlanId,
              verificationPlanHash,
              metricId: metric.metricId,
              metricHash,
              method: planAccess.visible ? plan.method : null,
              evaluationRules: planAccess.visible ? [...plan.evaluationRules] : [],
              observationRequest: planAccess.visible ? clone(plan.observationRequest) : null,
              accessReason: planAccess.visible ? null : 'access-denied',
            }
          : null,
        nextObservation:
          planAccess.visible && plan ? { ...clone(plan.observationRequest), dueAt: null } : null,
        revisit:
          planAccess.visible && plan
            ? {
                decisionIds: [...plan.revisitDecisionIds].sort(),
                conditions: plan.revisitDecisionIds.flatMap(
                  (decisionId) => indexes.decisions.get(decisionId)?.revisitConditions ?? [],
                ),
              }
            : null,
        snapshot: snapshot
          ? { snapshotId: snapshot.snapshotId, createdAt: snapshot.createdAt }
          : null,
        delta: delta
          ? {
              deltaId: delta.deltaId,
              priorSnapshotId: delta.priorSnapshotId,
              currentSnapshotId: delta.currentSnapshotId,
              derivedAt: delta.derivedAt,
            }
          : null,
        accessReason: planAccess.visible ? null : 'access-denied',
        deepLink: deepLink('outcome', outcome.outcomeId),
      };
    })
    .sort((left, right) => left.outcomeId.localeCompare(right.outcomeId));
}

function historySubject(indexes, entityId) {
  const candidates = [
    ['cycle', indexes.cycles.get(entityId)],
    [
      'input-binding',
      [...indexes.inputBindings.values()].find(({ inputBindingId }) => inputBindingId === entityId),
    ],
    ['assignment', indexes.assignments.get(entityId)],
    ['review', indexes.reviews.get(entityId)],
    ['artifact', indexes.artifacts.get(entityId)],
    ['decision', indexes.decisions.get(entityId)],
    ['action', indexes.actions.get(entityId)],
    ['outcome', indexes.outcomes.get(entityId)],
    ['learning', indexes.learnings.get(entityId)],
    ['operation', indexes.governedOperations.get(entityId)],
    ['execution-result', indexes.executionResults.get(entityId)],
    ['rollback-result', indexes.rollbackResults.get(entityId)],
  ];
  return candidates.find(([, record]) => record) ?? [null, null];
}

function historySourceArtifacts(indexes, kind, record) {
  if (!record) return [];
  if (kind === 'cycle') return indexes.inputBindings.get(record.cycleId)?.sourceArtifactIds ?? [];
  if (kind === 'input-binding') return record.sourceArtifactIds;
  if (kind === 'assignment') return record.inputArtifactIds;
  if (kind === 'artifact') return [record.artifactId];
  if (kind === 'review') return indexes.inputBindings.get(record.cycleId)?.sourceArtifactIds ?? [];
  if (['decision', 'action', 'outcome', 'learning'].includes(kind))
    return record.sourceArtifactId ? [record.sourceArtifactId] : [];
  if (kind === 'operation') return record.inputArtifactIds ?? [];
  return record.resultArtifactId ? [record.resultArtifactId] : [];
}

function historyEvidence(indexes, kind, record) {
  if (!record) return [];
  if (kind === 'decision' || kind === 'outcome' || kind === 'learning')
    return [...record.evidenceRefIds].sort();
  if (kind === 'action')
    return indexes.decisions.get(record.sourceDecisionId)?.evidenceRefIds?.slice().sort() ?? [];
  return [];
}

function historySummary(indexes, kind, record) {
  if (!record) return null;
  if (kind === 'cycle') return record.focus.join('; ') || null;
  if (kind === 'assignment') return record.objective;
  if (kind === 'decision' || kind === 'action') return record.title;
  if (kind === 'learning') return record.statement;
  if (kind === 'outcome') return record.status;
  if (kind === 'execution-result' || kind === 'rollback-result')
    return record.effectSummary.summary;
  if (kind === 'operation') return indexes.actions.get(record.action.actionId)?.title ?? null;
  return null;
}

function historyWhy(indexes, kind, record) {
  if (!record) return null;
  if (kind === 'decision') return record.rationale;
  if (kind === 'action')
    return indexes.decisions.get(record.sourceDecisionId)?.rationale ?? record.expectedResult;
  if (kind === 'outcome') {
    const action = indexes.actions.get(record.actionId);
    return action
      ? (indexes.decisions.get(action.sourceDecisionId)?.rationale ?? action.expectedResult)
      : null;
  }
  if (kind === 'learning') return record.statement;
  return null;
}

function historyAuthority(indexes, kind, record) {
  const operation =
    kind === 'operation'
      ? record
      : ['execution-result', 'rollback-result'].includes(kind)
        ? indexes.governedOperations.get(record.operationId ?? record.rollbackOperationId)
        : null;
  return operation
    ? {
        evaluationId: operation.evaluationId,
        approvalIds: [...operation.approvalIds].sort(),
        grantId: operation.grantId,
        capability: clone(operation.capability),
      }
    : null;
}

function buildHistory(indexes, cycles, allowedActions, screen) {
  const cycleIds = new Set(cycles.map(({ cycleId }) => cycleId));
  const nextBySubject = new Map(
    allowedActions.map(({ subjectId, action }) => [
      subjectId,
      { label: action.label, tool: action.tool },
    ]),
  );
  return indexes.stateEvents
    .filter((entry) => cycleIds.has(entry.cycleId))
    .map((entry) => {
      const [kind, record] = historySubject(indexes, entry.entityId);
      if (!record) return null;
      const sourceArtifactIds = historySourceArtifacts(indexes, kind, record);
      const lifecycleTransition =
        (kind === 'action' || kind === 'cycle') &&
        entry.payload &&
        typeof entry.payload.from === 'string' &&
        typeof entry.payload.to === 'string';
      const canonicalTransitionSummary = lifecycleTransition
        ? `${entry.payload.from} → ${entry.payload.to}`
        : null;
      const change = lifecycleTransition
        ? canonicalTransitionSummary
        : screen.text(historySummary(indexes, kind, record), null, sourceArtifactIds);
      const why = lifecycleTransition
        ? typeof entry.payload.reasonCode === 'string'
          ? entry.payload.reasonCode
          : null
        : screen.text(historyWhy(indexes, kind, record), null, sourceArtifactIds);
      const delta = newest(
        [...indexes.deltas.values()].filter((candidate) =>
          [...candidate.sourceRevisionChanges, ...candidate.metricChanges].some(
            ({ subjectId }) => subjectId === entry.entityId,
          ),
        ),
        'derivedAt',
      );
      const changeRecord = delta
        ? [...delta.sourceRevisionChanges, ...delta.metricChanges].find(
            ({ subjectId }) => subjectId === entry.entityId,
          )
        : null;
      const result =
        kind === 'execution-result' || kind === 'rollback-result'
          ? { status: record.status, completedAt: record.completedAt }
          : record?.state
            ? { status: record.state, completedAt: record.updatedAt ?? null }
            : record?.status
              ? { status: record.status, completedAt: record.observedAt ?? null }
              : null;
      const subjectLinkKind = kind === 'operation' || kind?.includes('result') ? 'history' : kind;
      return {
        eventId: entry.eventId,
        sequence: entry.sequence,
        type: entry.type,
        entityId: entry.entityId,
        actorKind: entry.actor.kind,
        actorId:
          sourceArtifactIds.length > 0 ? screen.identity(entry.actor.id, sourceArtifactIds) : null,
        timestamp: entry.timestamp,
        correlationId: entry.correlationId,
        eventHash: entry.eventHash,
        change: { subjectKind: kind, summary: change },
        why,
        authority: historyAuthority(indexes, kind, record),
        evidenceRefIds: historyEvidence(indexes, kind, record).filter((id) => {
          const evidence = indexes.evidenceRefs.get(id);
          return evidence ? screen.inspect([evidence.evidenceArtifactId]).visible : false;
        }),
        prior: { previousEventHash: entry.previousEventHash, causationId: entry.causationId },
        result,
        next: nextBySubject.get(entry.entityId) ?? null,
        deepLinks: [deepLink(subjectLinkKind, entry.entityId)].filter(Boolean),
        beforeAfter:
          delta && changeRecord
            ? {
                deltaId: delta.deltaId,
                kind: changeRecord.kind,
                priorSnapshotId: delta.priorSnapshotId,
                currentSnapshotId: delta.currentSnapshotId,
              }
            : null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.sequence - right.sequence);
}

function buildReplay(state, checkpoint, sourceStateHash, stateParityVerified, omissions) {
  const eventReplayIndexHash = sha256Jcs(state.eventReplayIndex);
  const startSequence = checkpoint
    ? checkpoint.eventHead.sequence + 1
    : (state.eventReplayIndex[0]?.sequence ?? null);
  const tail = checkpoint
    ? state.eventReplayIndex.filter(({ sequence }) => sequence > checkpoint.eventHead.sequence)
    : state.eventReplayIndex;
  return {
    checkpoint: checkpoint ? clone(checkpoint) : null,
    tail: {
      startSequence,
      endSequence: tail.at(-1)?.sequence ?? null,
      eventCount: tail.length,
      eventReplayIndexHash,
    },
    finalHead: clone(state.eventHead),
    liveAccessUsed: false,
    parityProof: {
      sourceStateHash,
      eventReplayIndexHash,
      checkpointVerified: checkpoint !== null,
      stateParityVerified,
      finalEventHashMatches:
        state.eventHead.sequence === 0
          ? state.eventHead.hash === null
          : state.eventReplayIndex.at(-1)?.eventHash === state.eventHead.hash,
    },
    filterDimensions: [
      'cycle',
      'action',
      'decision',
      'actor',
      'operation',
      'result',
      'event-type',
      'date',
    ],
    redactions: clone(omissions),
  };
}

function mergeOmissions(...groups) {
  const merged = new Map();
  for (const entry of groups.flat()) {
    const key = `${entry.classification}:${entry.reason}`;
    merged.set(key, { ...entry, count: (merged.get(key)?.count ?? 0) + entry.count });
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.classification.localeCompare(right.classification) ||
      left.reason.localeCompare(right.reason),
  );
}

function deepLink(kind, id, parentId = null) {
  const value = encodeURIComponent(id);
  return (
    {
      cycle: `#/operate/cycles/${value}`,
      assignment: `#/operate/cycles/${encodeURIComponent(parentId)}?assignment=${value}`,
      review: `#/operate/cycles/${encodeURIComponent(parentId)}/reviews/${value}`,
      decision: `#/operate/inbox/${value}`,
      approval: `#/operate/inbox/${value}`,
      action: `#/operate/actions/${value}`,
      evidence: `#/operate/evidence/${value}`,
      outcome: `#/operate/outcomes/${value}`,
      history: `#/operate/history/${value}`,
    }[kind] ?? null
  );
}

function newest(records, field) {
  return (
    [...records].sort(
      (left, right) =>
        right[field].localeCompare(left[field]) ||
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
    )[0] ?? null
  );
}

function assignmentStage(assignment) {
  return (
    {
      advisor: 'understand',
      challenger: 'understand',
      chair: 'understand',
      execution: 'act',
      verification: 'verify',
    }[assignment.assignmentKind] ?? 'observe'
  );
}

function accessSafeArtifactMetadata(indexes, screen, artifactId) {
  const artifact = indexes.artifacts.get(artifactId);
  const access = screen.inspect(artifactId ? [artifactId] : []);
  if (!artifact || !access.visible) return { artifact: null, access };
  return {
    artifact: {
      artifactId: artifact.artifactId,
      artifactType: artifact.artifactType,
      producer: clone(artifact.producer),
      observedAt: artifact.createdAt,
      rawHash: artifact.rawHash,
      canonicalHash: artifact.canonicalHash,
    },
    access,
  };
}

function buildDomainMetrics(indexes, screen) {
  const observations = [...indexes.metricObservations.values()];
  const deltas = [...indexes.deltas.values()];
  const plans = [...indexes.verificationPlans.values()];
  return [...indexes.metrics.values()]
    .map((metric) => {
      const access = screen.inspect([metric.sourceArtifactId]);
      if (!access.visible) screen.omit(access.classification, 'body-never-projected');
      const metricObservations = observations
        .filter(
          (entry) =>
            entry.metricId === metric.metricId &&
            metric.observationIds.includes(entry.observationId),
        )
        .sort(
          (left, right) =>
            left.observedAt.localeCompare(right.observedAt) ||
            left.observationId.localeCompare(right.observationId),
        );
      const current = metricObservations.at(-1) ?? null;
      const prior = metricObservations.at(-2) ?? null;
      const snapshot = current ? (indexes.snapshots.get(current.snapshotId) ?? null) : null;
      const delta = newest(
        deltas.filter(
          (entry) =>
            entry.currentSnapshotId === current?.snapshotId &&
            entry.metricChanges.some(({ subjectId }) => subjectId === metric.metricId),
        ),
        'derivedAt',
      );
      const deltaChange =
        delta?.metricChanges.find(({ subjectId }) => subjectId === metric.metricId) ?? null;
      const verification = plans
        .filter((entry) => entry.metricId === metric.metricId)
        .map((plan) => {
          const { action } = exactVerificationChain(indexes, plan);
          const outcome = newest(
            [...indexes.outcomes.values()].filter(
              (entry) => entry.verificationPlanId === plan.verificationPlanId,
            ),
            'observedAt',
          );
          return {
            verificationPlanId: plan.verificationPlanId,
            actionId: plan.actionId,
            state: outcome?.status ?? action?.state ?? null,
            dueAt: null,
            window: access.visible ? plan.window : null,
            deepLink: action ? deepLink('action', action.actionId) : null,
          };
        })
        .sort((left, right) => left.verificationPlanId.localeCompare(right.verificationPlanId));
      const state = access.visible ? (current ? metric.freshness : 'unavailable') : 'restricted';
      return {
        metricId: metric.metricId,
        title: access.visible ? metric.title : null,
        value: access.visible ? (current?.value ?? null) : null,
        unit: access.visible ? (current?.unit ?? metric.unit) : null,
        change:
          access.visible && (current || deltaChange)
            ? {
                kind: deltaChange?.kind ?? (prior ? 'changed' : 'added'),
                priorValue: prior?.value ?? null,
                currentValue: current?.value ?? null,
                deltaValue: prior && current ? current.value - prior.value : null,
                deltaId: delta?.deltaId ?? null,
              }
            : null,
        window: access.visible ? metric.window : null,
        freshness: metric.freshness,
        state,
        target: access.visible ? metric.target : null,
        threshold: access.visible ? metric.threshold : null,
        evidenceRefIds: access.visible
          ? metric.evidenceRefIds
              .filter((id) => {
                const evidence = indexes.evidenceRefs.get(id);
                return evidence ? screen.inspect([evidence.evidenceArtifactId]).visible : false;
              })
              .sort()
          : [],
        snapshot: snapshot
          ? { snapshotId: snapshot.snapshotId, createdAt: snapshot.createdAt }
          : null,
        delta: delta
          ? {
              deltaId: delta.deltaId,
              priorSnapshotId: delta.priorSnapshotId,
              currentSnapshotId: delta.currentSnapshotId,
              derivedAt: delta.derivedAt,
            }
          : null,
        dueVerification: verification,
        accessReason: access.visible ? null : 'access-denied',
      };
    })
    .sort((left, right) => left.metricId.localeCompare(right.metricId));
}

function buildCycleDetails(
  indexes,
  cycles,
  screen,
  replayCheckpoint,
  generatedAt,
  scope,
  state,
  accessLevel,
) {
  const assignments = [...indexes.assignments.values()];
  const actions = [...indexes.actions.values()];
  const resolutions = [...indexes.evidenceResolutions.values()];
  const uncertainClaims = [...indexes.claims.values()].filter(({ epistemicStatus }) =>
    ['speculative', 'unknown'].includes(epistemicStatus),
  );
  const uncertainOperations = [...indexes.governedOperations.values()].filter(({ state }) =>
    ['partial', 'uncertain', 'blocked'].includes(state),
  );
  return cycles.map((cycle) => {
    const cycleAssignments = assignments.filter((entry) => entry.cycleId === cycle.cycleId);
    const intelligencePlan = intelligencePlanForCycle(indexes, cycleAssignments);
    const cycleActions = actions.filter((entry) => entry.sourceCycleId === cycle.cycleId);
    const rows = cycleAssignments
      .map((assignment) => {
        const outputArtifactIds = [...indexes.artifacts.values()]
          .filter(({ assignmentId }) => assignmentId === assignment.assignmentId)
          .map(({ artifactId }) => artifactId)
          .sort();
        const dependencies = assignment.dependsOn.map((assignmentId) => {
          const dependency = indexes.assignments.get(assignmentId);
          return {
            assignmentId,
            state: dependency?.state ?? null,
            resolved: dependency?.state === 'validated',
          };
        });
        return {
          assignmentId: assignment.assignmentId,
          title: screen.text(assignment.objective, null, assignment.inputArtifactIds),
          role: screen.identity(assignment.roleId, assignment.inputArtifactIds),
          ownerLabel: screen.identity(
            assignment.claim?.actorId ?? null,
            assignment.inputArtifactIds,
          ),
          state: assignment.state,
          absence: assignmentAbsence(assignment),
          dueAt: null,
          next: null,
          deepLink: deepLink('assignment', assignment.assignmentId, cycle.cycleId),
          dependencies,
          blockers: dependencies
            .filter(({ resolved }) => !resolved)
            .map(({ assignmentId }) => assignmentId),
          inputArtifactIds: screen.artifactIds(assignment.inputArtifactIds),
          outputArtifactIds: screen.artifactIds(outputArtifactIds),
        };
      })
      .sort((left, right) => left.assignmentId.localeCompare(right.assignmentId));
    const evidenceGapIds = resolutions
      .filter(
        ({ outcome, sourceArtifactId }) =>
          outcome === 'rejected' && screen.inspect([sourceArtifactId]).visible,
      )
      .map(({ resolutionId }) => resolutionId)
      .sort();
    const uncertaintyIds = [
      ...uncertainClaims
        .filter(({ sourceArtifactId }) => screen.inspect([sourceArtifactId]).visible)
        .map(({ claimId }) => claimId),
      ...uncertainOperations
        .filter(({ action }) => cycleActions.some(({ actionId }) => actionId === action.actionId))
        .map(({ operationId }) => operationId),
    ].sort();
    const reviews = [...indexes.reviews.values()].filter(
      (entry) => entry.cycleId === cycle.cycleId,
    );
    const requirements = [...indexes.approvalRequirements.values()].filter(
      (requirement) =>
        currentApprovalRequirement(requirement, indexes) &&
        cycleActions.some(
          ({ actionId, revision, actionHash }) =>
            actionId === requirement.action.actionId &&
            revision === requirement.action.revision &&
            actionHash === requirement.action.actionHash,
        ),
    );
    const gatesByStage = {
      decide: reviews.map(({ reviewId, state }) => ({
        kind: 'review',
        subjectId: reviewId,
        state,
      })),
      govern: requirements.map((requirement) => ({
        kind: 'approval',
        subjectId: requirement.requirementId,
        state:
          approvalRequirementConsumed(requirement, indexes) ||
          approvalComplete(requirement, indexes, generatedAt)
            ? 'complete'
            : 'waiting',
      })),
      act: [...indexes.governedOperations.values()]
        .filter(({ action }) => cycleActions.some(({ actionId }) => actionId === action.actionId))
        .map(({ operationId, state }) => ({ kind: 'execution', subjectId: operationId, state })),
      verify: [...indexes.outcomes.values()]
        .filter(({ actionId }) => cycleActions.some((action) => action.actionId === actionId))
        .map(({ outcomeId, status }) => ({
          kind: 'verification',
          subjectId: outcomeId,
          state: status,
        })),
      learn: [...indexes.learnings.values()]
        .filter(({ outcomeId }) =>
          [...indexes.outcomes.values()].some(
            (outcome) =>
              outcome.outcomeId === outcomeId &&
              cycleActions.some((action) => action.actionId === outcome.actionId),
          ),
        )
        .map(({ learningId }) => ({ kind: 'learning', subjectId: learningId, state: 'recorded' })),
    };
    const stages = cycle.stages.map((stage) => {
      const stageAssignments = rows.filter(
        (entry) => assignmentStage(indexes.assignments.get(entry.assignmentId)) === stage.id,
      );
      return {
        ...stage,
        inputArtifactIds: [
          ...new Set(stageAssignments.flatMap(({ inputArtifactIds }) => inputArtifactIds)),
        ].sort(),
        outputArtifactIds: [
          ...new Set(stageAssignments.flatMap(({ outputArtifactIds }) => outputArtifactIds)),
        ].sort(),
        gates: (gatesByStage[stage.id] ?? []).sort((left, right) =>
          left.subjectId.localeCompare(right.subjectId),
        ),
        evidenceGapIds: stage.id === 'understand' ? evidenceGapIds : [],
        uncertaintyIds: ['understand', 'act', 'verify'].includes(stage.id) ? uncertaintyIds : [],
        persistentActionIds: ['act', 'verify', 'learn'].includes(stage.id)
          ? cycleActions.map(({ actionId }) => actionId).sort()
          : [],
      };
    });
    const dependencies = [
      ...rows
        .filter(({ dependencies: values }) => values.length > 0)
        .map(({ assignmentId, dependencies: values }) => ({
          subjectKind: 'assignment',
          subjectId: assignmentId,
          dependsOn: values,
        })),
      ...cycleActions
        .filter(({ dependsOnActionIds }) => dependsOnActionIds.length > 0)
        .map((action) => ({
          subjectKind: 'action',
          subjectId: action.actionId,
          dependsOn: action.dependsOnActionIds.map((actionId) => ({
            actionId,
            state: indexes.actions.get(actionId)?.state ?? null,
            resolved: indexes.actions.get(actionId)?.state === 'completed',
          })),
        })),
    ];
    const lensAbsences = lensAbsencesForPlan(intelligencePlan);
    const cycleRecord = indexes.cycles.get(cycle.cycleId);
    const cycleReviews = [...indexes.reviews.values()].filter(
      (entry) => entry.cycleId === cycle.cycleId && entry.subject?.type !== 'action',
    );
    let boardRecord = null;
    let traceMatrix = null;
    if (intelligencePlan && cycleReviews.length === 1) {
      try {
        boardRecord = readOperatingExecutiveBoardV2(state, {
          cycleId: cycle.cycleId,
          reviewId: cycleReviews[0].reviewId,
          accessLevel,
          eventHead: state.eventHead,
        });
        traceMatrix = clone(assertOperatingTraceMatrixV2(boardRecord.traceMatrix));
      } catch (error) {
        if (cycleRecord?.state === 'awaiting_review') {
          fail(
            'E_OPERATE_BINDING_MISMATCH',
            'Awaiting-Review Cycle cannot resolve one exact Executive Board truth.',
            {
              cycleId: cycle.cycleId,
              cause: error.code ?? error.message,
            },
          );
        }
      }
    }
    return {
      ...cycle,
      stages,
      assignments: rows,
      lensAbsences,
      executiveBoard: buildExecutiveBoardForCycle({
        indexes,
        cycle,
        scope: cycleRecord
          ? {
              scopeId: cycleRecord.scopeId,
              domainId: cycleRecord.domainId,
              domainVersion: cycleRecord.domainVersion,
            }
          : scope,
        screen,
        intelligencePlan,
        lensAbsences,
        assignmentAbsence,
        boardRecord,
        traceMatrix,
      }),
      dependencies,
      blockers: dependencies
        .filter(({ dependsOn }) => dependsOn.some(({ resolved }) => !resolved))
        .map(({ subjectKind, subjectId, dependsOn }) => ({
          subjectKind,
          subjectId,
          blockingSubjectIds: dependsOn
            .filter(({ resolved }) => !resolved)
            .map((entry) => entry.assignmentId ?? entry.actionId)
            .sort(),
        })),
      persistentActionIds: cycleActions.map(({ actionId }) => actionId).sort(),
      replayCheckpoint: replayCheckpoint ? clone(replayCheckpoint) : null,
      deepLink: deepLink('cycle', cycle.cycleId),
    };
  });
}

const ALLOWED_ACTION_SUBJECTS = Object.freeze({
  'operate.cycle.get': {
    kind: 'cycle',
    index: 'cycles',
    stateField: 'cycles',
    identityField: 'cycleId',
    argumentField: 'cycleId',
  },
  'operate.cycle.resume': {
    kind: 'cycle',
    index: 'cycles',
    stateField: 'cycles',
    identityField: 'cycleId',
    argumentField: 'cycleId',
  },
  'operate.assignment.claim': {
    kind: 'assignment',
    index: 'assignments',
    stateField: 'assignments',
    identityField: 'assignmentId',
    argumentField: 'assignmentId',
  },
  'operate.assignment.submit': {
    kind: 'assignment',
    index: 'assignments',
    stateField: 'assignments',
    identityField: 'assignmentId',
    argumentField: 'assignmentId',
  },
  'operate.artifact.get': {
    kind: 'artifact',
    index: 'artifacts',
    stateField: 'artifacts',
    identityField: 'artifactId',
    argumentField: 'artifactId',
  },
  'operate.review.get': {
    kind: 'review',
    index: 'reviews',
    stateField: 'reviews',
    identityField: 'reviewId',
    argumentField: 'reviewId',
  },
  'operate.review.submit': {
    kind: 'review',
    index: 'reviews',
    stateField: 'reviews',
    identityField: 'reviewId',
    argumentField: 'reviewId',
  },
  'operate.action.approve': {
    kind: 'action',
    index: 'actions',
    stateField: 'actions',
    identityField: 'actionId',
    argumentField: 'action',
  },
  'operate.action.execute': {
    kind: 'action',
    index: 'actions',
    stateField: 'actions',
    identityField: 'actionId',
    argumentField: 'action',
  },
  'operate.action.rollback': {
    kind: 'action',
    index: 'actions',
    stateField: 'actions',
    identityField: 'actionId',
    argumentField: 'action',
  },
});

function actorArgumentIds(value, ids = []) {
  if (Array.isArray(value)) {
    for (const entry of value) actorArgumentIds(entry, ids);
    return ids;
  }
  if (!value || typeof value !== 'object') return ids;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'actorId' && typeof entry === 'string') ids.push(entry);
    else actorArgumentIds(entry, ids);
  }
  return ids;
}

function resolveAllowedActionSubject(state, indexes, entry, actorId) {
  if (!entry || typeof entry.subjectId !== 'string')
    fail('RESULT_CONTRACT_INVALID', 'Allowed actions require one explicit subject identity.');
  assertProtocolArtifact('operate-allowed-action', entry.action, {
    protocolVersion: PROTOCOL_VERSION,
  });
  const binding = ALLOWED_ACTION_SUBJECTS[entry.action.tool];
  if (!binding)
    fail(
      'CAPABILITY_DENIED',
      'Allowed actions require an existing operation-specific canonical subject.',
      { tool: entry.action.tool },
    );
  const argument = entry.action.arguments[binding.argumentField];
  const argumentId = binding.kind === 'action' ? argument?.actionId : argument;
  if (argumentId !== entry.subjectId)
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Allowed action arguments do not bind the exact operation-specific subject.',
      { tool: entry.action.tool, subjectId: entry.subjectId },
    );
  if (actorArgumentIds(entry.action.arguments).some((value) => value !== actorId)) {
    fail(
      'CAPABILITY_DENIED',
      'Allowed action actor arguments do not bind the current experience actor.',
      { tool: entry.action.tool, subjectId: entry.subjectId },
    );
  }
  const record = indexes[binding.index].get(argumentId);
  if (!record)
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Allowed action subject is foreign or absent from the selected scope/domain/version.',
      { tool: entry.action.tool, subjectId: entry.subjectId },
    );
  const candidates = (state[binding.stateField] ?? []).filter((candidate) => {
    if (candidate?.[binding.identityField] !== argumentId) return false;
    if (binding.kind !== 'action') return true;
    return candidate.revision === argument.revision && candidate.actionHash === argument.actionHash;
  });
  if (candidates.length !== 1)
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Allowed action subject identity is ambiguous across runtime state.',
      { tool: entry.action.tool, subjectId: entry.subjectId, candidates: candidates.length },
    );
  if (
    binding.kind === 'action' &&
    (record.revision !== argument.revision || record.actionHash !== argument.actionHash)
  ) {
    fail(
      'ACTION_REVISION_MISMATCH',
      'Allowed action arguments contain a stale or foreign Action tuple.',
      { actionId: argumentId },
    );
  }
  return {
    kind: binding.kind,
    id: argumentId,
    revision: binding.kind === 'action' ? record.revision : null,
    hash:
      binding.kind === 'action'
        ? record.actionHash
        : binding.kind === 'artifact'
          ? record.rawHash
          : sha256Jcs(record),
    record,
  };
}

function subjectArtifactIds(indexes, subject) {
  if (subject.kind === 'cycle')
    return indexes.inputBindings.get(subject.id)?.sourceArtifactIds ?? [];
  if (subject.kind === 'assignment') return subject.record.inputArtifactIds;
  if (subject.kind === 'artifact') return [subject.id];
  if (subject.kind === 'review')
    return indexes.inputBindings.get(subject.record.cycleId)?.sourceArtifactIds ?? [];
  return subject.record?.sourceArtifactId ? [subject.record.sourceArtifactId] : [];
}

function boundAllowedActions(entries, state, indexes, screen, actorId) {
  const seen = new Set();
  return entries
    .map((entry) => {
      const subject = resolveAllowedActionSubject(state, indexes, entry, actorId);
      const actionDigest = sha256Jcs(entry.action);
      const key = `${subject.kind}:${subject.id}:${entry.action.tool}${
        entry.action.tool === 'operate.review.submit' ? `:${actionDigest}` : ''
      }`;
      if (seen.has(key))
        fail(
          'RESULT_CONTRACT_INVALID',
          'Allowed actions require one unique operation-specific subject tuple.',
        );
      seen.add(key);
      const action = clone(entry.action);
      action.label = screen.text(
        action.label,
        'Restricted action',
        subjectArtifactIds(indexes, subject),
      );
      return { subjectId: entry.subjectId, action };
    })
    .sort(
      (a, b) =>
        a.subjectId.localeCompare(b.subjectId) ||
        a.action.tool.localeCompare(b.action.tool) ||
        sha256Jcs(a.action).localeCompare(sha256Jcs(b.action)),
    );
}

/** Purely reconstruct one actor/scope experience from already durable state. */
export function buildOperateExperienceViewV2(
  state,
  {
    scope,
    actor,
    deliveryRoutes = [],
    allowedActions = [],
    events = [],
    checkpoint = null,
    checkpointState = null,
    generatedAt = state?.generatedAt,
    status = 'ready',
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
  assertBinding(scope, 'Experience projection');
  if (
    !actor ||
    typeof actor.actorId !== 'string' ||
    actor.actorId.length === 0 ||
    !ACCESS_ORDER.includes(actor.accessLevel)
  )
    fail('RESULT_CONTRACT_INVALID', 'Experience projection requires an actor and access level.');
  validInstant(generatedAt, 'generatedAt');
  const indexes = buildScopeIdentityIndexes(state, scope);
  const sourceStateHash = sha256Jcs(state);
  const replayCheckpointValidation = validateReplayCheckpoint(state, checkpoint, checkpointState);
  const replayCheckpoint = replayCheckpointValidation?.projection ?? null;
  const replayValidation = validateEventReplayIndex(state, events, replayCheckpointValidation);
  indexes.stateEvents = replayValidation.events;
  for (const metric of replayValidation.canonicalMetrics) {
    if (!sameScope(metric, scope)) continue;
    const prior = indexes.metrics.get(metric.metricId);
    if (prior && sha256Jcs(prior) !== sha256Jcs(metric)) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Current Metric conflicts with its exact verification-plan snapshot/state provenance.',
        {
          metricId: metric.metricId,
        },
      );
    }
    if (!prior) indexes.metrics.set(metric.metricId, clone(metric));
  }
  const screen = createAccessScreen(indexes.artifacts, actor.accessLevel);
  const baseCycles = [...indexes.cycles.values()]
    .map((cycle) => {
      const sourceArtifactIds = indexes.inputBindings.get(cycle.cycleId)?.sourceArtifactIds ?? [];
      return {
        cycleId: cycle.cycleId,
        state: cycle.state,
        health: cycle.health,
        focus: cycle.focus.map((value) =>
          screen.text(value, 'Restricted cycle focus', sourceArtifactIds),
        ),
        createdAt: cycle.createdAt,
        updatedAt: cycle.updatedAt,
        stages: cycleStages(cycle),
      };
    })
    .sort(compareLatest);
  const actionRecords = [...indexes.actions.values()].sort((a, b) =>
    a.actionId.localeCompare(b.actionId),
  );
  if (
    deliveryRoutes.length !== actionRecords.length ||
    deliveryRoutes.some(
      (route) => !actionRecords.some(({ actionId }) => actionId === route?.action?.actionId),
    )
  ) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Delivery routes must describe exactly the current scope-local Action set.',
    );
  }
  const actions = actionRecords.map((action) => {
    const source = [action.sourceArtifactId];
    const route = routeFor(action, deliveryRoutes, scope, state.eventHead);
    const executions = [...indexes.executionResults.values()]
      .filter((entry) => entry.action.actionId === action.actionId)
      .map((entry) => resultProjection(entry, screen, 'resultId'));
    const rollbacks = [...indexes.rollbackResults.values()]
      .filter((entry) => entry.action.actionId === action.actionId)
      .map((entry) => resultProjection(entry, screen, 'rollbackResultId'));
    return {
      actionId: action.actionId,
      revision: action.revision,
      actionHash: action.actionHash,
      title: screen.text(action.title, 'Restricted Action', source),
      state: action.state,
      ownerActorId: screen.identity(action.ownerActorId, source),
      expectedResult: screen.text(
        action.expectedResult,
        'Action details are unavailable at this access level.',
        source,
      ),
      verificationPlanId: action.verificationPlanId,
      deliveryRoute: screen.route(route, source),
      dependencyActionIds: [...action.dependsOnActionIds].sort(),
      executions,
      rollbacks,
      deepLink: deepLink('action', action.actionId),
    };
  });
  const outcomes = buildOutcomes(indexes, screen);
  const learnings = [...indexes.learnings.values()]
    .map((entry) => ({
      learningId: entry.learningId,
      outcomeId: entry.outcomeId,
      statement: screen.text(
        entry.statement,
        'Learning details are unavailable at this access level.',
        [entry.sourceArtifactId],
      ),
      decisionIds: [...entry.decisionIds].sort(),
      evidenceRefIds: entry.evidenceRefIds
        .filter((id) => {
          const evidence = indexes.evidenceRefs.get(id);
          return evidence ? screen.inspect([evidence.evidenceArtifactId]).visible : false;
        })
        .sort(),
      createdAt: entry.createdAt,
    }))
    .sort((a, b) => a.learningId.localeCompare(b.learningId));
  const safe = accessSafeEvidence(indexes, scope, actor.accessLevel);
  const claims = buildClaims(indexes, safe.evidence, scope, screen);
  const safeReasoning = safeRationale(state, indexes, scope, screen);
  const cycleDetails = buildCycleDetails(
    indexes,
    baseCycles,
    screen,
    replayCheckpoint,
    generatedAt,
    scope,
    state,
    actor.accessLevel,
  );
  const projectedAllowedActions = boundAllowedActions(
    allowedActions,
    state,
    indexes,
    screen,
    actor.actorId,
  );
  const inbox = buildInbox(
    indexes,
    baseCycles,
    actor.actorId,
    screen,
    generatedAt,
    safe.evidence,
    projectedAllowedActions,
  );
  const nextBySubject = new Map(
    projectedAllowedActions.map(({ subjectId, action }) => [
      subjectId,
      { label: action.label, tool: action.tool },
    ]),
  );
  const cycles = cycleDetails.map((cycle) => ({
    ...cycle,
    assignments: cycle.assignments.map((assignment) => ({
      ...assignment,
      next: nextBySubject.get(assignment.assignmentId) ?? null,
    })),
  }));
  const history = buildHistory(indexes, cycles, projectedAllowedActions, screen);
  const domainMetrics = buildDomainMetrics(indexes, screen);
  const omissions = mergeOmissions(safe.omissions, screen.omissions());
  const replay = buildReplay(
    state,
    replayCheckpoint,
    sourceStateHash,
    replayValidation.stateParityVerified,
    omissions,
  );
  const base = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    viewId: stableId('xview', {
      scope,
      actorId: actor.actorId,
      eventHead: state.eventHead,
      sourceStateHash,
    }),
    ...scope,
    actorId: actor.actorId,
    accessLevel: actor.accessLevel,
    generatedAt,
    eventHead: clone(state.eventHead),
    sourceStateHash,
    status,
    attention: buildAttention(indexes, inbox, actions, outcomes, actor.actorId, generatedAt),
    domainMetrics,
    cycles,
    inbox,
    actions,
    evidence: safe.evidence,
    claims,
    rationale: safeReasoning,
    outcomes,
    learnings,
    history,
    replay,
    allowedActions: projectedAllowedActions,
    omissions,
    export: {
      formats: ['html', 'json'],
      accessSafe: true,
      redactionCount: omissions.reduce((sum, entry) => sum + entry.count, 0),
    },
  };
  const view = { ...base, viewHash: sha256Jcs(base) };
  assertOperateExperienceArtifactV2('operate-experience-view', view);
  return freeze(view);
}

/** Return deterministic Today order from the contract-owned priority and stable identity. */
export function rankOperateAttentionV2(view) {
  assertCanonicalView(view);
  return freeze(sortAttention(view.attention.map(clone)));
}

function previewTarget(kind, id, revision, hash, disposition) {
  return { kind, id, revision, hash, disposition };
}

function buildPreviewTransition(state, indexes, current, allowedAction, actorId) {
  const args = allowedAction.arguments;
  if (allowedAction.tool === 'operate.review.submit') {
    const review = current.record;
    const disposition = args.disposition;
    const targets = [
      previewTarget('review', review.reviewId, null, sha256Jcs(review), disposition),
    ];
    for (const work of args.workDispositions ?? []) {
      const kind =
        work.entityType === 'operating-decision'
          ? 'decision'
          : work.entityType === 'operating-action'
            ? 'action'
            : 'finding';
      const index =
        kind === 'decision'
          ? indexes.decisions
          : kind === 'action'
            ? indexes.actions
            : indexes.findings;
      const record = index.get(work.entityId);
      if (!record)
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Review preview target is absent from current canonical state.',
        );
      targets.push(
        previewTarget(
          kind,
          work.entityId,
          Number.isInteger(record.revision) ? record.revision : null,
          kind === 'action' ? record.actionHash : sha256Jcs(record),
          work.disposition,
        ),
      );
    }
    return { kind: 'review', targets, reversible: false, nextState: disposition, threshold: null };
  }
  if (allowedAction.tool === 'operate.action.approve') {
    if (args.rollback !== undefined) {
      const action = indexes.actions.get(current.id);
      if (!action || action.revision !== current.revision || action.actionHash !== current.hash) {
        fail(
          'E_OPERATE_BINDING_MISMATCH',
          'Rollback approval preview requires one exact current Action.',
        );
      }
      const { plan, template } = exactRollbackApprovalContext(
        indexes,
        action,
        args.rollback,
        actorId,
        state.generatedAt,
      );
      const recorded = Math.min(template.requirement.threshold, 1);
      const remaining = Math.max(0, template.requirement.threshold - recorded);
      return {
        kind: 'approval',
        targets: [
          previewTarget('action', current.id, current.revision, current.hash, args.decision),
          previewTarget(
            'rollback-plan',
            plan.rollbackPlanId,
            null,
            plan.planHash,
            'approval-recorded',
          ),
        ],
        reversible: false,
        nextState: remaining === 0 ? 'threshold-satisfied' : 'recorded-parties-remain',
        threshold: {
          required: template.requirement.threshold,
          recorded,
          remaining,
          parties: template.requirement.parties.map((party) =>
            inboxUnrecordedParty(party, actorId),
          ),
        },
      };
    }
    const requirements = [...indexes.approvalRequirements.values()].filter(
      (entry) =>
        entry.action.actionId === current.id &&
        entry.action.revision === current.revision &&
        entry.action.actionHash === current.hash &&
        (entry.namedActorIds.includes(actorId) ||
          entry.parties.some((party) => party.actorId === actorId)) &&
        openApprovalRequirement(entry, indexes, state.generatedAt),
    );
    if (requirements.length !== 1) {
      fail(
        'E_OPERATE_BINDING_MISMATCH',
        'Approval preview requires one exact current requirement and party binding.',
      );
    }
    const requirement = requirements[0];
    const recorded = [...indexes.approvalRecords.values()].filter(
      (entry) =>
        entry.requirementId === requirement.requirementId &&
        entry.decision === 'approved' &&
        entry.consumedByOperationId === null,
    ).length;
    const prospectiveRecorded = Math.min(requirement.threshold, recorded + 1);
    const remaining = Math.max(0, requirement.threshold - prospectiveRecorded);
    return {
      kind: 'approval',
      targets: [
        previewTarget('action', current.id, current.revision, current.hash, args.decision),
        previewTarget(
          requirement.target.kind,
          requirement.target.id,
          requirement.target.revision,
          null,
          'unchanged',
        ),
      ],
      reversible: false,
      nextState: remaining === 0 ? 'threshold-satisfied' : 'recorded-parties-remain',
      threshold: {
        required: requirement.threshold,
        recorded: prospectiveRecorded,
        remaining,
        parties: requirement.parties.map((party) =>
          inboxParty(party, indexes, actorId, requirement.requirementId),
        ),
      },
    };
  }
  if (allowedAction.tool === 'operate.assignment.submit') {
    return {
      kind: 'verification',
      targets: [previewTarget('assignment', current.id, null, current.hash, 'submitted')],
      reversible: false,
      nextState: 'submitted',
      threshold: null,
    };
  }
  if (allowedAction.tool === 'operate.action.rollback') {
    return {
      kind: 'rollback',
      targets: [previewTarget('action', current.id, current.revision, current.hash, 'rolled-back')],
      reversible: false,
      nextState: 'rollback-dispatching',
      threshold: null,
    };
  }
  return {
    kind: 'execution',
    targets: [
      previewTarget(current.kind, current.id, current.revision, current.hash, 'dispatching'),
    ],
    reversible:
      current.kind === 'action' &&
      (state.rollbackPlans?.some((entry) => entry.action?.actionId === current.id) ?? false),
    nextState: 'dispatching',
    threshold: null,
  };
}

/** Build the exact, expiring confirmation preview for one runtime-provided action. */
export function createOperateExperiencePreviewV1(
  state,
  {
    scope,
    view,
    actionDigest,
    authority,
    consequence,
    reasonCodes = [],
    issuedAt = state?.generatedAt,
    expiresAt,
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
  assertBinding(scope, 'Experience preview');
  assertCanonicalView(view);
  if (
    !sameScope(view, scope) ||
    view.sourceStateHash !== sha256Jcs(state) ||
    view.eventHead.sequence !== state.eventHead.sequence ||
    view.eventHead.hash !== state.eventHead.hash ||
    view.viewHash !== sha256Jcs(without(view, 'viewHash'))
  ) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Experience preview requires the exact current actor/scope/Event-head view.',
    );
  }
  if (!['allowed', 'refused', 'read-only'].includes(authority)) {
    fail('RESULT_CONTRACT_INVALID', 'Experience preview requires a closed authority disposition.');
  }
  if (typeof actionDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(actionDigest)) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Experience preview requires one exact owner-issued action digest.',
    );
  }
  validInstant(issuedAt, 'issuedAt');
  validInstant(expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(issuedAt))
    fail('RESULT_CONTRACT_INVALID', 'Experience preview expiry must follow issuance.');
  const indexes = buildScopeIdentityIndexes(state, scope);
  const issued = view.allowedActions.filter((entry) => sha256Jcs(entry.action) === actionDigest);
  if (issued.length !== 1) {
    fail(
      'CAPABILITY_DENIED',
      'Experience preview action is not in the exact current actor-bound allowed-action set.',
    );
  }
  const allowedAction = issued[0].action;
  const current = resolveAllowedActionSubject(state, indexes, issued[0], view.actorId);
  const subject = {
    kind: current.kind,
    id: current.id,
    revision: current.revision,
    hash: current.hash,
  };
  if ((allowedAction.effect === 'read-only') !== (authority === 'read-only')) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Preview authority does not match the allowed action effect.',
    );
  }
  const effectCopy = {
    'read-only': 'Read-only inspection',
    'machine-local-write': 'Machine-local change',
    'project-write': 'Project change',
    'provider-call': 'Provider call',
    'external-effect': 'External effect',
    destructive: 'Destructive effect',
  }[allowedAction.effect];
  const projectedAction =
    subject.kind === 'action'
      ? (view.actions.find(({ actionId }) => actionId === subject.id) ?? null)
      : null;
  const canonicalConsequence = projectedAction
    ? `${effectCopy}: ${allowedAction.label}. Expected change: ${projectedAction.expectedResult}. Route: ${projectedAction.deliveryRoute.route}.`
    : `${effectCopy}: ${allowedAction.label}. Subject: ${subject.kind} ${subject.id}.`;
  if (consequence !== undefined && consequence !== canonicalConsequence) {
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Preview consequence must equal the canonical runtime-derived consequence.',
    );
  }
  const sortedReasons = [...reasonCodes].sort();
  const transition = buildPreviewTransition(state, indexes, current, allowedAction, view.actorId);
  const base = {
    kind: 'operate-experience-preview',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    previewId: stableId('xprv', {
      scope,
      actorId: view.actorId,
      actionDigest,
      eventHead: state.eventHead,
    }),
    ...scope,
    actorId: view.actorId,
    subject: clone(subject),
    eventHead: clone(state.eventHead),
    sourceViewHash: view.viewHash,
    actionDigest,
    allowedAction: clone(allowedAction),
    authority,
    consequence: canonicalConsequence,
    reasonCodes: sortedReasons,
    transition,
    issuedAt,
    expiresAt,
  };
  const preview = { ...base, previewHash: sha256Jcs(base) };
  assertOperateExperienceArtifactV2('operate-experience-preview', preview);
  return freeze(preview);
}

/** Build an ordered, access-safe replacement patch between two valid views. */

/** Verify patch hashes and return the exact already-projected next view. */
export function applyOperateExperienceLivePatchV2(previous, patch, next) {
  assertCanonicalView(previous);
  assertOperateExperienceArtifactV2('operate-experience-live-patch', patch);
  assertCanonicalView(next);
  if (
    patch.patchHash !== sha256Jcs(without(patch, 'patchHash')) ||
    patch.fromViewHash !== previous.viewHash ||
    patch.toViewHash !== next.viewHash ||
    patch.fromEventHead.sequence !== previous.eventHead.sequence ||
    patch.fromEventHead.hash !== previous.eventHead.hash ||
    patch.toEventHead.sequence !== next.eventHead.sequence ||
    patch.toEventHead.hash !== next.eventHead.hash
  )
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Live patch hash or exact Event-head/view binding is invalid.',
    );
  const expected = buildOperateExperienceLivePatchV2(previous, next, {
    createdAt: patch.createdAt,
  });
  if (sha256Jcs(expected) !== sha256Jcs(patch))
    fail(
      'E_OPERATE_BINDING_MISMATCH',
      'Live patch operations do not equal the deterministic projection delta.',
    );
  return next;
}

export { buildOperateExperienceLivePatchV2 };
