import { PipelineError } from '@openplanr/protocol/errors';
import { OPERATE_CONTRACT_CATALOG_V2 } from '@openplanr/protocol/operate-contract-catalog-v2';
import { selectOperatingTerminalVerificationAssignmentV2 } from './execution-verification-v2.mjs';

const ENTITY_CONFIG = Object.freeze({
  'operating-finding': Object.freeze({ id: 'findingId', unresolved: new Set(['open', 'accepted', 'deferred']) }),
  'operating-decision': Object.freeze({ id: 'decisionId', unresolved: new Set(['proposed', 'deferred']) }),
  'operating-action': Object.freeze({
    id: 'actionId',
    unresolved: new Set(['proposed', 'approved', 'queued', 'in_progress', 'blocked', 'deferred']),
  }),
});

function fail(message, context = {}) {
  throw new PipelineError('STATE_TRANSITION_INVALID', message, '', {
    retryable: false,
    context: structuredClone(context),
  });
}

function allRecords({ findings, decisions, actions }) {
  return [
    ...findings.map((record) => ['operating-finding', record]),
    ...decisions.map((record) => ['operating-decision', record]),
    ...actions.map((record) => ['operating-action', record]),
  ];
}

function recordKey(entityType, entityId) {
  return `${entityType}:${entityId}`;
}

function transition(entityType, from, to) {
  return OPERATE_CONTRACT_CATALOG_V2.transitions.find((entry) => (
    entry.entityId === entityType
    && entry.from === from
    && entry.to === to
    && entry.event === 'review.submitted'
    && entry.guard === 'review-submit-authorized'
    && entry.actorKinds.length === 1
    && entry.actorKinds[0] === 'human'
  )) ?? null;
}

const REVIEW_DISPOSITION_STRATEGIES = Object.freeze([
  Object.freeze({ id: 'approve', label: 'Approve decision-ready work' }),
  Object.freeze({ id: 'defer', label: 'Defer unresolved work' }),
  Object.freeze({ id: 'reject', label: 'Reject unresolved proposals' }),
]);

function dispositionForStrategy(entityType, state, strategy) {
  if (state === 'deferred') return 'deferred';
  if (entityType === 'operating-finding' && state === 'accepted') return 'resolved';
  if (entityType === 'operating-action' && state === 'approved') return 'deferred';
  if (strategy === 'approve') {
    if (entityType === 'operating-finding') return 'accepted';
    return 'approved';
  }
  return strategy === 'defer' ? 'deferred' : 'rejected';
}

/**
 * Derive the bounded canonical approved-Review choices from actual durable
 * source work. A choice is returned only when the complete exact target set
 * closes through the same transition validator used by Event reduction.
 */
export function deriveOperatingReviewWorkDispositionSetsV2({
  cycle,
  findings,
  decisions,
  actions,
  timestamp,
  reviewOwnerActorId,
}) {
  if (!cycle || !Array.isArray(findings) || !Array.isArray(decisions)
    || !Array.isArray(actions) || typeof timestamp !== 'string') {
    fail('Approved Review choice derivation requires one Cycle, durable collections, and timestamp.', {
      cycleId: cycle?.cycleId ?? null,
    });
  }
  const required = allRecords({ findings, decisions, actions })
    .filter(([entityType, record]) => (
      record.sourceCycleId === cycle.cycleId
      && ENTITY_CONFIG[entityType].unresolved.has(record.state)
    ))
    .sort(([leftType, left], [rightType, right]) => {
      const typeOrder = leftType.localeCompare(rightType);
      return typeOrder !== 0
        ? typeOrder
        : String(left[ENTITY_CONFIG[leftType].id]).localeCompare(String(right[ENTITY_CONFIG[rightType].id]));
    });
  const seen = new Set();
  const choices = [];
  for (const strategy of REVIEW_DISPOSITION_STRATEGIES) {
    const workDispositions = [];
    let valid = true;
    for (const [entityType, record] of required) {
      const disposition = dispositionForStrategy(entityType, record.state, strategy.id);
      if (record.state !== 'deferred' && !transition(entityType, record.state, disposition)) {
        valid = false;
        break;
      }
      workDispositions.push({
        entityType,
        entityId: record[ENTITY_CONFIG[entityType].id],
        disposition,
      });
    }
    if (!valid) continue;
    const identity = JSON.stringify(workDispositions);
    if (seen.has(identity)) continue;
    try {
      closeCycleWithCarriedWorkV2({
        cycle,
        findings,
        decisions,
        actions,
        workDispositions,
        timestamp,
        reviewOwnerActorId,
      });
    } catch {
      continue;
    }
    seen.add(identity);
    choices.push(Object.freeze({
      strategy: strategy.id,
      label: strategy.label,
      workDispositions: Object.freeze(workDispositions.map((entry) => Object.freeze(entry))),
    }));
  }
  return Object.freeze(choices);
}

