import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isOnSpacingScale, nearestSpacing, isCanonicalFrame, FRAMES, DEFAULT_FRAME, SPACING_STEP,
  BREAKPOINTS, RESPONSIVE_FRAMES,
} from '../../lib/design/tokens.mjs';

test('on the 4-point grid: 0, 2, and multiples of 4 pass', () => {
  for (const ok of [0, 2, 4, 8, 12, 16, 24, 32, 48, 60, 64, 128]) {
    assert.equal(isOnSpacingScale(ok), true, `${ok} should be on-grid`);
  }
});

test('off-grid spacing is rejected (the 13/14/17 drift)', () => {
  for (const bad of [1, 3, 6, 9, 10, 11, 13, 14, 17, 23, 13.5]) {
    assert.equal(isOnSpacingScale(bad), false, `${bad} should be off-grid`);
  }
});

test('negative margins are judged by magnitude', () => {
  assert.equal(isOnSpacingScale(-16), true);
  assert.equal(isOnSpacingScale(-13), false);
});

test('nearestSpacing snaps to the grid, preserving sign', () => {
  assert.equal(nearestSpacing(14), 16);
  assert.equal(nearestSpacing(13), 12);
  assert.equal(nearestSpacing(6), 8);
  assert.equal(nearestSpacing(11), 12);
  assert.equal(nearestSpacing(-13), -12);
  assert.equal(nearestSpacing(1), 2);
  assert.ok(isOnSpacingScale(nearestSpacing(17)), 'a snapped value is always on-grid');
});

test('canonical frames: desktop 1440 + tablet 834 + mobile 390 (v0.17.0)', () => {
  assert.equal(DEFAULT_FRAME.w, 1440);
  assert.equal(DEFAULT_FRAME.h, 1024);
  assert.equal(isCanonicalFrame({ w: 1440, h: 1024 }), true);
  assert.equal(isCanonicalFrame(FRAMES.tablet), true);
  assert.equal(isCanonicalFrame({ w: 834, h: 1194 }), true);
  assert.equal(isCanonicalFrame(FRAMES.mobile), true);
});

test('responsive frame set: desktop → tablet → mobile, widest first', () => {
  assert.deepEqual(RESPONSIVE_FRAMES.map((f) => f.name), ['desktop', 'tablet', 'mobile']);
  assert.deepEqual(RESPONSIVE_FRAMES.map((f) => f.w), [1440, 834, 390]);
  // breakpoint frame widths fall in their container-query ranges
  assert.ok(1440 >= BREAKPOINTS.desktop, 'desktop frame ≥ desktop breakpoint');
  assert.ok(834 >= BREAKPOINTS.tablet && 834 < BREAKPOINTS.desktop, 'tablet frame in tablet range');
  assert.ok(390 < BREAKPOINTS.tablet, 'mobile frame below tablet breakpoint');
});

test('off-canonical frames are rejected (the 760/700/820 drift)', () => {
  assert.equal(isCanonicalFrame({ w: 1440, h: 760 }), false);
  assert.equal(isCanonicalFrame({ w: 1320, h: 860 }), false);
  assert.equal(isCanonicalFrame({ w: 1440, h: 700 }), false);
});

test('SPACING_STEP is the 4-point grid', () => {
  assert.equal(SPACING_STEP, 4);
});
