import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DESIGN_UTILITY_CONTRACT, DESIGN_UTILITY_SUPPORTED } from '../lib/design/utility.mjs';

test('the design utility declares its contract inside the range it still serves', () => {
  assert.ok(Number.isInteger(DESIGN_UTILITY_CONTRACT) && DESIGN_UTILITY_CONTRACT >= 1);
  assert.ok(Object.isFrozen(DESIGN_UTILITY_SUPPORTED));
  const { min, max } = DESIGN_UTILITY_SUPPORTED;
  assert.ok(Number.isInteger(min) && min >= 1 && min <= max);
  assert.equal(max, DESIGN_UTILITY_CONTRACT);
});
