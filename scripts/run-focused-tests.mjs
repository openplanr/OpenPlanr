#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliRoot = resolve(root, 'packages/cli');
const cliRequire = createRequire(resolve(cliRoot, 'package.json'));
const vitestManifestPath = cliRequire.resolve('vitest/package.json');
const vitestManifest = JSON.parse(readFileSync(vitestManifestPath, 'utf8'));
const vitestBin = typeof vitestManifest.bin === 'string' ? vitestManifest.bin : vitestManifest.bin.vitest;

const steps = Object.freeze([
  { id: 'release-versioning-and-publication-boundaries', cwd: root, args: ['--test', 'tests/ecosystem-root/release-versioning.test.mjs', 'tests/ecosystem-root/diagram-onboarding.test.mjs', 'tests/ecosystem-root/plugin-manifest-versions.test.mjs', 'tests/release-train/plan.test.mjs', 'tests/release-train/notes.test.mjs', 'tests/release-train/marketplace.test.mjs', 'tests/release-train/lockfile.test.mjs', 'tests/ecosystem-root/publication-custody.test.mjs', 'conformance/migration/private-decisions.test.mjs', 'conformance/migration/archived-dashboard.test.mjs', 'conformance/migration/archived-planning.test.mjs', 'conformance/migration/preservation-catalog.test.mjs'] },
  { id: 'host-adapter-generation-check', cwd: root, args: ['scripts/skills/generate-v18.mjs', '--check'] },
  { id: 'guided-host-package-tests', cwd: root, args: ['--test', 'tests/skill-runtime/generation.test.mjs'] },
  { id: 'host-adapter-parity', cwd: root, args: ['scripts/skills/check-host-parity.mjs'] },
  { id: 'runtime-purity', cwd: root, args: ['scripts/skills/check-runtime-purity.mjs'] },
  {
    id: 'design-source-studio-and-installed-workflow',
    cwd: root,
    args: [
      '--test',
      '--test-concurrency=1',
      'tests/protocol/design-contracts.test.mjs',
      'packages/artifact/tests/local-document.test.mjs',
      'packages/artifact/tests/pin-stability.test.mjs',
      'packages/artifact/tests/pin-stability.browser.test.mjs',
      'packages/design/tests/document.test.mjs',
      'packages/design/tests/publication.test.mjs',
      'packages/design/tests/review.test.mjs',
      'packages/design/tests/workspace-client.test.mjs',
      'packages/design/tests/studio.test.mjs',
      'packages/design/tests/studio.browser.test.mjs',
      'packages/design/tests/walkthrough-transitions.browser.test.mjs',
      'packages/design/tests/reviewer-workflow.browser.test.mjs',
      'packages/design/tests/mobile-loading.browser.test.mjs',
      'packages/design/tests/mobile-shell.browser.test.mjs',
      'packages/artifact/tests/frame-budget.test.mjs',
      'packages/artifact/tests/frame-budget.browser.test.mjs',
      'packages/design/tests/review-export.test.mjs',
      'packages/design/tests/review-export-local.test.mjs',
      'packages/design/tests/browser-audit.test.mjs',
      'tests/skill-runtime/design-installed-workflow.test.mjs',
    ],
  },
  { id: 'protocol-1.8-skill-package-contracts', cwd: root, args: ['--test', 'tests/protocol/skill-package-v18.test.mjs'] },
  {
    id: 'workspace-and-toolchain-boundaries',
    cwd: root,
    args: ['--test', 'tests/skill-runtime/authoring-toolchain.test.mjs', 'tests/skill-runtime/packaging.test.mjs'],
  },
  { id: 'shared-integrations', cwd: root, args: ['--test', 'packages/integrations/tests/portable-sync.test.mjs'] },
  { id: 'utility-command-boundary', cwd: cliRoot, args: ['scripts/check-command-catalog.mjs'] },
  {
    id: 'host-native-cli-regression',
    cwd: cliRoot,
    args: [
      resolve(dirname(vitestManifestPath), vitestBin),
      'run',
      'tests/unit/command-registration-parity.test.ts',
      'tests/unit/spec-command.test.ts',
      'tests/unit/spec-service.test.ts',
      'tests/unit/credentials-service.test.ts',
    ],
  },
  {
    id: 'diagram-protocol-and-artifact',
    cwd: root,
    args: [
      '--test',
      'tests/protocol/diagram-contracts.test.mjs',
      'packages/artifact/tests/diagram.test.mjs',
      'packages/artifact/tests/diagram-rendering.test.mjs',
      'packages/artifact/tests/diagram-integration.test.mjs',
      'packages/artifact/tests/diagram-studio.test.mjs',
      'packages/artifact/tests/diagram-studio.browser.test.mjs',
    ],
  },
  { id: 'diagram-skill-quality', cwd: root, args: ['scripts/skills/lint.mjs', 'skills/planr-diagram'] },
  { id: 'diagram-skill-evaluation', cwd: root, args: ['scripts/skills/evaluate.mjs', 'skills/planr-diagram'] },
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
  process.stdout.write(`${JSON.stringify({ ok: true, focusedGates: results.map(({ id }) => id) }, null, 2)}\n`);
}
