import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  assertDashboardLiveEventEnvelope,
  createDashboardLiveEventEnvelope,
} from '../../lib/dashboard/server.mjs';
import { issueOperateExperienceDisplaySurfaceV1 } from '../../lib/dashboard/operate-experience-display-contract.mjs';
import { deriveOperateSharedTruthSummaryV1 } from '../../lib/dashboard/operate-review-workspace-projection-v2.mjs';

const hash = (character) => `sha256:${character.repeat(64)}`;
const binding = Object.freeze({
  actorId: 'owner-acme',
  projectId: hash('f'),
  scopeId: 'scope-acme',
  domainId: 'business',
  domainVersion: '1.0.0',
  generation: 4,
});
const cursor = Object.freeze({
  eventHead: Object.freeze({ sequence: 1, hash: hash('a') }),
  viewHash: hash('b'),
});
const truthView = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
)['operate-experience-view'];
const truthSummary = Object.freeze({
  ...deriveOperateSharedTruthSummaryV1(truthView),
  sourceEventHead: cursor.eventHead,
  sourceViewHash: cursor.viewHash,
});
const today = issueOperateExperienceDisplaySurfaceV1({
  ok: true,
  kind: 'operate-experience-surface',
  schemaVersion: '1.0.0',
  protocolVersion: '2.0.0',
  surface: 'today',
  readOnly: true,
  mutationEnabled: true,
  scopeId: binding.scopeId,
  domainId: binding.domainId,
  domainVersion: binding.domainVersion,
  actorId: binding.actorId,
  accessLevel: 'public',
  generatedAt: '2026-08-13T00:00:00.000Z',
  eventHead: cursor.eventHead,
  viewHash: cursor.viewHash,
  truthSummary,
  status: 'ready',
  reasonCodes: [],
  data: {
    attention: [],
    domainMetrics: [],
    activeCycle: null,
    inbox: [],
    actions: [],
    outcomes: [],
    allowedActions: [],
  },
});

test('dashboard live owner emits closed, generation-bound public envelopes', () => {
  const snapshot = createDashboardLiveEventEnvelope({
    event: 'snapshot',
    binding,
    cursor,
    payload: today,
  });
  assert.equal(assertDashboardLiveEventEnvelope(snapshot), snapshot);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'binding',
    'cursor',
    'event',
    'kind',
    'payload',
    'schemaVersion',
  ]);
  assert.deepEqual(Object.keys(snapshot.binding).sort(), [
    'actorId',
    'domainId',
    'domainVersion',
    'generation',
    'projectId',
    'scopeId',
  ]);
  assert.equal(JSON.stringify(snapshot).includes('/Users/'), false);
  assert.equal(JSON.stringify(snapshot).includes('privateBody'), false);

  const ready = createDashboardLiveEventEnvelope({
    event: 'ready',
    binding,
    cursor,
    payload: { mutationEnabled: true, reasonCodes: [] },
  });
  assert.equal(ready.event, 'ready');
  const stale = createDashboardLiveEventEnvelope({
    event: 'stale',
    binding,
    cursor,
    payload: {
      mutationEnabled: false,
      reasonCodes: ['OPERATE_EVENT_GAP'],
      recovery: 'Refresh the validated snapshot before submitting any command.',
    },
  });
  assert.equal(stale.event, 'stale');
  const patchSignal = {
    patchId: 'xpatch_12345678',
    patchHash: hash('c'),
    from: cursor,
    to: { eventHead: { sequence: 2, hash: hash('d') }, viewHash: hash('e') },
    changedPaths: ['/status'],
  };
  const patchEnvelope = assertDashboardLiveEventEnvelope({
    kind: 'dashboard-live-event',
    schemaVersion: '1.0.0',
    event: 'patch',
    binding,
    cursor: patchSignal.to,
    payload: patchSignal,
  });
  assert.equal(Object.hasOwn(patchEnvelope.payload, 'operations'), false);
});

test('dashboard live owner rejects unknown, contradictory, and cross-binding state', () => {
  assert.throws(
    () =>
      assertDashboardLiveEventEnvelope({
        ...createDashboardLiveEventEnvelope({
          event: 'ready',
          binding,
          cursor,
          payload: { mutationEnabled: true, reasonCodes: [] },
        }),
        privateBody: '/private/provider/body',
      }),
    /Invalid dashboard live event envelope/u,
  );

  assert.throws(
    () =>
      createDashboardLiveEventEnvelope({
        event: 'ready',
        binding,
        cursor,
        payload: { mutationEnabled: true, reasonCodes: ['OPERATE_OFFLINE'] },
      }),
    /ready payload/u,
  );

  assert.throws(
    () =>
      createDashboardLiveEventEnvelope({
        event: 'snapshot',
        binding: { ...binding, scopeId: 'foreign' },
        cursor,
        payload: today,
      }),
    /display surface|snapshot binding/u,
  );

  assert.throws(() =>
    createDashboardLiveEventEnvelope({
      event: 'snapshot',
      binding,
      cursor,
      payload: { ...today, ok: false },
    }),
  );

  assert.throws(
    () =>
      createDashboardLiveEventEnvelope({
        event: 'stale',
        binding: { ...binding, generation: -1 },
        cursor,
        payload: {
          mutationEnabled: false,
          reasonCodes: ['OPERATE_EVENT_GAP'],
          recovery: 'Refresh.',
        },
      }),
    /Invalid dashboard live event envelope/u,
  );
});
