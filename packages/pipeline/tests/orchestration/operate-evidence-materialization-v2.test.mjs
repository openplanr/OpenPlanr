import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  buildOperatingEvidenceGraphV2,
  createOperatingArtifactByteStoreV2,
  createEmptyOperatingRuntimeStateV2,
  createNoModelReplayHookV2,
  materializeOperatingEvidenceV2,
  readOperatingArtifactRawBytesV2,
  reduceOperatingRuntimeEventsV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { OPEN_REFERENCE_EVIDENCE_REGISTRY_V2 } from '../../lib/operate/evidence-v2.mjs';

const TIME = '2026-08-09T10:00:00.000Z';
const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
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

function validatedAssignment(value, artifact) {
  return {
    ...clone(value),
    assignmentId: artifact.assignmentId,
    inputArtifactIds: [...artifact.inputArtifactIds],
    outputContract: {
      ...clone(value.outputContract),
      schemaId: artifact.schemaId,
      schemaVersion: artifact.artifactSchemaVersion,
      mediaType: artifact.mediaType,
      encoding: artifact.encoding,
      maxBytes: Math.max(value.outputContract.maxBytes, artifact.sizeBytes),
    },
    state: 'validated',
    availableAt: TIME,
    completedAt: TIME,
    claim: {
      actorId: 'agent-001',
      actorKind: 'agent',
      runtime: 'codex',
      claimId: `claim-${artifact.assignmentId}`,
    },
    attemptPolicy: { ...value.attemptPolicy, attempt: 1 },
  };
}

function sourceState({
  candidateId = 'evc_materialize_001',
  links = [{ localClaimId: 'local-claim-revenue-001', relation: 'supportedBy', confidence: 0.8 }],
  candidateFactory = null,
  targetArtifactOverrides = {},
} = {}) {
  const valid = fixture('all-contracts-valid.json');
  const sourceArtifact = {
    ...clone(valid['operating-artifact']),
    artifactId: 'art_source_001',
    inputArtifactIds: [],
    createdAt: TIME,
  };
  const targetBytes = Buffer.from('target evidence bytes\n');
  const targetArtifact = {
    ...clone(valid['operating-artifact']),
    artifactId: 'art_target_001',
    assignmentId: 'asg_target_001',
    inputArtifactIds: [],
    createdAt: TIME,
    artifactType: 'chair-result',
    schemaId: 'operating-decision-ledger',
    artifactSchemaVersion: '2.0.0',
    rawHash: rawHash(targetBytes),
    canonicalHash: null,
    sizeBytes: targetBytes.byteLength,
    ...targetArtifactOverrides,
  };
  const sourceCandidate =
    candidateFactory === null
      ? candidate(sourceArtifact, targetArtifact, { candidateId })
      : candidateFactory({ sourceArtifact, targetArtifact, candidateId });
  const claimLinks = links.map(({ localClaimId, relation, confidence }) => ({
    sourceArtifactId: sourceArtifact.artifactId,
    localClaimId,
    relation,
    confidence,
  }));
  const sourceBytes = Buffer.from(
    JSON.stringify({
      evidenceCandidates: [sourceCandidate],
      evidenceClaimLinks: claimLinks.map((link) => ({ candidateId, ...link })),
    }),
    'utf8',
  );
  sourceArtifact.rawHash = rawHash(sourceBytes);
  sourceArtifact.canonicalHash = null;
  sourceArtifact.sizeBytes = sourceBytes.byteLength;
  const sourceSubmission = {
    ...clone(valid['operating-submission']),
    submissionId: 'sub_source_001',
    assignmentId: sourceArtifact.assignmentId,
    artifactId: sourceArtifact.artifactId,
    rawHash: sourceArtifact.rawHash,
    canonicalHash: sourceArtifact.canonicalHash,
    acceptanceEventIds: ['evt-source-accepted'],
  };
  const targetSubmission = {
    ...clone(sourceSubmission),
    submissionId: 'sub_target_001',
    assignmentId: targetArtifact.assignmentId,
    artifactId: targetArtifact.artifactId,
    rawHash: targetArtifact.rawHash,
    canonicalHash: targetArtifact.canonicalHash,
    acceptanceEventIds: ['evt-target-accepted'],
  };
  const sourceProof = bindAcceptedSubmissionProof(sourceSubmission, sourceArtifact);
  const targetProof = bindAcceptedSubmissionProof(targetSubmission, targetArtifact);
  const artifactStore = createOperatingArtifactByteStoreV2();
  artifactStore.stageRaw({ artifact: sourceArtifact, rawBytes: sourceBytes });
  artifactStore.stageRaw({ artifact: targetArtifact, rawBytes: targetBytes });
  return {
    state: {
      ...createEmptyOperatingRuntimeStateV2(TIME),
      cycles: [{ ...clone(valid['operating-cycle']), updatedAt: TIME }],
      inputBindings: [
        {
          ...clone(valid['operating-cycle-input-binding']),
          sourceArtifactIds: [],
          capturedAt: TIME,
        },
      ],
      assignments: [
        validatedAssignment(valid['operating-assignment'], sourceArtifact),
        validatedAssignment(valid['operating-assignment'], targetArtifact),
      ],
      submissions: [sourceProof.submission, targetProof.submission],
      artifacts: [sourceArtifact, targetArtifact],
      submissionReplayIndex: [sourceProof.replay, targetProof.replay],
    },
    sourceArtifact,
    targetArtifact,
    sourceCandidate,
    claimLinks,
    sourceBytes,
    targetBytes,
    artifactStore,
  };
}

