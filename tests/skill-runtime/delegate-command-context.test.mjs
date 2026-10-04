import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { contextCapacity } from '../../skills/planr-delegate/scripts/run-preflight.mjs';
import {
  delegateRunnerCommand,
  prepareDelegateRun,
} from '../../skills/planr-delegate/scripts/runner.mjs';

const runner = fileURLToPath(
  new URL('../../skills/planr-delegate/scripts/runner.mjs', import.meta.url),
);

test('CLI accepts documented argument and stdin action forms and returns actionable usage', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'delegate-command-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const call = (args, input) =>
    spawnSync(process.execPath, [runner, ...args], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', HOME: home },
    });
  for (const [args, input] of [
    [['probe'], {}],
    [[], { action: 'probe' }],
    [['probe'], { action: 'probe' }],
  ]) {
    const result = call(args, input);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
  }
  for (const [args, input, code] of [
    [[], {}, 'E_DELEGATE_COMMAND'],
    [[], { action: 'unknown' }, 'E_DELEGATE_COMMAND'],
    [['probe'], { action: 'prepare' }, 'E_DELEGATE_INPUT'],
    [['probe'], [], 'E_DELEGATE_INPUT'],
    [['probe'], null, 'E_DELEGATE_INPUT'],
  ]) {
    const result = call(args, input);
    assert.equal(result.status, 1);
    const error = JSON.parse(result.stderr);
    assert.equal(error.code, code);
    if (code === 'E_DELEGATE_COMMAND') {
      assert.ok(error.details.actions.includes('probe'));
      assert.ok(error.details.actions.includes('abandon'));
      assert.match(error.message, /node runner.mjs <action>/);
    }
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
