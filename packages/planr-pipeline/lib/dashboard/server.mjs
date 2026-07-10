/**
 * Dashboard HTTP server (SPEC-016 / T-001).
 *
 * A persistent localhost server for the planr dashboard, following the same
 * agent-independent daemon pattern as lib/design-engine/daemon.mjs (hard rule
 * 14): the dashboard keeps serving if the launching agent dies, and a second
 * launch on the same port reuses the running server instead of double-binding.
 *
 * Routes (real graph data wired in T-002 via lib/dashboard/graph-engine.mjs):
 *   GET /api/graph      → typed project graph { nodes, edges }   (application/json)
 *   GET /api/node/:id   → a single node with body                (application/json)
 *   GET /api/meta       → { version, planrDir, views, defaultView } (application/json)
 *   GET /api/events     → SSE stream, emits a `ready` event (text/event-stream)
 *   GET /health         → { ok, pid }                 (reuse-if-running probe)
 *   GET /*              → static asset from lib/dashboard/app/ (traversal-guarded)
 *
 * State: <planrHome>/dashboard-daemon/{port} PID file (reuse detection) +
 * <planrHome>/dashboard-daemon/port (last bound port, discovery).
 *
 * Stdlib only — no npm runtime dependency. Live sync (T-004): when watching is
 * enabled the server starts lib/dashboard/watcher.mjs, keeps an in-memory
 * `currentGraph` cache that the watcher's diff events patch, and broadcasts each
 * patch to every open /api/events SSE client. `--no-watch` suppresses startup.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import {
  dirname, join, sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import { planrHome } from '../design-engine/paths.mjs';
import { writePidFile } from '../design-engine/server-util.mjs';
import { MIME } from '../design/mime-types.mjs';
import { serveStaticFile } from '../design/path-util.mjs';
import { buildGraph, getNode as engineGetNode, detectMode } from './graph-engine.mjs';
import { createWatcher } from './watcher.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_PORT = 7473;

/**
 * The dashboard's view ids, in rail order (design-spec §4). The client shell
 * uses this list to pre-select the landing view and to keep the hash router and
 * the server's notion of "known views" from drifting (one source of truth).
 */
export const DASHBOARD_VIEWS = ['overview', 'graph', 'board', 'list', 'sprints', 'activity'];

/** The landing view the client pre-activates on first load. */
export const DEFAULT_VIEW = 'overview';

/** Resolve the `.planr/` directory for a project root (default: <cwd>/.planr). */
export function resolvePlanrDir(projectRoot = process.cwd()) {
  return join(projectRoot, '.planr');
}

/**
 * Read the plugin version from the repo's package.json (../../ from this module).
 * Cached after first read; falls back to "0.0.0" if the file is missing/invalid
 * so /api/meta never throws (the route stays a 200 with a best-effort version).
 */
