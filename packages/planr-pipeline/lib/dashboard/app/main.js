/**
 * main.js — dashboard client entry point (SPEC-016 / T-006).
 *
 * Renders the shell, then runs a tiny hash router that dynamically imports the
 * view module for the current `location.hash` and calls `view.mount(contentEl)`.
 * View rendering logic lives in the view modules — NOT here.
 *
 * Theme: toggleTheme() reads/writes localStorage.theme and toggles `.dark` on
 * <html>. The choice is restored on boot (before first paint of the shell) so a
 * reload preserves it. The shell's theme button also emits `planr:theme-change`,
 * which we listen for to persist the choice.
 *
 * Live sync (T-004): connectEvents() opens the /api/events SSE stream and, on
 * each `message`, parses the watcher patch `{ updated, added, removed, edges }`,
 * merges it into the in-memory graph IN PLACE (replace updated nodes by id,
 * append added, drop removed) and asks the active view to repaint only the
 * affected nodes via its `partialRefresh(affectedIds)` hook. It NEVER re-routes,
 * re-mounts, or re-renders the whole tree — so the selected node id, current
 * view hash, and active filter text are preserved across patches (AC6).
 *
 * Only design-system tokens (ds.css) are used; no raw hex, no off-grid spacing,
 * no third-party product codenames.
 */

import {
  renderShell,
  setActiveView,
  setModeChip,
  setOperatingAvailable,
  populateFilters,
} from './shell.js';

/* ──────────────────────────────────────────────────────────────────────────
 * filterState — authoritative client-side filter state (SPEC-016 / T-007).
 *
 * Holds the rail's Status + Type selection. Views (Overview, List, Board…) read
 * it via getFilter() and re-render on the `planr:filter-change` event it
 * dispatches on `document`. setFilter() is the single mutation entry point so the
 * dispatched detail always mirrors the stored state exactly (AC2).
 *
 *   shape: { statusFilter: string|null, typeFilter: string[], search: string }
 *     statusFilter — a single status id (e.g. 'done') or null for "All"
 *     typeFilter   — selected artifact types (e.g. ['task']); [] means "all types"
 *     search       — case-insensitive substring (List view); '' means no search
 *
 * This is the ONE filter store the whole app shares: the rail (shell.js) writes
 * type + status, the List view writes type + status + search, and every browse
 * view reads it via getFilter() + reacts to `planr:filter-change`. (Earlier the
 * rail was unwired and the List kept a private duplicate — two desynced stores.)
 * ──────────────────────────────────────────────────────────────────────────*/
const FILTER_KEYS = { status: 'statusFilter', type: 'typeFilter', search: 'search' };

const _filter = { statusFilter: null, typeFilter: [], search: '' };

/** Return a defensive copy of the current filter state. */
export function getFilter() {
  return { statusFilter: _filter.statusFilter, typeFilter: [..._filter.typeFilter], search: _filter.search };
}

/**
 * Set one filter dimension and announce the change on `planr:filter-change`.
 * @param {'status'|'type'|'search'} key  which dimension to set
 * @param {string|string[]|null} val  status id / null · type id array · search string
 * @returns {{statusFilter: string|null, typeFilter: string[], search: string}} the new state
 */
export function setFilter(key, val) {
  const field = FILTER_KEYS[key];
  if (!field) return getFilter();
  if (field === 'typeFilter') {
    _filter.typeFilter = Array.isArray(val) ? [...val] : (val == null ? [] : [val]);
  } else if (field === 'search') {
    _filter.search = val == null ? '' : String(val);
  } else {
    _filter.statusFilter = val == null || val === '' ? null : val;
  }
  const detail = getFilter();
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('planr:filter-change', { detail }));
  }
  return detail;
}

/**
 * Grouped export so view modules can `import { filterState } from '../main.js'`.
 * `setFilter`/`getFilter` mirror the module functions; the read-only accessors
 * let views that previously held a private state object read the same store.
 */
export const filterState = {
  setFilter,
  getFilter,
  get typeFilter() { return [..._filter.typeFilter]; },
  get statusFilter() { return _filter.statusFilter; },
  get search() { return _filter.search; },
};

