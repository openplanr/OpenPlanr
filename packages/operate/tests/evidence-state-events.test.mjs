import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createEvidenceStateRuntimeEventHandlerV2 } from '../lib/operate/runtime-foundation/evidence-state-events.mjs';
import {
  assertHandlesExactly,
  clone,
  handlerDependencies,
  RUNTIME_EVENT_TYPES,
  runtimeError,
  TIME,
} from './runtime-foundation-events.test-support.mjs';

const REQUEST_HASH = `sha256:${'a'.repeat(64)}`;
const OUTCOME_HASH = `sha256:${'b'.repeat(64)}`;

function rejection() {
  return {
    resolutionId: 'evs_00000001',
    candidateId: 'cand_00000001',
    sourceArtifactId: 'art_00000002',
    outcome: 'rejected',
    evidenceRefId: null,
    evidenceArtifactId: null,
    error: { code: 'EVIDENCE_UNAVAILABLE', message: 'Source is unavailable.' },
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    resolvedAt: TIME,
  };
}

function rejectedEvent(event = {}) {
  return {
    type: 'evidence.rejected',
    eventId: 'evt_00000009',
    cycleId: 'cyc_00000001',
    entityId: 'evs_00000001',
    timestamp: TIME,
    actor: { kind: 'runtime', id: 'openplanr' },
    payload: { resolution: rejection(), requestHash: REQUEST_HASH, outcomeHash: OUTCOME_HASH },
    ...event,
  };
}

function evidenceIndex() {
  return {
    evidenceResolutions: new Map(),
    evidenceReplay: new Map(),
    evidenceCandidateIds: new Map(),
  };
}

function rejectionHandler({ sameBinding = true } = {}) {
  const sources = [];
  const apply = createEvidenceStateRuntimeEventHandlerV2(
    handlerDependencies({
      runtimeError,
      clone,
      acceptedEvidenceSource: (_index, sourceArtifactId, binding) => {
        sources.push([sourceArtifactId, binding]);
        return { artifact: { artifactId: sourceArtifactId } };
      },
      sameEvidenceBinding: () => sameBinding,
    }),
  );
  return { apply, sources };
}

test('evidence-state handler applies exactly the evidence, snapshot, state and metric Events', () => {
  assertHandlesExactly(
    createEvidenceStateRuntimeEventHandlerV2(handlerDependencies({ runtimeError })),
    RUNTIME_EVENT_TYPES.evidenceState,
  );
});

test('evidence.rejected records one fresh runtime-owned rejection and its replay identity', () => {
  const { apply, sources } = rejectionHandler();
  const index = evidenceIndex();
  apply(index, rejectedEvent());
  assert.deepEqual(sources, [
    [
      'art_00000002',
      {
        cycleId: 'cyc_00000001',
        scopeId: 'scope-acme',
        domainId: 'business',
        domainVersion: '1.0.0',
      },
    ],
  ]);
  assert.deepEqual(index.evidenceResolutions.get('evs_00000001'), rejection());
  assert.deepEqual(index.evidenceReplay.get('evs_00000001'), {
    resolutionId: 'evs_00000001',
    candidateId: 'cand_00000001',
    sourceArtifactId: 'art_00000002',
    outcome: 'rejected',
    evidenceRefId: null,
    evidenceArtifactId: null,
    eventId: 'evt_00000009',
    requestHash: REQUEST_HASH,
    outcomeHash: OUTCOME_HASH,
  });
  assert.equal(index.evidenceCandidateIds.get('cand_00000001'), 'evs_00000001');

  assert.throws(() => apply(index, rejectedEvent()), { code: 'CONCURRENT_MODIFICATION' });
});

test('evidence.rejected refuses foreign actors and a changed source binding', () => {
  const { apply } = rejectionHandler();
  assert.throws(
    () => apply(evidenceIndex(), rejectedEvent({ actor: { kind: 'engine', id: 'openplanr' } })),
    { code: 'CAPABILITY_DENIED' },
  );
  const { apply: applyUnbound } = rejectionHandler({ sameBinding: false });
  const index = evidenceIndex();
  assert.throws(() => applyUnbound(index, rejectedEvent()), { code: 'STATE_TRANSITION_INVALID' });
  assert.equal(index.evidenceResolutions.size, 0);
});
