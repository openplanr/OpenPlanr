import { PipelineError } from '../protocol/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/canonical-json.mjs';
import { assertOperatingActionAuthorityTupleV2 } from './authorization-v2.mjs';
import {
  deriveOperatingExecutionVerificationStatusV2,
  deriveOperatingVerificationFeedbackV2,
  selectOperatingTerminalVerificationAssignmentV2,
} from './execution-verification-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';

function persistentWorkError(code, message, context = {}) {
  return new PipelineError(code, message, '', { retryable: false, context: structuredClone(context) });
}

function clone(value) {
  return structuredClone(value);
}

/** Immutable Action revision content; lifecycle state/time never alter identity. */
export function derivePersistentOperatingActionRevisionProjectionV2(action) {
  const projection = clone(action);
  for (const field of ['actionHash', 'revisionId', 'state', 'updatedAt']) delete projection[field];
  return projection;
}

export function derivePersistentOperatingActionRevisionHashV2(action) {
  return sha256Jcs(derivePersistentOperatingActionRevisionProjectionV2(action));
}

export function assertPersistentOperatingActionAuthorityV2(action) {
  const checked = assertOperatingActionAuthorityTupleV2(action);
  const expectedHash = derivePersistentOperatingActionRevisionHashV2(checked);
  const expectedRevisionId = `actrev_${sha256Jcs({
    actionId: checked.actionId,
    revision: checked.revision,
    actionHash: expectedHash,
  }).slice('sha256:'.length)}`;
  if (checked.actionHash !== expectedHash || checked.revisionId !== expectedRevisionId
    || (checked.revision === 1) !== (checked.predecessorRevisionId === null)) {
    throw persistentWorkError('ACTION_REVISION_MISMATCH', 'Action revision identity does not equal its immutable canonical content.', {
      actionId: checked.actionId,
      revision: checked.revision,
    });
  }
  return checked;
}

/** Safe rebuild projection for governed failure, recovery, and rollback history. */
export function derivePersistentOperatingRecoveryProjectionV2({ operation, result = null, rollbackPlan = null } = {}) {
  if (!operation || !['execute', 'rollback'].includes(operation.operationKind)
    || (result !== null && !['operating-execution-result', 'operating-rollback-result'].includes(result.kind))
    || (rollbackPlan !== null && rollbackPlan.kind !== 'operating-rollback-plan')) {
    throw persistentWorkError('RESULT_CONTRACT_INVALID', 'Recovery projection requires exact governed-operation history.');
  }
  return Object.freeze({
    operationId: operation.operationId,
    operationKind: operation.operationKind,
    action: clone(operation.action),
    state: operation.state,
    resultId: operation.resultId,
    rollbackPlanId: operation.rollbackPlanId ?? rollbackPlan?.rollbackPlanId ?? null,
    parentOperationId: operation.parentOperationId,
    verificationPlanId: operation.verificationPlanId,
    targetBeforeHash: result?.targetBeforeHash ?? null,
    targetAfterHash: result?.targetAfterHash ?? null,
    baselineArtifactId: result?.baselineArtifactId ?? rollbackPlan?.baselineArtifactId ?? null,
    baselineHash: result?.baselineHash ?? rollbackPlan?.baselineHash ?? null,
    projectionHash: sha256Jcs({
      operationId: operation.operationId,
      operationHash: operation.operationHash,
      resultHash: result?.resultHash ?? null,
      planHash: rollbackPlan?.planHash ?? null,
    }),
  });
}

function runtimeIssuedId(prefix, artifactId, canonicalHash, draftRef) {
  const digest = sha256Jcs({
    artifactId,
    canonicalHash,
    contract: 'operate-v2-persistent-work-materialization',
    draftRef,
    prefix,
  }).slice('sha256:'.length);
  return `${prefix}_${digest}`;
}

function requireTrimmedTitle(title, draftRef) {
  if (typeof title !== 'string' || title.length === 0 || title !== title.trim()) {
    throw persistentWorkError('RESULT_CONTRACT_INVALID',
      'Persistent-work titles must be trimmed nonblank display names.', { draftRef });
  }
}

