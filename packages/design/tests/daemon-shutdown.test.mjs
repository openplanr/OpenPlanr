import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createDaemon,
  daemonControlHeaders,
  findRunningDaemon,
  killRunningDaemon,
} from '../lib/design-engine/daemon.mjs';

function context() {
  const home = mkdtempSync(join(tmpdir(), 'planr-daemon-stop-'));
  const env = { PLANR_HOME: home };
  return { home, env, stateDir: join(home, 'design-daemon') };
}

function holdServerClose(t, daemon) {
  let releaseClose, reportClosed;
  const gate = new Promise((resolve) => {
    releaseClose = resolve;
  });
  const closed = new Promise((resolve) => {
    reportClosed = resolve;
  });
  const close = daemon.server.close.bind(daemon.server);
  t.mock.method(daemon.server, 'close', (callback) =>
    close((error) => {
      reportClosed();
      void gate.then(() => callback(error));
    }),
  );
  return { closed, release: () => releaseClose() };
}

test('owned stop waits beyond listener closure for the final private receipt and permits immediate teardown', async (t) => {
  const fixture = context();
  const daemon = createDaemon({ env: fixture.env });
  const gate = holdServerClose(t, daemon);
  let operation;
  try {
    await daemon.listen();
    const running = await findRunningDaemon({ env: fixture.env });
    const path = join(fixture.stateDir, `stopped-${running.instanceId}.json`);
    let settled = false;
    operation = killRunningDaemon(running, { env: fixture.env }).finally(() => {
      settled = true;
    });
    await gate.closed;
    assert.equal(await findRunningDaemon({ env: fixture.env }), null);
    await delay(100);
    assert.equal(settled, false, 'An unreachable listener is not a completed shutdown receipt.');
    const identity = JSON.parse(readFileSync(join(fixture.stateDir, 'instance.json'), 'utf8'));
    for (const invalid of [
      { ...identity, status: 'stopped', instanceId: 'x'.repeat(22) },
      { ...identity, status: 'stopped', startedAt: new Date(0).toISOString() },
      { ...identity, status: 'running' },
    ]) {
      writeFileSync(path, JSON.stringify(invalid), { mode: 0o600 });
      await delay(35);
      assert.equal(settled, false, 'A stopped receipt must bind the exact original instance.');
    }
    writeFileSync(path, JSON.stringify({ ...identity, status: 'stopped' }));
    if (process.platform !== 'win32') {
      chmodSync(path, 0o644);
      await delay(35);
      assert.equal(settled, false, 'A permissive receipt cannot certify private ownership.');
      rmSync(path);
      const target = join(fixture.home, 'untrusted-receipt.json');
      writeFileSync(target, JSON.stringify({ ...identity, status: 'stopped' }), { mode: 0o600 });
      symlinkSync(target, path);
      await delay(35);
      assert.equal(settled, false, 'A symlink receipt cannot certify private ownership.');
    }
    rmSync(path, { force: true });
    gate.release();
    assert.equal(await operation, true);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { ...identity, status: 'stopped' });
    assert.equal(
      JSON.parse(readFileSync(join(fixture.stateDir, 'instance.json'), 'utf8')).status,
      'stopped',
    );
    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
    rmSync(fixture.home, { recursive: true, force: true });
    await daemon.close();
    await delay(100);
    assert.equal(
      existsSync(fixture.home),
      false,
      'Acknowledged or repeated close performs no later state writes.',
    );
  } finally {
    gate.release();
    await operation;
    await delay(50);
    await daemon.close();
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test('owned shutdown drains an already accepted board body before acknowledging durable stop', async () => {
  const fixture = context();
  const boardDir = join(fixture.home, 'board');
  mkdirSync(boardDir);
  writeFileSync(join(boardDir, 'board.html'), '<!doctype html><title>Owned board</title>');
  const daemon = createDaemon({ env: fixture.env });
  let pendingRequest, operation;
  try {
    const port = await daemon.listen();
    const id = `pending--${'a'.repeat(24)}`;
    const body = JSON.stringify({ id, dir: boardDir });
    const accepted = once(daemon.server, 'request');
    pendingRequest = request(`http://127.0.0.1:${port}/api/boards`, {
      method: 'POST',
      headers: {
        ...daemonControlHeaders(fixture.env),
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    });
    const response = new Promise((resolve, reject) => {
      pendingRequest.once('error', reject);
      pendingRequest.once('response', (res) => {
        res.resume();
        res.once('end', () => resolve(res.statusCode));
      });
    });
    pendingRequest.write(body.slice(0, 8));
    await accepted;
    let reportStopping;
    const stopping = new Promise((resolve) => {
      reportStopping = resolve;
    });
    const running = await findRunningDaemon({ env: fixture.env });
    let settled = false;
    operation = killRunningDaemon(running, {
      env: fixture.env,
      async fetchImpl(url, options) {
        const result = await fetch(url, options);
        if (new URL(url).pathname === '/internal/v1/shutdown') reportStopping();
        return result;
      },
    }).finally(() => {
      settled = true;
    });
    await stopping;
    await delay(80);
    assert.equal(settled, false);
    const rejected = await fetch(`http://127.0.0.1:${port}/api/boards`, {
      method: 'POST',
      headers: { ...daemonControlHeaders(fixture.env), 'content-type': 'application/json' },
      body,
    });
    assert.equal(rejected.status, 503, 'Shutdown accepts no new board mutation.');
    pendingRequest.end(body.slice(8));
    assert.equal(await response, 200);
    assert.equal(await operation, true);
    assert.deepEqual(JSON.parse(readFileSync(join(fixture.stateDir, 'boards.json'), 'utf8')), {
      [id]: boardDir,
    });
    assert.equal(
      JSON.parse(readFileSync(join(fixture.stateDir, 'instance.json'), 'utf8')).status,
      'stopped',
    );
  } finally {
    pendingRequest?.destroy();
    await operation;
    await daemon.close();
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test('a retained stop receipt cannot authorize shutdown of a replacement instance', async () => {
  const fixture = context();
  const first = createDaemon({ env: fixture.env });
  const second = createDaemon({ env: fixture.env });
  try {
    await first.listen();
    const original = await findRunningDaemon({ env: fixture.env });
    assert.equal(await killRunningDaemon(original, { env: fixture.env }), true);
    await second.listen();
    const replacement = await findRunningDaemon({ env: fixture.env });
    assert.notEqual(replacement.instanceId, original.instanceId);
    await first.close();
    assert.equal(await killRunningDaemon(original, { env: fixture.env }), false);
    assert.equal(
      (await findRunningDaemon({ env: fixture.env })).instanceId,
      replacement.instanceId,
    );
    assert.equal(
      JSON.parse(readFileSync(join(fixture.stateDir, 'instance.json'), 'utf8')).instanceId,
      replacement.instanceId,
    );
  } finally {
    await first.close();
    await second.close();
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test('a preserved startup lock failure permits explicit repair and retry while the exact listener remains alive', async () => {
  const fixture = context();
  const daemon = createDaemon({ env: fixture.env });
  const lock = join(fixture.stateDir, 'startup.lock');
  try {
    await daemon.listen();
    const running = await findRunningDaemon({ env: fixture.env });
    const original = 'preserved legacy owner record';
    writeFileSync(lock, original, { mode: 0o600 });
    await assert.rejects(daemon.close(), { code: 'E_START_LOCK_LEGACY' });
    assert.equal(readFileSync(lock, 'utf8'), original);
    assert.equal(daemon.server.listening, true);
    assert.equal((await findRunningDaemon({ env: fixture.env })).instanceId, running.instanceId);
    rmSync(lock);
    assert.equal(await killRunningDaemon(running, { env: fixture.env }), true);
    assert.equal(daemon.server.listening, false);
    assert.equal(
      JSON.parse(readFileSync(join(fixture.stateDir, 'instance.json'), 'utf8')).status,
      'stopped',
    );
  } finally {
    rmSync(lock, { force: true });
    await daemon.close();
    rmSync(fixture.home, { recursive: true, force: true });
  }
});
