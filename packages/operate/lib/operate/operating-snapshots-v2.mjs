import { PipelineError } from '@openplanr/protocol/errors';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import {
  assertOperatingModelStateV2,
  buildOperatingModelStateV2,
} from './operating-state-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';

function snapshotError(code, message, context = {}) {
  return new PipelineError(code, message, '', { retryable: false, context: structuredClone(context) });
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
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)
    || ['scopeId', 'domainId', 'domainVersion'].some((key) => (
      typeof scope[key] !== 'string' || scope[key].length === 0
    ))) {
    throw snapshotError('OPERATING_SCOPE_INVALID', 'Operating snapshots require one explicit scope and domain binding.');
  }
}

function normalizedIds(ids, label, { minimum = 0 } = {}) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw snapshotError('RESULT_CONTRACT_INVALID', `${label} must be an array of durable identities.`);
  }
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length || unique.length < minimum) {
    throw snapshotError('RESULT_CONTRACT_INVALID', `${label} must be unique${minimum > 0 ? ' and nonempty' : ''}.`);
  }
  return unique.sort();
}

function normalizedSourceRevisions(sourceRevisions, sourceArtifactIds, evidenceRefIds) {
  if (!Array.isArray(sourceRevisions)) {
    throw snapshotError('RESULT_CONTRACT_INVALID', 'Snapshot source revisions must be an array.');
  }
  const knownSources = new Set(sourceArtifactIds);
  const knownEvidence = new Set(evidenceRefIds);
  const semantic = new Set();
  const normalized = sourceRevisions.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some((key) => !['sourceArtifactId', 'revision', 'evidenceRefIds'].includes(key))
      || typeof entry.sourceArtifactId !== 'string'
      || typeof entry.revision !== 'string' || entry.revision.trim().length === 0
      || !knownSources.has(entry.sourceArtifactId)) {
      throw snapshotError('RESULT_CONTRACT_INVALID', 'Snapshot revisions must bind an included source Artifact to one explicit revision.');
    }
    const refs = entry.evidenceRefIds === undefined
      ? undefined
      : normalizedIds(entry.evidenceRefIds, 'Snapshot revision evidence references');
    if (refs?.some((id) => !knownEvidence.has(id))) {
      throw snapshotError('OPERATING_SCOPE_INVALID', 'Snapshot revisions may reference only included typed EvidenceRefs.', {
        sourceArtifactId: entry.sourceArtifactId,
      });
    }
    const key = `${entry.sourceArtifactId}:${entry.revision}`;
    if (semantic.has(key)) {
      throw snapshotError('RESULT_CONTRACT_INVALID', 'Snapshot source revisions must not duplicate a source Artifact and revision pair.', {
        sourceArtifactId: entry.sourceArtifactId,
      });
    }
    semantic.add(key);
    return {
      sourceArtifactId: entry.sourceArtifactId,
      revision: entry.revision,
      ...(refs === undefined ? {} : { evidenceRefIds: refs }),
    };
  });
  return normalized.sort((left, right) => (
    left.sourceArtifactId.localeCompare(right.sourceArtifactId)
    || left.revision.localeCompare(right.revision)
  ));
}

function snapshotWithoutRuntimeHash(snapshot) {
  const value = clone(snapshot);
  delete value.runtimeHash;
  return value;
}

function sameCanonicalArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => sha256Jcs(value) === sha256Jcs(expected[index]));
}

/** Returns the deterministic JCS hash for a safe immutable snapshot descriptor. */
export function deriveOperatingSnapshotRuntimeHashV2(snapshot) {
  try {
    return sha256Jcs(snapshotWithoutRuntimeHash(snapshot));
  } catch {
    throw snapshotError('RESULT_CONTRACT_INVALID', 'Operating snapshots must contain deterministic JSON values.');
  }
}

