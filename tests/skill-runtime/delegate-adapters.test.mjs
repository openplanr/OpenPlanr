import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import {
  enrollProfile,
  inspectLocalBackend,
  listProfiles,
  loadProfile,
  PROFILE_LIFETIME_MS,
  PROFILE_RENEWAL_WARNING_MS,
  prepareProfile,
  previewProfileCandidate,
  profileIdentity,
  profileReadiness,
  removeProfile,
} from '../../skills/planr-delegate/scripts/profiles.mjs';

const local = { class: 'local', origin: 'http://127.0.0.1:11434' };
const external = { class: 'external', origin: 'https://example.invalid' };

const fixtureRoots = new Set();
after(async () =>
  Promise.all([...fixtureRoots].map((root) => rm(root, { recursive: true, force: true }))),
);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'planr-adapter-test-'));
  fixtureRoots.add(root);
  const executable = join(root, 'delegate-agent');
  const source = [
    '#!/usr/bin/env node',
    'const a=process.argv.slice(2);',
    "if(a.includes('--planr-probe')) { const fs=require('node:fs');const marker=require('node:path').join(process.cwd(),'endpoint.txt');const origin=fs.existsSync(marker)?fs.readFileSync(marker,'utf8').trim():process.env.FAKE_ORIGIN || 'http://127.0.0.1:11434'; console.log(JSON.stringify({protocol:'openplanr.delegate.adapter',version:process.env.FAKE_BAD_VERSION ? 9 : 1,capabilities:{implementation:true,structuredResult:true,exactResume:!process.env.FAKE_NO_RESUME},destination:{class:process.env.FAKE_CLASS || 'local',origin}})); process.exit(0); }",
    "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{",
    'if(process.env.FAKE_HANG) return setInterval(()=>{},1000);',
    "if(process.env.FAKE_BAD_RESULT) return console.log('not-json');",
    "if(process.env.FAKE_FLOOD) return console.log('x'.repeat(2*1024*1024));",
    'const input=JSON.parse(data);',
    'if(process.env.FAKE_REQUIRE_CAPSULE && input.capsulePath !== process.env.FAKE_REQUIRE_CAPSULE) process.exit(17);',
    "const result={status:process.env.FAKE_QUESTION ? 'question' : 'completed',sessionId:input.sessionId || 'session-1',summary:'done',question:{text:'Choose?',options:['A','B']},checks:['test passed'],issues:[]};",
    "console.log(JSON.stringify({protocol:'openplanr.delegate.adapter',version:1,...result}));",
    '});',
  ].join('\n');
  await writeFile(executable, source, { mode: 0o700 });
  await chmod(executable, 0o700);
  return { root, executable, directory: join(root, 'profiles') };
}

function declaration(f, overrides = {}) {
  return {
    name: 'test-agent',
    kind: 'generic',
    executable: f.executable,
    argv: [],
    allowedEnv: [
      'FAKE_ORIGIN',
      'FAKE_CLASS',
      'FAKE_BAD_VERSION',
      'FAKE_NO_RESUME',
      'FAKE_BAD_RESULT',
      'FAKE_QUESTION',
      'FAKE_HANG',
      'FAKE_FLOOD',
      'FAKE_REQUIRE_CAPSULE',
    ],
    workingDirectory: 'worktree',
    destination: local,
    ...overrides,
  };
}

test('private enrollment is bounded, expires, and can be removed', async () => {
  const f = await fixture();
  assert.equal(await removeProfile('missing', { directory: f.directory }), false);
  const now = 1_000_000;
  await enrollProfile(declaration(f), { directory: f.directory, now });
  assert.equal((await stat(f.directory)).mode & 0o077, 0);
  assert.equal((await stat(join(f.directory, 'test-agent.json'))).mode & 0o077, 0);
  const profile = await loadProfile('test-agent', {
    directory: f.directory,
    now: now + 1,
  });
  assert.equal(profile.expiresAt - profile.enrolledAt, PROFILE_LIFETIME_MS);
  await assert.rejects(
    loadProfile('test-agent', {
      directory: f.directory,
      now: now + PROFILE_LIFETIME_MS,
    }),
    { code: 'E_PROFILE_EXPIRED' },
  );
  assert.equal(await removeProfile('test-agent', { directory: f.directory }), true);
  assert.equal(await removeProfile('test-agent', { directory: f.directory }), false);
  await assert.rejects(
    enrollProfile(declaration(f, { argv: ['x'.repeat(17_000)] }), {
      directory: f.directory,
    }),
    { code: 'E_PROFILE_INVALID' },
  );
  await assert.rejects(
    enrollProfile(
      declaration(f, {
        allowedEnv: Array.from({ length: 64 }, (_, index) => `SAFE_${index}_${'X'.repeat(300)}`),
      }),
      { directory: f.directory },
    ),
    { code: 'E_PROFILE_SIZE' },
  );
});

