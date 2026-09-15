#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

const removedExactPaths = [
  'lib/dashboard/app/ds.css',
  'lib/dashboard/app/index.html',
  'lib/dashboard/app/main.js',
  'lib/dashboard/app/shell.js',
  'lib/dashboard/app/empty-state.js',
  'lib/dashboard/app/display-id.js',
  'lib/dashboard/app/metadata.js',
  'lib/dashboard/app/styles/operate-product.css',
  'lib/dashboard/app/styles/operate.css',
  'lib/dashboard/app/views/detail.js',
  'lib/dashboard/app/views/operate.js',
  'lib/dashboard/app/views/planning-operating-origin.js',
];

const removedPrefixes = [
  'lib/dashboard/app/operate/',
  'lib/dashboard/app/views/operate/',
  'lib/dashboard/app/vendor/',
];

for (const relativePath of removedExactPaths) {
  assert.equal(existsSync(join(root, relativePath)), false, `legacy dashboard path remains: ${relativePath}`);
}

const residualAppPaths = existsSync(join(root, 'lib/dashboard/app'))
  ? readdirSync(join(root, 'lib/dashboard/app'), { recursive: true })
    .map((entry) => `lib/dashboard/app/${String(entry).replaceAll('\\', '/')}`)
  : [];

for (const relativePath of residualAppPaths) {
  assert.equal(
    removedPrefixes.some((prefix) => relativePath.startsWith(prefix)),
    false,
    `legacy dashboard subtree remains: ${relativePath}`,
  );
}

assert.equal(existsSync(join(root, 'lib/dashboard/resolve-packaged-dashboard-root.mjs')), true);

process.stdout.write(`${JSON.stringify({
  ok: true,
  removedExactPaths: removedExactPaths.length,
  residualAppPaths: residualAppPaths.length,
})}\n`);
