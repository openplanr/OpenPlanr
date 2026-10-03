import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  listDashboardServers,
  stopDashboardServer,
} from '../../lib/dashboard/server/lifecycle.mjs';
import { createDashboardServer } from '../../lib/dashboard/server.mjs';

const staticRoot = fileURLToPath(new URL('./fixtures/unified-root', import.meta.url));
const planrDir = fileURLToPath(
  new URL('../../conformance/fixtures/dashboard-graph/.planr', import.meta.url),
);
function home(t) {
  const root = mkdtempSync(join(tmpdir(), 'dashboard-owned-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, env: { ...process.env, PLANR_HOME: root } };
}
async function start(t, env, extra = {}) {
  const dashboard = createDashboardServer({ staticRoot, planrDir, watch: false, ...extra });
  const port = await dashboard.listen(0, { env });
  t.after(() => dashboard.close());
  return { dashboard, port };
}
test('every dashboard has private custody and stopping one leaves the other serving', async (t) => {
  const { root, env } = home(t);
  const one = await start(t, env),
    two = await start(t, env);
  const instances = await listDashboardServers({ env });
  assert.equal(instances.length, 2);
  assert.equal(new Set(instances.map((x) => x.instanceId)).size, 2);
  assert.equal(
    instances.every(
      (x) =>
        x.projectRoot ===
        fileURLToPath(
          new URL('../../conformance/fixtures/dashboard-graph/', import.meta.url),
        ).replace(/\/$/, ''),
    ),
    true,
  );
  assert.doesNotMatch(JSON.stringify(instances), /controlToken/);
  const dir = join(root, 'dashboard-daemon', 'instances');
  for (const name of readdirSync(dir)) assert.equal(lstatSync(join(dir, name)).mode & 0o777, 0o600);
  const first = instances.find((x) => x.port === one.port);
  const denied = await fetch(`http://127.0.0.1:${one.port}/internal/v1/shutdown`, {
    method: 'POST',
  });
  assert.equal(denied.status, 403);
  const publicHealth = await fetch(`http://127.0.0.1:${one.port}/health`).then((x) => x.json());
  assert.equal(publicHealth.instanceId, first.instanceId);
  assert.equal(publicHealth.controlToken, undefined);
  assert.equal((await stopDashboardServer(first.instanceId, { env })).status, 'stopping');
  await one.dashboard.close();
  assert.deepEqual(
    (await listDashboardServers({ env })).map((x) => x.port),
    [two.port],
  );
  assert.equal((await fetch(`http://127.0.0.1:${two.port}/health`)).status, 200);
});
test('custody with a reused port or PID never authorizes shutdown of another server', async (t) => {
  const { root, env } = home(t);
  const owned = await start(t, env);
  const [instance] = await listDashboardServers({ env });
  await owned.dashboard.close();
  let shutdowns = 0;
  const foreign = createServer((req, res) => {
    if (req.url.includes('shutdown')) shutdowns++;
    res.end(
      JSON.stringify({
        ok: true,
        instanceId: 'b'.repeat(22),
        pid: instance.pid,
        kind: 'openplanr-dashboard',
      }),
    );
  });
  await new Promise((done) => foreign.listen(owned.port, '127.0.0.1', done));
  t.after(() => new Promise((done) => foreign.close(done)));
  const dir = join(root, 'dashboard-daemon', 'instances');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `instance-${instance.instanceId}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: '1.0.0',
      kind: instance.kind,
      instanceId: instance.instanceId,
      pid: instance.pid,
      port: instance.port,
      projectRoot: instance.projectRoot,
      runtimeRoot: instance.runtimeRoot,
      startedAt: instance.startedAt,
      controlToken: 'a'.repeat(43),
    }),
    { mode: 0o600 },
  );
  await assert.rejects(stopDashboardServer(instance.instanceId, { env }));
  assert.equal(shutdowns, 0);
  assert.deepEqual(await listDashboardServers({ env }), []);
  assert.ok(readFileSync(path));
});
test('dashboard reuse is bound to the project, configuration and runtime identity', async (t) => {
  const { env } = home(t),
    first = await start(t, env);
  const same = createDashboardServer({ staticRoot, planrDir, watch: false });
  t.after(() => same.close());
  assert.equal(await same.listen(first.port, { env }), first.port);
  assert.equal(same.reused, true);
  const other = createDashboardServer({
    staticRoot,
    planrDir: join(tmpdir(), '.planr'),
    watch: false,
  });
  t.after(() => other.close());
  await assert.rejects(other.listen(first.port, { env }), { code: 'E_DASHBOARD_PORT_IN_USE' });
});
test('malformed owned records are distinguished from missing ones and never removed', async (t) => {
  const { root, env } = home(t);
  assert.deepEqual(await listDashboardServers({ env }), []);
  const dir = join(root, 'dashboard-daemon', 'instances');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `instance-${'a'.repeat(22)}.json`);
  writeFileSync(path, '{bad', { mode: 0o600 });
  await assert.rejects(listDashboardServers({ env }), { code: 'E_SERVER_CUSTODY_UNSAFE' });
  assert.equal(readFileSync(path, 'utf8'), '{bad');
});
test('authenticated dashboard stop closes its child and lets the waiting parent exit', async (t) => {
  const { env, root } = home(t),
    script = join(root, 'owned-parent.mjs');
  const serverUrl = new URL('../../lib/dashboard/server.mjs', import.meta.url).href;
  writeFileSync(
    script,
    `import {fork} from 'node:child_process';\nimport {createDashboardServer} from ${JSON.stringify(serverUrl)};\nif(process.env.OWNED_CHILD==='1'){const d=createDashboardServer({staticRoot:${JSON.stringify(staticRoot)},planrDir:${JSON.stringify(planrDir)},watch:false});await d.listen(0);process.send('ready');process.disconnect();}else{const c=fork(import.meta.filename,[],{env:{...process.env,OWNED_CHILD:'1'},stdio:['ignore','ignore','ignore','ipc']});c.on('message',()=>process.send('ready'));c.on('exit',code=>{process.disconnect();process.exitCode=code;});}`,
  );
  const parent = fork(script, [], { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exited = new Promise((done) => parent.once('exit', (code) => done(code)));
  t.after(() => {
    if (parent.exitCode === null) parent.kill();
  });
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('dashboard readiness timeout')), 5000);
    parent.once('message', () => {
      clearTimeout(timer);
      done();
    });
    parent.once('error', reject);
  });
  const [instance] = await listDashboardServers({ env });
  assert.ok(instance);
  assert.notEqual(instance.pid, parent.pid);
  await stopDashboardServer(instance.instanceId, { env });
  assert.equal(
    await Promise.race([
      exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('owned group did not exit')), 5000),
      ),
    ]),
    0,
  );
});

test('a non-regular custody file fails promptly and is retained', {
  skip: process.platform === 'win32',
}, (t) => {
  const { root, env } = home(t);
  const dir = join(root, 'dashboard-daemon', 'instances');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `instance-${'a'.repeat(22)}.json`);
  execFileSync('mkfifo', ['-m', '600', path]);
  const lifecycleUrl = new URL('../../lib/dashboard/server/lifecycle.mjs', import.meta.url).href;
  const source = `import {listDashboardServers} from ${JSON.stringify(lifecycleUrl)};
try {await listDashboardServers();process.exitCode=1;} catch(error) {if(error.code!=='E_SERVER_CUSTODY_UNSAFE')throw error;}`;
  execFileSync(process.execPath, ['--input-type=module', '-e', source], { env, timeout: 3000 });
  assert.equal(lstatSync(path).isFIFO(), true);
});
