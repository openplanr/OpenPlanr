#!/usr/bin/env node
// Number a pending CLI release by the week it is prepared in: <major>.<YYWW>.<n>.
//
// Runs after `changeset version`, which decides whether the CLI releases at all and whether
// the release is a new major. The registry is the source of truth for earlier releases.
//
// Usage: node scripts/release-train/cli-version.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCliVersion, cliReleaseVersion } from './lib/cli-version.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { name, version } = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'));
if (name !== 'openplanr') throw new Error(`packages/cli declares ${name}, expected openplanr`);

const listed = JSON.parse(execFileSync('npm', ['view', name, 'versions', '--json'], { encoding: 'utf8' }));
const next = cliReleaseVersion({ current: version, published: [listed].flat(), date: new Date() });

if (next === null) {
  process.stdout.write(`${name} ${version} is already published; no CLI release is pending\n`);
} else if (next === version) {
  process.stdout.write(`${name} ${version} already follows the release week\n`);
} else {
  applyCliVersion({ root, from: version, to: next });
  process.stdout.write(`${name} ${version} -> ${next}\n`);
}
