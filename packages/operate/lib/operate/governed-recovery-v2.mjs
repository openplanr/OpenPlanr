import { canonicalizeJson, sha256Jcs } from '@openplanr/protocol/canonical-json';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { PipelineError } from '@openplanr/protocol/errors';
import { evaluateOperatingRollbackApprovalSetV2 } from './approvals-v2.mjs';
import { assertOperateAuthorityV2 } from './authorization-v2.mjs';
import { buildOperatingRollbackVerificationV2 } from './execution-verification-v2.mjs';
import {
  classifyOperateExecutorRecoveryCapabilityV2,
  createContainedExecutorInputEnvelopeV2,
  createTrustedExecutorBindingV2,
  deriveContainedExecutorRequestFingerprintV2,
  findOperateExecutorRegistrationV2,
  OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
  selectOperateExecutorV2,
} from './governed-extensions-v2.mjs';
import { assertOperatingRollbackPolicyV2, isOperatingRollbackEligibilityV2 } from './policy-v2.mjs';
import {
  createOpenReferenceCapabilityAvailabilityV2,
  resolveOpenReferenceExecutorHostV2,
} from './reference-governed-executors-v2.mjs';
import {
  acceptOperatingAssignmentSubmissionV2,
  assertOperatingRollbackAuthorityChainV2,
  createOperatingExecutionReceiptProofV2,
  createOperatingRuntimeEventV2,
  reduceOperatingRuntimeEventsV2,
  resolveOperatingLatestActionEvaluationV2,
  scheduleOperatingRuntimeEventsV2,
} from './runtime-foundation.mjs';

const PROTOCOL_VERSION = '2.0.0';
const DEFAULT_RUNTIME_VERSION = '0.44.0';
const ROLLBACK_TOOL_CAPABILITY = Object.freeze({
  id: 'operate-action-rollback',
  version: PROTOCOL_VERSION,
});
const TERMINAL_STATES = new Set(['succeeded', 'failed', 'partial', 'uncertain', 'blocked']);

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', {
    retryable: false,
    context: structuredClone(context),
  });
}

function provenTerminalError(error, context = {}) {
  if (error?.details?.context?.provenTerminal === true) return error;
  const inherited =
    error?.details && typeof error.details === 'object' ? structuredClone(error.details) : {};
  const inheritedContext =
    inherited.context && typeof inherited.context === 'object' ? inherited.context : {};
  return new PipelineError(
    typeof error?.code === 'string' ? error.code : 'OPERATION_UNCERTAIN',
    error?.message ??
      'Rollback terminalization failed after exact baseline restoration was proved.',
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
  const copy = clone(record);
  delete copy[field];
  return copy;
}

function exact(value, fields) {
  return snapshotExactDataRecord(value, fields) !== null;
}

function snapshotExactDataRecord(value, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return null;
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
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index]))
    return null;
  const snapshot = {};
  for (const field of expected) {
    const descriptor = descriptors[field];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

function validTime(value, field) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed))
    fail('RESULT_CONTRACT_INVALID', `${field} must be an explicit RFC 3339 timestamp.`, { field });
  return parsed;
}

function sameHead(left, right) {
  return left?.sequence === right?.sequence && left?.hash === right?.hash;
}

function runtimeHead(state) {
  if (state.eventHead.sequence === 0) return { previousEvent: null, causationId: null };
  const entry = state.eventReplayIndex.find(
    ({ sequence }) => sequence === state.eventHead.sequence,
  );
  if (!entry || entry.eventHash !== state.eventHead.hash)
    fail('STATE_TRANSITION_INVALID', 'Runtime checkpoint Event head is incomplete.');
  return {
    previousEvent: { sequence: entry.sequence, eventHash: entry.eventHash },
    causationId: entry.eventId,
  };
}

function runtimeEvent(state, input) {
  const head = runtimeHead(state);
  return createOperatingRuntimeEventV2(
    { ...input, causationId: head.causationId },
    {
      previousEvent: head.previousEvent,
    },
  );
}

async function readCheckpoint(checkpointStore, currentState) {
  if (typeof checkpointStore?.readSnapshot !== 'function') {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Governed recovery requires a durable read-only checkpoint primitive.',
    );
  }
  let snapshot;
  try {
    snapshot = await checkpointStore.readSnapshot();
  } catch (error) {
    fail('OPERATION_UNCERTAIN', 'Governed recovery could not refresh its durable checkpoint.', {
      cause: error?.code ?? error?.name ?? 'checkpoint-read-error',
    });
  }
  const durable = reduceOperatingRuntimeEventsV2([], { initialState: snapshot });
  const ancestry =
    sameHead(durable.eventHead, currentState.eventHead) ||
    currentState.eventHead.sequence === 0 ||
    durable.eventReplayIndex.some(
      ({ sequence, eventHash }) =>
        sequence === currentState.eventHead.sequence && eventHash === currentState.eventHead.hash,
    );
  if (
    durable.eventHead.sequence < currentState.eventHead.sequence ||
    !ancestry ||
    (sameHead(durable.eventHead, currentState.eventHead) &&
      sha256Jcs(durable) !== sha256Jcs(currentState))
  ) {
    fail('CONCURRENT_MODIFICATION', 'Governed recovery checkpoint history is stale or forked.');
  }
  return durable;
}

async function commitCheckpoint(checkpointStore, expectedState, nextState, context) {
  let response;
  try {
    response = await checkpointStore.compareAndSwap(
      freeze({
        expectedEventHead: clone(expectedState.eventHead),
        nextState: clone(nextState),
        phase: context.phase,
        operationId: context.operationId,
        requestFingerprint: context.requestFingerprint,
      }),
    );
  } catch (error) {
    fail('OPERATION_UNCERTAIN', 'Governed recovery checkpoint commit failed.', {
      ...context,
      cause: error?.code ?? error?.name ?? 'checkpoint-error',
    });
  }
  const receipt = snapshotExactDataRecord(response, ['committed', 'state']);
  if (receipt === null || typeof receipt.committed !== 'boolean') {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Governed recovery checkpoint store returned an invalid CAS receipt.',
    );
  }
  const state = reduceOperatingRuntimeEventsV2([], { initialState: receipt.state });
  if (receipt.committed && sha256Jcs(state) !== sha256Jcs(nextState)) {
    fail(
      'CONCURRENT_MODIFICATION',
      'Governed recovery checkpoint committed divergent bytes.',
      context,
    );
  }
  if (!receipt.committed && sameHead(state.eventHead, expectedState.eventHead)) {
    fail(
      'CONCURRENT_MODIFICATION',
      'Governed recovery checkpoint rejected CAS without a newer durable state.',
      context,
    );
  }
  return { committed: receipt.committed, state };
}

async function hasExactArtifactCustody(artifactStore, artifact, expectedBytes) {
  if (artifactStore === undefined) return true;
  try {
    const value = await Promise.resolve(
      artifactStore.readRaw({
        artifactId: artifact.artifactId,
        rawHash: artifact.rawHash,
      }),
    );
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
    // A write-once store may make the exact bytes durable and lose only the
    // acknowledgement. Read-back distinguishes custody from an absent write.
  }
  return hasExactArtifactCustody(artifactStore, artifact, rawBytes);
}

function actionIdentity(action) {
  return { actionId: action.actionId, revision: action.revision, actionHash: action.actionHash };
}