test('OpenPlanr cycle-context evidence receives only the closed context-manifest source contract', () => {
  const seeded = sourceState({
    links: [],
    targetArtifactOverrides: {
      artifactType: 'cycle-context-evidence',
      schemaId: 'operating-context-capture',
      artifactSchemaVersion: '2.0.0',
    },
  });
  const result = materializeOperatingEvidenceV2(
    { candidate: seeded.sourceCandidate },
    draft({
      resolutionId: 'evs_openplanr_context_001',
      eventId: 'evt_openplanr_context_001',
      evidenceRefId: 'evr_openplanr_context_001',
      evidenceArtifactId: 'art_openplanr_context_snapshot_001',
    }),
    options(seeded.state, seeded.artifactStore),
  );
  assert.deepEqual(result.evidenceRef.sourceContract, { id: 'context-manifest', version: '1.0.0' });
  assert.notDeepEqual(result.evidenceRef.sourceContract, {
    id: 'prior-decisions',
    version: '1.0.0',
  });
});

function candidate(sourceArtifact, targetArtifact, overrides = {}) {
  return {
    kind: 'operating-evidence-candidate',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    candidateId: 'evc_materialize_001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    sourceArtifactId: sourceArtifact.artifactId,
    evidenceKind: 'operate-artifact',
    locator: {
      artifactId: targetArtifact.artifactId,
      expectedArtifactType: targetArtifact.artifactType,
      expectedSchemaId: targetArtifact.schemaId,
      expectedSchemaVersion: targetArtifact.artifactSchemaVersion,
      expectedRawHash: targetArtifact.rawHash,
    },
    provider: { id: 'local-operate-artifact-evidence-provider', version: '2.0.0' },
    resolver: { id: 'local-operate-artifact-evidence-resolver', version: '2.0.0' },
    ...overrides,
  };
}

function draft(overrides = {}) {
  return {
    resolutionId: 'evs_materialize_001',
    eventId: 'evt-evidence-001',
    timestamp: TIME,
    correlationId: 'corr-evidence-001',
    evidenceRefId: 'evr_materialize_001',
    evidenceArtifactId: 'art_evidence_001',
    ...overrides,
  };
}

function options(state, artifactStore, overrides = {}) {
  return {
    initialState: state,
    registry: OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
    artifactStore,
    resolverContext: { capabilities: ['evidence.operate-artifact.read'] },
    ...overrides,
  };
}

