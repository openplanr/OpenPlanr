/**
 * Board daemon v2 — a persistent localhost HTTP server, INDEPENDENT of the
 * agent (hard rule 14): the board keeps working if the agent dies, and the
 * agent copes with a dead daemon by re-`board`ing the same dir.
 *
 * Endpoints
 *   GET  /health                       → { ok, pid, boards }
 *   GET  /                             → board index
 *   POST /api/boards                   → { id, dir } register (dir must hold board.html)
 *   GET  /boards/<id>/                 → the board HTML
 *   GET  /boards/<id>/<file>           → static asset from the board dir (traversal-guarded)
 *   GET  /boards/<id>/api/progress     → progress.json + reloadGen
 *   POST /boards/<id>/api/feedback     → { kind: submit|pending, feedback } → writes the file
 *   POST /boards/<id>/api/reload       → bump reloadGen (board polls it and swaps HTML in-tab)
 *
 * PROGRESS IS A FILE (documented decision): the agent writes progress.json next
 * to board.html; the daemon only reads it. Same philosophy as the feedback
 * handshake — the agent side stays dumb, file-driven, and crash-safe.
 *
 * A per-board MUTEX serializes feedback-writes vs reload-bumps so a reload can
 * never interleave with a half-written feedback file.
 *
 * State: <planrHome>/design-daemon/{port,boards.json}. Localhost only.
 */

import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync,
} from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';

import { daemonDir } from './paths.mjs';
import { clampPin, assertValidFeedback, FEEDBACK_FILE, PENDING_FILE } from './feedback.mjs';

/* ------------------------------------------------------------------ *
 * Shared server-lifecycle helpers (extracted in SPEC-016/T-001).
 *
 * The board daemon and the dashboard server both need the same three
 * primitives: write/read a port-keyed PID file, probe whether a TCP
 * port is already accepting connections, and confirm a process is alive.
 * They live here (the original server module) so neither surface owns a
 * duplicate copy. Existing board-daemon behaviour is unchanged — these
 * are additive exports only.
 * ------------------------------------------------------------------ */

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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolveBody, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolveBody(data));
    req.on('error', reject);
  });

