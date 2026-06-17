/**
 * overview.js — Overview view (SPEC-016 / T-006).
 *
 * design-spec §9 Screen #1: project health. Reads the project graph (live SSE
 * graph when present, else GET /api/graph) and renders a WHOLE-PROJECT snapshot:
 *   - a Completion tile + one KPI tile per artifact TYPE PRESENT (metadata-driven
 *     via typesInGraph / typePlural — quick, backlog, epic, feature, sprint, adr
 *     are no longer invisible)
 *   - an all-artifacts status breakdown (segmented bar + legend) over every
 *     status present, labelled/badged from the metadata registry
 *   - a specs table (nodes of type "spec" with a progress bar + status badge)
 *   - a 5-entry mini activity feed placeholder (live data wired by T-007)
 *
 * The Overview is a whole-project snapshot, so it deliberately does NOT honor the
 * rail filter (Type/Status) — that scoping belongs to Board/List/Graph. It DOES
 * prefer the live SSE-merged graph so counts stay fresh.
 *
 * When the graph is empty it delegates to empty-state.js; sections with no rows
 * of their own render explicit empty-state copy (never a blank dead-end).
 *
 * Token-only styling (ds.css). The variable-width KPI grid and the per-status
 * segment/dot colors are injected via a scoped <style> block because ds.css is a
 * Preserve file — no raw hex, no off-grid spacing, no third-party product codenames.
 *
 * Node shape (from lib/dashboard/graph-reader.mjs):
 *   { id, type, title, status, frontmatter, ... }
 *   status ∈ done | in-progress | blocked | addressed | outstanding
 */

import { mount as mountEmpty } from '../empty-state.js';
import { displayId } from '../display-id.js';
import {
  typesInGraph,
  typePlural,
  statusLabel,
  statusBadge,
  STATUS_IDS,
} from '../metadata.js';

const STYLE_ID = 'planr-overview-style';

/* Per-status accent tokens for the status bar / legend. Keyed by status id so a
 * breakdown covering ALL five statuses (the legacy bar folded them into four
 * buckets) stays on-palette; unknown statuses fall back to the muted token. */
const OVERVIEW_CSS = `
.ov-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-4);
  margin-top: var(--space-6);
}
.ov-statusbar__seg--outstanding,
.ov-statusbar__dot--outstanding { background: var(--muted-foreground); }
.ov-statusbar__seg--in-progress,
.ov-statusbar__dot--in-progress { background: var(--primary); }
.ov-statusbar__seg--blocked,
.ov-statusbar__dot--blocked { background: var(--warning); }
.ov-statusbar__seg--done,
.ov-statusbar__dot--done { background: var(--success); }
.ov-statusbar__seg--addressed,
.ov-statusbar__dot--addressed { background: var(--info); }
.ov-statusbar__seg--unknown,
.ov-statusbar__dot--unknown { background: var(--muted-foreground); }
.ov-emptyrow {
  padding: var(--space-6);
  text-align: center;
  color: var(--muted-foreground);
  font-size: var(--text-sm);
}
`;

/** Inject the overview stylesheet once (ds.css is a Preserve file). */
function ensureStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = OVERVIEW_CSS;
  document.head.append(style);
}

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

/**
 * Tally nodes (optionally of one type) into the five graph statuses + total.
 * Unknown statuses are folded into `outstanding` so nothing is dropped.
 */
function tally(nodes, type) {
  const out = { total: 0, done: 0, 'in-progress': 0, blocked: 0, addressed: 0, outstanding: 0 };
  for (const n of nodes) {
    if (type && n.type !== type) continue;
    out.total += 1;
    const key = Object.prototype.hasOwnProperty.call(out, n.status) ? n.status : 'outstanding';
    out[key] += 1;
  }
  return out;
}

