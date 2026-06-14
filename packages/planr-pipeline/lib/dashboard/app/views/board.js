/**
 * board.js — Kanban Board view (SPEC-016 / T-010 UI + T-011 logic).
 *
 * design-spec §9 Screen #3 (mockups/03-board-{desktop,tablet,mobile}.png):
 * a Kanban board grouped by status (default) / sprint / feature. Fetches
 * GET /api/graph, groups the nodes with groupBy(), and renders status columns
 * with a count badge and `ds-cardlet` cards (type accent · id · title · status
 * footer). The dashboard is READ-ONLY: there are no drag-to-move handlers and
 * no inline-edit controls (write-back is PRD M4, out of SPEC-016 scope).
 *
 * Re-renders the columns in place when `planr:filter-change` fires (rail filter
 * change) so selection / scroll elsewhere is preserved.
 *
 * UI layer (T-010): mount(el) + all rendering. Data layer (T-011): the pure
 * groupBy() transform exported below — no DOM, unit-testable. Both live in this
 * one file per the task contract.
 *
 * Token-only styling (ds.css tokens, injected via <style> because ds.css is a
 * Preserve file). No raw hex, no off-grid spacing, no third-party product
 * codenames. Icons would be inline outline SVG (design-spec §6) — never emoji.
 *
 * Node shape (schemas/v1.0.0/graph.schema.json):
 *   { id, type, title, status, frontmatter: { sprintId?, featureId?, ... } }
 *   status ∈ done | in-progress | blocked | outstanding | addressed
 */

import { displayId } from '../display-id.js';

/* ── data layer (T-011) — pure, no DOM ──────────────────────────────── */

/**
 * The four visible status columns, in board order. `addressed` folds into the
 * "Done" column (it is a terminal classified status). This order is also the
 * key order of the Map returned by groupBy(nodes, "status").
 */
const STATUS_ORDER = ['outstanding', 'in-progress', 'blocked', 'done'];

