import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  resolveSelectedChecks,
  runDelegateChecks,
} from '../../packages/pipeline/lib/delegate/integration-checks.mjs';
import { prepareProfile } from '../../packages/pipeline/lib/delegate/profiles.mjs';

const DELEGATE = resolve(import.meta.dirname, '../../packages/pipeline/lib/delegate');
const UNRELATED = { FOO_TOKEN: 'foo-secret', GITHUB_TOKEN: 'gh-secret', NPM_TOKEN: 'npm-secret' };
const HOST_AUTH = { ANTHROPIC_API_KEY: 'anthropic-key', OPENAI_API_KEY: 'openai-key' };

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

for (const [engine, command, own, other] of [
  ['claude', 'claude', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
  ['codex', 'codex', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
  ['cursor', 'agent', null, 'ANTHROPIC_API_KEY'],
]) {
  test(`${engine} children receive their own host variables and no unrelated token`, async (t) => {
    const { base, bin, root } = await workspace(t);
    const log = join(base, `${engine}.jsonl`);
    await recordingCli(bin, command, log);
    const env = {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: base,
      LANG: 'C.UTF-8',
      ...UNRELATED,
      ...HOST_AUTH,
      CURSOR_API_KEY: 'cursor-key',
      PROFILE_EXTRA: 'named-extra',
    };
    await prepareProfile(
      { kind: engine, executable: join(bin, command), argv: [], allowedEnv: ['PROFILE_EXTRA'] },
      { env, cwd: root, directory: join(base, 'profiles') },
    ).catch(() => undefined);
    const seen = await recordedEnvironments(log);
    assert.ok(seen.length > 0, `${engine} was never started`);
    for (const child of seen) {
      for (const name of Object.keys(UNRELATED)) assert.equal(child[name], undefined, name);
      assert.equal(child[other], undefined, other);
      if (own) assert.equal(child[own], HOST_AUTH[own]);
      if (engine === 'cursor') assert.equal(child.CURSOR_API_KEY, 'cursor-key');
      else assert.equal(child.CURSOR_API_KEY, undefined);
      assert.equal(child.PROFILE_EXTRA, 'named-extra');
      assert.equal(child.LANG, 'C.UTF-8');
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
  Object.assign(process.env, UNRELATED, HOST_AUTH, { DATABASE_URL: 'postgres://fixture' });
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
    for (const name of [...Object.keys(UNRELATED), ...Object.keys(HOST_AUTH)])
      assert.equal(child[name], undefined, name);
    assert.equal(child.PATH, process.env.PATH);
  }
  assert.equal(plain.DATABASE_URL, undefined);
  assert.equal(named.DATABASE_URL, 'postgres://fixture');
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
