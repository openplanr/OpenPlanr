import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  createEmptyOperatingRuntimeStateV2,
  createNoModelReplayHookV2,
  createOperatingArtifactByteStoreV2,
  materializeOperatingStateSnapshotV2,
  reduceOperatingRuntimeEventsV2,
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

function walk(seed) {
  const suffix = String(seed).padStart(3, '0');
  const bytes = Buffer.from(`state property source ${suffix}`, 'utf8');
  const assignmentId = `asg_prop_${suffix}`;
  const artifact = {
    ...clone(valid['operating-artifact']),
    artifactId: `art_prop_${suffix}`,
    assignmentId,
    rawHash: rawHash(bytes),
    canonicalHash: null,
    sizeBytes: bytes.byteLength,
    inputArtifactIds: [],
    createdAt: TIME,
  };
  const assignment = {
    ...clone(valid['operating-assignment']),
    assignmentId,
    state: 'validated',
    availableAt: TIME,
    completedAt: TIME,
    inputArtifactIds: [...artifact.inputArtifactIds],
    claim: {
      actorId: 'agent-001',
      actorKind: 'agent',
      runtime: 'codex',
      claimId: `claim_prop_${suffix}`,
    },
    attemptPolicy: { ...valid['operating-assignment'].attemptPolicy, attempt: 1 },
  };
  const proof = bindAcceptedSubmissionProof(
    {
      ...clone(valid['operating-submission']),
      submissionId: `sub_prop_${suffix}`,
      assignmentId,
      artifactId: artifact.artifactId,
      rawHash: artifact.rawHash,
      canonicalHash: null,
      sizeBytes: bytes.byteLength,
      acceptanceEventIds: [`evt_prop_accept_${suffix}`],
    },
    artifact,
  );
  const base = {
    ...createEmptyOperatingRuntimeStateV2(TIME),
    cycles: [{ ...clone(valid['operating-cycle']), state: 'advising', updatedAt: TIME }],
    inputBindings: [
      { ...clone(valid['operating-cycle-input-binding']), sourceArtifactIds: [], capturedAt: TIME },
    ],
    assignments: [assignment],
    submissions: [proof.submission],
    artifacts: [artifact],
    submissionReplayIndex: [proof.replay],
  };
  const sourceRecord = (kind) => ({
    ...clone(valid[kind]),
    sourceArtifactId: artifact.artifactId,
    createdAt: TIME,
    updatedAt: TIME,
  });
  const request = {
    cycleId: base.cycles[0].cycleId,
    scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
    domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
    sourceArtifactIds: [artifact.artifactId],
    sourceRevisions: [{ sourceArtifactId: artifact.artifactId, revision: `r-${suffix}` }],
    collections: {
      objectives: [sourceRecord('operating-objective')],
      metrics: [sourceRecord('operating-metric')],
      findings: [],
      decisions: [],
      actions: [],
      risks: [sourceRecord('operating-risk')],
      assumptions: [sourceRecord('operating-assumption')],
    },
  };
  const draft = {
    snapshotId: `snp_prop_${suffix}`,
    stateId: `oms_prop_${suffix}`,
    timestamp: TIME,
    correlationId: `corr_prop_${suffix}`,
    eventIds: { snapshot: `evt_snap_prop_${suffix}`, state: `evt_state_prop_${suffix}` },
  };
  const store = createOperatingArtifactByteStoreV2();
  store.stageRaw({ artifact, rawBytes: bytes });
  return { base, draft, request, store };
}

test('64 deterministic snapshot/state materialization and restart/replay walks are effect-free and model-free', () => {
  for (let seed = 1; seed <= 64; seed += 1) {
    const { base, request, draft, store } = walk(seed);
    const before = sha256Jcs(base);
    const firstHook = createNoModelReplayHookV2();
    const first = materializeOperatingStateSnapshotV2(request, draft, {
      initialState: base,
      artifactStore: store,
      replayHook: firstHook,
    });
    const rebuilt = reduceOperatingRuntimeEventsV2(first.events, { initialState: base });
    const replayHook = createNoModelReplayHookV2();
    const replay = materializeOperatingStateSnapshotV2(clone(request), clone(draft), {
      initialState: rebuilt,
      artifactStore: store,
      replayHook,
    });
    assert.equal(firstHook.dispatchCount, 0, `seed ${seed}: commit`);
    assert.equal(replayHook.dispatchCount, 0, `seed ${seed}: replay`);
    assert.equal(sha256Jcs(base), before, `seed ${seed}: input unchanged`);
    assert.equal(sha256Jcs(rebuilt), sha256Jcs(first.state), `seed ${seed}: restart rebuild`);
    assert.equal(replay.replayed, true, `seed ${seed}: duplicate replay`);
    assert.deepEqual(replay.events, [], `seed ${seed}: no duplicate events`);
    assert.equal(
      sha256Jcs(replay.state),
      sha256Jcs(first.state),
      `seed ${seed}: durable state unchanged`,
    );
  }
});
