import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { claudeWriteFlags } from '../../packages/pipeline/lib/delegate/adapters/claude.mjs';
import {
  codexWriteFlags,
  resolveCodexDestination,
} from '../../packages/pipeline/lib/delegate/adapters/codex.mjs';
import { terminateProcessGroup } from '../../packages/pipeline/lib/delegate/adapters/generic.mjs';
import { failureCode, nativeTurn } from '../../packages/pipeline/lib/delegate/adapters/native.mjs';
import { integrateBranchDelta } from '../../packages/pipeline/lib/delegate/handoff.mjs';
import { delegateIntegrationCommand } from '../../packages/pipeline/lib/delegate/integrate.mjs';
import {
  resolveSelectedChecks,
  runDelegateChecks,
} from '../../packages/pipeline/lib/delegate/integration-checks.mjs';
import {
  enrollProfile,
  loadProfile,
  nativeReadiness,
  prepareProfile,
  saveEngineChoice,
} from '../../packages/pipeline/lib/delegate/profiles.mjs';
import { cleanupAcceptedWorktree } from '../../packages/pipeline/lib/delegate/run-lifecycle.mjs';
import {
  processIdentity,
  readRunRecord,
  updateRunRecord,
} from '../../packages/pipeline/lib/delegate/run-record.mjs';
import {
  delegateRunnerCommand,
  delegateRunStatus,
  dispatchDelegateRun,
  prepareDelegateRun,
  resumeDelegateRun,
} from '../../packages/pipeline/lib/delegate/runner.mjs';

async function fixture(t, kind = 'codex', mode = '') {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'planr-native-v2-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'source');
  const bin = join(base, 'bin');
  await mkdir(root);
  await mkdir(bin);
  const git = (...args) => execFileSync('git', args, { cwd: root });
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  await writeFile(
    join(root, '.gitignore'),
    'ignored.md\ninvocations.jsonl\nnode_modules/\ncache/\n',
  );
  await writeFile(join(root, 'source.txt'), 'base\n');
  await writeFile(join(root, 'AGENTS.md'), 'Keep preserved.txt unchanged. Run relevant checks.\n');
  await writeFile(join(root, 'preserved.txt'), 'preserve\n');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  await writeFile(
    join(root, 'ignored.md'),
    'Required ignored context: use implemented then corrected.\n',
  );
  const executable = join(bin, kind === 'cursor' ? 'agent' : kind);
  // Native children receive an allowlisted environment, so the fixture reads its mode from HOME.
  const modeFile = join(base, 'fixture-mode');
  const setMode = (next) => writeFile(modeFile, next);
  await setMode(mode);
  await writeFile(
    executable,
    `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),kind=${JSON.stringify(kind)},mode=fs.readFileSync(path.join(process.env.HOME,'fixture-mode'),'utf8');
if(args.includes('--help')) { console.log('--print --output-format stream-json --resume --session-id --add-dir --json resume --sandbox --auto-review --workspace'); process.exit(0); }
if(args.includes('status')) { console.log(JSON.stringify({isAuthenticated:true,email:'account-is-not-evidence@example.test'})); process.exit(0); }
const resume=args.includes('--resume')||args.includes('resume');
const id=resume?(args.includes('--resume')?args[args.indexOf('--resume')+1]:args.at(-2)):(args.includes('--session-id')?args[args.indexOf('--session-id')+1]:'native-session');
let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{
 fs.appendFileSync('invocations.jsonl',JSON.stringify({args,input,extension:process.env.TRUSTED_EXTENSION,configuration:process.env.CLAUDE_CONFIG_DIR})+'\\n');
 const emit=event=>console.log(JSON.stringify(event));
 if(kind==='codex')emit({type:'thread.started',thread_id:id});else emit({type:'system',subtype:'init',session_id:id,model:'observed-model'});
 if(mode==='malformed')return console.log('invalid event');
 if(mode==='hang')return setInterval(()=>{},1000);
 if(mode==='denied') {
  if(kind==='codex')emit({type:'turn.failed',error:{message:'Permission requires approval'}});
  else emit({type:'result',subtype:'error',is_error:true,session_id:id,result:'Permission requires approval',errors:['Permission requires approval'],permission_denials:[{tool_name:'Bash'}]});
  return;
 }
 if(mode==='readonly-command'||mode==='readonly-summary'||mode==='readonly-capability') {
  if(mode==='readonly-command')emit({type:'item.completed',item:{type:'command_execution',command:'write source.txt',aggregated_output:'Read-only file system',exit_code:1}});
  emit({type:'item.completed',item:{type:'agent_message',text:mode==='readonly-summary'?'Implementation is blocked by read-only access.':mode==='readonly-capability'?'Read the request and all required mirror files. Implementation is blocked: this session permits only filesystem reads and forbids permission escalation.':'Native turn finished.'}});
  emit({type:'turn.completed',usage:{input_tokens:10,output_tokens:3}});
  return;
 }
 if(!resume) {
  const dir=args[args.indexOf('--add-dir')+1];
  const capsule=JSON.parse(fs.readFileSync(path.join(dir,'capsule.json'),'utf8'));
  const copied=capsule.mirror.files.find(file=>file.path.endsWith('/ignored.md'));
  if(!copied||!fs.readFileSync(path.join(dir,'readable',copied.path),'utf8').includes('Required ignored context'))process.exit(14);
 }
 for(let i=0;i<40;i++)if(kind==='codex')emit({type:'item.completed',item:{type:'command_execution',command:'same command',aggregated_output:'same output',exit_code:0}});
 if(mode==='survivor')require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},5000)'],{stdio:'ignore'}).unref();
 fs.writeFileSync('source.txt',resume?'corrected\\n':'implemented\\n');
 if(mode==='no-terminal')return;
 const finish=()=>{
 if(kind==='codex') { if(mode!=='no-summary')emit({type:'item.completed',item:{type:'agent_message',text:mode==='past-readonly'?'Implementation is complete. A previous session permitted only filesystem reads.':'Plain native summary.'}});emit({type:'turn.completed',usage:{input_tokens:10,output_tokens:3}}); }
 else { if(kind==='cursor')emit({type:'assistant',session_id:id,message:{content:[{type:'text',text:'Plain native summary.'}]}});emit({type:'result',subtype:'success',is_error:false,session_id:id,result:mode==='no-summary'?'':'Plain native summary.'}); }
 };
 if(mode==='slow')setTimeout(finish,450);else finish();
});
`,
    { mode: 0o700 },
  );
  const env = {
    ...process.env,
    HOME: base,
    PATH: `${bin}:/usr/bin:/bin`,
    TRUSTED_EXTENSION: 'unrelated-value',
    ANTHROPIC_BASE_URL: '',
    OPENAI_BASE_URL: '',
    CURSOR_API_ENDPOINT: '',
    CODEX_HOME: '',
    CLAUDE_CONFIG_DIR: '',
  };
  const profile = { name: `optional-${kind}`, kind, executable, argv: [] };
  const profileDirectory = join(base, 'profiles');
  const runDirectory = join(base, 'runs');
  const prepare = (extra) =>
    prepareDelegateRun({
      repositoryRoot: root,
      request: 'Implement source.txt using ignored.md and binding instructions.',
      selectedFiles: ['source.txt', 'ignored.md'],
      scopePaths: ['source.txt'],
      preservePaths: ['preserved.txt'],
      engine: kind,
      profileDirectory,
      runDirectory,
      env,
      ...extra,
    });
  return {
    base,
    root,
    bin,
    executable,
    env,
    setMode,
    profile,
    profileDirectory,
    runDirectory,
    prepare,
  };
}

