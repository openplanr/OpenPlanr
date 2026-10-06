import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveClaudeRouting } from '../../skills/planr-delegate/scripts/adapters/claude.mjs';
import { inspectLocalBackend } from '../../skills/planr-delegate/scripts/backend-diagnostics.mjs';
import { enrollProfile, prepareProfile } from '../../skills/planr-delegate/scripts/profiles.mjs';

const local = { class: 'local', origin: 'http://localhost:1234' };
const external = { class: 'external', origin: 'https://api.example.test' };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-delegate-routing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDir = join(root, 'claude-config');
  const cwd = join(root, 'worktree');
  await mkdir(configDir);
  await mkdir(join(cwd, '.claude'), { recursive: true });
  const executable = join(root, 'claude');
  await writeFile(
    executable,
    [
      '#!/usr/bin/env node',
      "if (process.argv.includes('--help')) {",
      "console.log('--print --output-format stream-json --resume --session-id --add-dir');",
      'setTimeout(() => process.exit(0), 100);',
      "} else { require('node:fs').writeFileSync('unexpected-execution.txt', 'started'); }",
    ].join('\n'),
    { mode: 0o700 },
  );
  const env = { HOME: root, PATH: `${join(process.execPath, '..')}:${process.env.PATH}` };
  const profile = {
    name: 'claude-local',
    kind: 'claude',
    executable,
    configDir,
    argv: ['--model', 'selected-model'],
  };
  const settings = (env) => writeFile(join(configDir, 'settings.json'), JSON.stringify({ env }));
  return { root, configDir, cwd, profile, env, settings };
}

test('Claude routing inspects inherited and installed settings without exposing their values', async (t) => {
  const f = await fixture(t);
  await f.settings({
    ANTHROPIC_BASE_URL: `${local.origin}/anthropic`,
    ANTHROPIC_AUTH_TOKEN: 'private-config-value',
  });
  await writeFile(
    join(f.cwd, '.claude', 'settings.json'),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: local.origin } }),
  );
  await writeFile(
    join(f.cwd, '.claude', 'settings.local.json'),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: local.origin } }),
  );
  const found = await resolveClaudeRouting(
    f.profile,
    { ...f.env, ANTHROPIC_BASE_URL: local.origin },
    f.cwd,
  );
  assert.deepEqual(found.destination, local);
  assert.equal(found.routing.sources.length, 4);
  assert.equal(found.routing.coverage, 'environment-and-file-settings');
  assert.equal(JSON.stringify(found).includes('private-config-value'), false);
  assert.equal(JSON.stringify(found).includes('/anthropic'), false);
});

test('conflicting environment and settings routes fail closed with sanitized source evidence', async (t) => {
  const f = await fixture(t);
  await f.settings({
    ANTHROPIC_BASE_URL: local.origin,
    ANTHROPIC_AUTH_TOKEN: 'private-auth-value',
  });
  await assert.rejects(
    resolveClaudeRouting(f.profile, { ...f.env, ANTHROPIC_BASE_URL: external.origin }, f.cwd),
    (error) => {
      assert.equal(error.code, 'E_DESTINATION_UNKNOWN');
      assert.equal(error.details.routing.state, 'ambiguous');
      assert.deepEqual(
        error.details.routing.candidates.map(({ origin }) => origin),
        [external.origin, local.origin],
      );
      assert.match(error.details.nextAction, /prepare a fresh preview/);
      assert.equal(JSON.stringify(error.details).includes('private-auth-value'), false);
      return true;
    },
  );
});

