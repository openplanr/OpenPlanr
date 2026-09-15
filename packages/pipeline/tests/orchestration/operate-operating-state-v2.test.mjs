import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  assertOperatingModelStateV2,
  assertOperatingSnapshotV2,
  createEmptyOperatingRuntimeStateV2,
  createNoModelReplayHookV2,
  createOperatingArtifactByteStoreV2,
  materializeOperatingStateSnapshotV2,
  reduceOperatingRuntimeEventsV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { validateProtocolArtifact } from '../../lib/protocol/contracts.mjs';

const TIME = '2026-08-09T12:00:00.000Z';
const fixture = (name) => JSON.parse(readFileSync(
  new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
  'utf8',
));
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

function acceptedSource(seed = '001') {
  const valid = fixture('all-contracts-valid.json');
  const bytes = Buffer.from(`opaque operating source ${seed}: never enters state or events`, 'utf8');
  const hash = rawHash(bytes);
  const assignmentId = `asg_source_${seed}`;
  const artifact = {
    ...clone(valid['operating-artifact']), artifactId: `art_source_${seed}`, assignmentId,
    rawHash: hash, canonicalHash: null, sizeBytes: bytes.byteLength, inputArtifactIds: [], createdAt: TIME,
  };
  const assignment = {
    ...clone(valid['operating-assignment']), assignmentId, state: 'validated', availableAt: TIME, completedAt: TIME,
    inputArtifactIds: [...artifact.inputArtifactIds],
    claim: { actorId: 'agent-001', actorKind: 'agent', runtime: 'codex', claimId: `claim_source_${seed}` },
    attemptPolicy: { ...valid['operating-assignment'].attemptPolicy, attempt: 1 },
  };
  const proof = bindAcceptedSubmissionProof({
    ...clone(valid['operating-submission']), submissionId: `sub_source_${seed}`, assignmentId,
    artifactId: artifact.artifactId, rawHash: hash, canonicalHash: null, sizeBytes: bytes.byteLength,
    acceptanceEventIds: [`evt_source_accepted_${seed}`],
  }, artifact);
  return { assignment, artifact, bytes, submission: proof.submission, replay: proof.replay };
}

function stateSeed(seed = '001') {
  const valid = fixture('all-contracts-valid.json');
  const source = acceptedSource(seed);
  const store = createOperatingArtifactByteStoreV2();
  store.stageRaw({ artifact: source.artifact, rawBytes: source.bytes });
  const runtimeState = {
    ...createEmptyOperatingRuntimeStateV2(TIME),
    cycles: [{ ...clone(valid['operating-cycle']), state: 'advising', updatedAt: TIME }],
    inputBindings: [{ ...clone(valid['operating-cycle-input-binding']), sourceArtifactIds: [], capturedAt: TIME }],
    assignments: [source.assignment], submissions: [source.submission], artifacts: [source.artifact],
    submissionReplayIndex: [source.replay],
  };
  const sourced = (kind) => ({
    ...clone(valid[kind]), sourceArtifactId: source.artifact.artifactId, createdAt: TIME, updatedAt: TIME,
  });
  return {
    store,
    source,
    runtimeState,
    request: {
      cycleId: runtimeState.cycles[0].cycleId,
      scope: { scopeId: 'scope-acme', domainId: 'business', domainVersion: '1.0.0' },
      domainContract: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
      sourceArtifactIds: [source.artifact.artifactId],
      sourceRevisions: [{ sourceArtifactId: source.artifact.artifactId, revision: `revision-${seed}` }],
      collections: {
        objectives: [sourced('operating-objective')],
        metrics: [sourced('operating-metric')],
        findings: [], decisions: [], actions: [],
        risks: [sourced('operating-risk')], assumptions: [sourced('operating-assumption')],
      },
    },
    draft: {
      snapshotId: `snp_state_${seed}`, stateId: `oms_state_${seed}`, timestamp: TIME,
      correlationId: `corr_state_${seed}`,
      eventIds: { snapshot: `evt_snapshot_${seed}`, state: `evt_state_${seed}` },
    },
  };
}

