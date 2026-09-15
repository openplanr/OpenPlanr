import { assertProtocolArtifact } from '@openplanr/protocol/contracts';

const PROTOCOL_VERSION = '2.0.0';

const ENTITY_TYPES = Object.freeze([
  ['operating-finding', 'findingId', 'findings'],
  ['operating-decision', 'decisionId', 'decisions'],
  ['operating-action', 'actionId', 'actions'],
]);

function clone(value) {
  return structuredClone(value);
}

function projectionError(message) {
  const error = new Error(message);
  error.code = 'STATE_TRANSITION_INVALID';
  return error;
}

function compareById(id) {
  return (left, right) => left[id].localeCompare(right[id]);
}

function assertState(state) {
  assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
}

function scopedRecords(state, scope) {
  const records = {};
  for (const [entityType, id, field] of ENTITY_TYPES) {
    records[field] = state[field]
      .filter((record) => (
        record.scopeId === scope.scopeId
        && record.domainId === scope.domainId
        && record.domainVersion === scope.domainVersion
      ))
      .map(clone)
      .sort(compareById(id));
    for (const record of records[field]) {
      if (record.kind !== entityType) throw projectionError(`Unexpected ${field} record kind.`);
    }
  }
  return records;
}

function linksForScope(state, scope, records) {
  const known = new Map();
  for (const [entityType, id, field] of ENTITY_TYPES) {
    for (const record of records[field]) known.set(`${entityType}:${record[id]}`, record);
  }
  const links = new Map();
  const add = (entityType, entityId, cycleId, relation) => {
    const key = `${entityType}:${entityId}:${cycleId}:${relation}`;
    links.set(key, { entityKind: entityType.replace('operating-', ''), entityId, cycleId, relation });
  };

  for (const [entityType, id, field] of ENTITY_TYPES) {
    for (const record of records[field]) add(entityType, record[id], record.sourceCycleId, 'source');
  }
  for (const review of state.reviews) {
    const cycle = state.cycles.find(({ cycleId }) => cycleId === review.cycleId);
    if (!cycle || cycle.scopeId !== scope.scopeId || cycle.domainId !== scope.domainId || cycle.domainVersion !== scope.domainVersion) continue;
    for (const disposition of review.workDispositions) {
      const record = known.get(`${disposition.entityType}:${disposition.entityId}`);
      if (!record) continue;
      add(disposition.entityType, disposition.entityId, review.cycleId, 'touched');
      if (disposition.disposition === 'deferred') add(disposition.entityType, disposition.entityId, review.cycleId, 'carried-forward');
    }
  }
  for (const action of records.actions) {
    const sourceCycle = state.cycles.find(({ cycleId }) => cycleId === action.sourceCycleId);
    const hasOwnedVerification = state.assignments.some((assignment) => (
      assignment.assignmentKind === 'verification'
      && state.governedOperations?.some((operation) => (
        operation.operationId === assignment.governedOperationId
        && operation.action.actionId === action.actionId
        && operation.action.revision === action.revision
        && operation.action.actionHash === action.actionHash
      ))
    ));
    if (sourceCycle?.state === 'closed'
      && ['blocked', 'deferred'].includes(action.state)
      && hasOwnedVerification) {
      add('operating-action', action.actionId, sourceCycle.cycleId, 'carried-forward');
    }
  }
  return [...links.values()].sort((left, right) => (
    left.cycleId.localeCompare(right.cycleId)
    || left.entityKind.localeCompare(right.entityKind)
    || left.entityId.localeCompare(right.entityId)
    || left.relation.localeCompare(right.relation)
  ));
}

/**
 * Rebuilds the canonical scope ledger from a valid v2 checkpoint. The result
 * is read-only derived data and never changes the supplied runtime state.
 */
export function buildOperatingWorkLedgerV2(state, scope, { generatedAt = state?.generatedAt } = {}) {
  assertState(state);
  if (!scope || typeof scope !== 'object' || ['scopeId', 'domainId', 'domainVersion'].some((key) => (
    typeof scope[key] !== 'string' || scope[key].length === 0
  ))) throw projectionError('A ledger requires an explicit v2 scope and domain binding.');
  if (typeof generatedAt !== 'string' || Number.isNaN(Date.parse(generatedAt))) {
    throw projectionError('A ledger requires an explicit generated timestamp.');
  }
  const records = scopedRecords(state, scope);
  const ledger = {
    kind: 'operating-work-ledger', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
    scopeId: scope.scopeId, domainId: scope.domainId, domainVersion: scope.domainVersion, generatedAt,
    ...records,
    cycleLinks: linksForScope(state, scope, records),
  };
  assertProtocolArtifact('operating-work-ledger', ledger, { protocolVersion: PROTOCOL_VERSION });
  return Object.freeze(ledger);
}

/**
 * Returns one Cycle's source and human-touch link view. Entity records remain
 * ledger-owned values; this view only selects immutable copies and links.
 */
export function buildOperatingCycleWorkViewV2(state, cycleId, { generatedAt = state?.generatedAt } = {}) {
  assertState(state);
  const cycle = state.cycles.find((candidate) => candidate.cycleId === cycleId);
  if (!cycle) throw projectionError(`Unknown Cycle ${cycleId}.`);
  const ledger = buildOperatingWorkLedgerV2(state, cycle, { generatedAt });
  const sourceOrTouched = new Set(ledger.cycleLinks
    .filter((link) => link.cycleId === cycleId)
    .map((link) => `${link.entityKind}:${link.entityId}`));
  const select = (field, id, kind) => ledger[field]
    .filter((record) => sourceOrTouched.has(`${kind}:${record[id]}`))
    .map(clone);
  return Object.freeze({
    kind: 'operating-cycle-work-view', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
    cycleId: cycle.cycleId, scopeId: cycle.scopeId, domainId: cycle.domainId, domainVersion: cycle.domainVersion,
    generatedAt,
    findings: Object.freeze(select('findings', 'findingId', 'finding')),
    decisions: Object.freeze(select('decisions', 'decisionId', 'decision')),
    actions: Object.freeze(select('actions', 'actionId', 'action')),
    cycleLinks: Object.freeze(ledger.cycleLinks.filter((link) => link.cycleId === cycleId).map(clone)),
  });
}