for (const kind of ['claude', 'codex', 'cursor']) {
  test(`${kind}: fresh native onboarding, complete ignored context, plain completion, exact continuation and owned cleanup`, async (t) => {
    const f = await fixture(t, kind);
    const prepared = await f.prepare();
    const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
    assert.equal(prepared.record.schemaVersion, '3.0.0');
    assert.equal(prepared.preview.modelSelection, 'native default/automatic');
    assert.equal(prepared.preview.destination.class, 'native-managed');
    assert.match(prepared.preview.executionPolicy.extensions, /hooks, plugins and MCP/);
    assert.equal(
      prepared.preview.executionPolicy.permissions,
      kind === 'cursor' ? 'native-managed' : 'native-managed; edit mode when none is configured',
    );
    const first = await dispatchDelegateRun(input);
    assert.equal(first.status, 'completed');
    const second = await resumeDelegateRun({
      ...input,
      correction: 'Change implemented to corrected and check the result.',
    });
    assert.equal(second.status, 'completed');
    assert.ok(first.record.backendSessionId);
    assert.equal(second.record.backendSessionId, first.record.backendSessionId);
    const calls = (await readFile(join(prepared.record.worktreePath, 'invocations.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].extension, undefined, 'unrelated variables stay out of the native child');
    assert.match(calls[0].input, /ordered|INDEX|index/i);
    assert.ok(!calls[1].input.includes('capsule.json'), 'resume does not resend full context');
    const writeFlags = {
      claude: ['--permission-mode', 'acceptEdits'],
      codex: ['--sandbox', 'workspace-write'],
      cursor: [],
    }[kind];
    for (const call of calls) {
      const at = call.args.indexOf(writeFlags[0]);
      if (writeFlags.length) assert.deepEqual(call.args.slice(at, at + 2), writeFlags);
      if (kind === 'codex') assert.ok(at < call.args.indexOf('--json'), 'exec-level flag');
      assert.equal(
        call.args.filter((arg) => /permission-mode|sandbox/u.test(arg)).length,
        writeFlags.length / 2,
      );
      assert.ok(
        !call.args.some((arg) =>
          /force|yolo|bypass|dangerously|danger-full-access|disallowedTools|strict-mcp|restricted|setting-sources|web_search/u.test(
            arg,
          ),
        ),
      );
    }
    assert.equal(
      (await readRunRecord(prepared.runId, { directory: f.runDirectory })).hardDeadlineAt,
      null,
    );
    const review = await delegateIntegrationCommand('review', input);
    assert.equal(review.ready, true);
    const applied = await delegateIntegrationCommand('apply', {
      ...input,
      checks: [
        {
          executable: process.execPath,
          args: [
            '-e',
            "require('node:assert').equal(require('node:fs').readFileSync('source.txt','utf8'),'corrected\\n')",
          ],
          cwd: '.',
        },
      ],
    });
    assert.equal(applied.status, 'completed', JSON.stringify(applied));
    assert.equal(applied.verification.candidateKind, 'prepared-worktree');
    assert.equal(applied.cleanup.status, 'removed');
    await assert.rejects(readFile(join(prepared.record.worktreePath, 'source.txt')), {
      code: 'ENOENT',
    });
    assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'corrected\n');
    const recovered = await delegateRunStatus(input);
    assert.equal(recovered.status, 'closed');
    assert.equal(recovered.integration.verified, true);
    assert.equal(recovered.report.Checks.includes('1/1'), true);
  });
}

test('edit flags apply only when native settings choose no permission mode', async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'planr-write-flags-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const cwd = join(base, 'worktree');
  const options = { managedRoot: join(base, 'managed') };
  await mkdir(join(cwd, '.claude'), { recursive: true });
  await mkdir(join(cwd, '.codex'), { recursive: true });
  await mkdir(join(base, '.claude'));
  await mkdir(join(base, '.codex'));
  const env = { HOME: base };
  const profile = { argv: [] };
  assert.deepEqual(await claudeWriteFlags(profile, env, cwd, options), [
    '--permission-mode',
    'acceptEdits',
  ]);
  await writeFile(
    join(cwd, '.claude', 'settings.json'),
    JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }),
  );
  assert.equal((await claudeWriteFlags(profile, env, cwd, options)).length, 2);
  await writeFile(
    join(base, '.claude', 'settings.json'),
    JSON.stringify({ permissions: { defaultMode: 'auto' } }),
  );
  assert.deepEqual(await claudeWriteFlags(profile, env, cwd, options), []);
  await writeFile(join(base, '.claude', 'settings.json'), '{ unreadable');
  assert.deepEqual(await claudeWriteFlags(profile, env, cwd, options), []);
  await writeFile(
    join(base, '.claude', 'settings.json'),
    JSON.stringify({ padding: 'x'.repeat(70 * 1024) }),
  );
  assert.deepEqual(await claudeWriteFlags(profile, env, cwd, options), []);

  const codex = join(base, '.codex', 'config.toml');
  assert.deepEqual(await codexWriteFlags(profile, env, cwd), ['--sandbox', 'workspace-write']);
  await writeFile(codex, 'profile = "ci"\n[profiles.other]\nsandbox_mode = "read-only"\n');
  assert.equal((await codexWriteFlags(profile, env, cwd)).length, 2);
  await writeFile(codex, 'profile = "ci"\n[profiles.ci]\nsandbox_mode = "danger-full-access"\n');
  assert.deepEqual(await codexWriteFlags(profile, env, cwd), []);
  await writeFile(codex, 'profiles.ci.sandbox_mode = "read-only"\n');
  assert.deepEqual(await codexWriteFlags(profile, env, cwd), []);
  await writeFile(codex, '[profiles]\nci = { sandbox_mode = "read-only" }\n');
  assert.deepEqual(await codexWriteFlags(profile, env, cwd), []);
  await writeFile(codex, '"sandbox_mode" = "read-only"\n');
  assert.deepEqual(await codexWriteFlags(profile, env, cwd), []);
  await writeFile(codex, '# sandbox_mode = "read-only"\n');
  assert.equal((await codexWriteFlags(profile, env, cwd)).length, 2);
  await writeFile(codex, `sandbox_mode = "danger-full-access"\n${'# padding\n'.repeat(8000)}`);
  assert.deepEqual(await codexWriteFlags(profile, env, cwd), []);
  await writeFile(codex, 'sandbox_mode = "danger-full-access"\n');
  await chmod(codex, 0o000);
  assert.deepEqual(await codexWriteFlags(profile, env, cwd), []);
  await chmod(codex, 0o600);
  await writeFile(codex, '');
  await writeFile(join(cwd, '.codex', 'config.toml'), 'sandbox_mode = "read-only"\n');
  assert.deepEqual(await codexWriteFlags(profile, env, cwd), []);
});

test('selection handles ambiguity, explicit model/configuration and saved native engine without enrollment', async (t) => {
  const f = await fixture(t);
  await symlink(f.executable, join(f.bin, 'claude'));
  await assert.rejects(
    prepareProfile(undefined, { env: f.env, cwd: f.root, directory: f.profileDirectory }),
    { code: 'E_ENGINE_AMBIGUOUS' },
  );
  const explicit = await prepareProfile(undefined, {
    engine: 'codex',
    model: 'specific-model',
    env: f.env,
    cwd: f.root,
    directory: f.profileDirectory,
  });
  assert.deepEqual(explicit.profile.argv, ['--model', 'specific-model']);
  await f.prepare();
  const saved = await prepareProfile(undefined, {
    env: f.env,
    cwd: f.root,
    directory: f.profileDirectory,
  });
  assert.equal(saved.profile.kind, 'codex');
});

test('optional native profiles have no renewal and legacy profile bytes remain unchanged', async (t) => {
  const f = await fixture(t);
  await enrollProfile(f.profile, { directory: f.profileDirectory });
  const saved = await loadProfile(f.profile.name, {
    directory: f.profileDirectory,
    now: Date.now() + 90 * 86400000,
  });
  assert.equal(saved.version, 2);
  assert.equal(saved.expiresAt, undefined);
  const old = {
    ...saved,
    version: 1,
    createdAt: 1,
    expiresAt: 2,
    destination: { class: 'external', origin: 'https://example.test' },
  };
  const path = join(f.profileDirectory, `${f.profile.name}.json`);
  const bytes = JSON.stringify(old);
  await writeFile(path, bytes, { mode: 0o600 });
  const native = await prepareProfile(f.profile.name, {
    directory: f.profileDirectory,
    cwd: f.root,
    env: { ...f.env, OPENAI_BASE_URL: old.destination.origin },
  });
  assert.equal(native.profile.kind, 'codex');
  assert.equal(await readFile(path, 'utf8'), bytes);
  await assert.rejects(enrollProfile(f.profile, { directory: f.profileDirectory }), {
    code: 'E_PROFILE_EXISTS',
  });
});

