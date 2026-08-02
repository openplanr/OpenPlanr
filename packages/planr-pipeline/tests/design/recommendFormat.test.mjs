import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  recommendFormat, isExploratory, DESIGN_FORMATS,
} from '../../lib/design/recommendFormat.mjs';

test('0–2 screens always recommend prototype', () => {
  for (const n of [0, 1, 2]) {
    assert.equal(recommendFormat({ screenCount: n }).format, 'prototype', `n=${n}`);
  }
});

test('3+ screens in a linear flow recommend walkthrough', () => {
  assert.equal(recommendFormat({ screenCount: 3 }).format, 'walkthrough');
  assert.equal(recommendFormat({ screenCount: 24 }).format, 'walkthrough');
});

test('3+ screens with exploratory intent recommend canvas', () => {
  assert.equal(recommendFormat({ screenCount: 6, intentText: 'show me options' }).format, 'canvas');
  assert.equal(recommendFormat({ screenCount: 5, intentText: 'concept exploration board' }).format, 'canvas');
});

test('exploratory intent does NOT override the ≤2-screen prototype floor', () => {
  assert.equal(recommendFormat({ screenCount: 1, intentText: 'explore options' }).format, 'prototype');
});

test('every recommendation is a known format and carries a reason', () => {
  const r = recommendFormat({ screenCount: 7 });
  assert.ok(DESIGN_FORMATS.includes(r.format));
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
});

test('isExploratory matches whole words only', () => {
  assert.equal(isExploratory('explore the variants'), true);
  assert.equal(isExploratory('a single login screen'), false);
});

test('non-finite / missing screenCount degrades to prototype', () => {
  assert.equal(recommendFormat({}).format, 'prototype');
  assert.equal(recommendFormat({ screenCount: NaN }).format, 'prototype');
});
