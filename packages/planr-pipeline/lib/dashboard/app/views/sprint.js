/**
 * sprint.js — Sprint (burndown) view (SPEC-016 / T-012).
 *
 * design-spec §9 Screen #6 (mockups/06-sprint-{desktop,tablet,mobile}.png):
 * KPI tiles + a burndown SVG (no charting library) + a by-assignee table.
 * Fetches GET /api/graph (T-002), derives the active sprint with getSprintData()
 * and renders:
 *   - an eyebrow + H1 ("S-NN · <name>") + a date-range lede
 *   - KPI tiles: Committed, Done (%), In progress (n blocked), Carryover risk
 *   - a burndown card: a dashed ideal polyline (full commitment → 0 on day N),
 *     a solid actual polyline (commitment → today's remaining), and a filled
 *     area path under the actual line — all drawn by hand with §1 tokens
 *   - a by-assignee table: assignee · committed · done · progress bar
 *
 * Read-only. The burndown is hand-rolled SVG: ZERO charting-library imports.
 * Token-only styling — sprint CSS is injected via <style> because ds.css is a
 * Preserve file. No raw hex, no off-grid spacing, no third-party product
 * codenames.
 *
 * Data helper: getSprintData(graph) is exported here so it is importable by
 * sibling work and unit-testable; it is pure (no DOM, no fetch). It folds the
 * graph into a single illustrative sprint summary, tolerating a graph with no
 * sprint metadata (a synthesised default window keeps the view renderable).
 *
 * Node shape (lib/dashboard/graph-reader.mjs):
 *   { id, type, title, status, frontmatter: { sprintId?, agent?, owner?, ... } }
 *   status ∈ done | in-progress | blocked | outstanding | addressed
 */

/* ── data layer (pure, no DOM) ──────────────────────────────────────── */

/** Treat done + addressed as the terminal "done" bucket for burndown. */
function isDone(status) {
  return status === 'done' || status === 'addressed';
}

/** Read a node's assignee (agent / owner) for the by-assignee table. */
function assigneeOf(node) {
  const fm = (node && node.frontmatter) || {};
  const raw = fm.agent != null && fm.agent !== '' ? fm.agent
    : (fm.owner != null && fm.owner !== '' ? fm.owner : 'unassigned');
  return String(raw);
}

/** Parse a frontmatter timestamp (ms epoch or ISO date string) to ms, or NaN. */
function tsOf(node) {
  const fm = (node && node.frontmatter) || {};
  const raw = fm.updated != null && fm.updated !== '' ? fm.updated : fm.created;
  if (raw == null || raw === '') return NaN;
  if (typeof raw === 'number') return raw;
  const parsed = Date.parse(String(raw));
  return Number.isNaN(parsed) ? NaN : parsed;
}

/**
 * Derive the active-sprint KPI summary and day-by-day burndown series from the
 * graph. Pure: no DOM, no fetch, stdlib only.
 *
 * Algorithm (per T-013 spec):
 *   1. Active sprint = nodes of `type === "sprint"` with `status !== "done"`,
 *      taking the first by `frontmatter.created` ascending.
 *   2. Committed tasks = task nodes whose `frontmatter.sprintId` matches that
 *      sprint's id.
 *   3. KPIs: committed = count; completed = done/addressed count;
 *      carryover = committed − completed clamped at 0; velocity = completed.
 *   4. burndownPoints: bucket each committed task's `updated` timestamp into a
 *      sprint day index (day 0 = sprint start) and, for each day up to the
 *      current day, count tasks not yet completed by the end of that day.
 *
 * Returns `null` when no active sprint exists.
 *
 * @param {{nodes: object[], edges?: object[]}} graph
 * @returns {{
 *   sprintId: string,
 *   committed: number,
 *   completed: number,
 *   carryover: number,
 *   velocity: number,
 *   burndownPoints: Array<{ day: number, remaining: number }>
 * } | null}
 */