test('diagnostics never infer an inactive provider and local model health remains diagnostic', async (t) => {
  const f = await fixture(t);
  const config = join(f.base, '.codex');
  await mkdir(config);
  await writeFile(
    join(config, 'config.toml'),
    '[model_providers.unused]\nbase_url="http://127.0.0.1:1234/v1"\n',
  );
  assert.equal((await resolveCodexDestination(f.profile, f.env)).class, 'native-managed');
  await writeFile(
    join(config, 'config.toml'),
    'model_provider="local"\n[model_providers.local]\nbase_url="http://127.0.0.1:1234/v1"\n',
  );
  assert.equal((await resolveCodexDestination(f.profile, f.env)).class, 'local');
  const readiness = nativeReadiness({ class: 'local' }, { status: 'unreachable' });
  assert.equal(readiness.dispatchable, true);
  assert.equal(readiness.diagnosticOnly, true);
  for (const [text, code] of [
    ['System message must be at the beginning', 'E_ADAPTER_MODEL_TEMPLATE'],
    ['Model not loaded', 'E_ADAPTER_MODEL_UNAVAILABLE'],
    ['Authentication required', 'E_ADAPTER_AUTHENTICATION'],
    ['Usage limit exceeded', 'E_ADAPTER_QUOTA'],
  ])
    assert.equal(failureCode(text), code);
});

test('native terminal evidence is strict; absent summary is only a warning', () => {
  const good = nativeTurn({
    terminal: { type: 'turn.completed', success: true },
    sessionId: 'exact',
    exitCode: 0,
  });
  assert.equal(good.status, 'completed');
  assert.equal(good.warnings.length, 1);
  assert.throws(() => nativeTurn({ sessionId: 'exact', exitCode: 0 }), {
    code: 'E_ADAPTER_RESULT',
  });
  assert.throws(
    () =>
      nativeTurn({
        terminal: { success: true },
        sessionId: 'different',
        expectedSessionId: 'exact',
        exitCode: 0,
      }),
    { code: 'E_ADAPTER_SESSION' },
  );
});

test('native permission denial remains actionable and continues the same session after resolution', async (t) => {
  const f = await fixture(t, 'codex', 'denied');
  const prepared = await f.prepare();
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  const denied = await dispatchDelegateRun(input);
  assert.equal(denied.status, 'blocked');
  const status = await delegateRunStatus(input);
  assert.equal(status.diagnostic.code, 'E_ADAPTER_PERMISSION');
  await assert.rejects(delegateIntegrationCommand('review', input), {
    code: 'E_INTEGRATION_RUN',
    message: /resume with this runId and an answer or correction/,
  });
  await f.setMode('');
  const resumed = await resumeDelegateRun({
    ...input,
    env: f.env,
    correction: 'Native approval is resolved; continue the task.',
  });
  assert.equal(resumed.status, 'completed');
  assert.ok(denied.record.backendSessionId);
  assert.equal(resumed.record.backendSessionId, denied.record.backendSessionId);
});

for (const mode of ['readonly-command', 'readonly-summary', 'readonly-capability']) {
  test(`Codex completed native turn with ${mode} remains actionable`, async (t) => {
    const f = await fixture(t, 'codex', mode);
    const prepared = await f.prepare();
    const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
    const denied = await dispatchDelegateRun(input);
    assert.equal(denied.status, 'blocked');
    assert.equal((await delegateRunStatus(input)).diagnostic.code, 'E_ADAPTER_PERMISSION');
    assert.equal(
      await readFile(join(prepared.record.worktreePath, 'source.txt'), 'utf8'),
      'base\n',
    );
    await f.setMode('');
    const resumed = await resumeDelegateRun({
      ...input,
      env: f.env,
      correction: 'Native approval is resolved; implement the same task.',
    });
    assert.equal(resumed.status, 'completed');
    assert.ok(denied.record.backendSessionId);
    assert.equal(resumed.record.backendSessionId, denied.record.backendSessionId);
  });
}

test('Codex completed work is not blocked by a historical read-only mention', async (t) => {
  const f = await fixture(t, 'codex', 'past-readonly');
  const prepared = await f.prepare();
  const result = await dispatchDelegateRun({
    runId: prepared.runId,
    runDirectory: f.runDirectory,
    env: f.env,
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.record.diagnostic, null);
  assert.equal(
    await readFile(join(prepared.record.worktreePath, 'source.txt'), 'utf8'),
    'implemented\n',
  );
});

test('native silence has no default deadline; an explicit deadline retains worktree and session', async (t) => {
  const slow = await fixture(t, 'codex', 'slow');
  const prepared = await slow.prepare();
  assert.equal(
    (
      await dispatchDelegateRun({
        runId: prepared.runId,
        runDirectory: slow.runDirectory,
        env: slow.env,
      })
    ).status,
    'completed',
  );
  const hanging = await fixture(t, 'codex', 'hang');
  const pending = await hanging.prepare();
  const timed = await dispatchDelegateRun({
    runId: pending.runId,
    runDirectory: hanging.runDirectory,
    env: hanging.env,
    timeoutMs: 1000,
  });
  assert.equal(timed.status, 'blocked');
  assert.equal(timed.record.diagnostic.code, 'E_DELEGATE_TIMEOUT');
  assert.equal(timed.record.executionTiming.attempts, 1);
  assert.equal(timed.record.sessionEvidence, 'observed');
  assert.equal(timed.record.delegateTerminationConfirmed, true);
  assert.equal(await readFile(join(pending.record.worktreePath, 'source.txt'), 'utf8'), 'base\n');
});

test('preparation runs once, attributes tracked changes and permits later correction of setup paths', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare({ scopePaths: ['source.txt', 'generated.txt'] });
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  const commands = [
    {
      executable: process.execPath,
      args: ['-e', "require('node:fs').writeFileSync('generated.txt','prepared\\n')"],
      cwd: '.',
    },
  ];
  await delegateRunnerCommand('prepare-worktree', { ...input, commands });
  await delegateRunnerCommand('prepare-worktree', {
    ...input,
    commands: [{ executable: 'missing-command', args: [] }],
  });
  await dispatchDelegateRun(input);
  await writeFile(join(prepared.record.worktreePath, 'generated.txt'), 'corrected setup\n');
  const review = await delegateIntegrationCommand('review', input);
  assert.equal(review.ready, true);
  assert.ok(review.changedPaths.includes('generated.txt'));
  const provenance = await readRunRecord(prepared.runId, { directory: f.runDirectory });
  assert.deepEqual(provenance.preparationProvenance.paths, ['generated.txt']);
});

test('structured checks support parent-selected Python, Make and focused tools without shell parsing', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'Makefile'), 'check:\n\t@test -f source.txt\n');
  const checks = await resolveSelectedChecks(f.root, [
    {
      executable: '/usr/bin/python3',
      args: ['-c', "from pathlib import Path; assert Path('source.txt').read_text() == 'base\\n'"],
      cwd: '.',
    },
    { executable: 'make', args: ['check'], cwd: '.' },
  ]);
  const results = await runDelegateChecks({ repositoryRoot: f.root, checks });
  assert.ok(
    results.every((result) => result.status === 'passed'),
    JSON.stringify(results),
  );
  await assert.rejects(resolveSelectedChecks(f.root, ['npm run test']), {
    code: 'E_INTEGRATION_CHECK_SELECTION',
  });
  await assert.rejects(
    resolveSelectedChecks(f.root, [{ executable: 'node', args: [], cwd: '..' }]),
    { code: 'E_INTEGRATION_CHECK_SELECTION' },
  );
});

