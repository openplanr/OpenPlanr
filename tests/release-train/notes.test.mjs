import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  appendProvenanceRows,
  changelogSection,
  payloadDigest,
  renderProvenanceRow,
  renderReleaseNotes,
} from '../../scripts/release/lib/notes.mjs';

const CHANGELOG =
  '# Changelog\n\n## 2.2.1\n### Patch Changes\n\n- abc1234: Stamp manifests.\n\n## 2.2.0\n### Minor Changes\n\n- f93a973: Sprint.\n';

test('changelogSection returns exactly one version section', () => {
  assert.equal(
    changelogSection(CHANGELOG, '2.2.1'),
    '## 2.2.1\n### Patch Changes\n\n- abc1234: Stamp manifests.\n',
  );
  assert.equal(
    changelogSection(CHANGELOG, '2.2.0'),
    '## 2.2.0\n### Minor Changes\n\n- f93a973: Sprint.\n',
  );
  assert.throws(() => changelogSection(CHANGELOG, '9.9.9'), /no section for 9\.9\.9/u);
});

test('release notes carry the changelog section and the publication evidence', () => {
  const notes = renderReleaseNotes({
    changelog: CHANGELOG,
    name: 'openplanr',
    version: '2.2.1',
    integrity: 'sha512-abc==',
    publishedAt: '2026-09-18T02:04:45.215Z',
    runUrl: 'https://github.com/openplanr/OpenPlanr/actions/runs/1',
    commit: 'd'.repeat(40),
    fileCount: 1750,
    bundled: 'planr-pipeline@0.45.3',
  });
  assert.match(notes, /^## 2\.2\.1\n/u);
  assert.match(
    notes,
    /https:\/\/www\.npmjs\.com\/package\/openplanr\/v\/2\.2\.1 — integrity `sha512-abc==`; bundles `planr-pipeline@0\.45\.3`/u,
  );
  assert.match(
    notes,
    /Published 2026-09-18 02:04:45 UTC by `publish-packages\.yml` run https:\/\/github\.com\/openplanr\/OpenPlanr\/actions\/runs\/1/u,
  );
  assert.match(notes, /1,750\/1,750 files/u);
});

test('payloadDigest hashes the sorted per-file digest list of an archive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-notes-'));
  try {
    mkdirSync(join(dir, 'package/lib'), { recursive: true });
    writeFileSync(join(dir, 'package/package.json'), '{"name":"x"}');
    writeFileSync(join(dir, 'package/lib/index.js'), 'export {};\n');
    execFileSync('tar', ['-czf', join(dir, 'x.tgz'), '-C', dir, 'package']);
    const first = payloadDigest(join(dir, 'x.tgz'));
    assert.equal(first.fileCount, 2);
    assert.match(first.digest, /^[0-9a-f]{64}$/u);
    assert.equal(payloadDigest(join(dir, 'x.tgz')).digest, first.digest);
    writeFileSync(join(dir, 'package/lib/index.js'), 'export const changed = true;\n');
    execFileSync('tar', ['-czf', join(dir, 'y.tgz'), '-C', dir, 'package']);
    assert.notEqual(payloadDigest(join(dir, 'y.tgz')).digest, first.digest);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('provenance rows are appended after the table once', () => {
  const row = renderProvenanceRow({
    name: 'openplanr',
    version: '2.2.1',
    publishedAt: '2026-09-18T02:04:45.215Z',
    runId: '42',
    commit: 'd'.repeat(40),
    payloadSha256: 'e'.repeat(64),
    integrity: 'sha512-abc==',
  });
  assert.equal(
    row,
    `| \`openplanr\` | \`2.2.1\` | 2026-09-18 02:04:45 | \`publish-packages.yml\` run 42; SLSA v1 attestation | \`${'d'.repeat(40)}\` | \`${'e'.repeat(64)}\` | \`sha512-abc==\` |`,
  );
  const document = [
    '## Publication provenance',
    '',
    '| Package | Version | Published (UTC) | Channel | Build commit in attestation | Payload SHA-256 | Registry integrity |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| `openplanr` | `2.2.0` | 2026-09-18 02:04:45 | run 1 | `c` | `p` | `i` |',
    '',
    'Narrative.',
    '',
  ].join('\n');
  const once = appendProvenanceRows(document, [row]);
  assert.equal(once.added, 1);
  assert.equal(once.document.split('\n')[5], row);
  assert.equal(once.document.split('\n')[7], 'Narrative.');
  const twice = appendProvenanceRows(once.document, [row, row.replace('run 42', 'run 43')]);
  assert.equal(twice.added, 0);
  assert.equal(twice.document, once.document);
});
