import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  codexAdapter,
  resolveCodexDestination,
} from '../../skills/planr-delegate/scripts/adapters/codex.mjs';
import { invokeProcess } from '../../skills/planr-delegate/scripts/adapters/generic.mjs';
import { enrollProfile } from '../../skills/planr-delegate/scripts/profiles.mjs';
import {
  acquireRunTransitionLock,
  closeRunRecord,
  createRunRecord,
  processIdentity,
  pruneClosedRunRecords,
  readRunRecord,
  updateRunRecord,
} from '../../skills/planr-delegate/scripts/run-record.mjs';
import {
  cleanupDelegateRun,
  delegateRunnerCommand,
  delegateRunStatus,
  dispatchDelegateRun,
  prepareDelegateRun,
  recoverDelegateRun,
  resumeDelegateRun,
} from '../../skills/planr-delegate/scripts/runner.mjs';

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'planr-execution-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'source');
  const runDirectory = join(base, 'runs');
  const profileDirectory = join(base, 'profiles');
  await mkdir(root);
  await mkdir(runDirectory, { mode: 0o700 });
  await mkdir(profileDirectory, { mode: 0o700 });
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  await writeFile(join(root, 'source.txt'), 'initial\n');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  return { base, root, runDirectory, profileDirectory };
}

async function executable(base, text) {
  const path = join(base, 'adapter.mjs');
  await writeFile(path, `#!/usr/bin/env node\n${text}`, { mode: 0o755 });
  await chmod(path, 0o755);
  return path;
}

async function preparedFixture(t) {
  const f = await fixture(t);
  const command = await executable(
    f.base,
    `
if (process.argv.includes('--planr-probe')) {
 console.log(JSON.stringify({protocol:'openplanr.delegate.adapter',version:1,capabilities:{implementation:true,structuredResult:true,exactResume:true},destination:{class:'local',origin:'http://127.0.0.1:11434'}})); process.exit(0);
}
let input='';for await(const part of process.stdin)input+=part;
await new Promise(resolve=>setTimeout(resolve,350));
console.log(JSON.stringify({protocol:'openplanr.delegate.adapter',version:1,status:'completed',sessionId:'execution-session',summary:'Done'}));
`,
  );
  await enrollProfile(
    {
      name: 'execution',
      kind: 'generic',
      executable: command,
      argv: [],
      allowedEnv: [],
      workingDirectory: 'worktree',
      destination: { class: 'local', origin: 'http://127.0.0.1:11434' },
    },
    { directory: f.profileDirectory },
  );
  const prepared = await prepareDelegateRun({
    repositoryRoot: f.root,
    request: 'Update source.txt.',
    selectedFiles: ['source.txt'],
    profile: 'execution',
    profileDirectory: f.profileDirectory,
    runDirectory: f.runDirectory,
    env: { HOME: f.base, PATH: process.env.PATH },
  });
  return { ...f, prepared };
}

