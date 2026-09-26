import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  assertAcceptedLiveEvidenceBridgeV2,
  assertOperatingOutcomeEvaluationV2,
  deriveOperatingLiveEvidenceContentDigestV2,
  deriveOperatingLiveEvidenceRequestHashV2,
  evaluateOperatingOutcomeV2,
  reduceOperatingConnectorCheckpointV2,
  reduceOperatingMeasurementScheduleV2,
  registerLiveEvidenceProviderV2,
} from '../../lib/protocol/live-evidence-v2.mjs';

const protocolFixtures = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/all-contracts-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

const digest = (value) => sha256Jcs(value);
const copy = (value) => structuredClone(value);
const hashRecord = (body, field) => ({ ...body, [field]: digest(body) });
const errorCode = (code) => (error) => error?.code === code;

function providerRegistration() {
  const baseEvidenceProvider = {
    ...copy(protocolFixtures['operate-evidence-provider-registration']),
    supportedEvidenceKinds: ['operate-artifact'],
  };
  const baseResolver = {
    ...copy(protocolFixtures['operate-evidence-resolver-registration']),
    supportedEvidenceKinds: ['operate-artifact'],
  };
  const body = {
    kind: 'operate-live-evidence-provider-registration',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    providerId: 'reference-live-provider',
    providerVersion: '1.0.0',
    adapterVersion: '1.0.0',
    baseEvidenceProvider: {
      contractId: 'operate-evidence-provider-registration',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      providerId: baseEvidenceProvider.providerId,
      providerVersion: baseEvidenceProvider.providerVersion,
      recordDigest: digest(baseEvidenceProvider),
    },
    baseResolver: {
      contractId: 'operate-evidence-resolver-registration',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      resolverId: baseResolver.resolverId,
      resolverVersion: baseResolver.resolverVersion,
      recordDigest: digest(baseResolver),
    },
    supportedKinds: ['metric-snapshot'],
    supportedDomains: ['product-analytics'],
    effects: ['provider-call'],
    bounds: { maxCalls: 2, maxPages: 4, maxRecords: 100, maxBytes: 65536, timeoutMs: 30000 },
    consent: {
      required: true,
      mode: 'named-owner-current',
      docketRequired: true,
      noDefaultChoice: true,
      previewEffect: 'none',
      runtimeCapability: 'opaque-local-preissued',
      credentialRefKinds: ['environment-name'],
    },
    sensitivity: {
      maximumInput: 'confidential',
      maximumOutput: 'internal',
      rawRestrictedPortable: false,
    },
    health: {
      statuses: ['available', 'degraded', 'unavailable'],
      maxAgeSeconds: 300,
      unavailableBehavior: 'typed-absence',
    },
    retry: { maxAttempts: 2, backoff: 'bounded-exponential', retryableErrors: ['RATE_LIMITED'] },
    idempotency: {
      identitySource: 'runtime-derived-request-hash',
      exactReplay: 'return-recorded-result',
      divergentReplay: 'conflict',
    },
    inputContract: { schemaId: 'operating-assignment', schemaVersion: '2.0.0' },
    outputContract: { schemaId: 'operating-live-evidence-ingestion', schemaVersion: '2.0.0' },
    errorContract: { schemaId: 'operate-api-envelope', schemaVersion: '2.0.0' },
    errorCodes: ['LIVE_EVIDENCE_PROVIDER_UNAVAILABLE', 'MISSING_CONSENT', 'RATE_LIMITED'],
    provenance: {
      packageName: 'openplanr-reference-provider',
      packageVersion: '1.0.0',
      integrity: digest('provider-package'),
    },
    conformanceDigest: digest('provider-conformance'),
    implementation: { kind: 'runtime-adapter', id: 'reference-live-adapter' },
    fallback: { kind: 'unavailable', errorCode: 'LIVE_EVIDENCE_PROVIDER_UNAVAILABLE' },
  };
  return { registration: hashRecord(body, 'registrationHash'), baseEvidenceProvider, baseResolver };
}