/** Human label for each status-group key. */
const STATUS_LABEL = {
  outstanding: 'Outstanding',
  'in-progress': 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

/** Map a raw node status onto one of the four board status buckets. */
function statusBucket(status) {
  if (status === 'addressed') return 'done';
  return STATUS_ORDER.includes(status) ? status : 'outstanding';
}

/**
 * Group nodes for the board. Pure: no DOM, no side effects.
 *
 * @param {Array<object>} nodes  the graph nodes
 * @param {'status'|'sprint'|'feature'} key  grouping dimension
 * @returns {Map<string, Array<object>>} ordered Map of group key → nodes.
 *   - status : exactly four keys in STATUS_ORDER (empty groups kept so all
 *              four columns always render).
 *   - sprint : keyed by frontmatter.sprintId; missing → "unassigned".
 *   - feature: keyed by frontmatter.featureId; missing → "unassigned".
 */
export function groupBy(nodes, key) {
  const list = Array.isArray(nodes) ? nodes : [];
  const out = new Map();

  if (key === 'status') {
    for (const k of STATUS_ORDER) out.set(k, []);
    for (const n of list) out.get(statusBucket(n && n.status)).push(n);
    return out;
  }

  const field = key === 'sprint' ? 'sprintId' : 'featureId';
  for (const n of list) {
    const fm = (n && n.frontmatter) || {};
    const groupKey = fm[field] != null && fm[field] !== '' ? String(fm[field]) : 'unassigned';
    if (!out.has(groupKey)) out.set(groupKey, []);
    out.get(groupKey).push(n);
  }
  // stable, readable order: named groups first (sorted), "unassigned" last.
  const ordered = new Map();
  const keys = [...out.keys()].filter((k) => k !== 'unassigned').sort();
  for (const k of keys) ordered.set(k, out.get(k));
  if (out.has('unassigned')) ordered.set('unassigned', out.get('unassigned'));
  return ordered;
}

/**
 * Resolve the spec a node belongs to, or null. Pure, no DOM. Reads frontmatter:
 * `specScope` (stamped by the reader on every story AND task under
 * specs/SPEC-NNN/) → authored `specId` → the namespaced id prefix as a last
 * resort. A spec body node resolves to its own id.
 * @param {object} node
 * @returns {string|null}
 */
export function specOf(node) {
  const fm = (node && node.frontmatter) || {};
  if (typeof fm.specScope === 'string' && fm.specScope) return fm.specScope;
  if (typeof fm.specId === 'string' && fm.specId) return fm.specId;
  if (node && typeof node.id === 'string' && node.id.includes('/')) {
    const scope = node.id.slice(0, node.id.indexOf('/'));
    if (/^SPEC-/i.test(scope)) return scope;
  }
  if (node && node.type === 'spec') {
    const own = fm.id != null && fm.id !== '' ? String(fm.id) : (node.id != null ? String(node.id) : '');
    if (own) return own;
  }
  return null;
}

/**
 * Distinct spec ids present in the graph, numerically sorted. Pure. Drives the
 * spec filter dropdown (only specs that actually exist are advertised).
 * @param {Array<object>} nodes
 * @returns {string[]}
 */
export function specsInGraph(nodes) {
  const set = new Set();
  for (const n of (Array.isArray(nodes) ? nodes : [])) {
    const s = specOf(n);
    if (s) set.add(s);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/* ── UI layer (T-010) ───────────────────────────────────────────────── */

/** Build an element with class / html / text / attrs / children. */
function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  for (const child of children) if (child) node.append(child);
  return node;
}

/** Token-scoped board CSS, injected once (ds.css is a Preserve file). */
const STYLE_ID = 'ds-board-style';
const BOARD_CSS = `
.board-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: var(--space-4) 0 var(--space-6);
}
.board-toolbar__label {
  font-size: var(--text-sm);
  color: var(--muted-foreground);
}
.board-groupby {
  display: inline-flex;
  gap: var(--space-1);
  padding: var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}
.board-groupby__btn {
  padding: var(--space-1) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted-foreground);
  font-size: var(--text-sm);
  transition: background var(--duration-fast) var(--ease);
}
.board-groupby__btn:hover { background: var(--muted); color: var(--foreground); }
.board-groupby__btn[aria-pressed="true"] {
  background: var(--accent);
  color: var(--accent-foreground);
  font-weight: var(--weight-medium);
}
.dark .board-groupby__btn[aria-pressed="true"] { color: var(--foreground); }

/* spec filter — native select pushed to the far right of the toolbar */
.board-specfilter {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}
.board-specfilter__select {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--foreground);
  font: inherit;
  font-size: var(--text-sm);
  transition: border-color var(--duration-fast) var(--ease);
}
.board-specfilter__select:hover { border-color: var(--ring); }
.board-specfilter__select:focus-visible { border-color: var(--ring); }

/* The board fills the content viewport at a FIXED height — the page itself never
 * grows. Only the column bodies scroll (vertical) and the column row scrolls
 * (horizontal); the page header + group-by toolbar + column headers stay put. */
.board-view {
  display: flex;
  flex-direction: column;
  /* Pin to the viewport: full height minus the sticky top bar and the content
   * area's own top+bottom padding. .ds-shell is min-height:100vh (not a definite
   * height), so a percentage height collapses to content — a vh calc is the
   * reliable bound. Tokens keep it in lockstep with the shell geometry. */
  height: calc(100vh - var(--topbar-height) - var(--space-6) - var(--space-6));
  min-height: 0;
}
.board-colshost {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.board-cols {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  gap: var(--space-4);
  align-items: stretch;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: var(--space-2);
}
.board-col {
  flex: 0 0 280px;
  min-width: 280px;
  max-height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.board-col__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 0 var(--space-1);
}
.board-col__title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--foreground);
}
.col-count {
  display: inline-grid;
  place-items: center;
  min-width: var(--space-6);
  padding: 0 var(--space-2);
  height: var(--space-6);
  border-radius: var(--radius-xl);
  background: var(--muted);
  color: var(--muted-foreground);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}
.board-col__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-bottom: var(--space-2);
}

.ds-cardlet {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--duration-fast) var(--ease), border-color var(--duration-fast) var(--ease);
}
.ds-cardlet:hover { box-shadow: var(--shadow-md); border-color: var(--ring); }
.ds-cardlet__accent {
  position: absolute;
  left: 0;
  top: var(--space-2);
  bottom: var(--space-2);
  width: var(--space-1);
  border-radius: var(--radius-xl);
  background: var(--muted-foreground);
}
.ds-cardlet__idrow {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.ds-cardlet__id {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--muted-foreground);
}
/* spec badge — subtle mono pill (same muted pair as the column count) */
.ds-cardlet__spec {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  line-height: 1.4;
  padding: 0 var(--space-2);
  border-radius: var(--radius-xl);
  background: var(--muted);
  color: var(--muted-foreground);
  white-space: nowrap;
}
/* agile-mode degraded (nearest parent) reads softer */
.ds-cardlet__spec--parent {
  background: transparent;
  border: 1px solid var(--border);
}
.ds-cardlet__title {
  font-size: var(--text-sm);
  color: var(--foreground);
  line-height: 1.4;
}
.ds-cardlet__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: var(--space-1);
}
/* type left-accent colours — all from §1 palette tokens */
.type-epic    { background: var(--primary); }
.type-feature { background: var(--info); }
.type-story   { background: var(--success); }
.type-task    { background: var(--muted-foreground); }
.type-spec    { background: var(--primary); }
.type-backlog { background: var(--muted-foreground); }
.type-quick   { background: var(--warning); }
.type-sprint  { background: var(--info); }
.type-adr     { background: var(--accent-foreground); }
.ds-cardlet__type {
  font-size: var(--text-xs);
  color: var(--muted-foreground);
  text-transform: capitalize;
}

@container shell (max-width: 767px) {
  .board-col { flex-basis: 84vw; min-width: 84vw; }
}
@supports not (container-type: inline-size) {
  @media (max-width: 767px) {
    .board-col { flex-basis: 84vw; min-width: 84vw; }
  }
}
`;

/** Inject the board stylesheet once. */
function ensureStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = BOARD_CSS;
  document.head.append(style);
}

/** Fetch the project graph, tolerating network/parse failure with an empty graph. */
async function fetchGraph() {
  try {
    const res = await fetch('/api/graph');
    if (!res.ok) return { nodes: [], edges: [] };
    const graph = await res.json();
    if (!graph || !Array.isArray(graph.nodes)) return { nodes: [], edges: [] };
    return graph;
  } catch {
    return { nodes: [], edges: [] };
  }
}

/** Map a node status onto a status-footer badge class + label (reuses ds.css). */
function badgeFor(status) {
  switch (status) {
    case 'done': return ['ds-badge--done', 'done'];
    case 'in-progress': return ['ds-badge--progress', 'in progress'];
    case 'blocked': return ['ds-badge--blocked', 'blocked'];
    case 'addressed': return ['ds-badge--addressed', 'addressed'];
    default: return ['ds-badge--todo', 'to do'];
  }
}

/**
 * The spec (or nearest-parent) badge descriptor for a card, or null. Roots and a
 * node whose spec equals its own id are suppressed so a spec card never shows a
 * redundant self-badge. In agile mode (no spec) it degrades to feature/epic.
 * @param {object} node
 * @returns {{kind:'spec'|'parent', text:string}|null}
 */
function specBadgeFor(node) {
  if (!node) return null;
  const id = displayId(node);
  const spec = specOf(node);
  if (spec && spec !== id) return { kind: 'spec', text: spec };
  const fm = node.frontmatter || {};
  const parent = fm.featureId || fm.epicId || '';
  if (parent && String(parent) !== id) return { kind: 'parent', text: String(parent) };
  return null;
}

/** Render one artifact card. */
function cardlet(node) {
  const [badgeClass, badgeLabel] = badgeFor(node && node.status);
  const localId = displayId(node);
  const sb = specBadgeFor(node);
  const card = el('div', {
    class: 'ds-cardlet',
    attrs: { 'data-id': node.id, role: 'link', tabindex: '0', 'aria-label': `${localId} ${node.title || ''}` },
  }, [
    el('span', { class: `ds-cardlet__accent type-${node.type || 'task'}` }),
    el('div', { class: 'ds-cardlet__idrow' }, [
      el('span', { class: 'ds-cardlet__id', text: localId }),
      sb ? el('span', {
        class: `ds-cardlet__spec${sb.kind === 'parent' ? ' ds-cardlet__spec--parent' : ''}`,
        text: sb.text,
        attrs: { title: sb.kind === 'spec' ? `Spec ${sb.text}` : `In ${sb.text}` },
      }) : null,
    ]),
    el('span', { class: 'ds-cardlet__title', text: node.title || localId }),
    el('div', { class: 'ds-cardlet__foot' }, [
      el('span', { class: 'ds-cardlet__type', text: node.type || '' }),
      el('span', { class: `ds-badge ${badgeClass}`, text: badgeLabel }),
    ]),
  ]);
  const go = () => { location.hash = `#detail/${node.id}`; };
  card.addEventListener('click', go);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
  });
  return card;
}

