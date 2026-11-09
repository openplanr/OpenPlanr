import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { invokeProcess } from '../../packages/pipeline/lib/delegate/adapters/generic.mjs';
import { agentEnvironment } from '../../packages/pipeline/lib/delegate/child-environment.mjs';
import { captureFileState, gitFileState } from '../../packages/pipeline/lib/delegate/custody.mjs';
import { snapshotTip } from '../../packages/pipeline/lib/delegate/handoff.mjs';
import {
  resolveSelectedChecks,
  runDelegateChecks,
} from '../../packages/pipeline/lib/delegate/integration-checks.mjs';
import { git as integrationGit } from '../../packages/pipeline/lib/delegate/integration-files.mjs';
import { prepareProfile } from '../../packages/pipeline/lib/delegate/profiles.mjs';
import { processIdentity } from '../../packages/pipeline/lib/delegate/run-record.mjs';

const DELEGATE = resolve(import.meta.dirname, '../../packages/pipeline/lib/delegate');
const UNRELATED = { FOO_TOKEN: 'foo-secret', GITHUB_TOKEN: 'gh-secret', NPM_TOKEN: 'npm-secret' };

async function workspace(t) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'planr-delegate-env-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const bin = join(base, 'bin');
  const root = join(base, 'repository');
  await mkdir(bin);
  await mkdir(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  return { base, bin, root };
}

// A fake native CLI that records the environment it was started with, then answers its probes.
async function recordingCli(bin, command, log) {
  await writeFile(
    join(bin, command),
    `#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.env) + '\\n');
const args = process.argv.slice(2);
if (args.includes('--help')) console.log('--print --output-format stream-json --resume --session-id --add-dir --json resume --sandbox --workspace');
else if (args.includes('status')) console.log(JSON.stringify({ isAuthenticated: true }));
`,
    { mode: 0o700 },
  );
}

