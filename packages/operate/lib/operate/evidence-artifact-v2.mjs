import { assertProtocolArtifact } from '@openplanr/protocol/contracts';

export const LOCAL_OPERATE_ARTIFACT_EVIDENCE_PROVIDER_ID_V2 =
  'local-operate-artifact-evidence-provider';
export const LOCAL_OPERATE_ARTIFACT_EVIDENCE_RESOLVER_ID_V2 =
  'local-operate-artifact-evidence-resolver';
export const LOCAL_OPERATE_ARTIFACT_EVIDENCE_CAPABILITY_V2 = 'evidence.operate-artifact.read';

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function safeError(candidate, provider, resolver, code, context = {}) {
  return freeze({
    status: 'rejected',
    provider: provider ?? null,
    resolver: resolver ?? null,
    capture: null,
    error: {
      code,
      retryable: false,
      context: {
        evidenceKind: 'operate-artifact',
        ...(candidate?.locator?.artifactId ? { artifactId: candidate.locator.artifactId } : {}),
        ...(resolver?.resolverId ? { resolverId: resolver.resolverId } : {}),
        ...context,
      },
    },
  });
}

function hasCapability(capabilities, capability) {
  return Array.isArray(capabilities) && capabilities.includes(capability);
}

function acceptedArtifactRecords(context) {
  const artifacts = context?.operateArtifacts ?? context?.sources?.['operate-artifact'];
  return Array.isArray(artifacts) ? artifacts : [];
}

function acceptedRecord(records, artifactId) {
  return (
    records.find(
      (record) => record?.accepted === true && record?.artifact?.artifactId === artifactId,
    ) ?? null
  );
}

function validArtifact(artifact) {
  try {
    assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: '2.0.0' });
    return true;
  } catch {
    return false;
  }
}

function accessAllows(record, capabilities) {
  const required = record?.access?.requiredCapabilities;
  return (
    Array.isArray(required) &&
    required.length > 0 &&
    required.every(
      (capability) => typeof capability === 'string' && capabilities.includes(capability),
    )
  );
}

function sameBinding(candidate, artifact) {
  return (
    candidate.scopeId === artifact.scopeId &&
    candidate.domainId === artifact.domainId &&
    candidate.domainVersion === artifact.domainVersion
  );
}

function assertSelection(candidate, provider, resolver) {
  return (
    candidate?.evidenceKind === 'operate-artifact' &&
    provider?.providerId === LOCAL_OPERATE_ARTIFACT_EVIDENCE_PROVIDER_ID_V2 &&
    resolver?.resolverId === LOCAL_OPERATE_ARTIFACT_EVIDENCE_RESOLVER_ID_V2
  );
}

/**
 * Resolves only a host-supplied, previously accepted v2 Artifact record. This
 * function deliberately does not receive, copy, validate, or accept artifact
 * content: its output is an immutable metadata reference to that one Artifact.
 */
export function resolveLocalOperateArtifactEvidenceV2(
  candidate,
  { provider, resolver, capabilities = [], ...context } = {},
) {
  if (!assertSelection(candidate, provider, resolver)) {
    return safeError(candidate, provider, resolver, 'UNSUPPORTED_EVIDENCE_KIND');
  }
  if (!hasCapability(capabilities, LOCAL_OPERATE_ARTIFACT_EVIDENCE_CAPABILITY_V2)) {
    return safeError(candidate, provider, resolver, 'CAPABILITY_DENIED');
  }
  const locator = candidate.locator;
  if (
    !locator ||
    typeof locator !== 'object' ||
    typeof locator.artifactId !== 'string' ||
    typeof locator.expectedArtifactType !== 'string' ||
    typeof locator.expectedSchemaId !== 'string' ||
    typeof locator.expectedSchemaVersion !== 'string' ||
    (locator.expectedRawHash !== undefined &&
      (typeof locator.expectedRawHash !== 'string' || !DIGEST.test(locator.expectedRawHash))) ||
    (locator.expectedCanonicalHash !== undefined &&
      (typeof locator.expectedCanonicalHash !== 'string' ||
        !DIGEST.test(locator.expectedCanonicalHash)))
  ) {
    return safeError(candidate, provider, resolver, 'EVIDENCE_LOCATOR_INVALID');
  }

  const record = acceptedRecord(acceptedArtifactRecords(context), locator.artifactId);
  if (record === null) return safeError(candidate, provider, resolver, 'ARTIFACT_NOT_FOUND');
  const artifact = record.artifact;
  if (!validArtifact(artifact))
    return safeError(candidate, provider, resolver, 'ARTIFACT_NOT_FOUND');
  if (
    !record.sourceContract ||
    typeof record.sourceContract !== 'object' ||
    Array.isArray(record.sourceContract) ||
    typeof record.sourceContract.id !== 'string' ||
    typeof record.sourceContract.version !== 'string'
  ) {
    return safeError(candidate, provider, resolver, 'OBJECT_TYPE_MISMATCH');
  }
  if (!accessAllows(record, capabilities))
    return safeError(candidate, provider, resolver, 'CAPABILITY_DENIED');
  if (!sameBinding(candidate, artifact))
    return safeError(candidate, provider, resolver, 'EVIDENCE_SOURCE_SCOPE_MISMATCH');
  if (
    artifact.artifactType !== locator.expectedArtifactType ||
    artifact.schemaId !== locator.expectedSchemaId ||
    artifact.artifactSchemaVersion !== locator.expectedSchemaVersion
  ) {
    return safeError(candidate, provider, resolver, 'OBJECT_TYPE_MISMATCH');
  }
  if (
    (locator.expectedRawHash !== undefined && locator.expectedRawHash !== artifact.rawHash) ||
    (locator.expectedCanonicalHash !== undefined &&
      locator.expectedCanonicalHash !== artifact.canonicalHash)
  ) {
    return safeError(candidate, provider, resolver, 'ARTIFACT_HASH_MISMATCH');
  }

  return freeze({
    status: 'resolved',
    provider,
    resolver,
    error: null,
    capture: {
      artifactId: artifact.artifactId,
      artifactType: artifact.artifactType,
      schemaId: artifact.schemaId,
      artifactSchemaVersion: artifact.artifactSchemaVersion,
      rawHash: artifact.rawHash,
      canonicalHash: artifact.canonicalHash,
      sizeBytes: artifact.sizeBytes,
      storageClass: artifact.storageClass,
      sensitivity: artifact.sensitivity,
      retentionClass: artifact.retentionClass,
      classification: artifact.sensitivity,
      freshness: 'historical',
      sourceContract: record.sourceContract,
      locator: {
        artifactId: artifact.artifactId,
        expectedArtifactType: artifact.artifactType,
        expectedSchemaId: artifact.schemaId,
        expectedSchemaVersion: artifact.artifactSchemaVersion,
        expectedRawHash: artifact.rawHash,
        ...(artifact.canonicalHash === null
          ? {}
          : { expectedCanonicalHash: artifact.canonicalHash }),
      },
      provenance: {
        artifactId: artifact.artifactId,
        artifactType: artifact.artifactType,
        schemaId: artifact.schemaId,
        artifactSchemaVersion: artifact.artifactSchemaVersion,
        rawHash: artifact.rawHash,
        canonicalHash: artifact.canonicalHash ?? 'null',
        retentionClass: artifact.retentionClass,
        sensitivity: artifact.sensitivity,
      },
    },
  });
}

/** The registered provider and resolver share one immutable reference path. */
export const resolveLocalOperateArtifactEvidenceProviderV2 = resolveLocalOperateArtifactEvidenceV2;