/** Lazy view loaders — code-split per route (dynamic import). */
const ROUTES = {
  overview: () => import('./views/overview.js'),
  graph: () => import('./views/graph.js'),
  board: () => import('./views/board.js'),
  list: () => import('./views/list.js'),
  sprints: () => import('./views/sprint.js'),
  activity: () => import('./views/activity.js'),
  operate: () => import('./views/operate.js'),
  detail: () => import('./views/detail.js'),
};

const DEFAULT_VIEW = 'overview';

/** The shell's content mount element (set by boot()). */
let contentEl = null;

/**
 * The currently-mounted view module — kept so live SSE patches can call its
 * optional `partialRefresh(affectedIds)` hook for an in-place repaint, without
 * re-importing or re-mounting (which would reset selection / scroll / filters).
 */
let activeModule = null;

/**
 * Shared client-side live-sync state. The in-memory graph is the single source
 * of truth the SSE merge maintains; views read it (via window.__dashboard.graph)
 * and the merge preserves selection / view hash / filter across patches (AC6).
 */
const dashboard = (window.__dashboard = window.__dashboard || {
  graph: { nodes: [], edges: [] },
  /** Selected node id — set by views; the SSE merge must not disturb it. */
  selectedId: null,
  /** Active filter text — set by views; the SSE merge must not disturb it. */
  filterText: '',
  /**
   * Project planning mode from GET /api/meta: 'spec' | 'agile' | 'mixed' |
   * 'empty' | null (not yet resolved). Views read this to default their tier
   * toggle / labels; the shell reads it to render the mode chip.
   */
  mode: null,
  /** Validated read-only Operating Board projection, when available. */
  operating: null,
});

/** Parse the leading segment of the hash into a known view id. */
function routeFromHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const id = raw.split('/')[0] || DEFAULT_VIEW;
  return Object.prototype.hasOwnProperty.call(ROUTES, id) ? id : DEFAULT_VIEW;
}

/** decodeURIComponent that never throws on a malformed escape. */
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Render a one-line note into the content area (loading / not-built-yet / error). */
function note(el, message) {
  if (!el) return;
  el.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'ds-note';
  p.textContent = message;
  el.append(p);
}

/**
 * Read the current hash, dynamically import the matching view module, and mount
 * it into the shell's content element. Unknown / not-yet-built views render a
 * neutral note rather than throwing.
 */
