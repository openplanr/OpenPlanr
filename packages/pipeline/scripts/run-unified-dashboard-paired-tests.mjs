#!/usr/bin/env node

import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pipelineRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const workspaceRoot = resolve(pipelineRoot, '../..');
const configuredOpenPlanrRoot = resolve(
  process.env.PLANR_OPENPLANR_ROOT || resolve(workspaceRoot, 'packages/cli'),
);
if (!existsSync(configuredOpenPlanrRoot)) {
  throw new Error(`paired OpenPlanr checkout does not exist: ${configuredOpenPlanrRoot}`);
}
const openPlanrRoot = realpathSync(configuredOpenPlanrRoot);
const openPlanrRequire = createRequire(resolve(openPlanrRoot, 'package.json'));
const typescript = openPlanrRequire.resolve('typescript/bin/tsc');
const vite = resolve(dirname(openPlanrRequire.resolve('vite/package.json')), 'bin/vite.js');
for (const path of [
  'package.json',
  'dist/dashboard/dashboard-manifest.json',
]) {
  if (!existsSync(resolve(openPlanrRoot, path))) {
    throw new Error(`paired OpenPlanr checkout is missing ${path}`);
  }
}
for (const [name, path] of [['TypeScript', typescript], ['Vite', vite]]) {
  if (!existsSync(path)) throw new Error(`workspace ${name} executable is missing: ${path}`);
}

const tests = [
  'tests/dashboard/dashboard-audit-display-packed.test.mjs',
  'tests/dashboard/dashboard-cycle-parity.test.mjs',
  'tests/dashboard/dashboard-display-packed.test.mjs',
  'tests/dashboard/dashboard-inbox-display-contract.test.mjs',
  'tests/dashboard/dashboard-planning-transport.test.mjs',
  'tests/dashboard/unified-dashboard-performance.test.mjs',
  'tests/ecosystem/unified-dashboard-consumer-install.test.mjs',
  'tests/ecosystem/unified-dashboard-package.test.mjs',
];
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: pipelineRoot,
  stdio: 'inherit',
  env: { ...process.env, PLANR_OPENPLANR_ROOT: openPlanrRoot },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