/** Validates one safe snapshot descriptor and its linked core state. */
export function assertOperatingSnapshotV2(snapshot, { state, previousSnapshotId } = {}) {
  try {
    assertProtocolArtifact('operating-snapshot', snapshot, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    throw snapshotError('RESULT_CONTRACT_INVALID', 'Operating snapshot is not a valid Protocol 2.0 record.', {
      cause: cause.code ?? null,
    });
  }
  if (!validTimestamp(snapshot.createdAt)) {
    throw snapshotError('STATE_TRANSITION_INVALID', 'Operating snapshots require an Event-owned createdAt timestamp.', {
      snapshotId: snapshot.snapshotId,
    });
  }
  const sourceArtifactIds = normalizedIds(snapshot.sourceArtifactIds, 'Snapshot source Artifacts', { minimum: 1 });
  const evidenceRefIds = normalizedIds(snapshot.evidenceRefIds, 'Snapshot EvidenceRefs');
  const sourceRevisions = normalizedSourceRevisions(
    snapshot.sourceRevisions,
    sourceArtifactIds,
    evidenceRefIds,
  );
  if (!sameCanonicalArray(snapshot.sourceArtifactIds, sourceArtifactIds)
    || !sameCanonicalArray(snapshot.evidenceRefIds, evidenceRefIds)
    || !sameCanonicalArray(snapshot.sourceRevisions, sourceRevisions)) {
    throw snapshotError('STATE_TRANSITION_INVALID', 'Operating snapshots must retain canonically ordered safe provenance descriptors.', {
      snapshotId: snapshot.snapshotId,
    });
  }
  if (snapshot.domainContract.apiDomainId !== snapshot.domainId
    || snapshot.domainContract.version !== snapshot.domainVersion) {
    throw snapshotError('OPERATING_SCOPE_INVALID', 'Snapshot domain-contract identity must match its explicit API domain and version.', {
      snapshotId: snapshot.snapshotId,
    });
  }
  if (previousSnapshotId !== undefined && snapshot.previousSnapshotId !== previousSnapshotId) {
    throw snapshotError('STATE_TRANSITION_INVALID', 'Snapshot prior linkage is not the deterministic current-scope predecessor.', {
      snapshotId: snapshot.snapshotId,
      previousSnapshotId,
    });
  }
  if (snapshot.runtimeHash !== deriveOperatingSnapshotRuntimeHashV2(snapshot)) {
    throw snapshotError('STATE_TRANSITION_INVALID', 'Operating snapshot runtimeHash does not match its immutable safe descriptor.', {
      snapshotId: snapshot.snapshotId,
    });
  }
  if (state !== undefined) {
    const linked = assertOperatingModelStateV2(state);
    if (linked.stateId !== snapshot.stateId
      || linked.snapshotId !== snapshot.snapshotId
      || linked.scopeId !== snapshot.scopeId
      || linked.domainId !== snapshot.domainId
      || linked.domainVersion !== snapshot.domainVersion
      || linked.generatedAt !== snapshot.createdAt) {
      throw snapshotError('STATE_TRANSITION_INVALID', 'Snapshot and operating-model state must have one exact immutable binding.', {
        snapshotId: snapshot.snapshotId,
        stateId: snapshot.stateId,
      });
    }
  }
  return freeze(clone(snapshot));
}

function expectedPreviousSnapshotId(previousSnapshots, scope) {
  const matches = (previousSnapshots ?? [])
    .filter((snapshot) => snapshot.scopeId === scope.scopeId
      && snapshot.domainId === scope.domainId
      && snapshot.domainVersion === scope.domainVersion)
    .sort((left, right) => (
      left.createdAt.localeCompare(right.createdAt)
      || left.snapshotId.localeCompare(right.snapshotId)
    ));
  return matches.at(-1)?.snapshotId ?? null;
}

/**
 * Builds the two immutable records for the runtime-owned snapshot/state
 * transaction. It has no storage or dispatch dependency; callers must prove
 * Artifact and EvidenceRef provenance before committing its returned records.
 */
export function buildOperatingSnapshotStateTransactionV2(request, draft, {
  previousSnapshots = [],
} = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || !draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw snapshotError('RESULT_CONTRACT_INVALID', 'Snapshot materialization requires a validated manifest and runtime-owned draft.');
  }
  const supportedRequest = new Set(['scope', 'domainContract', 'sourceArtifactIds', 'evidenceRefIds', 'sourceRevisions', 'collections']);
  const unsupportedRequest = Object.keys(request).filter((key) => !supportedRequest.has(key));
  const supportedDraft = new Set(['snapshotId', 'stateId', 'timestamp']);
  const unsupportedDraft = Object.keys(draft).filter((key) => !supportedDraft.has(key));
  if (unsupportedRequest.length > 0 || unsupportedDraft.length > 0
    || typeof draft.snapshotId !== 'string' || draft.snapshotId.length === 0
    || typeof draft.stateId !== 'string' || draft.stateId.length === 0
    || !validTimestamp(draft.timestamp)) {
    throw snapshotError('STATE_TRANSITION_INVALID', 'Snapshot materialization must use only complete runtime-owned identities and timestamp.');
  }
  assertScope(request.scope);
  const scope = request.scope;
  if (!request.domainContract || typeof request.domainContract !== 'object' || Array.isArray(request.domainContract)
    || Object.keys(request.domainContract).some((key) => !['apiDomainId', 'id', 'version'].includes(key))
    || request.domainContract.apiDomainId !== scope.domainId
    || request.domainContract.version !== scope.domainVersion
    || typeof request.domainContract.id !== 'string' || request.domainContract.id.length === 0) {
    throw snapshotError('OPERATING_SCOPE_INVALID', 'Snapshot materialization requires an explicit matching public domain-contract identity.');
  }
  const sourceArtifactIds = normalizedIds(request.sourceArtifactIds, 'Snapshot source Artifacts', { minimum: 1 });
  const evidenceRefIds = normalizedIds(request.evidenceRefIds ?? [], 'Snapshot EvidenceRefs');
  const sourceRevisions = normalizedSourceRevisions(request.sourceRevisions ?? [], sourceArtifactIds, evidenceRefIds);
  const previousSnapshotId = expectedPreviousSnapshotId(previousSnapshots, scope);
  const state = buildOperatingModelStateV2({
    stateId: draft.stateId,
    snapshotId: draft.snapshotId,
    scope,
    collections: request.collections,
    generatedAt: draft.timestamp,
  });
  const snapshot = {
    kind: 'operating-snapshot', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
    snapshotId: draft.snapshotId,
    scopeId: scope.scopeId, domainId: scope.domainId, domainVersion: scope.domainVersion,
    domainContract: clone(request.domainContract),
    stateId: state.stateId,
    previousSnapshotId,
    sourceArtifactIds,
    evidenceRefIds,
    sourceRevisions,
    createdAt: draft.timestamp,
  };
  snapshot.runtimeHash = deriveOperatingSnapshotRuntimeHashV2(snapshot);
  return freeze({
    snapshot: assertOperatingSnapshotV2(snapshot, { state, previousSnapshotId }),
    state,
  });
}
