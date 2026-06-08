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
  isOnSpacingScale, isCanonicalFrame, lintDesign, lintCanvasData, FRAMES, RESPONSIVE_FRAMES,
  designSystemStatus, resolveDesignSystem, contrastRatio, isReadable,
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
  'agents/modes/shared/design-principles.md',
  'lib/design/index.mjs',
  'lib/design/tokens.mjs',
  'lib/design/lint.mjs',
  'lib/design/designSystem.mjs',
  'lib/design/contrast.mjs',
  'procedures/design-system-generate.md',
  'templates/design-system/tokens.css.tpl',
  'templates/design-system/manifest.json.tpl',
  'templates/design-system/brand.md.tpl',
  'templates/design-system/components.md.tpl',
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

// 3b — desktop artboard sizing + front-loaded app context (v0.15.1)
log('\ndesktop sizing + app context (v0.15.1):');
assert(fileHas(canvasJs, '1440') && fileHas(canvasJs, '1024'),
  'DesignCanvas default artboard is desktop (1440×1024), not a 260×480 phone card');
assert(fileHas(join(root, 'templates/design/DesignCanvas.jsx'), 'width = 1440'),
  'DesignCanvas.jsx source default width is desktop (1440)');
assert(fileHas(canvasJs, '/ height, 1)') && !fileHas(canvasJs, '/ height, 2)'),
  'canvas focus overlay caps scale at 1:1 (never enlarges a desktop screen past real size — the zoom fix)');
const preflight = join(root, 'procedures/design-step0-preflight.md');
assert(fileHas(preflight, 'APP_CTX') && fileHas(preflight, 'VIEWPORT_W'),
  'preflight A.3.5 front-loads APP_CTX + VIEWPORT_W (read the project once, up front)');
const generate = join(root, 'procedures/design-step2-generate.md');
assert(fileHas(generate, 'VIEWPORT_W'), 'generate C.0/C.4 author at VIEWPORT_W (real desktop width)');

// 3c — token scale + deterministic linter (v0.16.0)
log('\ntoken scale + design linter (v0.16.0):');
assert(isOnSpacingScale(16) && isOnSpacingScale(24) && !isOnSpacingScale(14) && !isOnSpacingScale(13),
  'spacing scale: 16/24 on the 4-point grid, 13/14 off it');
assert(isCanonicalFrame({ w: 1440, h: 1024 }) && !isCanonicalFrame({ w: 1440, h: 760 }),
  'canonical frame: 1440×1024 ok, 1440×760 (the per-screen drift) rejected');
assert(lintDesign('<style>.a{margin-bottom:14px}</style>').ok === false,
  'linter FAILS off-grid spacing (14px)');
assert(lintDesign('<style>.a{margin-bottom:16px;padding:24px}</style>').ok === true,
  'linter PASSES on-grid spacing');
assert(lintCanvasData({ sections: [{ artboards: [{ id: 'x', width: 1440, height: 760 }] }] }).ok === false,
  'lintCanvasData FAILS an off-canonical artboard (1440×760)');
// the framework dogfoods its own grid — generated files inherit shell CSS, so the shells must be clean
for (const shell of ['prototype-shell.html', 'walkthrough-shell.html', 'canvas-shell.html']) {
  assert(lintDesign(readFileSync(join(root, 'templates/design', shell), 'utf-8')).ok,
    `${shell} is lint-clean (shells obey the 4-point grid)`);
}

// 3d — responsive breakpoint frames + device toggle (v0.17.0)
log('\nresponsive breakpoint frames (v0.17.0):');
assert(isCanonicalFrame({ w: 834, h: 1194 }), 'tablet frame 834×1194 is canonical');
assert(isCanonicalFrame(FRAMES.desktop) && isCanonicalFrame(FRAMES.mobile), 'desktop + mobile canonical');
assert(RESPONSIVE_FRAMES.length === 3 && RESPONSIVE_FRAMES.map((f) => f.name).join() === 'desktop,tablet,mobile',
  'RESPONSIVE_FRAMES = desktop → tablet → mobile');