/** Pure Event-projection helper for the exact approved Review disposition semantics. */
export function applyOperatingReviewWorkDispositionsV2({
  cycle,
  findings,
  decisions,
  actions,
  workDispositions,
  timestamp,
  reviewOwnerActorId,
}) {
  if (!cycle || !Array.isArray(workDispositions) || typeof timestamp !== 'string') {
    fail('Approved Review work projection requires one Cycle, explicit dispositions, and timestamp.', {
      cycleId: cycle?.cycleId ?? null,
    });
  }
  const records = new Map();
  for (const [entityType, record] of allRecords({ findings, decisions, actions })) {
    records.set(recordKey(entityType, record[ENTITY_CONFIG[entityType].id]), { entityType, record });
  }
  const replacements = new Map();
  for (const disposition of workDispositions) {
    const key = recordKey(disposition.entityType, disposition.entityId);
    if (replacements.has(key)) fail('A Review may record one disposition per durable work item.', {
      cycleId: cycle.cycleId, entityId: disposition.entityId,
    });
    const entry = records.get(key);
    if (!entry) fail('A Review disposition references unknown durable work.', {
      cycleId: cycle.cycleId, entityId: disposition.entityId,
    });
    const { entityType, record } = entry;
    const config = ENTITY_CONFIG[entityType];
    if (record.sourceCycleId !== cycle.cycleId
      || record.scopeId !== cycle.scopeId
      || record.domainId !== cycle.domainId
      || record.domainVersion !== cycle.domainVersion) {
      fail('A Review may touch only source durable work in its bound Cycle, scope, and domain.', {
        cycleId: cycle.cycleId, entityId: disposition.entityId,
      });
    }
    if (!config.unresolved.has(record.state)) {
      fail('A Review disposition may not mutate terminal durable work.', {
        cycleId: cycle.cycleId, entityId: disposition.entityId, state: record.state,
      });
    }
    if (record.state === 'deferred' && disposition.disposition === 'deferred') {
      replacements.set(key, structuredClone(record));
      continue;
    }
    if (!transition(entityType, record.state, disposition.disposition)) {
      fail('The requested durable-work disposition is not a canonical human Review transition.', {
        cycleId: cycle.cycleId, entityId: disposition.entityId,
        from: record.state, to: disposition.disposition,
      });
    }
    const replacement = { ...structuredClone(record), state: disposition.disposition, updatedAt: timestamp };
    if (entityType === 'operating-finding'
      && disposition.disposition === 'deferred'
      && replacement.ownerActorId === null
      && replacement.revisitAt === null) {
      if (typeof reviewOwnerActorId !== 'string' || reviewOwnerActorId.trim().length === 0) {
        fail('Deferring an unowned Finding requires the exact human Review owner.', {
          cycleId: cycle.cycleId,
          entityId: disposition.entityId,
        });
      }
      replacement.ownerActorId = reviewOwnerActorId;
    }
    replacements.set(key, replacement);
  }
  const replace = (entityType, recordsForType) => recordsForType.map((record) => (
    replacements.get(recordKey(entityType, record[ENTITY_CONFIG[entityType].id])) ?? structuredClone(record)
  ));
  return Object.freeze({
    findings: Object.freeze(replace('operating-finding', findings)),
    decisions: Object.freeze(replace('operating-decision', decisions)),
    actions: Object.freeze(replace('operating-action', actions)),
  });
}

/**
 * Validates an approved human Review as the one normal successful-close path.
 * It returns a pure replacement projection so an invalid disposition cannot
 * expose a partial durable-work or Cycle mutation.
 */
