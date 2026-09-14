#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyDashboardAssets } from './copy-dashboard-assets.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const result = spawnSync(
  'npm',
  ['run', 'build', '--workspace=@openplanr/dashboard-app'],
  { cwd: workspaceRoot, env: process.env, stdio: 'inherit' },
);
if (result.error) throw result.error;
if (result.signal || result.status !== 0) {
  throw new Error(`Dashboard app build failed${result.signal ? ` with ${result.signal}` : ''}.`);
}
const report = copyDashboardAssets();
process.stdout.write(`${JSON.stringify(report)}\n`);
