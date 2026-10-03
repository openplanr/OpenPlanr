import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  createDaemon,
  DAEMON_VERSION,
  daemonControlHeaders,
} from '../../lib/design-engine/daemon.mjs';

test('daemon startup prunes legacy + dead boards, keeps live tokenized ones', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-reg-home-'));
  const liveDir = mkdtempSync(join(tmpdir(), 'planr-reg-live-'));
  const env = { PLANR_HOME: home };
  const stateDir = join(home, 'design-daemon');
  mkdirSync(stateDir, { recursive: true });
  const regPath = join(stateDir, 'boards.json');

  const TOKEN = 'a'.repeat(24);
  writeFileSync(
    regPath,
    `${JSON.stringify(
      {
        'legacy-slug': liveDir, // pre-token (no --token), live dir → pruned as legacy
        [`dead--${TOKEN}`]: join(tmpdir(), 'planr-reg-gone-nonexistent'), // tokenized but dir gone → pruned
        [`live--${TOKEN}`]: liveDir, // tokenized + live dir → kept
      },
      null,
      2,
    )}\n`,
  );

  try {
    // Registry hygiene occurs after serialized ownership of the startup.
    const daemon = createDaemon({ env });
    await daemon.listen();
    await daemon.close();
    const reg = JSON.parse(readFileSync(regPath, 'utf-8'));
    assert.deepEqual(
      Object.keys(reg),
      [`live--${TOKEN}`],
      'only the live, tokenized board survives the startup prune',
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(liveDir, { recursive: true, force: true });
  }
});

const BOARD_ID = `live--${'b'.repeat(24)}`;

function isolatedState(t) {
  const home = mkdtempSync(join(tmpdir(), 'planr-reg-home-'));
  const boardDir = mkdtempSync(join(tmpdir(), 'planr-reg-board-'));
  writeFileSync(join(boardDir, 'board.html'), '<!doctype html><title>board</title>');
  t.after(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(boardDir, { recursive: true, force: true });
  });
  const env = { PLANR_HOME: home };
  const stateDir = join(home, 'design-daemon');
  mkdirSync(stateDir, { recursive: true });
  return { env, stateDir, boardDir, regPath: join(stateDir, 'boards.json') };
}

async function listen(t, env) {
  const daemon = createDaemon({ env });
  const port = await daemon.listen();
  t.after(() => daemon.close());
  return port;
}

const register = (port, env, dir) =>
  fetch(`http://127.0.0.1:${port}/api/boards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...daemonControlHeaders(env) },
    body: JSON.stringify({ id: BOARD_ID, dir }),
  });

for (const [label, bytes, reason] of [
  ['truncated', `{\n  "${BOARD_ID}": "/tmp/planr-board`, /^it is not valid JSON\. /],
  // V8 quotes the ten characters before an unexpected token, here the end of the board token.
  ['token-quoting', `{"${BOARD_ID}":x}`, /^it is not valid JSON\. /],
  ['non-map', '["legacy-slug"]\n', /^expected an object mapping board ids to directories\. /],
]) {
  test(`daemon startup sets a ${label} registry aside intact and reports it`, async (t) => {
    const { env, stateDir, boardDir, regPath } = isolatedState(t);
    writeFileSync(regPath, bytes);
    const stderr = [];
    t.mock.method(process.stderr, 'write', (chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    const port = await listen(t, env);
    const quarantined = readdirSync(stateDir).filter((name) =>
      name.startsWith('boards.json.corrupt-'),
    );
    assert.equal(quarantined.length, 1, 'exactly one preserved copy of the corrupt registry');
    const quarantinePath = join(stateDir, quarantined[0]);
    assert.equal(existsSync(regPath), false, 'startup does not write a replacement registry');
    const notice = stderr.join('');
    const prefix = `The design board registry ${regPath} is invalid: `;
    assert.ok(notice.includes(prefix), `notice names the registry: ${notice}`);
    assert.match(notice.slice(notice.indexOf(prefix) + prefix.length), reason);
    assert.equal(notice.includes('b'.repeat(8)), false, `notice quotes no board token: ${notice}`);
    assert.ok(notice.includes(quarantinePath), `notice names the preserved copy: ${notice}`);

    assert.equal((await register(port, env, boardDir)).status, 200);
    assert.deepEqual(JSON.parse(readFileSync(regPath, 'utf8')), { [BOARD_ID]: boardDir });
    assert.equal(readFileSync(quarantinePath, 'utf8'), bytes, 'the preserved copy is untouched');
  });
}

test('daemon startup fails, naming the registry, when it cannot read it', async (t) => {
  const { env, regPath } = isolatedState(t);
  mkdirSync(regPath);
  await assert.rejects(
    () => createDaemon({ env }).listen(),
    (error) => error.message.startsWith(`Cannot read the design board registry ${regPath}: `),
  );
  assert.ok(statSync(regPath).isDirectory(), 'the unreadable registry is left in place');
});

test('a registry corrupted while the daemon runs fails requests and is left untouched', async (t) => {
  const { env, boardDir, regPath } = isolatedState(t);
  const port = await listen(t, env);
  const truncated = `{"${BOARD_ID}": "/tmp/pla`;
  writeFileSync(regPath, truncated);
  const invalid = `The design board registry ${regPath} is invalid: `;

  for (const response of [
    await fetch(`http://127.0.0.1:${port}/boards/${BOARD_ID}/`),
    await register(port, env, boardDir),
  ]) {
    assert.equal(response.status, 500);
    const { error } = await response.json();
    assert.ok(error.startsWith(invalid), error);
  }

  const health = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: daemonControlHeaders(env),
  });
  assert.equal(health.status, 200, 'health still identifies the daemon');
  const { registryError, instanceId, startedAt, ...identity } = await health.json();
  assert.deepEqual(identity, {
    ok: true,
    kind: 'openplanr-design-daemon',
    pid: process.pid,
    version: DAEMON_VERSION,
  });
  assert.match(instanceId, /^[A-Za-z0-9_-]{22}$/u);
  assert.ok(Number.isFinite(Date.parse(startedAt)));
  assert.ok(registryError.startsWith(invalid), registryError);
  assert.equal(readFileSync(regPath, 'utf8'), truncated);
});

test('a missing registry starts empty and a registration replaces it atomically', async (t) => {
  const { env, stateDir, boardDir, regPath } = isolatedState(t);
  const port = await listen(t, env);
  assert.equal(existsSync(regPath), false);

  assert.equal((await register(port, env, boardDir)).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(regPath, 'utf8')), { [BOARD_ID]: boardDir });
  assert.deepEqual(
    readdirSync(stateDir).filter((name) => name.endsWith('.tmp')),
    [],
    'no temporary file is left beside the registry',
  );
  if (process.platform !== 'win32') assert.equal(statSync(regPath).mode & 0o777, 0o600);
});