test('state and snapshot fixtures validate while malformed runtime hashes fail schema validation', () => {
  const state = fixture('operating-state-valid.json');
  const snapshot = fixture('operating-snapshot-valid.json');
  assert.deepEqual(validateProtocolArtifact('operating-model-state', state, { protocolVersion: '2.0.0' }), []);
  assert.deepEqual(validateProtocolArtifact('operating-snapshot', snapshot, { protocolVersion: '2.0.0' }), []);
  assert.ok(validateProtocolArtifact('operating-model-state', fixture('operating-state-invalid.json'), {
    protocolVersion: '2.0.0',
  }).length > 0);
  assert.ok(validateProtocolArtifact('operating-snapshot', fixture('operating-snapshot-invalid.json'), {
    protocolVersion: '2.0.0',
  }).length > 0);
});

test('one runtime transaction atomically materializes immutable seven-collection state and snapshot from accepted exact bytes', () => {
  const { runtimeState, request, draft, store, source } = stateSeed();
  const before = sha256Jcs(runtimeState);
  const hook = createNoModelReplayHookV2();
  const result = materializeOperatingStateSnapshotV2(request, draft, {
    initialState: runtimeState, artifactStore: store, replayHook: hook,
  });

  assert.equal(sha256Jcs(runtimeState), before, 'input checkpoint remains immutable');
  assert.equal(hook.dispatchCount, 0, 'state replay never dispatches a model or provider');
  assert.equal(result.replayed, false);
  assert.deepEqual(result.events.map(({ type }) => type), ['snapshot.materialized', 'operating-state.materialized']);
  assert.equal(result.state.operatingSnapshots.length, 1);
  assert.equal(result.state.operatingModelStates.length, 1);
  assert.deepEqual(Object.keys(result.operatingState).filter((key) => [
    'objectives', 'metrics', 'findings', 'decisions', 'actions', 'risks', 'assumptions',
  ].includes(key)).sort(), [
    'actions', 'assumptions', 'decisions', 'findings', 'metrics', 'objectives', 'risks',
  ]);
  assert.equal(result.snapshot.stateId, result.operatingState.stateId);
  assert.equal(result.snapshot.runtimeHash.length, 71);
  assert.equal(result.operatingState.runtimeHash.length, 71);
  assert.equal(result.snapshot.sourceArtifactIds[0], source.artifact.artifactId);
  assert.doesNotMatch(JSON.stringify(result), /opaque operating source/, 'raw Artifact bytes never enter public state or events');
  assert.deepEqual(
    reduceOperatingRuntimeEventsV2(result.events, { initialState: runtimeState }),
    result.state,
    'restart rebuild uses Events only and yields the same checkpoint',
  );
  assertOperatingModelStateV2(result.operatingState);
  assertOperatingSnapshotV2(result.snapshot, { state: result.operatingState });
});

