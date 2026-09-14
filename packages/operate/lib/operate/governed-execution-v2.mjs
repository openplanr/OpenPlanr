import { PipelineError } from '@openplanr/protocol/errors';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { canonicalizeJson, sha256Jcs } from '@openplanr/protocol/canonical-json';
import { assertOperateAuthorityV2 } from './authorization-v2.mjs';
import { evaluateOperatingApprovalSetV2 } from './approvals-v2.mjs';
import {
  OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
  classifyOperateExecutorRecoveryCapabilityV2,
  createContainedExecutorInputEnvelopeV2,
  createTrustedExecutorBindingV2,
  deriveContainedExecutorRequestFingerprintV2,
  selectOperateExecutorV2,
} from './governed-extensions-v2.mjs';
import {
  acceptOperatingAssignmentSubmissionV2,
  assertOperatingExecuteOperationV2,
  assertOperatingExecutionResultSemanticsV2,
  createOperatingExecutionReceiptProofV2,
  createOperatingRuntimeEventV2,
  findOperatingExactActionOperationOwnerV2,
  OPERATING_EXECUTION_EFFECT_SUMMARIES_V2,
  reduceOperatingRuntimeEventsV2,
  resolveOperatingLatestActionEvaluationV2,
  scheduleOperatingRuntimeEventsV2,
} from './runtime-foundation.mjs';
import {
  createOpenReferenceCapabilityAvailabilityV2,
  resolveOpenReferenceExecutorHostV2,
} from './reference-governed-executors-v2.mjs';
import {
  reconcileOperatingGovernedDispatchV2,
} from './governed-recovery-v2.mjs';
import { buildOperatingExecutionLifecycleV2 } from './execution-verification-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';
const DEFAULT_RUNTIME_VERSION = '0.44.0';
const EXECUTE_TOOL_CAPABILITY = Object.freeze({ id: 'operate-action-execute', version: PROTOCOL_VERSION });
const TERMINAL_OPERATION_STATES = new Set(['succeeded', 'failed', 'partial', 'uncertain', 'blocked']);

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', {
    retryable: false,
    context: structuredClone(context),
  });
}

function provenTerminalError(error, context = {}) {
  if (error?.details?.context?.provenTerminal === true) return error;
  const inherited = error?.details && typeof error.details === 'object'
    ? structuredClone(error.details)
    : {};
  const inheritedContext = inherited.context && typeof inherited.context === 'object'
    ? inherited.context
    : {};
  return new PipelineError(
    typeof error?.code === 'string' ? error.code : 'OPERATION_UNCERTAIN',
    error?.message ?? 'Execution terminalization failed after the exact contained effect was proved.',
    error?.fix ?? '',
    {
      ...inherited,
      retryable: false,
      context: {
        ...inheritedContext,
        ...structuredClone(context),
        cause: error?.code ?? error?.name ?? 'post-proof-terminalization-error',
        provenTerminal: true,
        recoveryDisposition: 'commit-proven-result-before-retry',
      },
    },
  );
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function without(record, field) {
  const result = clone(record);
  delete result[field];
  return result;
}

function exactPlainRecord(value, fields) {
  return snapshotExactDataRecord(value, fields) !== null;
}

function snapshotExactDataRecord(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return null;
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((field) => typeof field !== 'string')) return null;
  const actual = ownKeys.sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])) return null;
  const snapshot = {};
  for (const field of expected) {
    const descriptor = descriptors[field];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

function explicitTime(value, field) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed)) fail('RESULT_CONTRACT_INVALID', `${field} must be an explicit RFC 3339 timestamp.`, { field });
  return parsed;
}

function assertExecutionRequest(request) {
  if (!exactPlainRecord(request, ['actionId', 'payload', 'rollbackBaseline'])
    || typeof request.actionId !== 'string'
    || !exactPlainRecord(request.payload, ['artifactId', 'contentHash', 'value'])
    || (request.rollbackBaseline !== null
      && !exactPlainRecord(request.rollbackBaseline, ['artifactId', 'contentHash', 'value']))) {
    fail('RESULT_CONTRACT_INVALID', 'Governed execution requires one closed Action, payload, and explicit rollback-baseline request.');
  }
  if (request.payload.contentHash !== sha256Jcs(request.payload.value)
    || (request.rollbackBaseline !== null
      && request.rollbackBaseline.contentHash !== sha256Jcs(request.rollbackBaseline.value))) {
    fail('OPERATION_CONFLICT', 'Governed execution payload hashes must equal their exact closed values.', {
      actionId: request.actionId,
    });
  }
  if (request.rollbackBaseline !== null
    && request.payload.artifactId === request.rollbackBaseline.artifactId) {
    fail('OPERATION_CONFLICT', 'Payload and rollback baseline must be distinct immutable Artifact identities.', {
      actionId: request.actionId,
    });
  }
  return clone(request);
}

const DRAFT_FIELDS = Object.freeze([
  'assignmentId', 'submissionId', 'operationId', 'grantId', 'resultId', 'resultArtifactId',
  'claimId', 'preparedAt', 'completedAt', 'grantExpiresAt', 'availabilityExpiresAt',
  'correlationId', 'eventIds', 'uncertainty',
]);

const EVENT_ID_FIELDS = Object.freeze([
  'assignmentCreated', 'assignmentClaimed', 'assignmentStarted', 'availabilityRecorded',
  'capabilityGranted', 'intentRecorded', 'submitted', 'artifactCreated', 'validated',
  'resultRecorded',
]);

const TERMINAL_EVENT_ID_FIELDS = Object.freeze([
  'submitted', 'artifactCreated', 'validated', 'resultRecorded',
]);

const UNCERTAINTY_FIELDS = Object.freeze([
  'resultId', 'resultArtifactId', 'submissionId', 'eventIds',
]);

function assertExecutionDraft(draft) {
  if (!exactPlainRecord(draft, DRAFT_FIELDS)
    || !exactPlainRecord(draft.eventIds, EVENT_ID_FIELDS)
    || !exactPlainRecord(draft.uncertainty, UNCERTAINTY_FIELDS)
    || !exactPlainRecord(draft.uncertainty.eventIds, TERMINAL_EVENT_ID_FIELDS)
    || DRAFT_FIELDS.filter((field) => !['eventIds', 'uncertainty'].includes(field))
      .some((field) => typeof draft[field] !== 'string' || draft[field].length === 0)
    || EVENT_ID_FIELDS.some((field) => typeof draft.eventIds[field] !== 'string' || draft.eventIds[field].length === 0)
    || UNCERTAINTY_FIELDS.filter((field) => field !== 'eventIds')
      .some((field) => typeof draft.uncertainty[field] !== 'string' || draft.uncertainty[field].length === 0)
    || TERMINAL_EVENT_ID_FIELDS.some((field) => (
      typeof draft.uncertainty.eventIds[field] !== 'string'
      || draft.uncertainty.eventIds[field].length === 0
    ))
    || new Set([
      ...Object.values(draft.eventIds),
      ...Object.values(draft.uncertainty.eventIds),
    ]).size !== EVENT_ID_FIELDS.length + TERMINAL_EVENT_ID_FIELDS.length
    || draft.resultId === draft.uncertainty.resultId
    || draft.resultArtifactId === draft.uncertainty.resultArtifactId
    || draft.submissionId === draft.uncertainty.submissionId) {
    fail('RESULT_CONTRACT_INVALID', 'Governed execution requires one complete runtime-owned identity and Event draft.');
  }
  const preparedAt = explicitTime(draft.preparedAt, 'draft.preparedAt');
  const completedAt = explicitTime(draft.completedAt, 'draft.completedAt');
  const grantExpiresAt = explicitTime(draft.grantExpiresAt, 'draft.grantExpiresAt');
  const availabilityExpiresAt = explicitTime(draft.availabilityExpiresAt, 'draft.availabilityExpiresAt');
  if (completedAt < preparedAt || grantExpiresAt <= preparedAt || availabilityExpiresAt <= preparedAt) {
    fail('RESULT_CONTRACT_INVALID', 'Execution completion and authority expiries must be causal.', {
      preparedAt: draft.preparedAt,
      completedAt: draft.completedAt,
    });
  }
  return clone(draft);
}

function actionIdentity(action) {
  return { actionId: action.actionId, revision: action.revision, actionHash: action.actionHash };
}

function sameEventHead(left, right) {
  return left?.sequence === right?.sequence && left?.hash === right?.hash;
}

