#!/usr/bin/env node
/**
 * BL-010: single source of truth for every cross-package version pin.
 *
 * The monorepo uses INDEPENDENT versions (ADR-013), so "one semver" is not what
 * kills drift — *generating* every pin is. Hand-maintained pins are the actual
 * drift mechanism, and they are what this script removes.
 *
 * Division of labour, deliberately reusing what already exists:
 *   - packages/marketplace/scripts/generate-ecosystem.mjs already generates the
 *     marketplace manifest, ecosystem.json and README table, and already resolves
 *     its siblings via OPENPLANR_ECOSYSTEM_ROOT ?? <repo>/.. — which in the
 *     monorepo is packages/. It needs no changes and is delegated to here.
 *   - planr-pipeline already owns generate/check pairs for its operating assets,
 *     guided adapters and artifact shell.
 *   - What nothing owned: four prose version strings in the planr-pipeline docs.
 *     Those are stamped below.
 *
 * Usage:
 *   node scripts/sync-ecosystem.mjs           # write
 *   node scripts/sync-ecosystem.mjs --check   # verify, non-zero on drift (CI gate)
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = join(root, 'packages');
const check = process.argv.includes('--check');

const version = (pkg) =>
  JSON.parse(readFileSync(join(packages, pkg, 'package.json'), 'utf8')).version;

const pipelineVersion = version('planr-pipeline');

/**
 * Prose pins: [file, regex with ONE capture group around the version, label].
 * The pattern must anchor on surrounding text so an unrelated semver elsewhere
 * in the file is never rewritten.
 */
const prosePins = [
  ['planr-pipeline/input/tech/stack.md', /(?<=^Version: ")(\d+\.\d+\.\d+)(?="$)/gm, 'stack.md Version'],
  [
    'planr-pipeline/docs/protocol/README.md',
    /(?<=Current engine: planr-pipeline v)(\d+\.\d+\.\d+)/g,
    'protocol README engine',
  ],
  [
    'planr-pipeline/docs/compatibility-matrix.md',
    /(?<=planr-pipeline v)(\d+\.\d+\.\d+)/g,
    'compatibility matrix',
  ],
];

const drift = [];

for (const [relative, pattern, label] of prosePins) {
  const path = join(packages, relative);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(pattern, pipelineVersion);
  if (before === after) continue;
  if (check) {
    const stale = [...before.matchAll(pattern)].map((m) => m[0]).filter((v) => v !== pipelineVersion);
    drift.push(`${relative} (${label}): ${[...new Set(stale)].join(', ')} != ${pipelineVersion}`);
  } else {
    writeFileSync(path, after);
    console.log(`  updated ${relative} -> ${pipelineVersion}`);
  }
}

// Delegate the marketplace manifest / ecosystem.json / README table.
const delegate = spawnSync(
  process.execPath,
  [join(packages, 'marketplace', 'scripts', 'generate-ecosystem.mjs'), ...(check ? ['--check'] : [])],
  { cwd: join(packages, 'marketplace'), encoding: 'utf8' }
);
if (delegate.status !== 0) {
  drift.push(`marketplace generator: ${(delegate.stdout || delegate.stderr || '').trim()}`);
}

if (drift.length > 0) {
  console.error('Ecosystem pins are out of sync:');
  for (const d of drift) console.error(`  - ${d}`);
  console.error('\nRun: node scripts/sync-ecosystem.mjs');
  process.exit(1);
}

console.log(
  check
    ? 'Ecosystem pins are in sync.'
    : `Ecosystem pins synchronized (planr-pipeline ${pipelineVersion}).`
);
