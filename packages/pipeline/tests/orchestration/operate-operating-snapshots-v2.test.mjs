import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  createEmptyOperatingRuntimeStateV2,
  createOperatingArtifactByteStoreV2,
  materializeOperatingStateSnapshotV2,
  reduceOperatingRuntimeEventsV2,
} from '../../lib/operate/runtime-foundation.mjs';

const TIME = '2026-08-09T12:00:00.000Z';
const NEXT_TIME = '2026-08-09T12:01:00.000Z';
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
      responseData: clone(accepted.responseData),
    },
  };
}

function acceptedArtifact(seed, timestamp = TIME) {
  const bytes = Buffer.from(`opaque snapshot source ${seed}`, 'utf8');
  const assignmentId = `asg_snapshot_${seed}`;
  const artifact = {
    ...clone(valid['operating-artifact']),
    artifactId: `art_snapshot_${seed}`,
    assignmentId,
    rawHash: rawHash(bytes),
    canonicalHash: null,
    sizeBytes: bytes.byteLength,
    inputArtifactIds: [],
    createdAt: timestamp,
  };
  const assignment = {
    ...clone(valid['operating-assignment']),
    assignmentId,
    state: 'validated',
    availableAt: timestamp,
    completedAt: timestamp,
    inputArtifactIds: [...artifact.inputArtifactIds],
    claim: {
      actorId: 'agent-001',
      actorKind: 'agent',
      runtime: 'codex',
      claimId: `claim_snapshot_${seed}`,
    },
    attemptPolicy: { ...valid['operating-assignment'].attemptPolicy, attempt: 1 },
  };
  const proof = bindAcceptedSubmissionProof(
    {
      ...clone(valid['operating-submission']),
      submissionId: `sub_snapshot_${seed}`,
      assignmentId,
      artifactId: artifact.artifactId,
      rawHash: artifact.rawHash,
      canonicalHash: null,
      sizeBytes: bytes.byteLength,
      acceptanceEventIds: [`evt_snapshot_accept_${seed}`],
    },
    artifact,
  );
  return { assignment, artifact, bytes, submission: proof.submission, replay: proof.replay };
}

