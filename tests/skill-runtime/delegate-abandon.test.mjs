import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createWorktreeCustody } from '../../skills/planr-delegate/scripts/custody.mjs';
import { abandonDelegateRun } from '../../skills/planr-delegate/scripts/run-lifecycle.mjs';
import {
  createRunRecord,
  readRunRecord,
  updateRunRecord,
  withRunTransitionLock,
} from '../../skills/planr-delegate/scripts/run-record.mjs';

async function fixture(
  t,
  {
    status = 'prepared',
    selectedDirty = false,
    selectedDeleted = false,
    crlf = false,
    filtered = false,
  } = {},
) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'planr-abandon-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'source');
  const worktreeParent = join(base, 'worktrees');
  const runDirectory = join(base, 'runs');
  const runId = 'never-started';
  const runPath = join(runDirectory, runId);
  await mkdir(root);
  await mkdir(worktreeParent);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  if (crlf) git('config', 'core.autocrlf', 'true');
  const filterCalls = join(base, 'filter-calls.txt');
  if (filtered) {
    const script = join(base, 'fixture-filter.cjs');
    await writeFile(
      script,
      [
        "const fs = require('node:fs');",
        `fs.appendFileSync(${JSON.stringify(filterCalls)}, process.argv[2] + '\\n');`,
        "const source = fs.readFileSync(0, 'utf8');",
        "process.stdout.write(process.argv[2] === 'smudge' ? 'checkout:' + source : source.replace(/^checkout:/u, ''));",
      ].join('\n'),
    );
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    const command = `${quote(process.execPath)} ${quote(script)}`;
    git('config', 'filter.delegate-fixture.smudge', `${command} smudge`);
    git('config', 'filter.delegate-fixture.clean', `${command} clean`);
    await writeFile(join(root, '.gitattributes'), 'source.txt filter=delegate-fixture\n');
  }
  await writeFile(join(root, '.gitignore'), 'ignored.txt\nnode_modules/\n');
  await writeFile(join(root, 'source.txt'), 'initial\n');
  if (selectedDeleted) {
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'nested', 'removed.txt'), 'initial selected file\n');
  }
  git('add', '.');
  git('commit', '-qm', 'fixture');
  if (selectedDeleted) await rm(join(root, 'nested', 'removed.txt'));
  if (selectedDirty) {
    await writeFile(join(root, 'source.txt'), 'selected local edit\n');
    await writeFile(join(root, 'new.txt'), 'selected untracked\n');
  }
  const custody = await createWorktreeCustody({
    repositoryRoot: root,
    selectedPaths: selectedDirty
      ? ['source.txt', 'new.txt']
      : selectedDeleted
        ? ['nested/removed.txt']
        : [],
    worktreeParent,
    runId,
    native: true,
  });
  const record = await createRunRecord(
    {
      runId,
      runPath,
      status,
      nativeSelection: { kind: 'claude' },
      repositoryRoot: root,
      worktreePath: custody.worktreePath,
      custodyPath: join(runPath, 'custody.json'),
      initialHead: custody.initialHead,
      initialIndex: custody.initialIndex,
      backendSessionId: null,
      sessionEvidence: 'unavailable',
    },
    { directory: runDirectory },
  );
  await writeFile(record.custodyPath, JSON.stringify(custody), { mode: 0o600 });
  await writeFile(join(runPath, 'retained.txt'), 'Retain diagnostic evidence.');
  const input = { runId, runDirectory };
  const inWorktree = (...args) =>
    execFileSync('git', args, { cwd: custody.worktreePath, encoding: 'utf8' }).trim();
  return {
    base,
    root,
    runId,
    runPath,
    runDirectory,
    record,
    custody,
    input,
    git,
    inWorktree,
    filterCalls,
  };
}

for (const status of ['prepared', 'blocked']) {
  test(`abandon ${status} never-started worktree preserves records and is repeatable`, async (t) => {
    const f = await fixture(t, { status });
    const first = await abandonDelegateRun(f.input);
    assert.equal(first.status, 'closed');
    assert.equal(first.disposition, 'abandoned');
    assert.equal(first.cleanup.status, 'removed');
    assert.equal(first.abandonment.kind, 'never-started');
    assert.ok(!f.git('worktree', 'list', '--porcelain').includes(f.custody.worktreePath));
    await assert.rejects(lstat(f.custody.worktreePath), { code: 'ENOENT' });
    assert.equal(
      await readFile(join(f.runPath, 'retained.txt'), 'utf8'),
      'Retain diagnostic evidence.',
    );
    assert.equal((await lstat(f.record.custodyPath)).isFile(), true);
    const again = await abandonDelegateRun(f.input);
    assert.equal(again.closedAt, first.closedAt);
    assert.deepEqual(again.cleanup, first.cleanup);
    assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'initial\n');
  });
}

