#!/usr/bin/env node
// Select the Workspace CI test jobs a pull request's changed files reach.
// Usage: node scripts/ci/workspace-jobs.mjs --event <name> [--head-ref <ref>]
//   [--head-repo <owner/name>] [--repo <owner/name>] < changed-files.txt (one path per line)
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The Workspace CI jobs a change can skip; build, static checks and the gate always run. */
export const JOBS = Object.freeze([
  'design-tests',
  'supporting-package-tests',
  'skill-runtime-tests',
  'pipeline-tests',
  'cli-tests',
]);
const [DESIGN, SUPPORTING, SKILL_RUNTIME, PIPELINE, CLI] = JOBS;
// Pipeline embeds projections of protocol, canvas, artifact, operate and design, and the CLI
// embeds pipeline, so most source changes reach these four suites.
const SHARED_READERS = Object.freeze([SUPPORTING, SKILL_RUNTIME, PIPELINE, CLI]);

/** The pull request files API lists at most this many files, so a longer list is incomplete. */
export const FILE_LIMIT = 3000;

/** The release branch Version packages opens with `npm run version-packages:ci`. */
export const VERSION_BRANCH = 'changeset-release/main';

/**
 * What that script writes: `changeset version` bumps workspace manifests, writes changelogs
 * and deletes changesets, `sync-lockfile.mjs` carries the versions into the lockfile, and
 * `npm run generate` refreshes the projections that digest the manifests.
 */
export const VERSION_FILES = Object.freeze([
  '.changeset/',
  'packages/*/package.json',
  'apps/*/package.json',
  'packages/*/CHANGELOG.md',
  'apps/*/CHANGELOG.md',
  'package-lock.json',
  'adapters/manifests/',
  '.claude-plugin/',
  'docs/generated/',
]);

/** Tracked outputs `npm run generate` derives from skills, agents and package metadata. */
export const SKILL_PROJECTIONS = Object.freeze([
  'packages/protocol/registries/skills.json',
  'packages/protocol/registries/commands.json',
  'packages/protocol/src/generated/canonical-registries.mjs',
  'packages/pipeline/lib/generated/protocol-projection.json',
  'adapters/',
  'docs/generated/',
  '.claude-plugin/',
]);

/**
 * Ordered rules; the first rule with a matching path decides a file's jobs. A path ending in
 * `/` matches everything below it, a trailing `*` matches any suffix, and an inner `*` matches
 * within one path segment. A file no rule matches selects every job.
 */
export const RULES = Object.freeze([
  { paths: SKILL_PROJECTIONS, jobs: SHARED_READERS },
  // The CLI suite scans every installed skill document, and protocol digests each SKILL.md.
  { paths: ['skills/', 'agents/', 'evaluation/'], jobs: SHARED_READERS },
  { paths: ['examples/'], jobs: [SKILL_RUNTIME] },
  { paths: ['docs/maintainers/pipeline/'], jobs: [PIPELINE] },
  // The protocol theme generator reads the brand assets.
  { paths: ['docs/assets/'], jobs: JOBS },
  {
    paths: [
      'docs/',
      '.changeset/',
      '*.md',
      'LICENSE',
      '.editorconfig',
      '.husky/',
      '.lintstagedrc.mjs',
      'scripts/hooks/',
      'tests/ci/',
      'tests/ecosystem-root/',
      'tests/release-train/',
      'tests/dashboard-app/',
      'tests/performance/',
    ],
    jobs: [],
  },
  { paths: ['tests/skill-runtime/'], jobs: [SKILL_RUNTIME] },
  { paths: ['tests/protocol/fixtures/'], jobs: [SUPPORTING, SKILL_RUNTIME, CLI] },
  { paths: ['tests/protocol/'], jobs: [SUPPORTING] },
  // Dependency manifests decide module resolution, and custody manifests digest each one.
  { paths: ['packages/*/package.json', 'apps/*/package.json'], jobs: JOBS },
  {
    paths: ['packages/cli/', 'packages/pipeline/', 'packages/skill-runtime/'],
    jobs: SHARED_READERS,
  },
  { paths: ['packages/integrations/'], jobs: [SUPPORTING, CLI] },
  { paths: ['apps/dashboard/'], jobs: [SUPPORTING, PIPELINE, CLI] },
  {
    paths: [
      'packages/',
      'scripts/',
      'tests/support/',
      'conformance/',
      '.github/',
      'package.json',
      'package-lock.json',
      '.npmrc',
      '.nvmrc',
      '.gitignore',
      '.gitattributes',
      'biome.jsonc',
      'tsconfig*',
    ],
    jobs: JOBS,
  },
]);

const escapeRegExp = (text) => text.replace(/[.+?^${}()|[\]\\]/gu, '\\$&');

/** Whether a repository-relative file matches a selector path pattern. */
export function matchesPath(file, pattern) {
  const prefix = pattern.endsWith('/') || pattern.endsWith('*');
  const body = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
  const source = body.split('*').map(escapeRegExp).join('[^/]*');
  return new RegExp(`^${source}${prefix ? '' : '$'}`, 'u').test(file);
}

/** Returns the jobs one changed file selects. */
export function jobsFor(file) {
  return (
    RULES.find(({ paths }) => paths.some((pattern) => matchesPath(file, pattern)))?.jobs ?? JOBS
  );
}

/** Whether a run is the Version packages pull request from this repository, unedited. */
export function isVersionPullRequest(files, { event, headRef, headRepo, repo }) {
  return (
    event === 'pull_request' &&
    headRef === VERSION_BRANCH &&
    !!repo &&
    headRepo === repo &&
    files.every((file) => VERSION_FILES.some((pattern) => matchesPath(file, pattern)))
  );
}

/**
 * Returns `{ job: boolean }` for every selectable job. Anything other than a pull request with a
 * complete, non-empty file list selects every job; the merge queue run always tests in full.
 */
export function selectJobs(files, context) {
  const every = (selected) => Object.fromEntries(JOBS.map((job) => [job, selected]));
  if (context.event !== 'pull_request' || files.length === 0 || files.length >= FILE_LIMIT)
    return every(true);
  if (isVersionPullRequest(files, context)) return every(false);
  const selected = new Set(files.flatMap(jobsFor));
  return Object.fromEntries(JOBS.map((job) => [job, selected.has(job)]));
}

/** Reads `--name value` pairs into a run context. */
export function parseContext(args) {
  const value = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const event = value('--event');
  if (!event) throw new Error('workspace-jobs: --event is required');
  return {
    event,
    headRef: value('--head-ref'),
    headRepo: value('--head-repo'),
    repo: value('--repo'),
  };
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const context = parseContext(process.argv.slice(2));
  const files = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  // Quoted, so a contributor's file name can never start a workflow command line.
  for (const file of files)
    process.stderr.write(`${JSON.stringify(file)}: ${jobsFor(file).join(', ') || '-'}\n`);
  for (const [job, selected] of Object.entries(selectJobs(files, context)))
    process.stdout.write(`${job}=${selected}\n`);
}