export function closeCycleWithCarriedWorkV2({
  cycle,
  findings,
  decisions,
  actions,
  workDispositions,
  timestamp,
  reviewOwnerActorId,
}) {
  if (!cycle || cycle.state !== 'awaiting_review' || !['normal', 'partial'].includes(cycle.health)) {
    fail('Successful Cycle closure requires a non-quiet, non-blocked awaiting-review Cycle.', {
      cycleId: cycle?.cycleId ?? null,
      state: cycle?.state ?? null,
      health: cycle?.health ?? null,
    });
  }
  if (!Array.isArray(workDispositions)) {
    fail('Successful Cycle closure requires an explicit durable-work disposition list.', {
      cycleId: cycle.cycleId,
    });
  }

  const records = new Map();
  for (const [entityType, record] of allRecords({ findings, decisions, actions })) {
    records.set(recordKey(entityType, record[ENTITY_CONFIG[entityType].id]), { entityType, record });
  }

  const dispositions = new Map();
  for (const disposition of workDispositions) {
    const key = recordKey(disposition.entityType, disposition.entityId);
    if (dispositions.has(key)) fail('A Review may record one disposition per durable work item.', {
      cycleId: cycle.cycleId,
      entityType: disposition.entityType,
      entityId: disposition.entityId,
    });
    const entry = records.get(key);
    if (!entry) fail('A Review disposition references unknown durable work.', {
      cycleId: cycle.cycleId,
      entityType: disposition.entityType,
      entityId: disposition.entityId,
    });
    const { record } = entry;
    if (
      record.scopeId !== cycle.scopeId
      || record.domainId !== cycle.domainId
      || record.domainVersion !== cycle.domainVersion
    ) {
      fail('A Review may touch only durable work in its bound scope and domain.', {
        cycleId: cycle.cycleId,
        entityId: disposition.entityId,
      });
    }
    dispositions.set(key, disposition);
  }

  const required = new Set();
  for (const [entityType, record] of allRecords({ findings, decisions, actions })) {
    const config = ENTITY_CONFIG[entityType];
    const entityId = record[config.id];
    if (record.sourceCycleId === cycle.cycleId && config.unresolved.has(record.state)) {
      required.add(recordKey(entityType, entityId));
    }
  }
  for (const [key, { entityType, record }] of records) {
    if (dispositions.has(key) && ENTITY_CONFIG[entityType].unresolved.has(record.state)) required.add(key);
  }
  for (const key of required) {
    if (!dispositions.has(key)) fail('Every unresolved source or touched durable-work item requires an explicit Review disposition.', {
      cycleId: cycle.cycleId,
      entityType: key.split(':', 1)[0],
      entityId: key.slice(key.indexOf(':') + 1),
    });
  }

  const projected = applyOperatingReviewWorkDispositionsV2({
    cycle, findings, decisions, actions, workDispositions, timestamp, reviewOwnerActorId,
  });
  return Object.freeze({
    cycle: Object.freeze({
      ...structuredClone(cycle),
      state: 'closed',
      activeReviewId: null,
      closedAt: timestamp,
      updatedAt: timestamp,
    }),
    findings: projected.findings,
    decisions: projected.decisions,
    actions: projected.actions,
  });
}

/**
 * Close the execution branch only after verification has a durable disposition.
 * Persistent blocked/deferred work may outlive the Cycle through an explicit
 * carry-forward identity; no Action revision or state is rewritten on close.
 */