/** Resolve the display label for a group key under the current grouping. */
function groupLabel(key, dimension) {
  if (dimension === 'status') return STATUS_LABEL[key] || key;
  if (key === 'unassigned') return 'Unassigned';
  return key;
}

/** Render the columns for a grouping into `host`, narrowed to `specFilter`. */
function renderColumns(host, graph, dimension, specFilter) {
  host.innerHTML = '';
  let nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  if (specFilter && specFilter !== 'all') nodes = nodes.filter((n) => specOf(n) === specFilter);
  const groups = groupBy(nodes, dimension);
  const cols = el('div', { class: 'board-cols', attrs: { 'data-group': dimension } });
  for (const [key, nodes] of groups) {
    const body = el('div', { class: 'board-col__body' });
    for (const n of nodes) body.append(cardlet(n));
    cols.append(el('div', { class: 'board-col', attrs: { 'data-col': key } }, [
      el('div', { class: 'board-col__head' }, [
        el('span', { class: 'board-col__title', text: groupLabel(key, dimension) }),
        el('span', { class: 'col-count tnum', text: String(nodes.length) }),
      ]),
      body,
    ]));
  }
  host.append(cols);
}

/**
 * Mount the Board view into `el`.
 * @param {HTMLElement} el2 content mount element
 */
