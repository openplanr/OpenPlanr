import { PipelineError } from '@openplanr/protocol/errors';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { sha256Jcs } from '@openplanr/protocol/canonical-json';

const PROTOCOL_VERSION = '2.0.0';

export const OPERATING_EXECUTION_VERIFICATION_STATUSES_V2 = Object.freeze([
  'success',
  'failure',
  'blocked',
  'uncertain',
  'partial',
  'cancelled',
  'rolled-back',
]);

export const OPERATING_HYPOTHESIS_VERIFICATION_STATUSES_V2 = Object.freeze([
  'pending',
  'confirmed',
  'failed',
  'blocked',
  'cancelled',
  'revisit',
]);

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', { retryable: false, context: structuredClone(context) });
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

function typed(kind, value, subject) {
  try {
    assertProtocolArtifact(kind, value, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', `${subject} must be one exact ${kind} record.`, {
      cause: cause?.code ?? cause?.name ?? null,
    });
  }
  return value;
}

function exactActionTuple(action, operation, result) {
  const tuple = operation?.action;
  if (!tuple
    || tuple.actionId !== action.actionId
    || tuple.revision !== action.revision
    || tuple.actionHash !== action.actionHash
    || result?.action?.actionId !== tuple.actionId
    || result?.action?.revision !== tuple.revision
    || result?.action?.actionHash !== tuple.actionHash) {
    fail('ACTION_REVISION_MISMATCH', 'Execution verification must retain one exact Action authority tuple.', {
      actionId: action?.actionId ?? null,
      operationId: operation?.operationId ?? operation?.rollbackOperationId ?? null,
    });
  }
}

function exactOperatingScope(action, record, subject) {
  if (record.scopeId !== action.scopeId
    || record.domainId !== action.domainId
    || record.domainVersion !== action.domainVersion) {
    fail('OPERATING_SCOPE_INVALID', `${subject} must retain the exact Action scope and domain version.`, {
      actionId: action.actionId,
      scopeId: action.scopeId,
      domainId: action.domainId,
      domainVersion: action.domainVersion,
    });
  }
}

function exactVerificationPlanOwnership(action, verificationPlan) {
  exactOperatingScope(action, verificationPlan, 'Action verification plan');
  if (action.verificationPlanId !== verificationPlan.verificationPlanId
    || verificationPlan.actionId !== action.actionId) {
    fail('ACTION_REVISION_MISMATCH', 'Verification plan must retain the exact Action identity.', {
      actionId: action.actionId,
      verificationPlanId: verificationPlan.verificationPlanId,
    });
  }
}

function digestIdentity(prefix, seed) {
  return `${prefix}_${sha256Jcs(seed).slice('sha256:'.length)}`;
}

function operationResultId(result) {
  return result?.resultId ?? result?.rollbackResultId ?? null;
}

function operationIdFor(result) {
  return result?.operationId ?? result?.rollbackOperationId ?? null;
}

function mapTerminalStatus(status, { rollback = false, cancelled = false } = {}) {
  if (cancelled) return 'cancelled';
  if (rollback && status === 'succeeded') return 'rolled-back';
  return ({
    succeeded: 'success',
    failed: 'failure',
    blocked: 'blocked',
    uncertain: 'uncertain',
    partial: 'partial',
    cancelled: 'cancelled',
    'rolled-back': 'rolled-back',
  })[status] ?? null;
}

export function deriveOperatingExecutionVerificationStatusV2({
  result = null,
  rollbackResult = null,
  cancelled = false,
} = {}) {
  if (cancelled) return 'cancelled';
  if (rollbackResult !== null) {
    typed('operating-rollback-result', rollbackResult, 'Rollback verification result');
    return mapTerminalStatus(rollbackResult.status, { rollback: true });
  }
  if (result !== null) {
    typed('operating-execution-result', result, 'Execution verification result');
    return mapTerminalStatus(result.status);
  }
  fail('RESULT_CONTRACT_INVALID', 'Execution verification requires a terminal execution or rollback result.');
}

