import assert from 'node:assert/strict';
import { test } from 'node:test';

test('Artifact canonical runtime preserves deterministic serialization', async () => {
  const artifact = await import('../lib/artifact/index.mjs');
  assert.equal(
    artifact.canonicalSerialize({ z: [2, { b: true, a: false }], a: 1 }),
    '{"a":1,"z":[2,{"a":false,"b":true}]}',
  );
  assert.equal(artifact.normalizeUtf8Text('\uFEFFone\r\ntwo\rthree'), 'one\ntwo\nthree');
});
