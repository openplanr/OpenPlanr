/**
 * list.js — Filterable artifact List view (SPEC-016 / T-010 UI + T-011 logic).
 *
 * design-spec §9 Screen #4 (mockups/04-list-{desktop,tablet,mobile}.png):
 * "All artifacts" — a filter toolbar of type chips above a sticky-header table
 * with five columns (id · title · type · status · updated). Fetches
 * GET /api/graph, renders a row per visible artifact, filters by type chip,
 * and sorts by any column header (click toggles asc → desc). Re-renders on
 * `planr:filter-change` and `planr:sort-change`. On mobile the table scrolls
 * horizontally inside its card rather than squishing (design-spec §3).
 *
 * UI layer (T-010): mount(el) + chips/table/sort rendering + filterState glue.
 * Data layer (T-011): pure filterNodes() / sortNodes() exported below — no DOM,
 * unit-testable. Both live in this one file per the task contract.
 *
 * Token-only styling (ds.css tokens; list extras injected via <style> since
 * ds.css is a Preserve file). No raw hex, no off-grid spacing, no third-party
 * product codenames.
 *
 * Node shape (schemas/v1.0.0/graph.schema.json):
 *   { id, type, title, status, frontmatter: { updated?, ... } }
 */

import { displayId } from '../display-id.js';

/* ── data layer (T-011) — pure, no DOM ──────────────────────────────── */

/** Status sort rank so "status" sorting is alphabetical on the display label. */
const STATUS_RANK = {
  blocked: 'blocked',
  done: 'done',
  'in-progress': 'in progress',
  outstanding: 'outstanding',
  addressed: 'addressed',
};

/** Read the sprint ref off a node (frontmatter.sprintId / sprint, else ""). */
function sprintOf(node) {
  const fm = (node && node.frontmatter) || {};
  return fm.sprintId || fm.sprint || '';
}

/** Read the dependsOn ids off a node (always an array). */
function depsOf(node) {
  const fm = (node && node.frontmatter) || {};
  return Array.isArray(fm.dependsOn) ? fm.dependsOn.map((d) => String(d)) : [];
}

/** Read a PR / issue ref off a node (node.githubIssue / frontmatter, else ""). */
function prOf(node) {
  const fm = (node && node.frontmatter) || {};
  return node && node.githubIssue ? String(node.githubIssue)
    : (fm.githubIssue || fm.pr || fm.prNumber || '');
}

/** Comparable string for a node under a sort key. */
function sortValue(node, key) {
  switch (key) {
    case 'id': return String(node.id || '');
    case 'title': return String(node.title || '');
    case 'type': return String(node.type || '');
    case 'status': return STATUS_RANK[node.status] || String(node.status || '');
    case 'sprint': return String(sprintOf(node));
    default: return String(node.id || '');
  }
}

/**
 * Filter nodes by type + status. Pure: no DOM, no side effects.
 * @param {Array<object>} nodes
 * @param {{ typeFilter?: string[], statusFilter?: string|null, search?: string }} filterState
 *        typeFilter: array of type strings; empty/absent = all types.
 *        statusFilter: a status string; null/absent = all statuses.
 *        search: case-insensitive substring matched against id + display id + title.
 * @returns {Array<object>}
 */
