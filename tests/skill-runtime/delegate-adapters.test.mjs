import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { claudeAdapter } from '../../skills/planr-delegate/scripts/adapters/claude.mjs';
import { codexAdapter } from '../../skills/planr-delegate/scripts/adapters/codex.mjs';
import {
  enrollProfile,
  inspectLocalBackend,
  listProfiles,
  loadProfile,
  PROFILE_LIFETIME_MS,
  PROFILE_RENEWAL_WARNING_MS,
  prepareProfile,
  previewProfileCandidate,
  profileReadiness,
  removeProfile,
} from '../../skills/planr-delegate/scripts/profiles.mjs';

const local = { class: 'local', origin: 'http://127.0.0.1:11434' };
const external = { class: 'external', origin: 'https://example.invalid' };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'planr-adapter-test-'));
  const executable = join(root, 'delegate-agent');
  const source = [
    '#!/usr/bin/env node',
    'const a=process.argv.slice(2);',
    "if(a.includes('--help')) { console.log('--print --output-format stream-json --include-partial-messages --verbose --resume --session-id --allowedTools --disallowedTools --json --sandbox resume'); process.exit(0); }",
    "if(a.includes('--planr-probe')) { const fs=require('node:fs');const marker=require('node:path').join(process.cwd(),'endpoint.txt');const origin=fs.existsSync(marker)?fs.readFileSync(marker,'utf8').trim():process.env.FAKE_ORIGIN || 'http://127.0.0.1:11434'; console.log(JSON.stringify({protocol:'openplanr.delegate.adapter',version:process.env.FAKE_BAD_VERSION ? 9 : 1,capabilities:{implementation:true,structuredResult:true,exactResume:!process.env.FAKE_NO_RESUME},destination:{class:process.env.FAKE_CLASS || 'local',origin}})); process.exit(0); }",
    "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{",
    'if(process.env.FAKE_HANG) return setInterval(()=>{},1000);',
    "if(process.env.FAKE_BAD_RESULT) return console.log('not-json');",
    "if(process.env.FAKE_FLOOD) return console.log('x'.repeat(2*1024*1024));",
    "const input=data.trim().startsWith('{') ? JSON.parse(data) : null;",
    "if(process.env.FAKE_CLAUDE_REQUIRE_CAPSULE && a.includes('--output-format')) { const fs=require('node:fs'); const path=require('node:path'); const index=a.indexOf('--add-dir'); if(index<0 || a.filter(x=>x==='--add-dir').length!==1 || a[index+1]!==fs.realpathSync(path.dirname(process.env.FAKE_CLAUDE_REQUIRE_CAPSULE)) || !fs.readFileSync(process.env.FAKE_CLAUDE_REQUIRE_CAPSULE,'utf8').includes('direct request')) process.exit(18); }",
    "if(a.includes('--output-format') && a[a.indexOf('--disallowedTools')+1]!=='Bash') process.exit(19);",
    'if(process.env.FAKE_REQUIRE_CAPSULE && input?.capsulePath !== process.env.FAKE_REQUIRE_CAPSULE) process.exit(17);',
    "const session=input?.sessionId || (a.includes('--session-id') ? a[a.indexOf('--session-id')+1] : 'session-1');",
    "const result={status:process.env.FAKE_QUESTION ? 'question' : 'completed',sessionId:session,summary:'done',question:{text:'Choose?',options:['A','B']},checks:['test passed'],issues:[]};",
    "if(process.env.FAKE_CLAUDE_DENIALS && a.includes('--output-format')) { for(let i=0;i<3;i++) console.log(JSON.stringify({type:'user',session_id:session,message:{content:[{type:'tool_result',content:'This command requires approval'}]}})); return; }",
    "if(a.includes('--planr-run') || a.includes('--planr-resume')) return console.log(JSON.stringify({protocol:'openplanr.delegate.adapter',version:1,...result}));",
    "if(process.env.FAKE_CLAUDE_BACKEND_ERROR && a.includes('--output-format')) { console.log(JSON.stringify({type:'result',is_error:true,session_id:session,result:'provider secret should never leak'})); process.exitCode=1; return; }",
    "if(['fence','fence-extra'].includes(process.env.FAKE_CLAUDE_TRAILING_JSON) && a.includes('--output-format')) { const text='Implementation complete.\\n```json\\n'+JSON.stringify(result)+'\\n```'+(process.env.FAKE_CLAUDE_TRAILING_JSON==='fence-extra'?' trailing':''); console.log(JSON.stringify({type:'result',is_error:false,session_id:session,result:text})); return; }",
    "if(process.env.FAKE_CLAUDE_TRAILING_JSON && a.includes('--output-format')) { const prefix=process.env.FAKE_CLAUDE_TRAILING_JSON==='two' ? '{\\\"status\\\":\\\"blocked\\\"}\\n' : 'Implementation complete.\\n'; console.log(JSON.stringify({type:'result',is_error:false,session_id:session,result:prefix+JSON.stringify(result)})); return; }",
    "if(a.includes('--output-format')) return console.log(JSON.stringify({type:'result',is_error:false,session_id:a.includes('--resume')?a[a.indexOf('--resume')+1]:session,result:JSON.stringify(result)}));",
    "if(a.includes('resume') && (!a.includes('-c') || !a.includes('sandbox_mode=\"workspace-write\"'))) process.exit(17);",
    "console.log(JSON.stringify({type:'thread.started',thread_id:a.includes('resume')?a.at(-2):session}));",
    "if(process.env.FAKE_CODEX_REPEAT) { for(let i=0;i<Number(process.env.FAKE_CODEX_REPEAT);i++) console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'cat source.txt',aggregated_output:'unchanged',exit_code:0}})); }",
    "if(process.env.FAKE_CODEX_NO_FINAL) { console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:120,cached_input_tokens:100,output_tokens:50,secret:'never-store'}})); return; }",
    "if(process.env.FAKE_CODEX_PROSE) { console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'prose, not JSON'}})); console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:321,output_tokens:12,secret:'never-store'}})); return; }",
    "if(['fence','fence-extra'].includes(process.env.FAKE_CODEX_TRAILING_JSON)) { const text='Implementation complete.\\n```json\\n'+JSON.stringify(result)+'\\n```'+(process.env.FAKE_CODEX_TRAILING_JSON==='fence-extra'?' trailing':''); console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}})); console.log(JSON.stringify({type:'turn.completed'})); return; }",
    "if(process.env.FAKE_CODEX_TRAILING_JSON) { const prefix=process.env.FAKE_CODEX_TRAILING_JSON==='two' ? '{\\\"status\\\":\\\"blocked\\\"}\\n' : 'Implementation complete.\\n'; console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:prefix+JSON.stringify(result)}})); console.log(JSON.stringify({type:'turn.completed'})); return; }",
    "console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(result)}}));",
    "console.log(JSON.stringify({type:'turn.completed'}));",
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

test('first-use preview fails closed for unknown Codex endpoint and incompatible generic adapter', async () => {
  const f = await fixture();
  await assert.rejects(
    previewProfileCandidate(
      declaration(f, {
        kind: 'codex',
        argv: [],
        allowedEnv: [],
      }),
      { cwd: f.root, env: { HOME: f.root, PATH: process.env.PATH } },
    ),
    { code: 'E_DESTINATION_UNKNOWN' },
  );
  await assert.rejects(
    previewProfileCandidate(declaration(f), {
      cwd: f.root,
      env: { PATH: process.env.PATH, FAKE_NO_RESUME: '1' },
    }),
    { code: 'E_ADAPTER_INCOMPATIBLE' },
  );
  assert.deepEqual(await listProfiles({ directory: f.directory }), []);
});

test('Claude destination rules work for arbitrary names as well as claude-local', async () => {
  const f = await fixture();
  const configDir = join(f.root, 'claude-config');
  await mkdir(configDir);
  await writeFile(
    join(configDir, 'settings.json'),
    JSON.stringify({
      env: { ANTHROPIC_BASE_URL: local.origin, ANTHROPIC_API_KEY: 'never-print-this-value' },
    }),
  );
  const declarationForClaude = declaration(f, {
    name: 'team-claude',
    kind: 'claude',
    configDir,
    argv: [],
    allowedEnv: [],
  });
  const preview = await previewProfileCandidate(declarationForClaude, {
    cwd: f.root,
    env: { HOME: f.root, PATH: process.env.PATH },
  });
  assert.deepEqual(preview.candidate.destination, local);
  assert.equal(JSON.stringify(preview).includes('never-print-this-value'), false);
  await enrollProfile(preview.candidate, { directory: f.directory });
  assert.deepEqual(
    (await prepareProfile('team-claude', { directory: f.directory, cwd: f.root })).destination,
    local,
  );
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
    env: { ...process.env, FAKE_REQUIRE_CAPSULE: capsulePath },
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

test('Codex preserves a validated session ID when a post-thread result is malformed', async () => {
  const f = await fixture();
  await assert.rejects(
    codexAdapter.run({
      profile: { executable: f.executable, argv: [] },
      cwd: f.root,
      prompt: 'safe request',
      env: { ...process.env, FAKE_CODEX_PROSE: '1' },
    }),
    (error) =>
      error.code === 'E_ADAPTER_RESULT' &&
      error.sessionId === 'session-1' &&
      error.completionEvidence === 'turn-completed-invalid-final' &&
      error.usage?.input_tokens === 321 &&
      error.usage?.output_tokens === 12 &&
      !JSON.stringify(error).includes('prose'),
  );
});

test('Codex distinguishes a completed reasoning-only turn from timeout', async () => {
  const f = await fixture();
  await assert.rejects(
    codexAdapter.run({
      profile: { executable: f.executable, argv: [] },
      cwd: f.root,
      prompt: 'safe request',
      env: { ...process.env, FAKE_CODEX_NO_FINAL: '1' },
    }),
    (error) =>
      error.code === 'E_ADAPTER_NO_FINAL' &&
      error.sessionId === 'session-1' &&
      error.completionEvidence === 'turn-completed-no-final' &&
      error.usage?.input_tokens === 120 &&
      !JSON.stringify(error).includes('never-store'),
  );
});

test('Codex stops repeated completed commands while retaining its exact session', async () => {
  const f = await fixture();
  const profile = { executable: f.executable, argv: [] };
  const env = { ...process.env, FAKE_CODEX_REPEAT: '5' };
  await assert.rejects(
    codexAdapter.run({ profile, cwd: f.root, prompt: 'safe request', env }),
    (error) =>
      error.code === 'E_ADAPTER_STALLED' &&
      error.sessionId === 'session-1' &&
      !JSON.stringify(error).includes('unchanged'),
  );
  const completed = await codexAdapter.run({
    profile,
    cwd: f.root,
    prompt: 'safe request',
    env: { ...process.env, FAKE_CODEX_REPEAT: '4' },
  });
  assert.equal(completed.status, 'completed');
});

test('Codex accepts one terminal JSON object after prose but rejects multiple objects', async () => {
  const f = await fixture();
  const profile = { executable: f.executable, argv: [] };
  const accepted = await codexAdapter.run({
    profile,
    cwd: f.root,
    prompt: 'safe request',
    env: { ...process.env, FAKE_CODEX_TRAILING_JSON: 'one' },
  });
  assert.equal(accepted.status, 'completed');
  assert.equal(accepted.sessionId, 'session-1');
  const fenced = await codexAdapter.run({
    profile,
    cwd: f.root,
    prompt: 'safe request',
    env: { ...process.env, FAKE_CODEX_TRAILING_JSON: 'fence' },
  });
  assert.equal(fenced.status, 'completed');
  await assert.rejects(
    codexAdapter.run({
      profile,
      cwd: f.root,
      prompt: 'safe request',
      env: { ...process.env, FAKE_CODEX_TRAILING_JSON: 'fence-extra' },
    }),
    (error) => error.code === 'E_ADAPTER_RESULT' && error.sessionId === 'session-1',
  );
  await assert.rejects(
    codexAdapter.run({
      profile,
      cwd: f.root,
      prompt: 'safe request',
      env: { ...process.env, FAKE_CODEX_TRAILING_JSON: 'two' },
    }),
    (error) => error.code === 'E_ADAPTER_RESULT' && error.sessionId === 'session-1',
  );
});

test('Claude accepts one terminal JSON object after prose and retains exact session on malformed output', async () => {
  const f = await fixture();
  const profile = { executable: f.executable, argv: [] };
  const capsulePath = await testCapsule(f.root);
  const accepted = await claudeAdapter.run({
    profile,
    cwd: f.root,
    prompt: 'safe request',
    capsulePath,
    env: {
      ...process.env,
      FAKE_CLAUDE_TRAILING_JSON: 'one',
      FAKE_CLAUDE_REQUIRE_CAPSULE: capsulePath,
    },
  });
  assert.equal(accepted.status, 'completed');
  assert.equal(accepted.sessionId, 'session-1');
  const fenced = await claudeAdapter.run({
    profile,
    cwd: f.root,
    prompt: 'safe request',
    capsulePath,
    env: { ...process.env, FAKE_CLAUDE_TRAILING_JSON: 'fence' },
  });
  assert.equal(fenced.status, 'completed');
  await assert.rejects(
    claudeAdapter.run({
      profile,
      cwd: f.root,
      prompt: 'safe request',
      capsulePath,
      env: { ...process.env, FAKE_CLAUDE_TRAILING_JSON: 'fence-extra' },
    }),
    (error) => error.code === 'E_ADAPTER_RESULT' && error.sessionId === 'session-1',
  );
  await assert.rejects(
    claudeAdapter.run({
      profile,
      cwd: f.root,
      prompt: 'safe request',
      capsulePath,
      env: { ...process.env, FAKE_CLAUDE_TRAILING_JSON: 'two' },
    }),
    (error) => error.code === 'E_ADAPTER_RESULT' && error.sessionId === 'session-1',
  );
});

test('Claude headless permission denials stop promptly without exposing tool output', async () => {
  const f = await fixture();
  const capsulePath = await testCapsule(f.root);
  await assert.rejects(
    claudeAdapter.run({
      profile: { executable: f.executable, argv: [] },
      cwd: f.root,
      prompt: 'Implement the selected task',
      capsulePath,
      sessionId: 'session-1',
      env: { ...process.env, FAKE_CLAUDE_DENIALS: '1' },
    }),
    (error) =>
      error.code === 'E_ADAPTER_PERMISSION' &&
      !JSON.stringify(error).includes('This command requires approval'),
  );
});

async function testCapsule(root) {
  const directory = join(root, 'runs', 'run-1', 'capsule');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, 'capsule.json');
  await writeFile(path, '{"request":"direct request"}', { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

test('Claude grants its exact private capsule directory on run and exact-session resume', async () => {
  const f = await fixture();
  const capsulePath = await testCapsule(f.root);
  const profile = { executable: f.executable, argv: [] };
  const env = { ...process.env, FAKE_CLAUDE_REQUIRE_CAPSULE: capsulePath };
  const first = await claudeAdapter.run({ profile, cwd: f.root, prompt: 'work', capsulePath, env });
  const second = await claudeAdapter.resume({
    profile,
    cwd: f.root,
    prompt: 'continue',
    capsulePath,
    sessionId: first.sessionId,
    env,
  });
  assert.equal(second.sessionId, first.sessionId);
  await assert.rejects(claudeAdapter.run({ profile, cwd: f.root, prompt: 'work', env }), {
    code: 'E_ADAPTER_ARGUMENTS',
  });
  await assert.rejects(
    claudeAdapter.run({
      profile,
      cwd: f.root,
      prompt: 'work',
      capsulePath: join(f.root, 'runs', 'run-1', 'capsule.json'),
      env,
    }),
    { code: 'E_ADAPTER_ARGUMENTS' },
  );
  await chmod(capsulePath, 0o644);
  await assert.rejects(
    claudeAdapter.run({ profile, cwd: f.root, prompt: 'work', capsulePath, env }),
    { code: 'E_ADAPTER_ARGUMENTS' },
  );
  await chmod(capsulePath, 0o600);
  const linked = join(f.root, 'runs', 'run-1', 'capsule', 'linked.json');
  await symlink(capsulePath, linked);
  await assert.rejects(
    claudeAdapter.run({ profile, cwd: f.root, prompt: 'work', capsulePath: linked, env }),
    { code: 'E_ADAPTER_ARGUMENTS' },
  );
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
      env: { ...process.env, FAKE_BAD_VERSION: '1' },
    }),
    { code: 'E_ADAPTER_INCOMPATIBLE' },
  );
  await assert.rejects(
    prepareProfile('test-agent', {
      directory: f.directory,
      env: { ...process.env, FAKE_NO_RESUME: '1' },
    }),
    { code: 'E_ADAPTER_INCOMPATIBLE' },
  );
  await assert.rejects(
    prepareProfile('test-agent', {
      directory: f.directory,
      env: {
        ...process.env,
        FAKE_ORIGIN: 'https://example.invalid',
        FAKE_CLASS: 'external',
      },
    }),
    { code: 'E_DESTINATION_CHANGED' },
  );
  await assert.rejects(
    prepareProfile('test-agent', {
      directory: f.directory,
      env: { ...process.env, FAKE_ORIGIN: 'not-a-url' },
    }),
    { code: 'E_DESTINATION_UNKNOWN' },
  );
  const prepared = await prepareProfile('test-agent', {
    directory: f.directory,
    env: { ...process.env, FAKE_BAD_RESULT: '1' },
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
    env: { ...process.env, FAKE_QUESTION: '1' },
  });
  assert.deepEqual((await question.adapter.run({ cwd: f.root, prompt: 'work' })).question, {
    text: 'Choose?',
    options: ['A', 'B'],
  });
  const hanging = await prepareProfile('test-agent', {
    directory: f.directory,
    env: { ...process.env, FAKE_HANG: '1' },
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
    env: { ...process.env, FAKE_FLOOD: '1' },
  });
  await assert.rejects(flooding.adapter.run({ cwd: f.root, prompt: 'work' }), {
    code: 'E_ADAPTER_OUTPUT_LIMIT',
  });
});

test('claude-local uses existing config directory and compares effective environment precedence', async () => {
  const f = await fixture();
  const capsulePath = await testCapsule(f.root);
  const claude = join(f.root, 'claude');
  await writeFile(claude, await readFile(f.executable), { mode: 0o700 });
  const configDir = join(f.root, 'claude-config');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(configDir));
  await writeFile(
    join(configDir, 'settings.json'),
    JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: local.origin,
        ANTHROPIC_API_KEY: 'never-print-this-value',
      },
    }),
  );
  await enrollProfile(
    declaration(f, {
      name: 'claude-local',
      kind: 'claude',
      executable: claude,
      argv: [],
      configDir,
      allowedEnv: ['ANTHROPIC_BASE_URL', 'FAKE_CLAUDE_BACKEND_ERROR'],
      destination: local,
    }),
    { directory: f.directory },
  );
  const prepared = await prepareProfile('claude-local', {
    directory: f.directory,
    cwd: f.root,
  });
  assert.equal(prepared.profile.configDir, await realpath(configDir));
  assert.equal(
    (await prepared.adapter.run({ cwd: f.root, prompt: 'work', capsulePath })).sessionId,
    'session-1',
  );
  const backendFailure = await prepareProfile('claude-local', {
    directory: f.directory,
    cwd: f.root,
    env: { ...process.env, FAKE_CLAUDE_BACKEND_ERROR: '1' },
  });
  await assert.rejects(
    backendFailure.adapter.run({ cwd: f.root, prompt: 'private task', capsulePath }),
    (error) => {
      assert.equal(error.code, 'E_ADAPTER_BACKEND_UNAVAILABLE');
      assert.equal(error.message.includes('provider secret'), false);
      assert.equal(error.message.includes('private task'), false);
      return true;
    },
  );
  await assert.rejects(
    prepareProfile('claude-local', {
      directory: f.directory,
      cwd: f.root,
      env: { ...process.env, ANTHROPIC_BASE_URL: external.origin },
    }),
    { code: 'E_DESTINATION_UNKNOWN' },
  );
  await mkdir(join(f.root, '.claude'));
  await writeFile(
    join(f.root, '.claude', 'settings.local.json'),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: external.origin } }),
  );
  await assert.rejects(prepareProfile('claude-local', { directory: f.directory, cwd: f.root }), {
    code: 'E_DESTINATION_UNKNOWN',
  });
  assert.ok(
    !(await readFile(join(f.directory, 'claude-local.json'), 'utf8')).includes(
      'never-print-this-value',
    ),
  );
});

