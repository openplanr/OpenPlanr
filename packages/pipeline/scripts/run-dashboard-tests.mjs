#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const fixtureRoot = resolve(root, 'tests/dashboard/fixtures/unified-root');
const result = spawnSync(process.execPath, [
  'scripts/run-test-group.mjs',
  'tests/dashboard',
  '--exclude',
  'tests/dashboard/dashboard-planning-transport.test.mjs',
  '--exclude',
  'tests/dashboard/unified-dashboard-performance.test.mjs',
], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    OPENPLANR_DASHBOARD_ROOT: process.env.OPENPLANR_DASHBOARD_ROOT || fixtureRoot,
  },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
