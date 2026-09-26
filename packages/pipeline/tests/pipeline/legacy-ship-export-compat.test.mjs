import assert from 'node:assert/strict';
import { test } from 'node:test';

import { finalizeShip, recordTaskResult } from '../../lib/pipeline/index.mjs';

test('legacy SHIP named exports remain linkable with bounded migration behavior', () => {
  assert.equal(typeof finalizeShip, 'function');
  assert.equal(typeof recordTaskResult, 'function');

  assert.throws(
    () => finalizeShip({ feature: 'legacy-feature' }),
    (error) =>
      error?.code === 'E_SHIP_LEGACY_API_RETIRED' && /finalizeShipClosure/.test(error?.fix ?? ''),
  );
  assert.throws(
    () => recordTaskResult({ task: { id: 'T-001' }, result: { status: 'done' } }),
    (error) => error?.code === 'E_SHIP_LEGACY_API_RETIRED' && /advanceShip/.test(error?.fix ?? ''),
  );
});
