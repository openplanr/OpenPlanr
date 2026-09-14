import { PipelineError } from '../protocol/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/canonical-json.mjs';
import { OPERATE_CONTRACT_CATALOG_V2 } from '../protocol/generated/contract-catalog-v2.mjs';
import {
  assertOperatingActionPolicyV2,
  assertOperatingPolicyEvaluationV2,
  isOperatingRollbackEligibilityV2,
} from './policy-v2.mjs';
import { evaluateOperatingApprovalSetV2 } from './approvals-v2.mjs';
import {
  assertContainedExecutorInputEnvelopeV2,
  assertOperateExecutorRegistrationV2,
  assertTrustedExecutorBindingV2,
} from './governed-extensions-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';
const AUTHORITY_DECISION_VERSION = '2.0.0';
const GOVERNED_OPERATIONS = new Set([
  'operate.review.submit',
  'operate.action.approve',
  'operate.action.execute',
  'operate.action.rollback',
]);
const AUTHORITY_TOOL_CAPABILITIES = Object.freeze({
  'operate.review.submit': Object.freeze({ id: 'operate-review-submit', version: PROTOCOL_VERSION }),
  'operate.action.approve': Object.freeze({ id: 'operate-action-approve', version: PROTOCOL_VERSION }),
  'operate.action.execute': Object.freeze({ id: 'operate-action-execute', version: PROTOCOL_VERSION }),
  'operate.action.rollback': Object.freeze({ id: 'operate-action-rollback', version: PROTOCOL_VERSION }),
});
const EFFECT_RANK = new Map([
  ['read-only', 0],
  ['machine-local-write', 1],
  ['project-write', 2],
  ['provider-call', 3],
  ['external-effect', 4],
  ['destructive', 5],
]);
const REGISTERED_ERRORS = new Map(
  OPERATE_CONTRACT_CATALOG_V2.errors.map(({ code, retryability }) => [code, retryability]),
);
const AUTHORITY_CONTEXT_FIELDS = Object.freeze([
  'actor', 'capabilities', 'actorCapabilities', 'now', 'cycle', 'review', 'reviewRequest',
  'action', 'actionRequest', 'request', 'scope', 'target', 'domainRegistration',
  'dependencyActions', 'actionPolicy', 'policyEvaluation', 'approvalRequirements', 'approvals',
  'actionPolicies',
  'capabilityAvailability', 'grant', 'operation', 'operationHistory',
  'currentPreconditionArtifactIds', 'executor', 'governedExtensions',
  'trustedExecutorBinding', 'executorInput', 'rollbackPlan', 'reconciliationProof',
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function isolateContext(context) {
  const isolated = {};
  for (const field of AUTHORITY_CONTEXT_FIELDS) {
    if (Object.hasOwn(context, field)) {
      isolated[field] = ['trustedExecutorBinding', 'executorInput'].includes(field)
        ? context[field]
        : clone(context[field]);
    }
  }
  return isolated;
}

function canonicalEqual(left, right) {
  return sha256Jcs(left) === sha256Jcs(right);
}

function sameSet(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && canonicalEqual([...left].sort(), [...right].sort());
}

function uniqueScalarSet(values) {
  return Array.isArray(values) && new Set(values).size === values.length;
}

function exactScalarSet(left, right) {
  return uniqueScalarSet(left) && uniqueScalarSet(right) && sameSet(left, right);
}

function actionIdentity(action) {
  return action && Number.isSafeInteger(action.revision)
    ? { actionId: action.actionId, revision: action.revision, actionHash: action.actionHash }
    : null;
}

function identityEqual(left, right) {
  return left !== null && right !== null && canonicalEqual(left, right);
}

function versionedIdentityEqual(left, right) {
  return left?.id === right?.id && left?.version === right?.version;
}

function targetEqual(left, right) {
  return left?.kind === right?.kind && left?.id === right?.id && left?.revision === right?.revision;
}

function policyEqual(left, right) {
  return left?.policyId === right?.policyId
    && left?.policyVersion === right?.policyVersion
    && left?.policyHash === right?.policyHash;
}

function parseTime(value) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

function hasToolCapability(context, operation) {
  const expected = AUTHORITY_TOOL_CAPABILITIES[operation];
  const capabilities = Array.isArray(context.capabilities) ? context.capabilities : [];
  if (capabilities.some((entry) => typeof entry === 'string' && (
    entry === '*' || entry === operation || entry === expected.id || entry.startsWith(`${expected.id}@`)
  ))) return false;
  return capabilities.some((entry) => (
    entry && typeof entry === 'object' && !Array.isArray(entry)
      && Object.keys(entry).length === 2 && versionedIdentityEqual(entry, expected)
  ));
}

function hasActorCapability(context, capability) {
  const entries = context.actorCapabilities ?? context.actor?.capabilities ?? [];
  return Array.isArray(entries)
    && entries.every((entry) => (
      entry && typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry).length === 2
    ))
    && entries.some((entry) => versionedIdentityEqual(entry, capability));
}

function operationEffectCeiling(operation) {
  return OPERATE_CONTRACT_CATALOG_V2.operations.find(({ id }) => id === operation)?.effect ?? null;
}

function contractValid(kind, value) {
  try {
    assertProtocolArtifact(kind, value, { protocolVersion: PROTOCOL_VERSION });
    return true;
  } catch {
    return false;
  }
}

function safeContext(operation, input = {}) {
  const allowed = ['cycleId', 'assignmentId', 'submissionId', 'submissionState', 'reviewId', 'state', 'maxBytes'];
  const context = { operation };
  for (const field of allowed) {
    if (input[field] !== undefined && input[field] !== null) context[field] = input[field];
  }
  return context;
}

function failure(operation, code, message, context = {}) {
  const registeredCode = REGISTERED_ERRORS.has(code) ? code : 'RESULT_CONTRACT_INVALID';
  return {
    code: registeredCode,
    message,
    retryable: REGISTERED_ERRORS.get(registeredCode) === 'state-derived',
    context: safeContext(operation, context),
  };
}

function decision(operation, context, {
  allowed, replayed = false, replayResultId = null, error = null, checks = [],
}) {
  const actor = context.actor && typeof context.actor === 'object'
    ? { kind: context.actor.kind ?? null, actorId: context.actor.actorId ?? null }
    : null;
  const summary = {
    kind: 'operate-authorization-decision',
    decisionVersion: AUTHORITY_DECISION_VERSION,
    operation,
    allowed,
    replayed,
    replayResultId,
    actor,
    action: actionIdentity(context.action),
    scope: context.scope ? {
      scopeId: context.scope.scopeId ?? null,
      domainId: context.scope.domainId ?? null,
      domainVersion: context.scope.domainVersion ?? null,
    } : null,
    target: context.target ? clone(context.target) : null,
    effectClass: context.action?.effectClass ?? null,
    evaluationId: context.policyEvaluation?.evaluationId ?? null,
    approvalIds: (context.approvals ?? []).map(({ approvalId }) => approvalId).sort(),
    grantId: context.grant?.grantId ?? null,
    operationId: context.operation?.operationId ?? null,
    checks: [...checks],
    error: error === null ? null : clone(error),
  };
  return deepFreeze({ ...summary, decisionHash: sha256Jcs(summary) });
}

function deniedDecision(operation, context, code, message, safe = {}, checks = []) {
  return decision(operation, context, {
    allowed: false,
    error: failure(operation, code, message, safe),
    checks,
  });
}

function validateActor(operation, context, allowedKinds, checks) {
  const actor = context.actor;
  if (!actor || typeof actor.actorId !== 'string' || !allowedKinds.includes(actor.kind)) {
    return deniedDecision(operation, context,
      operation === 'operate.review.submit' ? 'REVIEW_NOT_AUTHORIZED' : 'CAPABILITY_DENIED',
      `actor.kind is not authorized for ${operation}.`, { state: 'actor.kind' }, checks);
  }
  if (!hasToolCapability(context, operation)) {
    return deniedDecision(operation, context, 'CAPABILITY_DENIED',
      `capabilities must contain the exact ${AUTHORITY_TOOL_CAPABILITIES[operation].id}@${PROTOCOL_VERSION} identity.`,
      { state: 'capabilities' }, checks);
  }
  checks.push('actor-and-tool-capability');
  return null;
}

function evaluateReviewSubmit(context) {
  const operation = 'operate.review.submit';
  const checks = [];
  const actorFailure = validateActor(operation, context, ['human'], checks);
  if (actorFailure) return actorFailure;
  const { review, cycle } = context;
  const request = context.request ?? context.reviewRequest;
  if (!review) return deniedDecision(operation, context, 'REVIEW_NOT_FOUND', 'review is required.', {}, checks);
  if (!contractValid('operating-review', review)) {
    return deniedDecision(operation, context, 'RESULT_CONTRACT_INVALID',
      'review must satisfy operating-review@2.0.0.', { reviewId: review.reviewId, state: 'review' }, checks);
  }
  if (!cycle || !contractValid('operating-cycle', cycle) || cycle.cycleId !== review.cycleId) {
    return deniedDecision(operation, context, 'REVIEW_NOT_FOUND',
      'review.cycleId must bind its durable source Cycle.', { reviewId: review.reviewId }, checks);
  }
  if (review.state !== 'pending') {
    return deniedDecision(operation, context, 'REVIEW_NOT_PENDING',
      'Review must be pending.', { reviewId: review.reviewId, state: review.state }, checks);
  }
  if (review.subject?.type !== 'action'
    && (cycle.state !== 'awaiting_review' || cycle.activeReviewId !== review.reviewId)) {
    return deniedDecision(operation, context, 'REVIEW_NOT_FOUND',
      'A Cycle Review must be the active awaiting-review gate.', { reviewId: review.reviewId, state: 'cycle.activeReviewId' }, checks);
  }
  if (actorFailure === null && context.actor.actorId !== review.ownerActorId) {
    return deniedDecision(operation, context, 'REVIEW_NOT_AUTHORIZED',
      'actor.actorId must equal review.ownerActorId.', {
        reviewId: review.reviewId, state: 'actor.actorId',
      }, checks);
  }
  if (!request || !contractValid('operate-tool-call', {
    kind: 'operate-tool-call', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
    direction: 'request', operation, request: clone(request),
  })) {
    return deniedDecision(operation, context, 'RESULT_CONTRACT_INVALID',
      'request must contain one complete typed review disposition.', { reviewId: review.reviewId, state: 'request' }, checks);
  }
  if (request.reviewId !== review.reviewId) {
    return deniedDecision(operation, context, 'REVIEW_NOT_FOUND',
      'request.reviewId must equal review.reviewId.', { reviewId: review.reviewId, state: 'request.reviewId' }, checks);
  }
  if (request.cycleId !== cycle.cycleId
    || request.actor.actorId !== context.actor.actorId
    || request.actor.kind !== context.actor.kind
    || request.actor.runtime !== context.actor.runtime) {
    return deniedDecision(operation, context, 'REVIEW_NOT_AUTHORIZED',
      'request must retain the exact Cycle and immutable human actor identity.', {
        reviewId: review.reviewId, state: 'request.actor',
      }, checks);
  }
  if (!context.scope
    || request.scope.scopeId !== cycle.scopeId
    || request.scope.domainId !== cycle.domainId
    || request.scope.domainVersion !== cycle.domainVersion
    || request.scope.scopeId !== context.scope.scopeId
    || request.scope.domainId !== context.scope.domainId
    || request.scope.domainVersion !== context.scope.domainVersion) {
    return deniedDecision(operation, context, 'OPERATING_SCOPE_INVALID',
      'request.scope must equal the exact Review Cycle and authorization scope.', {
        reviewId: review.reviewId, state: 'request.scope',
      }, checks);
  }
  if (review.subject?.type === 'cycle' && review.subject.cycleId !== cycle.cycleId) {
    return deniedDecision(operation, context, 'REVIEW_NOT_FOUND',
      'a Cycle Review subject must equal the exact active Cycle identity.', {
        reviewId: review.reviewId, state: 'review.subject',
      }, checks);
  }
  if (review.subject?.type === 'action') {
    if (!context.action || !contractValid('operating-action', context.action)
      || !identityEqual(actionIdentity(review.subject), actionIdentity(context.action))
      || context.action.sourceCycleId !== cycle.cycleId
      || context.action.scopeId !== cycle.scopeId
      || context.action.domainId !== cycle.domainId
      || context.action.domainVersion !== cycle.domainVersion) {
      return deniedDecision(operation, context, 'ACTION_REVISION_MISMATCH',
        'an Action Review subject must bind its exact current identity, source Cycle, scope, and domain version.', {
          reviewId: review.reviewId, state: 'review.subject',
      }, checks);
    }
  }
  checks.push('review-subject-state-owner-request');
  return decision(operation, context, { allowed: true, checks });
}

function validateActionBase(operation, context, allowedStates, checks) {
  const { action } = context;
  const request = context.request ?? context.actionRequest;
  if (!action) return deniedDecision(operation, context, 'ACTION_NOT_FOUND', 'action is required.', {}, checks);
  if (!contractValid('operating-action', action)) {
    return deniedDecision(operation, context, 'RESULT_CONTRACT_INVALID',
      'action must satisfy operating-action@2.0.0.', { state: 'action' }, checks);
  }
  const requiredAuthorityFields = [
    'revisionId', 'revision', 'predecessorRevisionId', 'actionHash', 'actionKind',
    'requestedCapability', 'targetBinding', 'effectClass', 'preconditionArtifactIds', 'executionBinding',
  ];
  if (requiredAuthorityFields.some((field) => !Object.hasOwn(action, field))) {
    return deniedDecision(operation, context, 'ACTION_REVISION_MISMATCH',
      'action authority tuple is incomplete.', { state: 'action.authority' }, checks);
  }
  if (!request || !identityEqual(request.action, actionIdentity(action))) {
    return deniedDecision(operation, context, 'ACTION_REVISION_MISMATCH',
      'request.action must bind the exact current actionId, revision, and actionHash.', {
        state: 'request.action',
      }, checks);
  }
  if (allowedStates !== null && !allowedStates.includes(action.state)) {
    return deniedDecision(operation, context, 'STATE_TRANSITION_INVALID',
      `action.state ${action.state} cannot authorize ${operation}.`, { state: action.state }, checks);
  }
  const scope = context.scope;
  if (!scope || scope.scopeId !== action.scopeId || scope.domainId !== action.domainId
    || scope.domainVersion !== action.domainVersion) {
    return deniedDecision(operation, context, 'OPERATING_SCOPE_INVALID',
      'scope must bind the exact Action scopeId, domainId, and domainVersion.', { state: 'scope' }, checks);
  }
  if (!targetEqual(context.target, action.targetBinding)) {
    return deniedDecision(operation, context, 'CAPABILITY_GRANT_INVALID',
      'target must equal action.targetBinding including revision.', { state: 'target' }, checks);
  }
  if ((operation === 'operate.action.execute' || operation === 'operate.action.rollback')
    && !hasActorCapability(context, action.requestedCapability)) {
    return deniedDecision(operation, context, 'CAPABILITY_DENIED',
      'the engine actor must hold the exact versioned Action capability.', {
        state: 'actorCapabilities',
      }, checks);
  }
  if (allowedStates === null) {
    checks.push('action-identity-scope-domain-target');
    return null;
  }
  if (action.effectClass === 'destructive') {
    return deniedDecision(operation, context, 'POLICY_PROHIBITED',
      'action.effectClass destructive is prohibited.', { state: 'action.effectClass' }, checks);
  }
  for (const dependency of context.dependencyActions ?? []) {
    if (action.dependsOnActionIds.includes(dependency.actionId) && dependency.state !== 'completed') {
      return deniedDecision(operation, context, 'STATE_TRANSITION_INVALID',
        'action.dependsOnActionIds contains an incomplete dependency.', { state: 'action.dependsOnActionIds' }, checks);
    }
  }
  const knownDependencies = new Set((context.dependencyActions ?? []).map(({ actionId }) => actionId));
  if (action.dependsOnActionIds.some((id) => !knownDependencies.has(id))) {
    return deniedDecision(operation, context, 'STATE_TRANSITION_INVALID',
      'every action.dependsOnActionIds entry must be supplied and completed.', { state: 'action.dependsOnActionIds' }, checks);
  }
  if ((operation === 'operate.action.execute' || operation === 'operate.action.rollback')
    && EFFECT_RANK.get(action.effectClass) > EFFECT_RANK.get(operationEffectCeiling(operation))) {
    return deniedDecision(operation, context, 'CAPABILITY_DENIED',
      'the Action effect exceeds the compiler-owned operation effect ceiling.', {
        state: 'action.effectClass',
      }, checks);
  }
  checks.push('action-identity-state-scope-domain-target-effect');
  return null;
}

function validateDomainNarrowing(operation, context, checks) {
  const registration = context.domainRegistration;
  if (registration === undefined) return null;
  if (!contractValid('operate-domain-registration', registration)
    || registration.domainId !== context.action.domainId
    || registration.domainVersion !== context.action.domainVersion) {
    return deniedDecision(operation, context, 'DOMAIN_CONTRACT_UNSUPPORTED',
      'domainRegistration must match the Action domain exactly.', { state: 'domainRegistration' }, checks);
  }
  if (registration.actionKinds && !registration.actionKinds.some((entry) => versionedIdentityEqual(entry, context.action.actionKind))) {
    return deniedDecision(operation, context, 'DOMAIN_CONTRACT_UNSUPPORTED',
      'domainRegistration.actionKinds does not declare the exact Action kind.', { state: 'domainRegistration.actionKinds' }, checks);
  }
  if (registration.requestedCapabilities
    && !registration.requestedCapabilities.some((entry) => versionedIdentityEqual(entry, context.action.requestedCapability))) {
    return deniedDecision(operation, context, 'CAPABILITY_UNAVAILABLE',
      'domainRegistration.requestedCapabilities does not declare the exact requested capability.', {
        state: 'domainRegistration.requestedCapabilities',
      }, checks);
  }
  const requirements = registration.policyRequirements ?? [];
  if (requirements.length > 0 && !requirements.some((entry) => (
    versionedIdentityEqual(entry.actionKind, context.action.actionKind)
    && versionedIdentityEqual(entry.capability, context.action.requestedCapability)
    && entry.policy.id === context.action.executionBinding.policyId
    && entry.policy.version === context.action.executionBinding.policyVersion
  ))) {
    return deniedDecision(operation, context, 'POLICY_EVALUATION_REJECTED',
      'domainRegistration.policyRequirements narrows away the Action policy binding.', {
        state: 'domainRegistration.policyRequirements',
      }, checks);
  }
  checks.push('domain-registration-narrowing-only');
  return null;
}

function validatePolicy(operation, context, checks, nowMs) {
  const { action, actionPolicy: policy, policyEvaluation: evaluation } = context;
  if (!policy || !contractValid('operating-action-policy', policy)
    || !evaluation || !contractValid('operating-policy-evaluation', evaluation)) {
    return deniedDecision(operation, context, 'POLICY_EVALUATION_REJECTED',
      'actionPolicy and policyEvaluation must be contract-valid exact authority records.', {
        state: 'policyEvaluation',
      }, checks);
  }
  if (!Array.isArray(context.actionPolicies) || context.actionPolicies.length === 0) {
    return deniedDecision(operation, context, 'POLICY_EVALUATION_REJECTED',
      'actionPolicies must contain the complete configured policy registry.', {
        state: 'actionPolicies',
      }, checks);
  }
  const policyRef = {
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    policyHash: policy.policyHash,
  };
  try {
    assertOperatingActionPolicyV2(policy);
    const canonical = assertOperatingPolicyEvaluationV2(evaluation, {
      action,
      configuredPolicies: context.actionPolicies,
    });
    if (!policyEqual(canonical.policy, policyRef)
      || parseTime(canonical.evaluatedAt) === null
      || parseTime(canonical.evaluatedAt) > nowMs) {
      return deniedDecision(operation, context, 'POLICY_EVALUATION_REJECTED',
        'actionPolicy must be the exact effective configured policy at the explicit decision time.', {
          state: 'policyEvaluation.binding',
        }, checks);
    }
  } catch (error) {
    return deniedDecision(operation, context, error.code ?? 'POLICY_EVALUATION_REJECTED',
      error.message, { state: 'policyEvaluation.precedence' }, checks);
  }
  if (evaluation.outcome === 'prohibited') {
    return deniedDecision(operation, context, 'POLICY_PROHIBITED',
      'policyEvaluation.outcome prohibits the operation.', { state: 'policyEvaluation.outcome' }, checks);
  }
  if (evaluation.outcome === 'rejected') {
    return deniedDecision(operation, context, 'POLICY_EVALUATION_REJECTED',
      'policyEvaluation.outcome rejects the operation.', { state: 'policyEvaluation.outcome' }, checks);
  }
  if (evaluation.outcome === 'deferred') {
    return deniedDecision(operation, context, 'POLICY_EVALUATION_DEFERRED',
      'policyEvaluation.outcome defers the operation.', { state: 'policyEvaluation.outcome' }, checks);
  }
  checks.push('policy-exact-current-nonwidening');
  return null;
}

function validateApprovalAction(operation, context, checks, nowMs) {
  const request = context.request ?? context.actionRequest;
  if (!['approved', 'rejected', 'deferred'].includes(request.decision)) {
    return deniedDecision(operation, context, 'APPROVAL_INVALID',
      'request.decision must be approved, rejected, or deferred.', { state: 'request.decision' }, checks);
  }
  const evaluation = context.policyEvaluation;
  if (evaluation.outcome === 'automatic') {
    if (evaluation.approvalRequirementIds.length !== 0
      || (context.approvalRequirements ?? []).length !== 0
      || (context.approvals ?? []).length !== 0) {
      return deniedDecision(operation, context, 'APPROVAL_INVALID',
        'automatic policy authority has an exact empty requirement and approval set.', {
          state: 'approvalRequirements',
        }, checks);
    }
    if (context.actor.kind !== 'engine') {
      return deniedDecision(operation, context, 'REVIEW_NOT_AUTHORIZED',
        'automatic policy decisions may be recorded only by the engine.', { state: 'actor.kind' }, checks);
    }
    checks.push('automatic-approval-engine');
    return null;
  }
  const requirements = context.approvalRequirements ?? [];
  const requirementIds = requirements.map(({ requirementId }) => requirementId);
  const requirementById = new Map(requirements.map((item) => [item.requirementId, item]));
  if (!exactScalarSet(requirementIds, evaluation.approvalRequirementIds)) {
    return deniedDecision(operation, context, 'APPROVAL_INVALID',
      'approvalRequirements must be the exact unique applicable policy set.', {
        state: 'approvalRequirements',
      }, checks);
  }
  const approvalIds = (context.approvals ?? []).map(({ approvalId }) => approvalId);
  if (!uniqueScalarSet(approvalIds)) {
    return deniedDecision(operation, context, 'APPROVAL_INVALID',
      'approval records must have unique identities.', { state: 'approvals' }, checks);
  }
  try {
    evaluateOperatingApprovalSetV2({
      evaluation,
      action: context.action,
      requirements,
      approvals: context.approvals ?? [],
      now: context.now,
    });
  } catch (error) {
    return deniedDecision(operation, context, error.code ?? 'APPROVAL_INVALID',
      error.message, { state: 'approvalRecord.canonical' }, checks);
  }
  for (const requirementId of evaluation.approvalRequirementIds) {
    const requirement = requirementById.get(requirementId);
    if (!requirement) continue;
    const requirementExpiry = requirement.expiresAt === null ? null : parseTime(requirement.expiresAt);
    if (requirementExpiry !== null && requirementExpiry <= nowMs) continue;
    const eligibleParty = requirement.parties.find((party) => (
      party.actorKind === context.actor.kind
      && (party.actorId === null || party.actorId === context.actor.actorId)
      && hasActorCapability(context, party.requiredCapability)
    ));
    if (!eligibleParty) continue;
    const existing = (context.approvals ?? []).find((record) => (
      (record.requirementId === requirement.requirementId && record.partyId === eligibleParty.partyId)
      || (record.actor?.kind === context.actor.kind && record.actor?.actorId === context.actor.actorId)
    ));
    if (existing) {
      return deniedDecision(operation, context, 'APPROVAL_INVALID',
        'the named party or actor already has an approval record for this requirement.', {
          state: 'approval.partyId',
        }, checks);
    }
    checks.push('approval-party-capability-exact');
    return null;
  }
  return deniedDecision(operation, context, 'APPROVAL_REQUIRED',
    'actor does not satisfy an unsatisfied exact approval party.', { state: 'approvalRequirements' }, checks);
}

function validateApprovalSet(operation, context, checks) {
  const evaluation = context.policyEvaluation;
  try {
    const result = evaluateOperatingApprovalSetV2({
      evaluation,
      action: context.action,
      requirements: context.approvalRequirements ?? [],
      approvals: context.approvals ?? [],
      now: context.now,
    });
    if (!result.complete || result.disposition !== 'approved') {
      return deniedDecision(operation, context, 'APPROVAL_REQUIRED',
        'the exact current approval set is incomplete or not approved.', { state: result.reasonCode }, checks);
    }
    checks.push('approval-set-canonical-ledger');
    return null;
  } catch (error) {
    return deniedDecision(operation, context, error.code ?? 'APPROVAL_INVALID',
      error.message, { state: 'approvalRecord.canonical' }, checks);
  }
}

function validateOperationBinding(operationName, context, checks, { live = true, nowMs = null } = {}) {
  const { action, operation, policyEvaluation: evaluation } = context;
  const operationKind = operationName === 'operate.action.rollback' ? 'rollback' : 'execute';
  if (!operation || !contractValid('operating-governed-operation', operation)) {
    return deniedDecision(operationName, context, 'OPERATION_CONFLICT',
      'operation must be a valid runtime-issued governed operation.', { state: 'operation' }, checks);
  }
  if (operation.operationKind !== operationKind
    || !identityEqual(operation.action, actionIdentity(action))
    || !versionedIdentityEqual(operation.capability, action.requestedCapability)
    || !targetEqual(operation.target, action.targetBinding)
    || operation.effectClass !== action.effectClass
    || (operationKind === 'execute' && operation.verificationPlanId !== action.verificationPlanId)
    || (live && operationKind === 'rollback'
      && operation.verificationPlanId !== context.rollbackPlan?.verificationPlanId)) {
    return deniedDecision(operationName, context, 'OPERATION_CONFLICT',
      'operation must bind the exact kind, Action, policy, capability, target, effect, and verification plan.', {
        state: 'operation.binding',
      }, checks);
  }
  const approvedInputArtifactIds = [...new Set([
    action.sourceArtifactId,
    ...action.preconditionArtifactIds,
  ])];
  const rollbackClassificationValid = action.executionBinding.rollbackRequired
    ? operation.rollbackClass !== 'not-applicable'
    : operation.rollbackClass === 'not-applicable';
  if (!exactScalarSet(operation.preconditionArtifactIds, action.preconditionArtifactIds)
    || !exactScalarSet(operation.inputArtifactIds, approvedInputArtifactIds)
    || !rollbackClassificationValid) {
    return deniedDecision(operationName, context, 'OPERATION_CONFLICT',
      'operation connector, reviewed inputs, preconditions, and rollback classification must be closed and exact.', {
        state: 'operation.envelope',
      }, checks);
  }
  if (operation.connector !== null
    && (context.trustedExecutorBinding === undefined || context.trustedExecutorBinding === null)) {
    return deniedDecision(operationName, context, 'OPERATION_CONFLICT',
      'a connected operation requires one explicit trusted-host binding before live executor validation.', {
        state: 'operation.connector',
      }, checks);
  }
  if (operation.connector !== null) {
    try {
      assertContainedExecutorInputEnvelopeV2(context.executorInput, {
        operation,
        rollbackPlan: context.rollbackPlan ?? null,
      });
    } catch {
      return deniedDecision(operationName, context, 'OPERATION_CONFLICT',
        'a connected operation requires one exact payload-bound executor input envelope.', {
          state: 'operation.executorInput',
        }, checks);
    }
  } else if (context.executorInput !== undefined && context.executorInput !== null) {
    return deniedDecision(operationName, context, 'OPERATION_CONFLICT',
      'a connectorless operation cannot carry a contained executor input envelope.', {
        state: 'operation.executorInput',
      }, checks);
  }
  if (operationKind === 'rollback') {
    const request = context.request ?? context.actionRequest;
    if (operation.parentOperationId !== request?.originalOperationId
      || operation.rollbackPlanId !== request?.rollbackPlanId) {
      return deniedDecision(operationName, context, 'OPERATION_CONFLICT',
        'rollback operation identity must equal the exact request references.', {
          state: 'operation.rollback',
        }, checks);
    }
  }
  const operationCreatedAt = parseTime(operation.createdAt);
  const operationUpdatedAt = parseTime(operation.updatedAt);
  if (operationCreatedAt === null || operationUpdatedAt === null
    || operationCreatedAt > operationUpdatedAt || operationUpdatedAt > nowMs
    || (live && operation.evaluationId !== evaluation?.evaluationId)) {
    return deniedDecision(operationName, context, 'OPERATION_CONFLICT',
      'operation must bind the current evaluation and have causal runtime timestamps.', {
        state: 'operation.time',
      }, checks);
  }
  checks.push('operation-binding-exact');
  return null;
}

function replayDecision(operationName, context, checks, nowMs) {
  const operation = context.operation;
  const grant = context.grant;
  const history = context.operationHistory ?? [];
  const historyIds = history.map(({ operationId }) => operationId);
  if (!uniqueScalarSet(historyIds)) {
    return deniedDecision(operationName, context, 'OPERATION_CONFLICT',
      'operation history contains duplicate operation identities.', { state: 'operationHistory.operationId' }, checks);
  }
  const matches = history.filter((entry) => entry.operationId === operation.operationId);
  if (matches.length === 0) return null;
  const [entry] = matches;
  const immutableFields = [
    'operationId', 'operationKind', 'action', 'assignmentId', 'requestFingerprint', 'evaluationId',
    'approvalIds', 'grantId', 'capability', 'target', 'effectClass', 'executor', 'connector',
    'preconditionArtifactIds', 'inputArtifactIds', 'verificationPlanId', 'rollbackClass',
    'intentEventId', 'rollbackPlanId', 'parentOperationId', 'createdAt',
  ];
  const exact = contractValid('operating-governed-operation', entry)
    && immutableFields.every((field) => canonicalEqual(entry[field], operation[field]))
    && identityEqual(entry.action, actionIdentity(context.action))
    && parseTime(entry.createdAt) !== null
    && parseTime(entry.updatedAt) !== null
    && parseTime(entry.createdAt) <= parseTime(entry.updatedAt)
    && parseTime(entry.updatedAt) <= nowMs;
  if (!exact) {
    return deniedDecision(operationName, context, 'OPERATION_CONFLICT',
      'operationId was reused with a divergent or incomplete durable operation envelope.', {
        state: 'operationHistory.requestFingerprint',
      }, checks);
  }
  const grantIssuedAt = parseTime(grant?.issuedAt);
  const grantExpiresAt = parseTime(grant?.expiresAt);
  const grantConsumedAt = grant?.consumedAt === null ? null : parseTime(grant?.consumedAt);
  const grantRevokedAt = grant?.revokedAt === null ? null : parseTime(grant?.revokedAt);
  const operationCreatedAt = parseTime(operation.createdAt);
  if (!grant || !contractValid('operating-capability-grant', grant)
    || operation.grantId !== grant.grantId
    || grant.operationId !== operation.operationId
    || grant.assignmentId !== operation.assignmentId
    || grant.evaluationId !== operation.evaluationId
    || !identityEqual(grant.action, operation.action)
    || !identityEqual(grant.action, actionIdentity(context.action))
    || !exactScalarSet(grant.approvalIds, operation.approvalIds)
    || !versionedIdentityEqual(grant.capability, operation.capability)
    || !versionedIdentityEqual(grant.capability, context.action.requestedCapability)
    || !targetEqual(grant.target, operation.target)
    || !targetEqual(grant.target, context.action.targetBinding)
    || grant.effectClass !== operation.effectClass
    || grant.effectClass !== context.action.effectClass
    || grant.issuer.id !== context.actor.actorId
    || grant.useLimit !== 1
    || grantIssuedAt === null
    || grantExpiresAt === null
    || grantIssuedAt >= grantExpiresAt
    || (grant?.consumedAt !== null && (
      grantConsumedAt === null || grantConsumedAt < grantIssuedAt || grantConsumedAt > nowMs
    ))
    || (grant?.revokedAt !== null && (
      grantRevokedAt === null || grantRevokedAt < grantIssuedAt || grantRevokedAt > nowMs
    ))
    || operationCreatedAt === null
    || operationCreatedAt >= grantExpiresAt
    || (grant?.consumedAt !== null && grantConsumedAt < operationCreatedAt)
    || (grant?.revokedAt !== null && grantRevokedAt <= operationCreatedAt)
    || grantIssuedAt > operationCreatedAt) {
    return deniedDecision(operationName, context, 'CAPABILITY_GRANT_INVALID',
      'terminal replay requires the exact durable historical grant and original issuer binding.', {
        assignmentId: operation.assignmentId, state: 'grant.replayBinding',
      }, checks);
  }
  const terminalState = ['succeeded', 'failed', 'partial', 'uncertain', 'blocked', 'cancelled', 'rolled-back'].includes(entry.state);
  if (terminalState && entry.resultId !== null) {
    checks.push('durable-operation-replay');
    return decision(operationName, context, {
      allowed: true, replayed: true, replayResultId: entry.resultId, checks,
    });
  }
  const proof = context.reconciliationProof;
  const proofHash = proof && sha256Jcs(Object.fromEntries(
    Object.entries(proof).filter(([field]) => field !== 'reconciliationHash'),
  ));
  if (entry.state === 'dispatching'
    && proof?.kind === 'operating-reconciliation-proof'
    && proof?.schemaVersion === '1.0.0'
    && proof?.protocolVersion === PROTOCOL_VERSION
    && proof?.classification === 'not-applied'
    && proof?.operationId === entry.operationId
    && proof?.requestFingerprint === entry.requestFingerprint
    && proof?.executor?.executorId === entry.executor.executorId
    && proof?.executor?.executorVersion === entry.executor.executorVersion
    && proof?.reconciliationHash === proofHash
    && context.executor?.reconciliation?.supported === true
    && context.executor?.reconciliation?.mode === 'deterministic'
    && context.executor?.operationKinds?.includes(entry.operationKind)) {
    checks.push('deterministic-reconciliation-proved-not-applied');
    checks.push('executor-exact-healthy-contained-ceiling');
    checks.push('trusted-executor-connector-binding');
    return decision(operationName, context, { allowed: true, replayed: false, checks });
  }
  return deniedDecision(operationName, context, 'OPERATION_CONFLICT',
    'operationId already has non-terminal durable history.', { state: entry.state ?? 'operationHistory' }, checks);
}

function validateCapability(operationName, context, checks, nowMs) {
  const { action, capabilityAvailability: availability, grant, operation } = context;
  if (!availability || !contractValid('operating-capability-availability', availability)
    || !versionedIdentityEqual(availability.capability, action.requestedCapability)
    || !targetEqual(availability.target, action.targetBinding)) {
    return deniedDecision(operationName, context, 'CAPABILITY_UNAVAILABLE',
      'capabilityAvailability must bind the exact capability and target.', {
        state: 'capabilityAvailability.binding',
      }, checks);
  }
  const availabilityCheckedAt = parseTime(availability?.checkedAt);
  const availabilityExpiresAt = parseTime(availability?.expiresAt);
  if (availability.status !== 'available'
    || availabilityCheckedAt === null || availabilityCheckedAt > nowMs
    || availabilityExpiresAt === null || availabilityExpiresAt <= nowMs) {
    return deniedDecision(operationName, context, 'CAPABILITY_UNAVAILABLE',
      'capabilityAvailability must be available and unexpired.', {
        state: 'capabilityAvailability.status',
      }, checks);
  }
  if (EFFECT_RANK.get(availability.effectCeiling) < EFFECT_RANK.get(action.effectClass)) {
    return deniedDecision(operationName, context, 'CAPABILITY_UNAVAILABLE',
      'capabilityAvailability.effectCeiling cannot cover action.effectClass.', {
        state: 'capabilityAvailability.effectCeiling',
      }, checks);
  }
  const scopeHashes = [...new Set((context.approvalRequirements ?? []).map(({ scopeHash }) => scopeHash))];
  const expectedScopeHash = scopeHashes.length === 1 ? scopeHashes[0] : null;
  if (!grant || !contractValid('operating-capability-grant', grant)
    || grant.operationId !== operation.operationId
    || grant.assignmentId !== operation.assignmentId
    || grant.evaluationId !== context.policyEvaluation.evaluationId
    || !identityEqual(grant.action, actionIdentity(action))
    || !versionedIdentityEqual(grant.capability, action.requestedCapability)
    || !targetEqual(grant.target, action.targetBinding)
    || grant.effectClass !== action.effectClass
    || grant.issuer.id !== context.actor.actorId
    || (context.policyEvaluation.outcome !== 'automatic'
      && (expectedScopeHash === null || grant.scopeHash !== expectedScopeHash))) {
    return deniedDecision(operationName, context, 'CAPABILITY_GRANT_INVALID',
      'grant must bind the exact operation, Assignment, Action, policy, approvals, capability, target, effect, and scope.', {
        assignmentId: operation.assignmentId, state: 'grant.binding',
      }, checks);
  }
  const approvalIds = (context.approvals ?? []).map(({ approvalId }) => approvalId);
  if (!exactScalarSet(grant.approvalIds, approvalIds) || !exactScalarSet(operation.approvalIds, approvalIds)
    || operation.grantId !== grant.grantId || grant.useLimit !== 1) {
    return deniedDecision(operationName, context, 'CAPABILITY_GRANT_INVALID',
      'grant and operation must bind the exact approval set and one-use ceiling.', {
        assignmentId: operation.assignmentId, state: 'grant.approvalIds',
      }, checks);
  }
  const evaluatedAt = parseTime(context.policyEvaluation.evaluatedAt);
  const approvalTimes = (context.approvals ?? []).map(({ issuedAt }) => parseTime(issuedAt));
  const latestApprovalAt = approvalTimes.length === 0 ? evaluatedAt : Math.max(...approvalTimes);
  const grantIssuedAt = parseTime(grant.issuedAt);
  const grantExpiresAt = parseTime(grant.expiresAt);
  const operationCreatedAt = parseTime(operation.createdAt);
  if (grant.revokedAt !== null || evaluatedAt === null || latestApprovalAt === null
    || grantIssuedAt === null || grantIssuedAt < latestApprovalAt
    || operationCreatedAt === null || operationCreatedAt < grantIssuedAt || operationCreatedAt > nowMs
    || grantExpiresAt === null || grantExpiresAt <= nowMs) {
    return deniedDecision(operationName, context, 'CAPABILITY_GRANT_INVALID',
      'policy, approvals, grant, operation, and decision time must be causal; the grant must be current and not revoked.', {
        assignmentId: operation.assignmentId, state: 'grant.time',
      }, checks);
  }
  if (grant.consumedAt !== null) {
    return deniedDecision(operationName, context, 'CAPABILITY_GRANT_CONSUMED',
      'grant has already been consumed.', { assignmentId: operation.assignmentId, state: 'grant.consumedAt' }, checks);
  }
  checks.push('capability-availability-grant-expiry-usage');
  return null;
}

function validatePreconditions(operationName, context, checks) {
  const expected = context.action.preconditionArtifactIds;
  const current = context.currentPreconditionArtifactIds;
  if (!sameSet(context.operation.preconditionArtifactIds, expected)
    || !sameSet(current, expected)) {
    return deniedDecision(operationName, context, 'CAPABILITY_GRANT_INVALID',
      'currentPreconditionArtifactIds must equal the exact Action and operation precondition set.', {
        assignmentId: context.operation.assignmentId, state: 'preconditionArtifactIds',
      }, checks);
  }
  checks.push('target-preconditions-current');
  return null;
}

function validateExecutor(operationName, context, checks, nowMs) {
  const { action, executor, operation } = context;
  const operationKind = operationName === 'operate.action.rollback' ? 'rollback' : 'execute';
  let registeredExecutor = null;
  try {
    registeredExecutor = assertOperateExecutorRegistrationV2(executor, {
      registry: context.governedExtensions,
    });
  } catch {
    registeredExecutor = null;
  }
  if (!executor || !contractValid('operate-executor-registration', executor)
    || registeredExecutor === null
    || executor.executorId !== operation.executor.executorId
    || executor.executorVersion !== operation.executor.executorVersion) {
    return deniedDecision(operationName, context, 'EXECUTOR_UNAVAILABLE',
      'executor must be the exact contract-valid registration bound by the operation.', {
        assignmentId: operation.assignmentId, state: 'executor.binding',
      }, checks);
  }
  if (executor.health.status !== 'available'
    || parseTime(executor.health.checkedAt) === null || parseTime(executor.health.checkedAt) > nowMs
    || parseTime(executor.health.expiresAt) === null || parseTime(executor.health.expiresAt) <= nowMs
    || !executor.operationKinds.includes(operationKind)
    || !executor.capabilities.some((entry) => versionedIdentityEqual(entry, action.requestedCapability))
    || !executor.supportedActionKinds.some((entry) => versionedIdentityEqual(entry, action.actionKind))
    || !executor.supportedDomains.includes(action.domainId)
    || !executor.supportedTargetKinds.includes(action.targetBinding.kind)
    || EFFECT_RANK.get(executor.effectCeiling) < EFFECT_RANK.get(action.effectClass)) {
    return deniedDecision(operationName, context, 'EXECUTOR_UNAVAILABLE',
      'executor health, operation kind, capability, Action, domain, target, or effect ceiling is insufficient.', {
        assignmentId: operation.assignmentId, state: 'executor.ceiling',
      }, checks);
  }
  if (operation.connector === null) {
    if (context.trustedExecutorBinding !== undefined && context.trustedExecutorBinding !== null) {
      return deniedDecision(operationName, context, 'EXECUTOR_UNAVAILABLE',
        'a connectorless operation cannot carry a trusted connector binding.', {
          assignmentId: operation.assignmentId, state: 'executor.connector',
        }, checks);
    }
  } else {
    try {
      const binding = assertTrustedExecutorBindingV2(context.trustedExecutorBinding, { executor });
      if (!versionedIdentityEqual(binding.connector, operation.connector)) throw new Error('connector mismatch');
    } catch {
      return deniedDecision(operationName, context, 'EXECUTOR_UNAVAILABLE',
        'a connected operation requires the exact host-owned connector binding beneath the selected Executor.', {
          assignmentId: operation.assignmentId, state: 'executor.connector',
        }, checks);
    }
  }
  checks.push('executor-exact-healthy-contained-ceiling');
  checks.push('trusted-executor-connector-binding');
  return null;
}

function validateRollback(operationName, context, checks, nowMs) {
  if (operationName !== 'operate.action.rollback') return null;
  const request = context.request ?? context.actionRequest;
  const { rollbackPlan, operation } = context;
  if (!rollbackPlan || !contractValid('operating-rollback-plan', rollbackPlan)
    || request.originalOperationId !== rollbackPlan.operationId
    || request.rollbackPlanId !== rollbackPlan.rollbackPlanId
    || operation.parentOperationId !== rollbackPlan.operationId
    || operation.rollbackPlanId !== rollbackPlan.rollbackPlanId
    || !identityEqual(rollbackPlan.action, actionIdentity(context.action))
    || !versionedIdentityEqual(rollbackPlan.capability, context.action.requestedCapability)
    || rollbackPlan.effectClass !== context.action.effectClass
    || rollbackPlan.executor.executorId !== operation.executor.executorId
    || rollbackPlan.executor.executorVersion !== operation.executor.executorVersion) {
    return deniedDecision(operationName, context, 'ROLLBACK_NOT_ELIGIBLE',
      'rollbackPlan and request must bind the exact original operation, Action, capability, effect, and executor.', {
        assignmentId: operation.assignmentId, state: 'rollbackPlan.binding',
      }, checks);
  }
  if (!isOperatingRollbackEligibilityV2(rollbackPlan.eligibility) || parseTime(rollbackPlan.expiresAt) <= nowMs) {
    return deniedDecision(operationName, context, 'ROLLBACK_NOT_ELIGIBLE',
      'rollbackPlan must be eligible and unexpired.', {
        assignmentId: operation.assignmentId, state: 'rollbackPlan.eligibility',
      }, checks);
  }
  const originalMatches = (context.operationHistory ?? [])
    .filter(({ operationId }) => operationId === rollbackPlan.operationId);
  const [original] = originalMatches;
  if (originalMatches.length !== 1 || !contractValid('operating-governed-operation', original)
    || !['succeeded', 'partial'].includes(original.state)
    || original.resultId !== rollbackPlan.executionResultId
    || original.operationKind !== 'execute'
    || original.rollbackClass !== operation.rollbackClass
    || !identityEqual(original.action, actionIdentity(context.action))) {
    return deniedDecision(operationName, context, 'ROLLBACK_NOT_ELIGIBLE',
      'operationHistory must contain the exact successful or partial original operation result.', {
        assignmentId: operation.assignmentId, state: 'operationHistory.originalOperationId',
      }, checks);
  }
  checks.push('rollback-plan-exact-current');
  return null;
}

function evaluateActionOperation(operationName, context) {
  const checks = [];
  const allowedKinds = operationName === 'operate.action.approve' ? ['human', 'engine'] : ['engine'];
  const actorFailure = validateActor(operationName, context, allowedKinds, checks);
  if (actorFailure) return actorFailure;
  const states = operationName === 'operate.action.approve'
    ? ['proposed']
    : operationName === 'operate.action.execute'
      ? ['approved', 'blocked']
      : ['approved', 'completed', 'in_progress', 'blocked'];
  if (operationName === 'operate.action.approve') {
    const actionFailure = validateActionBase(operationName, context, states, checks);
    if (actionFailure) return actionFailure;
  } else {
    const identityFailure = validateActionBase(operationName, context, null, checks);
    if (identityFailure) return identityFailure;
  }
  const nowMs = parseTime(context.now);
  if (nowMs === null) {
    return deniedDecision(operationName, context, 'RESULT_CONTRACT_INVALID',
      'now must be an explicit valid timestamp.', { state: 'now' }, checks);
  }
  checks.push('explicit-decision-time');
  if (operationName !== 'operate.action.approve') {
    const replayOperationFailure = validateOperationBinding(operationName, context, checks, { live: false, nowMs });
    if (replayOperationFailure) return replayOperationFailure;
    const replay = replayDecision(operationName, context, checks, nowMs);
    if (replay) return replay;
  }
  if (operationName !== 'operate.action.approve') {
    const actionFailure = validateActionBase(operationName, context, states, checks);
    if (actionFailure) return actionFailure;
  }
  const domainFailure = validateDomainNarrowing(operationName, context, checks);
  if (domainFailure) return domainFailure;
  const policyFailure = validatePolicy(operationName, context, checks, nowMs);
  if (policyFailure) return policyFailure;
  if (operationName === 'operate.action.approve') {
    const approvalFailure = validateApprovalAction(operationName, context, checks, nowMs);
    return approvalFailure ?? decision(operationName, context, { allowed: true, checks });
  }
  const operationFailure = validateOperationBinding(operationName, context, checks, { live: true, nowMs });
  if (operationFailure) return operationFailure;
  const approvalFailure = validateApprovalSet(operationName, context, checks);
  if (approvalFailure) return approvalFailure;
  const capabilityFailure = validateCapability(operationName, context, checks, nowMs);
  if (capabilityFailure) return capabilityFailure;
  const preconditionFailure = validatePreconditions(operationName, context, checks);
  if (preconditionFailure) return preconditionFailure;
  const executorFailure = validateExecutor(operationName, context, checks, nowMs);
  if (executorFailure) return executorFailure;
  const rollbackFailure = validateRollback(operationName, context, checks, nowMs);
  if (rollbackFailure) return rollbackFailure;
  return decision(operationName, context, { allowed: true, checks });
}

/**
 * Evaluate one governance operation using only explicit immutable data. The
 * function has no model, provider, connector, executor, target, clock, or I/O
 * callback and therefore cannot cross an effect boundary while deciding.
 */
export function evaluateOperateAuthorityV2(operation, context = {}) {
  if (!GOVERNED_OPERATIONS.has(operation)) {
    return deniedDecision(operation, context, 'CONTRACT_VERSION_UNSUPPORTED',
      `operation ${operation} is not governed by authorization-v2.`, { state: 'operation' });
  }
  const isolated = isolateContext(context);
  return operation === 'operate.review.submit'
    ? evaluateReviewSubmit(isolated)
    : evaluateActionOperation(operation, isolated);
}

export function assertOperateAuthorityV2(operation, context = {}) {
  const result = evaluateOperateAuthorityV2(operation, context);
  if (!result.allowed) {
    throw new PipelineError(result.error.code, result.error.message, '', {
      retryable: result.error.retryable,
      context: clone(result.error.context),
    });
  }
  return result;
}

export function assertOperatingActionAuthorityTupleV2(action) {
  const fields = [
    'revisionId', 'revision', 'predecessorRevisionId', 'actionHash', 'actionKind',
    'requestedCapability', 'targetBinding', 'effectClass', 'preconditionArtifactIds', 'executionBinding',
  ];
  if (!contractValid('operating-action', action) || fields.some((field) => !Object.hasOwn(action, field))) {
    throw new PipelineError('ACTION_REVISION_MISMATCH', 'Action lacks a complete contract-valid authority tuple.', '', {
      retryable: false,
      context: { state: 'action.authority' },
    });
  }
  return deepFreeze(clone(action));
}

export function getOperateAuthorityArgumentCandidatesV2(operation, context = {}) {
  const action = actionIdentity(context.action);
  if (operation === 'operate.review.submit') {
    if (context.reviewRequest) return [clone(context.reviewRequest)];
    // Cycle Review work dispositions are target-bound and can be derived only
    // from the exact current durable Finding/Decision/Action set. The owner
    // read service advertises those complete choices; this generic authority
    // helper must never synthesize an incomplete or over-broad submission.
    return [];
  }
  if (action === null) return [];
  if (operation === 'operate.action.approve') {
    if (context.actionRequest) return [clone(context.actionRequest)];
    return ['approved', 'rejected', 'deferred'].map((approvalDecision) => ({
      action: clone(action), decision: approvalDecision,
    }));
  }
  if (operation === 'operate.action.execute') {
    return [context.actionRequest ? clone(context.actionRequest) : { action: clone(action) }];
  }
  if (operation === 'operate.action.rollback') {
    if (context.actionRequest) return [clone(context.actionRequest)];
    if (!context.rollbackPlan) return [];
    return [{
      action: clone(action),
      originalOperationId: context.rollbackPlan.operationId,
      rollbackPlanId: context.rollbackPlan.rollbackPlanId,
    }];
  }
  return [];
}

export function deriveOperateAuthorityAllowedActionsV2(context = {}) {
  const labels = new Map(OPERATE_CONTRACT_CATALOG_V2.actions.map(({ operationId, label }) => [operationId, label]));
  const effects = new Map(OPERATE_CONTRACT_CATALOG_V2.operations.map(({ id, effect }) => [id, effect]));
  const result = [];
  for (const operation of GOVERNED_OPERATIONS) {
    for (const request of getOperateAuthorityArgumentCandidatesV2(operation, context)) {
      const candidateContext = operation === 'operate.review.submit'
        ? { ...context, reviewRequest: request, request }
        : { ...context, actionRequest: request, request };
      if (!evaluateOperateAuthorityV2(operation, candidateContext).allowed) continue;
      result.push({ tool: operation, arguments: clone(request), label: labels.get(operation), effect: effects.get(operation) });
    }
  }
  return deepFreeze(result);
}

export const OPERATE_AUTHORITY_DECISION_VERSION_V2 = AUTHORITY_DECISION_VERSION;
export const OPERATE_AUTHORITY_TOOL_CAPABILITIES_V2 = AUTHORITY_TOOL_CAPABILITIES;