export function deriveOperatingExecutionLifecycleIdentitiesV2({ operationId, resultId }) {
  if (typeof operationId !== 'string' || operationId.length === 0
    || typeof resultId !== 'string' || resultId.length === 0) {
    fail('RESULT_CONTRACT_INVALID', 'Lifecycle identities require exact operation and result identities.');
  }
  const seed = { protocolVersion: PROTOCOL_VERSION, operationId, resultId };
  return freeze({
    assignmentId: digestIdentity('asg_vfy', seed),
    eventIds: {
      actionQueued: digestIdentity('evt_xvl_queue', seed),
      actionStarted: digestIdentity('evt_xvl_start', seed),
      cycleExecuting: digestIdentity('evt_xvl_execute', seed),
      actionTerminal: digestIdentity('evt_xvl_terminal', seed),
      verificationAssignmentCreated: digestIdentity('evt_xvl_verify', seed),
      cycleVerifying: digestIdentity('evt_xvl_cycle_verify', seed),
    },
  });
}

export function buildOperatingTerminalVerificationAssignmentV2({
  action,
  cycle,
  operation,
  result,
  verificationPlan,
  timestamp,
} = {}) {
  typed('operating-action', action, 'Verification-owned Action');
  typed('operating-cycle', cycle, 'Verification-owned Cycle');
  typed('operating-governed-operation', operation, 'Verification-owned operation');
  const resultKind = result?.kind === 'operating-rollback-result'
    ? 'operating-rollback-result'
    : 'operating-execution-result';
  typed(resultKind, result, 'Verification-owned terminal result');
  typed('operating-action-verification-plan', verificationPlan, 'Execution verification plan');
  exactActionTuple(action, operation, result);
  exactOperatingScope(action, cycle, 'Verification-owned Cycle');
  exactVerificationPlanOwnership(action, verificationPlan);
  const resultId = operationResultId(result);
  const operationId = operationIdFor(result);
  if (operation.operationId !== operationId
    || operation.resultId !== resultId
    || action.sourceCycleId !== cycle.cycleId
    || action.verificationPlanId !== verificationPlan.verificationPlanId
    || verificationPlan.actionId !== action.actionId
    || result.verificationPlanId !== verificationPlan.verificationPlanId
    || result.assignmentId !== operation.assignmentId
    || typeof timestamp !== 'string'
    || Number.isNaN(Date.parse(timestamp))) {
    fail('STATE_TRANSITION_INVALID', 'Terminal verification ownership must bind one Action, Cycle, plan, operation, and result.', {
      actionId: action.actionId,
      operationId: operation.operationId,
      resultId,
      verificationPlanId: verificationPlan.verificationPlanId,
    });
  }
  const identities = deriveOperatingExecutionLifecycleIdentitiesV2({ operationId, resultId });
  const assignment = {
    kind: 'operating-assignment',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    assignmentId: identities.assignmentId,
    cycleId: cycle.cycleId,
    assignmentKind: 'verification',
    roleId: 'operate-action-verifier',
    objective: `Verify Action ${action.actionId} against plan ${verificationPlan.verificationPlanId}; effect completion does not imply hypothesis success.`,
    state: 'pending',
    dependsOn: [],
    dependencyPolicy: { kind: 'none' },
    inputArtifactIds: [...new Set([
      verificationPlan.sourceArtifactId,
      result.resultArtifactId,
    ])].sort(),
    inputAbsences: [],
    outputContract: {
      schemaId: 'operating-outcome',
      schemaVersion: PROTOCOL_VERSION,
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262144,
    },
    capabilityGrantId: operation.grantId,
    governedOperationId: operation.operationId,
    attemptPolicy: { maxAttempts: 1, attempt: 0, timeoutMs: 30000 },
    claim: null,
    terminalOutcome: null,
    createdAt: timestamp,
    availableAt: null,
    completedAt: null,
  };
  typed('operating-assignment', assignment, 'Terminal verification Assignment');
  return freeze(assignment);
}