export function filterNodes(nodes, filterState) {
  const list = Array.isArray(nodes) ? nodes : [];
  const fs = filterState || {};
  const types = Array.isArray(fs.typeFilter) ? fs.typeFilter : [];
  const status = fs.statusFilter == null ? null : fs.statusFilter;
  const search = typeof fs.search === 'string' ? fs.search.trim().toLowerCase() : '';
  return list.filter((n) => {
    if (types.length && !types.includes(n && n.type)) return false;
    if (status != null && (n && n.status) !== status) return false;
    if (search) {
      const hay = `${(n && n.id) || ''} ${displayId(n)} ${(n && n.title) || ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

/**
 * Stable sort by a column key. Pure: returns a new array, leaves input intact.
 * @param {Array<object>} nodes
 * @param {'id'|'title'|'type'|'status'|'sprint'} sortKey
 * @param {'asc'|'desc'} direction
 * @returns {Array<object>}
 */
export function sortNodes(nodes, sortKey, direction) {
  const list = Array.isArray(nodes) ? nodes.slice() : [];
  const dir = direction === 'desc' ? -1 : 1;
  // Decorate-sort-undecorate keeps the sort stable across engines.
  return list
    .map((n, i) => ({ n, i }))
    .sort((a, b) => {
      const av = sortValue(a.n, sortKey);
      const bv = sortValue(b.n, sortKey);
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      return cmp !== 0 ? cmp * dir : a.i - b.i;
    })
    .map((x) => x.n);
}

/* ── UI layer (T-010) ───────────────────────────────────────────────── */

/** The table columns (display order), matching the signed-off mockup. id/title/
 * type/status/sprint sort; deps/PR are reference columns (not sortable). */
const COLUMNS = [
  { sortKey: 'id', label: 'ID', sortable: true },
  { sortKey: 'title', label: 'Title', sortable: true },
  { sortKey: 'type', label: 'Type', sortable: true },
  { sortKey: 'status', label: 'Status', sortable: true },
  { sortKey: 'sprint', label: 'Sprint', sortable: true },
  { key: 'deps', label: 'Deps', sortable: false },
  { key: 'pr', label: 'PR', sortable: false },
];

/** Type chips offered in the filter toolbar (plural + count, like the mockup);
 * only types present in the data are shown so a spec project never advertises an
 * empty Epics/Features chip. */
const TYPE_CHIPS = [
  { type: 'epic', label: 'Epics' },
  { type: 'feature', label: 'Features' },
  { type: 'story', label: 'Stories' },
  { type: 'task', label: 'Tasks' },
  { type: 'spec', label: 'Specs' },
];

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

/** Token-scoped list CSS, injected once (ds.css is a Preserve file). */
const STYLE_ID = 'ds-list-style';
const LIST_CSS = `
.list-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-4) 0 var(--space-4);
}
.chip {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  color: var(--foreground);
  font-size: var(--text-sm);
  transition: background var(--duration-fast) var(--ease);
}
.chip:hover { background: var(--muted); }
.chip[aria-pressed="true"] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-foreground);
  font-weight: var(--weight-medium);
}
.dark .chip[aria-pressed="true"] { color: var(--foreground); }

.list-sortbtn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  border: none;
  background: transparent;
  color: var(--muted-foreground);
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: .04em;
  text-transform: uppercase;
}
.list-sortbtn:hover { color: var(--foreground); }
.list-sortbtn[aria-sort="ascending"],
.list-sortbtn[aria-sort="descending"] { color: var(--foreground); }
.list-sortbtn__arrow { font-size: var(--text-xs); color: var(--muted-foreground); }
.list-empty { padding: var(--space-6); text-align: center; color: var(--muted-foreground); }
.list-id { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--muted-foreground); }
.list-type { color: var(--muted-foreground); }
.list-sprint { color: var(--muted-foreground); font-size: var(--text-sm); }
.list-deps, .list-pr { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--muted-foreground); }
.list-row { cursor: pointer; }
.list-row:hover td { background: var(--muted); }

