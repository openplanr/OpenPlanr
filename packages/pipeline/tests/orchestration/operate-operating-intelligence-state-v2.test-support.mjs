import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  createEmptyOperatingRuntimeStateV2,
  createOperatingArtifactByteStoreV2,
  materializeOperatingStateSnapshotV2,
} from '../../lib/operate/runtime-foundation.mjs';

const TIME = '2026-08-09T12:00:00.000Z';
const valid = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/all-contracts-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const clone = (value) => structuredClone(value);
const rawHash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export function checkpoint() {
  const sourceBytes = Buffer.from('opaque fact source; never enters events', 'utf8');
  const evidenceBytes = Buffer.from('opaque typed evidence; never enters events', 'utf8');
  const sourceArtifactId = 'art_intelligence_source_001';
  const evidenceArtifactId = 'art_intelligence_evidence_001';
  const assignmentId = 'asg_intelligence_source_001';
  const sourceArtifact = {
    ...clone(valid['operating-artifact']),
    artifactId: sourceArtifactId,
    assignmentId,
    rawHash: rawHash(sourceBytes),
    canonicalHash: null,
    sizeBytes: sourceBytes.byteLength,
    inputArtifactIds: [],
    createdAt: TIME,
    producer: {
      ...clone(valid['operating-artifact'].producer),
      roleId: valid['operating-assignment'].roleId,
    },
  };
  const assignment = {
    ...clone(valid['operating-assignment']),
    assignmentId,
    state: 'validated',
    availableAt: TIME,
    completedAt: TIME,
    inputArtifactIds: [],
    claim: {
      actorId: 'agent-001',
      actorKind: 'agent',
      runtime: 'codex',
      claimId: 'claim_intelligence_source_001',
    },
    attemptPolicy: { ...valid['operating-assignment'].attemptPolicy, attempt: 1 },
  };
  const submission = {
    ...clone(valid['operating-submission']),
    submissionId: 'sub_intelligence_source_001',
    assignmentId,
    artifactId: sourceArtifactId,
    rawHash: sourceArtifact.rawHash,
    canonicalHash: null,
    sizeBytes: sourceBytes.byteLength,
    acceptanceEventIds: ['evt_intelligence_source_accepted_001'],
    responseData: {
      accepted: true,
      artifactId: sourceArtifactId,
      rawHash: sourceArtifact.rawHash,
      sizeBytes: sourceBytes.byteLength,
      assignmentState: 'validated',
    },
  };
  const submissionReplay = {
    submissionId: submission.submissionId,
    assignmentId: submission.assignmentId,
    rawHash: submission.rawHash,
    canonicalHash: submission.canonicalHash,
    sizeBytes: submission.sizeBytes,
    artifactId: submission.artifactId,
    acceptanceEventIds: [...submission.acceptanceEventIds],
    responseData: clone(submission.responseData),
  };
  const evidenceArtifact = {
    ...clone(sourceArtifact),
    artifactId: evidenceArtifactId,
    artifactType: 'evidence-snapshot',
    schemaId: 'operating-evidence-snapshot',
    artifactSchemaVersion: '1.0.0',
    mediaType: 'application/octet-stream',
    encoding: 'binary',
    rawHash: rawHash(evidenceBytes),
    sizeBytes: evidenceBytes.byteLength,
    inputArtifactIds: [sourceArtifactId],
    createdAt: TIME,
  };
  const evidenceRef = {
    ...clone(valid['operating-evidence-ref']),
    evidenceRefId: 'evr_intelligence_001',
    candidateId: 'evc_intelligence_001',
    sourceArtifactId,
    evidenceArtifactId,
    evidenceArtifactRawHash: evidenceArtifact.rawHash,
    evidenceArtifactCanonicalHash: null,
    sourceContract: { id: 'demand-market', version: '1.0.0' },
    resolvedAt: TIME,
  };
  const metric = {
    ...clone(valid['operating-metric']),
    metricId: 'met_intelligence_001',
    sourceArtifactId,
    observationIds: [],
    evidenceRefIds: [evidenceRef.evidenceRefId],
    createdAt: TIME,
    updatedAt: TIME,
  };
  const assumption = {
    ...clone(valid['operating-assumption']),
    assumptionId: 'asm_intelligence_001',
    sourceArtifactId,
    affectedDecisionIds: ['dec_intelligence_001'],
    affectedActionIds: [],
    evidenceRefIds: [evidenceRef.evidenceRefId],
    createdAt: TIME,
    updatedAt: TIME,
    closedAt: null,
    revisionId: 'asm_intelligence_001',
    revision: 1,
    predecessorRevisionId: null,
  };
  const decision = {
    ...clone(valid['operating-decision']),
    decisionId: 'dec_intelligence_001',
    sourceArtifactId,
    origin: 'persistent-work',
    sourceCycleId: valid['operating-cycle'].cycleId,
    evidenceRefIds: [evidenceRef.evidenceRefId],
    assumptionIds: [assumption.assumptionId],
    createdAt: TIME,
    updatedAt: TIME,
  };
  for (const field of [
    'sourceAssignmentId',
    'sourceLocalDecisionId',
    'sourceClaimRefs',
    'claimIds',
    'sourceRecommendationRefs',
    'challengerFindingIds',
    'findingIds',
    'alternativeDispositions',
    'uncertainty',
    'reversibility',
    'dissentIds',
  ])
    delete decision[field];
  const store = createOperatingArtifactByteStoreV2();
  store.stageRaw({ artifact: sourceArtifact, rawBytes: sourceBytes });
  store.stageRaw({ artifact: evidenceArtifact, rawBytes: evidenceBytes });
  const initialState = {
    ...createEmptyOperatingRuntimeStateV2(TIME),
    cycles: [{ ...clone(valid['operating-cycle']), state: 'advising', updatedAt: TIME }],
    inputBindings: [
      { ...clone(valid['operating-cycle-input-binding']), sourceArtifactIds: [], capturedAt: TIME },
    ],
    assignments: [assignment],
    submissions: [submission],
    artifacts: [sourceArtifact, evidenceArtifact],
    evidenceRefs: [evidenceRef],
    submissionReplayIndex: [submissionReplay],
  };
  const result = materializeOperatingStateSnapshotV2(
    {
      cycleId: initialState.cycles[0].cycleId,
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
      sourceArtifactIds: [sourceArtifactId],
      evidenceRefIds: [evidenceRef.evidenceRefId],
      sourceRevisions: [
        { sourceArtifactId, revision: 'r1', evidenceRefIds: [evidenceRef.evidenceRefId] },
      ],
      collections: {
        objectives: [],
        metrics: [metric],
        findings: [],
        decisions: [decision],
        actions: [],
        risks: [],
        assumptions: [assumption],
      },
    },
    {
      snapshotId: 'snp_intelligence_001',
      stateId: 'oms_intelligence_001',
      timestamp: TIME,
      correlationId: 'corr_intelligence_snapshot_001',
      eventIds: { snapshot: 'evt_intelligence_snapshot_001', state: 'evt_intelligence_state_001' },
    },
    { initialState, artifactStore: store },
  );
  return {
    initialState,
    result,
    store,
    sourceArtifactId,
    evidenceRef,
    metric,
    assumption,
    decision,
  };
}
