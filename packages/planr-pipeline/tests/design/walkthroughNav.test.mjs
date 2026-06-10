import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chooseWalkthroughNav, ANCHOR_MAX_SCREENS } from '../../lib/design/walkthroughNav.mjs';

test('≤8 screens use anchor-scroll, >8 use lazy switching', () => {
  assert.equal(chooseWalkthroughNav(1), 'anchor');
  assert.equal(chooseWalkthroughNav(ANCHOR_MAX_SCREENS), 'anchor'); // boundary: 8 → anchor
  assert.equal(chooseWalkthroughNav(ANCHOR_MAX_SCREENS + 1), 'lazy'); // 9 → lazy
  assert.equal(chooseWalkthroughNav(24), 'lazy');
});

test('non-finite screen counts degrade to anchor', () => {
  assert.equal(chooseWalkthroughNav(NaN), 'anchor');
  assert.equal(chooseWalkthroughNav(undefined), 'anchor');
});
