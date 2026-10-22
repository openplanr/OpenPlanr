#!/usr/bin/env node
// Select the Browser workflow lanes a pull request's changed files reach.
// Usage: node scripts/ci/browser-lanes.mjs < changed-files.txt (one path per line)
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHARED = [
  'package.json',
  'package-lock.json',
  '.github/workflows/browser.yml',
  'scripts/ci/browser-lanes.mjs',
  'tests/support/browser-launcher.mjs',
];

/** Path prefixes, or exact paths, that select each lane. */
export const LANES = Object.freeze({
  canvas: ['packages/canvas/', ...SHARED],
  dashboard: [
    'apps/dashboard/',
    'packages/cli/tests/dashboard/',
    'packages/cli/tests/e2e/',
    'packages/cli/scripts/run-dashboard-browser-tests.mjs',
    'packages/cli/vite.dashboard.fixture.config.ts',
    'packages/operate/',
    'packages/pipeline/lib/dashboard/',
    'packages/protocol/',
    'scripts/dashboard/',
    ...SHARED,
  ],
  artifact: [
    'packages/artifact/',
    'packages/pipeline/lib/artifact/',
    'packages/pipeline/tests/artifact/',
    ...SHARED,
  ],
});

/** Returns `{ lane: boolean }` for every lane, given the changed file paths. */
export function selectLanes(files) {
  return Object.fromEntries(
    Object.entries(LANES).map(([lane, paths]) => [
      lane,
      files.some((file) =>
        paths.some((path) => (path.endsWith('/') ? file.startsWith(path) : file === path)),
      ),
    ]),
  );
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const files = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  if (files.length === 0) throw new Error('browser-lanes: read no changed files on stdin');
  for (const [lane, selected] of Object.entries(selectLanes(files)))
    process.stdout.write(`${lane}=${selected}\n`);
}
