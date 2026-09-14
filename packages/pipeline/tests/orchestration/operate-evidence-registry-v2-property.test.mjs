import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  createOperateEvidenceRegistryV2,
  prepareOperateEvidenceDispatchV2,
} from 'planr-pipeline/operate/evidence-v2';

const fixture = (name) => JSON.parse(readFileSync(
  new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
  'utf8',
));

function shuffled(entries, seed) {
  const copy = structuredClone(entries);
  let state = seed;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swap = state % (index + 1);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

test('registration order and capability omission cannot change authorized evidence dispatch', () => {
  const valid = fixture('evidence-registry-valid.json');
  const expected = createOperateEvidenceRegistryV2(valid);
  for (let seed = 1; seed <= 64; seed += 1) {
    const registry = createOperateEvidenceRegistryV2({
      providers: shuffled(valid.providers, seed),
      resolvers: shuffled(valid.resolvers, seed ^ 0x9e3779b9),
    });
    assert.deepEqual(registry, expected, `deterministic registry seed ${seed}`);
    const allowed = prepareOperateEvidenceDispatchV2(registry, valid.candidate, {
      scope: valid.scope,
      capabilities: valid.capabilities,
    });
    assert.equal(allowed.status, 'authorized', `authorized registry seed ${seed}`);
    const denied = prepareOperateEvidenceDispatchV2(registry, valid.candidate, {
      scope: valid.scope,
      capabilities: [],
    });
    assert.equal(denied.status, 'rejected', `capability denial seed ${seed}`);
    assert.equal(denied.error.code, 'CAPABILITY_DENIED', `capability code seed ${seed}`);
  }
});