test('profile discovery exposes enrolled choices without private execution settings', async () => {
  const f = await fixture();
  assert.deepEqual(await listProfiles({ directory: f.directory }), []);
  await enrollProfile(declaration(f, { argv: ['--model', 'local-test'] }), {
    directory: f.directory,
  });
  const choices = await listProfiles({ directory: f.directory });
  assert.equal(choices.length, 1);
  assert.deepEqual(
    { ...choices[0], expiresAt: undefined },
    {
      name: 'test-agent',
      kind: 'generic',
      version: 1,
      destination: local,
      selectedModel: 'local-test',
      status: 'enrolled',
      renewalRecommended: false,
      expiresAt: undefined,
    },
  );
  assert.ok(choices[0].expiresAt > Date.now());
  assert.ok(!JSON.stringify(choices).includes(f.executable));
});

test('profile list warns before expiration without silently renewing', async () => {
  const f = await fixture();
  const now = Date.now();
  await enrollProfile(declaration(f), {
    directory: f.directory,
    now: now - PROFILE_LIFETIME_MS + PROFILE_RENEWAL_WARNING_MS - 1000,
  });
  const [choice] = await listProfiles({ directory: f.directory, now });
  assert.equal(choice.status, 'enrolled');
  assert.equal(choice.renewalRecommended, true);
  assert.equal(choice.expiresAt, now + PROFILE_RENEWAL_WARNING_MS - 1000);
});

test('local backend preflight distinguishes unreachable, visible and absent selected models', async () => {
  const profile = { destination: local, argv: ['--model', 'local-test'] };
  const unreachable = await inspectLocalBackend(profile, {
    fetchImpl: async () => {
      throw new Error('private network diagnostic');
    },
  });
  assert.equal(unreachable.status, 'unreachable');
  assert.ok(!JSON.stringify(unreachable).includes('private network diagnostic'));
  const visible = await inspectLocalBackend(profile, {
    fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'local-test' }] })),
  });
  assert.equal(visible.modelStatus, 'visible');
  const absent = await inspectLocalBackend(profile, {
    fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'other' }] })),
  });
  assert.equal(absent.modelStatus, 'not-listed');
  assert.deepEqual(absent.visibleModels, ['other']);
  const unsupported = await inspectLocalBackend(profile, {
    fetchImpl: async () => new Response('No model list', { status: 404 }),
  });
  assert.equal(unsupported.modelStatus, 'unverified');
  const authenticationRequired = await inspectLocalBackend(profile, {
    fetchImpl: async () => new Response('Credential needed', { status: 401 }),
  });
  assert.equal(authenticationRequired.status, 'authentication-required');
  assert.equal(authenticationRequired.modelStatus, 'unknown');
  assert.equal(JSON.stringify(authenticationRequired).includes('Credential needed'), false);
  assert.deepEqual(profileReadiness(local, authenticationRequired), {
    state: 'authentication-required',
    dispatchable: false,
    nextAction:
      'Provide the local server token through an allowed environment variable, then probe again.',
  });
  assert.deepEqual(await inspectLocalBackend({ destination: external, argv: [] }), {
    status: 'not-checked',
    modelStatus: 'not-checked',
    selectedModel: null,
    visibleModels: [],
  });
  const nativeFetch = (loaded) => async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    if (new URL(url).pathname === '/v1/models')
      return new Response(JSON.stringify({ data: [{ id: 'local-test' }] }));
    return new Response(
      JSON.stringify({
        models: [{ key: 'local-test', loaded_instances: loaded ? [{ id: 'local-test' }] : [] }],
      }),
    );
  };
  const loaded = await inspectLocalBackend(profile, {
    fetchImpl: nativeFetch(true),
    env: { LM_API_TOKEN: 'private-token' },
  });
  assert.equal(loaded.loadStatus, 'loaded');
  assert.equal(JSON.stringify(loaded).includes('private-token'), false);
  const unloaded = await inspectLocalBackend(profile, {
    fetchImpl: nativeFetch(false),
    env: { LM_API_TOKEN: 'private-token' },
  });
  assert.equal(unloaded.loadStatus, 'not-loaded');
  const codexLoaded = await inspectLocalBackend(
    { ...profile, kind: 'codex' },
    {
      fetchImpl: nativeFetch(true),
      env: { LM_STUDIO_API_KEY: 'private-token' },
    },
  );
  assert.equal(codexLoaded.loadStatus, 'loaded');
  assert.equal(JSON.stringify(codexLoaded).includes('private-token'), false);
  assert.equal(visible.loadStatus, 'unverified');
});

