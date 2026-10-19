import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  checkChangesetBumps,
  MAJOR_APPROVAL_LABEL,
  parseChangeset,
  parseTitle,
} from '../../scripts/release-train/lib/changeset-bump.mjs';
import { BUNDLED_SOURCES, PUBLIC_TARGETS } from '../../scripts/release-train/lib/targets.mjs';

const script = resolve('scripts/release-train/check-changeset-bump.mjs');

function check({ title, body, labels = [], files = [], releases }) {
  const changesets = releases ? [{ file: '.changeset/change.md', releases }] : [];
  return checkChangesetBumps({
    title,
    body,
    labels,
    files: releases ? [...files, '.changeset/change.md'] : files,
    changesets,
    targets: PUBLIC_TARGETS,
    bundled: BUNDLED_SOURCES,
  });
}

test('reads the type and breaking marker from Conventional Commit titles', () => {
  assert.deepEqual(parseTitle('feat(cli): add repair'), { type: 'feat', breaking: false });
  assert.deepEqual(parseTitle('feat!: drop Node 20'), { type: 'feat', breaking: true });
  assert.deepEqual(parseTitle('fix(skills)!: rename a flag'), { type: 'fix', breaking: true });
  assert.equal(parseTitle('Add repair'), null);
  assert.equal(parseTitle('feat:missing space'), null);
});

test('reads quoted and bare releases and rejects unreadable lines', () => {
  assert.deepEqual(
    parseChangeset(
      '---\n\'openplanr\': minor\n"@openplanr/protocol": patch\n---\n\nText.\n',
      'a.md',
    ),
    { openplanr: 'minor', '@openplanr/protocol': 'patch' },
  );
  assert.deepEqual(parseChangeset('---\n---\n', 'empty.md'), {});
  assert.throws(
    () => parseChangeset("---\n'openplanr': huge\n---\n", 'b.md'),
    /b\.md: cannot read/u,
  );
  assert.throws(() => parseChangeset('No frontmatter', 'c.md'), /c\.md: no changeset frontmatter/u);
});

test('a feature needs a minor for a published package it changes', () => {
  const patch = check({ title: 'feat(cli): add repair', releases: { openplanr: 'patch' } });
  assert.deepEqual(patch.errors, [
    'feat: openplanr declares patch in .changeset/change.md; requires minor. Change it to "openplanr": minor.',
  ]);
  assert.deepEqual(
    check({ title: 'feat(cli): add repair', releases: { openplanr: 'minor' } }).errors,
    [],
  );
  const missing = check({ title: 'feat(cli): add repair', files: ['packages/cli/src/index.ts'] });
  assert.deepEqual(missing.errors, [
    'feat: openplanr changes with no changeset; requires minor. Add a changeset with "openplanr": minor.',
  ]);
});

test('a new canvas package accepts its first minor changeset and rejects a missing bump', () => {
  const files = ['packages/canvas/package.json', 'packages/canvas/src/index.mts'];
  assert.deepEqual(
    check({
      title: 'feat(canvas): add public package scaffold',
      files,
      releases: { '@openplanr/canvas': 'minor' },
    }),
    { errors: [], warnings: [] },
  );
  assert.equal(
    check({ title: 'feat(canvas): add public package scaffold', files }).errors.length,
    1,
  );
});

test('skill and adapter sources count as changes to openplanr', () => {
  const skillsOnly = check({
    title: 'feat(skills): offer findings',
    files: ['skills/planr-ship/SKILL.md'],
  });
  assert.deepEqual(skillsOnly.errors, [
    'feat: openplanr changes with no changeset; requires minor. Add a changeset with "openplanr": minor.',
  ]);
  assert.deepEqual(
    check({
      title: 'feat(skills): offer findings',
      files: ['skills/planr-ship/SKILL.md', 'adapters/manifests/canonical-skills.json'],
      releases: { openplanr: 'minor' },
    }).errors,
    [],
  );
});

test('one package reaching the bump covers generated changes in the others', () => {
  const files = [
    'packages/cli/src/index.ts',
    'packages/pipeline/lib/generated/protocol-projection.json',
    'packages/protocol/registries/skills.json',
    'skills/planr-ship/SKILL.md',
  ];
  assert.deepEqual(
    check({ title: 'feat: offer findings', files, releases: { openplanr: 'minor' } }),
    { errors: [], warnings: [] },
  );
  const patches = check({
    title: 'feat: offer findings',
    files,
    releases: { openplanr: 'patch', '@openplanr/protocol': 'patch' },
  });
  assert.deepEqual(patches.errors, [
    'feat: @openplanr/protocol declares patch in .changeset/change.md; requires minor. Change it to "@openplanr/protocol": minor.',
    'feat: planr-pipeline changes with no changeset; requires minor. Add a changeset with "planr-pipeline": minor.',
    'feat: openplanr declares patch in .changeset/change.md; requires minor. Change it to "openplanr": minor.',
  ]);
});