function collections(sourceArtifactId, timestamp) {
  const source = (kind) => ({
    ...clone(valid[kind]),
    sourceArtifactId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return {
    objectives: [source('operating-objective')],
    metrics: [source('operating-metric')],
    findings: [],
    decisions: [],
    actions: [],
    risks: [source('operating-risk')],
    assumptions: [source('operating-assumption')],
  };
}

test('snapshots retain only safe IDs/hashes, bind typed EvidenceRefs, and deterministically link to the prior scope snapshot', () => {
  const sourceOne = acceptedArtifact('001');
  const evidenceBytes = Buffer.from(
    'opaque evidence capture that must remain in the byte store',
    'utf8',
  );
  const evidenceArtifact = {
    ...clone(valid['operating-artifact']),
    artifactId: 'art_snapshot_evidence_001',
    assignmentId: sourceOne.assignment.assignmentId,
    artifactType: 'evidence-snapshot',
    schemaId: 'operating-evidence-snapshot',
    artifactSchemaVersion: '1.0.0',
    mediaType: 'application/octet-stream',
    encoding: 'binary',
    rawHash: rawHash(evidenceBytes),
    canonicalHash: null,
    sizeBytes: evidenceBytes.byteLength,
    inputArtifactIds: [sourceOne.artifact.artifactId],
    createdAt: TIME,
  };
  const evidenceRef = {
    ...clone(valid['operating-evidence-ref']),
    evidenceRefId: 'evr_snapshot_001',
    candidateId: 'evc_snapshot_001',
    sourceArtifactId: sourceOne.artifact.artifactId,
    evidenceArtifactId: evidenceArtifact.artifactId,
    evidenceArtifactRawHash: evidenceArtifact.rawHash,
    evidenceArtifactCanonicalHash: null,
    resolvedAt: TIME,
  };
  const store = createOperatingArtifactByteStoreV2();
  store.stageRaw({ artifact: sourceOne.artifact, rawBytes: sourceOne.bytes });
  store.stageRaw({ artifact: evidenceArtifact, rawBytes: evidenceBytes });
  const base = {
    ...createEmptyOperatingRuntimeStateV2(TIME),
    cycles: [{ ...clone(valid['operating-cycle']), state: 'advising', updatedAt: TIME }],
    inputBindings: [
      { ...clone(valid['operating-cycle-input-binding']), sourceArtifactIds: [], capturedAt: TIME },
    ],
    assignments: [sourceOne.assignment],
    submissions: [sourceOne.submission],
    artifacts: [sourceOne.artifact, evidenceArtifact],
    evidenceRefs: [evidenceRef],
    submissionReplayIndex: [sourceOne.replay],
  };
  const first = materializeOperatingStateSnapshotV2(
    {
      cycleId: base.cycles[0].cycleId,
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
      sourceArtifactIds: [sourceOne.artifact.artifactId],
      evidenceRefIds: [evidenceRef.evidenceRefId],
      sourceRevisions: [
        {
          sourceArtifactId: sourceOne.artifact.artifactId,
          revision: 'revision-001',
          evidenceRefIds: [evidenceRef.evidenceRefId],
        },
      ],
      collections: collections(sourceOne.artifact.artifactId, TIME),
    },
    {
      snapshotId: 'snp_snapshot_001',
      stateId: 'oms_snapshot_001',
      timestamp: TIME,
      correlationId: 'corr_snapshot_001',
      eventIds: { snapshot: 'evt_snapshot_001', state: 'evt_state_snapshot_001' },
    },
    { initialState: base, artifactStore: store },
  );
  assert.equal(first.snapshot.previousSnapshotId, null);
  assert.deepEqual(first.snapshot.evidenceRefIds, [evidenceRef.evidenceRefId]);
  assert.doesNotMatch(
    JSON.stringify(first),
    /opaque snapshot source|opaque evidence capture/,
    'state, snapshot, and Events contain no byte payload',
  );

  const sourceTwo = acceptedArtifact('002', NEXT_TIME);
  store.stageRaw({ artifact: sourceTwo.artifact, rawBytes: sourceTwo.bytes });
  const nextBase = {
    ...first.state,
    assignments: [...first.state.assignments, sourceTwo.assignment],
    submissions: [...first.state.submissions, sourceTwo.submission],
    artifacts: [...first.state.artifacts, sourceTwo.artifact],
    submissionReplayIndex: [...first.state.submissionReplayIndex, sourceTwo.replay],
  };
  const undeclaredEvidenceCollections = collections(sourceTwo.artifact.artifactId, NEXT_TIME);
  undeclaredEvidenceCollections.objectives[0].evidenceRefIds = [evidenceRef.evidenceRefId];
  assert.throws(
    () =>
      materializeOperatingStateSnapshotV2(
        {
          cycleId: nextBase.cycles[0].cycleId,
          scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
          domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
          sourceArtifactIds: [sourceTwo.artifact.artifactId],
          sourceRevisions: [
            {
              sourceArtifactId: sourceTwo.artifact.artifactId,
              revision: 'revision-unlisted-evidence',
            },
          ],
          collections: undeclaredEvidenceCollections,
        },
        {
          snapshotId: 'snp_snapshot_unlisted_evidence',
          stateId: 'oms_snapshot_unlisted_evidence',
          timestamp: NEXT_TIME,
          correlationId: 'corr_snapshot_unlisted_evidence',
          eventIds: {
            snapshot: 'evt_snapshot_unlisted_evidence',
            state: 'evt_state_unlisted_evidence',
          },
        },
        { initialState: nextBase, artifactStore: store },
      ),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  const second = materializeOperatingStateSnapshotV2(
    {
      cycleId: nextBase.cycles[0].cycleId,
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
      sourceArtifactIds: [sourceTwo.artifact.artifactId],
      sourceRevisions: [
        { sourceArtifactId: sourceTwo.artifact.artifactId, revision: 'revision-002' },
      ],
      collections: collections(sourceTwo.artifact.artifactId, NEXT_TIME),
    },
    {
      snapshotId: 'snp_snapshot_002',
      stateId: 'oms_snapshot_002',
      timestamp: NEXT_TIME,
      correlationId: 'corr_snapshot_002',
      eventIds: { snapshot: 'evt_snapshot_002', state: 'evt_state_snapshot_002' },
    },
    { initialState: nextBase, artifactStore: store },
  );
  assert.equal(second.snapshot.previousSnapshotId, first.snapshot.snapshotId);
  assert.equal(second.state.operatingSnapshots.length, 2);
  assert.deepEqual(
    reduceOperatingRuntimeEventsV2(second.events, { initialState: nextBase }),
    second.state,
    'the later snapshot rebuilds from the committed Event tail without providers or models',
  );
});
