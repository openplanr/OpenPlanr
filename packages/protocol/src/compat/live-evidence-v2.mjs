import { assertProtocolArtifact } from '../contracts.mjs';
import { sha256Jcs } from '../canonical-json.mjs';

const HASH = /^sha256:[a-f0-9]{64}$/u;
const CHECKPOINT_TRANSITIONS = Object.freeze({
  prepared: Object.freeze({ request: 'requesting', absent: 'absent' }),
  requesting: Object.freeze({ materialize: 'materialized', absent: 'absent', uncertain: 'uncertain' }),
  materialized: Object.freeze({ commit: 'committed', uncertain: 'uncertain' }),
  committed: Object.freeze({}), absent: Object.freeze({}), uncertain: Object.freeze({}),
});
const SCHEDULE_TRANSITIONS = Object.freeze({
  disabled: Object.freeze({ enable: 'enabled', revoke: 'revoked', expire: 'expired' }),
  enabled: Object.freeze({ disable: 'disabled', pause: 'paused', revoke: 'revoked', expire: 'expired', complete: 'completed', 'run-issued': 'enabled' }),
  paused: Object.freeze({ disable: 'disabled', resume: 'enabled', revoke: 'revoked', expire: 'expired' }),
  revoked: Object.freeze({}), expired: Object.freeze({}), completed: Object.freeze({}),
});
const IMMUTABLE_CHECKPOINT_FIELDS = Object.freeze([
  'checkpointId', 'requestId', 'requestHash', 'effect', 'provider', 'providerRegistrationHash',
  'adapterVersion', 'sourceIdentityHash', 'credentialRefHash', 'boundsHash', 'queryHash',
  'windowHash', 'redactionVersion', 'createdAt',
]);
const CONNECTOR_EVENT_FIELDS = Object.freeze([
  'eventId', 'eventHash', 'type', 'expectedGeneration', 'expectedCheckpointHash', 'at', 'patch',
]);
const CONNECTOR_PATCH_FIELDS = Object.freeze({
  request: Object.freeze(['consentRecordId', 'consentRecordHash', 'consentExpiresAt', 'runtimeCapabilityHash', 'health']),
  materialize: Object.freeze(['artifactId', 'artifactHash', 'watermarkDigest', 'health']),
  commit: Object.freeze(['watermarkDigest']),
  absent: Object.freeze(['absenceDigest', 'health']),
  uncertain: Object.freeze(['absenceDigest', 'health']),
});
const SCHEDULE_TRANSITION_FIELDS = Object.freeze([
  'receiptId', 'type', 'expectedGeneration', 'expectedScheduleHash', 'expectedState',
  'expectedRunCount', 'expectedNextEventIdentity', 'expectedNextDueAt', 'planHash',
  'consentRecordHashes', 'ceilingsHash', 'clockHash', 'eventId', 'nextEventIdentity',
  'nextDueAt', 'at',
]);
const SOURCE_CONTRACTS = Object.freeze([
  'capacity-throughput', 'channel-economics', 'ci-test-evidence', 'competitor-positioning',
  'context-manifest', 'demand-market', 'finance-metrics', 'incident-history',
  'objective-metrics', 'operations-customer-health', 'planning-acceptance', 'prior-decisions',
  'product-activation', 'repository-architecture', 'retention-discovery', 'support-incidents',
]);

export const LIVE_EVIDENCE_ABSENCE_KINDS_V2 = Object.freeze([
  'insufficient-evidence', 'missing-consent', 'missing-credential', 'provider-unavailable',
  'rate-limited', 'stale', 'unhealthy', 'unsupported',
]);
export const LIVE_EVIDENCE_EFFECT_CLASS_V2 = 'provider-call';
export const LIVE_EVIDENCE_PORTABLE_AUTHORITY_V2 = 'none';
export const OPERATING_OUTCOME_EVALUATION_OPERATORS_V2 = Object.freeze(['gt', 'gte', 'lt', 'lte', 'eq', 'between']);

export class OperatingLiveEvidenceErrorV2 extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OperatingLiveEvidenceErrorV2';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new OperatingLiveEvidenceErrorV2(code, message, details);
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