test('a fix needs a release when it declares one and only warns when it has none', () => {
  assert.deepEqual(check({ title: 'fix: keep exit codes', releases: { openplanr: 'patch' } }), {
    errors: [],
    warnings: [],
  });
  const none = check({ title: 'perf: cache reads', releases: { openplanr: 'none' } });
  assert.match(none.errors[0], /^perf: openplanr declares none .*requires patch/u);
  const missing = check({ title: 'fix(deps): bump sharp', files: ['packages/cli/package.json'] });
  assert.deepEqual(missing.errors, []);
  assert.match(missing.warnings[0], /^fix: openplanr changes with no changeset; requires patch/u);
});

test('other types need no changeset and private packages are ignored', () => {
  assert.deepEqual(check({ title: 'docs: fix a link', files: ['README.md'] }), {
    errors: [],
    warnings: [],
  });
  assert.deepEqual(
    check({ title: 'feat(design): new board', releases: { '@openplanr/design': 'patch' } }).errors,
    [],
  );
});

test('a major needs the approval label whatever the type', () => {
  const unapproved = check({ title: 'chore: release', releases: { openplanr: 'major' } });
  assert.equal(unapproved.errors.length, 1);
  assert.match(
    unapproved.errors[0],
    /^chore: openplanr declares major .*semver:major-approved label/u,
  );
  assert.deepEqual(
    check({
      title: 'feat: new entry point',
      labels: [MAJOR_APPROVAL_LABEL],
      releases: { openplanr: 'major' },
    }).errors,
    [],
  );
});

test('a breaking change needs a major and the approval label', () => {
  const minor = check({ title: 'feat!: drop Node 20', releases: { openplanr: 'minor' } });
  assert.match(minor.errors[0], /^feat!: openplanr declares minor .*requires major/u);
  const footer = check({
    title: 'refactor: rename config key',
    body: 'Change.\n\nBREAKING CHANGE: `planr.json` is now `.planr/config.json`.',
    releases: { openplanr: 'major' },
  });
  assert.match(footer.errors[0], /^refactor!: openplanr declares major .*semver:major-approved/u);
  const nothing = check({ title: 'feat!: drop Node 20' });
  assert.match(nothing.errors[0], /^feat!: no published package declares a changeset/u);
  assert.deepEqual(
    check({
      title: 'feat!: drop Node 20',
      labels: [MAJOR_APPROVAL_LABEL],
      releases: { openplanr: 'major' },
    }).errors,
    [],
  );
});

test('an unconventional title fails because the bump cannot be derived', () => {
  assert.match(check({ title: 'Update things' }).errors[0], /is not a Conventional Commit/u);
});

test('the command reads changed changesets from disk and exits non-zero on errors', () => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-changeset-bump-'));
  try {
    mkdirSync(join(root, '.changeset'));
    writeFileSync(join(root, '.changeset/change.md'), "---\n'openplanr': patch\n---\n\nText.\n");
    const run = (title, extraFiles = []) => {
      writeFileSync(join(root, 'pull.json'), JSON.stringify({ title, body: null, labels: [] }));
      writeFileSync(
        join(root, 'files.json'),
        JSON.stringify([
          [
            { filename: '.changeset/change.md', status: 'added' },
            { filename: '.changeset/consumed.md', status: 'removed' },
            ...extraFiles,
          ],
        ]),
      );
      return spawnSync(
        process.execPath,
        [
          script,
          '--root',
          root,
          '--pr',
          join(root, 'pull.json'),
          '--files',
          join(root, 'files.json'),
        ],
        { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } },
      );
    };
    const failed = run('feat(cli): add repair');
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /error: feat: openplanr declares patch .*requires minor/u);
    const passed = run('fix(cli): keep exit codes');
    assert.equal(passed.status, 0, passed.stderr);
    assert.match(
      passed.stdout,
      /Changeset bumps match "fix\(cli\): keep exit codes" \(1 changeset\(s\)\)/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