export function buildOperatingRollbackPlanV2({
  operation,
  result,
  baseline,
  rollbackPlanId,
  eligibility = 'eligible',
  expiresAt,
} = {}) {
  try {
    assertProtocolArtifact('operating-governed-operation', operation, {
      protocolVersion: PROTOCOL_VERSION,
    });
    assertProtocolArtifact('operating-execution-result', result, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch (error) {
    fail(
      'ROLLBACK_NOT_ELIGIBLE',
      'Rollback planning requires contract-valid immutable operation and result history.',
      {
        cause: error?.code ?? null,
      },
    );
  }
  if (
    !operation ||
    !result ||
    !baseline ||
    operation.operationKind !== 'execute' ||
    operation.rollbackClass !== 'reversible' ||
    !['succeeded', 'partial'].includes(result.status) ||
    result.operationId !== operation.operationId ||
    result.operationKind !== 'execute' ||
    operation.state !== result.status ||
    operation.resultId !== result.resultId ||
    operation.requestFingerprint !== result.requestFingerprint ||
    operation.assignmentId !== result.assignmentId ||
    operation.evaluationId !== result.evaluationId ||
    operation.grantId !== result.grantId ||
    operation.effectClass !== result.effectClass ||
    operation.verificationPlanId !== result.verificationPlanId ||
    operation.rollbackPlanId !== null ||
    result.rollbackPlanId !== null ||
    sha256Jcs(operation.action) !== sha256Jcs(result.action) ||
    sha256Jcs(operation.approvalIds) !== sha256Jcs(result.approvalIds) ||
    sha256Jcs(operation.capability) !== sha256Jcs(result.capability) ||
    sha256Jcs(operation.target) !== sha256Jcs(result.target) ||
    sha256Jcs(operation.executor) !== sha256Jcs(result.executor) ||
    sha256Jcs(operation.connector) !== sha256Jcs(result.connector) ||
    sha256Jcs(operation.inputArtifactIds) !== sha256Jcs(result.inputArtifactIds) ||
    operation.operationHash !== sha256Jcs(without(operation, 'operationHash')) ||
    result.resultHash !== sha256Jcs(without(result, 'resultHash')) ||
    result.baselineArtifactId !== baseline.artifactId ||
    result.baselineHash !== baseline.contentHash ||
    !operation.preconditionArtifactIds.includes(baseline.artifactId) ||
    !operation.inputArtifactIds.includes(baseline.artifactId) ||
    baseline.contentHash !== sha256Jcs(baseline.value) ||
    result.targetAfterHash === null ||
    !isOperatingRollbackEligibilityV2(eligibility) ||
    validTime(expiresAt, 'expiresAt') <= validTime(result.completedAt, 'result.completedAt')
  ) {
    fail(
      'ROLLBACK_NOT_ELIGIBLE',
      'Rollback planning requires one exact reversible terminal operation, result, and pre-effect baseline.',
      {
        operationId: operation?.operationId ?? null,
      },
    );
  }
  const identity =
    rollbackPlanId ??
    `rbp_${sha256Jcs({
      operationId: operation.operationId,
      executionResultId: result.resultId,
      baselineArtifactId: baseline.artifactId,
      baselineHash: baseline.contentHash,
    }).slice('sha256:'.length, 31)}`;
  const plan = {
    kind: 'operating-rollback-plan',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    rollbackPlanId: identity,
    operationId: operation.operationId,
    executionResultId: result.resultId,
    action: clone(operation.action),
    eligibility: result.status === 'succeeded' ? eligibility : 'uncertain',
    capability: clone(operation.capability),
    effectClass: operation.effectClass,
    executor: clone(operation.executor),
    baselineArtifactId: baseline.artifactId,
    baselineHash: baseline.contentHash,
    steps: [
      {
        stepId: 'restore-exact-baseline',
        description:
          'Restore the exact immutable pre-effect baseline after proving the expected current target hash.',
        expectedTargetHash: result.targetAfterHash,
      },
    ],
    verificationPlanId: operation.verificationPlanId,
    expiresAt,
  };
  plan.planHash = sha256Jcs(plan);
  assertProtocolArtifact('operating-rollback-plan', plan, { protocolVersion: PROTOCOL_VERSION });
  return freeze(plan);
}

export function recordOperatingRollbackPlanV2({
  state,
  plan,
  eventId,
  runtimeActorId = 'operate-runtime-v2',
} = {}) {
  try {
    assertProtocolArtifact('operating-rollback-plan', plan, { protocolVersion: PROTOCOL_VERSION });
  } catch (error) {
    fail(
      'ROLLBACK_NOT_ELIGIBLE',
      'Rollback plan recording requires one contract-valid immutable plan.',
      {
        cause: error?.code ?? null,
      },
    );
  }
  if (plan.planHash !== sha256Jcs(without(plan, 'planHash'))) {
    fail(
      'ROLLBACK_NOT_ELIGIBLE',
      'Rollback plan hash does not equal its canonical immutable content.',
    );
  }
  const durable = reduceOperatingRuntimeEventsV2([], { initialState: state });
  const result = durable.executionResults.find(
    ({ resultId }) => resultId === plan?.executionResultId,
  );
  const operation = durable.governedOperations.find(
    ({ operationId }) => operationId === plan?.operationId,
  );
  const action = durable.actions.find(({ actionId }) => actionId === plan?.action?.actionId);
  if (!result || !operation || !action || typeof eventId !== 'string') {
    fail(
      'ROLLBACK_NOT_ELIGIBLE',
      'Rollback plan recording requires its exact durable execution history.',
    );
  }
  const event = runtimeEvent(durable, {
    eventId,
    timestamp: result.completedAt,
    cycleId: action.sourceCycleId,
    type: 'rollback.plan-recorded',
    entityId: plan.rollbackPlanId,
    actor: { kind: 'engine', id: runtimeActorId },
    correlationId: `rollback-plan:${plan.rollbackPlanId}`,
    payload: clone(plan),
  });
  const next = reduceOperatingRuntimeEventsV2([event], { initialState: durable });
  return freeze({ state: clone(next), plan: clone(plan), event: clone(event), replayed: false });
}

export function classifyOperatingGovernedRecoveryV2({ state, operationId, observedAt } = {}) {
  const durable = reduceOperatingRuntimeEventsV2([], { initialState: state });
  const operation = durable.governedOperations.find(
    (candidate) => candidate.operationId === operationId,
  );
  if (!operation)
    fail('ACTION_NOT_FOUND', 'Recovery requires one exact durable governed operation.', {
      operationId,
    });
  const result =
    operation.operationKind === 'execute'
      ? durable.executionResults.find(({ resultId }) => resultId === operation.resultId)
      : durable.rollbackResults.find(
          ({ rollbackResultId }) => rollbackResultId === operation.resultId,
        );
  const classifications = {
    succeeded: 'applied',
    partial: 'partial',
    failed: 'not-applied',
    blocked: 'not-applied',
    uncertain: 'unknown',
    dispatching: 'unknown',
    authorized: 'unknown',
    'intent-recorded': 'unknown',
  };
  const proof = {
    kind: 'operating-reconciliation-proof',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    operationId: operation.operationId,
    requestFingerprint: operation.requestFingerprint,
    executor: clone(operation.executor),
    classification: classifications[result?.status ?? operation.state] ?? 'unknown',
    observedAt: observedAt ?? result?.completedAt ?? operation.updatedAt,
    source: 'durable-history',
    receipt: null,
  };
  proof.reconciliationHash = sha256Jcs(proof);
  return freeze(proof);
}

export function classifyOperatingRollbackReconciliationReceiptV2({
  state,
  operationId,
  response,
} = {}) {
  // Reconciliation is an authority-bearing public boundary: standalone
  // operation and plan shapes are insufficient because they do not prove the
  // immutable Event/replay/projection chain. Reduce the supplied checkpoint and
  // use the same validator as checkpoint loading and terminal replay.
  const durable = reduceOperatingRuntimeEventsV2([], { initialState: state });
  const operations = durable.governedOperations.filter(
    (candidate) => candidate.operationId === operationId,
  );
  const operation = operations.length === 1 ? operations[0] : null;
  if (
    !operation ||
    operation.operationKind !== 'rollback' ||
    operation.state !== 'dispatching' ||
    operation.resultId !== null
  ) {
    fail(
      'OPERATION_CONFLICT',
      'Rollback reconciliation requires one exact durable dispatching rollback operation.',
      {
        operationId: operationId ?? null,
      },
    );
  }
  const authority = assertOperatingRollbackAuthorityChainV2({ state: durable, operationId });
  const plans = durable.rollbackPlans.filter(
    ({ rollbackPlanId }) => rollbackPlanId === operation.rollbackPlanId,
  );
  const rollbackPlan = plans.length === 1 ? plans[0] : null;
  if (
    !rollbackPlan ||
    operation.operationHash !== sha256Jcs(without(operation, 'operationHash')) ||
    rollbackPlan.planHash !== sha256Jcs(without(rollbackPlan, 'planHash')) ||
    operation.parentOperationId !== rollbackPlan.operationId ||
    !isOperatingRollbackEligibilityV2(rollbackPlan.eligibility)
  ) {
    fail(
      'ROLLBACK_NOT_ELIGIBLE',
      'Rollback reconciliation requires exact canonical durable operation and plan bindings.',
      {
        operationId: operation.operationId,
        rollbackPlanId: operation.rollbackPlanId,
      },
    );
  }
  if (
    exact(response, ['status', 'receipt']) &&
    response.status === 'not-found' &&
    response.receipt === null
  ) {
    return freeze({ classification: 'not-applied', receipt: null });
  }
  if (
    exact(response, ['status', 'receipt']) &&
    response.status === 'succeeded' &&
    response.receipt !== null
  ) {
    try {
      const receipt = createRollbackReconciliationReceiptProof(
        operation,
        rollbackPlan,
        authority.parentReplayEntry.terminalReceipt,
        response.receipt,
      );
      return freeze({
        classification:
          receipt.after.stateHash === rollbackPlan.baselineHash ? 'applied' : 'partial',
        receipt,
      });
    } catch {
      // A malformed, foreign, or non-plan-bound receipt proves no safe
      // postcondition. It remains unknown and can never authorize redispatch.
    }
  }
  return freeze({ classification: 'unknown', receipt: null });
}

export async function reconcileOperatingGovernedDispatchV2({
  state,
  operationId,
  request,
  trustedHost,
  targetAdapter,
  registry = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
  observedAt,
} = {}) {
  const durable = reduceOperatingRuntimeEventsV2([], { initialState: state });
  const operation = durable.governedOperations.find(
    (candidate) => candidate.operationId === operationId,
  );
  const replay = durable.operationReplayIndex.find(
    (candidate) => candidate.operationId === operationId,
  );
  if (!operation || !replay || operation.state !== 'dispatching' || operation.resultId !== null) {
    return classifyOperatingGovernedRecoveryV2({ state: durable, operationId, observedAt });
  }
  const registration = findOperateExecutorRegistrationV2(registry, operation.executor.executorId, {
    executorVersion: operation.executor.executorVersion,
  });
  const host = resolveOpenReferenceExecutorHostV2(trustedHost);
  if (
    !registration ||
    !host ||
    !targetAdapter ||
    classifyOperateExecutorRecoveryCapabilityV2(registration) === 'uncertain-no-redispatch' ||
    registration.reconciliation.supported !== true ||
    host.executorId !== registration.executorId ||
    host.executorVersion !== registration.executorVersion
  ) {
    const unknown = clone(
      classifyOperatingGovernedRecoveryV2({ state: durable, operationId, observedAt }),
    );
    unknown.source = 'deterministic-executor';
    delete unknown.reconciliationHash;
    unknown.reconciliationHash = sha256Jcs(unknown);
    return freeze(unknown);
  }
  const rollbackPlans =
    operation.operationKind === 'rollback'
      ? durable.rollbackPlans.filter(
          ({ rollbackPlanId }) => rollbackPlanId === operation.rollbackPlanId,
        )
      : [];
  const rollbackPlan =
    operation.operationKind === 'rollback' && rollbackPlans.length === 1 ? rollbackPlans[0] : null;
  if (operation.operationKind === 'rollback') {
    if (rollbackPlan === null) {
      fail(
        'ROLLBACK_NOT_ELIGIBLE',
        'Rollback reconciliation requires one exact durable rollback plan.',
        {
          operationId: operation.operationId,
          rollbackPlanId: operation.rollbackPlanId,
        },
      );
    }
    assertOperatingRollbackAuthorityChainV2({ state: durable, operationId: operation.operationId });
  }
  const executorInput = createContainedExecutorInputEnvelopeV2({
    operation,
    payload: request.payload,
    rollbackBaseline: request.rollbackBaseline,
  });
  const selection = {
    status: 'available',
    registration,
    reasonCode: 'exact-registration-available',
    fallback: null,
  };
  const binding = createTrustedExecutorBindingV2({ selection, trustedHost });
  const response = await Promise.resolve(
    trustedHost.reconcile({
      targetAdapter,
      executorInput,
      binding,
      executor: registration,
      rollbackPlan,
    }),
  );
  let classification = 'unknown';
  let receipt = null;
  if (operation.operationKind === 'rollback') {
    ({ classification, receipt } = classifyOperatingRollbackReconciliationReceiptV2({
      state: durable,
      operationId: operation.operationId,
      response,
    }));
  } else {
    if (
      !exact(response, ['status', 'receipt']) ||
      !['not-found', 'succeeded'].includes(response.status) ||
      (response.status === 'not-found') !== (response.receipt === null)
    ) {
      fail(
        'OPERATION_UNCERTAIN',
        'Executor reconciliation returned an unsupported or ambiguous classification.',
        {
          operationId,
        },
      );
    }
    classification = response.status === 'succeeded' ? 'applied' : 'not-applied';
    receipt =
      response.status === 'succeeded'
        ? createOperatingExecutionReceiptProofV2({ operation, receipt: response.receipt })
        : null;
  }
  const proof = {
    kind: 'operating-reconciliation-proof',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    operationId: operation.operationId,
    requestFingerprint: operation.requestFingerprint,
    executor: clone(operation.executor),
    classification,
    observedAt: observedAt ?? operation.updatedAt,
    source: 'deterministic-executor',
    receipt: clone(receipt),
  };
  proof.reconciliationHash = sha256Jcs(proof);
  return freeze(proof);
}

const ROLLBACK_DRAFT_FIELDS = [
  'assignmentId',
  'submissionId',
  'operationId',
  'grantId',
  'rollbackResultId',
  'resultArtifactId',
  'claimId',
  'preparedAt',
  'completedAt',
  'grantExpiresAt',
  'availabilityExpiresAt',
  'correlationId',
  'eventIds',
  'uncertainty',
];
const EVENT_FIELDS = [
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
];
const TERMINAL_EVENT_FIELDS = ['submitted', 'artifactCreated', 'validated', 'resultRecorded'];

function assertRollbackRequest(request) {
  if (
    !exact(request, [
      'actionId',
      'originalOperationId',
      'rollbackPlanId',
      'payload',
      'rollbackBaseline',
    ]) ||
    !exact(request?.payload, ['artifactId', 'contentHash', 'value']) ||
    !exact(request?.rollbackBaseline, ['artifactId', 'contentHash', 'value']) ||
    request.payload.contentHash !== sha256Jcs(request.payload.value) ||
    request.rollbackBaseline.contentHash !== sha256Jcs(request.rollbackBaseline.value)
  ) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Governed rollback requires one closed exact plan, payload, and baseline request.',
    );
  }
  return clone(request);
}

