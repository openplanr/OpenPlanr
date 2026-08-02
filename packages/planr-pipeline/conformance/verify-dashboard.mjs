#!/usr/bin/env node
/**
 * Dashboard conformance for /planr-pipeline:dashboard (SPEC-016).
 *
 * Self-contained and deterministic — Node stdlib only, no npm deps (mirrors
 * conformance/verify-design-assets.mjs). It asserts the shipped dashboard
 * surfaces obey the project's hard constraints:
 *
 *   (a) palette fidelity — every hex color used in lib/dashboard/ and
 *       docs/dashboard.md is one of the design tokens declared in ds.css's
 *       TOKEN DEFINITION BLOCK (the committed palette source of truth, which
 *       mirrors design-spec.md §1); any off-palette value exits 1 with the
 *       offending file + hex.
 *   (b) brand hygiene — no third-party product codenames appear in any scanned
 *       file (fragment-assembled denylist, same approach as verify-design-assets).
 *   (c) schema presence — schemas/v1.0.0/graph.schema.json exists and parses as JSON.
 *
 * Exit 0 = all checks pass; non-zero = at least one failure.
 *
 * The vendored runtime under lib/dashboard/vendor/ (React + the reflow lib) is
 * attributed third-party code and is excluded from the palette + brand scans, the
 * same way verify-design-assets.mjs excludes templates/design/vendor/.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const log = (...a) => console.log(...a);
let failures = 0;
const ok = (label) => log(`  ✓ ${label}`);
const bad = (label, detail) => { log(`  ✗ ${label}`); if (detail) log(`    ${detail}`); failures += 1; };
const assert = (cond, label, detail) => (cond ? ok(label) : bad(label, detail));

const HEX_RE = /#[0-9a-fA-F]{3,8}/g;
// Text files the palette + brand scans cover (skip binaries / images).
const TEXT_EXT = /\.(md|mjs|js|jsx|html|json|css|svg|tpl)$/;

// ── scan scope ───────────────────────────────────────────────────────────────

const SCAN_ROOTS = ['lib/dashboard', 'docs/dashboard.md'];
const SCAN_SKIP = [
  'lib/dashboard/vendor', // attributed third-party runtime (React + reflow lib)
];

function* walkFiles(rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return;
  if (SCAN_SKIP.some((s) => rel === s || rel.startsWith(`${s}/`))) return;
  const stat = statSync(abs);
  if (stat.isFile()) { if (TEXT_EXT.test(rel)) yield rel; return; }
  for (const entry of readdirSync(abs)) yield* walkFiles(join(rel, entry));
}

const scannedFiles = [];
for (const start of SCAN_ROOTS) for (const rel of walkFiles(start)) scannedFiles.push(rel);

// ── allowed palette (from the design-system tokens) ──────────────────────────

/** Normalize a hex string to a comparable lowercase 6/8-digit form. */
function normHex(raw) {
  let h = raw.toLowerCase();
  if (h[0] === '#') h = h.slice(1);
  // expand 3-digit (#abc) and 4-digit (#abcd) shorthand to long form
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  return `#${h}`;
}

function loadPalette() {
  // The dashboard's palette source of truth is the TOKEN DEFINITION BLOCK at the
  // top of ds.css (its :root + .dark custom-property declarations) — the only
  // place raw hex is allowed. Deriving the allowed palette from that committed
  // block keeps this check self-contained and deterministic; the dogfooding
  // .planr/design-system/ that ds.css mirrors is gitignored and absent on CI.
  const dsPath = join(root, 'lib', 'dashboard', 'app', 'ds.css');
  const css = readFileSync(dsPath, 'utf-8');
  const end = css.indexOf('END TOKEN DEFINITION BLOCK');
  const block = end === -1 ? css : css.slice(0, end);
  const set = new Set();
  for (const m of block.match(HEX_RE) || []) set.add(normHex(m));
  return set;
}

log('planr dashboard conformance (SPEC-016)\n');

// 0 — there is something to scan (the dashboard exists)
log('scan scope:');
assert(scannedFiles.length > 0, 'lib/dashboard/ + docs/dashboard.md present and scannable',
  scannedFiles.length === 0 ? 'no dashboard files found under the scan roots' : undefined);

// (a) palette fidelity
log('\npalette fidelity (design-system tokens only):');
let palette;
try {
  palette = loadPalette();
  assert(palette.size > 0, `design-system token palette loaded (${palette.size} colors)`);
} catch (e) {
  palette = new Set();
  bad('ds.css token definition block is readable', String(e && e.message ? e.message : e));
}

const offPalette = [];
for (const rel of scannedFiles) {
  const text = readFileSync(join(root, rel), 'utf-8');
  for (const m of text.match(HEX_RE) || []) {
    if (!palette.has(normHex(m))) offPalette.push({ rel, hex: m });
  }
}
assert(
  offPalette.length === 0,
  'every hex color in the dashboard is a design-system token',
  offPalette.length > 0
    ? offPalette.map((o) => `off-palette ${o.hex} in ${o.rel}`).join('\n    ')
    : undefined,
);

// (b) brand hygiene — fragment-assembled denylist (this guard never spells a name)
log('\nbrand hygiene (proprietary — dashboard sources are codename-free):');
const FOREIGN_NAMES = ['ome' + 'lette', 'mu' + 'vi', 'gst' + 'ack'];
for (const name of FOREIGN_NAMES) {
  const re = new RegExp(name, 'i');
  let where = null;
  for (const rel of scannedFiles) {
    if (re.test(readFileSync(join(root, rel), 'utf-8'))) { where = rel; break; }
  }
  assert(!where, `dashboard sources are clean of codename #${FOREIGN_NAMES.indexOf(name) + 1}`,
    where ? `a forbidden codename was found in ${where}` : undefined);
}

// (c) schema presence — graph.schema.json exists and parses
log('\ngraph schema presence:');
const schemaPath = join(root, 'schemas', 'v1.0.0', 'graph.schema.json');
if (!existsSync(schemaPath)) {
  bad('schemas/v1.0.0/graph.schema.json exists', 'file is missing');
} else {
  try {
    const parsed = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    assert(parsed && typeof parsed === 'object', 'graph.schema.json is parseable JSON');
  } catch (e) {
    bad('graph.schema.json is parseable JSON', String(e && e.message ? e.message : e));
  }
}

log('');
if (failures === 0) { log('✓ all dashboard conformance checks passed'); process.exit(0); }
log(`✗ ${failures} dashboard conformance check(s) failed`);
process.exit(1);