test('non-Claude local probes never inspect or forward an ambient Anthropic token', async () => {
  for (const kind of ['codex', 'cursor', 'generic', undefined]) {
    const headers = [];
    const fetchImpl = async (url, options) => {
      headers.push(options.headers?.Authorization ?? null);
      return new Response(JSON.stringify({ data: [{ id: 'local-test' }] }));
    };
    const profile = { kind, destination: local, argv: ['--model', 'local-test'] };
    const ambient = await inspectLocalBackend(profile, {
      fetchImpl,
      env: { ANTHROPIC_AUTH_TOKEN: 'unrelated-anthropic-token' },
    });
    assert.equal(ambient.modelStatus, 'visible', String(kind));
    assert.ok(headers.length > 0 && headers.every((header) => header === null), String(kind));
    headers.length = 0;
    const scoped = await inspectLocalBackend(profile, {
      fetchImpl,
      env: { ANTHROPIC_AUTH_TOKEN: 'unrelated-anthropic-token', LM_API_TOKEN: 'local-token' },
    });
    assert.ok(
      headers.every((header) => header === 'Bearer local-token'),
      String(kind),
    );
    assert.equal(JSON.stringify([ambient, scoped]).includes('token'), false, String(kind));
  }
});

test('profile loader rejects permissive records and symlink substitution', async () => {
  const f = await fixture();
  await enrollProfile(declaration(f), { directory: f.directory });
  const path = join(f.directory, 'test-agent.json');
  await chmod(path, 0o644);
  await assert.rejects(loadProfile('test-agent', { directory: f.directory }), {
    code: 'E_PROFILE_PERMISSIONS',
  });
  await removeProfile('test-agent', { directory: f.directory });
  await symlink(f.executable, path);
  await assert.rejects(loadProfile('test-agent', { directory: f.directory }));
});

test('generic probe, run and exact resume use argv arrays and structured results', async () => {
  const f = await fixture();
  const sentinel = join(f.root, 'must-not-exist');
  const capsulePath = join(f.root, 'capsule.json');
  await enrollProfile(declaration(f, { argv: [`$(touch ${sentinel})`] }), {
    directory: f.directory,
  });
  const prepared = await prepareProfile('test-agent', {
    directory: f.directory,
    env: { HOME: f.root, PATH: process.env.PATH, FAKE_REQUIRE_CAPSULE: capsulePath },
  });
  assert.deepEqual(prepared.capabilities, {
    implementation: true,
    structuredResult: true,
    exactResume: true,
  });
  assert.deepEqual(prepared.destination, local);
  assert.equal(
    (await prepared.adapter.run({ cwd: f.root, prompt: 'do work', capsulePath })).sessionId,
    'session-1',
  );
  const resumed = await prepared.adapter.resume({
    cwd: f.root,
    prompt: 'answer',
    capsulePath,
    sessionId: 'session-1',
  });
  assert.equal(resumed.status, 'completed');
  await assert.rejects(stat(sentinel), { code: 'ENOENT' });
});

test('generic probe rechecks destination against the actual run worktree', async () => {
  const f = await fixture();
  const worktree = join(f.root, 'worktree');
  await mkdir(worktree);
  await enrollProfile(declaration(f), { directory: f.directory });
  const prepared = await prepareProfile('test-agent', {
    directory: f.directory,
    cwd: f.root,
  });
  await writeFile(join(worktree, 'endpoint.txt'), 'https://example.invalid');
  await assert.rejects(prepared.adapter.run({ cwd: worktree, prompt: 'must not run' }), {
    code: 'E_DESTINATION_UNKNOWN',
  });
});

