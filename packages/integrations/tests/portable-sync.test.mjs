import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  executeGitHubOperations,
  ghEnvironment,
  IntegrationError,
  inspectGitHub,
  inspectLocal,
  isLikelyLinearIssueId,
  reconcileStatus,
} from '../src/index.mjs';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-portable-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A `gh` stand-in that logs argv and environment names, and fails any call whose argv contains `fail`. */
function fakeGh(dir) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const log = join(dir, 'gh.log');
  writeFileSync(
    join(bin, 'gh'),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, env: Object.keys(process.env).sort() }) + '\\n');
if (args.includes('fail')) { process.stderr.write('GraphQL: Could not resolve to an issue'); process.exit(1); }
if (args[0] === 'repo') process.stdout.write('{"nameWithOwner":"acme/app","url":"https://github.com/acme/app"}');
else if (args[1] === 'create') process.stdout.write('https://github.com/acme/app/issues/7\\n');
else process.stdout.write('https://github.com/acme/app/issues/' + args[2] + '\\n');
`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  const calls = () =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return { env: { PATH: bin, HOME: dir, FOO_TOKEN: 'leak', GH_TOKEN: 'gh-own' }, calls };
}

test('reconcileStatus applies deterministic three-way conflict rules', () => {
  assert.deepEqual(reconcileStatus({ base: 'todo', local: 'todo', remote: 'done' }, 'local'), {
    final: 'done',
    side: 'remote',
    conflictDecisions: 0,
    isTrueConflict: false,
  });
  assert.equal(reconcileStatus({ local: 'todo', remote: 'done' }, 'local').final, 'todo');
  assert.equal(reconcileStatus({ local: 'todo', remote: 'done' }, 'remote').final, 'done');
});

test('Linear identifiers accept API UUIDs and human identifiers', () => {
  assert.equal(isLikelyLinearIssueId('ENG-42'), true);
  assert.equal(isLikelyLinearIssueId('7c252d85-2db6-4d36-a0ab-3df9f84f0301'), true);
  assert.equal(isLikelyLinearIssueId('ENG42'), false);
});

test('the gh environment keeps gh settings and drops unrelated secrets', () => {
  const child = ghEnvironment({
    PATH: '/bin',
    HOME: '/home/a',
    GH_TOKEN: 'gh-own',
    FOO_TOKEN: 'leak',
    OPENAI_API_KEY: 'leak',
    AWS_SECRET_ACCESS_KEY: 'leak',
  });
  assert.equal(child.PATH, '/bin');
  assert.equal(child.GH_TOKEN, 'gh-own');
  assert.equal(child.GH_PROMPT_DISABLED, '1');
  for (const name of ['FOO_TOKEN', 'OPENAI_API_KEY', 'AWS_SECRET_ACCESS_KEY'])
    assert.equal(name in child, false, `${name} reached the gh child`);
});

test('a preview validates every operation and runs nothing', async () => {
  const result = await executeGitHubOperations([{ action: 'create', title: 'Example' }], {
    env: { PATH: '' },
  });
  assert.deepEqual(result, {
    provider: 'github',
    applied: false,
    complete: true,
    results: [{ index: 0, action: 'create', title: 'Example', status: 'planned' }],
  });
  for (const [operations, pattern] of [
    [{}, /JSON array/u],
    [[{ action: 'create', title: ' ' }], /Operation 0: create needs a non-empty "title"/u],
    [[{ action: 'delete', id: '1' }], /Operation 0: unknown action "delete"/u],
    [[{ action: 'update', id: '3' }], /update needs at least one of/u],
    [[{ action: 'close', id: 'abc' }], /"id" must be an issue number or an issue URL/u],
    [[{ action: 'create', title: 'x', projectId: 'p' }], /create does not take projectId/u],
  ])
    await assert.rejects(
      executeGitHubOperations(operations, { env: { PATH: '' } }),
      (error) =>
        error instanceof IntegrationError &&
        error.code === 'E_SYNC_TRACKER_INPUT' &&
        pattern.test(error.message) &&
        typeof error.recovery === 'string',
    );
});

test('apply runs gh with an allowlisted environment and reports each issue', async (t) => {
  const dir = scratch(t);
  const gh = fakeGh(dir);
  const result = await executeGitHubOperations(
    [
      { action: 'create', title: 'New', labels: ['planr:task'] },
      { action: 'update', id: 3, title: 'Renamed' },
      { action: 'close', id: '4', comment: 'Done locally' },
      { action: 'reopen', id: '5' },
    ],
    { cwd: dir, env: gh.env, apply: true },
  );
  assert.equal(result.complete, true);
  assert.deepEqual(
    result.results.map(({ action, id, status, url }) => ({ action, id, status, url })),
    [
      { action: 'create', id: '7', status: 'applied', url: 'https://github.com/acme/app/issues/7' },
      { action: 'update', id: '3', status: 'applied', url: 'https://github.com/acme/app/issues/3' },
      { action: 'close', id: '4', status: 'applied', url: 'https://github.com/acme/app/issues/4' },
      { action: 'reopen', id: '5', status: 'applied', url: 'https://github.com/acme/app/issues/5' },
    ],
  );
  const calls = gh.calls();
  assert.deepEqual(
    calls.map(({ args }) => args),
    [
      ['issue', 'create', '--title', 'New', '--body', '', '--label', 'planr:task'],
      ['issue', 'edit', '3', '--title', 'Renamed'],
      ['issue', 'close', '4', '--comment', 'Done locally'],
      ['issue', 'reopen', '5'],
    ],
  );
  for (const { env } of calls) {
    assert.equal(env.includes('FOO_TOKEN'), false, 'FOO_TOKEN reached gh');
    assert.equal(env.includes('GH_TOKEN'), true);
  }
});

test('apply stops at the first failure and marks the rest not run', async (t) => {
  const dir = scratch(t);
  const gh = fakeGh(dir);
  const result = await executeGitHubOperations(
    [
      { action: 'close', id: '1' },
      { action: 'update', id: '2', title: 'fail' },
      { action: 'reopen', id: '3' },
    ],
    { cwd: dir, env: gh.env, apply: true },
  );
  assert.equal(result.complete, false);
  assert.deepEqual(
    result.results.map(({ status }) => status),
    ['applied', 'failed', 'not-run'],
  );
  assert.equal(result.results[1].error.code, 'E_SYNC_TRACKER_GH_FAILED');
  assert.match(result.results[1].error.problem, /Could not resolve to an issue/u);
  assert.equal(gh.calls().length, 2);
});

test('inspect reports the repository, a missing gh, and configured planning roots', async (t) => {
  const dir = scratch(t);
  const gh = fakeGh(dir);
  assert.deepEqual(await inspectGitHub({ cwd: dir, env: gh.env }), {
    provider: 'github',
    repository: { nameWithOwner: 'acme/app', url: 'https://github.com/acme/app' },
  });
  await assert.rejects(
    inspectGitHub({ cwd: dir, env: { PATH: join(dir, 'missing') } }),
    (error) =>
      error.code === 'E_SYNC_TRACKER_GH_MISSING' && /cli\.github\.com/u.test(error.recovery),
  );
  assert.deepEqual(await inspectLocal({ cwd: dir }), {
    provider: 'local',
    roots: [],
    configured: false,
  });
  mkdirSync(join(dir, '.planr'));
  writeFileSync(join(dir, '.planr', 'config.json'), '{}');
  assert.deepEqual(await inspectLocal({ cwd: dir }), {
    provider: 'local',
    roots: ['.planr'],
    configured: true,
  });
});

test('an issue URL must belong to the repository gh resolves', async (t) => {
  const dir = scratch(t);
  const gh = fakeGh(dir);
  const preview = await executeGitHubOperations(
    [{ action: 'close', id: 'https://github.com/acme/app/issues/9' }],
    { cwd: dir, env: gh.env },
  );
  assert.equal(preview.results[0].status, 'planned');
  await assert.rejects(
    executeGitHubOperations(
      [
        { action: 'close', id: '3' },
        { action: 'reopen', id: 'https://github.com/other/app/issues/9' },
      ],
      { cwd: dir, env: gh.env, apply: true },
    ),
    (error) =>
      error.code === 'E_SYNC_TRACKER_FOREIGN_ISSUE' &&
      /Operation 1: https:\/\/github\.com\/other\/app\/issues\/9 is not an issue in acme\/app/u.test(
        error.message,
      ),
  );
  assert.deepEqual(
    gh.calls().map(({ args }) => args[0]),
    ['repo', 'repo'],
    'only the repository lookups ran; no issue changed',
  );
});
