import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyCliVersion, cliReleaseVersion, releaseWeek } from '../../scripts/release-train/lib/cli-version.mjs';

const on = (day) => new Date(`${day}T12:00:00Z`);

test('release weeks follow ISO week-years across year boundaries', () => {
  assert.equal(releaseWeek(on('2026-09-24')), 2639);
  assert.equal(releaseWeek(on('2026-01-01')), 2601);
  assert.equal(releaseWeek(on('2025-12-29')), 2601, 'Monday of the week that contains 2026-01-01');
  assert.equal(releaseWeek(on('2026-12-31')), 2653);
  assert.equal(releaseWeek(on('2027-01-03')), 2653, 'Sunday still belongs to 2026 week 53');
  assert.equal(releaseWeek(on('2027-01-04')), 2701);
  assert.equal(releaseWeek(new Date('2026-09-27T23:59:59Z')), 2639, 'Sunday night UTC is still week 39');
});

test('the first release of a week takes patch 0 and later ones count up', () => {
  const published = ['2.6.2', '2.6.3'];
  assert.equal(cliReleaseVersion({ current: '2.7.0', published, date: on('2026-09-24') }), '2.2639.0');
  assert.equal(cliReleaseVersion({ current: '2.2639.1', published: [...published, '2.2639.0'], date: on('2026-09-25') }), '2.2639.1');
  assert.equal(
    cliReleaseVersion({ current: '2.2640.0', published: [...published, '2.2639.0', '2.2639.1'], date: on('2026-09-26') }),
    '2.2639.2',
    'A Changesets minor bump inside the same week still becomes a patch of that week',
  );
  assert.equal(cliReleaseVersion({ current: '2.2639.2', published: [...published, '2.2639.0'], date: on('2026-10-01') }), '2.2640.0');
});

test('a published version needs no renumbering and prereleases do not count', () => {
  assert.equal(cliReleaseVersion({ current: '2.6.3', published: ['2.6.3'], date: on('2026-09-24') }), null);
  assert.equal(cliReleaseVersion({ current: '2.7.0', published: ['2.6.3', '2.2639.0-beta.1'], date: on('2026-09-24') }), '2.2639.0');
});

test('a major release keeps its major and restarts the week count', () => {
  assert.equal(cliReleaseVersion({ current: '3.0.0', published: ['2.2639.0', '2.2640.0'], date: on('2026-10-01') }), '3.2640.0');
});

test('numbering never goes behind the registry', () => {
  assert.throws(
    () => cliReleaseVersion({ current: '2.2643.0', published: ['2.2641.0', '2.2642.0'], date: on('2026-10-01') }),
    /2\.2640\.0 would not be newer than the published 2\.2642\.0/u,
  );
});

test('the manifest version and the changelog heading are rewritten together', () => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-cli-version-'));
  try {
    mkdirSync(join(root, 'packages/cli'), { recursive: true });
    const manifestPath = join(root, 'packages/cli/package.json');
    const changelogPath = join(root, 'packages/cli/CHANGELOG.md');
    writeFileSync(manifestPath, '{\n  "name": "openplanr",\n  "version": "2.7.0",\n  "private": false\n}\n');
    writeFileSync(changelogPath, '# openplanr\n\n## 2.7.0\n\n### Minor Changes\n\n- a: Change.\n\n## 2.6.3\n\n- b: Fix.\n');
    applyCliVersion({ root, from: '2.7.0', to: '2.2639.0' });
    assert.equal(readFileSync(manifestPath, 'utf8'), '{\n  "name": "openplanr",\n  "version": "2.2639.0",\n  "private": false\n}\n');
    assert.equal(readFileSync(changelogPath, 'utf8'), '# openplanr\n\n## 2.2639.0\n\n### Minor Changes\n\n- a: Change.\n\n## 2.6.3\n\n- b: Fix.\n');
    assert.throws(() => applyCliVersion({ root, from: '2.7.0', to: '2.2639.1' }), /does not declare version 2\.7\.0 exactly once/u);
    writeFileSync(manifestPath, '{\n  "version": "2.2639.1"\n}\n');
    writeFileSync(changelogPath, '# openplanr\n\n## 2.2639.1\n\n- c: Next.\n\n## 2.2639.0\n\n- a: Change.\n');
    assert.throws(() => applyCliVersion({ root, from: '2.2639.1', to: '2.2639.0' }), /already has an unpublished 2\.2639\.0 section/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