/**
 * Select the one runtime-owned verification Assignment for a terminal result.
 * Input order never selects an owner: the deterministic identity and complete
 * canonical Assignment must both equal the Action/Cycle/plan/operation/result.
 */
export function selectOperatingTerminalVerificationAssignmentV2({
  assignments,
  action,
  cycle,
  operation,
  result,
  verificationPlan,
  timestamp = result?.completedAt,
} = {}) {
  if (!Array.isArray(assignments)) {
    fail('RESULT_CONTRACT_INVALID', 'Verification Assignment selection requires one explicit candidate collection.');
  }
  const expected = buildOperatingTerminalVerificationAssignmentV2({
    action, cycle, operation, result, verificationPlan, timestamp,
  });
  const candidates = assignments.filter((candidate) => (
    candidate?.assignmentId === expected.assignmentId
    || (candidate?.assignmentKind === 'verification'
      && candidate?.governedOperationId === operation.operationId)
  ));
  for (const candidate of candidates) {
    typed('operating-assignment', candidate, 'Terminal verification Assignment candidate');
  }
  if (candidates.length !== 1 || sha256Jcs(candidates[0]) !== sha256Jcs(expected)) {
    fail('RESULT_CONTRACT_INVALID', 'Terminal result requires exactly one canonical verification Assignment owner.', {
      actionId: action.actionId,
      operationId: operation.operationId,
      resultId: operationResultId(result),
      expectedAssignmentId: expected.assignmentId,
      candidateAssignmentIds: candidates.map(({ assignmentId }) => assignmentId).sort(),
    });
  }
  return freeze(clone(candidates[0]));
}

function actionTransition(action, from, to, operationId, resultId, reasonCode) {
  return freeze({
    action: {
      actionId: action.actionId,
      revision: action.revision,
      actionHash: action.actionHash,
    },
    from,
    to,
    operationId,
    resultId,
    reasonCode,
  });
}

function cycleTransition(cycle, from, to, actionId, operationId, resultId, reasonCode) {
  return freeze({ cycleId: cycle.cycleId, from, to, actionId, operationId, resultId, reasonCode });
}

export function buildOperatingExecutionLifecycleV2({
  action,
  cycle,
  operation,
  result,
  verificationPlan,
  timestamp = result?.completedAt,
  recovery = null,
} = {}) {
  typed('operating-action', action, 'Execution lifecycle Action');
  typed('operating-cycle', cycle, 'Execution lifecycle Cycle');
  typed('operating-governed-operation', operation, 'Execution lifecycle operation');
  typed('operating-execution-result', result, 'Execution lifecycle result');
  exactActionTuple(action, operation, result);
  if (operation.operationKind !== 'execute'
    || operation.operationId !== result.operationId
    || operation.resultId !== result.resultId
    || cycle.cycleId !== action.sourceCycleId
    || cycle.state !== 'approved'
    || !['approved', 'blocked'].includes(action.state)) {
    fail('STATE_TRANSITION_INVALID', 'Execution lifecycle starts only from one approved Cycle and approved or explicitly recoverable Action.', {
      actionState: action.state,
      cycleState: cycle.state,
      operationId: operation.operationId,
    });
  }
  const recovered = action.state === 'blocked';
  if (recovered && (!recovery
    || typeof recovery.priorResultId !== 'string'
    || typeof recovery.reasonCode !== 'string')) {
    fail('STATE_TRANSITION_INVALID', 'A blocked Action requires explicit prior-result recovery provenance.');
  }
  const executionStatus = deriveOperatingExecutionVerificationStatusV2({ result });
  const terminalSucceeded = executionStatus === 'success';
  const terminalReason = terminalSucceeded ? null : `execution-${executionStatus}`;
  const assignment = buildOperatingTerminalVerificationAssignmentV2({
    action, cycle, operation, result, verificationPlan, timestamp,
  });
  const identities = deriveOperatingExecutionLifecycleIdentitiesV2({
    operationId: operation.operationId,
    resultId: result.resultId,
  });
  return freeze({
    executionStatus,
    hypothesisStatus: 'pending',
    identities,
    verificationAssignment: assignment,
    transitions: {
      actionQueued: actionTransition(
        action,
        action.state,
        'queued',
        operation.operationId,
        recovered ? recovery.priorResultId : null,
        recovered ? recovery.reasonCode : null,
      ),
      actionStarted: actionTransition(action, 'queued', 'in_progress', operation.operationId, null, null),
      cycleExecuting: cycleTransition(cycle, 'approved', 'executing', action.actionId, operation.operationId, null, null),
      actionTerminal: actionTransition(
        action,
        'in_progress',
        terminalSucceeded ? 'completed' : 'blocked',
        operation.operationId,
        result.resultId,
        terminalReason,
      ),
      cycleVerifying: cycleTransition(
        cycle,
        'executing',
        'verifying',
        action.actionId,
        operation.operationId,
        result.resultId,
        null,
      ),
    },
  });
}

