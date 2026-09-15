import { PipelineError } from '@openplanr/protocol/errors';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { dispatchOperateEvidenceResolverV2 } from './evidence-v2.mjs';
import { createHash } from 'node:crypto';

const PROTOCOL_VERSION = '2.0.0';
const CLASSIFICATION_RANK = Object.freeze({
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
});
const MATERIALIZATION_BLOBS = new WeakMap();

function rawHashForBytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function materializationError(code, message, context = {}) {
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

function exactBytes(value, label) {
  if (!(value instanceof Uint8Array)) {
    throw materializationError('RESULT_CONTRACT_INVALID', `${label} must be exact binary bytes.`);
  }
  return Buffer.from(value);
}

function assertArtifactBytes(artifact, bytes, label) {
  try {
    assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    throw materializationError('ARTIFACT_NOT_FOUND', `${label} metadata is not a valid v2 Artifact.`, {
      cause: cause.code ?? null,
    });
  }
  if (bytes.byteLength !== artifact.sizeBytes || rawHashForBytes(bytes) !== artifact.rawHash) {
    throw materializationError('ARTIFACT_HASH_MISMATCH', `${label} bytes do not match its immutable Artifact identity.`, {
      artifactId: artifact.artifactId,
      rawHash: artifact.rawHash,
    });
  }
}

function requireByteStore(store) {
  if (!store || typeof store.readRaw !== 'function' || typeof store.stageRaw !== 'function') {
    throw materializationError('ARTIFACT_NOT_FOUND', 'Evidence materialization requires the runtime Artifact byte store.');
  }
  return store;
}

/**
 * The core runtime keeps exact raw Artifact bytes outside durable projections.
 * A production adapter implements these two methods inside its artifact/event
 * transaction; this in-memory reference implementation proves the identity,
 * hash, and retrieval contract without serializing bytes into state or Events.
 */
export function createOperatingArtifactByteStoreV2() {
  const entries = new Map();
  return Object.freeze({
    stageRaw({ artifact, rawBytes }) {
      const bytes = exactBytes(rawBytes, 'Artifact raw bytes');
      assertArtifactBytes(artifact, bytes, 'Artifact');
      const existing = entries.get(artifact.artifactId);
      if (existing) {
        if (existing.rawHash !== artifact.rawHash || !existing.bytes.equals(bytes)) {
          throw materializationError('SUBMISSION_ID_CONFLICT', 'Artifact identity is already bound to different exact bytes.', {
            artifactId: artifact.artifactId,
          });
        }
        return true;
      }
      entries.set(artifact.artifactId, Object.freeze({ rawHash: artifact.rawHash, bytes: Buffer.from(bytes) }));
      return true;
    },
    readRaw({ artifactId, rawHash }) {
      const entry = entries.get(artifactId);
      if (!entry) {
        throw materializationError('ARTIFACT_NOT_FOUND', 'Artifact raw bytes are unavailable from the runtime Artifact store.', {
          artifactId,
        });
      }
      if (entry.rawHash !== rawHash) {
        throw materializationError('ARTIFACT_HASH_MISMATCH', 'Artifact raw bytes do not match the requested immutable hash.', {
          artifactId,
          rawHash,
        });
      }
      const bytes = Buffer.from(entry.bytes);
      if (rawHashForBytes(bytes) !== rawHash) {
        throw materializationError('ARTIFACT_HASH_MISMATCH', 'Artifact raw bytes failed immutable hash verification.', {
          artifactId,
          rawHash,
        });
      }
      return bytes;
    },
  });
}

export function readOperatingArtifactRawBytesV2(store, { artifactId, rawHash }) {
  if (typeof artifactId !== 'string' || artifactId.length === 0 || typeof rawHash !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(rawHash)) {
    throw materializationError('ARTIFACT_NOT_FOUND', 'Artifact raw retrieval requires an immutable Artifact identity and SHA-256 hash.');
  }
  const bytes = exactBytes(requireByteStore(store).readRaw({ artifactId, rawHash }), 'Stored Artifact raw bytes');
  if (rawHashForBytes(bytes) !== rawHash) {
    throw materializationError('ARTIFACT_HASH_MISMATCH', 'Artifact raw retrieval failed immutable hash verification.', {
      artifactId,
      rawHash,
    });
  }
  return bytes;
}

function runtimeIssuedEdgeId({ sourceArtifactId, localClaimId, relation, evidenceRefId }) {
  const digest = sha256Jcs({
    contract: 'operate-v2-evidence-edge',
    sourceArtifactId,
    localClaimId,
    relation,
    evidenceRefId,
  }).slice('sha256:'.length);
  return `eve_${digest}`;
}

function captureHash(capture) {
  return sha256Jcs(capture);
}

function resolutionError(candidate, resolved, draft) {
  const error = resolved?.error;
  if (!error || typeof error !== 'object') {
    throw materializationError('STATE_TRANSITION_INVALID', 'A rejected evidence resolution requires a structured safe error.');
  }
  const resolution = {
    kind: 'operating-evidence-resolution', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
    resolutionId: draft.resolutionId,
    candidateId: candidate.candidateId,
    scopeId: candidate.scopeId, domainId: candidate.domainId, domainVersion: candidate.domainVersion,
    sourceArtifactId: candidate.sourceArtifactId, evidenceKind: candidate.evidenceKind,
    sourceContract: null,
    provider: clone(candidate.provider), resolver: clone(candidate.resolver),
    outcome: 'rejected', evidenceRefId: null, evidenceArtifactId: null,
    error: clone(error), resolvedAt: draft.timestamp,
  };
  try {
    assertProtocolArtifact('operating-evidence-resolution', resolution, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    throw materializationError('RESULT_CONTRACT_INVALID', 'The resolver returned an invalid evidence rejection.', {
      candidateId: candidate.candidateId,
      cause: cause.code ?? null,
    });
  }
  return resolution;
}

function normalizedInputs(sourceArtifactId, capture) {
  const identifiers = [sourceArtifactId];
  if (typeof capture.artifactId === 'string') identifiers.push(capture.artifactId);
  return [...new Set(identifiers)].sort();
}

function classificationFor(sourceArtifact, capture) {
  const source = CLASSIFICATION_RANK[sourceArtifact.sensitivity];
  const captured = CLASSIFICATION_RANK[capture.classification];
  if (source === undefined || captured === undefined) {
    throw materializationError('RESULT_CONTRACT_INVALID', 'Evidence classification must be an explicit known value.');
  }
  return Object.keys(CLASSIFICATION_RANK).find((key) => CLASSIFICATION_RANK[key] === Math.max(source, captured));
}

function buildSnapshotArtifact({ candidate, sourceArtifact, capture, draft }) {
  const artifact = {
    kind: 'operating-artifact', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
    artifactId: draft.evidenceArtifactId,
    artifactType: 'evidence-snapshot',
    assignmentId: sourceArtifact.assignmentId,
    cycleId: sourceArtifact.cycleId,
    scopeId: candidate.scopeId,
    domainId: candidate.domainId,
    domainVersion: candidate.domainVersion,
    schemaId: 'operating-evidence-snapshot',
    artifactSchemaVersion: '1.0.0',
    mediaType: 'application/octet-stream',
    encoding: 'binary',
    rawHash: capture.rawHash,
    canonicalHash: capture.canonicalHash ?? null,
    sizeBytes: capture.sizeBytes,
    storageClass: 'machine-local',
    sensitivity: capture.classification,
    retentionClass: capture.retentionClass ?? 'restricted-machine-local',
    producer: { actorId: 'openplanr', roleId: 'evidence-resolver', runtime: 'openplanr' },
    inputArtifactIds: normalizedInputs(candidate.sourceArtifactId, capture),
    createdAt: draft.timestamp,
  };
  try {
    assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    throw materializationError('RESULT_CONTRACT_INVALID', 'The runtime-built evidence snapshot Artifact is invalid.', {
      candidateId: candidate.candidateId,
      cause: cause.code ?? null,
    });
  }
  return artifact;
}

function buildEvidenceRef({ candidate, capture, artifact, draft }) {
  const evidenceRef = {
    kind: 'operating-evidence-ref', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
    evidenceRefId: draft.evidenceRefId,
    candidateId: candidate.candidateId,
    scopeId: candidate.scopeId, domainId: candidate.domainId, domainVersion: candidate.domainVersion,
    sourceArtifactId: candidate.sourceArtifactId,
    evidenceKind: candidate.evidenceKind,
    sourceContract: clone(capture.sourceContract),
    locator: clone(capture.locator),
    provider: clone(candidate.provider), resolver: clone(candidate.resolver),
    classification: capture.classification,
    freshness: capture.freshness,
    evidenceArtifactId: artifact.artifactId,
    evidenceArtifactRawHash: artifact.rawHash,
    evidenceArtifactCanonicalHash: artifact.canonicalHash,
    resolvedAt: draft.timestamp,
  };
  try {
    assertProtocolArtifact('operating-evidence-ref', evidenceRef, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    throw materializationError('RESULT_CONTRACT_INVALID', 'The runtime-built EvidenceRef is invalid.', {
      candidateId: candidate.candidateId,
      cause: cause.code ?? null,
    });
  }
  return evidenceRef;
}

function buildResolvedResolution({ candidate, evidenceRef, artifact, draft }) {
  const resolution = {
    kind: 'operating-evidence-resolution', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
    resolutionId: draft.resolutionId,
    candidateId: candidate.candidateId,
    scopeId: candidate.scopeId, domainId: candidate.domainId, domainVersion: candidate.domainVersion,
    sourceArtifactId: candidate.sourceArtifactId, evidenceKind: candidate.evidenceKind,
    sourceContract: clone(evidenceRef.sourceContract),
    provider: clone(candidate.provider), resolver: clone(candidate.resolver),
    outcome: 'resolved', evidenceRefId: evidenceRef.evidenceRefId, evidenceArtifactId: artifact.artifactId,
    error: null, resolvedAt: draft.timestamp,
  };
  try {
    assertProtocolArtifact('operating-evidence-resolution', resolution, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    throw materializationError('RESULT_CONTRACT_INVALID', 'The runtime-built evidence resolution is invalid.', {
      candidateId: candidate.candidateId,
      cause: cause.code ?? null,
    });
  }
  return resolution;
}

function normalizeClaimLinks(claimLinks, { candidate, sourceArtifact, evidenceRef, timestamp }) {
  if (claimLinks === undefined) return [];
  if (!Array.isArray(claimLinks)) {
    throw materializationError('RESULT_CONTRACT_INVALID', 'Evidence claim links must be an array.');
  }
  const edges = claimLinks.map((link) => {
    if (!link || typeof link !== 'object' || Array.isArray(link)
      || Object.keys(link).some((key) => !['sourceArtifactId', 'localClaimId', 'relation', 'confidence'].includes(key))
      || link.sourceArtifactId !== candidate.sourceArtifactId
      || typeof link.localClaimId !== 'string'
      || !['supportedBy', 'contradictedBy'].includes(link.relation)
      || typeof link.confidence !== 'number'
      || !Number.isFinite(link.confidence)
      || link.confidence < 0
      || link.confidence > 1) {
      throw materializationError('RESULT_CONTRACT_INVALID',
        'A Phase 4 evidence link must be a source-Artifact-local typed support or contradiction proposal.', {
          sourceArtifactId: candidate.sourceArtifactId,
        });
    }
    const edge = {
      kind: 'operating-evidence-edge', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
      edgeId: runtimeIssuedEdgeId({
        sourceArtifactId: candidate.sourceArtifactId,
        localClaimId: link.localClaimId,
        relation: link.relation,
        evidenceRefId: evidenceRef.evidenceRefId,
      }),
      scopeId: candidate.scopeId,
      domainId: candidate.domainId,
      domainVersion: candidate.domainVersion,
      sourceArtifactId: candidate.sourceArtifactId,
      localClaimId: link.localClaimId,
      relation: link.relation,
      evidenceRefId: evidenceRef.evidenceRefId,
      createdBy: { kind: 'runtime', id: 'openplanr' },
      createdAt: timestamp,
      confidence: link.confidence,
      classification: classificationFor(sourceArtifact, evidenceRef),
    };
    try {
      assertProtocolArtifact('operating-evidence-edge', edge, { protocolVersion: PROTOCOL_VERSION });
    } catch (cause) {
      throw materializationError('RESULT_CONTRACT_INVALID', 'The runtime-built evidence edge is invalid.', {
        sourceArtifactId: candidate.sourceArtifactId,
        cause: cause.code ?? null,
      });
    }
    return edge;
  });
  const duplicate = new Set();
  for (const edge of edges) {
    const key = `${edge.sourceArtifactId}:${edge.localClaimId}:${edge.relation}:${edge.evidenceRefId}`;
    if (duplicate.has(key)) {
      throw materializationError('STATE_TRANSITION_INVALID', 'Duplicate source-Artifact-local evidence links are forbidden.', {
        sourceArtifactId: edge.sourceArtifactId,
        localClaimId: edge.localClaimId,
        relation: edge.relation,
      });
    }
    duplicate.add(key);
  }
  return edges;
}

function assertSourceBinding(candidate, sourceArtifact, inputBinding) {
  try {
    assertProtocolArtifact('operating-evidence-candidate', candidate, { protocolVersion: PROTOCOL_VERSION });
    assertProtocolArtifact('operating-artifact', sourceArtifact, { protocolVersion: PROTOCOL_VERSION });
    assertProtocolArtifact('operating-cycle-input-binding', inputBinding, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    throw materializationError('RESULT_CONTRACT_INVALID', 'Evidence materialization requires valid v2 candidate, source Artifact, and input binding.', {
      cause: cause.code ?? null,
    });
  }
  if (
    candidate.sourceArtifactId !== sourceArtifact.artifactId
    || candidate.scopeId !== sourceArtifact.scopeId
    || candidate.domainId !== sourceArtifact.domainId
    || candidate.domainVersion !== sourceArtifact.domainVersion
    || inputBinding.cycleId !== sourceArtifact.cycleId
    || inputBinding.scopeId !== candidate.scopeId
    || inputBinding.domainId !== candidate.domainId
    || inputBinding.domainVersion !== candidate.domainVersion
  ) {
    throw materializationError('OPERATING_SCOPE_INVALID', 'Evidence candidate, source Artifact, and Cycle input binding must share one immutable scope/domain binding.', {
      candidateId: candidate?.candidateId ?? null,
      sourceArtifactId: candidate?.sourceArtifactId ?? null,
      inputBindingId: inputBinding?.inputBindingId ?? null,
    });
  }
}

function assertDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw materializationError('STATE_TRANSITION_INVALID', 'Evidence materialization requires a runtime-owned draft.');
  }
  const allowed = new Set(['resolutionId', 'eventId', 'timestamp', 'correlationId', 'evidenceRefId', 'evidenceArtifactId']);
  const unsupported = Object.keys(draft).filter((key) => !allowed.has(key));
  if (unsupported.length > 0
    || typeof draft.resolutionId !== 'string' || draft.resolutionId.length === 0
    || typeof draft.eventId !== 'string' || draft.eventId.length === 0
    || typeof draft.correlationId !== 'string' || draft.correlationId.length === 0
    || !validTimestamp(draft.timestamp)
    || (draft.evidenceRefId !== undefined && (typeof draft.evidenceRefId !== 'string' || draft.evidenceRefId.length === 0))
    || (draft.evidenceArtifactId !== undefined && (typeof draft.evidenceArtifactId !== 'string' || draft.evidenceArtifactId.length === 0))) {
    throw materializationError('STATE_TRANSITION_INVALID', 'Evidence materialization draft is incomplete or contains unsupported fields.');
  }
  return {
    resolutionId: draft.resolutionId,
    eventId: draft.eventId,
    timestamp: draft.timestamp,
    correlationId: draft.correlationId,
    ...(draft.evidenceRefId === undefined ? {} : { evidenceRefId: draft.evidenceRefId }),
    ...(draft.evidenceArtifactId === undefined ? {} : { evidenceArtifactId: draft.evidenceArtifactId }),
  };
}

/**
 * This fingerprint intentionally contains only the caller-visible evidence
 * request and runtime-issued draft. It is computed before any source or
 * resolver read, so an exact durable replay cannot be reopened by a changed
 * filesystem, Git worktree, or other mutable resolver input.
 */
export function deriveOperatingEvidenceRequestHashV2({ candidate, claimLinks, draft }) {
  const normalizedDraft = assertDraft(draft);
  try {
    const normalizedLinks = Array.isArray(claimLinks)
      ? [...claimLinks].sort((left, right) => sha256Jcs(left).localeCompare(sha256Jcs(right)))
      : claimLinks ?? [];
    return sha256Jcs({
      candidate,
      claimLinks: normalizedLinks,
      draft: normalizedDraft,
    });
  } catch {
    throw materializationError('RESULT_CONTRACT_INVALID', 'Evidence materialization inputs must be deterministic JSON values.');
  }
}

function compareProofLinks(left, right) {
  return sha256Jcs(left) === sha256Jcs(right);
}

function normalizeProofLinks(links, { candidateId, sourceArtifactId, allowCandidateId }) {
  if (!Array.isArray(links)) {
    throw materializationError('RESULT_CONTRACT_INVALID', 'Evidence claim links must be an array.', { candidateId });
  }
  const expectedFields = allowCandidateId
    ? ['candidateId', 'sourceArtifactId', 'localClaimId', 'relation', 'confidence']
    : ['sourceArtifactId', 'localClaimId', 'relation', 'confidence'];
  const normalized = links.map((link) => {
    if (!link || typeof link !== 'object' || Array.isArray(link)
      || Object.keys(link).some((key) => !expectedFields.includes(key))
      || (allowCandidateId && link.candidateId !== candidateId)
      || link.sourceArtifactId !== sourceArtifactId
      || typeof link.localClaimId !== 'string' || link.localClaimId.length === 0
      || !['supportedBy', 'contradictedBy'].includes(link.relation)
      || typeof link.confidence !== 'number' || !Number.isFinite(link.confidence)
      || link.confidence < 0 || link.confidence > 1) {
      throw materializationError('RESULT_CONTRACT_INVALID',
        'Evidence proof links must be typed source-Artifact-local proposals declared by the accepted result.', {
          candidateId,
          sourceArtifactId,
        });
    }
    return {
      sourceArtifactId: link.sourceArtifactId,
      localClaimId: link.localClaimId,
      relation: link.relation,
      confidence: link.confidence,
    };
  }).sort((left, right) => sha256Jcs(left).localeCompare(sha256Jcs(right)));
  const keys = new Set();
  for (const link of normalized) {
    const key = `${link.sourceArtifactId}:${link.localClaimId}:${link.relation}`;
    if (keys.has(key)) {
      throw materializationError('STATE_TRANSITION_INVALID', 'Duplicate source-Artifact-local evidence links are forbidden.', {
        candidateId,
        sourceArtifactId,
        localClaimId: link.localClaimId,
        relation: link.relation,
      });
    }
    keys.add(key);
  }
  return normalized;
}

function readDeclaredEvidencePayload(sourceArtifact, artifactStore, candidate, requestedClaimLinks) {
  if (sourceArtifact.mediaType !== 'application/json' || sourceArtifact.encoding !== 'utf-8') {
    throw materializationError('RESULT_CONTRACT_INVALID', 'Evidence candidates require a validated JSON source Artifact.', {
      artifactId: sourceArtifact.artifactId,
    });
  }
  const rawBytes = readOperatingArtifactRawBytesV2(artifactStore, {
    artifactId: sourceArtifact.artifactId,
    rawHash: sourceArtifact.rawHash,
  });
  const text = rawBytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(rawBytes)) {
    throw materializationError('RESULT_CONTRACT_INVALID', 'Evidence candidates require a UTF-8 source Artifact body.', {
      artifactId: sourceArtifact.artifactId,
    });
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw materializationError('RESULT_CONTRACT_INVALID', 'Evidence candidates require a JSON source Artifact body.', {
      artifactId: sourceArtifact.artifactId,
    });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || !Array.isArray(body.evidenceCandidates) || !Array.isArray(body.evidenceClaimLinks)) {
    throw materializationError('RESULT_CONTRACT_INVALID',
      'The validated source Artifact must declare evidenceCandidates and evidenceClaimLinks.', {
        artifactId: sourceArtifact.artifactId,
      });
  }
  const candidates = body.evidenceCandidates.filter((entry) => entry?.candidateId === candidate?.candidateId);
  if (candidates.length !== 1) {
    throw materializationError('RESULT_CONTRACT_INVALID', 'The requested evidence candidate is not uniquely declared by the validated source Artifact.', {
      artifactId: sourceArtifact.artifactId,
      candidateId: candidate?.candidateId ?? null,
    });
  }
  const declaredCandidate = candidates[0];
  try {
    assertProtocolArtifact('operating-evidence-candidate', declaredCandidate, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    throw materializationError('RESULT_CONTRACT_INVALID', 'The validated source Artifact declares an invalid evidence candidate.', {
      artifactId: sourceArtifact.artifactId,
      candidateId: candidate?.candidateId ?? null,
      cause: cause.code ?? null,
    });
  }
  if (sha256Jcs(declaredCandidate) !== sha256Jcs(candidate)) {
    throw materializationError('RESULT_CONTRACT_INVALID', 'Caller-supplied evidence candidate does not match the validated source Artifact.', {
      artifactId: sourceArtifact.artifactId,
      candidateId: candidate?.candidateId ?? null,
    });
  }
  const declaredLinks = normalizeProofLinks(
    body.evidenceClaimLinks.filter((link) => link?.candidateId === declaredCandidate.candidateId),
    { candidateId: declaredCandidate.candidateId, sourceArtifactId: sourceArtifact.artifactId, allowCandidateId: true },
  );
  const suppliedLinks = normalizeProofLinks(requestedClaimLinks ?? [], {
    candidateId: declaredCandidate.candidateId,
    sourceArtifactId: sourceArtifact.artifactId,
    allowCandidateId: false,
  });
  if (!compareProofLinks(declaredLinks, suppliedLinks)) {
    throw materializationError('RESULT_CONTRACT_INVALID', 'Caller-supplied evidence proof links do not match the validated source Artifact.', {
      artifactId: sourceArtifact.artifactId,
      candidateId: declaredCandidate.candidateId,
    });
  }
  return freeze({ candidate: clone(declaredCandidate), claimLinks: clone(declaredLinks) });
}

function capturedRawBytes(capture) {
  if (capture?.contentBase64 === undefined) return null;
  if (typeof capture.contentBase64 !== 'string'
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(capture.contentBase64)) {
    throw materializationError('RESULT_CONTRACT_INVALID', 'Resolver capture content must be exact base64 bytes.');
  }
  const bytes = Buffer.from(capture.contentBase64, 'base64');
  if (capture.sizeBytes !== bytes.byteLength || capture.rawHash !== rawHashForBytes(bytes)) {
    throw materializationError('ARTIFACT_HASH_MISMATCH', 'Resolver capture bytes do not match their immutable metadata.');
  }
  return bytes;
}

function assertResolverSourceContract(dispatch) {
  const sourceContract = dispatch?.capture?.sourceContract;
  const supported = dispatch?.resolver?.supportedSourceContracts;
  if (!sourceContract || typeof sourceContract !== 'object' || Array.isArray(sourceContract)
    || Object.keys(sourceContract).sort().join(',') !== 'id,version'
    || typeof sourceContract.id !== 'string' || typeof sourceContract.version !== 'string'
    || !Array.isArray(supported)
    || !supported.some((entry) => (
      entry.id === sourceContract.id && entry.version === sourceContract.version
    ))) {
    throw materializationError('RESULT_CONTRACT_INVALID',
      'Resolved evidence must retain one resolver-captured registered source contract.', {
        resolverId: dispatch?.resolver?.resolverId ?? null,
        sourceContract: sourceContract ?? null,
      });
  }
  return sourceContract;
}

function materializationResult(value, blob) {
  const result = freeze(value);
  MATERIALIZATION_BLOBS.set(result, blob === null ? null : Buffer.from(blob));
  return result;
}

function materializationBlob(result) {
  return MATERIALIZATION_BLOBS.get(result) ?? null;
}

function outcomeHash({ requestFingerprint, dispatch }) {
  return sha256Jcs({
    requestHash: requestFingerprint,
    dispatch: {
      status: dispatch.status,
      provider: dispatch.provider ?? null,
      resolver: dispatch.resolver ?? null,
      capture: dispatch.capture ?? null,
      error: dispatch.error ?? null,
    },
  });
}

/**
 * Builds the complete immutable evidence materialization value before the
 * reducer mutates any projection. Resolver execution stays in this bounded
 * runtime path; it cannot create Artifact/Event/Claim state by itself.
 */
export function buildOperatingEvidenceMaterializationV2({
  candidate,
  sourceArtifact,
  inputBinding,
  registry,
  resolverContext = {},
  draft,
  claimLinks,
}) {
  assertSourceBinding(candidate, sourceArtifact, inputBinding);
  const normalizedDraft = assertDraft(draft);
  const requestFingerprint = deriveOperatingEvidenceRequestHashV2({
    candidate,
    draft: normalizedDraft,
    claimLinks,
  });
  const dispatch = dispatchOperateEvidenceResolverV2(registry, candidate, {
    ...resolverContext,
    scope: {
      scopeId: inputBinding.scopeId,
      domainId: inputBinding.domainId,
      domainVersion: inputBinding.domainVersion,
    },
  });
  const resolvedDispatch = dispatch.status === 'resolved';
  if (resolvedDispatch && (typeof normalizedDraft.evidenceRefId !== 'string' || typeof normalizedDraft.evidenceArtifactId !== 'string')) {
    throw materializationError('STATE_TRANSITION_INVALID',
      'A resolved evidence transaction requires runtime-issued EvidenceRef and evidence-snapshot Artifact identities.', {
        candidateId: candidate.candidateId,
      });
  }
  const fingerprint = outcomeHash({ requestFingerprint, dispatch });
  if (!resolvedDispatch) {
    const resolution = resolutionError(candidate, dispatch, normalizedDraft);
    return materializationResult({
      outcome: 'rejected',
      requestHash: requestFingerprint,
      outcomeHash: fingerprint,
      resolution,
      evidenceRef: null,
      evidenceArtifact: null,
      edges: [],
      captureHash: null,
    }, null);
  }
  assertResolverSourceContract(dispatch);
  const rawBytes = capturedRawBytes(dispatch.capture);
  const artifact = buildSnapshotArtifact({ candidate, sourceArtifact, capture: dispatch.capture, draft: normalizedDraft });
  const evidenceRef = buildEvidenceRef({ candidate, capture: dispatch.capture, artifact, draft: normalizedDraft });
  const resolution = buildResolvedResolution({ candidate, evidenceRef, artifact, draft: normalizedDraft });
  const edges = normalizeClaimLinks(claimLinks, {
    candidate,
    sourceArtifact,
    evidenceRef,
    timestamp: normalizedDraft.timestamp,
  });
  return materializationResult({
    outcome: 'resolved',
    requestHash: requestFingerprint,
    outcomeHash: fingerprint,
    resolution,
    evidenceRef,
    evidenceArtifact: artifact,
    edges,
    captureHash: captureHash(dispatch.capture),
  }, rawBytes);
}

export function deriveOperatingEvidenceEdgeIdV2(input) {
  return runtimeIssuedEdgeId(input);
}

/** Internal runtime hook: raw bytes never enter events or projections. */
export function stageOperatingEvidenceMaterializationBlobV2(materialization, store) {
  if (materialization?.outcome !== 'resolved' || !materialization.evidenceArtifact) return null;
  const bytes = materializationBlob(materialization);
  if (bytes === null) return null;
  requireByteStore(store).stageRaw({ artifact: materialization.evidenceArtifact, rawBytes: bytes });
  return true;
}

/** Internal runtime hook for reference resolvers that captured metadata only. */
export function setOperatingEvidenceMaterializationBlobV2(materialization, bytes) {
  const exact = exactBytes(bytes, 'Referenced evidence Artifact raw bytes');
  assertArtifactBytes(materialization?.evidenceArtifact, exact, 'Referenced evidence Artifact');
  MATERIALIZATION_BLOBS.set(materialization, exact);
  return true;
}

export function validateOperatingEvidenceSourcePayloadV2({
  sourceArtifact,
  artifactStore,
  candidate,
  claimLinks,
}) {
  return readDeclaredEvidencePayload(sourceArtifact, requireByteStore(artifactStore), candidate, claimLinks);
}
