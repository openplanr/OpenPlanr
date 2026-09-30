import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { genericAdapter } from '../../skills/planr-delegate/scripts/adapters/generic.mjs';
import {
  parseOpenCodeEvents,
  probeOpenCode,
  runOpenCode,
} from '../../skills/planr-delegate/scripts/adapters/opencode-wrapper.mjs';

const cleanup = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

async function fixture({ drift = false, wrongSession = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'planr-opencode-test-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const capsuleDirectory = join(root, 'capsule');
  await mkdir(capsuleDirectory, { mode: 0o700 });
  const capsulePath = join(capsuleDirectory, 'capsule.json');
  await writeFile(capsulePath, '{}\n', { mode: 0o600 });
  const bin = join(root, 'bin');
  await mkdir(bin);
  const executable = join(bin, 'opencode');
  await writeFile(
    executable,
    `#!/usr/bin/env node
const args=process.argv.slice(2);
if(args[0]==='agent'){ process.stdout.write('build (primary)\\n'); process.exit(0); }
if(args[0]==='debug'){
  const x=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
  ${drift ? "x.provider['planr-local'].options.baseURL='https://other.example/v1';" : ''}
  process.stdout.write(JSON.stringify(x)); process.exit(0);
}
if(args[0]==='run' && args.includes('--help')){ process.stdout.write('--format --session --model --agent'); process.exit(0); }
if(args[0]==='run'){
  const p=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT).permission;
  const allowed=Object.keys(p?.external_directory||{});
  if(allowed.length!==1 || p.external_directory[allowed[0]]!=='allow' || p.read?.[allowed[0]]!=='allow' || p.edit?.[allowed[0]]!=='deny')process.exit(2);
  const id=args.includes('--session') ? args[args.indexOf('--session')+1] : 'ses_pilot';
  let prompt='';process.stdin.on('data',x=>prompt+=x);process.stdin.on('end',()=>{
    if(!prompt.trim()) process.exit(1);
    process.stdout.write(JSON.stringify({type:'text',sessionID:${wrongSession ? "'ses_wrong'" : 'id'},part:{text:JSON.stringify({status:'completed',summary:'Implemented in isolated worktree',checks:['focused']})}})+'\\n');
  });
  return;
}
process.exit(1);
`,
  );
  await chmod(executable, 0o755);
  const server = createServer((request, response) => {
    if (request.url === '/v1/models' && request.headers.authorization === 'Bearer private-value') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'meta/muse-glimmer' }] }));
    } else {
      response.writeHead(401);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    PLANR_OPENCODE_BASE_URL: endpoint,
    PLANR_OPENCODE_MODEL: 'meta/muse-glimmer',
    PLANR_OPENCODE_STATE_DIR: join(root, 'state'),
    LM_STUDIO_API_KEY: 'private-value',
  };
  return { root, executable, endpoint, env, capsulePath };
}

test('OpenCode generic wrapper probes effective local endpoint and exact resume', async () => {
  const { root, endpoint, env, capsulePath } = await fixture();
  const profile = {
    executable: process.execPath,
    argv: [
      new URL('../../skills/planr-delegate/scripts/adapters/opencode-wrapper.mjs', import.meta.url)
        .pathname,
    ],
  };
  const found = await genericAdapter.probe({ profile, cwd: root, env });
  assert.deepEqual(found.destination, {
    class: 'local',
    origin: new URL(endpoint).origin,
  });
  assert.equal(found.capabilities.exactResume, true);
  const result = await genericAdapter.run({
    profile,
    cwd: root,
    prompt: 'private task text',
    capsulePath,
    env,
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.sessionId, 'ses_pilot');
  assert.equal(JSON.stringify(result).includes('private-value'), false);
  assert.equal(JSON.stringify(result).includes('private task text'), false);
  const resumed = await genericAdapter.resume({
    profile,
    cwd: root,
    prompt: 'revision',
    capsulePath,
    sessionId: result.sessionId,
    env,
  });
  assert.equal(resumed.sessionId, result.sessionId);
});

test('OpenCode wrapper fails closed when resolved config changes destination', async () => {
  const { root, executable, env } = await fixture({ drift: true });
  await assert.rejects(probeOpenCode({ cwd: root, env, executable }), {
    code: 'E_DESTINATION_CHANGED',
  });
});

test('OpenCode wrapper rejects a different resumed session', async () => {
  const { root, executable, env, capsulePath } = await fixture({ wrongSession: true });
  await assert.rejects(
    runOpenCode({
      cwd: root,
      prompt: 'revision',
      capsulePath,
      sessionId: 'ses_pilot',
      env,
      executable,
    }),
    { code: 'E_ADAPTER_SESSION' },
  );
});

test('OpenCode wrapper rejects malformed answers and remote endpoints', async () => {
  assert.throws(
    () => parseOpenCodeEvents('{"type":"text","sessionID":"ses_1","part":{"text":"not-json"}}'),
    { code: 'E_ADAPTER_RESULT' },
  );
  const { root, executable, env } = await fixture();
  await assert.rejects(
    probeOpenCode({
      cwd: root,
      env: { ...env, PLANR_OPENCODE_BASE_URL: 'https://remote.example/v1' },
      executable,
    }),
    { code: 'E_DESTINATION_UNKNOWN' },
  );
});

test('OpenCode wrapper requires a private explicit capsule and never widens access', async () => {
  const { root, executable, env, capsulePath } = await fixture();
  await assert.rejects(runOpenCode({ cwd: root, prompt: 'test', env, executable }), {
    code: 'E_ADAPTER_ARGUMENTS',
  });
  await chmod(capsulePath, 0o644);
  await assert.rejects(runOpenCode({ cwd: root, prompt: 'test', capsulePath, env, executable }), {
    code: 'E_ADAPTER_ARGUMENTS',
  });
});
