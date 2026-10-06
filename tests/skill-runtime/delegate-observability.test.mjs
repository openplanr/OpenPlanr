import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  claudeAdapter,
  parseClaudeOutput,
} from '../../skills/planr-delegate/scripts/adapters/claude.mjs';
import { codexAdapter } from '../../skills/planr-delegate/scripts/adapters/codex.mjs';
import { cursorAdapter } from '../../skills/planr-delegate/scripts/adapters/cursor.mjs';
import { invokeProcess } from '../../skills/planr-delegate/scripts/adapters/generic.mjs';
import {
  createNativeProgress,
  failureCode,
  nativeDiagnostic,
  nativeTurn,
  safeNativeDiagnostic,
} from '../../skills/planr-delegate/scripts/adapters/native.mjs';
import {
  handoffPresentation,
  liveExecutionTiming,
  runStatusPresentation,
} from '../../skills/planr-delegate/scripts/presentation.mjs';
import {
  delegateRunnerCommand,
  prepareDelegateRun,
} from '../../skills/planr-delegate/scripts/runner.mjs';

test('unloaded models and authentication retain recognized reasons and numeric status without raw native output', () => {
  assert.equal(failureCode('500 {"message":"Model is unloaded."}'), 'E_ADAPTER_MODEL_UNAVAILABLE');
  const secret = `sk-${'xY'.repeat(15)}`;
  const result = parseClaudeOutput(
    {
      subtype: 'error',
      is_error: true,
      session_id: 'exact',
      result: `Not logged in · Please run /login ${secret}`,
      api_error_status: 401,
    },
    'exact',
    1,
  );
  assert.equal(result.diagnosticCode, 'E_ADAPTER_AUTHENTICATION');
  assert.deepEqual(result.nativeDiagnostic, {
    reason: 'Native CLI reported that it is not logged in.',
    httpStatus: 401,
    exitCode: 1,
  });
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.deepEqual(nativeDiagnostic('HTTP/1.1 500 password=private arbitrary text', 1), {
    httpStatus: 500,
    exitCode: 1,
  });
  assert.deepEqual(
    safeNativeDiagnostic(
      { reason: secret, httpStatus: 600, exitCode: -1, output: secret },
      { class: 'local', origin: 'http://localhost:1234' },
    ),
    { destination: { class: 'local', origin: 'http://localhost:1234' } },
  );
  assert.deepEqual(
    safeNativeDiagnostic({}, { origin: `https://example.test/?token=${secret}` }),
    {},
  );
  assert.throws(
    () => nativeTurn({ sessionId: 'exact', exitCode: 1, errorText: 'HTTP 500 Model is unloaded.' }),
    (error) =>
      error.code === 'E_ADAPTER_MODEL_UNAVAILABLE' &&
      error.details.nativeDiagnostic.httpStatus === 500,
  );
});

test('Claude progress describes actual tool events, retains the latest tool and hides inputs outside owned mounts', () => {
  const progress = createNativeProgress('claude', {
    cwd: '/worktree',
    capsuleDirectory: '/run/capsule',
  });
  const first = progress({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'read-1',
          name: 'Read',
          input: { file_path: '/run/capsule/readable/project/src/index.ts', secret: 'private' },
        },
      ],
    },
  });
  assert.deepEqual(first.latestTool.files, [
    { scope: 'capsule', path: 'readable/project/src/index.ts' },
  ]);
  assert.equal(first.latestTool.state, 'started');
  const completed = progress({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'sensitive file contents' }],
    },
  });
  assert.equal(completed.latestTool.state, 'completed');
  const retained = progress({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'secret narrative' }] },
  });
  assert.equal(retained.latestTool.name, 'Read');
  assert.equal(retained.eventCount, 3);
  assert.equal(retained.toolEventCount, 2);
  assert.ok(!JSON.stringify(retained).includes('secret'));
  const unknown = progress({
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', name: 'Read', input: { file_path: '/home/private/profile.json' } },
      ],
    },
  });
  assert.equal(unknown.latestTool.files, undefined);
  assert.ok(!JSON.stringify(unknown).includes('/home'));
});

