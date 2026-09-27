import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  createDaemon,
  findRunningDaemon,
  killRunningDaemon,
} from '../../lib/design-engine/daemon.mjs';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', '..', 'lib', 'design-engine', 'cli.mjs');
const DAEMON = join(here, '..', '..', 'lib', 'design-engine', 'daemon.mjs');

// Run `cli.mjs <args>` and return parsed stdout JSON. Async (NOT execFileSync) on purpose: the
// in-process daemon below answers /health on this same event loop, so a synchronous child would
// deadlock it. Only the reuse/status paths are exercised — never the boot-and-block path of
// `daemon --serve` with no daemon up (it would intentionally never exit).
const runCli = async (args, env) => {
  const { stdout } = await execFileP(process.execPath, [CLI, ...args], { env, encoding: 'utf-8' });
  return JSON.parse(stdout);
};

test('cli daemon --status / --serve: discovers and reuses a running daemon', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-daemoncmd-'));
  const env = { ...process.env, PLANR_HOME: home };
  try {
    // No daemon for this isolated PLANR_HOME.
    let status = await runCli(['daemon', '--status'], env);
    assert.equal(status.ok, true);
    assert.equal(status.running, false, 'no daemon → running:false');
    assert.equal(status.port, null);

    // Bring one up in-process, keyed to the same PLANR_HOME the subprocess will probe.
    const daemon = createDaemon({ env });
    const port = await daemon.listen();
    try {
      status = await runCli(['daemon', '--status'], env);
      assert.equal(status.running, true, 'live daemon → running:true');
      assert.equal(status.port, port, 'reports the live daemon port');
      assert.equal(status.current, true, 'live daemon is the current DAEMON_VERSION');

      // `daemon --serve` must REUSE a healthy daemon and exit (not boot a second server / block).
      const reused = await runCli(['daemon', '--serve'], env);
      assert.equal(reused.reused, true, '--serve reuses the running daemon');
      assert.equal(reused.port, port);
    } finally {
      await daemon.close();
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

function boardFixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'planr-daemoncmd-'));
  const boardDir = mkdtempSync(join(tmpdir(), 'planr-daemoncmd-board-'));
  writeFileSync(
    join(boardDir, 'variant-A.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
  );
  const env = { ...process.env, PLANR_HOME: home };
  const children = [];
  t.after(async () => {
    await killRunningDaemon(await findRunningDaemon({ env }));
    for (const child of children) if (child.exitCode === null && !child.signalCode) child.kill();
    rmSync(home, { recursive: true, force: true });
    rmSync(boardDir, { recursive: true, force: true });
  });
  return { env, boardDir, children, stateDir: join(home, 'design-daemon') };
}

// A separate process, so the CLI can stop it without signalling the test runner.
async function startDaemonProcess({ env, children }) {
  const child = spawn(process.execPath, [DAEMON, '--serve'], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  children.push(child);
  const exited = once(child, 'exit');
  let output = '';
  child.stderr.setEncoding('utf8');
  const port = await new Promise((resolvePort, reject) => {
    child.stderr.on('data', (chunk) => {
      output += chunk;
      const match = /^DAEMON_PORT: (\d+)\n/m.exec(output);
      if (match) resolvePort(Number(match[1]));
    });
    exited.then(([code, signal]) =>
      reject(new Error(`daemon exited (${code ?? signal}) before its port: ${output}`)),
    );
  });
  return { child, port, exited };
}

test('board replaces a daemon whose registry turned invalid instead of starting a second one', async (t) => {
  const fixture = boardFixture(t);
  const first = await startDaemonProcess(fixture);
  const regPath = join(fixture.stateDir, 'boards.json');
  const truncated = `{"stale--${'a'.repeat(24)}": "/tmp/pla`;
  writeFileSync(regPath, truncated);

  const identified = await findRunningDaemon({ env: fixture.env });
  assert.equal(identified?.pid, first.child.pid, 'health still identifies the running daemon');
  assert.equal(identified.port, first.port);
  assert.ok(
    identified.registryError.startsWith(`The design board registry ${regPath} is invalid: `),
    identified.registryError,
  );

  const board = await runCli(['board', '--dir', fixture.boardDir], fixture.env);
  const stopped = await Promise.race([first.exited, delay(5000, 'running', { ref: false })]);
  assert.deepEqual(stopped, [null, 'SIGTERM'], 'board stopped the first daemon');
  assert.notEqual(board.port, first.port, 'board registered on a fresh daemon');

  const preserved = readdirSync(fixture.stateDir).filter((name) =>
    name.startsWith('boards.json.corrupt-'),
  );
  assert.equal(preserved.length, 1);
  assert.equal(readFileSync(join(fixture.stateDir, preserved[0]), 'utf8'), truncated);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(regPath, 'utf8'))), [board.boardId]);
});