export async function hashRouter() {
  if (!contentEl) return;
  const view = routeFromHash();
  setActiveView(view);

  // A new route mounts a fresh module: drop the old reference so a late SSE
  // patch can't repaint a view that is no longer on screen.
  activeModule = null;

  const loader = ROUTES[view];
  if (!loader) { note(contentEl, 'Unknown view.'); return; }

  // Route params: everything after the view segment is the artifact id (e.g.
  // #detail/SPEC-016/T-004 → id "SPEC-016/T-004"). Namespaced ids contain '/',
  // so keep the FULL remainder rather than a single segment.
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const rest = raw.startsWith(view) ? raw.slice(view.length).replace(/^\//, '') : '';
  const params = rest ? { id: safeDecode(rest) } : {};

  try {
    const mod = await loader();
    if (typeof mod.mount === 'function') {
      contentEl.innerHTML = '';
      await mod.mount(contentEl, params);
      activeModule = mod; // remember for live partialRefresh (T-004)
    } else {
      note(contentEl, 'This view has no mount() export yet.');
    }
  } catch (err) {
    // A sibling view module (graph/board/list/sprints/activity) may not exist
    // yet — that is expected during incremental delivery. Show a neutral note.
    note(contentEl, `“${view}” view is not available yet.`);
    if (typeof console !== 'undefined') console.info('[dashboard] view load skipped:', view, err && err.message);
  }
}

/**
 * Merge a watcher patch into the in-memory graph in place.
 * Replaces `updated` nodes by id, appends `added`, drops `removed` ids, and
 * applies the edge add/remove sets. Returns the affected node ids so the active
 * view repaints only those. Touches only the graph — never view-state.
 * @returns {string[]} affected node ids
 */
export function mergePatch(graph, patch) {
  const affected = new Set();
  if (!graph || !patch) return [];

  const removed = new Set(patch.removed || []);
  if (removed.size) {
    graph.nodes = graph.nodes.filter((n) => !removed.has(n.id));
    for (const id of removed) affected.add(id);
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const node of patch.updated || []) {
    if (!node || !node.id) continue;
    if (byId.has(node.id)) {
      const idx = graph.nodes.findIndex((n) => n.id === node.id);
      graph.nodes[idx] = node;
    } else {
      graph.nodes.push(node);
    }
    byId.set(node.id, node);
    affected.add(node.id);
  }
  for (const node of patch.added || []) {
    if (!node || !node.id || byId.has(node.id)) continue;
    graph.nodes.push(node);
    byId.set(node.id, node);
    affected.add(node.id);
  }

  const edgePatch = patch.edges || { added: [], removed: [] };
  const edgeKey = (e) => `${e.kind} ${e.from} ${e.to}`;
  if (!Array.isArray(graph.edges)) graph.edges = [];
  if ((edgePatch.removed || []).length) {
    const drop = new Set(edgePatch.removed.map(edgeKey));
    graph.edges = graph.edges.filter((e) => !drop.has(edgeKey(e)));
  }
  if ((edgePatch.added || []).length) {
    const have = new Set(graph.edges.map(edgeKey));
    for (const e of edgePatch.added) {
      if (!have.has(edgeKey(e))) { graph.edges.push(e); have.add(edgeKey(e)); }
    }
  }

  return [...affected];
}

/**
 * Apply an SSE patch: merge into the in-memory graph, then repaint only the
 * affected nodes through the active view's `partialRefresh` hook. Selection,
 * view hash, and filter text are snapshotted and restored so a careless hook
 * cannot lose them (AC6). Never re-routes or re-mounts.
 */
export function applySsePatch(patch) {
  const keptSelection = dashboard.selectedId;
  const keptFilter = dashboard.filterText;
  const keptHash = location.hash;

  const affectedIds = mergePatch(dashboard.graph, patch);

  // Restore view-state regardless of what the merge/hook touches.
  dashboard.selectedId = keptSelection;
  dashboard.filterText = keptFilter;

  // A patch may introduce a new type/status — re-derive the rail filter options
  // from the merged graph (preserves the current selection). Cheap + idempotent.
  populateFilters(dashboard.graph);

  if (affectedIds.length === 0) return; // nothing changed → nothing to repaint

  if (activeModule && typeof activeModule.partialRefresh === 'function') {
    try {
      activeModule.partialRefresh(affectedIds, dashboard.graph);
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[dashboard] partialRefresh failed', err);
    }
  }

  // The hash never changes on a patch — assert it stayed put (cheap guard).
  if (location.hash !== keptHash) location.hash = keptHash;
}

/**
 * Open the /api/events SSE stream. Logs the `ready` event; on each default
 * `message` parses the patch and applies it in place. Reconnection is handled
 * natively by EventSource. Returns the source (or null when unsupported).
 */
export function connectEvents() {
  if (typeof EventSource === 'undefined') return null;
  let source;
  try {
    source = new EventSource('/api/events');
  } catch {
    return null;
  }
  source.addEventListener('ready', () => {
    if (typeof console !== 'undefined') console.info('[dashboard] live sync ready');
  });
  source.onmessage = (event) => {
    let patch;
    try {
      patch = JSON.parse(event.data);
    } catch {
      if (typeof console !== 'undefined') console.warn('[dashboard] SSE patch parse failed');
      return;
    }
    if (patch && typeof patch === 'object') applySsePatch(patch);
  };
  source.onerror = () => {
    // EventSource auto-reconnects; surface the blip for diagnostics only.
    if (typeof console !== 'undefined') console.warn('[dashboard] SSE connection error');
  };
  return source;
}

/**
 * Toggle the colour theme. Adds/removes `.dark` on <html>, persists the choice
 * to localStorage.theme, and returns the new theme name.
 * @returns {'light'|'dark'}
 */
export function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  const theme = isDark ? 'dark' : 'light';
  try { localStorage.setItem('theme', theme); } catch { /* storage may be blocked */ }
  return theme;
}

/** Apply the stored theme (or the OS preference) before the shell renders. */
function applyStoredTheme() {
  let stored = null;
  try { stored = localStorage.getItem('theme'); } catch { /* ignore */ }
  let dark;
  if (stored === 'dark' || stored === 'light') {
    dark = stored === 'dark';
  } else if (typeof matchMedia === 'function') {
    dark = matchMedia('(prefers-color-scheme: dark)').matches;
  } else {
    dark = false;
  }
  document.documentElement.classList.toggle('dark', dark);
}

