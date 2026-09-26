/**
 * Shared server-lifecycle primitives for the project's persistent localhost servers
 * (the board daemon and the dashboard server). Both need the same three things: write/read
 * a port-keyed PID file, probe whether a TCP port is already accepting connections, and
 * confirm a process is alive. They live here so neither surface owns a duplicate copy.
 */

import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';

export const LOOPBACK_HOST = '127.0.0.1';

function codedError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

/** Write a PID file at `<dir>/<port>` holding the current process id. */
export function writePidFile(dir, port, pid = process.pid) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, String(port)), `${pid}\n`);
}

/** Read a JSON state file, returning null for absent, malformed, or non-object state. */
export function readJsonState(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Atomically replace a private JSON state file. The temporary and final files
 * are user-readable only so control capabilities never inherit a permissive
 * umask. Callers own the schema; this helper owns only safe persistence.
 */
export function writePrivateJsonState(path, value, { mode = 0o600 } = {}) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
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

/**
 * Bind an HTTP server exclusively to IPv4 loopback. Errors reject instead of
 * leaving callers waiting forever on a missing `listening` event.
 */
export function listenLoopback(server, port = 0, { host = LOOPBACK_HOST } = {}) {
  if (host !== LOOPBACK_HOST) {
    return Promise.reject(
      codedError('E_LOOPBACK_HOST', `Refusing non-loopback bind host: ${host}`),
    );
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    return Promise.reject(codedError('E_LOOPBACK_PORT', `Invalid loopback port: ${String(port)}`));
  }
  return new Promise((resolveListen, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string' || address.address !== LOOPBACK_HOST) {
        closeHttpServer(server).finally(() =>
          reject(
            codedError(
              'E_LOOPBACK_BIND',
              'Server did not bind to the required IPv4 loopback interface.',
            ),
          ),
        );
        return;
      }
      resolveListen(address.port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ port, host, exclusive: true });
  });
}

/** Close a server deterministically, including idle/streaming test clients. */
export function closeHttpServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

/**
 * Read a request body with an exact byte ceiling. Data beyond the ceiling is
 * drained but never retained, allowing the handler to return a stable 413.
 */
export function readRequestBody(req, { maxBytes, encoding = null } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    return Promise.reject(
      codedError('E_REQUEST_BODY_LIMIT', 'A positive request byte limit is required.'),
    );
  }
  const declared = Number(req.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    req.resume?.();
    return Promise.reject(
      codedError('E_REQUEST_BODY_LIMIT', `Request body exceeds ${maxBytes} bytes.`, {
        maxBytes,
        declaredBytes: declared,
      }),
    );
  }
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maxBytes) {
        chunks.length = 0;
        rejectOnce(
          codedError('E_REQUEST_BODY_LIMIT', `Request body exceeds ${maxBytes} bytes.`, {
            maxBytes,
            receivedBytes: bytes,
          }),
        );
        return;
      }
      if (!settled) chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const body = Buffer.concat(chunks, bytes);
      resolveBody(encoding ? body.toString(encoding) : body);
    });
    req.on('error', rejectOnce);
    req.on('aborted', () =>
      rejectOnce(codedError('E_REQUEST_ABORTED', 'Request body was aborted.')),
    );
  });
}

/**
 * Reject DNS-rebinding/cross-site browser requests before route dispatch. GET
 * navigations may omit Origin; state-changing browser calls must provide the
 * exact loopback origin. Internal CLI calls opt into origin-less mutation.
 */
export function assertLoopbackRequest(
  req,
  { port, mutating = false, internal = false, hosts = [LOOPBACK_HOST] } = {},
) {
  const allowedHosts = new Set(hosts);
  const hostHeaders = req.headersDistinct?.host;
  const receivedHost = req.headers?.host;
  const separator = typeof receivedHost === 'string' ? receivedHost.lastIndexOf(':') : -1;
  const receivedName = separator > 0 ? receivedHost.slice(0, separator) : '';
  const receivedPort = separator > 0 ? receivedHost.slice(separator + 1) : '';
  const expectedHost = `${receivedName}:${port}`;
  const expectedOrigin = `http://${expectedHost}`;
  if (
    !allowedHosts.has(receivedName) ||
    receivedPort !== String(port) ||
    (Array.isArray(hostHeaders) && hostHeaders.length !== 1)
  ) {
    throw codedError('E_LOOPBACK_HOST', 'Loopback Host header rejected.');
  }
  const origin = req.headers?.origin;
  if (origin !== undefined && origin !== expectedOrigin) {
    throw codedError('E_LOOPBACK_ORIGIN', 'Loopback Origin header rejected.');
  }
  if (mutating && !internal && origin !== expectedOrigin) {
    throw codedError(
      'E_LOOPBACK_ORIGIN',
      'State-changing browser requests require the exact loopback origin.',
    );
  }
  if (internal && origin !== undefined) {
    throw codedError(
      'E_LOOPBACK_ORIGIN',
      'Internal control requests must not carry a browser Origin.',
    );
  }
  const fetchSite = String(req.headers?.['sec-fetch-site'] ?? '').toLowerCase();
  if (fetchSite && !['none', 'same-origin'].includes(fetchSite)) {
    throw codedError('E_LOOPBACK_FETCH_SITE', 'Cross-site loopback request rejected.');
  }
  return { expectedHost, expectedOrigin };
}

