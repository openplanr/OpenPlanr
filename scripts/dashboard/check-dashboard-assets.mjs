#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLI_DASHBOARD_OUTPUT,
  checkDashboardAssetOutput,
  checkDashboardAssetParity,
  DASHBOARD_APP_OUTPUT,
} from './copy-dashboard-assets.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dashboardAppRoot = resolve(workspaceRoot, 'apps/dashboard');

function buildTemporaryDashboard(output) {
  const result = spawnSync(
    'npm',
    ['run', 'build', '--workspace=@openplanr/dashboard-app', '--', '--outDir', output],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    },
  );
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `Temporary dashboard verification build failed${result.signal ? ` with ${result.signal}` : ''}${
        details ? `:\n${details}` : ''
      }`,
    );
  }
}

if (process.argv.length !== 3 || process.argv[2] !== '--check') {
  process.stderr.write('Usage: node scripts/dashboard/check-dashboard-assets.mjs --check\n');
  process.exitCode = 2;
} else {
  // Vite source maps include paths relative to the configured output. Temporarily
  // rebuild at the canonical path, then restore the caller's ignored build tree.
  const hadExistingOutput = existsSync(DASHBOARD_APP_OUTPUT);
  if (hadExistingOutput) {
    const metadata = lstatSync(DASHBOARD_APP_OUTPUT);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('Dashboard app output must be one real directory.');
    }
  }
  const temporaryRoot = mkdtempSync(join(dashboardAppRoot, '.dashboard-check-'));
  const backupOutput = join(temporaryRoot, 'dist');
  let backedUpOutput = false;
  try {
    if (hadExistingOutput) {
      renameSync(DASHBOARD_APP_OUTPUT, backupOutput);
      backedUpOutput = true;
    }
    buildTemporaryDashboard(DASHBOARD_APP_OUTPUT);
    const destinationPresent = existsSync(CLI_DASHBOARD_OUTPUT);
    const report = destinationPresent
      ? checkDashboardAssetParity({
          source: DASHBOARD_APP_OUTPUT,
          destination: CLI_DASHBOARD_OUTPUT,
        })
      : checkDashboardAssetOutput(DASHBOARD_APP_OUTPUT, 'Rebuilt dashboard output');
    process.stdout.write(
      `${JSON.stringify({
        ...report,
        custody: 'isolated-canonical-rebuild',
        packageCopy: destinationPresent ? 'exact' : 'deferred-to-build',
      })}\n`,
    );
  } finally {
    if (existsSync(DASHBOARD_APP_OUTPUT)) {
      rmSync(DASHBOARD_APP_OUTPUT, { recursive: true, force: true });
    }
    if (backedUpOutput) renameSync(backupOutput, DASHBOARD_APP_OUTPUT);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
