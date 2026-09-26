/**
 * Runtime Event registry: for every Protocol 2.0 Event type, the reducer handler that applies
 * it, the payload path of its entity identity, and the experience-projection parity rule that
 * rebuilds its records. runtime-event-reducer-v2.mjs dispatches through it and
 * experience-projection-v2.mjs checks Event history against it.
 */

/** Event-derived runtime-state collections: parity name → [state field, identity field]. */
export const RUNTIME_EVENT_COLLECTIONS = Object.freeze({
  assignments: Object.freeze(['assignments', 'assignmentId']),
  artifacts: Object.freeze(['artifacts', 'artifactId']),
  findings: Object.freeze(['findings', 'findingId']),
  decisions: Object.freeze(['decisions', 'decisionId']),
  actions: Object.freeze(['actions', 'actionId']),
  executiveBoards: Object.freeze(['executiveBoards', 'boardId']),
  operatingModelStates: Object.freeze(['operatingModelStates', 'stateId']),
  risks: Object.freeze(['risks', 'riskId']),
  assumptions: Object.freeze(['assumptions', 'assumptionId']),
  intelligencePlans: Object.freeze(['intelligencePlans', 'planId']),
  decisionLedgers: Object.freeze(['decisionLedgers', 'ledgerId']),
  scenarios: Object.freeze(['scenarios', 'scenarioId']),
  eventTriggers: Object.freeze(['eventTriggers', 'triggerId']),
  domainProjections: Object.freeze(['domainProjections', 'projectionId']),
  policyEvaluations: Object.freeze(['policyEvaluations', 'evaluationId']),
  approvalRecords: Object.freeze(['approvalRecords', 'approvalId']),
  capabilityAvailability: Object.freeze(['capabilityAvailability', 'availabilityId']),
  capabilityGrants: Object.freeze(['capabilityGrants', 'grantId']),
  governedOperations: Object.freeze(['governedOperations', 'operationId']),
  rollbackPlans: Object.freeze(['rollbackPlans', 'rollbackPlanId']),
  evidenceRefs: Object.freeze(['evidenceRefs', 'evidenceRefId']),
  evidenceResolutions: Object.freeze(['evidenceResolutions', 'resolutionId']),
  evidenceEdges: Object.freeze(['evidenceEdges', 'edgeId']),
  snapshots: Object.freeze(['operatingSnapshots', 'snapshotId']),
  metricObservations: Object.freeze(['metricObservations', 'observationId']),
  claims: Object.freeze(['claims', 'claimId']),
  deltas: Object.freeze(['deltas', 'deltaId']),
  verificationPlans: Object.freeze(['verificationPlans', 'verificationPlanId']),
  outcomes: Object.freeze(['outcomes', 'outcomeId']),
  learnings: Object.freeze(['learnings', 'learningId']),
  executionResults: Object.freeze(['executionResults', 'resultId']),
  rollbackResults: Object.freeze(['rollbackResults', 'rollbackResultId']),
});

/** An Event checked by a named parity rule. */
function ruled(handler, parity, entityId) {
  return Object.freeze({ handler, parity, entityId: Object.freeze(entityId) });
}

/** An Event whose payload (or the record at `record`) is one record of `collection`. */
function recorded(handler, collection, record = []) {
  return Object.freeze({
    handler,
    parity: 'record',
    collection,
    record: Object.freeze(record),
    entityId: Object.freeze([...record, RUNTIME_EVENT_COLLECTIONS[collection][1]]),
  });
}

/**
 * Event type → { handler, entityId, parity[, collection, record] }.
 * A null handler is rejected by the reducer; a null parity rule adds no parity record.
 */
