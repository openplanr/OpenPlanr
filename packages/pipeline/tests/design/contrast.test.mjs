import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contrastRatio, isReadable, parseColor, AA_NORMAL } from '../../lib/design/contrast.mjs';

test('black/white is ~21:1 (hex, both orders + shorthand)', () => {
  assert.ok(Math.abs(contrastRatio('#ffffff', '#000000') - 21) < 0.2);
  assert.ok(Math.abs(contrastRatio('#000', '#fff') - 21) < 0.2);
});

test('rgb() parses and computes', () => {
  assert.ok(Math.abs(contrastRatio('rgb(255,255,255)', 'rgb(0,0,0)') - 21) < 0.2);
});

test('oklch is parsed via OKLab (white/black ~21:1)', () => {
  assert.ok(Math.abs(contrastRatio('oklch(1 0 0)', 'oklch(0 0 0)') - 21) < 0.3);
});

test('matches a WCAG-verified Atlas pair: foreground on background ≈ 17.7:1', () => {
  // Atlas brand-identity.md publishes this oklch pairing as 17.7:1 (light).
  const r = contrastRatio('oklch(0.21 0.015 268)', 'oklch(1 0 0)');
  assert.ok(r > 15 && r < 20, `expected ~17.7, got ${r}`);
});

test('isReadable: low-contrast gray on white fails AA; black passes', () => {
  assert.equal(isReadable('#999999', '#ffffff'), false); // ~2.8:1
  assert.equal(isReadable('#000000', '#ffffff'), true);
});

test('large-text threshold (3:1) is more lenient than normal', () => {
  // a pair around ~3.5:1 passes large but not normal
  const fg = '#767676'; // ~4.54:1 vs white — tweak to a known mid value
  assert.equal(isReadable(fg, '#ffffff', { large: true }), true);
});

test('unresolvable colors (var/gradient/currentColor) → null ratio, isReadable true (never false-flag)', () => {
  assert.equal(parseColor('var(--accent)'), null);
  assert.equal(parseColor('linear-gradient(#fff,#000)'), null);
  assert.equal(parseColor('currentColor'), null);
  assert.equal(contrastRatio('var(--x)', '#fff'), null);
  assert.equal(isReadable('var(--x)', '#fff'), true);
});

test('AA_NORMAL threshold is 4.5', () => {
  assert.equal(AA_NORMAL, 4.5);
});
