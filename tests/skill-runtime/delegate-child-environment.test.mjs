import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
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
const ENGINE_SETTINGS = {
  CLAUDE_FIXTURE_SETTING: 'claude-setting',
  OPENAI_FIXTURE_SETTING: 'openai-setting',
  CURSOR_FIXTURE_SETTING: 'cursor-setting',
};

for (const [engine, command, own, chosen] of [
  ['claude', 'claude', 'CLAUDE_FIXTURE_SETTING', 'ANTHROPIC_API_KEY'],
  ['codex', 'codex', 'OPENAI_FIXTURE_SETTING', 'OPENAI_API_KEY'],
  ['cursor', 'agent', 'CURSOR_FIXTURE_SETTING', 'CURSOR_API_KEY'],
]) {
  test(`${engine} children get their engine settings, no credential unless chosen, and no unrelated token`, async (t) => {
    const { base, bin, root } = await workspace(t);
    const env = {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: base,
      LANG: 'C.UTF-8',
      ...UNRELATED,
      ...CREDENTIALS,
      ...ENGINE_SETTINGS,
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
        for (const name of Object.keys(UNRELATED)) assert.equal(child[name], undefined, name);
        for (const name of Object.keys(CREDENTIALS))
          assert.equal(
            child[name],
            allowedEnv.includes(name) ? CREDENTIALS[name] : undefined,
            `${name} with allowedEnv ${allowedEnv}`,
          );
        for (const name of Object.keys(ENGINE_SETTINGS))
          assert.equal(child[name], name === own ? ENGINE_SETTINGS[name] : undefined, name);
        assert.equal(child.PROFILE_EXTRA, 'named-extra');
        assert.equal(child.LANG, 'C.UTF-8');
      }
    }
  });
}

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
      if (!/\benv\b/u.test(call)) unbounded.push(`${file.slice(DELEGATE.length + 1)}:${call}`);
    }
    if (/\.\.\.process\.env\b/u.test(source))
      unbounded.push(`${file.slice(DELEGATE.length + 1)}: spreads process.env`);
  }
  assert.deepEqual(unbounded, []);
});