test('verification mutation invalidates the review, then the updated candidate can be reviewed', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare();
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await delegateIntegrationCommand('review', input);
  const result = await delegateIntegrationCommand('apply', {
    ...input,
    checks: [
      {
        executable: process.execPath,
        args: ['-e', "require('node:fs').writeFileSync('source.txt','verified mutation\\n')"],
        cwd: '.',
      },
    ],
  });
  assert.equal(result.code, 'E_INTEGRATION_REVIEW_DRIFT');
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'base\n');
  await delegateIntegrationCommand('review', input);
  const final = await delegateIntegrationCommand('apply', {
    ...input,
    checkSelectionReason:
      'Replace the mutating check with a read-only assertion on its reviewed result.',
    checks: [
      {
        executable: process.execPath,
        args: [
          '-e',
          "require('node:assert').equal(require('node:fs').readFileSync('source.txt','utf8'),'verified mutation\\n')",
        ],
        cwd: '.',
      },
    ],
  });
  assert.equal(final.status, 'completed');
});

test('unselected parent edits stay out of checks, are reported and survive apply', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare();
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await writeFile(join(f.root, 'owner-note.txt'), 'owner edit\n');
  await delegateIntegrationCommand('review', input);
  const applied = await delegateIntegrationCommand('apply', {
    ...input,
    checks: [
      {
        executable: process.execPath,
        args: [
          '-e',
          "require('node:assert').equal(require('node:fs').existsSync('owner-note.txt'),false)",
        ],
        cwd: '.',
      },
    ],
  });
  assert.equal(applied.status, 'completed', JSON.stringify(applied));
  assert.equal(applied.verification.candidateKind, 'prepared-worktree');
  assert.deepEqual(applied.unselectedDirtyPaths, ['owner-note.txt']);
  assert.match(
    applied.report.Checks,
    /did not include 1 unselected local change\(s\): owner-note\.txt/u,
  );
  assert.equal(await readFile(join(f.root, 'owner-note.txt'), 'utf8'), 'owner edit\n');
});

test('a parent edit to a reviewed path blocks apply with its path; unrelated edits do not', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare();
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await delegateIntegrationCommand('review', input);
  await writeFile(join(f.root, 'late-owner.txt'), 'owner save before acceptance\n');
  await writeFile(join(f.root, 'source.txt'), 'owner save on the same line\n');
  const result = await delegateIntegrationCommand('apply', {
    ...input,
    checks: [],
    reviewOnlyReason: 'Exercise the parent apply check.',
  });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(
    result.violations
      .filter(({ code }) => code === 'E_INTEGRATION_SOURCE_DRIFT')
      .map(({ path }) => path),
    ['source.txt'],
  );
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'owner save on the same line\n');
  assert.equal(
    await readFile(join(f.root, 'late-owner.txt'), 'utf8'),
    'owner save before acceptance\n',
  );
});

test('force-added ignored files beside an unrelated tracked edit integrate', async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'cache'));
  await writeFile(join(f.root, 'cache', 'tracked.md'), 'force-added\n');
  await writeFile(join(f.root, 'notes.txt'), 'notes\n');
  execFileSync('git', ['add', '--force', 'cache/tracked.md', 'notes.txt'], { cwd: f.root });
  execFileSync('git', ['commit', '-qm', 'track ignored file'], { cwd: f.root });
  const prepared = await f.prepare();
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await writeFile(join(f.root, 'notes.txt'), 'owner edit\n');
  assert.equal((await delegateIntegrationCommand('review', input)).ready, true);
  const applied = await delegateIntegrationCommand('apply', {
    ...input,
    checks: [
      {
        executable: process.execPath,
        args: [
          '-e',
          "require('node:assert').equal(require('node:fs').readFileSync('cache/tracked.md','utf8'),'force-added\\n')",
        ],
        cwd: '.',
      },
    ],
  });
  assert.equal(applied.status, 'completed', JSON.stringify(applied));
  assert.equal(applied.verification.candidateKind, 'prepared-worktree');
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'implemented\n');
  assert.equal(await readFile(join(f.root, 'notes.txt'), 'utf8'), 'owner edit\n');
});

const passingCheck = [{ executable: process.execPath, args: ['-e', 'process.exit(0)'], cwd: '.' }];

test('a tracked dangling symlink beside an unrelated parent edit integrates', async (t) => {
  const f = await fixture(t);
  await symlink('missing-target', join(f.root, 'dangling'));
  execFileSync('git', ['add', 'dangling'], { cwd: f.root });
  execFileSync('git', ['commit', '-qm', 'dangling link'], { cwd: f.root });
  const prepared = await f.prepare();
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await writeFile(join(f.root, 'owner-note.txt'), 'owner edit\n');
  assert.equal((await delegateIntegrationCommand('review', input)).ready, true);
  const applied = await delegateIntegrationCommand('apply', { ...input, checks: passingCheck });
  assert.equal(applied.status, 'completed', JSON.stringify(applied));
  assert.equal(fs.readlinkSync(join(f.root, 'dangling')), 'missing-target');
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'implemented\n');
});

test('a submodule beside an unrelated parent edit integrates and a gitlink change blocks', async (t) => {
  const f = await fixture(t);
  const commit = (ref) =>
    execFileSync('git', ['rev-parse', ref], { cwd: f.root, encoding: 'utf8' }).trim();
  const first = commit('HEAD');
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'second'], { cwd: f.root });
  execFileSync('git', ['update-index', '--add', '--cacheinfo', `160000,${first},vendor/lib`], {
    cwd: f.root,
  });
  await mkdir(join(f.root, 'vendor', 'lib'), { recursive: true });
  execFileSync('git', ['commit', '-qm', 'uninitialised submodule'], { cwd: f.root });
  const prepared = await f.prepare({ scopePaths: ['source.txt', 'vendor'] });
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await writeFile(join(f.root, 'owner-note.txt'), 'owner edit\n');
  assert.equal((await delegateIntegrationCommand('review', input)).ready, true);
  const applied = await delegateIntegrationCommand('apply', { ...input, checks: passingCheck });
  assert.equal(applied.status, 'completed', JSON.stringify(applied));
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'implemented\n');

  const second = await f.prepare({ scopePaths: ['source.txt', 'vendor'] });
  const next = { runId: second.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(next);
  const worktree = second.record.worktreePath;
  execFileSync('git', ['update-index', '--cacheinfo', `160000,${commit('HEAD~1')},vendor/lib`], {
    cwd: worktree,
  });
  execFileSync(
    'git',
    ['-c', 'user.name=Delegate', '-c', 'user.email=d@example.test', 'commit', '-qm', 'bump'],
    { cwd: worktree },
  );
  const review = await delegateIntegrationCommand('review', next);
  assert.equal(review.ready, false);
  assert.deepEqual(
    review.violations.filter(({ code }) => code === 'E_INTEGRATION_GITLINK'),
    [{ code: 'E_INTEGRATION_GITLINK', path: 'vendor/lib' }],
  );
});

for (const hidden of ['gitmodules', 'config', 'diff'])
  test(`a gitlink change hidden by ${hidden} ignore settings still blocks`, async (t) => {
    const f = await fixture(t);
    const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    const first = git(f.root, 'rev-parse', 'HEAD');
    git(f.root, 'commit', '--allow-empty', '-qm', 'second');
    git(f.root, 'update-index', '--add', '--cacheinfo', `160000,${first},vendor/lib`);
    await writeFile(
      join(f.root, '.gitmodules'),
      `[submodule "vendor/lib"]\n\tpath = vendor/lib\n\turl = ./lib\n${hidden === 'gitmodules' ? '\tignore = all\n' : ''}`,
    );
    git(f.root, 'add', '.gitmodules');
    await mkdir(join(f.root, 'vendor', 'lib'), { recursive: true });
    git(f.root, 'commit', '-qm', 'submodule');
    if (hidden === 'config') git(f.root, 'config', 'submodule.vendor/lib.ignore', 'all');
    if (hidden === 'diff') git(f.root, 'config', 'diff.ignoreSubmodules', 'all');
    const second = git(f.root, 'rev-parse', 'HEAD~1');
    for (const change of ['commit', 'checkout']) {
      const prepared = await f.prepare({ scopePaths: ['source.txt', 'vendor'] });
      const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
      await dispatchDelegateRun(input);
      const worktree = prepared.record.worktreePath;
      if (change === 'commit') {
        git(worktree, 'update-index', '--cacheinfo', `160000,${second},vendor/lib`);
        git(
          worktree,
          '-c',
          'user.name=Delegate',
          '-c',
          'user.email=d@example.test',
          'commit',
          '-qm',
          'bump',
        );
      } else {
        git(worktree, 'clone', '-q', f.root, 'vendor/lib');
        git(join(worktree, 'vendor', 'lib'), 'checkout', '-q', '--detach', second);
      }
      const review = await delegateIntegrationCommand('review', input);
      assert.equal(review.ready, false, `${change}: ${JSON.stringify(review)}`);
      assert.deepEqual(
        review.violations.filter(({ code }) => code === 'E_INTEGRATION_GITLINK'),
        [{ code: 'E_INTEGRATION_GITLINK', path: 'vendor/lib' }],
        change,
      );
    }
  });

