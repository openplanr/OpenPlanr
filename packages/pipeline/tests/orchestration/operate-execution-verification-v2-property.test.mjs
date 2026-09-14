import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveOperatingExecutionLifecycleIdentitiesV2,
} from '../../lib/operate/execution-verification-v2.mjs';

test('execution verification identities are deterministic, unique, and collision-resistant over bounded samples', () => {
  const seen = new Set();
  for (let index = 0; index < 256; index += 1) {
    const operationId = `op_property_${String(index).padStart(8, '0')}`;
    const resultId = `xres_property_${String(index).padStart(8, '0')}`;
    const first = deriveOperatingExecutionLifecycleIdentitiesV2({ operationId, resultId });
    const replay = deriveOperatingExecutionLifecycleIdentitiesV2({ operationId, resultId });
    assert.deepEqual(replay, first);
    const identities = [first.assignmentId, ...Object.values(first.eventIds)];
    assert.equal(new Set(identities).size, identities.length);
    for (const identity of identities) {
      assert.equal(seen.has(identity), false);
      seen.add(identity);
    }
  }
});

test('operation or result divergence changes every runtime-owned identity', () => {
  const base = deriveOperatingExecutionLifecycleIdentitiesV2({ operationId: 'op_property_base01', resultId: 'xres_property_base01' });
  const operationChanged = deriveOperatingExecutionLifecycleIdentitiesV2({ operationId: 'op_property_base02', resultId: 'xres_property_base01' });
  const resultChanged = deriveOperatingExecutionLifecycleIdentitiesV2({ operationId: 'op_property_base01', resultId: 'xres_property_base02' });
  assert.notEqual(base.assignmentId, operationChanged.assignmentId);
  assert.notEqual(base.assignmentId, resultChanged.assignmentId);
  for (const key of Object.keys(base.eventIds)) {
    assert.notEqual(base.eventIds[key], operationChanged.eventIds[key]);
    assert.notEqual(base.eventIds[key], resultChanged.eventIds[key]);
  }
});