export function getSprintData(graph) {
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];

  // (1) Active sprint: type "sprint", status !== "done", first by created asc.
  const sprints = nodes
    .filter((n) => n && n.type === 'sprint' && n.status !== 'done')
    .sort((a, b) => {
      const ca = (a.frontmatter && a.frontmatter.created) || '';
      const cb = (b.frontmatter && b.frontmatter.created) || '';
      return String(ca).localeCompare(String(cb));
    });
  const sprint = sprints[0];
  if (!sprint) return null;
  const sprintId = String(sprint.id);

  // (2) Committed tasks: task nodes whose sprintId matches the active sprint.
  const tasks = nodes.filter(
    (n) => n && n.type === 'task' && n.frontmatter && String(n.frontmatter.sprintId) === sprintId,
  );

  // (3) KPIs.
  const committed = tasks.length;
  const completed = tasks.filter((t) => isDone(t.status)).length;
  const velocity = completed;

  // (4) Burndown series — bucket task `updated` timestamps into sprint days and
  // count tasks still remaining (not completed) at the end of each day.
  const burndownPoints = computeBurndown(sprint, tasks);

  // Carryover = work that has spilled past the sprint window. While the sprint
  // is still in progress nothing has carried over yet (0); once the window has
  // fully elapsed, the still-remaining tasks become carryover. (AC3: a 5/3 mid-
  // sprint fixture has carryover === 0.)
  const carryover = sprintElapsed(sprint, burndownPoints) ? Math.max(0, committed - completed) : 0;

  return { sprintId, committed, completed, carryover, velocity, burndownPoints };
}

/**
 * Whether the sprint window has fully elapsed. True only when the sprint carries
 * an explicit `lengthDays` and the current day (last burndown point) has reached
 * it. A sprint with no declared length is treated as in progress (not elapsed),
 * so mid-sprint carryover stays 0. Pure helper for getSprintData.
 */
function sprintElapsed(sprint, burndownPoints) {
  const sf = (sprint && sprint.frontmatter) || {};
  const lengthDays = Number(sf.lengthDays) > 0 ? Math.floor(Number(sf.lengthDays)) : 0;
  if (lengthDays <= 0) return false;
  const lastDay = burndownPoints.length ? burndownPoints[burndownPoints.length - 1].day : 0;
  return lastDay >= lengthDays;
}

/**
 * Build the day-by-day burndown points for a sprint. Day 0 is the sprint start
 * (`sprint.frontmatter.created`); the series runs through the current day,
 * bounded by the sprint length when present. A point's `remaining` is the count
 * of committed tasks not yet completed (by `updated` timestamp) on or before
 * that day. Pure helper for getSprintData. Always returns ≥ 1 point.
 *
 * @param {object} sprint the active sprint node
 * @param {object[]} tasks the committed task nodes
 * @returns {Array<{ day: number, remaining: number }>}
 */
function computeBurndown(sprint, tasks) {
  const sf = (sprint && sprint.frontmatter) || {};
  const startMs = sf.created != null && sf.created !== '' ? Date.parse(String(sf.created)) : NaN;
  const start = Number.isNaN(startMs) ? 0 : startMs;
  const DAY = 86400000;

  // Span: prefer an explicit length; else from start → latest task update / now.
  const lengthDays = Number(sf.lengthDays) > 0 ? Math.floor(Number(sf.lengthDays)) : 0;
  let latest = start;
  for (const t of tasks) {
    const ts = tsOf(t);
    if (!Number.isNaN(ts) && ts > latest) latest = ts;
  }
  const elapsedFromData = start > 0 ? Math.max(0, Math.floor((latest - start) / DAY)) : 0;
  const totalDays = lengthDays > 0 ? lengthDays : Math.max(elapsedFromData, tasks.length, 1);
  const currentDay = lengthDays > 0 ? Math.min(elapsedFromData, lengthDays) : Math.max(elapsedFromData, 0);

  // Completion-day index per completed task (clamped to the visible span).
  const completedDays = [];
  for (const t of tasks) {
    if (!isDone(t.status)) continue;
    const ts = tsOf(t);
    let day = start > 0 && !Number.isNaN(ts) ? Math.floor((ts - start) / DAY) : totalDays;
    if (day < 0) day = 0;
    if (day > totalDays) day = totalDays;
    completedDays.push(day);
  }

  const committed = tasks.length;
  const points = [];
  const lastDay = Math.max(currentDay, 0);
  for (let d = 0; d <= lastDay; d++) {
    const doneByDay = completedDays.filter((cd) => cd <= d).length;
    points.push({ day: d, remaining: Math.max(0, committed - doneByDay) });
  }
  return points;
}