function assertArtifactAndChangeSet({ artifact, changeSet, timestamp }) {
  try {
    assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: PROTOCOL_VERSION });
    assertProtocolArtifact('operating-work-change-set', changeSet, { protocolVersion: PROTOCOL_VERSION });
  } catch (error) {
    throw persistentWorkError('RESULT_CONTRACT_INVALID',
      'Persistent work requires a valid v2 Artifact and work-change-set.', { cause: error.code ?? null });
  }
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw persistentWorkError('STATE_TRANSITION_INVALID',
      'Persistent-work materialization requires an explicit Event timestamp.');
  }
  if (
    artifact.schemaId !== 'operating-work-change-set'
    || artifact.artifactSchemaVersion !== PROTOCOL_VERSION
    || artifact.mediaType !== 'application/json'
    || artifact.encoding !== 'utf-8'
    || artifact.canonicalHash === null
  ) {
    throw persistentWorkError('RESULT_CONTRACT_INVALID',
      'The source Artifact is not a canonical UTF-8 v2 operating-work-change-set.', {
        artifactId: artifact.artifactId,
      });
  }
  if (sha256Jcs(changeSet) !== artifact.canonicalHash) {
    throw persistentWorkError('RESULT_CONTRACT_INVALID',
      'The supplied work-change-set does not match the accepted Artifact canonical bytes.', {
        artifactId: artifact.artifactId,
      });
  }
  if (
    changeSet.cycleId !== artifact.cycleId
    || changeSet.scopeId !== artifact.scopeId
    || changeSet.domainId !== artifact.domainId
    || changeSet.domainVersion !== artifact.domainVersion
  ) {
    throw persistentWorkError('OPERATING_SCOPE_INVALID',
      'The work-change-set does not match the immutable Artifact provenance.', {
        artifactId: artifact.artifactId,
        cycleId: artifact.cycleId,
      });
  }
}

function assertUniqueDraftRefs(changeSet) {
  const refs = new Set();
  for (const draft of [...changeSet.findings, ...changeSet.decisions, ...changeSet.actions]) {
    if (refs.has(draft.draftRef)) {
      throw persistentWorkError('RESULT_CONTRACT_INVALID', 'Work-change-set draft references must be globally unique.', {
        draftRef: draft.draftRef,
      });
    }
    refs.add(draft.draftRef);
  }
}

function assertActionGraph(actions) {
  const actionRefs = new Set(actions.map(({ draftRef }) => draftRef));
  const pending = new Map(actions.map((draft) => [draft.draftRef, new Set(draft.dependsOnActionDraftRefs)]));
  for (const draft of actions) {
    for (const dependencyRef of draft.dependsOnActionDraftRefs) {
      if (dependencyRef === draft.draftRef || !actionRefs.has(dependencyRef)) {
        throw persistentWorkError('STATE_TRANSITION_INVALID',
          'Action dependency references must name another local Action draft.', {
            actionDraftRef: draft.draftRef,
            dependencyDraftRef: dependencyRef,
          });
      }
    }
  }
  let removed = true;
  while (removed) {
    removed = false;
    for (const [draftRef, dependencies] of pending) {
      if (dependencies.size !== 0) continue;
      pending.delete(draftRef);
      for (const remaining of pending.values()) remaining.delete(draftRef);
      removed = true;
    }
  }
  if (pending.size !== 0) {
    throw persistentWorkError('STATE_TRANSITION_INVALID', 'Persistent Action dependencies must form a local DAG.', {
      actionDraftRefs: [...pending.keys()].sort(),
    });
  }
}

/**
 * Creates the complete, runtime-owned payload for one accepted work-change-set.
 * Normal callers never provide durable entity identities: the runtime derives
 * them from immutable accepted Artifact identity plus a local draft reference.
 */