test('provider flags cannot silently turn a concrete local route into native-managed routing', async (t) => {
  const f = await fixture(t);
  await f.settings({ ANTHROPIC_BASE_URL: local.origin });
  await assert.rejects(
    resolveClaudeRouting(f.profile, { ...f.env, CLAUDE_CODE_USE_BEDROCK: '1' }, f.cwd),
    { code: 'E_DESTINATION_UNKNOWN' },
  );
  assert.deepEqual(
    (await resolveClaudeRouting(f.profile, { ...f.env, CLAUDE_CODE_USE_BEDROCK: 'false' }, f.cwd))
      .destination,
    local,
  );
  await f.settings({});
  await assert.rejects(
    resolveClaudeRouting(
      f.profile,
      { ...f.env, CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1' },
      f.cwd,
    ),
    { code: 'E_DESTINATION_UNKNOWN' },
  );
});

test('empty endpoint overrides and managed fragment routes remain visible routing conflicts', async (t) => {
  const f = await fixture(t);
  const managedRoot = join(f.root, 'managed');
  await mkdir(join(managedRoot, 'managed-settings.d'), { recursive: true });
  await f.settings({ ANTHROPIC_BASE_URL: local.origin });
  await writeFile(
    join(managedRoot, 'managed-settings.d', '10-routing.json'),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: external.origin } }),
  );
  await assert.rejects(resolveClaudeRouting(f.profile, f.env, f.cwd, { managedRoot }), (error) => {
    assert.equal(error.code, 'E_DESTINATION_UNKNOWN');
    assert.ok(
      error.details.routing.sources.includes('managed fragment settings 1: ANTHROPIC_BASE_URL'),
    );
    return true;
  });
  await rm(join(managedRoot, 'managed-settings.d', '10-routing.json'));
  await writeFile(
    join(f.cwd, '.claude', 'settings.local.json'),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: '' } }),
  );
  await assert.rejects(resolveClaudeRouting(f.profile, f.env, f.cwd, { managedRoot }), {
    code: 'E_DESTINATION_UNKNOWN',
  });
});

test('unsafe endpoints and unreadable settings never become an apparently usable route', async (t) => {
  const f = await fixture(t);
  for (const endpoint of [
    'https://user:private-password@example.test',
    'https://example.test?token=private-query',
    123,
  ]) {
    await f.settings({ ANTHROPIC_BASE_URL: endpoint });
    await assert.rejects(resolveClaudeRouting(f.profile, f.env, f.cwd), (error) => {
      assert.equal(error.code, 'E_DESTINATION_UNKNOWN');
      assert.equal(JSON.stringify(error.details).includes('private-'), false);
      return true;
    });
  }
  await writeFile(join(f.configDir, 'settings.json'), 'not JSON');
  await assert.rejects(resolveClaudeRouting(f.profile, f.env, f.cwd), {
    code: 'E_DESTINATION_UNKNOWN',
  });
  await writeFile(join(f.configDir, 'settings.json'), ' '.repeat(65 * 1024));
  await assert.rejects(resolveClaudeRouting(f.profile, f.env, f.cwd), {
    code: 'E_DESTINATION_UNKNOWN',
  });
  await rm(join(f.configDir, 'settings.json'));
  await symlink(join(f.root, 'absent.json'), join(f.configDir, 'settings.json'));
  await assert.rejects(resolveClaudeRouting(f.profile, f.env, f.cwd), {
    code: 'E_DESTINATION_UNKNOWN',
  });
});

test('saved native destination remains a constraint and profile bytes remain unchanged', async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, 'profiles');
  await enrollProfile({ ...f.profile, destination: local }, { directory });
  const path = join(directory, `${f.profile.name}.json`);
  const before = await readFile(path, 'utf8');
  await f.settings({ ANTHROPIC_BASE_URL: external.origin });
  await assert.rejects(
    prepareProfile(f.profile.name, { directory, cwd: f.cwd, env: f.env }),
    (error) => {
      assert.equal(error.code, 'E_DESTINATION_CHANGED');
      assert.deepEqual(error.details.declaredDestination, local);
      assert.deepEqual(error.details.effectiveDestination, external);
      return true;
    },
  );
  assert.equal(await readFile(path, 'utf8'), before);
  await f.settings({});
  await assert.rejects(prepareProfile(f.profile.name, { directory, cwd: f.cwd, env: f.env }), {
    code: 'E_DESTINATION_UNKNOWN',
  });
});

test('routing is rechecked in the execution working directory before native dispatch', async (t) => {
  const f = await fixture(t);
  await f.settings({ ANTHROPIC_BASE_URL: local.origin });
  const prepared = await prepareProfile(
    { ...f.profile, destination: local },
    { cwd: f.cwd, env: f.env },
  );
  await writeFile(
    join(f.cwd, '.claude', 'settings.local.json'),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: external.origin } }),
  );
  await assert.rejects(prepared.adapter.run({ cwd: f.cwd, prompt: 'synthetic task' }), {
    code: 'E_DESTINATION_UNKNOWN',
  });
  await assert.rejects(readFile(join(f.cwd, 'unexpected-execution.txt')), { code: 'ENOENT' });
});

