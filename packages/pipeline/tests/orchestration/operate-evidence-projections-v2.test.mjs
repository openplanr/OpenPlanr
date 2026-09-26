import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { OPEN_REFERENCE_EVIDENCE_REGISTRY_V2 } from '../../lib/operate/evidence-v2.mjs';
import {
  buildOperatingEvidenceGraphV2,
  createEmptyOperatingRuntimeStateV2,
  createOperatingArtifactByteStoreV2,
  materializeOperatingEvidenceV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const TIME = '2026-08-09T10:00:00.000Z';
const valid = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/all-contracts-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const rawHash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function bindAcceptedSubmissionProof(submission, artifact) {
  const accepted = {
    ...submission,
    artifactId: artifact.artifactId,
    rawHash: artifact.rawHash,
    canonicalHash: artifact.canonicalHash,
    sizeBytes: artifact.sizeBytes,
    responseData: {
      accepted: true,
      artifactId: artifact.artifactId,
      rawHash: artifact.rawHash,
      sizeBytes: artifact.sizeBytes,
      assignmentState: 'validated',
    },
  };
  return {
    submission: accepted,
    replay: {
      submissionId: accepted.submissionId,
      assignmentId: accepted.assignmentId,
      rawHash: accepted.rawHash,
      canonicalHash: accepted.canonicalHash,
      sizeBytes: accepted.sizeBytes,
      artifactId: accepted.artifactId,
      acceptanceEventIds: [...accepted.acceptanceEventIds],
      responseData: structuredClone(accepted.responseData),
    },
  };
}

function validatedAssignment(artifact) {
  const assignment = {
    ...structuredClone(valid['operating-assignment']),
    assignmentId: artifact.assignmentId,
    inputArtifactIds: [...artifact.inputArtifactIds],
    state: 'validated',
    availableAt: TIME,
    completedAt: TIME,
    claim: {
      actorId: 'agent-001',
      actorKind: 'agent',
      runtime: 'codex',
      claimId: `claim-${artifact.assignmentId}`,
    },
    attemptPolicy: { ...valid['operating-assignment'].attemptPolicy, attempt: 1 },
  };
  if (artifact.artifactType === 'cycle-context-evidence') {
    assignment.assignmentKind = 'context-capture';
    assignment.roleId = 'operate-context-capture';
    delete assignment.roleVersion;
    assignment.analysisRubric = null;
    assignment.mandate = null;
    assignment.intelligenceContext = null;
    assignment.capabilityGrantId = null;
    assignment.governedOperationId = null;
    assignment.outputContract = {
      schemaId: 'operating-context-capture',
      schemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      maxBytes: 262144,
    };
  }
  return assignment;
}

function resolvedState() {
  const source = {
    ...structuredClone(valid['operating-artifact']),
    artifactId: 'art_projection_source',
    inputArtifactIds: [],
    createdAt: TIME,
  };
  const targetBytes = Buffer.from('{"context":"projection target evidence"}\n');
  const target = {
    ...structuredClone(valid['operating-artifact']),
    artifactId: 'art_projection_target',
    assignmentId: 'asg_projection_target',
    inputArtifactIds: [],
    createdAt: TIME,
    artifactType: 'cycle-context-evidence',
    schemaId: 'operating-context-capture',
    artifactSchemaVersion: '2.0.0',
    producer: { actorId: 'agent-001', roleId: 'operate-context-capture', runtime: 'codex' },
    rawHash: rawHash(targetBytes),
    canonicalHash: null,
    sizeBytes: targetBytes.byteLength,
  };
  const candidate = {
    kind: 'operating-evidence-candidate',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    candidateId: 'evc_projection_001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    sourceArtifactId: source.artifactId,
    evidenceKind: 'operate-artifact',
    locator: {
      artifactId: target.artifactId,
      expectedArtifactType: target.artifactType,
      expectedSchemaId: target.schemaId,
      expectedSchemaVersion: target.artifactSchemaVersion,
      expectedRawHash: target.rawHash,
    },
    provider: { id: 'local-operate-artifact-evidence-provider', version: '2.0.0' },
    resolver: { id: 'local-operate-artifact-evidence-resolver', version: '2.0.0' },
  };
  const claimLinks = [
    {
      sourceArtifactId: source.artifactId,
      localClaimId: 'local-claim-projection',
      relation: 'supportedBy',
      confidence: 0.7,
    },
  ];
  const sourceBytes = Buffer.from(
    JSON.stringify({
      evidenceCandidates: [candidate],
      evidenceClaimLinks: claimLinks.map((link) => ({
        candidateId: candidate.candidateId,
        ...link,
      })),
    }),
    'utf8',
  );
  source.rawHash = rawHash(sourceBytes);
  source.canonicalHash = null;
  source.sizeBytes = sourceBytes.byteLength;
  const submission = {
    ...structuredClone(valid['operating-submission']),
    submissionId: 'sub_projection_source',
    artifactId: source.artifactId,
    rawHash: source.rawHash,
    canonicalHash: source.canonicalHash,
    sizeBytes: source.sizeBytes,
    acceptanceEventIds: ['evt-projection-source'],
  };
  const targetSubmission = {
    ...submission,
    submissionId: 'sub_projection_target',
    assignmentId: target.assignmentId,
    artifactId: target.artifactId,
    rawHash: target.rawHash,
    canonicalHash: target.canonicalHash,
    sizeBytes: target.sizeBytes,
    acceptanceEventIds: ['evt-projection-target'],
  };
  const sourceProof = bindAcceptedSubmissionProof(submission, source);
  const targetProof = bindAcceptedSubmissionProof(targetSubmission, target);
  const state = {
    ...createEmptyOperatingRuntimeStateV2(TIME),
    cycles: [structuredClone(valid['operating-cycle'])],
    inputBindings: [
      { ...structuredClone(valid['operating-cycle-input-binding']), sourceArtifactIds: [] },
    ],
    assignments: [validatedAssignment(source), validatedAssignment(target)],
    submissions: [sourceProof.submission, targetProof.submission],
    artifacts: [source, target],
    submissionReplayIndex: [sourceProof.replay, targetProof.replay],
  };
  const artifactStore = createOperatingArtifactByteStoreV2();
  artifactStore.stageRaw({ artifact: source, rawBytes: sourceBytes });
  artifactStore.stageRaw({ artifact: target, rawBytes: targetBytes });
  return materializeOperatingEvidenceV2(
    {
      candidate,
      claimLinks,
    },
    {
      resolutionId: 'evs_projection_001',
      eventId: 'evt-projection-001',
      timestamp: TIME,
      correlationId: 'corr-projection-001',
      evidenceRefId: 'evr_projection_001',
      evidenceArtifactId: 'art_projection_evidence',
    },
    {
      initialState: state,
      registry: OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
      artifactStore,
      resolverContext: { capabilities: ['evidence.operate-artifact.read'] },
    },
  ).state;
}

test('the evidence graph is a deterministic, frozen scope projection with no Claim or runtime-state mutation path', () => {
  const state = resolvedState();
  const before = sha256Jcs(state);
  const graph = buildOperatingEvidenceGraphV2(
    state,
    {
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
    },
    { generatedAt: '2026-08-09T10:01:00.000Z' },
  );
  assert.equal(graph.evidenceRefs.length, 1);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].relation, 'supportedBy');
  assert.equal(Object.isFrozen(graph), true);
  assert.equal(sha256Jcs(state), before);
  assert.deepEqual(
    buildOperatingEvidenceGraphV2(
      state,
      {
        scopeId: 'scope-acme',
        domainId: 'business',
        domainVersion: '1.0.0',
      },
      { generatedAt: '2026-08-09T10:01:00.000Z' },
    ),
    graph,
  );
});
