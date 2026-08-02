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

// ── v0.18.0 adherence ────────────────────────────────────────────────────────
test('sub-AA text/background contrast is a hard ERROR', () => {
  const r = lintDesign('<style>.a{color:#999;background:#fff}</style>');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.rule === 'contrast-below-aa'), 'flags #999 on #fff (~2.85:1)');
});

test('a passing contrast pair is clean (no error)', () => {
  assert.equal(lintDesign('<style>.a{color:#111;background:#fff}</style>').ok, true);
});

test('contrast skips unresolvable pairs (var/no-pair) — never false-flags', () => {
  assert.equal(lintDesign('<style>.a{color:var(--ink);background:#fff}</style>').ok, true);
  assert.equal(lintDesign('<style>.a{color:#777}</style>').ok, true, 'no background → not checked');
});

test('raw color usage is a WARNING; a --token definition is not flagged', () => {
  const r = lintDesign('<style>:root{--bg:#fff} .a{background:#11151c}</style>');
  assert.ok(r.warnings.some((w) => w.rule === 'color-not-token' && w.value === '#11151c'));
  assert.ok(!r.warnings.some((w) => w.value === '#fff'), 'a --custom-prop definition is not raw-color usage');
  assert.equal(r.ok, true, 'raw color is advisory, not a hard error');
});

test('font-not-token warns against a known design system only', () => {
  const ds = { fonts: [{ family: 'Inter' }] };
  const bad = lintDesign('<style>.a{font-family:"Comic Sans MS",cursive}</style>', { designSystem: ds });
  assert.ok(bad.warnings.some((w) => w.rule === 'font-not-token'));
  const ok = lintDesign('<style>.a{font-family:Inter,system-ui}</style>', { designSystem: ds });
  assert.ok(!ok.warnings.some((w) => w.rule === 'font-not-token'), 'allowed DS font + system fallback is fine');
  const noDs = lintDesign('<style>.a{font-family:"Comic Sans MS"}</style>');
  assert.ok(!noDs.warnings.some((w) => w.rule === 'font-not-token'), 'no DS → cannot judge fonts');
});

test('off-grid spacing expressed in rem/em is caught (normalized to px at 16px root)', () => {
  assert.equal(lintDesign('<style>.a{padding:0.8125rem}</style>').errors.some((e) => e.rule === 'spacing-off-grid'), true, '0.8125rem = 13px is off-grid');
  assert.equal(lintDesign('<style>.a{padding:1rem;gap:0.5rem}</style>').errors.length, 0, '1rem/0.5rem = 16px/8px are on-grid');
});

test('lintDesign reports a declarations count (0 when no <style>/inline CSS is present)', () => {
  assert.equal(lintDesign('.a{padding:13px}').declarations, 0, 'raw CSS (no <style>) parses to zero declarations');
  assert.ok(lintDesign('<style>.a{padding:16px;color:#111}</style>').declarations >= 2, 'real <style> CSS parses declarations');
});

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LINT = join(dirname(fileURLToPath(import.meta.url)), '../../lib/design/lint.mjs');
const runLint = (args) => {
  try { execFileSync('node', [LINT, ...args], { stdio: 'pipe' }); return 0; }
  catch (e) { return e.status; }
};

test('CLI auto-wraps a bare .css so compiled stylesheets (Tailwind arbitrary values) are caught', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-cli-'));
  try {
    writeFileSync(join(dir, 'app.css'), '.p-13{padding:13px}.ok{margin:16px}'); // compiled off-grid px
    writeFileSync(join(dir, 'clean.css'), '.ok{padding:16px;gap:8px}');
    assert.equal(runLint([join(dir, 'app.css')]), 1, 'off-grid in a bare .css is caught (auto-wrapped) → exit 1');
    assert.equal(runLint([join(dir, 'clean.css')]), 0, 'on-grid compiled .css → exit 0');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI --expect-styles fails (exit 3) when a style-less file parses zero declarations — no fabricated clean pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-cli-'));
  try {
    writeFileSync(join(dir, 'shell.html'), '<div>no styles here</div>'); // a CSR shell — nothing to lint
    writeFileSync(join(dir, 'real.html'), '<style>.a{padding:16px}</style>');
    assert.equal(runLint([join(dir, 'shell.html')]), 0, 'back-compat: no flag → 0 even with nothing parsed');
    assert.equal(runLint(['--expect-styles', join(dir, 'shell.html')]), 3, 'zero-decl + --expect-styles → exit 3 (no fabricated pass)');
    assert.equal(runLint(['--expect-styles', join(dir, 'real.html')]), 0, 'real on-grid CSS → exit 0');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