export const RUNTIME_EVENT_REGISTRY = Object.freeze({
  'planning-delivery.ingested': ruled('evidenceState', 'planning-delivery', [
    'deliveryEvidence',
    'deliveryEvidenceId',
  ]),
  'cycle.input-bound': ruled('workflow', null, ['inputBindingId']),
  'assignment.created': recorded('assignment', 'assignments'),
  'assignment.available': ruled('assignment', 'assignment-lifecycle', ['assignmentId']),
  'assignment.claimed': ruled('assignment', 'assignment-lifecycle', ['assignmentId']),
  'assignment.started': ruled('assignment', 'assignment-lifecycle', ['assignmentId']),
  'assignment.submitted': ruled('assignment', 'assignment-lifecycle', ['assignmentId']),
  'artifact.created': ruled('assignment', 'artifact', ['artifactId']),
  'assignment.validated': ruled('assignment', 'assignment-lifecycle', ['assignmentId']),
  'assignment.rejected': ruled('assignment', 'assignment-lifecycle', ['assignmentId']),
  'assignment.abandoned': ruled('assignment', 'assignment-lifecycle', ['assignmentId']),
  'assignment.failed': ruled('assignment', 'assignment-lifecycle', ['assignmentId']),
  'executive-board.materialized': ruled('workflow', 'executive-board', ['boardId']),
  'review.created': ruled('workflow', 'review-created', ['reviewId']),
  'review.submitted': ruled('workflow', 'review-submitted', ['reviewId']),
  'work-change-set.materialized': ruled('workflow', 'work-change-set', ['artifactId']),
  'action.authority-promoted': ruled('workflow', 'action-authority', ['action', 'actionId']),
  'evidence.resolved': ruled('evidenceState', 'evidence-resolution', [
    'evidenceRef',
    'evidenceRefId',
  ]),
  'evidence.rejected': recorded('evidenceState', 'evidenceResolutions', ['resolution']),
  'operating-state.materialized': recorded('evidenceState', 'operatingModelStates'),
  'snapshot.materialized': recorded('evidenceState', 'snapshots'),
  'metric.observed': recorded('evidenceState', 'metricObservations', ['record']),
  'claim.recorded': recorded('intelligence', 'claims', ['record']),
  'finding.recorded': recorded('intelligence', 'findings', ['record']),
  'risk.recorded': recorded('intelligence', 'risks', ['record']),
  'assumption.recorded': recorded('intelligence', 'assumptions', ['record']),
  'decision.revised': recorded('intelligence', 'decisions', ['record']),
  'delta.derived': recorded('intelligence', 'deltas', ['record']),
  'intelligence.plan-recorded': recorded('intelligence', 'intelligencePlans'),
  'decision-ledger.materialized': recorded('intelligence', 'decisionLedgers'),
  'verification.plan-recorded': ruled('intelligence', 'verification-plan', ['verificationPlanId']),
  'outcome.recorded': ruled('intelligence', 'outcome', ['outcomeId']),
  'learning.recorded': ruled('intelligence', 'learning', ['learningId']),
  'scenario.recorded': recorded('intelligence', 'scenarios', ['record']),
  'trigger.recorded': recorded('intelligence', 'eventTriggers', ['record']),
  'domain-projection.rebuilt': recorded(null, 'domainProjections'),
  'policy.evaluated': ruled('authority', 'policy-evaluation', ['evaluationId']),
  'approval.recorded': ruled('authority', 'approval', ['approvalId']),
  'capability.availability-recorded': recorded('authority', 'capabilityAvailability'),
  'capability.granted': recorded('authority', 'capabilityGrants'),
  'operation.intent-recorded': ruled('authority', 'operation-intent', ['operation', 'operationId']),
  'execution.result-recorded': ruled('authority', 'execution-result', ['result', 'resultId']),
  'rollback.plan-recorded': recorded('authority', 'rollbackPlans'),
  'rollback.result-recorded': ruled('authority', 'rollback-result', ['rollbackResultId']),
  'action.approved': ruled('workflow', 'action-lifecycle', ['action', 'actionId']),
  'action.cancelled': ruled('workflow', 'action-lifecycle', ['action', 'actionId']),
  'action.rejected': ruled('workflow', 'action-lifecycle', ['action', 'actionId']),
  'action.deferred': ruled('workflow', 'action-lifecycle', ['action', 'actionId']),
  'action.reopened': ruled('workflow', 'action-lifecycle', ['action', 'actionId']),
  'action.queued': ruled('workflow', 'action-lifecycle', ['action', 'actionId']),
  'action.started': ruled('workflow', 'action-lifecycle', ['action', 'actionId']),
  'action.completed': ruled('workflow', 'action-lifecycle', ['action', 'actionId']),
  'action.blocked': ruled('workflow', 'action-lifecycle', ['action', 'actionId']),
  'cycle.approved': ruled('workflow', 'cycle-lifecycle', ['cycleId']),
  'cycle.executing': ruled('workflow', 'cycle-lifecycle', ['cycleId']),
  'cycle.verifying': ruled('workflow', 'cycle-lifecycle', ['cycleId']),
  'cycle.closed': ruled('workflow', 'cycle-lifecycle', ['cycleId']),
});

/** The registry entry for an Event type, or null for a type outside Protocol 2.0. */
export function runtimeEventEntry(type) {
  return Object.hasOwn(RUNTIME_EVENT_REGISTRY, type) ? RUNTIME_EVENT_REGISTRY[type] : null;
}

/** The Event's entity identity read from its payload, or null for an unregistered type. */
export function runtimeEventEntityId(event) {
  const entry = runtimeEventEntry(event.type);
  return entry === null ? null : entry.entityId.reduce((value, key) => value[key], event.payload);
}

/** Throws unless `ruleNames` implements exactly the parity rules the registry names. */
export function assertRuntimeEventParityRules(ruleNames) {
  const required = new Set(
    Object.values(RUNTIME_EVENT_REGISTRY)
      .map(({ parity }) => parity)
      .filter((parity) => parity !== null),
  );
  const provided = new Set(ruleNames);
  const missing = [...required].filter((name) => !provided.has(name));
  const unused = [...provided].filter((name) => !required.has(name));
  if (missing.length !== 0 || unused.length !== 0) {
    throw new TypeError(
      `Runtime Event parity rules differ from the registry: missing [${missing.join(', ')}], unused [${unused.join(', ')}].`,
    );
  }
}