export async function mount(el2) {
  if (!el2) return;
  ensureStyle();
  el2.innerHTML = '';
  el2.append(el('p', { class: 'ds-note', text: 'Loading board…' }));

  const graph = await fetchGraph();

  let dimension = 'status';
  let specFilter = 'all';

  // One source of truth for the columns: prefer the live SSE-merged graph, else
  // the initial fetch. The Group-by buttons, the spec <select>, and the rail
  // filter handler all read this so they stay in sync.
  const currentGraph = () => {
    const live = (typeof window !== 'undefined' && window.__dashboard && window.__dashboard.graph) || null;
    return live && Array.isArray(live.nodes) && live.nodes.length ? live : graph;
  };

  const root = el('div', { class: 'board-view' });
  const header = el('div', {}, [
    el('div', { class: 'ds-eyebrow', text: 'Board' }),
    el('h1', { class: 'ds-h1', text: 'Kanban board' }),
    el('p', { class: 'ds-lede', text: 'Grouped by status — read-only mirror of .planr/ (drag-to-move arrives with write-back, M4)' }),
  ]);

  const colsHost = el('div', { class: 'board-colshost' });

  // "Group by" toolbar control (Status / Sprint / Feature).
  const groupby = el('div', { class: 'board-groupby', attrs: { role: 'group', 'aria-label': 'Group by' } });
  const DIMS = [['status', 'Status'], ['sprint', 'Sprint'], ['feature', 'Feature']];
  const buttons = new Map();
  for (const [dim, label] of DIMS) {
    const btn = el('button', {
      class: 'board-groupby__btn',
      text: label,
      attrs: { type: 'button', 'data-group': dim, 'aria-pressed': dim === dimension ? 'true' : 'false' },
    });
    btn.addEventListener('click', () => {
      if (dimension === dim) return;
      dimension = dim;
      for (const [d, b] of buttons) b.setAttribute('aria-pressed', d === dim ? 'true' : 'false');
      renderColumns(colsHost, currentGraph(), dimension, specFilter);
    });
    buttons.set(dim, btn);
    groupby.append(btn);
  }

  const toolbar = el('div', { class: 'board-toolbar' }, [
    el('span', { class: 'board-toolbar__label', text: 'Group by' }),
    groupby,
  ]);

  // Spec filter — a native <select> at the far right of the toolbar. Only shown
  // when specs exist (a pure agile project keeps just the Group-by control).
  const buildSpecOptions = (select, specs) => {
    select.innerHTML = '';
    select.append(el('option', { text: 'All specs', attrs: { value: 'all' } }));
    for (const s of specs) select.append(el('option', { text: s, attrs: { value: s } }));
    select.value = specFilter;
  };
  let specSelect = null;
  const initialSpecs = specsInGraph(graph.nodes);
  if (initialSpecs.length) {
    specSelect = el('select', { class: 'board-specfilter__select', attrs: { 'aria-label': 'Filter by spec' } });
    buildSpecOptions(specSelect, initialSpecs);
    specSelect.addEventListener('change', () => {
      specFilter = specSelect.value;
      renderColumns(colsHost, currentGraph(), dimension, specFilter);
    });
    toolbar.append(el('div', { class: 'board-specfilter' }, [
      el('span', { class: 'board-toolbar__label', text: 'Spec' }),
      specSelect,
    ]));
  }

  renderColumns(colsHost, graph, dimension, specFilter);
  root.append(header, toolbar, colsHost);

  el2.innerHTML = '';
  el2.append(root);

  // Re-render columns in place when the rail filter changes (AC: read-only).
  // Also keep the spec <select> options fresh and reset a vanished selection.
  const onFilterChange = () => {
    const g = currentGraph();
    if (specSelect) {
      const specs = specsInGraph(g.nodes);
      if (specFilter !== 'all' && !specs.includes(specFilter)) specFilter = 'all';
      const want = ['all', ...specs];
      const have = [...specSelect.options].map((o) => o.value);
      if (want.length !== have.length || want.some((v, i) => v !== have[i])) buildSpecOptions(specSelect, specs);
      specSelect.value = specFilter;
    }
    renderColumns(colsHost, g, dimension, specFilter);
  };
  document.addEventListener('planr:filter-change', onFilterChange);

  // Hand main.js a teardown so the listener does not leak across route changes.
  mount.cleanup = () => document.removeEventListener('planr:filter-change', onFilterChange);
}
