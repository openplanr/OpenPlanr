import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectPlanDesignHandoff } from '../lib/design/plan-handoff-utility.mjs';
import { designUtility } from '../lib/design/utility.mjs';

const COMMANDS = [
  'inspect',
  'validate',
  'render',
  'open',
  'studio',
  'view-context',
  'export',
  'feedback',
  'verify',
  'share',
  'publish',
  'sync',
  'manage',
  'handoff',
];

function isolated(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'planr-design-help-')));
  const previous = process.cwd();
  const globalFetch = globalThis.fetch;
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    throw new Error('network is not allowed in help');
  };
  globalThis.fetch = fetchImpl;
  process.chdir(root);
  t.after(() => {
    process.chdir(previous);
    globalThis.fetch = globalFetch;
    rmSync(root, { recursive: true, force: true });
  });
  return { root, requests, fetchImpl, env: { ...process.env, PLANR_HOME: join(root, 'home') } };
}

for (const command of COMMANDS)
  for (const helpFlag of ['--help', '-h'])
    test(`design.mjs ${command} ${helpFlag} prints help and acts on nothing`, async (t) => {
      const { root, requests, fetchImpl, env } = isolated(t);
      const printed = [];
      const result = await designUtility([command, helpFlag], {
        stdout: (value) => printed.push(value),
        env,
        fetchImpl,
        openUrl: () => assert.fail('help must not open a browser'),
      });
      assert.equal(result.command, command);
      assert.match(result.usage, new RegExp(`design\\.mjs ${command} `));
      assert.deepEqual(printed, [result]);
      assert.deepEqual(requests, []);
      assert.deepEqual(readdirSync(root), []);
    });

test('a help flag after the document path still prints help', async (t) => {
  const { root, requests, fetchImpl, env } = isolated(t);
  for (const argv of [
    ['share', 'design-document.json', '--help'],
    ['publish', 'design-document.json', '--json', '-h'],
    ['manage', 'design-document.json', '--action', 'delete', '--help'],
  ]) {
    const result = await designUtility(argv, { stdout: () => {}, env, fetchImpl });
    assert.equal(result.command, argv[0]);
  }
  assert.deepEqual(requests, []);
  assert.deepEqual(readdirSync(root), []);
});

test('-h on its own prints the command list like --help', async (t) => {
  const { requests, fetchImpl, env } = isolated(t);
  const printed = [];
  const result = await designUtility(['-h'], {
    stdout: (value) => printed.push(value),
    env,
    fetchImpl,
  });
  assert.match(result.usage, /design\.mjs inspect\|validate/);
  assert.deepEqual(printed, [result]);
  assert.deepEqual(requests, []);
});

test('a document path that looks like an option is refused', async (t) => {
  const { requests, fetchImpl, env } = isolated(t);
  await assert.rejects(
    designUtility(['share', '-x'], { stdout: () => {}, env, fetchImpl }),
    /must be a design document path/,
  );
  assert.deepEqual(requests, []);
});

test('plan handoff support prints help wherever the flag appears', (t) => {
  const { root } = isolated(t);
  for (const argv of [
    ['handoff', '--help'],
    ['handoff', '-h'],
    ['handoff', 'design-document.json', '--help'],
  ]) {
    const result = inspectPlanDesignHandoff(argv, { stdout: () => {} });
    assert.match(result.usage, /design\.mjs handoff /);
  }
  assert.throws(
    () => inspectPlanDesignHandoff(['handoff', '-x'], { stdout: () => {} }),
    /must be a design document path/,
  );
  assert.deepEqual(readdirSync(root), []);
});