const genDoc = readFileSync(join(root, 'procedures/design-step2-generate.md'), 'utf-8');
assert(/@container/.test(genDoc) && /container-type/.test(genDoc),
  'generate guidance uses container queries + container-type (not media queries)');
assert(/834|tablet/i.test(genDoc), 'generate guidance names the tablet breakpoint frame');
assert(fileHas(join(root, 'templates/design/prototype-shell.html'), 'dv-bar') &&
  fileHas(join(root, 'templates/design/prototype-shell.html'), 'container-type'),
  'prototype shell has the device toggle + a container-query viewport');
assert(fileHas(join(root, 'templates/design/walkthrough-shell.html'), 'data-w="834px"') &&
  fileHas(join(root, 'templates/design/walkthrough-shell.html'), 'container-type'),
  'walkthrough shell has the device toggle + container-query frames');
assert(fileHas(join(root, 'templates/design/canvas-shell.html'), 'DATA.css'),
  'canvas shell injects the shared stylesheet (DATA.css) for breakpoint frames');

// 3e — design system layer + adherence (v0.18.0)
log('\ndesign system + adherence (v0.18.0):');
assert(designSystemStatus({ hasPackage: true }).source === 'package'
  && designSystemStatus({ hasDesignMd: true }).source === 'design-md'
  && designSystemStatus({}).found === false,
  'designSystemStatus priority (package > design-md > … > none)');
const dsFixDir = join(root, 'tests/fixtures/design-system');
const dsFix = resolveDesignSystem({ dir: dsFixDir, projectRoot: dsFixDir });
assert(dsFix.found && dsFix.source === 'package' && dsFix.tokens.length >= 5,
  'resolveDesignSystem reads the package fixture (tokens parsed)');
assert(Math.abs(contrastRatio('#ffffff', '#000000') - 21) < 0.2, 'contrast #fff/#000 ≈ 21:1');
assert(contrastRatio('oklch(0.21 0.015 268)', 'oklch(1 0 0)') > 15,
  'oklch contrast resolves to a WCAG-grade value (dark on white)');
assert(isReadable('#000', '#fff') && !isReadable('#999', '#fff'),
  'isReadable: black ok, mid-gray fails AA');
assert(lintDesign('<style>.a{color:#999;background:#fff}</style>').ok === false,
  'linter FAILS sub-AA text/background contrast');
assert(lintDesign('<style>.a{color:#111;background:#fff}</style>').ok === true,
  'linter PASSES AA contrast');
assert(lintDesign('<style>.a{background:#11151c}</style>').warnings.some((w) => w.rule === 'color-not-token'),
  'linter WARNS raw-color usage (prefer a token)');
const preflightDoc = readFileSync(join(root, 'procedures/design-step0-preflight.md'), 'utf-8');
assert(/A\.3\.6/.test(preflightDoc) && /design system/i.test(preflightDoc),
  'preflight A.3.6 no-system gate present (generate / existing / describe)');
assert(fileHas(join(root, 'procedures/design-step2-generate.md'), 'contrast-below-aa')
  && fileHas(join(root, 'procedures/design-step2-generate.md'), 'tokens.css'),
  'generate step links the DS tokens.css + enforces the contrast gate');

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

// 7 — brand hygiene: no foreign product names in the shipped design assets (proprietary)
log('\nbrand hygiene (proprietary — no foreign brands):');
const brandAssets = [
  'templates/design/DesignCanvas.jsx', 'templates/design/vendor/DesignCanvas.js',
  'templates/design/canvas-shell.html', 'templates/design/walkthrough-shell.html',
  'templates/design/prototype-shell.html', 'templates/design/README.md',
  'lib/design/walkthroughNav.mjs', 'lib/design/manifest.mjs',
];
for (const brand of ['omelette', 'muvi', 'gstack']) {
  const where = brandAssets.find((rel) => new RegExp(brand, 'i').test(readFileSync(join(root, rel), 'utf-8')));
  assert(!where, `no foreign brand "${brand}" in shipped design assets${where ? ` (found in ${where})` : ''}`);
}

log('');
if (failures === 0) { log('✓ all design-asset conformance checks passed'); process.exit(0); }
log(`✗ ${failures} design-asset conformance check(s) failed`);
process.exit(1);