async function commitCheckpoint(checkpointStore, expectedState, nextState, context) {
  if (typeof checkpointStore?.compareAndSwap !== 'function') {
    fail('RESULT_CONTRACT_INVALID', 'Governed execution requires a durable checkpoint store with compareAndSwap.');
  }
  let response;
  try {
    response = await checkpointStore.compareAndSwap(freeze({
      expectedEventHead: clone(expectedState.eventHead),
      nextState: clone(nextState),
      phase: context.phase,
      operationId: context.operationId,
      requestFingerprint: context.requestFingerprint,
    }));
  } catch (error) {
    fail('OPERATION_UNCERTAIN', 'Durable checkpoint compare-and-swap failed.', {
      operationId: context.operationId,
      phase: context.phase,
      cause: error?.code ?? error?.name ?? 'checkpoint-error',
      recoveryDisposition: 'reconcile-before-retry',
    });
  }
  const receipt = snapshotExactDataRecord(response, ['committed', 'state']);
  if (receipt === null || typeof receipt.committed !== 'boolean') {
    fail('RESULT_CONTRACT_INVALID', 'Checkpoint store returned an invalid compare-and-swap receipt.', {
      operationId: context.operationId,
      phase: context.phase,
    });
  }
  const state = reduceOperatingRuntimeEventsV2([], { initialState: receipt.state });
  if (receipt.committed) {
    if (sha256Jcs(state) !== sha256Jcs(nextState)) {
      fail('CONCURRENT_MODIFICATION', 'Checkpoint store committed bytes other than the proposed runtime state.', {
        operationId: context.operationId,
        phase: context.phase,
      });
    }
  } else if (sameEventHead(state.eventHead, expectedState.eventHead)) {
    fail('CONCURRENT_MODIFICATION', 'Checkpoint store rejected compare-and-swap without returning a newer durable state.', {
      operationId: context.operationId,
      phase: context.phase,
    });
  }
  return { committed: receipt.committed, state };
}

async function readCheckpoint(checkpointStore, currentState) {
  if (typeof checkpointStore?.readSnapshot !== 'function') {
    fail('RESULT_CONTRACT_INVALID', 'Governed execution requires a durable read-only checkpoint snapshot primitive.');
  }
  let snapshot;
  try {
    snapshot = await checkpointStore.readSnapshot();
  } catch (error) {
    fail('OPERATION_UNCERTAIN', 'Durable checkpoint refresh failed before execution.', {
      cause: error?.code ?? error?.name ?? 'checkpoint-read-error',
      recoveryDisposition: 'refresh-before-retry',
    });
  }
  const durable = reduceOperatingRuntimeEventsV2([], { initialState: snapshot });
  const sameHead = sameEventHead(durable.eventHead, currentState.eventHead);
  const currentHeadInDurable = currentState.eventHead.sequence === 0
    || durable.eventReplayIndex.some(({ sequence, eventHash }) => (
      sequence === currentState.eventHead.sequence && eventHash === currentState.eventHead.hash
    ));
  if (durable.eventHead.sequence < currentState.eventHead.sequence
    || (!sameHead && !currentHeadInDurable)
    || (sameHead && sha256Jcs(durable) !== sha256Jcs(currentState))) {
    fail('CONCURRENT_MODIFICATION', 'Durable checkpoint refresh returned a stale or forked runtime history.', {
      currentSequence: currentState.eventHead.sequence,
      durableSequence: durable.eventHead.sequence,
    });
  }
  return durable;
}

async function hasExactArtifactCustody(artifactStore, artifact, expectedBytes) {
  try {
    const value = await Promise.resolve(artifactStore.readRaw({
      artifactId: artifact.artifactId,
      rawHash: artifact.rawHash,
    }));
    if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) return false;
    return Buffer.from(value).equals(Buffer.from(expectedBytes));
  } catch {
    return false;
  }
}

async function stageAndProveArtifactCustody(artifactStore, artifact, rawBytes) {
  if (artifactStore === undefined) return true;
  try {
    await Promise.resolve(artifactStore.stageRaw({ artifact, rawBytes }));
  } catch {
    // A write-once store can make the bytes durable and then lose the write
    // acknowledgement. Exact read-back distinguishes that from no custody.
  }
  return hasExactArtifactCustody(artifactStore, artifact, rawBytes);
}

function runtimeHead(state) {
  if (state.eventHead.sequence === 0) return { previousEvent: null, causationId: null };
  const entry = state.eventReplayIndex.find(({ sequence }) => sequence === state.eventHead.sequence);
  if (!entry || entry.eventHash !== state.eventHead.hash) {
    fail('STATE_TRANSITION_INVALID', 'Runtime checkpoint Event head is incomplete.');
  }
  return {
    previousEvent: { sequence: entry.sequence, eventHash: entry.eventHash },
    causationId: entry.eventId,
  };
}

function runtimeEvent(state, input) {
  const head = runtimeHead(state);
  return createOperatingRuntimeEventV2({ ...input, causationId: head.causationId }, {
    previousEvent: head.previousEvent,
  });
}

function exactAuthority(state, action, now) {
  const evaluation = resolveOperatingLatestActionEvaluationV2({
    evaluations: state.policyEvaluations,
    action,
    configuredPolicies: state.actionPolicies,
    at: now,
  });
  if (!evaluation) fail('POLICY_EVALUATION_REJECTED', 'Approved Action has no current exact policy evaluation.', {
    actionId: action.actionId,
  });
  const actionPolicy = state.actionPolicies.find((policy) => (
    policy.policyId === evaluation.policy.policyId
    && policy.policyVersion === evaluation.policy.policyVersion
    && policy.policyHash === evaluation.policy.policyHash
  ));
  const requirements = evaluation.approvalRequirementIds.map((requirementId) => (
    state.approvalRequirements.find((requirement) => requirement.requirementId === requirementId)
  ));
  const approvals = state.approvalRecords.filter((approval) => (
    approval.evaluationId === evaluation.evaluationId
  ));
  if (!actionPolicy || requirements.some((requirement) => !requirement)) {
    fail('POLICY_EVALUATION_REJECTED', 'Current policy or approval requirement history is incomplete.', {
      actionId: action.actionId,
      evaluationId: evaluation.evaluationId,
    });
  }
  let disposition;
  try {
    disposition = evaluateOperatingApprovalSetV2({ evaluation, action, requirements, approvals, now });
  } catch (error) {
    fail(error.code ?? 'APPROVAL_INVALID', error.message, error.details?.context ?? {});
  }
  if (!disposition.complete || disposition.disposition !== 'approved') {
    fail('APPROVAL_REQUIRED', 'Only one current exactly approved Action can become an execution operation.', {
      actionId: action.actionId,
      reasonCode: disposition.reasonCode,
    });
  }
  return { evaluation, actionPolicy, requirements, approvals, disposition };
}

function buildAssignment(action, draft, inputArtifactIds) {
  return {
    kind: 'operating-assignment',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    assignmentId: draft.assignmentId,
    cycleId: action.sourceCycleId,
    assignmentKind: 'execution',
    roleId: 'operate-governed-executor',
    objective: `Execute the approved Action ${action.actionId} at most once within its governed target binding.`,
    state: 'pending',
    dependsOn: [],
    dependencyPolicy: { kind: 'none' },
    inputArtifactIds,
    inputAbsences: [],
    outputContract: {
      schemaId: 'operating-execution-result',
      schemaVersion: PROTOCOL_VERSION,
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262144,
    },
    capabilityGrantId: draft.grantId,
    governedOperationId: draft.operationId,
    attemptPolicy: { maxAttempts: 1, attempt: 0, timeoutMs: 30000 },
    claim: null,
    terminalOutcome: null,
    createdAt: draft.preparedAt,
    availableAt: null,
    completedAt: null,
  };
}

function terminalReservation(draft) {
  return {
    resultId: draft.resultId,
    resultArtifactId: draft.resultArtifactId,
    submissionId: draft.submissionId,
    eventIds: {
      submitted: draft.eventIds.submitted,
      artifactCreated: draft.eventIds.artifactCreated,
      validated: draft.eventIds.validated,
      resultRecorded: draft.eventIds.resultRecorded,
    },
    completedAt: draft.completedAt,
    correlationId: draft.correlationId,
    uncertainty: {
      resultId: draft.uncertainty.resultId,
      resultArtifactId: draft.uncertainty.resultArtifactId,
      submissionId: draft.uncertainty.submissionId,
      eventIds: clone(draft.uncertainty.eventIds),
    },
  };
}

function terminalReservationForStatus(draft, status) {
  const success = ['succeeded', 'partial'].includes(status);
  const identity = success ? draft : draft.uncertainty;
  return {
    resultId: identity.resultId,
    resultArtifactId: identity.resultArtifactId,
    submissionId: identity.submissionId,
    eventIds: success ? {
      submitted: draft.eventIds.submitted,
      artifactCreated: draft.eventIds.artifactCreated,
      validated: draft.eventIds.validated,
      resultRecorded: draft.eventIds.resultRecorded,
    } : clone(identity.eventIds),
    completedAt: draft.completedAt,
    correlationId: draft.correlationId,
  };
}