export function buildPersistentWorkMaterializationPayloadV2({ artifact, changeSet, timestamp }) {
  assertArtifactAndChangeSet({ artifact, changeSet, timestamp });
  assertUniqueDraftRefs(changeSet);

  const findingDrafts = new Map(changeSet.findings.map((draft) => [draft.draftRef, draft]));
  const decisionDrafts = new Map(changeSet.decisions.map((draft) => [draft.draftRef, draft]));
  for (const draft of changeSet.findings) requireTrimmedTitle(draft.title, draft.draftRef);
  for (const draft of changeSet.decisions) requireTrimmedTitle(draft.title, draft.draftRef);
  for (const draft of changeSet.actions) requireTrimmedTitle(draft.title, draft.draftRef);
  assertActionGraph(changeSet.actions);

  const base = {
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    scopeId: artifact.scopeId,
    domainId: artifact.domainId,
    domainVersion: artifact.domainVersion,
    sourceCycleId: artifact.cycleId,
    sourceArtifactId: artifact.artifactId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const findingIdByRef = new Map(changeSet.findings.map((draft) => [
    draft.draftRef,
    runtimeIssuedId('fnd', artifact.artifactId, artifact.canonicalHash, draft.draftRef),
  ]));
  const decisionIdByRef = new Map(changeSet.decisions.map((draft) => [
    draft.draftRef,
    runtimeIssuedId('dec', artifact.artifactId, artifact.canonicalHash, draft.draftRef),
  ]));
  const actionIdByRef = new Map(changeSet.actions.map((draft) => [
    draft.draftRef,
    runtimeIssuedId('act', artifact.artifactId, artifact.canonicalHash, draft.draftRef),
  ]));

  for (const draft of changeSet.actions) {
    if (draft.sourceDecisionDraftRef !== null && !decisionDrafts.has(draft.sourceDecisionDraftRef)) {
      throw persistentWorkError('STATE_TRANSITION_INVALID',
        'Action sourceDecisionDraftRef must name a local Decision draft.', {
          actionDraftRef: draft.draftRef,
          decisionDraftRef: draft.sourceDecisionDraftRef,
        });
    }
    for (const findingRef of draft.sourceFindingDraftRefs) {
      if (!findingDrafts.has(findingRef)) {
        throw persistentWorkError('STATE_TRANSITION_INVALID',
          'Action sourceFindingDraftRefs must name local Finding drafts.', {
            actionDraftRef: draft.draftRef,
            findingDraftRef: findingRef,
          });
      }
    }
  }

  const findings = changeSet.findings.map((draft) => ({
    kind: 'operating-finding',
    origin: 'persistent-work',
    ...base,
    findingId: findingIdByRef.get(draft.draftRef),
    title: draft.title,
    statement: draft.statement,
    state: draft.state,
    ownerActorId: draft.ownerActorId,
    revisitAt: draft.revisitAt,
  }));
  const decisions = changeSet.decisions.map((draft) => ({
    kind: 'operating-decision',
    origin: 'persistent-work',
    ...base,
    decisionId: decisionIdByRef.get(draft.draftRef),
    title: draft.title,
    question: draft.question,
    outcome: null,
    rationale: draft.rationale,
    evidenceRefIds: [...draft.evidenceRefIds],
    alternatives: [...draft.alternatives],
    confidence: draft.confidence,
    assumptionIds: [...draft.assumptionIds],
    expectedUpside: draft.expectedUpside,
    expectedDownside: draft.expectedDownside,
    dissent: [...draft.dissent],
    reopenConditions: [...draft.reopenConditions],
    revisitConditions: [...draft.revisitConditions],
    state: 'proposed',
    ownerActorId: draft.ownerActorId,
    revisitAt: draft.revisitAt,
    revision: 1,
    predecessorDecisionId: null,
    historyDecisionIds: [],
  }));
  const actions = changeSet.actions.map((draft) => ({
    kind: 'operating-action',
    ...base,
    actionId: actionIdByRef.get(draft.draftRef),
    title: draft.title,
    state: 'proposed',
    ownerActorId: draft.ownerActorId,
    accountabilityDisposition: draft.accountabilityDisposition,
    sourceDecisionId: draft.sourceDecisionDraftRef === null ? null : decisionIdByRef.get(draft.sourceDecisionDraftRef),
    sourceFindingIds: draft.sourceFindingDraftRefs.map((reference) => findingIdByRef.get(reference)),
    dependsOnActionIds: draft.dependsOnActionDraftRefs.map((reference) => actionIdByRef.get(reference)),
    objectiveId: draft.objectiveId,
    expectedResult: draft.expectedResult,
    metricId: draft.metricId,
    baseline: draft.baseline,
    target: draft.target,
    verificationWindow: draft.verificationWindow,
    verificationPlanId: draft.verificationPlanId,
  }));

  for (const [kind, records] of [
    ['operating-finding', findings],
    ['operating-decision', decisions],
    ['operating-action', actions],
  ]) {
    for (const record of records) {
      try {
        assertProtocolArtifact(kind, record, { protocolVersion: PROTOCOL_VERSION });
      } catch (error) {
        throw persistentWorkError('RESULT_CONTRACT_INVALID',
          'The runtime-generated persistent-work record is not contract-valid.', {
            kind,
            cause: error.code ?? null,
          });
      }
    }
  }
  return Object.freeze({
    artifactId: artifact.artifactId,
    canonicalHash: artifact.canonicalHash,
    changeSet: clone(changeSet),
    findings: Object.freeze(findings),
    decisions: Object.freeze(decisions),
    actions: Object.freeze(actions),
  });
}

export function assertPersistentWorkMaterializationPayloadV2(payload, options) {
  const expected = buildPersistentWorkMaterializationPayloadV2(options);
  if (sha256Jcs(payload) !== sha256Jcs(expected)) {
    throw persistentWorkError('STATE_TRANSITION_INVALID',
      'Persistent-work materialization payload does not match runtime-issued identities and provenance.', {
        artifactId: options.artifact?.artifactId ?? null,
      });
  }
  return expected;
}

/**
 * Promote one proposed Phase 3 Action into an exact Phase 6 authority revision.
 * The caller supplies policy/capability data, never an Action hash or revision
 * identity; both are derived from the complete immutable record.
 */
export function promotePersistentOperatingActionAuthorityV2(action, {
  actionKind,
  requestedCapability,
  targetBinding,
  effectClass,
  preconditionArtifactIds,
  executionBinding,
  updatedAt,
} = {}) {
  try {
    assertProtocolArtifact('operating-action', action, { protocolVersion: PROTOCOL_VERSION });
  } catch (error) {
    throw persistentWorkError('RESULT_CONTRACT_INVALID', 'Action promotion requires one valid persistent Action.', {
      cause: error.code ?? null,
    });
  }
  if (action.state !== 'proposed') {
    throw persistentWorkError('STATE_TRANSITION_INVALID', 'Only a proposed Action may receive its initial governed authority tuple.', {
      actionId: action.actionId,
      state: action.state,
    });
  }
  if (Object.hasOwn(action, 'revisionId')) {
    throw persistentWorkError('CONCURRENT_MODIFICATION', 'A governed Action revision cannot be promoted a second time.', {
      actionId: action.actionId,
      revisionId: action.revisionId,
    });
  }
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))
    || Date.parse(updatedAt) < Date.parse(action.createdAt)) {
    throw persistentWorkError('STATE_TRANSITION_INVALID', 'Action promotion requires one causal explicit timestamp.', {
      actionId: action.actionId,
    });
  }
  const governed = {
    ...clone(action),
    revision: 1,
    predecessorRevisionId: null,
    actionKind: clone(actionKind),
    requestedCapability: clone(requestedCapability),
    targetBinding: clone(targetBinding),
    effectClass,
    preconditionArtifactIds: [...new Set(preconditionArtifactIds ?? [])].sort(),
    executionBinding: clone(executionBinding),
    updatedAt,
  };
  governed.actionHash = derivePersistentOperatingActionRevisionHashV2(governed);
  governed.revisionId = `actrev_${sha256Jcs({
    actionId: governed.actionId,
    revision: governed.revision,
    actionHash: governed.actionHash,
  }).slice('sha256:'.length)}`;
  try {
    assertProtocolArtifact('operating-action', governed, { protocolVersion: PROTOCOL_VERSION });
    assertPersistentOperatingActionAuthorityV2(governed);
  } catch (error) {
    throw persistentWorkError('RESULT_CONTRACT_INVALID', 'Promoted Action authority tuple is not contract-valid.', {
      actionId: action.actionId,
      cause: error.code ?? null,
    });
  }
  return assertPersistentOperatingActionAuthorityV2(governed);
}