test('same runtime-issued transaction replays effect-free while divergent state, Event, source, or byte custody fails before commit', () => {
  const { runtimeState, request, draft, store, source } = stateSeed('002');
  const first = materializeOperatingStateSnapshotV2(request, draft, { initialState: runtimeState, artifactStore: store });
  const replayHook = createNoModelReplayHookV2();
  const replay = materializeOperatingStateSnapshotV2(clone(request), clone(draft), {
    initialState: first.state, artifactStore: store, replayHook,
  });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.events, []);
  assert.equal(replayHook.dispatchCount, 0);
  assert.deepEqual(replay.state, first.state);

  const before = sha256Jcs(first.state);
  assert.throws(() => materializeOperatingStateSnapshotV2({
    ...request,
    collections: { ...request.collections, objectives: [{ ...request.collections.objectives[0], title: 'Divergent title' }] },
  }, draft, { initialState: first.state, artifactStore: store }), { code: 'STATE_TRANSITION_INVALID' });
  const incompleteCollections = { ...request.collections };
  delete incompleteCollections.assumptions;
  assert.throws(() => materializeOperatingStateSnapshotV2({
    ...request, collections: incompleteCollections,
  }, { ...draft, snapshotId: 'snp_state_incomplete_002', stateId: 'oms_state_incomplete_002', eventIds: {
    snapshot: 'evt_snapshot_incomplete_002', state: 'evt_state_incomplete_002',
  } }, { initialState: first.state, artifactStore: store }), { code: 'RESULT_CONTRACT_INVALID' });
  assert.throws(() => materializeOperatingStateSnapshotV2(request, {
    ...draft, eventIds: { ...draft.eventIds, state: 'evt_state_different_002' },
  }, { initialState: first.state, artifactStore: store }), { code: 'STATE_TRANSITION_INVALID' });
  assert.throws(() => materializeOperatingStateSnapshotV2({
    ...request, sourceArtifactIds: ['art_missing_002'], sourceRevisions: [{ sourceArtifactId: 'art_missing_002', revision: 'missing' }],
  }, { ...draft, snapshotId: 'snp_state_missing_002', stateId: 'oms_state_missing_002', eventIds: {
    snapshot: 'evt_snapshot_missing_002', state: 'evt_state_missing_002',
  } }, { initialState: first.state, artifactStore: store }), { code: /ARTIFACT_NOT_FOUND|STATE_TRANSITION_INVALID/ });
  const missingStore = createOperatingArtifactByteStoreV2();
  assert.throws(() => materializeOperatingStateSnapshotV2({
    ...request, sourceArtifactIds: [source.artifact.artifactId],
  }, { ...draft, snapshotId: 'snp_state_bytes_002', stateId: 'oms_state_bytes_002', eventIds: {
    snapshot: 'evt_snapshot_bytes_002', state: 'evt_state_bytes_002',
  } }, { initialState: first.state, artifactStore: missingStore }), { code: 'ARTIFACT_NOT_FOUND' });
  assert.equal(sha256Jcs(first.state), before, 'all conflicts remain effect-free');
});

test('Finding, Decision, and Action source cycles must equal their accepted source Artifact cycle before any byte-store or state mutation', () => {
  const valid = fixture('all-contracts-valid.json');
  const records = [
    ['findings', 'operating-finding', 'findingId'],
    ['decisions', 'operating-decision', 'decisionId'],
    ['actions', 'operating-action', 'actionId'],
  ];
  const cases = [
    ['foreign', 'cyc_foreign_001'],
    ['nonexistent', 'cyc_missing_001'],
  ];

  for (const [caseName, sourceCycleId] of cases) {
    for (const [collection, kind, id] of records) {
      const { runtimeState, request, draft, store, source } = stateSeed(`${caseName}-${collection}`);
      if (caseName === 'foreign') {
        runtimeState.cycles.push({
          ...clone(valid['operating-cycle']), cycleId: sourceCycleId, inputBindingId: 'inb_foreign_001', updatedAt: TIME,
        });
      }
      request.collections[collection] = [{
        ...clone(valid[kind]), [id]: valid[kind][id], sourceArtifactId: source.artifact.artifactId,
        sourceCycleId, createdAt: TIME, updatedAt: TIME,
      }];
      const checkpoint = sha256Jcs(runtimeState);
      const events = clone(runtimeState.eventReplayIndex);
      let reads = 0;
      let stages = 0;
      const monitoredStore = {
        readRaw(input) {
          reads += 1;
          return store.readRaw(input);
        },
        stageRaw(input) {
          stages += 1;
          return store.stageRaw(input);
        },
      };
      assert.throws(() => materializeOperatingStateSnapshotV2(request, {
        ...draft,
        snapshotId: `snp_${caseName}_${collection}_001`,
        stateId: `oms_${caseName}_${collection}_001`,
        eventIds: {
          snapshot: `evt_snapshot_${caseName}_${collection}_001`,
          state: `evt_state_${caseName}_${collection}_001`,
        },
      }, { initialState: runtimeState, artifactStore: monitoredStore }), { code: 'OPERATING_SCOPE_INVALID' });
      assert.equal(sha256Jcs(runtimeState), checkpoint, `${caseName} ${collection}: checkpoint remains unchanged`);
      assert.deepEqual(runtimeState.eventReplayIndex, events, `${caseName} ${collection}: no events were appended`);
      assert.equal(reads, 0, `${caseName} ${collection}: byte store was not read`);
      assert.equal(stages, 0, `${caseName} ${collection}: byte store was not staged`);
    }
  }
});