export function buildOperatingRollbackVerificationV2({
  action,
  cycle,
  operation,
  result,
  verificationPlan,
  timestamp = result?.completedAt,
} = {}) {
  typed('operating-action', action, 'Rollback verification Action');
  typed('operating-cycle', cycle, 'Rollback verification Cycle');
  typed('operating-governed-operation', operation, 'Rollback verification operation');
  typed('operating-rollback-result', result, 'Rollback verification result');
  exactActionTuple(action, operation, result);
  if (operation.operationKind !== 'rollback'
    || operation.operationId !== result.rollbackOperationId
    || operation.resultId !== result.rollbackResultId
    || !['approved', 'executing', 'verifying'].includes(cycle.state)) {
    fail('STATE_TRANSITION_INVALID', 'Rollback verification requires one terminal rollback in its active Action Cycle.', {
      operationId: operation.operationId,
      cycleState: cycle.state,
    });
  }
  const executionStatus = deriveOperatingExecutionVerificationStatusV2({ rollbackResult: result });
  return freeze({
    executionStatus,
    hypothesisStatus: 'revisit',
    identities: deriveOperatingExecutionLifecycleIdentitiesV2({
      operationId: operation.operationId,
      resultId: result.rollbackResultId,
    }),
    verificationAssignment: buildOperatingTerminalVerificationAssignmentV2({
      action, cycle, operation, result, verificationPlan, timestamp,
    }),
  });
}