test('Codex streams more than 1MiB and pins execution settings on run and exact resume', async (t) => {
  const f = await fixture(t);
  const config = join(f.base, '.codex');
  await mkdir(config);
  await writeFile(
    join(config, 'config.toml'),
    '[mcp_servers."marker-server"]\ncommand="fixture"\n',
  );
  const argvPath = join(f.base, 'arguments.json');
  const command = await executable(
    f.base,
    `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(argvPath)},JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({type:'thread.started',thread_id:'stream-session'}));
for(let i=0;i<20;i++) console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'different '+i,aggregated_output:'x'.repeat(100000),exit_code:0}}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({status:'completed',summary:'Done'})}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:15,output_tokens:2}}));
`,
  );
  const args = {
    profile: { executable: command, argv: [] },
    cwd: f.root,
    env: { HOME: f.base, CODEX_HOME: config, PATH: process.env.PATH },
    prompt: 'Task',
    timeoutMs: 5000,
  };
  for (const operation of ['run', 'resume']) {
    const result = await codexAdapter[operation]({
      ...args,
      ...(operation === 'resume' ? { sessionId: 'stream-session' } : {}),
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.sessionId, 'stream-session');
    const argv = JSON.parse(await readFile(argvPath, 'utf8'));
    for (const setting of [
      'approval_policy="never"',
      'sandbox_mode="workspace-write"',
      'notify=[]',
      'web_search="disabled"',
      'mcp_servers={"marker-server"={enabled=false,command=""}}',
    ])
      assert.ok(argv.includes(setting), setting);
  }
});

test('Codex refuses uninspectable MCP transports before starting the CLI', async (t) => {
  const f = await fixture(t);
  const config = join(f.base, '.codex');
  await mkdir(config);
  await writeFile(
    join(config, 'config.toml'),
    '[mcp_servers."marker.server".env]\nMARKER="fixture"\n',
  );
  const launched = join(f.base, 'launched');
  const command = await executable(
    f.base,
    `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(launched)},'launched');`,
  );
  await assert.rejects(
    codexAdapter.run({
      profile: { executable: command, argv: [] },
      cwd: f.root,
      env: { HOME: f.base, CODEX_HOME: config, PATH: process.env.PATH },
      prompt: 'Task',
      timeoutMs: 5000,
    }),
    { code: 'E_ADAPTER_CONFIG' },
  );
  await assert.rejects(access(launched), { code: 'ENOENT' });
});

test('Codex disables literal MCP names with whitelisted matching inert transports', async (t) => {
  const f = await fixture(t);
  const config = join(f.base, '.codex');
  await mkdir(config);
  await writeFile(
    join(config, 'config.toml'),
    '[mcp_servers."marker.server"]\ncommand="private-command-marker"\n[mcp_servers."remote server"]\nurl="https://private-endpoint.example/mcp"\n',
  );
  const argvPath = join(f.base, 'arguments.json');
  const command = await executable(
    f.base,
    `
import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(argvPath)},JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({type:'thread.started',thread_id:'transport-session'}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({status:'completed',summary:'Done'})}}));
console.log(JSON.stringify({type:'turn.completed'}));
`,
  );
  await codexAdapter.run({
    profile: { executable: command, argv: [] },
    cwd: f.root,
    env: { HOME: f.base, CODEX_HOME: config, PATH: process.env.PATH },
    prompt: 'Task',
    timeoutMs: 5000,
  });
  const argv = JSON.parse(await readFile(argvPath, 'utf8'));
  const override = argv.find((value) => value.startsWith('mcp_servers='));
  assert.equal(
    override,
    'mcp_servers={"marker.server"={enabled=false,command=""},"remote server"={enabled=false,url="http://127.0.0.1:9/mcp"}}',
  );
  assert.ok(!JSON.stringify(argv).includes('private-command-marker'));
  assert.ok(!JSON.stringify(argv).includes('private-endpoint.example'));
});

test('identical Codex command repetitions stop even when outputs contain changing timings', async (t) => {
  const f = await fixture(t);
  const home = join(f.base, '.codex');
  await mkdir(home);
  const command = await executable(
    f.base,
    `
console.log(JSON.stringify({type:'thread.started',thread_id:'repeat-session'}));
for(let i=0;i<5;i++) console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'node --test',aggregated_output:'duration: '+i,exit_code:i%2}}));
console.log(JSON.stringify({type:'turn.completed'}));
`,
  );
  await assert.rejects(
    codexAdapter.run({
      profile: { executable: command, argv: [] },
      cwd: f.root,
      env: { HOME: f.base, CODEX_HOME: home, PATH: process.env.PATH },
      prompt: 'Task',
      timeoutMs: 5000,
    }),
    { code: 'E_ADAPTER_STALLED', sessionId: 'repeat-session' },
  );
});

test('adapter cancellation stops descendant commands before returning the worktree', async (t) => {
  const f = await fixture(t);
  const late = join(f.base, 'late.txt');
  const command = await executable(
    f.base,
    `
import { spawn } from 'node:child_process';
spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(late)},'late'),700)`)}],{stdio:'ignore'});
await new Promise(resolve=>setTimeout(resolve,10000));
`,
  );
  const controller = new AbortController();
  let identity;
  const running = invokeProcess(command, [], {
    cwd: f.root,
    env: { PATH: process.env.PATH },
    signal: controller.signal,
    timeoutMs: 5000,
    onProcess: (value) => {
      identity = value;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  controller.abort();
  await assert.rejects(running, { code: 'E_ADAPTER_CANCELLED' });
  assert.ok(identity.pid > 0);
  assert.equal(identity.pgid, identity.pid);
  assert.ok(identity.started);
  await new Promise((resolve) => setTimeout(resolve, 700));
  await assert.rejects(access(late), { code: 'ENOENT' });
});

test('a per-run transition lock prevents duplicate dispatch and competing resume', async (t) => {
  const f = await preparedFixture(t);
  const { runId } = f.prepared;
  const input = {
    runId,
    runDirectory: f.runDirectory,
    env: { HOME: f.base, PATH: process.env.PATH },
    timeoutMs: 2000,
  };
  const first = dispatchDelegateRun(input);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await assert.rejects(dispatchDelegateRun(input), { code: 'E_RUN_LOCKED' });
  await assert.rejects(resumeDelegateRun({ ...input, correction: 'Review correction' }), {
    code: 'E_RUN_LOCKED',
  });
  assert.equal((await first).status, 'completed');
  const record = await readRunRecord(runId, { directory: f.runDirectory });
  assert.ok(record.delegateProcess?.started);
  assert.ok(record.hostProcess?.started);
});

test('recover rejects PID reuse and honors hard deadlines instead of treating any live PID as its host', async (t) => {
  const f = await preparedFixture(t);
  const { runId } = f.prepared;
  const owner = await processIdentity();
  await updateRunRecord(
    runId,
    {
      status: 'running',
      activePid: process.pid,
      hostProcess: { ...owner, started: 'different-start' },
      hardDeadlineAt: new Date(Date.now() + 5000).toISOString(),
      backendSessionId: 'old-session',
    },
    { directory: f.runDirectory },
  );
  assert.equal(
    (await delegateRunStatus({ runId, runDirectory: f.runDirectory })).processState,
    'reused',
  );
  assert.equal(
    (await recoverDelegateRun({ runId, runDirectory: f.runDirectory })).status,
    'blocked',
  );
  await updateRunRecord(
    runId,
    {
      status: 'running',
      hostProcess: owner,
      hardDeadlineAt: new Date(Date.now() - 1).toISOString(),
    },
    { directory: f.runDirectory },
  );
  assert.equal(
    (await delegateRunStatus({ runId, runDirectory: f.runDirectory })).processState,
    'deadline-expired',
  );
  assert.equal(
    (await recoverDelegateRun({ runId, runDirectory: f.runDirectory })).diagnostic.code,
    'E_DELEGATE_INTERRUPTED',
  );
});

test('cleanup removes only an explicitly closed owned worktree and prune refuses retained worktrees', async (t) => {
  const f = await preparedFixture(t);
  const { runId, record } = f.prepared;
  await assert.rejects(
    cleanupDelegateRun({ runId, runDirectory: f.runDirectory, disposition: 'abandoned' }),
    { code: 'E_DELEGATE_CLEANUP' },
  );
  await closeRunRecord(runId, { directory: f.runDirectory, disposition: 'abandoned' });
  await assert.rejects(
    pruneClosedRunRecords({ directory: f.runDirectory, retentionMs: 0, now: Date.now() + 1000 }),
    { code: 'E_RUN_WORKTREE_RETAINED' },
  );
  await assert.rejects(
    cleanupDelegateRun({ runId, runDirectory: f.runDirectory, disposition: 'accepted' }),
    { code: 'E_DELEGATE_CLEANUP' },
  );
  const removed = await cleanupDelegateRun({
    runId,
    runDirectory: f.runDirectory,
    disposition: 'abandoned',
  });
  assert.equal(removed.status, 'removed');
  await assert.rejects(access(record.worktreePath), { code: 'ENOENT' });
  assert.deepEqual(
    await cleanupDelegateRun({ runId, runDirectory: f.runDirectory, disposition: 'abandoned' }),
    removed,
  );
  assert.deepEqual(
    await pruneClosedRunRecords({
      directory: f.runDirectory,
      retentionMs: 0,
      now: Date.now() + 1000,
    }),
    [runId],
  );
});

test('unresolved integration is visible and prevents execution or abandoning its source delta', async (t) => {
  const f = await preparedFixture(t);
  const { runId } = f.prepared;
  await updateRunRecord(
    runId,
    {
      status: 'completed',
      integration: {
        status: 'applying',
        phase: 'source-write',
        journalPath: 'journal.json',
        cursor: 1,
        pendingPath: 'source.txt',
      },
    },
    { directory: f.runDirectory },
  );
  const state = await delegateRunStatus({ runId, runDirectory: f.runDirectory });
  assert.equal(state.phase, 'integration-recovery');
  assert.match(state.nextAction, /recover/u);
  assert.equal(
    (await recoverDelegateRun({ runId, runDirectory: f.runDirectory })).integration.status,
    'applying',
  );
  await assert.rejects(dispatchDelegateRun({ runId, runDirectory: f.runDirectory }), {
    code: 'E_DELEGATE_INTEGRATION_RECOVERY',
  });
  await assert.rejects(
    resumeDelegateRun({ runId, runDirectory: f.runDirectory, correction: 'Fix' }),
    { code: 'E_DELEGATE_INTEGRATION_RECOVERY' },
  );
  await assert.rejects(
    closeRunRecord(runId, { directory: f.runDirectory, disposition: 'abandoned' }),
    { code: 'E_RUN_INTEGRATION_RECOVERY' },
  );
});

test('retained records without helpers remain readable but cannot silently dispatch unpinned code', async (t) => {
  const f = await fixture(t);
  await createRunRecord({ runId: 'retained', status: 'prepared' }, { directory: f.runDirectory });
  assert.equal(
    (await delegateRunnerCommand('status', { runId: 'retained', runDirectory: f.runDirectory }))
      .helperCompatibility,
    'read-only-record',
  );
  await assert.rejects(
    delegateRunnerCommand('dispatch', { runId: 'retained', runDirectory: f.runDirectory }),
    { code: 'E_DELEGATE_UNPINNED_RUN' },
  );
  assert.equal(
    (
      await delegateRunnerCommand('close', {
        runId: 'retained',
        runDirectory: f.runDirectory,
        disposition: 'abandoned',
      })
    ).status,
    'closed',
  );
});

test('status returns its question and diagnostic while eligibility failures preserve a retryable state', async (t) => {
  const f = await preparedFixture(t);
  const { runId } = f.prepared;
  await writeFile(join(f.profileDirectory, 'execution.json'), '{broken');
  const attempt = await dispatchDelegateRun({
    runId,
    runDirectory: f.runDirectory,
    env: { HOME: f.base, PATH: process.env.PATH },
  });
  assert.equal(attempt.status, 'prepared');
  assert.equal(attempt.record.diagnostic.code, 'E_PROFILE_INVALID');
  await updateRunRecord(
    runId,
    { status: 'question', question: { text: 'Choose A?', options: ['A', 'B'] } },
    { directory: f.runDirectory },
  );
  const state = await delegateRunStatus({ runId, runDirectory: f.runDirectory });
  assert.equal(state.question.text, 'Choose A?');
  assert.equal(state.diagnostic.code, 'E_PROFILE_INVALID');
  const release = await acquireRunTransitionLock(runId, { directory: f.runDirectory });
  await assert.rejects(acquireRunTransitionLock(runId, { directory: f.runDirectory }), {
    code: 'E_RUN_LOCKED',
  });
  await release();
});

test('stock Codex destinations are disclosed according to authentication mode and quoted providers work', async (t) => {
  const f = await fixture(t);
  const home = join(f.base, '.codex');
  await mkdir(home);
  const env = { HOME: f.base, CODEX_HOME: home };
  assert.deepEqual(await resolveCodexDestination({}, env, f.root), {
    class: 'external',
    origin: 'https://chatgpt.com',
  });
  await writeFile(join(home, 'auth.json'), '{"auth_mode":"apikey"}');
  assert.deepEqual(await resolveCodexDestination({}, env, f.root), {
    class: 'external',
    origin: 'https://api.openai.com',
  });
  await writeFile(
    join(home, 'config.toml'),
    'model_provider="local-model"\n[model_providers."local-model"]\nbase_url="http://localhost:1234/v1"\n',
  );
  assert.deepEqual(await resolveCodexDestination({}, env, f.root), {
    class: 'local',
    origin: 'http://localhost:1234',
  });
});

test('run locks recover a killed acquisition owner and stale transition without stranding the run', async (t) => {
  const f = await fixture(t);
  const record = await createRunRecord(
    { runId: 'stale-lock', status: 'prepared' },
    { directory: f.runDirectory },
  );
  const root = join(f.runDirectory, record.runId);
  const dead = { pid: 999999999, started: 'dead-start', source: 'ps-start-time' };
  for (const name of ['transition.acquire', 'transition.lock']) {
    await mkdir(join(root, name), { mode: 0o700 });
    await writeFile(join(root, name, 'owner.json'), JSON.stringify({ token: name, owner: dead }), {
      mode: 0o600,
    });
  }
  const release = await acquireRunTransitionLock(record.runId, { directory: f.runDirectory });
  await assert.rejects(acquireRunTransitionLock(record.runId, { directory: f.runDirectory }), {
    code: 'E_RUN_LOCKED',
  });
  await release();
  await assert.rejects(access(join(root, 'transition.lock')), { code: 'ENOENT' });
  await assert.rejects(access(join(root, 'transition.acquire')), { code: 'ENOENT' });
});