function consentFor(registration) {
  const shared = {
    provider: { id: registration.providerId, version: registration.providerVersion },
    adapterVersion: registration.adapterVersion,
    accountIdentityHash: digest('provider-account'),
    selectors: ['project.reference'],
    scopes: ['metrics.read'],
    queryHash: digest('activation-query'),
    window: { from: '2026-08-24T09:00:00Z', to: '2026-08-24T11:00:00Z' },
    ceilings: { maxCalls: 2, maxPages: 4, maxRecords: 100, maxBytes: 65536 },
    classification: 'internal',
    purpose: 'Evaluate the approved activation outcome.',
    expiresAt: '2026-08-24T13:00:00Z',
  };
  const docket = {
    ...copy(shared),
    sensitivity: 'confidential',
    effect: 'provider-call',
    changedRecordDiffHash: null,
    consequences: ['The provider receives one bounded read-only metric query.'],
    authorityBoundary: 'consent-is-not-access-authority',
    choices: ['approve', 'cancel'],
    defaultChoice: null,
    cancelEffect: 'none',
  };
  const body = {
    kind: 'operating-live-evidence-consent-record',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    consentRecordId: 'lcon_live0001',
    authority: 'none',
    decision: 'approved',
    docket,
    docketHash: digest(docket),
    actor: { actorId: 'owner.reference', kind: 'human' },
    ...shared,
    issuedAt: '2026-08-24T09:55:00Z',
  };
  return hashRecord(body, 'consentHash');
}

function assignmentFor() {
  return {
    ...copy(protocolFixtures['operating-assignment']),
    assignmentId: 'asg_live0001',
    cycleId: 'cyc_live0001',
    assignmentKind: 'verification',
    objective: 'Materialize the exact consent-bound activation observation.',
    outputContract: {
      schemaId: 'operating-live-evidence-ingestion',
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 65536,
    },
    createdAt: '2026-08-24T09:56:00Z',
    availableAt: '2026-08-24T09:56:01Z',
  };
}

function connectorEvent(current, type, eventId, at, patch) {
  const body = {
    eventId,
    type,
    expectedGeneration: current.generation,
    expectedCheckpointHash: current.checkpointHash,
    at,
    patch,
  };
  return { ...body, eventHash: digest(body) };
}