function assertTerminalReservationAvailable(state, draft) {
  const reservation = terminalReservation(draft);
  const uncertainty = reservation.uncertainty;
  const resultIds = [reservation.resultId, uncertainty.resultId];
  const artifactIds = [reservation.resultArtifactId, uncertainty.resultArtifactId];
  const submissionIds = [reservation.submissionId, uncertainty.submissionId];
  const eventIds = [...Object.values(reservation.eventIds), ...Object.values(uncertainty.eventIds)];
  if (new Set(resultIds).size !== resultIds.length
    || new Set(artifactIds).size !== artifactIds.length
    || new Set(submissionIds).size !== submissionIds.length
    || new Set(eventIds).size !== eventIds.length
    || state.executionResults.some(({ resultId }) => resultIds.includes(resultId))
    || state.artifacts.some(({ artifactId }) => artifactIds.includes(artifactId))
    || state.submissions.some(({ submissionId }) => submissionIds.includes(submissionId))
    || eventIds.some((eventId) => state.eventReplayIndex.some((entry) => entry.eventId === eventId))) {
    fail('OPERATION_CONFLICT', 'Governed execution terminal identities must be reserved before contained dispatch.', {
      operationId: draft.operationId,
      resultId: reservation.resultId,
      resultArtifactId: reservation.resultArtifactId,
      uncertaintyResultId: uncertainty.resultId,
      uncertaintyResultArtifactId: uncertainty.resultArtifactId,
    });
  }
  return reservation;
}

function assertReplayJournalIdentity(state, operation, draft) {
  const assignment = state.assignments.find(({ assignmentId }) => assignmentId === operation.assignmentId);
  const grant = state.capabilityGrants.find(({ grantId }) => grantId === operation.grantId);
  const action = state.actions.find(({ actionId }) => actionId === operation.action.actionId);
  const evaluation = state.policyEvaluations.find(({ evaluationId }) => evaluationId === operation.evaluationId);
  const requirements = evaluation?.approvalRequirementIds.map((requirementId) => (
    state.approvalRequirements.find((requirement) => requirement.requirementId === requirementId)
  )) ?? [];
  const approvals = evaluation
    ? state.approvalRecords.filter(({ evaluationId }) => evaluationId === evaluation.evaluationId)
    : [];
  const submissions = state.submissions.filter(({ assignmentId }) => assignmentId === operation.assignmentId);
  const availability = state.capabilityAvailability.filter((candidate) => (
    candidate.checkedAt === operation.createdAt
    && candidate.capability.id === operation.capability.id
    && candidate.capability.version === operation.capability.version
    && candidate.target.kind === operation.target.kind
    && candidate.target.id === operation.target.id
    && candidate.target.revision === operation.target.revision
  ));
  const exactIntent = state.eventReplayIndex.find(({ eventId }) => eventId === operation.intentEventId);
  const replayEntry = state.operationReplayIndex.find(({ operationId }) => operationId === operation.operationId);
  const reservedEventIds = replayEntry ? replayEntry.reservedTerminalEventIds : null;
  const reservedUncertaintyEventIds = replayEntry ? replayEntry.reservedUncertaintyTerminalEventIds : null;
  const successSubmission = submissions.find(({ submissionId }) => submissionId === draft.submissionId);
  const uncertaintySubmission = submissions.find(({ submissionId }) => (
    submissionId === draft.uncertainty.submissionId
  ));
  if (!assignment || !grant || submissions.length !== 2 || availability.length !== 1 || !exactIntent
    || !action || !evaluation || !replayEntry
    || draft.operationId !== operation.operationId
    || draft.assignmentId !== operation.assignmentId
    || draft.grantId !== operation.grantId
    || draft.preparedAt !== operation.createdAt
    || exactIntent.requestHash !== operation.requestFingerprint
    || exactIntent.type !== 'operation.intent-recorded'
    || exactIntent.entityId !== operation.operationId
    || exactIntent.cycleId !== assignment.cycleId
    || exactIntent.timestamp !== operation.createdAt
    || exactIntent.correlationId !== draft.correlationId
    || replayEntry.requestFingerprint !== operation.requestFingerprint
    || replayEntry.reservedResultId !== draft.resultId
    || replayEntry.reservedResultArtifactId !== draft.resultArtifactId
    || replayEntry.reservedSubmissionId !== draft.submissionId
    || replayEntry.reservedUncertaintyResultId !== draft.uncertainty.resultId
    || replayEntry.reservedUncertaintyResultArtifactId !== draft.uncertainty.resultArtifactId
    || replayEntry.reservedUncertaintySubmissionId !== draft.uncertainty.submissionId
    || replayEntry.reservedCompletedAt !== draft.completedAt
    || replayEntry.reservedCorrelationId !== draft.correlationId
    || sha256Jcs(reservedEventIds) !== sha256Jcs(terminalReservation(draft).eventIds)
    || sha256Jcs(reservedUncertaintyEventIds) !== sha256Jcs(draft.uncertainty.eventIds)
    || assignment.claim?.claimId !== draft.claimId
    || !successSubmission || !uncertaintySubmission
    || successSubmission.issuedAt !== operation.createdAt
    || uncertaintySubmission.issuedAt !== operation.createdAt
    || grant.issuedAt !== draft.preparedAt
    || grant.expiresAt !== draft.grantExpiresAt
    || availability[0].checkedAt !== draft.preparedAt
    || availability[0].expiresAt !== draft.availabilityExpiresAt) {
    fail('OPERATION_CONFLICT', 'Governed operation replay requires the exact persisted Assignment, grant, availability, intent, and submission identities.', {
      operationId: operation.operationId,
    });
  }
  const historicalOperation = TERMINAL_OPERATION_STATES.has(operation.state) ? {
    ...clone(operation),
    state: 'dispatching',
    resultId: null,
    updatedAt: operation.createdAt,
    operationHash: replayEntry.operationHash,
  } : operation;
  const authorityAction = action.state === 'approved'
    ? action
    : { ...clone(action), state: 'approved' };
  assertOperatingExecuteOperationV2({
    operation: historicalOperation,
    action: authorityAction,
    assignment,
    evaluation,
    evaluations: state.policyEvaluations,
    configuredPolicies: state.actionPolicies,
    grant,
    requirements,
    approvals,
    capabilityAvailability: availability[0],
    request: {
      payload: {
        artifactId: replayEntry.payloadArtifactId,
        contentHash: replayEntry.payloadHash,
      },
      rollbackBaseline: replayEntry.baselineArtifactId === null ? null : {
        artifactId: replayEntry.baselineArtifactId,
        contentHash: replayEntry.baselineHash,
      },
    },
    timestamp: operation.createdAt,
  });
  return { assignment, grant, successSubmission, uncertaintySubmission, replayEntry };
}

function replayResult(state, request, draft, { allowIncomplete = false } = {}) {
  const operation = state.governedOperations.find(({ operationId }) => operationId === draft.operationId);
  if (!operation) return null;
  const expectedFingerprint = deriveContainedExecutorRequestFingerprintV2({
    operation,
    payload: request.payload,
    rollbackBaseline: request.rollbackBaseline,
  });
  if (expectedFingerprint !== operation.requestFingerprint || operation.action.actionId !== request.actionId) {
    fail('OPERATION_CONFLICT', 'Governed operation identity was reused with a divergent Action or request fingerprint.', {
      operationId: operation.operationId,
    });
  }
  const terminal = TERMINAL_OPERATION_STATES.has(operation.state) && operation.resultId !== null;
  const journal = assertReplayJournalIdentity(state, operation, draft);
  if (!terminal) {
    if (allowIncomplete) return { incomplete: true, operation, journal };
    fail('OPERATION_UNCERTAIN', 'Governed operation has durable dispatch ownership but no terminal result; blind redispatch is forbidden.', {
      operationId: operation.operationId,
      state: operation.state,
      recoveryDisposition: 'reconcile-before-retry',
    });
  }
  const result = state.executionResults.find(({ resultId }) => resultId === operation.resultId);
  const artifact = result
    ? state.artifacts.find(({ artifactId }) => artifactId === result.resultArtifactId)
    : null;
  const reservation = result ? terminalReservationForStatus(draft, result.status) : null;
  const terminalSubmission = result && ['succeeded', 'partial'].includes(result.status)
    ? journal.successSubmission
    : journal.uncertaintySubmission;
  const expectedResultEventIds = result ? [
    draft.eventIds.intentRecorded,
    reservation.eventIds.submitted,
    reservation.eventIds.artifactCreated,
    reservation.eventIds.validated,
    reservation.eventIds.resultRecorded,
  ] : [];
  if (!result || !artifact || artifact.canonicalHash !== sha256Jcs(result)
    || reservation.resultId !== result.resultId
    || reservation.resultArtifactId !== result.resultArtifactId
    || draft.completedAt !== result.completedAt
    || journal.replayEntry.terminalResultId !== result.resultId
    || terminalSubmission.artifactId !== result.resultArtifactId
    || sha256Jcs(terminalSubmission.acceptanceEventIds) !== sha256Jcs(expectedResultEventIds.slice(1, 4))
    || sha256Jcs(result.eventIds) !== sha256Jcs(expectedResultEventIds)) {
    fail('RESULT_CONTRACT_INVALID', 'Terminal governed operation replay is missing its exact accepted result Artifact.', {
      operationId: operation.operationId,
      resultId: operation.resultId,
    });
  }
  return freeze({
    state: clone(state),
    operation: clone(operation),
    result: clone(result),
    artifact: clone(artifact),
    events: [],
    response: clone(state.submissionReplayIndex.find(({ artifactId }) => artifactId === artifact.artifactId)?.responseData),
    receipt: null,
    replayed: true,
    dispatchCount: 0,
    effectCount: 0,
  });
}