export function closeVerifiedOperatingCycleV2({
  cycle,
  actions,
  verificationPlans,
  governedOperations,
  executionResults,
  rollbackResults,
  verificationAssignments,
  verificationFeedback,
  carriedActionIds = [],
  timestamp,
}) {
  if (!cycle || cycle.state !== 'verifying'
    || typeof timestamp !== 'string'
    || Number.isNaN(Date.parse(timestamp))
    || !Array.isArray(actions)
    || !Array.isArray(verificationPlans)
    || !Array.isArray(governedOperations)
    || !Array.isArray(executionResults)
    || !Array.isArray(rollbackResults)
    || !Array.isArray(verificationAssignments)
    || !Array.isArray(verificationFeedback)
    || !Array.isArray(carriedActionIds)
    || new Set(carriedActionIds).size !== carriedActionIds.length) {
    fail('Verified Cycle closure requires exact verifying state, typed collections, and one timestamp.', {
      cycleId: cycle?.cycleId ?? null,
      state: cycle?.state ?? null,
    });
  }
  const selected = actions.filter(({ sourceCycleId }) => sourceCycleId === cycle.cycleId);
  if (selected.some((action) => (
    action.scopeId !== cycle.scopeId
    || action.domainId !== cycle.domainId
    || action.domainVersion !== cycle.domainVersion
  ))) {
    fail('Verified Cycle closure may use only source Actions in its exact scope and domain version.', {
      cycleId: cycle.cycleId,
    });
  }
  const feedbackByAction = new Map();
  for (const entry of verificationFeedback) {
    if (feedbackByAction.has(entry.actionId)) {
      fail('Verified Cycle closure rejects ambiguous verification feedback ownership.', {
        cycleId: cycle.cycleId,
        actionId: entry.actionId,
      });
    }
    feedbackByAction.set(entry.actionId, entry);
  }
  const carried = new Set(carriedActionIds);
  for (const action of selected) {
    const feedback = feedbackByAction.get(action.actionId);
    const persistentCarry = carried.has(action.actionId)
      && ['blocked', 'deferred'].includes(action.state);
    let assignment = null;
    if (feedback && !persistentCarry) {
      const plans = verificationPlans.filter(({ verificationPlanId }) => (
        verificationPlanId === feedback.verificationPlanId
      ));
      const operations = governedOperations.filter(({ operationId }) => (
        operationId === feedback.operationId
      ));
      const results = [
        ...executionResults.filter(({ resultId }) => resultId === feedback.resultId),
        ...rollbackResults.filter(({ rollbackResultId }) => rollbackResultId === feedback.resultId),
      ];
      if (plans.length !== 1 || operations.length !== 1 || results.length !== 1) {
        fail('Verified Cycle closure requires one exact plan, operation, and terminal result per Action.', {
          cycleId: cycle.cycleId,
          actionId: action.actionId,
        });
      }
      try {
        assignment = selectOperatingTerminalVerificationAssignmentV2({
          assignments: verificationAssignments,
          action,
          cycle,
          operation: operations[0],
          result: results[0],
          verificationPlan: plans[0],
          timestamp: results[0].completedAt,
        });
      } catch (error) {
        fail('Verified Cycle closure rejected non-canonical verification Assignment ownership.', {
          cycleId: cycle.cycleId,
          actionId: action.actionId,
          cause: error?.code ?? null,
        });
      }
      if (assignment.assignmentId !== feedback.verificationAssignmentId) {
        fail('Verified Cycle closure feedback does not retain its canonical verification Assignment identity.', {
          cycleId: cycle.cycleId,
          actionId: action.actionId,
          assignmentId: feedback.verificationAssignmentId ?? null,
        });
      }
    }
    if ((!feedback || !assignment) && !persistentCarry) {
      fail('Every executed Action requires one owned verification disposition or explicit persistent carry-forward.', {
        cycleId: cycle.cycleId,
        actionId: action.actionId,
      });
    }
    if (['queued', 'in_progress'].includes(action.state)
      || (carried.has(action.actionId) && !persistentCarry)
      || (feedback?.hypothesisStatus === 'pending' && !persistentCarry)) {
      fail('Cycle closure cannot hide active execution or an undisposed verification hypothesis.', {
        cycleId: cycle.cycleId,
        actionId: action.actionId,
        actionState: action.state,
        hypothesisStatus: feedback?.hypothesisStatus ?? null,
      });
    }
  }
  for (const actionId of carried) {
    if (!selected.some((action) => action.actionId === actionId)) {
      fail('Cycle carry-forward references an unknown source Action.', { cycleId: cycle.cycleId, actionId });
    }
  }
  return Object.freeze({
    cycle: Object.freeze({
      ...structuredClone(cycle),
      state: 'closed',
      activeReviewId: null,
      closedAt: timestamp,
      updatedAt: timestamp,
    }),
    actions: Object.freeze(actions.map((action) => Object.freeze(structuredClone(action)))),
    carriedActionIds: Object.freeze([...carried].sort()),
    verificationFeedback: Object.freeze(verificationFeedback.map((entry) => Object.freeze(structuredClone(entry)))),
  });
}