function buildLiveEvidence() {
  const { registration, baseEvidenceProvider, baseResolver } = providerRegistration();
  const consentRecord = consentFor(registration);
  const assignment = assignmentFor();
  const health = {
    status: 'available',
    checkedAt: '2026-08-24T10:00:00Z',
    freshUntil: '2026-08-24T12:00:00Z',
    proofDigest: digest('provider-health'),
  };
  const runtimeCapabilityHash = digest('opaque-runtime-capability');
  let preparedCheckpoint = hashRecord(
    {
      kind: 'operating-connector-checkpoint',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      checkpointId: 'lchk_live0001',
      generation: 0,
      lastEventId: null,
      lastEventHash: null,
      state: 'prepared',
      requestId: 'lreq_live0001',
      requestHash: digest('request-pending'),
      effect: 'provider-call',
      provider: { id: registration.providerId, version: registration.providerVersion },
      providerRegistrationHash: registration.registrationHash,
      adapterVersion: registration.adapterVersion,
      sourceIdentityHash: digest('source-identity'),
      consentRecordId: null,
      consentRecordHash: null,
      consentExpiresAt: null,
      runtimeCapabilityHash: null,
      credentialRefHash: digest('credential-reference'),
      boundsHash: digest(consentRecord.ceilings),
      queryHash: consentRecord.queryHash,
      windowHash: digest(consentRecord.window),
      health,
      redactionVersion: '1.0.0',
      predecessorDigest: null,
      watermarkDigest: null,
      artifactId: null,
      artifactHash: null,
      absenceDigest: null,
      createdAt: '2026-08-24T09:57:00Z',
      updatedAt: '2026-08-24T09:57:00Z',
    },
    'checkpointHash',
  );
  const requestPatch = {
    consentRecordId: consentRecord.consentRecordId,
    consentRecordHash: consentRecord.consentHash,
    consentExpiresAt: consentRecord.expiresAt,
    runtimeCapabilityHash,
    health,
  };
  const provisionalRequestEvent = connectorEvent(
    preparedCheckpoint,
    'request',
    'lcev_request00',
    '2026-08-24T10:00:00Z',
    requestPatch,
  );
  const requestBoundCheckpoint = reduceOperatingConnectorCheckpointV2(
    preparedCheckpoint,
    provisionalRequestEvent,
  );
  const requestHash = deriveOperatingLiveEvidenceRequestHashV2({
    assignment,
    consentRecord,
    connectorCheckpoint: requestBoundCheckpoint,
    liveProviderRegistration: registration,
    baseEvidenceProvider,
    baseResolver,
    sourceContract: { id: 'context-manifest', version: '1.0.0' },
    classification: 'internal',
  });
  preparedCheckpoint = { ...preparedCheckpoint, requestHash };
  const { checkpointHash: ignoredCheckpointHash, ...preparedBody } = preparedCheckpoint;
  preparedCheckpoint = { ...preparedBody, checkpointHash: digest(preparedBody) };

  const requestEvent = connectorEvent(
    preparedCheckpoint,
    'request',
    'lcev_request01',
    '2026-08-24T10:00:01Z',
    requestPatch,
  );
  const requestingCheckpoint = reduceOperatingConnectorCheckpointV2(
    preparedCheckpoint,
    requestEvent,
  );

  const artifactId = 'art_live00001';
  const evidenceRefId = 'evr_live00001';
  const redactedRecordDigest = digest('redacted-provider-record');
  const candidate = {
    kind: 'operating-evidence-candidate',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    candidateId: 'evc_live00001',
    scopeId: 'scope-reference',
    domainId: 'business',
    domainVersion: '1.0.0',
    sourceArtifactId: artifactId,
    evidenceKind: 'operate-artifact',
    locator: {
      artifactId,
      expectedArtifactType: 'live-evidence-ingestion',
      expectedSchemaId: 'operating-live-evidence-ingestion',
      expectedSchemaVersion: '2.0.0',
    },
    provider: {
      id: baseEvidenceProvider.providerId,
      version: baseEvidenceProvider.providerVersion,
    },
    resolver: { id: baseResolver.resolverId, version: baseResolver.resolverVersion },
  };
  const ingestionBody = {
    kind: 'operating-live-evidence-ingestion',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    ingestionId: 'ling_live0001',
    requestId: requestingCheckpoint.requestId,
    requestHash,
    assignment: {
      assignmentId: assignment.assignmentId,
      assignmentRevision: 1,
      assignmentHash: digest(assignment),
      requestHash,
      assignmentKind: 'verification',
      outputContract: { schemaId: 'operating-live-evidence-ingestion', schemaVersion: '2.0.0' },
    },
    submission: {
      operation: 'operate.assignment.submit',
      submissionId: 'sub_live00001',
      submittedEventId: 'evt_live00001',
      artifactCreatedEventId: 'evt_live00002',
      validatedEventId: 'evt_live00003',
      artifactId,
      evidenceRefId,
    },
    provider: { id: registration.providerId, version: registration.providerVersion },
    providerRegistration: copy(registration.baseEvidenceProvider),
    providerRegistrationHash: registration.registrationHash,
    resolverRegistration: copy(registration.baseResolver),
    resolverRegistrationHash: registration.baseResolver.recordDigest,
    adapterVersion: registration.adapterVersion,
    status: 'materialized',
    consentRecordHash: consentRecord.consentHash,
    runtimeCapabilityHash,
    checkpoint: {
      checkpointId: requestingCheckpoint.checkpointId,
      predecessorDigest: requestingCheckpoint.predecessorDigest,
      checkpointHash: requestingCheckpoint.checkpointHash,
    },
    health,
    boundsHash: digest(consentRecord.ceilings),
    classification: 'internal',
    sourceContract: { id: 'context-manifest', version: '1.0.0' },
    sourceTiming: {
      requestedAt: '2026-08-24T10:00:01Z',
      capturedAt: '2026-08-24T10:02:00Z',
      freshUntil: '2026-08-24T12:00:00Z',
    },
    records: [
      {
        recordIdentityHash: digest('provider-row-1'),
        contentDigest: redactedRecordDigest,
        classification: 'internal',
      },
    ],
    absences: [],
    evidenceCandidates: [candidate],
    evidenceClaimLinks: [
      {
        candidateId: candidate.candidateId,
        sourceArtifactId: artifactId,
        localClaimId: 'activation-rate',
        relation: 'supportedBy',
        confidence: 0.9,
      },
    ],
    materialization: {
      artifactId,
      artifactCreatedEventId: 'evt_live00002',
      evidenceRefId,
      contentDigest: digest('pending-redacted-manifest'),
      redactionVersion: '1.0.0',
    },
  };
  ingestionBody.materialization.contentDigest =
    deriveOperatingLiveEvidenceContentDigestV2(ingestionBody);
  const ingestion = hashRecord(ingestionBody, 'ingestionHash');
  const artifact = {
    ...copy(protocolFixtures['operating-artifact']),
    artifactId,
    artifactType: 'live-evidence-ingestion',
    assignmentId: assignment.assignmentId,
    cycleId: assignment.cycleId,
    schemaId: 'operating-live-evidence-ingestion',
    scopeId: candidate.scopeId,
    domainId: candidate.domainId,
    domainVersion: candidate.domainVersion,
    artifactSchemaVersion: '2.0.0',
    rawHash: digest('raw-provider-response'),
    canonicalHash: digest(ingestion),
    sizeBytes: 2048,
    createdAt: '2026-08-24T10:02:00Z',
  };
  const eventBody = (
    eventId,
    sequence,
    type,
    entityId,
    causationId,
    previousEventHash,
    payload,
  ) => ({
    kind: 'operating-event',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    eventId,
    sequence,
    timestamp: artifact.createdAt,
    cycleId: artifact.cycleId,
    type,
    entityId,
    actor: { kind: 'runtime', id: 'openplanr' },
    causationId,
    correlationId: 'corr-live-ingestion',
    previousEventHash,
    payload,
  });
  const submittedEvent = hashRecord(
    eventBody(
      ingestion.submission.submittedEventId,
      20,
      'assignment.submitted',
      assignment.assignmentId,
      null,
      digest('previous-runtime-event'),
      {
        assignmentId: assignment.assignmentId,
        submissionId: ingestion.submission.submissionId,
        rawHash: artifact.rawHash,
        canonicalHash: artifact.canonicalHash,
        sizeBytes: artifact.sizeBytes,
        mediaType: artifact.mediaType,
        encoding: artifact.encoding,
      },
    ),
    'eventHash',
  );
  const artifactCreatedEvent = hashRecord(
    eventBody(
      ingestion.submission.artifactCreatedEventId,
      21,
      'artifact.created',
      artifact.artifactId,
      submittedEvent.eventId,
      submittedEvent.eventHash,
      artifact,
    ),
    'eventHash',
  );
  const validatedEvent = hashRecord(
    eventBody(
      ingestion.submission.validatedEventId,
      22,
      'assignment.validated',
      assignment.assignmentId,
      artifactCreatedEvent.eventId,
      artifactCreatedEvent.eventHash,
      {
        assignmentId: assignment.assignmentId,
        submissionId: ingestion.submission.submissionId,
        artifactId,
        validatorVersion: '2.0.0',
      },
    ),
    'eventHash',
  );
  const evidenceArtifact = {
    ...copy(artifact),
    artifactId: 'art_evidence01',
    artifactType: 'evidence-snapshot',
    schemaId: 'operating-evidence-snapshot',
    artifactSchemaVersion: '1.0.0',
    mediaType: 'application/octet-stream',
    encoding: 'binary',
    producer: { actorId: 'openplanr', roleId: 'evidence-resolver', runtime: 'openplanr' },
    inputArtifactIds: [artifact.artifactId],
    createdAt: '2026-08-24T10:02:01Z',
  };
  const evidenceRef = {
    ...copy(protocolFixtures['operating-evidence-ref']),
    evidenceRefId,
    candidateId: candidate.candidateId,
    scopeId: candidate.scopeId,
    domainId: candidate.domainId,
    domainVersion: candidate.domainVersion,
    sourceArtifactId: artifactId,
    evidenceKind: candidate.evidenceKind,
    locator: {
      ...copy(candidate.locator),
      expectedRawHash: artifact.rawHash,
      expectedCanonicalHash: artifact.canonicalHash,
    },
    provider: copy(candidate.provider),
    resolver: copy(candidate.resolver),
    classification: 'internal',
    freshness: 'current',
    evidenceArtifactId: evidenceArtifact.artifactId,
    evidenceArtifactRawHash: evidenceArtifact.rawHash,
    evidenceArtifactCanonicalHash: evidenceArtifact.canonicalHash,
    resolvedAt: evidenceArtifact.createdAt,
    sourceContract: copy(ingestion.sourceContract),
  };
  const evidenceResolution = {
    ...copy(protocolFixtures['operating-evidence-resolution']),
    resolutionId: 'evs_live00001',
    candidateId: candidate.candidateId,
    scopeId: candidate.scopeId,
    domainId: candidate.domainId,
    domainVersion: candidate.domainVersion,
    sourceArtifactId: artifact.artifactId,
    evidenceKind: candidate.evidenceKind,
    provider: copy(candidate.provider),
    resolver: copy(candidate.resolver),
    outcome: 'resolved',
    evidenceRefId: evidenceRef.evidenceRefId,
    evidenceArtifactId: evidenceArtifact.artifactId,
    error: null,
    resolvedAt: evidenceRef.resolvedAt,
    sourceContract: copy(ingestion.sourceContract),
  };
  const materializeEvent = connectorEvent(
    requestingCheckpoint,
    'materialize',
    'lcev_material1',
    '2026-08-24T10:02:01Z',
    {
      artifactId,
      artifactHash: artifact.canonicalHash,
      watermarkDigest: digest('watermark-1'),
      health,
    },
  );
  const materializedCheckpoint = reduceOperatingConnectorCheckpointV2(
    requestingCheckpoint,
    materializeEvent,
  );
  const commitEvent = connectorEvent(
    materializedCheckpoint,
    'commit',
    'lcev_commit001',
    '2026-08-24T10:02:02Z',
    {
      watermarkDigest: digest('watermark-1'),
    },
  );
  const committedCheckpoint = reduceOperatingConnectorCheckpointV2(
    materializedCheckpoint,
    commitEvent,
  );
  const acceptedBridge = {
    assignment,
    artifact,
    submittedEvent,
    artifactCreatedEvent,
    validatedEvent,
    evidenceRef,
    evidenceArtifact,
    evidenceResolution,
    resultCheckpoint: committedCheckpoint,
    checkpointHistory: [materializedCheckpoint],
    connectorCheckpoint: requestingCheckpoint,
    liveProviderRegistration: registration,
    baseEvidenceProvider,
    baseResolver,
    consentRecord,
  };
  return {
    registration,
    baseEvidenceProvider,
    baseResolver,
    consentRecord,
    assignment,
    health,
    runtimeCapabilityHash,
    preparedCheckpoint,
    requestEvent,
    requestingCheckpoint,
    ingestion,
    artifact,
    submittedEvent,
    artifactCreatedEvent,
    validatedEvent,
    evidenceRef,
    evidenceArtifact,
    evidenceResolution,
    materializedCheckpoint,
    commitEvent,
    committedCheckpoint,
    acceptedBridge,
  };
}

