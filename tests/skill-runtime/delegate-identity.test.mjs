import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { claudeAdapter } from '../../packages/pipeline/lib/delegate/adapters/claude.mjs';
import { codexAdapter } from '../../packages/pipeline/lib/delegate/adapters/codex.mjs';
import {
  claudeIdentity,
  codexIdentity,
  cursorIdentity,
  identityForDestination,
  readNativeIdentity,
} from '../../packages/pipeline/lib/delegate/adapters/identity.mjs';
import { prepareProfile } from '../../packages/pipeline/lib/delegate/profiles.mjs';

const ACCOUNT = {
  email: 'person@example.test',
  orgId: 'org-0123456789abcdef',
  orgName: 'Example Organization',
  accountUuid: 'acct-fedcba9876543210',
};
const PRIVATE_VALUES = Object.values(ACCOUNT);

function assertNoAccountData(value) {
  const text = JSON.stringify(value);
  for (const secret of [...PRIVATE_VALUES, 'sk-proj']) assert.equal(text.includes(secret), false);
}

async function fakeEngine(t, name, script) {
  const root = await mkdtemp(join(tmpdir(), 'planr-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, name);
  await writeFile(executable, `#!/usr/bin/env node\n${script}\n`);
  await chmod(executable, 0o700);
  return {
    root,
    executable,
    env: { HOME: root, PATH: `${join(process.execPath, '..')}:${process.env.PATH}` },
  };
}

test('Claude status keeps only the sign-in state', () => {
  const status = (fields) => JSON.stringify({ ...ACCOUNT, apiProvider: 'firstParty', ...fields });
  const cases = [
    [{ loggedIn: true, authMethod: 'claude.ai' }, { state: 'account' }],
    [{ loggedIn: false, authMethod: 'none' }, { state: 'signed-out' }],
    [{ loggedIn: true, authMethod: 'api_key' }, { state: 'api-key' }],
    [{ loggedIn: false, apiProvider: 'bedrock' }, { state: 'provider-managed' }],
    [
      { loggedIn: true, authMethod: 'future' },
      { state: 'not-checked', reason: 'unrecognized-method' },
    ],
    [{ authMethod: 'claude.ai' }, { state: 'not-checked', reason: 'unrecognized-output' }],
  ];
  for (const [fields, expected] of cases) {
    const identity = claudeIdentity(status(fields));
    assert.deepEqual(identity, expected);
    assertNoAccountData(identity);
  }
  assert.deepEqual(claudeIdentity('Logged in as person@example.test'), {
    state: 'not-checked',
    reason: 'unrecognized-output',
  });
});

test('Codex status matches known lines and drops the rest of each line', () => {
  assert.deepEqual(codexIdentity('Logged in using ChatGPT (person@example.test)\n'), {
    state: 'account',
  });
  const apiKey = codexIdentity('Logged in using an API key - sk-proj-***ABCD\n');
  assert.deepEqual(apiKey, { state: 'api-key' });
  assertNoAccountData(apiKey);
  assert.deepEqual(codexIdentity('Not logged in\n'), { state: 'signed-out' });
  assert.deepEqual(codexIdentity('{"isAuthenticated":true}'), {
    state: 'not-checked',
    reason: 'unrecognized-output',
  });
});

test('Cursor status keeps only the sign-in state', () => {
  const account = cursorIdentity({
    isAuthenticated: true,
    hasAccessToken: true,
    userInfo: ACCOUNT,
  });
  assert.deepEqual(account, { state: 'account' });
  assertNoAccountData(account);
  assert.deepEqual(cursorIdentity({ isAuthenticated: false }), { state: 'signed-out' });
  assert.deepEqual(cursorIdentity({ isAuthenticated: true }), {
    state: 'not-checked',
    reason: 'unrecognized-method',
  });
});

test('a local destination needs no vendor sign-in; a cloud one names the login command', () => {
  assert.deepEqual(identityForDestination('codex', { state: 'signed-out' }, { class: 'local' }), {
    state: 'not-required',
  });
  assert.deepEqual(
    identityForDestination('claude', { state: 'signed-out' }, { class: 'native-managed' }),
    {
      state: 'signed-out',
      nextAction: 'Run claude auth login in your terminal, then probe again.',
    },
  );
  assert.deepEqual(identityForDestination('codex', { state: 'account' }, { class: 'local' }), {
    state: 'account',
  });
});

test('Claude probe reads sign-in through the engine and returns no account data', async (t) => {
  const f = await fakeEngine(
    t,
    'claude',
    [
      "if (process.argv.includes('--help')) { console.log('--print --output-format stream-json --resume --session-id --add-dir'); process.exit(0); }",
      "if (process.argv.slice(2, 4).join(' ') === 'auth status') {",
      `  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', configDirectory: process.env.CLAUDE_CONFIG_DIR, ...${JSON.stringify(ACCOUNT)} }));`,
      '  process.exit(0);',
      '}',
      'process.exit(9);',
    ].join('\n'),
  );
  const result = await claudeAdapter.probe({
    profile: { kind: 'claude', executable: f.executable, argv: [] },
    cwd: f.root,
    env: f.env,
  });
  assert.deepEqual(result.identity, { state: 'account' });
  assertNoAccountData(result);
});

test('Codex probe checks the profile configuration and reports failures as not checked', async (t) => {
  const f = await fakeEngine(
    t,
    'codex',
    [
      "if (process.argv.includes('--help')) { console.log('--json resume --add-dir'); process.exit(0); }",
      "if (process.argv.slice(2, 4).join(' ') === 'login status') {",
      "  if (process.env.CODEX_HOME?.endsWith('broken')) process.exit(2);",
      "  process.stderr.write(process.env.CODEX_HOME?.endsWith('signed-in') ? 'Logged in using ChatGPT (person@example.test)\\n' : 'Not logged in\\n');",
      '  process.exit(0);',
      '}',
      'process.exit(9);',
    ].join('\n'),
  );
  const probe = (configDir) =>
    codexAdapter.probe({
      profile: { kind: 'codex', executable: f.executable, argv: [] },
      env: { ...f.env, CODEX_HOME: join(f.root, configDir) },
    });
  const signedIn = await probe('signed-in');
  assert.deepEqual(signedIn.identity, { state: 'account' });
  assertNoAccountData(signedIn);
  assert.deepEqual((await probe('signed-out')).identity, {
    state: 'signed-out',
    nextAction: 'Run codex login in your terminal, then probe again.',
  });
  assert.equal((await probe('broken')).identity.state, 'not-checked');
});

test('a prepared profile carries the identity from its own configuration directory', async (t) => {
  const f = await fakeEngine(
    t,
    'codex',
    [
      "if (process.argv.includes('--help')) { console.log('--json resume --add-dir'); process.exit(0); }",
      "if (process.argv.slice(2, 4).join(' ') === 'login status') {",
      "  console.log(process.env.CODEX_HOME?.endsWith('work') ? 'Logged in using ChatGPT' : 'Not logged in');",
      '  process.exit(0);',
      '}',
      'process.exit(9);',
    ].join('\n'),
  );
  const configDir = join(f.root, 'work');
  await mkdir(configDir);
  const prepared = await prepareProfile(
    { name: 'codex-work', kind: 'codex', executable: f.executable, argv: [], configDir },
    { cwd: f.root, env: f.env },
  );
  assert.deepEqual(prepared.identity, { state: 'account' });
});

test('a Claude profile status call sees its configuration directory and ignores stderr', async (t) => {
  const f = await fakeEngine(
    t,
    'claude',
    [
      "if (process.argv.includes('--help')) { console.log('--print --output-format stream-json --resume --session-id --add-dir'); process.exit(0); }",
      "if (process.argv.slice(2, 4).join(' ') === 'auth status') {",
      "  process.stderr.write('Warning: a newer version is available\\n');",
      "  const signedIn = process.env.CLAUDE_CONFIG_DIR?.endsWith('work');",
      "  console.log(JSON.stringify({ loggedIn: signedIn, authMethod: signedIn ? 'claude.ai' : 'none', apiProvider: 'firstParty' }));",
      '  process.exit(0);',
      '}',
      'process.exit(9);',
    ].join('\n'),
  );
  const prepare = async (name) => {
    const configDir = join(f.root, name);
    await mkdir(configDir);
    return prepareProfile(
      { name: `claude-${name}`, kind: 'claude', executable: f.executable, argv: [], configDir },
      { cwd: f.root, env: f.env },
    );
  };
  assert.deepEqual((await prepare('work')).identity, { state: 'account' });
  assert.deepEqual((await prepare('other')).identity, {
    state: 'signed-out',
    nextAction: 'Run claude auth login in your terminal, then probe again.',
  });
});

test('an unconfirmed status process stop is raised, other failures report not checked', async () => {
  const failing = (fields) => async () => {
    throw Object.assign(new Error('status failed'), fields);
  };
  const options = (fields) => ({ env: {}, invoke: failing(fields) });
  await assert.rejects(
    readNativeIdentity('claude', ['auth', 'status'], claudeIdentity, {
      ...options({ code: 'E_ADAPTER_TIMEOUT', processTerminationConfirmed: false }),
    }),
    { processTerminationConfirmed: false },
  );
  await assert.rejects(
    readNativeIdentity('claude', ['auth', 'status'], claudeIdentity, {
      ...options({ code: 'E_ADAPTER_CANCELLED' }),
    }),
    { code: 'E_ADAPTER_CANCELLED' },
  );
  assert.deepEqual(
    await readNativeIdentity('claude', ['auth', 'status'], claudeIdentity, {
      ...options({ code: 'E_ADAPTER_TIMEOUT' }),
    }),
    { state: 'not-checked', reason: 'E_ADAPTER_TIMEOUT' },
  );
});
