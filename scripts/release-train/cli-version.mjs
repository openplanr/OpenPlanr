#!/usr/bin/env node
// Fail the version step when the CLI version Changesets wrote is not newer than every published one.
//
// Usage: node scripts/release-train/cli-version.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCliVersionAhead } from './lib/cli-version.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { name, version } = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'));
if (name !== 'openplanr') throw new Error(`packages/cli declares ${name}, expected openplanr`);

const listed = JSON.parse(
  execFileSync('npm', ['view', name, 'versions', '--json'], { encoding: 'utf8' }),
);
const pending = assertCliVersionAhead({ current: version, published: [listed].flat() });
process.stdout.write(
  pending
    ? `${name} ${version} is pending release\n`
    : `${name} ${version} is already published; no CLI release is pending\n`,
);