/* non-sortable column header label (deps / PR) — matches the sort-button type */
.list-th {
  display: inline-flex;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

/* search box (left of the type chips), styled like the top-bar search */
.list-search {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  width: 240px;
  max-width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--muted-foreground);
  transition: border-color var(--duration-fast) var(--ease);
}
.list-search:focus-within { border-color: var(--ring); }
.list-search__icon { display: inline-flex; flex: 0 0 auto; }
.list-search__input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  background: transparent;
  outline: none;
  color: var(--foreground);
  font: inherit;
  font-size: var(--text-sm);
}
.list-search__input::placeholder { color: var(--muted-foreground); }
`;

/** Inject the list stylesheet once. */
function ensureStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = LIST_CSS;
  document.head.append(style);
}

/** Magnifier icon for the search box (inline outline SVG, currentColor). */
const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" '
  + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
  + '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';

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

/** Map a node status onto a badge class + label (reuses ds.css badges). */
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
 * Shared client-side filter + sort state. setFilter() mutates the state then
 * dispatches the matching event so the view re-renders. The dimension `'type'`
 * sets typeFilter; `'status'` sets statusFilter.
 */
export const filterState = {
  typeFilter: [],
  statusFilter: null,
  search: '',
  sortKey: 'id',
  sortDir: 'asc',
  /**
   * @param {'type'|'status'|'search'} dimension
   * @param {string[]|string|null} value
   */
  setFilter(dimension, value) {
    if (dimension === 'type') this.typeFilter = Array.isArray(value) ? value.slice() : [];
    else if (dimension === 'status') this.statusFilter = value == null ? null : String(value);
    else if (dimension === 'search') this.search = value == null ? '' : String(value);
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('planr:filter-change', {
        detail: { typeFilter: this.typeFilter, statusFilter: this.statusFilter, search: this.search },
      }));
    }
  },
  /** Set sort key + direction (toggles direction when the key is unchanged). */
  setSort(sortKey) {
    if (this.sortKey === sortKey) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortKey = sortKey; this.sortDir = 'asc'; }
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('planr:sort-change', {
        detail: { sortKey: this.sortKey, sortDir: this.sortDir },
      }));
    }
  },
};

/** Render the table body rows for the current filter + sort. */
function renderRows(tbody, graph) {
  tbody.innerHTML = '';
  const visible = sortNodes(
    filterNodes(graph.nodes, filterState),
    filterState.sortKey,
    filterState.sortDir,
  );

  if (!visible.length) {
    const tr = el('tr');
    const td = el('td', { class: 'list-empty', attrs: { colspan: String(COLUMNS.length) }, text: 'No artifacts match the current filters.' });
    tr.append(td);
    tbody.append(tr);
    return;
  }

  for (const n of visible) {
    const [badgeClass, badgeLabel] = badgeFor(n.status);
    const deps = depsOf(n);
    const pr = prOf(n);
    const prText = pr ? (/^(#|http)/.test(pr) ? pr : `#${pr}`) : '—';
    const row = el('tr', { class: 'list-row', attrs: { 'data-id': n.id } }, [
      el('td', { class: 'list-id', text: displayId(n) }),
      el('td', { text: n.title || displayId(n) }),
      el('td', { class: 'list-type', text: n.type || '' }),
      el('td', {}, [el('span', { class: `ds-badge ${badgeClass}`, text: badgeLabel })]),
      el('td', { class: 'list-sprint', text: sprintOf(n) || '—' }),
      el('td', { class: 'list-deps', text: deps.length ? deps.join(', ') : '—' }),
      el('td', { class: 'list-pr', text: prText }),
    ]);
    row.addEventListener('click', () => { location.hash = `#detail/${n.id}`; });
    tbody.append(row);
  }
}

/** Reflect the active sort key/direction onto the column header buttons. */
function syncSortHeaders(headerBtns) {
  for (const [key, btn] of headerBtns) {
    if (key !== filterState.sortKey) {
      btn.setAttribute('aria-sort', 'none');
      const arrow = btn.querySelector('.list-sortbtn__arrow');
      if (arrow) arrow.textContent = '';
      continue;
    }
    const asc = filterState.sortDir === 'asc';
    btn.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
    const arrow = btn.querySelector('.list-sortbtn__arrow');
    if (arrow) arrow.textContent = asc ? '↑' : '↓';
  }
}

/** Reflect the active type filter onto the chips. */
function syncChips(chipBtns) {
  for (const [type, btn] of chipBtns) {
    btn.setAttribute('aria-pressed', filterState.typeFilter.includes(type) ? 'true' : 'false');
  }
}

/**
 * Mount the List view into `el`.
 * @param {HTMLElement} el2 content mount element
 */
