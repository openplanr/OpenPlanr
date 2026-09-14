import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { transitionOperatingActionLifecycleV2 } from '../../lib/operate/runtime-foundation.mjs';

const actionFixture = JSON.parse(readFileSync(
  new URL('../../conformance/fixtures/operating-runtime-v2/authorization-valid.json', import.meta.url),
  'utf8',
)).action;

test('all bounded legal terminal branches preserve immutable Action identity', () => {
  const timestamps = Array.from({ length: 64 }, (_, index) => (
    `2026-08-10T12:${String(index % 60).padStart(2, '0')}:00.000Z`
  ));
  for (const timestamp of timestamps) {
    const action = structuredClone(actionFixture);
    const queued = transitionOperatingActionLifecycleV2(action, 'queued', { updatedAt: timestamp });
    const started = transitionOperatingActionLifecycleV2(queued, 'in_progress', { updatedAt: timestamp });
    for (const terminal of ['completed', 'blocked', 'cancelled']) {
      const value = transitionOperatingActionLifecycleV2(started, terminal, { updatedAt: timestamp });
      assert.equal(value.actionHash, action.actionHash);
      assert.equal(value.revision, action.revision);
      assert.equal(value.revisionId, action.revisionId);
      if (terminal !== 'blocked') {
        assert.throws(
          () => transitionOperatingActionLifecycleV2(value, 'in_progress', { updatedAt: timestamp }),
          (error) => error?.code === 'STATE_TRANSITION_INVALID',
        );
      }
    }
  }
});

test('blocked recovery is explicit and cannot use a terminal reopen edge', () => {
  const action = structuredClone(actionFixture);
  const queued = transitionOperatingActionLifecycleV2(action, 'queued', { updatedAt: '2026-08-10T12:00:00.000Z' });
  const blocked = transitionOperatingActionLifecycleV2(queued, 'blocked', { updatedAt: '2026-08-10T12:01:00.000Z' });
  assert.equal(transitionOperatingActionLifecycleV2(blocked, 'queued', {
    updatedAt: '2026-08-10T12:02:00.000Z',
  }).state, 'queued');
  assert.throws(
    () => transitionOperatingActionLifecycleV2(blocked, 'completed', { updatedAt: '2026-08-10T12:02:00.000Z' }),
    (error) => error?.code === 'STATE_TRANSITION_INVALID',
  );
});