function assertRollbackDraft(draft) {
  if (
    !exact(draft, ROLLBACK_DRAFT_FIELDS) ||
    !exact(draft?.eventIds, EVENT_FIELDS) ||
    !exact(draft?.uncertainty, [
      'rollbackResultId',
      'resultArtifactId',
      'submissionId',
      'eventIds',
    ]) ||
    !exact(draft?.uncertainty?.eventIds, TERMINAL_EVENT_FIELDS) ||
    !String(draft?.rollbackResultId).startsWith('rbres_') ||
    !String(draft?.uncertainty?.rollbackResultId).startsWith('rbres_') ||
    new Set([...Object.values(draft.eventIds), ...Object.values(draft.uncertainty.eventIds)])
      .size !==
      EVENT_FIELDS.length + TERMINAL_EVENT_FIELDS.length
  ) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Governed rollback requires one complete runtime-owned identity draft.',
    );
  }
  const prepared = validTime(draft.preparedAt, 'draft.preparedAt');
  if (
    validTime(draft.completedAt, 'draft.completedAt') < prepared ||
    validTime(draft.grantExpiresAt, 'draft.grantExpiresAt') <= prepared ||
    validTime(draft.availabilityExpiresAt, 'draft.availabilityExpiresAt') <= prepared
  ) {
    fail('RESULT_CONTRACT_INVALID', 'Rollback identities and authority expiries must be causal.');
  }
  return clone(draft);
}

