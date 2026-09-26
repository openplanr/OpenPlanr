import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { PipelineError } from '@openplanr/protocol/errors';

const PROTOCOL_VERSION = '2.0.0';

/** The sole domain-neutral collections in OperatingModelStateV2. */
export const OPERATING_MODEL_STATE_COLLECTIONS_V2 = Object.freeze([
  Object.freeze({ field: 'objectives', kind: 'operating-objective', id: 'objectiveId' }),
  Object.freeze({ field: 'metrics', kind: 'operating-metric', id: 'metricId' }),
  Object.freeze({ field: 'findings', kind: 'operating-finding', id: 'findingId' }),
  Object.freeze({ field: 'decisions', kind: 'operating-decision', id: 'decisionId' }),
  Object.freeze({ field: 'actions', kind: 'operating-action', id: 'actionId' }),
  Object.freeze({ field: 'risks', kind: 'operating-risk', id: 'riskId' }),
  Object.freeze({ field: 'assumptions', kind: 'operating-assumption', id: 'assumptionId' }),
]);

function stateError(code, message, context = {}) {
  return new PipelineError(code, message, '', {
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

function validTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function assertScope(scope) {
  if (
    !scope ||
    typeof scope !== 'object' ||
    Array.isArray(scope) ||
    ['scopeId', 'domainId', 'domainVersion'].some(
      (key) => typeof scope[key] !== 'string' || scope[key].length === 0,
    )
  ) {
    throw stateError(
      'OPERATING_SCOPE_INVALID',
      'Operating-model state requires one explicit scope and domain binding.',
    );
  }
}

function sameScope(record, scope) {
  return (
    record.scopeId === scope.scopeId &&
    record.domainId === scope.domainId &&
    record.domainVersion === scope.domainVersion
  );
}

function sortedRecords(records, id) {
  if (!Array.isArray(records)) {
    throw stateError(
      'RESULT_CONTRACT_INVALID',
      'Each operating-model state collection must be an array.',
    );
  }
  const seen = new Set();
  const normalized = records.map((record) => clone(record));
  for (const record of normalized) {
    if (typeof record?.[id] !== 'string' || record[id].length === 0 || seen.has(record[id])) {
      throw stateError(
        'STATE_TRANSITION_INVALID',
        'Operating-model state collections require unique durable record identities.',
        {
          id: record?.[id] ?? null,
        },
      );
    }
    seen.add(record[id]);
  }
  return normalized.sort((left, right) => left[id].localeCompare(right[id]));
}

function stateWithoutRuntimeHash(state) {
  const value = clone(state);
  delete value.runtimeHash;
  return value;
}

/** Returns the deterministic JCS hash for safe, portable state metadata. */
export function deriveOperatingModelStateRuntimeHashV2(state) {
  try {
    return sha256Jcs(stateWithoutRuntimeHash(state));
  } catch {
    throw stateError(
      'RESULT_CONTRACT_INVALID',
      'Operating-model state must contain deterministic JSON values.',
    );
  }
}

function validateCollectionRecords(state, scope) {
  for (const { field, kind, id } of OPERATING_MODEL_STATE_COLLECTIONS_V2) {
    const records = state[field];
    const seen = new Set();
    if (!Array.isArray(records)) {
      throw stateError(
        'RESULT_CONTRACT_INVALID',
        `Operating-model state ${field} must be an array.`,
      );
    }
    const canonicalOrder = [...records].sort((left, right) =>
      String(left?.[id] ?? '').localeCompare(String(right?.[id] ?? '')),
    );
    if (records.some((record, position) => record?.[id] !== canonicalOrder[position]?.[id])) {
      throw stateError(
        'STATE_TRANSITION_INVALID',
        'Operating-model state collections must use canonical durable-identity order.',
        {
          field,
        },
      );
    }
    for (const record of records) {
      try {
        assertProtocolArtifact(kind, record, { protocolVersion: PROTOCOL_VERSION });
      } catch (cause) {
        throw stateError(
          'RESULT_CONTRACT_INVALID',
          `Operating-model state contains an invalid ${kind} record.`,
          {
            kind,
            cause: cause.code ?? null,
          },
        );
      }
      if (!sameScope(record, scope) || seen.has(record[id])) {
        throw stateError(
          'OPERATING_SCOPE_INVALID',
          'Operating-model state records must be unique and match the immutable state scope.',
          {
            kind,
            entityId: record?.[id] ?? null,
          },
        );
      }
      seen.add(record[id]);
    }
  }
}

/**
 * Validates a complete OperatingModelStateV2 without consulting storage.
 * Storage/provenance checks intentionally happen in the runtime transaction,
 * where accepted Artifact and EvidenceRef indexes are available.
 */
export function assertOperatingModelStateV2(state) {
  try {
    assertProtocolArtifact('operating-model-state', state, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    throw stateError(
      'RESULT_CONTRACT_INVALID',
      'Operating-model state is not a valid Protocol 2.0 record.',
      {
        cause: cause.code ?? null,
      },
    );
  }
  const scope = {
    scopeId: state.scopeId,
    domainId: state.domainId,
    domainVersion: state.domainVersion,
  };
  assertScope(scope);
  if (!validTimestamp(state.generatedAt)) {
    throw stateError(
      'STATE_TRANSITION_INVALID',
      'Operating-model state requires an Event-owned generatedAt timestamp.',
      {
        stateId: state.stateId,
      },
    );
  }
  validateCollectionRecords(state, scope);
  const expectedHash = deriveOperatingModelStateRuntimeHashV2(state);
  if (state.runtimeHash !== expectedHash) {
    throw stateError(
      'STATE_TRANSITION_INVALID',
      'Operating-model state runtimeHash does not match its immutable safe projection.',
      {
        stateId: state.stateId,
      },
    );
  }
  return freeze(clone(state));
}

/**
 * Builds the exact seven-collection, domain-neutral state record. Domain
 * vocabulary, projections, providers, and execution data have no place here.
 */
export function buildOperatingModelStateV2({
  stateId,
  snapshotId,
  scope,
  collections,
  generatedAt,
}) {
  assertScope(scope);
  if (
    typeof stateId !== 'string' ||
    stateId.length === 0 ||
    typeof snapshotId !== 'string' ||
    snapshotId.length === 0 ||
    !validTimestamp(generatedAt) ||
    !collections ||
    typeof collections !== 'object' ||
    Array.isArray(collections)
  ) {
    throw stateError(
      'STATE_TRANSITION_INVALID',
      'Runtime-owned state identity, snapshot identity, timestamp, and collections are required.',
    );
  }
  const expectedFields = new Set(OPERATING_MODEL_STATE_COLLECTIONS_V2.map(({ field }) => field));
  const suppliedFields = Object.keys(collections);
  const unsupported = suppliedFields.filter((key) => !expectedFields.has(key));
  const missing = [...expectedFields].filter((key) => !Object.hasOwn(collections, key));
  if (unsupported.length > 0 || missing.length > 0) {
    throw stateError(
      'RESULT_CONTRACT_INVALID',
      'Operating-model state requires exactly its seven domain-neutral collections.',
      {
        unsupportedFields: unsupported.sort(),
        missingFields: missing.sort(),
      },
    );
  }
  const state = {
    kind: 'operating-model-state',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    stateId,
    snapshotId,
    scopeId: scope.scopeId,
    domainId: scope.domainId,
    domainVersion: scope.domainVersion,
    objectives: [],
    metrics: [],
    findings: [],
    decisions: [],
    actions: [],
    risks: [],
    assumptions: [],
    generatedAt,
  };
  for (const { field, id } of OPERATING_MODEL_STATE_COLLECTIONS_V2) {
    state[field] = sortedRecords(collections[field], id);
  }
  state.runtimeHash = deriveOperatingModelStateRuntimeHashV2(state);
  return assertOperatingModelStateV2(state);
}