/** Probe a loopback JSON health endpoint without ever throwing. */
export async function probeLoopbackJson(
  port,
  path = '/health',
  { fetchImpl = fetch, timeout = 800 } = {},
) {
  try {
    const response = await fetchImpl(`http://${LOOPBACK_HOST}:${port}${path}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) return null;
    const value = await response.json();
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

/**
 * Acquire a cross-process startup lock. Only a dead owner's lock is removed;
 * an alive but slow owner is allowed to finish or the waiter times out.
 */
export async function acquireStartLock(
  path,
  {
    timeout = 5_000,
    poll = 25,
    pid = process.pid,
    now = () => Date.now(),
    isAlive = isProcessAlive,
    waitImpl = wait,
  } = {},
) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const started = now();

  // Older releases used one shared lock file. Removing that pathname after
  // inspecting it is inherently racy because another legacy process can replace
  // it before unlink. Fail closed and preserve the record for explicit cleanup.
  if (existsSync(path)) {
    throw codedError(
      'E_START_LOCK_LEGACY',
      `A legacy startup lock must be cleared after confirming its owner is stopped: ${path}`,
    );
  }

  const directory = `${path}.writers`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = lstatSync(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw codedError('E_START_LOCK_UNSAFE', `Startup lock directory is unsafe: ${directory}`);
  }
  const owner = randomBytes(16).toString('hex');
  const name = `${pid}-${owner}.json`;
  const recordPath = join(directory, name);

  const announce = (ticket) => writePrivateJsonState(recordPath, { pid, owner, ticket });
  const writers = () => {
    const result = [];
    for (const entry of readdirSync(directory)) {
      if (!entry.endsWith('.json')) continue;
      const match = /^([1-9]\d*)-([a-f0-9]{32})\.json$/u.exec(entry);
      if (!match)
        throw codedError('E_START_LOCK_UNSAFE', `Startup lock record is invalid: ${entry}`);
      const entryPath = join(directory, entry);
      let info;
      try {
        info = lstatSync(entryPath);
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) {
        throw codedError('E_START_LOCK_UNSAFE', `Startup lock record is unsafe: ${entry}`);
      }
      const value = readJsonState(entryPath);
      if (
        value?.pid !== Number(match[1]) ||
        value?.owner !== match[2] ||
        !Number.isSafeInteger(value.ticket) ||
        value.ticket < 0
      )
        throw codedError('E_START_LOCK_UNSAFE', `Startup lock record is invalid: ${entry}`);
      if (!isAlive(value.pid)) {
        // Writer names are random and never reused. Reclaimers can remove this
        // exact dead writer without risking a later owner's record.
        rmSync(entryPath, { force: true });
        continue;
      }
      result.push({ ...value, name: entry });
    }
    return result;
  };

  try {
    announce(0);
    const ticket = Math.max(0, ...writers().map((writer) => writer.ticket)) + 1;
    if (!Number.isSafeInteger(ticket)) {
      throw codedError('E_START_LOCK_UNSAFE', 'Startup lock ticket limit reached.');
    }
    announce(ticket);
    while (now() - started <= timeout) {
      const blocked = writers().some(
        (writer) =>
          writer.name !== name &&
          (writer.ticket === 0 ||
            writer.ticket < ticket ||
            (writer.ticket === ticket && writer.name < name)),
      );
      if (!blocked) {
        return () => {
          const current = readJsonState(recordPath);
          if (current?.owner === owner && current?.pid === pid) rmSync(recordPath, { force: true });
        };
      }
      await waitImpl(poll);
    }
    throw codedError('E_START_LOCK_TIMEOUT', `Timed out waiting for startup lock: ${path}`);
  } catch (error) {
    rmSync(recordPath, { force: true });
    throw error;
  }
}