/** Persist theme when the shell's toggle button announces a change. */
function bindThemeEvents() {
  document.addEventListener('planr:theme-change', (e) => {
    const theme = e && e.detail && e.detail.theme;
    if (theme === 'dark' || theme === 'light') {
      try { localStorage.setItem('theme', theme); } catch { /* ignore */ }
    }
  });
}

/* ──────────────────────────────────────────────────────────────────────────
 * cmdkDispatcher — ⌘K command-palette opener (SPEC-016 / T-007).
 *
 * Listens for the canonical `planr:cmdk-open` event AND the shell's existing
 * `planr:open-search` click event (shell.js fires the latter from its ⌘K field;
 * we bridge both without editing shell.js), plus a global ⌘K / Ctrl+K keydown.
 * On any of these it dynamically imports views/search.js and calls open(). The
 * search module is sibling work (T-009); until it ships the import is tolerated
 * with a neutral console note rather than throwing (incremental delivery). AC3.
 * ──────────────────────────────────────────────────────────────────────────*/
let _cmdkOpening = false;

/** Dynamically import the search view and open the command palette. */
async function openCommandPalette() {
  if (_cmdkOpening) return; // de-dupe concurrent triggers (key + click)
  _cmdkOpening = true;
  try {
    const search = await import('./views/search.js');
    if (typeof search.open === 'function') search.open();
    else if (typeof console !== 'undefined') console.info('[dashboard] search.js has no open() yet');
  } catch (err) {
    if (typeof console !== 'undefined') console.info('[dashboard] command palette not available yet', err && err.message);
  } finally {
    _cmdkOpening = false;
  }
}

/** Wire the ⌘K open paths: custom events + the keyboard shortcut. */
function bindCmdk() {
  if (typeof document === 'undefined') return;
  document.addEventListener('planr:cmdk-open', openCommandPalette);
  // Bridge the shell's existing click event onto the canonical open path.
  document.addEventListener('planr:open-search', openCommandPalette);
  document.addEventListener('keydown', (e) => {
    const isK = e.key === 'k' || e.key === 'K';
    if (isK && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      // Fire the canonical event so any other listener stays in sync (AC3),
      // then the listener above performs the dynamic import + open().
      document.dispatchEvent(new CustomEvent('planr:cmdk-open'));
    }
  });
}

/** Grouped export so tests / views can invoke the dispatcher directly. */
export const cmdkDispatcher = { open: openCommandPalette, bind: bindCmdk };

/* ──────────────────────────────────────────────────────────────────────────
 * Shell metadata — GET /api/meta (SPEC-016 / T-007).
 *
 * Populates the breadcrumb's root crumb with the planr-dir basename and the
 * top-bar version chip with the plugin version, so neither is hard-coded in the
 * shell (one source of truth: package.json + the server's planrDir). AC4.
 * ──────────────────────────────────────────────────────────────────────────*/