function buildGrant({ action, authority, availability, draft, runtimeActorId }) {
  const scopeHashes = [...new Set(authority.requirements.map(({ scopeHash }) => scopeHash))];
  if (authority.evaluation.outcome !== 'automatic' && scopeHashes.length !== 1) {
    fail('CAPABILITY_GRANT_INVALID', 'Approved authority must resolve to one exact grant scope hash.', {
      evaluationId: authority.evaluation.evaluationId,
    });
  }
  const authorityExpiries = [
    availability.expiresAt,
    ...authority.requirements.map(({ expiresAt }) => expiresAt).filter(Boolean),
    ...authority.approvals.map(({ expiresAt }) => expiresAt).filter(Boolean),
  ].map((value) => explicitTime(value, 'authority.expiresAt'));
  const grantExpiresAt = explicitTime(draft.grantExpiresAt, 'draft.grantExpiresAt');
  if (authorityExpiries.some((expiry) => grantExpiresAt > expiry)) {
    fail('CAPABILITY_GRANT_INVALID', 'The one-use runtime grant cannot outlive capability or approval authority.', {
      actionId: action.actionId,
    });
  }
  const grant = {
    kind: 'operating-capability-grant',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    grantId: draft.grantId,
    issuer: { kind: 'runtime', id: runtimeActorId },
    assignmentId: draft.assignmentId,
    action: actionIdentity(action),
    evaluationId: authority.evaluation.evaluationId,
    approvalIds: [...authority.disposition.approvalIds].sort(),
    operationId: draft.operationId,
    capability: clone(action.requestedCapability),
    target: clone(action.targetBinding),
    effectClass: action.effectClass,
    useLimit: 1,
    issuedAt: draft.preparedAt,
    expiresAt: draft.grantExpiresAt,
    consumedAt: null,
    revokedAt: null,
    scopeHash: scopeHashes[0] ?? sha256Jcs({
      action: actionIdentity(action),
      evaluationId: authority.evaluation.evaluationId,
      scopeId: action.scopeId,
      domainId: action.domainId,
      domainVersion: action.domainVersion,
    }),
  };
  grant.grantHash = sha256Jcs(grant);
  assertProtocolArtifact('operating-capability-grant', grant, { protocolVersion: PROTOCOL_VERSION });
  return grant;
}

function buildOperation({ action, authority, assignment, grant, selection, binding, request, draft }) {
  const operation = {
    kind: 'operating-governed-operation',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    operationId: draft.operationId,
    operationKind: 'execute',
    action: actionIdentity(action),
    assignmentId: assignment.assignmentId,
    requestFingerprint: `sha256:${'0'.repeat(64)}`,
    evaluationId: authority.evaluation.evaluationId,
    approvalIds: [...authority.disposition.approvalIds].sort(),
    grantId: grant.grantId,
    capability: clone(action.requestedCapability),
    target: clone(action.targetBinding),
    effectClass: action.effectClass,
    executor: {
      executorId: selection.registration.executorId,
      executorVersion: selection.registration.executorVersion,
    },
    connector: clone(binding.connector),
    preconditionArtifactIds: [...action.preconditionArtifactIds],
    inputArtifactIds: [...assignment.inputArtifactIds],
    verificationPlanId: action.verificationPlanId,
    rollbackClass: action.executionBinding.rollbackRequired ? 'reversible' : 'not-applicable',
    state: 'dispatching',
    intentEventId: draft.eventIds.intentRecorded,
    resultId: null,
    rollbackPlanId: null,
    parentOperationId: null,
    createdAt: draft.preparedAt,
    updatedAt: draft.preparedAt,
    operationHash: `sha256:${'0'.repeat(64)}`,
  };
  operation.requestFingerprint = deriveContainedExecutorRequestFingerprintV2({
    operation,
    payload: request.payload,
    rollbackBaseline: request.rollbackBaseline,
  });
  operation.operationHash = sha256Jcs(without(operation, 'operationHash'));
  assertProtocolArtifact('operating-governed-operation', operation, { protocolVersion: PROTOCOL_VERSION });
  return operation;
}

function buildAuthorityContext({ state, action, authority, availability, grant, operation, selection, binding, executorInput, draft, runtimeActorId, registry }) {
  return {
    actor: {
      actorId: runtimeActorId,
      kind: 'engine',
      capabilities: [clone(action.requestedCapability)],
    },
    capabilities: [clone(EXECUTE_TOOL_CAPABILITY)],
    now: draft.preparedAt,
    action,
    actionRequest: { action: actionIdentity(action) },
    request: { action: actionIdentity(action) },
    scope: { scopeId: action.scopeId, domainId: action.domainId, domainVersion: action.domainVersion },
    target: clone(action.targetBinding),
    dependencyActions: state.actions.filter(({ actionId }) => action.dependsOnActionIds.includes(actionId)),
    actionPolicy: authority.actionPolicy,
    actionPolicies: state.actionPolicies,
    policyEvaluation: authority.evaluation,
    approvalRequirements: authority.requirements,
    approvals: authority.approvals,
    capabilityAvailability: availability,
    grant,
    operation,
    operationHistory: state.governedOperations,
    currentPreconditionArtifactIds: [...action.preconditionArtifactIds],
    executor: selection.registration,
    governedExtensions: registry,
    trustedExecutorBinding: binding,
    executorInput,
  };
}

function buildResult({ operation, receiptProof, request, draft, reservation, eventIds, status = 'succeeded', targetBeforeHash }) {
  const provenEffect = status === 'succeeded' || status === 'partial';
  const beforeHash = receiptProof?.before?.stateHash ?? targetBeforeHash;
  const afterHash = provenEffect ? receiptProof.after.stateHash : null;
  const changed = provenEffect ? receiptProof.changed : false;
  const summaries = {
    succeeded: changed
      ? OPERATING_EXECUTION_EFFECT_SUMMARIES_V2.changed
      : OPERATING_EXECUTION_EFFECT_SUMMARIES_V2.unchanged,
    partial: OPERATING_EXECUTION_EFFECT_SUMMARIES_V2.partial,
    failed: OPERATING_EXECUTION_EFFECT_SUMMARIES_V2.failed,
    blocked: OPERATING_EXECUTION_EFFECT_SUMMARIES_V2.blocked,
    uncertain: OPERATING_EXECUTION_EFFECT_SUMMARIES_V2.uncertain,
  };
  const affectedTargetIds = ['failed', 'blocked'].includes(status) ? [] : [operation.target.id];
  const result = {
    kind: 'operating-execution-result',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    resultId: reservation.resultId,
    operationId: operation.operationId,
    operationKind: operation.operationKind,
    requestFingerprint: operation.requestFingerprint,
    action: clone(operation.action),
    assignmentId: operation.assignmentId,
    evaluationId: operation.evaluationId,
    approvalIds: clone(operation.approvalIds),
    grantId: operation.grantId,
    capability: clone(operation.capability),
    target: clone(operation.target),
    effectClass: operation.effectClass,
    executor: clone(operation.executor),
    connector: clone(operation.connector),
    status,
    targetBeforeHash: beforeHash,
    targetAfterHash: afterHash,
    baselineArtifactId: request.rollbackBaseline?.artifactId ?? null,
    baselineHash: request.rollbackBaseline?.contentHash ?? null,
    inputArtifactIds: clone(operation.inputArtifactIds),
    outputArtifactIds: [reservation.resultArtifactId],
    effectSummary: {
      changed,
      summary: summaries[status],
      affectedTargetIds,
    },
    resultArtifactId: reservation.resultArtifactId,
    verificationPlanId: operation.verificationPlanId,
    rollbackPlanId: null,
    eventIds: [...new Set(eventIds)],
    completedAt: draft.completedAt,
  };
  result.resultHash = sha256Jcs(result);
  assertProtocolArtifact('operating-execution-result', result, { protocolVersion: PROTOCOL_VERSION });
  return result;
}