function buildMeasurement(live) {
  const verificationPlan = {
    ...copy(protocolFixtures['operating-action-verification-plan']),
    verificationPlanId: 'vfy_live0001',
    actionId: 'act_live0001',
    metricId: 'met_live0001',
    baseline: 40,
    target: 45,
    window: '2026-08-24T09:00:00Z/2026-08-24T11:00:00Z',
    method: 'Compare the exact activation observation.',
    evaluationRules: ['Activation is at least 45 percent.'],
    revisitDecisionIds: ['dec_live0001'],
    sourceArtifactId: live.artifact.artifactId,
    createdAt: '2026-08-24T09:58:00Z',
  };
  const plan = hashRecord(
    {
      kind: 'operating-measurement-plan',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      measurementPlanId: 'mpln_live0001',
      action: {
        actionId: verificationPlan.actionId,
        revision: 1,
        actionHash: digest('action-live'),
      },
      metric: {
        metricId: verificationPlan.metricId,
        metricHash: digest('metric-live'),
        unit: 'percent',
        dimension: 'activation-rate',
      },
      baseline: {
        value: 40,
        unit: 'percent',
        observedAt: '2026-08-24T09:00:00Z',
        evidenceHashes: [digest('baseline-evidence')],
      },
      target: { operator: 'gte', value: 45, unit: 'percent', direction: 'increase' },
      sources: [
        {
          provider: {
            id: live.registration.providerId,
            version: live.registration.providerVersion,
          },
          queryHash: live.consentRecord.queryHash,
          consentRecordHash: live.consentRecord.consentHash,
        },
      ],
      window: { from: '2026-08-24T09:00:00Z', to: '2026-08-24T11:00:00Z', inclusive: true },
      dueAt: '2026-08-24T12:00:00Z',
      freshnessSeconds: 7200,
      sensitivity: 'internal',
      minimumEvidence: 1,
      terminalResults: ['passed', 'failed', 'insufficient-evidence'],
      verificationPlan: {
        contractId: 'operating-action-verification-plan',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        verificationPlanId: verificationPlan.verificationPlanId,
        recordDigest: digest(verificationPlan),
        canonicalTarget: verificationPlan.target,
        windowDigest: digest(verificationPlan.window),
        methodDigest: digest(verificationPlan.method),
        evaluationRulesDigest: digest(verificationPlan.evaluationRules),
      },
    },
    'planHash',
  );
  const outcome = {
    ...copy(protocolFixtures['operating-outcome']),
    outcomeId: 'out_live0001',
    actionId: verificationPlan.actionId,
    verificationPlanId: verificationPlan.verificationPlanId,
    status: 'succeeded',
    observationIds: ['mob_live0001'],
    evidenceRefIds: [live.evidenceRef.evidenceRefId],
    sourceArtifactId: live.artifact.artifactId,
    observedAt: '2026-08-24T10:03:00Z',
  };
  const observation = (suffix, value, observedAt, freshUntil) => {
    const metricObservation = {
      ...copy(protocolFixtures['operating-metric-observation']),
      observationId: `mob_live000${suffix}`,
      metricId: plan.metric.metricId,
      value,
      unit: plan.metric.unit,
      observedAt,
      evidenceRefIds: [live.evidenceRef.evidenceRefId],
      sourceArtifactId: live.artifact.artifactId,
    };
    const body = {
      kind: 'operating-evidence-observation',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      evidenceObservationId: `eobs_live000${suffix}`,
      measurementPlan: {
        contractId: 'operating-measurement-plan',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        recordId: plan.measurementPlanId,
        recordDigest: plan.planHash,
      },
      metricId: plan.metric.metricId,
      metricObservation: {
        contractId: 'operating-metric-observation',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        recordId: metricObservation.observationId,
        recordDigest: digest(metricObservation),
      },
      provider: { id: live.registration.providerId, version: live.registration.providerVersion },
      providerRegistrationHash: live.registration.registrationHash,
      checkpoint: {
        checkpointId: live.committedCheckpoint.checkpointId,
        checkpointHash: live.committedCheckpoint.checkpointHash,
      },
      ingestion: {
        ingestionId: live.ingestion.ingestionId,
        ingestionHash: live.ingestion.ingestionHash,
      },
      artifact: { artifactId: live.artifact.artifactId, recordDigest: digest(live.artifact) },
      evidenceRefs: [
        { evidenceRefId: live.evidenceRef.evidenceRefId, recordDigest: digest(live.evidenceRef) },
      ],
      value,
      unit: plan.metric.unit,
      dimension: plan.metric.dimension,
      observedAt,
      freshUntil,
      classification: 'internal',
      status: 'observed',
      providerConfidence: 0.9,
      absences: [],
      contradictions: [],
    };
    return { metricObservation, evidenceObservation: hashRecord(body, 'observationHash') };
  };
  return { verificationPlan, plan, outcome, observation };
}

