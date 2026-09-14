#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Asserts CHANGELOG.md documents the version in package.json.
 *
 * Versions 0.37.0, 0.37.1 and 0.37.2 were tagged and published to npm with no
 * changelog section at all, and nothing detected it. This runs immediately
 * before `npm publish`, so a release cannot ship without its record.
 *
 * Deliberately standalone rather than part of the release audit: that audit
 * reconciles five repositories and needs them checked out, which a single-repo
 * publish job does not have. Wiring it here failed the publish with three
 * complaints about missing sibling repositories — a true report of a check that
 * did not belong in this context.
 *
 * Accepts both heading styles in use: `## 1.2.3` (changesets) and
 * `## [1.2.3] — date` (Keep a Changelog).
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
const changelog = readFileSync(join(repositoryRoot, 'CHANGELOG.md'), 'utf8');

const heading = new RegExp(`^#{1,3}\\s*\\[?v?${version.replace(/\./g, '\\.')}\\]?(?:\\s|$)`, 'm');

if (!heading.test(changelog)) {
  console.error(`CHANGELOG.md has no section for ${version}.`);
  console.error(`Add a "## [${version}]" section before tagging and publishing.`);
  process.exit(1);
}
console.log(`CHANGELOG.md documents ${version}.`);
