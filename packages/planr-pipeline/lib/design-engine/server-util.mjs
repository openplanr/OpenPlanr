/**
 * Shared server-lifecycle primitives for the project's persistent localhost servers
 * (the board daemon and the dashboard server). Both need the same three things: write/read
 * a port-keyed PID file, probe whether a TCP port is already accepting connections, and
 * confirm a process is alive. They live here so neither surface owns a duplicate copy.
 */

import { createConnection } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Write a PID file at `<dir>/<port>` holding the current process id. */
export function writePidFile(dir, port, pid = process.pid) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, String(port)), `${pid}\n`);
}

/** Read the pid recorded at `<dir>/<port>`, or null if absent/unreadable. */
export function readPidFile(dir, port) {
  const file = join(dir, String(port));
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, 'utf-8').trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** True when a process with `pid` is currently alive (signal 0 probe). */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is owned by another user.
    return err && err.code === 'EPERM';
  }
}

/**
 * Resolve to true when `port` on `host` already accepts a TCP connection
 * (i.e. a server owns it). Never rejects — a refused/timed-out probe
 * resolves false. Used for reuse-if-running detection.
 */
export function isPortInUse(port, { host = '127.0.0.1', timeout = 500 } = {}) {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ port, host });
    let settled = false;
    const done = (inUse) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(inUse);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}