test('Codex selected provider config determines destination and supports exact resume', async () => {
  const f = await fixture();
  const codex = join(f.root, 'codex');
  await writeFile(codex, await readFile(f.executable), { mode: 0o700 });
  const configDir = join(f.root, 'codex-config');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(configDir));
  await writeFile(
    join(configDir, 'config.toml'),
    'model_provider = "local"\n[model_providers.local]\nbase_url = "http://127.0.0.1:11434/v1"\n',
  );
  await enrollProfile(
    declaration(f, {
      kind: 'codex',
      executable: codex,
      argv: [],
      allowedEnv: ['CODEX_HOME'],
    }),
    { directory: f.directory },
  );
  const prepared = await prepareProfile('test-agent', {
    directory: f.directory,
    cwd: f.root,
    env: { ...process.env, CODEX_HOME: configDir },
  });
  assert.deepEqual(prepared.destination, local);
  assert.equal(
    (await prepared.adapter.run({ cwd: f.root, prompt: 'work' })).sessionId,
    'session-1',
  );
  assert.equal(
    (
      await prepared.adapter.resume({
        cwd: f.root,
        prompt: 'answer',
        sessionId: 'session-1',
      })
    ).sessionId,
    'session-1',
  );
  await assert.rejects(prepareProfile('test-agent', { directory: f.directory, cwd: f.root }), {
    code: 'E_DESTINATION_UNKNOWN',
  });
  await mkdir(join(f.root, '.codex'));
  await writeFile(
    join(f.root, '.codex', 'config.toml'),
    'openai_base_url = "https://example.invalid/v1"\n',
  );
  await assert.rejects(
    prepareProfile('test-agent', {
      directory: f.directory,
      cwd: f.root,
      env: { ...process.env, CODEX_HOME: configDir },
    }),
    { code: 'E_DESTINATION_UNKNOWN' },
  );
});