/** Count nodes by status id across the whole graph (registry order, present-only). */
function statusCounts(nodes) {
  const counts = new Map();
  for (const n of nodes) {
    const key = n && n.status != null && n.status !== '' ? String(n.status) : 'outstanding';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/** A KPI tile. */
function kpiTile(label, value, sub) {
  return el('div', { class: 'ds-card' }, [
    el('div', { class: 'ds-kpi__label', text: label }),
    el('div', { class: 'ds-kpi__value tnum', text: String(value) }),
    el('div', { class: 'ds-kpi__sub', text: sub }),
  ]);
}

/** Compute a percentage from part/total (0 when total is 0). */
function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

/** A status id we recognise gets its own class suffix; anything else is "unknown". */
function statusClassKey(status) {
  return STATUS_IDS.includes(status) ? status : 'unknown';
}

/**
 * The KPI tiles — METADATA-DRIVEN. A leading "Completion" tile (done over ALL
 * artifacts, since the snapshot spans every type) then one tile per type present
 * in the graph, in registry order, using its plural label + count and a
 * done/open/blocked sub-line. No type is hardcoded in or out.
 * @param {{nodes: object[]}} graph
 */
function kpiSection(graph) {
  const nodes = graph.nodes;
  const overall = tally(nodes);
  const completion = pct(overall.done, overall.total);

  const tiles = el('div', { class: 'ov-kpis' });
  // Completion is computed across ALL work in the project (every artifact type),
  // matching the all-artifacts status breakdown below.
  tiles.append(kpiTile('Completion', `${completion}%`, `${overall.done} of ${overall.total} done`));

  for (const type of typesInGraph(nodes)) {
    const t = tally(nodes, type);
    const open = t['in-progress'] + t.outstanding + t.addressed;
    tiles.append(kpiTile(
      typePlural(type),
      t.total,
      `${t.done} done · ${open} open · ${t.blocked} blocked`,
    ));
  }
  return tiles;
}

/**
 * The status breakdown — covers ALL artifacts, not tasks only. Renders a
 * segmented bar (one segment per status present, canonical order) and a legend
 * labelled from the metadata registry; counts come from every node in the graph.
 * @param {{nodes: object[]}} graph
 */
function statusSection(graph) {
  const nodes = graph.nodes;
  const counts = statusCounts(nodes);
  const total = nodes.length;
  // Enumerate the statuses actually counted (this folds unknown statuses into
  // outstanding, so we read from the counts map) in canonical order, unknowns last.
  const present = [...counts.keys()].sort((a, b) => {
    const ia = STATUS_IDS.indexOf(a);
    const ib = STATUS_IDS.indexOf(b);
    return (ia === -1 ? STATUS_IDS.length : ia) - (ib === -1 ? STATUS_IDS.length : ib)
      || a.localeCompare(b);
  });

  const card = el('div', { class: 'ds-card' });

  if (!total) {
    card.append(el('div', { class: 'ov-emptyrow', text: 'No artifacts yet' }));
  } else {
    const bar = el('div', {
      class: 'ds-segbar',
      attrs: { role: 'img', 'aria-label': 'Artifact status distribution' },
    });
    for (const status of present) {
      const n = counts.get(status) || 0;
      if (!n) continue;
      const seg = el('div', { class: `ds-segbar__seg ov-statusbar__seg--${statusClassKey(status)}` });
      seg.style.width = `${pct(n, total)}%`;
      bar.append(seg);
    }

    const legend = el('div', { class: 'ds-legend' });
    for (const status of present) {
      legend.append(el('span', { class: 'ds-legend__item' }, [
        el('span', { class: `ds-legend__dot ov-statusbar__dot--${statusClassKey(status)}` }),
        el('span', { text: `${statusLabel(status)} ${counts.get(status) || 0}` }),
      ]));
    }
    card.append(bar, legend);
  }

  return el('section', { class: 'ds-section' }, [
    el('div', { class: 'ds-section__head' }, [
      el('div', { class: 'ds-section__title', text: 'Status breakdown' }),
      el('div', { class: 'ds-section__meta tnum', text: `${total} total` }),
    ]),
    card,
  ]);
}

/** Progress for a spec = its done children / total children (null when none). */
function specProgress(specId, nodes, edges) {
  const childIds = new Set(
    edges.filter((e) => e.kind === 'contains' && e.from === specId).map((e) => e.to),
  );
  if (childIds.size === 0) return null;
  let done = 0;
  for (const n of nodes) if (childIds.has(n.id) && n.status === 'done') done += 1;
  return pct(done, childIds.size);
}

/** The specs table (with an empty-state row when no specs exist yet). */
function specsSection(graph) {
  const specs = graph.nodes.filter((n) => n.type === 'spec');

  const card = el('section', { class: 'ds-card' }, [
    el('div', { class: 'ds-section__head' }, [
      el('div', { class: 'ds-section__title', text: 'Specs' }),
    ]),
  ]);

  if (!specs.length) {
    card.append(el('div', { class: 'ov-emptyrow', text: 'No specs yet' }));
    return card;
  }

  const table = el('table', { class: 'ds-table' });
  const thead = el('thead', {}, [
    el('tr', {}, [
      el('th', { text: 'ID' }),
      el('th', { text: 'Title' }),
      el('th', { text: 'Progress' }),
      el('th', { text: 'Status' }),
    ]),
  ]);
  const tbody = el('tbody');
  for (const s of specs) {
    const progress = specProgress(s.id, graph.nodes, graph.edges);
    const [badgeClass, badgeText] = statusBadge(s.status);
    const progCell = el('td');
    if (progress == null) {
      progCell.append(el('span', { class: 'ds-progress__pct', text: '—' }));
    } else {
      const fill = el('div', { class: 'ds-progress__fill' });
      fill.style.width = `${progress}%`;
      progCell.append(el('div', { class: 'ds-progress' }, [
        el('div', { class: 'ds-progress__track' }, [fill]),
        el('span', { class: 'ds-progress__pct tnum', text: `${progress}%` }),
      ]));
    }
    tbody.append(el('tr', {}, [
      el('td', { class: 'ds-table__id', text: displayId(s) }),
      el('td', { text: s.title }),
      progCell,
      el('td', {}, [el('span', { class: `ds-badge ${badgeClass}`, text: badgeText })]),
    ]));
  }
  table.append(thead, tbody);

  card.append(el('div', { class: 'ds-tablewrap' }, [table]));
  return card;
}

/**
 * The mini activity feed placeholder. Real entries stream in via T-007 data
 * wiring; this renders up to 5 neutral placeholder rows so the layout matches
 * the design while empty.
 */
function feedSection() {
  const rows = el('div', { class: 'ds-feed' });
  for (let i = 0; i < 5; i++) {
    rows.append(el('div', { class: 'ds-feed__row', attrs: { 'data-feed-placeholder': 'true' } }, [
      el('span', { class: 'ds-feed__dot ds-dot--todo' }),
      el('div', { class: 'ds-feed__body' }, [
        el('div', { class: 'ds-feed__text', text: 'Awaiting activity…' }),
        el('div', { class: 'ds-feed__meta', text: 'live feed' }),
      ]),
      el('span', { class: 'ds-feed__time', text: '—' }),
    ]));
  }
  return el('section', { class: 'ds-card' }, [
    el('div', { class: 'ds-section__head' }, [
      el('div', { class: 'ds-section__title', text: 'Recent activity' }),
      el('span', { class: 'ds-livebadge' }, [
        el('span', { class: 'ds-livebadge__dot' }),
        el('span', { text: 'live' }),
      ]),
    ]),
    rows,
  ]);
}

/**
 * Mount the Overview view into `el`. Whole-project snapshot — does NOT honor the
 * rail filter (Board/List/Graph own that), but prefers the live SSE-merged graph.
 * @param {HTMLElement} el2 content mount element
 */
export async function mount(el2) {
  if (!el2) return;
  ensureStyle();
  el2.innerHTML = '';
  el2.append(el('p', { class: 'ds-note', text: 'Loading overview…' }));

  const fetched = await fetchGraph();
  // Live data preference (the SSE merge keeps window.__dashboard.graph fresh).
  const live = (typeof window !== 'undefined' && window.__dashboard && window.__dashboard.graph) || null;
  const graph = live && Array.isArray(live.nodes) && live.nodes.length ? live : fetched;

  // empty-graph case → delegate to the empty state
  if (!graph.nodes.length) {
    mountEmpty(el2);
    return;
  }

  el2.innerHTML = '';
  el2.append(
    el('div', {}, [
      el('div', { class: 'ds-eyebrow', text: 'Dashboard' }),
      el('h1', { class: 'ds-h1', text: 'Project overview' }),
      el('p', { class: 'ds-lede', text: 'Live view of everything in .planr/ — read-first, in lockstep with disk' }),
    ]),
    kpiSection(graph),
    statusSection(graph),
    el('div', { class: 'ds-grid-2' }, [
      specsSection(graph),
      feedSection(),
    ]),
  );
}