export async function mount(el2) {
  if (!el2) return;
  ensureStyle();
  el2.innerHTML = '';
  el2.append(el('p', { class: 'ds-note', text: 'Loading list…' }));

  const graph = await fetchGraph();

  const header = el('div', {}, [
    el('div', { class: 'ds-eyebrow', text: 'List' }),
    el('h1', { class: 'ds-h1', text: 'All artifacts' }),
  ]);

  // filter toolbar — search box + "All" + one counted chip per present type.
  const toolbar = el('div', { class: 'list-toolbar', attrs: { role: 'group', 'aria-label': 'Filter artifacts' } });
  const chipBtns = new Map();

  // search box (filters rows by id / display id / title, live).
  const searchInput = el('input', {
    class: 'list-search__input',
    attrs: { type: 'search', placeholder: 'Search id or title…', 'aria-label': 'Search artifacts by id or title', value: filterState.search || '' },
  });
  searchInput.addEventListener('input', () => filterState.setFilter('search', searchInput.value));
  toolbar.append(el('div', { class: 'list-search' }, [
    el('span', { class: 'list-search__icon', html: SEARCH_ICON }),
    searchInput,
  ]));

  const allChip = el('button', {
    class: 'chip',
    text: 'All',
    attrs: { type: 'button', 'data-type': 'all', 'aria-pressed': filterState.typeFilter.length ? 'false' : 'true' },
  });
  allChip.addEventListener('click', () => {
    filterState.setFilter('type', []);
  });
  toolbar.append(allChip);

  for (const { type, label } of TYPE_CHIPS) {
    const count = graph.nodes.filter((n) => n.type === type).length;
    if (!count) continue; // only advertise types that exist in this project
    const chip = el('button', {
      class: 'chip',
      attrs: { type: 'button', 'data-type': type, 'aria-pressed': 'false' },
    }, [
      el('span', { text: `${label} ${count}` }),
    ]);
    chip.addEventListener('click', () => {
      // toggle this type in the filter set.
      const set = new Set(filterState.typeFilter);
      if (set.has(type)) set.delete(type); else set.add(type);
      filterState.setFilter('type', [...set]);
    });
    chipBtns.set(type, chip);
    toolbar.append(chip);
  }

  // table with sticky thead + sortable headers.
  const table = el('table', { class: 'ds-table' });
  const headRow = el('tr');
  const headerBtns = new Map();
  for (const col of COLUMNS) {
    if (!col.sortable) {
      // reference column (deps / PR) — a plain, non-interactive header label.
      headRow.append(el('th', {}, [el('span', { class: 'list-th', text: col.label })]));
      continue;
    }
    const btn = el('button', {
      class: 'list-sortbtn',
      attrs: { type: 'button', 'data-sort': col.sortKey, 'aria-sort': 'none' },
    }, [
      el('span', { text: col.label }),
      el('span', { class: 'list-sortbtn__arrow' }),
    ]);
    btn.addEventListener('click', () => {
      filterState.setSort(col.sortKey);
    });
    headerBtns.set(col.sortKey, btn);
    headRow.append(el('th', {}, [btn]));
  }
  const thead = el('thead', {}, [headRow]);
  const tbody = el('tbody');
  table.append(thead, tbody);

  const card = el('section', { class: 'ds-card' }, [
    el('div', { class: 'ds-tablewrap' }, [table]),
  ]);

  const root = el('div', {}, [header, toolbar, card]);
  el2.innerHTML = '';
  el2.append(root);

  // initial paint
  renderRows(tbody, graph);
  syncSortHeaders(headerBtns);
  syncChips(chipBtns);
  allChip.setAttribute('aria-pressed', filterState.typeFilter.length ? 'false' : 'true');

  // live data preference (SSE merge keeps window.__dashboard.graph fresh).
  const currentGraph = () => {
    const live = (typeof window !== 'undefined' && window.__dashboard && window.__dashboard.graph) || null;
    return live && Array.isArray(live.nodes) && live.nodes.length ? live : graph;
  };

  const onFilterChange = () => {
    renderRows(tbody, currentGraph());
    syncChips(chipBtns);
    allChip.setAttribute('aria-pressed', filterState.typeFilter.length ? 'false' : 'true');
  };
  const onSortChange = () => {
    renderRows(tbody, currentGraph());
    syncSortHeaders(headerBtns);
  };
  document.addEventListener('planr:filter-change', onFilterChange);
  document.addEventListener('planr:sort-change', onSortChange);

  mount.cleanup = () => {
    document.removeEventListener('planr:filter-change', onFilterChange);
    document.removeEventListener('planr:sort-change', onSortChange);
  };
}