/**
 * Build the burndown view-model the SVG render consumes (ideal + actual series,
 * sprint window, KPI display fields) from a getSprintData() summary and the raw
 * graph. Returns a synthesised honest default when there is no active sprint so
 * the view always renders. Pure: no DOM.
 */
function sprintViewModel(summary, graph) {
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];

  if (!summary) {
    // No active sprint — render an honest empty window rather than throwing.
    return {
      id: 'S-00', name: 'No active sprint', rangeLabel: 'no sprint in progress',
      lengthDays: 10, elapsedDays: 0,
      committed: 0, done: 0, inProgress: 0, blocked: 0, carryover: 0,
      completionPct: 0, velocity: 0,
      ideal: [{ day: 0, remaining: 0 }, { day: 10, remaining: 0 }],
      actual: [{ day: 0, remaining: 0 }],
      assignees: [],
    };
  }

  const sprintId = summary.sprintId;
  const sprintNode = nodes.find((n) => n && n.type === 'sprint' && String(n.id) === sprintId) || null;
  const committedTasks = nodes.filter(
    (n) => n && n.type === 'task' && n.frontmatter && String(n.frontmatter.sprintId) === sprintId,
  );

  const committed = summary.committed;
  const done = summary.completed;
  const inProgress = committedTasks.filter((t) => t.status === 'in-progress').length;
  const blocked = committedTasks.filter((t) => t.status === 'blocked').length;

  const points = summary.burndownPoints.length ? summary.burndownPoints : [{ day: 0, remaining: committed }];
  const elapsedDays = points[points.length - 1].day;
  const sf = (sprintNode && sprintNode.frontmatter) || {};
  const lengthDays = Number(sf.lengthDays) > 0 ? Math.floor(Number(sf.lengthDays)) : Math.max(elapsedDays, 10);

  const completionPct = committed ? Math.round((done / committed) * 100) : 0;

  // Ideal line: full commitment on day 0, linear to zero on the final day.
  const ideal = [];
  for (let d = 0; d <= lengthDays; d++) {
    ideal.push({ day: d, remaining: committed * (1 - d / lengthDays) });
  }
  // Actual line = the real burndown points from the summary.
  const actual = points;

  // Per-assignee tally.
  const byName = new Map();
  for (const t of committedTasks) {
    const name = assigneeOf(t);
    if (!byName.has(name)) byName.set(name, { name, committed: 0, done: 0, inProgress: 0, blocked: 0 });
    const row = byName.get(name);
    row.committed += 1;
    if (isDone(t.status)) row.done += 1;
    else if (t.status === 'in-progress') row.inProgress += 1;
    else if (t.status === 'blocked') row.blocked += 1;
  }
  const assignees = [...byName.values()].sort((a, b) => b.committed - a.committed || a.name.localeCompare(b.name));

  return {
    id: sprintId,
    name: sprintNode && sprintNode.title ? sprintNode.title : 'Current sprint',
    rangeLabel: sf.range != null && sf.range !== '' ? String(sf.range) : `day ${elapsedDays} of ${lengthDays}`,
    lengthDays, elapsedDays,
    committed, done, inProgress, blocked, carryover: summary.carryover,
    completionPct, velocity: summary.velocity,
    ideal, actual, assignees,
  };
}

/* ── element + svg helpers ──────────────────────────────────────────── */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Build an HTML element with class / html / text / attrs / children. */
function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  for (const child of children) if (child) node.append(child);
  return node;
}

/** Build an SVG element (correct namespace) with class / attrs / children. */
function svg(tag, opts = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  if (opts.class) node.setAttribute('class', opts.class);
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  for (const child of children) if (child) node.append(child);
  return node;
}

/* ── scoped stylesheet (ds.css is Preserve) ─────────────────────────── */