test('a parent edit elsewhere in a file the delegate changed merges on apply', async (t) => {
  const f = await fixture(t);
  const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
  await writeFile(join(f.root, 'notes.md'), `${lines.join('\n')}\n`);
  execFileSync('git', ['add', 'notes.md'], { cwd: f.root });
  execFileSync('git', ['commit', '-qm', 'notes'], { cwd: f.root });
  const prepared = await f.prepare({ scopePaths: ['source.txt', 'notes.md'] });
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  const edit = (first, last) => `${[first, ...lines.slice(1, -1), last].join('\n')}\n`;
  await writeFile(
    join(prepared.record.worktreePath, 'notes.md'),
    edit('delegate line 1', 'line 12'),
  );
  await writeFile(join(f.root, 'notes.md'), edit('line 1', 'owner line 12'));
  assert.equal((await delegateIntegrationCommand('review', input)).ready, true);
  const applied = await delegateIntegrationCommand('apply', { ...input, checks: passingCheck });
  assert.equal(applied.status, 'completed', JSON.stringify(applied));
  assert.equal(
    await readFile(join(f.root, 'notes.md'), 'utf8'),
    edit('delegate line 1', 'owner line 12'),
  );
});

async function interruptedApply(t, { notes, delegateNotes, ownerNotes, mode } = {}) {
  const f = await fixture(t);
  await writeFile(join(f.root, 'notes.md'), notes);
  if (mode) await chmod(join(f.root, 'notes.md'), mode);
  execFileSync('git', ['add', 'notes.md'], { cwd: f.root });
  execFileSync('git', ['commit', '-qm', 'notes'], { cwd: f.root });
  const prepared = await f.prepare({
    scopePaths: ['source.txt', 'notes.md'],
    retainWorktree: true,
  });
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  const delegated = join(prepared.record.worktreePath, 'notes.md');
  if (typeof delegateNotes === 'function') await delegateNotes(delegated);
  else await writeFile(delegated, delegateNotes);
  if (ownerNotes) await writeFile(join(f.root, 'notes.md'), ownerNotes);
  await delegateIntegrationCommand('review', input);
  const applied = await delegateIntegrationCommand('apply', { ...input, checks: passingCheck });
  assert.equal(applied.status, 'completed', JSON.stringify(applied));
  // Model the durable state a crash leaves between the apply check and acceptance.
  const closed = await readRunRecord(prepared.runId, { directory: f.runDirectory });
  const { at: _at, states: _states, ...accepted } = closed.integration;
  execFileSync('git', ['update-ref', accepted.restoreRef, accepted.restore], { cwd: f.root });
  await updateRunRecord(
    prepared.runId,
    {
      status: 'completed',
      disposition: null,
      closedAt: null,
      integration: { ...accepted, status: 'applying' },
    },
    { directory: f.runDirectory },
  );
  return { f, input, accepted };
}

const LINES = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
const lines = (first, last) => `${[first, ...LINES.slice(1, -1), last].join('\n')}\n`;

for (const crash of ['before-apply', 'after-apply', 'partial', 'edited-after-apply'])
  test(`an apply interrupted ${crash} recovers without losing owner edits`, async (t) => {
    const owner = lines('line 1', 'owner line 12');
    const merged = lines('delegate line 1', 'owner line 12');
    const { f, input, accepted } = await interruptedApply(t, {
      notes: lines('line 1', 'line 12'),
      delegateNotes: lines('delegate line 1', 'line 12'),
      ownerNotes: owner,
    });
    assert.equal(await readFile(join(f.root, 'notes.md'), 'utf8'), merged);
    if (crash === 'before-apply')
      execFileSync('git', ['apply', '-R', accepted.patchPath], { cwd: f.root });
    if (crash === 'partial') await writeFile(join(f.root, 'notes.md'), owner);
    if (crash === 'edited-after-apply')
      await writeFile(join(f.root, 'source.txt'), 'owner edit after the crash\n');
    if (crash === 'after-apply') {
      const recovered = await delegateIntegrationCommand('recover', {
        ...input,
        resolution: 'accept',
      });
      assert.equal(recovered.recovered, 'accepted');
      const record = await readRunRecord(input.runId, { directory: f.runDirectory });
      assert.equal(record.disposition, 'integrated');
      assert.equal(record.integration.verified, true);
      assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'implemented\n');
      assert.equal(await readFile(join(f.root, 'notes.md'), 'utf8'), merged);
    } else if (crash === 'edited-after-apply') {
      const recovered = await delegateIntegrationCommand('recover', input);
      assert.equal(recovered.recovered, 'conflicts');
      assert.deepEqual(
        recovered.rollbackErrors.map(({ path }) => path),
        ['source.txt'],
      );
      assert.equal(
        await readFile(join(f.root, 'source.txt'), 'utf8'),
        'owner edit after the crash\n',
      );
      assert.equal(await readFile(join(f.root, 'notes.md'), 'utf8'), owner);
      return;
    } else {
      await assert.rejects(
        delegateIntegrationCommand('recover', { ...input, resolution: 'accept' }),
        { code: 'E_INTEGRATION_RECOVERY_INCOMPLETE' },
      );
      const recovered = await delegateIntegrationCommand('recover', input);
      assert.equal(recovered.recovered, 'rolled-back');
      assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'base\n');
      assert.equal(await readFile(join(f.root, 'notes.md'), 'utf8'), owner);
      const retried = await delegateIntegrationCommand('apply', { ...input, checks: passingCheck });
      assert.equal(retried.status, 'completed', JSON.stringify(retried));
      assert.equal(await readFile(join(f.root, 'notes.md'), 'utf8'), merged);
    }
    assert.equal(
      execFileSync('git', ['for-each-ref', accepted.restoreRef], { cwd: f.root, encoding: 'utf8' }),
      '',
    );
  });

test('recover leaves an unapplied path alone when the patch also reverses cleanly', async (t) => {
  const block = (value) => ['l9', value, 'l11'];
  const notes = `${[...LINES.slice(0, 8), ...block('l10'), 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'end'].join('\n')}\n`;
  // The owner pasted the post-image lower in the file, so the reverse hunk also matches there.
  const owner = `${notes}${['line 7', 'line 8', ...block('CHANGED'), 'm1', 'm2'].join('\n')}\n`;
  const { f, input, accepted } = await interruptedApply(t, {
    notes,
    delegateNotes: notes.replace('\nl10\n', '\nCHANGED\n'),
    ownerNotes: owner,
  });
  // source.txt stays applied and notes.md returns to its pre-image, so the whole patch reverses.
  await writeFile(join(f.root, 'notes.md'), owner);
  execFileSync('git', ['apply', '--check', '-R', accepted.patchPath], { cwd: f.root });
  await assert.rejects(delegateIntegrationCommand('recover', { ...input, resolution: 'accept' }), {
    code: 'E_INTEGRATION_RECOVERY_INCOMPLETE',
  });
  const recovered = await delegateIntegrationCommand('recover', input);
  assert.equal(recovered.recovered, 'rolled-back', JSON.stringify(recovered));
  assert.equal(await readFile(join(f.root, 'notes.md'), 'utf8'), owner);
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'base\n');
});

