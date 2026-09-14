#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2];
if (!command || !/^[a-z][a-z0-9:-]*$/u.test(command)) {
  throw new Error('Usage: node scripts/workspace-command.mjs <script-name>');
}

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const declared = new Set(manifest.workspaces ?? []);
const order = [
  'packages/protocol',
  'packages/operate',
  'packages/artifact',
  'packages/design',
  'packages/integrations',
  'packages/pipeline',
  'packages/skill-runtime',
  'apps/dashboard',
  'packages/cli',
];
if (order.length !== declared.size || order.some((workspace) => !declared.has(workspace))) {
  throw new Error('The explicit workspace list does not match the dependency-order runner.');
}

const npmExecPath = process.env.npm_execpath;
for (const workspace of order) {
  const packageManifest = JSON.parse(readFileSync(resolve(root, workspace, 'package.json'), 'utf8'));
  if (!packageManifest.scripts?.[command]) continue;
  process.stdout.write(`\n[${packageManifest.name}] ${command}\n`);
  const executable = npmExecPath ? process.execPath : 'npm';
  const args = npmExecPath
    ? [npmExecPath, 'run', command, '--workspace', workspace]
    : ['run', command, '--workspace', workspace];
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
