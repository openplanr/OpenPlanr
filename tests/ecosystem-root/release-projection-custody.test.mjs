import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { syncSkillRelease } from '../../scripts/skills/release-custody.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-release-custody-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tree = (entries) =>
    new Map(entries.map(([path, bytes]) => [path, { bytes: Buffer.from(bytes), mode: 0o644 }]));
  const write = (path, bytes) => {
    const absolute = join(root, 'release', path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, bytes);
  };
  return { root, tree, write, read: (path) => readFileSync(join(root, 'release', path), 'utf8') };
}

test('release custody updates exact owned archives and retires only their recorded bytes', (t) => {
  const { root, tree, read } = fixture(t);
  const before = tree([
    ['archives/design-1.zip', 'first immutable archive'],
    ['release-index.json', 'first index'],
  ]);
  syncSkillRelease({ root, tree: before, mode: 'write' });
  const next = tree([
    ['archives/design-2.zip', 'second immutable archive'],
    ['release-index.json', 'second index'],
  ]);
  syncSkillRelease({ root, tree: next, mode: 'write' });
  assert.equal(existsSync(join(root, 'release/archives/design-1.zip')), false);
  assert.equal(read('archives/design-2.zip'), 'second immutable archive');
  assert.equal(read('release-index.json'), 'second index');
  assert.equal(syncSkillRelease({ root, tree: next, mode: 'write' }).changedFiles, 0);
  assert.equal(syncSkillRelease({ root, tree: next, mode: 'check' }).changedFiles, 0);
});

test('release generation preserves a modified retired archive and does not write the new candidate', (t) => {
  const { root, tree, write, read } = fixture(t);
  syncSkillRelease({
    root,
    tree: tree([['archives/design-1.zip', 'generated archive']]),
    mode: 'write',
  });
  write('archives/design-1.zip', 'locally retained archive');
  assert.throws(
    () =>
      syncSkillRelease({
        root,
        tree: tree([['archives/design-2.zip', 'new archive']]),
        mode: 'write',
      }),
    /unproven or modified bytes/u,
  );
  assert.equal(read('archives/design-1.zip'), 'locally retained archive');
  assert.equal(existsSync(join(root, 'release/archives/design-2.zip')), false);
});

test('a release marker does not authorize removing unknown archives or notes', (t) => {
  const { root, tree, write, read } = fixture(t);
  write('.openplanr-release.json', '{"kind":"openplanr-generated-release-root"}');
  write('archives/customer-backup.zip', 'unknown archive');
  write('release-notes-draft.md', 'user draft');
  assert.throws(
    () =>
      syncSkillRelease({
        root,
        tree: tree([
          ['.openplanr-release.json', '{"kind":"new generated marker"}'],
          ['archives/design-2.zip', 'new archive'],
        ]),
        mode: 'write',
      }),
    /custody conflicts/u,
  );
  assert.equal(read('archives/customer-backup.zip'), 'unknown archive');
  assert.equal(read('release-notes-draft.md'), 'user draft');
  assert.equal(read('.openplanr-release.json'), '{"kind":"openplanr-generated-release-root"}');
  assert.equal(existsSync(join(root, 'release/archives/design-2.zip')), false);
});

test('release writes recheck a concurrent archive edit immediately before replacement', (t) => {
  const { root, tree, write, read } = fixture(t);
  const path = 'archives/design-1.zip';
  syncSkillRelease({ root, tree: tree([[path, 'generated archive']]), mode: 'write' });
  assert.throws(
    () =>
      syncSkillRelease({
        root,
        tree: tree([[path, 'updated archive']]),
        mode: 'write',
        beforeWrite: () => write(path, 'concurrent archive edit'),
      }),
    /changed during synchronization/u,
  );
  assert.equal(read(path), 'concurrent archive edit');
});
