#!/usr/bin/env node
// Select the Browser workflow lanes a pull request's changed files reach.
// Usage: node scripts/ci/browser-lanes.mjs --event <name> [--head-ref <ref>]
//   [--head-repo <owner/name>] [--repo <owner/name>] < changed-files.txt (one path per line)
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FILE_LIMIT,
  isVersionPullRequest,
  matchesPath,
  parseContext,
  SKILL_PROJECTIONS,
} from './workspace-jobs.mjs';

const SHARED = [
  'package.json',
  'package-lock.json',
  '.github/workflows/browser.yml',
  'scripts/ci/browser-lanes.mjs',
  'scripts/ci/workspace-jobs.mjs',
  'tests/support/browser-launcher.mjs',
];

/** Path prefixes (ending in `/` or `*`), or exact paths, that select each lane. */
export const LANES = Object.freeze({
  canvas: [
    'packages/canvas/',
    'packages/artifact/lib/artifact/ui/',
    'packages/artifact/tests/diagram-editor*',
    'packages/artifact/tests/fixtures/diagram-editor-canvas.mjs',
    ...SHARED,
  ],
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

/**
 * Returns `{ lane: boolean }` for every lane, given the changed file paths. A run other than a
 * pull request, such as the merge queue, runs every lane; an unedited version pull request
 * runs none.
 */
export function selectLanes(files, context = { event: 'pull_request' }) {
  const every = (selected) =>
    Object.fromEntries(Object.keys(LANES).map((lane) => [lane, selected]));
  if (context.event !== 'pull_request' || files.length >= FILE_LIMIT) return every(true);
  if (isVersionPullRequest(files, context)) return every(false);
  // No lane reads the skill projections, and static checks prove them against their sources.
  const reaching = files.filter(
    (file) => !SKILL_PROJECTIONS.some((pattern) => matchesPath(file, pattern)),
  );
  return Object.fromEntries(
    Object.entries(LANES).map(([lane, paths]) => [
      lane,
      reaching.some((file) => paths.some((pattern) => matchesPath(file, pattern))),
    ]),
  );
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const context = parseContext(process.argv.slice(2));
  const files = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  if (context.event === 'pull_request' && files.length === 0)
    throw new Error('browser-lanes: read no changed files on stdin');
  for (const [lane, selected] of Object.entries(selectLanes(files, context)))
    process.stdout.write(`${lane}=${selected}\n`);
}