test('Codex enrollment pins a separate config directory and forwards only named credentials', async () => {
  const f = await fixture();
  const configDir = join(f.root, 'codex-local-config');
  await mkdir(configDir);
  await writeFile(
    join(configDir, 'config.toml'),
    'model_provider = "lmstudio"\n[model_providers.lmstudio]\nbase_url = "http://127.0.0.1:11434/v1"\nenv_key = "LM_STUDIO_API_KEY"\n',
  );
  const declarationForCodex = declaration(f, {
    name: 'codex-local',
    kind: 'codex',
    configDir,
    argv: ['--model', 'local-test'],
    allowedEnv: ['LM_STUDIO_API_KEY'],
  });
  const preview = await previewProfileCandidate(declarationForCodex, {
    cwd: f.root,
    env: {
      HOME: f.root,
      PATH: process.env.PATH,
      CODEX_HOME: join(f.root, 'not-the-enrolled-config'),
      LM_STUDIO_API_KEY: 'never-print-this-token',
    },
  });
  assert.deepEqual(preview.candidate.destination, local);
  assert.equal(preview.candidate.configDir, await realpath(configDir));
  assert.equal(JSON.stringify(preview).includes('never-print-this-token'), false);
  await enrollProfile(preview.candidate, { directory: f.directory });
  const prepared = await prepareProfile('codex-local', {
    directory: f.directory,
    cwd: f.root,
    env: {
      HOME: f.root,
      PATH: process.env.PATH,
      CODEX_HOME: join(f.root, 'not-the-enrolled-config'),
      LM_STUDIO_API_KEY: 'never-print-this-token',
    },
  });
  assert.deepEqual(prepared.destination, local);
  assert.equal(
    (await prepared.adapter.run({ cwd: f.root, prompt: 'work' })).sessionId,
    'session-1',
  );
  assert.equal(
    (await readFile(join(f.directory, 'codex-local.json'), 'utf8')).includes(
      'never-print-this-token',
    ),
    false,
  );
});