test('a validated candidate atomically materializes one immutable evidence-snapshot, EvidenceRef, Event, and local proof edge', () => {
  const {
    state,
    sourceArtifact,
    targetArtifact,
    sourceCandidate,
    claimLinks,
    artifactStore,
    targetBytes,
  } = sourceState();
  const before = sha256Jcs(state);
  const replayHook = createNoModelReplayHookV2();
  const result = materializeOperatingEvidenceV2(
    {
      candidate: sourceCandidate,
      claimLinks,
    },
    draft(),
    options(state, artifactStore, { replayHook }),
  );

  assert.equal(sha256Jcs(state), before, 'transaction never mutates its checkpoint input');
  assert.equal(replayHook.dispatchCount, 0, 'materialization invokes no model');
  assert.equal(result.replayed, false);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].type, 'evidence.resolved');
  assert.equal(result.evidenceRef.evidenceArtifactId, result.evidenceArtifact.artifactId);
  assert.equal(result.evidenceArtifact.artifactType, 'evidence-snapshot');
  assert.equal(result.evidenceArtifact.rawHash, targetArtifact.rawHash);
  assert.deepEqual(
    result.evidenceArtifact.inputArtifactIds,
    [sourceArtifact.artifactId, targetArtifact.artifactId].sort(),
  );
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].sourceArtifactId, sourceArtifact.artifactId);
  assert.equal(result.edges[0].relation, 'supportedBy');
  assert.equal(result.state.evidenceRefs.length, 1);
  assert.equal(result.state.evidenceResolutions.length, 1);
  assert.equal(result.state.evidenceEdges.length, 1);
  assert.equal(result.state.evidenceResolutionReplayIndex.length, 1);
  assert.equal(
    result.state.findings.length,
    0,
    'a proof link does not create persistent operating work',
  );
  assert.equal(result.state.decisions.length, 0);
  assert.equal(result.state.actions.length, 0);
  assert.deepEqual(
    readOperatingArtifactRawBytesV2(artifactStore, {
      artifactId: result.evidenceArtifact.artifactId,
      rawHash: result.evidenceArtifact.rawHash,
    }),
    targetBytes,
    'snapshot bytes are staged under the runtime-owned Artifact identity',
  );

  const rebuilt = reduceOperatingRuntimeEventsV2(result.events, { initialState: state });
  assert.equal(sha256Jcs(rebuilt), sha256Jcs(result.state), 'the transaction is event-rebuildable');
});