test('Claude projects every parallel tool event in order without retaining results', () => {
  const progress = createNativeProgress('claude', { cwd: '/worktree' });
  const started = progress({
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'one.txt' } },
        { type: 'tool_use', id: 'edit', name: 'Edit', input: { file_path: 'two.txt' } },
      ],
    },
  });
  assert.equal(started.toolEventCount, 2);
  assert.equal(started.latestTool.name, 'Edit');
  const completed = progress({
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'read', content: 'private read contents' },
        { type: 'tool_result', tool_use_id: 'edit', is_error: true, content: 'private error' },
      ],
    },
  });
  assert.equal(completed.toolEventCount, 4);
  assert.equal(completed.latestTool.name, 'Edit');
  assert.equal(completed.latestTool.state, 'failed');
  assert.deepEqual(completed.latestTool.files, [{ scope: 'worktree', path: 'two.txt' }]);
  assert.ok(!JSON.stringify(completed).includes('private'));
  assert.deepEqual(createNativeProgress('__proto__')({ type: 'secret', output: 'private' }), {
    event: 'unknown',
    eventCount: 1,
    toolEventCount: 0,
  });
});

test('Codex and Cursor progress expose bounded file-change or file-tool paths without shell commands', () => {
  const codex = createNativeProgress('codex', { cwd: '/worktree' });
  const command = codex({
    type: 'item.started',
    item: {
      type: 'command_execution',
      command: 'export TOKEN=private',
      aggregated_output: 'secret',
    },
  });
  assert.equal(command.latestTool.name, 'Command');
  assert.ok(!JSON.stringify(command).includes('TOKEN'));
  const changed = codex({
    type: 'item.completed',
    item: {
      type: 'file_change',
      changes: Array.from({ length: 20 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        diff: 'secret diff',
      })),
    },
  });
  assert.equal(changed.latestTool.files.length, 6);
  assert.ok(!JSON.stringify(changed).includes('diff'));
  const cursor = createNativeProgress('cursor', { cwd: '/worktree' });
  const read = cursor({
    type: 'tool_call',
    subtype: 'started',
    tool_call: { readToolCall: { args: { path: 'src/file.ts', content: 'private' } } },
  });
  assert.deepEqual(read.latestTool.files, [{ scope: 'worktree', path: 'src/file.ts' }]);
  assert.equal(read.latestTool.name, 'read');
  const hidden = cursor({
    type: 'tool_call',
    subtype: 'started',
    tool_call: { readToolCall: { args: { path: `sk-${'xY'.repeat(15)}` } } },
  });
  assert.equal(hidden.latestTool.files, undefined);
});

test('live timing adds active attempt duration without changing persisted totals or double-counting completed attempts', () => {
  const record = {
    status: 'running',
    executionTiming: {
      attempts: 2,
      durationMs: 500,
      last: { status: 'running', startedAt: '2026-10-04T10:00:00.000Z' },
    },
  };
  const current = liveExecutionTiming(record, Date.parse('2026-10-04T10:30:00.000Z'));
  assert.equal(current.durationMs, 1_800_500);
  assert.equal(current.last.durationMs, 1_800_000);
  assert.equal(current.live, true);
  assert.equal(record.executionTiming.durationMs, 500);
  const completed = {
    status: 'completed',
    executionTiming: {
      attempts: 2,
      durationMs: 1_800_500,
      last: {
        status: 'completed',
        startedAt: '2026-10-04T10:00:00.000Z',
        finishedAt: '2026-10-04T10:30:00.000Z',
        durationMs: 1_800_000,
      },
    },
  };
  assert.deepEqual(
    liveExecutionTiming(completed, Date.parse('2026-10-04T11:00:00.000Z')),
    completed.executionTiming,
  );
  assert.equal(liveExecutionTiming({}), null);
  const diagnostic = { code: 'E_ADAPTER_AUTHENTICATION', details: { native: { httpStatus: 401 } } };
  assert.deepEqual(
    handoffPresentation({ status: 'blocked', record: { diagnostic } }).diagnostic,
    diagnostic,
  );
});

test('abandoned never-started runs distinguish cleanup completion from retained work needing recovery', () => {
  for (const status of ['removed', 'not-created']) {
    const presentation = runStatusPresentation(
      { abandonment: { kind: 'never-started' }, cleanup: { status } },
      {},
    );
    assert.equal(presentation.phase, 'abandoned');
    assert.match(presentation.nextAction, /record and capsule remain available/);
  }
  const pending = runStatusPresentation(
    { abandonment: { kind: 'never-started' }, cleanup: { status: 'failed' } },
    {},
  );
  assert.equal(pending.phase, 'abandon-cleanup-pending');
  assert.match(pending.nextAction, /worktree remains retained/);
});

