import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createDaemon,
  DAEMON_VERSION,
  daemonControlHeaders,
  findRunningDaemon,
  killRunningDaemon,
} from '../../design/lib/design-engine/daemon.mjs';
import { ensureBoardToken } from '../lib/artifact/internal/board-token.mjs';
import { acquireStartLock, acquireStartLockSync } from '../lib/artifact/internal/server-util.mjs';

const tokenModule = new URL('../lib/artifact/internal/board-token.mjs', import.meta.url).href;
const lockModule = new URL('../lib/artifact/internal/server-util.mjs', import.meta.url).href;
function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-lifecycle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function child(code, args = [], env = process.env) {
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, ['--input-type=module', '-e', code, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      error = '';
    processChild.stdout.on('data', (x) => (output += x));
    processChild.stderr.on('data', (x) => (error += x));
    processChild.on('error', reject);
    processChild.on('exit', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`Isolated child exited ${code}: ${error}`)),
    );
  });
}
test('parallel board token writers retain every board and reuse one token per directory', async (t) => {
  const root = temporary(t),
    env = { ...process.env, PLANR_HOME: root };
  const values = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      child(
        `import {ensureBoardToken} from ${JSON.stringify(tokenModule)};console.log(ensureBoardToken(process.argv[1]));`,
        [join(root, `board-${i % 6}`)],
        env,
      ),
    ),
  );
  const tokens = JSON.parse(readFileSync(join(root, 'design-daemon/tokens.json'), 'utf8'));
  assert.equal(Object.keys(tokens).length, 6);
  assert.equal(new Set(Object.values(tokens)).size, 6);
  values.forEach((value, i) => {
    assert.equal(value.trim(), tokens[join(root, `board-${i % 6}`)]);
  });
  assert.equal(ensureBoardToken(join(root, 'board-0'), { env }), tokens[join(root, 'board-0')]);
});
test('async and synchronous lock drivers share the same ownership queue', async (t) => {
  const root = temporary(t),
    lock = join(root, 'startup.lock'),
    unlock = await acquireStartLock(lock);
  const pending = child(
    `import {acquireStartLockSync} from ${JSON.stringify(lockModule)};const unlock=acquireStartLockSync(process.argv[1]);console.log('entered');unlock();`,
    [lock],
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  unlock();
  assert.equal((await pending).trim(), 'entered');
  const unlockSync = acquireStartLockSync(lock);
  let entered = false;
  const next = acquireStartLock(lock).then((release) => {
    entered = true;
    release();
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(entered, false);
  unlockSync();
  await next;
  assert.equal(entered, true);
  assert.deepEqual(readdirSync(`${lock}.writers`), []);
});
test('sync timeout preserves live writer ownership and reclaims only exact dead records', async (t) => {
  const root = temporary(t),
    lock = join(root, 'startup.lock'),
    unlock = await acquireStartLock(lock);
  assert.throws(() => acquireStartLockSync(lock, { timeout: 40, poll: 5 }), {
    code: 'E_START_LOCK_TIMEOUT',
  });
  assert.equal(readdirSync(`${lock}.writers`).length, 1);
  unlock();
  const dead = join(`${lock}.writers`, `2147483647-${'a'.repeat(32)}.json`);
  writeFileSync(dead, JSON.stringify({ pid: 2147483647, owner: 'a'.repeat(32), ticket: 1 }));
  const release = acquireStartLockSync(lock, { isAlive: (pid) => pid !== 2147483647 });
  assert.equal(existsSync(dead), false);
  release();
});
test('simultaneous daemon binds converge on one authenticated instance; stale identities cannot stop it', async (t) => {
  const root = temporary(t),
    env = { PLANR_HOME: root },
    a = createDaemon({ env }),
    b = createDaemon({ env });
  t.after(() => a.close());
  t.after(() => b.close());
  const ports = await Promise.all([a.listen(), b.listen()]);
  assert.equal(ports[0], ports[1]);
  assert.notEqual(a.server.listening, b.server.listening);
  const running = await findRunningDaemon({ env });
  assert.equal(running.version, DAEMON_VERSION);
  assert.match(running.instanceId, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(await killRunningDaemon({ ...running, instanceId: 'x'.repeat(22) }, { env }), false);
  const wrong = await fetch(`http://127.0.0.1:${running.port}/internal/v1/shutdown`, {
    method: 'POST',
    headers: { ...daemonControlHeaders(env), 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: 'x'.repeat(22) }),
  });
  assert.equal(wrong.status, 409);
  assert.equal(await killRunningDaemon(running, { env }), true);
  for (let i = 0; i < 50 && (await findRunningDaemon({ env })); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(await findRunningDaemon({ env }), null);
});
test('stale background daemon is preserved and is never killed from a pid', async (t) => {
  const root = temporary(t),
    env = { PLANR_HOME: root },
    daemon = createDaemon({ env });
  t.after(() => daemon.close());
  const port = await daemon.listen();
  const identity = JSON.parse(readFileSync(join(root, 'design-daemon/instance.json'), 'utf8'));
  identity.version--;
  writeFileSync(join(root, 'design-daemon/instance.json'), JSON.stringify(identity), {
    mode: 0o600,
  });
  const running = await findRunningDaemon({ env });
  assert.equal(running.port, port);
  assert.equal(running.instanceId, undefined);
  await assert.rejects(createDaemon({ env }).listen(), {
    code: 'E_DESIGN_DAEMON_RESTART_REQUIRED',
  });
  assert.equal(await killRunningDaemon(running, { env }), false);
  assert.equal(daemon.server.listening, true);
});
test('board procedure reuses only a current compatible daemon', () => {
  const source = readFileSync(
    new URL('../../pipeline/procedures/design-loop-step3-board.md', import.meta.url),
    'utf8',
  );
  assert.match(source, /if `current:true`, skip/);
  assert.doesNotMatch(source, /if `running:true`, skip/);
});