test('identical evidence resolution replays without effects; divergent candidate, identity, resolver output, or link input fails before mutation', () => {
  const { state, sourceArtifact, targetArtifact, sourceCandidate, artifactStore } = sourceState({
    links: [{ localClaimId: 'local-claim-001', relation: 'contradictedBy', confidence: 0.4 }],
  });
  const request = {
    candidate: sourceCandidate,
    claimLinks: [
      {
        sourceArtifactId: sourceArtifact.artifactId,
        localClaimId: 'local-claim-001',
        relation: 'contradictedBy',
        confidence: 0.4,
      },
    ],
  };
  const first = materializeOperatingEvidenceV2(request, draft(), options(state, artifactStore));
  const replayHook = createNoModelReplayHookV2();
  const replay = materializeOperatingEvidenceV2(
    clone(request),
    clone(draft()),
    options(first.state, artifactStore, { replayHook }),
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.events, []);
  assert.equal(replayHook.dispatchCount, 0);
  assert.equal(sha256Jcs(replay.state), sha256Jcs(first.state));

  const before = sha256Jcs(first.state);
  assert.throws(
    () =>
      materializeOperatingEvidenceV2(
        {
          ...request,
          candidate: {
            ...request.candidate,
            locator: { ...request.candidate.locator, expectedRawHash: `sha256:${'f'.repeat(64)}` },
          },
        },
        draft(),
        options(first.state, artifactStore),
      ),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  assert.throws(
    () =>
      materializeOperatingEvidenceV2(
        request,
        draft({ eventId: 'evt-evidence-different' }),
        options(first.state, artifactStore),
      ),
    {
      code: 'STATE_TRANSITION_INVALID',
    },
  );
  assert.throws(
    () =>
      materializeOperatingEvidenceV2(
        {
          ...request,
          claimLinks: [{ ...request.claimLinks[0], confidence: 0.9 }],
        },
        draft(),
        options(first.state, artifactStore),
      ),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  assert.equal(sha256Jcs(first.state), before, 'every conflict is effect-free');
});

test('registered resolver rejection is durably auditable but creates no EvidenceRef, snapshot Artifact, or graph edge', () => {
  const { state, sourceCandidate, artifactStore } = sourceState({ links: [] });
  const result = materializeOperatingEvidenceV2(
    {
      candidate: sourceCandidate,
    },
    draft({
      resolutionId: 'evs_rejected_001',
      eventId: 'evt-evidence-rejected-001',
      evidenceRefId: undefined,
      evidenceArtifactId: undefined,
    }),
    options(state, artifactStore, { resolverContext: { capabilities: [] } }),
  );

  assert.equal(result.replayed, false);
  assert.equal(result.events[0].type, 'evidence.rejected');
  assert.equal(result.resolution.outcome, 'rejected');
  assert.equal(result.resolution.error.code, 'CAPABILITY_DENIED');
  assert.equal(result.evidenceRef, null);
  assert.equal(result.evidenceArtifact, null);
  assert.deepEqual(result.edges, []);
  assert.deepEqual(result.state.evidenceRefs, []);
  assert.deepEqual(result.state.evidenceEdges, []);
  assert.equal(result.state.evidenceResolutions.length, 1);
});

test('foreign, duplicate, untyped, or unresolved claim links fail without making a hidden Claim or operating-state mutation', () => {
  const { state, sourceArtifact, sourceCandidate, artifactStore } = sourceState({ links: [] });
  const request = { candidate: sourceCandidate };
  const before = sha256Jcs(state);
  for (const claimLinks of [
    [
      {
        sourceArtifactId: 'art_foreign_001',
        localClaimId: 'local-claim-001',
        relation: 'supportedBy',
        confidence: 0.5,
      },
    ],
    [
      {
        sourceArtifactId: sourceArtifact.artifactId,
        localClaimId: 'local-claim-001',
        relation: 'derivedFrom',
        confidence: 0.5,
      },
    ],
    [
      {
        sourceArtifactId: sourceArtifact.artifactId,
        localClaimId: 'local-claim-001',
        relation: 'supportedBy',
        confidence: 0.5,
      },
      {
        sourceArtifactId: sourceArtifact.artifactId,
        localClaimId: 'local-claim-001',
        relation: 'supportedBy',
        confidence: 0.5,
      },
    ],
  ]) {
    assert.throws(
      () =>
        materializeOperatingEvidenceV2(
          { ...request, claimLinks },
          draft(),
          options(state, artifactStore),
        ),
      {
        code: /RESULT_CONTRACT_INVALID|STATE_TRANSITION_INVALID/,
      },
    );
  }
  assert.equal(sha256Jcs(state), before);
});

test('an exact filesystem retry replays before resolver reads, and the staged snapshot stays retrievable after source mutation', () => {
  const parent = mkdtempSync(join(tmpdir(), 'operate-evidence-replay-'));
  const root = join(parent, 'root');
  const relativePath = 'signals/current.txt';
  const initialBytes = Buffer.from('captured before mutation\n');
  mkdirSync(join(root, 'signals'), { recursive: true });
  writeFileSync(join(root, relativePath), initialBytes);
  try {
    const seeded = sourceState({
      links: [],
      candidateFactory: ({ sourceArtifact, candidateId }) => ({
        kind: 'operating-evidence-candidate',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        candidateId,
        scopeId: sourceArtifact.scopeId,
        domainId: sourceArtifact.domainId,
        domainVersion: sourceArtifact.domainVersion,
        sourceArtifactId: sourceArtifact.artifactId,
        evidenceKind: 'filesystem',
        locator: { sourceRootId: 'workspace', path: relativePath },
        provider: { id: 'local-filesystem-evidence-provider', version: '2.0.0' },
        resolver: { id: 'local-filesystem-evidence-resolver', version: '2.0.0' },
      }),
    });
    const resolverContext = {
      capabilities: ['evidence.filesystem.read'],
      filesystemRoots: [
        {
          sourceRootId: 'workspace',
          rootPath: root,
          scope: {
            scopeId: seeded.sourceArtifact.scopeId,
            domainId: seeded.sourceArtifact.domainId,
            domainVersion: seeded.sourceArtifact.domainVersion,
          },
          sourceContract: { id: 'context-manifest', version: '1.0.0' },
        },
      ],
    };
    const request = { candidate: seeded.sourceCandidate, claimLinks: seeded.claimLinks };
    const first = materializeOperatingEvidenceV2(
      request,
      draft({
        resolutionId: 'evs_filesystem_replay_001',
        eventId: 'evt-filesystem-replay-001',
        evidenceRefId: 'evr_filesystem_replay_001',
        evidenceArtifactId: 'art_filesystem_replay_001',
      }),
      {
        initialState: seeded.state,
        registry: OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
        artifactStore: seeded.artifactStore,
        resolverContext,
      },
    );
    writeFileSync(join(root, relativePath), 'changed after resolution\n');
    const replay = materializeOperatingEvidenceV2(
      clone(request),
      draft({
        resolutionId: 'evs_filesystem_replay_001',
        eventId: 'evt-filesystem-replay-001',
        evidenceRefId: 'evr_filesystem_replay_001',
        evidenceArtifactId: 'art_filesystem_replay_001',
      }),
      {
        initialState: first.state,
        registry: OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
        artifactStore: seeded.artifactStore,
        resolverContext,
      },
    );
    assert.equal(
      replay.replayed,
      true,
      'changed resolver input cannot reopen an exact durable request',
    );
    assert.deepEqual(replay.events, []);
    assert.deepEqual(
      readOperatingArtifactRawBytesV2(seeded.artifactStore, {
        artifactId: first.evidenceArtifact.artifactId,
        rawHash: first.evidenceArtifact.rawHash,
      }),
      initialBytes,
      'the snapshot is retrievable by its own immutable identity and hash',
    );
    assert.doesNotMatch(
      JSON.stringify(first.events),
      /captured before mutation/,
      'Event payloads contain no raw evidence bytes',
    );
    assert.doesNotMatch(
      JSON.stringify(first.state),
      /captured before mutation/,
      'projection state contains no raw evidence bytes',
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('an unregistered resolver-captured source contract is rejected before Artifact or Event state', () => {
  const parent = mkdtempSync(join(tmpdir(), 'operate-evidence-source-contract-'));
  const root = join(parent, 'root');
  const relativePath = 'signals/finance.json';
  mkdirSync(join(root, 'signals'), { recursive: true });
  writeFileSync(join(root, relativePath), '{"revenue":100}\n');
  try {
    const seeded = sourceState({
      links: [],
      candidateFactory: ({ sourceArtifact, candidateId }) => ({
        kind: 'operating-evidence-candidate',
        schemaVersion: '1.0.0',
        protocolVersion: '2.0.0',
        candidateId,
        scopeId: sourceArtifact.scopeId,
        domainId: sourceArtifact.domainId,
        domainVersion: sourceArtifact.domainVersion,
        sourceArtifactId: sourceArtifact.artifactId,
        evidenceKind: 'filesystem',
        locator: { sourceRootId: 'workspace', path: relativePath },
        provider: { id: 'local-filesystem-evidence-provider', version: '2.0.0' },
        resolver: { id: 'local-filesystem-evidence-resolver', version: '2.0.0' },
      }),
    });
    const before = sha256Jcs(seeded.state);
    assert.throws(
      () =>
        materializeOperatingEvidenceV2(
          { candidate: seeded.sourceCandidate },
          draft({
            resolutionId: 'evs_source_contract_spoof_001',
            eventId: 'evt-source-contract-spoof-001',
            evidenceRefId: 'evr_source_contract_spoof_001',
            evidenceArtifactId: 'art_source_contract_spoof_001',
          }),
          {
            initialState: seeded.state,
            registry: OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
            artifactStore: seeded.artifactStore,
            resolverContext: {
              capabilities: ['evidence.filesystem.read'],
              filesystemRoots: [
                {
                  sourceRootId: 'workspace',
                  rootPath: root,
                  sourceContract: { id: 'unregistered-finance', version: '1.0.0' },
                  scope: {
                    scopeId: seeded.sourceArtifact.scopeId,
                    domainId: seeded.sourceArtifact.domainId,
                    domainVersion: seeded.sourceArtifact.domainVersion,
                  },
                },
              ],
            },
          },
        ),
      (error) =>
        error.code === 'RESULT_CONTRACT_INVALID' && error.message.includes('source contract'),
    );
    assert.equal(sha256Jcs(seeded.state), before);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('candidate and proof-link assertions must exactly match the accepted source Artifact body and source bytes must be present and intact', () => {
  const seeded = sourceState();
  const request = { candidate: seeded.sourceCandidate, claimLinks: seeded.claimLinks };
  const sourceHash = sha256Jcs(seeded.state);
  assert.throws(
    () =>
      materializeOperatingEvidenceV2(
        request,
        draft({ resolutionId: 'evs_absent_001', eventId: 'evt-absent-001' }),
        {
          initialState: seeded.state,
          registry: OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
          artifactStore: createOperatingArtifactByteStoreV2(),
          resolverContext: { capabilities: ['evidence.operate-artifact.read'] },
        },
      ),
    { code: 'ARTIFACT_NOT_FOUND' },
  );
  const tamperedStore = {
    stageRaw: seeded.artifactStore.stageRaw,
    readRaw: ({ artifactId, rawHash: expectedHash }) =>
      artifactId === seeded.sourceArtifact.artifactId
        ? Buffer.from('{"evidenceCandidates":[],"evidenceClaimLinks":[]}')
        : seeded.artifactStore.readRaw({ artifactId, rawHash: expectedHash }),
  };
  assert.throws(
    () =>
      materializeOperatingEvidenceV2(
        request,
        draft({ resolutionId: 'evs_tampered_001', eventId: 'evt-tampered-001' }),
        {
          initialState: seeded.state,
          registry: OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
          artifactStore: tamperedStore,
          resolverContext: { capabilities: ['evidence.operate-artifact.read'] },
        },
      ),
    { code: 'ARTIFACT_HASH_MISMATCH' },
  );
  assert.throws(
    () =>
      materializeOperatingEvidenceV2(
        {
          ...request,
          candidate: {
            ...request.candidate,
            locator: { ...request.candidate.locator, expectedRawHash: `sha256:${'f'.repeat(64)}` },
          },
        },
        draft({
          resolutionId: 'evs_candidate_tampered_001',
          eventId: 'evt-candidate-tampered-001',
        }),
        options(seeded.state, seeded.artifactStore),
      ),
    {
      code: 'RESULT_CONTRACT_INVALID',
    },
  );
  assert.throws(
    () =>
      materializeOperatingEvidenceV2(
        {
          ...request,
          claimLinks: [{ ...request.claimLinks[0], confidence: 0.1 }],
        },
        draft({ resolutionId: 'evs_link_tampered_001', eventId: 'evt-link-tampered-001' }),
        options(seeded.state, seeded.artifactStore),
      ),
    {
      code: 'RESULT_CONTRACT_INVALID',
    },
  );
  assert.equal(
    sha256Jcs(seeded.state),
    sourceHash,
    'byte custody and source-payload failures cannot mutate the checkpoint',
  );
});