/** Last path segment of a `/`-or-`\`-separated path (the dir's own name). */
function basename(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/** Set the breadcrumb root crumb text (the planr dir's basename). */
function setBreadcrumbRoot(text) {
  if (!text || typeof document === 'undefined') return;
  const root = document.querySelector('.ds-crumb__root');
  if (root) root.textContent = text;
}

/**
 * Populate the rail's workspace card from /api/meta (DOM-only — shell.js renders
 * static placeholders). Sets the repo name and a real `branch · N specs` line so
 * the card never shows a stale hard-coded count.
 * @param {{repo?:string, branch?:string, specs?:number}} meta
 */
function setWorkspace(meta) {
  if (!meta || typeof document === 'undefined') return;
  const nameEl = document.querySelector('.ds-workspace__name');
  const subEl = document.querySelector('.ds-workspace__sub');
  if (nameEl && meta.repo) nameEl.textContent = meta.repo;
  if (subEl && (meta.branch || typeof meta.specs === 'number')) {
    const branch = meta.branch || 'main';
    const n = typeof meta.specs === 'number' ? meta.specs : 0;
    subEl.textContent = `${branch} · ${n} spec${n === 1 ? '' : 's'}`;
  }
}

/**
 * Set the version chip text. Uses an existing `[data-version]` element when the
 * shell provides one; otherwise injects a small chip into the top-bar's right
 * cluster (DOM-only — shell.js is not edited).
 */
function setVersionChip(version) {
  if (!version || typeof document === 'undefined') return;
  const label = `v${String(version).replace(/^v/, '')}`;
  let chip = document.querySelector('[data-version]');
  if (!chip) {
    const right = document.querySelector('.ds-topbar__right');
    if (!right) return;
    chip = document.createElement('span');
    chip.className = 'ds-modechip';
    chip.setAttribute('data-version', '');
    chip.setAttribute('aria-label', 'planr-pipeline version');
    right.prepend(chip);
  }
  chip.textContent = label;
}

/**
 * Apply the project planning mode from /api/meta: store it on the shared
 * dashboard state, drive the shell's mode chip, and announce it on
 * `planr:mode` so views can default their tier toggle / labels. Tolerates an
 * unknown value by treating it as "empty" (chip hides, views default to spec).
 * @param {'spec'|'agile'|'mixed'|'empty'|undefined} mode
 */
function applyMode(mode) {
  const valid = mode === 'spec' || mode === 'agile' || mode === 'mixed' || mode === 'empty';
  const resolved = valid ? mode : 'empty';
  dashboard.mode = resolved;
  setModeChip(resolved);
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('planr:mode', { detail: { mode: resolved } }));
  }
}

/**
 * Fetch GET /api/meta and bind the breadcrumb + version chip + planning-mode
 * chip. Tolerates network/parse failure (the shell still works with its static
 * defaults; the mode chip simply stays hidden).
 * @returns {Promise<object|null>} the meta payload, or null on failure
 */
export async function fetchMeta() {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch('/api/meta');
    if (!res.ok) return null;
    const meta = await res.json();
    if (!meta || typeof meta !== 'object') return null;
    setBreadcrumbRoot(basename(meta.planrDir));
    setVersionChip(meta.version);
    setWorkspace(meta);
    applyMode(meta.mode);
    return meta;
  } catch {
    return null;
  }
}

/** Discover the optional Operating Board projection without mutating it. */
export async function fetchOperatingAvailability() {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch('/api/operate', { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const projection = await response.json();
    dashboard.operating = projection;
    setOperatingAvailable(projection?.status !== 'absent');
    return projection;
  } catch {
    setOperatingAvailable(false);
    return null;
  }
}

/** Boot: theme, shell, router, hashchange wiring. */
function boot() {
  applyStoredTheme();
  bindThemeEvents();

  const root = document.getElementById('app');
  if (!root) { if (typeof console !== 'undefined') console.error('[dashboard] #app root missing'); return; }

  contentEl = renderShell(root);
  if (!location.hash) location.hash = `#${DEFAULT_VIEW}`;
  window.addEventListener('hashchange', hashRouter);
  hashRouter();

  // ⌘K command palette (T-007): wire the open paths before first interaction.
  bindCmdk();

  // Shell metadata (T-007): breadcrumb basename + version chip from /api/meta.
  fetchMeta();
  fetchOperatingAvailability();

  // Live sync (T-004): open the SSE stream so .planr/ edits patch in place.
  connectEvents();

  // Metadata-driven rail filters: load the graph once into the shared in-memory
  // store, then build the Type + Status filter controls from the types/statuses
  // ACTUALLY present (re-derived live as patches arrive). Async — the rail shows
  // its "Filters" header immediately and the controls fill in on load.
  loadInitialGraph();
}

/**
 * Fetch GET /api/graph once at boot, store it as the shared in-memory graph
 * (the same object SSE patches mutate), and populate the rail's Type + Status
 * filters from the data. Tolerates failure: the rail simply renders no filter
 * options rather than a hard-coded list. AC: metadata-driven filters.
 * @returns {Promise<object|null>}
 */
export async function loadInitialGraph() {
  if (typeof fetch !== 'function') { populateFilters(dashboard.graph); return null; }
  let graph = null;
  try {
    const res = await fetch('/api/graph');
    if (res.ok) {
      const g = await res.json();
      if (g && Array.isArray(g.nodes)) graph = g;
    }
  } catch { graph = null; }
  if (graph) dashboard.graph = graph;
  populateFilters(dashboard.graph);
  return graph;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