/**
 * Project persistent Action execution and verification without relocating the
 * Action into a Cycle-local queue. Exact operation/result/plan provenance is
 * retained across Cycle closure and later snapshots.
 */
export function derivePersistentOperatingExecutionVerificationProjectionV2({
  action,
  verificationPlan,
  operations = [],
  executionResults = [],
  rollbackResults = [],
  verificationAssignments = [],
  outcomes = [],
  learnings = [],
  deltas = [],
  snapshots = [],
  sourceCycle = null,
  cycle = null,
} = {}) {
  assertPersistentOperatingActionAuthorityV2(action);
  try {
    assertProtocolArtifact('operating-action-verification-plan', verificationPlan, { protocolVersion: PROTOCOL_VERSION });
  } catch (error) {
    throw persistentWorkError('RESULT_CONTRACT_INVALID', 'Persistent execution projection requires the Action verification plan.', {
      actionId: action.actionId,
      cause: error.code ?? null,
    });
  }
  if (verificationPlan.actionId !== action.actionId
    || verificationPlan.verificationPlanId !== action.verificationPlanId
    || verificationPlan.scopeId !== action.scopeId
    || verificationPlan.domainId !== action.domainId
    || verificationPlan.domainVersion !== action.domainVersion) {
    throw persistentWorkError('ACTION_REVISION_MISMATCH', 'Persistent execution projection plan does not own the exact Action.');
  }
  const exactScope = (record) => record?.scopeId === action.scopeId
    && record.domainId === action.domainId
    && record.domainVersion === action.domainVersion;
  const ownedOperations = operations.filter(({ action: tuple }) => (
    tuple?.actionId === action.actionId
    && tuple.revision === action.revision
    && tuple.actionHash === action.actionHash
  )).sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)
    || left.operationId.localeCompare(right.operationId));
  const operation = ownedOperations.at(-1) ?? null;
  const executionResultMatches = operation?.operationKind === 'execute'
    ? executionResults.filter(({ resultId }) => resultId === operation.resultId)
    : [];
  const rollbackResultMatches = operation?.operationKind === 'rollback'
    ? rollbackResults.filter(({ rollbackResultId }) => rollbackResultId === operation.resultId)
    : [];
  if (executionResultMatches.length > 1 || rollbackResultMatches.length > 1) {
    throw persistentWorkError('RESULT_CONTRACT_INVALID', 'Persistent execution projection rejects ambiguous terminal result ownership.', {
      actionId: action.actionId,
      operationId: operation?.operationId ?? null,
    });
  }
  const executionResult = executionResultMatches[0] ?? null;
  const rollbackResult = rollbackResultMatches[0] ?? null;
  const result = executionResult ?? rollbackResult;
  const resultOperationId = result?.operationId ?? result?.rollbackOperationId ?? null;
  if (result && (resultOperationId !== operation.operationId
    || result.verificationPlanId !== verificationPlan.verificationPlanId
    || result.action.actionId !== action.actionId
    || result.action.revision !== action.revision
    || result.action.actionHash !== action.actionHash)) {
    throw persistentWorkError('ACTION_REVISION_MISMATCH', 'Persistent execution result does not retain the exact Action, operation, and verification plan.', {
      actionId: action.actionId,
      operationId: operation.operationId,
      resultId: operation.resultId,
    });
  }
  const executionStatus = rollbackResult
    ? deriveOperatingExecutionVerificationStatusV2({ rollbackResult })
    : executionResult
      ? deriveOperatingExecutionVerificationStatusV2({ result: executionResult })
      : action.state === 'cancelled' ? 'cancelled' : null;
  if (operation && result && (!sourceCycle
    || sourceCycle.cycleId !== action.sourceCycleId
    || !exactScope(sourceCycle))) {
    throw persistentWorkError('OPERATING_SCOPE_INVALID', 'Persistent execution projection requires the exact source Cycle scope and domain version.', {
      actionId: action.actionId,
      sourceCycleId: action.sourceCycleId,
    });
  }
  const assignment = operation && result
    ? selectOperatingTerminalVerificationAssignmentV2({
      assignments: verificationAssignments,
      action,
      cycle: sourceCycle,
      operation,
      result,
      verificationPlan,
      timestamp: result.completedAt,
    })
    : null;
  const outcome = outcomes.filter((candidate) => (
    exactScope(candidate)
    && candidate.actionId === action.actionId
    && candidate.verificationPlanId === verificationPlan.verificationPlanId
  )).sort((left, right) => left.observedAt.localeCompare(right.observedAt)
    || left.outcomeId.localeCompare(right.outcomeId)).at(-1) ?? null;
  const learning = outcome
    ? learnings.filter((candidate) => (
      exactScope(candidate) && candidate.outcomeId === outcome.outcomeId
    )).sort((left, right) => left.createdAt.localeCompare(right.createdAt)
      || left.learningId.localeCompare(right.learningId)).at(-1) ?? null
    : null;
  const scopedDeltas = deltas.filter(exactScope).sort((left, right) => (
    left.derivedAt.localeCompare(right.derivedAt) || left.deltaId.localeCompare(right.deltaId)
  ));
  const scopedSnapshots = snapshots.filter(exactScope).sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt) || left.snapshotId.localeCompare(right.snapshotId)
  ));
  const delta = scopedDeltas.at(-1) ?? null;
  const snapshot = delta
    ? scopedSnapshots.find(({ snapshotId }) => snapshotId === delta.currentSnapshotId) ?? null
    : scopedSnapshots.at(-1) ?? null;
  if (delta && !snapshot) {
    throw persistentWorkError('STATE_TRANSITION_INVALID', 'Persistent verification Delta is missing its exact current Snapshot.', {
      actionId: action.actionId,
      deltaId: delta.deltaId,
      currentSnapshotId: delta.currentSnapshotId,
    });
  }
  const feedback = executionStatus
    ? deriveOperatingVerificationFeedbackV2({
      action,
      verificationPlan,
      executionStatus,
      sourceCycle: operation && result ? sourceCycle : null,
      operation,
      result,
      verificationAssignments: operation && result ? verificationAssignments : null,
      outcome,
      learning,
      delta,
      snapshot,
      cycle,
    })
    : null;
  const projection = {
    actionId: action.actionId,
    actionRevision: action.revision,
    actionHash: action.actionHash,
    sourceCycleId: action.sourceCycleId,
    currentCycleId: cycle?.cycleId ?? null,
    actionState: action.state,
    operationId: operation?.operationId ?? null,
    resultId: operation?.resultId ?? null,
    verificationPlanId: verificationPlan.verificationPlanId,
    verificationAssignmentId: assignment?.assignmentId ?? null,
    executionStatus,
    hypothesisStatus: feedback?.hypothesisStatus ?? 'pending',
    outcomeId: outcome?.outcomeId ?? null,
    learningId: learning?.learningId ?? null,
    deltaId: delta?.deltaId ?? null,
    snapshotId: snapshot?.snapshotId ?? null,
    carriedForward: cycle !== null && cycle.cycleId !== action.sourceCycleId,
  };
  return Object.freeze({ ...projection, projectionHash: sha256Jcs(projection) });
}