function safePortable(value, path = '$') {
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    fail('LIVE_EVIDENCE_NON_PORTABLE', 'Live-evidence artifacts must be JSON-only.', { path });
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => safePortable(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => safePortable(entry, `${path}.${key}`));
    return;
  }
  if (typeof value !== 'string') return;
  if (value.includes('\u0000') || value.startsWith('/') || value.startsWith('~')
    || /(?:^|[\s"'`(])\/(?:Users|home|private|var|etc|tmp)\//u.test(value)
    || /(?:^|[\s"'`(])[A-Za-z]:[\\/][^\s]+/u.test(value)
    || value.split(/[\\/]/u).includes('..')
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value)
    || /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/u.test(value)
    || /\b(?:api[-_ ]?key|access[-_ ]?token|client[-_ ]?secret|password|passwd|secret|token)\s*[:=]\s*[^\s]+/iu.test(value)) {
    fail('LIVE_EVIDENCE_UNSAFE', 'Live-evidence artifacts contain private path or credential material.', { path });
  }
}

function protocol(kind, value, protocolVersion = '2.0.0') {
  try {
    assertProtocolArtifact(kind, value, { protocolVersion });
  } catch (cause) {
    fail('LIVE_EVIDENCE_CONTRACT_INVALID', `Invalid ${kind} contract.`, { cause: cause.code ?? cause.message });
  }
}

function selfHash(record, field) {
  const { [field]: claimed, ...body } = record;
  const expected = sha256Jcs(body);
  if (!HASH.test(claimed ?? '') || claimed !== expected) {
    fail('LIVE_EVIDENCE_DIGEST_MISMATCH', `${field} does not bind the exact canonical record.`, { field, expected, actual: claimed ?? null });
  }
  return expected;
}

function exactDigest(record, expected, label) {
  const actual = sha256Jcs(record);
  if (actual !== expected) fail('LIVE_EVIDENCE_BASE_RECORD_MISMATCH', `${label} bytes do not match their bound digest.`, { expected, actual });
}

function same(left, right, label) {
  if (sha256Jcs(left) !== sha256Jcs(right)) fail('LIVE_EVIDENCE_BINDING_MISMATCH', `${label} binding changed.`, { left, right });
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('LIVE_EVIDENCE_CONTRACT_INVALID', `${label} must be one closed object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!sameValue(actual, wanted)) {
    fail('LIVE_EVIDENCE_CONTRACT_INVALID', `${label} contains missing or unsupported fields.`, { actual, expected: wanted });
  }
}

function currentAt(timestamp, expiresAt, label) {
  if (!(Date.parse(timestamp) < Date.parse(expiresAt))) {
    fail('LIVE_EVIDENCE_STALE', `${label} is not current at the bound time.`, { timestamp, expiresAt });
  }
}

function exactBaseRecord(options, singularKey, pluralKey, reference, identityFields, label) {
  const supplied = [
    options?.[singularKey],
    ...(Array.isArray(options?.[pluralKey]) ? options[pluralKey] : []),
  ].filter((entry) => entry !== undefined);
  const matching = supplied.filter((entry) => identityFields.every((field) => entry?.[field] === reference[field]));
  const unique = [...new Map(matching.map((entry) => [sha256Jcs(entry), entry])).values()];
  if (unique.length !== 1) {
    fail('LIVE_EVIDENCE_BASE_RECORD_REQUIRED', `${label} requires exactly one matching frozen base record.`, {
      identity: Object.fromEntries(identityFields.map((field) => [field, reference[field]])),
      matches: unique.length,
    });
  }
  return unique[0];
}

function assertProviderBaseRecords(record, options = {}) {
  const baseEvidenceProvider = exactBaseRecord(options, 'baseEvidenceProvider', 'baseEvidenceProviders',
    record.baseEvidenceProvider, ['providerId', 'providerVersion'], 'Live provider registration');
  protocol('operate-evidence-provider-registration', baseEvidenceProvider);
  exactDigest(baseEvidenceProvider, record.baseEvidenceProvider.recordDigest, 'Evidence-provider registration');
  const baseResolver = exactBaseRecord(options, 'baseResolver', 'baseResolvers',
    record.baseResolver, ['resolverId', 'resolverVersion'], 'Live provider registration');
  protocol('operate-evidence-resolver-registration', baseResolver);
  exactDigest(baseResolver, record.baseResolver.recordDigest, 'Evidence-resolver registration');
  if (!baseResolver.supportedEvidenceKinds.includes('operate-artifact')) {
    fail('LIVE_EVIDENCE_BRIDGE_INVALID', 'The base resolver must use the canonical operate-artifact boundary.');
  }
}

function assertLiveEvidenceProviderRegistrationStructureV2(record) {
  protocol('operate-live-evidence-provider-registration', record);
  safePortable(record);
  selfHash(record, 'registrationHash');
  if (record.effects.length !== 1 || record.effects[0] !== 'provider-call'
    || record.consent.required !== true || record.consent.mode !== 'named-owner-current'
    || record.consent.runtimeCapability !== 'opaque-local-preissued'
    || record.consent.noDefaultChoice !== true || record.consent.previewEffect !== 'none') {
    fail('LIVE_EVIDENCE_AUTHORITY_INVALID', 'Registration must require current consent and a pre-issued opaque capability for provider-call.');
  }
  return freeze(clone(record));
}

export function assertLiveEvidenceProviderRegistrationV2(record, options = {}) {
  const normalized = assertLiveEvidenceProviderRegistrationStructureV2(record);
  assertProviderBaseRecords(normalized, options);
  return normalized;
}

export function assertLiveEvidenceProviderRegistryV2(registry, options = {}) {
  protocol('operate-live-evidence-provider-registry', registry);
  safePortable(registry);
  selfHash(registry, 'registryHash');
  let previous = null;
  const identities = new Set();
  for (const provider of registry.providers) {
    assertLiveEvidenceProviderRegistrationV2(provider, options);
    const identity = `${provider.providerId}@${provider.providerVersion}`;
    if (identities.has(identity) || (previous !== null && identity.localeCompare(previous) <= 0)) {
      fail('LIVE_EVIDENCE_REGISTRY_CONFLICT', 'Provider registry membership must be unique and canonically ordered.', { identity });
    }
    identities.add(identity);
    previous = identity;
  }
  return freeze(clone(registry));
}

export function registerLiveEvidenceProviderV2(registry, registration, options = {}) {
  const current = assertLiveEvidenceProviderRegistryV2(registry, options);
  const provider = assertLiveEvidenceProviderRegistrationV2(registration, options);
  const index = current.providers.findIndex((entry) => entry.providerId === provider.providerId && entry.providerVersion === provider.providerVersion);
  if (index >= 0) {
    if (current.providers[index].registrationHash !== provider.registrationHash) {
      fail('LIVE_EVIDENCE_REGISTRY_CONFLICT', 'Divergent provider bytes cannot reuse one provider identity.');
    }
    return current;
  }
  const next = clone(current);
  next.providers.push(clone(provider));
  next.providers.sort((left, right) => `${left.providerId}@${left.providerVersion}`.localeCompare(`${right.providerId}@${right.providerVersion}`));
  next.registryHash = sha256Jcs(Object.fromEntries(Object.entries(next).filter(([key]) => key !== 'registryHash')));
  return assertLiveEvidenceProviderRegistryV2(next, options);
}

export function assertOperatingLiveEvidenceConsentRecordV2(record) {
  protocol('operating-live-evidence-consent-record', record);
  safePortable(record);
  selfHash(record, 'consentHash');
  if (record.authority !== 'none' || record.docket.defaultChoice !== null || record.docket.cancelEffect !== 'none') {
    fail('LIVE_EVIDENCE_AUTHORITY_INVALID', 'Consent proof and docket cannot grant access authority or preselect an owner choice.');
  }
  if (sha256Jcs(record.docket) !== record.docketHash) fail('LIVE_EVIDENCE_DIGEST_MISMATCH', 'Consent docket bytes changed.');
  same(record.docket.provider, record.provider, 'Consent provider');
  for (const field of ['adapterVersion', 'accountIdentityHash', 'selectors', 'scopes', 'queryHash', 'window', 'ceilings', 'classification', 'purpose', 'expiresAt']) {
    same(record.docket[field], record[field], `Consent ${field}`);
  }
  currentAt(record.issuedAt, record.expiresAt, 'Consent');
  return freeze(clone(record));
}

export function assertOperatingLiveEvidenceIngestionV2(record, {
  liveProviderRegistration, baseEvidenceProvider, baseResolver, assignment,
  consentRecord, connectorCheckpoint,
} = {}) {
  protocol('operating-live-evidence-ingestion', record);
  safePortable(record);
  selfHash(record, 'ingestionHash');
  if (!SOURCE_CONTRACTS.includes(record.sourceContract.id)) fail('LIVE_EVIDENCE_SOURCE_CONTRACT_INVALID', 'Ingestion source contract is not accepted by the frozen operate-artifact resolver.');
  if (record.status === 'materialized') {
    if (record.health.status !== 'available' || record.absences.length !== 0 || record.records.length === 0) {
      fail('LIVE_EVIDENCE_FALSE_PASS', 'Materialized evidence requires available health, records, and no absence.');
    }
    if (record.materialization.contentDigest !== deriveOperatingLiveEvidenceContentDigestV2(record)) {
      fail('LIVE_EVIDENCE_DIGEST_MISMATCH', 'Materialization contentDigest does not bind the exact redacted record manifest.');
    }
    currentAt(record.sourceTiming.capturedAt, record.health.freshUntil, 'Provider health');
    currentAt(record.sourceTiming.capturedAt, record.sourceTiming.freshUntil, 'Source evidence');
  }
  if (record.assignment.requestHash !== record.requestHash || record.submission.operation !== 'operate.assignment.submit') {
    fail('LIVE_EVIDENCE_BRIDGE_INVALID', 'Ingestion must bind its issued Assignment request and normal submission operation.');
  }
  if (record.assignment.assignmentRevision !== 1) {
    fail('LIVE_EVIDENCE_BRIDGE_INVALID', 'The immutable Protocol 2.0 Assignment revision must be one.');
  }
  if (record.materialization !== null) {
    for (const field of ['artifactId', 'artifactCreatedEventId', 'evidenceRefId']) same(record.materialization[field], record.submission[field], `Materialization ${field}`);
  }
  for (const candidate of record.evidenceCandidates) {
    if (candidate.evidenceKind !== 'operate-artifact' || candidate.sourceArtifactId !== record.submission.artifactId
      || candidate.locator?.artifactId !== record.submission.artifactId
      || candidate.locator?.expectedArtifactType !== 'live-evidence-ingestion'
      || candidate.locator?.expectedSchemaId !== 'operating-live-evidence-ingestion'
      || candidate.locator?.expectedSchemaVersion !== '2.0.0'
      || candidate.provider.id !== record.providerRegistration.providerId
      || candidate.provider.version !== record.providerRegistration.providerVersion
      || candidate.resolver.id !== record.resolverRegistration.resolverId
      || candidate.resolver.version !== record.resolverRegistration.resolverVersion) {
      fail('LIVE_EVIDENCE_BRIDGE_INVALID', 'Evidence candidates must reference the pre-issued accepted ingestion Artifact.');
    }
  }
  for (const link of record.evidenceClaimLinks) {
    if (link.sourceArtifactId !== record.submission.artifactId
      || !record.evidenceCandidates.some((candidate) => candidate.candidateId === link.candidateId)) {
      fail('LIVE_EVIDENCE_BRIDGE_INVALID', 'Evidence claim links must bind a declared candidate and accepted source Artifact.');
    }
  }
  if (liveProviderRegistration !== undefined) {
    const registration = assertLiveEvidenceProviderRegistrationV2(liveProviderRegistration, { baseEvidenceProvider, baseResolver });
    if (registration.registrationHash !== record.providerRegistrationHash) fail('LIVE_EVIDENCE_BASE_RECORD_MISMATCH', 'Live provider registration changed.');
    same([registration.providerId, registration.providerVersion, registration.adapterVersion], [record.provider.id, record.provider.version, record.adapterVersion], 'Live provider');
    same(registration.baseEvidenceProvider, record.providerRegistration, 'Base evidence-provider reference');
    same(registration.baseResolver, record.resolverRegistration, 'Base evidence-resolver reference');
  }
  if (record.resolverRegistrationHash !== record.resolverRegistration.recordDigest) fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Resolver registration digest fields disagree.');
  if (baseEvidenceProvider !== undefined) {
    protocol('operate-evidence-provider-registration', baseEvidenceProvider);
    exactDigest(baseEvidenceProvider, record.providerRegistration.recordDigest, 'Base evidence-provider registration');
  }
  if (baseResolver !== undefined) {
    protocol('operate-evidence-resolver-registration', baseResolver);
    exactDigest(baseResolver, record.resolverRegistration.recordDigest, 'Base evidence-resolver registration');
    if (!baseResolver.supportedSourceContracts.some((entry) => sameValue(entry, record.sourceContract))) {
      fail('LIVE_EVIDENCE_SOURCE_CONTRACT_INVALID', 'The selected resolver does not support the ingestion source contract.');
    }
  }
  if (assignment !== undefined) {
    protocol('operating-assignment', assignment);
    exactDigest(assignment, record.assignment.assignmentHash, 'Issued Assignment');
    if (assignment.assignmentId !== record.assignment.assignmentId || assignment.assignmentKind !== 'verification'
      || assignment.outputContract.schemaId !== 'operating-live-evidence-ingestion'
      || assignment.outputContract.schemaVersion !== '2.0.0') {
      fail('LIVE_EVIDENCE_BRIDGE_INVALID', 'The canonical Assignment does not authorize this ingestion output.');
    }
  }
  if (record.status === 'materialized' && (assignment === undefined || consentRecord === undefined
    || connectorCheckpoint === undefined || liveProviderRegistration === undefined
    || baseEvidenceProvider === undefined || baseResolver === undefined)) {
    fail('LIVE_EVIDENCE_BASE_RECORD_REQUIRED', 'Materialized ingestion requires exact Assignment, consent, checkpoint, and provider registrations.');
  }
  if (consentRecord !== undefined) {
    const consent = assertOperatingLiveEvidenceConsentRecordV2(consentRecord);
    if (consent.consentHash !== record.consentRecordHash) fail('LIVE_EVIDENCE_BASE_RECORD_MISMATCH', 'Consent record changed.');
    same([consent.provider, consent.adapterVersion, consent.classification], [record.provider, record.adapterVersion, record.classification], 'Consent provider');
    if (sha256Jcs(consent.ceilings) !== record.boundsHash) fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Consent ceilings changed.');
    currentAt(record.sourceTiming.capturedAt, consent.expiresAt, 'Consent');
  }
  if (connectorCheckpoint !== undefined) {
    const checkpoint = assertOperatingConnectorCheckpointV2(connectorCheckpoint);
    if (checkpoint.state !== 'requesting' || checkpoint.checkpointId !== record.checkpoint.checkpointId
      || checkpoint.checkpointHash !== record.checkpoint.checkpointHash
      || checkpoint.predecessorDigest !== record.checkpoint.predecessorDigest
      || checkpoint.requestId !== record.requestId || checkpoint.providerRegistrationHash !== record.providerRegistrationHash
      || checkpoint.consentRecordHash !== record.consentRecordHash
      || checkpoint.runtimeCapabilityHash !== record.runtimeCapabilityHash
      || checkpoint.boundsHash !== record.boundsHash || !sameValue(checkpoint.provider, record.provider)
      || checkpoint.adapterVersion !== record.adapterVersion || !sameValue(checkpoint.health, record.health)) {
      fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Ingestion changed its exact requesting connector checkpoint.');
    }
    if (consentRecord !== undefined && (checkpoint.queryHash !== consentRecord.queryHash
      || checkpoint.windowHash !== sha256Jcs(consentRecord.window)
      || checkpoint.boundsHash !== sha256Jcs(consentRecord.ceilings))) {
      fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Checkpoint query, window, or bounds changed from owner consent.');
    }
  }
  if (assignment !== undefined && consentRecord !== undefined && connectorCheckpoint !== undefined) {
    const expectedRequestHash = deriveOperatingLiveEvidenceRequestHashV2({
      assignment, consentRecord, connectorCheckpoint, liveProviderRegistration, sourceContract: record.sourceContract,
      baseEvidenceProvider, baseResolver, classification: record.classification,
    });
    if (record.requestHash !== expectedRequestHash || connectorCheckpoint.requestHash !== expectedRequestHash) {
      fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Ingestion request is not the engine-derived Assignment/provider request.');
    }
  }
  return freeze(clone(record));
}

function sameValue(left, right) {
  return sha256Jcs(left) === sha256Jcs(right);
}

export function deriveOperatingLiveEvidenceRequestHashV2({
  assignment, consentRecord, connectorCheckpoint, liveProviderRegistration, baseEvidenceProvider, baseResolver,
  sourceContract, classification,
}) {
  protocol('operating-assignment', assignment);
  const consent = assertOperatingLiveEvidenceConsentRecordV2(consentRecord);
  const checkpoint = assertOperatingConnectorCheckpointV2(connectorCheckpoint);
  const registration = assertLiveEvidenceProviderRegistrationV2(liveProviderRegistration, {
    baseEvidenceProvider, baseResolver,
  });
  return sha256Jcs({
    domain: 'openplanr-operating-live-evidence-request-v2',
    assignment: { assignmentId: assignment.assignmentId, assignmentHash: sha256Jcs(assignment) },
    requestId: checkpoint.requestId,
    provider: checkpoint.provider,
    providerRegistrationHash: registration.registrationHash,
    adapterVersion: checkpoint.adapterVersion,
    consentRecordHash: consent.consentHash,
    runtimeCapabilityHash: checkpoint.runtimeCapabilityHash,
    sourceIdentityHash: checkpoint.sourceIdentityHash,
    credentialRefHash: checkpoint.credentialRefHash,
    boundsHash: checkpoint.boundsHash,
    queryHash: checkpoint.queryHash,
    windowHash: checkpoint.windowHash,
    sourceContract,
    classification,
  });
}

export function deriveOperatingLiveEvidenceContentDigestV2(record) {
  if (record?.materialization === null || record?.materialization === undefined || !Array.isArray(record?.records)) {
    fail('LIVE_EVIDENCE_CONTRACT_INVALID', 'Materialized live evidence requires a redacted record manifest.');
  }
  const records = clone(record.records).sort((left, right) => left.recordIdentityHash.localeCompare(right.recordIdentityHash));
  return sha256Jcs({
    domain: 'openplanr-operating-live-evidence-redacted-content-v2',
    redactionVersion: record.materialization.redactionVersion,
    records,
  });
}

export function assertAcceptedLiveEvidenceSourceV2(record, {
  assignment, artifact, submittedEvent, artifactCreatedEvent, validatedEvent,
  ...options
}) {
  const ingestion = assertOperatingLiveEvidenceIngestionV2(record, { assignment, ...options });
  protocol('operating-artifact', artifact);
  protocol('operating-event', submittedEvent);
  protocol('operating-event', artifactCreatedEvent);
  protocol('operating-event', validatedEvent);
  if (artifact.artifactId !== ingestion.submission.artifactId || artifact.assignmentId !== ingestion.assignment.assignmentId
    || artifact.artifactType !== 'live-evidence-ingestion'
    || artifact.schemaId !== 'operating-live-evidence-ingestion' || artifact.artifactSchemaVersion !== '2.0.0'
    || artifact.canonicalHash !== sha256Jcs(ingestion)) {
    fail('LIVE_EVIDENCE_BRIDGE_INVALID', 'Accepted Artifact does not bind the exact ingestion bytes and Assignment.');
  }
  const eventBindings = [[submittedEvent, 'assignment.submitted', ingestion.submission.submittedEventId], [artifactCreatedEvent, 'artifact.created', ingestion.submission.artifactCreatedEventId], [validatedEvent, 'assignment.validated', ingestion.submission.validatedEventId]];
  for (const [event, type, eventId] of eventBindings) {
    selfHash(event, 'eventHash');
    if (event.eventId !== eventId || event.type !== type || event.cycleId !== artifact.cycleId
      || event.timestamp !== artifact.createdAt || event.actor.kind !== 'runtime' || event.actor.id !== 'openplanr') {
      fail('LIVE_EVIDENCE_BRIDGE_INVALID', 'Accepted Event lineage does not match the pre-issued ingestion identities.', { type });
    }
  }
  if (submittedEvent.entityId !== assignment.assignmentId || artifactCreatedEvent.entityId !== artifact.artifactId
    || validatedEvent.entityId !== assignment.assignmentId
    || artifactCreatedEvent.causationId !== submittedEvent.eventId || validatedEvent.causationId !== artifactCreatedEvent.eventId
    || submittedEvent.correlationId !== artifactCreatedEvent.correlationId || submittedEvent.correlationId !== validatedEvent.correlationId
    || artifactCreatedEvent.previousEventHash !== submittedEvent.eventHash || validatedEvent.previousEventHash !== artifactCreatedEvent.eventHash
    || artifactCreatedEvent.sequence !== submittedEvent.sequence + 1 || validatedEvent.sequence !== artifactCreatedEvent.sequence + 1
    || !sameValue(submittedEvent.payload, {
      assignmentId: assignment.assignmentId, submissionId: ingestion.submission.submissionId,
      rawHash: artifact.rawHash, canonicalHash: artifact.canonicalHash, sizeBytes: artifact.sizeBytes,
      mediaType: artifact.mediaType, encoding: artifact.encoding,
    }) || !sameValue(artifactCreatedEvent.payload, artifact)
    || validatedEvent.payload.assignmentId !== assignment.assignmentId
    || validatedEvent.payload.submissionId !== ingestion.submission.submissionId
    || validatedEvent.payload.artifactId !== artifact.artifactId
    || typeof validatedEvent.payload.validatorVersion !== 'string') {
    fail('LIVE_EVIDENCE_BRIDGE_INVALID', 'Runtime-created Assignment/Event payload or chain changed.');
  }
  return ingestion;
}

export function assertAcceptedLiveEvidenceBridgeV2(record, {
  assignment, artifact, submittedEvent, artifactCreatedEvent, validatedEvent, evidenceRef,
  evidenceArtifact, evidenceResolution, resultCheckpoint, checkpointHistory = [],
  ...options
}) {
  const ingestion = assertAcceptedLiveEvidenceSourceV2(record, {
    assignment, artifact, submittedEvent, artifactCreatedEvent, validatedEvent, ...options,
  });
  protocol('operating-evidence-ref', evidenceRef);
  protocol('operating-artifact', evidenceArtifact);
  protocol('operating-evidence-resolution', evidenceResolution);
  const candidate = ingestion.evidenceCandidates.find((entry) => entry.candidateId === evidenceRef.candidateId);
  const expectedLocator = candidate === undefined ? null : {
    artifactId: candidate.locator.artifactId,
    expectedArtifactType: candidate.locator.expectedArtifactType,
    expectedSchemaId: candidate.locator.expectedSchemaId,
    expectedSchemaVersion: candidate.locator.expectedSchemaVersion,
    expectedRawHash: artifact.rawHash,
    expectedCanonicalHash: artifact.canonicalHash,
  };
  if (evidenceRef.evidenceRefId !== ingestion.submission.evidenceRefId || evidenceRef.sourceArtifactId !== artifact.artifactId
    || candidate === undefined || evidenceRef.evidenceKind !== 'operate-artifact'
    || !sameValue(evidenceRef.sourceContract, ingestion.sourceContract)
    || (candidate.locator.expectedRawHash !== undefined && candidate.locator.expectedRawHash !== artifact.rawHash)
    || (candidate.locator.expectedCanonicalHash !== undefined && candidate.locator.expectedCanonicalHash !== artifact.canonicalHash)
    || !sameValue(evidenceRef.locator, expectedLocator)
    || !sameValue(evidenceRef.provider, candidate.provider) || !sameValue(evidenceRef.resolver, candidate.resolver)
    || evidenceRef.classification !== ingestion.classification
    || evidenceRef.evidenceArtifactId !== evidenceArtifact.artifactId
    || evidenceRef.evidenceArtifactRawHash !== evidenceArtifact.rawHash
    || evidenceRef.evidenceArtifactCanonicalHash !== evidenceArtifact.canonicalHash
    || evidenceArtifact.artifactId === artifact.artifactId
    || evidenceArtifact.artifactType !== 'evidence-snapshot'
    || evidenceArtifact.assignmentId !== artifact.assignmentId || evidenceArtifact.cycleId !== artifact.cycleId
    || evidenceArtifact.scopeId !== artifact.scopeId || evidenceArtifact.domainId !== artifact.domainId
    || evidenceArtifact.domainVersion !== artifact.domainVersion
    || evidenceArtifact.schemaId !== 'operating-evidence-snapshot' || evidenceArtifact.artifactSchemaVersion !== '1.0.0'
    || evidenceArtifact.mediaType !== 'application/octet-stream' || evidenceArtifact.encoding !== 'binary'
    || evidenceArtifact.rawHash !== artifact.rawHash || evidenceArtifact.canonicalHash !== artifact.canonicalHash
    || evidenceArtifact.sizeBytes !== artifact.sizeBytes || evidenceArtifact.sensitivity !== artifact.sensitivity
    || evidenceArtifact.retentionClass !== artifact.retentionClass
    || !sameValue(evidenceArtifact.inputArtifactIds, [artifact.artifactId])
    || evidenceArtifact.createdAt !== evidenceRef.resolvedAt
    || !sameValue(evidenceArtifact.producer, { actorId: 'openplanr', roleId: 'evidence-resolver', runtime: 'openplanr' })) {
    fail('LIVE_EVIDENCE_BRIDGE_INVALID', 'Accepted EvidenceRef does not bind the ingestion Artifact.');
  }
  if (evidenceResolution.outcome !== 'resolved' || evidenceResolution.error !== null
    || evidenceResolution.candidateId !== candidate.candidateId
    || evidenceResolution.sourceArtifactId !== artifact.artifactId
    || evidenceResolution.evidenceKind !== 'operate-artifact'
    || !sameValue(evidenceResolution.sourceContract, ingestion.sourceContract)
    || !sameValue(evidenceResolution.provider, candidate.provider)
    || !sameValue(evidenceResolution.resolver, candidate.resolver)
    || evidenceResolution.evidenceRefId !== evidenceRef.evidenceRefId
    || evidenceResolution.evidenceArtifactId !== evidenceArtifact.artifactId
    || evidenceResolution.resolvedAt !== evidenceRef.resolvedAt
    || evidenceArtifact.createdAt !== evidenceResolution.resolvedAt
    || evidenceResolution.scopeId !== artifact.scopeId || evidenceResolution.domainId !== artifact.domainId
    || evidenceResolution.domainVersion !== artifact.domainVersion) {
    fail('LIVE_EVIDENCE_BRIDGE_INVALID', 'Evidence resolution changed the runtime-built snapshot or EvidenceRef custody.');
  }
  if (resultCheckpoint === undefined) fail('LIVE_EVIDENCE_BASE_RECORD_REQUIRED', 'Accepted ingestion requires the exact post-acceptance connector checkpoint.');
  const requestCheckpoint = assertOperatingConnectorCheckpointV2(options.connectorCheckpoint);
  const chain = [requestCheckpoint, ...checkpointHistory.map(assertOperatingConnectorCheckpointV2), assertOperatingConnectorCheckpointV2(resultCheckpoint)];
  for (let index = 1; index < chain.length; index += 1) {
    if (chain[index].predecessorDigest !== chain[index - 1].checkpointHash
      || chain[index].generation !== chain[index - 1].generation + 1) fail('LIVE_EVIDENCE_BRIDGE_INVALID', 'Connector checkpoint lineage is not contiguous.');
  }
  const terminalCheckpoint = chain.at(-1);
  if (!['materialized', 'committed'].includes(terminalCheckpoint.state)
    || terminalCheckpoint.artifactId !== artifact.artifactId || terminalCheckpoint.artifactHash !== artifact.canonicalHash
    || terminalCheckpoint.requestHash !== ingestion.requestHash
    || terminalCheckpoint.consentRecordHash !== ingestion.consentRecordHash
    || terminalCheckpoint.runtimeCapabilityHash !== ingestion.runtimeCapabilityHash
    || !sameValue(terminalCheckpoint.health, ingestion.health)) {
    fail('LIVE_EVIDENCE_BRIDGE_INVALID', 'Post-acceptance checkpoint changed Artifact or request custody.');
  }
  return ingestion;
}

export function assertOperatingConnectorCheckpointV2(checkpoint) {
  protocol('operating-connector-checkpoint', checkpoint);
  safePortable(checkpoint);
  selfHash(checkpoint, 'checkpointHash');
  if (checkpoint.generation === 0 && (checkpoint.state !== 'prepared' || checkpoint.predecessorDigest !== null || checkpoint.lastEventId !== null || checkpoint.lastEventHash !== null)) {
    fail('LIVE_EVIDENCE_CHECKPOINT_INVALID', 'Generation-zero connector checkpoint must be an unadvanced prepared record.');
  }
  if (checkpoint.state === 'prepared' && (checkpoint.consentRecordId !== null || checkpoint.consentRecordHash !== null
    || checkpoint.consentExpiresAt !== null || checkpoint.runtimeCapabilityHash !== null
    || checkpoint.artifactId !== null || checkpoint.artifactHash !== null || checkpoint.absenceDigest !== null)) {
    fail('LIVE_EVIDENCE_CHECKPOINT_INVALID', 'Prepared checkpoint cannot claim consent, capability, Artifact, or absence custody.');
  }
  if (['requesting', 'materialized', 'committed'].includes(checkpoint.state)) {
    if (checkpoint.consentRecordId === null || checkpoint.consentRecordHash === null
      || checkpoint.consentExpiresAt === null || checkpoint.runtimeCapabilityHash === null) {
      fail('LIVE_EVIDENCE_CHECKPOINT_INVALID', 'Requested checkpoint requires exact consent and runtime capability custody.');
    }
    currentAt(checkpoint.updatedAt, checkpoint.consentExpiresAt, 'Connector consent');
  }
  if (['materialized', 'committed'].includes(checkpoint.state)) {
    if (checkpoint.health.status !== 'available' || checkpoint.artifactId === null || checkpoint.artifactHash === null
      || checkpoint.absenceDigest !== null) fail('LIVE_EVIDENCE_FALSE_PASS', 'Materialized connector checkpoint requires available health and exact Artifact custody.');
    currentAt(checkpoint.updatedAt, checkpoint.health.freshUntil, 'Provider health');
  }
  if (['absent', 'uncertain'].includes(checkpoint.state)
    && (checkpoint.absenceDigest === null || checkpoint.artifactId !== null || checkpoint.artifactHash !== null)) {
    fail('LIVE_EVIDENCE_CHECKPOINT_INVALID', 'Absent or uncertain checkpoint requires one typed absence and no Artifact custody.');
  }
  return freeze(clone(checkpoint));
}

export function reduceOperatingConnectorCheckpointV2(currentValue, eventValue) {
  const current = assertOperatingConnectorCheckpointV2(currentValue);
  const event = clone(eventValue);
  assertExactKeys(event, CONNECTOR_EVENT_FIELDS, 'Connector transition Event');
  if (!CONNECTOR_PATCH_FIELDS[event.type]) fail('LIVE_EVIDENCE_TRANSITION_INVALID', 'Unknown connector transition type.', { type: event.type });
  assertExactKeys(event.patch, CONNECTOR_PATCH_FIELDS[event.type], `${event.type} connector patch`);
  const claimed = event.eventHash;
  delete event.eventHash;
  const eventHash = sha256Jcs(event);
  if (claimed !== eventHash) fail('LIVE_EVIDENCE_DIGEST_MISMATCH', 'Connector event hash does not bind the exact event.');
  if (current.lastEventId === event.eventId) {
    if (current.lastEventHash !== eventHash) fail('LIVE_EVIDENCE_REPLAY_CONFLICT', 'Divergent connector event reused one identity.');
    return current;
  }
  if (event.expectedGeneration !== current.generation || event.expectedCheckpointHash !== current.checkpointHash) {
    fail('LIVE_EVIDENCE_CONCURRENT_MODIFICATION', 'Connector checkpoint generation or digest changed.');
  }
  const target = CHECKPOINT_TRANSITIONS[current.state]?.[event.type];
  if (target === undefined) fail('LIVE_EVIDENCE_TRANSITION_INVALID', 'Illegal connector checkpoint transition.', { from: current.state, type: event.type });
  const patch = event.patch ?? {};
  for (const field of IMMUTABLE_CHECKPOINT_FIELDS) {
    if (Object.hasOwn(patch, field) && !sameValue(patch[field], current[field])) fail('LIVE_EVIDENCE_BINDING_MISMATCH', `Connector ${field} cannot change.`);
  }
  if (current.state !== 'prepared') {
    for (const field of ['consentRecordId', 'consentRecordHash', 'consentExpiresAt', 'runtimeCapabilityHash']) {
      if (Object.hasOwn(patch, field) && !sameValue(patch[field], current[field])) {
        fail('LIVE_EVIDENCE_BINDING_MISMATCH', `Connector ${field} is frozen after request issuance.`);
      }
    }
  }
  if (event.type === 'request' && (patch.consentRecordId === null || patch.consentRecordHash === null
    || patch.consentExpiresAt === null || patch.runtimeCapabilityHash === null)) {
    fail('LIVE_EVIDENCE_AUTHORITY_INVALID', 'Requesting a provider call requires current consent and one opaque runtime capability.');
  }
  if (event.type === 'materialize' && (patch.artifactId === null || patch.artifactHash === null
    || patch.health?.status !== 'available')) {
    fail('LIVE_EVIDENCE_FALSE_PASS', 'Materialize transition requires exact Artifact and current available-health proof.');
  }
  if (['absent', 'uncertain'].includes(event.type) && patch.absenceDigest === null) {
    fail('LIVE_EVIDENCE_CHECKPOINT_INVALID', 'Absent or uncertain transition requires a typed absence digest.');
  }
  const next = { ...clone(current), ...patch, state: target, generation: current.generation + 1, lastEventId: event.eventId, lastEventHash: eventHash, predecessorDigest: current.checkpointHash, updatedAt: event.at };
  delete next.checkpointHash;
  next.checkpointHash = sha256Jcs(next);
  return assertOperatingConnectorCheckpointV2(next);
}

export function assertOperatingMeasurementPlanV2(plan, { verificationPlan } = {}) {
  protocol('operating-measurement-plan', plan);
  safePortable(plan);
  selfHash(plan, 'planHash');
  const terminal = [...plan.terminalResults].sort();
  if (!sameValue(terminal, ['failed', 'insufficient-evidence', 'passed'])) fail('LIVE_EVIDENCE_PLAN_INVALID', 'Measurement plan must declare every terminal result.');
  if (plan.target.unit !== plan.metric.unit || plan.baseline.unit !== plan.metric.unit) fail('LIVE_EVIDENCE_UNIT_MISMATCH', 'Baseline and target units must match the metric.');
  if (![plan.baseline.value, ...(Array.isArray(plan.target.value) ? plan.target.value : [plan.target.value])].every(Number.isFinite)
    || Date.parse(plan.window.from) > Date.parse(plan.window.to) || Date.parse(plan.dueAt) < Date.parse(plan.window.to)) {
    fail('LIVE_EVIDENCE_PLAN_INVALID', 'Measurement values must be finite and the inclusive window/due chronology must be ordered.');
  }
  const algebra = {
    increase: ['gt', 'gte'], decrease: ['lt', 'lte'], maintain: ['eq'], range: ['between'],
  };
  if (!algebra[plan.target.direction]?.includes(plan.target.operator)) {
    fail('LIVE_EVIDENCE_PLAN_INVALID', 'Measurement direction and operator are incompatible.');
  }
  if (plan.target.operator === 'between') {
    if (!Array.isArray(plan.target.value) || plan.target.value.length !== 2 || plan.target.value[0] > plan.target.value[1]) {
      fail('LIVE_EVIDENCE_PLAN_INVALID', 'Between target must be one ordered finite range.');
    }
  } else if (Array.isArray(plan.target.value)) {
    fail('LIVE_EVIDENCE_PLAN_INVALID', 'Scalar measurement operators cannot use a range target.');
  }
  if ((plan.target.direction === 'increase' && plan.target.value <= plan.baseline.value)
    || (plan.target.direction === 'decrease' && plan.target.value >= plan.baseline.value)
    || (plan.target.direction === 'maintain' && plan.target.value !== plan.baseline.value)) {
    fail('LIVE_EVIDENCE_PLAN_INVALID', 'Measurement target does not match the declared baseline direction.');
  }
  if (verificationPlan !== undefined) {
    protocol('operating-action-verification-plan', verificationPlan);
    exactDigest(verificationPlan, plan.verificationPlan.recordDigest, 'Action verification plan');
    same([verificationPlan.verificationPlanId, verificationPlan.actionId, verificationPlan.metricId, verificationPlan.baseline, verificationPlan.target], [plan.verificationPlan.verificationPlanId, plan.action.actionId, plan.metric.metricId, plan.baseline.value, plan.verificationPlan.canonicalTarget], 'Measurement-plan specialization');
    same(sha256Jcs(verificationPlan.window), plan.verificationPlan.windowDigest, 'Verification window digest');
    same(sha256Jcs(verificationPlan.method), plan.verificationPlan.methodDigest, 'Verification method digest');
    same(sha256Jcs(verificationPlan.evaluationRules), plan.verificationPlan.evaluationRulesDigest, 'Verification rule digest');
    const targetValues = Array.isArray(plan.target.value) ? plan.target.value : [plan.target.value];
    if (!targetValues.includes(verificationPlan.target)) fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Measurement target is not derivable from the canonical verification target.');
  }
  return freeze(clone(plan));
}

export function assertOperatingMeasurementScheduleV2(schedule) {
  protocol('operating-measurement-schedule', schedule);
  safePortable(schedule);
  selfHash(schedule, 'scheduleHash');
  if (schedule.generation === 0 && (schedule.state !== 'disabled' || schedule.runCount !== 0
    || schedule.nextEventIdentity !== null || schedule.nextDueAt !== null
    || schedule.lastReceiptId !== null || schedule.lastTransitionHash !== null)) {
    fail('LIVE_EVIDENCE_SCHEDULE_INVALID', 'New schedules must be disabled and unadvanced.');
  }
  if (schedule.recurrence.kind === 'once' && schedule.recurrence.intervalSeconds !== null) fail('LIVE_EVIDENCE_SCHEDULE_INVALID', 'One-time schedules cannot carry an interval.');
  if (schedule.recurrence.kind === 'interval' && schedule.recurrence.intervalSeconds === null) fail('LIVE_EVIDENCE_SCHEDULE_INVALID', 'Interval schedules require a bounded interval.');
  if (Date.parse(schedule.startsAt) > Date.parse(schedule.endsAt ?? schedule.startsAt)
    || schedule.runCount > schedule.maxRuns) fail('LIVE_EVIDENCE_SCHEDULE_INVALID', 'Schedule time bounds or run count are invalid.');
  if (schedule.state === 'enabled' && (schedule.consentRecordHashes.length === 0
    || schedule.nextEventIdentity === null || schedule.nextDueAt === null
    || schedule.runCount >= schedule.maxRuns || Date.parse(schedule.nextDueAt) < Date.parse(schedule.startsAt)
    || (schedule.endsAt !== null && Date.parse(schedule.nextDueAt) > Date.parse(schedule.endsAt)))) {
    fail('LIVE_EVIDENCE_SCHEDULE_INVALID', 'Enabled schedule requires current consent, one due identity, and remaining bounded runs.');
  }
  if (['disabled', 'revoked', 'expired', 'completed'].includes(schedule.state)
    && (schedule.nextEventIdentity !== null || schedule.nextDueAt !== null)) {
    fail('LIVE_EVIDENCE_SCHEDULE_INVALID', 'Inactive schedule cannot retain an executable due identity.');
  }
  return freeze(clone(schedule));
}

function assertOperatingMeasurementScheduleReceiptStructureV2(receipt) {
  protocol('operating-measurement-schedule-receipt', receipt);
  safePortable(receipt);
  selfHash(receipt, 'receiptHash');
  if (receipt.authority !== 'none' || receipt.scheduleHash !== receipt.resultingScheduleHash) fail('LIVE_EVIDENCE_SCHEDULE_INVALID', 'Schedule receipt is non-authoritative and must bind its exact result schedule.');
  return freeze(clone(receipt));
}

function assertScheduleReceiptPredecessor(receipt, previousSchedule) {
  const previous = assertOperatingMeasurementScheduleV2(previousSchedule);
  if (previous.scheduleHash !== receipt.previousScheduleHash || previous.scheduleId !== receipt.scheduleId
    || previous.state !== receipt.fromState || previous.runCount !== receipt.previousRunCount
    || previous.nextEventIdentity !== receipt.previousNextEventIdentity || previous.nextDueAt !== receipt.previousNextDueAt) {
    fail('LIVE_EVIDENCE_BASE_RECORD_MISMATCH', 'Schedule receipt changed its exact predecessor.');
  }
}

function assertScheduleReceiptResult(receipt, resultingSchedule) {
  const result = assertOperatingMeasurementScheduleV2(resultingSchedule);
  if (result.scheduleHash !== receipt.resultingScheduleHash || result.scheduleId !== receipt.scheduleId
    || result.state !== receipt.toState || result.runCount !== receipt.resultingRunCount
    || result.nextEventIdentity !== receipt.resultingNextEventIdentity || result.nextDueAt !== receipt.resultingNextDueAt) {
    fail('LIVE_EVIDENCE_BASE_RECORD_MISMATCH', 'Schedule receipt changed its exact result.');
  }
}

export function assertOperatingMeasurementScheduleReceiptV2(receipt, { previousSchedule, resultingSchedule } = {}) {
  const normalized = assertOperatingMeasurementScheduleReceiptStructureV2(receipt);
  if (previousSchedule === undefined || resultingSchedule === undefined) {
    fail('LIVE_EVIDENCE_BASE_RECORD_REQUIRED', 'A certifying schedule receipt requires its exact predecessor and resulting schedules.');
  }
  assertScheduleReceiptPredecessor(normalized, previousSchedule);
  assertScheduleReceiptResult(normalized, resultingSchedule);
  return normalized;
}

function scheduleReceipt(schedule, transition, next) {
  const receipt = {
    kind: 'operating-measurement-schedule-receipt', schemaVersion: '1.0.0', protocolVersion: '2.0.0', receiptId: transition.receiptId,
    authority: 'none', scheduleId: schedule.scheduleId, scheduleHash: next.scheduleHash,
    previousScheduleHash: transition.expectedScheduleHash, resultingScheduleHash: next.scheduleHash,
    measurementPlanId: schedule.measurementPlanId, planHash: schedule.planHash,
    consentRecordHashes: clone(schedule.consentRecordHashes), ceilingsHash: schedule.ceilingsHash, clockHash: transition.clockHash,
    recurrenceHash: sha256Jcs(schedule.recurrence), startsAt: schedule.startsAt, endsAt: schedule.endsAt, maxRuns: schedule.maxRuns,
    misfirePolicy: schedule.misfirePolicy, dstPolicy: schedule.dstPolicy, transition: transition.type,
    fromState: transition.expectedState, toState: next.state,
    previousRunCount: transition.expectedRunCount, resultingRunCount: next.runCount,
    previousNextEventIdentity: transition.expectedNextEventIdentity, resultingNextEventIdentity: next.nextEventIdentity,
    previousNextDueAt: transition.expectedNextDueAt, resultingNextDueAt: next.nextDueAt,
    ownerActorId: schedule.ownerActorId, eventId: transition.eventId, nextEventIdentity: next.nextEventIdentity,
    at: transition.at,
  };
  receipt.receiptHash = sha256Jcs(receipt);
  return receipt;
}

export function reduceOperatingMeasurementScheduleV2(scheduleValue, transitionValue, { priorReceipt } = {}) {
  const schedule = assertOperatingMeasurementScheduleV2(scheduleValue);
  const transition = clone(transitionValue);
  assertExactKeys(transition, SCHEDULE_TRANSITION_FIELDS, 'Measurement schedule transition');
  const transitionHash = sha256Jcs(transition);
  if (schedule.lastReceiptId === transition.receiptId) {
    if (schedule.lastTransitionHash !== transitionHash) fail('LIVE_EVIDENCE_REPLAY_CONFLICT', 'Divergent schedule transition reused one receipt identity.');
    if (priorReceipt === undefined) fail('LIVE_EVIDENCE_BASE_RECORD_REQUIRED', 'Exact schedule replay requires the stored immutable prior receipt.');
    const receipt = assertOperatingMeasurementScheduleReceiptStructureV2(priorReceipt);
    const expected = scheduleReceipt(schedule, transition, schedule);
    if (!sameValue(receipt, expected)) fail('LIVE_EVIDENCE_REPLAY_CONFLICT', 'Stored schedule receipt does not match the exact replay request and resulting schedule.');
    assertScheduleReceiptResult(receipt, schedule);
    return freeze({ replay: true, schedule, receipt });
  }
  if (transition.expectedGeneration !== schedule.generation || transition.expectedScheduleHash !== schedule.scheduleHash) fail('LIVE_EVIDENCE_CONCURRENT_MODIFICATION', 'Schedule generation or digest changed.');
  if (transition.expectedState !== schedule.state || transition.expectedRunCount !== schedule.runCount
    || transition.expectedNextEventIdentity !== schedule.nextEventIdentity || transition.expectedNextDueAt !== schedule.nextDueAt) {
    fail('LIVE_EVIDENCE_CONCURRENT_MODIFICATION', 'Schedule state, run count, or due identity changed.');
  }
  let toState = SCHEDULE_TRANSITIONS[schedule.state]?.[transition.type];
  if (toState === undefined) fail('LIVE_EVIDENCE_TRANSITION_INVALID', 'Illegal measurement schedule transition.', { from: schedule.state, type: transition.type });
  if (transition.planHash !== schedule.planHash || !sameValue(transition.consentRecordHashes, schedule.consentRecordHashes)
    || transition.ceilingsHash !== schedule.ceilingsHash) fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Schedule transition changed plan or consent custody.');
  let runCount = schedule.runCount;
  if (transition.type === 'enable') {
    if (schedule.consentRecordHashes.length === 0 || transition.nextEventIdentity === null || transition.nextDueAt === null
      || Date.parse(transition.nextDueAt) < Date.parse(schedule.startsAt)) {
      fail('LIVE_EVIDENCE_AUTHORITY_INVALID', 'Enabling measurement requires consent custody and a bounded runtime-issued due identity.');
    }
  } else if (transition.type === 'run-issued') {
    if (schedule.nextEventIdentity !== transition.eventId || schedule.nextDueAt === null
      || Date.parse(transition.at) < Date.parse(schedule.nextDueAt)
      || (schedule.endsAt !== null && Date.parse(transition.at) > Date.parse(schedule.endsAt))) {
      fail('LIVE_EVIDENCE_TRANSITION_INVALID', 'Measurement run is not the exact due runtime identity within its schedule window.');
    }
    runCount += 1;
    const terminalRun = runCount >= schedule.maxRuns || schedule.recurrence.kind === 'once';
    toState = terminalRun ? 'completed' : 'enabled';
    if (terminalRun ? (transition.nextEventIdentity !== null || transition.nextDueAt !== null)
      : (transition.nextEventIdentity === null || transition.nextDueAt === null
        || transition.nextEventIdentity === transition.eventId
        || Date.parse(transition.nextDueAt) <= Date.parse(schedule.nextDueAt))) {
      fail('LIVE_EVIDENCE_TRANSITION_INVALID', 'Measurement run successor identity or completion state is invalid.');
    }
  } else if (['disable', 'revoke', 'expire', 'complete'].includes(transition.type)) {
    if (transition.nextEventIdentity !== null || transition.nextDueAt !== null) fail('LIVE_EVIDENCE_TRANSITION_INVALID', 'Inactive transition cannot retain an executable due identity.');
  } else if (transition.nextEventIdentity !== schedule.nextEventIdentity || transition.nextDueAt !== schedule.nextDueAt) {
    fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Pause or resume cannot substitute the scheduled due identity.');
  }
  const next = { ...clone(schedule), generation: schedule.generation + 1, state: toState, runCount,
    nextEventIdentity: transition.nextEventIdentity, nextDueAt: transition.nextDueAt,
    lastReceiptId: transition.receiptId, lastTransitionHash: transitionHash };
  delete next.scheduleHash;
  next.scheduleHash = sha256Jcs(next);
  const normalizedNext = assertOperatingMeasurementScheduleV2(next);
  const receipt = scheduleReceipt(schedule, transition, normalizedNext);
  return freeze({ replay: false, schedule: normalizedNext,
    receipt: assertOperatingMeasurementScheduleReceiptV2(receipt, { previousSchedule: schedule, resultingSchedule: normalizedNext }) });
}

export function assertOperatingEvidenceObservationV2(observation, {
  measurementPlan, metricObservation, ingestion, connectorCheckpoint, artifact, evidenceRefs, acceptedBridge,
} = {}) {
  protocol('operating-evidence-observation', observation);
  safePortable(observation);
  selfHash(observation, 'observationHash');
  if (measurementPlan === undefined) fail('LIVE_EVIDENCE_BASE_RECORD_REQUIRED', 'Evidence observation requires the exact measurement plan.');
  const plan = assertOperatingMeasurementPlanV2(measurementPlan);
  if (plan.measurementPlanId !== observation.measurementPlan.recordId || plan.planHash !== observation.measurementPlan.recordDigest
    || plan.metric.metricId !== observation.metricId || plan.metric.unit !== observation.unit || plan.metric.dimension !== observation.dimension) {
    fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Evidence observation changed measurement-plan metric custody.');
  }
  if (ingestion === undefined || connectorCheckpoint === undefined || artifact === undefined || !Array.isArray(evidenceRefs)
    || acceptedBridge === undefined) {
    fail('LIVE_EVIDENCE_BASE_RECORD_REQUIRED', 'Evidence observation requires the exact accepted ingestion bridge, checkpoint, Artifact, and EvidenceRef custody.');
  }
  const accepted = assertAcceptedLiveEvidenceBridgeV2(ingestion, acceptedBridge);
  if (accepted.ingestionHash !== ingestion.ingestionHash
    || acceptedBridge.artifact?.artifactId !== artifact.artifactId
    || acceptedBridge.resultCheckpoint?.checkpointId !== connectorCheckpoint.checkpointId
    || evidenceRefs.length !== 1
    || acceptedBridge.evidenceRef?.evidenceRefId !== evidenceRefs[0]?.evidenceRefId
    || sha256Jcs(acceptedBridge.evidenceRef) !== sha256Jcs(evidenceRefs[0])) {
    fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Observation custody is not the exact accepted live-evidence bridge.');
  }
  const checkpoint = assertOperatingConnectorCheckpointV2(connectorCheckpoint);
  protocol('operating-artifact', artifact);
  if (observation.ingestion.ingestionId !== ingestion.ingestionId || observation.ingestion.ingestionHash !== ingestion.ingestionHash
    || observation.checkpoint.checkpointId !== checkpoint.checkpointId || observation.checkpoint.checkpointHash !== checkpoint.checkpointHash
    || observation.artifact.artifactId !== artifact.artifactId || observation.artifact.recordDigest !== sha256Jcs(artifact)
    || artifact.canonicalHash !== sha256Jcs(ingestion) || ingestion.providerRegistrationHash !== observation.providerRegistrationHash
    || !sameValue(ingestion.provider, observation.provider)) {
    fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Evidence observation changed live-ingestion Artifact or provider custody.');
  }
  const refs = evidenceRefs.map((entry) => {
    protocol('operating-evidence-ref', entry);
    return { evidenceRefId: entry.evidenceRefId, recordDigest: sha256Jcs(entry) };
  }).sort((left, right) => left.evidenceRefId.localeCompare(right.evidenceRefId));
  const claimedRefs = [...observation.evidenceRefs].sort((left, right) => left.evidenceRefId.localeCompare(right.evidenceRefId));
  if (!sameValue(refs, claimedRefs)) fail('LIVE_EVIDENCE_BASE_RECORD_MISMATCH', 'Evidence observation changed EvidenceRef membership or bytes.');
  if (observation.status === 'observed') {
    currentAt(observation.observedAt, observation.freshUntil, 'Observation');
    if (metricObservation === undefined) fail('LIVE_EVIDENCE_BASE_RECORD_REQUIRED', 'Observed evidence requires the exact canonical metric observation.');
    protocol('operating-metric-observation', metricObservation);
    exactDigest(metricObservation, observation.metricObservation.recordDigest, 'Metric observation');
    same([metricObservation.observationId, metricObservation.metricId, metricObservation.value, metricObservation.unit, metricObservation.observedAt, metricObservation.sourceArtifactId, metricObservation.evidenceRefIds], [observation.metricObservation.recordId, observation.metricId, observation.value, observation.unit, observation.observedAt, observation.artifact.artifactId, observation.evidenceRefs.map((entry) => entry.evidenceRefId)], 'Metric observation');
  } else if ((observation.status === 'absent' && observation.absences.length === 0)
    || (observation.status === 'contradicted' && observation.contradictions.length === 0)) {
    fail('LIVE_EVIDENCE_FALSE_PASS', 'Non-observed evidence must retain its typed absence or contradiction.');
  }
  return freeze(clone(observation));
}

function observationCustodyFor(observation, custody) {
  const matches = custody.filter((entry) => entry?.evidenceObservationId === observation.evidenceObservationId);
  if (matches.length !== 1) fail('LIVE_EVIDENCE_BASE_RECORD_REQUIRED', 'Each evidence observation requires one exact custody bundle.', { evidenceObservationId: observation.evidenceObservationId });
  return matches[0];
}

function canonicalEvaluationInputs({ evaluation, plan, evidenceObservations, metricObservations, observationCustody }) {
  if (!Array.isArray(observationCustody)) fail('LIVE_EVIDENCE_BASE_RECORD_REQUIRED', 'Outcome evaluation requires exact observation custody bundles.');
  const ids = new Set();
  const normalizedEvidence = evidenceObservations.map((entry) => {
    if (ids.has(entry.evidenceObservationId)) fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Duplicate evidence observation identity is forbidden.', { evidenceObservationId: entry.evidenceObservationId });
    ids.add(entry.evidenceObservationId);
    const custody = observationCustodyFor(entry, observationCustody);
    const metricObservation = entry.metricObservation === null ? undefined
      : metricObservations.find((candidate) => candidate.observationId === entry.metricObservation.recordId);
    return assertOperatingEvidenceObservationV2(entry, { measurementPlan: plan, metricObservation, ...custody });
  }).sort((left, right) => left.evidenceObservationId.localeCompare(right.evidenceObservationId));
  if (normalizedEvidence.length !== evaluation.observations.length || observationCustody.length !== normalizedEvidence.length) {
    fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Evaluation observation membership changed.');
  }
  const wrappers = normalizedEvidence.map((entry) => ({
    evidenceObservationId: entry.evidenceObservationId,
    observationId: entry.metricObservation?.recordId ?? null,
    observationHash: entry.observationHash,
    metricObservationDigest: entry.metricObservation?.recordDigest ?? null,
    value: entry.value,
    unit: entry.unit,
    observedAt: entry.observedAt,
    freshUntil: entry.freshUntil,
    status: entry.status,
  }));
  if (!sameValue(evaluation.observations, wrappers)) fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Evaluation wrappers are not the canonical unique observation set.');
  const inWindow = normalizedEvidence.filter((entry) => Date.parse(entry.observedAt) >= Date.parse(plan.window.from)
    && Date.parse(entry.observedAt) <= Date.parse(plan.window.to));
  const observed = inWindow.filter((entry) => entry.status === 'observed' && Date.parse(entry.freshUntil) > Date.parse(evaluation.evaluatedAt));
  const absences = inWindow.flatMap((entry) => entry.absences.map((absence) => absence.detailsHash));
  for (const entry of inWindow.filter((item) => item.status === 'observed' && Date.parse(item.freshUntil) <= Date.parse(evaluation.evaluatedAt))) {
    absences.push(sha256Jcs({ kind: 'stale', evidenceObservationId: entry.evidenceObservationId, observationHash: entry.observationHash, evaluatedAt: evaluation.evaluatedAt }));
  }
  const contradictions = inWindow.flatMap((entry) => entry.contradictions);
  return {
    normalizedEvidence, wrappers, inWindow, observed,
    absences: [...new Set(absences)].sort(), contradictions: [...new Set(contradictions)].sort(),
  };
}

export function assertOperatingOutcomeEvaluationV2(evaluation, {
  measurementPlan, verificationPlan, outcome, evidenceObservations, metricObservations = [],
  observationCustody, previousEvaluation,
} = {}) {
  protocol('operating-outcome-evaluation', evaluation);
  safePortable(evaluation);
  selfHash(evaluation, 'evaluationHash');
  if (measurementPlan === undefined || verificationPlan === undefined || outcome === undefined || !Array.isArray(evidenceObservations)) fail('LIVE_EVIDENCE_BASE_RECORD_REQUIRED', 'Outcome evaluation requires its exact plan, Outcome, and evidence observations.');
  const plan = assertOperatingMeasurementPlanV2(measurementPlan, { verificationPlan });
  if (plan.planHash !== evaluation.measurementPlan.recordDigest || plan.measurementPlanId !== evaluation.measurementPlan.recordId) fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Evaluation changed its measurement plan.');
  const canonical = canonicalEvaluationInputs({ evaluation, plan, evidenceObservations, metricObservations, observationCustody });
  if (!sameValue([evaluation.window, evaluation.operator, evaluation.unit, evaluation.dimension, evaluation.baseline, evaluation.target, evaluation.minimumEvidence],
    [plan.window, plan.target.operator, plan.metric.unit, plan.metric.dimension, plan.baseline.value, plan.target.value, plan.minimumEvidence])) {
    fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Evaluation changed its exact plan algebra, window, or threshold.');
  }
  const computedResult = canonical.absences.length > 0 || canonical.contradictions.length > 0 || canonical.observed.length < plan.minimumEvidence
    ? 'insufficient-evidence' : canonical.observed.every((entry) => compare(plan.target.operator, entry.value, plan.target.value)) ? 'passed' : 'failed';
  const computedConfidence = canonical.inWindow.length === 0 ? 0 : canonical.observed.length / Math.max(canonical.inWindow.length, plan.minimumEvidence);
  const computedInputDigest = sha256Jcs(canonical.wrappers.map((entry) => entry.observationHash));
  const computedProviders = [...new Map(canonical.inWindow.map((entry) => [`${entry.provider.id}@${entry.provider.version}`, entry.provider])).values()].sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`));
  if (evaluation.result !== computedResult || evaluation.confidence !== computedConfidence || evaluation.exactInputDigest !== computedInputDigest
    || !sameValue(evaluation.providerVersions, computedProviders) || !sameValue(evaluation.absences, canonical.absences)
    || !sameValue(evaluation.contradictions, canonical.contradictions)) fail('LIVE_EVIDENCE_FALSE_PASS', 'Outcome result, confidence, input digest, provider, absence, or contradiction truth is not deterministic from bound evidence.');
  if (verificationPlan !== undefined) {
    protocol('operating-action-verification-plan', verificationPlan);
    exactDigest(verificationPlan, evaluation.verificationPlan.recordDigest, 'Verification plan');
    same([verificationPlan.verificationPlanId, verificationPlan.actionId, verificationPlan.metricId], [evaluation.verificationPlan.recordId, evaluation.actionId, evaluation.metricId], 'Evaluation verification plan');
  }
  if (outcome !== undefined) {
    protocol('operating-outcome', outcome);
    exactDigest(outcome, evaluation.outcome.recordDigest, 'Outcome');
    const status = evaluation.result === 'passed' ? 'succeeded' : evaluation.result === 'failed' ? 'failed' : 'insufficient-evidence';
    same([outcome.outcomeId, outcome.actionId, outcome.verificationPlanId, outcome.status], [evaluation.outcome.recordId, evaluation.actionId, evaluation.verificationPlan.recordId, status], 'Outcome evaluation');
  }
  if (evaluation.previousEvaluationHash === null) {
    if (previousEvaluation !== undefined && previousEvaluation !== null) fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Initial evaluation cannot carry a predecessor.');
  } else {
    if (previousEvaluation === undefined || previousEvaluation === null) fail('LIVE_EVIDENCE_BASE_RECORD_REQUIRED', 'Reevaluation requires the exact immutable predecessor.');
    protocol('operating-outcome-evaluation', previousEvaluation);
    selfHash(previousEvaluation, 'evaluationHash');
    if (previousEvaluation.evaluationHash !== evaluation.previousEvaluationHash
      || !sameValue([previousEvaluation.measurementPlan, previousEvaluation.verificationPlan, previousEvaluation.outcome],
        [evaluation.measurementPlan, evaluation.verificationPlan, evaluation.outcome])
      || Date.parse(previousEvaluation.evaluatedAt) >= Date.parse(evaluation.evaluatedAt)
      || previousEvaluation.exactInputDigest === evaluation.exactInputDigest) {
      fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Reevaluation predecessor, lineage, time, or changed evidence custody is invalid.');
    }
  }
  if (evaluation.revisit.required !== (evaluation.result !== 'passed')
    || !sameValue(evaluation.revisit.decisionIds, verificationPlan.revisitDecisionIds)) {
    fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Evaluation revisit truth changed from its result or verification plan.');
  }
  return freeze(clone(evaluation));
}

function compare(operator, value, target) {
  if (operator === 'gt') return value > target;
  if (operator === 'gte') return value >= target;
  if (operator === 'lt') return value < target;
  if (operator === 'lte') return value <= target;
  if (operator === 'eq') return value === target;
  return value >= target[0] && value <= target[1];
}

export function evaluateOperatingOutcomeV2({
  plan, observations, metricObservations, observationCustody, evaluationId, outcome, verificationPlan,
  evaluatedAt, previousEvaluation = null,
}) {
  const normalizedPlan = assertOperatingMeasurementPlanV2(plan, { verificationPlan });
  const normalized = observations.map((entry) => {
    const custody = observationCustodyFor(entry, observationCustody);
    return assertOperatingEvidenceObservationV2(entry, { measurementPlan: normalizedPlan,
      metricObservation: entry.metricObservation === null ? undefined : metricObservations.find((candidate) => candidate.observationId === entry.metricObservation.recordId),
      ...custody });
  }).sort((left, right) => left.evidenceObservationId.localeCompare(right.evidenceObservationId));
  const inWindow = normalized.filter((entry) => Date.parse(entry.observedAt) >= Date.parse(plan.window.from) && Date.parse(entry.observedAt) <= Date.parse(plan.window.to));
  const observed = inWindow.filter((entry) => entry.status === 'observed' && Date.parse(entry.freshUntil) > Date.parse(evaluatedAt));
  const absences = inWindow.flatMap((entry) => entry.absences.map((absence) => absence.detailsHash));
  for (const entry of inWindow.filter((item) => item.status === 'observed' && Date.parse(item.freshUntil) <= Date.parse(evaluatedAt))) {
    absences.push(sha256Jcs({ kind: 'stale', evidenceObservationId: entry.evidenceObservationId, observationHash: entry.observationHash, evaluatedAt }));
  }
  const contradictions = inWindow.flatMap((entry) => entry.contradictions);
  let result = 'insufficient-evidence';
  if (absences.length === 0 && contradictions.length === 0 && observed.length >= plan.minimumEvidence) {
    result = observed.every((entry) => compare(plan.target.operator, entry.value, plan.target.value)) ? 'passed' : 'failed';
  }
  const evaluation = {
    kind: 'operating-outcome-evaluation', schemaVersion: '1.0.0', protocolVersion: '2.0.0', evaluationId, previousEvaluationHash: previousEvaluation?.evaluationHash ?? null,
    measurementPlan: { contractId: 'operating-measurement-plan', schemaVersion: '1.0.0', protocolVersion: '2.0.0', recordId: plan.measurementPlanId, recordDigest: plan.planHash },
    verificationPlan: { contractId: 'operating-action-verification-plan', schemaVersion: '1.0.0', protocolVersion: '2.0.0', recordId: verificationPlan.verificationPlanId, recordDigest: sha256Jcs(verificationPlan) },
    outcome: { contractId: 'operating-outcome', schemaVersion: '1.0.0', protocolVersion: '2.0.0', recordId: outcome.outcomeId, recordDigest: sha256Jcs(outcome) },
    actionId: plan.action.actionId, metricId: plan.metric.metricId,
    observations: normalized.map((entry) => ({ evidenceObservationId: entry.evidenceObservationId, observationId: entry.metricObservation?.recordId ?? null, observationHash: entry.observationHash, metricObservationDigest: entry.metricObservation?.recordDigest ?? null, value: entry.value, unit: entry.unit, observedAt: entry.observedAt, freshUntil: entry.freshUntil, status: entry.status })),
    providerVersions: [...new Map(inWindow.map((entry) => [`${entry.provider.id}@${entry.provider.version}`, entry.provider])).values()].sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`)),
    window: clone(plan.window), operator: plan.target.operator, unit: plan.metric.unit, dimension: plan.metric.dimension,
    baseline: plan.baseline.value, target: clone(plan.target.value), minimumEvidence: plan.minimumEvidence,
    exactInputDigest: sha256Jcs(normalized.map((entry) => entry.observationHash)), result,
    confidence: inWindow.length === 0 ? 0 : observed.length / Math.max(inWindow.length, plan.minimumEvidence), absences: [...new Set(absences)].sort(),
    contradictions: [...new Set(contradictions)].sort(), evaluatedAt,
    revisit: { required: result !== 'passed', condition: result === 'passed' ? null : 'Evidence did not prove the declared target.', decisionIds: clone(verificationPlan.revisitDecisionIds) },
  };
  evaluation.evaluationHash = sha256Jcs(evaluation);
  return assertOperatingOutcomeEvaluationV2(evaluation, { measurementPlan: normalizedPlan, verificationPlan, outcome,
    evidenceObservations: normalized, metricObservations, observationCustody, previousEvaluation });
}

export function assertOperatingLearningReceiptV2(receipt, {
  learning, outcome, evaluation, measurementPlan, verificationPlan, evidenceObservations,
  metricObservations, observationCustody, previousEvaluation,
} = {}) {
  protocol('operating-learning-receipt', receipt);
  safePortable(receipt);
  selfHash(receipt, 'receiptHash');
  if (learning === undefined || outcome === undefined || evaluation === undefined
    || measurementPlan === undefined || verificationPlan === undefined
    || !Array.isArray(evidenceObservations) || !Array.isArray(metricObservations)
    || !Array.isArray(observationCustody)) {
    fail('LIVE_EVIDENCE_BASE_RECORD_REQUIRED', 'A certifying Learning receipt requires exact Learning, Outcome, evaluation, plan, and observation custody.');
  }
  protocol('operating-learning', learning);
  exactDigest(learning, receipt.learning.recordDigest, 'Learning');
  same([learning.learningId, learning.outcomeId, learning.assumptionIds, learning.decisionIds, learning.evidenceRefIds], [receipt.learning.recordId, receipt.outcome.recordId, receipt.assumptionIds, receipt.decisionIds, receipt.evidenceRefIds], 'Learning receipt');
  same(sha256Jcs(learning.statement), receipt.statementDigest, 'Learning statement digest');
  protocol('operating-outcome', outcome);
  exactDigest(outcome, receipt.outcome.recordDigest, 'Learning outcome');
  assertOperatingOutcomeEvaluationV2(evaluation, { measurementPlan, verificationPlan, outcome,
    evidenceObservations, metricObservations, observationCustody, previousEvaluation });
  if (evaluation.evaluationId !== receipt.evaluation.evaluationId || evaluation.evaluationHash !== receipt.evaluation.evaluationHash || evaluation.result !== receipt.evaluation.result) fail('LIVE_EVIDENCE_BINDING_MISMATCH', 'Learning receipt changed the evaluation result.');
  return freeze(clone(receipt));
}
