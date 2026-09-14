import { PipelineError } from '../protocol/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';

const PROTOCOL_VERSION = '2.0.0';

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

function projectionError(message, context = {}) {
  return new PipelineError('STATE_TRANSITION_INVALID', message, '', { retryable: false, context });
}

function assertScope(scope) {
  if (!scope || typeof scope !== 'object'
    || ['scopeId', 'domainId', 'domainVersion'].some((key) => typeof scope[key] !== 'string' || scope[key].length === 0)) {
    throw projectionError('An evidence graph requires an explicit scope/domain binding.');
  }
}

function sameScope(record, scope) {
  return record.scopeId === scope.scopeId
    && record.domainId === scope.domainId
    && record.domainVersion === scope.domainVersion;
}

/**
 * Rebuilds the Phase 4 evidence ledger/graph from a valid checkpoint. It is
 * a pure read-only projection: it creates no Claim or Operating State and
 * cannot modify the supplied runtime projection.
 */
export function buildOperatingEvidenceGraphV2(state, scope, { generatedAt = state?.generatedAt } = {}) {
  try {
    assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    throw projectionError('An evidence graph requires a valid v2 runtime checkpoint.', { cause: cause.code ?? null });
  }
  assertScope(scope);
  if (typeof generatedAt !== 'string' || Number.isNaN(Date.parse(generatedAt))) {
    throw projectionError('An evidence graph requires an explicit generated timestamp.');
  }
  const evidenceRefs = (state.evidenceRefs ?? [])
    .filter((record) => sameScope(record, scope))
    .map(clone)
    .sort((left, right) => left.evidenceRefId.localeCompare(right.evidenceRefId));
  const knownRefs = new Map(evidenceRefs.map((record) => [record.evidenceRefId, record]));
  const artifacts = new Map(state.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  const edges = (state.evidenceEdges ?? [])
    .filter((record) => sameScope(record, scope))
    .map(clone)
    .sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  const semanticEdges = new Set();
  for (const edge of edges) {
    const evidence = knownRefs.get(edge.evidenceRefId);
    const source = artifacts.get(edge.sourceArtifactId);
    const semanticKey = `${edge.sourceArtifactId}:${edge.localClaimId}:${edge.relation}:${edge.evidenceRefId}`;
    if (!evidence || !source || !sameScope(source, scope) || !sameScope(evidence, scope)
      || evidence.sourceArtifactId !== edge.sourceArtifactId || semanticEdges.has(semanticKey)) {
      throw projectionError('The durable evidence graph contains an unresolved, foreign, or duplicate proof edge.', {
        edgeId: edge.edgeId,
      });
    }
    semanticEdges.add(semanticKey);
  }
  const graph = {
    kind: 'operating-evidence-graph', schemaVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION,
    scopeId: scope.scopeId, domainId: scope.domainId, domainVersion: scope.domainVersion,
    generatedAt,
    evidenceRefs,
    edges,
  };
  try {
    assertProtocolArtifact('operating-evidence-graph', graph, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    throw projectionError('The rebuilt evidence graph is not contract-valid.', { cause: cause.code ?? null });
  }
  return freeze(graph);
}