let versionCache;
function readPackageVersion() {
  if (versionCache !== undefined) return versionCache;
  try {
    const pkgPath = join(here, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    versionCache = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    versionCache = '0.0.0';
  }
  return versionCache;
}

/**
 * Best-effort current git branch for the workspace card. Reads `.git/HEAD`
 * directly (no subprocess) and parses `ref: refs/heads/<branch>`; falls back to
 * 'main' on a detached HEAD, a worktree gitfile, or any read error.
 * @param {string} repoRoot the repository root (the dir containing `.planr`)
 * @returns {string}
 */
function readGitBranch(repoRoot) {
  try {
    const head = readFileSync(join(repoRoot, '.git', 'HEAD'), 'utf-8').trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return m ? m[1] : 'main';
  } catch {
    return 'main';
  }
}

/** Static client app directory served at `/`. */
const APP_DIR = join(here, 'app');

/** Per-process state dir for the dashboard daemon (mirrors design-daemon). */
export function dashboardDir(env = process.env) {
  return join(planrHome(env), 'dashboard-daemon');
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

/**
 * Apply a watcher patch (`{ updated, added, removed, edges }`) to an in-memory
 * graph, returning a new graph. Updated nodes replace by id, added nodes append,
 * removed ids drop out; edges add/remove by their `kind from to` identity. Pure
 * — does not mutate the input — so the cache swap is atomic.
 */
export function applyPatch(graph, patch) {
  const base = graph && Array.isArray(graph.nodes) ? graph : { nodes: [], edges: [] };
  if (!patch) return { nodes: [...(base.nodes || [])], edges: [...(base.edges || [])] };

  const removed = new Set(patch.removed || []);
  const replaced = new Map((patch.updated || []).filter((n) => n && n.id).map((n) => [n.id, n]));

  const nodes = (base.nodes || [])
    .filter((n) => !removed.has(n.id))
    .map((n) => (replaced.has(n.id) ? replaced.get(n.id) : n));
  const have = new Set(nodes.map((n) => n.id));
  for (const n of patch.added || []) {
    if (n && n.id && !have.has(n.id)) { nodes.push(n); have.add(n.id); }
  }

  const edgePatch = patch.edges || { added: [], removed: [] };
  const edgeKey = (e) => `${e.kind} ${e.from} ${e.to}`;
  const dropEdges = new Set((edgePatch.removed || []).map(edgeKey));
  const edges = (base.edges || []).filter((e) => !dropEdges.has(edgeKey(e)));
  const haveEdges = new Set(edges.map(edgeKey));
  for (const e of edgePatch.added || []) {
    if (e && !haveEdges.has(edgeKey(e))) { edges.push(e); haveEdges.add(edgeKey(e)); }
  }

  return { nodes, edges };
}

/**
 * Create the dashboard HTTP server. `getGraph` / `getNode` remain injectable so the
 * T-004 watcher can supply cached/patched readers without editing this module; the
 * defaults serve the in-memory `currentGraph` cache (T-004), which the watcher
 * patches in place. `watch` (default true) starts the filesystem watcher; pass
 * `watch: false` (the `--no-watch` flag) to suppress it.
 */
export function createDashboardServer({
  appDir = APP_DIR,
  planrDir = resolvePlanrDir(),
  watch = true,
  getGraph,
  getNode = (id) => engineGetNode(planrDir, id) ?? null,
} = {}) {
  // In-memory graph cache: seeded lazily, patched in place by the watcher so
  // fresh page loads and SSE clients see the same up-to-date graph (one truth).
  let currentGraph = null;
  const ensureGraph = () => {
    if (!currentGraph) currentGraph = buildGraph(planrDir);
    return currentGraph;
  };
  const readGraph = typeof getGraph === 'function' ? getGraph : ensureGraph;

  /** Open SSE connections — the watcher broadcasts each patch to all of them. */
  const sseClients = new Set();

  /** Watcher handle (started in listen() unless watching is disabled). */
  let watcher = null;

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;
      const parts = pathname.split('/').filter(Boolean);

      if (req.method === 'GET' && pathname === '/health') {
        return json(res, 200, { ok: true, pid: process.pid });
      }

      if (req.method === 'GET' && pathname === '/api/graph') {
        return json(res, 200, readGraph());
      }

      // Shell metadata: lets the client pre-select the landing view, render the
      // planr-dir breadcrumb, and show the version chip without hard-coding any
      // of it (the version comes from package.json — one source of truth).
      if (req.method === 'GET' && pathname === '/api/meta') {
        const metaGraph = readGraph();
        const repoRoot = dirname(planrDir);
        return json(res, 200, {
          version: readPackageVersion(),
          planrDir,
          repo: repoRoot.split(sep).filter(Boolean).pop() || 'project',
          branch: readGitBranch(repoRoot),
          specs: (metaGraph.nodes || []).filter((n) => n && n.type === 'spec').length,
          mode: detectMode(metaGraph),
          views: DASHBOARD_VIEWS,
          defaultView: DEFAULT_VIEW,
        });
      }

      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'node' && parts[2]) {
        const id = decodeURIComponent(parts.slice(2).join('/'));
        const node = getNode(id);
        if (!node) return json(res, 404, { error: `unknown node "${id}"` });
        return json(res, 200, node);
      }

      if (req.method === 'GET' && pathname === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write('event: ready\n');
        res.write(`data: ${JSON.stringify({ ok: true, pid: process.pid })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return undefined; // keep the stream open
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        return serveStaticFile(res, appDir, pathname, MIME);
      }

      return json(res, 404, { error: 'not found' });
    } catch (err) {
      return json(res, 500, { error: String(err?.message ?? err) });
    }
  });

  /**
   * Receive a watcher patch: update the in-memory cache, then push the patch to
   * every open SSE client as a default `message` event (the client merges it in
   * place, preserving selection / view / zoom / filters — AC6).
   */
  const onWatcherPatch = (patch) => {
    currentGraph = applyPatch(ensureGraph(), patch);
    const frame = `data: ${JSON.stringify(patch)}\n\n`;
    for (const client of sseClients) {
      try { client.write(frame); } catch { sseClients.delete(client); }
    }
  };

  return {
    server,
    sseClients,
    /** Current in-memory graph (for tests / introspection). */
    getCurrentGraph: () => ensureGraph(),
    /** True when the filesystem watcher is running. */
    isWatching: () => watcher != null,
    /**
     * Broadcast a named SSE event to every open /api/events client. Patches are
     * pushed as default `message` events via onWatcherPatch; this stays for the
     * `ready`-style named events.
     */
    broadcast(event, payload) {
      const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of sseClients) client.write(frame);
    },
    /** Start on 127.0.0.1; writes the port + PID files for reuse discovery. */
    listen(port = DEFAULT_PORT, { env = process.env } = {}) {
      return new Promise((resolveListen) => {
        server.listen(port, '127.0.0.1', () => {
          const actual = server.address().port;
          const stateDir = dashboardDir(env);
          writePidFile(stateDir, actual);
          writePidFile(stateDir, 'port', actual); // last-bound port for discovery
          // Start live sync unless suppressed by --no-watch. The watcher is
          // seeded with the current cache so its first patch is a true diff.
          if (watch && !watcher) {
            watcher = createWatcher(planrDir, {
              onPatch: onWatcherPatch,
              initialGraph: ensureGraph(),
            });
            watcher.start();
          }
          resolveListen(actual);
        });
      });
    },
    close: () => new Promise((r) => {
      if (watcher) { watcher.stop(); watcher = null; }
      for (const client of sseClients) client.end();
      sseClients.clear();
      server.close(r);
    }),
  };
}

// CLI entry: `node server.mjs --serve [port] [--no-watch]`
if (
  process.argv[1]
  && import.meta.url.endsWith(process.argv[1].split('/').pop())
  && process.argv.includes('--serve')
) {
  const serveArg = process.argv[process.argv.indexOf('--serve') + 1];
  const portArg = Number(serveArg) || DEFAULT_PORT;
  // --no-watch suppresses the filesystem watcher (live sync off).
  const watch = !process.argv.includes('--no-watch');
  const dash = createDashboardServer({ watch });
  dash.listen(portArg).then((port) => {
    process.stdout.write(`DASHBOARD_URL: http://localhost:${port}/\n`);
  });
}
