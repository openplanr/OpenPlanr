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
 *   GET  /boards/<id>/api/feedback     → the durable feedback record (normalizeLegacy'd), or
 *                                        { authors: [], items: [] } when no file exists yet
 *   POST /boards/<id>/api/feedback     → { kind: submit|pending, feedback } → MERGES (never
 *                                        overwrites) into the durable store under the board mutex
 *   POST /boards/<id>/api/reload       → bump reloadGen (board polls it and swaps HTML in-tab)
 *
 * durable, multi-author feedback (load + merge persistence path).
 * The feedback file is the single source of truth; the board is a live projection of it.
 *   - GET loads + normalizes the durable record so a refresh/re-serve never starts empty.
 *   - POST reads the current durable file, mergeFeedback()s the contribution in, and writes
 *     the result — all serialized on the per-board mutex so one author's submit can never
 *     wipe another author's (or an earlier) pins. The raw request body is never written verbatim.
 *   - A "pending" round is reconciled INTO the durable store (not consumed-and-deleted), so
 *     the destructive feedback-pending.json delete that dropped data is gone.
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
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { daemonDir } from './paths.mjs';
import { MIME } from '../design/mime-types.mjs';
import { serveStaticFile } from '../design/path-util.mjs';
import {
  clampPin, assertValidFeedback, mergeFeedback, normalizeLegacy, isDeleteMarker,
  FEEDBACK_FILE, PENDING_FILE,
} from './feedback.mjs';

// Shared server-lifecycle primitives live in server-util.mjs (used by both this daemon and the
// dashboard server). Re-exported here for back-compat with importers that reach for them on daemon.
export {
  writePidFile, readPidFile, isProcessAlive, isPortInUse,
} from './server-util.mjs';

/**
 * Daemon behaviour version. Bumped whenever the server's contract changes (e.g.
 * the non-enumerating index, registry pruning) so `ensureDaemon` can detect a
 * daemon running stale code and restart it instead of reusing it forever. A
 * daemon started before this field existed reports no version → treated as stale.
 */
export const DAEMON_VERSION = 2;

/** Cap on a request body (bytes) — a feedback round is small; this bounds memory per request. */
const MAX_BODY_SIZE = 5_000_000;

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolveBody, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > MAX_BODY_SIZE) reject(new Error('body too large'));
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

  // Startup hygiene: prune the registry so it never serves a vanished dir or a
  // legacy entry that predates capability tokens (which would leak across projects).
  (() => {
    const reg = loadRegistry();
    let changed = false;
    for (const [id, dir] of Object.entries(reg)) {
      if (!existsSync(dir) || !/--[a-f0-9]{16,}$/.test(id)) { delete reg[id]; changed = true; }
    }
    if (changed) saveRegistry(reg);
  })();

  const reloadGen = new Map(); // boardId → counter
  const mutex = new Map(); // boardId → promise chain
  const locked = (id, fn) => {
    const tail = (mutex.get(id) ?? Promise.resolve()).then(fn, fn);
    mutex.set(id, tail.catch(() => {}));
    return tail;
  };

  /* ------------------------------------------------------------------ *
   * live collaboration via Server-Sent Events.
   *
   * The daemon keeps an in-memory registry of every open SSE connection per
   * board (keyed by boardId). It is the ONLY ephemeral, non-file state the
   * board owns — presence is a transient "who's looking right now" signal, not
   * durable feedback, so it is intentionally never persisted (hard rule: the
   * feedback file is the single source of truth; presence is not feedback).
   *
   * Each entry is a { name, initials, color, res } record so we can (a) write
   * SSE frames to the response stream, and (b) deduplicate presence by name so
   * one reviewer with two tabs open surfaces as a single avatar.
   *
   * If no tab is connected (the stream is unavailable), every broadcast is a
   * silent no-op and the board still works fully through load + merge-on-submit
   * — live sync degrades cleanly, it is never required for correctness.
   * ------------------------------------------------------------------ */
  const presence = {
    clients: new Map(), // boardId → Set<{ name, initials, color, res }>

    /** Frame one SSE event for a single client. Named event + JSON data payload. */
    write(res, eventName, data) {
      try {
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* a half-closed stream throws on write — the close handler prunes it */
      }
    },

    /** Broadcast a named event with a JSON payload to every connected client of a board. */
    broadcast(boardId, eventName, data) {
      const clients = this.clients.get(boardId);
      if (!clients) return;
      for (const client of clients) this.write(client.res, eventName, data);
    },

    /**
     * The deduplicated roster for a board: each distinct reviewer NAME appears once (two tabs by
     * the same reviewer collapse to a single avatar), carrying only the display-safe
     * { name, initials, color } — never the response stream or any PII.
     */
    roster(boardId) {
      const clients = this.clients.get(boardId);
      if (!clients) return [];
      const byName = new Map();
      for (const { name, initials, color } of clients) {
        if (!byName.has(name)) byName.set(name, { name, initials, color });
      }
      return [...byName.values()];
    },
  };

  const boardDir = (id) => {
    const dir = loadRegistry()[id];
    return dir && existsSync(dir) ? dir : null;
  };

  // boards we've already announced the mutex-guarded merge path for,
  // so the startup/registration log line is emitted once per board, not per request.
  const mutexAnnounced = new Set();
  const announceMutexPath = (id) => {
    if (mutexAnnounced.has(id)) return;
    mutexAnnounced.add(id);
    process.stderr.write(`[feedback] mutex-guarded merge path active for board ${id}\n`);
  };

  /**
   * read the durable feedback record for a board and normalize it so every pin
   * carries an author + stable id (legacy/unattributed files load as "Anonymous"). Returns
   * null when the file is absent or unparseable — callers decide the empty/fallback shape.
   */
  const readStored = (dir) => {
    const file = join(dir, FEEDBACK_FILE);
    if (!existsSync(file)) return null;
    try {
      return normalizeLegacy(JSON.parse(readFileSync(file, 'utf-8')));
    } catch {
      return null;
    }
  };

  /**
   * reconcile any leftover feedback-pending.json into the durable store, then
   * leave the pending file as an empty record. The previous board version consumed-and-deleted
   * the pending file on read, which dropped other authors' pins — here it is MERGED, never
   * destroyed. Best-effort + serialized on the board mutex; a parse error skips reconciliation
   * rather than corrupting the durable file.
   */
  const reconcilePending = (id, dir) =>
    locked(id, () => {
      const pendingPath = join(dir, PENDING_FILE);
      if (!existsSync(pendingPath)) return;
      let pending;
      try {
        pending = JSON.parse(readFileSync(pendingPath, 'utf-8'));
      } catch {
        return; // unreadable pending round — leave it untouched, never destroy the durable store
      }
      const merged = mergeFeedback(readStored(dir) ?? {}, pending);
      try {
        assertValidFeedback(merged);
      } catch {
        return; // refuse to write an invalid durable record
      }
      writeFileSync(join(dir, FEEDBACK_FILE), `${JSON.stringify(merged, null, 2)}\n`);
      // The pending round is now folded into the durable store. Empty it (rather than delete)
      // so a stale round can never be double-applied, while keeping the file's existence intact.
      writeFileSync(pendingPath, `${JSON.stringify({ pins: [], authors: [] }, null, 2)}\n`);
    });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);

      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, 200, { ok: true, pid: process.pid, version: DAEMON_VERSION, boards: Object.keys(loadRegistry()).length });
      }

      if (req.method === 'GET' && url.pathname === '/') {
        // The root never enumerates boards: the registry spans every project on
        // this machine, and listing it would leak other projects' names into a
        // shared/screenshared review URL. A board is reachable only via its own
        // capability URL (/boards/<slug>--<token>/), printed by the command.
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset="utf-8"><title>planr design boards</title>
<body style="font:15px system-ui;padding:32px"><h1>planr design boards</h1>
<p>Open the board with the exact URL printed by your design command. Boards are not listed here.</p>`);
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
        // confirm the mutex-guarded merge path is active for this board and fold any
        // leftover pending round into the durable store (non-destructively) on (re-)register.
        announceMutexPath(id);
        reconcilePending(id, registry[id]);
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
          // GET /api/feedback/stream — the live collaboration channel. A
          // long-lived SSE connection; the daemon pushes presence:join/leave (the deduplicated
          // roster) and feedback:update (the merged item after each POST). Identity is read from
          // the query (?name=&initials=&color=) — a LOCAL display name + avatar only, no auth/PII.
          if (req.method === 'GET' && parts[3] === 'feedback' && parts[4] === 'stream') {
            const name = (url.searchParams.get('name') || 'Anonymous').trim() || 'Anonymous';
            const initials = (url.searchParams.get('initials') || '').trim();
            const color = (url.searchParams.get('color') || '').trim();

            res.writeHead(200, {
              'content-type': 'text/event-stream; charset=utf-8',
              'cache-control': 'no-cache',
              connection: 'keep-alive',
              // SSE behind a proxy: disable response buffering so events flush immediately.
              'x-accel-buffering': 'no',
            });
            // Open the stream with a comment frame so the client's EventSource fires `onopen`
            // promptly even before the first real event.
            res.write(': connected\n\n');

            const client = { name, initials, color, res };
            if (!presence.clients.has(id)) presence.clients.set(id, new Set());
            const clients = presence.clients.get(id);
            clients.add(client);

            // Announce the grown roster to the other clients (the joiner doesn't get its own join).
            for (const other of clients) {
              if (other !== client) presence.write(other.res, 'presence:join', { roster: presence.roster(id) });
            }

            req.on('close', () => {
              clients.delete(client);
              if (clients.size === 0) {
                presence.clients.delete(id);
              } else {
                // Notify the remaining clients with the post-leave deduplicated roster.
                presence.broadcast(id, 'presence:leave', { roster: presence.roster(id) });
              }
            });
            return; // keep the connection open — no res.end()
          }
          // GET the durable feedback record for the board's initial load — never a fetch
          // error. No file yet → a valid empty record (the designed "no feedback yet" state).
          // Read-only: it must NOT delete feedback-pending.json.
          if (req.method === 'GET' && parts[3] === 'feedback') {
            const stored = readStored(dir);
            return json(res, 200, stored ?? { authors: [], items: [] });
          }
          if (req.method === 'POST' && parts[3] === 'feedback') {
            const body = JSON.parse(await readBody(req) || '{}');
            const kind = body.kind === 'pending' ? 'pending' : 'submit';
            const raw = body.feedback ?? {};
            // a contribution may carry DELETE MARKERS ({ id, author, deleted:true })
            // alongside (or instead of) real pins. Markers are instructions, not stored items, so they
            // are NOT clamped (no coords to normalize) and they must bypass the schema gate — a marker
            // intentionally omits the required pin fields. We clamp only real pins, validate a
            // marker-free view of the contribution, then hand the FULL contribution (markers included)
            // to mergeFeedback so the author-scoped removal happens under the same mutex.
            const rawPins = Array.isArray(raw.pins) ? raw.pins : [];
            raw.pins = rawPins.map((p) => (isDeleteMarker(p) ? p : clampPin(p)));
            // normalize the incoming round first — fill author ("Anonymous") + the
            // content-derived stable id on every pin — so a client that doesn't pre-assign ids
            // stays compatible, and the same logical pin keys consistently across submits. The
            // contribution must then itself be a valid feedback object before we fold it in, so a
            // malformed body is rejected up front and never reaches the durable file.
            const contribution = normalizeLegacy(raw);
            // Validate a marker-free view: delete markers are deliberately not schema-shaped pins.
            const validatable = { ...contribution, pins: (contribution.pins ?? []).filter((p) => !isDeleteMarker(p)) };
            try {
              assertValidFeedback(validatable);
            } catch (e) {
              return json(res, 400, { error: e.message });
            }
            announceMutexPath(id);

            // A "pending" round is the design-loop's regenerate/remix handshake: written to its own
            // PENDING_FILE (mutex-serialized so it can't interleave with a reload) and NOT folded
            // into the durable store. The destructive part removed was the load-side
            // consume that dropped other authors' durable pins — a pending write never touches
            // feedback.json. It's a generation request, never a lifecycle edit, so it carries no
            // delete markers and the marker-free, schema-valid view is what's written.
            if (kind === 'pending') {
              await locked(id, () => {
                writeFileSync(join(dir, PENDING_FILE), `${JSON.stringify(validatable, null, 2)}\n`);
              });
              return json(res, 200, { ok: true, kind });
            }

            // submit → MERGE into the durable store, never overwrite. Read-merge-write runs INSIDE
            // the per-board lock so two concurrent POSTs can't interleave a half-written file or
            // clobber each other; the raw request body is never written verbatim.
            let result;
            try {
              await locked(id, () => {
                const stored = readStored(dir) ?? {};
                const merged = mergeFeedback(stored, contribution);
                assertValidFeedback(merged);
                writeFileSync(join(dir, FEEDBACK_FILE), `${JSON.stringify(merged, null, 2)}\n`);
                result = merged;
              });
            } catch (e) {
              return json(res, 500, { error: String(e.message ?? e) });
            }
            // fan the merge out to every tab viewing this board over SSE. The
            // event carries only the single changed item(s) from this contribution — looked up by
            // (id + author) in the just-merged record so the canonical post-merge state is sent —
            // not the whole file. A contribution is normally one pin (a drop/edit/reply/resolve);
            // deletes carry no surviving item, so we skip those (the client re-fetches if needed).
            // This runs inside the POST handler so connected clients see the update within the
            // request's lifetime (~1s). No connected clients → a silent no-op.
            const mergedByKey = new Map(
              (Array.isArray(result?.pins) ? result.pins : []).map((p) => [`${p.id} ${p.author}`, p]),
            );
            for (const cp of Array.isArray(contribution.pins) ? contribution.pins : []) {
              const item = mergedByKey.get(`${cp.id} ${cp.author}`);
              if (item) presence.broadcast(id, 'feedback:update', { item });
            }
            return json(res, 200, { ok: true, kind, feedback: result });
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
          const rel = parts.slice(2).join('/');
          serveStaticFile(res, dir, rel || 'board.html', MIME);
          return;
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
    if (res.ok) {
      const health = await res.json().catch(() => ({}));
      return { port, pid: health.pid ?? null, version: health.version ?? null };
    }
  } catch {
    /* dead daemon — caller starts a fresh one (rule 14) */
  }
  return null;
}

/**
 * Kill a running daemon process (identified by findRunningDaemon). Best-effort:
 * sends SIGTERM, waits 200ms for the OS to release the listener.
 * Safe to call with null/undefined running.
 */
export async function killRunningDaemon(running) {
  if (!running || !running.pid) return;
  try { process.kill(running.pid); } catch { /* already gone, or not ours */ }
  await new Promise((r) => setTimeout(r, 200));
}

// CLI entry: `node daemon.mjs --serve [port]`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && process.argv.includes('--serve')) {
  const portArg = Number(process.argv[process.argv.indexOf('--serve') + 1]) || 0;
  const daemon = createDaemon();
  daemon.listen(portArg).then((port) => {
    process.stderr.write(`DAEMON_PORT: ${port}\n`);
  });
}