async function syntheticAdapter(t, engine, mode) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'planr-observed-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'capsule');
  await mkdir(directory, { mode: 0o700 });
  const capsulePath = join(directory, 'capsule.json');
  await writeFile(capsulePath, '{}', { mode: 0o600 });
  const executable = join(root, 'synthetic-native');
  await writeFile(
    executable,
    `#!${process.execPath}
if(process.argv.includes('--help')) { if(process.env.FIXTURE_PROBE_FAILURE) { console.log('Not logged in sk-'+ 'xY'.repeat(15)); process.exit(1); } console.log('--print --output-format stream-json --resume --session-id --add-dir --json resume'); process.exit(0); }
const emit = event => console.log(JSON.stringify(event));
process.stdin.resume(); process.stdin.on('end', () => {
const engine = ${JSON.stringify(engine)}, mode = ${JSON.stringify(mode)};
if (mode === 'stderr') { if(process.env.FIXTURE_OBSERVED_SESSION) emit({type:'thread.started',thread_id:'exact'}); process.stderr.write('HTTP 500 Model is unloaded. password=do-not-retain'); process.exitCode = 1; return; }
if (engine === 'codex') { emit({type:'thread.started',thread_id:'exact'}); emit({type:'item.started',item:{type:'command_execution',command:'echo secret'}}); emit({type:'item.completed',item:{type:'agent_message',text:'Completed'}}); emit({type:'turn.completed'}); }
else { emit({type:'system',subtype:'init',session_id:'exact'}); if (engine === 'claude') emit({type:'assistant',session_id:'exact',message:{content:[{type:'tool_use',id:'read-1',name:'Read',input:{file_path:process.cwd()+'/source.ts'}}]}}); else { emit({type:'tool_call',subtype:'started',session_id:'exact',tool_call:{readToolCall:{args:{path:'source.ts'}}}}); emit({type:'assistant',session_id:'exact',message:{content:[{type:'text',text:'Completed'}]}}); } emit({type:'result',subtype:'success',is_error:false,session_id:'exact',result:'Completed'}); }
});
`,
    { mode: 0o700 },
  );
  return {
    profile: { executable, argv: [] },
    cwd: root,
    capsulePath,
    prompt: 'Synthetic fixture',
    sessionId: 'exact',
    env: { ...process.env },
  };
}