for (const resolution of ['rollback', 'accept'])
  test(`recover ${resolution} keeps a private file's permissions`, async (t) => {
    const { f, input } = await interruptedApply(t, {
      notes: 'secret\n',
      delegateNotes: 'rotated secret\n',
      mode: 0o600,
    });
    assert.equal((await stat(join(f.root, 'notes.md'))).mode & 0o777, 0o600);
    // A crash between git apply and the permission restore leaves the default mode.
    await chmod(join(f.root, 'notes.md'), 0o644);
    const recovered = await delegateIntegrationCommand('recover', { ...input, resolution });
    assert.equal(recovered.recovered, resolution === 'accept' ? 'accepted' : 'rolled-back');
    assert.equal(
      await readFile(join(f.root, 'notes.md'), 'utf8'),
      resolution === 'accept' ? 'rotated secret\n' : 'secret\n',
    );
    assert.equal((await stat(join(f.root, 'notes.md'))).mode & 0o777, 0o600);
  });

for (const [change, delegate] of [
  ['deleted', (path) => rm(path)],
  [
    'replaced by a symlink',
    async (path) => {
      await rm(path);
      await symlink('source.txt', path);
    },
  ],
])
  test(`recover rollback keeps the permissions of a private file the delegate ${change}`, async (t) => {
    const { f, input } = await interruptedApply(t, {
      notes: 'secret\n',
      delegateNotes: delegate,
      mode: 0o600,
    });
    const recovered = await delegateIntegrationCommand('recover', input);
    assert.equal(recovered.recovered, 'rolled-back', JSON.stringify(recovered));
    assert.equal(await readFile(join(f.root, 'notes.md'), 'utf8'), 'secret\n');
    assert.equal((await lstat(join(f.root, 'notes.md'))).mode & 0o777, 0o600);
  });

test('a run with no changes completes without a patch or restore point', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare();
  const run = await readRunRecord(prepared.runId, { directory: f.runDirectory });
  const custody = JSON.parse(await readFile(run.custodyPath, 'utf8'));
  assert.equal(custody.runDirectory, await realpath(f.runDirectory));
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await writeFile(join(prepared.record.worktreePath, 'source.txt'), 'base\n');
  const review = await delegateIntegrationCommand('review', input);
  assert.equal(review.ready, true);
  assert.deepEqual(review.changedPaths, []);
  const applied = await delegateIntegrationCommand('apply', { ...input, checks: passingCheck });
  assert.equal(applied.status, 'completed', JSON.stringify(applied));
  const record = await readRunRecord(prepared.runId, { directory: f.runDirectory });
  assert.equal(record.integration.status, 'applied');
  assert.equal(record.integration.restoreRef, null);
  await assert.rejects(stat(join(record.runPath, 'patch.diff')), { code: 'ENOENT' });
  assert.equal(
    execFileSync('git', ['for-each-ref', 'refs/planr-delegate/'], {
      cwd: f.root,
      encoding: 'utf8',
    }),
    '',
  );
});

test('failure evidence is saved without automatic baseline and cannot be erased by zero checks', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare();
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await delegateIntegrationCommand('review', input);
  const failed = await delegateIntegrationCommand('apply', {
    ...input,
    checks: [
      {
        executable: process.execPath,
        args: ['-e', "console.error('bounded failure evidence'); process.exit(1)"],
        cwd: '.',
      },
    ],
  });
  assert.equal(failed.status, 'blocked');
  assert.match(failed.checks[0].diagnostic, /bounded failure/);
  assert.ok(!failed.verification.phases.some((phase) => phase.phase.startsWith('baseline')));
  assert.ok(
    (await readFile(failed.verification.evidencePath, 'utf8')).includes('candidateIdentity'),
  );
  await assert.rejects(
    delegateIntegrationCommand('apply', {
      ...input,
      checks: [],
      reviewOnlyReason: 'Skip failures',
    }),
    { code: 'E_INTEGRATION_CHECKS_REQUIRED' },
  );
});

test('review-only is explicitly unverified and retention keeps the owned worktree', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare({ retainWorktree: true });
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await delegateIntegrationCommand('review', input);
  const applied = await delegateIntegrationCommand('apply', {
    ...input,
    checks: [],
    reviewOnlyReason: 'Text fixture has no applicable automated check.',
  });
  assert.equal(applied.status, 'completed');
  const saved = await readRunRecord(prepared.runId, { directory: f.runDirectory });
  assert.equal(saved.integration.verified, false);
  assert.match(applied.report.Checks, /unconfirmed/);
  assert.equal(
    await readFile(join(prepared.record.worktreePath, 'source.txt'), 'utf8'),
    'implemented\n',
  );
});

test('a verification mutation beside an unrelated parent edit stays in the worktree for re-review', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare();
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await writeFile(join(f.root, 'owner-note.txt'), 'concurrent owner edit\n');
  await delegateIntegrationCommand('review', input);
  const result = await delegateIntegrationCommand('apply', {
    ...input,
    checks: [
      {
        executable: process.execPath,
        args: ['-e', "require('node:fs').writeFileSync('source.txt','review this mutation\\n')"],
        cwd: '.',
      },
    ],
  });
  assert.equal(result.code, 'E_INTEGRATION_REVIEW_DRIFT');
  assert.deepEqual(result.verification.mutatedPaths, ['source.txt']);
  assert.equal(
    await readFile(join(prepared.record.worktreePath, 'source.txt'), 'utf8'),
    'review this mutation\n',
  );
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'base\n');
  await delegateIntegrationCommand('review', input);
  const applied = await delegateIntegrationCommand('apply', {
    ...input,
    checkSelectionReason:
      'The first check rewrote source; assert the re-reviewed content without modifying it.',
    checks: [
      {
        executable: process.execPath,
        args: [
          '-e',
          "require('node:assert').equal(require('node:fs').readFileSync('source.txt','utf8'),'review this mutation\\n')",
        ],
        cwd: '.',
      },
    ],
  });
  assert.equal(applied.status, 'completed');
  assert.equal(await readFile(join(f.root, 'owner-note.txt'), 'utf8'), 'concurrent owner edit\n');
});

test('a candidate edit after selection blocks checks and integration while retaining the owner save', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare();
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  const custody = JSON.parse(await readFile(prepared.record.custodyPath, 'utf8'));
  const run = await readRunRecord(prepared.runId, { directory: f.runDirectory });
  let edited = false;
  const result = await integrateBranchDelta({
    custody,
    run,
    scopePaths: ['source.txt'],
    checks: [
      {
        executable: process.execPath,
        args: ['-e', "require('node:fs').writeFileSync('check-started','yes')"],
        cwd: '.',
      },
    ],
    onVerification: async (evidence) => {
      if (
        !edited &&
        evidence.phases.some((phase) => phase.phase === 'candidate-selection' && phase.finishedAt)
      ) {
        edited = true;
        await writeFile(join(prepared.record.worktreePath, 'source.txt'), 'owner candidate save\n');
      }
    },
  });
  assert.equal(result.code, 'E_INTEGRATION_CANDIDATE_STALE');
  assert.deepEqual(
    result.violations.filter(({ code }) => code === 'E_INTEGRATION_CANDIDATE_STALE'),
    [{ code: 'E_INTEGRATION_CANDIDATE_STALE', path: 'source.txt', change: 'changed' }],
  );
  assert.equal(result.checks.length, 0);
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'base\n');
  assert.equal(
    await readFile(join(prepared.record.worktreePath, 'source.txt'), 'utf8'),
    'owner candidate save\n',
  );
  await assert.rejects(readFile(join(prepared.record.worktreePath, 'check-started')), {
    code: 'ENOENT',
  });
});