function materializeTerminalResult({
  state, operation, assignment, action, draft, reservation, result, receiptProof, runtimeActorId,
}) {
  let workingState = state;
  const lifecycleEvents = [];
  const sourceActions = state.actions.filter(({ actionId }) => actionId === action.actionId);
  const sourceCycles = state.cycles.filter(({ cycleId }) => cycleId === action.sourceCycleId);
  const verificationPlans = state.verificationPlans.filter(({ verificationPlanId }) => (
    verificationPlanId === action.verificationPlanId
  ));
  const sourceAction = sourceActions[0] ?? null;
  const sourceCycle = sourceCycles[0] ?? null;
  const verificationPlan = verificationPlans[0] ?? null;
  const sameScope = (record) => record?.scopeId === action.scopeId
    && record.domainId === action.domainId
    && record.domainVersion === action.domainVersion;
  if (sourceActions.length !== 1 || sourceCycles.length !== 1 || verificationPlans.length > 1
    || !sameScope(sourceAction) || !sameScope(sourceCycle)
    || (verificationPlan && (!sameScope(verificationPlan) || verificationPlan.actionId !== action.actionId))) {
    fail('OPERATING_SCOPE_INVALID', 'Terminal lifecycle selection requires one exact Action, Cycle, and verification-plan scope and domain version.', {
      actionId: action.actionId,
      cycleId: action.sourceCycleId,
      verificationPlanId: action.verificationPlanId,
    });
  }
  let lifecycle = null;
  // Protocol v2 checkpoints created before integrated execution lifecycles did
  // not necessarily contain a verification plan or an approved Cycle. Preserve
  // their replayability while making the complete lifecycle mandatory whenever
  // all Phase 5 authority records are present.
  if (sourceAction?.state === 'approved'
    && sourceCycle?.state === 'approved'
    && verificationPlan) {
    const terminalOperation = {
      ...clone(operation),
      state: result.status,
      resultId: result.resultId,
      updatedAt: result.completedAt,
    };
    terminalOperation.operationHash = sha256Jcs(without(terminalOperation, 'operationHash'));
    lifecycle = buildOperatingExecutionLifecycleV2({
      action: sourceAction,
      cycle: sourceCycle,
      operation: terminalOperation,
      result,
      verificationPlan,
      timestamp: draft.completedAt,
    });
    const actor = { kind: 'engine', id: runtimeActorId };
    const append = (input) => {
      const event = runtimeEvent(workingState, {
        ...input,
        timestamp: draft.completedAt,
        cycleId: action.sourceCycleId,
        actor,
        correlationId: draft.correlationId,
      });
      workingState = reduceOperatingRuntimeEventsV2([event], { initialState: workingState });
      lifecycleEvents.push(event);
    };
    append({
      eventId: lifecycle.identities.eventIds.actionQueued,
      type: 'action.queued',
      entityId: action.actionId,
      payload: lifecycle.transitions.actionQueued,
    });
    append({
      eventId: lifecycle.identities.eventIds.actionStarted,
      type: 'action.started',
      entityId: action.actionId,
      payload: lifecycle.transitions.actionStarted,
    });
    append({
      eventId: lifecycle.identities.eventIds.cycleExecuting,
      type: 'cycle.executing',
      entityId: action.sourceCycleId,
      payload: lifecycle.transitions.cycleExecuting,
    });
  }
  const resultBytes = Buffer.from(canonicalizeJson(result), 'utf8');
  const claimedAssignment = workingState.assignments.find(({ assignmentId }) => (
    assignmentId === assignment.assignmentId
  ));
  if (!claimedAssignment?.claim || claimedAssignment.state !== 'running') {
    fail('ASSIGNMENT_NOT_AVAILABLE', 'Terminal result materialization requires the exact running Assignment claim.', {
      assignmentId: assignment.assignmentId,
    });
  }
  const accepted = acceptOperatingAssignmentSubmissionV2({
    assignmentId: assignment.assignmentId,
    submissionId: reservation.submissionId,
    actor: {
      actorId: claimedAssignment.claim.actorId,
      kind: claimedAssignment.claim.actorKind,
      runtime: claimedAssignment.claim.runtime,
    },
    contentBase64: resultBytes.toString('base64'),
    mediaType: 'application/json',
    encoding: 'utf-8',
  }, {
    artifactId: reservation.resultArtifactId,
    artifactType: 'operating-execution-result',
    storageClass: 'machine-local',
    sensitivity: 'internal',
    retentionClass: 'project',
    inputArtifactIds: operation.inputArtifactIds,
    timestamp: draft.completedAt,
    validatorVersion: 'operate-governed-execution-v2@1.0.0',
    eventIds: {
      submitted: reservation.eventIds.submitted,
      artifactCreated: reservation.eventIds.artifactCreated,
      validated: reservation.eventIds.validated,
    },
    correlationId: draft.correlationId,
  }, { initialState: workingState });
  const resultRecorded = runtimeEvent(accepted.state, {
    eventId: reservation.eventIds.resultRecorded,
    timestamp: draft.completedAt,
    cycleId: action.sourceCycleId,
    type: 'execution.result-recorded',
    entityId: result.resultId,
    actor: { kind: 'engine', id: runtimeActorId },
    correlationId: draft.correlationId,
    payload: { result, receipt: receiptProof },
  });
  workingState = reduceOperatingRuntimeEventsV2(
    [...accepted.events, resultRecorded],
    { initialState: workingState },
  );
  if (lifecycle) {
    const actor = { kind: 'engine', id: runtimeActorId };
    const append = (input) => {
      const event = runtimeEvent(workingState, {
        ...input,
        timestamp: draft.completedAt,
        cycleId: action.sourceCycleId,
        actor,
        correlationId: draft.correlationId,
      });
      workingState = reduceOperatingRuntimeEventsV2([event], { initialState: workingState });
      lifecycleEvents.push(event);
    };
    append({
      eventId: lifecycle.identities.eventIds.actionTerminal,
      type: lifecycle.transitions.actionTerminal.to === 'completed' ? 'action.completed' : 'action.blocked',
      entityId: action.actionId,
      payload: lifecycle.transitions.actionTerminal,
    });
    append({
      eventId: lifecycle.identities.eventIds.verificationAssignmentCreated,
      type: 'assignment.created',
      entityId: lifecycle.verificationAssignment.assignmentId,
      payload: lifecycle.verificationAssignment,
    });
    append({
      eventId: lifecycle.identities.eventIds.cycleVerifying,
      type: 'cycle.verifying',
      entityId: action.sourceCycleId,
      payload: lifecycle.transitions.cycleVerifying,
    });
  }
  const preResultLifecycleEvents = lifecycleEvents.slice(0, lifecycle ? 3 : 0);
  const postResultLifecycleEvents = lifecycleEvents.slice(lifecycle ? 3 : 0);
  return {
    accepted,
    resultRecorded,
    lifecycleEvents,
    events: [
      ...preResultLifecycleEvents,
      ...accepted.events,
      resultRecorded,
      ...postResultLifecycleEvents,
    ],
    finalState: workingState,
    resultBytes,
  };
}

/**
 * Owns one serializable journal backed by a caller-supplied durable CAS store.
 * No contained host call is reachable until dispatch ownership is committed.
 */
