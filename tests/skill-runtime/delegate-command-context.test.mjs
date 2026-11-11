import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { contextCapacity } from '../../packages/pipeline/lib/delegate/run-preflight.mjs';
import {
  delegateRunnerCommand,
  prepareDelegateRun,
} from '../../packages/pipeline/lib/delegate/runner.mjs';

test('unknown and malformed actions return actionable codes', async () => {
  for (const [action, input, code] of [
    [undefined, {}, 'E_DELEGATE_COMMAND'],
    ['unknown', {}, 'E_DELEGATE_COMMAND'],
    ['probe', [], 'E_DELEGATE_INPUT'],
    ['probe', null, 'E_DELEGATE_INPUT'],
  ]) {
    await assert.rejects(delegateRunnerCommand(action, input), (error) => {
      assert.equal(error.code, code);
      if (code === 'E_DELEGATE_COMMAND') {
        assert.ok(error.details.actions.includes('probe'));
        assert.ok(error.details.actions.includes('abandon'));
        assert.match(error.message, /openplanr delegate --help/);
      }
      return true;
    });
  }
});

test('context reports decoded workload independently of base64 packaging and never invents throughput', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'delegate-context-metrics-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const capsulePath = join(directory, 'capsule.json');
  const capsule = {
    request: 'Implement the selected scope.',
    inventory: [
      { repositoryKey: 'project', path: 'src/main.mjs', bytes: 100, required: true },
      { repositoryKey: 'project', path: 'docs/background.md', bytes: 200, required: false },
    ],
    encodedOverhead: 'x'.repeat(4000),
  };
  await writeFile(capsulePath, JSON.stringify(capsule));
  const prepared = {
    destination: { class: 'local', origin: 'http://127.0.0.1:1234' },
    profile: { argv: [] },
  };
  const result = await contextCapacity({ capsulePath }, prepared);
  assert.equal(result.contextBytes, 300);
  assert.equal(result.requiredBytes, 100);
  assert.equal(result.requiredFileCount, 1);
  assert.equal(result.optionalFileCount, 1);
  assert.ok(result.capsuleBytes > result.contextBytes);
  assert.equal(result.largestFiles[0].path, 'docs/background.md');
  assert.match(result.tokenEstimate, /unverified/);
  assert.match(result.durationEstimate, /unverified/);
  assert.match(result.guidance, /Required sources remain complete/);
  assert.deepEqual(JSON.parse(await readFile(capsulePath, 'utf8')), capsule);
});

test('changed routing is returned directly with before/after and does not launch or replace the prepared run', async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'delegate-route-diff-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'source');
  await mkdir(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  await writeFile(join(root, 'source.txt'), 'initial\n');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  const executable = join(base, 'codex');
  await writeFile(
    executable,
    `#!${process.execPath}\nif (process.argv.includes('--help')) console.log('--json resume --add-dir'); else process.exit(91);\n`,
    { mode: 0o700 },
  );
  const env = { PATH: '/usr/bin:/bin', HOME: base };
  const runDirectory = join(base, 'runs');
  const prepared = await prepareDelegateRun({
    repositoryRoot: root,
    request: 'Update source.txt.',
    profile: { name: 'fixture', kind: 'codex', executable, argv: [] },
    env,
    selectedFiles: ['source.txt'],
    scopePaths: ['source.txt'],
    runDirectory,
    profileDirectory: join(base, 'profiles'),
  });
  const result = await delegateRunnerCommand('dispatch', {
    runId: prepared.runId,
    runDirectory,
    env: { ...env, OPENAI_BASE_URL: 'https://different.example.test' },
  });
  assert.equal(result.status, 'prepared');
  assert.equal(result.diagnostic.code, 'E_DELEGATE_PROFILE_CHANGED');
  assert.deepEqual(
    result.diagnostic.details.changes.find(({ field }) => field === 'destination'),
    {
      field: 'destination',
      before: { class: 'native-managed', origin: 'native-managed' },
      after: { class: 'external', origin: 'https://different.example.test' },
    },
  );
  assert.match(result.nextAction, /prepare a new preview/);
  assert.equal(
    await readFile(join(prepared.record.worktreePath, 'source.txt'), 'utf8'),
    'initial\n',
  );
});
