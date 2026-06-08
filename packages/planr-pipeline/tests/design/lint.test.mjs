import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintDesign, lintCanvasData } from '../../lib/design/lint.mjs';

test('clean design (on-grid spacing) passes', () => {
  const html = `<style>.card{padding:24px;margin-bottom:16px;gap:8px}</style>
    <div class="card" style="padding:16px">ok</div>`;
  const r = lintDesign(html);
  assert.equal(r.ok, true, r.summary);
  assert.equal(r.errors.length, 0);
});

test('off-grid spacing in a <style> rule is an ERROR with a snap suggestion', () => {
  const r = lintDesign('<style>.ds-card{margin-bottom:14px;padding:13px 24px}</style>');
  assert.equal(r.ok, false);
  const marginErr = r.errors.find((e) => e.value === '14px');
  assert.ok(marginErr, 'flags the 14px margin');
  assert.equal(marginErr.rule, 'spacing-off-grid');
  assert.equal(marginErr.suggestion, '16px');
  assert.ok(r.errors.find((e) => e.value === '13px' && e.suggestion === '12px'), 'flags 13px → 12px');
});

test('off-grid spacing in an INLINE style is also an ERROR', () => {
  const r = lintDesign('<div style="margin:0 0 11px 0">x</div>');
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].where, 'inline');
  assert.equal(r.errors[0].suggestion, '12px');
});

test('var()/calc() and 0 are never flagged', () => {
  const r = lintDesign('<style>.a{padding:var(--space);gap:calc(2px + 1px);margin:0}</style>');
  assert.equal(r.ok, true, r.summary);
});

test('border-width / font-size are not spacing — not flagged by the grid rule', () => {
  const r = lintDesign('<style>.a{border:1px solid #ccc;font-size:13px;border-radius:9px}</style>');
  assert.equal(r.errors.length, 0, 'only padding/margin/gap/inset are grid-checked');
});

test('a classed element with inline sizing is a drift WARNING (not an error)', () => {
  const r = lintDesign('<span class="ds-badge" style="height:20px;padding:0 8px">A</span>');
  assert.equal(r.ok, true, 'drift is advisory, not a hard error');
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].rule, 'inline-sizing-drift');
});

test('lintCanvasData: every artboard must be a canonical frame', () => {
  const good = { sections: [{ artboards: [{ id: 'a', width: 1440, height: 1024 }] }] };
  assert.equal(lintCanvasData(good).ok, true);

  const bad = { sections: [{ artboards: [
    { id: 'home', width: 1440, height: 760 },
    { id: 'roles', width: 1440, height: 820 },
  ] }] };
  const r = lintCanvasData(bad);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2, 'flags both off-frame artboards (the 760/820 drift)');
  assert.equal(r.errors[0].suggestion, '1440×1024');
});
