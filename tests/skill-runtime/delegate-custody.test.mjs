import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  captureFileState,
  cleanupWorktreeCustody,
  createWorktreeCustody,
  planWritableScopes,
  validateWorktreeCustody,
} from '../../skills/planr-delegate/scripts/custody.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

async function fixture(run) {
  const base = await mkdtemp(join(tmpdir(), 'planr-custody-test-'));
  const root = join(base, 'source');
  const worktreeParent = join(base, 'runs');
  await mkdir(root);
  await mkdir(worktreeParent);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.test');
  await writeFile(join(root, '.gitignore'), '.planr/\nignored.txt\n');
  await writeFile(join(root, 'changed.txt'), 'old\n');
  await writeFile(join(root, 'deleted.txt'), 'delete me\n');
  await writeFile(join(root, 'unrelated.txt'), 'stable\n');
  await writeFile(join(root, 'protected.txt'), 'do not edit\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');
  try {
    return await run({ base, root, worktreeParent });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

function capsule(selectedPaths, preservePaths = []) {
  const frontmatter = `---\nid: "T-070"\npreserve:\n${preservePaths.map((path) => `  - repositoryKey: "project"\n    path: "${path}"\n`).join('')}---\n`;
  return {
    kind: 'openplanr-delegation-context-capsule',
    inventory: selectedPaths.map((path) => ({
      repositoryKey: 'project',
      path,
      roles: ['selected-source'],
    })),
    files: [
      {
        repositoryKey: 'project',
        roles: ['task'],
        contentBase64: Buffer.from(frontmatter).toString('base64'),
      },
    ],
  };
}

test('selected tracked edits, deletion, mode and untracked bytes are isolated from unrelated source state', async () =>
  fixture(async ({ root, worktreeParent }) => {
    await writeFile(join(root, 'changed.txt'), Buffer.from([0, 13, 10, 255]));
    await chmod(join(root, 'changed.txt'), 0o755);
    await rm(join(root, 'deleted.txt'));
    await writeFile(join(root, 'new.txt'), 'new\n');
    await writeFile(join(root, 'unrelated.txt'), 'source-only\n');
    await mkdir(join(root, '.planr'));
    await writeFile(join(root, '.planr', 'private.md'), 'private');
    const record = await createWorktreeCustody({
      repositoryRoot: root,
      capsule: capsule(['changed.txt', 'deleted.txt', 'new.txt'], ['protected.txt']),
      worktreeParent,
    });
    assert.equal(git(record.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD');
    assert.deepEqual(
      await readFile(join(record.worktreePath, 'changed.txt')),
      Buffer.from([0, 13, 10, 255]),
    );
    assert.equal((await captureFileState(record.worktreePath, 'changed.txt')).mode & 0o111, 0o111);
    assert.deepEqual(record.startingFiles['deleted.txt'], { kind: 'absent' });
    assert.equal(await readFile(join(record.worktreePath, 'new.txt'), 'utf8'), 'new\n');
    assert.equal(await readFile(join(record.worktreePath, 'unrelated.txt'), 'utf8'), 'stable\n');
    assert.equal((await captureFileState(record.worktreePath, '.planr/private.md')).kind, 'absent');
    assert.equal(await readFile(join(root, 'unrelated.txt'), 'utf8'), 'source-only\n');
    assert.equal((await validateWorktreeCustody(record)).valid, true);
    await cleanupWorktreeCustody(record, { disposition: 'accepted' });
  }));

test('ignored untracked files and symlink escapes are rejected before creating a worktree', async () =>
  fixture(async ({ root, worktreeParent, base }) => {
    await writeFile(join(root, 'ignored.txt'), 'ignored');
    await assert.rejects(
      createWorktreeCustody({
        repositoryRoot: root,
        capsule: capsule(['ignored.txt']),
        worktreeParent,
      }),
      (error) => error.code === 'E_CUSTODY_IGNORED',
    );
    await symlink(base, join(root, 'escape'));
    await assert.rejects(
      createWorktreeCustody({
        repositoryRoot: root,
        capsule: capsule(['escape/secret.txt']),
        worktreeParent,
      }),
      (error) => error.code === 'E_CUSTODY_PATH',
    );
    assert.deepEqual(await readdir(worktreeParent), []);
  }));

test('Preserve edits reject validation while leaving worktree intact', async () =>
  fixture(async ({ root, worktreeParent }) => {
    const record = await createWorktreeCustody({
      repositoryRoot: root,
      capsule: capsule(['changed.txt'], ['protected.txt']),
      worktreeParent,
    });
    await writeFile(join(record.worktreePath, 'protected.txt'), 'changed');
    const result = await validateWorktreeCustody(record);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some(({ code }) => code === 'E_CUSTODY_PRESERVE'));
    assert.equal(await readFile(join(record.worktreePath, 'protected.txt'), 'utf8'), 'changed');
  }));

test('staging and committing are rejected even with a clean final worktree', async () =>
  fixture(async ({ root, worktreeParent }) => {
    const record = await createWorktreeCustody({
      repositoryRoot: root,
      capsule: capsule(['changed.txt']),
      worktreeParent,
    });
    await writeFile(join(record.worktreePath, 'changed.txt'), 'delegate');
    git(record.worktreePath, 'add', 'changed.txt');
    const staged = await validateWorktreeCustody(record);
    assert.equal(staged.valid, false);
    assert.ok(staged.violations.some(({ code }) => code === 'E_CUSTODY_INDEX'));
    assert.ok(staged.violations.some(({ code }) => code === 'E_CUSTODY_STAGED'));
    git(record.worktreePath, 'commit', '-qm', 'delegate should not commit');
    const committed = await validateWorktreeCustody(record);
    assert.equal(committed.valid, false);
    assert.ok(committed.violations.some(({ code }) => code === 'E_CUSTODY_HEAD'));
    assert.equal(committed.changedPaths.length, 0);
  }));

test('source checkout HEAD and index drift are observed', async () =>
  fixture(async ({ root, worktreeParent }) => {
    const record = await createWorktreeCustody({
      repositoryRoot: root,
      capsule: capsule(['changed.txt']),
      worktreeParent,
    });
    await writeFile(join(root, 'unrelated.txt'), 'source staged');
    git(root, 'add', 'unrelated.txt');
    assert.ok(
      (await validateWorktreeCustody(record)).violations.some(
        ({ code }) => code === 'E_CUSTODY_SOURCE_INDEX',
      ),
    );
    git(root, 'commit', '-qm', 'source drift');
    assert.ok(
      (await validateWorktreeCustody(record)).violations.some(
        ({ code }) => code === 'E_CUSTODY_SOURCE_HEAD',
      ),
    );
  }));

test('scope planner orders contract owner first and keeps secondary context read-only', () => {
  const scopes = planWritableScopes({
    contractOwnerKey: 'protocol',
    repositories: [
      { repositoryKey: 'web', root: '/web', writable: true, selectedContext: ['src/use.ts'] },
      {
        repositoryKey: 'protocol',
        root: '/protocol',
        writable: true,
        selectedContext: ['schema.json'],
      },
      { repositoryKey: 'notes', root: '/notes', writable: false },
    ],
  });
  assert.deepEqual(
    scopes.map((scope) => scope.writableRepository.repositoryKey),
    ['protocol', 'web'],
  );
  assert.deepEqual(scopes[0].readOnlyRepositories, [
    { repositoryKey: 'web', root: '/web', selectedContext: ['src/use.ts'], writable: false },
  ]);
  assert.ok(scopes.every((scope) => !scope.readOnlyRepositories.some((other) => other.writable)));
});

test('a run rejects a second writable root and source selections outside its capsule', async () =>
  fixture(async ({ root, worktreeParent }) => {
    await assert.rejects(
      createWorktreeCustody({
        repositoryRoot: root,
        capsule: capsule(['changed.txt']),
        selectedPaths: ['unrelated.txt'],
        worktreeParent,
      }),
      (error) => error.code === 'E_CUSTODY_SCOPE',
    );
    await assert.rejects(
      createWorktreeCustody({
        repositoryRoot: root,
        capsule: capsule(['changed.txt']),
        worktreeParent,
        readOnlyRepositories: [{ repositoryKey: 'other', root: '/other', writable: true }],
      }),
      (error) => error.code === 'E_CUSTODY_SCOPE',
    );
  }));

test('a new file under a Preserve directory is detected, including an initially absent path', async () =>
  fixture(async ({ root, worktreeParent }) => {
    await mkdir(join(root, 'protected-dir'));
    const record = await createWorktreeCustody({
      repositoryRoot: root,
      capsule: capsule(['changed.txt'], ['protected-dir', 'missing-protected.txt']),
      worktreeParent,
    });
    await mkdir(join(record.worktreePath, 'protected-dir'));
    await writeFile(join(record.worktreePath, 'protected-dir', 'new.txt'), 'unexpected');
    await writeFile(join(record.worktreePath, 'missing-protected.txt'), 'unexpected');
    const result = await validateWorktreeCustody(record);
    assert.deepEqual(
      result.violations.filter(({ code }) => code === 'E_CUSTODY_PRESERVE').map(({ path }) => path),
      ['missing-protected.txt', 'protected-dir'],
    );
  }));

test('traversal and absolute selected paths are refused', async () =>
  fixture(async ({ root, worktreeParent }) => {
    for (const path of ['../outside.txt', '/tmp/outside.txt', 'bad\\path.txt']) {
      await assert.rejects(
        createWorktreeCustody({ repositoryRoot: root, capsule: capsule([path]), worktreeParent }),
        (error) => error.code === 'E_CUSTODY_PATH',
      );
    }
  }));

test('cleanup is explicit and cannot target an unrelated worktree', async () =>
  fixture(async ({ root, worktreeParent }) => {
    const record = await createWorktreeCustody({
      repositoryRoot: root,
      capsule: capsule(['changed.txt']),
      worktreeParent,
    });
    const other = await createWorktreeCustody({
      repositoryRoot: root,
      capsule: capsule(['changed.txt']),
      worktreeParent,
    });
    await assert.rejects(
      cleanupWorktreeCustody(record),
      (error) => error.code === 'E_CUSTODY_CLEANUP',
    );
    await assert.rejects(
      cleanupWorktreeCustody({ ...record, worktreePath: root }, { disposition: 'abandoned' }),
      (error) => error.code === 'E_CUSTODY_CLEANUP',
    );
    await assert.rejects(
      cleanupWorktreeCustody(
        { ...record, worktreePath: other.worktreePath },
        { disposition: 'abandoned' },
      ),
      (error) => error.code === 'E_CUSTODY_CLEANUP',
    );
    assert.equal((await captureFileState(record.worktreePath, 'changed.txt')).kind, 'file');
    await cleanupWorktreeCustody(record, { disposition: 'abandoned' });
    assert.equal((await captureFileState(other.worktreePath, 'changed.txt')).kind, 'file');
    await cleanupWorktreeCustody(other, { disposition: 'abandoned' });
  }));