test('provider registration is exact-replay idempotent and same-identity divergent bytes conflict', () => {
  const { registration, baseEvidenceProvider, baseResolver } = providerRegistration();
  const empty = hashRecord(
    {
      kind: 'operate-live-evidence-provider-registry',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      registryVersion: '1.0.0',
      providers: [],
    },
    'registryHash',
  );
  const options = { baseEvidenceProvider, baseResolver };
  const registered = registerLiveEvidenceProviderV2(empty, registration, options);
  assert.deepEqual(registerLiveEvidenceProviderV2(registered, registration, options), registered);
  const { registrationHash, ...changedBody } = {
    ...copy(registration),
    retry: { ...registration.retry, maxAttempts: 3 },
  };
  const changed = { ...changedBody, registrationHash: digest(changedBody) };
  assert.throws(
    () => registerLiveEvidenceProviderV2(registered, changed, options),
    errorCode('LIVE_EVIDENCE_REGISTRY_CONFLICT'),
  );
});

test('accepted ingestion binds exact Assignment, raw/canonical Artifact bytes, Event chain, and connector lineage', () => {
  const live = buildLiveEvidence();
  const accepted = assertAcceptedLiveEvidenceBridgeV2(live.ingestion, live.acceptedBridge);
  assert.equal(accepted.ingestionHash, live.ingestion.ingestionHash);
  assert.notEqual(live.artifact.rawHash, live.artifact.canonicalHash);
  assert.equal(live.artifact.canonicalHash, digest(live.ingestion));
  const substituted = { ...copy(live.artifact), canonicalHash: live.ingestion.ingestionHash };
  assert.throws(
    () =>
      assertAcceptedLiveEvidenceBridgeV2(live.ingestion, {
        ...live.acceptedBridge,
        artifact: substituted,
      }),
    errorCode('LIVE_EVIDENCE_BRIDGE_INVALID'),
  );
  for (const field of ['expectedRawHash', 'expectedCanonicalHash']) {
    const missingHash = copy(live.evidenceRef);
    delete missingHash.locator[field];
    assert.throws(
      () =>
        assertAcceptedLiveEvidenceBridgeV2(live.ingestion, {
          ...live.acceptedBridge,
          evidenceRef: missingHash,
        }),
      errorCode('LIVE_EVIDENCE_BRIDGE_INVALID'),
    );

    const substitutedHash = copy(live.evidenceRef);
    substitutedHash.locator[field] = digest(`substituted-${field}`);
    assert.throws(
      () =>
        assertAcceptedLiveEvidenceBridgeV2(live.ingestion, {
          ...live.acceptedBridge,
          evidenceRef: substitutedHash,
        }),
      errorCode('LIVE_EVIDENCE_BRIDGE_INVALID'),
    );
  }
});

