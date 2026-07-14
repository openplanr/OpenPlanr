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
  existsSync, mkdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import {
  basename, dirname, extname, join, resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import { daemonDir } from './paths.mjs';
import {
  closeHttpServer,
  listenLoopback,
  readRequestBody,
} from './server-util.mjs';
import { MIME } from '../design/mime-types.mjs';
import { resolveContainedRealPath, serveStaticFile } from '../design/path-util.mjs';
import {
  clampPin, assertValidFeedback, mergeFeedback, normalizeLegacy, isDeleteMarker,
  artifactReviewToDesignFeedback, designFeedbackToArtifactReview,
  FEEDBACK_FILE, PENDING_FILE,
} from './feedback.mjs';
import {
  DESIGN_BOARD_ENVELOPE_FILE,
  DESIGN_BOARD_SOURCES_FILE,
} from './board.mjs';
import {
  createArtifactBridgeNonce,
  prepareArtifactDocument,
  renderArtifactParentRuntime,
} from '../artifact/bridge.mjs';
import {
  digestArtifactEnvelope,
  validateArtifactEnvelope,
  validateArtifactReview,
} from '../artifact/envelope.mjs';

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
export const DAEMON_VERSION = 3;

/** Cap on a request body (bytes) — a feedback round is small; this bounds memory per request. */
const MAX_BODY_SIZE = 5_000_000;

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const readBody = (req) => readRequestBody(req, {
  maxBytes: MAX_BODY_SIZE,
  encoding: 'utf8',
});

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifactStageRuntimePath = join(packageRoot, 'templates', 'artifact-review-stage.js');
const designBoardAdapterPath = join(packageRoot, 'templates', 'design', 'design-board-adapter.js');

export function createDaemon({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
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
  const bridgeNonces = new Map(); // boardId → opaque-origin bridge capability
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

  const readEnvelope = (dir) => {
    const path = join(dir, DESIGN_BOARD_ENVELOPE_FILE);
    if (!existsSync(path)) return null;
    try {
      const envelope = JSON.parse(readFileSync(path, 'utf8'));
      validateArtifactEnvelope(envelope);
      return envelope;
    } catch {
      return null;
    }
  };

  const readSources = (dir, envelope = readEnvelope(dir)) => {
    if (!envelope) return [];
    const path = join(dir, DESIGN_BOARD_SOURCES_FILE);
    if (!existsSync(path)) return [];
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      if (value?.schemaVersion !== '1.0.0' || !Array.isArray(value.sources)) return [];
      const artifactIds = new Set(envelope.artifacts.map(({ id: artifactId }) => artifactId));
      const seen = new Set();
      const sources = [];
      for (const source of value.sources) {
        if (!source || typeof source !== 'object' || Array.isArray(source)
          || !artifactIds.has(source.artifactId) || seen.has(source.artifactId)
          || !['svg', 'png', 'html'].includes(source.kind)
          || typeof source.src !== 'string' || source.src.length < 1 || source.src.length > 512
          || source.src.includes('\0')) continue;
        const expected = source.kind === 'svg' ? '.svg' : source.kind === 'png' ? '.png' : '.html';
        if (extname(source.src).toLowerCase() !== expected) continue;
        const resolved = resolveContainedRealPath(dir, source.src).realPath;
        const entry = statSync(resolved);
        if (!entry.isFile() || entry.size > 10 * 1024 * 1024) continue;
        seen.add(source.artifactId);
        sources.push({
          artifactId: source.artifactId,
          kind: source.kind,
          name: basename(source.src),
          path: resolved,
          bytes: entry.size,
        });
      }
      return sources;
    } catch {
      return [];
    }
  };

  const artifactReviewFor = (id, dir, envelope, stored = readStored(dir)) => {
    const feedback = stored ?? {
      schema_version: '1.0.0', boardId: id, publishedAt: new Date(0).toISOString(),
      regenerated: false, ratings: {}, comments: {}, authors: [], pins: [],
    };
    const artifactIdByVariant = Object.fromEntries(envelope.artifacts.map(({ id: artifactId }) => [artifactId, artifactId]));
    const viewportByArtifact = Object.fromEntries(envelope.artifacts.map(({ id: artifactId, viewport }) => [artifactId, viewport]));
    return designFeedbackToArtifactReview(feedback, {
      reviewOf: digestArtifactEnvelope(envelope),
      artifactId: envelope.viewer.activeArtifactId,
      artifactIdByVariant,
      viewport: envelope.artifacts[0]?.viewport,
      viewportByArtifact,
    });
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
        if (!bridgeNonces.has(id)) bridgeNonces.set(id, createArtifactBridgeNonce());
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
          if (req.method === 'GET' && parts[3] === 'envelope') {
            const envelope = readEnvelope(dir);
            if (!envelope) return json(res, 404, { error: 'artifact envelope unavailable' });
            const review = artifactReviewFor(id, dir, envelope);
            return json(res, 200, { envelope: { ...envelope, review } });
          }
          if (req.method === 'GET' && parts[3] === 'sources') {
            const envelope = readEnvelope(dir);
            if (!envelope) return json(res, 404, { error: 'artifact envelope unavailable' });
            const sources = readSources(dir, envelope)
              .filter(({ kind }) => kind === 'svg' || kind === 'png')
              .map(({ artifactId, kind, name, bytes }) => ({
                artifactId,
                kind,
                name,
                bytes,
                url: `exports/${encodeURIComponent(artifactId)}/source`,
              }));
            return json(res, 200, { sources });
          }
          if (req.method === 'GET' && parts[3] === 'artifact-review') {
            const envelope = readEnvelope(dir);
            if (!envelope) return json(res, 404, { error: 'artifact envelope unavailable' });
            const feedback = readStored(dir);
            return json(res, 200, {
              review: artifactReviewFor(id, dir, envelope, feedback),
              feedback: feedback ?? null,
            });
          }
          if (req.method === 'PUT' && parts[3] === 'artifact-review') {
            const envelope = readEnvelope(dir);
            if (!envelope) return json(res, 404, { error: 'artifact envelope unavailable' });
            const value = JSON.parse(await readBody(req) || '{}');
            const review = value.review ?? value;
            try { validateArtifactReview(review); } catch (error) {
              return json(res, 400, { error: error.message });
            }
            if (review.reviewOf !== digestArtifactEnvelope(envelope)) {
              return json(res, 409, { error: 'artifact review targets a stale design envelope' });
            }
            let feedback;
            try {
              await locked(id, () => {
                feedback = artifactReviewToDesignFeedback(review, {
                  storedFeedback: readStored(dir),
                  boardId: id,
                });
                assertValidFeedback(feedback);
                writeFileSync(join(dir, FEEDBACK_FILE), `${JSON.stringify(feedback, null, 2)}\n`);
              });
            } catch (error) {
              return json(res, 400, { error: error.message });
            }
            const byId = new Map(feedback.pins.map((pin) => [pin.id, pin]));
            for (const pin of review.pins) {
              const item = byId.get(pin.id);
              if (item) presence.broadcast(id, 'feedback:update', { item });
            }
            return json(res, 200, { ok: true, feedback, review: artifactReviewFor(id, dir, envelope, feedback) });
          }
          if (req.method === 'POST' && parts[3] === 'pastes') {
            const value = JSON.parse(await readBody(req) || '{}');
            const allowed = ['schemaVersion', 'operation', 'iv', 'ciphertext', 'ttl'];
            if (!value || typeof value !== 'object' || Array.isArray(value)
              || Object.keys(value).some((key) => !allowed.includes(key))
              || value.schemaVersion !== '1.0.0' || value.operation !== 'create'
              || !['1d', '7d', '30d'].includes(value.ttl)
              || typeof value.iv !== 'string' || typeof value.ciphertext !== 'string') {
              return json(res, 400, { error: 'invalid encrypted paste request' });
            }
            if (typeof fetchImpl !== 'function') return json(res, 503, { error: 'share service unavailable' });
            try {
              const remote = await fetchImpl('https://share.openplanr.dev/api/v1/pastes', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(allowed.map((key) => [key, value[key]]))),
                redirect: 'error',
              });
              const body = await remote.json().catch(() => ({ error: 'share service returned malformed JSON' }));
              return json(res, remote.ok ? 200 : remote.status, body);
            } catch {
              return json(res, 503, { error: 'share service unavailable' });
            }
          }
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

        const boardBase = `/boards/${encodeURIComponent(id)}/`;
        if ((req.method === 'GET' || req.method === 'HEAD') && parts.length === 3 && parts[2] === 'runtime.js') {
          const nonce = bridgeNonces.get(id) ?? createArtifactBridgeNonce();
          bridgeNonces.set(id, nonce);
          const source = renderArtifactParentRuntime({
            artifactBaseUrl: `${boardBase}artifacts/`,
            stageRuntimeUrl: `${boardBase}stage.js`,
            adapterRuntimeUrl: `${boardBase}design-adapter.js`,
            nonce,
          });
          res.writeHead(200, {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          return res.end(req.method === 'HEAD' ? undefined : source);
        }
        if ((req.method === 'GET' || req.method === 'HEAD') && parts.length === 3
          && ['stage.js', 'design-adapter.js'].includes(parts[2])) {
          const path = parts[2] === 'stage.js' ? artifactStageRuntimePath : designBoardAdapterPath;
          if (!existsSync(path)) return json(res, 503, { error: 'generated board runtime unavailable' });
          const source = readFileSync(path);
          res.writeHead(200, {
            'content-type': 'text/javascript; charset=utf-8',
            'content-length': source.byteLength,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          return res.end(req.method === 'HEAD' ? undefined : source);
        }
        if ((req.method === 'GET' || req.method === 'HEAD') && parts.length === 4 && parts[2] === 'artifacts') {
          const envelope = readEnvelope(dir);
          const artifact = envelope?.artifacts.find(({ id: artifactId }) => artifactId === decodeURIComponent(parts[3]));
          if (!artifact) return json(res, 404, { error: 'artifact unavailable' });
          const nonce = bridgeNonces.get(id) ?? createArtifactBridgeNonce();
          bridgeNonces.set(id, nonce);
          const address = server.address();
          const port = typeof address === 'object' && address ? address.port : 0;
          const prepared = prepareArtifactDocument({
            html: artifact.html,
            artifactId: artifact.id,
            nonce,
            parentOrigin: `http://127.0.0.1:${port}`,
          });
          const source = Buffer.from(prepared.html);
          res.writeHead(200, {
            'content-security-policy': `${prepared.csp}; sandbox allow-scripts; frame-ancestors 'none'`,
            'content-disposition': 'attachment; filename="openplanr-design-artifact.html"',
            'content-type': 'application/octet-stream',
            'content-length': source.byteLength,
            'cache-control': 'no-store',
            'cross-origin-resource-policy': 'same-origin',
            'x-content-type-options': 'nosniff',
          });
          return res.end(req.method === 'HEAD' ? undefined : source);
        }
        if ((req.method === 'GET' || req.method === 'HEAD') && parts.length === 5
          && parts[2] === 'exports' && parts[4] === 'source') {
          const artifactId = decodeURIComponent(parts[3]);
          const source = readSources(dir).find((candidate) => candidate.artifactId === artifactId
            && ['svg', 'png'].includes(candidate.kind));
          if (!source) return json(res, 404, { error: 'design source unavailable' });
          const bytes = readFileSync(source.path);
          const downloadName = `openplanr-${artifactId.replace(/[^A-Za-z0-9._-]+/g, '_')}.${source.kind}`;
          res.writeHead(200, {
            'content-type': source.kind === 'svg' ? MIME['.svg'] : MIME['.png'],
            'content-length': bytes.byteLength,
            'content-disposition': `attachment; filename="${downloadName}"`,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          return res.end(req.method === 'HEAD' ? undefined : bytes);
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
    async listen(port = 0) {
      const actual = await listenLoopback(server, port);
      writeFileSync(join(stateDir, 'port'), String(actual));
      return actual;
    },
    close: () => closeHttpServer(server),
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