test('independent preparation and checks can use a directory introduced by the delegate', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare({ scopePaths: ['source.txt', 'new-package'] });
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await mkdir(join(prepared.record.worktreePath, 'new-package'));
  await writeFile(join(prepared.record.worktreePath, 'new-package/value.txt'), 'new package\n');
  await delegateIntegrationCommand('review', input);
  const result = await delegateIntegrationCommand('apply', {
    ...input,
    preparation: [
      {
        executable: process.execPath,
        args: ['-e', "require('node:fs').accessSync('value.txt')"],
        cwd: 'new-package',
      },
    ],
    checks: [
      {
        executable: process.execPath,
        args: [
          '-e',
          "require('node:assert').equal(require('node:fs').readFileSync('value.txt','utf8'),'new package\\n')",
        ],
        cwd: 'new-package',
      },
    ],
  });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.checks[0].cwd, 'new-package');
  assert.equal(await readFile(join(f.root, 'new-package/value.txt'), 'utf8'), 'new package\n');
});

test('malformed native events retain the already observed exact session', async (t) => {
  const f = await fixture(t, 'codex', 'malformed');
  const prepared = await f.prepare();
  const failed = await dispatchDelegateRun({
    runId: prepared.runId,
    runDirectory: f.runDirectory,
    env: f.env,
  });
  assert.equal(failed.status, 'blocked');
  assert.equal(failed.record.backendSessionId, 'native-session');
});

test('explicit model and configuration override named and saved defaults without profile writes', async (t) => {
  const f = await fixture(t);
  await enrollProfile(
    { ...f.profile, argv: ['--model', 'model-A'] },
    { directory: f.profileDirectory },
  );
  const path = join(f.profileDirectory, `${f.profile.name}.json`);
  const before = await readFile(path, 'utf8');
  const configDir = join(f.base, 'alternate-config');
  await mkdir(configDir);
  await saveEngineChoice('codex', { directory: f.profileDirectory, profile: f.profile.name });
  for (const choice of [f.profile.name, undefined]) {
    const selection = await prepareProfile(choice, {
      model: 'model-B',
      configDir,
      directory: f.profileDirectory,
      cwd: f.root,
      env: f.env,
    });
    assert.deepEqual(selection.profile.argv, ['--model', 'model-B']);
    assert.equal(selection.profile.configDir, configDir);
    assert.equal(await readFile(path, 'utf8'), before);
  }
});

test('explicit Claude configuration governs preview, execution and exact continuation', async (t) => {
  const f = await fixture(t, 'claude');
  const defaultConfig = join(f.base, '.claude');
  const alternate = join(f.base, 'alternate-claude');
  for (const [directory, origin] of [
    [defaultConfig, 'https://default.example.test'],
    [alternate, 'https://alternate.example.test'],
  ]) {
    await mkdir(directory);
    await writeFile(
      join(directory, 'settings.json'),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: origin } }),
    );
  }
  const env = { ...f.env, CLAUDE_CONFIG_DIR: alternate };
  delete env.ANTHROPIC_BASE_URL;
  for (const [configDir, expected, origin] of [
    [defaultConfig, defaultConfig, 'https://default.example.test'],
    [alternate, alternate, 'https://alternate.example.test'],
    [undefined, alternate, 'https://alternate.example.test'],
  ]) {
    const prepared = await f.prepare({ env, ...(configDir ? { configDir } : {}) });
    assert.equal(prepared.preview.destination.origin, origin);
    const input = { runId: prepared.runId, runDirectory: f.runDirectory, env };
    assert.equal((await dispatchDelegateRun(input)).status, 'completed');
    assert.equal(
      (await resumeDelegateRun({ ...input, correction: 'Correct source.txt.' })).status,
      'completed',
    );
    const calls = (await readFile(join(prepared.record.worktreePath, 'invocations.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.deepEqual(
      calls.map((call) => call.configuration),
      [expected, expected],
    );
  }
  assert.equal(env.CLAUDE_CONFIG_DIR, alternate);
});

test('normal check completion stops background writers and timeout retains bounded diagnostic', async (t) => {
  const f = await fixture(t);
  const writer = "setTimeout(()=>require('node:fs').writeFileSync('late.txt','late'),700)";
  let owned;
  const results = await runDelegateChecks({
    repositoryRoot: f.root,
    checks: [
      {
        command: process.execPath,
        args: [
          '-e',
          `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(writer)}],{stdio:'ignore'}).unref();`,
        ],
        cwd: '.',
      },
    ],
    onProcess: (identity) => {
      if (identity) owned = identity;
    },
  });
  assert.equal(results[0].status, 'passed');
  assert.ok(owned?.pgid);
  await new Promise((resolve) => setTimeout(resolve, 750));
  await assert.rejects(readFile(join(f.root, 'late.txt')), { code: 'ENOENT' });
  const timed = await runDelegateChecks({
    repositoryRoot: f.root,
    checks: [
      {
        command: process.execPath,
        args: ['-e', "console.error('actionable fixture error'); setInterval(()=>{},1000)"],
        cwd: '.',
        timeoutMs: 250,
      },
    ],
  });
  assert.equal(timed[0].status, 'timed-out');
  assert.match(timed[0].diagnostic, /actionable fixture error/);
});

test('an owner save between the apply check and git apply is kept and the run returns to review', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare();
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  const record = await readRunRecord(prepared.runId, { directory: f.runDirectory });
  const custody = JSON.parse(await readFile(record.custodyPath, 'utf8'));
  let rolledBack;
  const result = await integrateBranchDelta({
    custody,
    run: record,
    scopePaths: ['source.txt'],
    checks: [],
    reviewOnlyReason: 'Exercise destination concurrency.',
    patchPath: join(record.runPath, 'patch.diff'),
    onApplying: async () => {
      await writeFile(join(f.root, 'source.txt'), 'owner save during apply\n');
    },
    onRolledBack: async (state) => {
      rolledBack = state;
    },
  });
  assert.equal(result.code, 'E_INTEGRATION_SOURCE_DRIFT', JSON.stringify(result));
  assert.deepEqual(rolledBack, { rollbackErrors: [], code: 'E_INTEGRATION_SOURCE_DRIFT' });
  assert.ok(
    result.violations.some(
      ({ code, path }) => code === 'E_INTEGRATION_SOURCE_DRIFT' && path === 'source.txt',
    ),
  );
  assert.doesNotMatch(result.nextAction, /recover/u);
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'owner save during apply\n');
  assert.equal(
    execFileSync('git', ['for-each-ref', 'refs/planr-delegate/'], {
      cwd: f.root,
      encoding: 'utf8',
    }),
    '',
  );
});

for (const failed of [true, false])
  test(`the worktree retains ${failed ? 'failed' : 'undeclared'} generator output for inspection`, async (t) => {
    const f = await fixture(t);
    const pkg = 'packages/fixture';
    await mkdir(join(f.root, pkg), { recursive: true });
    await writeFile(
      join(f.root, pkg, 'package.json'),
      JSON.stringify({ scripts: { generate: 'node generate.mjs' } }),
    );
    await writeFile(
      join(f.root, pkg, 'generate.mjs'),
      `import {writeFileSync} from 'node:fs'; writeFileSync('generated.txt','inspect generated mutation\\n'); ${failed ? 'process.exit(1)' : "writeFileSync('undeclared.txt','inspect undeclared mutation')"};`,
    );
    await writeFile(join(f.root, pkg, 'input.txt'), 'original\n');
    await writeFile(join(f.root, pkg, 'generated.txt'), 'original\n');
    execFileSync('git', ['add', '.'], { cwd: f.root });
    execFileSync('git', ['commit', '-qm', 'generator fixture'], { cwd: f.root });
    const prepared = await f.prepare({ scopePaths: ['source.txt', pkg] });
    const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
    await dispatchDelegateRun(input);
    await writeFile(join(prepared.record.worktreePath, pkg, 'input.txt'), 'delegate input\n');
    await writeFile(join(f.root, 'owner-note.txt'), 'owner concurrent note\n');
    await delegateIntegrationCommand('review', input);
    const result = await delegateIntegrationCommand('apply', {
      ...input,
      checks: [],
      reviewOnlyReason: 'Inspect generator behavior.',
      generators: [{ packagePath: pkg, script: 'generate', outputPaths: [`${pkg}/generated.txt`] }],
    });
    assert.equal(
      result.code,
      failed ? 'E_INTEGRATION_GENERATION' : 'E_INTEGRATION_GENERATOR_SCOPE',
    );
    assert.equal(result.verification.candidateKind, 'prepared-worktree');
    assert.ok(result.verification.mutatedPaths.includes(`${pkg}/generated.txt`));
    assert.match(
      await readFile(join(prepared.record.worktreePath, pkg, 'generated.txt'), 'utf8'),
      /inspect generated mutation/,
    );
    assert.equal(await readFile(join(f.root, pkg, 'generated.txt'), 'utf8'), 'original\n');
  });

