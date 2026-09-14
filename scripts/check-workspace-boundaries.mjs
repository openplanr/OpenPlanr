#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_PACKAGE_PATHS, WORKSPACE_IDENTITIES, validateWorkspaceManifests } from './lib/workspace-release-policy.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedWorkspaces = Object.freeze(Object.keys(WORKSPACE_IDENTITIES));
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx']);
const manifestByPath = new Map();
const failures = [];

function invariant(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) files.push(path);
    }
  };
  visit(root);
  return files;
}

function importedSpecifiers(source) {
  const values = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) values.push(match[1]);
  }
  return values;
}

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

const rootManifest = readJson(join(workspaceRoot, 'package.json'));
for (const workspacePath of expectedWorkspaces) {
  const manifestPath = join(workspaceRoot, workspacePath, 'package.json');
  invariant(existsSync(manifestPath), `${workspacePath} must contain package.json`);
  if (existsSync(manifestPath)) manifestByPath.set(workspacePath, readJson(manifestPath));
  invariant(!existsSync(join(workspaceRoot, workspacePath, 'package-lock.json')), `${workspacePath} must not own an active package lockfile`);
}

failures.push(...validateWorkspaceManifests(rootManifest, manifestByPath));

const runtimeRoots = Object.freeze({
  'packages/cli': ['src', 'lib', 'bin'],
  'packages/pipeline': ['lib', 'bin'],
  'packages/protocol': ['src', 'lib'],
  'packages/operate': ['lib'],
  'packages/artifact': ['lib'],
  'packages/design': ['lib'],
  'packages/skill-runtime': ['src'],
  'packages/integrations': ['src'],
  'apps/dashboard': ['src'],
});
const allowedInternalImports = Object.freeze({
  'packages/cli': new Set(),
  'packages/pipeline': new Set(),
  'packages/protocol': new Set(),
  'packages/operate': new Set(['@openplanr/protocol']),
  'packages/artifact': new Set(['@openplanr/protocol']),
  'packages/design': new Set(['@openplanr/artifact', '@openplanr/protocol']),
  'packages/skill-runtime': new Set(['@openplanr/protocol']),
  'packages/integrations': new Set(),
  'apps/dashboard': new Set(['@openplanr/protocol']),
});

let scannedFiles = 0;
let scannedImports = 0;
for (const [workspacePath, roots] of Object.entries(runtimeRoots)) {
  for (const root of roots) {
    for (const path of listFiles(join(workspaceRoot, workspacePath, root))) {
      scannedFiles += 1;
      const displayPath = relative(workspaceRoot, path).split(sep).join('/');
      for (const specifier of importedSpecifiers(readFileSync(path, 'utf8'))) {
        scannedImports += 1;
        invariant(!specifier.includes('conformance/'), `${displayPath} imports conformance runtime code: ${specifier}`);
        const name = packageName(specifier);
        if (name.startsWith('@openplanr/')) {
          invariant(allowedInternalImports[workspacePath].has(name), `${displayPath} has forbidden internal import ${specifier}`);
        }
        invariant(name !== 'openplanr', `${displayPath} imports the CLI package`);
      }
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    workspaces: expectedWorkspaces.length,
    publicPackages: PUBLIC_PACKAGE_PATHS.length,
    privatePackages: expectedWorkspaces.length - PUBLIC_PACKAGE_PATHS.length,
    scannedFiles,
    scannedImports,
    policies: [
      'explicit-workspace-list',
      'single-active-lockfile',
      'exact-cli-pipeline-pin',
      'public-package-self-containment',
      'no-runtime-conformance-imports',
      'no-internal-cli-dependencies',
      'artifact-does-not-depend-on-design',
    ],
  }, null, 2)}\n`);
}
