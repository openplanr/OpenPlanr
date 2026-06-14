/**
 * overview.js — Overview view (SPEC-016 / T-006).
 *
 * design-spec §9 Screen #1: project health. Fetches GET /api/graph, counts nodes
 * by status, and renders:
 *   - KPI tiles (Specs · Stories · Tasks · Completion)
 *   - a segmented task-status bar + legend
 *   - a specs table (nodes of type "spec" with a progress bar + status badge)
 *   - a 5-entry mini activity feed placeholder (live data wired by T-007)
 *
 * When the graph is empty it delegates to empty-state.js. Token-only styling
 * (ds.css) — no raw hex, no off-grid spacing, no third-party product codenames.
 *
 * Node shape (from lib/dashboard/graph-reader.mjs):
 *   { id, type, title, status, frontmatter, ... }
 *   status ∈ done | in-progress | blocked | addressed | outstanding
 */

import { mount as mountEmpty } from '../empty-state.js';
import { displayId } from '../display-id.js';

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

/** Tally nodes (optionally of one type) into the five graph statuses + total. */
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

/** Group the status tally into the four visible buckets (done / progress / blocked / todo). */
function buckets(t) {
  const done = t.done;
  const progress = t['in-progress'];
  const blocked = t.blocked;
  const todo = t.outstanding + t.addressed;
  return { done, progress, blocked, todo, total: done + progress + blocked + todo };
}

/** A KPI tile. */
function kpiTile(label, value, sub) {
  return el('div', { class: 'ds-card' }, [
    el('div', { class: 'ds-kpi__label', text: label }),
    el('div', { class: 'ds-kpi__value tnum', text: String(value) }),
    el('div', { class: 'ds-kpi__sub', text: sub }),
  ]);
}

/** Compute a percentage string from part/total (0 when total is 0). */
function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

/** The segmented status bar + legend. */
function statusSection(taskBuckets) {
  const { done, progress, blocked, todo, total } = taskBuckets;
  const bar = el('div', { class: 'ds-segbar', attrs: { role: 'img', 'aria-label': 'Task status distribution' } });
  const segs = [
    ['done', done], ['progress', progress], ['blocked', blocked], ['todo', todo],
  ];
  for (const [name, n] of segs) {
    if (!n) continue;
    const seg = el('div', { class: `ds-segbar__seg ds-seg--${name}` });
    seg.style.width = `${pct(n, total)}%`;
    bar.append(seg);
  }

  const legend = el('div', { class: 'ds-legend' });
  const items = [
    ['done', 'Done', done], ['progress', 'In progress', progress],
    ['blocked', 'Blocked', blocked], ['todo', 'To do', todo],
  ];
  for (const [name, label, n] of items) {
    legend.append(el('span', { class: 'ds-legend__item' }, [
      el('span', { class: `ds-legend__dot ds-dot--${name}` }),
      el('span', { text: `${label} ${n}` }),
    ]));
  }

  return el('section', { class: 'ds-section' }, [
    el('div', { class: 'ds-section__head' }, [
      el('div', { class: 'ds-section__title', text: 'Task status' }),
      el('div', { class: 'ds-section__meta tnum', text: `${total} total` }),
    ]),
    el('div', { class: 'ds-card' }, [bar, legend]),
  ]);
}

/** Map a graph status to a badge class + label. */
function badgeFor(status) {
  switch (status) {
    case 'done': return ['ds-badge--done', 'shipped'];
    case 'in-progress': return ['ds-badge--progress', 'active'];
    case 'blocked': return ['ds-badge--blocked', 'blocked'];
    case 'addressed': return ['ds-badge--addressed', 'addressed'];
    default: return ['ds-badge--todo', 'todo'];
  }
}

/** Progress for a spec = its done children / total children (0 when none). */
function specProgress(specId, nodes, edges) {
  const childIds = new Set(
    edges.filter((e) => e.kind === 'contains' && e.from === specId).map((e) => e.to),
  );
  if (childIds.size === 0) return null;
  let done = 0;
  for (const n of nodes) if (childIds.has(n.id) && n.status === 'done') done += 1;
  return pct(done, childIds.size);
}

/** The specs table. */
function specsSection(graph) {
  const specs = graph.nodes.filter((n) => n.type === 'spec');

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
    const [badgeClass, badgeLabel] = badgeFor(s.status);
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
      el('td', {}, [el('span', { class: `ds-badge ${badgeClass}`, text: badgeLabel })]),
    ]));
  }
  table.append(thead, tbody);

  return el('section', { class: 'ds-card' }, [
    el('div', { class: 'ds-section__head' }, [
      el('div', { class: 'ds-section__title', text: 'Specs' }),
    ]),
    el('div', { class: 'ds-tablewrap' }, [table]),
  ]);
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
 * Mount the Overview view into `el`.
 * @param {HTMLElement} el content mount element
 */
export async function mount(el2) {
  if (!el2) return;
  el2.innerHTML = '';
  el2.append(el('p', { class: 'ds-note', text: 'Loading overview…' }));

  const graph = await fetchGraph();

  // empty-graph case → delegate to the empty state
  if (!graph.nodes.length) {
    mountEmpty(el2);
    return;
  }

  const specTally = tally(graph.nodes, 'spec');
  const storyTally = tally(graph.nodes, 'story');
  const taskTally = tally(graph.nodes, 'task');
  const taskBuckets = buckets(taskTally);
  const completion = pct(taskBuckets.done, taskBuckets.total);

  el2.innerHTML = '';
  el2.append(
    el('div', {}, [
      el('div', { class: 'ds-eyebrow', text: 'Dashboard' }),
      el('h1', { class: 'ds-h1', text: 'Project overview' }),
      el('p', { class: 'ds-lede', text: 'Live view of everything in .planr/ — read-first, in lockstep with disk' }),
    ]),
    el('div', { class: 'ds-kpis' }, [
      kpiTile('Specs', specTally.total,
        `${specTally.done} shipped · ${specTally['in-progress']} active · ${specTally.blocked} blocked`),
      kpiTile('Stories', storyTally.total, `across ${specTally.total} specs`),
      kpiTile('Tasks', taskTally.total,
        `${taskBuckets.done} done · ${taskBuckets.progress + taskBuckets.todo} open · ${taskBuckets.blocked} blocked`),
      kpiTile('Completion', `${completion}%`, 'tasks done'),
    ]),
    statusSection(taskBuckets),
    el('div', { class: 'ds-grid-2' }, [
      specsSection(graph),
      feedSection(),
    ]),
  );
}