function assertRuntimeReconcileInput(input) {
  const allowed = new Set(['operationId', 'request', 'trustedHost', 'targetAdapter', 'observedAt']);
  const fields =
    input && typeof input === 'object' && !Array.isArray(input)
      ? Object.getOwnPropertyNames(input)
      : [];
  const rollbackBaseline = input?.request?.rollbackBaseline;
  if (
    !input ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Object.getOwnPropertySymbols(input).length > 0 ||
    fields.some((field) => !allowed.has(field)) ||
    typeof input.operationId !== 'string' ||
    !exact(input.request, ['payload', 'rollbackBaseline']) ||
    !exact(input.request.payload, ['artifactId', 'contentHash', 'value']) ||
    input.request.payload.contentHash !== sha256Jcs(input.request.payload.value) ||
    (rollbackBaseline !== null &&
      (!exact(rollbackBaseline, ['artifactId', 'contentHash', 'value']) ||
        rollbackBaseline.contentHash !== sha256Jcs(rollbackBaseline.value))) ||
    (input.observedAt !== undefined && Number.isNaN(Date.parse(input.observedAt)))
  ) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Runtime reconciliation accepts only the documented operation, request, host, target, and observation fields.',
    );
  }
  return {
    operationId: input.operationId,
    request: clone(input.request),
    ...(input.trustedHost === undefined ? {} : { trustedHost: input.trustedHost }),
    ...(input.targetAdapter === undefined ? {} : { targetAdapter: input.targetAdapter }),
    ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
  };
}