for (const operation of ['prepare-worktree', 'dispatch'])
  test(`${operation} recovers an orphan preparation writer before retry`, async (t) => {
    const f = await fixture(t);
    const prepared = await f.prepare();
    const child = spawn(
      process.execPath,
      ['-e', "setTimeout(()=>require('node:fs').writeFileSync('late.txt','late'),700)"],
      { cwd: prepared.record.worktreePath, detached: true, stdio: 'ignore' },
    );
    await new Promise((resolve) => child.once('spawn', resolve));
    const identity = { ...(await processIdentity(child.pid)), pgid: child.pid };
    await updateRunRecord(
      prepared.runId,
      {
        preparationProcess: identity,
        preparationHost: { pid: 2147483000, started: 'exited-fixture', source: 'ps-start-time' },
      },
      { directory: f.runDirectory },
    );
    const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
    const result =
      operation === 'dispatch'
        ? await dispatchDelegateRun(input)
        : await delegateRunnerCommand(operation, { ...input, commands: [] });
    assert.equal(result.status, operation === 'dispatch' ? 'completed' : 'passed');
    await new Promise((resolve) => setTimeout(resolve, 750));
    await assert.rejects(readFile(join(prepared.record.worktreePath, 'late.txt')), {
      code: 'ENOENT',
    });
  });

test('failed group termination retains command custody and stops subsequent checks', async (t) => {
  const f = await fixture(t);
  const originalKill = process.kill;
  let identity;
  const events = [];
  process.kill = (pid, signal) => {
    if (identity && pid === -identity.pgid)
      throw Object.assign(new Error('fixture group permission denial'), { code: 'EPERM' });
    return originalKill(pid, signal);
  };
  let results;
  try {
    const child = 'setTimeout(()=>{},5000)';
    results = await runDelegateChecks({
      repositoryRoot: f.root,
      checks: [
        {
          command: process.execPath,
          args: [
            '-e',
            `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore'}).unref();`,
          ],
          cwd: '.',
        },
        {
          command: process.execPath,
          args: ['-e', "require('node:fs').writeFileSync('should-not-run.txt','bad')"],
          cwd: '.',
        },
      ],
      onProcess: (value) => {
        events.push(value);
        if (value) identity = value;
      },
    });
  } finally {
    process.kill = originalKill;
    if (identity) await terminateProcessGroup(identity);
  }
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'failed');
  assert.equal(results[0].processTerminationConfirmed, false);
  assert.ok(identity?.pgid);
  assert.ok(!events.includes(null));
  await assert.rejects(readFile(join(f.root, 'should-not-run.txt')), { code: 'ENOENT' });
});

test('failed native termination retains custody and blocks resume until recovery stops the exact group', async (t) => {
  const f = await fixture(t, 'codex', 'survivor');
  const prepared = await f.prepare();
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  const originalKill = process.kill;
  let identity;
  process.kill = (pid, signal) => {
    if (pid < 0)
      throw Object.assign(new Error('fixture native termination denial'), { code: 'EPERM' });
    return originalKill(pid, signal);
  };
  try {
    const failed = await dispatchDelegateRun(input);
    assert.equal(failed.status, 'blocked');
    const record = await readRunRecord(prepared.runId, { directory: f.runDirectory });
    identity = record.delegateProcess;
    assert.ok(identity?.pgid);
    assert.equal(record.delegateTerminationConfirmed, false);
    await assert.rejects(resumeDelegateRun({ ...input, correction: 'Continue the task.' }), {
      code: 'EPERM',
    });
    await assert.rejects(delegateIntegrationCommand('review', input), { code: 'EPERM' });
    assert.deepEqual(
      (await readRunRecord(prepared.runId, { directory: f.runDirectory })).delegateProcess,
      identity,
    );
  } finally {
    process.kill = originalKill;
    if (identity) await terminateProcessGroup(identity);
  }
  const recovered = await delegateRunnerCommand('recover', input);
  assert.equal(recovered.status, 'blocked');
  const record = await readRunRecord(prepared.runId, { directory: f.runDirectory });
  assert.equal(record.delegateProcess, null);
  assert.equal(record.delegateTerminationConfirmed, true);
  await f.setMode('');
  const resumed = await resumeDelegateRun({
    ...input,
    env: f.env,
    correction: 'Continue the same task after native process recovery.',
  });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.record.backendSessionId, record.backendSessionId);
});

test('automatic cleanup retains an owned worktree edited after acceptance', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare({ retainWorktree: true });
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await delegateIntegrationCommand('review', input);
  const accepted = await delegateIntegrationCommand('apply', {
    ...input,
    checks: [{ executable: process.execPath, args: ['-e', 'process.exit(0)'], cwd: '.' }],
  });
  assert.equal(accepted.status, 'completed');
  await writeFile(join(prepared.record.worktreePath, 'source.txt'), 'owner post-acceptance save\n');
  const record = await readRunRecord(prepared.runId, { directory: f.runDirectory });
  await assert.rejects(cleanupAcceptedWorktree(record, f.runDirectory), {
    code: 'E_DELEGATE_CLEANUP_DRIFT',
  });
  assert.equal(
    await readFile(join(prepared.record.worktreePath, 'source.txt'), 'utf8'),
    'owner post-acceptance save\n',
  );
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'implemented\n');
});

test('cleanup retains an owner save made during the final ownership read', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare({ retainWorktree: true });
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await delegateIntegrationCommand('review', input);
  assert.equal(
    (
      await delegateIntegrationCommand('apply', {
        ...input,
        checks: [{ executable: process.execPath, args: ['-e', 'process.exit(0)'], cwd: '.' }],
      })
    ).status,
    'completed',
  );
  const record = await readRunRecord(prepared.runId, { directory: f.runDirectory });
  const originalRead = fs.promises.readFile;
  let saved = false;
  fs.promises.readFile = async (path, ...args) => {
    const value = await originalRead(path, ...args);
    if (String(path).endsWith('/ownership.json') && !saved) {
      saved = true;
      await writeFile(join(record.worktreePath, 'source.txt'), 'owner save during cleanup\n');
    }
    return value;
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(cleanupAcceptedWorktree(record, f.runDirectory), {
      code: 'E_DELEGATE_CLEANUP_DRIFT',
    });
  } finally {
    fs.promises.readFile = originalRead;
    syncBuiltinESMExports();
  }
  assert.equal(saved, true);
  assert.equal(
    await readFile(join(record.worktreePath, 'source.txt'), 'utf8'),
    'owner save during cleanup\n',
  );
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'implemented\n');
});

test('native cleanup unregisters an accepted worktree already missing from disk', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare({ retainWorktree: true });
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await delegateIntegrationCommand('review', input);
  assert.equal(
    (
      await delegateIntegrationCommand('apply', {
        ...input,
        checks: [{ executable: process.execPath, args: ['-e', 'process.exit(0)'], cwd: '.' }],
      })
    ).status,
    'completed',
  );
  const record = await readRunRecord(prepared.runId, { directory: f.runDirectory });
  await rm(record.worktreePath, { recursive: true });
  const result = await cleanupAcceptedWorktree(record, f.runDirectory);
  assert.equal(result.status, 'removed');
  const registered = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: f.root,
    encoding: 'utf8',
  });
  assert.equal(registered.includes(record.worktreePath), false);
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'implemented\n');
});
