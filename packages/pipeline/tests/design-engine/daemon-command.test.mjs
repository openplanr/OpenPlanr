import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { createDaemon } from '../../lib/design-engine/daemon.mjs';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', '..', 'lib', 'design-engine', 'cli.mjs');

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