test('local metadata sends no credentials and recognizes exact loaded instance IDs', async (t) => {
  const f = await fixture(t);
  const calls = [];
  const server = createServer((request, response) => {
    calls.push({
      method: request.method,
      path: request.url,
      authorization: request.headers.authorization,
    });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/v1/models') response.end(JSON.stringify({ data: [{ id: 'model-key' }] }));
    else
      response.end(
        JSON.stringify({
          models: [
            {
              key: 'model-key',
              loaded_instances: [
                { id: 'selected-model', config: { context_length: 8192 } },
                { id: 'another-instance', config: { context_length: 1024 } },
              ],
            },
          ],
        }),
      );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const destination = { class: 'local', origin: `http://127.0.0.1:${server.address().port}` };
  await f.settings({
    ANTHROPIC_BASE_URL: destination.origin,
    ANTHROPIC_AUTH_TOKEN: 'private-local-token',
  });
  const backend = await inspectLocalBackend(
    { ...f.profile, destination },
    { env: f.env, cwd: f.cwd },
  );
  assert.equal(backend.modelStatus, 'visible');
  assert.equal(backend.loadStatus, 'loaded');
  assert.equal(backend.contextLength, 8192);
  assert.ok(backend.metadataLatencyMs >= 0);
  assert.deepEqual(
    calls.map(({ method, path }) => [method, path]),
    [
      ['GET', '/v1/models'],
      ['GET', '/api/v1/models'],
    ],
  );
  assert.ok(calls.every(({ authorization }) => authorization === undefined));
  assert.equal(JSON.stringify(backend).includes('private-local-token'), false);
});

test('configured Anthropic tokens are never sent and changed routing sends no metadata requests', async (t) => {
  const f = await fixture(t);
  await f.settings({ ANTHROPIC_BASE_URL: local.origin, ANTHROPIC_AUTH_TOKEN: 'config-token' });
  const headers = [];
  const options = {
    cwd: f.cwd,
    env: { ...f.env, ANTHROPIC_AUTH_TOKEN: 'different-shell-token' },
    fetchImpl: async (_url, init) => {
      headers.push(init.headers);
      return new Response('Sign-in required', { status: 401 });
    },
  };
  const backend = await inspectLocalBackend({ ...f.profile, destination: local }, options);
  assert.equal(backend.status, 'authentication-required');
  assert.deepEqual(headers, [undefined]);
  assert.equal(JSON.stringify(backend).includes('token'), false);
  await f.settings({ ANTHROPIC_BASE_URL: external.origin });
  const changed = await inspectLocalBackend(
    { ...f.profile, destination: local },
    { ...options, env: f.env },
  );
  assert.equal(changed.diagnostic.code, 'E_DESTINATION_CHANGED');
  assert.equal(headers.length, 1);
});

test('local metadata deadline also bounds a stalled response body', async () => {
  let cancelled = false;
  const backend = await inspectLocalBackend(
    { destination: local, argv: [] },
    {
      env: {},
      timeoutMs: 30,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        ),
    },
  );
  assert.equal(backend.diagnostic.code, 'E_BACKEND_TIMEOUT');
  assert.ok(backend.metadataLatencyMs >= 20);
  assert.equal(cancelled, true);
});

test('local model load state is diagnostic and never triggers inference or model loading', async () => {
  const calls = [];
  const backend = await inspectLocalBackend(
    { destination: local, argv: ['--model', 'selected-model'] },
    {
      env: {},
      fetchImpl: async (url, options) => {
        calls.push([new URL(url).pathname, options.method]);
        return new Response(
          JSON.stringify(
            new URL(url).pathname === '/v1/models'
              ? { data: [{ id: 'selected-model' }] }
              : { models: [{ key: 'selected-model', loaded_instances: [] }] },
          ),
        );
      },
    },
  );
  assert.equal(backend.loadStatus, 'not-loaded');
  assert.deepEqual(calls, [
    ['/v1/models', 'GET'],
    ['/api/v1/models', 'GET'],
  ]);
});
