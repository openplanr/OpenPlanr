import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { OPEN_REFERENCE_EVIDENCE_REGISTRY_V2 } from '../../lib/operate/evidence-v2.mjs';
import {
  createEmptyOperatingRuntimeStateV2,
  createNoModelReplayHookV2,
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
  return {
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
}

function stateFor(seed) {
  const source = {
    ...structuredClone(valid['operating-artifact']),
    artifactId: `art_source_${seed}`,
    inputArtifactIds: [],
    createdAt: TIME,
  };
  const targetBytes = Buffer.from(`target evidence ${seed}\n`);
  const target = {
    ...structuredClone(valid['operating-artifact']),
    artifactId: `art_target_${seed}`,
    assignmentId: `asg_target_${seed}`,
    inputArtifactIds: [],
    createdAt: TIME,
    rawHash: rawHash(targetBytes),
    canonicalHash: null,
    sizeBytes: targetBytes.byteLength,
  };
  const suffix = String(seed).padStart(3, '0');
  const candidate = {
    kind: 'operating-evidence-candidate',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    candidateId: `evc_property_${suffix}`,
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
      localClaimId: `local-claim-${suffix}`,
      relation: seed % 2 ? 'supportedBy' : 'contradictedBy',
      confidence: (seed % 10) / 10,
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
    submissionId: `sub_source_${seed}`,
    artifactId: source.artifactId,
    rawHash: source.rawHash,
    canonicalHash: source.canonicalHash,
    sizeBytes: source.sizeBytes,
    acceptanceEventIds: [`evt-source-${seed}`],
  };
  const targetSubmission = {
    ...submission,
    submissionId: `sub_target_${seed}`,
    assignmentId: target.assignmentId,
    artifactId: target.artifactId,
    rawHash: target.rawHash,
    canonicalHash: target.canonicalHash,
    sizeBytes: target.sizeBytes,
    acceptanceEventIds: [`evt-target-${seed}`],
  };
  const sourceProof = bindAcceptedSubmissionProof(submission, source);
  const targetProof = bindAcceptedSubmissionProof(targetSubmission, target);
  const artifactStore = createOperatingArtifactByteStoreV2();
  artifactStore.stageRaw({ artifact: source, rawBytes: sourceBytes });
  artifactStore.stageRaw({ artifact: target, rawBytes: targetBytes });
  return {
    source,
    target,
    candidate,
    claimLinks,
    artifactStore,
    state: {
      ...createEmptyOperatingRuntimeStateV2(TIME),
      cycles: [structuredClone(valid['operating-cycle'])],
      inputBindings: [
        { ...structuredClone(valid['operating-cycle-input-binding']), sourceArtifactIds: [] },
      ],
      assignments: [validatedAssignment(source), validatedAssignment(target)],
      submissions: [sourceProof.submission, targetProof.submission],
      artifacts: [source, target],
      submissionReplayIndex: [sourceProof.replay, targetProof.replay],
    },
  };
}

test('256 deterministic materialization/replay walks preserve one immutable outcome and never dispatch a model', () => {
  for (let seed = 1; seed <= 256; seed += 1) {
    const { state, candidate, claimLinks, artifactStore } = stateFor(seed);
    const suffix = String(seed).padStart(3, '0');
    const draft = {
      resolutionId: `evs_property_${suffix}`,
      eventId: `evt-evidence-property-${suffix}`,
      timestamp: TIME,
      correlationId: `corr-evidence-property-${suffix}`,
      evidenceRefId: `evr_property_${suffix}`,
      evidenceArtifactId: `art_evidence_${suffix}`,
    };
    const request = { candidate, claimLinks };
    const firstHook = createNoModelReplayHookV2();
    const first = materializeOperatingEvidenceV2(request, draft, {
      initialState: state,
      registry: OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
      artifactStore,
      resolverContext: { capabilities: ['evidence.operate-artifact.read'] },
      replayHook: firstHook,
    });
    const replayHook = createNoModelReplayHookV2();
    const replay = materializeOperatingEvidenceV2(
      structuredClone(request),
      structuredClone(draft),
      {
        initialState: first.state,
        registry: OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
        artifactStore,
        resolverContext: { capabilities: ['evidence.operate-artifact.read'] },
        replayHook,
      },
    );
    assert.equal(firstHook.dispatchCount, 0, `seed ${seed}`);
    assert.equal(replayHook.dispatchCount, 0, `seed ${seed}`);
    assert.equal(replay.replayed, true, `seed ${seed}`);
    assert.deepEqual(replay.events, [], `seed ${seed}`);
    assert.equal(sha256Jcs(replay.state), sha256Jcs(first.state), `seed ${seed}`);
  }
});