export function createDaemon({ env = process.env } = {}) {
  const stateDir = daemonDir(env);
  mkdirSync(stateDir, { recursive: true });
  const registryPath = join(stateDir, 'boards.json');

  const loadRegistry = () => {
    try {
      return existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf-8')) : {};
    } catch {
      return {};
    }
  };
  const saveRegistry = (r) => writeFileSync(registryPath, `${JSON.stringify(r, null, 2)}\n`);

  const reloadGen = new Map(); // boardId → counter
  const mutex = new Map(); // boardId → promise chain
  const locked = (id, fn) => {
    const tail = (mutex.get(id) ?? Promise.resolve()).then(fn, fn);
    mutex.set(id, tail.catch(() => {}));
    return tail;
  };

  const boardDir = (id) => {
    const dir = loadRegistry()[id];
    return dir && existsSync(dir) ? dir : null;
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);

      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, 200, { ok: true, pid: process.pid, boards: Object.keys(loadRegistry()).length });
      }

      if (req.method === 'GET' && url.pathname === '/') {
        const registry = loadRegistry();
        const rows = Object.keys(registry)
          .map((id) => `<li><a href="/boards/${encodeURIComponent(id)}/">${id}</a></li>`)
          .join('') || '<li>(no boards yet)</li>';
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset="utf-8"><title>planr design boards</title>
<body style="font:15px system-ui;padding:32px"><h1>planr design boards</h1><ul>${rows}</ul>`);
      }

      if (req.method === 'POST' && url.pathname === '/api/boards') {
        const { id, dir } = JSON.parse(await readBody(req) || '{}');
        if (!id || !dir) return json(res, 400, { error: 'id and dir required' });
        if (!existsSync(join(dir, 'board.html'))) {
          return json(res, 400, { error: `no board.html in ${dir}` });
        }
        const registry = loadRegistry();
        registry[id] = resolve(dir);
        saveRegistry(registry);
        if (!reloadGen.has(id)) reloadGen.set(id, 0);
        return json(res, 200, { ok: true, url: `/boards/${encodeURIComponent(id)}/` });
      }

      if (parts[0] === 'boards' && parts.length >= 2) {
        const id = decodeURIComponent(parts[1]);
        const dir = boardDir(id);
        if (!dir) return json(res, 404, { error: `unknown board "${id}"` });

        // Canonical trailing slash: /boards/<id> (no slash) must NOT serve the
        // page — the browser would resolve every relative URL (variant-A.png,
        // api/progress, api/feedback) against /boards/ and the whole board
        // silently breaks (404 images, dead polling, lost feedback). Terminal
        // linkifiers routinely drop the trailing slash from BOARD_URL, so
        // redirect instead of serving.
        if (parts.length === 2 && !url.pathname.endsWith('/')) {
          res.writeHead(301, { location: `/boards/${encodeURIComponent(id)}/` });
          return res.end();
        }

        // /boards/<id>/api/…
        if (parts[2] === 'api') {
          if (req.method === 'GET' && parts[3] === 'progress') {
            let progress = {};
            const p = join(dir, 'progress.json');
            if (existsSync(p)) {
              try { progress = JSON.parse(readFileSync(p, 'utf-8')); } catch { progress = { parseError: true }; }
            }
            return json(res, 200, { ...progress, reloadGen: reloadGen.get(id) ?? 0 });
          }
          if (req.method === 'POST' && parts[3] === 'feedback') {
            const body = JSON.parse(await readBody(req) || '{}');
            const kind = body.kind === 'pending' ? 'pending' : 'submit';
            const feedback = body.feedback ?? {};
            feedback.pins = (feedback.pins ?? []).map(clampPin);
            try {
              assertValidFeedback(feedback);
            } catch (e) {
              return json(res, 400, { error: e.message });
            }
            await locked(id, () => {
              const file = kind === 'pending' ? PENDING_FILE : FEEDBACK_FILE;
              writeFileSync(join(dir, file), `${JSON.stringify(feedback, null, 2)}\n`);
            });
            return json(res, 200, { ok: true, kind });
          }
          if (req.method === 'POST' && parts[3] === 'reload') {
            await locked(id, () => reloadGen.set(id, (reloadGen.get(id) ?? 0) + 1));
            return json(res, 200, { ok: true, reloadGen: reloadGen.get(id) });
          }
          return json(res, 404, { error: 'unknown api route' });
        }

        // static: /boards/<id>/ → board.html, else the named file (traversal-guarded).
        // HEAD is honored like GET (Node omits the body automatically).
        if (req.method === 'GET' || req.method === 'HEAD') {
          const rel = parts.slice(2).join('/') || 'board.html';
          // realpath BEFORE resolving: macOS tmp dirs are symlinks (/var → /private/var),
          // and the guard must compare like with like.
          const realDir = realpathSync(dir);
          const abs = resolve(realDir, rel);
          if (abs !== realDir && !abs.startsWith(realDir + sep)) {
            return json(res, 403, { error: 'path traversal blocked' });
          }
          if (!existsSync(abs)) return json(res, 404, { error: `not found: ${rel}` });
          res.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream' });
          return res.end(readFileSync(abs));
        }
      }

      return json(res, 404, { error: 'not found' });
    } catch (err) {
      return json(res, 500, { error: String(err.message ?? err) });
    }
  });

  return {
    server,
    /** Start on 127.0.0.1; port 0 = ephemeral. Persists the port for discovery. */
    listen(port = 0) {
      return new Promise((resolveListen) => {
        server.listen(port, '127.0.0.1', () => {
          const actual = server.address().port;
          writeFileSync(join(stateDir, 'port'), String(actual));
          resolveListen(actual);
        });
      });
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Discover a running daemon: read the port file, confirm /health answers. */
export async function findRunningDaemon({ env = process.env, fetchImpl = fetch } = {}) {
  const portFile = join(daemonDir(env), 'port');
  if (!existsSync(portFile)) return null;
  const port = Number(readFileSync(portFile, 'utf-8').trim());
  if (!port) return null;
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) });
    if (res.ok) return { port };
  } catch {
    /* dead daemon — caller starts a fresh one (rule 14) */
  }
  return null;
}

// CLI entry: `node daemon.mjs --serve [port]`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && process.argv.includes('--serve')) {
  const portArg = Number(process.argv[process.argv.indexOf('--serve') + 1]) || 0;
  const daemon = createDaemon();
  daemon.listen(portArg).then((port) => {
    process.stderr.write(`DAEMON_PORT: ${port}\n`);
  });
}
