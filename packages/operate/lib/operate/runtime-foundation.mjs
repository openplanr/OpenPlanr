import { createHash } from 'node:crypto';

import {
  appendOperatingApprovalRecordV2,
  assertOperatingActionPolicyV2,
  assertOperatingApprovalRecordV2,
  assertOperatingApprovalRequirementIntegrityV2,
  assertOperatingApprovalRequirementSetIntegrityV2,
  assertOperatingApprovalRequirementV2,
  assertOperatingPolicyEvaluationV2,
  assertOperatingRollbackPolicyV2,
  assertPersistentOperatingActionAuthorityV2,
  buildPersistentWorkMaterializationPayloadV2,
  evaluateOperateAuthorityV2,
  evaluateOperatingApprovalSetV2,
  getOperateAuthorityArgumentCandidatesV2,
  isOperatingRollbackEligibilityV2,
  promotePersistentOperatingActionAuthorityV2,
} from './runtime-foundation/authority.mjs';
import { createAuthorityRuntimeEventHandlerV2 } from './runtime-foundation/authority-events.mjs';
import {
  assertOperatingSnapshotV2,
  buildOperatingEvidenceMaterializationV2,
  buildOperatingSnapshotStateTransactionV2,
  classifyOperatingDeltaMaterialityV2,
  deriveOperatingDeltaV2,
  deriveOperatingEvidenceRequestHashV2,
  readOperatingArtifactRawBytesV2,
  setOperatingEvidenceMaterializationBlobV2,
  stageOperatingEvidenceMaterializationBlobV2,
  validateOperatingEvidenceSourcePayloadV2,
} from './runtime-foundation/evidence-state.mjs';
import { createEvidenceStateRuntimeEventHandlerV2 } from './runtime-foundation/evidence-state-events.mjs';
import {
  assertOperatingReviewBoundSubmissionV1,
  buildOperatingActionVerificationMaterializationV2,
  buildOperatingActionVerificationOutcomeV2,
  buildOperatingTerminalVerificationAssignmentV2,
  closeVerifiedOperatingCycleV2,
  deriveContainedExecutorRequestFingerprintFromBindingV2,
  deriveOperatingExecutionLifecycleIdentitiesV2,
  deriveOperatingExecutionVerificationStatusV2,
  deriveOperatingReviewWorkDispositionSetsV2,
  deriveOperatingVerificationFeedbackV2,
  findOpenReferenceExecutorHostDeclarationV2,
  OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
  selectOperateCapabilityProviderV2,
  selectOperateExecutorV2,
} from './runtime-foundation/execution.mjs';
import {
  assertOperatingExecutiveBoardV2,
  assertOperatingValidatedDependencyProofV2,
  buildOperatingDecisionLedgerMaterializationV2,
  buildOperatingIntelligenceStateTransitionV2,
  buildOperatingTriggerScenarioTransitionV2,
  createOperatingAssignmentContractServiceV2,
  createOperatingIntelligenceReplayServiceV2,
  createOperatingRuntimeEventReducerV2,
  decodeOperatingIntelligenceArtifactBodyV2,
  deriveOperatingAssignmentReleaseIntentsV2,
  deriveOperatingAssignmentTerminalIntentsV2,
  deriveOperatingEvidenceAbsenceIdV2,
  deriveOperatingIntelligenceAssignmentIdV2,
  deriveOperatingIntelligenceBundleCustodyIdsV2,
  planOperatingIntelligenceBoardV2,
  resolveOperatingAssignmentInputAbsencesV2,
  resolveOperatingAssignmentInputArtifactIdsV2,
  validateOperatingAssignmentGraphV2,
  validateOperatingIntelligenceAssignmentGraphV2,
} from './runtime-foundation/intelligence.mjs';
import { createIntelligenceRuntimeEventHandlerV2 } from './runtime-foundation/intelligence-events.mjs';
import {
  assertAcceptedLiveEvidenceSourceV2,
  assertOperateExperienceArtifactV2,
  assertProtocolArtifact,
  canonicalizeJson,
  OPERATE_CONTRACT_CATALOG_V2,
  PipelineError,
  sha256Jcs,
  validateProtocolArtifact,
} from './runtime-foundation/protocol.mjs';
import { createWorkflowRuntimeEventHandlerV2 } from './runtime-foundation/workflow-events.mjs';

export {
  buildOperatingActionExecutionFeedbackV2,
  buildOperatingActionVerificationMaterializationV2,
  buildOperatingActionVerificationOutcomeV2,
} from './action-verification-v2.mjs';
export {
  appendOperatingApprovalRecordV2,
  assertOperatingApprovalRecordV2,
  assertOperatingApprovalRequirementIntegrityV2,
  assertOperatingApprovalRequirementSetIntegrityV2,
  assertOperatingApprovalRequirementV2,
  consumeOperatingApprovalRecordsV2,
  createOperatingActionReviewV2,
  createOperatingApprovalRecordV2,
  createOperatingApprovalRequirementV2,
  evaluateOperatingApprovalSetV2,
  evaluateOperatingRollbackApprovalSetV2,
  partitionSupersededOperatingAuthorityV2,
} from './approvals-v2.mjs';
export {
  assertOperateAuthorityV2,
  assertOperatingActionAuthorityTupleV2,
  deriveOperateAuthorityAllowedActionsV2,
  evaluateOperateAuthorityV2,
  getOperateAuthorityArgumentCandidatesV2,
  OPERATE_AUTHORITY_DECISION_VERSION_V2,
  OPERATE_AUTHORITY_TOOL_CAPABILITIES_V2,
} from './authorization-v2.mjs';
export {
  closeVerifiedOperatingCycleV2,
  deriveOperatingReviewWorkDispositionSetsV2,
} from './cycle-closure-v2.mjs';
export {
  createOperatingArtifactByteStoreV2,
  readOperatingArtifactRawBytesV2,
} from './evidence-materialization-v2.mjs';
export { buildOperatingEvidenceGraphV2 } from './evidence-projections-v2.mjs';
export {
  buildOperatingExecutionLifecycleV2,
  buildOperatingRollbackVerificationV2,
  buildOperatingTerminalVerificationAssignmentV2,
  deriveOperatingExecutionLifecycleIdentitiesV2,
  deriveOperatingExecutionVerificationStatusV2,
  deriveOperatingVerificationFeedbackV2,
  OPERATING_EXECUTION_VERIFICATION_STATUSES_V2,
  OPERATING_HYPOTHESIS_VERIFICATION_STATUSES_V2,
  selectOperatingTerminalVerificationAssignmentV2,
} from './execution-verification-v2.mjs';
export {
  assertOperatingRoleLocalClaimIdsV2,
  deriveOperatingChairLedgerIdV2,
  deriveOperatingRoleLocalClaimIdV2,
} from './intelligence-output-identities-v2.mjs';
export { preflightOperatingIntelligenceResultV2 } from './intelligence-result-validator-v2.mjs';
export {
  assertOperatingIntelligencePlanV2,
  planOperatingIntelligenceBoardV2,
} from './intelligence-router-v2.mjs';
export {
  assertOperatingDeltaV2,
  classifyOperatingDeltaMaterialityV2,
  deriveOperatingDeltaV2,
} from './operating-delta-v2.mjs';
export { buildOperatingIntelligenceStateTransitionV2 } from './operating-intelligence-state-v2.mjs';
export {
  assertOperatingSnapshotV2,
  buildOperatingSnapshotStateTransactionV2,
  deriveOperatingSnapshotRuntimeHashV2,
} from './operating-snapshots-v2.mjs';
export {
  assertOperatingModelStateV2,
  buildOperatingModelStateV2,
  deriveOperatingModelStateRuntimeHashV2,
  OPERATING_MODEL_STATE_COLLECTIONS_V2,
} from './operating-state-v2.mjs';
export { buildOperatingTriggerScenarioTransitionV2 } from './operating-triggers-v2.mjs';
export {
  buildOperatingCycleWorkViewV2,
  buildOperatingWorkLedgerV2,
} from './persistent-work-projections-v2.mjs';
export {
  derivePersistentOperatingExecutionVerificationProjectionV2,
  derivePersistentOperatingRecoveryProjectionV2,
} from './persistent-work-v2.mjs';
export {
  assertOperatingActionPolicyV2,
  assertOperatingPolicyEvaluationV2,
  assertOperatingRollbackPolicyV2,
  createOperatingActionPolicyV2,
  deriveApplicableOperatingActionPoliciesV2,
  deriveOperatingApprovalRequirementInstanceIdV2,
  evaluateOperatingActionPolicyV2,
  OPERATE_CORE_PROHIBITION_IDENTIFIERS_V2,
  OPERATE_POLICY_OUTCOME_STRENGTH_V2,
  OPERATE_POLICY_TIER_PRECEDENCE_V2,
} from './policy-v2.mjs';
export {
  assertOperatingReviewBoundSubmissionV1,
  buildOperatingReviewBoundSubmissionV1,
  computeOperatingReviewBoundSubmissionHashV1,
  OPERATE_REVIEW_BOUND_SUBMISSION_DOMAIN,
} from './review-bound-submission-v2.mjs';

const ZERO_TIME = '1970-01-01T00:00:00.000Z';
const PROTOCOL_VERSION = '2.0.0';
const GOVERNED_AUTHORITY_OPERATIONS_V2 = new Set([
  'operate.review.submit',
  'operate.action.approve',
  'operate.action.execute',
  'operate.action.rollback',
]);

function compiledLifecycleTransitions(entityId) {
  const transitions = OPERATE_CONTRACT_CATALOG_V2.transitions.filter(
    (transition) => transition.entityId === entityId,
  );
  if (transitions.length === 0) {
    throw new Error(`The compiled Operate catalog does not declare ${entityId} transitions.`);
  }
  const states = new Set(transitions.flatMap((transition) => [transition.from, transition.to]));
  const table = Object.fromEntries(
    [...states].sort().map((state) => [
      state,
      Object.freeze(
        transitions
          .filter((transition) => transition.from === state)
          .map((transition) => transition.to)
          .sort(),
      ),
    ]),
  );
  return Object.freeze(table);
}

function compiledTransition(entityId, from, to) {
  return (
    OPERATE_CONTRACT_CATALOG_V2.transitions.find(
      (transition) =>
        transition.entityId === entityId && transition.from === from && transition.to === to,
    ) ?? null
  );
}

/** Compiler-owned legal Assignment state table. */
export const OPERATING_ASSIGNMENT_TRANSITIONS_V2 =
  compiledLifecycleTransitions('operating-assignment');

/** Compiler-owned legal cycle-scoped Review state table. */
export const OPERATING_REVIEW_TRANSITIONS_V2 = compiledLifecycleTransitions('operating-review');

const TERMINAL_CYCLE_STATES = new Set(['failed', 'cancelled']);
const TERMINAL_ASSIGNMENT_STATES = new Set(['validated', 'abandoned', 'failed']);

function runtimeError(code, message, context = {}, retryable = false) {
  return new PipelineError(code, message, '', { retryable, context: structuredClone(context) });
}

const {
  actorMatchesClaim,
  artifactArguments,
  canonicalHashForSubmissionBytes,
  decodeSubmissionBytes,
  decodedBase64Size,
  issuedAssignmentCapabilities,
  rawHashForBytes,
  validateExactAcceptedSubmissionReplay,
  validateArtifactGetRequestShape,
  validateSubmissionBodyForAssignment,
  validateSubmitRequestShape,
} = createOperatingAssignmentContractServiceV2({ runtimeError });

const { exactIntelligenceBoardReplay, intelligenceAssignmentCreationEventId } =
  createOperatingIntelligenceReplayServiceV2({ runtimeError });

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function exactPlainRecord(value, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  )
    return false;
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...fields].sort();
  return (
    actual.length === expected.length &&
    actual.every((field, index) => field === expected[index]) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) =>
        Object.hasOwn(descriptor, 'value') &&
        descriptor.get === undefined &&
        descriptor.set === undefined,
    )
  );
}

function actionOperationOwnerKey(action) {
  return `${action?.actionId ?? ''}\u0000${action?.revision ?? ''}\u0000${action?.actionHash ?? ''}`;
}

/** One canonical owner lookup shared by checkpoint loading, Event reduction, and execution. */
export function findOperatingExactActionOperationOwnerV2(
  operations,
  action,
  { excludeOperationId = null } = {},
) {
  if (!Array.isArray(operations)) {
    throw runtimeError(
      'OPERATION_CONFLICT',
      'Exact Action operation ownership requires one operation collection.',
    );
  }
  const key = actionOperationOwnerKey(action);
  const owners = operations.filter(
    (operation) =>
      operation.operationId !== excludeOperationId &&
      operation.operationKind === 'execute' &&
      actionOperationOwnerKey(operation.action) === key,
  );
  if (owners.length > 1) {
    throw runtimeError(
      'OPERATION_CONFLICT',
      'One exact Action revision may own only one governed operation.',
      {
        actionId: action?.actionId ?? null,
      },
    );
  }
  return owners.length === 0 ? null : clone(owners[0]);
}

function governedActionIdentity(action) {
  return {
    actionId: action.actionId,
    revision: action.revision,
    actionHash: action.actionHash,
  };
}

/** Resolve the one latest deterministic evaluation effective for an Action at a timestamp. */
export function resolveOperatingLatestActionEvaluationV2({
  evaluations = [],
  action,
  configuredPolicies = [],
  at,
} = {}) {
  if (
    !Array.isArray(evaluations) ||
    !Array.isArray(configuredPolicies) ||
    !action ||
    typeof at !== 'string' ||
    Number.isNaN(Date.parse(at))
  ) {
    throw runtimeError(
      'POLICY_EVALUATION_REJECTED',
      'Latest Action evaluation resolution requires complete deterministic inputs.',
    );
  }
  const candidates = evaluations.filter(
    (candidate) =>
      candidate?.action?.actionId === action.actionId &&
      candidate.action.revision === action.revision &&
      candidate.action.actionHash === action.actionHash &&
      Date.parse(candidate.evaluatedAt) <= Date.parse(at),
  );
  const validated = candidates.map((candidate) => {
    try {
      return assertOperatingPolicyEvaluationV2(candidate, { action, configuredPolicies });
    } catch (error) {
      throw runtimeError(
        error.code ?? 'POLICY_EVALUATION_REJECTED',
        error.message,
        error.details?.context ?? {
          evaluationId: candidate?.evaluationId ?? null,
        },
      );
    }
  });
  return (
    validated
      .sort(
        (left, right) =>
          left.evaluatedAt.localeCompare(right.evaluatedAt) ||
          left.evaluationId.localeCompare(right.evaluationId),
      )
      .at(-1) ?? null
  );
}

/**
 * Derive and validate the only execute-operation projection this runtime can
 * own. The candidate supplies runtime-issued identities; every authority,
 * executor, connector, target, I/O, rollback, and time field is reconstructed
 * from durable records and the exact registered reference selection.
 */
export function assertOperatingExecuteOperationV2({
  operation,
  action,
  assignment,
  evaluation,
  evaluations = [],
  configuredPolicies = [],
  grant,
  requirements = [],
  approvals = [],
  capabilityAvailability,
  request,
  timestamp,
  registry = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
} = {}) {
  const payload = request?.payload;
  const rollbackBaseline = request?.rollbackBaseline ?? null;
  const expectedAction = action ? governedActionIdentity(action) : null;
  const expectedInputArtifactIds = action
    ? [...new Set([action.sourceArtifactId, ...action.preconditionArtifactIds])].sort()
    : [];
  const requiredRollback = action?.executionBinding?.rollbackRequired === true;
  try {
    assertPersistentOperatingActionAuthorityV2(action);
  } catch (error) {
    throw runtimeError(
      error.code ?? 'ACTION_REVISION_MISMATCH',
      error.message,
      error.details?.context ?? {
        actionId: action?.actionId ?? null,
      },
    );
  }
  let latestEvaluation = null;
  try {
    latestEvaluation = resolveOperatingLatestActionEvaluationV2({
      evaluations,
      action,
      configuredPolicies,
      at: timestamp,
    });
  } catch {
    latestEvaluation = null;
  }
  let authorityDisposition = null;
  let authorityRecordsValid = false;
  if (
    Array.isArray(requirements) &&
    Array.isArray(approvals) &&
    evaluation &&
    action &&
    operation
  ) {
    try {
      const expectedRequirementIds = [...evaluation.approvalRequirementIds].sort();
      const actualRequirementIds = requirements.map(({ requirementId }) => requirementId).sort();
      const actualApprovalIds = approvals.map(({ approvalId }) => approvalId).sort();
      if (
        new Set(actualRequirementIds).size !== actualRequirementIds.length ||
        new Set(actualApprovalIds).size !== actualApprovalIds.length ||
        sha256Jcs(actualRequirementIds) !== sha256Jcs(expectedRequirementIds)
      ) {
        throw runtimeError(
          'APPROVAL_INVALID',
          'Execute operation requires the exact approval requirement and complete current-evaluation record sets.',
        );
      }
      assertOperatingApprovalRequirementSetIntegrityV2({
        requirements,
        evaluationId: evaluation.evaluationId,
      });
      for (const requirement of requirements) {
        assertOperatingApprovalRequirementV2(requirement, { evaluation, action });
      }
      const authorityApprovals = approvals.map((approval) => {
        const requirement = requirements.find(
          ({ requirementId }) => requirementId === approval.requirementId,
        );
        if (
          !requirement ||
          ![null, operation.operationId].includes(approval.consumedByOperationId)
        ) {
          throw runtimeError(
            'APPROVAL_INVALID',
            'Execute operation approval record has no exact requirement or operation consumption binding.',
            {
              approvalId: approval?.approvalId ?? null,
            },
          );
        }
        assertOperatingApprovalRecordV2(approval, { requirement });
        if (approval.consumedByOperationId === null) return approval;
        const restored = { ...clone(approval), consumedByOperationId: null };
        restored.recordHash = sha256Jcs(recordWithoutHash(restored, 'recordHash'));
        return restored;
      });
      authorityDisposition = evaluateOperatingApprovalSetV2({
        evaluation,
        action,
        requirements,
        approvals: authorityApprovals,
        now: timestamp,
      });
      authorityRecordsValid =
        authorityDisposition.complete === true &&
        authorityDisposition.disposition === 'approved' &&
        sameCanonicalStringSet(authorityDisposition.approvalIds, operation.approvalIds) &&
        approvals.every((approval) =>
          operation.approvalIds.includes(approval.approvalId)
            ? [null, operation.operationId].includes(approval.consumedByOperationId)
            : approval.consumedByOperationId === null,
        );
    } catch {
      authorityDisposition = null;
      authorityRecordsValid = false;
    }
  }
  const canonicalApprovalIds = authorityRecordsValid
    ? [...authorityDisposition.approvalIds].sort()
    : null;
  const scopeHashes = Array.isArray(requirements)
    ? [...new Set(requirements.map(({ scopeHash }) => scopeHash))]
    : [];
  const expectedScopeHash =
    evaluation?.outcome === 'automatic'
      ? sha256Jcs({
          action: expectedAction,
          evaluationId: evaluation?.evaluationId,
          scopeId: action?.scopeId,
          domainId: action?.domainId,
          domainVersion: action?.domainVersion,
        })
      : scopeHashes.length === 1
        ? scopeHashes[0]
        : null;
  let selection = null;
  let host = null;
  let capabilitySelection = null;
  try {
    const registration = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.executors.find(
      (candidate) =>
        candidate.executorId === operation?.executor?.executorId &&
        candidate.executorVersion === operation?.executor?.executorVersion,
    );
    const criteria = registration
      ? {
          executorId: registration.executorId,
          executorVersion: registration.executorVersion,
          protocolVersion: PROTOCOL_VERSION,
          runtimeVersion: registration.provenance.packageVersion,
          now: timestamp,
          domainId: action?.domainId,
          actionKind: action?.actionKind,
          capability: action?.requestedCapability,
          targetKind: action?.targetBinding?.kind,
          effectClass: action?.effectClass,
          operationKind: 'execute',
        }
      : null;
    selection = criteria
      ? selectOperateExecutorV2(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2, criteria)
      : null;
    const providedSelection = criteria ? selectOperateExecutorV2(registry, criteria) : null;
    if (
      selection?.status !== 'available' ||
      providedSelection?.status !== 'available' ||
      sha256Jcs(providedSelection.registration) !== sha256Jcs(selection.registration)
    ) {
      selection = null;
    }
    capabilitySelection = selectOperateCapabilityProviderV2(
      OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
      {
        providerId: capabilityAvailability?.provider?.providerId,
        providerVersion: capabilityAvailability?.provider?.providerVersion,
        protocolVersion: PROTOCOL_VERSION,
        runtimeVersion: selection?.registration?.provenance?.packageVersion ?? '0.44.0',
        now: timestamp,
        domainId: action?.domainId,
        actionKind: action?.actionKind,
        capability: action?.requestedCapability,
        targetKind: action?.targetBinding?.kind,
        effectClass: action?.effectClass,
      },
    );
    host =
      selection?.status === 'available'
        ? findOpenReferenceExecutorHostDeclarationV2({
            executorId: selection.registration.executorId,
            executorVersion: selection.registration.executorVersion,
            implementationId: selection.registration.implementation.id,
          })
        : null;
  } catch {
    selection = null;
    host = null;
  }
  const availabilityIdentityDraft = capabilityAvailability
    ? {
        ...clone(capabilityAvailability),
        availabilityId: 'cava_pending000',
      }
    : null;
  if (availabilityIdentityDraft) delete availabilityIdentityDraft.availabilityHash;
  const expectedAvailabilityId = availabilityIdentityDraft
    ? `cava_${sha256Jcs(availabilityIdentityDraft).slice('sha256:'.length)}`
    : null;
  const grantExpiry = Date.parse(grant?.expiresAt);
  const authorityExpiryCeilings = [
    capabilityAvailability?.expiresAt,
    ...(Array.isArray(requirements) ? requirements.map(({ expiresAt }) => expiresAt) : []),
    ...(Array.isArray(approvals) ? approvals.map(({ expiresAt }) => expiresAt) : []),
  ]
    .filter((expiresAt) => expiresAt !== null && expiresAt !== undefined)
    .map(Date.parse);
  if (
    !operation ||
    !action ||
    action.state !== 'approved' ||
    !assignment ||
    !evaluation ||
    !grant ||
    !payload ||
    !authorityRecordsValid ||
    canonicalApprovalIds === null ||
    !latestEvaluation ||
    sha256Jcs(evaluation) !== sha256Jcs(latestEvaluation) ||
    selection?.status !== 'available' ||
    host === null ||
    capabilitySelection?.status !== 'available' ||
    capabilityAvailability?.kind !== 'operating-capability-availability' ||
    capabilityAvailability.schemaVersion !== '1.0.0' ||
    capabilityAvailability.protocolVersion !== PROTOCOL_VERSION ||
    capabilityAvailability.status !== 'available' ||
    capabilityAvailability.reasonCode !== capabilitySelection.reasonCode ||
    capabilityAvailability.availabilityId !== expectedAvailabilityId ||
    capabilityAvailability.effectCeiling !== capabilitySelection.registration.effectCeiling ||
    capabilityAvailability.checkedAt !== timestamp ||
    Date.parse(capabilityAvailability.expiresAt) <= Date.parse(timestamp) ||
    Date.parse(capabilityAvailability.expiresAt) >
      Date.parse(capabilitySelection.registration.health.expiresAt) ||
    sha256Jcs(capabilityAvailability.capability) !== sha256Jcs(action.requestedCapability) ||
    sha256Jcs(capabilityAvailability.target) !== sha256Jcs(action.targetBinding) ||
    capabilityAvailability.availabilityHash !==
      sha256Jcs(recordWithoutHash(capabilityAvailability, 'availabilityHash')) ||
    operation.operationId !== grant.operationId ||
    operation.operationId !== assignment.governedOperationId ||
    operation.assignmentId !== assignment.assignmentId ||
    operation.grantId !== grant.grantId ||
    operation.evaluationId !== evaluation.evaluationId ||
    sha256Jcs(evaluation.action) !== sha256Jcs(expectedAction) ||
    sha256Jcs(grant.action) !== sha256Jcs(expectedAction) ||
    grant.assignmentId !== assignment.assignmentId ||
    grant.evaluationId !== evaluation.evaluationId ||
    !sameCanonicalStringSet(grant.approvalIds, canonicalApprovalIds) ||
    sha256Jcs(grant.capability) !== sha256Jcs(action.requestedCapability) ||
    sha256Jcs(grant.target) !== sha256Jcs(action.targetBinding) ||
    grant.effectClass !== action.effectClass ||
    grant.useLimit !== 1 ||
    grant.issuer?.kind !== 'runtime' ||
    typeof grant.issuer.id !== 'string' ||
    grant.scopeHash !== expectedScopeHash ||
    grant.issuedAt !== timestamp ||
    Date.parse(grant.expiresAt) <= Date.parse(timestamp) ||
    !Number.isFinite(grantExpiry) ||
    authorityExpiryCeilings.some((expiry) => !Number.isFinite(expiry) || grantExpiry > expiry) ||
    ![null, timestamp].includes(grant.consumedAt) ||
    grant.revokedAt !== null ||
    assignment.cycleId !== action.sourceCycleId ||
    !sameCanonicalStringSet(assignment.inputArtifactIds, expectedInputArtifactIds) ||
    !expectedInputArtifactIds.includes(payload.artifactId) ||
    requiredRollback !== (rollbackBaseline !== null) ||
    (rollbackBaseline !== null &&
      !expectedInputArtifactIds.includes(rollbackBaseline.artifactId)) ||
    payload.artifactId === rollbackBaseline?.artifactId
  ) {
    throw runtimeError(
      'OPERATION_CONFLICT',
      'Execute operation authority inputs do not equal the exact durable Action, evaluation, grant, and registered selection.',
      {
        operationId: operation?.operationId ?? null,
      },
    );
  }
  const expected = {
    kind: 'operating-governed-operation',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    operationId: operation.operationId,
    operationKind: 'execute',
    action: expectedAction,
    assignmentId: assignment.assignmentId,
    requestFingerprint: `sha256:${'0'.repeat(64)}`,
    evaluationId: evaluation.evaluationId,
    approvalIds: canonicalApprovalIds,
    grantId: grant.grantId,
    capability: clone(action.requestedCapability),
    target: clone(action.targetBinding),
    effectClass: action.effectClass,
    executor: {
      executorId: selection.registration.executorId,
      executorVersion: selection.registration.executorVersion,
    },
    connector: clone(host.connector),
    preconditionArtifactIds: [...action.preconditionArtifactIds],
    inputArtifactIds: expectedInputArtifactIds,
    verificationPlanId: action.verificationPlanId,
    rollbackClass: requiredRollback ? 'reversible' : 'not-applicable',
    state: 'dispatching',
    intentEventId: operation.intentEventId,
    resultId: null,
    rollbackPlanId: null,
    parentOperationId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    operationHash: `sha256:${'0'.repeat(64)}`,
  };
  try {
    expected.requestFingerprint = deriveContainedExecutorRequestFingerprintFromBindingV2({
      operation: expected,
      payload: { artifactId: payload.artifactId, contentHash: payload.contentHash },
      rollbackBaseline:
        rollbackBaseline === null
          ? null
          : {
              artifactId: rollbackBaseline.artifactId,
              contentHash: rollbackBaseline.contentHash,
            },
    });
  } catch {
    throw runtimeError(
      'OPERATION_CONFLICT',
      'Execute operation request fingerprint inputs are invalid.',
      {
        operationId: operation.operationId,
      },
    );
  }
  expected.operationHash = sha256Jcs(recordWithoutHash(expected, 'operationHash'));
  if (sha256Jcs(operation) !== sha256Jcs(expected)) {
    throw runtimeError(
      'OPERATION_CONFLICT',
      'Execute operation does not equal the one exact runtime-derived projection.',
      {
        operationId: operation.operationId,
      },
    );
  }
  return clone(expected);
}

function sameCanonicalStringSet(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    sha256Jcs([...left].sort()) === sha256Jcs([...right].sort())
  );
}

function recordWithoutHash(record, hashField) {
  const result = clone(record);
  delete result[hashField];
  return result;
}

function assertCanonicalRecordHash(record, hashField, code, label) {
  if (record?.[hashField] !== sha256Jcs(recordWithoutHash(record, hashField))) {
    throw runtimeError(code, `${label} failed its canonical hash check.`, {
      [hashField]: record?.[hashField] ?? null,
    });
  }
}

export const OPERATING_EXECUTION_EFFECT_SUMMARIES_V2 = Object.freeze({
  changed: 'Applied the exact approved contained target change.',
  unchanged: 'The exact approved contained target already matched the requested value.',
  partial:
    'Contained dispatch changed the target without reaching the exact requested postcondition.',
  failed: 'Contained dispatch failed without a proven target postcondition.',
  blocked: 'Contained dispatch is blocked without a proven target postcondition.',
  uncertain: 'Contained dispatch outcome is uncertain; reconciliation is required before retry.',
});

/** Validate untrusted host bytes and retain only the closed durable receipt proof. */
export function createOperatingExecutionReceiptProofV2({ operation, receipt } = {}) {
  if (
    !operation ||
    !exactPlainRecord(receipt, [
      'operationId',
      'requestFingerprint',
      'target',
      'before',
      'after',
      'changed',
      'synthetic',
      'effectCount',
    ]) ||
    !exactPlainRecord(receipt.target, ['kind', 'id']) ||
    !exactPlainRecord(receipt.before, ['value', 'revision', 'stateHash']) ||
    !exactPlainRecord(receipt.after, ['value', 'revision', 'stateHash']) ||
    receipt.operationId !== operation.operationId ||
    receipt.requestFingerprint !== operation.requestFingerprint ||
    receipt.target.kind !== operation.target.kind ||
    receipt.target.id !== operation.target.id ||
    receipt.before.revision !== operation.target.revision ||
    typeof receipt.after.revision !== 'string' ||
    receipt.after.revision.length === 0 ||
    receipt.before.stateHash !== sha256Jcs(receipt.before.value) ||
    receipt.after.stateHash !== sha256Jcs(receipt.after.value) ||
    receipt.changed !== (receipt.before.stateHash !== receipt.after.stateHash) ||
    typeof receipt.synthetic !== 'boolean' ||
    receipt.effectCount !== 1
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Contained receipt bytes must prove one exact operation-local target effect.',
      {
        operationId: operation?.operationId ?? null,
      },
    );
  }
  return Object.freeze({
    operationId: receipt.operationId,
    requestFingerprint: receipt.requestFingerprint,
    target: clone(receipt.target),
    before: { revision: receipt.before.revision, stateHash: receipt.before.stateHash },
    after: { revision: receipt.after.revision, stateHash: receipt.after.stateHash },
    changed: receipt.changed,
    synthetic: receipt.synthetic,
    effectCount: receipt.effectCount,
  });
}

export function assertOperatingExecutionResultSemanticsV2({
  result,
  operation,
  replayEntry,
  grant,
  receiptProof = null,
} = {}) {
  const completedAt = Date.parse(result?.completedAt);
  const createdAt = Date.parse(operation?.createdAt);
  const issuedAt = Date.parse(grant?.issuedAt);
  const consumedAt = Date.parse(grant?.consumedAt);
  const expiresAt = Date.parse(grant?.expiresAt);
  const status = result?.status;
  const provenEffect = status === 'succeeded' || status === 'partial';
  const expectedChanged = provenEffect
    ? result?.targetBeforeHash !== result?.targetAfterHash
    : false;
  const statusRules = {
    succeeded: {
      receipt: true,
      postcondition: result?.targetAfterHash === replayEntry?.payloadHash,
      changed: expectedChanged,
      summary: expectedChanged
        ? OPERATING_EXECUTION_EFFECT_SUMMARIES_V2.changed
        : OPERATING_EXECUTION_EFFECT_SUMMARIES_V2.unchanged,
      affectedTargetIds: [operation?.target?.id],
    },
    partial: {
      receipt: true,
      postcondition:
        typeof result?.targetAfterHash === 'string' &&
        result.targetAfterHash !== result.targetBeforeHash &&
        result.targetAfterHash !== replayEntry?.payloadHash,
      changed: true,
      summary: OPERATING_EXECUTION_EFFECT_SUMMARIES_V2.partial,
      affectedTargetIds: [operation?.target?.id],
    },
    failed: {
      receipt: false,
      postcondition: result?.targetAfterHash === null,
      changed: false,
      summary: OPERATING_EXECUTION_EFFECT_SUMMARIES_V2.failed,
      affectedTargetIds: [],
    },
    blocked: {
      receipt: false,
      postcondition: result?.targetAfterHash === null,
      changed: false,
      summary: OPERATING_EXECUTION_EFFECT_SUMMARIES_V2.blocked,
      affectedTargetIds: [],
    },
    uncertain: {
      receipt: false,
      postcondition: result?.targetAfterHash === null,
      changed: false,
      summary: OPERATING_EXECUTION_EFFECT_SUMMARIES_V2.uncertain,
      affectedTargetIds: [operation?.target?.id],
    },
  };
  const rule = statusRules[status] ?? null;
  const baselineRequired = operation?.rollbackClass !== 'not-applicable';
  const requestBinding = replayEntry
    ? {
        payload: {
          artifactId: replayEntry.payloadArtifactId,
          contentHash: replayEntry.payloadHash,
        },
        rollbackBaseline:
          replayEntry.baselineArtifactId === null
            ? null
            : {
                artifactId: replayEntry.baselineArtifactId,
                contentHash: replayEntry.baselineHash,
              },
      }
    : null;
  let fingerprint = null;
  try {
    fingerprint =
      requestBinding &&
      deriveContainedExecutorRequestFingerprintFromBindingV2({
        operation,
        ...requestBinding,
      });
  } catch {
    fingerprint = null;
  }
  if (
    !result ||
    !operation ||
    !replayEntry ||
    !grant ||
    Number.isNaN(completedAt) ||
    Number.isNaN(createdAt) ||
    Number.isNaN(issuedAt) ||
    Number.isNaN(consumedAt) ||
    Number.isNaN(expiresAt) ||
    completedAt < createdAt ||
    issuedAt > consumedAt ||
    consumedAt !== createdAt ||
    consumedAt >= expiresAt ||
    grant.revokedAt !== null ||
    fingerprint !== operation.requestFingerprint ||
    result.requestFingerprint !== operation.requestFingerprint ||
    result.targetBeforeHash !== replayEntry.targetBeforeHash ||
    baselineRequired !== (replayEntry.baselineArtifactId !== null) ||
    result.baselineArtifactId !== replayEntry.baselineArtifactId ||
    result.baselineHash !== replayEntry.baselineHash ||
    (baselineRequired && result.targetBeforeHash !== result.baselineHash) ||
    !sameCanonicalStringSet(result.outputArtifactIds, [result.resultArtifactId]) ||
    !rule ||
    !rule.postcondition ||
    rule.receipt !== (receiptProof !== null) ||
    result.effectSummary?.changed !== rule.changed ||
    result.effectSummary?.summary !== rule.summary ||
    !sameCanonicalStringSet(result.effectSummary?.affectedTargetIds, rule.affectedTargetIds)
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Execution result semantics must equal the durable request, target, grant-consumption, and effect bindings.',
      {
        resultId: result?.resultId ?? null,
        operationId: operation?.operationId ?? null,
      },
    );
  }
  if (receiptProof !== null) {
    if (
      !exactPlainRecord(receiptProof, [
        'operationId',
        'requestFingerprint',
        'target',
        'before',
        'after',
        'changed',
        'synthetic',
        'effectCount',
      ]) ||
      !exactPlainRecord(receiptProof.target, ['kind', 'id']) ||
      !exactPlainRecord(receiptProof.before, ['revision', 'stateHash']) ||
      !exactPlainRecord(receiptProof.after, ['revision', 'stateHash']) ||
      receiptProof.operationId !== operation.operationId ||
      receiptProof.requestFingerprint !== operation.requestFingerprint ||
      receiptProof.target.kind !== operation.target.kind ||
      receiptProof.target.id !== operation.target.id ||
      receiptProof.before.revision !== operation.target.revision ||
      typeof receiptProof.after.revision !== 'string' ||
      receiptProof.after.revision.length === 0 ||
      receiptProof.before.stateHash !== result.targetBeforeHash ||
      receiptProof.after.stateHash !== result.targetAfterHash ||
      receiptProof.changed !== rule.changed ||
      typeof receiptProof.synthetic !== 'boolean' ||
      receiptProof.effectCount !== 1
    ) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Durable contained receipt proof must equal the exact status-bound target effect.',
        {
          resultId: result.resultId,
          operationId: operation.operationId,
        },
      );
    }
  }
  return clone(result);
}

function replayEventHashForPayload(entry, payload) {
  const event = {
    kind: 'operating-event',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    eventId: entry.eventId,
    sequence: entry.sequence,
    timestamp: entry.timestamp,
    cycleId: entry.cycleId,
    type: entry.type,
    entityId: entry.entityId,
    actor: clone(entry.actor),
    causationId: entry.causationId,
    correlationId: entry.correlationId,
    previousEventHash: entry.previousEventHash,
    ...(entry.requestHash === undefined ? {} : { requestHash: entry.requestHash }),
    payload: clone(payload),
  };
  return computeOperatingRuntimeEventHashV2(event);
}

function assertReplayEventPayload(entry, payload, expected) {
  if (
    !entry ||
    entry.type !== expected.type ||
    entry.entityId !== expected.entityId ||
    entry.cycleId !== expected.cycleId ||
    entry.timestamp !== expected.timestamp ||
    entry.correlationId !== expected.correlationId ||
    entry.causationId !== expected.causationId ||
    sha256Jcs(entry.actor) !== sha256Jcs(expected.actor) ||
    entry.requestHash !== expected.requestHash ||
    entry.payloadHash !== sha256Jcs(payload) ||
    entry.eventHash !== replayEventHashForPayload(entry, payload)
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Execution terminal Event replay proof is incomplete or inconsistent.',
      {
        eventId: entry?.eventId ?? null,
        type: expected.type,
      },
    );
  }
}

function reservedExecutionTerminalForStatus(replayEntry, status) {
  const uncertainty = !['succeeded', 'partial'].includes(status);
  return uncertainty
    ? {
        resultId: replayEntry?.reservedUncertaintyResultId,
        resultArtifactId: replayEntry?.reservedUncertaintyResultArtifactId,
        submissionId: replayEntry?.reservedUncertaintySubmissionId,
        eventIds: replayEntry?.reservedUncertaintyTerminalEventIds ?? {},
      }
    : {
        resultId: replayEntry?.reservedResultId,
        resultArtifactId: replayEntry?.reservedResultArtifactId,
        submissionId: replayEntry?.reservedSubmissionId,
        eventIds: replayEntry?.reservedTerminalEventIds ?? {},
      };
}

function assertOperatingDispatchExecutionProjectionsV2({
  operation,
  assignment,
  action,
  grant,
  successSubmission,
  uncertaintySubmission,
  replayEntry,
}) {
  const registration = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.executors.find(
    (candidate) =>
      candidate.executorId === operation.executor.executorId &&
      candidate.executorVersion === operation.executor.executorVersion,
  );
  const expectedAssignment =
    assignment && registration
      ? {
          kind: 'operating-assignment',
          schemaVersion: '1.0.0',
          protocolVersion: PROTOCOL_VERSION,
          assignmentId: operation.assignmentId,
          cycleId: action.sourceCycleId,
          assignmentKind: 'execution',
          roleId: 'operate-governed-executor',
          objective: `Execute the approved Action ${action.actionId} at most once within its governed target binding.`,
          state: 'running',
          dependsOn: [],
          dependencyPolicy: { kind: 'none' },
          inputArtifactIds: [...operation.inputArtifactIds].sort(),
          inputAbsences: [],
          outputContract: {
            schemaId: 'operating-execution-result',
            schemaVersion: PROTOCOL_VERSION,
            mediaType: 'application/json',
            encoding: 'utf-8',
            maxBytes: 262144,
          },
          capabilityGrantId: operation.grantId,
          governedOperationId: operation.operationId,
          attemptPolicy: { maxAttempts: 1, attempt: 1, timeoutMs: 30000 },
          claim: {
            actorId: grant.issuer.id,
            actorKind: 'agent',
            runtime: `planr-pipeline@${registration.provenance.packageVersion}`,
            claimId: assignment.claim?.claimId,
          },
          terminalOutcome: null,
          createdAt: operation.createdAt,
          availableAt: operation.createdAt,
          completedAt: null,
        }
      : null;
  const pristineSubmission = (submissionId) => ({
    kind: 'operating-submission',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    submissionId,
    assignmentId: assignment.assignmentId,
    cycleId: assignment.cycleId,
    state: 'issued',
    rawHash: null,
    canonicalHash: null,
    sizeBytes: null,
    artifactId: null,
    acceptanceEventIds: [],
    responseData: null,
    issuedAt: operation.createdAt,
    resolvedAt: null,
  });
  if (
    !registration ||
    typeof assignment?.claim?.claimId !== 'string' ||
    sha256Jcs(assignment) !== sha256Jcs(expectedAssignment) ||
    sha256Jcs(successSubmission) !==
      sha256Jcs(pristineSubmission(replayEntry.reservedSubmissionId)) ||
    sha256Jcs(uncertaintySubmission) !==
      sha256Jcs(pristineSubmission(replayEntry.reservedUncertaintySubmissionId))
  ) {
    throw runtimeError(
      'OPERATION_CONFLICT',
      'Dispatch checkpoint projections do not equal the exact runtime-owned Assignment and pristine terminal reservations.',
      {
        operationId: operation?.operationId ?? null,
      },
    );
  }
}

function assertOperatingExecuteDispatchEventChainV2({
  index,
  operation,
  assignment,
  grant,
  replayEntry,
}) {
  const exactEntry = (type, entityId) => {
    const entries = [...index.eventReplay.values()].filter(
      (entry) => entry.type === type && entry.entityId === entityId,
    );
    return entries.length === 1 ? entries[0] : null;
  };
  const created = exactEntry('assignment.created', assignment.assignmentId);
  const available = exactEntry('assignment.available', assignment.assignmentId);
  const claimed = exactEntry('assignment.claimed', assignment.assignmentId);
  const started = exactEntry('assignment.started', assignment.assignmentId);
  const availabilityRecords = [...index.capabilityAvailability.values()].filter(
    (candidate) =>
      candidate.checkedAt === operation.createdAt &&
      sha256Jcs(candidate.capability) === sha256Jcs(operation.capability) &&
      sha256Jcs(candidate.target) === sha256Jcs(operation.target),
  );
  const availabilityRecord = availabilityRecords.length === 1 ? availabilityRecords[0] : null;
  const availabilityEvent = availabilityRecord
    ? exactEntry('capability.availability-recorded', availabilityRecord.availabilityId)
    : null;
  const grantEvent = exactEntry('capability.granted', grant.grantId);
  const intentEvent = index.eventReplay.get(operation.intentEventId);
  const ordered = [
    created,
    available,
    claimed,
    started,
    availabilityEvent,
    grantEvent,
    intentEvent,
  ];
  const priorEntry = created
    ? ([...index.eventReplay.values()].find(({ sequence }) => sequence === created.sequence - 1) ??
      null)
    : null;
  if (
    ordered.some((entry) => !entry) ||
    ordered.some((entry, offset) =>
      offset === 0 ? false : entry.sequence !== ordered[offset - 1].sequence + 1,
    ) ||
    created.causationId !== (priorEntry?.eventId ?? null) ||
    created.previousEventHash !== (priorEntry?.eventHash ?? null)
  ) {
    throw runtimeError(
      'OPERATION_CONFLICT',
      'Execute dispatch requires one contiguous runtime-owned lifecycle and authority Event chain.',
      {
        operationId: operation.operationId,
      },
    );
  }
  const initialAssignment = {
    ...clone(assignment),
    state: 'pending',
    inputArtifactIds: clone(operation.inputArtifactIds),
    attemptPolicy: { ...clone(assignment.attemptPolicy), attempt: 0 },
    claim: null,
    availableAt: null,
    completedAt: null,
  };
  const releaseProofs = [];
  const releaseId = `rel_${sha256Jcs({
    assignmentId: assignment.assignmentId,
    cycleId: assignment.cycleId,
    dependencyProofs: releaseProofs,
  }).slice(7, 31)}`;
  const initialGrant = { ...clone(grant), consumedAt: null };
  initialGrant.grantHash = sha256Jcs(recordWithoutHash(initialGrant, 'grantHash'));
  const correlationId = replayEntry.reservedCorrelationId;
  const engine = { kind: 'engine', id: grant.issuer.id };
  assertReplayEventPayload(created, initialAssignment, {
    type: 'assignment.created',
    entityId: assignment.assignmentId,
    cycleId: assignment.cycleId,
    timestamp: operation.createdAt,
    correlationId,
    causationId: priorEntry?.eventId ?? null,
    actor: engine,
    requestHash: undefined,
  });
  assertReplayEventPayload(
    available,
    {
      assignmentId: assignment.assignmentId,
      releaseId,
      dependencyProofs: [],
      dependencyEventIds: [],
    },
    {
      type: 'assignment.available',
      entityId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      timestamp: operation.createdAt,
      correlationId,
      causationId: created.eventId,
      actor: { kind: 'engine', id: 'openplanr-scheduler' },
      requestHash: undefined,
    },
  );
  assertReplayEventPayload(
    claimed,
    {
      assignmentId: assignment.assignmentId,
      actorId: assignment.claim.actorId,
      actorKind: assignment.claim.actorKind,
      runtime: assignment.claim.runtime,
      claimId: assignment.claim.claimId,
      submissionId: replayEntry.reservedSubmissionId,
    },
    {
      type: 'assignment.claimed',
      entityId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      timestamp: operation.createdAt,
      correlationId,
      causationId: available.eventId,
      actor: engine,
      requestHash: undefined,
    },
  );
  assertReplayEventPayload(
    started,
    { assignmentId: assignment.assignmentId, attempt: 1 },
    {
      type: 'assignment.started',
      entityId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      timestamp: operation.createdAt,
      correlationId,
      causationId: claimed.eventId,
      actor: engine,
      requestHash: undefined,
    },
  );
  assertReplayEventPayload(availabilityEvent, availabilityRecord, {
    type: 'capability.availability-recorded',
    entityId: availabilityRecord.availabilityId,
    cycleId: assignment.cycleId,
    timestamp: operation.createdAt,
    correlationId,
    causationId: started.eventId,
    actor: engine,
    requestHash: undefined,
  });
  assertReplayEventPayload(grantEvent, initialGrant, {
    type: 'capability.granted',
    entityId: grant.grantId,
    cycleId: assignment.cycleId,
    timestamp: operation.createdAt,
    correlationId,
    causationId: availabilityEvent.eventId,
    actor: engine,
    requestHash: undefined,
  });
  if (intentEvent.causationId !== grantEvent.eventId) {
    throw runtimeError(
      'OPERATION_CONFLICT',
      'Execute intent must be caused by the exact capability grant Event.',
      {
        operationId: operation.operationId,
      },
    );
  }
}

function assertOperatingTerminalExecutionProjectionsV2({
  index,
  operation,
  assignment,
  action,
  result,
  artifact,
  submission,
  submissionReplay,
  unusedSubmission,
  reservation,
  unusedReservation,
}) {
  const registration = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.executors.find(
    (candidate) =>
      candidate.executorId === operation.executor.executorId &&
      candidate.executorVersion === operation.executor.executorVersion,
  );
  const cycle = index.cycles.get(action.sourceCycleId);
  const canonicalBytes = Buffer.from(canonicalizeJson(result), 'utf8');
  const expectedRawHash = rawHashForBytes(canonicalBytes);
  const acceptanceEventIds = [
    reservation.eventIds.submitted,
    reservation.eventIds.artifactCreated,
    reservation.eventIds.validated,
  ];
  const responseData = {
    accepted: true,
    artifactId: artifact?.artifactId,
    rawHash: expectedRawHash,
    sizeBytes: canonicalBytes.byteLength,
    assignmentState: 'validated',
  };
  const expectedAssignment =
    assignment && registration
      ? {
          kind: 'operating-assignment',
          schemaVersion: '1.0.0',
          protocolVersion: PROTOCOL_VERSION,
          assignmentId: operation.assignmentId,
          cycleId: action.sourceCycleId,
          assignmentKind: 'execution',
          roleId: 'operate-governed-executor',
          objective: `Execute the approved Action ${action.actionId} at most once within its governed target binding.`,
          state: 'validated',
          dependsOn: [],
          dependencyPolicy: { kind: 'none' },
          inputArtifactIds: [...operation.inputArtifactIds].sort(),
          inputAbsences: [],
          outputContract: {
            schemaId: 'operating-execution-result',
            schemaVersion: PROTOCOL_VERSION,
            mediaType: 'application/json',
            encoding: 'utf-8',
            maxBytes: 262144,
          },
          capabilityGrantId: operation.grantId,
          governedOperationId: operation.operationId,
          attemptPolicy: { maxAttempts: 1, attempt: 1, timeoutMs: 30000 },
          claim: {
            actorId: index.capabilityGrants.get(operation.grantId)?.issuer?.id,
            actorKind: 'agent',
            runtime: `planr-pipeline@${registration.provenance.packageVersion}`,
            claimId: assignment.claim?.claimId,
          },
          terminalOutcome: null,
          createdAt: operation.createdAt,
          availableAt: operation.createdAt,
          completedAt: result.completedAt,
        }
      : null;
  const expectedArtifact =
    artifact && assignment && cycle
      ? {
          kind: 'operating-artifact',
          schemaVersion: '1.0.0',
          protocolVersion: PROTOCOL_VERSION,
          artifactId: reservation.resultArtifactId,
          artifactType: 'operating-execution-result',
          assignmentId: assignment.assignmentId,
          cycleId: assignment.cycleId,
          scopeId: cycle.scopeId,
          domainId: cycle.domainId,
          domainVersion: cycle.domainVersion,
          schemaId: 'operating-execution-result',
          artifactSchemaVersion: PROTOCOL_VERSION,
          mediaType: 'application/json',
          encoding: 'utf-8',
          rawHash: expectedRawHash,
          canonicalHash: sha256Jcs(result),
          sizeBytes: canonicalBytes.byteLength,
          storageClass: 'machine-local',
          sensitivity: 'internal',
          retentionClass: 'project',
          producer: {
            actorId: assignment.claim?.actorId,
            roleId: 'operate-governed-executor',
            runtime: assignment.claim?.runtime,
          },
          inputArtifactIds: clone(operation.inputArtifactIds),
          createdAt: result.completedAt,
        }
      : null;
  const expectedSubmission = assignment
    ? {
        kind: 'operating-submission',
        schemaVersion: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
        submissionId: reservation.submissionId,
        assignmentId: assignment.assignmentId,
        cycleId: assignment.cycleId,
        state: 'accepted',
        rawHash: expectedRawHash,
        canonicalHash: sha256Jcs(result),
        sizeBytes: canonicalBytes.byteLength,
        artifactId: reservation.resultArtifactId,
        acceptanceEventIds,
        responseData,
        issuedAt: operation.createdAt,
        resolvedAt: result.completedAt,
      }
    : null;
  const expectedReplay = assignment
    ? {
        submissionId: reservation.submissionId,
        assignmentId: assignment.assignmentId,
        rawHash: expectedRawHash,
        canonicalHash: sha256Jcs(result),
        sizeBytes: canonicalBytes.byteLength,
        artifactId: reservation.resultArtifactId,
        acceptanceEventIds,
        responseData,
      }
    : null;
  const expectedUnusedSubmission = assignment
    ? {
        kind: 'operating-submission',
        schemaVersion: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
        submissionId: unusedReservation.submissionId,
        assignmentId: assignment.assignmentId,
        cycleId: assignment.cycleId,
        state: 'issued',
        rawHash: null,
        canonicalHash: null,
        sizeBytes: null,
        artifactId: null,
        acceptanceEventIds: [],
        responseData: null,
        issuedAt: operation.createdAt,
        resolvedAt: null,
      }
    : null;
  if (
    !registration ||
    !cycle ||
    typeof assignment?.claim?.claimId !== 'string' ||
    sha256Jcs(assignment) !== sha256Jcs(expectedAssignment) ||
    sha256Jcs(artifact) !== sha256Jcs(expectedArtifact) ||
    sha256Jcs(submission) !== sha256Jcs(expectedSubmission) ||
    sha256Jcs(submissionReplay) !== sha256Jcs(expectedReplay) ||
    sha256Jcs(unusedSubmission) !== sha256Jcs(expectedUnusedSubmission)
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Terminal execution projections do not equal the exact runtime-owned Assignment, Submission, Artifact, and replay records.',
      {
        operationId: operation?.operationId ?? null,
        resultId: result?.resultId ?? null,
      },
    );
  }
}

function actionAtExecutionAuthority(action) {
  return action?.state === 'approved' ? action : { ...clone(action), state: 'approved' };
}

function sameOperatingScope(left, right) {
  return (
    left?.scopeId === right?.scopeId &&
    left?.domainId === right?.domainId &&
    left?.domainVersion === right?.domainVersion
  );
}

function assertOperatingActionCyclePlanOwnershipV2({
  action,
  cycle,
  verificationPlan,
  operation,
  allowAbsentOptionalRecords = false,
}) {
  const cyclePresent = cycle !== null && cycle !== undefined;
  const verificationPlanPresent = verificationPlan !== null && verificationPlan !== undefined;
  if (
    !action ||
    (!allowAbsentOptionalRecords && (!cyclePresent || !verificationPlanPresent)) ||
    (cyclePresent &&
      (cycle.cycleId !== action.sourceCycleId || !sameOperatingScope(action, cycle))) ||
    (verificationPlanPresent &&
      (verificationPlan.verificationPlanId !== action.verificationPlanId ||
        verificationPlan.actionId !== action.actionId ||
        !sameOperatingScope(action, verificationPlan))) ||
    (operation && operation.verificationPlanId !== action.verificationPlanId)
  ) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Execution verification must bind one exact Action, Cycle, and verification-plan scope and domain version.',
      {
        actionId: action?.actionId ?? null,
        cycleId: cycle?.cycleId ?? null,
        verificationPlanId: verificationPlan?.verificationPlanId ?? null,
        operationId: operation?.operationId ?? null,
      },
    );
  }
}

function assertOperatingTerminalExecutionChainV2({ index, result, operation, resultEvent }) {
  const assignment = index.assignments.get(result.assignmentId);
  const grant = index.capabilityGrants.get(result.grantId);
  const artifact = index.artifacts.get(result.resultArtifactId);
  const replayEntry = index.operationReplayIndex.get(result.operationId);
  const action = index.actions.get(result.action.actionId);
  const authorityAction = actionAtExecutionAuthority(action);
  const cycle = action ? index.cycles.get(action.sourceCycleId) : null;
  const verificationPlan = operation
    ? index.verificationPlans.get(operation.verificationPlanId)
    : null;
  const evaluation = index.policyEvaluations.get(result.evaluationId);
  const capabilityAvailabilityMatches = [...index.capabilityAvailability.values()].filter(
    (candidate) =>
      candidate.checkedAt === operation?.createdAt &&
      sha256Jcs(candidate.capability) === sha256Jcs(operation?.capability) &&
      sha256Jcs(candidate.target) === sha256Jcs(operation?.target),
  );
  const capabilityAvailability =
    capabilityAvailabilityMatches.length === 1 ? capabilityAvailabilityMatches[0] : null;
  const reservation = reservedExecutionTerminalForStatus(replayEntry, result.status);
  const submission = replayEntry ? index.submissions.get(reservation.submissionId) : null;
  const submissionReplay = submission ? index.replay.get(submission.submissionId) : null;
  const requirements =
    evaluation?.approvalRequirementIds.map((id) => index.approvalRequirements.get(id)) ?? [];
  const approvals = evaluation
    ? [...index.approvalRecords.values()].filter(
        ({ evaluationId }) => evaluationId === evaluation.evaluationId,
      )
    : [];
  const terminalEventIds = reservation.eventIds;
  const unusedReservation = ['succeeded', 'partial'].includes(result.status)
    ? reservedExecutionTerminalForStatus(replayEntry, 'uncertain')
    : reservedExecutionTerminalForStatus(replayEntry, 'succeeded');
  const unusedSubmission = replayEntry
    ? index.submissions.get(unusedReservation.submissionId)
    : null;
  const submittedEvent = index.eventReplay.get(terminalEventIds.submitted);
  const artifactEvent = index.eventReplay.get(terminalEventIds.artifactCreated);
  const validatedEvent = index.eventReplay.get(terminalEventIds.validated);
  const terminalEvent = resultEvent ?? index.eventReplay.get(terminalEventIds.resultRecorded);
  const submittedCause = submittedEvent
    ? [...index.eventReplay.values()].find(
        ({ sequence }) => sequence === submittedEvent.sequence - 1,
      )
    : null;
  const intentEvent = operation ? index.eventReplay.get(operation.intentEventId) : null;
  const exactOperationFields = [
    'operationId',
    'operationKind',
    'requestFingerprint',
    'action',
    'assignmentId',
    'evaluationId',
    'approvalIds',
    'grantId',
    'capability',
    'target',
    'effectClass',
    'executor',
    'connector',
    'inputArtifactIds',
    'verificationPlanId',
    'rollbackPlanId',
  ];
  const expectedResultEventIds =
    operation && replayEntry
      ? [
          operation.intentEventId,
          terminalEventIds.submitted,
          terminalEventIds.artifactCreated,
          terminalEventIds.validated,
          terminalEventIds.resultRecorded,
        ]
      : [];
  const canonicalBytes = Buffer.from(canonicalizeJson(result), 'utf8');
  let disposition = null;
  try {
    if (evaluation && authorityAction && requirements.every(Boolean) && approvals.every(Boolean)) {
      const authorityApprovals = approvals.map((approval) => {
        if (approval.consumedByOperationId === null) return approval;
        const restored = { ...clone(approval), consumedByOperationId: null };
        restored.recordHash = sha256Jcs(recordWithoutHash(restored, 'recordHash'));
        return restored;
      });
      disposition = evaluateOperatingApprovalSetV2({
        evaluation,
        action: authorityAction,
        requirements,
        approvals: authorityApprovals,
        now: operation.createdAt,
      });
    }
  } catch {
    disposition = null;
  }
  if (verificationPlan) {
    assertOperatingActionCyclePlanOwnershipV2({ action, cycle, verificationPlan, operation });
  }
  if (
    !operation ||
    !assignment ||
    !grant ||
    !artifact ||
    !replayEntry ||
    !action ||
    !evaluation ||
    !capabilityAvailability ||
    !submission ||
    !submissionReplay ||
    !unusedSubmission ||
    !terminalEvent ||
    !intentEvent ||
    !submittedCause ||
    submittedEvent.causationId !== submittedCause.eventId ||
    submittedEvent.sequence <= intentEvent.sequence ||
    operation.resultId !== result.resultId ||
    operation.state !== result.status ||
    operation.updatedAt !== result.completedAt ||
    Date.parse(operation.updatedAt) < Date.parse(operation.createdAt) ||
    replayEntry.terminalResultId !== result.resultId ||
    reservation.resultId !== result.resultId ||
    reservation.resultArtifactId !== result.resultArtifactId ||
    reservation.submissionId !== submission.submissionId ||
    replayEntry.reservedCompletedAt !== result.completedAt ||
    replayEntry.reservedCorrelationId !== terminalEvent.correlationId ||
    assignment.assignmentKind !== 'execution' ||
    assignment.state !== 'validated' ||
    assignment.governedOperationId !== operation.operationId ||
    assignment.capabilityGrantId !== operation.grantId ||
    assignment.cycleId !== action.sourceCycleId ||
    !assignment.objective.includes('at most once') ||
    assignment.outputContract.schemaId !== 'operating-execution-result' ||
    assignment.outputContract.schemaVersion !== PROTOCOL_VERSION ||
    assignment.outputContract.mediaType !== 'application/json' ||
    assignment.outputContract.encoding !== 'utf-8' ||
    !sameCanonicalStringSet(assignment.inputArtifactIds, operation.inputArtifactIds) ||
    operation.action.revision !== action.revision ||
    operation.action.actionHash !== action.actionHash ||
    operation.evaluationId !== evaluation.evaluationId ||
    sha256Jcs(evaluation.action) !== sha256Jcs(operation.action) ||
    !sameCanonicalStringSet(operation.approvalIds, disposition?.approvalIds ?? []) ||
    disposition?.complete !== true ||
    disposition?.disposition !== 'approved' ||
    approvals.some((approval) =>
      operation.approvalIds.includes(approval.approvalId)
        ? approval.consumedByOperationId !== operation.operationId
        : approval.consumedByOperationId !== null,
    ) ||
    grant.operationId !== operation.operationId ||
    grant.assignmentId !== assignment.assignmentId ||
    grant.evaluationId !== evaluation.evaluationId ||
    !sameCanonicalStringSet(grant.approvalIds, operation.approvalIds) ||
    sha256Jcs(grant.action) !== sha256Jcs(operation.action) ||
    sha256Jcs(grant.capability) !== sha256Jcs(operation.capability) ||
    sha256Jcs(grant.target) !== sha256Jcs(operation.target) ||
    grant.effectClass !== operation.effectClass ||
    exactOperationFields.some(
      (field) => sha256Jcs(result[field]) !== sha256Jcs(operation[field]),
    ) ||
    !sameCanonicalStringSet(result.eventIds, expectedResultEventIds) ||
    submission.assignmentId !== assignment.assignmentId ||
    submission.state !== 'accepted' ||
    submission.artifactId !== artifact.artifactId ||
    !sameCanonicalStringSet(submission.acceptanceEventIds, expectedResultEventIds.slice(1, 4)) ||
    artifact.assignmentId !== assignment.assignmentId ||
    artifact.schemaId !== 'operating-execution-result' ||
    artifact.artifactSchemaVersion !== PROTOCOL_VERSION ||
    artifact.mediaType !== 'application/json' ||
    artifact.encoding !== 'utf-8' ||
    !sameCanonicalStringSet(artifact.inputArtifactIds, operation.inputArtifactIds) ||
    artifact.rawHash !== rawHashForBytes(canonicalBytes) ||
    artifact.canonicalHash !== sha256Jcs(result) ||
    artifact.sizeBytes !== canonicalBytes.byteLength
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Execution result must equal the exact accepted bytes, authority, operation, and reserved terminal chain.',
      {
        resultId: result?.resultId ?? null,
        operationId: result?.operationId ?? null,
      },
    );
  }
  const historicalOperation = {
    ...clone(operation),
    state: 'dispatching',
    resultId: null,
    updatedAt: operation.createdAt,
    operationHash: replayEntry.operationHash,
  };
  assertOperatingExecuteOperationV2({
    operation: historicalOperation,
    action: authorityAction,
    assignment,
    evaluation,
    evaluations: [...index.policyEvaluations.values()],
    configuredPolicies: [...index.actionPolicies.values()],
    grant,
    requirements,
    approvals,
    capabilityAvailability,
    request: {
      payload: {
        artifactId: replayEntry.payloadArtifactId,
        contentHash: replayEntry.payloadHash,
      },
      rollbackBaseline:
        replayEntry.baselineArtifactId === null
          ? null
          : {
              artifactId: replayEntry.baselineArtifactId,
              contentHash: replayEntry.baselineHash,
            },
    },
    timestamp: operation.createdAt,
  });
  assertOperatingTerminalExecutionProjectionsV2({
    index,
    operation,
    assignment,
    action,
    result,
    artifact,
    submission,
    submissionReplay,
    unusedSubmission,
    reservation,
    unusedReservation,
  });
  assertOperatingValidatedDependencyProofV2({
    assignment,
    submission,
    artifact,
    replay: submissionReplay,
  });
  assertReplayEventPayload(
    submittedEvent,
    {
      assignmentId: assignment.assignmentId,
      submissionId: submission.submissionId,
      rawHash: artifact.rawHash,
      canonicalHash: artifact.canonicalHash,
      sizeBytes: artifact.sizeBytes,
      mediaType: artifact.mediaType,
      encoding: artifact.encoding,
    },
    {
      type: 'assignment.submitted',
      entityId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      timestamp: result.completedAt,
      correlationId: replayEntry.reservedCorrelationId,
      causationId: submittedCause.eventId,
      actor: { kind: 'runtime', id: 'openplanr' },
      requestHash: undefined,
    },
  );
  assertReplayEventPayload(artifactEvent, artifact, {
    type: 'artifact.created',
    entityId: artifact.artifactId,
    cycleId: assignment.cycleId,
    timestamp: result.completedAt,
    correlationId: replayEntry.reservedCorrelationId,
    causationId: submittedEvent.eventId,
    actor: { kind: 'runtime', id: 'openplanr' },
    requestHash: undefined,
  });
  assertReplayEventPayload(
    validatedEvent,
    {
      assignmentId: assignment.assignmentId,
      submissionId: submission.submissionId,
      artifactId: artifact.artifactId,
      validatorVersion: 'operate-governed-execution-v2@1.0.0',
    },
    {
      type: 'assignment.validated',
      entityId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      timestamp: result.completedAt,
      correlationId: replayEntry.reservedCorrelationId,
      causationId: artifactEvent.eventId,
      actor: { kind: 'runtime', id: 'openplanr' },
      requestHash: undefined,
    },
  );
  assertReplayEventPayload(
    terminalEvent,
    { result, receipt: replayEntry.terminalReceipt },
    {
      type: 'execution.result-recorded',
      entityId: result.resultId,
      cycleId: assignment.cycleId,
      timestamp: result.completedAt,
      correlationId: replayEntry.reservedCorrelationId,
      causationId: validatedEvent.eventId,
      actor: { kind: 'engine', id: grant.issuer.id },
      requestHash: undefined,
    },
  );
  assertOperatingExecutionResultSemanticsV2({
    result,
    operation: {
      ...operation,
      state: 'dispatching',
      resultId: null,
      updatedAt: operation.createdAt,
    },
    replayEntry,
    grant,
    receiptProof: replayEntry.terminalReceipt,
  });
}

function hasCapability(context, operation) {
  const capabilities =
    context.capabilities instanceof Set
      ? context.capabilities
      : new Set(context.capabilities ?? []);
  return capabilities.has(operation);
}

function denied(code, message, context = {}, retryable = false) {
  return Object.freeze({
    allowed: false,
    error: Object.freeze({ code, message, retryable, context }),
  });
}

function allowed() {
  return Object.freeze({ allowed: true, error: null });
}

function requireCapability(context, operation) {
  return hasCapability(context, operation)
    ? null
    : denied('CAPABILITY_DENIED', `Capability ${operation} is required.`, { operation });
}

function cycleIdentityArguments(context) {
  return typeof context.cycle?.cycleId === 'string' ? { cycleId: context.cycle.cycleId } : null;
}

function claimArguments(context) {
  const actor = context.actor;
  if (
    typeof context.assignment?.assignmentId !== 'string' ||
    !actor ||
    typeof actor.actorId !== 'string' ||
    !['agent', 'human'].includes(actor.kind) ||
    typeof actor.runtime !== 'string'
  )
    return null;
  return {
    assignmentId: context.assignment.assignmentId,
    actor: { actorId: actor.actorId, kind: actor.kind, runtime: actor.runtime },
  };
}

function submitArguments(context) {
  const request = context.submitRequest;
  if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
  return clone(request);
}

function startArguments(context) {
  return context.startRequest && typeof context.startRequest === 'object'
    ? clone(context.startRequest)
    : null;
}

function reviewIdentityArguments(context) {
  if (context.reviewReadRequest && typeof context.reviewReadRequest === 'object') {
    return clone(context.reviewReadRequest);
  }
  const { review, cycle, actor } = context;
  const scope =
    context.scope ??
    (cycle
      ? {
          scopeId: cycle.scopeId,
          domainId: cycle.domainId,
          domainVersion: cycle.domainVersion,
        }
      : null);
  if (
    typeof review?.reviewId !== 'string' ||
    typeof cycle?.cycleId !== 'string' ||
    !actor ||
    actor.kind !== 'human' ||
    typeof actor.actorId !== 'string' ||
    typeof actor.runtime !== 'string' ||
    !scope
  )
    return null;
  return {
    reviewId: review.reviewId,
    cycleId: cycle.cycleId,
    actor: { actorId: actor.actorId, kind: 'human', runtime: actor.runtime },
    scope: clone(scope),
  };
}

function validateReviewGetRequestShape(request) {
  try {
    assertProtocolArtifact(
      'operate-tool-call',
      {
        kind: 'operate-tool-call',
        schemaVersion: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
        direction: 'request',
        operation: 'operate.review.get',
        request: clone(request),
      },
      { protocolVersion: PROTOCOL_VERSION },
    );
    return true;
  } catch {
    return false;
  }
}

function validateReviewRequestShape(request) {
  try {
    assertProtocolArtifact(
      'operate-tool-call',
      {
        kind: 'operate-tool-call',
        schemaVersion: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
        direction: 'request',
        operation: 'operate.review.submit',
        request: clone(request),
      },
      { protocolVersion: PROTOCOL_VERSION },
    );
    return true;
  } catch {
    return false;
  }
}

function checkCycleReadable(context, operation) {
  const capabilityFailure = requireCapability(context, operation);
  if (capabilityFailure) return capabilityFailure;
  if (!context.cycle) return denied('CYCLE_NOT_FOUND', 'The operating cycle does not exist.', {});
  return allowed();
}

function checkCycleResume(context) {
  const readable = checkCycleReadable(context, 'operate.cycle.resume');
  if (!readable.allowed) return readable;
  if (TERMINAL_CYCLE_STATES.has(context.cycle.state)) {
    return denied('CYCLE_TERMINAL', `Cycle ${context.cycle.cycleId} is terminal.`, {
      cycleId: context.cycle.cycleId,
      state: context.cycle.state,
    });
  }
  return allowed();
}

function checkAssignmentClaim(context) {
  const capabilityFailure = requireCapability(context, 'operate.assignment.claim');
  if (capabilityFailure) return capabilityFailure;
  const assignment = context.assignment;
  if (!assignment) return denied('ASSIGNMENT_NOT_AVAILABLE', 'The assignment is unavailable.', {});
  try {
    assertProtocolArtifact('operating-assignment', assignment, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch {
    return denied('RESULT_CONTRACT_INVALID', 'The Assignment contract is invalid.', {});
  }
  if (assignment.state === 'claimed' || assignment.state === 'running') {
    return denied(
      'ASSIGNMENT_ALREADY_CLAIMED',
      `Assignment ${assignment.assignmentId} is already claimed.`,
      {
        assignmentId: assignment.assignmentId,
        state: assignment.state,
      },
    );
  }
  if (assignment.state !== 'available') {
    return denied(
      'ASSIGNMENT_NOT_AVAILABLE',
      `Assignment ${assignment.assignmentId} is not available.`,
      {
        assignmentId: assignment.assignmentId,
        state: assignment.state,
      },
    );
  }
  return allowed();
}

function checkAssignmentSubmit(context) {
  const capabilityFailure = requireCapability(context, 'operate.assignment.submit');
  if (capabilityFailure) return capabilityFailure;
  const assignment = context.assignment;
  if (!assignment) return denied('ASSIGNMENT_NOT_AVAILABLE', 'The assignment is unavailable.', {});
  try {
    assertProtocolArtifact('operating-assignment', assignment, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch {
    return denied('RESULT_CONTRACT_INVALID', 'The Assignment contract is invalid.', {});
  }
  const submission = context.submission;
  if (!submission || typeof submission !== 'object' || Array.isArray(submission)) {
    return denied(
      'SUBMISSION_ID_CONFLICT',
      'The issued submission identity does not match the assignment.',
      {
        assignmentId: assignment.assignmentId,
      },
    );
  }
  try {
    assertProtocolArtifact('operating-submission', submission, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch {
    return denied('SUBMISSION_ID_CONFLICT', 'The runtime-issued submission record is invalid.', {
      assignmentId: assignment.assignmentId,
    });
  }
  const request = context.submitRequest;
  if (!validateSubmitRequestShape(request)) {
    return denied('RESULT_CONTRACT_INVALID', 'The submission request is malformed.', {
      assignmentId: assignment.assignmentId,
      submissionId: submission.submissionId,
    });
  }
  if (
    !actorMatchesClaim(request.actor, assignment.claim) ||
    !actorMatchesClaim(context.actor, assignment.claim) ||
    request.actor.actorId !== context.actor.actorId ||
    request.actor.kind !== context.actor.kind ||
    request.actor.runtime !== context.actor.runtime
  ) {
    return denied(
      'CAPABILITY_DENIED',
      'Only the exact retained Assignment claimant may submit this result.',
      {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
      },
    );
  }
  if (assignment.state === 'validated' && submission.state === 'accepted') {
    try {
      validateExactAcceptedSubmissionReplay({
        request,
        assignment,
        submission,
        artifact: context.artifact,
        replay: context.submissionReplay,
      });
      return allowed();
    } catch (error) {
      return denied(
        error.code ?? 'ASSIGNMENT_ALREADY_SUBMITTED',
        error.message,
        error.details?.context ?? {
          assignmentId: assignment.assignmentId,
          submissionId: submission.submissionId,
        },
      );
    }
  }
  if (assignment.state === 'submitted' || TERMINAL_ASSIGNMENT_STATES.has(assignment.state)) {
    return denied(
      'ASSIGNMENT_ALREADY_SUBMITTED',
      `Assignment ${assignment.assignmentId} cannot accept another submission.`,
      {
        assignmentId: assignment.assignmentId,
        state: assignment.state,
      },
    );
  }
  if (assignment.state !== 'running') {
    return denied(
      'STATE_TRANSITION_INVALID',
      `Assignment ${assignment.assignmentId} is not running.`,
      {
        assignmentId: assignment.assignmentId,
        state: assignment.state,
      },
    );
  }
  if (submission.state !== 'issued') {
    return denied(
      'ASSIGNMENT_ALREADY_SUBMITTED',
      `Submission ${submission.submissionId} is already resolved.`,
      {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
        submissionState: submission.state,
      },
    );
  }
  if (
    submission.rawHash !== null ||
    submission.canonicalHash !== null ||
    submission.sizeBytes !== null ||
    submission.artifactId !== null ||
    submission.acceptanceEventIds.length !== 0 ||
    submission.responseData !== null ||
    submission.resolvedAt !== null
  ) {
    return denied(
      'ASSIGNMENT_ALREADY_SUBMITTED',
      `Submission ${submission.submissionId} contains prior attempt material.`,
      {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
      },
    );
  }
  if (
    submission.assignmentId !== assignment.assignmentId ||
    submission.cycleId !== assignment.cycleId ||
    request.assignmentId !== assignment.assignmentId ||
    request.submissionId !== submission.submissionId
  ) {
    return denied(
      'SUBMISSION_ID_CONFLICT',
      'The submission request does not match the runtime-issued assignment binding.',
      {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
      },
    );
  }
  if (
    request.mediaType !== assignment.outputContract.mediaType ||
    request.encoding !== assignment.outputContract.encoding
  ) {
    return denied(
      'RESULT_CONTRACT_INVALID',
      'The submission media type or encoding does not match the assignment contract.',
      {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
      },
    );
  }
  if (decodedBase64Size(request.contentBase64) > assignment.outputContract.maxBytes) {
    return denied('RESULT_CONTRACT_INVALID', 'The submission exceeds the assignment byte limit.', {
      assignmentId: assignment.assignmentId,
      submissionId: submission.submissionId,
      maxBytes: assignment.outputContract.maxBytes,
    });
  }
  try {
    validateSubmissionBodyForAssignment(Buffer.from(request.contentBase64, 'base64'), assignment);
  } catch (error) {
    if (error?.code) {
      return denied(error.code, error.message, error.details?.context ?? {});
    }
    return denied(
      'RESULT_CONTRACT_INVALID',
      'The submission is not valid UTF-8 JSON for its declared contract.',
    );
  }
  return allowed();
}

function checkArtifactRead(context) {
  const capabilityFailure = requireCapability(context, 'operate.artifact.get');
  if (capabilityFailure) return capabilityFailure;
  const request = context.artifactRequest;
  if (!validateArtifactGetRequestShape(request)) {
    return denied('RESULT_CONTRACT_INVALID', 'The Artifact read request is malformed.', {});
  }
  const artifact = context.artifact;
  if (!artifact || artifact.artifactId !== request.artifactId) {
    return denied('ARTIFACT_NOT_FOUND', 'The artifact does not exist.', {});
  }
  try {
    assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: PROTOCOL_VERSION });
    if (context.assignment !== undefined && context.assignment !== null) {
      assertProtocolArtifact('operating-assignment', context.assignment, {
        protocolVersion: PROTOCOL_VERSION,
      });
    }
  } catch {
    return denied(
      'CAPABILITY_DENIED',
      'Artifact read context is not a valid runtime-issued contract.',
      {},
    );
  }
  if (
    !context.actor ||
    context.actor.actorId !== request.actor.actorId ||
    context.actor.kind !== request.actor.kind ||
    context.actor.runtime !== request.actor.runtime
  ) {
    return denied(
      'CAPABILITY_DENIED',
      'Artifact reads must retain the exact requesting actor.',
      {},
    );
  }
  if (
    artifact.scopeId !== request.scope.scopeId ||
    artifact.domainId !== request.scope.domainId ||
    artifact.domainVersion !== request.scope.domainVersion
  ) {
    return denied(
      'OPERATING_SCOPE_INVALID',
      'Artifact read scope does not match its owner-issued metadata.',
      {
        ...(request.assignmentId === null ? {} : { assignmentId: request.assignmentId }),
      },
    );
  }
  if (request.actor.kind === 'agent') {
    const assignment = context.assignment;
    if (
      !assignment ||
      assignment.assignmentId !== request.assignmentId ||
      assignment.state !== 'running'
    ) {
      return denied(
        'ASSIGNMENT_NOT_AVAILABLE',
        'Agent Artifact reads require one running issued Assignment.',
        {
          assignmentId: request.assignmentId,
        },
      );
    }
    if (!actorMatchesClaim(request.actor, assignment.claim)) {
      return denied(
        'CAPABILITY_DENIED',
        'Agent Artifact reads require the exact retained Assignment claimant.',
        {
          assignmentId: assignment.assignmentId,
        },
      );
    }
    if (
      assignment.cycleId !== artifact.cycleId ||
      !assignment.inputArtifactIds.includes(artifact.artifactId)
    ) {
      return denied(
        'CAPABILITY_DENIED',
        'The Artifact is outside this Assignment issued input set.',
        {
          assignmentId: assignment.assignmentId,
        },
      );
    }
    return allowed();
  }
  const membership = context.scopeMembership;
  if (
    !membership ||
    membership.active !== true ||
    membership.actorId !== request.actor.actorId ||
    membership.scopeId !== request.scope.scopeId ||
    membership.domainId !== request.scope.domainId ||
    membership.domainVersion !== request.scope.domainVersion
  ) {
    return denied(
      'CAPABILITY_DENIED',
      'Human Artifact reads require explicit adapter-owned scope membership.',
      {},
    );
  }
  if (request.assignmentId !== null) {
    const assignment = context.assignment;
    if (
      !assignment ||
      assignment.assignmentId !== request.assignmentId ||
      assignment.cycleId !== artifact.cycleId
    ) {
      return denied(
        'ASSIGNMENT_NOT_AVAILABLE',
        'The requested Assignment does not authorize this human read.',
        {
          assignmentId: request.assignmentId,
        },
      );
    }
  }
  return allowed();
}

function checkReviewReadable(context) {
  const capabilityFailure = requireCapability(context, 'operate.review.get');
  if (capabilityFailure) return capabilityFailure;
  const request = context.reviewReadRequest;
  if (!validateReviewGetRequestShape(request)) {
    return denied('RESULT_CONTRACT_INVALID', 'The Review read request is malformed.', {});
  }
  const review = context.review;
  const cycle = context.cycle;
  if (
    !review ||
    !cycle ||
    review.reviewId !== request.reviewId ||
    review.cycleId !== request.cycleId ||
    cycle.cycleId !== request.cycleId
  ) {
    return denied('REVIEW_NOT_FOUND', 'The exact Review and bound Cycle do not exist.', {
      reviewId: request.reviewId,
      cycleId: request.cycleId,
    });
  }
  try {
    assertProtocolArtifact('operating-review', review, { protocolVersion: PROTOCOL_VERSION });
    assertProtocolArtifact('operating-cycle', cycle, { protocolVersion: PROTOCOL_VERSION });
  } catch {
    return denied('RESULT_CONTRACT_INVALID', 'The Review or Cycle contract is invalid.', {
      reviewId: request.reviewId,
      cycleId: request.cycleId,
    });
  }
  if (
    !context.actor ||
    context.actor.actorId !== request.actor.actorId ||
    context.actor.kind !== request.actor.kind ||
    context.actor.runtime !== request.actor.runtime ||
    request.actor.kind !== 'human' ||
    request.actor.actorId !== review.ownerActorId
  ) {
    return denied(
      'REVIEW_NOT_AUTHORIZED',
      'Only the exact immutable human Review owner may read it.',
      {
        reviewId: review.reviewId,
        state: 'actor.actorId',
      },
    );
  }
  if (
    request.scope.scopeId !== cycle.scopeId ||
    request.scope.domainId !== cycle.domainId ||
    request.scope.domainVersion !== cycle.domainVersion
  ) {
    return denied(
      'OPERATING_SCOPE_INVALID',
      'The Review read scope does not match its exact Cycle.',
      {
        reviewId: review.reviewId,
        cycleId: cycle.cycleId,
      },
    );
  }
  if (review.state !== 'pending') {
    return denied('REVIEW_NOT_PENDING', 'Only a pending Review has a pre-commit owner read.', {
      reviewId: review.reviewId,
      state: review.state,
    });
  }
  if (
    review.subject?.type !== 'action' &&
    (cycle.state !== 'awaiting_review' || cycle.activeReviewId !== review.reviewId)
  ) {
    return denied(
      'REVIEW_NOT_FOUND',
      'A Cycle Review must be the exact active awaiting-review gate.',
      {
        reviewId: review.reviewId,
        cycleId: cycle.cycleId,
      },
    );
  }
  return allowed();
}

function checkReviewSubmit(context) {
  return authorityGuardResult('operate.review.submit', context);
}

function authorityGuardResult(operation, context) {
  return evaluateOperateAuthorityV2(operation, {
    ...context,
    request: operation === 'operate.review.submit' ? context.reviewRequest : context.actionRequest,
  });
}

function checkCycleStart(context) {
  const capabilityFailure = requireCapability(context, 'operate.cycle.start');
  if (capabilityFailure) return capabilityFailure;
  return allowed();
}

const GUARD_IMPLEMENTATIONS_V2 = Object.freeze({
  'cycle-start-authorized': checkCycleStart,
  'cycle-readable': (context) => checkCycleReadable(context, 'operate.cycle.get'),
  'cycle-resumable': checkCycleResume,
  'assignment-claim-authorized': checkAssignmentClaim,
  'assignment-submit-authorized': checkAssignmentSubmit,
  'artifact-readable': checkArtifactRead,
  'review-readable': checkReviewReadable,
  'review-submit-authorized': checkReviewSubmit,
  'action-approval-authorized': (context) =>
    authorityGuardResult('operate.action.approve', context),
  'action-execution-authorized': (context) =>
    authorityGuardResult('operate.action.execute', context),
  'action-rollback-authorized': (context) =>
    authorityGuardResult('operate.action.rollback', context),
});

const ARGUMENT_PROFILE_FACTORIES_V2 = Object.freeze({
  'cycle-start': (context) => (startArguments(context) === null ? [] : [startArguments(context)]),
  'cycle-identity': (context) =>
    cycleIdentityArguments(context) === null ? [] : [cycleIdentityArguments(context)],
  'assignment-claim': (context) =>
    claimArguments(context) === null ? [] : [claimArguments(context)],
  'assignment-submit': (context) =>
    submitArguments(context) === null ? [] : [submitArguments(context)],
  'artifact-get': (context) =>
    artifactArguments(context) === null ? [] : [artifactArguments(context)],
  'review-identity': (context) =>
    reviewIdentityArguments(context) === null ? [] : [reviewIdentityArguments(context)],
  'review-submit': (context) =>
    getOperateAuthorityArgumentCandidatesV2('operate.review.submit', context),
  'action-approve': (context) =>
    getOperateAuthorityArgumentCandidatesV2('operate.action.approve', context),
  'action-execute': (context) =>
    getOperateAuthorityArgumentCandidatesV2('operate.action.execute', context),
  'action-rollback': (context) =>
    getOperateAuthorityArgumentCandidatesV2('operate.action.rollback', context),
});

function contextWithArguments(operation, context, argumentsValue) {
  if (operation === 'operate.review.get') {
    return { ...context, reviewReadRequest: clone(argumentsValue) };
  }
  if (operation === 'operate.review.submit') {
    return { ...context, reviewRequest: clone(argumentsValue) };
  }
  if (operation.startsWith('operate.action.')) {
    return { ...context, actionRequest: clone(argumentsValue) };
  }
  return context;
}

function compiledGuardResult(row, context) {
  if (
    !GOVERNED_AUTHORITY_OPERATIONS_V2.has(row.operation) &&
    row.actorKinds.length > 0 &&
    !row.actorKinds.includes(context.actor?.kind)
  ) {
    const code = row.guardId.startsWith('review-') ? 'REVIEW_NOT_AUTHORIZED' : 'CAPABILITY_DENIED';
    return denied(
      code,
      `Actor kind ${context.actor?.kind ?? '<unknown>'} cannot invoke ${row.operation}.`,
      {
        operation: row.operation,
        ...(row.guardId.startsWith('review-') && context.review
          ? {
              reviewId: context.review.reviewId,
              state: 'actor.kind',
            }
          : {}),
      },
    );
  }
  return row.guard(context);
}

function compileOperateGuardTableV2(catalog) {
  const guards = new Map(catalog.guards.map((guard) => [guard.id, guard]));
  const actions = new Map(catalog.actions.map((action) => [action.operationId, action]));
  return Object.freeze(
    Object.fromEntries(
      catalog.operations.map((operation) => {
        const guard = guards.get(operation.guard);
        const action = actions.get(operation.id);
        const guardImplementation = GUARD_IMPLEMENTATIONS_V2[operation.guard];
        const argumentCandidates = ARGUMENT_PROFILE_FACTORIES_V2[operation.argumentProfile];
        if (!guard || !action || !guardImplementation || !argumentCandidates) {
          throw new Error(
            `The compiled Operate catalog has an incomplete public operation binding for ${operation.id}.`,
          );
        }
        const row = Object.freeze({
          operation: operation.id,
          label: action.label,
          effect: operation.effect,
          guardId: operation.guard,
          actorKinds: Object.freeze([...(guard.actorKinds ?? [])]),
          guard: guardImplementation,
          argumentCandidates,
        });
        return [operation.id, row];
      }),
    ),
  );
}

/** Compiler-owned public action authority. Runtime code supplies only pure guard implementations. */
export const OPERATE_GUARD_TABLE_V2 = compileOperateGuardTableV2(OPERATE_CONTRACT_CATALOG_V2);

export function evaluateOperateGuardV2(operation, context = {}) {
  const row = OPERATE_GUARD_TABLE_V2[operation];
  if (!row) {
    return denied('CONTRACT_VERSION_UNSUPPORTED', `Unknown Operate 2.0 operation ${operation}.`, {
      operation,
    });
  }
  const candidates = row.argumentCandidates(context);
  return candidates.length === 1
    ? compiledGuardResult(row, contextWithArguments(operation, context, candidates[0]))
    : compiledGuardResult(row, context);
}

export function assertOperateAuthorizedV2(operation, context = {}) {
  const row = OPERATE_GUARD_TABLE_V2[operation];
  if (!row) {
    throw runtimeError(
      'CONTRACT_VERSION_UNSUPPORTED',
      `Unknown Operate 2.0 operation ${operation}.`,
      { operation },
    );
  }
  const candidates = row.argumentCandidates(context);
  if (candidates.length === 0) {
    const result = compiledGuardResult(row, context);
    if (!result.allowed) {
      throw runtimeError(
        result.error.code,
        result.error.message,
        result.error.context,
        result.error.retryable,
      );
    }
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      `Operation ${operation} is missing complete typed arguments.`,
      { operation },
    );
  }
  if (candidates.length !== 1) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      `Operation ${operation} requires one explicit typed argument selection.`,
      { operation },
    );
  }
  const [argumentsValue] = candidates;
  const result = compiledGuardResult(row, contextWithArguments(operation, context, argumentsValue));
  if (!result.allowed) {
    throw runtimeError(
      result.error.code,
      result.error.message,
      result.error.context,
      result.error.retryable,
    );
  }
  try {
    assertProtocolArtifact(
      'operate-allowed-action',
      {
        tool: operation,
        arguments: argumentsValue,
        label: row.label,
        effect: row.effect,
      },
      { protocolVersion: PROTOCOL_VERSION },
    );
  } catch {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      `Operation ${operation} has invalid typed arguments.`,
      { operation },
    );
  }
  return GOVERNED_AUTHORITY_OPERATIONS_V2.has(operation) ? result : true;
}

export function deriveOperateAllowedActionsV2(context = {}) {
  const actions = [];
  for (const [tool, row] of Object.entries(OPERATE_GUARD_TABLE_V2)) {
    for (const argumentsValue of row.argumentCandidates(context)) {
      const candidateContext = contextWithArguments(tool, context, argumentsValue);
      if (!compiledGuardResult(row, candidateContext).allowed) continue;
      const action = { tool, arguments: argumentsValue, label: row.label, effect: row.effect };
      try {
        assertProtocolArtifact('operate-allowed-action', action, {
          protocolVersion: PROTOCOL_VERSION,
        });
      } catch {
        // Incomplete or schema-invalid arguments are never advertised.
        continue;
      }
      actions.push(action);
    }
  }
  return actions;
}

export function createOperateFailureEnvelopeV2(operation, context = {}) {
  const result = evaluateOperateGuardV2(operation, context);
  if (result.allowed) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      `Operation ${operation} is authorized and has no guard refusal.`,
      { operation },
    );
  }
  const envelope = {
    ok: false,
    operation,
    error: clone(result.error),
    allowedActions: deriveOperateAllowedActionsV2(context),
  };
  assertProtocolArtifact('operate-api-envelope', envelope, { protocolVersion: PROTOCOL_VERSION });
  return envelope;
}

/**
 * Read one authorized Artifact representation. `decoded-json` is available
 * only after exact raw-byte, UTF-8, JSON, and canonical-hash verification;
 * private bytes never enter an error context or runtime Event.
 */
export function readOperatingArtifactV2(
  request,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    artifactStore,
    capabilities = [],
    scopeMembership = null,
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  if (!validateArtifactGetRequestShape(request)) {
    throw runtimeError('RESULT_CONTRACT_INVALID', 'The Artifact read request is malformed.');
  }
  const index = indexRuntimeState(initialState);
  const artifact = index.artifacts.get(request.artifactId);
  const assignment =
    request.assignmentId === null ? null : index.assignments.get(request.assignmentId);
  const context = {
    capabilities,
    actor: request.actor,
    artifact,
    assignment,
    artifactRequest: request,
    scopeMembership,
  };
  const authorization = evaluateOperateGuardV2('operate.artifact.get', context);
  if (!authorization.allowed) {
    throw runtimeError(
      authorization.error.code,
      authorization.error.message,
      authorization.error.context,
      authorization.error.retryable,
    );
  }
  const data = { metadata: clone(artifact), representation: request.representation };
  if (request.representation !== 'metadata') {
    if (!artifactStore || typeof artifactStore.readRaw !== 'function') {
      throw runtimeError(
        'ARTIFACT_NOT_FOUND',
        'Artifact bytes are unavailable from the exact runtime byte store.',
        {
          artifactId: artifact.artifactId,
        },
      );
    }
    const bytes = readOperatingArtifactRawBytesV2(artifactStore, {
      artifactId: artifact.artifactId,
      rawHash: artifact.rawHash,
    });
    if (request.representation === 'raw') {
      data.contentBase64 = Buffer.from(bytes).toString('base64');
    } else {
      if (
        artifact.mediaType !== 'application/json' ||
        artifact.encoding !== 'utf-8' ||
        artifact.canonicalHash === null
      ) {
        throw runtimeError(
          'RESULT_CONTRACT_INVALID',
          `${request.representation} requires a canonical UTF-8 JSON Artifact.`,
          {
            artifactId: artifact.artifactId,
          },
        );
      }
      let decoded;
      try {
        decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        throw runtimeError('RESULT_CONTRACT_INVALID', 'Artifact bytes are not valid UTF-8 JSON.', {
          artifactId: artifact.artifactId,
        });
      }
      if (sha256Jcs(decoded) !== artifact.canonicalHash) {
        throw runtimeError(
          'ARTIFACT_HASH_MISMATCH',
          'Artifact JSON differs from its immutable canonical hash.',
          {
            artifactId: artifact.artifactId,
          },
        );
      }
      if (request.representation === 'decoded-json') data.contentJson = clone(decoded);
      else data.contentBase64 = Buffer.from(canonicalizeJson(decoded), 'utf8').toString('base64');
    }
  }
  const envelope = {
    ok: true,
    operation: 'operate.artifact.get',
    data,
    allowedActions: deriveOperateAllowedActionsV2(context),
  };
  assertProtocolArtifact('operate-api-envelope', envelope, { protocolVersion: PROTOCOL_VERSION });
  return Object.freeze(envelope);
}

function reviewScope(cycle) {
  return {
    scopeId: cycle.scopeId,
    domainId: cycle.domainId,
    domainVersion: cycle.domainVersion,
  };
}

function reviewLedgerForCycle(index, cycleId) {
  const ledgers = [...index.decisionLedgers.values()].filter(
    (ledger) => index.artifacts.get(ledger.sourceArtifactId)?.cycleId === cycleId,
  );
  if (ledgers.length > 1) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'A Cycle Review requires one exact current Chair ledger.',
      {
        cycleId,
      },
    );
  }
  return ledgers[0] ?? null;
}

function reviewPlanForCycle(index, cycleId, ledger) {
  if (ledger) return index.intelligencePlans.get(ledger.intelligencePlanId) ?? null;
  const planIds = new Set(
    [...index.assignments.values()]
      .filter(
        (assignment) => assignment.cycleId === cycleId && assignment.intelligenceContext !== null,
      )
      .map((assignment) => assignment.intelligenceContext.intelligencePlanId),
  );
  if (planIds.size > 1) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'A Cycle Review cannot project ambiguous intelligence plans.',
      {
        cycleId,
      },
    );
  }
  const [planId] = planIds;
  return planId === undefined ? null : (index.intelligencePlans.get(planId) ?? null);
}

function reviewSeatState(state) {
  return ['claimed', 'running', 'submitted'].includes(state) ? 'running' : state;
}

function buildOperatingReviewSeatStatusV2(index, cycle, ledger) {
  const plan = reviewPlanForCycle(index, cycle.cycleId, ledger);
  if (!plan) return [];
  return plan.selectedRoles.map((role) => {
    const assignments = [...index.assignments.values()].filter(
      (assignment) =>
        assignment.cycleId === cycle.cycleId &&
        assignment.roleId === role.roleId &&
        assignment.roleVersion === role.roleVersion &&
        assignment.intelligenceContext?.intelligencePlanId === plan.planId,
    );
    if (assignments.length !== 1) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Review seat status requires one exact Assignment per selected role.',
        {
          cycleId: cycle.cycleId,
        },
      );
    }
    const [assignment] = assignments;
    const artifacts = [...index.artifacts.values()].filter(
      (artifact) =>
        artifact.assignmentId === assignment.assignmentId &&
        artifact.schemaId === assignment.outputContract.schemaId,
    );
    if (
      (assignment.state === 'validated' && artifacts.length !== 1) ||
      (assignment.state !== 'validated' && artifacts.length !== 0)
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Review seat status found ambiguous accepted Artifact custody.',
        {
          assignmentId: assignment.assignmentId,
        },
      );
    }
    return {
      roleId: role.roleId,
      roleKind: role.roleKind,
      roleVersion: role.roleVersion,
      state: reviewSeatState(assignment.state),
      artifactId: artifacts[0]?.artifactId ?? null,
      absenceIds: assignment.inputAbsences.map(({ absenceId }) => absenceId),
    };
  });
}

function reviewCycleRecords(index, cycleId) {
  const bySourceCycle = (record) => record.sourceCycleId === cycleId;
  return {
    decisions: [...index.decisions.values()]
      .filter(bySourceCycle)
      .sort((left, right) => left.decisionId.localeCompare(right.decisionId)),
    actions: [...index.actions.values()]
      .filter(bySourceCycle)
      .sort((left, right) => left.actionId.localeCompare(right.actionId)),
    findings: [...index.findings.values()]
      .filter(bySourceCycle)
      .sort((left, right) => left.findingId.localeCompare(right.findingId)),
  };
}

function buildOperatingReviewSummariesV2(index, cycle, ledger) {
  const records = reviewCycleRecords(index, cycle.cycleId);
  const decisions = records.decisions.map((decision) => ({
    origin: decision.origin,
    decisionId: decision.decisionId,
    title: decision.title,
    question: decision.question,
    outcome: decision.outcome,
    rationale: decision.rationale,
    confidence: decision.confidence,
    ownerActorId: decision.ownerActorId,
    expectedUpside: decision.expectedUpside,
    expectedDownside: decision.expectedDownside,
    ...(decision.origin === 'operating-intelligence'
      ? {
          uncertainty: decision.uncertainty,
          reversibility: decision.reversibility,
          dissentIds: clone(decision.dissentIds),
        }
      : {}),
    revisitConditions: clone(decision.revisitConditions),
    dissent: clone(decision.dissent),
    evidenceRefIds: clone(decision.evidenceRefIds),
  }));
  const actions = records.actions.map((action) => {
    const verificationPlan = index.verificationPlans.get(action.verificationPlanId);
    if (!verificationPlan || verificationPlan.actionId !== action.actionId) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Review Action summary requires its exact verification plan.',
        {
          cycleId: cycle.cycleId,
        },
      );
    }
    return {
      actionId: action.actionId,
      title: action.title,
      state: action.state,
      ownerActorId: action.ownerActorId,
      sourceDecisionId: action.sourceDecisionId,
      expectedResult: action.expectedResult,
      metricId: action.metricId,
      baseline: action.baseline,
      target: action.target,
      verificationWindow: action.verificationWindow,
      verificationMethod: verificationPlan.method,
    };
  });
  const findings = records.findings.map((finding) => ({
    origin: finding.origin,
    findingId: finding.findingId,
    title: finding.title,
    statement: finding.statement,
    ...(finding.origin === 'operating-intelligence'
      ? {
          findingType: finding.findingType,
          severity: finding.severity,
          confidence: finding.confidence,
          supportingEvidenceRefIds: clone(finding.supportingEvidenceRefIds),
          contradictingEvidenceRefIds: clone(finding.contradictingEvidenceRefIds),
        }
      : {}),
    state: finding.state,
    ownerActorId: finding.ownerActorId,
    revisitAt: finding.revisitAt,
  }));
  const dissent = (ledger?.dissent ?? []).map((entry) => ({
    sourceArtifactId: entry.sourceArtifactId,
    localDissentId: entry.localDissentId,
    statement: entry.statement,
    resolutionCondition: entry.resolutionCondition,
  }));
  const gaps = [
    ...(ledger?.advisorAbsenceGaps ?? []).map(
      ({
        absenceId,
        kind,
        roleId,
        roleKind,
        roleVersion,
        sourceAssignmentId,
        reason,
        recoveryDisposition,
      }) => ({
        absenceId,
        kind,
        roleId,
        roleKind,
        roleVersion,
        sourceAssignmentId,
        reason,
        recoveryDisposition,
      }),
    ),
    ...(ledger?.evidenceGaps ?? []).map(
      ({ absenceId, kind, requirementId, sourceContracts, reason, recoveryDisposition }) => ({
        absenceId,
        kind,
        requirementId,
        sourceContracts: clone(sourceContracts),
        reason,
        recoveryDisposition,
      }),
    ),
  ];
  return { records, decisions, actions, findings, dissent, gaps };
}

function operatingReviewChoice(submitArguments, label) {
  const choiceHash = sha256Jcs(submitArguments);
  return {
    choiceId: `rch_${choiceHash.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    choiceHash,
    label,
    submitArguments: clone(submitArguments),
  };
}

function buildOperatingReviewDispositionChoicesV2({
  review,
  cycle,
  actor,
  scope,
  records,
  timestamp,
}) {
  const base = {
    reviewId: review.reviewId,
    cycleId: cycle.cycleId,
    actor: clone(actor),
    scope: clone(scope),
  };
  const choices = [];
  if (review.subject?.type === 'action') {
    choices.push(
      operatingReviewChoice(
        {
          ...base,
          disposition: 'approved',
          workDispositions: [],
        },
        'Approve this Action review',
      ),
    );
  } else {
    for (const candidate of deriveOperatingReviewWorkDispositionSetsV2({
      cycle,
      findings: records.findings,
      decisions: records.decisions,
      actions: records.actions,
      timestamp,
      reviewOwnerActorId: actor.actorId,
    })) {
      choices.push(
        operatingReviewChoice(
          {
            ...base,
            disposition: 'approved',
            workDispositions: clone(candidate.workDispositions),
          },
          candidate.label,
        ),
      );
    }
  }
  for (const [disposition, label] of [
    ['changes_requested', 'Request changes'],
    ['rejected', 'Reject this Review'],
    ['cancelled', 'Cancel this Review'],
  ]) {
    choices.push(
      operatingReviewChoice(
        {
          ...base,
          disposition,
          workDispositions: [],
        },
        label,
      ),
    );
  }
  return choices;
}

function authorizeOperatingReviewReadV2(request, index, capabilities) {
  const review = index.reviews.get(request.reviewId);
  const cycle = index.cycles.get(request.cycleId);
  const context = {
    capabilities,
    actor: request.actor,
    review,
    cycle,
    scope: request.scope,
    reviewReadRequest: request,
  };
  const authorization = evaluateOperateGuardV2('operate.review.get', context);
  if (!authorization.allowed) {
    throw runtimeError(
      authorization.error.code,
      authorization.error.message,
      authorization.error.context,
      authorization.error.retryable,
    );
  }
  return { review, cycle, context };
}

function buildOperatingReviewReadDataV2({ index, eventHead, review, cycle, actor, readAt }) {
  const ledger = reviewLedgerForCycle(index, cycle.cycleId);
  const summaries = buildOperatingReviewSummariesV2(index, cycle, ledger);
  const scope = reviewScope(cycle);
  return {
    kind: 'operating-review-read',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    cycleId: cycle.cycleId,
    eventHead: clone(eventHead),
    scope,
    reader: clone(actor),
    review: clone(review),
    seatStatus: buildOperatingReviewSeatStatusV2(index, cycle, ledger),
    decisions: summaries.decisions,
    actions: summaries.actions,
    findings: summaries.findings,
    dissent: summaries.dissent,
    gaps: summaries.gaps,
    dispositionChoices: buildOperatingReviewDispositionChoicesV2({
      review,
      cycle,
      actor,
      scope,
      records: summaries.records,
      timestamp: readAt,
    }),
    readAt,
  };
}

/** Exact-owner pre-commit Review projection with byte-replayable choices. */
export function readOperatingReviewV2(
  request,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    capabilities = [],
    readAt = initialState.generatedAt,
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  if (
    !validateReviewGetRequestShape(request) ||
    typeof readAt !== 'string' ||
    Number.isNaN(Date.parse(readAt))
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'The Review read request or runtime-owned timestamp is malformed.',
    );
  }
  const index = indexRuntimeState(initialState);
  const { review, cycle } = authorizeOperatingReviewReadV2(request, index, capabilities);
  // Authorization is intentionally complete before any board summary is built.
  const data = buildOperatingReviewReadDataV2({
    index,
    eventHead: initialState.eventHead,
    review,
    cycle,
    actor: request.actor,
    readAt,
  });
  assertProtocolArtifact('operating-review-read', data, { protocolVersion: PROTOCOL_VERSION });
  const envelope = {
    ok: true,
    operation: 'operate.review.get',
    data,
    allowedActions: data.dispositionChoices.map((choice) => ({
      tool: 'operate.review.submit',
      arguments: clone(choice.submitArguments),
      label: choice.label,
      effect: 'project-write',
    })),
  };
  assertProtocolArtifact('operate-api-envelope', envelope, { protocolVersion: PROTOCOL_VERSION });
  return Object.freeze(envelope);
}

function operatingReviewSubmissionRequestHash(request, draft) {
  return sha256Jcs({
    contract: 'operate-review-submit@2.0.0',
    request,
    eventId: draft.eventId,
    timestamp: draft.timestamp,
    correlationId: draft.correlationId,
  });
}

function operatingReviewBoundSubmissionRequestHash(boundSubmission, draft) {
  return sha256Jcs({
    contract: 'operate-review-bound-submission@1.0.0',
    boundSubmission,
    eventId: draft.eventId,
    timestamp: draft.timestamp,
    correlationId: draft.correlationId,
  });
}

function hasReviewSubmitCapabilityV2(capabilities) {
  return capabilities.some(
    (capability) =>
      capability &&
      typeof capability === 'object' &&
      !Array.isArray(capability) &&
      capability.id === 'operate-review-submit' &&
      capability.version === PROTOCOL_VERSION,
  );
}

function sameOperatingEventHead(left, right) {
  return left?.sequence === right?.sequence && left?.hash === right?.hash;
}

function authorizeBoundReviewIdentityV2(boundSubmission, initialState, capabilities) {
  const request = boundSubmission.submitArguments;
  const index = indexRuntimeState(initialState);
  const review = index.reviews.get(request.reviewId);
  const cycle = index.cycles.get(request.cycleId);
  if (!review || !cycle || review.cycleId !== cycle.cycleId) {
    throw runtimeError('REVIEW_NOT_FOUND', 'The exact Review and bound Cycle do not exist.', {
      reviewId: request.reviewId,
      cycleId: request.cycleId,
    });
  }
  if (
    !hasReviewSubmitCapabilityV2(capabilities) ||
    request.actor?.kind !== 'human' ||
    request.actor.actorId !== review.ownerActorId
  ) {
    throw runtimeError(
      'REVIEW_NOT_AUTHORIZED',
      'Only the exact immutable human Review owner may submit it.',
      {
        reviewId: review.reviewId,
        state: 'actor.actorId',
      },
    );
  }
  const scope = reviewScope(cycle);
  if (sha256Jcs(scope) !== sha256Jcs(request.scope)) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Review submission scope does not match its exact Cycle.',
      {
        reviewId: review.reviewId,
        cycleId: cycle.cycleId,
      },
    );
  }
  return { index, review, cycle, scope };
}

function operatingReviewReceiptId(eventId, requestHash) {
  return `rrc_${sha256Jcs({
    contract: 'operating-review-receipt@2.0.0',
    eventId,
    requestHash,
  }).slice('sha256:'.length, 'sha256:'.length + 24)}`;
}

function buildOperatingReviewReceiptV2({
  state,
  request,
  receiptProjection,
  eventHead,
  committedAt,
  eventId,
  requestHash,
}) {
  const index = indexRuntimeState(state);
  const review = index.reviews.get(request.reviewId);
  const cycle = index.cycles.get(request.cycleId);
  if (
    !review ||
    !cycle ||
    review.state !== request.disposition ||
    sha256Jcs(review.workDispositions) !== sha256Jcs(request.workDispositions)
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Review receipt cannot be reconstructed from divergent committed state.',
      {
        reviewId: request.reviewId,
        cycleId: request.cycleId,
      },
    );
  }
  const read = receiptProjection?.read;
  const appliedChoices =
    read?.dispositionChoices?.filter(
      (choice) =>
        choice.choiceId === receiptProjection.appliedChoiceId &&
        choice.choiceHash === receiptProjection.appliedChoiceHash &&
        sha256Jcs(choice.submitArguments) === sha256Jcs(request),
    ) ?? [];
  if (appliedChoices.length !== 1) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Review receipt cannot identify exactly one applied advertised choice.',
      {
        reviewId: request.reviewId,
        cycleId: request.cycleId,
      },
    );
  }
  const [appliedChoice] = appliedChoices;
  if (
    read.cycleId !== cycle.cycleId ||
    sha256Jcs(read.scope) !== sha256Jcs(request.scope) ||
    sha256Jcs(read.reader) !== sha256Jcs(request.actor) ||
    read.review.reviewId !== review.reviewId ||
    read.review.ownerActorId !== review.ownerActorId ||
    read.review.state !== 'pending'
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Review receipt projection lost its exact pre-commit owner, scope, or pending Review binding.',
      {
        reviewId: request.reviewId,
        cycleId: request.cycleId,
      },
    );
  }
  const boundSubmission = receiptProjection.boundSubmission ?? null;
  if (boundSubmission !== null) {
    try {
      assertOperatingReviewBoundSubmissionV1(boundSubmission);
    } catch {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Review receipt contains an invalid bound submission proof.',
        {
          reviewId: request.reviewId,
          cycleId: request.cycleId,
        },
      );
    }
    if (
      !sameOperatingEventHead(boundSubmission.expectedReadEventHead, read.eventHead) ||
      boundSubmission.choiceId !== appliedChoice.choiceId ||
      boundSubmission.choiceHash !== appliedChoice.choiceHash ||
      sha256Jcs(boundSubmission.submitArguments) !== sha256Jcs(request)
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Review receipt bound submission diverges from its pre-commit read and applied choice.',
        {
          reviewId: request.reviewId,
          cycleId: request.cycleId,
        },
      );
    }
  }
  const data = {
    kind: 'operating-review-receipt',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    receiptId: operatingReviewReceiptId(eventId, requestHash),
    cycleId: cycle.cycleId,
    readEventHead: clone(read.eventHead),
    eventHead: clone(eventHead),
    scope: reviewScope(cycle),
    actor: clone(request.actor),
    review: clone(review),
    decision: request.disposition,
    seatStatus: clone(read.seatStatus),
    decisions: clone(read.decisions),
    actions: clone(read.actions),
    findings: clone(read.findings),
    dissent: clone(read.dissent),
    gaps: clone(read.gaps),
    dispositionChoices: clone(read.dispositionChoices),
    appliedChoiceId: appliedChoice.choiceId,
    appliedChoiceHash: appliedChoice.choiceHash,
    appliedWorkDispositions: clone(review.workDispositions),
    ...(boundSubmission === null ? {} : { boundSubmission: clone(boundSubmission) }),
    summary: {
      decisionCount: read.decisions.length,
      actionCount: read.actions.length,
      findingCount: read.findings.length,
      dissentCount: read.dissent.length,
      gapCount: read.gaps.length,
      message: `Review ${request.disposition}; retained ${read.decisions.length} decision(s), ${read.actions.length} action(s), ${read.findings.length} Finding(s), ${read.dissent.length} dissent item(s), and ${read.gaps.length} typed gap(s).`,
    },
    committedAt,
  };
  assertProtocolArtifact('operating-review-receipt', data, { protocolVersion: PROTOCOL_VERSION });
  const envelope = {
    ok: true,
    operation: 'operate.review.submit',
    data,
    allowedActions: [],
  };
  assertProtocolArtifact('operate-api-envelope', envelope, { protocolVersion: PROTOCOL_VERSION });
  return envelope;
}

function submitOperatingReviewTransactionV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    capabilities = [],
    replayHook = createNoModelReplayHookV2(),
    boundSubmission = null,
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  if (!validateReviewRequestShape(request)) {
    throw runtimeError('RESULT_CONTRACT_INVALID', 'The Review submission request is malformed.');
  }
  assertExactKeys(draft, ['eventId', 'timestamp', 'correlationId'], 'Review submission draft');
  for (const value of [draft.eventId, draft.timestamp, draft.correlationId]) {
    if (typeof value !== 'string' || value.length === 0) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Review submission runtime identities must be non-empty strings.',
      );
    }
  }
  if (Number.isNaN(Date.parse(draft.timestamp))) {
    throw runtimeError('RESULT_CONTRACT_INVALID', 'Review submission timestamp is invalid.');
  }
  const requestHash =
    boundSubmission === null
      ? operatingReviewSubmissionRequestHash(request, draft)
      : operatingReviewBoundSubmissionRequestHash(boundSubmission, draft);
  const replay = initialState.eventReplayIndex.find(({ eventId }) => eventId === draft.eventId);
  if (replay) {
    if (
      replay.type !== 'review.submitted' ||
      replay.entityId !== request.reviewId ||
      replay.cycleId !== request.cycleId ||
      replay.actor.kind !== 'human' ||
      replay.actor.id !== request.actor.actorId ||
      replay.requestHash !== requestHash ||
      replay.payloadHash !==
        sha256Jcs({
          reviewId: request.reviewId,
          disposition: request.disposition,
          workDispositions: request.workDispositions,
          receiptProjection: replay.receiptProjection,
        })
    ) {
      throw runtimeError(
        'CONCURRENT_MODIFICATION',
        'Review submission Event identity was reused with divergent bytes.',
        {
          reviewId: request.reviewId,
          cycleId: request.cycleId,
        },
      );
    }
    return Object.freeze({
      state: clone(initialState),
      response: Object.freeze(
        buildOperatingReviewReceiptV2({
          state: initialState,
          request,
          receiptProjection: replay.receiptProjection,
          eventHead: { sequence: replay.sequence, hash: replay.eventHash },
          committedAt: replay.timestamp,
          eventId: replay.eventId,
          requestHash,
        }),
      ),
      events: Object.freeze([]),
      replayed: true,
    });
  }
  const index = indexRuntimeState(initialState);
  const review = index.reviews.get(request.reviewId);
  const cycle = index.cycles.get(request.cycleId);
  if (!review || !cycle) {
    throw runtimeError('REVIEW_NOT_FOUND', 'The exact Review and bound Cycle do not exist.', {
      reviewId: request.reviewId,
      cycleId: request.cycleId,
    });
  }
  const scope = reviewScope(cycle);
  if (sha256Jcs(scope) !== sha256Jcs(request.scope)) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Review submission scope does not match its exact Cycle.',
      {
        reviewId: review.reviewId,
        cycleId: cycle.cycleId,
      },
    );
  }
  if (request.actor.actorId !== review.ownerActorId) {
    throw runtimeError(
      'REVIEW_NOT_AUTHORIZED',
      'Only the exact immutable human Review owner may submit it.',
      {
        reviewId: review.reviewId,
        state: 'actor.actorId',
      },
    );
  }
  if (
    boundSubmission !== null &&
    !sameOperatingEventHead(boundSubmission.expectedReadEventHead, initialState.eventHead)
  ) {
    throw runtimeError(
      'CONCURRENT_MODIFICATION',
      'Review state changed after the owner-bound read. Refresh the current legal choices.',
      {
        reviewId: review.reviewId,
        cycleId: cycle.cycleId,
        state: 'expectedReadEventHead',
      },
    );
  }
  const precommitRead = buildOperatingReviewReadDataV2({
    index,
    eventHead: initialState.eventHead,
    review,
    cycle,
    actor: request.actor,
    readAt: draft.timestamp,
  });
  assertProtocolArtifact('operating-review-read', precommitRead, {
    protocolVersion: PROTOCOL_VERSION,
  });
  const advertised = precommitRead.dispositionChoices;
  const exact = advertised.filter(
    (choice) =>
      sha256Jcs(choice.submitArguments) === sha256Jcs(request) &&
      (boundSubmission === null ||
        (choice.choiceId === boundSubmission.choiceId &&
          choice.choiceHash === boundSubmission.choiceHash &&
          sha256Jcs(choice.submitArguments) === sha256Jcs(boundSubmission.submitArguments))),
  );
  if (exact.length !== 1) {
    throw runtimeError(
      boundSubmission === null ? 'STATE_TRANSITION_INVALID' : 'CONCURRENT_MODIFICATION',
      'Review submission must equal exactly one current advertised disposition choice.',
      {
        reviewId: review.reviewId,
        cycleId: cycle.cycleId,
        ...(boundSubmission === null ? {} : { state: 'choice' }),
      },
    );
  }
  const receiptProjection = {
    read: clone(precommitRead),
    appliedChoiceId: exact[0].choiceId,
    appliedChoiceHash: exact[0].choiceHash,
    ...(boundSubmission === null ? {} : { boundSubmission: clone(boundSubmission) }),
  };
  const action =
    review.subject?.type === 'action' ? index.actions.get(review.subject.actionId) : null;
  assertOperateAuthorizedV2('operate.review.submit', {
    capabilities,
    actor: request.actor,
    review,
    cycle,
    action,
    scope,
    reviewRequest: request,
  });
  const creationEvents = initialState.eventReplayIndex.filter(
    (entry) => entry.type === 'review.created' && entry.entityId === review.reviewId,
  );
  if (creationEvents.length > 1) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Review submission has ambiguous creation causation.',
      {
        reviewId: review.reviewId,
      },
    );
  }
  const previousEvent =
    initialState.eventHead.sequence === 0
      ? null
      : {
          sequence: initialState.eventHead.sequence,
          eventHash: initialState.eventHead.hash,
        };
  const event = createOperatingRuntimeEventV2(
    {
      eventId: draft.eventId,
      timestamp: draft.timestamp,
      cycleId: cycle.cycleId,
      type: 'review.submitted',
      entityId: review.reviewId,
      actor: { kind: 'human', id: request.actor.actorId },
      causationId: creationEvents[0]?.eventId ?? null,
      correlationId: draft.correlationId,
      requestHash,
      payload: {
        reviewId: review.reviewId,
        disposition: request.disposition,
        workDispositions: clone(request.workDispositions),
        receiptProjection,
      },
    },
    { previousEvent },
  );
  const state = reduceOperatingRuntimeEventsV2([event], { initialState, replayHook });
  replayHook.assertUnused();
  const response = buildOperatingReviewReceiptV2({
    state,
    request,
    receiptProjection,
    eventHead: { sequence: event.sequence, hash: event.eventHash },
    committedAt: event.timestamp,
    eventId: event.eventId,
    requestHash,
  });
  return Object.freeze({
    state,
    response: Object.freeze(response),
    events: Object.freeze([event]),
    replayed: false,
  });
}

/** Commit one legacy Review submit request exactly as Protocol 2.0 originally advertised it. */
export function submitOperatingReviewV2(request, draft, options = {}) {
  return submitOperatingReviewTransactionV2(request, draft, options);
}

/** Commit one head- and choice-bound Review submission without changing legacy tool bytes. */
export function submitBoundOperatingReviewV2(
  boundSubmission,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    capabilities = [],
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  try {
    assertOperatingReviewBoundSubmissionV1(boundSubmission);
  } catch {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'The bound Review submission wrapper is malformed.',
    );
  }
  authorizeBoundReviewIdentityV2(boundSubmission, initialState, capabilities);
  return submitOperatingReviewTransactionV2(boundSubmission.submitArguments, draft, {
    initialState,
    capabilities,
    replayHook,
    boundSubmission,
  });
}

/** Read the immutable receipt for one exact terminal Review without replaying a mutation. */
export function readCommittedOperatingReviewReceiptV2(
  request,
  { initialState = createEmptyOperatingRuntimeStateV2(), capabilities = [] } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  if (!validateReviewGetRequestShape(request)) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'The committed Review receipt request is malformed.',
    );
  }
  const index = indexRuntimeState(initialState);
  const review = index.reviews.get(request.reviewId);
  const cycle = index.cycles.get(request.cycleId);
  if (!review || !cycle || review.cycleId !== cycle.cycleId) {
    throw runtimeError('REVIEW_NOT_FOUND', 'The exact Review and bound Cycle do not exist.', {
      reviewId: request.reviewId,
      cycleId: request.cycleId,
    });
  }
  if (
    !capabilities.includes('operate.review.get') ||
    request.actor?.kind !== 'human' ||
    request.actor.actorId !== review.ownerActorId
  ) {
    throw runtimeError(
      'REVIEW_NOT_AUTHORIZED',
      'Only the exact immutable human Review owner may read its receipt.',
      {
        reviewId: review.reviewId,
        state: 'actor.actorId',
      },
    );
  }
  const scope = reviewScope(cycle);
  if (sha256Jcs(scope) !== sha256Jcs(request.scope)) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Review receipt scope does not match its exact Cycle.',
      {
        reviewId: review.reviewId,
        cycleId: cycle.cycleId,
      },
    );
  }
  const committed = initialState.eventReplayIndex.filter(
    (entry) =>
      entry.type === 'review.submitted' &&
      entry.entityId === review.reviewId &&
      entry.cycleId === cycle.cycleId &&
      entry.actor.kind === 'human' &&
      entry.actor.id === request.actor.actorId &&
      entry.receiptProjection,
  );
  if (committed.length !== 1 || review.state === 'pending') {
    throw runtimeError(
      review.state === 'pending' ? 'REVIEW_NOT_PENDING' : 'STATE_TRANSITION_INVALID',
      review.state === 'pending'
        ? 'A pending Review has no committed receipt.'
        : 'The terminal Review does not have exactly one reconstructable committed receipt.',
      {
        reviewId: review.reviewId,
        cycleId: cycle.cycleId,
      },
    );
  }
  const [entry] = committed;
  const projection = entry.receiptProjection;
  const choices =
    projection.read?.dispositionChoices?.filter(
      (choice) =>
        choice.choiceId === projection.appliedChoiceId &&
        choice.choiceHash === projection.appliedChoiceHash,
    ) ?? [];
  if (
    choices.length !== 1 ||
    sha256Jcs(projection.read.reader) !== sha256Jcs(request.actor) ||
    sha256Jcs(projection.read.scope) !== sha256Jcs(request.scope)
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'The committed Review receipt lost its exact actor, scope, or applied choice proof.',
      {
        reviewId: review.reviewId,
        cycleId: cycle.cycleId,
      },
    );
  }
  return Object.freeze(
    buildOperatingReviewReceiptV2({
      state: initialState,
      request: choices[0].submitArguments,
      receiptProjection: projection,
      eventHead: { sequence: entry.sequence, hash: entry.eventHash },
      committedAt: entry.timestamp,
      eventId: entry.eventId,
      requestHash: entry.requestHash,
    }),
  );
}

/**
 * Claim one runtime-issued available Assignment and start its first attempt.
 * The response returns the complete now-running Assignment; callers cannot
 * replace its mandate, rubric, custody, or output contract with request data.
 */
export function claimOperatingAssignmentV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    capabilities = [],
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  try {
    assertProtocolArtifact(
      'operate-tool-call',
      {
        kind: 'operate-tool-call',
        schemaVersion: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
        direction: 'request',
        operation: 'operate.assignment.claim',
        request: clone(request),
      },
      { protocolVersion: PROTOCOL_VERSION },
    );
  } catch {
    throw runtimeError('RESULT_CONTRACT_INVALID', 'The Assignment claim request is malformed.');
  }
  assertExactKeys(
    draft,
    ['claimId', 'submissionId', 'eventIds', 'timestamp', 'correlationId'],
    'Assignment claim draft',
  );
  assertExactKeys(draft.eventIds, ['claimed', 'started'], 'Assignment claim Event identities');
  for (const value of [
    draft.claimId,
    draft.submissionId,
    draft.eventIds.claimed,
    draft.eventIds.started,
    draft.timestamp,
    draft.correlationId,
  ]) {
    if (typeof value !== 'string' || value.length === 0) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Assignment claim draft identities must be non-empty strings.',
      );
    }
  }
  const index = indexRuntimeState(initialState);
  const assignment = index.assignments.get(request.assignmentId);
  if (!assignment) {
    throw runtimeError('ASSIGNMENT_NOT_AVAILABLE', 'The Assignment is unavailable.', {
      assignmentId: request.assignmentId,
    });
  }
  const existingSubmission = index.submissions.get(draft.submissionId);
  if (assignment.state === 'running') {
    if (
      !actorMatchesClaim(request.actor, assignment.claim) ||
      assignment.claim.claimId !== draft.claimId ||
      !existingSubmission ||
      existingSubmission.assignmentId !== assignment.assignmentId ||
      existingSubmission.state !== 'issued'
    ) {
      throw runtimeError(
        'ASSIGNMENT_ALREADY_CLAIMED',
        'The Assignment is already retained by a different exact claim.',
        {
          assignmentId: assignment.assignmentId,
        },
      );
    }
    const response = {
      assignment: clone(assignment),
      submissionId: existingSubmission.submissionId,
      capabilities: issuedAssignmentCapabilities(assignment),
    };
    assertProtocolArtifact(
      'operate-api-envelope',
      {
        ok: true,
        operation: 'operate.assignment.claim',
        data: response,
        allowedActions: [],
      },
      { protocolVersion: PROTOCOL_VERSION },
    );
    return Object.freeze({
      state: clone(initialState),
      response: Object.freeze(response),
      events: Object.freeze([]),
      replayed: true,
    });
  }
  assertOperateAuthorizedV2('operate.assignment.claim', {
    capabilities,
    assignment,
    actor: request.actor,
  });
  if (index.submissions.has(draft.submissionId)) {
    throw runtimeError(
      'SUBMISSION_ID_CONFLICT',
      'The runtime-issued submission identity is already in use.',
      {
        submissionId: draft.submissionId,
      },
    );
  }
  const priorEvent =
    initialState.eventHead.sequence === 0
      ? null
      : (initialState.eventReplayIndex.find(
          ({ sequence }) => sequence === initialState.eventHead.sequence,
        ) ?? null);
  const claimed = createOperatingRuntimeEventV2(
    {
      eventId: draft.eventIds.claimed,
      timestamp: draft.timestamp,
      cycleId: assignment.cycleId,
      type: 'assignment.claimed',
      entityId: assignment.assignmentId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId: priorEvent?.eventId ?? null,
      correlationId: draft.correlationId,
      payload: {
        assignmentId: assignment.assignmentId,
        actorId: request.actor.actorId,
        actorKind: request.actor.kind,
        runtime: request.actor.runtime,
        claimId: draft.claimId,
        submissionId: draft.submissionId,
      },
    },
    { previousEvent: priorEvent },
  );
  const started = createOperatingRuntimeEventV2(
    {
      eventId: draft.eventIds.started,
      timestamp: draft.timestamp,
      cycleId: assignment.cycleId,
      type: 'assignment.started',
      entityId: assignment.assignmentId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId: claimed.eventId,
      correlationId: draft.correlationId,
      payload: { assignmentId: assignment.assignmentId, attempt: 1 },
    },
    { previousEvent: claimed },
  );
  const state = reduceOperatingRuntimeEventsV2([claimed, started], { initialState, replayHook });
  const running = state.assignments.find(
    ({ assignmentId }) => assignmentId === assignment.assignmentId,
  );
  const response = {
    assignment: clone(running),
    submissionId: draft.submissionId,
    capabilities: issuedAssignmentCapabilities(running),
  };
  assertProtocolArtifact(
    'operate-api-envelope',
    {
      ok: true,
      operation: 'operate.assignment.claim',
      data: response,
      allowedActions: [],
    },
    { protocolVersion: PROTOCOL_VERSION },
  );
  return Object.freeze({
    state,
    response: Object.freeze(response),
    events: Object.freeze([claimed, started]),
    replayed: false,
  });
}

export function transitionOperatingAssignmentV2(assignment, nextState, patch = {}) {
  assertProtocolArtifact('operating-assignment', assignment, { protocolVersion: PROTOCOL_VERSION });
  const allowedStates = OPERATING_ASSIGNMENT_TRANSITIONS_V2[assignment.state] ?? [];
  if (
    !allowedStates.includes(nextState) ||
    !compiledTransition('operating-assignment', assignment.state, nextState)
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      `Invalid assignment transition ${assignment.state} -> ${nextState} for ${assignment.assignmentId}.`,
      {
        assignmentId: assignment.assignmentId,
        from: assignment.state,
        to: nextState,
      },
    );
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Assignment transition patch must be an object.',
      {
        assignmentId: assignment.assignmentId,
        from: assignment.state,
        to: nextState,
      },
    );
  }
  const allowedPatchFields = new Set(
    nextState === 'available'
      ? ['availableAt', 'inputArtifactIds', 'inputAbsences']
      : nextState === 'claimed'
        ? ['claim']
        : nextState === 'running'
          ? ['attemptPolicy']
          : nextState === 'validated'
            ? ['completedAt']
            : ['abandoned', 'failed'].includes(nextState)
              ? ['completedAt', 'terminalOutcome']
              : [],
  );
  const invalidPatchFields = Object.keys(patch).filter((field) => !allowedPatchFields.has(field));
  if (invalidPatchFields.length > 0) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      `Assignment transition cannot patch immutable or unrelated fields: ${invalidPatchFields.join(', ')}.`,
      {
        assignmentId: assignment.assignmentId,
        from: assignment.state,
        to: nextState,
        fields: invalidPatchFields,
      },
    );
  }
  if (nextState === 'available' && typeof patch.availableAt !== 'string') {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'An available Assignment requires its availability timestamp.',
    );
  }
  if (nextState === 'available' && patch.inputArtifactIds !== undefined) {
    if (
      !Array.isArray(patch.inputArtifactIds) ||
      new Set(patch.inputArtifactIds).size !== patch.inputArtifactIds.length ||
      !assignment.inputArtifactIds.every((artifactId) =>
        patch.inputArtifactIds.includes(artifactId),
      )
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'An available Assignment may only expand its bound input Artifact IDs.',
        {
          assignmentId: assignment.assignmentId,
        },
      );
    }
  }
  if (nextState === 'claimed' && (!patch.claim || typeof patch.claim !== 'object')) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'A claimed Assignment requires its runtime-issued claim binding.',
    );
  }
  if (nextState === 'running') {
    const attemptPolicy = patch.attemptPolicy;
    if (
      !attemptPolicy ||
      attemptPolicy.maxAttempts !== assignment.attemptPolicy.maxAttempts ||
      attemptPolicy.timeoutMs !== assignment.attemptPolicy.timeoutMs ||
      attemptPolicy.attempt !== assignment.attemptPolicy.attempt + 1 ||
      attemptPolicy.attempt > attemptPolicy.maxAttempts
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'A running Assignment must advance only its bounded attempt counter.',
        {
          assignmentId: assignment.assignmentId,
        },
      );
    }
  }
  if (
    ['validated', 'abandoned', 'failed'].includes(nextState) &&
    typeof patch.completedAt !== 'string'
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      `A ${nextState} Assignment requires its completion timestamp.`,
    );
  }
  if (patch.terminalOutcome !== undefined && patch.terminalOutcome?.outcome !== nextState) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'A terminal proof must name the exact terminal Assignment state.',
      {
        assignmentId: assignment.assignmentId,
        state: nextState,
      },
    );
  }
  const result = { ...clone(assignment), ...clone(patch), state: nextState };
  assertProtocolArtifact('operating-assignment', result, { protocolVersion: PROTOCOL_VERSION });
  return result;
}

export function transitionOperatingReviewV2(review, nextState, patch = {}) {
  assertProtocolArtifact('operating-review', review, { protocolVersion: PROTOCOL_VERSION });
  if (!compiledTransition('operating-review', review.state, nextState)) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      `Invalid Review transition ${review.state} -> ${nextState} for ${review.reviewId}.`,
      {
        reviewId: review.reviewId,
        from: review.state,
        to: nextState,
      },
    );
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw runtimeError('STATE_TRANSITION_INVALID', 'Review transition patch must be an object.', {
      reviewId: review.reviewId,
      from: review.state,
      to: nextState,
    });
  }
  const invalidPatchFields = Object.keys(patch).filter(
    (field) => !['updatedAt', 'workDispositions'].includes(field),
  );
  if (
    invalidPatchFields.length > 0 ||
    typeof patch.updatedAt !== 'string' ||
    (patch.workDispositions !== undefined && !Array.isArray(patch.workDispositions))
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'A Review transition requires its timestamp and explicit durable-work dispositions.',
      {
        reviewId: review.reviewId,
        from: review.state,
        to: nextState,
        fields: invalidPatchFields,
      },
    );
  }
  const result = {
    ...clone(review),
    updatedAt: patch.updatedAt,
    state: nextState,
    disposition: nextState,
    workDispositions: clone(patch.workDispositions ?? []),
  };
  assertProtocolArtifact('operating-review', result, { protocolVersion: PROTOCOL_VERSION });
  return result;
}

/**
 * Apply one compiler-owned persistent Action lifecycle transition. The Action
 * revision/hash tuple remains immutable; execution state is event-derived.
 */
export function transitionOperatingActionLifecycleV2(action, nextState, { updatedAt } = {}) {
  assertProtocolArtifact('operating-action', action, { protocolVersion: PROTOCOL_VERSION });
  if (
    !compiledTransition('operating-action', action.state, nextState) ||
    typeof updatedAt !== 'string' ||
    Number.isNaN(Date.parse(updatedAt))
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      `Invalid Action transition ${action.state} -> ${nextState} for ${action.actionId}.`,
      {
        actionId: action.actionId,
        from: action.state,
        to: nextState,
      },
    );
  }
  const result = { ...clone(action), state: nextState, updatedAt };
  assertProtocolArtifact('operating-action', result, { protocolVersion: PROTOCOL_VERSION });
  return result;
}

/** Apply one compiler-owned Cycle execution/verification/closure transition. */
export function transitionOperatingCycleLifecycleV2(cycle, nextState, { updatedAt } = {}) {
  assertProtocolArtifact('operating-cycle', cycle, { protocolVersion: PROTOCOL_VERSION });
  if (
    !compiledTransition('operating-cycle', cycle.state, nextState) ||
    typeof updatedAt !== 'string' ||
    Number.isNaN(Date.parse(updatedAt))
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      `Invalid Cycle transition ${cycle.state} -> ${nextState} for ${cycle.cycleId}.`,
      {
        cycleId: cycle.cycleId,
        from: cycle.state,
        to: nextState,
      },
    );
  }
  const result = {
    ...clone(cycle),
    state: nextState,
    updatedAt,
    ...(nextState === 'closed' ? { activeReviewId: null, closedAt: updatedAt } : {}),
  };
  assertProtocolArtifact('operating-cycle', result, { protocolVersion: PROTOCOL_VERSION });
  return result;
}

function withoutEventHash(event) {
  const copy = clone(event);
  delete copy.eventHash;
  return copy;
}

export function computeOperatingRuntimeEventHashV2(event) {
  return sha256Jcs(withoutEventHash(event));
}

export function createOperatingRuntimeEventV2(
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
  { previousEvent = null, sequence = previousEvent ? previousEvent.sequence + 1 : 1 } = {},
) {
  const event = {
    kind: 'operating-event',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    eventId,
    sequence,
    timestamp,
    cycleId,
    type,
    entityId,
    actor: clone(actor),
    causationId,
    correlationId,
    previousEventHash: previousEvent?.eventHash ?? null,
    ...(requestHash === undefined ? {} : { requestHash }),
    payload: clone(payload),
  };
  event.eventHash = computeOperatingRuntimeEventHashV2(event);
  assertProtocolArtifact('operating-event', event, { protocolVersion: PROTOCOL_VERSION });
  return event;
}

export function verifyOperatingRuntimeEventChainV2(
  events,
  { startingSequence = 0, startingHash = null, seenEventIds = [] } = {},
) {
  if (!Array.isArray(events))
    throw runtimeError('STATE_TRANSITION_INVALID', 'Operating events must be an array.');
  let expectedSequence = startingSequence + 1;
  let expectedHash = startingHash;
  const ids = new Set(seenEventIds);
  for (const event of events) {
    if (event?.protocolVersion !== PROTOCOL_VERSION) {
      throw runtimeError(
        'CONTRACT_VERSION_UNSUPPORTED',
        `Event ${event?.eventId ?? '<unknown>'} is not Protocol 2.0.0.`,
        {
          eventId: event?.eventId ?? null,
          protocolVersion: event?.protocolVersion ?? null,
        },
      );
    }
    try {
      assertProtocolArtifact('operating-event', event, { protocolVersion: PROTOCOL_VERSION });
    } catch (error) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        `Event at sequence ${event?.sequence ?? '?'} is invalid: ${error.message}.`,
        {
          sequence: event?.sequence ?? null,
        },
      );
    }
    if (ids.has(event.eventId)) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        `Duplicate operating event ID ${event.eventId}.`,
        { eventId: event.eventId },
      );
    }
    if (event.sequence !== expectedSequence) {
      throw runtimeError(
        'CONCURRENT_MODIFICATION',
        `Expected sequence ${expectedSequence}, received ${event.sequence}.`,
        {
          expectedSequence,
          receivedSequence: event.sequence,
        },
        true,
      );
    }
    if (event.previousEventHash !== expectedHash) {
      throw runtimeError(
        'CONCURRENT_MODIFICATION',
        `Event ${event.eventId} does not reference the current event head.`,
        {
          eventId: event.eventId,
          expectedHash,
          receivedHash: event.previousEventHash,
        },
        true,
      );
    }
    if (computeOperatingRuntimeEventHashV2(event) !== event.eventHash) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        `Event ${event.eventId} failed its JCS hash check.`,
        { eventId: event.eventId },
      );
    }
    ids.add(event.eventId);
    expectedSequence += 1;
    expectedHash = event.eventHash;
  }
  return { sequence: expectedSequence - 1, hash: expectedHash };
}

export function createEmptyOperatingRuntimeStateV2(
  generatedAt = ZERO_TIME,
  { actionPolicies = undefined, approvalRequirements = undefined } = {},
) {
  const authorityConfigured = actionPolicies !== undefined || approvalRequirements !== undefined;
  const state = {
    kind: 'operating-runtime-state',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    generatedAt,
    eventHead: { sequence: 0, hash: null },
    cycles: [],
    inputBindings: [],
    assignments: [],
    reviews: [],
    executiveBoards: [],
    submissions: [],
    artifacts: [],
    findings: [],
    decisions: [],
    actions: [],
    operatingModelStates: [],
    operatingSnapshots: [],
    objectives: [],
    metrics: [],
    metricObservations: [],
    risks: [],
    assumptions: [],
    claims: [],
    deltas: [],
    intelligencePlans: [],
    decisionLedgers: [],
    scenarios: [],
    eventTriggers: [],
    verificationPlans: [],
    outcomes: [],
    learnings: [],
    evidenceRefs: [],
    evidenceResolutions: [],
    evidenceEdges: [],
    evidenceResolutionReplayIndex: [],
    submissionReplayIndex: [],
    workChangeSetReplayIndex: [],
    eventReplayIndex: [],
    ...(authorityConfigured
      ? {
          actionPolicies: clone(actionPolicies ?? []),
          policyEvaluations: [],
          approvalRequirements: clone(approvalRequirements ?? []),
          approvalRecords: [],
          capabilityAvailability: [],
          capabilityGrants: [],
          governedOperations: [],
          executionResults: [],
          rollbackPlans: [],
          rollbackResults: [],
          operationReplayIndex: [],
        }
      : {}),
  };
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
  return state;
}

function indexBy(records, key, label) {
  const index = new Map();
  for (const record of records) {
    if (index.has(record[key]))
      throw runtimeError('STATE_TRANSITION_INVALID', `Duplicate ${label} ${record[key]}.`);
    index.set(record[key], clone(record));
  }
  return index;
}

function indexPolicies(records) {
  const index = new Map();
  for (const record of records) {
    let checked;
    try {
      checked = assertOperatingActionPolicyV2(record);
    } catch (error) {
      throw runtimeError(
        error.code ?? 'POLICY_EVALUATION_REJECTED',
        error.message,
        error.details?.context ?? {},
      );
    }
    const key = `${checked.policyId}@${checked.policyVersion}`;
    if (index.has(key))
      throw runtimeError('STATE_TRANSITION_INVALID', `Duplicate action policy ${key}.`);
    index.set(key, clone(checked));
  }
  return index;
}

function uniqueReplayEvent(index, type, entityId) {
  const entries = [...index.eventReplay.values()].filter(
    (entry) => entry.type === type && entry.entityId === entityId,
  );
  return entries.length === 1 ? entries[0] : null;
}

function capabilityAvailabilityForGovernedOperation(
  index,
  { checkedAt, capability, target, grant },
) {
  const matches = [...index.capabilityAvailability.values()].filter(
    (candidate) =>
      candidate.checkedAt === checkedAt &&
      sha256Jcs(candidate.capability) === sha256Jcs(capability) &&
      sha256Jcs(candidate.target) === sha256Jcs(target),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1 && grant) {
    const grantEvent = uniqueReplayEvent(index, 'capability.granted', grant.grantId);
    const parentEvent = grantEvent ? index.eventReplay.get(grantEvent.causationId) : null;
    if (parentEvent?.type === 'capability.availability-recorded') {
      const matched = index.capabilityAvailability.get(parentEvent.entityId);
      if (
        matched &&
        matches.some((candidate) => candidate.availabilityId === matched.availabilityId)
      ) {
        return matched;
      }
    }
  }
  return null;
}

function rollbackTerminalReservationV2(replayEntry, status) {
  const success = ['succeeded', 'partial'].includes(status);
  return success
    ? {
        resultId: replayEntry?.reservedResultId,
        resultArtifactId: replayEntry?.reservedResultArtifactId,
        submissionId: replayEntry?.reservedSubmissionId,
        eventIds: replayEntry?.reservedTerminalEventIds ?? {},
      }
    : {
        resultId: replayEntry?.reservedUncertaintyResultId,
        resultArtifactId: replayEntry?.reservedUncertaintyResultArtifactId,
        submissionId: replayEntry?.reservedUncertaintySubmissionId,
        eventIds: replayEntry?.reservedUncertaintyTerminalEventIds ?? {},
      };
}

/**
 * Validate one rollback from its immutable parent and current authority through
 * its Event, Assignment, grant, availability, operation, Artifact, and result
 * projections. This is the single rollback validator used by direct reduction,
 * checkpoint loading, terminal transition validation, and public replay.
 */
function assertOperatingRollbackAuthorityChainIndexV2(index, operation, replayEntry) {
  const assignment = index.assignments.get(operation.assignmentId);
  const grant = index.capabilityGrants.get(operation.grantId);
  const action = index.actions.get(operation.action.actionId);
  const evaluation = index.policyEvaluations.get(operation.evaluationId);
  const plan = index.rollbackPlans.get(operation.rollbackPlanId);
  const parent = index.governedOperations.get(operation.parentOperationId);
  const parentResult = parent ? index.executionResults.get(parent.resultId) : null;
  const parentReplayEntry = parent ? index.operationReplayIndex.get(parent.operationId) : null;
  const intentEvent = index.eventReplay.get(operation.intentEventId);
  const successSubmission = replayEntry
    ? index.submissions.get(replayEntry.reservedSubmissionId)
    : null;
  const uncertaintySubmission = replayEntry
    ? index.submissions.get(replayEntry.reservedUncertaintySubmissionId)
    : null;
  const terminal = operation.resultId !== null;
  const result = terminal ? index.rollbackResults.get(operation.resultId) : null;
  const terminalReservation = rollbackTerminalReservationV2(replayEntry, result?.status);
  const terminalSubmission =
    result && ['succeeded', 'partial'].includes(result.status)
      ? successSubmission
      : uncertaintySubmission;
  const unusedReservation =
    result && ['succeeded', 'partial'].includes(result.status)
      ? rollbackTerminalReservationV2(replayEntry, 'uncertain')
      : rollbackTerminalReservationV2(replayEntry, 'succeeded');
  const unusedSubmission =
    result && ['succeeded', 'partial'].includes(result.status)
      ? uncertaintySubmission
      : successSubmission;
  const terminalArtifact = result ? index.artifacts.get(result.resultArtifactId) : null;
  const resultEvent = result
    ? index.eventReplay.get(terminalReservation.eventIds.resultRecorded)
    : null;
  const planEvent = plan
    ? uniqueReplayEvent(index, 'rollback.plan-recorded', plan.rollbackPlanId)
    : null;
  const assignmentCreated = assignment
    ? uniqueReplayEvent(index, 'assignment.created', assignment.assignmentId)
    : null;
  const assignmentAvailable = assignment
    ? uniqueReplayEvent(index, 'assignment.available', assignment.assignmentId)
    : null;
  const assignmentClaimed = assignment
    ? uniqueReplayEvent(index, 'assignment.claimed', assignment.assignmentId)
    : null;
  const assignmentStarted = assignment
    ? uniqueReplayEvent(index, 'assignment.started', assignment.assignmentId)
    : null;
  const availability = capabilityAvailabilityForGovernedOperation(index, {
    checkedAt: operation.createdAt,
    capability: operation.capability,
    target: operation.target,
    grant,
  });
  const availabilityEvent = availability
    ? uniqueReplayEvent(index, 'capability.availability-recorded', availability.availabilityId)
    : null;
  const grantEvent = grant ? uniqueReplayEvent(index, 'capability.granted', grant.grantId) : null;
  const requirements =
    evaluation?.approvalRequirementIds.map((requirementId) =>
      index.approvalRequirements.get(requirementId),
    ) ?? [];
  const approvals = evaluation
    ? [...index.approvalRecords.values()].filter(
        ({ evaluationId }) => evaluationId === evaluation.evaluationId,
      )
    : [];
  let latestEvaluation = null;
  let disposition = null;
  let policyValid = false;
  try {
    latestEvaluation = resolveOperatingLatestActionEvaluationV2({
      evaluations: [...index.policyEvaluations.values()],
      action,
      configuredPolicies: [...index.actionPolicies.values()],
      at: operation.createdAt,
    });
    const authorityApprovals = approvals.map((approval) => {
      const requirement = requirements.find(
        ({ requirementId }) => requirementId === approval.requirementId,
      );
      if (!requirement || approval.consumedByOperationId !== operation.operationId) {
        throw runtimeError(
          'APPROVAL_INVALID',
          'Rollback approval consumption must bind the exact rollback operation.',
          {
            approvalId: approval?.approvalId ?? null,
          },
        );
      }
      assertOperatingApprovalRecordV2(approval, { requirement });
      const restored = { ...clone(approval), consumedByOperationId: null };
      restored.recordHash = sha256Jcs(recordWithoutHash(restored, 'recordHash'));
      return restored;
    });
    disposition = evaluateOperatingApprovalSetV2({
      evaluation,
      action,
      requirements,
      approvals: authorityApprovals,
      now: operation.createdAt,
    });
    assertOperatingRollbackPolicyV2({
      action,
      evaluation,
      rollbackPlan: plan,
      at: operation.createdAt,
    });
    policyValid =
      disposition.complete === true &&
      disposition.disposition === 'approved' &&
      sameCanonicalStringSet(disposition.approvalIds, operation.approvalIds) &&
      sameCanonicalStringSet(
        operation.approvalIds,
        approvals.map(({ approvalId }) => approvalId),
      );
  } catch {
    latestEvaluation = null;
    disposition = null;
    policyValid = false;
  }
  const expectedAction = action ? governedActionIdentity(action) : null;
  const expectedInputs = action
    ? [...new Set([action.sourceArtifactId, ...action.preconditionArtifactIds])].sort()
    : [];
  const scopeHashes = [...new Set(requirements.map(({ scopeHash }) => scopeHash))];
  const expectedScopeHash =
    evaluation?.outcome === 'automatic'
      ? sha256Jcs({
          action: expectedAction,
          evaluationId: evaluation?.evaluationId,
          scopeId: action?.scopeId,
          domainId: action?.domainId,
          domainVersion: action?.domainVersion,
        })
      : scopeHashes.length === 1
        ? scopeHashes[0]
        : null;
  let executorSelection = null;
  let capabilitySelection = null;
  let host = null;
  try {
    const registration = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2.executors.find(
      (candidate) =>
        candidate.executorId === operation.executor.executorId &&
        candidate.executorVersion === operation.executor.executorVersion,
    );
    executorSelection = registration
      ? selectOperateExecutorV2(OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2, {
          executorId: registration.executorId,
          executorVersion: registration.executorVersion,
          protocolVersion: PROTOCOL_VERSION,
          runtimeVersion: registration.provenance.packageVersion,
          now: operation.createdAt,
          domainId: action?.domainId,
          actionKind: action?.actionKind,
          capability: action?.requestedCapability,
          targetKind: action?.targetBinding?.kind,
          effectClass: action?.effectClass,
          operationKind: 'rollback',
        })
      : null;
    capabilitySelection = selectOperateCapabilityProviderV2(
      OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
      {
        providerId: availability?.provider?.providerId,
        providerVersion: availability?.provider?.providerVersion,
        protocolVersion: PROTOCOL_VERSION,
        runtimeVersion: executorSelection?.registration?.provenance?.packageVersion ?? '0.44.0',
        now: operation.createdAt,
        domainId: action?.domainId,
        actionKind: action?.actionKind,
        capability: action?.requestedCapability,
        targetKind: action?.targetBinding?.kind,
        effectClass: action?.effectClass,
      },
    );
    host =
      executorSelection?.status === 'available'
        ? findOpenReferenceExecutorHostDeclarationV2({
            executorId: executorSelection.registration.executorId,
            executorVersion: executorSelection.registration.executorVersion,
            implementationId: executorSelection.registration.implementation.id,
          })
        : null;
  } catch {
    executorSelection = null;
    capabilitySelection = null;
    host = null;
  }
  const availabilityIdentity = availability
    ? { ...clone(availability), availabilityId: 'cava_pending000' }
    : null;
  if (availabilityIdentity) delete availabilityIdentity.availabilityHash;
  const expectedAvailabilityId = availabilityIdentity
    ? `cava_${sha256Jcs(availabilityIdentity).slice('sha256:'.length)}`
    : null;
  const historicalOperation = terminal
    ? {
        ...clone(operation),
        state: 'dispatching',
        resultId: null,
        updatedAt: operation.createdAt,
        operationHash: replayEntry?.operationHash,
      }
    : clone(operation);
  let expectedFingerprint = null;
  try {
    expectedFingerprint = deriveContainedExecutorRequestFingerprintFromBindingV2({
      operation: historicalOperation,
      payload: {
        artifactId: replayEntry?.payloadArtifactId,
        contentHash: replayEntry?.payloadHash,
      },
      rollbackBaseline: {
        artifactId: replayEntry?.baselineArtifactId,
        contentHash: replayEntry?.baselineHash,
      },
    });
  } catch {
    expectedFingerprint = null;
  }
  const expectedOperation =
    historicalOperation &&
    action &&
    assignment &&
    evaluation &&
    disposition &&
    grant &&
    plan &&
    parent &&
    executorSelection?.status === 'available' &&
    host
      ? {
          kind: 'operating-governed-operation',
          schemaVersion: '1.0.0',
          protocolVersion: PROTOCOL_VERSION,
          operationId: historicalOperation.operationId,
          operationKind: 'rollback',
          action: expectedAction,
          assignmentId: assignment?.assignmentId,
          requestFingerprint: expectedFingerprint,
          evaluationId: evaluation?.evaluationId,
          approvalIds: disposition ? [...disposition.approvalIds].sort() : null,
          grantId: grant?.grantId,
          capability: clone(action?.requestedCapability),
          target: clone(action?.targetBinding),
          effectClass: action?.effectClass,
          executor:
            executorSelection?.status === 'available'
              ? {
                  executorId: executorSelection.registration.executorId,
                  executorVersion: executorSelection.registration.executorVersion,
                }
              : null,
          connector: clone(host?.connector),
          preconditionArtifactIds: clone(action?.preconditionArtifactIds),
          inputArtifactIds: expectedInputs,
          verificationPlanId: plan?.verificationPlanId,
          rollbackClass: 'reversible',
          state: 'dispatching',
          intentEventId: historicalOperation.intentEventId,
          resultId: null,
          rollbackPlanId: plan?.rollbackPlanId,
          parentOperationId: parent?.operationId,
          createdAt: historicalOperation.createdAt,
          updatedAt: historicalOperation.createdAt,
          operationHash: `sha256:${'0'.repeat(64)}`,
        }
      : null;
  if (expectedOperation)
    expectedOperation.operationHash = sha256Jcs(
      recordWithoutHash(expectedOperation, 'operationHash'),
    );
  const expectedPendingAssignment = assignment
    ? {
        kind: 'operating-assignment',
        schemaVersion: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
        assignmentId: assignment.assignmentId,
        cycleId: action?.sourceCycleId,
        assignmentKind: 'execution',
        roleId: 'operate-governed-executor',
        objective: `Roll back the governed Action ${action?.actionId} exactly once to its immutable baseline.`,
        state: 'pending',
        dependsOn: [],
        dependencyPolicy: { kind: 'none' },
        inputArtifactIds: expectedInputs,
        inputAbsences: [],
        outputContract: {
          schemaId: 'operating-rollback-result',
          schemaVersion: PROTOCOL_VERSION,
          mediaType: 'application/json',
          encoding: 'utf-8',
          maxBytes: 262144,
        },
        capabilityGrantId: grant?.grantId,
        governedOperationId: historicalOperation?.operationId,
        attemptPolicy: { maxAttempts: 1, attempt: 0, timeoutMs: 30000 },
        claim: null,
        terminalOutcome: null,
        createdAt: historicalOperation?.createdAt,
        availableAt: null,
        completedAt: null,
      }
    : null;
  const expectedAssignment = expectedPendingAssignment
    ? {
        ...clone(expectedPendingAssignment),
        state: terminal ? 'validated' : 'running',
        attemptPolicy: { maxAttempts: 1, attempt: 1, timeoutMs: 30000 },
        claim: {
          actorId: grant?.issuer?.id,
          actorKind: 'agent',
          runtime:
            executorSelection?.status === 'available'
              ? `${executorSelection.registration.provenance.packageName}@${executorSelection.registration.provenance.packageVersion}`
              : null,
          claimId: assignment?.claim?.claimId,
        },
        availableAt: historicalOperation.createdAt,
        completedAt: terminal ? replayEntry?.reservedCompletedAt : null,
      }
    : null;
  const unconsumedGrant = grant ? { ...clone(grant), consumedAt: null } : null;
  if (unconsumedGrant)
    unconsumedGrant.grantHash = sha256Jcs(recordWithoutHash(unconsumedGrant, 'grantHash'));
  const grantExpiry = Date.parse(grant?.expiresAt);
  const authorityExpiries = [
    availability?.expiresAt,
    ...requirements.map(({ expiresAt }) => expiresAt),
    ...approvals.map(({ expiresAt }) => expiresAt),
  ]
    .filter((expiry) => expiry !== null && expiry !== undefined)
    .map(Date.parse);
  const duplicateRollback = [...index.governedOperations.values()].filter(
    (candidate) =>
      candidate.operationKind === 'rollback' &&
      candidate.parentOperationId === operation.parentOperationId &&
      candidate.rollbackPlanId === operation.rollbackPlanId,
  );
  if (
    !replayEntry ||
    replayEntry.operationKind !== 'rollback' ||
    !assignment ||
    !grant ||
    !action ||
    !evaluation ||
    !plan ||
    !parent ||
    !parentResult ||
    !parentReplayEntry ||
    parentReplayEntry.terminalResultId !== parent.resultId ||
    parentReplayEntry.terminalReceipt === null ||
    !intentEvent ||
    !planEvent ||
    !assignmentCreated ||
    !assignmentAvailable ||
    !assignmentClaimed ||
    !assignmentStarted ||
    !availability ||
    !availabilityEvent ||
    !grantEvent ||
    duplicateRollback.length !== 1 ||
    !policyValid ||
    !latestEvaluation ||
    sha256Jcs(latestEvaluation) !== sha256Jcs(evaluation) ||
    replayEntry.operationId !== operation.operationId ||
    replayEntry.requestFingerprint !== operation.requestFingerprint ||
    replayEntry.actionId !== operation.action.actionId ||
    replayEntry.actionRevision !== operation.action.revision ||
    replayEntry.actionHash !== operation.action.actionHash ||
    replayEntry.intentEventId !== operation.intentEventId ||
    replayEntry.reservedResultId.startsWith('rbres_') !== true ||
    replayEntry.reservedUncertaintyResultId.startsWith('rbres_') !== true ||
    sha256Jcs(assignment) !== sha256Jcs(expectedAssignment) ||
    !assignment.claim ||
    assignment.claim.actorId !== grant.issuer.id ||
    typeof assignment.claim.claimId !== 'string' ||
    assignment.claim.claimId.length === 0 ||
    assignment.claim.runtime !== expectedAssignment?.claim?.runtime ||
    grant.operationId !== operation.operationId ||
    grant.assignmentId !== operation.assignmentId ||
    grant.evaluationId !== operation.evaluationId ||
    sha256Jcs(grant.action) !== sha256Jcs(expectedAction) ||
    !sameCanonicalStringSet(grant.approvalIds, operation.approvalIds) ||
    sha256Jcs(grant.capability) !== sha256Jcs(action.requestedCapability) ||
    sha256Jcs(grant.target) !== sha256Jcs(action.targetBinding) ||
    grant.effectClass !== action.effectClass ||
    grant.useLimit !== 1 ||
    grant.issuer.kind !== 'runtime' ||
    typeof grant.issuer.id !== 'string' ||
    grant.scopeHash !== expectedScopeHash ||
    grant.issuedAt !== operation.createdAt ||
    grant.consumedAt !== operation.createdAt ||
    grant.revokedAt !== null ||
    !Number.isFinite(grantExpiry) ||
    grantExpiry <= Date.parse(operation.createdAt) ||
    authorityExpiries.some((expiry) => !Number.isFinite(expiry) || grantExpiry > expiry) ||
    grant.grantHash !== sha256Jcs(recordWithoutHash(grant, 'grantHash')) ||
    availability.status !== 'available' ||
    availability.checkedAt !== operation.createdAt ||
    Date.parse(availability.expiresAt) <= Date.parse(operation.createdAt) ||
    capabilitySelection?.status !== 'available' ||
    availability.reasonCode !== capabilitySelection?.reasonCode ||
    availability.effectCeiling !== capabilitySelection?.registration?.effectCeiling ||
    Date.parse(availability.expiresAt) >
      Date.parse(capabilitySelection?.registration?.health?.expiresAt) ||
    availability.availabilityId !== expectedAvailabilityId ||
    availability.availabilityHash !==
      sha256Jcs(recordWithoutHash(availability, 'availabilityHash')) ||
    sha256Jcs(availability.capability) !== sha256Jcs(action.requestedCapability) ||
    sha256Jcs(availability.target) !== sha256Jcs(action.targetBinding) ||
    plan.operationId !== parent.operationId ||
    plan.executionResultId !== parentResult.resultId ||
    plan.baselineArtifactId !== replayEntry.baselineArtifactId ||
    plan.baselineHash !== replayEntry.baselineHash ||
    parent.operationKind !== 'execute' ||
    parent.state !== 'succeeded' ||
    parent.rollbackClass !== 'reversible' ||
    parentResult.status !== 'succeeded' ||
    parentResult.operationId !== parent.operationId ||
    !isOperatingRollbackEligibilityV2(plan.eligibility) ||
    plan.steps.length !== 1 ||
    plan.steps[0].expectedTargetHash !== parentResult.targetAfterHash ||
    plan.baselineArtifactId !== parentResult.baselineArtifactId ||
    plan.baselineHash !== parentResult.baselineHash ||
    sha256Jcs(operation.action) !== sha256Jcs(parent.action) ||
    sha256Jcs(operation.action) !== sha256Jcs(plan.action) ||
    sha256Jcs(operation.capability) !== sha256Jcs(plan.capability) ||
    operation.effectClass !== plan.effectClass ||
    sha256Jcs(operation.executor) !== sha256Jcs(plan.executor) ||
    operation.verificationPlanId !== plan.verificationPlanId ||
    plan.planHash !== sha256Jcs(recordWithoutHash(plan, 'planHash')) ||
    Date.parse(plan.expiresAt) <= Date.parse(operation.createdAt) ||
    operation.operationKind !== 'rollback' ||
    operation.state === 'rolled-back' ||
    operation.rollbackClass !== 'reversible' ||
    operation.resultId !== replayEntry.terminalResultId ||
    intentEvent.type !== 'operation.intent-recorded' ||
    intentEvent.entityId !== operation.operationId ||
    intentEvent.requestHash !== operation.requestFingerprint ||
    intentEvent.cycleId !== assignment.cycleId ||
    !successSubmission ||
    !uncertaintySubmission ||
    expectedFingerprint !== operation.requestFingerprint ||
    sha256Jcs(historicalOperation) !== sha256Jcs(expectedOperation) ||
    replayEntry.operationHash !== expectedOperation?.operationHash ||
    replayEntry.payloadArtifactId !== action.sourceArtifactId ||
    replayEntry.payloadHash !== parentResult.targetAfterHash ||
    replayEntry.baselineArtifactId !== plan.baselineArtifactId ||
    replayEntry.baselineHash !== plan.baselineHash ||
    replayEntry.targetBeforeHash !== parentResult.targetAfterHash ||
    replayEntry.reservedCompletedAt < operation.createdAt ||
    replayEntry.reservedCorrelationId !== intentEvent.correlationId ||
    successSubmission.assignmentId !== assignment.assignmentId ||
    uncertaintySubmission.assignmentId !== assignment.assignmentId ||
    successSubmission.issuedAt !== operation.createdAt ||
    uncertaintySubmission.issuedAt !== operation.createdAt ||
    (terminal && (!result || !terminalArtifact || !terminalSubmission || !resultEvent)) ||
    (!terminal && (result || replayEntry.terminalReceipt !== null)) ||
    (terminal && terminalReservation.resultId !== result.rollbackResultId) ||
    (terminal && terminalReservation.resultArtifactId !== result.resultArtifactId) ||
    (terminal && terminalReservation.submissionId !== terminalSubmission.submissionId) ||
    (terminal && terminalSubmission.state !== 'accepted') ||
    (terminal && terminalArtifact.schemaId !== 'operating-rollback-result') ||
    (terminal && terminalArtifact.canonicalHash !== sha256Jcs(result)) ||
    (terminal && terminalArtifact.rawHash !== terminalArtifact.canonicalHash) ||
    (terminal &&
      terminalArtifact.sizeBytes !== Buffer.byteLength(canonicalizeJson(result), 'utf8')) ||
    (terminal && resultEvent.type !== 'rollback.result-recorded') ||
    (terminal && resultEvent.entityId !== result.rollbackResultId) ||
    (terminal && result.resultHash !== sha256Jcs(recordWithoutHash(result, 'resultHash'))) ||
    (terminal && unusedSubmission.state !== 'issued') ||
    (terminal && index.rollbackResults.has(unusedReservation.resultId)) ||
    (terminal && index.artifacts.has(unusedReservation.resultArtifactId)) ||
    (terminal &&
      Object.values(unusedReservation.eventIds).some((eventId) => index.eventReplay.has(eventId)))
  ) {
    throw runtimeError(
      'OPERATION_CONFLICT',
      'Rollback checkpoint history is incomplete, divergent, or non-replayable.',
      {
        operationId: operation?.operationId ?? null,
        rollbackPlanId: operation?.rollbackPlanId ?? null,
      },
    );
  }
  assertReplayEventPayload(planEvent, plan, {
    type: 'rollback.plan-recorded',
    entityId: plan.rollbackPlanId,
    cycleId: action.sourceCycleId,
    timestamp: parentResult.completedAt,
    correlationId: `rollback-plan:${plan.rollbackPlanId}`,
    causationId: planEvent.causationId,
    actor: { kind: 'engine', id: grant.issuer.id },
    requestHash: undefined,
  });
  assertReplayEventPayload(assignmentCreated, expectedPendingAssignment, {
    type: 'assignment.created',
    entityId: assignment.assignmentId,
    cycleId: assignment.cycleId,
    timestamp: operation.createdAt,
    correlationId: replayEntry.reservedCorrelationId,
    causationId: assignmentCreated.causationId,
    actor: { kind: 'engine', id: grant.issuer.id },
    requestHash: undefined,
  });
  const releaseId = `rel_${sha256Jcs({
    assignmentId: assignment.assignmentId,
    cycleId: assignment.cycleId,
    dependencyProofs: [],
  }).slice(7, 31)}`;
  assertReplayEventPayload(
    assignmentAvailable,
    {
      assignmentId: assignment.assignmentId,
      releaseId,
      dependencyProofs: [],
      dependencyEventIds: [],
    },
    {
      type: 'assignment.available',
      entityId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      timestamp: operation.createdAt,
      correlationId: replayEntry.reservedCorrelationId,
      causationId: assignmentCreated.eventId,
      actor: { kind: 'engine', id: 'openplanr-scheduler' },
      requestHash: undefined,
    },
  );
  assertReplayEventPayload(
    assignmentClaimed,
    {
      assignmentId: assignment.assignmentId,
      actorId: assignment.claim.actorId,
      actorKind: assignment.claim.actorKind,
      runtime: assignment.claim.runtime,
      claimId: assignment.claim.claimId,
      submissionId: replayEntry.reservedSubmissionId,
    },
    {
      type: 'assignment.claimed',
      entityId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      timestamp: operation.createdAt,
      correlationId: replayEntry.reservedCorrelationId,
      causationId: assignmentAvailable.eventId,
      actor: { kind: 'engine', id: grant.issuer.id },
      requestHash: undefined,
    },
  );
  assertReplayEventPayload(
    assignmentStarted,
    { assignmentId: assignment.assignmentId, attempt: 1 },
    {
      type: 'assignment.started',
      entityId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      timestamp: operation.createdAt,
      correlationId: replayEntry.reservedCorrelationId,
      causationId: assignmentClaimed.eventId,
      actor: { kind: 'engine', id: grant.issuer.id },
      requestHash: undefined,
    },
  );
  assertReplayEventPayload(availabilityEvent, availability, {
    type: 'capability.availability-recorded',
    entityId: availability.availabilityId,
    cycleId: assignment.cycleId,
    timestamp: operation.createdAt,
    correlationId: replayEntry.reservedCorrelationId,
    causationId: assignmentStarted.eventId,
    actor: { kind: 'engine', id: grant.issuer.id },
    requestHash: undefined,
  });
  assertReplayEventPayload(grantEvent, unconsumedGrant, {
    type: 'capability.granted',
    entityId: grant.grantId,
    cycleId: assignment.cycleId,
    timestamp: operation.createdAt,
    correlationId: replayEntry.reservedCorrelationId,
    causationId: availabilityEvent.eventId,
    actor: { kind: 'engine', id: grant.issuer.id },
    requestHash: undefined,
  });
  assertReplayEventPayload(
    intentEvent,
    {
      operation: historicalOperation,
      request: {
        payload: {
          artifactId: replayEntry.payloadArtifactId,
          contentHash: replayEntry.payloadHash,
        },
        rollbackBaseline: {
          artifactId: replayEntry.baselineArtifactId,
          contentHash: replayEntry.baselineHash,
        },
        targetBeforeHash: replayEntry.targetBeforeHash,
      },
      terminal: {
        resultId: replayEntry.reservedResultId,
        resultArtifactId: replayEntry.reservedResultArtifactId,
        submissionId: replayEntry.reservedSubmissionId,
        eventIds: clone(replayEntry.reservedTerminalEventIds),
        completedAt: replayEntry.reservedCompletedAt,
        correlationId: replayEntry.reservedCorrelationId,
        uncertainty: {
          resultId: replayEntry.reservedUncertaintyResultId,
          resultArtifactId: replayEntry.reservedUncertaintyResultArtifactId,
          submissionId: replayEntry.reservedUncertaintySubmissionId,
          eventIds: clone(replayEntry.reservedUncertaintyTerminalEventIds),
        },
      },
    },
    {
      type: 'operation.intent-recorded',
      entityId: operation.operationId,
      cycleId: assignment.cycleId,
      timestamp: operation.createdAt,
      correlationId: replayEntry.reservedCorrelationId,
      causationId: grantEvent.eventId,
      actor: { kind: 'engine', id: grant.issuer.id },
      requestHash: operation.requestFingerprint,
    },
  );
  if (terminal) {
    const expectedResultEventIds = [
      operation.intentEventId,
      terminalReservation.eventIds.submitted,
      terminalReservation.eventIds.artifactCreated,
      terminalReservation.eventIds.validated,
      terminalReservation.eventIds.resultRecorded,
    ];
    const operationMappings = {
      operationKind: 'operationKind',
      requestFingerprint: 'requestFingerprint',
      action: 'action',
      assignmentId: 'assignmentId',
      evaluationId: 'evaluationId',
      approvalIds: 'approvalIds',
      grantId: 'grantId',
      capability: 'capability',
      target: 'target',
      effectClass: 'effectClass',
      executor: 'executor',
      connector: 'connector',
      inputArtifactIds: 'inputArtifactIds',
      verificationPlanId: 'verificationPlanId',
      rollbackPlanId: 'rollbackPlanId',
    };
    const resultStatusValid =
      ['succeeded', 'partial', 'failed', 'blocked', 'uncertain'].includes(result.status) &&
      result.status === operation.state &&
      result.originalOperationId === parent.operationId &&
      result.executionResultId === parentResult.resultId &&
      result.targetBeforeHash === replayEntry.targetBeforeHash &&
      result.baselineArtifactId === plan.baselineArtifactId &&
      result.baselineHash === plan.baselineHash &&
      result.resultArtifactId === terminalArtifact.artifactId &&
      result.completedAt === replayEntry.reservedCompletedAt &&
      sameCanonicalStringSet(result.outputArtifactIds, [terminalArtifact.artifactId]) &&
      sameCanonicalStringSet(result.eventIds, expectedResultEventIds) &&
      Object.entries(operationMappings).every(
        ([resultField, operationField]) =>
          sha256Jcs(result[resultField]) === sha256Jcs(operation[operationField]),
      ) &&
      result.effectSummary.summary ===
        {
          succeeded:
            result.targetBeforeHash === plan.baselineHash
              ? 'The target already equalled the exact immutable baseline.'
              : 'Restored the exact immutable pre-effect baseline.',
          partial: 'Rollback changed the target without restoring the exact immutable baseline.',
          failed: 'Rollback failed without a proven target postcondition.',
          blocked: 'Rollback was blocked without touching the target.',
          uncertain:
            'Rollback outcome is uncertain; reconciliation is required before further remediation.',
        }[result.status] &&
      sameCanonicalStringSet(
        result.effectSummary.affectedTargetIds,
        ['failed', 'blocked'].includes(result.status) ? [] : [operation.target.id],
      ) &&
      (result.status === 'succeeded'
        ? result.targetAfterHash === plan.baselineHash &&
          result.effectSummary.changed === (result.targetBeforeHash !== result.targetAfterHash)
        : result.status === 'partial'
          ? typeof result.targetAfterHash === 'string' &&
            result.targetAfterHash !== plan.baselineHash &&
            result.effectSummary.changed === true
          : result.targetAfterHash === null && result.effectSummary.changed === false);
    if (!resultStatusValid) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Rollback result is not the exact status-bound compensation projection.',
        {
          rollbackResultId: result.rollbackResultId,
        },
      );
    }
    assertReplayEventPayload(resultEvent, result, {
      type: 'rollback.result-recorded',
      entityId: result.rollbackResultId,
      cycleId: assignment.cycleId,
      timestamp: result.completedAt,
      correlationId: replayEntry.reservedCorrelationId,
      causationId: terminalReservation.eventIds.validated,
      actor: { kind: 'engine', id: grant.issuer.id },
      requestHash: undefined,
    });
  }
  return {
    operation: clone(operation),
    action: clone(action),
    assignment: clone(assignment),
    evaluation: clone(evaluation),
    grant: clone(grant),
    availability: clone(availability),
    plan: clone(plan),
    parent: clone(parent),
    parentResult: clone(parentResult),
    parentReplayEntry: clone(parentReplayEntry),
    result: clone(result),
    artifact: clone(terminalArtifact),
    replayEntry: clone(replayEntry),
    intentOperation: clone(historicalOperation),
    intentAssignment: expectedAssignment
      ? {
          ...clone(expectedAssignment),
          state: 'running',
          completedAt: null,
        }
      : null,
    intentGrant: clone(unconsumedGrant),
    intentReplayEntry: replayEntry
      ? {
          ...clone(replayEntry),
          terminalResultId: null,
          terminalReceipt: null,
        }
      : null,
  };
}

function selectCheckpointTerminalVerificationAssignmentV2({
  index,
  action,
  cycle,
  operation,
  result,
  verificationPlan,
}) {
  const expected = buildOperatingTerminalVerificationAssignmentV2({
    action,
    cycle,
    operation,
    result,
    verificationPlan,
    timestamp: result.completedAt,
  });
  const candidates = [...index.assignments.values()].filter(
    (candidate) =>
      candidate.assignmentId === expected.assignmentId ||
      (candidate.assignmentKind === 'verification' &&
        candidate.governedOperationId === operation.operationId),
  );
  for (const candidate of candidates) {
    assertProtocolArtifact('operating-assignment', candidate, {
      protocolVersion: PROTOCOL_VERSION,
    });
  }
  if (candidates.length !== 1) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Terminal result requires exactly one canonical verification Assignment owner.',
      {
        actionId: action.actionId,
        operationId: operation.operationId,
        resultId: result.resultId ?? result.rollbackResultId,
        expectedAssignmentId: expected.assignmentId,
        candidateAssignmentIds: candidates.map(({ assignmentId }) => assignmentId).sort(),
      },
    );
  }
  const assignment = candidates[0];
  const initialProjection = {
    ...clone(assignment),
    state: expected.state,
    attemptPolicy: {
      ...clone(assignment.attemptPolicy),
      attempt: expected.attemptPolicy.attempt,
    },
    claim: expected.claim,
    terminalOutcome: expected.terminalOutcome,
    availableAt: expected.availableAt,
    completedAt: expected.completedAt,
  };
  if (sha256Jcs(initialProjection) !== sha256Jcs(expected)) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Verification Assignment immutable fields diverge from its canonical terminal owner.',
      {
        assignmentId: assignment.assignmentId,
        operationId: operation.operationId,
      },
    );
  }

  const entries = (type) =>
    [...index.eventReplay.values()].filter(
      (entry) => entry.type === type && entry.entityId === assignment.assignmentId,
    );
  const oneEntry = (type) => {
    const matches = entries(type);
    return matches.length === 1 ? matches[0] : null;
  };
  const created = oneEntry('assignment.created');
  if (!created) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Verification Assignment requires one canonical creation Event.',
      {
        assignmentId: assignment.assignmentId,
      },
    );
  }
  assertReplayEventPayload(created, expected, {
    type: 'assignment.created',
    entityId: expected.assignmentId,
    cycleId: cycle.cycleId,
    timestamp: result.completedAt,
    correlationId: created.correlationId,
    causationId: created.causationId,
    actor: created.actor,
    requestHash: undefined,
  });

  const lifecycleTypes = [
    'assignment.available',
    'assignment.claimed',
    'assignment.started',
    'assignment.submitted',
    'assignment.validated',
    'assignment.rejected',
    'assignment.abandoned',
    'assignment.failed',
  ];
  if (lifecycleTypes.some((type) => entries(type).length > 1)) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Verification Assignment lifecycle contains duplicate transition Events.',
      {
        assignmentId: assignment.assignmentId,
      },
    );
  }
  const available = oneEntry('assignment.available');
  const claimed = oneEntry('assignment.claimed');
  const started = oneEntry('assignment.started');
  const submitted = oneEntry('assignment.submitted');
  const validated = oneEntry('assignment.validated');
  const rejected = oneEntry('assignment.rejected');
  const abandoned = oneEntry('assignment.abandoned');
  const failed = oneEntry('assignment.failed');
  const actualEvents = lifecycleTypes.filter((type) => oneEntry(type));
  const expectedEvents = {
    pending: [],
    available: ['assignment.available'],
    claimed: ['assignment.available', 'assignment.claimed'],
    running: ['assignment.available', 'assignment.claimed', 'assignment.started'],
    submitted: [
      'assignment.available',
      'assignment.claimed',
      'assignment.started',
      'assignment.submitted',
    ],
    validated: [
      'assignment.available',
      'assignment.claimed',
      'assignment.started',
      'assignment.submitted',
      'assignment.validated',
    ],
    rejected: [
      'assignment.available',
      'assignment.claimed',
      'assignment.started',
      'assignment.submitted',
      'assignment.rejected',
    ],
    abandoned: ['assignment.abandoned'],
    failed: ['assignment.failed'],
  }[assignment.state];
  if (!expectedEvents || !sameCanonicalStringSet(actualEvents, expectedEvents)) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Verification Assignment lifecycle projection is not backed by its exact transition Events.',
      {
        assignmentId: assignment.assignmentId,
        state: assignment.state,
        eventTypes: actualEvents,
      },
    );
  }

  let projected = clone(expected);
  if (available) {
    const dependencyProofs = [];
    const releaseId = `rel_${sha256Jcs({
      assignmentId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      dependencyProofs,
    }).slice(7, 31)}`;
    assertReplayEventPayload(
      available,
      {
        assignmentId: assignment.assignmentId,
        releaseId,
        dependencyProofs,
        dependencyEventIds: [],
      },
      {
        type: 'assignment.available',
        entityId: assignment.assignmentId,
        cycleId: assignment.cycleId,
        timestamp: expected.createdAt,
        correlationId: created.correlationId,
        causationId: created.eventId,
        actor: { kind: 'engine', id: 'openplanr-scheduler' },
        requestHash: undefined,
      },
    );
    projected = transitionOperatingAssignmentV2(projected, 'available', {
      availableAt: available.timestamp,
    });
  }
  const linkedSubmissions = [...index.submissions.values()].filter(
    ({ assignmentId }) => assignmentId === assignment.assignmentId,
  );
  const submission = linkedSubmissions.length === 1 ? linkedSubmissions[0] : null;
  if (claimed) {
    if (!submission || !assignment.claim) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Verification Assignment claim lacks one runtime-issued Submission.',
        {
          assignmentId: assignment.assignmentId,
        },
      );
    }
    assertReplayEventPayload(
      claimed,
      {
        assignmentId: assignment.assignmentId,
        actorId: assignment.claim.actorId,
        actorKind: assignment.claim.actorKind,
        runtime: assignment.claim.runtime,
        claimId: assignment.claim.claimId,
        submissionId: submission.submissionId,
      },
      {
        type: 'assignment.claimed',
        entityId: assignment.assignmentId,
        cycleId: assignment.cycleId,
        timestamp: claimed.timestamp,
        correlationId: claimed.correlationId,
        causationId: claimed.causationId,
        actor: claimed.actor,
        requestHash: undefined,
      },
    );
    projected = transitionOperatingAssignmentV2(projected, 'claimed', {
      claim: clone(assignment.claim),
    });
  }
  if (started) {
    assertReplayEventPayload(
      started,
      {
        assignmentId: assignment.assignmentId,
        attempt: assignment.attemptPolicy.attempt,
      },
      {
        type: 'assignment.started',
        entityId: assignment.assignmentId,
        cycleId: assignment.cycleId,
        timestamp: started.timestamp,
        correlationId: started.correlationId,
        causationId: started.causationId,
        actor: started.actor,
        requestHash: undefined,
      },
    );
    projected = transitionOperatingAssignmentV2(projected, 'running', {
      attemptPolicy: clone(assignment.attemptPolicy),
    });
  }
  if (submitted) {
    if (!submission) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Verification Assignment submission Event lacks one durable Submission.',
        {
          assignmentId: assignment.assignmentId,
        },
      );
    }
    assertReplayEventPayload(
      submitted,
      {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
        rawHash: submission.rawHash,
        canonicalHash: submission.canonicalHash,
        sizeBytes: submission.sizeBytes,
        mediaType: assignment.outputContract.mediaType,
        encoding: assignment.outputContract.encoding,
      },
      {
        type: 'assignment.submitted',
        entityId: assignment.assignmentId,
        cycleId: assignment.cycleId,
        timestamp: submitted.timestamp,
        correlationId: submitted.correlationId,
        causationId: submitted.causationId,
        actor: submitted.actor,
        requestHash: undefined,
      },
    );
    projected = transitionOperatingAssignmentV2(projected, 'submitted');
  }
  if (validated) {
    const artifact = submission ? index.artifacts.get(submission.artifactId) : null;
    const replay = submission ? index.replay.get(submission.submissionId) : null;
    if (
      !submission ||
      !artifact ||
      !replay ||
      submission.acceptanceEventIds.at(-1) !== validated.eventId
    ) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Verification Assignment validation lacks its accepted Artifact and replay proof.',
        {
          assignmentId: assignment.assignmentId,
        },
      );
    }
    try {
      assertOperatingValidatedDependencyProofV2({ assignment, submission, artifact, replay });
    } catch (error) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        error.message,
        error.details ?? {
          assignmentId: assignment.assignmentId,
        },
      );
    }
    projected = transitionOperatingAssignmentV2(projected, 'validated', {
      completedAt: validated.timestamp,
    });
  }
  if (rejected) {
    if (!submission || submission.state !== 'rejected') {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Verification Assignment rejection lacks its durable rejected Submission.',
        {
          assignmentId: assignment.assignmentId,
        },
      );
    }
    assertReplayEventPayload(
      rejected,
      {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
        attempt: assignment.attemptPolicy.attempt,
        violations: clone(submission.responseData?.violations),
        attemptsRemaining: submission.responseData?.attemptsRemaining,
      },
      {
        type: 'assignment.rejected',
        entityId: assignment.assignmentId,
        cycleId: assignment.cycleId,
        timestamp: rejected.timestamp,
        correlationId: rejected.correlationId,
        causationId: rejected.causationId,
        actor: rejected.actor,
        requestHash: undefined,
      },
    );
    projected = transitionOperatingAssignmentV2(projected, 'rejected');
  }
  const terminal = abandoned ?? failed;
  if (terminal) {
    const terminalState = terminal.type === 'assignment.abandoned' ? 'abandoned' : 'failed';
    const payload =
      terminalState === 'abandoned'
        ? {
            assignmentId: assignment.assignmentId,
            reasonCode: assignment.terminalOutcome?.code,
            reason: assignment.terminalOutcome?.reason,
            recoveryDisposition: assignment.terminalOutcome?.recoveryDisposition,
          }
        : {
            assignmentId: assignment.assignmentId,
            errorCode: assignment.terminalOutcome?.code,
            reason: assignment.terminalOutcome?.reason,
            recoveryStatus: assignment.terminalOutcome?.recoveryDisposition,
          };
    assertReplayEventPayload(terminal, payload, {
      type: terminal.type,
      entityId: assignment.assignmentId,
      cycleId: assignment.cycleId,
      timestamp: terminal.timestamp,
      correlationId: terminal.correlationId,
      causationId: terminal.causationId,
      actor: terminal.actor,
      requestHash: undefined,
    });
    projected = transitionOperatingAssignmentV2(projected, terminalState, {
      completedAt: terminal.timestamp,
      terminalOutcome: clone(assignment.terminalOutcome),
    });
  }
  if (sha256Jcs(projected) !== sha256Jcs(assignment)) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Verification Assignment lifecycle fields diverge from their canonical Events.',
      {
        assignmentId: assignment.assignmentId,
        state: assignment.state,
      },
    );
  }
  return clone(assignment);
}

function assertCheckpointTerminalVerificationAssignmentsV2(index) {
  for (const operation of index.governedOperations.values()) {
    if (operation.resultId === null) continue;
    const result =
      operation.operationKind === 'rollback'
        ? index.rollbackResults.get(operation.resultId)
        : index.executionResults.get(operation.resultId);
    if (!result) continue;
    const resultId = result.resultId ?? result.rollbackResultId;
    const identities = deriveOperatingExecutionLifecycleIdentitiesV2({
      operationId: operation.operationId,
      resultId,
    });
    const created = index.eventReplay.get(identities.eventIds.verificationAssignmentCreated);
    const candidates = [...index.assignments.values()].filter(
      (candidate) =>
        candidate.assignmentId === identities.assignmentId ||
        (candidate.assignmentKind === 'verification' &&
          candidate.governedOperationId === operation.operationId),
    );
    // Checkpoints older than lifecycle Events have neither lifecycle Event nor verification
    // Assignment. Once either appears, their complete canonical pair is atomic.
    if (!created && candidates.length === 0) continue;
    const action = index.actions.get(operation.action.actionId);
    const cycle = action ? index.cycles.get(action.sourceCycleId) : null;
    const verificationPlan = index.verificationPlans.get(operation.verificationPlanId);
    assertOperatingActionCyclePlanOwnershipV2({ action, cycle, verificationPlan, operation });
    const assignment = selectCheckpointTerminalVerificationAssignmentV2({
      index,
      action,
      cycle,
      operation,
      result,
      verificationPlan,
    });
    if (
      !created ||
      created.type !== 'assignment.created' ||
      created.entityId !== assignment.assignmentId ||
      created.cycleId !== cycle.cycleId ||
      created.timestamp !== result.completedAt ||
      created.payloadHash !==
        sha256Jcs(
          buildOperatingTerminalVerificationAssignmentV2({
            action,
            cycle,
            operation,
            result,
            verificationPlan,
            timestamp: result.completedAt,
          }),
        )
    ) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Checkpoint verification Assignment and creation Event must equal one canonical terminal owner.',
        {
          operationId: operation.operationId,
          resultId,
          assignmentId: assignment.assignmentId,
        },
      );
    }
  }
}

function assertIntelligenceCheckpointIntegrity(index) {
  for (const plan of index.intelligencePlans.values()) {
    const assignments = plan.selectedRoles.map((role) =>
      index.assignments.get(
        deriveOperatingIntelligenceAssignmentIdV2(plan.planId, role.roleId, role.roleVersion),
      ),
    );
    if (assignments.some((assignment) => !assignment)) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Checkpoint intelligence plan is missing a canonical Assignment.',
        {
          planId: plan.planId,
        },
      );
    }
    const cycleIds = new Set(assignments.map(({ cycleId }) => cycleId));
    const cycle = cycleIds.size === 1 ? index.cycles.get(assignments[0].cycleId) : null;
    const snapshot = index.operatingSnapshots.get(plan.snapshotId);
    if (!cycle || !snapshot) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Checkpoint intelligence plan is missing its exact Cycle or snapshot.',
        {
          planId: plan.planId,
        },
      );
    }
    try {
      validateOperatingIntelligenceAssignmentGraphV2(plan, assignments, {
        allowLifecycleProgress: true,
        canonicalContext: { cycle, snapshot },
      });
    } catch (error) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        error.message,
        error.details ?? { planId: plan.planId },
      );
    }
    const planEvents = [...index.eventReplay.values()].filter(
      (entry) => entry.type === 'intelligence.plan-recorded' && entry.entityId === plan.planId,
    );
    if (
      planEvents.length !== 1 ||
      planEvents[0].cycleId !== cycle.cycleId ||
      planEvents[0].timestamp !== plan.createdAt ||
      planEvents[0].actor.kind !== 'runtime' ||
      planEvents[0].actor.id !== 'openplanr' ||
      planEvents[0].payloadHash !== sha256Jcs(plan)
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Checkpoint intelligence plan differs from its runtime-issued Event.',
        {
          planId: plan.planId,
        },
      );
    }
    const planEvent = planEvents[0];
    for (const [position, assignment] of assignments.entries()) {
      const role = plan.selectedRoles[position];
      const baseEvidenceAbsences = assignment.inputAbsences.filter(
        (absence) =>
          absence.kind === 'evidence' &&
          absence.absenceId ===
            deriveOperatingEvidenceAbsenceIdV2({
              bundleId: assignment.intelligenceContext.inputBundle.bundleId,
              roleId: assignment.roleId,
              roleVersion: assignment.roleVersion,
              requirementId: absence.requirementId,
              absenceCode: absence.absenceCode,
              sourceEvidenceRefIds: absence.sourceEvidenceRefIds,
              sourceEventIds: absence.sourceEventIds,
            }),
      );
      const expectedCreationRecord = {
        ...clone(assignment),
        state: 'pending',
        inputArtifactIds: [...role.inputArtifactIds],
        inputAbsences: baseEvidenceAbsences,
        attemptPolicy: { ...clone(assignment.attemptPolicy), attempt: 0 },
        claim: null,
        terminalOutcome: null,
        availableAt: null,
        completedAt: null,
      };
      const creationEvent = index.eventReplay.get(
        intelligenceAssignmentCreationEventId(plan.planId, assignment.assignmentId),
      );
      if (
        !creationEvent ||
        creationEvent.type !== 'assignment.created' ||
        creationEvent.entityId !== assignment.assignmentId ||
        creationEvent.cycleId !== cycle.cycleId ||
        creationEvent.causationId !== planEvent.eventId ||
        creationEvent.timestamp !== plan.createdAt ||
        creationEvent.correlationId !== planEvent.correlationId ||
        creationEvent.requestHash !== planEvent.requestHash ||
        creationEvent.actor.kind !== 'runtime' ||
        creationEvent.actor.id !== 'openplanr' ||
        creationEvent.payloadHash !== sha256Jcs(expectedCreationRecord)
      ) {
        throw runtimeError(
          'STATE_TRANSITION_INVALID',
          'Checkpoint intelligence Assignment differs from its runtime-issued immutable intent.',
          {
            planId: plan.planId,
            assignmentId: assignment.assignmentId,
          },
        );
      }
    }
  }
}

function indexRuntimeState(state, { skipRollbackAuthorityValidation = false } = {}) {
  const eventReplay = indexBy(state.eventReplayIndex, 'eventId', 'event replay entry');
  const eventSequences = new Map();
  for (const entry of eventReplay.values()) {
    if (entry.sequence > state.eventHead.sequence || eventSequences.has(entry.sequence)) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'The durable Event replay index is incomplete or inconsistent.',
      );
    }
    eventSequences.set(entry.sequence, entry);
  }
  if (eventReplay.size !== state.eventHead.sequence) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'The durable Event replay index does not cover the checkpoint event head.',
    );
  }
  for (let sequence = 1; sequence <= state.eventHead.sequence; sequence += 1) {
    const entry = eventSequences.get(sequence);
    const prior = sequence === 1 ? null : eventSequences.get(sequence - 1);
    if (!entry) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'The durable Event replay index has a sequence gap.',
      );
    }
    if (entry.previousEventHash !== (prior?.eventHash ?? null)) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'The durable Event replay index has a broken hash chain.',
        {
          eventId: entry.eventId,
        },
      );
    }
  }
  if (
    state.eventHead.sequence > 0 &&
    eventSequences.get(state.eventHead.sequence)?.eventHash !== state.eventHead.hash
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'The durable Event replay index does not match the checkpoint event head.',
    );
  }
  const evidenceRefs = indexBy(state.evidenceRefs ?? [], 'evidenceRefId', 'EvidenceRef');
  const evidenceResolutions = indexBy(
    state.evidenceResolutions ?? [],
    'resolutionId',
    'evidence resolution',
  );
  const evidenceEdges = indexBy(state.evidenceEdges ?? [], 'edgeId', 'evidence edge');
  const evidenceReplay = indexBy(
    state.evidenceResolutionReplayIndex ?? [],
    'resolutionId',
    'evidence resolution replay entry',
  );
  const evidenceCandidateIds = new Map();
  for (const replay of evidenceReplay.values()) {
    const resolution = evidenceResolutions.get(replay.resolutionId);
    if (
      !resolution ||
      resolution.candidateId !== replay.candidateId ||
      resolution.sourceArtifactId !== replay.sourceArtifactId ||
      resolution.outcome !== replay.outcome ||
      resolution.evidenceRefId !== replay.evidenceRefId ||
      resolution.evidenceArtifactId !== replay.evidenceArtifactId
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'The durable evidence replay index is incomplete or inconsistent.',
        {
          resolutionId: replay.resolutionId,
        },
      );
    }
    if (evidenceCandidateIds.has(replay.candidateId)) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'A candidate may have only one durable evidence resolution identity.',
        {
          candidateId: replay.candidateId,
        },
      );
    }
    evidenceCandidateIds.set(replay.candidateId, replay.resolutionId);
  }
  if (evidenceReplay.size !== evidenceResolutions.size) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Every durable evidence resolution requires one replay entry.',
    );
  }
  const assignments = indexBy(state.assignments, 'assignmentId', 'assignment');
  const submissions = indexBy(state.submissions, 'submissionId', 'submission');
  const artifacts = indexBy(state.artifacts, 'artifactId', 'artifact');
  const replay = indexBy(state.submissionReplayIndex, 'submissionId', 'submission replay entry');
  const acceptedSubmissions = [...submissions.values()].filter(
    ({ state: submissionState }) => submissionState === 'accepted',
  );
  if (replay.size !== acceptedSubmissions.length) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Every accepted Submission requires one exact durable replay proof.',
    );
  }
  for (const submission of acceptedSubmissions) {
    const assignment = assignments.get(submission.assignmentId);
    const artifact = artifacts.get(submission.artifactId);
    const replayEntry = replay.get(submission.submissionId);
    if (!assignment || !artifact || !replayEntry) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Accepted Submission proof identities are incomplete.',
        {
          submissionId: submission.submissionId,
        },
      );
    }
    try {
      assertOperatingValidatedDependencyProofV2({
        assignment,
        submission,
        artifact,
        replay: replayEntry,
      });
    } catch (error) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        error.message,
        error.details ?? {
          submissionId: submission.submissionId,
        },
      );
    }
  }
  const index = {
    authorityHistoryEnabled: Object.hasOwn(state, 'actionPolicies'),
    executiveBoardsEnabled: Object.hasOwn(state, 'executiveBoards'),
    cycles: indexBy(state.cycles, 'cycleId', 'cycle'),
    inputBindings: indexBy(state.inputBindings, 'inputBindingId', 'input binding'),
    assignments,
    reviews: indexBy(state.reviews, 'reviewId', 'review'),
    executiveBoards: indexBy(state.executiveBoards ?? [], 'boardId', 'Executive Board'),
    submissions,
    artifacts,
    findings: indexBy(state.findings, 'findingId', 'finding'),
    decisions: indexBy(state.decisions, 'decisionId', 'decision'),
    actions: indexBy(state.actions, 'actionId', 'action'),
    operatingModelStates: indexBy(
      state.operatingModelStates ?? [],
      'stateId',
      'operating-model state',
    ),
    operatingSnapshots: indexBy(state.operatingSnapshots ?? [], 'snapshotId', 'operating snapshot'),
    objectives: indexBy(state.objectives ?? [], 'objectiveId', 'objective'),
    metrics: indexBy(state.metrics ?? [], 'metricId', 'metric'),
    metricObservations: indexBy(
      state.metricObservations ?? [],
      'observationId',
      'metric observation',
    ),
    risks: indexBy(state.risks ?? [], 'riskId', 'risk'),
    assumptions: indexBy(state.assumptions ?? [], 'assumptionId', 'assumption'),
    claims: indexBy(state.claims ?? [], 'claimId', 'claim'),
    deltas: indexBy(state.deltas ?? [], 'deltaId', 'delta'),
    intelligencePlans: indexBy(state.intelligencePlans ?? [], 'planId', 'intelligence plan'),
    decisionLedgers: indexBy(state.decisionLedgers ?? [], 'ledgerId', 'decision ledger'),
    verificationPlans: indexBy(
      state.verificationPlans ?? [],
      'verificationPlanId',
      'action verification plan',
    ),
    outcomes: indexBy(state.outcomes ?? [], 'outcomeId', 'outcome'),
    learnings: indexBy(state.learnings ?? [], 'learningId', 'learning'),
    scenarios: indexBy(state.scenarios ?? [], 'scenarioId', 'scenario'),
    eventTriggers: indexBy(state.eventTriggers ?? [], 'triggerId', 'event trigger'),
    actionPolicies: indexPolicies(state.actionPolicies ?? []),
    policyEvaluations: indexBy(state.policyEvaluations ?? [], 'evaluationId', 'policy evaluation'),
    approvalRequirements: indexBy(
      state.approvalRequirements ?? [],
      'requirementId',
      'approval requirement',
    ),
    approvalRecords: indexBy(state.approvalRecords ?? [], 'approvalId', 'approval record'),
    capabilityAvailability: indexBy(
      state.capabilityAvailability ?? [],
      'availabilityId',
      'capability availability',
    ),
    capabilityGrants: indexBy(state.capabilityGrants ?? [], 'grantId', 'capability grant'),
    governedOperations: indexBy(
      state.governedOperations ?? [],
      'operationId',
      'governed operation',
    ),
    executionResults: indexBy(state.executionResults ?? [], 'resultId', 'execution result'),
    rollbackPlans: indexBy(state.rollbackPlans ?? [], 'rollbackPlanId', 'rollback plan'),
    rollbackResults: indexBy(state.rollbackResults ?? [], 'rollbackResultId', 'rollback result'),
    operationReplayIndex: indexBy(
      state.operationReplayIndex ?? [],
      'operationId',
      'operation replay entry',
    ),
    replay,
    workReplay: indexBy(
      state.workChangeSetReplayIndex,
      'artifactId',
      'work-change-set replay entry',
    ),
    evidenceRefs,
    evidenceResolutions,
    evidenceEdges,
    evidenceReplay,
    evidenceCandidateIds,
    eventReplay,
  };
  const boardReviewOwners = new Set();
  for (const board of index.executiveBoards.values()) {
    assertOperatingExecutiveBoardV2(board, { materializedOnly: true });
    const owner = `${board.cycleId}\0${board.reviewId}`;
    if (boardReviewOwners.has(owner)) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'A Cycle Review may have only one materialized Executive Board.',
        {
          cycleId: board.cycleId,
          reviewId: board.reviewId,
        },
      );
    }
    boardReviewOwners.add(owner);
    const boardEvents = [...index.eventReplay.values()].filter(
      (entry) =>
        entry.type === 'executive-board.materialized' &&
        entry.entityId === board.boardId &&
        entry.cycleId === board.cycleId,
    );
    const boardEvent = boardEvents.length === 1 ? boardEvents[0] : null;
    const reviewEvents = [...index.eventReplay.values()].filter(
      (entry) =>
        entry.type === 'review.created' &&
        entry.entityId === board.reviewId &&
        entry.cycleId === board.cycleId,
    );
    const reviewEvent = reviewEvents.length === 1 ? reviewEvents[0] : null;
    const review = index.reviews.get(board.reviewId);
    const submissionEvents = [...index.eventReplay.values()].filter(
      (entry) =>
        entry.type === 'review.submitted' &&
        entry.entityId === board.reviewId &&
        entry.cycleId === board.cycleId,
    );
    const creationProjection =
      submissionEvents.length === 1
        ? (submissionEvents[0].receiptProjection?.read?.review ?? null)
        : null;
    const currentReviewBound =
      review?.state === 'pending'
        ? sha256Jcs(review) === board.reviewHash
        : submissionEvents.length === 1 &&
          creationProjection &&
          sha256Jcs(creationProjection) === board.reviewHash &&
          creationProjection.reviewId === review?.reviewId &&
          creationProjection.cycleId === review?.cycleId &&
          creationProjection.ownerActorId === review?.ownerActorId &&
          creationProjection.createdAt === review?.createdAt &&
          sha256Jcs(creationProjection.subject ?? null) === sha256Jcs(review?.subject ?? null);
    if (
      !boardEvent ||
      boardEvent.eventId !== board.materializedEventId ||
      boardEvent.sequence !== board.sourceEventHead.sequence + 1 ||
      boardEvent.previousEventHash !== board.sourceEventHead.hash ||
      boardEvent.payloadHash !== sha256Jcs(board) ||
      boardEvent.timestamp !== board.createdAt ||
      boardEvent.actor.kind !== 'runtime' ||
      boardEvent.actor.id !== 'openplanr' ||
      !reviewEvent ||
      reviewEvent.sequence !== boardEvent.sequence + 1 ||
      reviewEvent.previousEventHash !== boardEvent.eventHash ||
      reviewEvent.payloadHash !== board.reviewHash ||
      reviewEvent.timestamp !== board.createdAt ||
      reviewEvent.causationId !== boardEvent.eventId ||
      reviewEvent.correlationId !== boardEvent.correlationId ||
      !review ||
      !currentReviewBound ||
      review.cycleId !== board.cycleId ||
      review.subject?.type === 'action' ||
      review.createdAt !== board.createdAt
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Executive Board checkpoint custody does not bind one adjacent creation Event and exact following Review.',
        {
          boardId: board.boardId,
          cycleId: board.cycleId,
          reviewId: board.reviewId,
        },
      );
    }
  }
  for (const submission of acceptedSubmissions) {
    const assignment = index.assignments.get(submission.assignmentId);
    const artifact = index.artifacts.get(submission.artifactId);
    const cycle = assignment ? index.cycles.get(assignment.cycleId) : null;
    if (
      !assignment ||
      !artifact ||
      !cycle ||
      artifact.cycleId !== cycle.cycleId ||
      artifact.scopeId !== cycle.scopeId ||
      artifact.domainId !== cycle.domainId ||
      artifact.domainVersion !== cycle.domainVersion
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Accepted Artifact checkpoint scope differs from its exact Cycle binding.',
        {
          submissionId: submission.submissionId,
          assignmentId: submission.assignmentId,
        },
      );
    }
  }
  assertIntelligenceCheckpointIntegrity(index);
  for (const action of index.actions.values()) {
    assertOperatingActionCyclePlanOwnershipV2({
      action,
      cycle: index.cycles.get(action.sourceCycleId),
      verificationPlan: index.verificationPlans.get(action.verificationPlanId),
      allowAbsentOptionalRecords: true,
    });
  }
  if (index.authorityHistoryEnabled) {
    for (const action of index.actions.values()) {
      if (!Object.hasOwn(action, 'revisionId')) continue;
      try {
        assertPersistentOperatingActionAuthorityV2(action);
      } catch (error) {
        throw runtimeError(
          error.code ?? 'ACTION_REVISION_MISMATCH',
          error.message,
          error.details?.context ?? {
            actionId: action.actionId,
          },
        );
      }
    }
    assertOperatingApprovalRequirementSetIntegrityV2({
      requirements: [...index.approvalRequirements.values()],
    });
    for (const requirement of index.approvalRequirements.values()) {
      assertOperatingApprovalRequirementIntegrityV2(requirement);
      const evaluation = index.policyEvaluations.get(requirement.evaluationId);
      if (!evaluation) continue;
      const action = index.actions.get(requirement.action.actionId);
      if (!action) {
        throw runtimeError(
          'APPROVAL_INVALID',
          'Checkpoint approval requirement references an unavailable Action.',
          {
            requirementId: requirement.requirementId,
          },
        );
      }
      assertOperatingApprovalRequirementV2(requirement, { evaluation, action });
    }
    for (const evaluation of index.policyEvaluations.values()) {
      const action = index.actions.get(evaluation.action.actionId);
      if (!action) {
        throw runtimeError(
          'POLICY_EVALUATION_REJECTED',
          'Checkpoint policy evaluation references an unavailable Action.',
          {
            evaluationId: evaluation.evaluationId,
            actionId: evaluation.action.actionId,
          },
        );
      }
      try {
        assertOperatingPolicyEvaluationV2(evaluation, {
          action,
          configuredPolicies: [...index.actionPolicies.values()],
        });
      } catch (error) {
        throw runtimeError(
          error.code ?? 'POLICY_EVALUATION_REJECTED',
          error.message,
          error.details?.context ?? {
            evaluationId: evaluation.evaluationId,
          },
        );
      }
      const requirements = evaluation.approvalRequirementIds.map((requirementId) =>
        index.approvalRequirements.get(requirementId),
      );
      if (requirements.some((requirement) => !requirement)) {
        throw runtimeError(
          'APPROVAL_REQUIRED',
          'Checkpoint policy evaluation requirement set is incomplete.',
          {
            evaluationId: evaluation.evaluationId,
          },
        );
      }
      assertOperatingApprovalRequirementSetIntegrityV2({
        requirements,
        evaluationId: evaluation.evaluationId,
      });
      const records = [...index.approvalRecords.values()]
        .filter((record) => record.evaluationId === evaluation.evaluationId)
        .sort((left, right) => left.approvalId.localeCompare(right.approvalId));
      let accepted = [];
      for (const record of records) {
        const requirement = index.approvalRequirements.get(record.requirementId);
        if (!requirement) {
          throw runtimeError(
            'APPROVAL_INVALID',
            'Checkpoint approval record references an unavailable requirement.',
            {
              approvalId: record.approvalId,
            },
          );
        }
        assertOperatingApprovalRecordV2(record, { requirement });
        accepted = appendOperatingApprovalRecordV2({
          records: accepted,
          record,
          requirement,
          requirements,
        }).records;
      }
    }
    for (const record of index.approvalRecords.values()) {
      if (!index.policyEvaluations.has(record.evaluationId)) {
        throw runtimeError(
          'APPROVAL_INVALID',
          'Checkpoint approval record references an unavailable evaluation.',
          {
            approvalId: record.approvalId,
          },
        );
      }
    }
    for (const availability of index.capabilityAvailability.values()) {
      assertCanonicalRecordHash(
        availability,
        'availabilityHash',
        'CAPABILITY_UNAVAILABLE',
        `Capability availability ${availability.availabilityId}`,
      );
    }
    for (const grant of index.capabilityGrants.values()) {
      assertCanonicalRecordHash(
        grant,
        'grantHash',
        'CAPABILITY_GRANT_INVALID',
        `Capability grant ${grant.grantId}`,
      );
      const assignment = index.assignments.get(grant.assignmentId);
      const operation = index.governedOperations.get(grant.operationId);
      if (
        !assignment ||
        assignment.capabilityGrantId !== grant.grantId ||
        assignment.governedOperationId !== grant.operationId ||
        (operation && operation.grantId !== grant.grantId)
      ) {
        throw runtimeError(
          'CAPABILITY_GRANT_INVALID',
          'Checkpoint grant binding is incomplete or inconsistent.',
          {
            grantId: grant.grantId,
            assignmentId: grant.assignmentId,
            operationId: grant.operationId,
          },
        );
      }
    }
    for (const operation of index.governedOperations.values()) {
      assertCanonicalRecordHash(
        operation,
        'operationHash',
        'OPERATION_CONFLICT',
        `Governed operation ${operation.operationId}`,
      );
      const replayEntry = index.operationReplayIndex.get(operation.operationId);
      if (operation.operationKind === 'rollback') {
        if (!skipRollbackAuthorityValidation) {
          assertOperatingRollbackAuthorityChainIndexV2(index, operation, replayEntry);
        }
        continue;
      }
      const assignment = index.assignments.get(operation.assignmentId);
      const grant = index.capabilityGrants.get(operation.grantId);
      const action = index.actions.get(operation.action.actionId);
      const evaluation = index.policyEvaluations.get(operation.evaluationId);
      const capabilityAvailabilityMatches = [...index.capabilityAvailability.values()].filter(
        (candidate) =>
          candidate.checkedAt === operation.createdAt &&
          sha256Jcs(candidate.capability) === sha256Jcs(operation.capability) &&
          sha256Jcs(candidate.target) === sha256Jcs(operation.target),
      );
      const capabilityAvailability =
        capabilityAvailabilityMatches.length === 1 ? capabilityAvailabilityMatches[0] : null;
      const intentEvent = index.eventReplay.get(operation.intentEventId);
      const reservedSubmission = replayEntry
        ? index.submissions.get(replayEntry.reservedSubmissionId)
        : null;
      const reservedUncertaintySubmission = replayEntry
        ? index.submissions.get(replayEntry.reservedUncertaintySubmissionId)
        : null;
      const competingOwner = findOperatingExactActionOperationOwnerV2(
        [...index.governedOperations.values()],
        operation.action,
        { excludeOperationId: operation.operationId },
      );
      const reservedEventIds = replayEntry
        ? [
            ...Object.values(replayEntry.reservedTerminalEventIds),
            ...Object.values(replayEntry.reservedUncertaintyTerminalEventIds),
          ]
        : [];
      const terminal = operation.resultId !== null;
      const terminalReservation = terminal
        ? reservedExecutionTerminalForStatus(replayEntry, operation.state)
        : null;
      const unusedReservation =
        terminal && ['succeeded', 'partial'].includes(operation.state)
          ? reservedExecutionTerminalForStatus(replayEntry, 'uncertain')
          : reservedExecutionTerminalForStatus(replayEntry, 'succeeded');
      const unusedSubmission = terminal
        ? index.submissions.get(unusedReservation.submissionId)
        : null;
      const historicalOperation =
        terminal && replayEntry
          ? {
              ...clone(operation),
              state: 'dispatching',
              resultId: null,
              updatedAt: operation.createdAt,
              operationHash: replayEntry.operationHash,
            }
          : operation;
      const authorityAction = actionAtExecutionAuthority(action);
      const requirements =
        evaluation?.approvalRequirementIds.map((requirementId) =>
          index.approvalRequirements.get(requirementId),
        ) ?? [];
      const approvals = evaluation
        ? [...index.approvalRecords.values()].filter(
            ({ evaluationId }) => evaluationId === evaluation.evaluationId,
          )
        : [];
      let disposition = null;
      try {
        if (
          evaluation &&
          authorityAction &&
          requirements.every(Boolean) &&
          approvals.every(Boolean)
        ) {
          disposition = evaluateOperatingApprovalSetV2({
            evaluation,
            action: authorityAction,
            requirements,
            approvals: approvals.map((approval) => {
              if (approval.consumedByOperationId === null) return approval;
              const restored = { ...clone(approval), consumedByOperationId: null };
              restored.recordHash = sha256Jcs(recordWithoutHash(restored, 'recordHash'));
              return restored;
            }),
            now: operation.createdAt,
          });
        }
      } catch {
        disposition = null;
      }
      if (replayEntry) {
        assertCanonicalRecordHash(
          historicalOperation,
          'operationHash',
          'OPERATION_CONFLICT',
          `Governed operation intent ${operation.operationId}`,
        );
      }
      if (
        !replayEntry ||
        !assignment ||
        !grant ||
        !action ||
        !evaluation ||
        !capabilityAvailability ||
        disposition?.complete !== true ||
        disposition.disposition !== 'approved' ||
        competingOwner ||
        replayEntry.operationKind !== 'execute' ||
        replayEntry.requestFingerprint !== operation.requestFingerprint ||
        replayEntry.actionId !== operation.action.actionId ||
        replayEntry.actionRevision !== operation.action.revision ||
        replayEntry.actionHash !== operation.action.actionHash ||
        replayEntry.intentEventId !== operation.intentEventId ||
        replayEntry.operationHash !== historicalOperation.operationHash ||
        replayEntry.terminalResultId !== operation.resultId ||
        replayEntry.payloadArtifactId === replayEntry.baselineArtifactId ||
        replayEntry.targetBeforeHash !==
          (replayEntry.baselineHash ?? replayEntry.targetBeforeHash) ||
        !intentEvent ||
        intentEvent.type !== 'operation.intent-recorded' ||
        intentEvent.entityId !== operation.operationId ||
        intentEvent.requestHash !== operation.requestFingerprint ||
        intentEvent.cycleId !== assignment.cycleId ||
        intentEvent.cycleId !== action.sourceCycleId ||
        intentEvent.timestamp !== operation.createdAt ||
        intentEvent.correlationId !== replayEntry.reservedCorrelationId ||
        !reservedSubmission ||
        !reservedUncertaintySubmission ||
        reservedSubmission.assignmentId !== operation.assignmentId ||
        reservedSubmission.submissionId !== replayEntry.reservedSubmissionId ||
        reservedSubmission.issuedAt !== operation.createdAt ||
        reservedUncertaintySubmission.assignmentId !== operation.assignmentId ||
        reservedUncertaintySubmission.submissionId !==
          replayEntry.reservedUncertaintySubmissionId ||
        reservedUncertaintySubmission.issuedAt !== operation.createdAt ||
        replayEntry.reservedResultId === replayEntry.reservedUncertaintyResultId ||
        replayEntry.reservedResultArtifactId === replayEntry.reservedUncertaintyResultArtifactId ||
        replayEntry.reservedSubmissionId === replayEntry.reservedUncertaintySubmissionId ||
        new Set(reservedEventIds).size !== reservedEventIds.length ||
        reservedEventIds.includes(operation.intentEventId) ||
        Date.parse(replayEntry.reservedCompletedAt) < Date.parse(operation.createdAt) ||
        terminal !== (replayEntry.terminalResultId !== null) ||
        (!terminal && replayEntry.terminalReceipt !== null) ||
        (!terminal && index.executionResults.has(replayEntry.reservedResultId)) ||
        (!terminal && index.executionResults.has(replayEntry.reservedUncertaintyResultId)) ||
        (!terminal && index.artifacts.has(replayEntry.reservedResultArtifactId)) ||
        (!terminal && index.artifacts.has(replayEntry.reservedUncertaintyResultArtifactId)) ||
        (!terminal &&
          (reservedSubmission.state !== 'issued' ||
            reservedUncertaintySubmission.state !== 'issued')) ||
        (!terminal && reservedEventIds.some((eventId) => index.eventReplay.has(eventId))) ||
        (terminal && operation.resultId !== terminalReservation.resultId) ||
        (terminal && (!unusedSubmission || unusedSubmission.state !== 'issued')) ||
        (terminal && index.executionResults.has(unusedReservation.resultId)) ||
        (terminal && index.artifacts.has(unusedReservation.resultArtifactId)) ||
        (terminal &&
          Object.values(unusedReservation.eventIds).some((eventId) =>
            index.eventReplay.has(eventId),
          )) ||
        grant.consumedAt !== operation.createdAt ||
        Date.parse(grant.issuedAt) > Date.parse(grant.consumedAt) ||
        Date.parse(grant.consumedAt) >= Date.parse(grant.expiresAt) ||
        assignment.governedOperationId !== operation.operationId ||
        assignment.capabilityGrantId !== grant.grantId ||
        grant.operationId !== operation.operationId ||
        operation.action.revision !== action.revision ||
        operation.action.actionHash !== action.actionHash
      ) {
        throw runtimeError(
          'OPERATION_CONFLICT',
          'Checkpoint operation replay binding is incomplete or inconsistent.',
          {
            operationId: operation.operationId,
          },
        );
      }
      assertOperatingExecuteOperationV2({
        operation: historicalOperation,
        action: authorityAction,
        assignment,
        evaluation,
        evaluations: [...index.policyEvaluations.values()],
        configuredPolicies: [...index.actionPolicies.values()],
        grant,
        requirements,
        approvals,
        capabilityAvailability,
        request: {
          payload: {
            artifactId: replayEntry.payloadArtifactId,
            contentHash: replayEntry.payloadHash,
          },
          rollbackBaseline:
            replayEntry.baselineArtifactId === null
              ? null
              : {
                  artifactId: replayEntry.baselineArtifactId,
                  contentHash: replayEntry.baselineHash,
                },
        },
        timestamp: historicalOperation.createdAt,
      });
      assertOperatingExecuteDispatchEventChainV2({
        index,
        operation: historicalOperation,
        assignment,
        grant,
        replayEntry,
      });
      if (!terminal) {
        assertOperatingDispatchExecutionProjectionsV2({
          operation: historicalOperation,
          assignment,
          action,
          grant,
          successSubmission: reservedSubmission,
          uncertaintySubmission: reservedUncertaintySubmission,
          replayEntry,
        });
      }
      assertReplayEventPayload(
        intentEvent,
        {
          operation: historicalOperation,
          request: {
            payload: {
              artifactId: replayEntry.payloadArtifactId,
              contentHash: replayEntry.payloadHash,
            },
            rollbackBaseline:
              replayEntry.baselineArtifactId === null
                ? null
                : {
                    artifactId: replayEntry.baselineArtifactId,
                    contentHash: replayEntry.baselineHash,
                  },
            targetBeforeHash: replayEntry.targetBeforeHash,
          },
          terminal: {
            resultId: replayEntry.reservedResultId,
            resultArtifactId: replayEntry.reservedResultArtifactId,
            submissionId: replayEntry.reservedSubmissionId,
            eventIds: clone(replayEntry.reservedTerminalEventIds),
            completedAt: replayEntry.reservedCompletedAt,
            correlationId: replayEntry.reservedCorrelationId,
            uncertainty: {
              resultId: replayEntry.reservedUncertaintyResultId,
              resultArtifactId: replayEntry.reservedUncertaintyResultArtifactId,
              submissionId: replayEntry.reservedUncertaintySubmissionId,
              eventIds: clone(replayEntry.reservedUncertaintyTerminalEventIds),
            },
          },
        },
        {
          type: 'operation.intent-recorded',
          entityId: operation.operationId,
          cycleId: assignment.cycleId,
          timestamp: operation.createdAt,
          correlationId: replayEntry.reservedCorrelationId,
          causationId: intentEvent.causationId,
          actor: { kind: 'engine', id: grant.issuer.id },
          requestHash: operation.requestFingerprint,
        },
      );
    }
    if (index.operationReplayIndex.size !== index.governedOperations.size) {
      throw runtimeError(
        'OPERATION_CONFLICT',
        'Every governed operation requires one exact durable replay entry.',
      );
    }
    for (const result of index.executionResults.values()) {
      assertCanonicalRecordHash(
        result,
        'resultHash',
        'RESULT_CONTRACT_INVALID',
        `Execution result ${result.resultId}`,
      );
      const operation = index.governedOperations.get(result.operationId);
      assertOperatingTerminalExecutionChainV2({ index, result, operation });
    }
    assertCheckpointTerminalVerificationAssignmentsV2(index);
  }
  return index;
}

export function assertOperatingRollbackAuthorityChainV2({ state, operationId } = {}) {
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
  const index = indexRuntimeState(state, { skipRollbackAuthorityValidation: true });
  const operation = index.governedOperations.get(operationId);
  if (!operation || operation.operationKind !== 'rollback') {
    throw runtimeError(
      'OPERATION_CONFLICT',
      'Rollback authority validation requires one exact durable rollback operation.',
      {
        operationId: operationId ?? null,
      },
    );
  }
  return Object.freeze(
    assertOperatingRollbackAuthorityChainIndexV2(
      index,
      operation,
      index.operationReplayIndex.get(operation.operationId),
    ),
  );
}

/**
 * Read-only proof that one durable execute operation owns the exact canonical
 * dispatch Event chain already enforced by the runtime-state validator.
 */
export function assertOperatingExecuteDispatchAuthorityChainV2({ state, operationId } = {}) {
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
  const index = indexRuntimeState(state);
  const operation = index.governedOperations.get(operationId);
  if (!operation || operation.operationKind !== 'execute') {
    throw runtimeError(
      'OPERATION_CONFLICT',
      'Execute dispatch authority validation requires one exact durable execute operation.',
      {
        operationId: operationId ?? null,
      },
    );
  }
  const assignment = index.assignments.get(operation.assignmentId);
  const grant = index.capabilityGrants.get(operation.grantId);
  const replayEntry = index.operationReplayIndex.get(operation.operationId);
  const availability = [...index.capabilityAvailability.values()].filter(
    (candidate) =>
      candidate.checkedAt === operation.createdAt &&
      sha256Jcs(candidate.capability) === sha256Jcs(operation.capability) &&
      sha256Jcs(candidate.target) === sha256Jcs(operation.target),
  );
  if (!assignment || !grant || !replayEntry || availability.length !== 1) {
    throw runtimeError(
      'OPERATION_CONFLICT',
      'Execute dispatch authority proof is missing one exact durable owner.',
      {
        operationId: operation.operationId,
      },
    );
  }
  const intentOperation =
    operation.resultId === null
      ? clone(operation)
      : {
          ...clone(operation),
          state: 'dispatching',
          resultId: null,
          updatedAt: operation.createdAt,
          operationHash: replayEntry.operationHash,
        };
  const intentGrant = { ...clone(grant), consumedAt: null };
  intentGrant.grantHash = sha256Jcs(recordWithoutHash(intentGrant, 'grantHash'));
  return Object.freeze({
    operation: clone(operation),
    assignment: clone(assignment),
    action: clone(actionAtExecutionAuthority(index.actions.get(operation.action.actionId))),
    grant: clone(grant),
    availability: clone(availability[0]),
    replayEntry: clone(replayEntry),
    intentOperation,
    intentAssignment: {
      ...clone(assignment),
      state: 'running',
      attemptPolicy: { ...clone(assignment.attemptPolicy), attempt: 1 },
      terminalOutcome: null,
      availableAt: operation.createdAt,
      completedAt: null,
    },
    intentGrant,
    intentReplayEntry: {
      ...clone(replayEntry),
      terminalResultId: null,
      terminalReceipt: null,
    },
  });
}

function requireValidatedWorkChangeSetArtifact(index, event) {
  const artifact = index.artifacts.get(event.payload.artifactId);
  if (!artifact) {
    throw runtimeError(
      'ARTIFACT_NOT_FOUND',
      'Persistent-work materialization references an unknown Artifact.',
      {
        artifactId: event.payload.artifactId,
      },
    );
  }
  const assignment = index.assignments.get(artifact.assignmentId);
  const submission = [...index.submissions.values()].find(
    (candidate) =>
      candidate.assignmentId === artifact.assignmentId &&
      candidate.artifactId === artifact.artifactId &&
      candidate.state === 'accepted',
  );
  const cycle = index.cycles.get(artifact.cycleId);
  if (
    event.entityId !== artifact.artifactId ||
    event.cycleId !== artifact.cycleId ||
    !cycle ||
    !assignment ||
    assignment.assignmentKind !== 'chair' ||
    assignment.state !== 'validated' ||
    !submission ||
    submission.canonicalHash !== artifact.canonicalHash
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Persistent work may be materialized only from a validated Chair Artifact in its source Cycle.',
      {
        artifactId: artifact.artifactId,
        assignmentId: artifact.assignmentId,
        cycleId: artifact.cycleId,
      },
    );
  }
  if (
    cycle.scopeId !== artifact.scopeId ||
    cycle.domainId !== artifact.domainId ||
    cycle.domainVersion !== artifact.domainVersion
  ) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'The source Artifact no longer matches its durable Cycle binding.',
      {
        artifactId: artifact.artifactId,
        cycleId: artifact.cycleId,
      },
    );
  }
  return artifact;
}

function sameEvidenceBinding(left, right) {
  return (
    left.scopeId === right.scopeId &&
    left.domainId === right.domainId &&
    left.domainVersion === right.domainVersion
  );
}

function acceptedEvidenceSource(index, sourceArtifactId, expected = {}) {
  const artifact = index.artifacts.get(sourceArtifactId);
  if (!artifact) {
    throw runtimeError(
      'ARTIFACT_NOT_FOUND',
      'Evidence materialization references an unknown source Artifact.',
      {
        artifactId: sourceArtifactId,
      },
    );
  }
  const submission = [...index.submissions.values()].find(
    (candidate) =>
      candidate.assignmentId === artifact.assignmentId &&
      candidate.artifactId === artifact.artifactId &&
      candidate.state === 'accepted',
  );
  const assignment = index.assignments.get(artifact.assignmentId);
  const cycle = index.cycles.get(artifact.cycleId);
  const inputBinding = cycle ? index.inputBindings.get(cycle.inputBindingId) : null;
  if (
    !submission ||
    !assignment ||
    assignment.state !== 'validated' ||
    !cycle ||
    !inputBinding ||
    submission.rawHash !== artifact.rawHash ||
    submission.canonicalHash !== artifact.canonicalHash ||
    !sameEvidenceBinding(artifact, cycle) ||
    !sameEvidenceBinding(artifact, inputBinding) ||
    (expected.cycleId !== undefined && artifact.cycleId !== expected.cycleId) ||
    (expected.scopeId !== undefined && artifact.scopeId !== expected.scopeId) ||
    (expected.domainId !== undefined && artifact.domainId !== expected.domainId) ||
    (expected.domainVersion !== undefined && artifact.domainVersion !== expected.domainVersion)
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Evidence materialization requires one accepted source Artifact with an intact Cycle input binding.',
      {
        artifactId: sourceArtifactId,
      },
    );
  }
  return { artifact, submission, cycle, inputBinding };
}

function requireAcceptedSnapshotSourceArtifact(index, artifactId, scope) {
  const artifact = index.artifacts.get(artifactId);
  if (!artifact) {
    throw runtimeError(
      'ARTIFACT_NOT_FOUND',
      'Operating snapshot provenance references an unknown Artifact.',
      {
        artifactId,
      },
    );
  }
  const assignment = index.assignments.get(artifact.assignmentId);
  const submission = [...index.submissions.values()].find(
    (candidate) =>
      candidate.assignmentId === artifact.assignmentId &&
      candidate.artifactId === artifact.artifactId &&
      candidate.state === 'accepted' &&
      candidate.rawHash === artifact.rawHash &&
      candidate.canonicalHash === artifact.canonicalHash,
  );
  if (
    !assignment ||
    assignment.state !== 'validated' ||
    !submission ||
    !sameEvidenceBinding(artifact, scope)
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Operating snapshot provenance requires one accepted Artifact with an intact immutable scope binding.',
      {
        artifactId,
      },
    );
  }
  return { artifact, assignment, submission };
}

function requireSnapshotEvidenceRef(index, evidenceRefId, snapshot) {
  const evidenceRef = index.evidenceRefs.get(evidenceRefId);
  if (
    !evidenceRef ||
    (Array.isArray(snapshot.evidenceRefIds) && !snapshot.evidenceRefIds.includes(evidenceRefId)) ||
    !sameEvidenceBinding(evidenceRef, snapshot)
  ) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Operating snapshot requires a declared, in-scope EvidenceRef.',
      {
        evidenceRefId,
        snapshotId: snapshot.snapshotId,
      },
    );
  }
  const evidenceArtifact = index.artifacts.get(evidenceRef.evidenceArtifactId);
  if (
    !evidenceArtifact ||
    evidenceArtifact.artifactType !== 'evidence-snapshot' ||
    evidenceArtifact.schemaId !== 'operating-evidence-snapshot' ||
    !evidenceArtifact.inputArtifactIds.includes(evidenceRef.sourceArtifactId) ||
    evidenceArtifact.rawHash !== evidenceRef.evidenceArtifactRawHash ||
    evidenceArtifact.canonicalHash !== evidenceRef.evidenceArtifactCanonicalHash ||
    !sameEvidenceBinding(evidenceArtifact, snapshot)
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'EvidenceRef snapshot provenance does not resolve to its immutable evidence Artifact.',
      {
        evidenceRefId,
        snapshotId: snapshot.snapshotId,
      },
    );
  }
  const source = requireAcceptedSnapshotSourceArtifact(
    index,
    evidenceRef.sourceArtifactId,
    snapshot,
  );
  if (
    evidenceArtifact.assignmentId !== source.artifact.assignmentId ||
    evidenceArtifact.cycleId !== source.artifact.cycleId
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'EvidenceRef must resolve to an Evidence Artifact derived from its accepted source Artifact.',
      {
        evidenceRefId,
        evidenceArtifactId: evidenceArtifact.artifactId,
      },
    );
  }
  return { evidenceRef, evidenceArtifact };
}

function assertOperatingModelStateProvenance(index, state, { snapshot } = {}) {
  const scope = state;
  const snapshotSourceArtifactIds =
    snapshot === undefined ? null : new Set(snapshot.sourceArtifactIds);
  const snapshotEvidenceRefIds = snapshot === undefined ? null : new Set(snapshot.evidenceRefIds);
  const evidenceRefs = new Map();
  for (const evidenceRef of index.evidenceRefs.values()) {
    if (sameEvidenceBinding(evidenceRef, scope))
      evidenceRefs.set(evidenceRef.evidenceRefId, evidenceRef);
  }
  const collections = [
    ['objectives', 'objectiveId'],
    ['metrics', 'metricId'],
    ['findings', 'findingId'],
    ['decisions', 'decisionId'],
    ['actions', 'actionId'],
    ['risks', 'riskId'],
    ['assumptions', 'assumptionId'],
  ];
  const identifiers = Object.fromEntries(
    collections.map(([field, id]) => [field, new Set(state[field].map((record) => record[id]))]),
  );
  for (const [field, id] of collections) {
    for (const record of state[field]) {
      if (!sameEvidenceBinding(record, scope)) {
        throw runtimeError(
          'OPERATING_SCOPE_INVALID',
          'Operating-model state includes a foreign domain-neutral record.',
          {
            stateId: state.stateId,
            entityId: record[id],
          },
        );
      }
      const { artifact: sourceArtifact } = requireAcceptedSnapshotSourceArtifact(
        index,
        record.sourceArtifactId,
        scope,
      );
      if (
        ['findings', 'decisions', 'actions'].includes(field) &&
        record.sourceCycleId !== sourceArtifact.cycleId
      ) {
        throw runtimeError(
          'OPERATING_SCOPE_INVALID',
          'Finding, Decision, and Action provenance must retain the accepted source Artifact cycle identity.',
          {
            stateId: state.stateId,
            entityId: record[id],
            sourceArtifactId: sourceArtifact.artifactId,
            sourceCycleId: record.sourceCycleId,
          },
        );
      }
      if (
        snapshotSourceArtifactIds !== null &&
        !snapshotSourceArtifactIds.has(record.sourceArtifactId)
      ) {
        throw runtimeError(
          'STATE_TRANSITION_INVALID',
          'Operating-model state provenance must be declared by its immutable snapshot.',
          {
            stateId: state.stateId,
            snapshotId: snapshot.snapshotId,
            entityId: record[id],
            sourceArtifactId: record.sourceArtifactId,
          },
        );
      }
      const recordEvidenceIds = record.evidenceRefIds ?? [];
      for (const evidenceRefId of recordEvidenceIds) {
        if (!evidenceRefs.has(evidenceRefId)) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Operating-model state record references unavailable typed evidence.',
            {
              stateId: state.stateId,
              entityId: record[id],
              evidenceRefId,
            },
          );
        }
        if (snapshotEvidenceRefIds !== null && !snapshotEvidenceRefIds.has(evidenceRefId)) {
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'Operating-model state evidence must be declared by its immutable snapshot.',
            {
              stateId: state.stateId,
              snapshotId: snapshot.snapshotId,
              entityId: record[id],
              evidenceRefId,
            },
          );
        }
      }
    }
  }
  for (const decision of state.decisions) {
    if (decision.assumptionIds.some((id) => !identifiers.assumptions.has(id))) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Decision assumptions must resolve within the immutable operating-model state.',
        {
          stateId: state.stateId,
          decisionId: decision.decisionId,
        },
      );
    }
  }
  for (const objective of state.objectives) {
    if (objective.metricIds.some((id) => !identifiers.metrics.has(id))) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Objective metrics must resolve within the immutable operating-model state.',
        {
          stateId: state.stateId,
          objectiveId: objective.objectiveId,
        },
      );
    }
  }
  for (const assumption of state.assumptions) {
    if (
      assumption.affectedDecisionIds.some((id) => !identifiers.decisions.has(id)) ||
      assumption.affectedActionIds.some((id) => !identifiers.actions.has(id))
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Assumption affected-work references must resolve within the immutable operating-model state.',
        {
          stateId: state.stateId,
          assumptionId: assumption.assumptionId,
        },
      );
    }
  }
  for (const action of state.actions) {
    if (
      !identifiers.objectives.has(action.objectiveId) ||
      !identifiers.metrics.has(action.metricId) ||
      (action.sourceDecisionId !== null && !identifiers.decisions.has(action.sourceDecisionId)) ||
      action.sourceFindingIds.some((id) => !identifiers.findings.has(id)) ||
      action.dependsOnActionIds.some((id) => id === action.actionId || !identifiers.actions.has(id))
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Action references must resolve within the immutable operating-model state.',
        {
          stateId: state.stateId,
          actionId: action.actionId,
        },
      );
    }
  }
}

function assertOperatingSnapshotProvenance(index, snapshot, { artifactStore } = {}) {
  for (const artifactId of snapshot.sourceArtifactIds) {
    const { artifact } = requireAcceptedSnapshotSourceArtifact(index, artifactId, snapshot);
    if (artifactStore !== undefined) {
      const bytes = readOperatingArtifactRawBytesV2(artifactStore, {
        artifactId: artifact.artifactId,
        rawHash: artifact.rawHash,
      });
      artifactStore.stageRaw({ artifact, rawBytes: bytes });
    }
  }
  for (const evidenceRefId of snapshot.evidenceRefIds) {
    const { evidenceArtifact } = requireSnapshotEvidenceRef(index, evidenceRefId, snapshot);
    if (artifactStore !== undefined) {
      const bytes = readOperatingArtifactRawBytesV2(artifactStore, {
        artifactId: evidenceArtifact.artifactId,
        rawHash: evidenceArtifact.rawHash,
      });
      artifactStore.stageRaw({ artifact: evidenceArtifact, rawBytes: bytes });
    }
  }
  for (const revision of snapshot.sourceRevisions) {
    const source = requireAcceptedSnapshotSourceArtifact(
      index,
      revision.sourceArtifactId,
      snapshot,
    );
    for (const evidenceRefId of revision.evidenceRefIds ?? []) {
      const { evidenceRef } = requireSnapshotEvidenceRef(index, evidenceRefId, snapshot);
      if (evidenceRef.sourceArtifactId !== source.artifact.artifactId) {
        throw runtimeError(
          'STATE_TRANSITION_INVALID',
          'Snapshot source revisions may bind only EvidenceRefs from their named source Artifact.',
          {
            snapshotId: snapshot.snapshotId,
            sourceArtifactId: source.artifact.artifactId,
            evidenceRefId,
          },
        );
      }
    }
  }
}

function stageOperatingModelStateProvenanceBytes(index, state, artifactStore) {
  if (
    !artifactStore ||
    typeof artifactStore.readRaw !== 'function' ||
    typeof artifactStore.stageRaw !== 'function'
  ) {
    throw runtimeError(
      'ARTIFACT_NOT_FOUND',
      'Operating state/snapshot materialization requires the runtime Artifact byte store.',
    );
  }
  const sourceArtifactIds = new Set();
  const evidenceRefIds = new Set();
  for (const field of [
    'objectives',
    'metrics',
    'findings',
    'decisions',
    'actions',
    'risks',
    'assumptions',
  ]) {
    for (const record of state[field]) {
      sourceArtifactIds.add(record.sourceArtifactId);
      for (const evidenceRefId of record.evidenceRefIds ?? []) evidenceRefIds.add(evidenceRefId);
    }
  }
  for (const artifactId of sourceArtifactIds) {
    const { artifact } = requireAcceptedSnapshotSourceArtifact(index, artifactId, state);
    const bytes = readOperatingArtifactRawBytesV2(artifactStore, {
      artifactId: artifact.artifactId,
      rawHash: artifact.rawHash,
    });
    artifactStore.stageRaw({ artifact, rawBytes: bytes });
  }
  for (const evidenceRefId of evidenceRefIds) {
    const { evidenceArtifact } = requireSnapshotEvidenceRef(index, evidenceRefId, state);
    const bytes = readOperatingArtifactRawBytesV2(artifactStore, {
      artifactId: evidenceArtifact.artifactId,
      rawHash: evidenceArtifact.rawHash,
    });
    artifactStore.stageRaw({ artifact: evidenceArtifact, rawBytes: bytes });
  }
}

function assertOperatingSnapshotCheckpoint(index) {
  for (const snapshot of index.operatingSnapshots.values()) {
    const state = index.operatingModelStates.get(snapshot.stateId);
    try {
      assertOperatingSnapshotV2(snapshot, { state });
      assertOperatingModelStateProvenance(index, state, { snapshot });
      assertOperatingSnapshotProvenance(index, snapshot);
    } catch (error) {
      throw runtimeError(
        error.code ?? 'STATE_TRANSITION_INVALID',
        error.message,
        error.details?.context ?? {
          snapshotId: snapshot.snapshotId,
        },
      );
    }
  }
}

function requireIntelligenceSnapshot(index, event, snapshotId, stateId) {
  const snapshot = index.operatingSnapshots.get(snapshotId);
  const operatingState = snapshot ? index.operatingModelStates.get(snapshot.stateId) : null;
  const cycle = index.cycles.get(event.cycleId);
  if (
    !snapshot ||
    !operatingState ||
    snapshot.stateId !== stateId ||
    operatingState.stateId !== stateId ||
    !cycle ||
    !sameEvidenceBinding(snapshot, cycle) ||
    !sameEvidenceBinding(operatingState, snapshot)
  ) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Operating intelligence Event requires one durable snapshot/state and matching Cycle scope.',
      {
        snapshotId,
        stateId,
        cycleId: event.cycleId,
      },
    );
  }
  return { snapshot, operatingState, cycle };
}

function requireRuntimeIntelligenceActor(event) {
  if (event.actor.kind !== 'runtime' || event.actor.id !== 'openplanr') {
    throw runtimeError(
      'CAPABILITY_DENIED',
      'Only the deterministic runtime may materialize operating intelligence facts.',
      {
        actorKind: event.actor.kind,
        actorId: event.actor.id,
      },
    );
  }
}

function operatingActionAuthorityPromotionRequestHash(before, authority) {
  return sha256Jcs({
    contract: 'operating-action-authority-promotion-v2',
    before,
    authority,
  });
}

function intelligenceEventRecord(index, event) {
  const payload = event.payload;
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    typeof payload.snapshotId !== 'string' ||
    typeof payload.stateId !== 'string' ||
    !payload.record ||
    typeof payload.record !== 'object' ||
    Array.isArray(payload.record)
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Operating intelligence Event requires an explicit snapshot/state binding and typed record.',
      {
        eventId: event.eventId,
      },
    );
  }
  const binding = requireIntelligenceSnapshot(index, event, payload.snapshotId, payload.stateId);
  return { ...binding, record: payload.record };
}

const INTELLIGENCE_PRODUCER_SCHEMA_IDS = Object.freeze(
  new Set(['operating-advisor-result', 'operating-challenger-review', 'operating-decision-ledger']),
);

function acceptedIntelligenceProducerArtifact(index, snapshot, sourceArtifactId) {
  const artifact = index.artifacts.get(sourceArtifactId);
  const assignment = artifact ? index.assignments.get(artifact.assignmentId) : null;
  const submission = artifact
    ? [...index.submissions.values()].find(
        (candidate) =>
          candidate.assignmentId === artifact.assignmentId &&
          candidate.artifactId === artifact.artifactId &&
          candidate.state === 'accepted' &&
          candidate.rawHash === artifact.rawHash &&
          candidate.canonicalHash === artifact.canonicalHash,
      )
    : null;
  if (
    !artifact ||
    !assignment ||
    assignment.state !== 'validated' ||
    !submission ||
    !INTELLIGENCE_PRODUCER_SCHEMA_IDS.has(artifact.schemaId) ||
    !sameEvidenceBinding(artifact, snapshot) ||
    sha256Jcs(artifact.inputArtifactIds) !== sha256Jcs(assignment.inputArtifactIds)
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Durable intelligence provenance requires one exact accepted producer Artifact.',
      {
        sourceArtifactId,
        snapshotId: snapshot.snapshotId,
      },
    );
  }
  return { artifact, assignment, submission };
}

function intelligenceProducerArtifacts(index, snapshot) {
  return [...index.artifacts.values()].filter(
    (artifact) =>
      INTELLIGENCE_PRODUCER_SCHEMA_IDS.has(artifact.schemaId) &&
      sameEvidenceBinding(artifact, snapshot),
  );
}

function assertIntelligenceEvidenceRefs(
  index,
  snapshot,
  evidenceRefIds,
  sourceArtifactId,
  { allowProducedSource = false } = {},
) {
  if (!Array.isArray(evidenceRefIds)) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Operating intelligence records require typed EvidenceRef identities.',
      {
        snapshotId: snapshot.snapshotId,
      },
    );
  }
  const producer =
    sourceArtifactId !== undefined &&
    allowProducedSource &&
    !snapshot.sourceArtifactIds.includes(sourceArtifactId)
      ? acceptedIntelligenceProducerArtifact(index, snapshot, sourceArtifactId)
      : null;
  for (const evidenceRefId of new Set(evidenceRefIds)) {
    const { evidenceRef, evidenceArtifact } = requireSnapshotEvidenceRef(
      index,
      evidenceRefId,
      snapshot,
    );
    const authorized =
      sourceArtifactId === undefined
        ? true
        : producer === null
          ? evidenceRef.sourceArtifactId === sourceArtifactId
          : producer.artifact.inputArtifactIds.includes(evidenceArtifact.artifactId) &&
            producer.assignment.inputArtifactIds.includes(evidenceArtifact.artifactId);
    if (evidenceRef.freshness === 'stale' || !authorized) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Operating intelligence evidence must retain exact selected and issued Artifact custody.',
        {
          snapshotId: snapshot.snapshotId,
          sourceArtifactId,
          evidenceRefId,
          evidenceArtifactId: evidenceArtifact.artifactId,
        },
      );
    }
  }
}

function assertIntelligenceSourceArtifact(
  index,
  event,
  record,
  snapshot,
  { allowProducedSource = false } = {},
) {
  const source = snapshot.sourceArtifactIds.includes(record.sourceArtifactId)
    ? requireAcceptedSnapshotSourceArtifact(index, record.sourceArtifactId, snapshot)
    : allowProducedSource
      ? acceptedIntelligenceProducerArtifact(index, snapshot, record.sourceArtifactId)
      : null;
  if (!source || event.causationId !== (source.submission.acceptanceEventIds.at(-1) ?? null)) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Operating intelligence Event must retain exact accepted source-Artifact causation.',
      {
        entityId: event.entityId,
        sourceArtifactId: record.sourceArtifactId,
      },
    );
  }
  return source;
}

function assertIntelligenceTimestamp(event, record, field) {
  if (record[field] !== event.timestamp) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Operating intelligence record timestamp must be runtime Event-owned.',
      {
        entityId: event.entityId,
        field,
      },
    );
  }
}

function assertFreshIntelligenceIdentity(index, map, id, event, expectedId) {
  if (event.entityId !== expectedId || map.has(id)) {
    throw runtimeError(
      'CONCURRENT_MODIFICATION',
      'Operating intelligence identity already exists or does not match its Event.',
      {
        entityId: event.entityId,
        expectedId,
      },
    );
  }
}

function acceptedSubmissionForArtifact(index, artifact) {
  const submission = [...index.submissions.values()].find(
    (candidate) =>
      candidate.assignmentId === artifact.assignmentId &&
      candidate.artifactId === artifact.artifactId &&
      candidate.state === 'accepted',
  );
  if (!submission) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'A decision-ledger role Artifact must retain its exact accepted Submission.',
      {
        artifactId: artifact.artifactId,
      },
    );
  }
  return submission;
}

function acceptedChairArtifactForLedger(index, ledger) {
  const plan = index.intelligencePlans.get(ledger?.intelligencePlanId);
  const chairs = plan?.selectedRoles.filter(({ roleKind }) => roleKind === 'chair') ?? [];
  if (chairs.length !== 1) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Decision ledger requires one exact Chair role in its immutable plan.',
      {
        ledgerId: ledger?.ledgerId ?? null,
      },
    );
  }
  const [chair] = chairs;
  const assignmentId = deriveOperatingIntelligenceAssignmentIdV2(
    plan.planId,
    chair.roleId,
    chair.roleVersion,
  );
  const assignment = index.assignments.get(assignmentId);
  const accepted = [...index.submissions.values()].filter(
    (candidate) =>
      candidate.assignmentId === assignmentId &&
      candidate.state === 'accepted' &&
      typeof candidate.artifactId === 'string',
  );
  if (assignment?.state !== 'validated' || accepted.length !== 1) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Decision ledger requires one exact validated Chair Submission.',
      {
        ledgerId: ledger?.ledgerId ?? null,
        assignmentId,
      },
    );
  }
  const artifact = index.artifacts.get(accepted[0].artifactId);
  if (
    !artifact ||
    artifact.assignmentId !== assignmentId ||
    artifact.schemaId !== 'operating-decision-ledger' ||
    artifact.artifactSchemaVersion !== PROTOCOL_VERSION ||
    !assignment.intelligenceContext?.sourceArtifactIds.includes(ledger.sourceArtifactId)
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Decision ledger lost its exact accepted Chair Artifact or issued source custody.',
      {
        ledgerId: ledger?.ledgerId ?? null,
        assignmentId,
        artifactId: accepted[0].artifactId,
      },
    );
  }
  return artifact;
}

function decodedLedgerRoleOutput(index, artifactId, artifactStore, subject) {
  const artifact = index.artifacts.get(artifactId);
  if (!artifact)
    throw runtimeError(
      'ARTIFACT_NOT_FOUND',
      'Decision-ledger materialization references an unknown role Artifact.',
      {
        artifactId,
      },
    );
  try {
    return {
      artifactId,
      output: decodeOperatingIntelligenceArtifactBodyV2({
        artifact,
        rawBytes: readOperatingArtifactRawBytesV2(artifactStore, {
          artifactId: artifact.artifactId,
          rawHash: artifact.rawHash,
        }),
        subject,
      }),
    };
  } catch (error) {
    throw runtimeError(
      error.code ?? 'RESULT_CONTRACT_INVALID',
      error.message,
      error.details?.context ?? {
        artifactId,
      },
    );
  }
}

function buildRuntimeDecisionLedgerMaterialization(index, ledger, timestamp, artifactStore) {
  if (!artifactStore) {
    throw runtimeError(
      'ARTIFACT_NOT_FOUND',
      'Decision-ledger replay requires the exact immutable Artifact byte store.',
      {
        ledgerId: ledger?.ledgerId ?? null,
      },
    );
  }
  const plan = index.intelligencePlans.get(ledger.intelligencePlanId);
  const snapshot = index.operatingSnapshots.get(ledger.snapshotId);
  const operatingState = snapshot ? index.operatingModelStates.get(snapshot.stateId) : null;
  const chairArtifact = plan ? acceptedChairArtifactForLedger(index, ledger) : null;
  if (!plan || !snapshot || !operatingState || !chairArtifact) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Decision ledger requires durable plan, snapshot/state, and Chair Artifact identities.',
      {
        ledgerId: ledger.ledgerId,
      },
    );
  }
  const chairOutput = decodedLedgerRoleOutput(
    index,
    chairArtifact.artifactId,
    artifactStore,
    'Chair result',
  );
  const planAssignments = plan.selectedRoles.map(({ roleId, roleVersion }) =>
    index.assignments.get(
      deriveOperatingIntelligenceAssignmentIdV2(plan.planId, roleId, roleVersion),
    ),
  );
  const inputBundles = planAssignments.map((assignment) => {
    const bundleArtifactId = assignment?.intelligenceContext?.inputBundle?.bundleArtifactId;
    if (!bundleArtifactId) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Intelligence Assignment lost its role-scoped input bundle custody.',
        {
          assignmentId: assignment?.assignmentId ?? null,
        },
      );
    }
    return {
      assignmentId: assignment.assignmentId,
      bundle: decodedLedgerRoleOutput(
        index,
        bundleArtifactId,
        artifactStore,
        'Intelligence input bundle',
      ).output,
    };
  });
  const advisorResults = ledger.advisorArtifactIds.map((artifactId) =>
    decodedLedgerRoleOutput(index, artifactId, artifactStore, 'Advisor result'),
  );
  const challengerReview =
    ledger.challengerArtifactId === null
      ? null
      : decodedLedgerRoleOutput(
          index,
          ledger.challengerArtifactId,
          artifactStore,
          'Challenger review',
        );
  let materialization;
  try {
    materialization = buildOperatingDecisionLedgerMaterializationV2({
      snapshot,
      operatingState,
      inputBundles,
      plan,
      assignments: [...index.assignments.values()],
      artifacts: [...index.artifacts.values()],
      submissions: [...index.submissions.values()],
      submissionReplayIndex: [...index.replay.values()],
      evidenceRefs: [...index.evidenceRefs.values()],
      advisorResults,
      challengerReview,
      chairArtifact,
      ledger,
      existingClaims: [...index.claims.values()],
      existingRisks: [...index.risks.values()],
      existingFindings: [...index.findings.values()],
      existingDecisions: [...index.decisions.values()],
      timestamp,
    });
  } catch (error) {
    throw runtimeError(
      error.code ?? 'RESULT_CONTRACT_INVALID',
      error.message,
      error.details?.context ?? {
        ledgerId: ledger.ledgerId,
      },
    );
  }
  if (sha256Jcs(chairOutput.output) !== sha256Jcs(materialization.ledger)) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Decision-ledger Event payload does not equal the exact accepted Chair Artifact output.',
      {
        ledgerId: ledger.ledgerId,
        artifactId: chairArtifact.artifactId,
      },
    );
  }
  return materialization;
}

function recordedDecisionLedgerMaterializationTimestamp(index, ledger) {
  const replays = [...index.eventReplay.values()].filter(
    (entry) =>
      entry.type === 'decision-ledger.materialized' &&
      entry.entityId === ledger.ledgerId &&
      entry.payloadHash === sha256Jcs(ledger),
  );
  if (replays.length !== 1) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Decision-ledger replay requires one exact materialization Event owner.',
      {
        ledgerId: ledger.ledgerId,
        replayCount: replays.length,
      },
    );
  }
  return replays[0].timestamp;
}

/**
 * Reconstruct the exact ungoverned Action that one recorded verification-plan
 * Event materialized. This is read-only projection support: it proves the
 * Event/ledger/snapshot/state/Decision chain and never trusts a later authority
 * promotion payload as the Action source.
 */
export function reconstructOperatingVerificationPlanActionV2({ state, event } = {}) {
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
  try {
    assertProtocolArtifact('operating-event', event, { protocolVersion: PROTOCOL_VERSION });
  } catch (error) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Verification-plan Action reconstruction requires one typed Event.',
      {
        cause: error.code ?? null,
      },
    );
  }
  if (
    event.type !== 'verification.plan-recorded' ||
    event.actor.kind !== 'runtime' ||
    event.actor.id !== 'openplanr'
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Verification-plan Action reconstruction accepts only a runtime-recorded verification plan.',
      {
        eventId: event?.eventId ?? null,
        type: event?.type ?? null,
      },
    );
  }
  const index = indexRuntimeState(state);
  const verificationPlan = event.payload;
  const replay = index.eventReplay.get(event.eventId);
  const planReplays = [...index.eventReplay.values()].filter(
    (candidate) =>
      candidate.type === 'verification.plan-recorded' &&
      candidate.entityId === verificationPlan.verificationPlanId,
  );
  if (
    !replay ||
    planReplays.length !== 1 ||
    replay.type !== event.type ||
    replay.entityId !== event.entityId ||
    replay.eventHash !== event.eventHash ||
    replay.payloadHash !== sha256Jcs(verificationPlan) ||
    event.entityId !== verificationPlan.verificationPlanId ||
    event.timestamp !== verificationPlan.createdAt
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Verification-plan Action reconstruction requires one exact Event replay owner.',
      {
        eventId: event.eventId,
        verificationPlanId: verificationPlan?.verificationPlanId ?? null,
      },
    );
  }
  try {
    assertProtocolArtifact('operating-action-verification-plan', verificationPlan, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch (error) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Verification-plan Action reconstruction requires one typed plan.',
      {
        cause: error.code ?? null,
      },
    );
  }
  const ledgers = [...index.decisionLedgers.values()].filter(
    (ledger) =>
      acceptedChairArtifactForLedger(index, ledger).artifactId ===
        verificationPlan.sourceArtifactId && sameEvidenceBinding(ledger, verificationPlan),
  );
  if (ledgers.length !== 1) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Verification-plan Action reconstruction requires one exact Chair ledger.',
      {
        verificationPlanId: verificationPlan.verificationPlanId,
        ledgerCount: ledgers.length,
      },
    );
  }
  const ledger = ledgers[0];
  const ledgerReplay = [...index.eventReplay.values()].filter(
    (candidate) =>
      candidate.type === 'decision-ledger.materialized' &&
      candidate.entityId === ledger.ledgerId &&
      candidate.payloadHash === sha256Jcs(ledger),
  );
  const snapshot = index.operatingSnapshots.get(ledger.snapshotId);
  const operatingState = snapshot ? index.operatingModelStates.get(snapshot.stateId) : null;
  const chairArtifact = acceptedChairArtifactForLedger(index, ledger);
  const chairSubmission = acceptedSubmissionForArtifact(index, chairArtifact);
  const snapshotReplay = snapshot
    ? [...index.eventReplay.values()].filter(
        (candidate) =>
          candidate.type === 'snapshot.materialized' &&
          candidate.entityId === snapshot.snapshotId &&
          candidate.payloadHash === sha256Jcs(snapshot),
      )
    : [];
  const stateReplay = operatingState
    ? [...index.eventReplay.values()].filter(
        (candidate) =>
          candidate.type === 'operating-state.materialized' &&
          candidate.entityId === operatingState.stateId &&
          candidate.payloadHash === sha256Jcs(operatingState),
      )
    : [];
  if (
    ledgerReplay.length !== 1 ||
    ledgerReplay[0].sequence >= replay.sequence ||
    snapshotReplay.length !== 1 ||
    stateReplay.length !== 1 ||
    snapshotReplay[0].sequence >= stateReplay[0].sequence ||
    stateReplay[0].sequence >= ledgerReplay[0].sequence ||
    !snapshot ||
    !operatingState ||
    !chairArtifact ||
    !chairSubmission ||
    event.cycleId !== chairArtifact.cycleId ||
    event.causationId !== (chairSubmission.acceptanceEventIds.at(-1) ?? null) ||
    !sameEvidenceBinding(ledger, snapshot) ||
    !sameEvidenceBinding(verificationPlan, snapshot)
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Verification-plan Action reconstruction lost its exact ledger, snapshot/state, or Chair causation.',
      {
        verificationPlanId: verificationPlan.verificationPlanId,
        ledgerId: ledger.ledgerId,
      },
    );
  }
  const decisions = ledger.decisions.map((ledgerDecision) => {
    const matches = [...index.decisions.values()].filter(
      (decision) =>
        decision.sourceArtifactId === chairArtifact.artifactId &&
        decision.sourceCycleId === event.cycleId &&
        decision.title === ledgerDecision.title &&
        decision.question === ledgerDecision.question &&
        sameEvidenceBinding(decision, snapshot),
    );
    if (matches.length !== 1) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Verification-plan Action reconstruction requires each exact ledger Decision revision.',
        {
          ledgerId: ledger.ledgerId,
          decisionTitle: ledgerDecision.title,
          decisionCount: matches.length,
        },
      );
    }
    const decisionReplay = [...index.eventReplay.values()].filter(
      (candidate) =>
        candidate.type === 'decision.revised' &&
        candidate.entityId === matches[0].decisionId &&
        candidate.sequence > ledgerReplay[0].sequence &&
        candidate.sequence < replay.sequence,
    );
    if (decisionReplay.length !== 1) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Verification-plan Action reconstruction requires ordered Event-backed Decision provenance.',
        {
          decisionId: matches[0].decisionId,
        },
      );
    }
    return matches[0];
  });
  const findings = decisions.flatMap((decision) =>
    decision.findingIds.map((findingId) => index.findings.get(findingId)),
  );
  let materialization;
  try {
    materialization = buildOperatingActionVerificationMaterializationV2({
      snapshot,
      operatingState,
      ledger,
      decisions,
      findings,
      timestamp: event.timestamp,
    });
  } catch (error) {
    throw runtimeError(
      error.code ?? 'RESULT_CONTRACT_INVALID',
      error.message,
      error.details?.context ?? {
        verificationPlanId: verificationPlan.verificationPlanId,
      },
    );
  }
  const expectedPlan = materialization.verificationPlans.find(
    (candidate) => candidate.verificationPlanId === verificationPlan.verificationPlanId,
  );
  const expectedAction = materialization.actions.find(
    (candidate) => candidate.actionId === verificationPlan.actionId,
  );
  const metrics = expectedAction
    ? operatingState.metrics.filter((candidate) => candidate.metricId === expectedAction.metricId)
    : [];
  if (
    !expectedPlan ||
    !expectedAction ||
    metrics.length !== 1 ||
    !sameEvidenceBinding(metrics[0], expectedAction) ||
    expectedPlan.metricId !== metrics[0].metricId ||
    expectedPlan.baseline !== expectedAction.baseline ||
    expectedPlan.target !== expectedAction.target ||
    expectedPlan.window !== expectedAction.verificationWindow ||
    sha256Jcs(expectedPlan) !== sha256Jcs(verificationPlan)
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Verification-plan Event does not equal the canonical ledger-derived Action/plan materialization.',
      {
        verificationPlanId: verificationPlan.verificationPlanId,
        actionId: verificationPlan.actionId,
      },
    );
  }
  return Object.freeze({
    action: clone(expectedAction),
    verificationPlan: clone(expectedPlan),
    metric: clone(metrics[0]),
    ledgerId: ledger.ledgerId,
    snapshotId: snapshot.snapshotId,
    stateId: operatingState.stateId,
    decisionIds: Object.freeze(decisions.map(({ decisionId }) => decisionId)),
  });
}

function planningDeliveryIdentity(prefix, value) {
  return `${prefix}_${sha256Jcs(value).slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

function buildPlanningDeliveryIngestionV2(
  state,
  { origin, deliveryEvidence, verificationPlanEvent, timestamp } = {},
) {
  assertOperateExperienceArtifactV2('operating-origin', origin);
  assertOperateExperienceArtifactV2('operating-delivery-evidence', deliveryEvidence);
  const reconstructed = reconstructOperatingVerificationPlanActionV2({
    state,
    event: verificationPlanEvent,
  });
  const currentAction = state.actions.filter(({ actionId }) => actionId === origin.action.id);
  const currentDecision = state.decisions.filter(
    ({ decisionId }) => decisionId === origin.decision.id,
  );
  if (
    currentAction.length !== 1 ||
    currentDecision.length !== 1 ||
    currentAction[0].revision !== origin.action.revision ||
    currentAction[0].actionHash !== origin.action.hash ||
    currentDecision[0].revision !== origin.decision.revision ||
    sha256Jcs(currentDecision[0]) !== origin.decision.hash ||
    currentAction[0].sourceDecisionId !== currentDecision[0].decisionId ||
    reconstructed.action.actionId !== currentAction[0].actionId ||
    reconstructed.verificationPlan.verificationPlanId !== origin.verification.verificationPlanId ||
    sha256Jcs(reconstructed.verificationPlan) !== origin.verification.verificationPlanHash ||
    reconstructed.metric.metricId !== origin.metric.metricId ||
    sha256Jcs(reconstructed.metric) !== origin.metric.metricHash ||
    reconstructed.verificationPlan.window !== origin.verification.window ||
    deliveryEvidence.deliveryEvidenceHash !==
      sha256Jcs(
        Object.fromEntries(
          Object.entries(deliveryEvidence).filter(([key]) => key !== 'deliveryEvidenceHash'),
        ),
      ) ||
    deliveryEvidence.correlationId !== origin.correlationId ||
    deliveryEvidence.proposalId !== origin.proposalId ||
    deliveryEvidence.proposalRevision !== origin.proposalRevision ||
    sha256Jcs(deliveryEvidence.decision) !== sha256Jcs(origin.decision) ||
    sha256Jcs(deliveryEvidence.action) !== sha256Jcs(origin.action) ||
    sha256Jcs(deliveryEvidence.metric) !== sha256Jcs(origin.metric) ||
    sha256Jcs(deliveryEvidence.verification) !== sha256Jcs(origin.verification) ||
    deliveryEvidence.spec.specId !== origin.spec.specId ||
    deliveryEvidence.spec.contentHash !== origin.spec.contentHash ||
    deliveryEvidence.spec.originHash !== origin.originHash ||
    deliveryEvidence.outcomeStatus !== 'verification-required' ||
    timestamp !== deliveryEvidence.createdAt
  ) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Planning delivery evidence must retain the exact current origin, Decision, Action, metric, plan, SPEC, and verification bindings.',
    );
  }
  const seed = {
    contract: 'operate-v2-planning-delivery-ingestion',
    deliveryEvidenceId: deliveryEvidence.deliveryEvidenceId,
    deliveryEvidenceHash: deliveryEvidence.deliveryEvidenceHash,
    actionId: currentAction[0].actionId,
    verificationPlanId: reconstructed.verificationPlan.verificationPlanId,
  };
  const assignmentId = planningDeliveryIdentity('asg', seed);
  const artifactId = planningDeliveryIdentity('art', seed);
  const evidenceRefId = planningDeliveryIdentity('evr', seed);
  const candidateId = planningDeliveryIdentity('evc', seed);
  const bytes = Buffer.from(canonicalizeJson(deliveryEvidence), 'utf8');
  const rawHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const artifactBodyHash = sha256Jcs(deliveryEvidence);
  const artifact = {
    kind: 'operating-artifact',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    artifactId,
    artifactType: 'planning-delivery-evidence',
    assignmentId,
    cycleId: currentAction[0].sourceCycleId,
    scopeId: currentAction[0].scopeId,
    domainId: currentAction[0].domainId,
    domainVersion: currentAction[0].domainVersion,
    schemaId: 'operating-delivery-evidence',
    artifactSchemaVersion: '1.0.0',
    mediaType: 'application/json',
    encoding: 'utf-8',
    rawHash,
    canonicalHash: artifactBodyHash,
    sizeBytes: bytes.byteLength,
    storageClass: 'machine-local',
    sensitivity: deliveryEvidence.classification,
    retentionClass: 'project',
    producer: { actorId: 'openplanr', roleId: 'planning-delivery-ingestor', runtime: 'openplanr' },
    inputArtifactIds: [currentAction[0].sourceArtifactId],
    createdAt: timestamp,
  };
  const evidenceRef = {
    kind: 'operating-evidence-ref',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    evidenceRefId,
    candidateId,
    scopeId: currentAction[0].scopeId,
    domainId: currentAction[0].domainId,
    domainVersion: currentAction[0].domainVersion,
    sourceArtifactId: currentAction[0].sourceArtifactId,
    evidenceKind: 'planr',
    sourceContract: { id: 'planning-acceptance', version: '1.0.0' },
    locator: {
      projectId: 'openplanr',
      artifactId: deliveryEvidence.deliveryEvidenceId,
      artifactType: 'planning-delivery-evidence',
      contentHash: deliveryEvidence.deliveryEvidenceHash,
    },
    provider: { id: 'openplanr-delivery-provider', version: PROTOCOL_VERSION },
    resolver: { id: 'openplanr-delivery-resolver', version: PROTOCOL_VERSION },
    classification: deliveryEvidence.classification,
    freshness: 'current',
    evidenceArtifactId: artifactId,
    evidenceArtifactRawHash: rawHash,
    evidenceArtifactCanonicalHash: artifactBodyHash,
    resolvedAt: timestamp,
  };
  const revisit = deliveryEvidence.deliveryStatus !== 'succeeded';
  const assignment = {
    kind: 'operating-assignment',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    assignmentId,
    cycleId: currentAction[0].sourceCycleId,
    assignmentKind: 'verification',
    roleId: revisit ? 'operate-planning-decision-revisit' : 'operate-planning-delivery-verifier',
    objective: revisit
      ? `Revisit Decision ${currentDecision[0].decisionId} after ${deliveryEvidence.deliveryStatus} Planning delivery evidence; do not rewrite the source Decision.`
      : `Observe metric ${reconstructed.metric.metricId} in ${reconstructed.verificationPlan.window} for original plan ${reconstructed.verificationPlan.verificationPlanId}; delivery does not establish an Outcome.`,
    state: 'available',
    dependsOn: [],
    dependencyPolicy: { kind: 'none' },
    inputArtifactIds: [artifactId],
    inputAbsences: [],
    outputContract: {
      schemaId: revisit ? 'operating-decision-ledger' : 'operating-metric-observation',
      schemaVersion: PROTOCOL_VERSION,
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262144,
    },
    capabilityGrantId: null,
    governedOperationId: null,
    attemptPolicy: { maxAttempts: 1, attempt: 0, timeoutMs: 30000 },
    claim: null,
    terminalOutcome: null,
    createdAt: timestamp,
    availableAt: timestamp,
    completedAt: null,
  };
  for (const [kind, record] of [
    ['operating-artifact', artifact],
    ['operating-evidence-ref', evidenceRef],
    ['operating-assignment', assignment],
  ]) {
    assertProtocolArtifact(kind, record, { protocolVersion: PROTOCOL_VERSION });
  }
  return { artifact, evidenceRef, assignment, bytes, reconstructed };
}

export function ingestOperatingPlanningDeliveryEvidenceV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    artifactStore,
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertExactKeys(
    request,
    ['origin', 'deliveryEvidence', 'verificationPlanEvent', 'expectedEventHead'],
    'Planning delivery ingestion request',
  );
  assertExactKeys(
    draft,
    ['eventId', 'timestamp', 'correlationId'],
    'Planning delivery ingestion draft',
  );
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  const built = buildPlanningDeliveryIngestionV2(initialState, {
    ...request,
    timestamp: draft.timestamp,
  });
  const payload = {
    origin: clone(request.origin),
    deliveryEvidence: clone(request.deliveryEvidence),
    artifact: clone(built.artifact),
    evidenceRef: clone(built.evidenceRef),
    assignment: clone(built.assignment),
    verificationPlanEvent: clone(request.verificationPlanEvent),
    verificationSource: {
      ledgerId: built.reconstructed.ledgerId,
      snapshotId: built.reconstructed.snapshotId,
      stateId: built.reconstructed.stateId,
    },
  };
  const requestHash = sha256Jcs({
    contract: 'operate-v2-planning-delivery-ingestion',
    origin: request.origin,
    deliveryEvidence: request.deliveryEvidence,
    verificationPlanEvent: request.verificationPlanEvent,
    draft,
  });
  const replay = initialState.eventReplayIndex.find(({ eventId }) => eventId === draft.eventId);
  if (replay) {
    const exact =
      replay.type === 'planning-delivery.ingested' &&
      replay.entityId === request.deliveryEvidence.deliveryEvidenceId &&
      replay.requestHash === requestHash &&
      initialState.assignments.some(
        ({ assignmentId }) => assignmentId === built.assignment.assignmentId,
      ) &&
      initialState.artifacts.some(({ artifactId }) => artifactId === built.artifact.artifactId) &&
      initialState.evidenceRefs.some(
        ({ evidenceRefId }) => evidenceRefId === built.evidenceRef.evidenceRefId,
      );
    if (!exact)
      throw runtimeError(
        'CONCURRENT_MODIFICATION',
        'Planning delivery Event identity was reused with divergent custody.',
      );
    return Object.freeze({
      state: clone(initialState),
      events: Object.freeze([]),
      ...payload,
      replayed: true,
    });
  }
  if (
    request.expectedEventHead?.sequence !== initialState.eventHead.sequence ||
    request.expectedEventHead?.hash !== initialState.eventHead.hash
  ) {
    throw runtimeError(
      'CONCURRENT_MODIFICATION',
      'Planning delivery ingestion requires the exact current Event head.',
    );
  }
  if (
    initialState.assignments.some(
      ({ assignmentId }) => assignmentId === built.assignment.assignmentId,
    ) ||
    initialState.artifacts.some(({ artifactId }) => artifactId === built.artifact.artifactId) ||
    initialState.evidenceRefs.some(
      ({ evidenceRefId }) => evidenceRefId === built.evidenceRef.evidenceRefId,
    )
  ) {
    throw runtimeError(
      'CONCURRENT_MODIFICATION',
      'Planning delivery evidence already has conflicting materialized custody.',
    );
  }
  const previousEvent =
    initialState.eventHead.sequence === 0
      ? null
      : { sequence: initialState.eventHead.sequence, eventHash: initialState.eventHead.hash };
  const event = createOperatingRuntimeEventV2(
    {
      eventId: draft.eventId,
      timestamp: draft.timestamp,
      cycleId: built.assignment.cycleId,
      type: 'planning-delivery.ingested',
      entityId: request.deliveryEvidence.deliveryEvidenceId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId: request.verificationPlanEvent.eventId,
      correlationId: draft.correlationId,
      requestHash,
      payload,
    },
    { previousEvent },
  );
  const state = reduceOperatingRuntimeEventsV2([event], {
    initialState,
    artifactStore,
    replayHook,
  });
  if (!artifactStore?.stageRaw)
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Planning delivery ingestion requires durable Artifact byte custody.',
    );
  artifactStore.stageRaw({ artifact: built.artifact, rawBytes: built.bytes });
  replayHook.assertUnused();
  return Object.freeze({ state, events: Object.freeze([event]), ...payload, replayed: false });
}

const TERMINAL_VERIFICATION_INSUFFICIENT_EVIDENCE_STATEMENT =
  'No accepted metric observation was available; the Action hypothesis remains unconfirmed.';

function runtimeVerificationId(prefix, identity) {
  return `${prefix}_${sha256Jcs(identity).slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

/**
 * Build the only terminal-verification result that may be issued without a
 * metric observation. It records absence of evidence, never execution success
 * or failure, and remains owned by one canonical verification Assignment.
 */
export function buildOperatingTerminalVerificationInsufficientEvidenceV2({
  action,
  verificationPlan,
  assignment,
  sourceArtifactId,
  timestamp: observedAt,
} = {}) {
  for (const [kind, candidate] of [
    ['operating-action', action],
    ['operating-action-verification-plan', verificationPlan],
    ['operating-assignment', assignment],
  ]) {
    try {
      assertProtocolArtifact(kind, candidate, { protocolVersion: PROTOCOL_VERSION });
    } catch (error) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Terminal verification requires contract-valid Action, plan, and Assignment records.',
        {
          kind,
          cause: error.code ?? null,
        },
      );
    }
  }
  assertRuntimeDraftString(sourceArtifactId, 'sourceArtifactId', 'Terminal verification result');
  assertRuntimeDraftString(observedAt, 'timestamp', 'Terminal verification result');
  if (Number.isNaN(Date.parse(observedAt))) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Terminal verification result timestamp must be ISO 8601.',
    );
  }
  if (
    !sameOperatingScope(action, verificationPlan) ||
    action.verificationPlanId !== verificationPlan.verificationPlanId ||
    verificationPlan.actionId !== action.actionId ||
    assignment.assignmentKind !== 'verification' ||
    assignment.cycleId !== action.sourceCycleId ||
    typeof assignment.governedOperationId !== 'string' ||
    assignment.outputContract?.schemaId !== 'operating-outcome' ||
    assignment.outputContract?.schemaVersion !== PROTOCOL_VERSION ||
    assignment.outputContract?.mediaType !== 'application/json' ||
    assignment.outputContract?.encoding !== 'utf-8'
  ) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Terminal verification result must retain one exact Action, plan, and verification Assignment binding.',
      {
        actionId: action?.actionId ?? null,
        verificationPlanId: verificationPlan?.verificationPlanId ?? null,
        assignmentId: assignment?.assignmentId ?? null,
      },
    );
  }
  const outcomeId = runtimeVerificationId('out', {
    contract: 'operate-v2-terminal-verification-insufficient-evidence',
    actionId: action.actionId,
    verificationPlanId: verificationPlan.verificationPlanId,
    assignmentId: assignment.assignmentId,
    governedOperationId: assignment.governedOperationId,
    sourceArtifactId,
    observedAt,
  });
  const outcome = {
    kind: 'operating-outcome',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    outcomeId,
    actionId: action.actionId,
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    verificationPlanId: verificationPlan.verificationPlanId,
    status: 'insufficient-evidence',
    observationIds: [],
    evidenceRefIds: [],
    sourceArtifactId,
    observedAt,
  };
  const learning = {
    kind: 'operating-learning',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    learningId: runtimeVerificationId('lrn', {
      contract: 'operate-v2-terminal-verification-insufficient-evidence-learning',
      outcomeId,
      statement: TERMINAL_VERIFICATION_INSUFFICIENT_EVIDENCE_STATEMENT,
    }),
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    statement: TERMINAL_VERIFICATION_INSUFFICIENT_EVIDENCE_STATEMENT,
    outcomeId,
    assumptionIds: [],
    decisionIds: [action.sourceDecisionId],
    evidenceRefIds: [],
    sourceArtifactId,
    createdAt: observedAt,
  };
  for (const [kind, candidate] of [
    ['operating-outcome', outcome],
    ['operating-learning', learning],
  ]) {
    try {
      assertProtocolArtifact(kind, candidate, { protocolVersion: PROTOCOL_VERSION });
    } catch (error) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Runtime-issued terminal verification records are not contract-valid.',
        {
          kind,
          cause: error.code ?? null,
        },
      );
    }
  }
  return Object.freeze({ outcome: clone(outcome), learning: clone(learning) });
}

function terminalVerificationInsufficientEvidenceSource(index, outcome, timestamp, artifactStore) {
  const artifact = index.artifacts.get(outcome.sourceArtifactId);
  const assignment = artifact ? index.assignments.get(artifact.assignmentId) : null;
  const submission = artifact ? acceptedSubmissionForArtifact(index, artifact) : null;
  const action = index.actions.get(outcome.actionId);
  const verificationPlan = index.verificationPlans.get(outcome.verificationPlanId);
  const operation = assignment
    ? index.governedOperations.get(assignment.governedOperationId)
    : null;
  const cycle = action ? index.cycles.get(action.sourceCycleId) : null;
  const result =
    operation?.operationKind === 'rollback'
      ? index.rollbackResults.get(operation.resultId)
      : index.executionResults.get(operation?.resultId);
  if (
    !artifact ||
    !assignment ||
    !submission ||
    !action ||
    !verificationPlan ||
    !operation ||
    !cycle ||
    !result ||
    outcome.status !== 'insufficient-evidence' ||
    outcome.observationIds.length !== 0 ||
    outcome.evidenceRefIds.length !== 0 ||
    assignment.state !== 'validated' ||
    assignment.assignmentKind !== 'verification' ||
    assignment.cycleId !== cycle.cycleId ||
    assignment.governedOperationId !== operation.operationId ||
    operation.state !== 'succeeded' ||
    operation.resultId !== (result.resultId ?? result.rollbackResultId) ||
    operation.action.actionId !== action.actionId ||
    operation.action.revision !== action.revision ||
    operation.action.actionHash !== action.actionHash ||
    operation.verificationPlanId !== verificationPlan.verificationPlanId ||
    !sameOperatingScope(action, cycle) ||
    !sameOperatingScope(action, verificationPlan)
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Insufficient-evidence Outcome requires one accepted canonical terminal verification Assignment and exact operation authority.',
      {
        outcomeId: outcome?.outcomeId ?? null,
        assignmentId: assignment?.assignmentId ?? null,
        operationId: operation?.operationId ?? null,
      },
    );
  }
  const records = buildOperatingTerminalVerificationInsufficientEvidenceV2({
    action,
    verificationPlan,
    assignment,
    sourceArtifactId: artifact.artifactId,
    timestamp,
  });
  let body;
  try {
    body = decodeOperatingIntelligenceArtifactBodyV2({
      artifact,
      rawBytes: readOperatingArtifactRawBytesV2(artifactStore, {
        artifactId: artifact.artifactId,
        rawHash: artifact.rawHash,
      }),
      subject: 'Terminal verification result',
    });
  } catch (error) {
    throw runtimeError(
      error.code ?? 'RESULT_CONTRACT_INVALID',
      error.message,
      error.details?.context ?? {
        artifactId: artifact.artifactId,
      },
    );
  }
  if (sha256Jcs(body) !== sha256Jcs(records.outcome)) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Accepted terminal verification bytes must equal the runtime-issued insufficient-evidence Outcome.',
      {
        artifactId: artifact.artifactId,
        outcomeId: records.outcome.outcomeId,
      },
    );
  }
  return {
    artifact,
    assignment,
    submission,
    action,
    verificationPlan,
    operation,
    cycle,
    result,
    records,
  };
}

const applyWorkflowRuntimeEvent = createWorkflowRuntimeEventHandlerV2({
  PROTOCOL_VERSION,
  assertOperatingActionCyclePlanOwnershipV2,
  buildOperatingReviewReadDataV2,
  clone,
  compiledTransition,
  indexBy,
  materializeRuntimeState,
  operatingActionAuthorityPromotionRequestHash,
  requireValidatedWorkChangeSetArtifact,
  runtimeError,
  sameOperatingEventHead,
  transitionOperatingActionLifecycleV2,
  transitionOperatingCycleLifecycleV2,
  transitionOperatingReviewV2,
  uniqueReplayEvent,
});

const applyEvidenceStateRuntimeEvent = createEvidenceStateRuntimeEventHandlerV2({
  acceptedEvidenceSource,
  assertFreshIntelligenceIdentity,
  assertIntelligenceEvidenceRefs,
  assertIntelligenceSourceArtifact,
  assertIntelligenceTimestamp,
  assertOperatingModelStateProvenance,
  assertOperatingSnapshotProvenance,
  buildPlanningDeliveryIngestionV2,
  clone,
  intelligenceEventRecord,
  materializeRuntimeState,
  requireRuntimeIntelligenceActor,
  runtimeError,
  sameEvidenceBinding,
});

const applyIntelligenceRecordRuntimeEvent = createIntelligenceRuntimeEventHandlerV2({
  PROTOCOL_VERSION,
  acceptedCausationForSnapshotSource,
  acceptedChairArtifactForLedger,
  acceptedSubmissionForArtifact,
  assertFreshIntelligenceIdentity,
  assertIntelligenceEvidenceRefs,
  assertIntelligenceSourceArtifact,
  assertIntelligenceTimestamp,
  buildRuntimeDecisionLedgerMaterialization,
  clone,
  intelligenceEventRecord,
  intelligenceProducerArtifacts,
  recordedDecisionLedgerMaterializationTimestamp,
  requireRuntimeIntelligenceActor,
  runtimeError,
  sameEvidenceBinding,
  terminalVerificationInsufficientEvidenceSource,
});

const applyAuthorityRuntimeEvent = createAuthorityRuntimeEventHandlerV2({
  PROTOCOL_VERSION,
  assertCanonicalRecordHash,
  assertOperatingDispatchExecutionProjectionsV2,
  assertOperatingExecuteOperationV2,
  assertOperatingRollbackAuthorityChainIndexV2,
  assertOperatingTerminalExecutionChainV2,
  capabilityAvailabilityForGovernedOperation,
  clone,
  // The reducer that defines eventReplayEntry is created after its handlers.
  eventReplayEntry: (event) => eventReplayEntry(event),
  findOperatingExactActionOperationOwnerV2,
  indexBy,
  recordWithoutHash,
  requireRuntimeIntelligenceActor,
  reservedExecutionTerminalForStatus,
  runtimeError,
  sameCanonicalStringSet,
});

// The reducer hands evidence-state and intelligence record Events to one intelligence handler.
const EVIDENCE_STATE_EVENT_PREFIXES = new Set([
  'evidence',
  'planning-delivery',
  'snapshot',
  'operating-state',
  'metric',
]);

function applyIntelligenceRuntimeEvent(index, event, options) {
  const apply = EVIDENCE_STATE_EVENT_PREFIXES.has(event.type.split('.')[0])
    ? applyEvidenceStateRuntimeEvent
    : applyIntelligenceRecordRuntimeEvent;
  apply(index, event, options);
}

function sorted(index, key) {
  return [...index.values()].sort((left, right) =>
    String(left[key]).localeCompare(String(right[key])),
  );
}

function materializeRuntimeState(index, generatedAt, eventHead) {
  assertOperatingSnapshotCheckpoint(index);
  if (index.authorityHistoryEnabled) assertCheckpointTerminalVerificationAssignmentsV2(index);
  const state = {
    kind: 'operating-runtime-state',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    generatedAt,
    eventHead,
    cycles: sorted(index.cycles, 'cycleId'),
    inputBindings: sorted(index.inputBindings, 'inputBindingId'),
    assignments: sorted(index.assignments, 'assignmentId'),
    reviews: sorted(index.reviews, 'reviewId'),
    ...(index.executiveBoardsEnabled
      ? { executiveBoards: sorted(index.executiveBoards, 'boardId') }
      : {}),
    submissions: sorted(index.submissions, 'submissionId'),
    artifacts: sorted(index.artifacts, 'artifactId'),
    findings: sorted(index.findings, 'findingId'),
    decisions: sorted(index.decisions, 'decisionId'),
    actions: sorted(index.actions, 'actionId'),
    operatingModelStates: sorted(index.operatingModelStates, 'stateId'),
    operatingSnapshots: sorted(index.operatingSnapshots, 'snapshotId'),
    objectives: sorted(index.objectives, 'objectiveId'),
    metrics: sorted(index.metrics, 'metricId'),
    metricObservations: sorted(index.metricObservations, 'observationId'),
    risks: sorted(index.risks, 'riskId'),
    assumptions: sorted(index.assumptions, 'assumptionId'),
    claims: sorted(index.claims, 'claimId'),
    deltas: sorted(index.deltas, 'deltaId'),
    intelligencePlans: sorted(index.intelligencePlans, 'planId'),
    decisionLedgers: sorted(index.decisionLedgers, 'ledgerId'),
    verificationPlans: sorted(index.verificationPlans, 'verificationPlanId'),
    outcomes: sorted(index.outcomes, 'outcomeId'),
    learnings: sorted(index.learnings, 'learningId'),
    scenarios: sorted(index.scenarios, 'scenarioId'),
    eventTriggers: sorted(index.eventTriggers, 'triggerId'),
    evidenceRefs: sorted(index.evidenceRefs, 'evidenceRefId'),
    evidenceResolutions: sorted(index.evidenceResolutions, 'resolutionId'),
    evidenceEdges: sorted(index.evidenceEdges, 'edgeId'),
    evidenceResolutionReplayIndex: sorted(index.evidenceReplay, 'resolutionId'),
    submissionReplayIndex: sorted(index.replay, 'submissionId'),
    workChangeSetReplayIndex: sorted(index.workReplay, 'artifactId'),
    eventReplayIndex: [...index.eventReplay.values()].sort(
      (left, right) => left.sequence - right.sequence,
    ),
    ...(index.authorityHistoryEnabled
      ? {
          actionPolicies: [...index.actionPolicies.values()].sort((left, right) =>
            `${left.policyId}@${left.policyVersion}`.localeCompare(
              `${right.policyId}@${right.policyVersion}`,
            ),
          ),
          policyEvaluations: sorted(index.policyEvaluations, 'evaluationId'),
          approvalRequirements: sorted(index.approvalRequirements, 'requirementId'),
          approvalRecords: sorted(index.approvalRecords, 'approvalId'),
          capabilityAvailability: sorted(index.capabilityAvailability, 'availabilityId'),
          capabilityGrants: sorted(index.capabilityGrants, 'grantId'),
          governedOperations: sorted(index.governedOperations, 'operationId'),
          executionResults: sorted(index.executionResults, 'resultId'),
          rollbackPlans: sorted(index.rollbackPlans, 'rollbackPlanId'),
          rollbackResults: sorted(index.rollbackResults, 'rollbackResultId'),
          operationReplayIndex: sorted(index.operationReplayIndex, 'operationId'),
        }
      : {}),
  };
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
  return state;
}

function schedulerSourceEvent(events) {
  return (
    [...events]
      .reverse()
      .find(
        ({ type }) =>
          type === 'assignment.created' ||
          type === 'assignment.validated' ||
          type === 'assignment.abandoned' ||
          type === 'assignment.failed',
      ) ?? null
  );
}

function schedulerReleaseEventId(releaseId) {
  return `evt_${releaseId}`;
}

function schedulerTerminalEventId(terminalId) {
  return `evt_${terminalId}`;
}

/**
 * Atomically reduce caller-owned source Events with the complete runtime-owned
 * scheduler terminal and release batch. This is the only normal transaction
 * constructor for creation and qualifying terminal transitions; callers never
 * select targets, proofs, or scheduler Event identities.
 */
export function scheduleOperatingRuntimeEventsV2(
  sourceEvents,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  if (!Array.isArray(sourceEvents)) {
    throw runtimeError('STATE_TRANSITION_INVALID', 'Scheduler source Events must be an array.');
  }
  if (sourceEvents.some((event) => event?.type === 'assignment.available')) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Availability Events are scheduler-owned and cannot be supplied as source Events.',
    );
  }
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  const durableEventIds = new Set(initialState.eventReplayIndex.map(({ eventId }) => eventId));
  const created = sourceEvents
    .filter((event) => event?.type === 'assignment.created' && !durableEventIds.has(event.eventId))
    .map(({ payload }) => payload);
  try {
    validateOperatingAssignmentGraphV2([...initialState.assignments, ...created]);
  } catch (error) {
    throw runtimeError('STATE_TRANSITION_INVALID', error.message, error.details ?? {});
  }
  const sourceState = reduceOperatingRuntimeEventsV2(sourceEvents, { initialState, replayHook });
  try {
    validateOperatingAssignmentGraphV2(sourceState.assignments);
  } catch (error) {
    throw runtimeError('STATE_TRANSITION_INVALID', error.message, error.details ?? {});
  }
  const source = schedulerSourceEvent(sourceEvents);
  if (!source) {
    return Object.freeze({
      state: sourceState,
      events: Object.freeze([...sourceEvents]),
      releaseEvents: Object.freeze([]),
    });
  }
  const terminalIntents = deriveOperatingAssignmentTerminalIntentsV2({
    assignments: sourceState.assignments,
    submissions: sourceState.submissions,
    artifacts: sourceState.artifacts,
    submissionReplayIndex: sourceState.submissionReplayIndex,
    intelligencePlans: sourceState.intelligencePlans,
  });
  let previousEvent =
    sourceState.eventHead.sequence === 0
      ? null
      : { sequence: sourceState.eventHead.sequence, eventHash: sourceState.eventHead.hash };
  const terminalEvents = terminalIntents.map((intent) => {
    const event = createOperatingRuntimeEventV2(
      {
        eventId: schedulerTerminalEventId(intent.terminalId),
        timestamp: source.timestamp,
        cycleId: intent.cycleId,
        type: 'assignment.failed',
        entityId: intent.assignmentId,
        actor: { kind: 'engine', id: 'openplanr-scheduler' },
        causationId: intent.dependencyEventIds.at(-1),
        correlationId: source.correlationId,
        payload: clone(intent.payload),
      },
      { previousEvent },
    );
    previousEvent = event;
    return event;
  });
  const terminalState =
    terminalEvents.length === 0
      ? sourceState
      : reduceOperatingRuntimeEventsV2(terminalEvents, { initialState: sourceState, replayHook });
  const intents = deriveOperatingAssignmentReleaseIntentsV2({
    assignments: terminalState.assignments,
    submissions: terminalState.submissions,
    artifacts: terminalState.artifacts,
    submissionReplayIndex: terminalState.submissionReplayIndex,
    intelligencePlans: terminalState.intelligencePlans,
  });
  const releaseCausation = terminalEvents.at(-1)?.eventId ?? source.eventId;
  const releaseEvents = intents.map((intent) => {
    const event = createOperatingRuntimeEventV2(
      {
        eventId: schedulerReleaseEventId(intent.releaseId),
        timestamp: source.timestamp,
        cycleId: intent.cycleId,
        type: 'assignment.available',
        entityId: intent.assignmentId,
        actor: { kind: 'engine', id: 'openplanr-scheduler' },
        causationId: releaseCausation,
        correlationId: source.correlationId,
        payload: {
          assignmentId: intent.assignmentId,
          releaseId: intent.releaseId,
          dependencyProofs: clone(intent.dependencyProofs),
          dependencyEventIds: clone(intent.dependencyEventIds),
        },
      },
      { previousEvent },
    );
    previousEvent = event;
    return event;
  });
  if (terminalEvents.length === 0 && releaseEvents.length === 0) {
    return Object.freeze({
      state: sourceState,
      events: Object.freeze([...sourceEvents]),
      releaseEvents: Object.freeze([]),
    });
  }
  const state =
    releaseEvents.length === 0
      ? terminalState
      : reduceOperatingRuntimeEventsV2(releaseEvents, { initialState: terminalState, replayHook });
  return Object.freeze({
    state,
    events: Object.freeze([...sourceEvents, ...terminalEvents, ...releaseEvents]),
    releaseEvents: Object.freeze(releaseEvents),
  });
}

function requireSubmissionAcceptanceDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw runtimeError('RESULT_CONTRACT_INVALID', 'The runtime acceptance draft is required.');
  }
  const allowedFields = new Set([
    'artifactId',
    'artifactType',
    'storageClass',
    'sensitivity',
    'retentionClass',
    'inputArtifactIds',
    'timestamp',
    'validatorVersion',
    'eventIds',
    'correlationId',
  ]);
  const unsupported = Object.keys(draft).filter((field) => !allowedFields.has(field));
  if (unsupported.length > 0) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'The runtime acceptance draft contains unsupported fields.',
      {
        fields: unsupported,
      },
    );
  }
  if (
    typeof draft.artifactId !== 'string' ||
    typeof draft.artifactType !== 'string' ||
    typeof draft.timestamp !== 'string' ||
    typeof draft.validatorVersion !== 'string' ||
    typeof draft.correlationId !== 'string' ||
    !draft.eventIds ||
    typeof draft.eventIds !== 'object' ||
    Array.isArray(draft.eventIds)
  ) {
    throw runtimeError('RESULT_CONTRACT_INVALID', 'The runtime acceptance draft is incomplete.');
  }
  const eventIds = [
    draft.eventIds.submitted,
    draft.eventIds.artifactCreated,
    draft.eventIds.validated,
  ];
  if (
    eventIds.some((eventId) => typeof eventId !== 'string' || eventId.length === 0) ||
    new Set(eventIds).size !== eventIds.length
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'The runtime acceptance draft must contain three distinct Event identities.',
    );
  }
  if (
    !Array.isArray(draft.inputArtifactIds) ||
    new Set(draft.inputArtifactIds).size !== draft.inputArtifactIds.length
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'The runtime acceptance draft has invalid immutable references.',
    );
  }
  return {
    artifactId: draft.artifactId,
    artifactType: draft.artifactType,
    storageClass: draft.storageClass ?? 'machine-local',
    sensitivity: draft.sensitivity ?? 'internal',
    retentionClass: draft.retentionClass ?? 'project',
    inputArtifactIds: clone(draft.inputArtifactIds),
    timestamp: draft.timestamp,
    validatorVersion: draft.validatorVersion,
    eventIds: {
      submitted: draft.eventIds.submitted,
      artifactCreated: draft.eventIds.artifactCreated,
      validated: draft.eventIds.validated,
    },
    correlationId: draft.correlationId,
  };
}

function acceptanceConflict(submissionId) {
  throw runtimeError(
    'SUBMISSION_ID_CONFLICT',
    `Submission ${submissionId} is bound to different exact result bytes.`,
    {
      submissionId,
    },
  );
}

function validationIssueFromError(error) {
  const context = clone(error?.details?.context ?? {});
  const schemaMessage = context.schemaMessage;
  const match =
    typeof schemaMessage === 'string'
      ? schemaMessage.match(/(?:^|:\s)(\$(?:\.[A-Za-z0-9_-]+|\[[0-9]+\])*)/u)
      : null;
  const path =
    typeof context.path === 'string'
      ? context.path
      : match
        ? match[1]
            .slice(1)
            .replace(/\.([A-Za-z0-9_-]+)/gu, '/$1')
            .replace(/\[([0-9]+)\]/gu, '/$1') || '/'
        : '/';
  return Object.freeze({
    code: error?.code ?? 'RESULT_CONTRACT_INVALID',
    path,
    message: error?.message ?? 'Assignment result validation failed.',
    context: Object.freeze(context),
  });
}

function protocolValidationIssue({ path, rule, detail }) {
  const pointer =
    typeof path === 'string' && path.startsWith('$')
      ? path
          .slice(1)
          .replace(/\.([A-Za-z0-9_-]+)/gu, '/$1')
          .replace(/\[([0-9]+)\]/gu, '/$1') || '/'
      : '/';
  return Object.freeze({
    code: 'RESULT_CONTRACT_INVALID',
    path: pointer,
    message: detail,
    context: Object.freeze({ rule }),
  });
}

/**
 * Resolve and preflight one prepared executor result against the exact durable
 * Assignment, issued bundle, Evidence custody, and accepted predecessor bytes.
 * This function is read-only and emits no identities, Events, or state changes.
 */
export function preflightOperatingAssignmentResultV2(
  request,
  { initialState = createEmptyOperatingRuntimeStateV2(), artifactStore } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  assertExactKeys(request, ['assignmentId', 'contentBytes'], 'Assignment result preflight request');
  if (
    typeof request.assignmentId !== 'string' ||
    request.assignmentId.length === 0 ||
    !(request.contentBytes instanceof Uint8Array)
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Assignment result preflight requires one Assignment identity and exact byte buffer.',
    );
  }
  const index = indexRuntimeState(initialState);
  const assignment = index.assignments.get(request.assignmentId);
  if (!assignment || !['running', 'validated'].includes(assignment.state)) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Assignment result preflight requires one exact claimed or retained validated Assignment.',
      {
        assignmentId: request.assignmentId,
      },
    );
  }
  const contentBytes = Buffer.from(request.contentBytes);
  if (
    assignment.outputContract.mediaType === 'application/json' &&
    assignment.outputContract.encoding === 'utf-8'
  ) {
    let value;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contentBytes));
    } catch {
      return Object.freeze({
        valid: false,
        assignmentId: assignment.assignmentId,
        schemaId: assignment.outputContract.schemaId,
        issues: Object.freeze([
          Object.freeze({
            code: 'RESULT_CONTRACT_INVALID',
            path: '/',
            message: 'The prepared result is not valid UTF-8 JSON.',
            context: Object.freeze({}),
          }),
        ]),
      });
    }
    const schemaErrors = validateProtocolArtifact(assignment.outputContract.schemaId, value, {
      protocolVersion: PROTOCOL_VERSION,
    });
    if (schemaErrors.length > 0) {
      return Object.freeze({
        valid: false,
        assignmentId: assignment.assignmentId,
        schemaId: assignment.outputContract.schemaId,
        issues: Object.freeze(schemaErrors.slice(0, 64).map(protocolValidationIssue)),
      });
    }
  }
  try {
    validateSubmissionBodyForAssignment(contentBytes, assignment, index, { artifactStore });
    return Object.freeze({
      valid: true,
      assignmentId: assignment.assignmentId,
      schemaId: assignment.outputContract.schemaId,
      issues: Object.freeze([]),
    });
  } catch (error) {
    return Object.freeze({
      valid: false,
      assignmentId: assignment.assignmentId,
      schemaId: assignment.outputContract.schemaId,
      issues: Object.freeze([validationIssueFromError(error)]),
    });
  }
}

/**
 * Reference transaction for the bounded Phase 1 direct-submit path.
 *
 * The raw bytes are decoded and staged only in local variables. All validation,
 * immutable Artifact construction, Event construction, and projection reduction
 * finishes before a new state is returned, so an exception cannot expose a
 * partially accepted projection. A durable store implements the corresponding
 * raw-byte staging/promotion around this pure contract; it must not add paths,
 * caller idempotency keys, or a second acceptance route.
 */
export function acceptOperatingAssignmentSubmissionV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    artifactStore,
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  if (!validateSubmitRequestShape(request)) {
    throw runtimeError('RESULT_CONTRACT_INVALID', 'The submission request is malformed.');
  }
  const acceptance = requireSubmissionAcceptanceDraft(draft);
  const index = indexRuntimeState(initialState);
  const assignment = index.assignments.get(request.assignmentId);
  if (!assignment || !actorMatchesClaim(request.actor, assignment.claim)) {
    throw runtimeError(
      'CAPABILITY_DENIED',
      'Only the exact retained Assignment claimant may submit this result.',
      {
        assignmentId: request.assignmentId,
        submissionId: request.submissionId,
      },
    );
  }
  const existingReplay = index.replay.get(request.submissionId);

  if (existingReplay) {
    const existingSubmission = index.submissions.get(request.submissionId);
    const existingArtifact = index.artifacts.get(existingReplay.artifactId);
    let stagedRawBytes;
    try {
      stagedRawBytes = validateExactAcceptedSubmissionReplay({
        request,
        assignment,
        submission: existingSubmission,
        artifact: existingArtifact,
        replay: existingReplay,
        requestedInputArtifactIds: acceptance.inputArtifactIds,
      });
    } catch (error) {
      if (error?.code === 'SUBMISSION_ID_CONFLICT') acceptanceConflict(request.submissionId);
      throw error;
    }
    return Object.freeze({
      state: clone(initialState),
      response: clone(existingReplay.responseData),
      artifact: clone(existingArtifact),
      events: Object.freeze([]),
      stagedRawBytes: Buffer.from(stagedRawBytes),
      replayed: true,
    });
  }

  const submission = index.submissions.get(request.submissionId);
  if (
    !assignment ||
    !submission ||
    submission.assignmentId !== request.assignmentId ||
    submission.cycleId !== assignment.cycleId
  ) {
    throw runtimeError(
      'SUBMISSION_ID_CONFLICT',
      'The submission request does not match a runtime-issued Assignment identity.',
      {
        assignmentId: request.assignmentId,
        submissionId: request.submissionId,
      },
    );
  }
  if (assignment.state !== 'running' || submission.state !== 'issued') {
    throw runtimeError(
      'ASSIGNMENT_ALREADY_SUBMITTED',
      'The runtime-issued Assignment cannot accept another submission.',
      {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
        state: assignment.state,
        submissionState: submission.state,
      },
    );
  }
  if (sha256Jcs(acceptance.inputArtifactIds) !== sha256Jcs(assignment.inputArtifactIds)) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'The Artifact draft must retain the complete ordered Assignment input custody.',
      {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
      },
    );
  }
  const stagedRawBytes = decodeSubmissionBytes(request);
  const rawHash = rawHashForBytes(stagedRawBytes);
  if (
    submission.rawHash !== null ||
    submission.canonicalHash !== null ||
    submission.sizeBytes !== null ||
    submission.artifactId !== null ||
    submission.acceptanceEventIds.length !== 0 ||
    submission.responseData !== null ||
    submission.resolvedAt !== null
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'The runtime-issued submission record contains prior attempt material.',
      {
        submissionId: submission.submissionId,
      },
    );
  }
  if (
    request.mediaType !== assignment.outputContract.mediaType ||
    request.encoding !== assignment.outputContract.encoding
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'The submission media type or encoding does not match the Assignment contract.',
      {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
      },
    );
  }
  if (stagedRawBytes.byteLength > assignment.outputContract.maxBytes) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'The submission exceeds the Assignment byte limit.',
      {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
        maxBytes: assignment.outputContract.maxBytes,
      },
    );
  }
  validateSubmissionBodyForAssignment(stagedRawBytes, assignment, index, { artifactStore });
  const cycle = index.cycles.get(assignment.cycleId);
  if (!cycle || !assignment.claim) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'A running Assignment must retain its Cycle and runtime claim.',
      {
        assignmentId: assignment.assignmentId,
      },
    );
  }
  const canonicalHash = canonicalHashForSubmissionBytes(stagedRawBytes, assignment.outputContract);
  const artifact = {
    kind: 'operating-artifact',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    artifactId: acceptance.artifactId,
    artifactType: acceptance.artifactType,
    assignmentId: assignment.assignmentId,
    cycleId: assignment.cycleId,
    scopeId: cycle.scopeId,
    domainId: cycle.domainId,
    domainVersion: cycle.domainVersion,
    schemaId: assignment.outputContract.schemaId,
    artifactSchemaVersion: assignment.outputContract.schemaVersion,
    mediaType: assignment.outputContract.mediaType,
    encoding: assignment.outputContract.encoding,
    rawHash,
    canonicalHash,
    sizeBytes: stagedRawBytes.byteLength,
    storageClass: acceptance.storageClass,
    sensitivity: acceptance.sensitivity,
    retentionClass: acceptance.retentionClass,
    producer: {
      actorId: assignment.claim.actorId,
      roleId: assignment.roleId,
      runtime: assignment.claim.runtime,
    },
    inputArtifactIds: acceptance.inputArtifactIds,
    createdAt: acceptance.timestamp,
  };
  assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: PROTOCOL_VERSION });
  if (index.artifacts.has(artifact.artifactId)) {
    throw runtimeError(
      'SUBMISSION_ID_CONFLICT',
      'The runtime acceptance draft reuses an Artifact identity.',
      {
        artifactId: artifact.artifactId,
      },
    );
  }

  const priorEvent =
    initialState.eventReplayIndex.find(
      ({ sequence }) => sequence === initialState.eventHead.sequence,
    ) ?? null;
  const submitted = createOperatingRuntimeEventV2(
    {
      eventId: acceptance.eventIds.submitted,
      timestamp: acceptance.timestamp,
      cycleId: assignment.cycleId,
      type: 'assignment.submitted',
      entityId: assignment.assignmentId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId: priorEvent?.eventId ?? null,
      correlationId: acceptance.correlationId,
      payload: {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
        rawHash,
        canonicalHash,
        sizeBytes: stagedRawBytes.byteLength,
        mediaType: assignment.outputContract.mediaType,
        encoding: assignment.outputContract.encoding,
      },
    },
    {
      previousEvent: {
        sequence: initialState.eventHead.sequence,
        eventHash: initialState.eventHead.hash,
      },
    },
  );
  const artifactCreated = createOperatingRuntimeEventV2(
    {
      eventId: acceptance.eventIds.artifactCreated,
      timestamp: acceptance.timestamp,
      cycleId: assignment.cycleId,
      type: 'artifact.created',
      entityId: artifact.artifactId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId: submitted.eventId,
      correlationId: acceptance.correlationId,
      payload: artifact,
    },
    { previousEvent: submitted },
  );
  const validated = createOperatingRuntimeEventV2(
    {
      eventId: acceptance.eventIds.validated,
      timestamp: acceptance.timestamp,
      cycleId: assignment.cycleId,
      type: 'assignment.validated',
      entityId: assignment.assignmentId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId: artifactCreated.eventId,
      correlationId: acceptance.correlationId,
      payload: {
        assignmentId: assignment.assignmentId,
        submissionId: submission.submissionId,
        artifactId: artifact.artifactId,
        validatorVersion: acceptance.validatorVersion,
      },
    },
    { previousEvent: artifactCreated },
  );
  const transaction = scheduleOperatingRuntimeEventsV2([submitted, artifactCreated, validated], {
    initialState,
    replayHook,
  });
  const { state } = transaction;
  const response = state.submissionReplayIndex.find(
    ({ submissionId }) => submissionId === submission.submissionId,
  )?.responseData;
  if (!response) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'The atomic submission transaction did not produce a replay acknowledgement.',
      {
        submissionId: submission.submissionId,
      },
    );
  }
  if (artifactStore !== undefined) {
    if (typeof artifactStore?.stageRaw !== 'function') {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Artifact byte storage must implement the runtime raw staging contract.',
      );
    }
    artifactStore.stageRaw({ artifact, rawBytes: stagedRawBytes });
  }
  return Object.freeze({
    state,
    response: clone(response),
    artifact: clone(artifact),
    events: transaction.events,
    stagedRawBytes: Buffer.from(stagedRawBytes),
    replayed: false,
  });
}

/**
 * Materializes durable work from one already-accepted Chair Artifact. This is
 * an internal runtime transaction, not a normal-agent tool: it derives every
 * persistent identity and records one atomic Event before exposing a state.
 */
export function materializeValidatedOperatingWorkV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Persistent-work materialization requires an Artifact and work-change-set.',
    );
  }
  if (
    !draft ||
    typeof draft !== 'object' ||
    Array.isArray(draft) ||
    typeof draft.eventId !== 'string' ||
    draft.eventId.length === 0 ||
    typeof draft.timestamp !== 'string' ||
    Number.isNaN(Date.parse(draft.timestamp)) ||
    typeof draft.correlationId !== 'string' ||
    draft.correlationId.length === 0
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Persistent-work materialization requires runtime-owned Event identity and timestamp.',
    );
  }
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  replayHook.assertUnused();
  const index = indexRuntimeState(initialState);
  const artifact = index.artifacts.get(request.artifactId);
  if (!artifact)
    throw runtimeError(
      'ARTIFACT_NOT_FOUND',
      'Persistent-work materialization references an unknown Artifact.',
      {
        artifactId: request.artifactId ?? null,
      },
    );
  const existing = index.workReplay.get(artifact.artifactId);
  if (existing) {
    let payload;
    try {
      payload = buildPersistentWorkMaterializationPayloadV2({
        artifact,
        changeSet: request.changeSet,
        timestamp: initialState.generatedAt,
      });
    } catch (error) {
      throw runtimeError(
        error.code ?? 'RESULT_CONTRACT_INVALID',
        error.message,
        error.details?.context ?? {
          artifactId: artifact.artifactId,
        },
      );
    }
    if (existing.canonicalHash !== payload.canonicalHash) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'A durable work-change-set Artifact identity was reused with different canonical content.',
        {
          artifactId: artifact.artifactId,
        },
      );
    }
    replayHook.assertUnused();
    return Object.freeze({
      state: clone(initialState),
      events: Object.freeze([]),
      findings: Object.freeze(
        existing.findingIds.map((findingId) => clone(index.findings.get(findingId))),
      ),
      decisions: Object.freeze(
        existing.decisionIds.map((decisionId) => clone(index.decisions.get(decisionId))),
      ),
      actions: Object.freeze(
        existing.actionIds.map((actionId) => clone(index.actions.get(actionId))),
      ),
      replayed: true,
    });
  }
  const source = {
    payload: { artifactId: artifact.artifactId },
    entityId: artifact.artifactId,
    cycleId: artifact.cycleId,
  };
  requireValidatedWorkChangeSetArtifact(index, source);
  let payload;
  try {
    payload = buildPersistentWorkMaterializationPayloadV2({
      artifact,
      changeSet: request.changeSet,
      timestamp: draft.timestamp,
    });
  } catch (error) {
    throw runtimeError(
      error.code ?? 'RESULT_CONTRACT_INVALID',
      error.message,
      error.details?.context ?? {
        artifactId: artifact.artifactId,
      },
    );
  }
  const causalSubmission = [...index.submissions.values()].find(
    (candidate) =>
      candidate.assignmentId === artifact.assignmentId &&
      candidate.artifactId === artifact.artifactId &&
      candidate.state === 'accepted',
  );
  const materialized = createOperatingRuntimeEventV2(
    {
      eventId: draft.eventId,
      timestamp: draft.timestamp,
      cycleId: artifact.cycleId,
      type: 'work-change-set.materialized',
      entityId: artifact.artifactId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId: causalSubmission.acceptanceEventIds.at(-1),
      correlationId: draft.correlationId,
      payload,
    },
    {
      previousEvent: {
        sequence: initialState.eventHead.sequence,
        eventHash: initialState.eventHead.hash,
      },
    },
  );
  const state = reduceOperatingRuntimeEventsV2([materialized], { initialState, replayHook });
  replayHook.assertUnused();
  return Object.freeze({
    state,
    events: Object.freeze([materialized]),
    findings: Object.freeze(payload.findings.map(clone)),
    decisions: Object.freeze(payload.decisions.map(clone)),
    actions: Object.freeze(payload.actions.map(clone)),
    replayed: false,
  });
}

/**
 * Promote one exact proposed Action into its immutable governed revision and
 * append the promotion as a replayable engine-owned Event. Callers provide the
 * prior Action bytes and closed authority inputs, never revision/hash identity.
 */
export function promoteOperatingActionAuthorityV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertExactKeys(request, ['action', 'authority'], 'Action authority-promotion request');
  assertExactKeys(
    request.authority,
    [
      'actionKind',
      'requestedCapability',
      'targetBinding',
      'effectClass',
      'preconditionArtifactIds',
      'executionBinding',
      'updatedAt',
    ],
    'Action authority-promotion inputs',
  );
  assertExactKeys(
    draft,
    ['eventId', 'timestamp', 'correlationId'],
    'Action authority-promotion draft',
  );
  assertRuntimeDraftString(draft.eventId, 'eventId', 'Action authority-promotion draft');
  assertRuntimeDraftString(
    draft.correlationId,
    'correlationId',
    'Action authority-promotion draft',
  );
  if (
    typeof draft.timestamp !== 'string' ||
    Number.isNaN(Date.parse(draft.timestamp)) ||
    request.authority.updatedAt !== draft.timestamp
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Action authority promotion requires one causal Event-owned timestamp.',
    );
  }
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  replayHook.assertUnused();
  let promoted;
  try {
    promoted = promotePersistentOperatingActionAuthorityV2(request.action, request.authority);
  } catch (error) {
    throw runtimeError(
      error.code ?? 'ACTION_REVISION_MISMATCH',
      error.message,
      error.details?.context ?? {
        actionId: request.action?.actionId ?? null,
      },
    );
  }
  const requestHash = operatingActionAuthorityPromotionRequestHash(
    request.action,
    request.authority,
  );
  const replay = initialState.eventReplayIndex.find(({ eventId }) => eventId === draft.eventId);
  if (replay) {
    const current = initialState.actions.find(
      ({ actionId }) => actionId === request.action.actionId,
    );
    if (
      replay.type !== 'action.authority-promoted' ||
      replay.entityId !== request.action.actionId ||
      replay.requestHash !== requestHash ||
      replay.timestamp !== draft.timestamp ||
      replay.correlationId !== draft.correlationId ||
      !current ||
      sha256Jcs(current) !== sha256Jcs(promoted)
    ) {
      throw runtimeError(
        'CONCURRENT_MODIFICATION',
        'Action authority promotion Event identity was reused with divergent content.',
        {
          eventId: draft.eventId,
          actionId: request.action.actionId,
        },
      );
    }
    return Object.freeze({
      state: clone(initialState),
      action: clone(current),
      events: Object.freeze([]),
      replayed: true,
    });
  }
  const current = initialState.actions.find(({ actionId }) => actionId === request.action.actionId);
  if (!current || sha256Jcs(current) !== sha256Jcs(request.action)) {
    throw runtimeError(
      'ACTION_REVISION_MISMATCH',
      'Action authority promotion requires the exact current proposed Action bytes.',
      {
        actionId: request.action?.actionId ?? null,
      },
    );
  }
  const event = createOperatingRuntimeEventV2(
    {
      eventId: draft.eventId,
      timestamp: draft.timestamp,
      cycleId: current.sourceCycleId,
      type: 'action.authority-promoted',
      entityId: current.actionId,
      actor: { kind: 'engine', id: 'openplanr' },
      causationId: initialState.eventReplayIndex.at(-1)?.eventId ?? null,
      correlationId: draft.correlationId,
      requestHash,
      payload: {
        before: clone(current),
        authority: clone(request.authority),
        action: clone(promoted),
      },
    },
    {
      previousEvent:
        initialState.eventHead.sequence === 0
          ? null
          : { sequence: initialState.eventHead.sequence, eventHash: initialState.eventHead.hash },
    },
  );
  const state = reduceOperatingRuntimeEventsV2([event], { initialState, replayHook });
  replayHook.assertUnused();
  return Object.freeze({
    state,
    action: clone(promoted),
    events: Object.freeze([event]),
    replayed: false,
  });
}

function assertOperatingSnapshotMaterializationRequest(request, draft) {
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    !draft ||
    typeof draft !== 'object' ||
    Array.isArray(draft)
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Operating state/snapshot materialization requires a manifest and runtime-owned draft.',
    );
  }
  const requestFields = new Set([
    'cycleId',
    'scope',
    'domainContract',
    'sourceArtifactIds',
    'evidenceRefIds',
    'sourceRevisions',
    'collections',
  ]);
  const draftFields = new Set(['snapshotId', 'stateId', 'timestamp', 'correlationId', 'eventIds']);
  const unsupportedRequest = Object.keys(request).filter((key) => !requestFields.has(key));
  const unsupportedDraft = Object.keys(draft).filter((key) => !draftFields.has(key));
  if (
    unsupportedRequest.length > 0 ||
    unsupportedDraft.length > 0 ||
    typeof request.cycleId !== 'string' ||
    request.cycleId.length === 0 ||
    typeof draft.snapshotId !== 'string' ||
    draft.snapshotId.length === 0 ||
    typeof draft.stateId !== 'string' ||
    draft.stateId.length === 0 ||
    typeof draft.timestamp !== 'string' ||
    Number.isNaN(Date.parse(draft.timestamp)) ||
    typeof draft.correlationId !== 'string' ||
    draft.correlationId.length === 0 ||
    !draft.eventIds ||
    typeof draft.eventIds !== 'object' ||
    Array.isArray(draft.eventIds) ||
    Object.keys(draft.eventIds).some((key) => !['snapshot', 'state'].includes(key)) ||
    typeof draft.eventIds.snapshot !== 'string' ||
    draft.eventIds.snapshot.length === 0 ||
    typeof draft.eventIds.state !== 'string' ||
    draft.eventIds.state.length === 0 ||
    draft.eventIds.snapshot === draft.eventIds.state
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Operating state/snapshot materialization draft is incomplete or contains unsupported fields.',
    );
  }
  return {
    request: {
      cycleId: request.cycleId,
      scope: clone(request.scope),
      domainContract: clone(request.domainContract),
      sourceArtifactIds: clone(request.sourceArtifactIds),
      evidenceRefIds: clone(request.evidenceRefIds ?? []),
      sourceRevisions: clone(request.sourceRevisions ?? []),
      collections: clone(request.collections),
    },
    draft: {
      snapshotId: draft.snapshotId,
      stateId: draft.stateId,
      timestamp: draft.timestamp,
      correlationId: draft.correlationId,
      eventIds: { snapshot: draft.eventIds.snapshot, state: draft.eventIds.state },
    },
  };
}

/**
 * Atomically commits an immutable Operating Snapshot and the exact seven-
 * collection OperatingModelStateV2 it names. It is runtime-only: callers do
 * not provide Event identities, hashes, byte paths, providers, or dispatch.
 */
export function materializeOperatingStateSnapshotV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    artifactStore,
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  replayHook.assertUnused();
  const normalized = assertOperatingSnapshotMaterializationRequest(request, draft);
  const index = indexRuntimeState(initialState);
  assertOperatingSnapshotCheckpoint(index);
  const cycle = index.cycles.get(normalized.request.cycleId);
  if (
    !cycle ||
    cycle.scopeId !== normalized.request.scope?.scopeId ||
    cycle.domainId !== normalized.request.scope?.domainId ||
    cycle.domainVersion !== normalized.request.scope?.domainVersion
  ) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Snapshot materialization must bind to one existing Cycle and its immutable scope/domain.',
      {
        cycleId: normalized.request.cycleId,
      },
    );
  }
  const transaction = buildOperatingSnapshotStateTransactionV2(
    {
      scope: normalized.request.scope,
      domainContract: normalized.request.domainContract,
      sourceArtifactIds: normalized.request.sourceArtifactIds,
      evidenceRefIds: normalized.request.evidenceRefIds,
      sourceRevisions: normalized.request.sourceRevisions,
      collections: normalized.request.collections,
    },
    {
      snapshotId: normalized.draft.snapshotId,
      stateId: normalized.draft.stateId,
      timestamp: normalized.draft.timestamp,
    },
    {
      // Replaying the same runtime-issued snapshot identity must reconstruct
      // its original predecessor rather than treating itself as a new prior.
      previousSnapshots: (initialState.operatingSnapshots ?? []).filter(
        (snapshot) => snapshot.snapshotId !== normalized.draft.snapshotId,
      ),
    },
  );
  const existingSnapshot = index.operatingSnapshots.get(transaction.snapshot.snapshotId);
  if (existingSnapshot) {
    const existingState = index.operatingModelStates.get(existingSnapshot.stateId);
    try {
      assertOperatingSnapshotV2(existingSnapshot, { state: existingState });
    } catch (error) {
      throw runtimeError(
        error.code ?? 'STATE_TRANSITION_INVALID',
        'Durable operating snapshot replay state is incomplete or invalid.',
        {
          snapshotId: transaction.snapshot.snapshotId,
        },
      );
    }
    if (
      sha256Jcs(existingSnapshot) !== sha256Jcs(transaction.snapshot) ||
      sha256Jcs(existingState) !== sha256Jcs(transaction.state) ||
      normalized.draft.eventIds.snapshot !==
        index.eventReplay.get(normalized.draft.eventIds.snapshot)?.eventId ||
      normalized.draft.eventIds.state !==
        index.eventReplay.get(normalized.draft.eventIds.state)?.eventId
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'A durable operating snapshot identity was reused with a different manifest, state, or Event transaction identity.',
        {
          snapshotId: transaction.snapshot.snapshotId,
          stateId: transaction.state.stateId,
        },
      );
    }
    replayHook.assertUnused();
    return Object.freeze({
      state: clone(initialState),
      snapshot: clone(existingSnapshot),
      operatingState: clone(existingState),
      events: Object.freeze([]),
      replayed: true,
    });
  }
  if (
    index.operatingModelStates.has(transaction.state.stateId) ||
    index.eventReplay.has(normalized.draft.eventIds.snapshot) ||
    index.eventReplay.has(normalized.draft.eventIds.state)
  ) {
    throw runtimeError(
      'CONCURRENT_MODIFICATION',
      'Operating state/snapshot identities and Event identities must be fresh before commit.',
      {
        snapshotId: transaction.snapshot.snapshotId,
        stateId: transaction.state.stateId,
      },
    );
  }
  try {
    // Validate all durable provenance before a byte-store staging write. This
    // keeps a foreign source-cycle assertion wholly effect-free.
    assertOperatingSnapshotProvenance(index, transaction.snapshot);
    assertOperatingModelStateProvenance(index, transaction.state, {
      snapshot: transaction.snapshot,
    });
    assertOperatingSnapshotProvenance(index, transaction.snapshot, { artifactStore });
    stageOperatingModelStateProvenanceBytes(index, transaction.state, artifactStore);
  } catch (error) {
    throw runtimeError(
      error.code ?? 'STATE_TRANSITION_INVALID',
      error.message,
      error.details?.context ?? {
        snapshotId: transaction.snapshot.snapshotId,
        stateId: transaction.state.stateId,
      },
    );
  }
  const primarySource = requireAcceptedSnapshotSourceArtifact(
    index,
    transaction.snapshot.sourceArtifactIds[0],
    transaction.snapshot,
  );
  const snapshotEvent = createOperatingRuntimeEventV2(
    {
      eventId: normalized.draft.eventIds.snapshot,
      timestamp: normalized.draft.timestamp,
      cycleId: cycle.cycleId,
      type: 'snapshot.materialized',
      entityId: transaction.snapshot.snapshotId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId: primarySource.submission.acceptanceEventIds.at(-1) ?? null,
      correlationId: normalized.draft.correlationId,
      payload: transaction.snapshot,
    },
    {
      previousEvent: {
        sequence: initialState.eventHead.sequence,
        eventHash: initialState.eventHead.hash,
      },
    },
  );
  const stateEvent = createOperatingRuntimeEventV2(
    {
      eventId: normalized.draft.eventIds.state,
      timestamp: normalized.draft.timestamp,
      cycleId: cycle.cycleId,
      type: 'operating-state.materialized',
      entityId: transaction.state.stateId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId: snapshotEvent.eventId,
      correlationId: normalized.draft.correlationId,
      payload: transaction.state,
    },
    { previousEvent: snapshotEvent },
  );
  const state = reduceOperatingRuntimeEventsV2([snapshotEvent, stateEvent], {
    initialState,
    replayHook,
  });
  replayHook.assertUnused();
  return Object.freeze({
    state,
    snapshot: clone(transaction.snapshot),
    operatingState: clone(transaction.state),
    events: Object.freeze([snapshotEvent, stateEvent]),
    replayed: false,
  });
}

/** Backwards-readable spelling for the single state/snapshot transaction. */
export const materializeOperatingSnapshotV2 = materializeOperatingStateSnapshotV2;

function assertExactKeys(value, keys, subject) {
  const actual =
    value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : null;
  const expected = [...keys].sort();
  if (
    !actual ||
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      `${subject} must contain exactly its declared fields.`,
    );
  }
}

function assertRuntimeDraftString(value, field, subject) {
  if (typeof value !== 'string' || value.length === 0) {
    throw runtimeError('RESULT_CONTRACT_INVALID', `${subject} requires a runtime-issued ${field}.`);
  }
}

function intelligenceEventFreshness(index, eventIds, records, requestHash) {
  const occupiedEventIds = new Set(index.eventReplay.keys());
  const occupiedRecordIds = records.filter(({ map, id }) => map.has(id));
  const occupiedIds = eventIds.filter((eventId) => occupiedEventIds.has(eventId));
  if (occupiedRecordIds.length === 0 && occupiedIds.length === 0) return false;
  if (occupiedRecordIds.length !== records.length || occupiedIds.length !== eventIds.length) {
    throw runtimeError(
      'CONCURRENT_MODIFICATION',
      'Operating intelligence replay identity is incomplete or conflicts with a prior transaction.',
      {
        eventIds: eventIds.filter((eventId) => occupiedEventIds.has(eventId)).sort(),
        entityIds: occupiedRecordIds.map(({ id }) => id).sort(),
      },
    );
  }
  for (const eventId of eventIds) {
    if (index.eventReplay.get(eventId)?.requestHash !== requestHash) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'A runtime-issued intelligence Event identity was reused with a different exact request or draft.',
        {
          eventId,
        },
      );
    }
  }
  return true;
}

function exactExistingIntelligenceRecords(records) {
  for (const { map, id, record } of records) {
    if (sha256Jcs(map.get(id)) !== sha256Jcs(record)) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'A runtime-issued operating intelligence identity was reused with different content.',
        {
          entityId: id,
        },
      );
    }
  }
}

const INTELLIGENCE_STATE_REPLAY_GROUPS = Object.freeze([
  ['claims', 'claimId', 'claims'],
  ['metricObservations', 'observationId', 'metricObservations'],
  ['risks', 'riskId', 'risks'],
  ['assumptions', 'assumptionId', 'assumptions'],
  ['decisionRevisions', 'decisionId', 'decisions'],
]);

function replayIntelligenceStateTransition(snapshot, request) {
  const transition = {
    snapshotId: snapshot.snapshotId,
    scopeId: snapshot.scopeId,
    domainId: snapshot.domainId,
    domainVersion: snapshot.domainVersion,
  };
  for (const [group, idField] of INTELLIGENCE_STATE_REPLAY_GROUPS) {
    transition[group] = request[group]
      .map(clone)
      .sort((left, right) => left[idField].localeCompare(right[idField]));
  }
  return Object.freeze(transition);
}

/**
 * Exact replay is the sole exception to append-only identity rejection. It is
 * proven before the public lifecycle builder runs: the full Event set, durable
 * records, and canonical request hash must all already agree. A fresh Event
 * that merely repeats a byte-identical Risk or Assumption therefore cannot
 * borrow this path.
 */
function exactIntelligenceStateReplay(index, request, draft, snapshot, requestHash) {
  let existing = 0;
  let total = 0;
  const seenEventIds = new Set();
  for (const [group, idField, mapName] of INTELLIGENCE_STATE_REPLAY_GROUPS) {
    const records = request[group];
    const eventIds = draft.eventIds[group];
    if (!Array.isArray(records) || !Array.isArray(eventIds) || records.length !== eventIds.length)
      return null;
    for (let position = 0; position < eventIds.length; position += 1) {
      const eventId = eventIds[position];
      const record = records[position];
      const recordId = record?.[idField];
      if (
        typeof eventId !== 'string' ||
        eventId.length === 0 ||
        seenEventIds.has(eventId) ||
        typeof recordId !== 'string' ||
        recordId.length === 0
      )
        return null;
      seenEventIds.add(eventId);
      total += 1;
      const replay = index.eventReplay.get(eventId);
      const existingRecord = index[mapName].get(recordId);
      if (!replay && !existingRecord) continue;
      if (!replay || !existingRecord) {
        throw runtimeError(
          'CONCURRENT_MODIFICATION',
          'Operating intelligence replay identity is incomplete or conflicts with a prior transaction.',
          {
            eventIds: [eventId],
            entityIds: [recordId],
          },
        );
      }
      if (replay.requestHash !== requestHash || sha256Jcs(existingRecord) !== sha256Jcs(record)) {
        throw runtimeError(
          'STATE_TRANSITION_INVALID',
          'A runtime-issued intelligence Event identity was reused with a different exact request, draft, or record.',
          {
            eventId,
            entityId: recordId,
          },
        );
      }
      existing += 1;
    }
  }
  if (existing === 0 || total === 0) return null;
  if (existing !== total) {
    throw runtimeError(
      'CONCURRENT_MODIFICATION',
      'Operating intelligence replay identity is incomplete or conflicts with a prior transaction.',
      {
        eventIds: [...seenEventIds].filter((eventId) => index.eventReplay.has(eventId)).sort(),
      },
    );
  }
  return replayIntelligenceStateTransition(snapshot, request);
}

function intelligenceEventDraft(draft, fields, subject) {
  assertExactKeys(draft, fields, subject);
  assertRuntimeDraftString(draft?.timestamp, 'timestamp', subject);
  assertRuntimeDraftString(draft?.correlationId, 'correlationId', subject);
  if (Number.isNaN(Date.parse(draft.timestamp))) {
    throw runtimeError('RESULT_CONTRACT_INVALID', `${subject} timestamp must be ISO 8601.`);
  }
}

function intelligenceRequestHash(operation, request, draft) {
  return sha256Jcs({ protocolVersion: PROTOCOL_VERSION, operation, request, draft });
}

function runtimeEventForIntelligence(
  { eventId, timestamp, cycleId, type, entityId, causationId, correlationId, requestHash, payload },
  previousEvent,
) {
  return createOperatingRuntimeEventV2(
    {
      eventId,
      timestamp,
      cycleId,
      type,
      entityId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId,
      correlationId,
      requestHash,
      payload,
    },
    { previousEvent },
  );
}

function snapshotForRuntimeIntelligence(index, cycleId, snapshotId, stateId) {
  const snapshot = index.operatingSnapshots.get(snapshotId);
  const operatingState = snapshot ? index.operatingModelStates.get(snapshot.stateId) : null;
  const cycle = index.cycles.get(cycleId);
  if (
    !snapshot ||
    !operatingState ||
    snapshot.stateId !== stateId ||
    operatingState.stateId !== stateId ||
    !cycle ||
    !sameEvidenceBinding(snapshot, cycle)
  ) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Operating intelligence transaction requires one snapshot/state and matching Cycle scope.',
      {
        cycleId,
        snapshotId,
        stateId,
      },
    );
  }
  return { snapshot, operatingState, cycle };
}

function acceptedCausationForSnapshotSource(index, snapshot, sourceArtifactId) {
  const source = requireAcceptedSnapshotSourceArtifact(index, sourceArtifactId, snapshot);
  if (!snapshot.sourceArtifactIds.includes(sourceArtifactId)) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Operating intelligence source Artifact is not declared by the snapshot.',
      {
        snapshotId: snapshot.snapshotId,
        sourceArtifactId,
      },
    );
  }
  return source.submission.acceptanceEventIds.at(-1) ?? null;
}

/**
 * Derive and atomically record one Delta from the current snapshot and its
 * exact predecessor. The draft is runtime-owned; no provider or model is
 * consulted, and an exact retry returns the existing immutable Delta.
 */
export function deriveOperatingRuntimeDeltaV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  replayHook.assertUnused();
  assertExactKeys(request, ['cycleId', 'snapshotId', 'stateId'], 'Delta request');
  intelligenceEventDraft(
    draft,
    ['deltaId', 'eventId', 'timestamp', 'correlationId'],
    'Delta draft',
  );
  assertRuntimeDraftString(request?.cycleId, 'cycleId', 'Delta request');
  assertRuntimeDraftString(request?.snapshotId, 'snapshotId', 'Delta request');
  assertRuntimeDraftString(request?.stateId, 'stateId', 'Delta request');
  assertRuntimeDraftString(draft.deltaId, 'deltaId', 'Delta draft');
  assertRuntimeDraftString(draft.eventId, 'eventId', 'Delta draft');
  const index = indexRuntimeState(initialState);
  const { snapshot, operatingState } = snapshotForRuntimeIntelligence(
    index,
    request.cycleId,
    request.snapshotId,
    request.stateId,
  );
  const priorSnapshot =
    snapshot.previousSnapshotId === null
      ? null
      : index.operatingSnapshots.get(snapshot.previousSnapshotId);
  const priorState = priorSnapshot ? index.operatingModelStates.get(priorSnapshot.stateId) : null;
  if (snapshot.previousSnapshotId !== null && (!priorSnapshot || !priorState)) {
    throw runtimeError('STATE_TRANSITION_INVALID', 'Current snapshot predecessor is incomplete.', {
      snapshotId: snapshot.snapshotId,
    });
  }
  const sourceArtifactId = [...snapshot.sourceArtifactIds].sort()[0];
  const delta = deriveOperatingDeltaV2({
    deltaId: draft.deltaId,
    currentSnapshot: snapshot,
    currentState: operatingState,
    priorSnapshot,
    priorState,
    evidenceRefs: [...index.evidenceRefs.values()],
    evidenceArtifacts: [...index.artifacts.values()],
    claims: [...index.claims.values()],
    metricObservations: [...index.metricObservations.values()],
    priorMetricObservations: [...index.metricObservations.values()],
    risks: [...index.risks.values()],
    assumptions: [...index.assumptions.values()],
    decisions: [...index.decisions.values()],
    outcomes: [...index.outcomes.values()],
    learnings: [...index.learnings.values()],
    sourceArtifactId,
    derivedAt: draft.timestamp,
  });
  const records = [{ map: index.deltas, id: delta.deltaId, record: delta }];
  const requestHash = intelligenceRequestHash('derive-operating-runtime-delta-v2', request, draft);
  if (intelligenceEventFreshness(index, [draft.eventId], records, requestHash)) {
    exactExistingIntelligenceRecords(records);
    replayHook.assertUnused();
    return Object.freeze({
      state: clone(initialState),
      delta: clone(index.deltas.get(delta.deltaId)),
      events: Object.freeze([]),
      replayed: true,
      materiality: classifyOperatingDeltaMaterialityV2(index.deltas.get(delta.deltaId)),
    });
  }
  const event = runtimeEventForIntelligence(
    {
      eventId: draft.eventId,
      timestamp: draft.timestamp,
      cycleId: request.cycleId,
      type: 'delta.derived',
      entityId: delta.deltaId,
      causationId: acceptedCausationForSnapshotSource(index, snapshot, sourceArtifactId),
      correlationId: draft.correlationId,
      requestHash,
      payload: { snapshotId: snapshot.snapshotId, stateId: operatingState.stateId, record: delta },
    },
    initialState.eventHead.sequence === 0
      ? null
      : { sequence: initialState.eventHead.sequence, eventHash: initialState.eventHead.hash },
  );
  const state = reduceOperatingRuntimeEventsV2([event], { initialState, replayHook });
  replayHook.assertUnused();
  return Object.freeze({
    state,
    delta: clone(delta),
    events: Object.freeze([event]),
    replayed: false,
    materiality: classifyOperatingDeltaMaterialityV2(delta),
  });
}

function materializePreparedOperatingIntelligenceInputBundleV2(
  capture,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    artifactStore,
    replayHook = createNoModelReplayHookV2(),
    stageArtifact = true,
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  assertExactKeys(draft, ['timestamp', 'correlationId'], 'Intelligence-bundle draft');
  if (
    !artifactStore ||
    typeof artifactStore.readRaw !== 'function' ||
    typeof artifactStore.stageRaw !== 'function'
  ) {
    throw runtimeError(
      'ARTIFACT_NOT_FOUND',
      'Intelligence-bundle materialization requires the exact runtime Artifact byte store.',
    );
  }
  assertRuntimeDraftString(draft.timestamp, 'timestamp', 'Intelligence-bundle draft');
  assertRuntimeDraftString(draft.correlationId, 'correlationId', 'Intelligence-bundle draft');
  const built = capture;
  const ids = deriveOperatingIntelligenceBundleCustodyIdsV2(built?.bundle);
  if (
    !built ||
    sha256Jcs(ids) !== sha256Jcs(built.custodyIds) ||
    built.bundle.createdAt !== draft.timestamp ||
    built.rawHash !== `sha256:${createHash('sha256').update(built.rawBytes).digest('hex')}` ||
    built.canonicalHash !== sha256Jcs(built.bundle)
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Prepared intelligence bundle bytes or runtime custody identities were altered.',
    );
  }
  try {
    assertProtocolArtifact('operating-intelligence-input-bundle', built.bundle, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch (cause) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Intelligence-bundle materialization requires one runtime-built contract-valid bundle.',
      {
        cause: cause?.code ?? null,
      },
    );
  }
  const index = indexRuntimeState(initialState);
  const { snapshot, cycle } = snapshotForRuntimeIntelligence(
    index,
    built.bundle.cycleId,
    built.bundle.snapshotId,
    built.bundle.operatingState.sourceStateId,
  );
  const delta = index.deltas.get(built.bundle.deltaId);
  if (
    !delta ||
    delta.currentSnapshotId !== snapshot.snapshotId ||
    !sameEvidenceBinding(delta, snapshot)
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Intelligence-bundle materialization requires the exact recorded Delta.',
    );
  }
  const inputArtifactIds = [
    ...new Set([...built.bundle.sourceArtifactIds, ...built.evidenceArtifactIds]),
  ].sort();
  const assignment = {
    kind: 'operating-assignment',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    assignmentId: ids.assignmentId,
    cycleId: cycle.cycleId,
    assignmentKind: 'context-capture',
    roleId: 'operate-intelligence-bundle',
    objective: 'Materialize the exact bounded runtime intelligence input bundle.',
    state: 'pending',
    dependsOn: [],
    dependencyPolicy: { kind: 'none' },
    inputArtifactIds,
    inputAbsences: [],
    intelligenceContext: null,
    outputContract: {
      schemaId: 'operating-intelligence-input-bundle',
      schemaVersion: PROTOCOL_VERSION,
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: built.rawBytes.byteLength,
    },
    capabilityGrantId: null,
    attemptPolicy: { maxAttempts: 1, attempt: 0, timeoutMs: 300000 },
    claim: null,
    terminalOutcome: null,
    createdAt: draft.timestamp,
    availableAt: null,
    completedAt: null,
  };
  assertProtocolArtifact('operating-assignment', assignment, { protocolVersion: PROTOCOL_VERSION });
  const actor = { actorId: 'openplanr', kind: 'agent', runtime: 'openplanr' };
  const submitRequest = {
    assignmentId: ids.assignmentId,
    submissionId: ids.submissionId,
    actor,
    mediaType: 'application/json',
    encoding: 'utf-8',
    contentBase64: built.rawBytes.toString('base64'),
  };
  const acceptanceDraft = {
    artifactId: ids.artifactId,
    artifactType: 'intelligence-input-bundle',
    storageClass: 'machine-local',
    sensitivity: 'internal',
    retentionClass: 'project',
    inputArtifactIds,
    timestamp: draft.timestamp,
    validatorVersion: PROTOCOL_VERSION,
    eventIds: {
      submitted: ids.submittedEventId,
      artifactCreated: ids.artifactEventId,
      validated: ids.validatedEventId,
    },
    correlationId: draft.correlationId,
  };

  const existingAssignment = index.assignments.get(ids.assignmentId);
  if (existingAssignment) {
    const accepted = acceptOperatingAssignmentSubmissionV2(submitRequest, acceptanceDraft, {
      initialState,
      replayHook,
    });
    const artifact = accepted.artifact;
    if (
      artifact.schemaId !== 'operating-intelligence-input-bundle' ||
      artifact.canonicalHash !== built.canonicalHash ||
      artifact.rawHash !== built.rawHash
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Retained intelligence bundle differs from the exact recomputed runtime bytes.',
        {
          bundleId: built.bundle.bundleId,
        },
      );
    }
    readOperatingArtifactRawBytesV2(artifactStore, {
      artifactId: artifact.artifactId,
      rawHash: artifact.rawHash,
    });
    return Object.freeze({
      state: clone(initialState),
      bundle: clone(built.bundle),
      artifact: clone(artifact),
      assignment: clone(existingAssignment),
      events: Object.freeze([]),
      replayed: true,
      rawBytes: Buffer.from(built.rawBytes),
    });
  }

  const previous =
    initialState.eventHead.sequence === 0
      ? null
      : {
          sequence: initialState.eventHead.sequence,
          eventHash: initialState.eventHead.hash,
        };
  const created = createOperatingRuntimeEventV2(
    {
      eventId: ids.creationEventId,
      timestamp: draft.timestamp,
      cycleId: cycle.cycleId,
      type: 'assignment.created',
      entityId: assignment.assignmentId,
      actor: { kind: 'runtime', id: 'openplanr' },
      causationId: acceptedCausationForSnapshotSource(index, snapshot, delta.sourceArtifactId),
      correlationId: draft.correlationId,
      payload: assignment,
    },
    { previousEvent: previous },
  );
  const createdTransaction = scheduleOperatingRuntimeEventsV2([created], {
    initialState,
    replayHook,
  });
  const claimed = claimOperatingAssignmentV2(
    { assignmentId: assignment.assignmentId, actor },
    {
      claimId: ids.claimId,
      submissionId: ids.submissionId,
      eventIds: { claimed: ids.claimedEventId, started: ids.startedEventId },
      timestamp: draft.timestamp,
      correlationId: draft.correlationId,
    },
    {
      initialState: createdTransaction.state,
      capabilities: ['operate.assignment.claim'],
      replayHook,
    },
  );
  const accepted = acceptOperatingAssignmentSubmissionV2(submitRequest, acceptanceDraft, {
    initialState: claimed.state,
    replayHook,
  });
  if (
    accepted.artifact.rawHash !== built.rawHash ||
    accepted.artifact.canonicalHash !== built.canonicalHash
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Accepted intelligence bundle Artifact lost its exact canonical byte binding.',
    );
  }
  if (stageArtifact)
    artifactStore.stageRaw({ artifact: accepted.artifact, rawBytes: built.rawBytes });
  return Object.freeze({
    state: accepted.state,
    bundle: clone(built.bundle),
    artifact: clone(accepted.artifact),
    assignment: clone(
      accepted.state.assignments.find(({ assignmentId }) => assignmentId === ids.assignmentId),
    ),
    events: Object.freeze([...createdTransaction.events, ...claimed.events, ...accepted.events]),
    replayed: false,
    rawBytes: Buffer.from(built.rawBytes),
  });
}

/**
 * Atomically capture one runtime-owned role-scoped intelligence bundle. The
 * caller selects only a registry role; plan, Assignment, bundle, and Artifact
 * identities remain deterministic runtime derivations.
 */
export function materializeOperatingIntelligenceInputBundleV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    artifactStore,
    authorizeEvidence = () => true,
    replayHook = createNoModelReplayHookV2(),
    stageArtifact = true,
  } = {},
) {
  assertExactKeys(
    request,
    [
      'cycleId',
      'snapshotId',
      'stateId',
      'deltaId',
      'focus',
      'domainDescriptor',
      'decisionOwnerActorId',
      'roleId',
    ],
    'Intelligence-bundle request',
  );
  const index = indexRuntimeState(initialState);
  const { snapshot, operatingState, cycle } = snapshotForRuntimeIntelligence(
    index,
    request.cycleId,
    request.snapshotId,
    request.stateId,
  );
  const delta = index.deltas.get(request.deltaId);
  const board = planOperatingIntelligenceBoardV2(
    {
      cycleId: cycle.cycleId,
      delta,
      snapshot,
      operatingState,
      evidenceRefs: [...index.evidenceRefs.values()],
      evidenceArtifacts: [...index.artifacts.values()],
      focus: request.focus,
      domainDescriptor: request.domainDescriptor,
      decisionOwnerActorId: request.decisionOwnerActorId,
      createdAt: draft.timestamp,
    },
    { authorizeEvidence },
  );
  const capture = board.bundleCaptures.find(
    ({ bundle }) => bundle.assignmentBinding.roleId === request.roleId,
  );
  if (!capture) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Requested role is not selected by the deterministic intelligence board.',
      {
        roleId: request.roleId,
      },
    );
  }
  return materializePreparedOperatingIntelligenceInputBundleV2(capture, draft, {
    initialState,
    artifactStore,
    replayHook,
    stageArtifact,
  });
}

/**
 * Record one pure intelligence plan and its ordinary Assignment graph, then
 * let the canonical scheduler release only dependency-ready work. No role,
 * model, tool, provider, policy, or external target is invoked here.
 */
export function planOperatingRuntimeIntelligenceBoardV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    artifactStore,
    authorizeEvidence = () => true,
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  replayHook.assertUnused();
  assertExactKeys(
    request,
    [
      'cycleId',
      'snapshotId',
      'stateId',
      'deltaId',
      'focus',
      'domainDescriptor',
      'decisionOwnerActorId',
    ],
    'Intelligence-board request',
  );
  intelligenceEventDraft(
    draft,
    ['eventId', 'timestamp', 'correlationId'],
    'Intelligence-board draft',
  );
  for (const field of ['cycleId', 'snapshotId', 'stateId', 'deltaId']) {
    assertRuntimeDraftString(request?.[field], field, 'Intelligence-board request');
  }
  assertRuntimeDraftString(
    request.decisionOwnerActorId,
    'decisionOwnerActorId',
    'Intelligence-board request',
  );
  assertRuntimeDraftString(draft.eventId, 'eventId', 'Intelligence-board draft');
  const initialIndex = indexRuntimeState(initialState);
  const initialBinding = snapshotForRuntimeIntelligence(
    initialIndex,
    request.cycleId,
    request.snapshotId,
    request.stateId,
  );
  const {
    snapshot: initialSnapshot,
    operatingState: initialOperatingState,
    cycle: initialCycle,
  } = initialBinding;
  const initialDelta = initialIndex.deltas.get(request.deltaId);
  if (
    !initialDelta ||
    initialDelta.currentSnapshotId !== initialSnapshot.snapshotId ||
    !sameEvidenceBinding(initialDelta, initialSnapshot)
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Intelligence-board planning requires one recorded Delta for the exact immutable snapshot.',
      {
        deltaId: request.deltaId,
        snapshotId: request.snapshotId,
      },
    );
  }
  const requestHash = intelligenceRequestHash(
    'plan-operating-runtime-intelligence-board-v2',
    request,
    draft,
  );
  const replayedPlanEvent = initialIndex.eventReplay.get(draft.eventId);
  if (replayedPlanEvent) {
    const replayedPlan = initialIndex.intelligencePlans.get(replayedPlanEvent.entityId);
    if (
      replayedPlanEvent.type !== 'intelligence.plan-recorded' ||
      replayedPlanEvent.requestHash !== requestHash ||
      !replayedPlan ||
      replayedPlanEvent.payloadHash !== sha256Jcs(replayedPlan) ||
      replayedPlan.snapshotId !== initialSnapshot.snapshotId ||
      replayedPlan.deltaId !== initialDelta.deltaId
    ) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Intelligence-board replay Event was reused with different exact routing inputs.',
        {
          eventId: draft.eventId,
        },
      );
    }
    const assignments = replayedPlan.selectedRoles.map(({ roleId, roleVersion }) =>
      initialIndex.assignments.get(
        deriveOperatingIntelligenceAssignmentIdV2(replayedPlan.planId, roleId, roleVersion),
      ),
    );
    if (assignments.some((assignment) => !assignment)) {
      throw runtimeError(
        'CONCURRENT_MODIFICATION',
        'Intelligence-board replay is missing a canonical role Assignment.',
        {
          planId: replayedPlan.planId,
        },
      );
    }
    validateOperatingIntelligenceAssignmentGraphV2(replayedPlan, assignments, {
      allowLifecycleProgress: true,
      canonicalContext: { cycle: initialCycle, snapshot: initialSnapshot },
    });
    for (const assignment of assignments) {
      const bundleArtifactId = assignment.intelligenceContext.inputBundle.bundleArtifactId;
      const { output: bundle } = decodedLedgerRoleOutput(
        initialIndex,
        bundleArtifactId,
        artifactStore,
        'Intelligence input bundle',
      );
      if (
        bundle.assignmentBinding.assignmentId !== assignment.assignmentId ||
        bundle.bundleId !== assignment.intelligenceContext.inputBundle.bundleId ||
        bundle.snapshotId !== assignment.intelligenceContext.snapshotId
      ) {
        throw runtimeError(
          'STATE_TRANSITION_INVALID',
          'Intelligence-board replay bundle differs from its exact role Assignment.',
          {
            assignmentId: assignment.assignmentId,
            bundleArtifactId,
          },
        );
      }
      const baseAssignment = {
        ...clone(assignment),
        inputArtifactIds: [
          bundleArtifactId,
          ...bundle.assignmentBinding.issuedEvidence.map(
            ({ evidenceArtifactId }) => evidenceArtifactId,
          ),
        ].sort(),
        inputAbsences: clone(bundle.assignmentBinding.evidenceAbsences),
      };
      let dependencyProofs = [];
      if (assignment.state !== 'pending') {
        dependencyProofs = [...assignment.dependsOn].sort().map((dependencyId) => {
          const dependency = initialIndex.assignments.get(dependencyId);
          if (!dependency) {
            throw runtimeError(
              'STATE_TRANSITION_INVALID',
              'Intelligence-board replay lost one declared dependency Assignment.',
              {
                assignmentId: assignment.assignmentId,
                dependencyId,
              },
            );
          }
          if (dependency.state === 'validated') {
            const submissions = [...initialIndex.submissions.values()].filter(
              (submission) =>
                submission.assignmentId === dependency.assignmentId &&
                submission.state === 'accepted' &&
                typeof submission.artifactId === 'string',
            );
            const submission = submissions.length === 1 ? submissions[0] : null;
            const artifact = submission ? initialIndex.artifacts.get(submission.artifactId) : null;
            const replay = submission ? initialIndex.replay.get(submission.submissionId) : null;
            if (!submission || !artifact || !replay) {
              throw runtimeError(
                'STATE_TRANSITION_INVALID',
                'Intelligence-board replay lost exact validated dependency custody.',
                {
                  assignmentId: assignment.assignmentId,
                  dependencyId,
                },
              );
            }
            try {
              return assertOperatingValidatedDependencyProofV2({
                assignment: dependency,
                submission,
                artifact,
                replay,
              });
            } catch (error) {
              throw runtimeError(
                'STATE_TRANSITION_INVALID',
                error.message,
                error.details?.context ?? {
                  assignmentId: assignment.assignmentId,
                  dependencyId,
                },
              );
            }
          }
          if (
            ['abandoned', 'failed'].includes(dependency.state) &&
            dependency.terminalOutcome?.outcome === dependency.state
          ) {
            return {
              assignmentId: dependency.assignmentId,
              outcome: dependency.state,
              eventId: dependency.terminalOutcome.eventId,
              absence: {
                code: dependency.terminalOutcome.code,
                reason: dependency.terminalOutcome.reason,
                recoveryDisposition: dependency.terminalOutcome.recoveryDisposition,
              },
            };
          }
          throw runtimeError(
            'STATE_TRANSITION_INVALID',
            'A progressed intelligence Assignment has an unresolved dependency.',
            {
              assignmentId: assignment.assignmentId,
              dependencyId,
              dependencyState: dependency.state,
            },
          );
        });
      }
      const expectedInputArtifactIds =
        assignment.state === 'pending'
          ? baseAssignment.inputArtifactIds
          : resolveOperatingAssignmentInputArtifactIdsV2(baseAssignment, dependencyProofs);
      const expectedInputAbsences =
        assignment.state === 'pending'
          ? baseAssignment.inputAbsences
          : resolveOperatingAssignmentInputAbsencesV2(baseAssignment, {
              dependencyProofs,
              assignments,
              intelligencePlans: [replayedPlan],
            });
      if (
        sha256Jcs(assignment.inputArtifactIds) !== sha256Jcs(expectedInputArtifactIds) ||
        sha256Jcs(assignment.inputAbsences) !== sha256Jcs(expectedInputAbsences)
      ) {
        throw runtimeError(
          'STATE_TRANSITION_INVALID',
          'Intelligence-board replay Assignment inputs differ from exact bundle and dependency custody.',
          {
            assignmentId: assignment.assignmentId,
          },
        );
      }
    }
    replayHook.assertUnused();
    return Object.freeze({
      state: clone(initialState),
      plan: clone(replayedPlan),
      assignments: Object.freeze(assignments.map(clone)),
      events: Object.freeze([]),
      releaseEvents: Object.freeze([]),
      replayed: true,
    });
  }
  const board = planOperatingIntelligenceBoardV2(
    {
      cycleId: initialCycle.cycleId,
      delta: initialDelta,
      snapshot: initialSnapshot,
      operatingState: initialOperatingState,
      evidenceRefs: [...initialIndex.evidenceRefs.values()],
      evidenceArtifacts: [...initialIndex.artifacts.values()],
      focus: request.focus,
      domainDescriptor: request.domainDescriptor,
      decisionOwnerActorId: request.decisionOwnerActorId,
      createdAt: draft.timestamp,
    },
    { authorizeEvidence },
  );
  let bundleState = initialState;
  const bundleTransactions = [];
  for (const capture of board.bundleCaptures) {
    const transaction = materializePreparedOperatingIntelligenceInputBundleV2(
      capture,
      {
        timestamp: draft.timestamp,
        correlationId: draft.correlationId,
      },
      {
        initialState: bundleState,
        artifactStore,
        replayHook,
        stageArtifact: false,
      },
    );
    bundleState = transaction.state;
    bundleTransactions.push(transaction);
  }
  const index = indexRuntimeState(bundleState);
  const { snapshot, cycle } = snapshotForRuntimeIntelligence(
    index,
    request.cycleId,
    request.snapshotId,
    request.stateId,
  );
  const creationEventIds = board.assignments.map(({ assignmentId }) =>
    intelligenceAssignmentCreationEventId(board.plan.planId, assignmentId),
  );
  if (exactIntelligenceBoardReplay(index, draft.eventId, creationEventIds, board, requestHash)) {
    replayHook.assertUnused();
    return Object.freeze({
      state: clone(bundleState),
      plan: clone(index.intelligencePlans.get(board.plan.planId)),
      assignments: Object.freeze(
        board.assignments.map(({ assignmentId }) => clone(index.assignments.get(assignmentId))),
      ),
      events: Object.freeze([]),
      releaseEvents: Object.freeze([]),
      replayed: true,
    });
  }
  acceptedCausationForSnapshotSource(index, snapshot, board.plan.sourceArtifactId);
  let previousEvent =
    bundleState.eventHead.sequence === 0
      ? null
      : { sequence: bundleState.eventHead.sequence, eventHash: bundleState.eventHead.hash };
  const planEvent = runtimeEventForIntelligence(
    {
      eventId: draft.eventId,
      timestamp: draft.timestamp,
      cycleId: cycle.cycleId,
      type: 'intelligence.plan-recorded',
      entityId: board.plan.planId,
      causationId: acceptedCausationForSnapshotSource(index, snapshot, board.plan.sourceArtifactId),
      correlationId: draft.correlationId,
      requestHash,
      payload: board.plan,
    },
    previousEvent,
  );
  previousEvent = planEvent;
  const assignmentEvents = board.assignments.map((assignment, position) => {
    const event = runtimeEventForIntelligence(
      {
        eventId: creationEventIds[position],
        timestamp: draft.timestamp,
        cycleId: cycle.cycleId,
        type: 'assignment.created',
        entityId: assignment.assignmentId,
        causationId: planEvent.eventId,
        correlationId: draft.correlationId,
        requestHash,
        payload: assignment,
      },
      previousEvent,
    );
    previousEvent = event;
    return event;
  });
  const scheduled = scheduleOperatingRuntimeEventsV2([planEvent, ...assignmentEvents], {
    initialState: bundleState,
    replayHook,
  });
  for (const transaction of bundleTransactions.filter(({ replayed }) => !replayed)) {
    artifactStore.stageRaw({ artifact: transaction.artifact, rawBytes: transaction.rawBytes });
  }
  replayHook.assertUnused();
  return Object.freeze({
    state: scheduled.state,
    plan: clone(board.plan),
    assignments: Object.freeze(
      board.assignments.map(({ assignmentId }) =>
        clone(
          scheduled.state.assignments.find(
            (assignment) => assignment.assignmentId === assignmentId,
          ),
        ),
      ),
    ),
    events: Object.freeze([
      ...bundleTransactions.flatMap(({ events }) => events),
      ...scheduled.events,
    ]),
    releaseEvents: scheduled.releaseEvents,
    replayed: false,
  });
}

/**
 * Materialize one challenged Chair ledger from already accepted role Artifacts.
 * The runtime reads exact bytes solely to prove their immutable identities,
 * then commits only safe typed ledger/Decision records. It never dispatches a
 * model, grants authority, creates an Action, or performs an external effect.
 */
export function materializeOperatingDecisionLedgerV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    artifactStore,
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  replayHook.assertUnused();
  assertExactKeys(
    request,
    [
      'cycleId',
      'snapshotId',
      'stateId',
      'intelligencePlanId',
      'advisorArtifactIds',
      'challengerArtifactId',
      'chairArtifactId',
    ],
    'Decision-ledger request',
  );
  intelligenceEventDraft(
    draft,
    [
      'eventId',
      'claimEventIds',
      'riskEventIds',
      'findingEventIds',
      'decisionEventIds',
      'timestamp',
      'correlationId',
    ],
    'Decision-ledger draft',
  );
  for (const field of [
    'cycleId',
    'snapshotId',
    'stateId',
    'intelligencePlanId',
    'chairArtifactId',
  ]) {
    assertRuntimeDraftString(request?.[field], field, 'Decision-ledger request');
  }
  if (
    !Array.isArray(request.advisorArtifactIds) ||
    request.advisorArtifactIds.some(
      (artifactId) => typeof artifactId !== 'string' || artifactId.length === 0,
    ) ||
    new Set(request.advisorArtifactIds).size !== request.advisorArtifactIds.length ||
    (request.challengerArtifactId !== null &&
      (typeof request.challengerArtifactId !== 'string' ||
        request.challengerArtifactId.length === 0)) ||
    !['claimEventIds', 'riskEventIds', 'findingEventIds', 'decisionEventIds'].every(
      (field) =>
        Array.isArray(draft[field]) &&
        draft[field].every((eventId) => typeof eventId === 'string' && eventId.length > 0) &&
        new Set(draft[field]).size === draft[field].length,
    )
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Decision-ledger request and runtime Event identities must be explicit and unique.',
    );
  }
  assertRuntimeDraftString(draft.eventId, 'eventId', 'Decision-ledger draft');
  const index = indexRuntimeState(initialState);
  const { snapshot, operatingState, cycle } = snapshotForRuntimeIntelligence(
    index,
    request.cycleId,
    request.snapshotId,
    request.stateId,
  );
  const chairArtifact = index.artifacts.get(request.chairArtifactId);
  if (!chairArtifact)
    throw runtimeError(
      'ARTIFACT_NOT_FOUND',
      'Decision-ledger request references an unknown Chair Artifact.',
      {
        artifactId: request.chairArtifactId,
      },
    );
  const chairOutput = decodedLedgerRoleOutput(
    index,
    chairArtifact.artifactId,
    artifactStore,
    'Chair result',
  );
  const ledger = chairOutput.output;
  const plan = index.intelligencePlans.get(request.intelligencePlanId);
  try {
    assertProtocolArtifact('operating-decision-ledger', ledger, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch (error) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Chair result must be one valid operating-decision-ledger.',
      {
        artifactId: chairArtifact.artifactId,
        cause: error.code ?? null,
      },
    );
  }
  if (
    ledger.intelligencePlanId !== request.intelligencePlanId ||
    ledger.snapshotId !== snapshot.snapshotId ||
    ledger.sourceArtifactId !== plan?.sourceArtifactId ||
    !sameEvidenceBinding(ledger, snapshot) ||
    !sameCanonicalStringSet(ledger.advisorArtifactIds, request.advisorArtifactIds) ||
    ledger.challengerArtifactId !== request.challengerArtifactId
  ) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Decision-ledger request must exactly match the immutable Chair result binding.',
      {
        ledgerId: ledger.ledgerId,
      },
    );
  }
  if (
    !plan ||
    plan.snapshotId !== snapshot.snapshotId ||
    plan.scopeId !== cycle.scopeId ||
    plan.domainId !== cycle.domainId ||
    plan.domainVersion !== cycle.domainVersion
  ) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Decision-ledger request requires the recorded plan for its exact Cycle and snapshot.',
      {
        intelligencePlanId: request.intelligencePlanId,
      },
    );
  }
  const materialization = buildRuntimeDecisionLedgerMaterialization(
    index,
    ledger,
    draft.timestamp,
    artifactStore,
  );
  const persistedLedger = materialization.ledger;
  const eventGroups = [
    ['claims', 'claimEventIds'],
    ['risks', 'riskEventIds'],
    ['findings', 'findingEventIds'],
    ['decisions', 'decisionEventIds'],
  ];
  if (
    eventGroups.some(
      ([recordsKey, eventIdsKey]) =>
        materialization[recordsKey].length !== draft[eventIdsKey].length,
    )
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Decision-ledger runtime Event identities must exactly match every derived intelligence record.',
      {
        ledgerId: ledger.ledgerId,
      },
    );
  }
  const records = [
    { map: index.decisionLedgers, id: persistedLedger.ledgerId, record: persistedLedger },
    ...materialization.claims.map((record) => ({ map: index.claims, id: record.claimId, record })),
    ...materialization.risks.map((record) => ({ map: index.risks, id: record.riskId, record })),
    ...materialization.findings.map((record) => ({
      map: index.findings,
      id: record.findingId,
      record,
    })),
    ...materialization.decisions.map((record) => ({
      map: index.decisions,
      id: record.decisionId,
      record,
    })),
  ];
  const eventIds = [
    draft.eventId,
    ...draft.claimEventIds,
    ...draft.riskEventIds,
    ...draft.findingEventIds,
    ...draft.decisionEventIds,
  ];
  if (new Set(eventIds).size !== eventIds.length) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'One Decision-ledger transaction may not reuse an Event identity across record kinds.',
    );
  }
  const requestHash = intelligenceRequestHash(
    'materialize-operating-decision-ledger-v2',
    request,
    draft,
  );
  if (intelligenceEventFreshness(index, eventIds, records, requestHash)) {
    exactExistingIntelligenceRecords(records);
    replayHook.assertUnused();
    return Object.freeze({
      state: clone(initialState),
      ledger: clone(index.decisionLedgers.get(ledger.ledgerId)),
      claims: Object.freeze(materialization.claims.map(clone)),
      risks: Object.freeze(materialization.risks.map(clone)),
      findings: Object.freeze(materialization.findings.map(clone)),
      decisions: Object.freeze(materialization.decisions.map(clone)),
      actionHypotheses: Object.freeze(materialization.actionHypotheses.map(clone)),
      events: Object.freeze([]),
      replayed: true,
    });
  }
  const chairSubmission = acceptedSubmissionForArtifact(index, chairArtifact);
  let previousEvent =
    initialState.eventHead.sequence === 0
      ? null
      : { sequence: initialState.eventHead.sequence, eventHash: initialState.eventHead.hash };
  const ledgerEvent = runtimeEventForIntelligence(
    {
      eventId: draft.eventId,
      timestamp: draft.timestamp,
      cycleId: cycle.cycleId,
      type: 'decision-ledger.materialized',
      entityId: persistedLedger.ledgerId,
      causationId: chairSubmission.acceptanceEventIds.at(-1) ?? null,
      correlationId: draft.correlationId,
      requestHash,
      payload: persistedLedger,
    },
    previousEvent,
  );
  previousEvent = ledgerEvent;
  const recordEvents = [];
  const appendRecordEvents = (recordsToRecord, ids, type, idField) => {
    for (const [position, record] of recordsToRecord.entries()) {
      const event = runtimeEventForIntelligence(
        {
          eventId: ids[position],
          timestamp: draft.timestamp,
          cycleId: cycle.cycleId,
          type,
          entityId: record[idField],
          causationId: chairSubmission.acceptanceEventIds.at(-1) ?? null,
          correlationId: draft.correlationId,
          requestHash,
          payload: { snapshotId: snapshot.snapshotId, stateId: operatingState.stateId, record },
        },
        previousEvent,
      );
      previousEvent = event;
      recordEvents.push(event);
    }
  };
  appendRecordEvents(materialization.claims, draft.claimEventIds, 'claim.recorded', 'claimId');
  appendRecordEvents(materialization.risks, draft.riskEventIds, 'risk.recorded', 'riskId');
  appendRecordEvents(
    materialization.findings,
    draft.findingEventIds,
    'finding.recorded',
    'findingId',
  );
  const decisionEvents = materialization.decisions.map((record, position) => {
    const event = runtimeEventForIntelligence(
      {
        eventId: draft.decisionEventIds[position],
        timestamp: draft.timestamp,
        cycleId: cycle.cycleId,
        type: 'decision.revised',
        entityId: record.decisionId,
        causationId: chairSubmission.acceptanceEventIds.at(-1) ?? null,
        correlationId: draft.correlationId,
        requestHash,
        payload: { snapshotId: snapshot.snapshotId, stateId: operatingState.stateId, record },
      },
      previousEvent,
    );
    previousEvent = event;
    return event;
  });
  const events = [ledgerEvent, ...recordEvents, ...decisionEvents];
  const state = reduceOperatingRuntimeEventsV2(events, {
    initialState,
    artifactStore,
    replayHook,
  });
  replayHook.assertUnused();
  return Object.freeze({
    state,
    ledger: clone(persistedLedger),
    claims: Object.freeze(materialization.claims.map(clone)),
    risks: Object.freeze(materialization.risks.map(clone)),
    findings: Object.freeze(materialization.findings.map(clone)),
    decisions: Object.freeze(materialization.decisions.map(clone)),
    actionHypotheses: Object.freeze(materialization.actionHypotheses.map(clone)),
    events: Object.freeze(events),
    replayed: false,
  });
}

/**
 * Atomically materialize every complete Action hypothesis in one already
 * byte-proven Chair ledger together with its observation-only verification
 * plan. This creates neither an Assignment nor any execution/approval/policy
 * surface; it is a durable operating-model projection only.
 */
export function materializeOperatingActionVerificationV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    artifactStore,
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  replayHook.assertUnused();
  assertExactKeys(
    request,
    ['cycleId', 'snapshotId', 'stateId', 'ledgerId'],
    'Action-verification request',
  );
  intelligenceEventDraft(
    draft,
    ['eventIds', 'timestamp', 'correlationId'],
    'Action-verification draft',
  );
  for (const field of ['cycleId', 'snapshotId', 'stateId', 'ledgerId']) {
    assertRuntimeDraftString(request?.[field], field, 'Action-verification request');
  }
  if (
    !Array.isArray(draft.eventIds) ||
    draft.eventIds.length === 0 ||
    draft.eventIds.some((eventId) => typeof eventId !== 'string' || eventId.length === 0) ||
    new Set(draft.eventIds).size !== draft.eventIds.length
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Action-verification draft requires unique runtime Event identities.',
    );
  }
  const index = indexRuntimeState(initialState);
  const { snapshot, operatingState, cycle } = snapshotForRuntimeIntelligence(
    index,
    request.cycleId,
    request.snapshotId,
    request.stateId,
  );
  const ledger = index.decisionLedgers.get(request.ledgerId);
  if (
    !ledger ||
    ledger.snapshotId !== snapshot.snapshotId ||
    !sameEvidenceBinding(ledger, snapshot)
  ) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Action verification requires the recorded Chair ledger for the exact request snapshot.',
      {
        ledgerId: request.ledgerId,
        snapshotId: request.snapshotId,
      },
    );
  }
  const ledgerMaterialization = buildRuntimeDecisionLedgerMaterialization(
    index,
    ledger,
    recordedDecisionLedgerMaterializationTimestamp(index, ledger),
    artifactStore,
  );
  let materialization;
  try {
    materialization = buildOperatingActionVerificationMaterializationV2({
      snapshot,
      operatingState,
      ledger,
      decisions: ledgerMaterialization.decisions,
      findings: ledgerMaterialization.findings,
      timestamp: draft.timestamp,
    });
  } catch (error) {
    throw runtimeError(
      error.code ?? 'RESULT_CONTRACT_INVALID',
      error.message,
      error.details?.context ?? { ledgerId: ledger.ledgerId },
    );
  }
  if (draft.eventIds.length !== materialization.verificationPlans.length) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Action-verification Event identities must exactly match complete derived verification plans.',
      {
        expected: materialization.verificationPlans.length,
        received: draft.eventIds.length,
      },
    );
  }
  const records = materialization.verificationPlans.map((plan) => ({
    map: index.verificationPlans,
    id: plan.verificationPlanId,
    record: plan,
  }));
  const actionRecords = materialization.actions.map((action) => ({
    map: index.actions,
    id: action.actionId,
    record: action,
  }));
  const requestHash = intelligenceRequestHash(
    'materialize-operating-action-verification-v2',
    request,
    draft,
  );
  if (
    intelligenceEventFreshness(index, draft.eventIds, [...records, ...actionRecords], requestHash)
  ) {
    exactExistingIntelligenceRecords([...records, ...actionRecords]);
    replayHook.assertUnused();
    return Object.freeze({
      state: clone(initialState),
      actions: Object.freeze(materialization.actions.map(clone)),
      verificationPlans: Object.freeze(materialization.verificationPlans.map(clone)),
      events: Object.freeze([]),
      replayed: true,
    });
  }
  const chairArtifact = acceptedChairArtifactForLedger(index, ledger);
  const chairSubmission = acceptedSubmissionForArtifact(index, chairArtifact);
  if (!chairArtifact || !chairSubmission || chairArtifact.cycleId !== cycle.cycleId) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Action verification must retain the exact validated Chair Artifact and source Cycle.',
      {
        ledgerId: ledger.ledgerId,
      },
    );
  }
  let previousEvent =
    initialState.eventHead.sequence === 0
      ? null
      : { sequence: initialState.eventHead.sequence, eventHash: initialState.eventHead.hash };
  const events = materialization.verificationPlans.map((plan, position) => {
    const event = runtimeEventForIntelligence(
      {
        eventId: draft.eventIds[position],
        timestamp: draft.timestamp,
        cycleId: cycle.cycleId,
        type: 'verification.plan-recorded',
        entityId: plan.verificationPlanId,
        causationId: chairSubmission.acceptanceEventIds.at(-1) ?? null,
        correlationId: draft.correlationId,
        requestHash,
        payload: plan,
      },
      previousEvent,
    );
    previousEvent = event;
    return event;
  });
  const state = reduceOperatingRuntimeEventsV2(events, { initialState, artifactStore, replayHook });
  replayHook.assertUnused();
  return Object.freeze({
    state,
    actions: Object.freeze(materialization.actions.map(clone)),
    verificationPlans: Object.freeze(materialization.verificationPlans.map(clone)),
    events: Object.freeze(events),
    replayed: false,
  });
}

/**
 * Record one metric-observed outcome and its bounded learning in a later
 * snapshot. The status is calculated from the Action's typed baseline/target;
 * no request can claim the Action was executed.
 */
export function recordOperatingActionVerificationOutcomeV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  replayHook.assertUnused();
  assertExactKeys(
    request,
    [
      'cycleId',
      'snapshotId',
      'stateId',
      'actionId',
      'verificationPlanId',
      'observationId',
      'learning',
    ],
    'Observed Action verification request',
  );
  intelligenceEventDraft(
    draft,
    ['eventIds', 'timestamp', 'correlationId'],
    'Observed Action verification draft',
  );
  for (const field of [
    'cycleId',
    'snapshotId',
    'stateId',
    'actionId',
    'verificationPlanId',
    'observationId',
  ]) {
    assertRuntimeDraftString(request?.[field], field, 'Observed Action verification request');
  }
  if (!draft.eventIds || typeof draft.eventIds !== 'object' || Array.isArray(draft.eventIds)) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Observed Action verification draft requires runtime-owned Outcome and Learning Event identities.',
    );
  }
  assertExactKeys(
    draft.eventIds,
    ['outcome', 'learning'],
    'Observed Action verification Event identities',
  );
  assertRuntimeDraftString(
    draft.eventIds.outcome,
    'outcome Event identity',
    'Observed Action verification draft',
  );
  assertRuntimeDraftString(
    draft.eventIds.learning,
    'learning Event identity',
    'Observed Action verification draft',
  );
  if (draft.eventIds.outcome === draft.eventIds.learning) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Observed Action verification Event identities must be unique.',
    );
  }
  const index = indexRuntimeState(initialState);
  const { snapshot, cycle } = snapshotForRuntimeIntelligence(
    index,
    request.cycleId,
    request.snapshotId,
    request.stateId,
  );
  const action = index.actions.get(request.actionId);
  const verificationPlan = index.verificationPlans.get(request.verificationPlanId);
  const observation = index.metricObservations.get(request.observationId);
  const sourceDecision = action ? index.decisions.get(action.sourceDecisionId) : null;
  if (
    !action ||
    !verificationPlan ||
    !observation ||
    !sourceDecision ||
    action.verificationPlanId !== verificationPlan.verificationPlanId ||
    verificationPlan.actionId !== action.actionId ||
    observation.snapshotId !== snapshot.snapshotId ||
    !sameEvidenceBinding(action, snapshot) ||
    !sameEvidenceBinding(observation, snapshot)
  ) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Observed Action verification requires one Action, plan, source Decision, and accepted observation in the exact request snapshot.',
      {
        actionId: request.actionId,
        verificationPlanId: request.verificationPlanId,
        observationId: request.observationId,
      },
    );
  }
  let records;
  try {
    records = buildOperatingActionVerificationOutcomeV2({
      action,
      verificationPlan,
      observation,
      learning: request.learning,
      timestamp: draft.timestamp,
      sourceDecision,
    });
  } catch (error) {
    throw runtimeError(
      error.code ?? 'RESULT_CONTRACT_INVALID',
      error.message,
      error.details?.context ?? {
        actionId: action.actionId,
      },
    );
  }
  const requestHash = intelligenceRequestHash(
    'record-operating-action-verification-outcome-v2',
    request,
    draft,
  );
  const replayRecords = [
    { map: index.outcomes, id: records.outcome.outcomeId, record: records.outcome },
    { map: index.learnings, id: records.learning.learningId, record: records.learning },
  ];
  if (
    intelligenceEventFreshness(
      index,
      [draft.eventIds.outcome, draft.eventIds.learning],
      replayRecords,
      requestHash,
    )
  ) {
    exactExistingIntelligenceRecords(replayRecords);
    replayHook.assertUnused();
    return Object.freeze({
      state: clone(initialState),
      outcome: clone(records.outcome),
      learning: clone(records.learning),
      events: Object.freeze([]),
      replayed: true,
    });
  }
  if (
    index.outcomes.has(records.outcome.outcomeId) ||
    index.learnings.has(records.learning.learningId) ||
    [...index.outcomes.values()].some(
      (outcome) => outcome.verificationPlanId === verificationPlan.verificationPlanId,
    )
  ) {
    throw runtimeError(
      'CONCURRENT_MODIFICATION',
      'An Action verification plan may record exactly one durable observed outcome and learning.',
      {
        verificationPlanId: verificationPlan.verificationPlanId,
      },
    );
  }
  const causationId = acceptedCausationForSnapshotSource(
    index,
    snapshot,
    observation.sourceArtifactId,
  );
  let previousEvent =
    initialState.eventHead.sequence === 0
      ? null
      : { sequence: initialState.eventHead.sequence, eventHash: initialState.eventHead.hash };
  const outcomeEvent = runtimeEventForIntelligence(
    {
      eventId: draft.eventIds.outcome,
      timestamp: draft.timestamp,
      cycleId: cycle.cycleId,
      type: 'outcome.recorded',
      entityId: records.outcome.outcomeId,
      causationId,
      correlationId: draft.correlationId,
      requestHash,
      payload: records.outcome,
    },
    previousEvent,
  );
  previousEvent = outcomeEvent;
  const learningEvent = runtimeEventForIntelligence(
    {
      eventId: draft.eventIds.learning,
      timestamp: draft.timestamp,
      cycleId: cycle.cycleId,
      type: 'learning.recorded',
      entityId: records.learning.learningId,
      causationId,
      correlationId: draft.correlationId,
      requestHash,
      payload: records.learning,
    },
    previousEvent,
  );
  const state = reduceOperatingRuntimeEventsV2([outcomeEvent, learningEvent], {
    initialState,
    replayHook,
  });
  replayHook.assertUnused();
  return Object.freeze({
    state,
    outcome: clone(records.outcome),
    learning: clone(records.learning),
    events: Object.freeze([outcomeEvent, learningEvent]),
    replayed: false,
  });
}

/**
 * Record an accepted terminal verification Assignment when no canonical metric
 * observation exists. This transaction can only produce insufficient-evidence
 * plus its paired Learning; it cannot infer success or failure from execution.
 */
export function recordOperatingTerminalVerificationInsufficientEvidenceV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    artifactStore,
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  replayHook.assertUnused();
  assertExactKeys(
    request,
    ['cycleId', 'actionId', 'verificationPlanId', 'assignmentId', 'submissionId'],
    'Terminal verification insufficient-evidence request',
  );
  intelligenceEventDraft(
    draft,
    ['eventIds', 'timestamp', 'correlationId'],
    'Terminal verification insufficient-evidence draft',
  );
  for (const field of [
    'cycleId',
    'actionId',
    'verificationPlanId',
    'assignmentId',
    'submissionId',
  ]) {
    assertRuntimeDraftString(
      request?.[field],
      field,
      'Terminal verification insufficient-evidence request',
    );
  }
  if (!draft.eventIds || typeof draft.eventIds !== 'object' || Array.isArray(draft.eventIds)) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Terminal verification insufficient-evidence draft requires runtime-owned Outcome and Learning Event identities.',
    );
  }
  assertExactKeys(
    draft.eventIds,
    ['outcome', 'learning'],
    'Terminal verification insufficient-evidence Event identities',
  );
  assertRuntimeDraftString(
    draft.eventIds.outcome,
    'outcome Event identity',
    'Terminal verification insufficient-evidence draft',
  );
  assertRuntimeDraftString(
    draft.eventIds.learning,
    'learning Event identity',
    'Terminal verification insufficient-evidence draft',
  );
  if (draft.eventIds.outcome === draft.eventIds.learning) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Terminal verification insufficient-evidence Event identities must be unique.',
    );
  }
  const index = indexRuntimeState(initialState);
  const assignment = index.assignments.get(request.assignmentId);
  const action = index.actions.get(request.actionId);
  const verificationPlan = index.verificationPlans.get(request.verificationPlanId);
  const submission = index.submissions.get(request.submissionId);
  const artifact = submission ? index.artifacts.get(submission.artifactId) : null;
  const cycle = index.cycles.get(request.cycleId);
  if (
    !assignment ||
    !action ||
    !verificationPlan ||
    !submission ||
    !artifact ||
    !cycle ||
    submission.assignmentId !== assignment.assignmentId ||
    assignment.cycleId !== cycle.cycleId ||
    action.sourceCycleId !== cycle.cycleId ||
    action.verificationPlanId !== verificationPlan.verificationPlanId ||
    verificationPlan.actionId !== action.actionId ||
    !sameOperatingScope(action, cycle) ||
    !sameOperatingScope(action, verificationPlan)
  ) {
    throw runtimeError(
      'OPERATING_SCOPE_INVALID',
      'Terminal verification insufficient-evidence request must bind one exact Cycle, Action, plan, Assignment, Submission, and Artifact.',
      {
        cycleId: request.cycleId,
        actionId: request.actionId,
        verificationPlanId: request.verificationPlanId,
        assignmentId: request.assignmentId,
        submissionId: request.submissionId,
      },
    );
  }
  const records = buildOperatingTerminalVerificationInsufficientEvidenceV2({
    action,
    verificationPlan,
    assignment,
    sourceArtifactId: artifact.artifactId,
    timestamp: draft.timestamp,
  });
  terminalVerificationInsufficientEvidenceSource(
    index,
    records.outcome,
    draft.timestamp,
    artifactStore,
  );
  const requestHash = intelligenceRequestHash(
    'record-operating-terminal-verification-insufficient-evidence-v2',
    request,
    draft,
  );
  const replayRecords = [
    { map: index.outcomes, id: records.outcome.outcomeId, record: records.outcome },
    { map: index.learnings, id: records.learning.learningId, record: records.learning },
  ];
  if (
    intelligenceEventFreshness(
      index,
      [draft.eventIds.outcome, draft.eventIds.learning],
      replayRecords,
      requestHash,
    )
  ) {
    exactExistingIntelligenceRecords(replayRecords);
    replayHook.assertUnused();
    return Object.freeze({
      state: clone(initialState),
      outcome: clone(records.outcome),
      learning: clone(records.learning),
      events: Object.freeze([]),
      replayed: true,
    });
  }
  if (
    index.outcomes.has(records.outcome.outcomeId) ||
    index.learnings.has(records.learning.learningId) ||
    [...index.outcomes.values()].some(
      (candidate) => candidate.verificationPlanId === verificationPlan.verificationPlanId,
    )
  ) {
    throw runtimeError(
      'CONCURRENT_MODIFICATION',
      'An Action verification plan may record exactly one durable Outcome and Learning.',
      {
        verificationPlanId: verificationPlan.verificationPlanId,
      },
    );
  }
  const causationId = submission.acceptanceEventIds.at(-1) ?? null;
  let previousEvent =
    initialState.eventHead.sequence === 0
      ? null
      : { sequence: initialState.eventHead.sequence, eventHash: initialState.eventHead.hash };
  const outcomeEvent = runtimeEventForIntelligence(
    {
      eventId: draft.eventIds.outcome,
      timestamp: draft.timestamp,
      cycleId: cycle.cycleId,
      type: 'outcome.recorded',
      entityId: records.outcome.outcomeId,
      causationId,
      correlationId: draft.correlationId,
      requestHash,
      payload: records.outcome,
    },
    previousEvent,
  );
  previousEvent = outcomeEvent;
  const learningEvent = runtimeEventForIntelligence(
    {
      eventId: draft.eventIds.learning,
      timestamp: draft.timestamp,
      cycleId: cycle.cycleId,
      type: 'learning.recorded',
      entityId: records.learning.learningId,
      causationId,
      correlationId: draft.correlationId,
      requestHash,
      payload: records.learning,
    },
    previousEvent,
  );
  const state = reduceOperatingRuntimeEventsV2([outcomeEvent, learningEvent], {
    initialState,
    artifactStore,
    replayHook,
  });
  replayHook.assertUnused();
  return Object.freeze({
    state,
    outcome: clone(records.outcome),
    learning: clone(records.learning),
    events: Object.freeze([outcomeEvent, learningEvent]),
    replayed: false,
  });
}

/**
 * Close a verifying Cycle only after the exact terminal operation and accepted
 * Outcome/Learning feedback are durable. Exact Event retry is projection-only.
 */
export function closeOperatingVerifiedRuntimeCycleV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  replayHook.assertUnused();
  assertExactKeys(
    request,
    [
      'cycleId',
      'actionId',
      'operationId',
      'resultId',
      'outcomeId',
      'learningId',
      'deltaId',
      'snapshotId',
      'carriedActionIds',
    ],
    'Verified Cycle-close request',
  );
  assertExactKeys(draft, ['eventId', 'timestamp', 'correlationId'], 'Verified Cycle-close draft');
  for (const field of [
    'cycleId',
    'actionId',
    'operationId',
    'resultId',
    'outcomeId',
    'learningId',
  ]) {
    assertRuntimeDraftString(request[field], field, 'Verified Cycle-close request');
  }
  for (const field of ['eventId', 'timestamp', 'correlationId']) {
    assertRuntimeDraftString(draft[field], field, 'Verified Cycle-close draft');
  }
  if (
    (request.deltaId !== null && typeof request.deltaId !== 'string') ||
    (request.snapshotId !== null && typeof request.snapshotId !== 'string') ||
    !Array.isArray(request.carriedActionIds) ||
    new Set(request.carriedActionIds).size !== request.carriedActionIds.length
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Verified Cycle-close provenance and carry-forward identities are malformed.',
    );
  }
  const requestHash = sha256Jcs({
    operation: 'close-operating-verified-runtime-cycle-v2',
    request,
    draft,
  });
  const replayEntry = initialState.eventReplayIndex.find(
    ({ eventId }) => eventId === draft.eventId,
  );
  if (replayEntry) {
    if (
      replayEntry.type !== 'cycle.closed' ||
      replayEntry.entityId !== request.cycleId ||
      replayEntry.requestHash !== requestHash
    ) {
      throw runtimeError(
        'CONCURRENT_MODIFICATION',
        'Verified Cycle-close Event identity was reused with divergent input.',
        {
          eventId: draft.eventId,
        },
      );
    }
    replayHook.assertUnused();
    return Object.freeze({
      state: clone(initialState),
      feedback: null,
      events: Object.freeze([]),
      replayed: true,
    });
  }
  const index = indexRuntimeState(initialState);
  const cycle = index.cycles.get(request.cycleId);
  const action = index.actions.get(request.actionId);
  const operation = index.governedOperations.get(request.operationId);
  const result =
    index.executionResults.get(request.resultId) ?? index.rollbackResults.get(request.resultId);
  const plan = action ? index.verificationPlans.get(action.verificationPlanId) : null;
  const outcome = index.outcomes.get(request.outcomeId);
  const learning = index.learnings.get(request.learningId);
  const delta = request.deltaId === null ? null : index.deltas.get(request.deltaId);
  const snapshot =
    request.snapshotId === null ? null : index.operatingSnapshots.get(request.snapshotId);
  let assignment = null;
  const grant = operation ? index.capabilityGrants.get(operation.grantId) : null;
  const operationResultId = result?.resultId ?? result?.rollbackResultId ?? null;
  if (cycle && action && operation && result && plan) {
    assertOperatingActionCyclePlanOwnershipV2({ action, cycle, verificationPlan: plan, operation });
    assignment = selectCheckpointTerminalVerificationAssignmentV2({
      index,
      action,
      cycle,
      operation,
      result,
      verificationPlan: plan,
    });
  }
  if (
    !cycle ||
    cycle.state !== 'verifying' ||
    !action ||
    !operation ||
    !result ||
    !plan ||
    !outcome ||
    !learning ||
    !assignment ||
    !grant ||
    action.sourceCycleId !== cycle.cycleId ||
    operation.action.actionId !== action.actionId ||
    operation.resultId !== operationResultId ||
    operationResultId !== request.resultId ||
    outcome.actionId !== action.actionId ||
    learning.outcomeId !== outcome.outcomeId
  ) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Verified Cycle closure requires one exact terminal operation, owned Assignment, and Outcome/Learning pair.',
      {
        cycleId: request.cycleId,
        actionId: request.actionId,
        operationId: request.operationId,
      },
    );
  }
  const executionStatus =
    result.kind === 'operating-rollback-result'
      ? deriveOperatingExecutionVerificationStatusV2({ rollbackResult: result })
      : deriveOperatingExecutionVerificationStatusV2({ result });
  const feedback = deriveOperatingVerificationFeedbackV2({
    action,
    verificationPlan: plan,
    executionStatus,
    sourceCycle: cycle,
    operation,
    result,
    verificationAssignments: [...index.assignments.values()],
    outcome,
    learning,
    delta,
    snapshot,
    cycle,
  });
  closeVerifiedOperatingCycleV2({
    cycle,
    actions: [...index.actions.values()],
    verificationPlans: [...index.verificationPlans.values()],
    governedOperations: [...index.governedOperations.values()],
    executionResults: [...index.executionResults.values()],
    rollbackResults: [...index.rollbackResults.values()],
    verificationAssignments: [...index.assignments.values()],
    verificationFeedback: [feedback],
    carriedActionIds: request.carriedActionIds,
    timestamp: draft.timestamp,
  });
  const prior =
    initialState.eventHead.sequence === 0
      ? null
      : initialState.eventReplayIndex.find(
          ({ sequence }) => sequence === initialState.eventHead.sequence,
        );
  const learningEvent = initialState.eventReplayIndex.find(
    (entry) => entry.type === 'learning.recorded' && entry.entityId === learning.learningId,
  );
  const event = createOperatingRuntimeEventV2(
    {
      eventId: draft.eventId,
      timestamp: draft.timestamp,
      cycleId: cycle.cycleId,
      type: 'cycle.closed',
      entityId: cycle.cycleId,
      actor: { kind: 'engine', id: grant.issuer.id },
      causationId: learningEvent?.eventId ?? null,
      correlationId: draft.correlationId,
      requestHash,
      payload: {
        cycleId: cycle.cycleId,
        from: 'verifying',
        to: 'closed',
        actionId: action.actionId,
        operationId: operation.operationId,
        resultId: operationResultId,
        reasonCode:
          feedback.hypothesisStatus === 'confirmed'
            ? null
            : `verification-${feedback.hypothesisStatus}`,
      },
    },
    {
      previousEvent: prior ? { sequence: prior.sequence, eventHash: prior.eventHash } : null,
    },
  );
  const state = reduceOperatingRuntimeEventsV2([event], { initialState, replayHook });
  replayHook.assertUnused();
  return Object.freeze({ state, feedback, events: Object.freeze([event]), replayed: false });
}

function canonicalRuntimeIntelligenceFacts(request, draft, index) {
  assertExactKeys(
    request,
    [
      'cycleId',
      'snapshotId',
      'stateId',
      'claims',
      'metricObservations',
      'risks',
      'assumptions',
      'decisionRevisions',
    ],
    'Intelligence-state request',
  );
  intelligenceEventDraft(
    draft,
    ['timestamp', 'correlationId', 'eventIds'],
    'Intelligence-state draft',
  );
  assertRuntimeDraftString(request?.cycleId, 'cycleId', 'Intelligence-state request');
  assertRuntimeDraftString(request?.snapshotId, 'snapshotId', 'Intelligence-state request');
  assertRuntimeDraftString(request?.stateId, 'stateId', 'Intelligence-state request');
  if (!draft.eventIds || typeof draft.eventIds !== 'object' || Array.isArray(draft.eventIds)) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Intelligence-state draft requires runtime-owned Event identities.',
    );
  }
  assertExactKeys(
    draft.eventIds,
    ['claims', 'metricObservations', 'risks', 'assumptions', 'decisionRevisions'],
    'Intelligence-state Event identities',
  );
  const { snapshot, operatingState } = snapshotForRuntimeIntelligence(
    index,
    request.cycleId,
    request.snapshotId,
    request.stateId,
  );
  for (const record of Array.isArray(request.claims) ? request.claims : []) {
    assertIntelligenceEvidenceRefs(
      index,
      snapshot,
      [...record.supportingEvidenceRefIds, ...record.contradictingEvidenceRefIds],
      record.sourceArtifactId,
      { allowProducedSource: true },
    );
  }
  for (const record of Array.isArray(request.metricObservations) ? request.metricObservations : [])
    assertIntelligenceEvidenceRefs(index, snapshot, record.evidenceRefIds, record.sourceArtifactId);
  for (const record of Array.isArray(request.risks) ? request.risks : []) {
    assertIntelligenceEvidenceRefs(
      index,
      snapshot,
      record.evidenceRefIds,
      record.sourceArtifactId,
      {
        allowProducedSource: true,
      },
    );
  }
  for (const record of Array.isArray(request.assumptions) ? request.assumptions : [])
    assertIntelligenceEvidenceRefs(index, snapshot, record.evidenceRefIds, record.sourceArtifactId);
  for (const record of Array.isArray(request.decisionRevisions) ? request.decisionRevisions : [])
    assertIntelligenceEvidenceRefs(index, snapshot, record.evidenceRefIds, record.sourceArtifactId);
  const transition = buildOperatingIntelligenceStateTransitionV2({
    snapshot,
    operatingState,
    evidenceRefs: [...index.evidenceRefs.values()],
    evidenceArtifacts: [...index.artifacts.values()],
    sourceArtifacts: intelligenceProducerArtifacts(index, snapshot),
    existingDecisions: [...index.decisions.values()],
    existingActions: [...index.actions.values()],
    existingRisks: [...index.risks.values()],
    existingAssumptions: [...index.assumptions.values()],
    claims: request.claims,
    metricObservations: request.metricObservations,
    risks: request.risks,
    assumptions: request.assumptions,
    decisionRevisions: request.decisionRevisions,
  });
  const groups = [
    ['claim.recorded', 'claims', 'claimId', transition.claims, index.claims, 'createdAt'],
    [
      'metric.observed',
      'metricObservations',
      'observationId',
      transition.metricObservations,
      index.metricObservations,
      'observedAt',
    ],
    ['risk.recorded', 'risks', 'riskId', transition.risks, index.risks, 'createdAt'],
    [
      'assumption.recorded',
      'assumptions',
      'assumptionId',
      transition.assumptions,
      index.assumptions,
      'createdAt',
    ],
    [
      'decision.revised',
      'decisionRevisions',
      'decisionId',
      transition.decisionRevisions,
      index.decisions,
      'createdAt',
    ],
  ];
  const entries = [];
  for (const [type, group, idField, records, map, timestampField] of groups) {
    const eventIds = draft.eventIds[group];
    if (
      !Array.isArray(eventIds) ||
      eventIds.length !== records.length ||
      eventIds.some((eventId) => typeof eventId !== 'string' || eventId.length === 0) ||
      new Set(eventIds).size !== eventIds.length
    ) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Intelligence-state Event identities must exactly match canonical fact records.',
        { group },
      );
    }
    records.forEach((record, position) => {
      const isLifecycleRevision = ['risks', 'assumptions'].includes(group) && record.revision > 1;
      if (
        (isLifecycleRevision ? record.updatedAt : record[timestampField]) !== draft.timestamp ||
        (['risks', 'assumptions', 'decisionRevisions'].includes(group) &&
          record.updatedAt !== draft.timestamp)
      ) {
        throw runtimeError(
          'STATE_TRANSITION_INVALID',
          'Intelligence facts must use the runtime Event timestamp.',
          { entityId: record[idField] },
        );
      }
      entries.push({ type, eventId: eventIds[position], id: record[idField], record, map });
    });
  }
  if (new Set(entries.map(({ eventId }) => eventId)).size !== entries.length) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Intelligence-state Event identities must be unique across fact kinds.',
    );
  }
  return { snapshot, transition, entries };
}

/**
 * Atomically append typed claims, immutable observations, risk/assumption
 * lifecycle records, and Decision revisions. Existing records are never
 * overwritten; exact event/record retry is effect-free.
 */
export function recordOperatingIntelligenceStateV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  replayHook.assertUnused();
  const index = indexRuntimeState(initialState);
  // Resolve the immutable binding and exact replay identity before invoking
  // the lifecycle builder. This keeps replay tied to its existing Event IDs,
  // rather than treating an identical fresh Risk/Assumption as idempotent.
  assertExactKeys(
    request,
    [
      'cycleId',
      'snapshotId',
      'stateId',
      'claims',
      'metricObservations',
      'risks',
      'assumptions',
      'decisionRevisions',
    ],
    'Intelligence-state request',
  );
  intelligenceEventDraft(
    draft,
    ['timestamp', 'correlationId', 'eventIds'],
    'Intelligence-state draft',
  );
  assertRuntimeDraftString(request?.cycleId, 'cycleId', 'Intelligence-state request');
  assertRuntimeDraftString(request?.snapshotId, 'snapshotId', 'Intelligence-state request');
  assertRuntimeDraftString(request?.stateId, 'stateId', 'Intelligence-state request');
  if (!draft.eventIds || typeof draft.eventIds !== 'object' || Array.isArray(draft.eventIds)) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Intelligence-state draft requires runtime-owned Event identities.',
    );
  }
  assertExactKeys(
    draft.eventIds,
    ['claims', 'metricObservations', 'risks', 'assumptions', 'decisionRevisions'],
    'Intelligence-state Event identities',
  );
  const replaySnapshot = snapshotForRuntimeIntelligence(
    index,
    request.cycleId,
    request.snapshotId,
    request.stateId,
  ).snapshot;
  const replayRequestHash = intelligenceRequestHash(
    'record-operating-intelligence-state-v2',
    request,
    draft,
  );
  const replayTransition = exactIntelligenceStateReplay(
    index,
    request,
    draft,
    replaySnapshot,
    replayRequestHash,
  );
  if (replayTransition) {
    replayHook.assertUnused();
    return Object.freeze({
      state: clone(initialState),
      transition: replayTransition,
      events: Object.freeze([]),
      replayed: true,
    });
  }
  const { snapshot, transition, entries } = canonicalRuntimeIntelligenceFacts(
    request,
    draft,
    index,
  );
  const records = entries.map(({ map, id, record }) => ({ map, id, record }));
  const eventIds = entries.map(({ eventId }) => eventId);
  const requestHash = intelligenceRequestHash(
    'record-operating-intelligence-state-v2',
    request,
    draft,
  );
  if (intelligenceEventFreshness(index, eventIds, records, requestHash)) {
    exactExistingIntelligenceRecords(records);
    replayHook.assertUnused();
    return Object.freeze({
      state: clone(initialState),
      transition,
      events: Object.freeze([]),
      replayed: true,
    });
  }
  let previousEvent =
    initialState.eventHead.sequence === 0
      ? null
      : { sequence: initialState.eventHead.sequence, eventHash: initialState.eventHead.hash };
  const events = entries.map(({ type, eventId, id, record }) => {
    const event = runtimeEventForIntelligence(
      {
        eventId,
        timestamp: draft.timestamp,
        cycleId: request.cycleId,
        type,
        entityId: id,
        causationId: acceptedCausationForSnapshotSource(index, snapshot, record.sourceArtifactId),
        correlationId: draft.correlationId,
        requestHash,
        payload: { snapshotId: snapshot.snapshotId, stateId: snapshot.stateId, record },
      },
      previousEvent,
    );
    previousEvent = event;
    return event;
  });
  const state = reduceOperatingRuntimeEventsV2(events, { initialState, replayHook });
  replayHook.assertUnused();
  return Object.freeze({ state, transition, events: Object.freeze(events), replayed: false });
}

function canonicalRuntimeTriggerScenario(request, draft, index) {
  assertExactKeys(
    request,
    ['cycleId', 'snapshotId', 'stateId', 'scenarios', 'triggers'],
    'Scenario/trigger request',
  );
  intelligenceEventDraft(
    draft,
    ['timestamp', 'correlationId', 'eventIds'],
    'Scenario/trigger draft',
  );
  assertRuntimeDraftString(request?.cycleId, 'cycleId', 'Scenario/trigger request');
  assertRuntimeDraftString(request?.snapshotId, 'snapshotId', 'Scenario/trigger request');
  assertRuntimeDraftString(request?.stateId, 'stateId', 'Scenario/trigger request');
  if (!draft.eventIds || typeof draft.eventIds !== 'object' || Array.isArray(draft.eventIds)) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Scenario/trigger draft requires runtime-owned Event identities.',
    );
  }
  assertExactKeys(draft.eventIds, ['scenarios', 'triggers'], 'Scenario/trigger Event identities');
  const { snapshot, operatingState } = snapshotForRuntimeIntelligence(
    index,
    request.cycleId,
    request.snapshotId,
    request.stateId,
  );
  for (const record of Array.isArray(request.scenarios) ? request.scenarios : []) {
    assertIntelligenceEvidenceRefs(index, snapshot, record.evidenceRefIds, record.sourceArtifactId);
    assertIntelligenceEvidenceRefs(
      index,
      snapshot,
      record.base.evidenceRefIds,
      record.base.sourceArtifactId,
    );
    assertIntelligenceEvidenceRefs(
      index,
      snapshot,
      record.upside.evidenceRefIds,
      record.upside.sourceArtifactId,
    );
    assertIntelligenceEvidenceRefs(
      index,
      snapshot,
      record.downside.evidenceRefIds,
      record.downside.sourceArtifactId,
    );
  }
  for (const record of Array.isArray(request.triggers) ? request.triggers : [])
    assertIntelligenceEvidenceRefs(index, snapshot, record.evidenceRefIds, record.sourceArtifactId);
  const transition = buildOperatingTriggerScenarioTransitionV2({
    snapshot,
    operatingState,
    evidenceRefs: [...index.evidenceRefs.values()],
    evidenceArtifacts: [...index.artifacts.values()],
    scenarios: request.scenarios,
    triggers: request.triggers,
  });
  const groups = [
    ['scenario.recorded', 'scenarios', 'scenarioId', transition.scenarios, index.scenarios],
    ['trigger.recorded', 'triggers', 'triggerId', transition.triggers, index.eventTriggers],
  ];
  const entries = [];
  for (const [type, group, idField, records, map] of groups) {
    const eventIds = draft.eventIds[group];
    if (
      !Array.isArray(eventIds) ||
      eventIds.length !== records.length ||
      eventIds.some((eventId) => typeof eventId !== 'string' || eventId.length === 0) ||
      new Set(eventIds).size !== eventIds.length
    ) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Scenario/trigger Event identities must exactly match canonical records.',
        { group },
      );
    }
    records.forEach((record, position) => {
      if (record.createdAt !== draft.timestamp) {
        throw runtimeError(
          'STATE_TRANSITION_INVALID',
          'Scenario/trigger records must use the runtime Event timestamp.',
          { entityId: record[idField] },
        );
      }
      entries.push({ type, eventId: eventIds[position], id: record[idField], record, map });
    });
  }
  if (new Set(entries.map(({ eventId }) => eventId)).size !== entries.length) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Scenario/trigger Event identities must be unique across record kinds.',
    );
  }
  return { snapshot, transition, entries };
}

/** Record immutable analytical scenarios and normal-work trigger requests; no work is started or authorized. */
export function recordOperatingTriggerScenarioV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  replayHook.assertUnused();
  const index = indexRuntimeState(initialState);
  const { snapshot, transition, entries } = canonicalRuntimeTriggerScenario(request, draft, index);
  const records = entries.map(({ map, id, record }) => ({ map, id, record }));
  const eventIds = entries.map(({ eventId }) => eventId);
  const requestHash = intelligenceRequestHash(
    'record-operating-trigger-scenario-v2',
    request,
    draft,
  );
  if (intelligenceEventFreshness(index, eventIds, records, requestHash)) {
    exactExistingIntelligenceRecords(records);
    replayHook.assertUnused();
    return Object.freeze({
      state: clone(initialState),
      transition,
      events: Object.freeze([]),
      replayed: true,
    });
  }
  let previousEvent =
    initialState.eventHead.sequence === 0
      ? null
      : { sequence: initialState.eventHead.sequence, eventHash: initialState.eventHead.hash };
  const events = entries.map(({ type, eventId, id, record }) => {
    const event = runtimeEventForIntelligence(
      {
        eventId,
        timestamp: draft.timestamp,
        cycleId: request.cycleId,
        type,
        entityId: id,
        causationId: acceptedCausationForSnapshotSource(index, snapshot, record.sourceArtifactId),
        correlationId: draft.correlationId,
        requestHash,
        payload: { snapshotId: snapshot.snapshotId, stateId: snapshot.stateId, record },
      },
      previousEvent,
    );
    previousEvent = event;
    return event;
  });
  const state = reduceOperatingRuntimeEventsV2(events, { initialState, replayHook });
  replayHook.assertUnused();
  return Object.freeze({ state, transition, events: Object.freeze(events), replayed: false });
}

const OPERATE_ARTIFACT_SOURCE_CONTRACTS_V2 = Object.freeze(
  new Map([
    [
      'cycle-evidence:operating-context-capture@2.0.0',
      Object.freeze({ id: 'context-manifest', version: '1.0.0' }),
    ],
    [
      'cycle-context-evidence:operating-context-capture@2.0.0',
      Object.freeze({ id: 'context-manifest', version: '1.0.0' }),
    ],
    [
      'chair-result:operating-decision-ledger@2.0.0',
      Object.freeze({ id: 'prior-decisions', version: '1.0.0' }),
    ],
    [
      'planning-delivery-evidence:operating-delivery-evidence@1.0.0',
      Object.freeze({ id: 'planning-acceptance', version: '1.0.0' }),
    ],
  ]),
);

function sourceContractForAcceptedOperateArtifactV2(
  artifact,
  assignment,
  artifactStore,
  liveEvidenceCustody,
) {
  const fixed = OPERATE_ARTIFACT_SOURCE_CONTRACTS_V2.get(
    `${artifact.artifactType}:${artifact.schemaId}@${artifact.artifactSchemaVersion}`,
  );
  if (fixed) return fixed;
  if (
    artifact.artifactType !== 'live-evidence-ingestion' ||
    artifact.schemaId !== 'operating-live-evidence-ingestion' ||
    artifact.artifactSchemaVersion !== PROTOCOL_VERSION
  )
    return null;
  const rawBytes = readOperatingArtifactRawBytesV2(artifactStore, {
    artifactId: artifact.artifactId,
    rawHash: artifact.rawHash,
  });
  let ingestion;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
    if (!Buffer.from(text, 'utf8').equals(rawBytes)) throw new Error('non-canonical UTF-8');
    ingestion = JSON.parse(text);
    assertProtocolArtifact('operating-live-evidence-ingestion', ingestion, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch (cause) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Accepted live-evidence Artifact bytes do not satisfy their declared ingestion contract.',
      {
        artifactId: artifact.artifactId,
        cause: cause?.code ?? cause?.message ?? 'invalid-ingestion',
      },
    );
  }
  if (
    artifact.canonicalHash !== sha256Jcs(ingestion) ||
    ingestion.submission.artifactId !== artifact.artifactId ||
    ingestion.assignment.assignmentId !== artifact.assignmentId
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Accepted live-evidence Artifact changed canonical Assignment or Artifact custody.',
      {
        artifactId: artifact.artifactId,
      },
    );
  }
  if (
    !liveEvidenceCustody ||
    typeof liveEvidenceCustody !== 'object' ||
    Array.isArray(liveEvidenceCustody)
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Accepted live-evidence source eligibility requires its exact semantic custody bundle.',
      {
        artifactId: artifact.artifactId,
      },
    );
  }
  const { issuedAssignment, ...sourceCustody } = liveEvidenceCustody;
  try {
    assertProtocolArtifact('operating-assignment', issuedAssignment, {
      protocolVersion: PROTOCOL_VERSION,
    });
    const currentAsIssued = {
      ...clone(assignment),
      state: issuedAssignment.state,
      completedAt: issuedAssignment.completedAt,
    };
    if (
      issuedAssignment.state !== 'running' ||
      assignment.state !== 'validated' ||
      sha256Jcs(currentAsIssued) !== sha256Jcs(issuedAssignment)
    ) {
      throw runtimeError(
        'RESULT_CONTRACT_INVALID',
        'Accepted live-evidence Assignment lifecycle changed immutable custody.',
        {
          assignmentId: assignment.assignmentId,
        },
      );
    }
    assertAcceptedLiveEvidenceSourceV2(ingestion, {
      ...sourceCustody,
      assignment: issuedAssignment,
      artifact,
    });
  } catch (cause) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Accepted live-evidence source failed semantic Assignment/provider custody.',
      {
        artifactId: artifact.artifactId,
        cause: cause?.code ?? cause?.message ?? 'invalid-live-evidence-custody',
      },
    );
  }
  return ingestion.sourceContract;
}

function acceptedOperateArtifactEvidenceSources(
  index,
  artifactStore,
  liveEvidenceCustodyByArtifactId,
) {
  return [...index.artifacts.values()]
    .map((artifact) => {
      const assignment = index.assignments.get(artifact.assignmentId);
      const accepted = [...index.submissions.values()].some(
        (submission) =>
          submission.assignmentId === artifact.assignmentId &&
          submission.artifactId === artifact.artifactId &&
          submission.state === 'accepted' &&
          submission.rawHash === artifact.rawHash &&
          submission.canonicalHash === artifact.canonicalHash,
      );
      if (!accepted || assignment?.state !== 'validated') return null;
      const sourceContract = sourceContractForAcceptedOperateArtifactV2(
        artifact,
        assignment,
        artifactStore,
        liveEvidenceCustodyByArtifactId?.[artifact.artifactId],
      );
      return accepted && assignment?.state === 'validated' && sourceContract
        ? {
            accepted: true,
            artifact: clone(artifact),
            sourceContract: clone(sourceContract),
            access: { requiredCapabilities: ['evidence.operate-artifact.read'] },
          }
        : null;
    })
    .filter(Boolean);
}

/**
 * Resolves one validated candidate from an accepted v2 result Artifact. The
 * runtime owns all durable identities and commits the snapshot Artifact,
 * EvidenceRef, outcome Event, replay index, and local proof edges together.
 * This is deliberately not a normal-agent tool and never calls a model.
 */
export function materializeOperatingEvidenceV2(
  request,
  draft,
  {
    initialState = createEmptyOperatingRuntimeStateV2(),
    registry,
    artifactStore,
    liveEvidenceCustodyByArtifactId = {},
    resolverContext = {},
    replayHook = createNoModelReplayHookV2(),
  } = {},
) {
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    !request.candidate ||
    typeof request.candidate !== 'object' ||
    Array.isArray(request.candidate) ||
    (request.claimLinks !== undefined && !Array.isArray(request.claimLinks))
  ) {
    throw runtimeError(
      'RESULT_CONTRACT_INVALID',
      'Evidence materialization requires a typed candidate and optional claim-link proposals.',
    );
  }
  assertProtocolArtifact('operating-runtime-state', initialState, {
    protocolVersion: PROTOCOL_VERSION,
  });
  replayHook.assertUnused();
  const index = indexRuntimeState(initialState);
  const requestHash = deriveOperatingEvidenceRequestHashV2({
    candidate: request.candidate,
    claimLinks: request.claimLinks,
    draft,
  });
  const existing = index.evidenceReplay.get(draft.resolutionId);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'An evidence resolution identity was reused with different caller-visible candidate, claim links, or runtime-owned identities.',
        {
          resolutionId: draft.resolutionId,
        },
      );
    }
    const resolution = index.evidenceResolutions.get(existing.resolutionId);
    const evidenceRef =
      existing.evidenceRefId === null ? null : index.evidenceRefs.get(existing.evidenceRefId);
    const evidenceArtifact =
      existing.evidenceArtifactId === null
        ? null
        : index.artifacts.get(existing.evidenceArtifactId);
    if (!resolution || (existing.outcome === 'resolved' && (!evidenceRef || !evidenceArtifact))) {
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'The durable evidence replay result is incomplete or inconsistent.',
        {
          resolutionId: existing.resolutionId,
        },
      );
    }
    replayHook.assertUnused();
    return Object.freeze({
      state: clone(initialState),
      events: Object.freeze([]),
      resolution: clone(resolution),
      evidenceRef: evidenceRef === null ? null : clone(evidenceRef),
      evidenceArtifact: evidenceArtifact === null ? null : clone(evidenceArtifact),
      edges: Object.freeze(
        existing.evidenceRefId === null
          ? []
          : [...index.evidenceEdges.values()]
              .filter((edge) => edge.evidenceRefId === existing.evidenceRefId)
              .map(clone)
              .sort((left, right) => left.edgeId.localeCompare(right.edgeId)),
      ),
      replayed: true,
    });
  }
  if (!registry || typeof registry !== 'object') {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Evidence materialization requires the explicit registered resolver registry.',
    );
  }
  const source = acceptedEvidenceSource(index, request.candidate.sourceArtifactId);
  const declared = validateOperatingEvidenceSourcePayloadV2({
    sourceArtifact: source.artifact,
    artifactStore,
    candidate: request.candidate,
    claimLinks: request.claimLinks,
  });
  const materialization = buildOperatingEvidenceMaterializationV2({
    candidate: declared.candidate,
    sourceArtifact: source.artifact,
    inputBinding: source.inputBinding,
    registry,
    resolverContext: {
      ...resolverContext,
      operateArtifacts: acceptedOperateArtifactEvidenceSources(
        index,
        artifactStore,
        liveEvidenceCustodyByArtifactId,
      ),
    },
    draft,
    claimLinks: declared.claimLinks,
  });
  if (materialization.requestHash !== requestHash) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'Validated evidence payload verification changed the replay request identity.',
    );
  }
  if (index.evidenceCandidateIds.has(materialization.resolution.candidateId)) {
    throw runtimeError(
      'STATE_TRANSITION_INVALID',
      'A source-Artifact-local candidate already has a different evidence resolution identity.',
      {
        candidateId: materialization.resolution.candidateId,
      },
    );
  }
  if (materialization.outcome === 'resolved') {
    if (
      index.evidenceRefs.has(materialization.evidenceRef.evidenceRefId) ||
      index.artifacts.has(materialization.evidenceArtifact.artifactId)
    ) {
      throw runtimeError(
        'CONCURRENT_MODIFICATION',
        'Runtime-owned EvidenceRef or evidence-snapshot Artifact identity already exists.',
        {
          resolutionId: materialization.resolution.resolutionId,
        },
      );
    }
  }
  const causationId = source.submission.acceptanceEventIds.at(-1) ?? null;
  const event =
    materialization.outcome === 'resolved'
      ? createOperatingRuntimeEventV2(
          {
            eventId: draft.eventId,
            timestamp: materialization.resolution.resolvedAt,
            cycleId: source.artifact.cycleId,
            type: 'evidence.resolved',
            entityId: materialization.evidenceRef.evidenceRefId,
            actor: { kind: 'runtime', id: 'openplanr' },
            causationId,
            correlationId: draft.correlationId,
            payload: {
              resolution: materialization.resolution,
              evidenceRef: materialization.evidenceRef,
              evidenceArtifact: materialization.evidenceArtifact,
              edges: materialization.edges,
              requestHash: materialization.requestHash,
              outcomeHash: materialization.outcomeHash,
            },
          },
          {
            previousEvent: {
              sequence: initialState.eventHead.sequence,
              eventHash: initialState.eventHead.hash,
            },
          },
        )
      : createOperatingRuntimeEventV2(
          {
            eventId: draft.eventId,
            timestamp: materialization.resolution.resolvedAt,
            cycleId: source.artifact.cycleId,
            type: 'evidence.rejected',
            entityId: materialization.resolution.resolutionId,
            actor: { kind: 'runtime', id: 'openplanr' },
            causationId,
            correlationId: draft.correlationId,
            payload: {
              resolution: materialization.resolution,
              requestHash: materialization.requestHash,
              outcomeHash: materialization.outcomeHash,
            },
          },
          {
            previousEvent: {
              sequence: initialState.eventHead.sequence,
              eventHash: initialState.eventHead.hash,
            },
          },
        );
  const state = reduceOperatingRuntimeEventsV2([event], { initialState, replayHook });
  if (materialization.outcome === 'resolved') {
    let staged = stageOperatingEvidenceMaterializationBlobV2(materialization, artifactStore);
    if (staged === null && declared.candidate.evidenceKind === 'operate-artifact') {
      const targetArtifactId = declared.candidate.locator?.artifactId;
      if (typeof targetArtifactId === 'string') {
        const bytes = readOperatingArtifactRawBytesV2(artifactStore, {
          artifactId: targetArtifactId,
          rawHash: materialization.evidenceArtifact.rawHash,
        });
        setOperatingEvidenceMaterializationBlobV2(materialization, bytes);
        staged = stageOperatingEvidenceMaterializationBlobV2(materialization, artifactStore);
      }
    }
    if (staged !== true) {
      throw runtimeError(
        'ARTIFACT_NOT_FOUND',
        'Resolved evidence bytes are unavailable for immutable evidence-snapshot storage.',
        {
          artifactId: materialization.evidenceArtifact.artifactId,
        },
      );
    }
  }
  replayHook.assertUnused();
  return Object.freeze({
    state,
    events: Object.freeze([event]),
    resolution: clone(materialization.resolution),
    evidenceRef: materialization.evidenceRef === null ? null : clone(materialization.evidenceRef),
    evidenceArtifact:
      materialization.evidenceArtifact === null ? null : clone(materialization.evidenceArtifact),
    edges: Object.freeze(materialization.edges.map(clone)),
    replayed: false,
  });
}

export function createNoModelReplayHookV2() {
  let dispatchCount = 0;
  return Object.freeze({
    dispatch() {
      dispatchCount += 1;
      throw runtimeError(
        'STATE_TRANSITION_INVALID',
        'Model or runtime dispatch is forbidden during deterministic replay.',
        { dispatchCount },
      );
    },
    assertUnused() {
      if (dispatchCount !== 0)
        throw runtimeError(
          'STATE_TRANSITION_INVALID',
          'Replay performed a model or runtime dispatch.',
          { dispatchCount },
        );
      return true;
    },
    get dispatchCount() {
      return dispatchCount;
    },
  });
}

const { eventReplayEntry, reduceOperatingRuntimeEventsV2 } = createOperatingRuntimeEventReducerV2({
  runtimeError,
  computeEventHash: computeOperatingRuntimeEventHashV2,
  verifyEventChain: verifyOperatingRuntimeEventChainV2,
  indexRuntimeState,
  transitionAssignment: transitionOperatingAssignmentV2,
  eventHandlers: Object.freeze({
    workflow: applyWorkflowRuntimeEvent,
    intelligence: applyIntelligenceRuntimeEvent,
    authority: applyAuthorityRuntimeEvent,
  }),
  materializeRuntimeState,
  createEmptyState: createEmptyOperatingRuntimeStateV2,
  createNoModelReplayHook: createNoModelReplayHookV2,
});

export { reduceOperatingRuntimeEventsV2 };