test('board fails at once with the daemon exit code and error when the daemon cannot start', async (t) => {
  const fixture = boardFixture(t);
  const regPath = join(fixture.stateDir, 'boards.json');
  mkdirSync(regPath, { recursive: true });

  await assert.rejects(
    execFileP(process.execPath, [CLI, 'board', '--dir', fixture.boardDir], {
      env: fixture.env,
      encoding: 'utf-8',
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(
        error.stderr,
        /daemon .*daemon\.mjs exited with code 1 before reporting its port: /,
      );
      assert.ok(
        error.stderr.includes(`Cannot read the design board registry ${regPath}: EISDIR`),
        error.stderr,
      );
      return true;
    },
  );
});

test('board relays the daemon notice that sets an invalid registry aside', async (t) => {
  const fixture = boardFixture(t);
  mkdirSync(fixture.stateDir, { recursive: true });
  const regPath = join(fixture.stateDir, 'boards.json');
  writeFileSync(regPath, '["legacy-slug"]\n');

  const { stderr } = await execFileP(process.execPath, [CLI, 'board', '--dir', fixture.boardDir], {
    env: fixture.env,
    encoding: 'utf-8',
  });
  const notice = `[design-daemon] The design board registry ${regPath} is invalid: expected an object mapping board ids to directories. Preserved it as ${regPath}.corrupt-`;
  assert.ok(stderr.includes(notice), stderr);
  assert.ok(stderr.indexOf(notice) < stderr.indexOf('BOARD_URL: '), stderr);
  assert.doesNotMatch(stderr, /DAEMON_PORT/);
});

test('a daemon started by board keeps serving after the command exits and the daemon logs', async (t) => {
  const fixture = boardFixture(t);
  const first = await runCli(['board', '--dir', fixture.boardDir], fixture.env);
  const started = await runCli(['daemon', '--status'], fixture.env);
  assert.equal(started.running, true, 'the daemon board started is still running');
  assert.equal(started.port, first.port);

  // Registering another board makes the daemon write its per-board notice to stderr.
  const secondDir = join(fixture.boardDir, 'second');
  mkdirSync(secondDir);
  writeFileSync(
    join(secondDir, 'variant-A.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
  );
  const second = await runCli(['board', '--dir', secondDir], fixture.env);
  assert.equal(second.port, first.port, 'the second board reuses the daemon');
  const log = readFileSync(join(fixture.stateDir, 'daemon.log'), 'utf8');
  assert.ok(
    log.includes(`[feedback] mutex-guarded merge path active for board ${second.boardId}\n`),
    log,
  );

  const after = await runCli(['daemon', '--status'], fixture.env);
  assert.equal(after.running, true, 'the daemon survives its stderr writes');
  assert.equal(after.pid, started.pid);
  for (const { url } of [first, second]) {
    const response = await fetch(url);
    assert.equal(response.status, 200, url);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
  }
});

test('a respawned daemon keeps the previous daemon log', async (t) => {
  const fixture = boardFixture(t);
  const logPath = join(fixture.stateDir, 'daemon.log');
  const first = await runCli(['board', '--dir', fixture.boardDir], fixture.env);
  const firstLog = readFileSync(logPath, 'utf8');
  assert.ok(firstLog.startsWith(`DAEMON_PORT: ${first.port}\n`), firstLog);
  if (process.platform !== 'win32') assert.equal(statSync(logPath).mode & 0o777, 0o600);

  assert.equal(await killRunningDaemon(await findRunningDaemon({ env: fixture.env })), true);
  const second = await runCli(['board', '--dir', fixture.boardDir], fixture.env);
  assert.notEqual(second.port, first.port);
  assert.equal(readFileSync(`${logPath}.1`, 'utf8'), firstLog);
  assert.ok(readFileSync(logPath, 'utf8').startsWith(`DAEMON_PORT: ${second.port}\n`));
});