async function recordedEnvironments(log) {
  return (await readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

const CREDENTIALS = {
  ANTHROPIC_API_KEY: 'anthropic-key',
  ANTHROPIC_AUTH_TOKEN: 'anthropic-token',
  CLAUDE_CODE_OAUTH_TOKEN: 'claude-oauth',
  OPENAI_API_KEY: 'openai-key',
  CODEX_API_KEY: 'codex-key',
  CURSOR_API_KEY: 'cursor-key',
};
// Engine variables no adapter reads; ANTHROPIC_CUSTOM_HEADERS often carries an Authorization header.
const UNREAD_ENGINE_SETTINGS = {
  ANTHROPIC_CUSTOM_HEADERS: 'Authorization: Bearer header-secret',
  CLAUDE_FIXTURE_SETTING: 'claude-setting',
  OPENAI_ORGANIZATION: 'openai-organization',
  CURSOR_FIXTURE_SETTING: 'cursor-setting',
};

for (const [engine, command, configVariable, chosen] of [
  ['claude', 'claude', 'CLAUDE_CONFIG_DIR', 'ANTHROPIC_API_KEY'],
  ['codex', 'codex', 'CODEX_HOME', 'OPENAI_API_KEY'],
  ['cursor', 'agent', null, 'CURSOR_API_KEY'],
]) {
  test(`${engine} children get their config directory, no credential unless chosen, and no unrelated variable`, async (t) => {
    const { base, bin, root } = await workspace(t);
    const configDirectory = join(base, 'native-config');
    await mkdir(configDirectory);
    const env = {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: base,
      LANG: 'C.UTF-8',
      ...UNRELATED,
      ...CREDENTIALS,
      ...UNREAD_ENGINE_SETTINGS,
      ...(configVariable ? { [configVariable]: configDirectory } : {}),
      PROFILE_EXTRA: 'named-extra',
    };
    for (const allowedEnv of [['PROFILE_EXTRA'], ['PROFILE_EXTRA', chosen]]) {
      const log = join(base, `${engine}-${allowedEnv.length}.jsonl`);
      await recordingCli(bin, command, log);
      await prepareProfile(
        { kind: engine, executable: join(bin, command), argv: [], allowedEnv },
        { env, cwd: root, directory: join(base, 'profiles') },
      ).catch(() => undefined);
      const seen = await recordedEnvironments(log);
      assert.ok(seen.length > 0, `${engine} was never started`);
      for (const child of seen) {
        for (const name of [...Object.keys(UNRELATED), ...Object.keys(UNREAD_ENGINE_SETTINGS)])
          assert.equal(child[name], undefined, name);
        for (const name of Object.keys(CREDENTIALS))
          assert.equal(
            child[name],
            allowedEnv.includes(name) ? CREDENTIALS[name] : undefined,
            `${name} with allowedEnv ${allowedEnv}`,
          );
        if (configVariable) assert.equal(child[configVariable], configDirectory);
        assert.equal(child.PROFILE_EXTRA, 'named-extra');
        assert.equal(child.LANG, 'C.UTF-8');
      }
    }
  });
}

test('each engine receives only the routing names its adapter reads', () => {
  const source = {
    PATH: '/usr/bin',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:1234',
    OPENAI_BASE_URL: 'http://127.0.0.1:5678',
    CURSOR_API_ENDPOINT: 'https://cursor.example.test',
    AWS_REGION: 'eu-west-1',
    AWS_SESSION_TOKEN: 'aws-token',
    CLOUD_ML_REGION: 'us-east5',
  };
  const names = (kind, extra = {}) =>
    Object.keys(agentEnvironment({ kind, allowedEnv: [] }, { ...source, ...extra })).sort();
  assert.deepEqual(names('claude'), ['ANTHROPIC_BASE_URL', 'PATH']);
  assert.deepEqual(names('claude', { CLAUDE_CODE_USE_BEDROCK: '1' }), [
    'ANTHROPIC_BASE_URL',
    'AWS_REGION',
    'CLAUDE_CODE_USE_BEDROCK',
    'PATH',
  ]);
  assert.deepEqual(names('claude', { CLAUDE_CODE_USE_VERTEX: '1' }), [
    'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_USE_VERTEX',
    'CLOUD_ML_REGION',
    'PATH',
  ]);
  assert.deepEqual(names('codex'), ['OPENAI_BASE_URL', 'PATH']);
  assert.deepEqual(names('cursor'), ['CURSOR_API_ENDPOINT', 'PATH']);
  assert.deepEqual(names('generic'), ['PATH']);
});

test('parent-selected checks receive the base environment plus only the names they list', async (t) => {
  const { base, root } = await workspace(t);
  const log = join(base, 'check.jsonl');
  const record = `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.env) + '\\n')`;
  const saved = { ...process.env };
  t.after(() => {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  });
  Object.assign(process.env, UNRELATED, CREDENTIALS, { DATABASE_URL: 'postgres://fixture' });
  const checks = await resolveSelectedChecks(root, [
    { executable: process.execPath, args: ['-e', record], cwd: '.' },
    { executable: process.execPath, args: ['-e', record], cwd: '.', env: ['DATABASE_URL'] },
  ]);
  const results = await runDelegateChecks({ repositoryRoot: root, checks, timeoutMs: 20000 });
  assert.deepEqual(
    results.map(({ status }) => status),
    ['passed', 'passed'],
  );
  const [plain, named] = await recordedEnvironments(log);
  for (const child of [plain, named]) {
    for (const name of [...Object.keys(UNRELATED), ...Object.keys(CREDENTIALS)])
      assert.equal(child[name], undefined, name);
    assert.equal(child.PATH, process.env.PATH);
  }
  assert.equal(plain.DATABASE_URL, undefined);
  assert.equal(named.DATABASE_URL, 'postgres://fixture');
});

// Wraps a real tool so each call records the environment it was started with.
async function recordingWrapper(bin, tool, log) {
  const real = execFileSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim();
  await writeFile(
    join(bin, tool),
    `#!/bin/sh\n${JSON.stringify(process.execPath)} -e 'require("node:fs").appendFileSync(process.argv[1], JSON.stringify({ tool: process.argv[2], env: process.env }) + "\\n")' ${JSON.stringify(log)} ${tool}\nexec ${JSON.stringify(real)} "$@"\n`,
    { mode: 0o700 },
  );
}

test('git and ps children get the base environment and no token or credential', async (t) => {
  const { base, bin, root } = await workspace(t);
  const log = join(base, 'tools.jsonl');
  await recordingWrapper(bin, 'git', log);
  await recordingWrapper(bin, 'ps', log);
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  await writeFile(join(root, 'a.txt'), 'a\n');
  const saved = { ...process.env };
  t.after(() => {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  });
  Object.assign(process.env, UNRELATED, CREDENTIALS, { PATH: `${bin}:${process.env.PATH}` });
  await snapshotTip({ worktreePath: root, runId: 'environment-run' });
  await integrationGit(root, 'status', '--porcelain');
  await gitFileState(root, 'a.txt', await captureFileState(root, 'a.txt'));
  await processIdentity();
  const calls = await recordedEnvironments(log);
  const tools = new Set(calls.map(({ tool }) => tool));
  assert.ok(tools.has('git'));
  if (process.platform !== 'linux') assert.ok(tools.has('ps'));
  for (const { tool, env } of calls) {
    for (const name of [...Object.keys(UNRELATED), ...Object.keys(CREDENTIALS)])
      assert.equal(env[name], undefined, `${tool} received ${name}`);
    assert.equal(env.HOME, process.env.HOME);
  }
});

test('starting a process without an explicit environment fails instead of inheriting one', async () => {
  for (const options of [{}, { env: undefined }, { env: null }])
    await assert.rejects(invokeProcess(process.execPath, ['-e', ''], options), {
      code: 'E_ADAPTER_ENVIRONMENT',
    });
});

test('every child process the delegate runtime starts names an explicit environment', async () => {
  const files = [];
  for (const entry of await readdir(DELEGATE, { recursive: true, withFileTypes: true }))
    if (entry.isFile() && entry.name.endsWith('.mjs'))
      files.push(join(entry.parentPath, entry.name));
  const unbounded = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(
      /\b(?:execFile|execFileAsync|spawn|promisify\(execFileCallback\))\(|\bexecute\(\s*['"]/gu,
    )) {
      const call = source.slice(match.index, source.indexOf(');', match.index) + 2);
      const relative = file.slice(DELEGATE.length + 1);
      // invokeProcess rejects a missing env before this spawn; every other site builds one by name.
      const guardedSpawn =
        relative === 'adapters/generic.mjs' &&
        call.startsWith('spawn(') &&
        source.includes("'E_ADAPTER_ENVIRONMENT'");
      if (!guardedSpawn && !/\benv: (?:base|git|check|agent)Environment\(/u.test(call))
        unbounded.push(`${relative}:${call}`);
    }
    if (/\.\.\.process\.env\b/u.test(source))
      unbounded.push(`${file.slice(DELEGATE.length + 1)}: spreads process.env`);
  }
  assert.deepEqual(unbounded, []);
});