test('connector and one-time schedule reducers replay exactly, reject divergence, and issue one due run', () => {
  const live = buildLiveEvidence();
  assert.deepEqual(
    reduceOperatingConnectorCheckpointV2(live.requestingCheckpoint, live.requestEvent),
    live.requestingCheckpoint,
  );
  const divergentConnector = { ...copy(live.requestEvent), at: '2026-08-24T10:00:02Z' };
  const { eventHash: ignoredEventHash, ...divergentConnectorBody } = divergentConnector;
  divergentConnector.eventHash = digest(divergentConnectorBody);
  assert.throws(
    () => reduceOperatingConnectorCheckpointV2(live.requestingCheckpoint, divergentConnector),
    errorCode('LIVE_EVIDENCE_REPLAY_CONFLICT'),
  );

  const initial = hashRecord(
    {
      kind: 'operating-measurement-schedule',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      scheduleId: 'msch_live0001',
      generation: 0,
      measurementPlanId: 'mpln_live0001',
      planHash: digest('measurement-plan'),
      ownerActorId: 'owner.reference',
      consentRecordHashes: [live.consentRecord.consentHash],
      ceilingsHash: digest(live.consentRecord.ceilings),
      recurrence: { kind: 'once', intervalSeconds: null, timeZone: 'Europe/Istanbul' },
      startsAt: '2026-08-24T10:10:00Z',
      endsAt: '2026-08-24T11:00:00Z',
      maxRuns: 1,
      misfirePolicy: 'run-once',
      dstPolicy: 'elapsed-time',
      state: 'disabled',
      runCount: 0,
      nextEventIdentity: null,
      nextDueAt: null,
      lastReceiptId: null,
      lastTransitionHash: null,
    },
    'scheduleHash',
  );
  const transition = (current, values) => ({
    receiptId: values.receiptId,
    type: values.type,
    expectedGeneration: current.generation,
    expectedScheduleHash: current.scheduleHash,
    expectedState: current.state,
    expectedRunCount: current.runCount,
    expectedNextEventIdentity: current.nextEventIdentity,
    expectedNextDueAt: current.nextDueAt,
    planHash: current.planHash,
    consentRecordHashes: copy(current.consentRecordHashes),
    ceilingsHash: current.ceilingsHash,
    clockHash: digest(values.clock),
    eventId: values.eventId,
    nextEventIdentity: values.nextEventIdentity,
    nextDueAt: values.nextDueAt,
    at: values.at,
  });
  const enable = transition(initial, {
    receiptId: 'msrc_enable001',
    type: 'enable',
    clock: 'clock-enable',
    eventId: 'mevt_enable001',
    nextEventIdentity: 'mevt_due00001',
    nextDueAt: initial.startsAt,
    at: '2026-08-24T10:00:00Z',
  });
  const enabled = reduceOperatingMeasurementScheduleV2(initial, enable);
  assert.equal(enabled.schedule.state, 'enabled');
  const run = transition(enabled.schedule, {
    receiptId: 'msrc_run00001',
    type: 'run-issued',
    clock: 'clock-run',
    eventId: enabled.schedule.nextEventIdentity,
    nextEventIdentity: null,
    nextDueAt: null,
    at: enabled.schedule.nextDueAt,
  });
  const completed = reduceOperatingMeasurementScheduleV2(enabled.schedule, run);
  assert.equal(completed.schedule.state, 'completed');
  assert.equal(completed.schedule.runCount, 1);
  assert.equal(
    reduceOperatingMeasurementScheduleV2(completed.schedule, run, {
      priorReceipt: completed.receipt,
    }).replay,
    true,
  );
  assert.throws(
    () =>
      reduceOperatingMeasurementScheduleV2(completed.schedule, {
        ...run,
        clockHash: digest('changed-clock'),
      }),
    errorCode('LIVE_EVIDENCE_REPLAY_CONFLICT'),
  );
  const secondRun = {
    ...run,
    receiptId: 'msrc_run00002',
    expectedGeneration: completed.schedule.generation,
    expectedScheduleHash: completed.schedule.scheduleHash,
    expectedState: completed.schedule.state,
    expectedRunCount: completed.schedule.runCount,
    expectedNextEventIdentity: null,
    expectedNextDueAt: null,
  };
  assert.throws(
    () => reduceOperatingMeasurementScheduleV2(completed.schedule, secondRun),
    errorCode('LIVE_EVIDENCE_TRANSITION_INVALID'),
  );
});