export function deriveOperatingVerificationFeedbackV2({
  action,
  verificationPlan,
  executionStatus,
  sourceCycle = null,
  operation = null,
  result = null,
  verificationAssignments = null,
  outcome = null,
  learning = null,
  delta = null,
  snapshot = null,
  cycle = null,
} = {}) {
  typed('operating-action', action, 'Verification feedback Action');
  typed('operating-action-verification-plan', verificationPlan, 'Verification feedback plan');
  exactVerificationPlanOwnership(action, verificationPlan);
  if (!OPERATING_EXECUTION_VERIFICATION_STATUSES_V2.includes(executionStatus)
  ) {
    fail('RESULT_CONTRACT_INVALID', 'Verification feedback requires one exact Action plan and execution status.', {
      actionId: action.actionId,
      executionStatus,
    });
  }
  if (outcome !== null) {
    typed('operating-outcome', outcome, 'Verification feedback Outcome');
    exactOperatingScope(action, outcome, 'Verification Outcome');
    if (outcome.actionId !== action.actionId
      || outcome.verificationPlanId !== verificationPlan.verificationPlanId) {
      fail('OPERATING_SCOPE_INVALID', 'Verification Outcome must retain the exact Action and plan.');
    }
  }
  if (learning !== null) {
    typed('operating-learning', learning, 'Verification feedback Learning');
    exactOperatingScope(action, learning, 'Verification Learning');
    if (!outcome
      || learning.outcomeId !== outcome.outcomeId
      || learning.sourceArtifactId !== outcome.sourceArtifactId
      || sha256Jcs(learning.evidenceRefIds) !== sha256Jcs(outcome.evidenceRefIds)) {
      fail('STATE_TRANSITION_INVALID', 'Verification Learning must be atomically owned by its exact Outcome.');
    }
  }
  if (delta !== null) {
    typed('operating-delta', delta, 'Verification feedback Delta');
    exactOperatingScope(action, delta, 'Verification Delta');
  }
  if (snapshot !== null) {
    typed('operating-snapshot', snapshot, 'Verification feedback Snapshot');
    exactOperatingScope(action, snapshot, 'Verification Snapshot');
  }
  if (delta !== null && snapshot !== null && delta.currentSnapshotId !== snapshot.snapshotId) {
    fail('STATE_TRANSITION_INVALID', 'Verification Delta must bind the exact supplied later Snapshot.', {
      deltaId: delta.deltaId,
      currentSnapshotId: delta.currentSnapshotId,
      snapshotId: snapshot.snapshotId,
    });
  }
  if (cycle !== null) {
    typed('operating-cycle', cycle, 'Verification feedback Cycle');
    exactOperatingScope(action, cycle, 'Verification Cycle');
  }
  const ownershipInputs = [sourceCycle, operation, result, verificationAssignments];
  const hasOwnership = ownershipInputs.some((value) => value !== null);
  let verificationAssignment = null;
  if (hasOwnership) {
    if (!sourceCycle || !operation || !result || !Array.isArray(verificationAssignments)) {
      fail('RESULT_CONTRACT_INVALID', 'Verification feedback ownership requires the complete source Cycle, operation, result, and Assignment set.');
    }
    verificationAssignment = selectOperatingTerminalVerificationAssignmentV2({
      assignments: verificationAssignments,
      action,
      cycle: sourceCycle,
      operation,
      result,
      verificationPlan,
      timestamp: result.completedAt,
    });
  }

  const changedSubjects = new Set([
    ...(delta?.sourceRevisionChanges?.map(({ subjectId }) => subjectId) ?? []),
    ...(delta?.metricChanges?.map(({ subjectId }) => subjectId) ?? []),
    ...(delta?.decisionRevisitIds ?? []),
  ]);
  const revisit = changedSubjects.has(action.actionId)
    || changedSubjects.has(verificationPlan.metricId)
    || verificationPlan.revisitDecisionIds.some((id) => changedSubjects.has(id));
  let hypothesisStatus = 'pending';
  if (executionStatus === 'cancelled') hypothesisStatus = 'cancelled';
  else if (executionStatus === 'rolled-back') hypothesisStatus = 'revisit';
  else if (['failure', 'blocked', 'uncertain', 'partial'].includes(executionStatus)) hypothesisStatus = 'blocked';
  if (outcome?.status === 'succeeded') hypothesisStatus = 'confirmed';
  else if (outcome?.status === 'failed') hypothesisStatus = 'failed';
  else if (outcome?.status === 'cancelled') hypothesisStatus = 'cancelled';
  else if (outcome && ['blocked', 'insufficient-evidence'].includes(outcome.status)) hypothesisStatus = 'blocked';
  if (revisit && !['cancelled', 'failed'].includes(hypothesisStatus)) hypothesisStatus = 'revisit';

  return freeze({
    actionId: action.actionId,
    verificationPlanId: verificationPlan.verificationPlanId,
    operationId: operationIdFor(result),
    resultId: operationResultId(result),
    verificationAssignmentId: verificationAssignment?.assignmentId ?? null,
    executionStatus,
    hypothesisStatus,
    executionCompleted: ['success', 'rolled-back'].includes(executionStatus),
    hypothesisConfirmed: hypothesisStatus === 'confirmed',
    revisit,
    cycleClosed: cycle?.state === 'closed',
    provenance: {
      outcomeId: outcome?.outcomeId ?? null,
      learningId: learning?.learningId ?? null,
      deltaId: delta?.deltaId ?? null,
      snapshotId: snapshot?.snapshotId ?? null,
      sourceArtifactId: outcome?.sourceArtifactId ?? verificationPlan.sourceArtifactId,
      observationIds: clone(outcome?.observationIds ?? []),
      evidenceRefIds: clone(outcome?.evidenceRefIds ?? []),
    },
  });
}
