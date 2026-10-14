#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliRoot = resolve(root, 'packages/cli');

// Only gates no Workspace CI package job runs; package suites own their own test files.
const steps = Object.freeze([
  {
    id: 'release-versioning-and-publication-boundaries',
    cwd: root,
    args: [
      '--test',
      'tests/ecosystem-root/release-versioning.test.mjs',
      'tests/ecosystem-root/studio-candidate-pack.test.mjs',
      'tests/ecosystem-root/generator-graph.test.mjs',
      'tests/ecosystem-root/generated-ignore.test.mjs',
      'tests/ecosystem-root/generated-aggregate-merge.test.mjs',
      'tests/ecosystem-root/studio-style-compiler.test.mjs',
      'tests/ecosystem-root/ecosystem-generation.test.mjs',
      'tests/ecosystem-root/diagram-onboarding.test.mjs',
      'tests/ecosystem-root/plugin-manifest-versions.test.mjs',
      'tests/ecosystem-root/ecosystem-schema.test.mjs',
      'tests/release-train/plan.test.mjs',
      'tests/release-train/notes.test.mjs',
      'tests/release-train/marketplace.test.mjs',
      'tests/release-train/publish-marketplace.test.mjs',
      'tests/release-train/lockfile.test.mjs',
      'tests/release-train/cli-version.test.mjs',
      'tests/ecosystem-root/publication-custody.test.mjs',
      'tests/ecosystem-root/packed-surface-baseline.test.mjs',
      'tests/ecosystem-root/source-comments.test.mjs',
      'tests/ecosystem-root/verify-migration.test.mjs',
    ],
  },
  { id: 'host-adapter-parity', cwd: root, args: ['scripts/skills/check-host-parity.mjs'] },
  { id: 'runtime-purity', cwd: root, args: ['scripts/skills/check-runtime-purity.mjs'] },
  { id: 'utility-command-boundary', cwd: cliRoot, args: ['scripts/check-command-catalog.mjs'] },
  {
    id: 'diagram-skill-quality',
    cwd: root,
    args: ['scripts/skills/lint.mjs', 'skills/planr-diagram'],
  },
  {
    id: 'diagram-skill-evaluation',
    cwd: root,
    args: ['scripts/skills/evaluate.mjs', 'skills/planr-diagram'],
  },
]);

const results = [];
for (const [index, step] of steps.entries()) {
  process.stdout.write(`[${index + 1}/${steps.length}] ${step.id}\n`);
  const result = spawnSync(process.execPath, step.args, {
    cwd: step.cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  results.push({ id: step.id, status: result.status, signal: result.signal });
  if (result.error || result.signal || result.status !== 0) {
    process.stderr.write(`${JSON.stringify({ ok: false, failed: step.id, results }, null, 2)}\n`);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode !== 1) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, focusedGates: results.map(({ id }) => id) }, null, 2)}\n`,
  );
}