test('initial selected dirty and untracked files may be removed only when exact captured bytes remain', async (t) => {
  const f = await fixture(t, { selectedDirty: true });
  assert.equal((await abandonDelegateRun(f.input)).cleanup.status, 'removed');
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'selected local edit\n');
  assert.equal(await readFile(join(f.root, 'new.txt'), 'utf8'), 'selected untracked\n');
});

test('an unchanged selected deletion may abandon the resulting empty tracked directory', async (t) => {
  const f = await fixture(t, { selectedDeleted: true });
  assert.deepEqual(f.custody.startingFiles['nested/removed.txt'], { kind: 'absent' });
  assert.equal((await lstat(join(f.custody.worktreePath, 'nested'))).isDirectory(), true);
  assert.equal((await abandonDelegateRun(f.input)).cleanup.status, 'removed');
  await assert.rejects(lstat(join(f.root, 'nested', 'removed.txt')), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'initial\n');
});

test('fresh CRLF checkouts retain compact raw-byte evidence and may abandon untouched', async (t) => {
  const f = await fixture(t, { crlf: true });
  const bytes = await readFile(join(f.custody.worktreePath, 'source.txt'));
  assert.equal(bytes.toString(), 'initial\r\n');
  assert.deepEqual(f.custody.initialCheckoutFiles['source.txt'], {
    kind: 'file',
    mode: 0o644,
    bytes: bytes.length,
    digest: createHash('sha256').update(bytes).digest('hex'),
  });
  assert.equal((await abandonDelegateRun(f.input)).cleanup.status, 'removed');
});

test('untouched filtered checkout may abandon without rerunning the clean or smudge filter', async (t) => {
  const f = await fixture(t, { filtered: true });
  assert.equal(
    await readFile(join(f.custody.worktreePath, 'source.txt'), 'utf8'),
    'checkout:initial\n',
  );
  assert.ok(f.custody.initialCheckoutFiles['source.txt']);
  const before = await readFile(f.filterCalls, 'utf8');
  assert.equal((await abandonDelegateRun(f.input)).cleanup.status, 'removed');
  assert.equal(await readFile(f.filterCalls, 'utf8'), before);
});

test('edited filtered checkout stays retained without rerunning a cleanup filter', async (t) => {
  const f = await fixture(t, { filtered: true });
  const before = await readFile(f.filterCalls, 'utf8');
  await writeFile(join(f.custody.worktreePath, 'source.txt'), 'checkout:edited\n');
  await assert.rejects(abandonDelegateRun(f.input), { code: 'E_DELEGATE_ABANDON' });
  assert.equal(await readFile(f.filterCalls, 'utf8'), before);
  assert.equal(
    await readFile(join(f.custody.worktreePath, 'source.txt'), 'utf8'),
    'checkout:edited\n',
  );
});

for (const [label, bytes] of [
  ['line-ending normalization', 'initial\n'],
  ['changed CRLF content', 'changed\r\n'],
]) {
  test(`initial CRLF evidence retains later ${label}`, async (t) => {
    const f = await fixture(t, { crlf: true });
    await writeFile(join(f.custody.worktreePath, 'source.txt'), bytes);
    await assert.rejects(abandonDelegateRun(f.input), { code: 'E_DELEGATE_ABANDON' });
    assert.equal(await readFile(join(f.custody.worktreePath, 'source.txt'), 'utf8'), bytes);
    assert.equal((await readRunRecord(f.runId, { directory: f.runDirectory })).status, 'prepared');
  });
}

test('historical CRLF custody without exact checkout evidence remains conservatively retained', async (t) => {
  const f = await fixture(t, { crlf: true });
  const legacy = { ...f.custody };
  delete legacy.initialCheckoutFiles;
  await writeFile(f.record.custodyPath, JSON.stringify(legacy), { mode: 0o600 });
  await assert.rejects(abandonDelegateRun(f.input), { code: 'E_DELEGATE_ABANDON' });
  assert.equal(await readFile(join(f.custody.worktreePath, 'source.txt'), 'utf8'), 'initial\r\n');
});