export function createOperatingGovernedExecutionRuntimeV2({
  initialState,
  artifactStore,
  checkpointStore,
  runtimeVersion = DEFAULT_RUNTIME_VERSION,
  runtimeActorId = 'operate-runtime-v2',
  registry = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
} = {}) {
  if (!initialState) fail('RESULT_CONTRACT_INVALID', 'Governed execution runtime requires an explicit checkpoint.');
  if (typeof checkpointStore?.compareAndSwap !== 'function') {
    fail('RESULT_CONTRACT_INVALID', 'Governed execution runtime requires an explicit durable checkpoint store.');
  }
  if (typeof checkpointStore?.readSnapshot !== 'function') {
    fail('RESULT_CONTRACT_INVALID', 'Governed execution runtime requires an explicit read-only checkpoint snapshot primitive.');
  }
  if (artifactStore !== undefined
    && (typeof artifactStore?.stageRaw !== 'function' || typeof artifactStore?.readRaw !== 'function')) {
    fail('RESULT_CONTRACT_INVALID', 'Artifact byte storage must implement exact raw staging and retrieval.');
  }
  let currentState = reduceOperatingRuntimeEventsV2([], { initialState });
  let totalDispatchCount = 0;
  const inFlight = new Map();
  const provenTerminalOperations = new Set();

  async function executeOnce(requestInput, draftInput, { trustedHost, targetAdapter } = {}) {
    const request = assertExecutionRequest(requestInput);
    const draft = assertExecutionDraft(draftInput);
    currentState = await readCheckpoint(checkpointStore, currentState);
    const replay = replayResult(currentState, request, draft, { allowIncomplete: true });
    if (replay && !replay.incomplete) return replay;
    if (replay?.incomplete && provenTerminalOperations.has(replay.operation.operationId)) {
      throw provenTerminalError(
        new PipelineError('OPERATION_UNCERTAIN', 'The contained effect is proved but terminal metadata is not yet durable.'),
        { operationId: replay.operation.operationId },
      );
    }

    async function terminalizeUncertain({ operation, assignment, action, cause }) {
      const causeCode = cause?.code ?? cause?.name ?? 'post-intent-failure';
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const durable = replayResult(currentState, request, draft, { allowIncomplete: true });
        if (durable && !durable.incomplete) {
          if (durable.result.status === 'succeeded') return durable;
          fail('OPERATION_UNCERTAIN', 'The governed operation has a durable terminal non-success result.', {
            operationId: durable.operation.operationId,
            resultId: durable.result.resultId,
            status: durable.result.status,
            cause: causeCode,
            recoveryDisposition: 'reconcile-before-retry',
          });
        }
        const durableOperation = durable?.operation ?? operation;
        const durableJournal = durable?.journal ?? assertReplayJournalIdentity(currentState, durableOperation, draft);
        const durableAssignment = durableJournal.assignment ?? assignment;
        const durableAction = currentState.actions.find(({ actionId }) => (
          actionId === durableOperation.action.actionId
        )) ?? action;
        const durableGrant = durableJournal.grant;
        const replayEntry = durableJournal.replayEntry;
        const uncertaintyReservation = terminalReservationForStatus(draft, 'uncertain');
        const result = buildResult({
          operation: durableOperation,
          receiptProof: null,
          request,
          draft,
          reservation: uncertaintyReservation,
          eventIds: [
            durableOperation.intentEventId,
            uncertaintyReservation.eventIds.submitted,
            uncertaintyReservation.eventIds.artifactCreated,
            uncertaintyReservation.eventIds.validated,
            uncertaintyReservation.eventIds.resultRecorded,
          ],
          status: 'uncertain',
          targetBeforeHash: replayEntry.targetBeforeHash,
        });
        assertOperatingExecutionResultSemanticsV2({
          result,
          operation: durableOperation,
          replayEntry,
          grant: durableGrant,
          receiptProof: null,
        });
        const terminal = materializeTerminalResult({
          state: currentState,
          operation: durableOperation,
          assignment: durableAssignment,
          action: durableAction,
          draft,
          reservation: uncertaintyReservation,
          result,
          receiptProof: null,
          runtimeActorId,
        });
        await stageAndProveArtifactCustody(
          artifactStore,
          terminal.accepted.artifact,
          terminal.resultBytes,
        );
        try {
          const terminalCommit = await commitCheckpoint(checkpointStore, currentState, terminal.finalState, {
            phase: 'terminal-result',
            operationId: durableOperation.operationId,
            requestFingerprint: durableOperation.requestFingerprint,
          });
          currentState = terminalCommit.state;
          if (!terminalCommit.committed) continue;
          fail('OPERATION_UNCERTAIN', 'A post-intent failure was atomically recorded as a terminal uncertain result.', {
            operationId: durableOperation.operationId,
            resultId: result.resultId,
            cause: causeCode,
            causeMessage: cause?.message ?? null,
            recoveryDisposition: 'reconcile-before-retry',
          });
        } catch (commitError) {
          if (commitError?.code !== 'OPERATION_UNCERTAIN'
            || commitError?.details?.context?.resultId === result.resultId) throw commitError;
          // A compare-and-swap acknowledgement can be lost after the store made
          // the state durable. Retry against the same head to recover its state.
        }
      }
      const finalReplay = replayResult(currentState, request, draft, { allowIncomplete: true });
      if (finalReplay && !finalReplay.incomplete && finalReplay.result.status === 'succeeded') return finalReplay;
      fail('OPERATION_UNCERTAIN', 'The governed operation remains non-redispatchable and requires durable reconciliation.', {
        operationId: operation.operationId,
        cause: causeCode,
        recoveryDisposition: 'reconcile-before-retry',
      });
    }

    async function commitProvenSuccess({
      operation, assignment, action, result, receiptProof, receipt, preEffectEvents,
    }) {
      try {
        // A contained receipt has already proved the exact effect. Any unrelated
        // checkpoint append must rebase this same success; it may never downgrade
        // the reserved Artifact identity to uncertainty after success bytes stage.
        for (let rebaseAttempt = 0; rebaseAttempt < 16; rebaseAttempt += 1) {
          const durable = replayResult(currentState, request, draft, { allowIncomplete: true });
          if (durable && !durable.incomplete) {
            if (durable.result.resultHash !== result.resultHash) {
              fail('OPERATION_CONFLICT', 'A different terminal result already owns the reserved operation identities.', {
                operationId: operation.operationId,
                resultId: durable.result.resultId,
              });
            }
            return durable;
          }
          const successReservation = terminalReservationForStatus(draft, 'succeeded');
          const terminal = { result, ...materializeTerminalResult({
            state: currentState,
            operation,
            assignment,
            action,
            draft,
            reservation: successReservation,
            result,
            receiptProof,
            runtimeActorId,
          }) };
          if (!await stageAndProveArtifactCustody(
            artifactStore,
            terminal.accepted.artifact,
            terminal.resultBytes,
          )) {
            fail('OPERATION_UNCERTAIN', 'Success Artifact custody could not be proven after contained execution.', {
              operationId: operation.operationId,
              resultId: result.resultId,
              resultArtifactId: result.resultArtifactId,
            });
          }
          try {
            const terminalCommit = await commitCheckpoint(checkpointStore, currentState, terminal.finalState, {
              phase: 'terminal-result',
              operationId: operation.operationId,
              requestFingerprint: operation.requestFingerprint,
            });
            currentState = terminalCommit.state;
            if (!terminalCommit.committed) continue;
            return freeze({
              state: clone(terminal.finalState),
              operation: clone(terminal.finalState.governedOperations.find(({ operationId }) => (
                operationId === operation.operationId
              ))),
              result: clone(result),
              artifact: clone(terminal.accepted.artifact),
              events: [
                ...preEffectEvents,
                ...terminal.events,
              ].map(clone),
              response: clone(terminal.accepted.response),
              receipt: clone(receipt),
              replayed: false,
              dispatchCount: 1,
              effectCount: receipt.effectCount,
            });
          } catch (commitError) {
            if (commitError?.code !== 'OPERATION_UNCERTAIN') throw commitError;
            // Lost acknowledgement: retry the exact success against the durable
            // state returned by the next CAS, without another host/target call.
          }
        }
        fail('OPERATION_UNCERTAIN', 'Proven terminal success could not acquire the durable checkpoint after bounded rebasing.', {
          operationId: operation.operationId,
        });
      } catch (error) {
        throw provenTerminalError(error, {
          operationId: operation.operationId,
          resultId: result.resultId,
        });
      }
    }

    if (replay?.incomplete) {
      const operation = replay.operation;
      const action = currentState.actions.find(({ actionId }) => actionId === operation.action.actionId);
      let reconciliation;
      try {
        reconciliation = await reconcileOperatingGovernedDispatchV2({
          state: currentState,
          operationId: operation.operationId,
          request,
          trustedHost,
          targetAdapter,
          registry,
          observedAt: draft.completedAt,
        });
      } catch (error) {
        return terminalizeUncertain({
          operation,
          assignment: replay.journal.assignment,
          action,
          cause: error,
        });
      }
      if (reconciliation.classification === 'applied' && reconciliation.receipt !== null) {
        provenTerminalOperations.add(operation.operationId);
        try {
          const successReservation = terminalReservationForStatus(draft, 'succeeded');
          const result = buildResult({
            operation,
            receiptProof: reconciliation.receipt,
            request,
            draft,
            reservation: successReservation,
            eventIds: [
              operation.intentEventId,
              successReservation.eventIds.submitted,
              successReservation.eventIds.artifactCreated,
              successReservation.eventIds.validated,
              successReservation.eventIds.resultRecorded,
            ],
            targetBeforeHash: replay.journal.replayEntry.targetBeforeHash,
          });
          return await commitProvenSuccess({
            operation,
            assignment: replay.journal.assignment,
            action,
            result,
            receiptProof: reconciliation.receipt,
            receipt: reconciliation.receipt,
            preEffectEvents: [],
          });
        } catch (error) {
          throw provenTerminalError(error, { operationId: operation.operationId });
        }
      }
      if (reconciliation.classification === 'not-applied') {
        const host = resolveOpenReferenceExecutorHostV2(trustedHost);
        const selection = host && selectOperateExecutorV2(registry, {
          executorId: host.executorId,
          executorVersion: host.executorVersion,
          protocolVersion: PROTOCOL_VERSION,
          runtimeVersion,
          now: operation.createdAt,
          domainId: action.domainId,
          actionKind: action.actionKind,
          capability: action.requestedCapability,
          targetKind: action.targetBinding.kind,
          effectClass: action.effectClass,
          operationKind: 'execute',
        });
        if (!host || selection?.status !== 'available'
          || classifyOperateExecutorRecoveryCapabilityV2(selection.registration) === 'uncertain-no-redispatch') {
          return terminalizeUncertain({ operation, assignment: replay.journal.assignment, action, cause: { code: 'REDISPATCH_NOT_PROVED_SAFE' } });
        }
        const binding = createTrustedExecutorBindingV2({ selection, trustedHost });
        const executorInput = createContainedExecutorInputEnvelopeV2({
          operation, payload: request.payload, rollbackBaseline: request.rollbackBaseline,
        });
        const evaluation = currentState.policyEvaluations.find(({ evaluationId }) => evaluationId === operation.evaluationId);
        const requirements = evaluation.approvalRequirementIds.map((requirementId) => (
          currentState.approvalRequirements.find((candidate) => candidate.requirementId === requirementId)
        ));
        const approvals = currentState.approvalRecords.filter(({ evaluationId }) => evaluationId === evaluation.evaluationId);
        const actionPolicy = currentState.actionPolicies.find((candidate) => (
          candidate.policyId === evaluation.policy.policyId
          && candidate.policyVersion === evaluation.policy.policyVersion
          && candidate.policyHash === evaluation.policy.policyHash
        ));
        const availability = currentState.capabilityAvailability.find((candidate) => (
          candidate.checkedAt === operation.createdAt
          && candidate.capability.id === operation.capability.id
          && candidate.capability.version === operation.capability.version
          && candidate.target.kind === operation.target.kind
          && candidate.target.id === operation.target.id
          && candidate.target.revision === operation.target.revision
        ));
        const authorityContext = {
          actor: { actorId: replay.journal.grant.issuer.id, kind: 'engine', capabilities: [clone(action.requestedCapability)] },
          capabilities: [clone(EXECUTE_TOOL_CAPABILITY)],
          now: operation.createdAt,
          action,
          actionRequest: { action: actionIdentity(action) },
          request: { action: actionIdentity(action) },
          scope: { scopeId: action.scopeId, domainId: action.domainId, domainVersion: action.domainVersion },
          target: clone(action.targetBinding),
          dependencyActions: currentState.actions.filter(({ actionId }) => action.dependsOnActionIds.includes(actionId)),
          actionPolicy,
          actionPolicies: currentState.actionPolicies,
          policyEvaluation: evaluation,
          approvalRequirements: requirements,
          approvals,
          capabilityAvailability: availability,
          grant: replay.journal.grant,
          operation,
          operationHistory: currentState.governedOperations,
          currentPreconditionArtifactIds: [...action.preconditionArtifactIds],
          executor: selection.registration,
          governedExtensions: registry,
          trustedExecutorBinding: binding,
          executorInput,
          reconciliationProof: reconciliation,
        };
        const authorityDecision = assertOperateAuthorityV2('operate.action.execute', authorityContext);
        totalDispatchCount += 1;
        try {
          const receipt = await Promise.resolve(trustedHost.execute({
            authorityContext, authorityDecision, executorInput, binding,
            executor: selection.registration, targetAdapter,
          }));
          const receiptProof = createOperatingExecutionReceiptProofV2({ operation, receipt });
          const successReservation = terminalReservationForStatus(draft, 'succeeded');
          const result = buildResult({
            operation, receiptProof, request, draft, reservation: successReservation,
            eventIds: [
              operation.intentEventId,
              successReservation.eventIds.submitted,
              successReservation.eventIds.artifactCreated,
              successReservation.eventIds.validated,
              successReservation.eventIds.resultRecorded,
            ],
            targetBeforeHash: replay.journal.replayEntry.targetBeforeHash,
          });
          return commitProvenSuccess({
            operation, assignment: replay.journal.assignment, action, result,
            receiptProof, receipt, preEffectEvents: [],
          });
        } catch (error) {
          return terminalizeUncertain({ operation, assignment: replay.journal.assignment, action, cause: error });
        }
      }
      return terminalizeUncertain({
        operation,
        assignment: replay.journal.assignment,
        action,
        cause: { code: `RECONCILIATION_${reconciliation.classification.toUpperCase().replace('-', '_')}` },
      });
    }

    const actionMatches = currentState.actions.filter(({ actionId }) => actionId === request.actionId);
    if (actionMatches.length !== 1) fail('ACTION_NOT_FOUND', 'Governed execution requires one exact current Action.', {
      actionId: request.actionId,
    });
    const [action] = actionMatches;
    const existingActionOwner = findOperatingExactActionOperationOwnerV2(currentState.governedOperations, action);
    if (existingActionOwner) {
      fail('OPERATION_CONFLICT', 'The exact Action revision already owns a governed execution operation.', {
        actionId: action.actionId,
        operationId: existingActionOwner.operationId,
      });
    }
    if (action.state !== 'approved') fail('STATE_TRANSITION_INVALID', 'Only a current approved Action may create an execution operation.', {
      actionId: action.actionId,
      state: action.state,
    });
    if (currentState.assignments.some(({ governedOperationId }) => governedOperationId === draft.operationId)) {
      fail('OPERATION_CONFLICT', 'A governed operation may own only one execution Assignment.', {
        operationId: draft.operationId,
      });
    }
    const reservation = assertTerminalReservationAvailable(currentState, draft);
    if (action.executionBinding.rollbackRequired && request.rollbackBaseline === null) {
      fail('OPERATION_CONFLICT', 'A reversible Action requires one exact reviewed rollback baseline before dispatch.', {
        actionId: action.actionId,
      });
    }
    if (!action.executionBinding.rollbackRequired && request.rollbackBaseline !== null) {
      fail('OPERATION_CONFLICT', 'A non-reversible Action cannot add an undeclared rollback baseline.', {
        actionId: action.actionId,
      });
    }
    const inputArtifactIds = [...new Set([action.sourceArtifactId, ...action.preconditionArtifactIds])].sort();
    if (!inputArtifactIds.includes(request.payload.artifactId)
      || (request.rollbackBaseline !== null && !inputArtifactIds.includes(request.rollbackBaseline.artifactId))) {
      fail('RESULT_CONTRACT_INVALID', 'Executor payload and rollback baseline must use only reviewed Action inputs.', {
        actionId: action.actionId,
      });
    }

    const authority = exactAuthority(currentState, action, draft.preparedAt);
    const host = resolveOpenReferenceExecutorHostV2(trustedHost);
    if (host === null || !targetAdapter) {
      fail('EXECUTOR_UNAVAILABLE', 'Governed execution requires one package-owned contained host and explicit contained target adapter.');
    }
    const selection = selectOperateExecutorV2(registry, {
      executorId: host.executorId,
      executorVersion: host.executorVersion,
      protocolVersion: PROTOCOL_VERSION,
      runtimeVersion,
      now: draft.preparedAt,
      domainId: action.domainId,
      actionKind: action.actionKind,
      capability: action.requestedCapability,
      targetKind: action.targetBinding.kind,
      effectClass: action.effectClass,
      operationKind: 'execute',
    });
    if (selection.status !== 'available') {
      fail('EXECUTOR_UNAVAILABLE', 'The exact contained Executor registration is unavailable.', {
        reasonCode: selection.reasonCode,
      });
    }
    const binding = createTrustedExecutorBindingV2({ selection, trustedHost });
    const availability = createOpenReferenceCapabilityAvailabilityV2({
      action,
      runtimeVersion,
      checkedAt: draft.preparedAt,
      expiresAt: draft.availabilityExpiresAt,
      registry,
    });
    if (availability.status !== 'available') {
      fail('CAPABILITY_UNAVAILABLE', 'The exact contained capability is unavailable.', {
        reasonCode: availability.reasonCode,
      });
    }
    const assignment = buildAssignment(action, draft, inputArtifactIds);
    const grant = buildGrant({ action, authority, availability, draft, runtimeActorId });
    const operation = buildOperation({ action, authority, assignment, grant, selection, binding, request, draft });
    assertOperatingExecuteOperationV2({
      operation,
      action,
      assignment,
      evaluation: authority.evaluation,
      evaluations: currentState.policyEvaluations,
      configuredPolicies: currentState.actionPolicies,
      grant,
      requirements: authority.requirements,
      approvals: authority.approvals,
      capabilityAvailability: availability,
      request,
      timestamp: draft.preparedAt,
      registry,
    });
    const executorInput = createContainedExecutorInputEnvelopeV2({
      operation,
      payload: request.payload,
      rollbackBaseline: request.rollbackBaseline,
    });
    const authorityContext = buildAuthorityContext({
      state: currentState,
      action,
      authority,
      availability,
      grant,
      operation,
      selection,
      binding,
      executorInput,
      draft,
      runtimeActorId,
      registry,
    });
    const authorityDecision = assertOperateAuthorityV2('operate.action.execute', authorityContext);

    // Canonical authority denial must precede any target observation. Only an
    // already-authorized closed operation may inspect its contained target.
    const targetBefore = trustedHost.inspect({ targetAdapter, target: action.targetBinding });
    if (request.rollbackBaseline !== null
      && request.rollbackBaseline.contentHash !== targetBefore.stateHash) {
      fail('OPERATION_CONFLICT', 'Reviewed rollback baseline must equal the exact contained target state before dispatch.', {
        actionId: action.actionId,
      });
    }
    if (deriveContainedExecutorRequestFingerprintV2({
      operation,
      payload: request.payload,
      rollbackBaseline: request.rollbackBaseline,
    }) !== operation.requestFingerprint) {
      fail('OPERATION_CONFLICT', 'Contained target preflight diverged from the canonical operation fingerprint.', {
        actionId: action.actionId,
        operationId: operation.operationId,
      });
    }
    const finalAuthorityDecision = assertOperateAuthorityV2('operate.action.execute', authorityContext);
    if (sha256Jcs(finalAuthorityDecision) !== sha256Jcs(authorityDecision)) {
      fail('OPERATION_CONFLICT', 'Canonical authority changed during contained target preflight.', {
        actionId: action.actionId,
        operationId: operation.operationId,
      });
    }

    let stagedState = currentState;
    const preEffectEvents = [];
    const created = runtimeEvent(stagedState, {
      eventId: draft.eventIds.assignmentCreated,
      timestamp: draft.preparedAt,
      cycleId: action.sourceCycleId,
      type: 'assignment.created',
      entityId: assignment.assignmentId,
      actor: { kind: 'engine', id: runtimeActorId },
      correlationId: draft.correlationId,
      payload: assignment,
    });
    const scheduled = scheduleOperatingRuntimeEventsV2([created], { initialState: stagedState });
    stagedState = scheduled.state;
    preEffectEvents.push(...scheduled.events);

    for (const input of [
      {
        eventId: draft.eventIds.assignmentClaimed,
        type: 'assignment.claimed',
        entityId: assignment.assignmentId,
        payload: {
          assignmentId: assignment.assignmentId,
          actorId: runtimeActorId,
          actorKind: 'agent',
          runtime: `${selection.registration.provenance.packageName}@${selection.registration.provenance.packageVersion}`,
          claimId: draft.claimId,
          submissionId: draft.submissionId,
        },
      },
      {
        eventId: draft.eventIds.assignmentStarted,
        type: 'assignment.started',
        entityId: assignment.assignmentId,
        payload: { assignmentId: assignment.assignmentId, attempt: 1 },
      },
      {
        eventId: draft.eventIds.availabilityRecorded,
        type: 'capability.availability-recorded',
        entityId: availability.availabilityId,
        payload: availability,
      },
      {
        eventId: draft.eventIds.capabilityGranted,
        type: 'capability.granted',
        entityId: grant.grantId,
        payload: grant,
      },
      {
        eventId: draft.eventIds.intentRecorded,
        type: 'operation.intent-recorded',
        entityId: operation.operationId,
        requestHash: operation.requestFingerprint,
        payload: {
          operation,
          request: {
            payload: {
              artifactId: request.payload.artifactId,
              contentHash: request.payload.contentHash,
            },
            rollbackBaseline: request.rollbackBaseline === null ? null : {
              artifactId: request.rollbackBaseline.artifactId,
              contentHash: request.rollbackBaseline.contentHash,
            },
            targetBeforeHash: targetBefore.stateHash,
          },
          terminal: reservation,
        },
      },
    ]) {
      const event = runtimeEvent(stagedState, {
        ...input,
        timestamp: draft.preparedAt,
        cycleId: action.sourceCycleId,
        actor: { kind: 'engine', id: runtimeActorId },
        correlationId: draft.correlationId,
      });
      stagedState = reduceOperatingRuntimeEventsV2([event], { initialState: stagedState });
      preEffectEvents.push(event);
    }

    const dispatchBase = currentState;
    const intentCommit = await commitCheckpoint(checkpointStore, dispatchBase, stagedState, {
      phase: 'dispatch-intent',
      operationId: operation.operationId,
      requestFingerprint: operation.requestFingerprint,
    });
    currentState = intentCommit.state;
    if (!intentCommit.committed) {
      const electedReplay = replayResult(currentState, request, draft, { allowIncomplete: true });
      if (electedReplay && !electedReplay.incomplete) return electedReplay;
      if (electedReplay?.incomplete) {
        return terminalizeUncertain({
          operation: electedReplay.operation,
          assignment: electedReplay.journal.assignment,
          action,
          cause: { code: 'DISPATCH_OWNERSHIP_ALREADY_DURABLE' },
        });
      }
      const electedOwner = findOperatingExactActionOperationOwnerV2(currentState.governedOperations, action);
      fail(electedOwner ? 'OPERATION_CONFLICT' : 'CONCURRENT_MODIFICATION',
        electedOwner
          ? 'Another operation already owns the exact Action revision.'
          : 'Dispatch ownership compare-and-swap lost to another runtime state.', {
          actionId: action.actionId,
          operationId: operation.operationId,
          electedOperationId: electedOwner?.operationId ?? null,
        });
    }
    totalDispatchCount += 1;
    const durableReplayEntry = currentState.operationReplayIndex.find(({ operationId }) => (
      operationId === operation.operationId
    ));
    const durableGrant = currentState.capabilityGrants.find(({ grantId }) => grantId === operation.grantId);
    const successReservation = terminalReservationForStatus(draft, 'succeeded');
    const allResultEventIds = [
      operation.intentEventId,
      successReservation.eventIds.submitted,
      successReservation.eventIds.artifactCreated,
      successReservation.eventIds.validated,
      successReservation.eventIds.resultRecorded,
    ];
    let receipt = null;
    let effectProven = false;
    try {
      receipt = trustedHost.execute({
        authorityContext,
        authorityDecision,
        executorInput,
        binding,
        executor: selection.registration,
        targetAdapter,
      });
      receipt = await Promise.resolve(receipt);
      const receiptProof = createOperatingExecutionReceiptProofV2({ operation, receipt });
      effectProven = true;
      provenTerminalOperations.add(operation.operationId);
      const result = buildResult({
        operation,
        receiptProof,
        request,
        draft,
        reservation: successReservation,
        eventIds: allResultEventIds,
        targetBeforeHash: targetBefore.stateHash,
      });
      assertOperatingExecutionResultSemanticsV2({
        result,
        operation,
        replayEntry: durableReplayEntry,
        grant: durableGrant,
        receiptProof,
      });
      return await commitProvenSuccess({
        operation, assignment, action, result, receiptProof, receipt, preEffectEvents,
      });
    } catch (postIntentError) {
      if (effectProven) {
        throw provenTerminalError(postIntentError, { operationId: operation.operationId });
      }
      if (postIntentError?.details?.context?.provenTerminal === true) throw postIntentError;
      return terminalizeUncertain({ operation, assignment, action, cause: postIntentError });
    }
  }

  async function execute(requestInput, draftInput, environment = {}) {
    const operationId = draftInput?.operationId;
    const invocationHash = sha256Jcs({ request: requestInput, draft: draftInput });
    const active = typeof operationId === 'string' ? inFlight.get(operationId) : null;
    if (active) {
      if (active.invocationHash !== invocationHash) {
        fail('OPERATION_CONFLICT', 'An in-flight governed operation identity cannot be reused with divergent input.', {
          operationId,
        });
      }
      await active.promise;
      const request = assertExecutionRequest(requestInput);
      const draft = assertExecutionDraft(draftInput);
      return replayResult(currentState, request, draft);
    }
    const promise = executeOnce(requestInput, draftInput, environment);
    if (typeof operationId === 'string') inFlight.set(operationId, { invocationHash, promise });
    try {
      return await promise;
    } finally {
      if (inFlight.get(operationId)?.promise === promise) inFlight.delete(operationId);
    }
  }

  return Object.freeze({
    execute,
    checkpoint: () => clone(currentState),
    getState: () => clone(currentState),
    get dispatchCount() { return totalDispatchCount; },
  });
}

export async function executeOperatingGovernedActionV2(request, draft, options = {}) {
  const runtime = createOperatingGovernedExecutionRuntimeV2(options);
  return runtime.execute(request, draft, options);
}

export const OPERATING_GOVERNED_EXECUTION_TERMINAL_STATES_V2 = Object.freeze(
  [...TERMINAL_OPERATION_STATES].sort(),
);
