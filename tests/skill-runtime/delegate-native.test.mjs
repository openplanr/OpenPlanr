import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveCodexDestination } from '../../skills/planr-delegate/scripts/adapters/codex.mjs';
import { terminateProcessGroup } from '../../skills/planr-delegate/scripts/adapters/generic.mjs';
import { failureCode, nativeTurn } from '../../skills/planr-delegate/scripts/adapters/native.mjs';
import { captureFileState } from '../../skills/planr-delegate/scripts/custody.mjs';
import {
  delegateIntegrationCommand,
  integrateDelegateDelta,
} from '../../skills/planr-delegate/scripts/integrate.mjs';
import {
  resolveSelectedChecks,
  runDelegateChecks,
} from '../../skills/planr-delegate/scripts/integration-checks.mjs';
import {
  retainedEntryState,
  rollbackWritten,
} from '../../skills/planr-delegate/scripts/integration-files.mjs';
import {
  enrollProfile,
  loadProfile,
  nativeReadiness,
  prepareProfile,
  saveEngineChoice,
} from '../../skills/planr-delegate/scripts/profiles.mjs';
import { cleanupAcceptedWorktree } from '../../skills/planr-delegate/scripts/run-lifecycle.mjs';
import {
  processIdentity,
  readRunRecord,
  updateRunRecord,
} from '../../skills/planr-delegate/scripts/run-record.mjs';
import {
  delegateRunnerCommand,
  delegateRunStatus,
  dispatchDelegateRun,
  prepareDelegateRun,
  resumeDelegateRun,
} from '../../skills/planr-delegate/scripts/runner.mjs';

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
  await writeFile(
    executable,
    `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),kind=${JSON.stringify(kind)},mode=process.env.FIXTURE_MODE;
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
 if(mode==='readonly-command'||mode==='readonly-summary') {
  if(mode==='readonly-command')emit({type:'item.completed',item:{type:'command_execution',command:'write source.txt',aggregated_output:'Read-only file system',exit_code:1}});
  emit({type:'item.completed',item:{type:'agent_message',text:mode==='readonly-summary'?'Implementation is blocked by read-only access.':'Native turn finished.'}});
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
 if(kind==='codex') { if(mode!=='no-summary')emit({type:'item.completed',item:{type:'agent_message',text:'Plain native summary.'}});emit({type:'turn.completed',usage:{input_tokens:10,output_tokens:3}}); }
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
    FIXTURE_MODE: mode,
    TRUSTED_EXTENSION: 'trusted-value',
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
  return { base, root, bin, executable, env, profile, profileDirectory, runDirectory, prepare };
}

for (const kind of ['claude', 'codex', 'cursor']) {
  test(`${kind}: fresh native onboarding, complete ignored context, plain completion, exact continuation and owned cleanup`, async (t) => {
    const f = await fixture(t, kind);
    const prepared = await f.prepare();
    const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
    assert.equal(prepared.record.schemaVersion, '2.0.0');
    assert.equal(prepared.preview.modelSelection, 'native default/automatic');
    assert.equal(prepared.preview.destination.class, 'native-managed');
    assert.match(prepared.preview.executionPolicy.extensions, /hooks, plugins and MCP/);
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
    assert.equal(calls[0].extension, 'trusted-value');
    assert.match(calls[0].input, /ordered|INDEX|index/i);
    assert.ok(!calls[1].input.includes('capsule.json'), 'resume does not resend full context');
    for (const call of calls)
      assert.ok(
        !call.args.some((arg) =>
          /force|yolo|bypass|sandbox|permission-mode|disallowedTools|strict-mcp|restricted|setting-sources|web_search/u.test(
            arg,
          ),
        ),
      );
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
    env: f.env,
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
  const resumed = await resumeDelegateRun({
    ...input,
    env: { ...f.env, FIXTURE_MODE: '' },
    correction: 'Native approval is resolved; continue the task.',
  });
  assert.equal(resumed.status, 'completed');
  assert.ok(denied.record.backendSessionId);
  assert.equal(resumed.record.backendSessionId, denied.record.backendSessionId);
});

for (const mode of ['readonly-command', 'readonly-summary']) {
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
    const resumed = await resumeDelegateRun({
      ...input,
      env: { ...f.env, FIXTURE_MODE: '' },
      correction: 'Native approval is resolved; implement the same task.',
    });
    assert.equal(resumed.status, 'completed');
    assert.ok(denied.record.backendSessionId);
    assert.equal(resumed.record.backendSessionId, denied.record.backendSessionId);
  });
}

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
    timeoutMs: 200,
  });
  assert.equal(timed.status, 'blocked');
  assert.equal(timed.record.diagnostic.code, 'E_DELEGATE_TIMEOUT');
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

test('stale prepared worktree checks the actual merged candidate and preserves unrelated source edits', async (t) => {
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
          "require('node:assert').equal(require('node:fs').readFileSync('owner-note.txt','utf8'),'owner edit\\n')",
        ],
        cwd: '.',
      },
    ],
  });
  assert.equal(applied.status, 'completed', JSON.stringify(applied));
  assert.equal(applied.verification.candidateKind, 'fresh-candidate');
  assert.equal(await readFile(join(f.root, 'owner-note.txt'), 'utf8'), 'owner edit\n');
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

test('fresh-candidate verification mutation returns to owned worktree for re-review without changing the source', async (t) => {
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
  assert.equal(result.verification.candidateKind, 'fresh-candidate');
  assert.equal(result.verification.mutationsReturnedToWorktree, true);
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
  const result = await integrateDelegateDelta({
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

test('fresh-candidate mutation return cannot overwrite an owner edit between per-file writes', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'z-other.txt'), 'other base\n');
  execFileSync('git', ['add', 'z-other.txt'], { cwd: f.root });
  execFileSync('git', ['commit', '-qm', 'second fixture file'], { cwd: f.root });
  const prepared = await f.prepare({ scopePaths: ['source.txt', 'z-other.txt'] });
  const input = { runId: prepared.runId, runDirectory: f.runDirectory, env: f.env };
  await dispatchDelegateRun(input);
  await writeFile(join(f.root, 'owner-note.txt'), 'source owner edit\n');
  await delegateIntegrationCommand('review', input);
  const rename = fs.renameSync;
  t.after(() => {
    fs.renameSync = rename;
    syncBuiltinESMExports();
  });
  fs.renameSync = (from, to) => {
    rename(from, to);
    if (from === join(prepared.record.worktreePath, 'source.txt'))
      fs.writeFileSync(join(prepared.record.worktreePath, 'z-other.txt'), 'owner worktree save\n');
  };
  syncBuiltinESMExports();
  const result = await delegateIntegrationCommand('apply', {
    ...input,
    checks: [
      {
        executable: process.execPath,
        args: [
          '-e',
          "const fs=require('node:fs'); fs.writeFileSync('source.txt','mutation'); fs.writeFileSync('z-other.txt','other mutation')",
        ],
        cwd: '.',
      },
    ],
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.verification.retainedCandidate, true);
  assert.equal(
    await readFile(join(prepared.record.worktreePath, 'z-other.txt'), 'utf8'),
    'owner worktree save\n',
  );
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'base\n');
  assert.equal(await readFile(join(f.root, 'z-other.txt'), 'utf8'), 'other base\n');
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

test('an owner save during journal persistence cannot be overwritten by apply or rollback', async (t) => {
  const f = await fixture(t);
  const prepared = await f.prepare();
  await dispatchDelegateRun({ runId: prepared.runId, runDirectory: f.runDirectory, env: f.env });
  const record = await readRunRecord(prepared.runId, { directory: f.runDirectory });
  const custody = JSON.parse(await readFile(record.custodyPath, 'utf8'));
  const result = await integrateDelegateDelta({
    custody,
    run: record,
    scopePaths: ['source.txt'],
    checks: [],
    reviewOnlyReason: 'Exercise destination concurrency.',
    onProgress: async (_path, phase) => {
      if (phase === 'before')
        await writeFile(join(f.root, 'source.txt'), 'owner save during journal\n');
    },
  });
  assert.equal(result.code, 'E_INTEGRATION_SOURCE_DRIFT');
  assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'owner save during journal\n');
});

for (const failed of [true, false])
  test(`fresh candidate retains ${failed ? 'failed' : 'undeclared'} generator output for inspection`, async (t) => {
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
    assert.equal(result.verification.candidateKind, 'fresh-candidate');
    assert.ok(result.verification.mutatedPaths.includes(`${pkg}/generated.txt`));
    assert.match(
      await readFile(join(prepared.record.worktreePath, pkg, 'generated.txt'), 'utf8'),
      /inspect generated mutation/,
    );
    assert.equal(await readFile(join(f.root, pkg, 'generated.txt'), 'utf8'), 'original\n');
  });

test('rollback recovers claimed-but-unpublished files and symlinks, including a second interrupted rollback', async (t) => {
  const f = await fixture(t);
  const path = 'source.txt',
    writeId = 'crash-fixture';
  const sourceBefore = await captureFileState(f.root, path);
  const after = { ...sourceBefore, contentBase64: Buffer.from('applied\n').toString('base64') };
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
    cwd: f.root,
    encoding: 'utf8',
  }).trim();
  const file = `${createHash('sha256').update(path).digest('hex')}.before`;
  const custody = join(gitDir, 'planr-delegate-write-custody', writeId);
  await mkdir(custody, { recursive: true, mode: 0o700 });
  const { rename } = await import('node:fs/promises');
  await rename(join(f.root, path), join(custody, file));
  const changes = [{ path, sourceBefore, after, writeId }];
  assert.deepEqual(await rollbackWritten(f.root, changes, 'recover'), []);
  assert.equal(await readFile(join(f.root, path), 'utf8'), 'base\n');
  await writeFile(join(f.root, path), 'applied\n');
  const rollbackCustody = join(gitDir, 'planr-delegate-write-custody', `${writeId}-rollback`);
  await mkdir(rollbackCustody, { recursive: true, mode: 0o700 });
  await rename(join(f.root, path), join(rollbackCustody, file));
  assert.deepEqual(await rollbackWritten(f.root, changes, 'recover-again'), []);
  assert.equal(await readFile(join(f.root, path), 'utf8'), 'base\n');
  const linkPath = 'link',
    linkId = 'link-crash';
  await symlink(path, join(f.root, linkPath));
  const linkBefore = await captureFileState(f.root, linkPath);
  const linkCustody = join(gitDir, 'planr-delegate-write-custody', linkId);
  await mkdir(linkCustody, { recursive: true, mode: 0o700 });
  const linkFile = `${createHash('sha256').update(linkPath).digest('hex')}.before`;
  await rename(join(f.root, linkPath), join(linkCustody, linkFile));
  assert.equal(retainedEntryState(join(linkCustody, linkFile)).target, path);
  assert.deepEqual(
    await rollbackWritten(
      f.root,
      [{ path: linkPath, sourceBefore: linkBefore, after: { kind: 'absent' }, writeId: linkId }],
      'link-recover',
    ),
    [],
  );
  assert.equal((await captureFileState(f.root, linkPath)).target, path);
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
  const resumed = await resumeDelegateRun({
    ...input,
    env: { ...f.env, FIXTURE_MODE: '' },
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

for (const interleaving of ['journal', 'later-write'])
  test(`integration rejects a checkout changed during ${interleaving} without losing owner edits`, async (t) => {
    const f = await fixture(t);
    await writeFile(join(f.root, 'owner-note.txt'), 'owner baseline\n');
    await writeFile(join(f.root, 'z-other.txt'), 'other baseline\n');
    execFileSync('git', ['add', '.'], { cwd: f.root });
    execFileSync('git', ['commit', '-qm', 'additional fixture files'], { cwd: f.root });
    const prepared = await f.prepare({ scopePaths: ['source.txt', 'z-other.txt'] });
    await dispatchDelegateRun({ runId: prepared.runId, runDirectory: f.runDirectory, env: f.env });
    await writeFile(join(prepared.record.worktreePath, 'z-other.txt'), 'other implementation\n');
    const record = await readRunRecord(prepared.runId, { directory: f.runDirectory });
    const custody = JSON.parse(await readFile(record.custodyPath, 'utf8'));
    let accepted = false;
    const result = await integrateDelegateDelta({
      custody,
      run: record,
      scopePaths: ['source.txt', 'z-other.txt'],
      checks: [{ executable: process.execPath, args: ['-e', 'process.exit(0)'], cwd: '.' }],
      beforeApply: async () => {
        if (interleaving === 'journal')
          await writeFile(join(f.root, 'owner-note.txt'), 'owner journal save\n');
      },
      onProgress: async (path, phase) => {
        if (interleaving === 'later-write' && path === 'z-other.txt' && phase === 'before')
          await writeFile(join(f.root, 'source.txt'), 'owner later save\n');
      },
      onAccepted: () => {
        accepted = true;
      },
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.code, 'E_INTEGRATION_SOURCE_DRIFT');
    assert.equal(accepted, false);
    assert.equal(await readFile(join(f.root, 'z-other.txt'), 'utf8'), 'other baseline\n');
    assert.equal(
      await readFile(join(f.root, 'source.txt'), 'utf8'),
      interleaving === 'later-write' ? 'owner later save\n' : 'base\n',
    );
    assert.equal(
      await readFile(join(f.root, 'owner-note.txt'), 'utf8'),
      interleaving === 'journal' ? 'owner journal save\n' : 'owner baseline\n',
    );
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

for (const ownerEdit of [false, true])
  test(`native crash acceptance ${ownerEdit ? 'rejects checkout drift' : 'recovers the tested candidate'}`, async (t) => {
    const f = await fixture(t);
    await writeFile(join(f.root, 'owner-note.txt'), 'owner baseline\n');
    execFileSync('git', ['add', '.'], { cwd: f.root });
    execFileSync('git', ['commit', '-qm', 'additional fixture file'], { cwd: f.root });
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
    const journalPath = join(record.runPath, 'integration-journal.json');
    const bytes = await readFile(journalPath);
    const journal = JSON.parse(bytes);
    // Model the durable state after the last write cursor but before final acceptance.
    await updateRunRecord(
      record.runId,
      {
        status: 'completed',
        disposition: null,
        integration: {
          status: 'interrupted',
          journalPath,
          journalDigest: createHash('sha256').update(bytes).digest('hex'),
          cursor: journal.changes.length,
          pendingPath: null,
        },
      },
      { directory: f.runDirectory },
    );
    if (ownerEdit) {
      await writeFile(join(f.root, 'owner-note.txt'), 'owner save before recovery\n');
      await assert.rejects(
        delegateIntegrationCommand('recover', {
          ...input,
          resolution: 'accept',
        }),
        { code: 'E_INTEGRATION_RECOVERY_CONFLICT' },
      );
      assert.equal(
        (await readRunRecord(record.runId, { directory: f.runDirectory })).integration.status,
        'interrupted',
      );
      assert.equal(
        await readFile(join(f.root, 'owner-note.txt'), 'utf8'),
        'owner save before recovery\n',
      );
    } else {
      const recovered = await delegateIntegrationCommand('recover', {
        ...input,
        resolution: 'accept',
      });
      assert.equal(recovered.recovered, 'accepted');
      assert.equal(
        (await readRunRecord(record.runId, { directory: f.runDirectory })).integration.verified,
        true,
      );
    }
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
