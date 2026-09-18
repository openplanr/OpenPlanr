#!/usr/bin/env node
// Carry the versions Changesets wrote into package-lock.json without re-resolving the tree.
//
// `npm install --package-lock-only` rewrites third-party resolution too: on CI it pruned
// vitest's nested esbuild and its platform packages, and `npm ci` then refused the lockfile.
// Only workspace versions and the ranges between workspaces change during versioning, so
// this writes exactly those fields.
//
// Usage: node scripts/release-train/sync-lockfile.mjs [--check]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const check = process.argv.includes('--check');
const lockPath = join(root, 'package-lock.json');
const original = readFileSync(lockPath, 'utf8');
const lock = JSON.parse(original);
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

// Workspace records are the only keys outside any node_modules tree.
const workspaceDirectories = Object.keys(lock.packages).filter(
  (path) => path.length > 0 && !path.split('/').includes('node_modules'),
);
const versions = new Map();
for (const directory of workspaceDirectories) {
  const manifest = JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8'));
  versions.set(manifest.name, { directory, manifest });
}

const changes = [];
for (const [name, { directory, manifest }] of versions) {
  const record = lock.packages[directory];
  if (record.version !== manifest.version) {
    changes.push(`${directory} ${record.version ?? '(none)'} -> ${manifest.version}`);
    record.version = manifest.version;
  }
  for (const field of DEPENDENCY_FIELDS) {
    const declared = manifest[field];
    if (!declared) continue;
    for (const [dependency, range] of Object.entries(declared)) {
      // Only ranges the manifest itself declares are copied; resolution stays untouched.
      if (record[field]?.[dependency] !== undefined && record[field][dependency] !== range) {
        changes.push(
          `${directory} ${field}.${dependency} ${record[field][dependency]} -> ${range}`,
        );
        record[field][dependency] = range;
      }
    }
  }
  if (name === lock.name && lock.version !== manifest.version && directory === '') {
    lock.version = manifest.version;
  }
}

const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (lock.name !== rootManifest.name)
  throw new Error('package-lock.json does not describe this workspace');
if (lock.version !== rootManifest.version) {
  changes.push(`root version ${lock.version} -> ${rootManifest.version}`);
  lock.version = rootManifest.version;
  lock.packages[''].version = rootManifest.version;
}

const updated = `${JSON.stringify(lock, null, 2)}\n`;
if (check) {
  if (updated !== original) {
    process.stderr.write(
      `package-lock.json is out of step with the workspace manifests:\n${changes.map((line) => `  ${line}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  process.stdout.write('package-lock.json matches the workspace manifests\n');
  process.exit(0);
}

if (updated === original) {
  process.stdout.write('package-lock.json already matches the workspace manifests\n');
} else {
  writeFileSync(lockPath, updated);
  process.stdout.write(
    `package-lock.json updated:\n${changes.map((line) => `  ${line}`).join('\n')}\n`,
  );
}