function exactAuthority(state, action, plan, now) {
  const evaluation = resolveOperatingLatestActionEvaluationV2({
    evaluations: state.policyEvaluations,
    action,
    configuredPolicies: state.actionPolicies,
    at: now,
  });
  const actionPolicy = state.actionPolicies.find(
    (policy) =>
      policy.policyId === evaluation?.policy.policyId &&
      policy.policyVersion === evaluation?.policy.policyVersion &&
      policy.policyHash === evaluation?.policy.policyHash,
  );
  const requirements =
    evaluation?.approvalRequirementIds.map((requirementId) =>
      state.approvalRequirements.find((candidate) => candidate.requirementId === requirementId),
    ) ?? [];
  const approvals = evaluation
    ? state.approvalRecords.filter(({ evaluationId }) => evaluationId === evaluation.evaluationId)
    : [];
  let disposition;
  try {
    assertOperatingRollbackPolicyV2({ action, evaluation, rollbackPlan: plan, at: now });
    disposition = evaluateOperatingRollbackApprovalSetV2({
      evaluation,
      action,
      requirements,
      approvals,
      now,
    });
  } catch (error) {
    fail(error.code ?? 'APPROVAL_REQUIRED', error.message, error.details?.context ?? {});
  }
  if (
    !evaluation ||
    !actionPolicy ||
    requirements.some((entry) => !entry) ||
    !disposition.complete ||
    disposition.disposition !== 'approved'
  ) {
    fail(
      'APPROVAL_REQUIRED',
      'Rollback requires one fresh exact current policy and approval disposition.',
      {
        actionId: action.actionId,
      },
    );
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
    objective: `Roll back the governed Action ${action.actionId} exactly once to its immutable baseline.`,
    state: 'pending',
    dependsOn: [],
    dependencyPolicy: { kind: 'none' },
    inputArtifactIds,
    inputAbsences: [],
    outputContract: {
      schemaId: 'operating-rollback-result',
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

function buildGrant({ action, authority, availability, draft, runtimeActorId }) {
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
    scopeHash:
      authority.requirements[0]?.scopeHash ??
      sha256Jcs({
        action: actionIdentity(action),
        evaluationId: authority.evaluation.evaluationId,
        scopeId: action.scopeId,
        domainId: action.domainId,
        domainVersion: action.domainVersion,
      }),
  };
  grant.grantHash = sha256Jcs(grant);
  assertProtocolArtifact('operating-capability-grant', grant, {
    protocolVersion: PROTOCOL_VERSION,
  });
  return grant;
}

function terminalReservation(draft) {
  return {
    resultId: draft.rollbackResultId,
    resultArtifactId: draft.resultArtifactId,
    submissionId: draft.submissionId,
    eventIds: Object.fromEntries(
      TERMINAL_EVENT_FIELDS.map((field) => [field, draft.eventIds[field]]),
    ),
    completedAt: draft.completedAt,
    correlationId: draft.correlationId,
    uncertainty: {
      resultId: draft.uncertainty.rollbackResultId,
      resultArtifactId: draft.uncertainty.resultArtifactId,
      submissionId: draft.uncertainty.submissionId,
      eventIds: clone(draft.uncertainty.eventIds),
    },
  };
}

function buildOperation({
  action,
  authority,
  assignment,
  plan,
  selection,
  binding,
  request,
  draft,
}) {
  const operation = {
    kind: 'operating-governed-operation',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    operationId: draft.operationId,
    operationKind: 'rollback',
    action: actionIdentity(action),
    assignmentId: assignment.assignmentId,
    requestFingerprint: `sha256:${'0'.repeat(64)}`,
    evaluationId: authority.evaluation.evaluationId,
    approvalIds: [...authority.disposition.approvalIds].sort(),
    grantId: draft.grantId,
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
    verificationPlanId: plan.verificationPlanId,
    rollbackClass: 'reversible',
    state: 'dispatching',
    intentEventId: draft.eventIds.intentRecorded,
    resultId: null,
    rollbackPlanId: plan.rollbackPlanId,
    parentOperationId: plan.operationId,
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
  assertProtocolArtifact('operating-governed-operation', operation, {
    protocolVersion: PROTOCOL_VERSION,
  });
  return operation;
}

function buildAuthorityContext({
  state,
  action,
  authority,
  availability,
  grant,
  operation,
  plan,
  selection,
  binding,
  executorInput,
  draft,
  runtimeActorId,
  registry,
}) {
  return {
    actor: {
      actorId: runtimeActorId,
      kind: 'engine',
      capabilities: [clone(action.requestedCapability)],
    },
    capabilities: [clone(ROLLBACK_TOOL_CAPABILITY)],
    now: draft.preparedAt,
    action,
    actionRequest: {
      action: actionIdentity(action),
      originalOperationId: plan.operationId,
      rollbackPlanId: plan.rollbackPlanId,
    },
    request: {
      action: actionIdentity(action),
      originalOperationId: plan.operationId,
      rollbackPlanId: plan.rollbackPlanId,
    },
    scope: {
      scopeId: action.scopeId,
      domainId: action.domainId,
      domainVersion: action.domainVersion,
    },
    target: clone(action.targetBinding),
    dependencyActions: state.actions.filter(({ actionId }) =>
      action.dependsOnActionIds.includes(actionId),
    ),
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
    rollbackPlan: plan,
  };
}

function buildRollbackResult({ operation, plan, draft, reservation, receiptProof, status }) {
  const successful = ['succeeded', 'partial'].includes(status);
  const changed = successful ? receiptProof.changed : false;
  const summaries = {
    succeeded: changed
      ? 'Restored the exact immutable pre-effect baseline.'
      : 'The target already equalled the exact immutable baseline.',
    partial: 'Rollback changed the target without restoring the exact immutable baseline.',
    failed: 'Rollback failed without a proven target postcondition.',
    blocked: 'Rollback was blocked without touching the target.',
    uncertain:
      'Rollback outcome is uncertain; reconciliation is required before further remediation.',
  };
  const result = {
    kind: 'operating-rollback-result',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    rollbackResultId: reservation.resultId,
    rollbackOperationId: operation.operationId,
    operationKind: 'rollback',
    requestFingerprint: operation.requestFingerprint,
    originalOperationId: plan.operationId,
    executionResultId: plan.executionResultId,
    rollbackPlanId: plan.rollbackPlanId,
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
    targetBeforeHash: receiptProof?.before.stateHash ?? plan.steps[0].expectedTargetHash,
    targetAfterHash: successful ? receiptProof.after.stateHash : null,
    baselineArtifactId: plan.baselineArtifactId,
    baselineHash: plan.baselineHash,
    inputArtifactIds: clone(operation.inputArtifactIds),
    outputArtifactIds: [reservation.resultArtifactId],
    effectSummary: {
      changed,
      summary: summaries[status],
      affectedTargetIds: ['failed', 'blocked'].includes(status) ? [] : [operation.target.id],
    },
    resultArtifactId: reservation.resultArtifactId,
    verificationPlanId: operation.verificationPlanId,
    eventIds: [
      operation.intentEventId,
      reservation.eventIds.submitted,
      reservation.eventIds.artifactCreated,
      reservation.eventIds.validated,
      reservation.eventIds.resultRecorded,
    ],
    completedAt: draft.completedAt,
  };
  result.resultHash = sha256Jcs(result);
  assertProtocolArtifact('operating-rollback-result', result, {
    protocolVersion: PROTOCOL_VERSION,
  });
  return result;
}

function createRollbackReconciliationReceiptProof(operation, plan, parentReceipt, receipt) {
  if (
    !exact(receipt, [
      'operationId',
      'requestFingerprint',
      'target',
      'before',
      'after',
      'changed',
      'synthetic',
      'effectCount',
    ]) ||
    !exact(parentReceipt, [
      'operationId',
      'requestFingerprint',
      'target',
      'before',
      'after',
      'changed',
      'synthetic',
      'effectCount',
    ]) ||
    !exact(receipt?.target, ['kind', 'id']) ||
    !exact(receipt?.before, ['value', 'revision', 'stateHash']) ||
    !exact(receipt?.after, ['value', 'revision', 'stateHash']) ||
    !exact(parentReceipt?.target, ['kind', 'id']) ||
    !exact(parentReceipt?.before, ['revision', 'stateHash']) ||
    !exact(parentReceipt?.after, ['revision', 'stateHash']) ||
    receipt.operationId !== operation.operationId ||
    receipt.requestFingerprint !== operation.requestFingerprint ||
    receipt.target.kind !== operation.target.kind ||
    receipt.target.id !== operation.target.id ||
    parentReceipt.operationId !== plan.operationId ||
    parentReceipt.target.kind !== operation.target.kind ||
    parentReceipt.target.id !== operation.target.id ||
    parentReceipt.after.stateHash !== plan.steps[0].expectedTargetHash ||
    typeof parentReceipt.before.revision !== 'string' ||
    parentReceipt.before.revision.length === 0 ||
    typeof parentReceipt.after.revision !== 'string' ||
    parentReceipt.after.revision.length === 0 ||
    typeof receipt.before.revision !== 'string' ||
    receipt.before.revision.length === 0 ||
    typeof receipt.after.revision !== 'string' ||
    receipt.after.revision.length === 0 ||
    receipt.before.revision !== parentReceipt.after.revision ||
    receipt.after.revision === receipt.before.revision ||
    receipt.after.revision === parentReceipt.before.revision ||
    receipt.before.stateHash !== sha256Jcs(receipt.before.value) ||
    receipt.after.stateHash !== sha256Jcs(receipt.after.value) ||
    receipt.before.stateHash !== plan.steps[0].expectedTargetHash ||
    receipt.changed !== (receipt.before.stateHash !== receipt.after.stateHash) ||
    typeof receipt.synthetic !== 'boolean' ||
    receipt.effectCount !== 1
  ) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Rollback receipt must prove one exact plan-bound compensation attempt.',
      {
        operationId: operation.operationId,
      },
    );
  }
  return freeze({
    operationId: receipt.operationId,
    requestFingerprint: receipt.requestFingerprint,
    target: clone(receipt.target),
    before: { revision: receipt.before.revision, stateHash: receipt.before.stateHash },
    after: { revision: receipt.after.revision, stateHash: receipt.after.stateHash },
    changed: receipt.changed,
    synthetic: receipt.synthetic,
    effectCount: 1,
  });
}

function createRollbackReceiptProof(operation, plan, parentReceipt, receipt) {
  const proof = createRollbackReconciliationReceiptProof(operation, plan, parentReceipt, receipt);
  if (proof.after.stateHash !== plan.baselineHash) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Rollback receipt must prove the exact plan-bound baseline postcondition.',
      {
        operationId: operation.operationId,
        rollbackPlanId: plan.rollbackPlanId,
      },
    );
  }
  return proof;
}