test('generic incompatibility, endpoint change, expiry and malformed output fail closed', async () => {
  const f = await fixture();
  await enrollProfile(declaration(f), { directory: f.directory });
  await assert.rejects(
    prepareProfile('test-agent', {
      directory: f.directory,
      env: { HOME: f.root, PATH: process.env.PATH, FAKE_BAD_VERSION: '1' },
    }),
    { code: 'E_ADAPTER_INCOMPATIBLE' },
  );
  await assert.rejects(
    prepareProfile('test-agent', {
      directory: f.directory,
      env: { HOME: f.root, PATH: process.env.PATH, FAKE_NO_RESUME: '1' },
    }),
    { code: 'E_ADAPTER_INCOMPATIBLE' },
  );
  await assert.rejects(
    prepareProfile('test-agent', {
      directory: f.directory,
      env: {
        HOME: f.root,
        PATH: process.env.PATH,
        FAKE_ORIGIN: 'https://example.invalid',
        FAKE_CLASS: 'external',
      },
    }),
    { code: 'E_DESTINATION_CHANGED' },
  );
  await assert.rejects(
    prepareProfile('test-agent', {
      directory: f.directory,
      env: { HOME: f.root, PATH: process.env.PATH, FAKE_ORIGIN: 'not-a-url' },
    }),
    { code: 'E_DESTINATION_UNKNOWN' },
  );
  const prepared = await prepareProfile('test-agent', {
    directory: f.directory,
    env: { HOME: f.root, PATH: process.env.PATH, FAKE_BAD_RESULT: '1' },
  });
  await assert.rejects(prepared.adapter.run({ cwd: f.root, prompt: 'secret prompt' }), {
    code: 'E_ADAPTER_RESULT',
  });
  await assert.rejects(prepared.adapter.resume({ cwd: f.root, prompt: 'answer', sessionId: '' }), {
    code: 'E_ADAPTER_SESSION',
  });
});

test('generic structured question, cancellation and output are bounded', async () => {
  const f = await fixture();
  await enrollProfile(declaration(f), { directory: f.directory });
  const question = await prepareProfile('test-agent', {
    directory: f.directory,
    env: { HOME: f.root, PATH: process.env.PATH, FAKE_QUESTION: '1' },
  });
  assert.deepEqual((await question.adapter.run({ cwd: f.root, prompt: 'work' })).question, {
    text: 'Choose?',
    options: ['A', 'B'],
  });
  const hanging = await prepareProfile('test-agent', {
    directory: f.directory,
    env: { HOME: f.root, PATH: process.env.PATH, FAKE_HANG: '1' },
  });
  const controller = new AbortController();
  const pending = hanging.adapter.run({
    cwd: f.root,
    prompt: 'work',
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending, { code: 'E_ADAPTER_CANCELLED' });
  const flooding = await prepareProfile('test-agent', {
    directory: f.directory,
    env: { HOME: f.root, PATH: process.env.PATH, FAKE_FLOOD: '1' },
  });
  await assert.rejects(flooding.adapter.run({ cwd: f.root, prompt: 'work' }), {
    code: 'E_ADAPTER_OUTPUT_LIMIT',
  });
});

test('profile renewal retains stable run identity while endpoint or executable changes do not', async () => {
  const f = await fixture();
  const first = await enrollProfile(declaration(f), { directory: f.directory, now: 1000 });
  const renewed = await enrollProfile(declaration(f), { directory: f.directory, now: 2000 });
  assert.equal(profileIdentity(first), profileIdentity(renewed));
  assert.equal(
    (await loadProfile(first.name, { directory: f.directory, now: 3000 })).recordDigest,
    profileIdentity(first),
  );
  assert.notEqual(profileIdentity(first), profileIdentity({ ...renewed, destination: external }));
  assert.notEqual(
    profileIdentity(first),
    profileIdentity({ ...renewed, executable: '/different/agent' }),
  );
});

test('profile open and local metadata parse failures retain sanitized causes', async () => {
  const f = await fixture();
  await enrollProfile(declaration(f), { directory: f.directory });
  await rm(join(f.directory, 'test-agent.json'));
  await symlink(join(f.root, 'missing'), join(f.directory, 'test-agent.json'));
  await assert.rejects(
    loadProfile('test-agent', { directory: f.directory }),
    (error) => error.code === 'E_PROFILE_READ' && error.details.cause === 'ELOOP',
  );
  const result = await inspectLocalBackend(
    { destination: local, argv: [] },
    {
      fetchImpl: async () => new Response('not-json', { status: 200 }),
      env: {},
    },
  );
  assert.equal(result.diagnostic.code, 'E_BACKEND_RESPONSE');
  assert.equal(result.diagnostic.cause, 'SyntaxError');
});
