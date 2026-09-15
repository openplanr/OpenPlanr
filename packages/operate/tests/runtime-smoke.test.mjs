import assert from 'node:assert/strict';
import { test } from 'node:test';

test('Operate canonical runtime loads through protocol-only imports', async () => {
  const runtime = await import('../lib/operate/runtime-foundation.mjs');
  assert.equal(typeof runtime.createEmptyOperatingRuntimeStateV2, 'function');
  const replay = runtime.createNoModelReplayHookV2();
  assert.equal(replay.dispatchCount, 0);
  assert.equal(replay.assertUnused(), true);
});
