import assert from 'node:assert/strict';
import test from 'node:test';
import * as integrations from '../src/index.mjs';

test('the portable package exposes no Linear transport', () => {
  assert.equal('inspectLinear' in integrations, false);
  assert.equal('executeLinearOperations' in integrations, false);
});
