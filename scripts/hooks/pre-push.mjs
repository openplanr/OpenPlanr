#!/usr/bin/env node
// Run the static gates, then the small suites of the workspaces a push changes.
// Git passes "<local ref> <local sha> <remote ref> <remote sha>" lines on stdin.
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STATIC_GATES = [
  'check:generated',
  'check:boundaries',
  'check:docs',
  'check:comments',
  'check:diagrams',
  'lint',
  'typecheck:declarations',
];
// The suites short enough for a push; the rest stay in CI.
const SMALL_SUITES = Object.freeze({
  '@openplanr/protocol': ['packages/protocol/', 'tests/protocol/'],
  '@openplanr/canvas': ['packages/canvas/'],
  '@openplanr/operate': ['packages/operate/'],
  '@openplanr/artifact': ['packages/artifact/'],
  '@openplanr/integrations': ['packages/integrations/'],
  '@openplanr/dashboard-app': ['apps/dashboard/'],
});
const EVERY_SUITE = ['package.json', 'package-lock.json', 'tests/support/'];
const ZERO = /^0+$/u;

/** Returns the small-suite workspaces the changed files reach, in a stable order. */
export function suitesFor(files) {
  const touches = (prefixes) =>
    files.some((file) =>
      prefixes.some((prefix) => (prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix)),
    );
  if (touches(EVERY_SUITE)) return Object.keys(SMALL_SUITES);
  return Object.entries(SMALL_SUITES)
    .filter(([, prefixes]) => touches(prefixes))
    .map(([name]) => name);
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || result.status}`);
  return result.stdout.trim();
}

/** Lists the files the pushed refs change; a new branch is compared with origin/main. */
export function changedFiles(lines) {
  const files = new Set();
  for (const line of lines) {
    const [, local, , remote] = line.split(' ');
    if (!local || ZERO.test(local)) continue;
    const base = remote && !ZERO.test(remote) ? remote : git(['merge-base', 'origin/main', local]);
    for (const file of git(['diff', '--name-only', base, local]).split('\n'))
      if (file) files.add(file);
  }
  return [...files];
}

function run(args) {
  process.stdout.write(`pre-push: npm ${args.join(' ')}\n`);
  const result = spawnSync('npm', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.stderr.write(
      `pre-push: npm ${args.join(' ')} failed; fix it or push with --no-verify.\n`,
    );
    process.exit(result.status ?? 1);
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const lines = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  const suites = suitesFor(changedFiles(lines));
  for (const script of STATIC_GATES) run(['run', script, '--silent']);
  for (const workspace of suites) run(['test', `--workspace=${workspace}`]);
}