function materializeRollbackResult({
  state,
  operation,
  assignment,
  action,
  result,
  draft,
  reservation,
  runtimeActorId,
}) {
  const bytes = Buffer.from(canonicalizeJson(result), 'utf8');
  const claimedAssignment = state.assignments.find(
    ({ assignmentId }) => assignmentId === assignment.assignmentId,
  );
  if (!claimedAssignment?.claim || claimedAssignment.state !== 'running') {
    fail(
      'ASSIGNMENT_NOT_AVAILABLE',
      'Rollback result materialization requires the exact running Assignment claim.',
      {
        assignmentId: assignment.assignmentId,
      },
    );
  }
  const accepted = acceptOperatingAssignmentSubmissionV2(
    {
      assignmentId: assignment.assignmentId,
      submissionId: reservation.submissionId,
      actor: {
        actorId: claimedAssignment.claim.actorId,
        kind: claimedAssignment.claim.actorKind,
        runtime: claimedAssignment.claim.runtime,
      },
      contentBase64: bytes.toString('base64'),
      mediaType: 'application/json',
      encoding: 'utf-8',
    },
    {
      artifactId: reservation.resultArtifactId,
      artifactType: 'operating-rollback-result',
      storageClass: 'machine-local',
      sensitivity: 'internal',
      retentionClass: 'project',
      inputArtifactIds: operation.inputArtifactIds,
      timestamp: draft.completedAt,
      validatorVersion: 'operate-governed-recovery-v2@1.0.0',
      eventIds: {
        submitted: reservation.eventIds.submitted,
        artifactCreated: reservation.eventIds.artifactCreated,
        validated: reservation.eventIds.validated,
      },
      correlationId: draft.correlationId,
    },
    { initialState: state },
  );
  const resultRecorded = runtimeEvent(accepted.state, {
    eventId: reservation.eventIds.resultRecorded,
    timestamp: draft.completedAt,
    cycleId: action.sourceCycleId,
    type: 'rollback.result-recorded',
    entityId: result.rollbackResultId,
    actor: { kind: 'engine', id: runtimeActorId },
    correlationId: draft.correlationId,
    payload: result,
  });
  let finalState = reduceOperatingRuntimeEventsV2([...accepted.events, resultRecorded], {
    initialState: state,
  });
  const lifecycleEvents = [];
  const terminalActions = finalState.actions.filter(({ actionId }) => actionId === action.actionId);
  const terminalCycles = finalState.cycles.filter(
    ({ cycleId }) => cycleId === action.sourceCycleId,
  );
  const terminalOperations = finalState.governedOperations.filter(
    ({ operationId }) => operationId === operation.operationId,
  );
  const verificationPlans = finalState.verificationPlans.filter(
    ({ verificationPlanId }) => verificationPlanId === action.verificationPlanId,
  );
  const terminalAction = terminalActions[0] ?? null;
  const terminalCycle = terminalCycles[0] ?? null;
  const terminalOperation = terminalOperations[0] ?? null;
  const verificationPlan = verificationPlans[0] ?? null;
  const sameScope = (record) =>
    record?.scopeId === action.scopeId &&
    record.domainId === action.domainId &&
    record.domainVersion === action.domainVersion;
  if (
    terminalActions.length !== 1 ||
    terminalCycles.length !== 1 ||
    terminalOperations.length !== 1 ||
    verificationPlans.length > 1 ||
    !sameScope(terminalAction) ||
    !sameScope(terminalCycle) ||
    (verificationPlan &&
      (!sameScope(verificationPlan) || verificationPlan.actionId !== action.actionId))
  ) {
    fail(
      'OPERATING_SCOPE_INVALID',
      'Rollback lifecycle selection requires one exact Action, Cycle, and verification-plan scope and domain version.',
      {
        actionId: action.actionId,
        cycleId: action.sourceCycleId,
        verificationPlanId: action.verificationPlanId,
      },
    );
  }
  if (
    terminalAction &&
    terminalCycle &&
    terminalOperation &&
    verificationPlan &&
    ['executing', 'verifying'].includes(terminalCycle.state)
  ) {
    const lifecycle = buildOperatingRollbackVerificationV2({
      action: terminalAction,
      cycle: terminalCycle,
      operation: terminalOperation,
      result,
      verificationPlan,
      timestamp: draft.completedAt,
    });
    const append = (input) => {
      const event = runtimeEvent(finalState, {
        ...input,
        timestamp: draft.completedAt,
        cycleId: action.sourceCycleId,
        actor: { kind: 'engine', id: runtimeActorId },
        correlationId: draft.correlationId,
      });
      finalState = reduceOperatingRuntimeEventsV2([event], { initialState: finalState });
      lifecycleEvents.push(event);
    };
    append({
      eventId: lifecycle.identities.eventIds.verificationAssignmentCreated,
      type: 'assignment.created',
      entityId: lifecycle.verificationAssignment.assignmentId,
      payload: lifecycle.verificationAssignment,
    });
    if (terminalCycle.state === 'executing') {
      append({
        eventId: lifecycle.identities.eventIds.cycleVerifying,
        type: 'cycle.verifying',
        entityId: terminalCycle.cycleId,
        payload: {
          cycleId: terminalCycle.cycleId,
          from: 'executing',
          to: 'verifying',
          actionId: terminalAction.actionId,
          operationId: terminalOperation.operationId,
          resultId: result.rollbackResultId,
          reasonCode: null,
        },
      });
    }
  }
  return { accepted, resultRecorded, lifecycleEvents, finalState, bytes };
}

async function rollbackReplay(state, request, draft, artifactStore) {
  const operation = state.governedOperations.find(
    ({ operationId }) => operationId === draft.operationId,
  );
  if (!operation) return null;
  if (
    operation.operationKind !== 'rollback' ||
    operation.parentOperationId !== request.originalOperationId ||
    operation.rollbackPlanId !== request.rollbackPlanId ||
    deriveContainedExecutorRequestFingerprintV2({
      operation,
      payload: request.payload,
      rollbackBaseline: request.rollbackBaseline,
    }) !== operation.requestFingerprint
  ) {
    fail('OPERATION_CONFLICT', 'Rollback operation identity was reused with divergent input.', {
      operationId: draft.operationId,
    });
  }
  if (!TERMINAL_STATES.has(operation.state) || operation.resultId === null) {
    fail(
      'OPERATION_UNCERTAIN',
      'Rollback has durable dispatch intent without a terminal result; blind retry is forbidden.',
      {
        operationId: operation.operationId,
        recoveryDisposition: 'reconcile-before-retry',
      },
    );
  }
  const result = state.rollbackResults.find(
    ({ rollbackResultId }) => rollbackResultId === operation.resultId,
  );
  const artifact =
    result && state.artifacts.find(({ artifactId }) => artifactId === result.resultArtifactId);
  if (!result || !artifact || artifact.canonicalHash !== sha256Jcs(result)) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Rollback replay is missing its exact immutable result Artifact.',
    );
  }
  assertOperatingRollbackAuthorityChainV2({ state, operationId: operation.operationId });
  const resultBytes = Buffer.from(canonicalizeJson(result), 'utf8');
  if (!(await hasExactArtifactCustody(artifactStore, artifact, resultBytes))) {
    const provenTerminal =
      ['succeeded', 'partial'].includes(result.status) &&
      operation.state === result.status &&
      operation.resultId === result.rollbackResultId;
    fail(
      'RESULT_CONTRACT_INVALID',
      'Rollback replay cannot prove custody of the exact accepted result bytes.',
      {
        operationId: operation.operationId,
        rollbackResultId: result.rollbackResultId,
        resultArtifactId: result.resultArtifactId,
        ...(provenTerminal
          ? {
              provenTerminal: true,
              recoveryDisposition: 'restore-exact-result-custody-before-retry',
            }
          : {}),
      },
    );
  }
  return freeze({
    state: clone(state),
    operation: clone(operation),
    result: clone(result),
    artifact: clone(artifact),
    events: [],
    receipt: null,
    replayed: true,
    dispatchCount: 0,
    effectCount: 0,
  });
}