test('dispatch returns the recognized native failure and exact destination directly while retaining the draft', async (t) => {
  const input = await syntheticAdapter(t, 'codex', 'stderr');
  const git = (...args) => execFileSync('git', args, { cwd: input.cwd, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  await writeFile(join(input.cwd, '.gitignore'), 'capsule/\nsynthetic-native\n');
  await writeFile(join(input.cwd, 'source.ts'), 'export const initial = true;\n');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  const env = {
    HOME: input.cwd,
    PATH: '/usr/bin:/bin',
    OPENAI_BASE_URL: 'https://fixture.example.test',
  };
  const runDirectory = await realpath(await mkdtemp(join(tmpdir(), 'planr-observed-runs-')));
  t.after(() => rm(runDirectory, { recursive: true, force: true }));
  const prepared = await prepareDelegateRun({
    repositoryRoot: input.cwd,
    request: 'Update source.ts.',
    selectedFiles: ['source.ts'],
    scopePaths: ['source.ts'],
    profile: { ...input.profile, kind: 'codex', name: 'observable-fixture' },
    profileDirectory: join(runDirectory, 'profiles'),
    runDirectory,
    env,
  });
  const outcome = await delegateRunnerCommand('dispatch', {
    runId: prepared.runId,
    runDirectory,
    env,
  });
  assert.equal(outcome.status, 'blocked');
  assert.equal(outcome.diagnostic.code, 'E_ADAPTER_MODEL_UNAVAILABLE');
  assert.deepEqual(outcome.diagnostic.details.native, {
    reason: 'Model is unloaded.',
    httpStatus: 500,
    exitCode: 1,
    destination: { class: 'external', origin: 'https://fixture.example.test' },
  });
  assert.ok(!JSON.stringify(outcome).includes('do-not-retain'));
  assert.equal(outcome.presentation.timing.attempts, 1);
  assert.equal(
    await readFile(join(outcome.record.worktreePath, 'source.ts'), 'utf8'),
    'export const initial = true;\n',
  );
  const fresh = await prepareDelegateRun({
    repositoryRoot: input.cwd,
    request: 'Update source.ts.',
    selectedFiles: ['source.ts'],
    scopePaths: ['source.ts'],
    profile: { ...input.profile, kind: 'codex', name: 'observable-fixture' },
    profileDirectory: join(runDirectory, 'profiles'),
    runDirectory,
    env,
  });
  const denied = await delegateRunnerCommand('dispatch', {
    runId: fresh.runId,
    runDirectory,
    env: { ...env, FIXTURE_PROBE_FAILURE: '1' },
  });
  assert.equal(denied.status, 'prepared');
  assert.equal(
    denied.diagnostic.details.native.reason,
    'Native CLI reported that it is not logged in.',
  );
  assert.ok(!JSON.stringify(denied).includes(`sk-${'xY'.repeat(15)}`));
  const started = await delegateRunnerCommand('dispatch', {
    runId: fresh.runId,
    runDirectory,
    env: { ...env, FIXTURE_OBSERVED_SESSION: '1' },
  });
  assert.equal(started.status, 'blocked');
  assert.equal(started.record.backendSessionId, 'exact');
  const resumed = await delegateRunnerCommand('resume', {
    runId: fresh.runId,
    runDirectory,
    correction: 'Retry the observed failure.',
    env: { ...env, FIXTURE_PROBE_FAILURE: '1' },
  });
  assert.equal(resumed.status, 'blocked');
  assert.equal(
    resumed.diagnostic.details.native.reason,
    'Native CLI reported that it is not logged in.',
  );
  assert.ok(!JSON.stringify(resumed).includes(`sk-${'xY'.repeat(15)}`));
  assert.equal(resumed.presentation.timing.attempts, 1);
});

for (const [engine, adapter] of [
  ['claude', claudeAdapter],
  ['codex', codexAdapter],
  ['cursor', cursorAdapter],
]) {
  test(`${engine}: synthetic stderr-only failure is classified without exposing raw output`, async (t) => {
    const input = await syntheticAdapter(t, engine, 'stderr');
    await assert.rejects(adapter.run(input), (error) => {
      assert.equal(error.code, 'E_ADAPTER_MODEL_UNAVAILABLE');
      assert.equal(error.details.nativeDiagnostic.httpStatus, 500);
      assert.ok(!JSON.stringify(error).includes('do-not-retain'));
      return true;
    });
  });
  test(`${engine}: synthetic native stream exposes actual latest tool and terminal event`, async (t) => {
    const input = await syntheticAdapter(t, engine, 'progress');
    const activity = [];
    const result = await adapter.run({
      ...input,
      onActivity: (progress) => activity.push(progress),
    });
    assert.equal(result.status, 'completed');
    assert.equal(activity.at(-1).latestTool.state, 'started');
    assert.equal(activity.at(-1).toolEventCount, 1);
    assert.ok(!JSON.stringify(activity).includes('echo secret'));
    if (engine !== 'codex')
      assert.deepEqual(activity.at(-1).latestTool.files, [
        { scope: 'worktree', path: 'source.ts' },
      ]);
  });
}

test('launch bookkeeping failure terminates the owned child without awaiting its own rejection callback', async () => {
  const started = Date.now();
  await assert.rejects(
    invokeProcess(process.execPath, ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'], {
      timeoutMs: 2000,
      onProcess: () => {
        throw Object.assign(new Error('synthetic bookkeeping failure'), {
          code: 'E_FIXTURE_BOOKKEEPING',
        });
      },
    }),
    { code: 'E_FIXTURE_BOOKKEEPING' },
  );
  assert.ok(
    Date.now() - started < 1800,
    'failure returns without waiting for the explicit deadline',
  );
});

test('unavailable process inspection fails before spawning an adapter', {
  skip: process.platform === 'linux' || process.platform === 'win32',
}, () => {
  const adapter = new URL(
    '../../skills/planr-delegate/scripts/adapters/generic.mjs',
    import.meta.url,
  ).href;
  const script = `
    import assert from 'node:assert/strict';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    let spawned = 0;
    childProcess.execFile = (...args) => queueMicrotask(() => args.at(-1)(Object.assign(new Error('inspection rejected'), { code: 'EACCES' })));
    childProcess.spawn = () => { spawned++; throw new Error('must not launch'); };
    syncBuiltinESMExports();
    const { invokeProcess } = await import(${JSON.stringify(adapter)});
    await assert.rejects(invokeProcess(process.execPath, ['-e', 'throw new Error("must not execute")']), { code: 'E_ADAPTER_PROCESS_IDENTITY' });
    assert.equal(spawned, 0);
  `;
  execFileSync(process.execPath, ['--input-type=module', '-'], {
    input: script,
    timeout: 5000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
});
