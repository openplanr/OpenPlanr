import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureFileState } from '../../skills/planr-delegate/scripts/custody.mjs';
import {
  putStateGuarded,
  retainedEntryState,
  rollbackWritten,
  sameState,
  workingPaths,
} from '../../skills/planr-delegate/scripts/integration-files.mjs';

async function fixture(t, crossVolume = true) {
  const base = await promises.realpath(
    await promises.mkdtemp(join(tmpdir(), 'planr-write-volume-')),
  );
  t.after(() => promises.rm(base, { recursive: true, force: true }));
  const main = join(base, 'main');
  const root = join(base, 'linked');
  await promises.mkdir(main);
  const git = (...args) => execFileSync('git', args, { cwd: main, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  await promises.writeFile(join(main, 'source.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  git('worktree', 'add', '-q', '--detach', root);
  const metadata = join(main, '.git');
  const originals = { lstat: promises.lstat, renameSync: fs.renameSync, linkSync: fs.linkSync };
  // Emulate separate volumes: Git metadata has a different device, and crossing
  // that boundary fails with EXDEV just as rename/link do on a real filesystem.
  const crosses = (from, to) => from.startsWith(metadata) !== to.startsWith(metadata);
  const guard = (operation) => (from, to) => {
    if (crossVolume && crosses(from, to))
      throw Object.assign(new Error('Cross-device link'), { code: 'EXDEV' });
    return operation(from, to);
  };
  promises.lstat = async (...args) => {
    const info = await originals.lstat(...args);
    if (crossVolume && String(args[0]).startsWith(metadata)) info.dev += 1;
    return info;
  };
  fs.renameSync = guard(originals.renameSync);
  fs.linkSync = guard(originals.linkSync);
  syncBuiltinESMExports();
  t.after(() => {
    Object.assign(promises, { lstat: originals.lstat });
    Object.assign(fs, { renameSync: originals.renameSync, linkSync: originals.linkSync });
    syncBuiltinESMExports();
  });
  return { root, main, metadata, originals };
}

const file = (text) => ({
  kind: 'file',
  mode: 0o644,
  contentBase64: Buffer.from(text).toString('base64'),
});

test('cross-volume linked checkout supports guarded replacement, creation, deletion and symlinks', async (t) => {
  const f = await fixture(t);
  const before = await captureFileState(f.root, 'source.txt');
  const claimed = await putStateGuarded(
    f.root,
    'source.txt',
    file('candidate\n'),
    before,
    'replace',
  );
  assert.ok(claimed.startsWith(join(f.root, '.planr-delegate-write-custody')));
  assert.ok(sameState(retainedEntryState(claimed), before));
  await putStateGuarded(f.root, 'nested/new.txt', file('new\n'), { kind: 'absent' }, 'create');
  await promises.symlink('source.txt', join(f.root, 'link'));
  const linkBefore = await captureFileState(f.root, 'link');
  await putStateGuarded(
    f.root,
    'link',
    { ...linkBefore, target: 'nested/new.txt' },
    linkBefore,
    'symlink',
  );
  const changes = [
    { path: 'source.txt', sourceBefore: before, after: file('candidate\n'), writeId: 'replace' },
    {
      path: 'nested/new.txt',
      sourceBefore: { kind: 'absent' },
      after: file('new\n'),
      writeId: 'create',
    },
    {
      path: 'link',
      sourceBefore: linkBefore,
      after: { ...linkBefore, target: 'nested/new.txt' },
      writeId: 'symlink',
    },
  ];
  assert.deepEqual(await rollbackWritten(f.root, changes, 'recover'), []);
  assert.deepEqual(await captureFileState(f.root, 'source.txt'), before);
  assert.equal((await captureFileState(f.root, 'nested/new.txt')).kind, 'absent');
  assert.deepEqual(await captureFileState(f.root, 'link'), linkBefore);
  await putStateGuarded(f.root, 'source.txt', { kind: 'absent' }, before, 'delete');
  assert.deepEqual(
    await rollbackWritten(
      f.root,
      [{ path: 'source.txt', sourceBefore: before, after: { kind: 'absent' }, writeId: 'delete' }],
      'restore-delete',
    ),
    [],
  );
  assert.deepEqual(await captureFileState(f.root, 'source.txt'), before);
  assert.deepEqual(await workingPaths(f.root), ['link']);
});

test('cross-volume recovery restores a claimed but unpublished original from its saved location', async (t) => {
  const f = await fixture(t);
  const before = await captureFileState(f.root, 'source.txt');
  await putStateGuarded(f.root, 'source.txt', file('candidate\n'), before, 'interrupted');
  await promises.unlink(join(f.root, 'source.txt'));
  assert.deepEqual(
    await rollbackWritten(
      f.root,
      [
        {
          path: 'source.txt',
          sourceBefore: before,
          after: file('candidate\n'),
          writeId: 'interrupted',
        },
      ],
      'recover-interrupted',
    ),
    [],
  );
  assert.deepEqual(await captureFileState(f.root, 'source.txt'), before);
});

test('cross-volume publication preserves an owner replacement made during the claim', async (t) => {
  const f = await fixture(t);
  const before = await captureFileState(f.root, 'source.txt');
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    rename(from, to);
    if (from === join(f.root, 'source.txt')) fs.writeFileSync(from, 'owner edit\n');
  };
  syncBuiltinESMExports();
  await assert.rejects(
    putStateGuarded(f.root, 'source.txt', file('candidate\n'), before, 'concurrent'),
    (error) => {
      assert.equal(error.code, 'E_INTEGRATION_SOURCE_DRIFT');
      assert.ok(sameState(retainedEntryState(error.details.retainedPath), before));
      return true;
    },
  );
  assert.equal(await promises.readFile(join(f.root, 'source.txt'), 'utf8'), 'owner edit\n');
  assert.deepEqual(
    await rollbackWritten(
      f.root,
      [
        {
          path: 'source.txt',
          sourceBefore: before,
          after: file('candidate\n'),
          writeId: 'concurrent',
        },
      ],
      'recover-owner',
    ),
    [{ path: 'source.txt', code: 'E_INTEGRATION_ROLLBACK_CONFLICT' }],
  );
});

test('cross-volume custody rejects a pre-existing symlink without changing source', async (t) => {
  const f = await fixture(t);
  const before = await captureFileState(f.root, 'source.txt');
  await promises.symlink(f.metadata, join(f.root, '.planr-delegate-write-custody'));
  await assert.rejects(
    putStateGuarded(f.root, 'source.txt', file('candidate\n'), before, 'unsafe'),
    { code: 'E_INTEGRATION_CUSTODY' },
  );
  assert.deepEqual(await captureFileState(f.root, 'source.txt'), before);
});

for (const unsafe of ['symlink', 'permissions'])
  test(`metadata custody rejects existing unsafe ${unsafe} without changing source`, async (t) => {
    const f = await fixture(t, false);
    const before = await captureFileState(f.root, 'source.txt');
    const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
      cwd: f.root,
      encoding: 'utf8',
    }).trim();
    const base = join(gitDir, 'planr-delegate-write-custody');
    if (unsafe === 'symlink') await promises.symlink(f.root, base);
    else {
      await promises.mkdir(base);
      await promises.chmod(base, 0o777);
    }
    await assert.rejects(
      putStateGuarded(f.root, 'source.txt', file('candidate'), before, 'unsafe-metadata'),
      { code: 'E_INTEGRATION_CUSTODY' },
    );
    assert.deepEqual(await captureFileState(f.root, 'source.txt'), before);
  });

test('parent replacement during directory inspection blocks publication', async (t) => {
  const f = await fixture(t, false);
  const parent = join(f.root, 'folder');
  const outside = join(f.main, 'outside');
  const original = join(f.root, 'original-folder');
  await promises.mkdir(parent);
  await promises.mkdir(outside);
  const lstat = promises.lstat;
  let inspections = 0;
  promises.lstat = async (...args) => {
    const info = await lstat(...args);
    if (String(args[0]) === parent && ++inspections === 2) {
      f.originals.renameSync(parent, original);
      fs.symlinkSync(outside, parent);
    }
    return info;
  };
  syncBuiltinESMExports();
  await assert.rejects(
    putStateGuarded(f.root, 'folder/new.txt', file('candidate'), { kind: 'absent' }, 'parent-race'),
    { code: 'E_INTEGRATION_PATH' },
  );
  await assert.rejects(promises.readFile(join(outside, 'new.txt')), { code: 'ENOENT' });
});