for (const [label, mutate] of [
  [
    'tracked edit',
    async (f) => writeFile(join(f.custody.worktreePath, 'source.txt'), 'unexpected edit\n'),
  ],
  [
    'untracked file',
    async (f) => writeFile(join(f.custody.worktreePath, 'notes.txt'), 'retain me'),
  ],
  [
    'ignored file',
    async (f) => writeFile(join(f.custody.worktreePath, 'ignored.txt'), 'retain me'),
  ],
  [
    'ignored empty dependency directory',
    async (f) => mkdir(join(f.custody.worktreePath, 'node_modules')),
  ],
  ['empty unknown directory', async (f) => mkdir(join(f.custody.worktreePath, 'drafts'))],
  [
    'staged edit',
    async (f) => {
      await writeFile(join(f.custody.worktreePath, 'source.txt'), 'staged');
      f.inWorktree('add', 'source.txt');
    },
  ],
  ['HEAD advance', async (f) => f.inWorktree('commit', '--allow-empty', '-qm', 'unknown work')],
  ['executable mode change', async (f) => chmod(join(f.custody.worktreePath, 'source.txt'), 0o755)],
  [
    'unknown resource beside worktree',
    async (f) => writeFile(join(dirname(f.custody.worktreePath), 'recovery.txt'), 'retain me'),
  ],
  [
    'ownership changed',
    async (f) =>
      writeFile(
        join(dirname(f.custody.worktreePath), 'ownership.json'),
        JSON.stringify({ ...f.custody, custodyToken: 'wrong' }),
      ),
  ],
  [
    'escaped symlink',
    async (f) => {
      await rm(join(f.custody.worktreePath, 'source.txt'));
      await symlink(join(f.base, 'outside'), join(f.custody.worktreePath, 'source.txt'));
    },
  ],
]) {
  test(`abandon retains ${label}`, async (t) => {
    const f = await fixture(t);
    await mutate(f);
    await assert.rejects(abandonDelegateRun(f.input));
    assert.equal((await readRunRecord(f.runId, { directory: f.runDirectory })).status, 'prepared');
    assert.equal((await lstat(f.custody.worktreePath)).isDirectory(), true);
    assert.ok(f.git('worktree', 'list', '--porcelain').includes(f.custody.worktreePath));
  });
}

for (const [label, changes] of [
  ['running', { status: 'running' }],
  ['resuming', { status: 'resuming' }],
  ['started attempt', { executionTiming: { attempts: 1, durationMs: 0 } }],
  ['reserved session', { backendSessionId: 'reserved', sessionEvidence: 'reserved' }],
  [
    'retained observed session',
    { backendSessionId: 'native-session', sessionEvidence: 'observed' },
  ],
  ['delegate process', { delegateProcess: { pid: 123, started: 'unknown' } }],
  ['unconfirmed termination', { delegateTerminationConfirmed: false }],
  ['setup provenance', { preparationProvenance: { status: 'failed' } }],
  ['setup snapshot', { setup: { digest: 'unknown' } }],
  ['verification', { verification: { status: 'blocked' } }],
  ['interrupted integration', { integration: { status: 'interrupted' } }],
  ['ordinary abandoned closure', { status: 'closed', disposition: 'abandoned' }],
]) {
  test(`abandon refuses ${label} without process effects`, async (t) => {
    const f = await fixture(t, { status: 'blocked' });
    await updateRunRecord(f.runId, changes, { directory: f.runDirectory });
    await assert.rejects(
      abandonDelegateRun(f.input),
      (error) => error.code === 'E_DELEGATE_ABANDON',
    );
    assert.equal((await lstat(f.custody.worktreePath)).isDirectory(), true);
  });
}

test('abandon does not overlap another run transition', async (t) => {
  const f = await fixture(t);
  await withRunTransitionLock(f.runId, { directory: f.runDirectory }, async () => {
    await assert.rejects(abandonDelegateRun(f.input), (error) => error.code === 'E_RUN_LOCKED');
    assert.equal((await lstat(f.custody.worktreePath)).isDirectory(), true);
  });
});

test('a preparation with no worktree closes without filesystem removal', async (t) => {
  const f = await fixture(t);
  await updateRunRecord(
    f.runId,
    { worktreePath: null, custodyPath: null },
    { directory: f.runDirectory },
  );
  const result = await abandonDelegateRun(f.input);
  assert.equal(result.cleanup.status, 'not-created');
  assert.equal((await lstat(f.custody.worktreePath)).isDirectory(), true);
});

test('closed abandonment retries interrupted cleanup when a removed worktree remains registered', async (t) => {
  const f = await fixture(t);
  await updateRunRecord(
    f.runId,
    {
      status: 'closed',
      disposition: 'abandoned',
      closedAt: new Date().toISOString(),
      abandonment: { kind: 'never-started', checkedAt: new Date().toISOString() },
    },
    { directory: f.runDirectory },
  );
  await rm(f.custody.worktreePath, { recursive: true });
  const result = await abandonDelegateRun(f.input);
  assert.equal(result.cleanup.status, 'removed');
  assert.ok(!f.git('worktree', 'list', '--porcelain').includes(f.custody.worktreePath));
});

test('interrupted cleanup retains new surrounding recovery resources even after closure', async (t) => {
  const f = await fixture(t);
  await updateRunRecord(
    f.runId,
    {
      status: 'closed',
      disposition: 'abandoned',
      closedAt: new Date().toISOString(),
      abandonment: { kind: 'never-started', checkedAt: new Date().toISOString() },
    },
    { directory: f.runDirectory },
  );
  await rm(f.custody.worktreePath, { recursive: true });
  const retained = join(dirname(f.custody.worktreePath), 'recovery.txt');
  await writeFile(retained, 'retain me');
  await assert.rejects(abandonDelegateRun(f.input), (error) => error.code === 'E_DELEGATE_ABANDON');
  assert.equal(await readFile(retained, 'utf8'), 'retain me');
});
