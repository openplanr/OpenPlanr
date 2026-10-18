#!/usr/bin/env node
// Fail a pull request whose changeset bumps do not match its Conventional Commit type.
// Usage: node scripts/release-train/check-changeset-bump.mjs --pr <pull.json> --files <files.json> [--root <dir>]
// pull.json is the REST pull request (title, body, labels); files.json is the slurped
// `gh api --paginate --slurp .../files` output, an array of pages of { filename, status }.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkChangesetBumps, parseChangeset } from './lib/changeset-bump.mjs';
import { PUBLIC_TARGETS } from './lib/targets.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) throw new Error(`Missing ${name} <path>`);
  return args[index + 1];
};
const root = args.includes('--root')
  ? resolve(flag('--root'))
  : resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const pull = JSON.parse(readFileSync(flag('--pr'), 'utf8'));
const files = JSON.parse(readFileSync(flag('--files'), 'utf8')).flat();
const changesets = files
  .filter(
    ({ filename, status }) =>
      /^\.changeset\/[^/]+\.md$/u.test(filename) &&
      filename !== '.changeset/README.md' &&
      status !== 'removed',
  )
  .map(({ filename }) => ({
    file: filename,
    releases: parseChangeset(readFileSync(join(root, filename), 'utf8'), filename),
  }));

const { errors, warnings } = checkChangesetBumps({
  title: pull.title,
  body: pull.body ?? '',
  labels: pull.labels.map((label) => label.name),
  files: files.map(({ filename }) => filename),
  changesets,
  targets: PUBLIC_TARGETS,
});

const annotate = process.env.GITHUB_ACTIONS === 'true';
for (const warning of warnings) console.log(`${annotate ? '::warning::' : 'warning: '}${warning}`);
for (const error of errors) console.error(`${annotate ? '::error::' : 'error: '}${error}`);
if (errors.length > 0) process.exit(1);
console.log(
  `Changeset bumps match ${JSON.stringify(pull.title)} (${changesets.length} changeset(s)).`,
);
