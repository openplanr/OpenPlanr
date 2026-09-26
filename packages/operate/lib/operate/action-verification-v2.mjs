import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { PipelineError } from '@openplanr/protocol/errors';
import { deriveOperatingVerificationFeedbackV2 } from './execution-verification-v2.mjs';
import { assertOperatingSnapshotV2 } from './operating-snapshots-v2.mjs';
import { assertOperatingModelStateV2 } from './operating-state-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';
const MAX_OPERATING_ACTION_HYPOTHESES_PER_LEDGER_V2 = 512;

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', {
    retryable: false,
    context: structuredClone(context),
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

function sameScope(left, right) {
  return (
    left?.scopeId === right?.scopeId &&
    left?.domainId === right?.domainId &&
    left?.domainVersion === right?.domainVersion
  );
}

function timestamp(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    fail('STATE_TRANSITION_INVALID', `${field} must be an explicit Event timestamp.`);
  }
}

function stableId(prefix, value) {
  return `${prefix}_${sha256Jcs(value).slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

function canonicalIds(values, subject, { required = false } = {}) {
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== 'string' || value.length === 0)
  ) {
    fail('RESULT_CONTRACT_INVALID', `${subject} must be an array of durable identities.`);
  }
  if ((required && values.length === 0) || new Set(values).size !== values.length) {
    fail(
      'RESULT_CONTRACT_INVALID',
      `${subject} must be nonempty when required and contain no duplicate identities.`,
    );
  }
  return [...values].sort();
}

function checkedSnapshotState(snapshot, operatingState) {
  try {
    const state = assertOperatingModelStateV2(operatingState);
    return { state, snapshot: assertOperatingSnapshotV2(snapshot, { state }) };
  } catch (cause) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Action verification requires one valid immutable snapshot and exact operating-model state.',
      {
        cause: cause?.code ?? null,
      },
    );
  }
}

function assertLedger(ledger, snapshot) {
  try {
    assertProtocolArtifact('operating-decision-ledger', ledger, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch (cause) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Action verification requires a typed challenged Chair ledger.',
      {
        cause: cause?.code ?? null,
      },
    );
  }
  if (!sameScope(ledger, snapshot) || ledger.snapshotId !== snapshot.snapshotId) {
    fail(
      'OPERATING_SCOPE_INVALID',
      'The challenged Chair ledger must bind the exact immutable snapshot and scope.',
    );
  }
  const actionCount = ledger.decisions.reduce(
    (total, decision) => total + decision.actionHypotheses.length,
    0,
  );
  if (actionCount > MAX_OPERATING_ACTION_HYPOTHESES_PER_LEDGER_V2) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'A Chair ledger cannot exceed the bounded owner Review Action capacity.',
      {
        actionCount,
        maximumActionCount: MAX_OPERATING_ACTION_HYPOTHESES_PER_LEDGER_V2,
      },
    );
  }
}

function assertDecision(record, chairArtifactId, snapshot) {
  try {
    assertProtocolArtifact('operating-decision', record, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Action verification requires runtime-derived Decision records.',
      {
        cause: cause?.code ?? null,
      },
    );
  }
  if (
    !sameScope(record, snapshot) ||
    record.sourceArtifactId !== chairArtifactId ||
    record.origin !== 'operating-intelligence'
  ) {
    fail(
      'OPERATING_SCOPE_INVALID',
      'Action verification Decision provenance must retain the exact Chair Artifact.',
    );
  }
}

function actionPlanIds(ledger, decision, hypothesis, decisionIndex, hypothesisIndex) {
  const identity = {
    contract: 'operate-v2-action-verification',
    ledgerId: ledger.ledgerId,
    sourceArtifactId: decision.sourceArtifactId,
    decisionId: decision.decisionId,
    decisionIndex,
    hypothesisIndex,
    hypothesis,
  };
  const actionId = stableId('act', identity);
  return {
    actionId,
    verificationPlanId: stableId('vfy', { ...identity, actionId }),
  };
}

function assertHypothesis(
  hypothesis,
  {
    decision,
    findings,
    actionIdByHypothesisId,
    snapshot,
    state,
    ledger,
    chairArtifactId,
    decisionIndex,
    hypothesisIndex,
  },
) {
  if (!hypothesis || typeof hypothesis !== 'object' || Array.isArray(hypothesis)) {
    fail('RESULT_CONTRACT_INVALID', 'A Chair Action hypothesis must be one structured object.');
  }
  const title = hypothesis.title;
  if (typeof title !== 'string' || title.length === 0 || title !== title.trim()) {
    fail('RESULT_CONTRACT_INVALID', 'A material Action requires a trimmed nonblank title.', {
      decisionIndex,
      hypothesisIndex,
    });
  }
  if (
    typeof hypothesis.objectiveId !== 'string' ||
    !state.objectives.some(({ objectiveId }) => objectiveId === hypothesis.objectiveId)
  ) {
    fail(
      'STATE_TRANSITION_INVALID',
      'A material Action must reference one Objective in the immutable model state.',
      {
        objectiveId: hypothesis.objectiveId ?? null,
      },
    );
  }
  const metric = state.metrics.find(({ metricId }) => metricId === hypothesis.metricId);
  if (
    !metric ||
    typeof hypothesis.baseline !== 'number' ||
    !Number.isFinite(hypothesis.baseline) ||
    typeof hypothesis.target !== 'number' ||
    !Number.isFinite(hypothesis.target)
  ) {
    fail(
      'STATE_TRANSITION_INVALID',
      'A material Action requires a typed in-scope metric plus finite baseline and target.',
      {
        metricId: hypothesis.metricId ?? null,
      },
    );
  }
  if (
    typeof hypothesis.expectedResult !== 'string' ||
    hypothesis.expectedResult.trim() !== hypothesis.expectedResult ||
    hypothesis.expectedResult.length === 0 ||
    typeof hypothesis.verificationWindow !== 'string' ||
    hypothesis.verificationWindow.trim() !== hypothesis.verificationWindow ||
    hypothesis.verificationWindow.length === 0
  ) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'A material Action requires an expected result and verification window.',
      {
        title,
      },
    );
  }
  if (
    typeof hypothesis.verificationMethod !== 'string' ||
    hypothesis.verificationMethod.trim() !== hypothesis.verificationMethod ||
    hypothesis.verificationMethod.length === 0
  ) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'A material Action requires the Chair to state one trimmed nonblank verification method.',
      {
        title,
      },
    );
  }
  const hasOwner =
    typeof hypothesis.ownerActorId === 'string' && hypothesis.ownerActorId.length > 0;
  const disposition = hypothesis.accountabilityDisposition;
  if (
    (hasOwner && disposition !== null) ||
    (!hasOwner && !['unowned', 'blocked'].includes(disposition))
  ) {
    fail(
      'STATE_TRANSITION_INVALID',
      'A material Action needs one owner or an explicit unowned/blocking disposition.',
      { title },
    );
  }
  const sourceFindingIds = canonicalIds(hypothesis.sourceFindingIds, 'Action source Findings', {
    required: true,
  });
  const findingIds = sourceFindingIds
    .map((sourceLocalFindingId) => {
      const position = decision.challengerFindingIds.indexOf(sourceLocalFindingId);
      const findingId = position < 0 ? null : decision.findingIds[position];
      const finding =
        findingId === undefined ? null : findings.find((record) => record.findingId === findingId);
      if (
        !finding ||
        finding.origin !== 'operating-intelligence' ||
        finding.sourceLocalFindingId !== sourceLocalFindingId
      ) {
        fail(
          'STATE_TRANSITION_INVALID',
          'Action Findings must resolve from Chair-local provenance to durable Findings in the immutable operating state.',
          {
            sourceLocalFindingId,
            findingId,
          },
        );
      }
      return findingId;
    })
    .sort();
  const sourceDependencyIds = canonicalIds(
    hypothesis.dependsOnActionHypothesisIds,
    'Action-hypothesis dependencies',
  );
  const dependencyIds = sourceDependencyIds.map((localActionHypothesisId) =>
    actionIdByHypothesisId.get(localActionHypothesisId),
  );
  if (dependencyIds.some((actionId) => actionId === undefined)) {
    fail(
      'STATE_TRANSITION_INVALID',
      'Action dependencies must resolve from Chair-local hypotheses to runtime-owned Action identities.',
      {
        title,
      },
    );
  }
  assertDecision(decision, chairArtifactId, snapshot);
  return { metric, findingIds, dependencyIds, verificationMethod: hypothesis.verificationMethod };
}

const EVALUATION_RULES = Object.freeze([
  'succeeded: a typed observation reaches the target in the declared verification window.',
  'failed: a typed observation does not reach the target in the declared verification window.',
  'blocked: a future accepted analysis records a blocking condition without asserting execution.',
  'cancelled: a future accepted analysis records cancellation without asserting execution.',
  'insufficient-evidence: a future accepted analysis cannot evaluate the declared metric.',
]);

/**
 * Deterministically turns complete hypotheses from one already validated Chair
 * ledger into Actions and their observation-only verification plans. This is a
 * data constructor: runtime code separately proves the ledger came from exact
 * accepted Chair bytes before it calls this function.
 */
export function buildOperatingActionVerificationMaterializationV2({
  snapshot,
  operatingState,
  ledger,
  decisions,
  findings = [],
  timestamp: createdAt,
} = {}) {
  const { snapshot: checkedSnapshot, state } = checkedSnapshotState(snapshot, operatingState);
  assertLedger(ledger, checkedSnapshot);
  timestamp(createdAt, 'Action verification createdAt');
  if (
    !Array.isArray(decisions) ||
    decisions.length !== ledger.decisions.length ||
    !Array.isArray(findings)
  ) {
    fail(
      'STATE_TRANSITION_INVALID',
      'Action verification requires exactly the Decision revisions derived from its Chair ledger.',
      {
        ledgerId: ledger.ledgerId,
      },
    );
  }
  const chairArtifactIds = new Set(decisions.map(({ sourceArtifactId }) => sourceArtifactId));
  if (chairArtifactIds.size !== 1 || chairArtifactIds.has(undefined)) {
    fail(
      'OPERATING_SCOPE_INVALID',
      'Action verification requires one exact accepted Chair Artifact across all Decisions.',
      {
        ledgerId: ledger.ledgerId,
      },
    );
  }
  const [chairArtifactId] = chairArtifactIds;
  const actionIdByHypothesisId = new Map();
  ledger.decisions.forEach((ledgerDecision, decisionIndex) => {
    const decision = decisions[decisionIndex];
    ledgerDecision.actionHypotheses.forEach((hypothesis, hypothesisIndex) => {
      if (actionIdByHypothesisId.has(hypothesis.localActionHypothesisId)) {
        fail(
          'STATE_TRANSITION_INVALID',
          'Chair-local Action hypothesis identities must be unique.',
          {
            localActionHypothesisId: hypothesis.localActionHypothesisId,
          },
        );
      }
      actionIdByHypothesisId.set(
        hypothesis.localActionHypothesisId,
        actionPlanIds(ledger, decision, hypothesis, decisionIndex, hypothesisIndex).actionId,
      );
    });
  });
  const actions = [];
  const verificationPlans = [];
  ledger.decisions.forEach((ledgerDecision, decisionIndex) => {
    const decision = decisions[decisionIndex];
    assertDecision(decision, chairArtifactId, checkedSnapshot);
    if (decision.question !== ledgerDecision.question || decision.title !== ledgerDecision.title) {
      fail(
        'STATE_TRANSITION_INVALID',
        'Chair Action hypotheses must retain their exact runtime-derived Decision binding.',
        {
          ledgerId: ledger.ledgerId,
          decisionId: decision.decisionId,
        },
      );
    }
    ledgerDecision.actionHypotheses.forEach((hypothesis, hypothesisIndex) => {
      const { metric, findingIds, dependencyIds, verificationMethod } = assertHypothesis(
        hypothesis,
        {
          decision,
          findings,
          actionIdByHypothesisId,
          snapshot: checkedSnapshot,
          state,
          ledger,
          chairArtifactId,
          decisionIndex,
          hypothesisIndex,
        },
      );
      const { actionId, verificationPlanId } = actionPlanIds(
        ledger,
        decision,
        hypothesis,
        decisionIndex,
        hypothesisIndex,
      );
      const action = {
        kind: 'operating-action',
        schemaVersion: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
        actionId,
        scopeId: checkedSnapshot.scopeId,
        domainId: checkedSnapshot.domainId,
        domainVersion: checkedSnapshot.domainVersion,
        sourceCycleId: decision.sourceCycleId,
        sourceArtifactId: chairArtifactId,
        title: hypothesis.title,
        state: 'proposed',
        ownerActorId: hypothesis.ownerActorId,
        accountabilityDisposition: hypothesis.accountabilityDisposition,
        sourceDecisionId: decision.decisionId,
        sourceFindingIds: findingIds,
        dependsOnActionIds: dependencyIds,
        objectiveId: hypothesis.objectiveId,
        expectedResult: hypothesis.expectedResult,
        metricId: metric.metricId,
        baseline: hypothesis.baseline,
        target: hypothesis.target,
        verificationWindow: hypothesis.verificationWindow,
        verificationPlanId,
        createdAt,
        updatedAt: createdAt,
      };
      const plan = {
        kind: 'operating-action-verification-plan',
        schemaVersion: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
        verificationPlanId,
        actionId,
        scopeId: checkedSnapshot.scopeId,
        domainId: checkedSnapshot.domainId,
        domainVersion: checkedSnapshot.domainVersion,
        metricId: metric.metricId,
        baseline: hypothesis.baseline,
        target: hypothesis.target,
        window: hypothesis.verificationWindow,
        method: verificationMethod,
        observationRequest: { kind: 'future-observation', reason: hypothesis.expectedResult },
        evaluationRules: [...EVALUATION_RULES],
        revisitDecisionIds: [decision.decisionId],
        sourceArtifactId: chairArtifactId,
        createdAt,
      };
      for (const [kind, record] of [
        ['operating-action', action],
        ['operating-action-verification-plan', plan],
      ]) {
        try {
          assertProtocolArtifact(kind, record, { protocolVersion: PROTOCOL_VERSION });
        } catch (cause) {
          fail(
            'RESULT_CONTRACT_INVALID',
            'The runtime-derived Action verification record is not contract-valid.',
            {
              kind,
              cause: cause?.code ?? null,
            },
          );
        }
      }
      actions.push(action);
      verificationPlans.push(plan);
    });
  });
  if (actions.length === 0) {
    fail(
      'STATE_TRANSITION_INVALID',
      'The challenged Chair ledger contains no complete material Action hypothesis to verify.',
      {
        ledgerId: ledger.ledgerId,
      },
    );
  }
  return freeze({
    ledgerId: ledger.ledgerId,
    sourceArtifactId: chairArtifactId,
    actions: actions.sort((left, right) => left.actionId.localeCompare(right.actionId)).map(clone),
    verificationPlans: verificationPlans
      .sort((left, right) => left.verificationPlanId.localeCompare(right.verificationPlanId))
      .map(clone),
  });
}

function evaluationStatus(action, observation) {
  if (action.target > action.baseline)
    return observation.value >= action.target ? 'succeeded' : 'failed';
  if (action.target < action.baseline)
    return observation.value <= action.target ? 'succeeded' : 'failed';
  return observation.value === action.target ? 'succeeded' : 'failed';
}

/**
 * Build one observed outcome and one bounded learning record. The outcome is
 * strictly observational: no field represents execution, an operation, a
 * capability, approval, policy, or external effect.
 */
export function buildOperatingActionVerificationOutcomeV2({
  action,
  verificationPlan,
  observation,
  learning,
  timestamp: observedAt,
  sourceDecision,
} = {}) {
  timestamp(observedAt, 'Outcome observedAt');
  for (const [kind, record] of [
    ['operating-action', action],
    ['operating-action-verification-plan', verificationPlan],
    ['operating-metric-observation', observation],
    ['operating-decision', sourceDecision],
  ]) {
    try {
      assertProtocolArtifact(kind, record, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail(
        'RESULT_CONTRACT_INVALID',
        'Observed action verification requires contract-valid Action, plan, observation, and source Decision.',
        {
          kind,
          cause: cause?.code ?? null,
        },
      );
    }
  }
  if (
    !sameScope(action, verificationPlan) ||
    !sameScope(action, observation) ||
    !sameScope(action, sourceDecision) ||
    action.verificationPlanId !== verificationPlan.verificationPlanId ||
    action.metricId !== verificationPlan.metricId ||
    action.baseline !== verificationPlan.baseline ||
    action.target !== verificationPlan.target ||
    observation.metricId !== action.metricId ||
    observation.unit === undefined ||
    action.sourceDecisionId !== sourceDecision.decisionId
  ) {
    fail(
      'OPERATING_SCOPE_INVALID',
      'An observed outcome must retain one exact Action, verification plan, metric, and source Decision binding.',
    );
  }
  if (
    !learning ||
    typeof learning !== 'object' ||
    Array.isArray(learning) ||
    typeof learning.statement !== 'string' ||
    learning.statement.length === 0 ||
    learning.statement.trim() !== learning.statement
  ) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'An observed Action outcome requires one trimmed nonblank Learning statement.',
    );
  }
  const assumptionIds = canonicalIds(learning.assumptionIds ?? [], 'Learning assumptions');
  const decisionIds = canonicalIds(
    learning.decisionIds ?? [sourceDecision.decisionId],
    'Learning revisit Decisions',
    { required: true },
  );
  if (
    decisionIds.some((decisionId) => decisionId !== sourceDecision.decisionId) ||
    assumptionIds.some((assumptionId) => !sourceDecision.assumptionIds.includes(assumptionId))
  ) {
    fail(
      'STATE_TRANSITION_INVALID',
      'Learning may revisit only the Action source Decision and its bound Assumptions.',
    );
  }
  const evidenceRefIds = canonicalIds(observation.evidenceRefIds, 'Observed outcome EvidenceRefs', {
    required: true,
  });
  const outcomeId = stableId('out', {
    contract: 'operate-v2-observed-action-outcome',
    actionId: action.actionId,
    verificationPlanId: verificationPlan.verificationPlanId,
    observationId: observation.observationId,
    sourceArtifactId: observation.sourceArtifactId,
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
    status: evaluationStatus(action, observation),
    observationIds: [observation.observationId],
    evidenceRefIds,
    sourceArtifactId: observation.sourceArtifactId,
    observedAt,
  };
  const learningRecord = {
    kind: 'operating-learning',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    learningId: stableId('lrn', {
      contract: 'operate-v2-observed-action-learning',
      outcomeId,
      statement: learning.statement,
      assumptionIds,
      decisionIds,
      evidenceRefIds,
    }),
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    statement: learning.statement,
    outcomeId,
    assumptionIds,
    decisionIds,
    evidenceRefIds,
    sourceArtifactId: observation.sourceArtifactId,
    createdAt: observedAt,
  };
  for (const [kind, record] of [
    ['operating-outcome', outcome],
    ['operating-learning', learningRecord],
  ]) {
    try {
      assertProtocolArtifact(kind, record, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      fail(
        'RESULT_CONTRACT_INVALID',
        'The runtime-derived observed Action record is not contract-valid.',
        {
          kind,
          cause: cause?.code ?? null,
        },
      );
    }
  }
  return freeze({ outcome: clone(outcome), learning: clone(learningRecord) });
}

/**
 * Join Phase 5 Outcome/Learning truth to the distinct execution result without
 * treating effect completion as proof that the Action hypothesis succeeded.
 */
export function buildOperatingActionExecutionFeedbackV2({
  action,
  verificationPlan,
  executionStatus,
  outcome = null,
  learning = null,
  delta = null,
  snapshot = null,
  cycle = null,
} = {}) {
  return deriveOperatingVerificationFeedbackV2({
    action,
    verificationPlan,
    executionStatus,
    outcome,
    learning,
    delta,
    snapshot,
    cycle,
  });
}
