#!/usr/bin/env node
/**
 * Design-asset conformance for /planr-pipeline:design (SPEC-015).
 *
 * Self-contained and deterministic — no runtime/operator needed (unlike
 * runner.mjs, which drives feat-todo through a live agent). This asserts the
 * SHIPPED design assets are intact and the tested core behaves:
 *   1. command + procedures + shared template + lib helpers present
 *   2. renderer shells present with their GENERATOR markers
 *   3. vendored runtime present; the compiled canvas parses + registers globals
 *   4. the design manifest schema accepts the golden valid fixture, rejects the invalid
 *   5. the screen resolver + format-recommendation rule agree on the fixture spec
 *   6. the escaping helpers neutralize a hostile string (XSS regression, S1)
 *
 * Exit 0 = all pass; non-zero = at least one failure.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate } from './json-schema-validate.mjs';
import {
  escapeHtml, embedJson, hasUnsafeHtml,
  recommendFormat, resolveScreens, countScreens, chooseWalkthroughNav,
  decideThinSpec,
} from '../lib/design/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const log = (...a) => console.log(...a);
let failures = 0;
const ok = (label) => log(`  ✓ ${label}`);
const bad = (label, detail) => { log(`  ✗ ${label}`); if (detail) log(`    ${detail}`); failures++; };
const assert = (cond, label, detail) => (cond ? ok(label) : bad(label, detail));
const fileHas = (p, needle) => existsSync(p) && readFileSync(p, 'utf-8').includes(needle);

log('OpenPlanr design-asset conformance (SPEC-015)\n');

// 1 — orchestration files present
log('orchestration:');
for (const rel of [
  'commands/design.md',
  'procedures/design-step0-preflight.md',
  'procedures/design-step1-clarify.md',
  'procedures/design-step2-generate.md',
  'procedures/design-step3-spec-and-handoff.md',
  'procedures/design-detect-nudge.md',
  'agents/modes/shared/design-spec-template.md',
  'agents/modes/shared/design-craft-rubric.md',
  'lib/design/index.mjs',
  'schemas/v1.0.0/design-manifest.schema.json',
]) assert(existsSync(join(root, rel)), rel);

// 2 — renderer shells + their markers
log('\nrenderer shells:');
const shells = {
  'templates/design/prototype-shell.html': ['GENERATOR:screen', 'pretext.js'],
  'templates/design/walkthrough-shell.html': ['GENERATOR:screens', 'data-nav-mode', 'wt-counter'],
  'templates/design/canvas-shell.html': ['GENERATOR:data', 'dc-viewonly', 'DesignCanvas.js'],
};
for (const [rel, needles] of Object.entries(shells)) {
  const p = join(root, rel);
  assert(existsSync(p), rel);
  for (const n of needles) assert(fileHas(p, n), `${rel} contains "${n}"`);
}

// 3 — vendored runtime + compiled canvas
log('\nvendored runtime:');
for (const rel of [
  'templates/design/vendor/pretext.js',
  'templates/design/vendor/react.production.min.js',
  'templates/design/vendor/react-dom.production.min.js',
  'templates/design/vendor/DesignCanvas.js',
  'templates/design/DesignCanvas.jsx',
]) assert(existsSync(join(root, rel)) && readFileSync(join(root, rel)).length > 0, `${rel} (non-empty)`);

const canvasJs = join(root, 'templates/design/vendor/DesignCanvas.js');
assert(fileHas(canvasJs, 'React.createElement'), 'DesignCanvas.js is compiled (React.createElement)');
assert(fileHas(canvasJs, 'Object.assign(window'), 'DesignCanvas.js registers globals');
try {
  execFileSync('node', ['--check', canvasJs], { stdio: 'pipe' });
  ok('DesignCanvas.js passes node --check');
} catch (e) {
  bad('DesignCanvas.js passes node --check', String(e.stderr || e.message).split('\n')[0]);
}

// 4 — manifest schema vs golden fixtures
log('\ndesign-manifest schema:');
const schema = JSON.parse(readFileSync(join(root, 'schemas/v1.0.0/design-manifest.schema.json'), 'utf-8'));
assert(!('format' in schema.properties) && 'design_format' in schema.properties,
  'schema uses design_format, not the reserved keyword format (T2)');
const validManifest = JSON.parse(readFileSync(join(root, 'tests/fixtures/valid-design-manifest.json'), 'utf-8'));
const invalidManifest = JSON.parse(readFileSync(join(root, 'tests/fixtures/invalid-design-manifest-missing-fields.json'), 'utf-8'));
assert(validate(validManifest, schema).length === 0, 'golden valid manifest passes');
assert(validate(invalidManifest, schema).length > 0, 'golden invalid manifest fails');

// 5 — screens + recommendation agree on the fixture spec (5 linear screens → walkthrough)
log('\nscreens + recommendation:');
const fixtureSpec = readFileSync(join(root, 'conformance/fixture-design/SPEC-900-design-sample.md'), 'utf-8');
const screens = resolveScreens(fixtureSpec);
assert(countScreens(fixtureSpec) === 5, `fixture resolves 5 screens (got ${screens.length}: ${screens.join(', ')})`);
assert(recommendFormat({ screenCount: screens.length }).format === 'walkthrough',
  '5 linear screens → walkthrough recommended');
assert(recommendFormat({ screenCount: 1 }).format === 'prototype', '1 screen → prototype');
assert(recommendFormat({ screenCount: 6, intentText: 'explore options' }).format === 'canvas',
  '6 exploratory screens → canvas');
assert(chooseWalkthroughNav(5) === 'anchor' && chooseWalkthroughNav(20) === 'lazy',
  'walkthrough nav: 5 → anchor, 20 → lazy');

// thin-spec decision (v0.13.1 — interactive asks, only headless dead-ends)
assert(decideThinSpec({ screenCount: 0 }).action === 'clarify',
  '0 screens interactive → clarify (no dead-end)');
assert(decideThinSpec({ screenCount: 0, format: 'walkthrough', from: 'spec' }).action === 'abort',
  '0 screens headless (both flags, non-describe) → abort');
assert(decideThinSpec({ screenCount: 0, from: 'describe' }).action === 'proceed',
  '0 screens with --from describe → proceed');

// 6 — escaping neutralizes a hostile string (XSS regression S1)
log('\nescaping (S1 regression):');
const hostile = '</script><img src=x onerror=alert(1)>';
assert(!hasUnsafeHtml(escapeHtml(hostile)), 'escapeHtml removes live markup');
assert(!embedJson({ label: hostile }).includes('</script>'), 'embedJson has no </script> breakout');
assert(JSON.parse(embedJson({ label: hostile })).label === hostile, 'embedJson preserves the value');

log('');
if (failures === 0) { log('✓ all design-asset conformance checks passed'); process.exit(0); }
log(`✗ ${failures} design-asset conformance check(s) failed`);
process.exit(1);