export function createOperatingGovernedRecoveryRuntimeV2({
  initialState,
  artifactStore,
  checkpointStore,
  runtimeVersion = DEFAULT_RUNTIME_VERSION,
  runtimeActorId = 'operate-runtime-v2',
  registry = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
} = {}) {
  if (
    !initialState ||
    typeof checkpointStore?.readSnapshot !== 'function' ||
    typeof checkpointStore?.compareAndSwap !== 'function'
  ) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Governed recovery runtime requires one explicit state and durable CAS checkpoint store.',
    );
  }
  if (
    artifactStore !== undefined &&
    (typeof artifactStore?.stageRaw !== 'function' || typeof artifactStore?.readRaw !== 'function')
  ) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Rollback Artifact byte storage must implement exact raw staging and retrieval.',
    );
  }
  const configuredRegistry = freeze(clone(registry));
  let currentState = reduceOperatingRuntimeEventsV2([], { initialState });
  let dispatchCount = 0;
  const inFlight = new Map();
  const provenTerminalOperations = new Set();

  async function rollbackOnce(requestInput, draftInput, { trustedHost, targetAdapter } = {}) {
    const request = assertRollbackRequest(requestInput);
    const draft = assertRollbackDraft(draftInput);
    currentState = await readCheckpoint(checkpointStore, currentState);
    let replay;
    try {
      replay = await rollbackReplay(currentState, request, draft, artifactStore);
    } catch (error) {
      if (provenTerminalOperations.has(draft.operationId)) {
        throw provenTerminalError(error, { operationId: draft.operationId });
      }
      throw error;
    }
    if (replay) return replay;
    const action = currentState.actions.find(({ actionId }) => actionId === request.actionId);
    const plan = currentState.rollbackPlans.find(
      ({ rollbackPlanId }) => rollbackPlanId === request.rollbackPlanId,
    );
    const parent = currentState.governedOperations.find(
      ({ operationId }) => operationId === request.originalOperationId,
    );
    const parentResult =
      parent && currentState.executionResults.find(({ resultId }) => resultId === parent.resultId);
    if (
      !action ||
      !plan ||
      !parent ||
      !parentResult ||
      plan.operationId !== parent.operationId ||
      plan.executionResultId !== parentResult.resultId ||
      parent.operationKind !== 'execute' ||
      !['succeeded', 'partial'].includes(parent.state) ||
      !isOperatingRollbackEligibilityV2(plan.eligibility) ||
      Date.parse(plan.expiresAt) <= Date.parse(draft.preparedAt) ||
      request.rollbackBaseline.artifactId !== plan.baselineArtifactId ||
      request.rollbackBaseline.contentHash !== plan.baselineHash ||
      request.payload.artifactId !== action.sourceArtifactId ||
      currentState.governedOperations.some(
        (candidate) =>
          candidate.operationKind === 'rollback' &&
          candidate.parentOperationId === parent.operationId &&
          candidate.rollbackPlanId === plan.rollbackPlanId,
      )
    ) {
      fail(
        'ROLLBACK_NOT_ELIGIBLE',
        'Rollback request is stale, repeated, unsupported, or divergent from immutable execution history.',
        {
          rollbackPlanId: request.rollbackPlanId,
        },
      );
    }
    const authority = exactAuthority(currentState, action, plan, draft.preparedAt);
    const host = resolveOpenReferenceExecutorHostV2(trustedHost);
    if (!host || !targetAdapter)
      fail(
        'EXECUTOR_UNAVAILABLE',
        'Rollback requires one package-owned contained host and target.',
      );
    const selection = selectOperateExecutorV2(configuredRegistry, {
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
      operationKind: 'rollback',
    });
    if (
      selection.status !== 'available' ||
      selection.registration.executorId !== plan.executor.executorId ||
      selection.registration.executorVersion !== plan.executor.executorVersion
    ) {
      fail(
        'EXECUTOR_UNAVAILABLE',
        'Rollback requires the exact healthy executor version recorded by its plan.',
      );
    }
    const binding = createTrustedExecutorBindingV2({ selection, trustedHost });
    const availability = createOpenReferenceCapabilityAvailabilityV2({
      action,
      runtimeVersion,
      checkedAt: draft.preparedAt,
      expiresAt: draft.availabilityExpiresAt,
      registry: configuredRegistry,
    });
    if (availability.status !== 'available')
      fail('CAPABILITY_UNAVAILABLE', 'Rollback capability is unavailable.');
    const inputArtifactIds = [
      ...new Set([action.sourceArtifactId, ...action.preconditionArtifactIds]),
    ].sort();
    if (!inputArtifactIds.includes(request.rollbackBaseline.artifactId)) {
      fail(
        'ROLLBACK_NOT_ELIGIBLE',
        'Rollback baseline is not one of the reviewed immutable Action inputs.',
      );
    }
    const assignment = buildAssignment(action, draft, inputArtifactIds);
    const grant = buildGrant({ action, authority, availability, draft, runtimeActorId });
    const operation = buildOperation({
      action,
      authority,
      assignment,
      plan,
      selection,
      binding,
      request,
      draft,
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
      plan,
      selection,
      binding,
      executorInput,
      draft,
      runtimeActorId,
      registry: configuredRegistry,
    });
    const authorityDecision = assertOperateAuthorityV2('operate.action.rollback', authorityContext);
    let targetBefore;
    try {
      targetBefore = trustedHost.inspect({
        targetAdapter,
        target: action.targetBinding,
        operationId: parent.operationId,
        expectedStateHash: plan.steps[0].expectedTargetHash,
      });
    } catch (error) {
      fail(
        'ROLLBACK_NOT_ELIGIBLE',
        'Rollback target no longer equals the plan-bound post-execution state.',
        {
          rollbackPlanId: plan.rollbackPlanId,
          cause: error?.code ?? error?.name ?? 'target-inspection-error',
        },
      );
    }
    if (
      !exact(targetBefore, ['value', 'revision', 'stateHash']) ||
      targetBefore.stateHash !== sha256Jcs(targetBefore.value) ||
      targetBefore.stateHash !== plan.steps[0].expectedTargetHash
    ) {
      fail(
        'ROLLBACK_NOT_ELIGIBLE',
        'Rollback target no longer equals the plan-bound post-execution state.',
        { rollbackPlanId: plan.rollbackPlanId },
      );
    }
    const finalDecision = assertOperateAuthorityV2('operate.action.rollback', authorityContext);
    if (sha256Jcs(authorityDecision) !== sha256Jcs(finalDecision))
      fail('OPERATION_CONFLICT', 'Rollback authority changed during preflight.');
    const reservation = terminalReservation(draft);
    let staged = currentState;
    const events = [];
    const created = runtimeEvent(staged, {
      eventId: draft.eventIds.assignmentCreated,
      timestamp: draft.preparedAt,
      cycleId: action.sourceCycleId,
      type: 'assignment.created',
      entityId: assignment.assignmentId,
      actor: { kind: 'engine', id: runtimeActorId },
      correlationId: draft.correlationId,
      payload: assignment,
    });
    const scheduled = scheduleOperatingRuntimeEventsV2([created], { initialState: staged });
    staged = scheduled.state;
    events.push(...scheduled.events);
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
            rollbackBaseline: {
              artifactId: request.rollbackBaseline.artifactId,
              contentHash: request.rollbackBaseline.contentHash,
            },
            targetBeforeHash: targetBefore.stateHash,
          },
          terminal: reservation,
        },
      },
    ]) {
      const event = runtimeEvent(staged, {
        ...input,
        timestamp: draft.preparedAt,
        cycleId: action.sourceCycleId,
        actor: { kind: 'engine', id: runtimeActorId },
        correlationId: draft.correlationId,
      });
      staged = reduceOperatingRuntimeEventsV2([event], { initialState: staged });
      events.push(event);
    }
    const committedIntent = await commitCheckpoint(checkpointStore, currentState, staged, {
      phase: 'rollback-intent',
      operationId: operation.operationId,
      requestFingerprint: operation.requestFingerprint,
    });
    currentState = committedIntent.state;
    if (!committedIntent.committed) {
      const elected = await rollbackReplay(currentState, request, draft, artifactStore);
      if (elected) return elected;
      fail('OPERATION_CONFLICT', 'A concurrent rollback operation already owns this plan.');
    }
    dispatchCount += 1;
    let receipt;
    try {
      receipt = await Promise.resolve(
        trustedHost.rollback({
          authorityContext,
          authorityDecision,
          executorInput,
          binding,
          executor: selection.registration,
          targetAdapter,
        }),
      );
      const durableAuthority = assertOperatingRollbackAuthorityChainV2({
        state: currentState,
        operationId: operation.operationId,
      });
      const receiptProof = createRollbackReceiptProof(
        operation,
        plan,
        durableAuthority.parentReplayEntry.terminalReceipt,
        receipt,
      );
      if (receiptProof.after.stateHash !== plan.baselineHash)
        fail(
          'OPERATION_UNCERTAIN',
          'Rollback receipt did not prove the exact baseline postcondition.',
        );
      provenTerminalOperations.add(operation.operationId);
      const result = buildRollbackResult({
        operation,
        plan,
        draft,
        reservation,
        receiptProof,
        status: 'succeeded',
      });
      // The contained host has proved exact baseline restoration. Unrelated
      // checkpoint appends may only rebase this same success; they must never
      // cause a second host call or downgrade the proven receipt to uncertain.
      for (let rebaseAttempt = 0; rebaseAttempt < 16; rebaseAttempt += 1) {
        const durableOperation = currentState.governedOperations.find(
          ({ operationId }) => operationId === operation.operationId,
        );
        if (!durableOperation) {
          fail(
            'OPERATION_CONFLICT',
            'The durable rollback owner disappeared during proven-success rebasing.',
            {
              operationId: operation.operationId,
              provenTerminal: true,
            },
          );
        }
        if (TERMINAL_STATES.has(durableOperation.state) && durableOperation.resultId !== null) {
          const durable = await rollbackReplay(currentState, request, draft, artifactStore);
          if (durable.result.resultHash !== result.resultHash) {
            fail(
              'OPERATION_CONFLICT',
              'A different terminal rollback result owns the reserved identities.',
              {
                operationId: operation.operationId,
                provenTerminal: true,
              },
            );
          }
          return durable;
        }
        const terminal = materializeRollbackResult({
          state: currentState,
          operation,
          assignment,
          action,
          result,
          draft,
          reservation,
          runtimeActorId,
        });
        if (
          !(await stageAndProveArtifactCustody(
            artifactStore,
            terminal.accepted.artifact,
            terminal.bytes,
          ))
        ) {
          fail(
            'OPERATION_UNCERTAIN',
            'Proven rollback success Artifact custody could not be established.',
            {
              operationId: operation.operationId,
              rollbackResultId: result.rollbackResultId,
              resultArtifactId: result.resultArtifactId,
              provenTerminal: true,
              recoveryDisposition: 'commit-proven-result-before-retry',
            },
          );
        }
        try {
          const committed = await commitCheckpoint(
            checkpointStore,
            currentState,
            terminal.finalState,
            {
              phase: 'rollback-result',
              operationId: operation.operationId,
              requestFingerprint: operation.requestFingerprint,
            },
          );
          currentState = committed.state;
          if (!committed.committed) continue;
          return freeze({
            state: clone(terminal.finalState),
            operation: clone(
              terminal.finalState.governedOperations.find(
                ({ operationId }) => operationId === operation.operationId,
              ),
            ),
            result: clone(result),
            artifact: clone(terminal.accepted.artifact),
            events: [
              ...events,
              ...terminal.accepted.events,
              terminal.resultRecorded,
              ...terminal.lifecycleEvents,
            ].map(clone),
            receipt: clone(receipt),
            replayed: false,
            dispatchCount: 1,
            effectCount: receipt.effectCount,
          });
        } catch (commitError) {
          if (commitError?.code !== 'OPERATION_UNCERTAIN') throw commitError;
          // Lost acknowledgement is resolved by the next exact CAS/replay
          // attempt against durable state, without touching the host again.
        }
      }
      fail(
        'OPERATION_UNCERTAIN',
        'Proven rollback success could not acquire the durable checkpoint after bounded rebasing.',
        {
          operationId: operation.operationId,
          rollbackResultId: result.rollbackResultId,
          provenTerminal: true,
          recoveryDisposition: 'commit-proven-result-before-retry',
        },
      );
    } catch (error) {
      if (
        provenTerminalOperations.has(operation.operationId) ||
        error?.details?.context?.provenTerminal === true
      ) {
        throw provenTerminalError(error, {
          operationId: operation.operationId,
          rollbackPlanId: plan.rollbackPlanId,
        });
      }
      const uncertaintyReservation = {
        resultId: reservation.uncertainty.resultId,
        resultArtifactId: reservation.uncertainty.resultArtifactId,
        submissionId: reservation.uncertainty.submissionId,
        eventIds: clone(reservation.uncertainty.eventIds),
      };
      const uncertainResult = buildRollbackResult({
        operation,
        plan,
        draft,
        reservation: uncertaintyReservation,
        receiptProof: null,
        status: 'uncertain',
      });
      const terminal = materializeRollbackResult({
        state: currentState,
        operation,
        assignment,
        action,
        result: uncertainResult,
        draft,
        reservation: uncertaintyReservation,
        runtimeActorId,
      });
      if (
        !(await stageAndProveArtifactCustody(
          artifactStore,
          terminal.accepted.artifact,
          terminal.bytes,
        ))
      ) {
        fail(
          'OPERATION_UNCERTAIN',
          'Rollback uncertainty bytes could not be placed in exact Artifact custody.',
          {
            operationId: operation.operationId,
            cause: error?.code ?? error?.name ?? 'rollback-error',
            rollbackResultId: null,
            recoveryDisposition: 'reconcile-before-retry',
          },
        );
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const durableOperation = currentState.governedOperations.find(
          ({ operationId }) => operationId === operation.operationId,
        );
        if (
          durableOperation &&
          TERMINAL_STATES.has(durableOperation.state) &&
          durableOperation.resultId !== null
        ) {
          const durable = await rollbackReplay(currentState, request, draft, artifactStore);
          fail(
            'OPERATION_UNCERTAIN',
            'Rollback dispatch has one durable terminal non-success result.',
            {
              operationId: durable.operation.operationId,
              cause: error?.code ?? error?.name ?? 'rollback-error',
              rollbackResultId: durable.result.rollbackResultId,
              recoveryDisposition: 'reconcile-before-retry',
            },
          );
        }
        const rebasedTerminal = materializeRollbackResult({
          state: currentState,
          operation,
          assignment,
          action,
          result: uncertainResult,
          draft,
          reservation: uncertaintyReservation,
          runtimeActorId,
        });
        try {
          const committed = await commitCheckpoint(
            checkpointStore,
            currentState,
            rebasedTerminal.finalState,
            {
              phase: 'rollback-result',
              operationId: operation.operationId,
              requestFingerprint: operation.requestFingerprint,
            },
          );
          currentState = committed.state;
          if (!committed.committed) continue;
          fail(
            'OPERATION_UNCERTAIN',
            'Rollback dispatch outcome is uncertain and cannot be retried blindly.',
            {
              operationId: operation.operationId,
              cause: error?.code ?? error?.name ?? 'rollback-error',
              causeMessage: error?.message ?? null,
              rollbackResultId: uncertainResult.rollbackResultId,
              recoveryDisposition: 'reconcile-before-retry',
            },
          );
        } catch (commitError) {
          if (
            commitError?.code !== 'OPERATION_UNCERTAIN' ||
            commitError?.details?.context?.rollbackResultId === uncertainResult.rollbackResultId
          )
            throw commitError;
        }
      }
      fail(
        'OPERATION_UNCERTAIN',
        'Rollback dispatch remains non-redispatchable without a durable uncertainty result.',
        {
          operationId: operation.operationId,
          cause: error?.code ?? error?.name ?? 'rollback-error',
          rollbackResultId: null,
          recoveryDisposition: 'reconcile-before-retry',
        },
      );
    }
  }

  async function rollback(request, draft, environment = {}) {
    const operationId = draft?.operationId;
    const invocationHash = sha256Jcs({ request, draft });
    const active = inFlight.get(operationId);
    if (active) {
      if (active.invocationHash !== invocationHash)
        fail('OPERATION_CONFLICT', 'Concurrent rollback identity reuse is divergent.', {
          operationId,
        });
      await active.promise;
      return rollbackReplay(
        currentState,
        assertRollbackRequest(request),
        assertRollbackDraft(draft),
        artifactStore,
      );
    }
    const promise = rollbackOnce(request, draft, environment);
    inFlight.set(operationId, { invocationHash, promise });
    try {
      return await promise;
    } finally {
      if (inFlight.get(operationId)?.promise === promise) inFlight.delete(operationId);
    }
  }

  return Object.freeze({
    rollback,
    reconcile: async (input) => {
      const checked = assertRuntimeReconcileInput(input);
      currentState = await readCheckpoint(checkpointStore, currentState);
      return reconcileOperatingGovernedDispatchV2({
        ...checked,
        state: currentState,
        registry: configuredRegistry,
      });
    },
    checkpoint: () => clone(currentState),
    getState: () => clone(currentState),
    get dispatchCount() {
      return dispatchCount;
    },
  });
}

export async function rollbackOperatingGovernedActionV2(request, draft, options = {}) {
  return createOperatingGovernedRecoveryRuntimeV2(options).rollback(request, draft, options);
}

export const OPERATING_GOVERNED_RECOVERY_CLASSIFICATIONS_V2 = Object.freeze([
  'applied',
  'not-applied',
  'partial',
  'unknown',
]);