test('canonical observations deterministically evaluate and reevaluate without mutating their predecessor', () => {
  const live = buildLiveEvidence();
  const measurement = buildMeasurement(live);
  const first = measurement.observation('1', 46, '2026-08-24T10:03:00Z', '2026-08-24T12:00:00Z');
  const custody = (entry) => ({
    evidenceObservationId: entry.evidenceObservation.evidenceObservationId,
    ingestion: live.ingestion,
    connectorCheckpoint: live.committedCheckpoint,
    artifact: live.artifact,
    evidenceRefs: [live.evidenceRef],
    acceptedBridge: live.acceptedBridge,
  });
  const initial = evaluateOperatingOutcomeV2({
    plan: measurement.plan,
    observations: [first.evidenceObservation],
    metricObservations: [first.metricObservation],
    observationCustody: [custody(first)],
    evaluationId: 'oevl_live0001',
    outcome: measurement.outcome,
    verificationPlan: measurement.verificationPlan,
    evaluatedAt: '2026-08-24T10:05:00Z',
  });
  assert.equal(initial.result, 'passed');
  const bypassCustody = custody(first);
  delete bypassCustody.acceptedBridge;
  assert.throws(
    () =>
      evaluateOperatingOutcomeV2({
        plan: measurement.plan,
        observations: [first.evidenceObservation],
        metricObservations: [first.metricObservation],
        observationCustody: [bypassCustody],
        evaluationId: 'oevl_bypass001',
        outcome: measurement.outcome,
        verificationPlan: measurement.verificationPlan,
        evaluatedAt: '2026-08-24T10:05:00Z',
      }),
    errorCode('LIVE_EVIDENCE_BASE_RECORD_REQUIRED'),
  );
  const frozenInitial = copy(initial);
  const second = measurement.observation('2', 47, '2026-08-24T10:06:00Z', '2026-08-24T12:00:00Z');
  const reevaluation = evaluateOperatingOutcomeV2({
    plan: measurement.plan,
    observations: [second.evidenceObservation],
    metricObservations: [second.metricObservation],
    observationCustody: [custody(second)],
    evaluationId: 'oevl_live0002',
    outcome: measurement.outcome,
    verificationPlan: measurement.verificationPlan,
    evaluatedAt: '2026-08-24T10:07:00Z',
    previousEvaluation: initial,
  });
  assert.equal(reevaluation.previousEvaluationHash, initial.evaluationHash);
  assert.notEqual(reevaluation.exactInputDigest, initial.exactInputDigest);
  assert.deepEqual(initial, frozenInitial);
  assertOperatingOutcomeEvaluationV2(reevaluation, {
    measurementPlan: measurement.plan,
    verificationPlan: measurement.verificationPlan,
    outcome: measurement.outcome,
    evidenceObservations: [second.evidenceObservation],
    metricObservations: [second.metricObservation],
    observationCustody: [custody(second)],
    previousEvaluation: initial,
  });
});
