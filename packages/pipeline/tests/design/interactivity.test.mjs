import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideThinSpec, isHeadless } from '../../lib/design/interactivity.mjs';

test('a run is headless only when BOTH flags are supplied', () => {
  assert.equal(isHeadless({ format: 'walkthrough', from: 'spec' }), true);
  assert.equal(isHeadless({ format: 'walkthrough' }), false);
  assert.equal(isHeadless({ from: 'spec' }), false);
  assert.equal(isHeadless({}), false);
});

test('screens resolved → proceed', () => {
  assert.equal(decideThinSpec({ screenCount: 5 }).action, 'proceed');
  assert.equal(decideThinSpec({ screenCount: 1, format: 'prototype', from: 'spec' }).action, 'proceed');
});

test('0 screens, interactive (no flags) → CLARIFY (ask, not dead-end)', () => {
  assert.equal(decideThinSpec({ screenCount: 0 }).action, 'clarify');
  // partial flags are still interactive (Phase B runs for the missing axis)
  assert.equal(decideThinSpec({ screenCount: 0, format: 'walkthrough' }).action, 'clarify');
});

test('0 screens, headless (both flags), non-describe source → ABORT (cannot prompt)', () => {
  assert.equal(decideThinSpec({ screenCount: 0, format: 'walkthrough', from: 'spec' }).action, 'abort');
});

test('--from describe always proceeds (derives screens from the brief)', () => {
  assert.equal(decideThinSpec({ screenCount: 0, from: 'describe' }).action, 'proceed');
  assert.equal(decideThinSpec({ screenCount: 0, from: 'describe', format: 'prototype' }).action, 'proceed');
});

test('every decision carries a reason', () => {
  for (const input of [{ screenCount: 3 }, { screenCount: 0 }, { screenCount: 0, format: 'x', from: 'spec' }]) {
    assert.ok(decideThinSpec(input).reason.length > 0);
  }
});
