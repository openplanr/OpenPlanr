/** Private owned dashboard custody; shutdown is authenticated, never inferred from a PID. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readPrivateJsonState,
  writePrivateJsonState,
} from '../../artifact/internal/server-util.mjs';
import { DASHBOARD_SERVER_KIND, readPackageVersion } from './identity.mjs';
import { planrHome } from './platform.mjs';

const INSTANCE = /^[A-Za-z0-9_-]{22}$/u;
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const runtimeRoot = fileURLToPath(new URL('../../../', import.meta.url));
const failure = (cause) =>
  Object.assign(new Error('Owned dashboard custody is unsafe or malformed.', { cause }), {
    code: 'E_SERVER_CUSTODY_UNSAFE',
  });
const directory = (env) => join(planrHome(env), 'dashboard-daemon', 'instances');

function readState(path) {
  try {
    const state = readPrivateJsonState(path);
    if (state === null) return null;
    if (
      !state ||
      Object.keys(state).sort().join(',') !==
        'controlToken,instanceId,kind,pid,port,projectRoot,runtimeRoot,schemaVersion,startedAt' ||
      state.schemaVersion !== '1.0.0' ||
      state.kind !== 'dashboard' ||
      !INSTANCE.test(state.instanceId) ||
      !TOKEN.test(state.controlToken) ||
      !Number.isInteger(state.pid) ||
      state.pid <= 0 ||
      !Number.isInteger(state.port) ||
      state.port < 1 ||
      state.port > 65535 ||
      typeof state.projectRoot !== 'string' ||
      typeof state.runtimeRoot !== 'string' ||
      typeof state.startedAt !== 'string' ||
      !Number.isFinite(Date.parse(state.startedAt))
    )
      throw failure();
    return state;
  } catch (error) {
    if (error.code === 'E_SERVER_CUSTODY_UNSAFE') throw error;
    throw failure(error);
  }
}

async function control(state, path, { fetchImpl = fetch, method = 'GET' } = {}) {
  const response = await fetchImpl(`http://127.0.0.1:${state.port}/internal/v1/${path}`, {
    method,
    headers: {
      'x-openplanr-control': state.controlToken,
      'x-openplanr-instance': state.instanceId,
    },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok)
    throw Object.assign(new Error('The owned dashboard is unavailable or changed.'), {
      code: 'E_SERVER_INSTANCE_CHANGED',
    });
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) throw failure();
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (
    value?.instanceId !== state.instanceId ||
    value.pid !== state.pid ||
    value.kind !== DASHBOARD_SERVER_KIND
  )
    throw failure();
  return value;
}

export function createDashboardLifecycle({ projectRoot, watch, close }) {
  const instanceId = randomBytes(16).toString('base64url');
  const controlToken = randomBytes(32).toString('base64url');
  const startedAt = new Date().toISOString();
  const binding = createHash('sha256')
    .update(JSON.stringify({ projectRoot, runtimeRoot, watch, version: readPackageVersion() }))
    .digest('hex');
  let statePath = null;
  let stopping = false;
  const health = () => ({
    ok: true,
    instanceId,
    binding,
    pid: process.pid,
    kind: DASHBOARD_SERVER_KIND,
    version: readPackageVersion(),
    status: stopping ? 'stopping' : 'running',
  });
  return {
    health,
    register(port, env) {
      const dir = directory(env);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const stat = lstatSync(dir);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        stat.mode & 0o077 ||
        (process.getuid && stat.uid !== process.getuid())
      )
        throw failure();
      statePath = join(dir, `instance-${instanceId}.json`);
      writePrivateJsonState(statePath, {
        schemaVersion: '1.0.0',
        kind: 'dashboard',
        instanceId,
        controlToken,
        pid: process.pid,
        port,
        projectRoot,
        runtimeRoot,
        startedAt,
      });
    },
    release() {
      if (!statePath) return;
      const state = readState(statePath);
      if (state?.instanceId === instanceId && state.controlToken === controlToken)
        rmSync(statePath, { force: true });
      statePath = null;
    },
    handle({ req, res, pathname }) {
      const supplied = req.headers['x-openplanr-control'];
      const authenticated =
        typeof supplied === 'string' &&
        TOKEN.test(supplied) &&
        timingSafeEqual(Buffer.from(supplied), Buffer.from(controlToken)) &&
        req.headers['x-openplanr-instance'] === instanceId;
      res.setHeader('cache-control', 'no-store');
      res.setHeader('content-type', 'application/json');
      if (!authenticated) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'Owned instance authentication required.' }));
        return;
      }
      if (pathname.endsWith('/shutdown')) {
        if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) !== 0) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Shutdown accepts no body.' }));
          return;
        }
        stopping = true;
        res.once('finish', () => {
          void close().catch(() => {
            process.stderr.write(
              'E_SERVER_SHUTDOWN: The dashboard stopped but its custody cleanup needs recovery.\n',
            );
            process.exitCode = 1;
          });
        });
      }
      res.end(JSON.stringify(health()));
    },
  };
}

export async function listDashboardServers({ env = process.env, fetchImpl = fetch } = {}) {
  const dir = directory(env);
  let names;
  try {
    const stat = lstatSync(dir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.mode & 0o077 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw failure();
    names = readdirSync(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const result = [];
  for (const name of names.sort()) {
    if (!/^instance-[A-Za-z0-9_-]{22}\.json$/u.test(name)) continue;
    const state = readState(join(dir, name));
    if (!state) continue;
    try {
      const health = await control(state, 'health', { fetchImpl });
      const { controlToken: _secret, schemaVersion: _version, ...publicState } = state;
      result.push({
        ...publicState,
        url: `http://127.0.0.1:${state.port}/`,
        status: health.status,
      });
    } catch {
      /* Unreachable custody is retained; it never authorizes a process signal. */
    }
  }
  return result;
}

export async function stopDashboardServer(
  instanceId,
  { env = process.env, fetchImpl = fetch } = {},
) {
  if (!INSTANCE.test(instanceId)) throw failure();
  const state = readState(join(directory(env), `instance-${instanceId}.json`));
  if (!state)
    throw Object.assign(new Error('The owned dashboard is stopped or unavailable.'), {
      code: 'E_SERVER_INSTANCE_CHANGED',
    });
  await control(state, 'health', { fetchImpl });
  return control(state, 'shutdown', { fetchImpl, method: 'POST' });
}