const STYLE_ID = 'ds-sprint-style';
const SPRINT_CSS = `
.sprint-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-4);
  margin: var(--space-6) 0;
}
.sprint-burndown { margin-bottom: var(--space-6); }
.burndown-card {
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}
.burndown-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.burndown-title { font-weight: var(--weight-semibold); color: var(--foreground); }
.burndown-legend { display: inline-flex; align-items: center; gap: var(--space-4); font-size: var(--text-xs); color: var(--muted-foreground); }
.burndown-legend__item { display: inline-flex; align-items: center; gap: var(--space-2); }
.burndown-legend__swatch { width: var(--space-4); height: 2px; }
.burndown-legend__swatch--actual { background: var(--primary); }
.burndown-legend__swatch--ideal { background: var(--muted-foreground); }
.burndown-svg { display: block; width: 100%; height: auto; }
.burndown-ideal { fill: none; stroke: var(--muted-foreground); stroke-width: 1.5; stroke-dasharray: 4 4; }
.burndown-actual { fill: none; stroke: var(--primary); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.burndown-area { fill: var(--primary); fill-opacity: 0.12; stroke: none; }
.burndown-axis { stroke: var(--border); stroke-width: 1; }

.assignee-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  overflow: hidden;
}
.assignee-card__head { padding: var(--space-4); font-weight: var(--weight-semibold); color: var(--foreground); }
.assignee-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.assignee-table th {
  text-align: left;
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--muted-foreground);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.assignee-table td { padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); color: var(--foreground); }
.assignee-table tr:last-child td { border-bottom: none; }
.assignee-name { display: inline-flex; align-items: center; gap: var(--space-3); }
.assignee-avatar {
  display: inline-grid;
  place-items: center;
  width: var(--space-6);
  height: var(--space-6);
  border-radius: 50%;
  background: var(--muted);
  color: var(--muted-foreground);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}
.assignee-progress { display: flex; align-items: center; gap: var(--space-3); min-width: 120px; }
.assignee-progress__track { flex: 1; height: var(--space-2); border-radius: var(--radius-xl); background: var(--muted); overflow: hidden; }
.assignee-progress__fill { height: 100%; border-radius: var(--radius-xl); background: var(--primary); }
.assignee-progress__fill--done { background: var(--success); }

@container shell (max-width: 1023px) {
  .sprint-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container shell (max-width: 767px) {
  .sprint-kpis { grid-template-columns: minmax(0, 1fr); }
  .assignee-tablewrap { overflow-x: auto; }
}
@supports not (container-type: inline-size) {
  @media (max-width: 1023px) { .sprint-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 767px) {
    .sprint-kpis { grid-template-columns: minmax(0, 1fr); }
    .assignee-tablewrap { overflow-x: auto; }
  }
}
`;

/** Inject the sprint stylesheet once. */
function ensureStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = SPRINT_CSS;
  document.head.append(style);
}

/* ── data fetch ─────────────────────────────────────────────────────── */

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

/* ── section builders ───────────────────────────────────────────────── */

/** A KPI tile (reuses ds.css ds-card / ds-kpi tokens). */
function kpiTile(label, value, sub) {
  return el('div', { class: 'ds-card' }, [
    el('div', { class: 'ds-kpi__label', text: label }),
    el('div', { class: 'ds-kpi__value tnum', text: String(value) }),
    el('div', { class: 'ds-kpi__sub', text: sub }),
  ]);
}

