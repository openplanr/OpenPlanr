import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cursorAdapter } from '../../skills/planr-delegate/scripts/adapters/cursor.mjs';
import {
  enrollProfile,
  prepareProfile,
  previewProfileCandidate,
} from '../../skills/planr-delegate/scripts/profiles.mjs';

async function fixture(t, mode = '') {
  const root = await mkdtemp(join(tmpdir(), 'delegate-cursor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'workspace');
  const capsule = join(root, 'capsule');
  await mkdir(cwd);
  await mkdir(capsule, { mode: 0o700 });
  const capsulePath = join(capsule, 'capsule.json');
  await writeFile(capsulePath, '{}', { mode: 0o600 });
  const executable = join(root, 'agent');
  await writeFile(
    executable,
    `#!${process.execPath}
import {writeFileSync,readFileSync} from 'node:fs';
const args=process.argv.slice(2);
const mode=process.env.FIXTURE_MODE;
if(args.includes('--help')) {
 console.log(mode==='old'?'--print':'--print --output-format stream-json --resume --auto-review --sandbox --workspace --add-dir --endpoint');process.exit(0);
}
if(args.includes('status')) {
 console.log(JSON.stringify({isAuthenticated:mode!=='logout',email:'never-return-account@example.test',accessToken:'never-return-token'}));process.exit(0);
}
const id=args.includes('--resume')?args[args.indexOf('--resume')+1]:'cursor-session-1';
let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{
 writeFileSync('invocation.json',JSON.stringify({args,input,home:process.env.HOME,secret:process.env.NOT_ALLOWED_SECRET}));
 const emit=e=>console.log(JSON.stringify(e));
 emit({type:'system',subtype:'init',session_id:id});
 if(mode==='malformed')return console.log('bad json');
 if(mode==='mismatch')return emit({type:'assistant',session_id:'different'});
 if(mode==='hang')return setInterval(()=>{},1000);
 const message=text=>emit({type:'assistant',session_id:id,message:{role:'assistant',content:[{type:'text',text}]}});
 message('Progress mentions '+String.fromCharCode(96)+'source.txt'+String.fromCharCode(96)+' and {non-result}');
 if(mode==='flood')for(let i=0;i<80;i++)message('x'.repeat(32000));
 emit({type:'tool_call',subtype:'completed',session_id:id,tool_call:{readToolCall:{result:{success:{content:readFileSync(${JSON.stringify(capsulePath)},'utf8')}}}}});
 writeFileSync('source.txt',args.includes('--resume')?'corrected\\n':'implemented\\n');
 const result=JSON.stringify({status:mode==='question'?'question':'completed',summary:'done',question:{text:'Which option?',options:['A','B']},checks:[],issues:[]});
 if(mode!=='no-final')message(mode==='prose'?'Not a JSON result':mode==='two-json'?result+result:result);
 if(mode==='stale')emit({type:'tool_call',subtype:'started',session_id:id});
 if(mode==='no-terminal')return;
 emit({type:'result',subtype:'success',is_error:mode==='error',session_id:id,result:'Concatenated progress '+result});
 if(mode==='duplicate')emit({type:'result',session_id:id});
 if(mode==='exit')process.exitCode=2;
});
`,
    { mode: 0o700 },
  );
  const profile = {
    name: 'cursor',
    kind: 'cursor',
    executable,
    argv: [],
    allowedEnv: ['FIXTURE_MODE', 'CURSOR_API_ENDPOINT'],
    workingDirectory: 'worktree',
    trustNativeConfiguration: true,
  };
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    USER: 'fixture',
    FIXTURE_MODE: mode,
    NOT_ALLOWED_SECRET: 'withheld',
  };
  return { root, cwd, capsulePath, profile, env };
}

test('Cursor preview discloses native configuration and retains normal auth without leaking account data', async (t) => {
  const f = await fixture(t);
  const preview = await previewProfileCandidate(f.profile, { cwd: f.cwd, env: f.env });
  assert.deepEqual(preview.candidate.destination, {
    class: 'external',
    origin: 'https://api2.cursor.sh',
  });
  assert.equal(preview.executionPolicy.configuration, 'trusted-native');
  assert.equal(preview.executionPolicy.sandbox, 'enabled');
  assert.match(preview.executionPolicy.extensions, /hooks, plugins and MCP/);
  assert.ok(!JSON.stringify(preview).includes('never-return'));
  const directory = join(f.root, 'profiles');
  await enrollProfile(preview.candidate, { directory });
  const prepared = await prepareProfile('cursor', { directory, cwd: f.cwd, env: f.env });
  assert.equal(prepared.executionPolicy.configuration, 'trusted-native');
  await assert.rejects(
    prepareProfile('cursor', {
      directory,
      cwd: f.cwd,
      env: { ...f.env, CURSOR_API_ENDPOINT: 'https://alternate.test' },
    }),
    { code: 'E_DESTINATION_CHANGED' },
  );
});

test('Cursor stdin dispatch and correction use the exact session, capsule root and sandbox without force flags', async (t) => {
  const f = await fixture(t);
  const preview = await previewProfileCandidate(f.profile, { cwd: f.cwd, env: f.env });
  const directory = join(f.root, 'profiles');
  await enrollProfile({ ...preview.candidate, argv: ['-m', 'chosen-model'] }, { directory });
  const prepared = await prepareProfile('cursor', { directory, cwd: f.cwd, env: f.env });
  const sessions = [];
  const options = {
    cwd: f.cwd,
    capsulePath: f.capsulePath,
    prompt: 'fixture task over stdin',
    onSessionId: (id) => sessions.push(id),
  };
  const first = await prepared.adapter.run(options);
  assert.equal(first.status, 'completed');
  assert.equal(await readFile(join(f.cwd, 'source.txt'), 'utf8'), 'implemented\n');
  const second = await prepared.adapter.resume({
    ...options,
    sessionId: first.sessionId,
    prompt: 'correct fixture over stdin',
  });
  assert.equal(second.sessionId, first.sessionId);
  assert.deepEqual(sessions, ['cursor-session-1', 'cursor-session-1']);
  assert.equal(await readFile(join(f.cwd, 'source.txt'), 'utf8'), 'corrected\n');
  const call = JSON.parse(await readFile(join(f.cwd, 'invocation.json'), 'utf8'));
  assert.equal(call.input, 'correct fixture over stdin');
  assert.equal(call.home, f.root);
  assert.equal(call.secret, undefined);
  for (const flag of [
    '--force',
    '--yolo',
    '--approve-mcps',
    '--continue',
    '--stream-partial-output',
  ])
    assert.ok(!call.args.includes(flag));
  assert.equal(call.args[call.args.indexOf('--sandbox') + 1], 'enabled');
  assert.equal(
    call.args[call.args.indexOf('--add-dir') + 1],
    await realpath(join(f.root, 'capsule')),
  );
  assert.equal(call.args[call.args.indexOf('--resume') + 1], first.sessionId);
  assert.equal(call.args[call.args.indexOf('--model') + 1], 'chosen-model');
  assert.ok(!call.args.includes(call.input));
});

test('Cursor streams large progress without retaining it and handles a structured question', async (t) => {
  const f = await fixture(t, 'flood');
  const options = {
    profile: f.profile,
    cwd: f.cwd,
    env: f.env,
    capsulePath: f.capsulePath,
    prompt: 'fixture',
  };
  const result = await cursorAdapter.run(options);
  assert.deepEqual(result.checks, []);
  assert.ok(JSON.stringify(result).length < 300);
  assert.equal(
    (await cursorAdapter.run({ ...options, env: { ...f.env, FIXTURE_MODE: 'question' } })).question
      .text,
    'Which option?',
  );
});

test('Cursor rejects missing capability, login and unmodelled endpoint configuration before task dispatch', async (t) => {
  const f = await fixture(t);
  for (const [mode, code] of [
    ['old', 'E_ADAPTER_INCOMPATIBLE'],
    ['logout', 'E_ADAPTER_AUTHENTICATION'],
  ])
    await assert.rejects(
      cursorAdapter.probe({
        profile: f.profile,
        cwd: f.cwd,
        env: { ...f.env, FIXTURE_MODE: mode },
      }),
      { code },
    );
  for (const endpoint of [
    'https://user:password@example.test',
    'https://example.test/path',
    'https://example.test/?token=value',
  ])
    await assert.rejects(
      cursorAdapter.probe({
        profile: f.profile,
        cwd: f.cwd,
        env: { ...f.env, CURSOR_API_ENDPOINT: endpoint },
      }),
      { code: 'E_DESTINATION_UNKNOWN' },
    );
  await assert.rejects(
    cursorAdapter.probe({
      profile: f.profile,
      cwd: f.cwd,
      env: { ...f.env, HTTPS_PROXY: 'https://proxy.test' },
    }),
    { code: 'E_DESTINATION_UNKNOWN' },
  );
  await assert.rejects(cursorAdapter.resume({ sessionId: '' }), { code: 'E_ADAPTER_SESSION' });
});

test('Cursor rejects malformed streams, mismatched sessions, missing final reports and unsuccessful completion', async (t) => {
  const f = await fixture(t);
  const modes = {
    malformed: 'E_ADAPTER_RESULT',
    mismatch: 'E_ADAPTER_SESSION',
    'no-final': 'E_ADAPTER_RESULT',
    prose: 'E_ADAPTER_RESULT',
    'two-json': 'E_ADAPTER_RESULT',
    stale: 'E_ADAPTER_RESULT',
    'no-terminal': 'E_ADAPTER_RESULT',
    duplicate: 'E_ADAPTER_RESULT',
    error: 'E_ADAPTER_RESULT',
    exit: 'E_ADAPTER_EXIT',
  };
  for (const [mode, code] of Object.entries(modes))
    await assert.rejects(
      cursorAdapter.run({
        profile: f.profile,
        cwd: f.cwd,
        env: { ...f.env, FIXTURE_MODE: mode },
        capsulePath: f.capsulePath,
        prompt: 'fixture',
      }),
      { code },
      mode,
    );
});
