/**
 * Filesystem watcher for live dashboard sync (SPEC-016 / US-004, T-004).
 *
 * Observes `.planr/` with `node:fs.watch` (recursive where the platform supports
 * it, polling fallback otherwise), debounces a burst of saves into a single
 * recompute, asks the graph engine to rebuild the changed node's subgraph, diffs
 * the result against the last in-memory snapshot, and hands a minimal patch
 * `{ updated, added, removed }` to an `onPatch` callback so the server can push
 * it over SSE. Closes FR6 (live sync ≤1s) and AC6 (view-state preservation: the
 * patch is incremental so the client never resets selection / zoom / filters).
 *
 * Strictly READ-ONLY (BR1): this module never writes, unlinks, or mkdirs under
 * `.planr/`. It only reads (via the graph engine) and watches. Zero third-party
 * dependencies — `node:fs` watch + `setTimeout` debounce are stdlib.
 *
 * graph-engine.mjs is a Preserve file: the watcher calls `buildGraph(planrDir,
 * { scope })` but does not modify the engine. The `scope` carries the changed
 * node id so the engine can narrow its recompute (and so AC2 is inspectable);
 * the watcher itself always diffs against its own snapshot, so correctness does
 * not depend on the engine honouring `scope`.
 */

import { watch, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { buildGraph as defaultBuildGraph } from './graph-engine.mjs';

/** Default debounce window (ms) — a burst of saves within this window = 1 patch. */
export const DEFAULT_DEBOUNCE_MS = 300;

/** Default polling interval (ms) for the non-recursive fallback watcher. */
export const DEFAULT_POLL_MS = 750;

/**
 * Resolve an artifact id from a changed `.planr/`-relative path.
 *
 * planr artifacts are named `PREFIX-NNN-slug.md` and the id is the leading
 * `PREFIX-NNN` token (e.g. `tasks/T-004-dashboard-live-sync.md` → `T-004`,
 * `specs/SPEC-016-dashboard/SPEC-016-dashboard.md` → `SPEC-016`). Returns null
 * for paths that are not artifact nodes (gherkin, error reports, dotfiles,
 * non-markdown), so the watcher can ignore noise without a recompute.
 *
 * @param {string} relPath path relative to `.planr/` (or a bare filename)
 * @returns {string|null} the artifact id, or null when the path is not a node
 */
export function resolveChangedId(relPath) {
  if (!relPath) return null;
  const file = basename(String(relPath).replace(/\\/g, '/'));
  if (!file || file.startsWith('.')) return null;
  if (!file.endsWith('.md')) return null;
  if (file.endsWith('-gherkin.feature')) return null; // not .md anyway, belt + braces
  if (file.endsWith('-error-report.md')) return null;
  const stem = file.slice(0, -'.md'.length);
  // Leading PREFIX-NNN (uppercase letters + dash + digits). Tolerates further
  // `-slug` tail; the id is just the first two dash-separated tokens.
  const m = stem.match(/^([A-Z]+)-(\d+)/);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

/**
 * Index a graph's nodes and edges by a stable key for diffing.
 * Nodes key on `id`; edges key on `kind from to` (matches graph-reader's edge key).
 */
function indexGraph(graph) {
  const nodes = new Map();
  const edges = new Map();
  if (graph && Array.isArray(graph.nodes)) {
    for (const n of graph.nodes) {
      if (n && n.id) nodes.set(String(n.id), n);
    }
  }
  if (graph && Array.isArray(graph.edges)) {
    for (const e of graph.edges) {
      if (e && e.from && e.to && e.kind) {
        edges.set(`${e.kind} ${e.from} ${e.to}`, e);
      }
    }
  }
  return { nodes, edges };
}

/** Stable stringify for shallow node/edge equality (key order normalised). */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function nodeEquals(a, b) {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Compute a minimal patch between two graphs.
 *
 * @param {{nodes:object[],edges:object[]}} prev last known graph (may be null)
 * @param {{nodes:object[],edges:object[]}} next freshly built graph
 * @returns {{ updated: object[], added: object[], removed: string[],
 *             edges: { added: object[], removed: object[] } }}
 *   - `added`   — nodes present in `next` but not `prev`
 *   - `updated` — nodes present in both whose content changed
 *   - `removed` — ids present in `prev` but gone from `next`
 *   - `edges`   — edge add/remove sets (so the graph view can re-link in place)
 */
export function diffGraphs(prev, next) {
  const a = indexGraph(prev || { nodes: [], edges: [] });
  const b = indexGraph(next || { nodes: [], edges: [] });

  const added = [];
  const updated = [];
  const removed = [];
  for (const [id, node] of b.nodes) {
    const before = a.nodes.get(id);
    if (!before) added.push(node);
    else if (!nodeEquals(before, node)) updated.push(node);
  }
  for (const id of a.nodes.keys()) {
    if (!b.nodes.has(id)) removed.push(id);
  }

  const edgesAdded = [];
  const edgesRemoved = [];
  for (const [key, edge] of b.edges) {
    if (!a.edges.has(key)) edgesAdded.push(edge);
  }
  for (const [key, edge] of a.edges) {
    if (!b.edges.has(key)) edgesRemoved.push(edge);
  }

  return { updated, added, removed, edges: { added: edgesAdded, removed: edgesRemoved } };
}

/** True when a patch changes nothing (so the watcher can skip the broadcast). */
export function isEmptyPatch(patch) {
  if (!patch) return true;
  return (
    patch.updated.length === 0
    && patch.added.length === 0
    && patch.removed.length === 0
    && patch.edges.added.length === 0
    && patch.edges.removed.length === 0
  );
}

/**
 * Create a `.planr/` watcher. Returns `{ start, stop, recompute }`.
 *
 * @param {string} planrDir absolute path to the `.planr/` directory to observe
 * @param {object} [options]
 * @param {number} [options.debounceMs=300] debounce window for save bursts
 * @param {number} [options.pollMs=750] polling interval for the fallback watcher
 * @param {(patch:object) => void} [options.onPatch] called with each non-empty diff
 * @param {{nodes:object[],edges:object[]}} [options.initialGraph] seed snapshot
 *        (the server passes its `currentGraph` so the first patch is a true diff)
 * @param {(planrDir:string, opts:object) => object} [options.buildGraph] engine
 *        hook (defaults to graph-engine.buildGraph) — injectable for tests
 * @param {typeof watch} [options.watchImpl] fs.watch impl — injectable for tests
 * @returns {{ start: () => boolean, stop: () => void,
 *             recompute: (changedId?: string|null) => object }}
 */
export function createWatcher(planrDir, options = {}) {
  const debounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : DEFAULT_DEBOUNCE_MS;
  const pollMs = Number.isFinite(options.pollMs) ? options.pollMs : DEFAULT_POLL_MS;
  const onPatch = typeof options.onPatch === 'function' ? options.onPatch : () => {};
  const buildGraph = typeof options.buildGraph === 'function' ? options.buildGraph : defaultBuildGraph;
  const watchImpl = typeof options.watchImpl === 'function' ? options.watchImpl : watch;

  // Last known graph snapshot. Seeded from the server's cache when provided so
  // the first watcher patch is a real diff rather than a full add-everything.
  let snapshot = options.initialGraph || null;

  let watcher = null; // fs.FSWatcher
  let pollTimer = null; // setInterval handle (fallback)
  let pollSeen = null; // Map<relPath, mtimeMs> for the polling fallback
  let debounceTimer = null;
  let pendingId = null; // last changed artifact id within the debounce window
  let running = false;

  /**
   * Recompute the subgraph for a changed id and diff it against the snapshot.
   * Always advances the snapshot to the freshly built graph. Returns the patch.
   * Read-only: only reads via buildGraph; never writes to `.planr/`.
   */
  function recompute(changedId = null) {
    let next;
    try {
      // Pass `scope` so the engine can narrow its recompute (AC2 inspectable).
      next = buildGraph(planrDir, { scope: changedId });
    } catch {
      // A transient half-written file: keep the old snapshot, emit nothing.
      return { updated: [], added: [], removed: [], edges: { added: [], removed: [] } };
    }
    const patch = diffGraphs(snapshot, next);
    snapshot = next;
    return patch;
  }

  /** Fire after the debounce window: recompute + broadcast a non-empty patch. */
  function flush() {
    debounceTimer = null;
    const changedId = pendingId;
    pendingId = null;
    const patch = recompute(changedId);
    if (!isEmptyPatch(patch)) onPatch(patch);
  }

  /** Schedule (or reschedule) a flush; coalesces a burst of changes into one. */
  function schedule(changedId) {
    if (changedId) pendingId = changedId;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, debounceMs);
    // Don't keep the event loop alive solely for a pending flush.
    if (typeof debounceTimer.unref === 'function') debounceTimer.unref();
  }

  /** Handle one fs.watch event. */
  function onFsEvent(_eventType, filename) {
    if (!running) return;
    const id = resolveChangedId(filename);
    // Even when we can't resolve an id (e.g. a directory rename, or a platform
    // that reports null filenames), schedule a recompute: the diff is still the
    // source of truth, and an empty diff is harmless.
    schedule(id);
  }

  /** Start the recursive fs.watch; falls back to polling when unsupported. */
  function start() {
    if (running) return true;
    running = true;
    try {
      watcher = watchImpl(planrDir, { recursive: true, persistent: false }, onFsEvent);
      watcher.on('error', () => {
        // A watch error (e.g. ENOSPC, or recursive unsupported surfacing late)
        // degrades to polling rather than killing live sync.
        stopFsWatch();
        startPolling();
      });
      return true;
    } catch {
      // Recursive watch unsupported on this platform → polling fallback.
      watcher = null;
      startPolling();
      return true;
    }
  }

  /** Polling fallback: scan mtimes on an interval, schedule on any change. */
  function startPolling() {
    if (pollTimer) return;
    pollSeen = scanMtimes(planrDir);
    pollTimer = setInterval(() => {
      if (!running) return;
      const now = scanMtimes(planrDir);
      const changedId = firstChangedId(pollSeen, now);
      pollSeen = now;
      if (changedId !== undefined) schedule(changedId);
    }, pollMs);
    if (typeof pollTimer.unref === 'function') pollTimer.unref();
  }

  function stopFsWatch() {
    if (watcher) {
      try { watcher.close(); } catch { /* already closed */ }
      watcher = null;
    }
  }

  /** Stop watching and cancel any pending flush. Idempotent. */
  function stop() {
    running = false;
    stopFsWatch();
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    pollSeen = null;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    pendingId = null;
  }

  return { start, stop, recompute };
}

// ── Polling-fallback helpers (read-only mtime scan) ──────────────────────────

/** Recursively map `.planr/`-relative artifact paths → mtimeMs (read-only). */
function scanMtimes(dir, base = dir, acc = new Map()) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      scanMtimes(full, base, acc);
    } else if (ent.isFile() && ent.name.endsWith('.md')) {
      try {
        acc.set(full.slice(base.length + 1), statSync(full).mtimeMs);
      } catch { /* vanished between readdir and stat */ }
    }
  }
  return acc;
}

/**
 * Compare two mtime maps; return the resolved id of the first changed file,
 * `null` when a file changed but resolves to no id, or `undefined` when nothing
 * changed (so the caller can skip scheduling).
 */
function firstChangedId(prev, next) {
  for (const [rel, mtime] of next) {
    if (!prev.has(rel) || prev.get(rel) !== mtime) return resolveChangedId(rel);
  }
  for (const rel of prev.keys()) {
    if (!next.has(rel)) return resolveChangedId(rel);
  }
  return undefined;
}