/** Map a series of {day, remaining} points to an SVG "x,y" point string. */
function pointsFor(series, geo) {
  const { pad, w, h, maxDay, maxRem } = geo;
  return series.map((p) => {
    const x = pad + (maxDay ? (p.day / maxDay) * (w - pad * 2) : 0);
    const y = pad + (maxRem ? (1 - p.remaining / maxRem) * (h - pad * 2) : 0);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

/** The burndown card: dashed ideal + solid actual + filled area, hand-drawn SVG. */
function burndownSection(data) {
  const w = 720;
  const h = 280;
  const pad = 24;
  const maxDay = data.lengthDays || 1;
  const maxRem = data.committed || 1;
  const geo = { pad, w, h, maxDay, maxRem };

  const idealPts = pointsFor(data.ideal, geo);
  const actualPts = pointsFor(data.actual, geo);

  // Area path: actual line, then down to the baseline and back to the start.
  const baseY = (h - pad).toFixed(2);
  const firstActual = data.actual[0];
  const lastActual = data.actual[data.actual.length - 1] || firstActual;
  const startX = (pad).toFixed(2);
  const lastX = (pad + (lastActual.day / maxDay) * (w - pad * 2)).toFixed(2);
  const areaD = `M ${startX},${baseY} L ${actualPts.replace(/ /g, ' L ')} L ${lastX},${baseY} Z`;

  const chart = svg('svg', {
    class: 'burndown-svg',
    attrs: {
      viewBox: `0 0 ${w} ${h}`,
      role: 'img',
      'aria-label': `Burndown — ${data.done} of ${data.committed} done by day ${data.elapsedDays} of ${data.lengthDays}`,
      preserveAspectRatio: 'none',
    },
  }, [
    // baseline x-axis
    svg('line', { class: 'burndown-axis', attrs: { x1: pad, y1: h - pad, x2: w - pad, y2: h - pad } }),
    // shaded area under the actual line
    svg('path', { class: 'burndown-area', attrs: { d: areaD } }),
    // dashed ideal line
    svg('polyline', { class: 'burndown-ideal', attrs: { points: idealPts } }),
    // solid actual line
    svg('polyline', { class: 'burndown-actual', attrs: { points: actualPts } }),
  ]);

  return el('section', { class: 'sprint-burndown' }, [
    el('div', { class: 'burndown-card' }, [
      el('div', { class: 'burndown-head' }, [
        el('span', { class: 'burndown-title', text: 'Burndown' }),
        el('div', { class: 'burndown-legend' }, [
          el('span', { class: 'burndown-legend__item' }, [
            el('span', { class: 'burndown-legend__swatch burndown-legend__swatch--actual' }),
            el('span', { text: 'actual' }),
          ]),
          el('span', { class: 'burndown-legend__item' }, [
            el('span', { class: 'burndown-legend__swatch burndown-legend__swatch--ideal' }),
            el('span', { text: 'ideal' }),
          ]),
        ]),
      ]),
      chart,
    ]),
  ]);
}

/** Initials for an avatar from an assignee name. */
function initials(name) {
  const parts = String(name).replace(/[^a-zA-Z0-9 -]/g, ' ').split(/[ -]+/).filter(Boolean);
  if (!parts.length) return '–';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** The by-assignee table: assignee · committed · done · progress bar. */
function assigneeSection(data) {
  const table = el('table', { class: 'assignee-table' });
  const thead = el('thead', {}, [
    el('tr', {}, [
      el('th', { text: 'Assignee' }),
      el('th', { text: 'Committed' }),
      el('th', { text: 'Done' }),
      el('th', { text: 'Progress' }),
    ]),
  ]);
  const tbody = el('tbody');
  for (const a of data.assignees) {
    const pct = a.committed ? Math.round((a.done / a.committed) * 100) : 0;
    const fill = el('div', { class: `assignee-progress__fill${pct === 100 ? ' assignee-progress__fill--done' : ''}` });
    fill.style.width = `${pct}%`;
    tbody.append(el('tr', {}, [
      el('td', {}, [
        el('span', { class: 'assignee-name' }, [
          el('span', { class: 'assignee-avatar', text: initials(a.name) }),
          el('span', { text: a.name }),
        ]),
      ]),
      el('td', { class: 'tnum', text: String(a.committed) }),
      el('td', { class: 'tnum', text: String(a.done) }),
      el('td', {}, [
        el('div', { class: 'assignee-progress' }, [
          el('div', { class: 'assignee-progress__track' }, [fill]),
        ]),
      ]),
    ]));
  }
  table.append(thead, tbody);

  return el('section', { class: 'assignee-card' }, [
    el('div', { class: 'assignee-card__head', text: 'By assignee' }),
    el('div', { class: 'assignee-tablewrap' }, [table]),
  ]);
}

/* ── mount ──────────────────────────────────────────────────────────── */

/**
 * Mount the Sprint view into `el`.
 * @param {HTMLElement} el2 content mount element
 */
export async function mount(el2) {
  if (!el2) return;
  ensureStyle();
  el2.innerHTML = '';
  el2.append(el('p', { class: 'ds-note', text: 'Loading sprint…' }));

  const graph = await fetchGraph();
  const data = sprintViewModel(getSprintData(graph), graph);

  el2.innerHTML = '';
  el2.append(
    el('header', {}, [
      el('div', { class: 'ds-eyebrow', text: 'Sprint' }),
      el('h1', { class: 'ds-h1', text: `${data.id} · ${data.name}` }),
      el('p', { class: 'ds-lede', text: data.rangeLabel }),
    ]),
    el('div', { class: 'sprint-kpis' }, [
      kpiTile('Committed', data.committed, 'tasks'),
      kpiTile('Done', data.done, `${data.completionPct}%`),
      kpiTile('In progress', data.inProgress, `${data.blocked} blocked`),
      kpiTile('Carryover risk', data.carryover, 'behind ideal'),
    ]),
    burndownSection(data),
    assigneeSection(data),
  );
}
