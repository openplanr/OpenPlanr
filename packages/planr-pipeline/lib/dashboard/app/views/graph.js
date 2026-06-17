/**
 * graph.js — Graph view (SPEC-016 / T-008, US-006): a collapse-to-roots canvas.
 *
 * design-spec §9 Screen #2: the project DAG. The graph is wide and shallow —
 * ~16 spec roots, each containing a handful of stories, each containing a handful
 * of tasks (≈147 nodes). Drawing all of them at once crams 147 cards into a few
 * hairline rows that render off-frame. So this view renders a COLLAPSE-TO-ROOTS
 * canvas, laid out by ../vendor/graph-layout.js (T-009):
 *
 *   - COLLAPSED (default): one card per top-level group — in spec mode one card
 *     per SPEC (≈16), in agile mode one per epic / feature root. Each card shows
 *     its displayId, title, a status accent, and a ROLLUP line computed from its
 *     descendants ("8 US · 12 T · 100%": story count · task count · % tasks done).
 *   - EXPAND / COLLAPSE: clicking a card's chevron expands it in place into a
 *     tidy compact subtree (child stories + each story's tasks) with `contains`
 *     (solid) + `depends_on` (dashed; blocked = warning) edges. Other roots stay
 *     collapsed and reflow cleanly. Toolbar "Expand all" / "Collapse all".
 *   - REAL CANVAS INTERACTION: drag-to-pan; scroll / ⌘-scroll to zoom; +/- zoom
 *     buttons; ⤢ fits the visible nodes to the viewport. AUTO-FIT on first render
 *     and after every expand / collapse so nodes are always centered + on-frame
 *     (the off-frame-on-load bug this rework fixes). Zoom is clamped; transitions
 *     stay ≤260ms.
 *   - KEPT: status→accent colors, the inspector (click any node), the legend, the
 *     minimap (reflects the currently-visible nodes), and the Spec/Agile mode
 *     toggle + tier pill. #detail/<id> keeps using the unique node.id.
 *   - PERFORMANCE: only the VISIBLE set is laid out + rendered — never the full
 *     147-node graph when 16 cards are shown.
 *
 * Styling uses ONLY design-system tokens from ds.css (§1 palette, §2 fonts, §3
 * 4-point spacing). ds.css is owned by T-006 (Preserve), so this view's graph
 * rules are injected once as a scoped <style> block referencing those CSS custom
 * properties only — no raw hex, no off-grid spacing, no third-party codenames.
 * Zero npm runtime dependencies.
 *
 * Graph object shape (schemas/v1.0.0/graph.schema.json):
 *   nodes: { id, type, title, status, frontmatter, ... }
 *     type   ∈ epic | feature | story | task | spec | backlog | quick | sprint | adr
 *     status ∈ done | in-progress | blocked | outstanding | addressed
 *   edges: { from, to, kind }
 *     kind === "contains"   → from = parent, to = child
 *     kind === "depends_on" → from = dependent, to = prerequisite
 */

import { displayId } from '../display-id.js';
import { buildHierarchy, layoutVisible, bboxOf } from '../vendor/graph-layout.js';
import { getFilter } from '../main.js';
import {
  typeLabel, typeAccent,
  statusBadge, filterNodes,
} from '../metadata.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ── tier-code labels for the mode pill (SPEC · US · TASK) ────────────────────
 * `code` is the short token shown in the mode pill. This is ONLY the per-mode
 * hierarchy the layout engine lays into tiers/lanes — it is NOT an allowlist that
 * decides which nodes render. Every node present in the (rail-filtered) graph is
 * always representable: types outside this hierarchy (quick, backlog, adr,
 * sprint, or any unknown type) are laid into an appended "Other" lane below the
 * hierarchy so they never silently vanish. Vocabulary (labels, accents, badges)
 * comes from the shared metadata registry, never a fixed list here.
 */
const TIER_CODES = {
  agile: [
    { type: 'epic', code: 'EPIC' },
    { type: 'feature', code: 'FEAT' },
    { type: 'story', code: 'US' },
    { type: 'task', code: 'TASK' },
  ],
  spec: [
    { type: 'spec', code: 'SPEC' },
    { type: 'story', code: 'US' },
    { type: 'task', code: 'TASK' },
  ],
};

/**
 * Default graph mode from the project's planning mode (window.__dashboard.mode,
 * set by main.js from GET /api/meta). spec-only → 'spec'; agile-only → 'agile';
 * mixed keeps the agile superset so both tiers show. Falls back to 'spec' when
 * the mode is not yet known (spec-driven is the common project shape).
 */
function defaultMode() {
  const m = (typeof window !== 'undefined' && window.__dashboard && window.__dashboard.mode) || null;
  if (m === 'agile' || m === 'mixed') return 'agile';
  return 'spec';
}

/* ── small DOM helpers ───────────────────────────────────────────────────── */

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

/** Build an SVG element with attrs / children (SVG needs the SVG namespace). */
function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const child of children) if (child) node.append(child);
  return node;
}

/* ── data model helpers ──────────────────────────────────────────────────── */

/** Map a graph status to its accent-stripe class (status-to-accent key). */
function accentClass(status) {
  switch (status) {
    case 'done': return 'acc-done';
    case 'in-progress': return 'acc-progress';
    case 'blocked': return 'acc-blocked';
    case 'addressed': return 'acc-addressed';
    default: return 'acc-todo';
  }
}

/**
 * Map a graph status to a badge [class, label] via the shared metadata registry,
 * so unknown statuses get a safe default instead of vanishing.
 * @param {string} status
 * @returns {[string, string]} [badgeClass, badgeText]
 */
function badgeFor(status) {
  return statusBadge(status);
}

/**
 * Transitive closure of `nodeId` over `depends_on` edges in the from → to
 * direction (a breadth-first walk). Retained for the data-logic contract
 * (SPEC-016 / T-009).
 *
 * @param {{nodes:object[],edges:object[]}} graph schema-valid Graph
 * @param {string} nodeId starting node id
 * @returns {Set<string>} all transitively reached node ids (excludes nodeId)
 */
export function blockedTransitiveDependents(graph, nodeId) {
  const next = new Map();
  for (const e of (graph && graph.edges) || []) {
    if (e.kind !== 'depends_on') continue;
    if (!next.has(e.from)) next.set(e.from, []);
    next.get(e.from).push(e.to);
  }
  const out = new Set();
  const queue = [nodeId];
  while (queue.length) {
    const cur = queue.shift();
    for (const to of next.get(cur) || []) {
      if (!out.has(to)) { out.add(to); queue.push(to); }
    }
  }
  out.delete(nodeId);
  return out;
}

/**
 * Return a fresh shallow copy of a Graph (SPEC-016 / T-009 — metadata follow-up).
 *
 * This formerly dropped every node whose type was not in the per-`mode` tier
 * allowlist, which silently deleted quick / backlog / adr / sprint (and any
 * unknown type) from the canvas. The mode now only selects which type is the
 * top-level ROOT for the hierarchy layout (handled by the layout engine); it must
 * never decide which nodes are representable. So this keeps EVERY node + edge —
 * auxiliary / unknown types are laid into the appended "Other" lane at render
 * time rather than removed. The input is never mutated.
 *
 * @param {{nodes:object[],edges:object[]}} graph schema-valid Graph
 * @param {"agile"|"spec"} [mode] retained for signature compatibility (unused)
 * @returns {{nodes:object[],edges:object[]}} a fresh Graph with all nodes/edges
 */
export function filterByMode(graph, mode) {
  void mode;
  const nodes = ((graph && graph.nodes) || []).slice();
  const edges = ((graph && graph.edges) || []).slice();
  return { nodes, edges };
}

/**
 * Assemble the inspector-panel payload for a node (SPEC-016 / T-009). Returns the
 * id / title / type / status, the node's frontmatter fields minus `body`, and the
 * in-app detail link (`#detail/<id>`). Returns null when the node is absent.
 *
 * @param {{nodes:object[],edges:object[]}} graph schema-valid Graph
 * @param {string} nodeId artifact id to assemble for
 * @returns {{id:string,title:string,type:string,status:string,fields:object,detailHref:string}|null}
 */
export function assembleInspectorData(graph, nodeId) {
  const node = ((graph && graph.nodes) || []).find((n) => n.id === nodeId);
  if (!node) return null;
  const fm = node.frontmatter || {};
  const fields = {};
  for (const [k, v] of Object.entries(fm)) {
    if (k === 'body') continue;
    fields[k] = v;
  }
  return {
    id: node.id,
    title: node.title || node.id,
    type: node.type,
    status: node.status,
    fields,
    detailHref: `#detail/${node.id}`,
  };
}

/**
 * The hierarchy tier codes for `mode` that actually have at least one node in
 * `graph`, so a spec-only project never advertises an empty "EPIC"/"FEAT" code.
 * Only the hierarchy tiers are shown here as a quick orientation pill — auxiliary
 * types still render in the canvas regardless; they just are not part of the
 * mode's tier vocabulary.
 * @param {{nodes:object[]}} graph
 * @param {"agile"|"spec"} mode
 * @returns {Array<{type:string,code:string}>}
 */
export function presentTiers(graph, mode) {
  const tiers = TIER_CODES[mode] || TIER_CODES.agile;
  const types = new Set(((graph && graph.nodes) || []).map((n) => n && n.type));
  const present = tiers.filter((t) => types.has(t.type));
  return present.length ? present : tiers;
}

/**
 * Format a root rollup as the compact card line: "8 US · 12 T · 58%"
 * (story count · task count · % of its tasks done).
 * @param {{stories:number,tasks:number,donePct:number}} r
 * @returns {string}
 */
export function rollupLine(r) {
  if (!r) return '';
  return `${r.stories} US · ${r.tasks} T · ${r.donePct}%`;
}

/* ── edge routing ────────────────────────────────────────────────────────── */

/**
 * Relationship-aware edge path. `a` = source (draw-from), `b` = target (draw-to);
 * callers pass depends_on edges already normalized to prerequisite -> dependent so
 * a `marker-end` arrowhead points at the dependent.
 *  - contains: a vertical S-curve with short orthogonal entry/exit stubs so lines
 *    leave the parent's bottom and enter the child's top cleanly.
 *  - depends_on / blocked between SAME-ROW siblings: a lateral arc from the right
 *    port of the prerequisite to the left port of the dependent (forward edges bow
 *    up, back-edges bow down so opposing arcs never overlap) — never the old
 *    downward stub-loop.
 *  - depends_on / blocked across rows: a vertical curve (the dash comes from CSS).
 */
function edgePath(a, b, kind) {
  const ax = a.x; const ay = a.y; const aw = a.w; const ah = a.h;
  const bx = b.x; const by = b.y; const bw = b.w;
  if (kind === 'contains') {
    const x1 = ax + aw / 2; const y1 = ay + ah;
    const x2 = bx + bw / 2; const y2 = by;
    const stub = 12; const my = (y1 + y2) / 2;
    return `M ${x1} ${y1} L ${x1} ${y1 + stub} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2 - stub} L ${x2} ${y2}`;
  }
  const sameRow = Math.abs(ay - by) < 2;
  if (sameRow) {
    const y = ay + ah / 2;
    let xr; let xl; let dir;
    if (bx >= ax) { xr = ax + aw; xl = bx; dir = -1; } // forward: bow up
    else { xr = ax; xl = bx + bw; dir = 1; } // back-edge: bow down
    const gap = Math.abs(xl - xr);
    const k = Math.min(80, Math.max(24, gap * 0.5));
    const bow = dir * Math.min(36, ah * 0.6);
    const c1 = bx >= ax ? xr + k : xr - k;
    const c2 = bx >= ax ? xl - k : xl + k;
    return `M ${xr} ${y} C ${c1} ${y + bow}, ${c2} ${y + bow}, ${xl} ${y}`;
  }
  const x1 = ax + aw / 2; const y1 = ay + ah;
  const x2 = bx + bw / 2; const y2 = by;
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

/* ── "Other" lane: nodes the hierarchy layout did not place ────────────────── */

// Geometry for the appended auxiliary lane (every value is a multiple of the
// 4-point grid, §3). The lane card matches the layout engine's leaf-card size so
// the two drawings read as one canvas.
const AUX_CARD_W = 200;
const AUX_CARD_H = 68;
const AUX_GAP_X = 24; // gap between sibling aux cards
const AUX_GAP_Y = 56; // gap between wrapped aux rows / from the hierarchy above
const AUX_LABEL_H = 28; // height reserved above the lane for its "Other" label

/**
 * Lay out the leftover nodes — every filtered node the hierarchy layout did NOT
 * place (auxiliary types like quick / backlog / adr / sprint, plus any orphan or
 * unknown type) — into a single "Other" lane appended BELOW the hierarchy
 * drawing, so no node ever silently vanishes. Pure: returns absolute-pixel boxes
 * keyed by id, the lane's label anchor, and the lane's own bounding box.
 *
 * @param {object[]} nodes the rail-filtered node list
 * @param {object} placed the layout engine's `nodes` map (already-placed ids)
 * @param {Set<string>} hierMembers ids that BELONG to the contains-hierarchy
 *   (roots + their descendants). These are excluded even when not currently
 *   placed, because a collapsed root's descendants are hidden ON PURPOSE and are
 *   revealed by expanding the root — they are not orphans.
 * @param {{minX:number,maxX:number,maxY:number,width:number}} hierBox the
 *   hierarchy drawing's bbox, used to align + position the lane beneath it
 * @returns {{nodes:object, label:{x:number,y:number}|null,
 *            box:{minX:number,minY:number,maxX:number,maxY:number}|null}}
 */
function layoutOtherLane(nodes, placed, hierMembers, hierBox) {
  const leftover = (Array.isArray(nodes) ? nodes : [])
    .filter((n) => n && !placed[n.id] && !(hierMembers && hierMembers.has(n.id)));
  if (!leftover.length) return { nodes: {}, label: null, box: null };

  // Lane origin: left-aligned with the hierarchy drawing, dropped below it.
  const originX = hierBox.minX;
  const top = hierBox.maxY + AUX_GAP_Y;
  // Wrap into as many columns as the hierarchy width allows (>= 1).
  const usableW = Math.max(AUX_CARD_W, hierBox.width);
  const perRow = Math.max(1, Math.floor((usableW + AUX_GAP_X) / (AUX_CARD_W + AUX_GAP_X)));

  const out = {};
  const cardTop = top + AUX_LABEL_H;
  let maxX = originX + AUX_CARD_W;
  let maxY = cardTop + AUX_CARD_H;
  leftover.forEach((n, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = originX + col * (AUX_CARD_W + AUX_GAP_X);
    const y = cardTop + row * (AUX_CARD_H + AUX_GAP_Y);
    out[n.id] = {
      id: n.id, x, y,
      w: AUX_CARD_W, h: AUX_CARD_H, width: AUX_CARD_W, height: AUX_CARD_H,
      kind: 'aux', rootId: null,
    };
    maxX = Math.max(maxX, x + AUX_CARD_W);
    maxY = Math.max(maxY, y + AUX_CARD_H);
  });

  return {
    nodes: out,
    label: { x: originX, y: top + AUX_LABEL_H - 8 },
    box: { minX: originX, minY: top, maxX, maxY },
  };
}

/**
 * Union two bounding boxes into the {minX,minY,maxX,maxY,width,height} shape the
 * view's fit/minimap consume. `b` may be null (returns `a` unchanged).
 */
function mergeBoxes(a, b) {
  if (!b) return a;
  const minX = Math.min(a.minX, b.minX);
  const minY = Math.min(a.minY, b.minY);
  const maxX = Math.max(a.maxX, b.maxX);
  const maxY = Math.max(a.maxY, b.maxY);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/* ── scoped stylesheet (token-only; injected once) ──────────────────────── */

const GRAPH_STYLE_ID = 'ds-graph-style';

/**
 * Inject the graph view's scoped stylesheet once. Every declaration references a
 * design-system token (var(--*)) — no raw hex, no off-grid spacing.
 */
function ensureStyle() {
  if (document.getElementById(GRAPH_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = GRAPH_STYLE_ID;
  style.textContent = `
.ds-graph {
  display: grid;
  /* the inspector column is auto-sized, so when the inspector is [hidden]
   * (display:none) its track collapses to 0 and the canvas gets the full width —
   * no dead 336px gutter before a node is selected. */
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-4);
  height: 100%;
  min-height: 70vh;
}
.ds-graph__stage {
  position: relative;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--muted);
  overflow: hidden;
}
.ds-graph__toolbar {
  position: absolute;
  inset: var(--space-3) var(--space-3) auto var(--space-3);
  z-index: 3;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  pointer-events: none;
}
.ds-graph__toolbar > * { pointer-events: auto; }
.ds-graph__toolbar-right { margin-left: auto; display: flex; align-items: center; gap: var(--space-2); }

.ds-seg {
  display: inline-flex;
  padding: var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  gap: var(--space-1);
}
.ds-seg__btn {
  padding: var(--space-1) var(--space-3);
  border: none;
  border-radius: var(--radius-xl);
  background: transparent;
  color: var(--muted-foreground);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}
.ds-seg__btn[aria-pressed="true"] { background: var(--accent); color: var(--accent-foreground); }
.dark .ds-seg__btn[aria-pressed="true"] { color: var(--foreground); }

.ds-graph__tierchips {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--muted-foreground);
}

.ds-graph__expand {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  overflow: hidden;
}
.ds-graph__expand button {
  padding: var(--space-1) var(--space-3);
  border: none;
  background: transparent;
  color: var(--muted-foreground);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}
.ds-graph__expand button + button { border-left: 1px solid var(--border); }
.ds-graph__expand button:hover { background: var(--muted); color: var(--foreground); }

.ds-graph__filterchip {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  font-size: var(--text-sm);
  color: var(--foreground);
}
.ds-graph__filterchip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-foreground); }
.dark .ds-graph__filterchip[aria-pressed="true"] { color: var(--foreground); }

.ds-graph__scroll {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
}
.ds-graph__scroll.is-panning { cursor: grabbing; }
.ds-graph__svg { display: block; width: 100%; height: 100%; }
.ds-graph__viewport { transform-origin: 0 0; transition: transform var(--duration-slow) var(--ease); }
.ds-graph__scroll.is-panning .ds-graph__viewport,
.ds-graph__scroll.is-zooming .ds-graph__viewport { transition: none; }

.edges path { transition: opacity var(--duration-fast) var(--ease), stroke-width var(--duration-fast) var(--ease); }
/* contains (structure) reads clearly; depends_on (dependencies) stays subtle by
 * default so the hierarchy dominates — hover/select a node to bring its own
 * dependency chain to full strength (.is-lit). Blocked paths always stand out. */
.edge-contains { stroke: var(--muted-foreground); stroke-width: 1.5; fill: none; opacity: .45; vector-effect: non-scaling-stroke; }
.edge-depends { stroke: var(--primary); stroke-width: 1.5; fill: none; opacity: .28; stroke-dasharray: 5 4; vector-effect: non-scaling-stroke; }
.edge-blocked { stroke: var(--warning); stroke-width: 2; fill: none; opacity: .9; stroke-dasharray: 5 4; vector-effect: non-scaling-stroke; }
.ds-arrowhead-dep { fill: var(--primary); fill-opacity: .5; }
.ds-arrowhead-blocked { fill: var(--warning); fill-opacity: .9; }

/* infinite-canvas dot grid (lives inside the pan/zoom <g> so it tracks 1:1) */
.ds-graph__dot { fill: var(--muted-foreground); fill-opacity: .14; }
.dark .ds-graph__dot { fill-opacity: .20; }
.ds-graph__grid { pointer-events: none; }
/* let card shadows + the hover lift render past the foreignObject box */
.ds-graph__svg foreignObject { overflow: visible; }

/* "Other" lane heading — labels the appended lane of auxiliary / orphan nodes
 * (quick · backlog · adr · sprint · unknown types) the hierarchy can't tier. */
.ds-graph__lane-label {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: .04em;
  text-transform: uppercase;
  fill: var(--muted-foreground);
}

.ds-node {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  padding-left: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow var(--duration-fast) var(--ease), transform var(--duration-fast) var(--ease), opacity var(--duration-base) var(--ease), border-color var(--duration-fast) var(--ease);
}
.ds-node::before {
  content: "";
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: var(--space-1);
  border-top-left-radius: var(--radius-lg);
  border-bottom-left-radius: var(--radius-lg);
  background: var(--muted-foreground);
}
.ds-node.acc-done::before { background: var(--success); }
.ds-node.acc-progress::before { background: var(--primary); }
.ds-node.acc-blocked::before { background: var(--warning); }
.ds-node.acc-addressed::before { background: var(--info); }
.ds-node.acc-todo::before { background: var(--muted-foreground); }
.ds-node:hover { background: var(--muted); box-shadow: var(--shadow-md); transform: translateY(-1px); }
/* Selection + open-parent highlight: a filled tint + a primary border carried by
 * the card's OWN radius. A detached outline/ring breaks against the rounded
 * corners and the left status stripe, so we fill + recolour the border instead. */
.ds-node.is-selected,
.ds-node.is-expanded { background: var(--accent); border-color: var(--primary); box-shadow: var(--shadow-md); }
.ds-node.node-blocked { border-color: var(--warning); }
.ds-node.is-root { box-shadow: var(--shadow-md); }
/* the opened spec is the focal object — give it the strongest elevation */
.ds-node.is-expanded { box-shadow: var(--shadow-lg); }

/* hover / select-to-trace: spotlight a node's edges + neighbours, recede the rest */
.ds-graph__viewport.is-tracing .ds-node:not(.is-lit) { opacity: .30; }
.ds-graph__viewport.is-tracing .edges path:not(.is-lit) { opacity: .10; }
.edges path.is-lit { opacity: 1; stroke-width: 2.5; }
.ds-node.is-lit { box-shadow: var(--shadow-md); border-color: var(--primary); }
/* ghost the OTHER collapsed roots while one spec is focused (hover restores) */
.ds-node.is-ghost { opacity: .55; }
.ds-node.is-ghost:hover { opacity: 1; }

.ds-node__head { display: flex; align-items: center; gap: var(--space-2); }
/* a small type-colour dot on aux-lane cards so quick / backlog / adr / sprint
 * (and any unknown type) carry a clear, fallback-safe type cue. The colour is set
 * inline from typeAccent() — always a ds.css token, muted for unknowns. */
.ds-node__type-dot { width: var(--space-2); height: var(--space-2); border-radius: 50%; flex: none; background: var(--muted-foreground); }
.ds-node__id { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--muted-foreground); }
.ds-node__title {
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ds-node.is-root .ds-node__title { font-weight: var(--weight-semibold); }
.ds-node__rollup {
  margin-top: auto;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--muted-foreground);
}
.ds-node__badge { margin-top: auto; }

/* chevron expand affordance on root cards */
.ds-node__chevron {
  margin-left: auto;
  display: grid;
  place-items: center;
  width: var(--space-6);
  height: var(--space-6);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--background);
  color: var(--muted-foreground);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  line-height: 1;
  flex: none;
}
.ds-node__chevron:hover { background: var(--accent); color: var(--accent-foreground); border-color: var(--accent); }
.dark .ds-node__chevron:hover { color: var(--foreground); }

.ds-graph__zoom {
  display: inline-flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  overflow: hidden;
}
.ds-graph__zoom button {
  display: grid;
  place-items: center;
  width: var(--space-8);
  height: var(--space-8);
  border: none;
  background: transparent;
  color: var(--foreground);
  font-size: var(--text-lg);
}
.ds-graph__zoom button + button { border-top: 1px solid var(--border); }
.ds-graph__zoom button:hover { background: var(--muted); }
.ds-graph__zoom .is-reset { font-size: var(--text-sm); font-weight: var(--weight-medium); }
.ds-graph__zoompct {
  display: grid;
  place-items: center;
  min-width: var(--space-8);
  height: var(--space-6);
  border-top: 1px solid var(--border);
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--muted-foreground);
}

.ds-graph__hint {
  position: absolute;
  left: 50%;
  bottom: var(--space-3);
  transform: translateX(-50%);
  z-index: 3;
  padding: var(--space-1) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  font-size: var(--text-xs);
  color: var(--muted-foreground);
  opacity: 1;
  transition: opacity var(--duration-slow) var(--ease);
}
.ds-graph__hint.is-gone { opacity: 0; pointer-events: none; }

.ds-graph__legend {
  position: absolute;
  left: var(--space-3);
  bottom: var(--space-3);
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  font-size: var(--text-xs);
  color: var(--muted-foreground);
}
.ds-graph__legend-item { display: inline-flex; align-items: center; gap: var(--space-2); }
.ds-graph__legend-dot { width: var(--space-2); height: var(--space-2); border-radius: 50%; }
.lg-done { background: var(--success); }
.lg-progress { background: var(--primary); }
.lg-blocked { background: var(--warning); }
.lg-todo { background: var(--muted-foreground); }
.lg-addressed { background: var(--info); }
.ds-graph__legend-line { width: var(--space-6); height: 0; border-top: 1.5px solid var(--muted-foreground); }
.ds-graph__legend-line.is-dashed { border-top-style: dashed; border-color: var(--primary); }
.ds-graph__legend-line.is-blocked { border-top-style: dashed; border-color: var(--warning); }

.ds-graph__minimap {
  position: absolute;
  right: var(--space-3);
  bottom: var(--space-3);
  z-index: 3;
  width: 160px;
  height: 120px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.ds-graph__minimap svg { display: block; width: 100%; height: 100%; }
.ds-graph__minimap .mm-node { fill: var(--muted-foreground); opacity: .55; }
.ds-graph__minimap .mm-node.acc-done { fill: var(--success); }
.ds-graph__minimap .mm-node.acc-progress { fill: var(--primary); }
.ds-graph__minimap .mm-node.acc-blocked { fill: var(--warning); }
.ds-graph__minimap .mm-viewport { fill: none; stroke: var(--primary); stroke-width: 2; opacity: .8; }

.ds-inspector {
  width: 336px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  overflow-y: auto;
}
.ds-inspector[hidden] { display: none; }
.ds-inspector__eyebrow { font-size: var(--text-xs); font-weight: var(--weight-semibold); letter-spacing: .04em; text-transform: uppercase; color: var(--muted-foreground); }
.ds-inspector__title { margin: 0; font-size: var(--text-lg); font-weight: var(--weight-semibold); color: var(--foreground); }
.ds-inspector__meta { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-4); font-size: var(--text-sm); }
.ds-inspector__key { color: var(--muted-foreground); }
.ds-inspector__val { color: var(--foreground); font-family: var(--font-mono); font-size: var(--text-xs); word-break: break-word; }
.ds-inspector__section-label { font-size: var(--text-xs); font-weight: var(--weight-semibold); letter-spacing: .04em; text-transform: uppercase; color: var(--muted-foreground); }
.ds-inspector__fm { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-1) var(--space-3); font-size: var(--text-xs); }
.ds-inspector__cta { margin-top: var(--space-2); }

/* tablet >=768 and <1280: inspector folds away, content is single column */
@container shell (max-width: 1279px) {
  .ds-graph { grid-template-columns: minmax(0, 1fr); }
  .ds-inspector { display: none; }
}
/* mobile <768: minimap + chips hide */
@container shell (max-width: 767px) {
  .ds-graph__minimap { display: none; }
  .ds-graph__tierchips, .ds-graph__filterchip { display: none; }
}
@supports not (container-type: inline-size) {
  @media (max-width: 1279px) {
    .ds-graph { grid-template-columns: minmax(0, 1fr); }
    .ds-inspector { display: none; }
  }
  @media (max-width: 767px) {
    .ds-graph__minimap { display: none; }
    .ds-graph__tierchips, .ds-graph__filterchip { display: none; }
  }
}
`;
  document.head.append(style);
}

/* ── data fetch ──────────────────────────────────────────────────────────── */

/** Fetch the project graph, tolerating network/parse failure with an empty graph. */
async function fetchGraph() {
  try {
    const res = await fetch('/api/graph');
    if (!res.ok) return { nodes: [], edges: [] };
    const graph = await res.json();
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      return { nodes: [], edges: [] };
    }
    return graph;
  } catch {
    return { nodes: [], edges: [] };
  }
}

/* ── zoom range + fit padding ─────────────────────────────────────────────── */

const MIN_SCALE = 0.2;
const MAX_SCALE = 2.0;
const ZOOM_STEP = 1.2; // multiplicative step for the +/- buttons
const FIT_PAD = 32; // viewport padding (px) kept around the fitted drawing
// When fitting EVERYTHING (first render, fit button, expand-all, collapse-all) a
// very wide drawing can otherwise shrink to a microscopic strip; clamp the
// fit-all scale to a readable floor so cards never become unreadable. Focus-fit
// (a single expanded spec) is exempt — that box is small, so it should fill the
// viewport up to MAX_SCALE.
const FIT_ALL_MIN_SCALE = 0.5;
// Focus-fit (a single expanded spec) stays in a readable, natural band: a floor so
// a wide subtree never shrinks to a hairline strip, and a ceiling so a tiny subtree
// (one story) doesn't blow up to a cartoonish zoom.
const FOCUS_MIN_SCALE = 0.4;
const FOCUS_MAX_SCALE = 1.1;

/* ── render ──────────────────────────────────────────────────────────────── */

/**
 * Mount the Graph view into `mountEl`.
 * @param {HTMLElement} mountEl content mount element supplied by the router
 */
export async function mount(mountEl) {
  if (!mountEl) return;
  ensureStyle();
  mountEl.innerHTML = '';
  mountEl.append(el('p', { class: 'ds-note', text: 'Loading graph…' }));

  const graph = await fetchGraph();

  // Per-view state. `expanded` is the set of root ids opened in place; the canvas
  // is collapsed-by-default (empty set). The mode toggle defaults to the
  // project's planning mode reported by /api/meta.
  const state = {
    mode: defaultMode(),
    scale: 1,
    tx: 0,
    ty: 0,
    expanded: new Set(),
    selectedId: (window.__dashboard && window.__dashboard.selectedId) || null,
  };

  /**
   * Live-data preference: prefer the in-memory graph the SSE merge maintains
   * (window.__dashboard.graph) so live patches repaint, falling back to the graph
   * fetched at mount. Always returns a `{ nodes, edges }` shape.
   */
  function liveGraph() {
    const live = window.__dashboard && window.__dashboard.graph;
    if (live && Array.isArray(live.nodes) && Array.isArray(live.edges) && live.nodes.length) {
      return live;
    }
    return graph;
  }

  /**
   * The graph the canvas should lay out: the live graph narrowed by the SHARED
   * rail filter (type + status). An empty type filter = all types; a null status
   * = all statuses (see filterNodes). Edges are kept only between surviving nodes.
   * Auxiliary / unknown types are NOT dropped — they survive the type filter the
   * same as any other type and are laid into the "Other" lane at render time.
   */
  function filteredGraph() {
    const g = liveGraph();
    const f = getFilter();
    const nodes = filterNodes(g.nodes, { typeFilter: f.typeFilter, statusFilter: f.statusFilter }, displayId);
    const keep = new Set(nodes.map((n) => n.id));
    const edges = (g.edges || []).filter((e) => keep.has(e.from) && keep.has(e.to));
    return { nodes, edges };
  }

  // Stable DOM scaffold (built once); the canvas is re-rendered on change.
  const stage = el('div', { class: 'ds-graph__stage' });
  const scroll = el('div', { class: 'ds-graph__scroll', attrs: { tabindex: '0', 'aria-label': 'Project graph canvas' } });
  stage.append(scroll);

  const inspector = el('aside', { class: 'ds-inspector', attrs: { hidden: 'hidden', 'aria-label': 'Node inspector' } });
  const root = el('div', { class: 'ds-graph' }, [stage, inspector]);

  /* ── toolbar: Agile/Spec toggle · tier chips · expand-all · collapse-all ─ */
  const agileBtn = el('button', { class: 'ds-seg__btn', text: 'Agile', attrs: { type: 'button', 'aria-pressed': String(state.mode === 'agile') } });
  const specBtn = el('button', { class: 'ds-seg__btn', text: 'Spec', attrs: { type: 'button', 'aria-pressed': String(state.mode === 'spec') } });
  const seg = el('div', { class: 'ds-seg', attrs: { role: 'group', 'aria-label': 'Graph mode' } }, [agileBtn, specBtn]);
  const tierChips = el('div', { class: 'ds-graph__tierchips' });

  const expandAllBtn = el('button', { text: 'Expand all', attrs: { type: 'button' } });
  const collapseAllBtn = el('button', { text: 'Collapse all', attrs: { type: 'button' } });
  const expandGroup = el('div', { class: 'ds-graph__expand', attrs: { role: 'group', 'aria-label': 'Expand / collapse all' } }, [expandAllBtn, collapseAllBtn]);

  const zoomIn = el('button', { text: '+', attrs: { type: 'button', 'aria-label': 'Zoom in' } });
  const zoomPct = el('span', { class: 'ds-graph__zoompct', text: '100%', attrs: { 'aria-hidden': 'true' } });
  const zoomOut = el('button', { text: '−', attrs: { type: 'button', 'aria-label': 'Zoom out' } });
  const zoomReset = el('button', { class: 'is-reset', text: '1:1', attrs: { type: 'button', 'aria-label': 'Reset zoom to 100%' } });
  const zoomFit = el('button', { text: '⤢', attrs: { type: 'button', 'aria-label': 'Fit to view' } });
  const zoom = el('div', { class: 'ds-graph__zoom' }, [zoomIn, zoomPct, zoomOut, zoomReset, zoomFit]);

  const toolbar = el('div', { class: 'ds-graph__toolbar' }, [
    seg, tierChips, expandGroup,
    el('div', { class: 'ds-graph__toolbar-right' }, [zoom]),
  ]);
  stage.append(toolbar);

  // legend + minimap live in the stage; re-filled per render
  const legend = el('div', { class: 'ds-graph__legend' });
  const minimap = el('div', { class: 'ds-graph__minimap', attrs: { 'aria-hidden': 'true' } });
  const hint = el('div', { class: 'ds-graph__hint', text: 'Scroll to zoom · drag to pan · hover to trace' });
  stage.append(legend, minimap, hint);

  // the SVG viewBox for the CURRENT render (set in render(); used by auto-fit)
  let lastBox = { minX: 0, minY: 0, maxX: 800, maxY: 600, width: 800, height: 600 };
  let lastLaid = null; // the laid result of the CURRENT render (used by focus-fit)
  let minimapVp = null; // the minimap's viewport-indicator rect
  let lastAdj = new Map(); // neighbour index of the CURRENT render (hover/select trace)
  let tracedId = null; // the id currently lit (guards pointerover thrash)

  /* ── transform application ─────────────────────────────────────────── */
  let viewport = null; // the <g class="ds-graph__viewport"> of the current render
  function applyTransform() {
    if (viewport) viewport.setAttribute('transform', `translate(${state.tx} ${state.ty}) scale(${state.scale})`);
    if (zoomPct) zoomPct.textContent = `${Math.round(state.scale * 100)}%`;
    updateMinimapViewport();
  }

  /** Clamp a scale to the configured range, rounded to 1/100. */
  function clampScale(s) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(s * 100) / 100));
  }

  /** The on-screen size of the scroll container (the visible viewport, px). */
  function viewportSize() {
    const r = scroll.getBoundingClientRect();
    // fall back to a sane size when measured before layout (e.g. in tests)
    return { w: r.width || 960, h: r.height || 640 };
  }

  /**
   * Auto-fit: compute the scale + translate that centers a bounding box within the
   * viewport, clamped to the zoom range, then apply it.
   *
   * @param {object}  [box]      the box to fit; defaults to the whole drawing
   *                             (`lastBox`). Pass a single spec's subtree bbox to
   *                             FOCUS-fit (drill-IN) instead of refitting all roots.
   * @param {number}  [minScale] a lower clamp for the fit scale; the fit-all paths
   *                             pass FIT_ALL_MIN_SCALE so a wide graph never shrinks
   *                             to a microscopic strip. Focus-fit omits it so a
   *                             small subtree can fill the viewport.
   */
  function fitToView(box, minScale, maxScale) {
    const target = box || lastBox;
    const { w: vw, h: vh } = viewportSize();
    const bw = Math.max(1, target.width);
    const bh = Math.max(1, target.height);
    let scale = Math.min((vw - FIT_PAD * 2) / bw, (vh - FIT_PAD * 2) / bh);
    if (minScale != null) scale = Math.max(scale, minScale);
    if (maxScale != null) scale = Math.min(scale, maxScale);
    scale = clampScale(scale);
    state.scale = scale;
    // center: place the box's mid-point at the viewport's mid-point
    const boxCx = target.minX + bw / 2;
    const boxCy = target.minY + bh / 2;
    state.tx = vw / 2 - boxCx * scale;
    state.ty = vh / 2 - boxCy * scale;
    applyTransform();
  }

  /**
   * Zoom by a multiplicative factor about a focal point in viewport pixels
   * (defaults to the viewport center). Keeps the focal content point fixed so the
   * graph zooms "toward the cursor" on wheel + stays centered on the buttons.
   */
  function zoomBy(factor, focal) {
    const { w: vw, h: vh } = viewportSize();
    const fx = focal ? focal.x : vw / 2;
    const fy = focal ? focal.y : vh / 2;
    const prev = state.scale;
    const next = clampScale(prev * factor);
    if (next === prev) return;
    // content point under the focal stays put: cx = (fx - tx) / prev
    state.tx = fx - ((fx - state.tx) / prev) * next;
    state.ty = fy - ((fy - state.ty) / prev) * next;
    state.scale = next;
    applyTransform();
  }

  /* ── inspector population ──────────────────────────────────────────── */
  function nodeById(id) { return liveGraph().nodes.find((n) => n.id === id) || null; }

  function showInspector(node) {
    inspector.innerHTML = '';
    if (!node) { inspector.setAttribute('hidden', 'hidden'); return; }
    const [badgeClass, badgeLabel] = badgeFor(node.status);

    const meta = el('div', { class: 'ds-inspector__meta' }, [
      el('span', { class: 'ds-inspector__key', text: 'ID' }),
      el('span', { class: 'ds-inspector__val', text: displayId(node) }),
      el('span', { class: 'ds-inspector__key', text: 'Type' }),
      el('span', { class: 'ds-inspector__val', text: node.type }),
      el('span', { class: 'ds-inspector__key', text: 'Status' }),
      el('span', {}, [el('span', { class: `ds-badge ${badgeClass}`, text: badgeLabel })]),
    ]);

    const fm = node.frontmatter || {};
    const fmGrid = el('div', { class: 'ds-inspector__fm' });
    let shown = 0;
    for (const [k, v] of Object.entries(fm)) {
      if (shown >= 8) break;
      if (v == null || typeof v === 'object') {
        if (Array.isArray(v)) {
          fmGrid.append(
            el('span', { class: 'ds-inspector__key', text: k }),
            el('span', { class: 'ds-inspector__val', text: v.join(', ') || '—' }),
          );
          shown += 1;
        }
        continue;
      }
      fmGrid.append(
        el('span', { class: 'ds-inspector__key', text: k }),
        el('span', { class: 'ds-inspector__val', text: String(v) }),
      );
      shown += 1;
    }

    inspector.append(
      el('div', { class: 'ds-inspector__eyebrow', text: node.type }),
      el('h2', { class: 'ds-inspector__title', text: node.title || displayId(node) }),
      meta,
      el('div', { class: 'ds-inspector__section-label', text: 'Frontmatter' }),
      shown ? fmGrid : el('p', { class: 'ds-inspector__val', text: 'No frontmatter fields.' }),
      el('a', {
        class: 'ds-btn ds-inspector__cta', text: 'Go to detail',
        attrs: { href: `#detail/${node.id}` },
      }),
    );
    inspector.removeAttribute('hidden');
  }

  /* ── hover / select trace: spotlight a node's edges + neighbours ────── */
  function clearTrace() {
    tracedId = null;
    if (viewport && viewport.classList) viewport.classList.remove('is-tracing');
    for (const n of scroll.querySelectorAll('.ds-node.is-lit')) n.classList.remove('is-lit');
    for (const p of scroll.querySelectorAll('.edges path.is-lit')) p.classList.remove('is-lit');
  }
  function lightTrace(id) {
    if (!id || id === tracedId) return;
    clearTrace();
    tracedId = id;
    if (viewport && viewport.classList) viewport.classList.add('is-tracing');
    const lit = new Set([id, ...((lastAdj.get(id)) || [])]);
    for (const card of scroll.querySelectorAll('.ds-node')) {
      if (lit.has(card.getAttribute('data-id'))) card.classList.add('is-lit');
    }
    for (const p of scroll.querySelectorAll('.edges path')) {
      if (p.getAttribute('data-from') === id || p.getAttribute('data-to') === id) p.classList.add('is-lit');
    }
  }

  function selectNode(id) {
    state.selectedId = id;
    if (window.__dashboard) window.__dashboard.selectedId = id;
    for (const fo of scroll.querySelectorAll('.ds-node')) {
      fo.classList.toggle('is-selected', fo.getAttribute('data-id') === id);
    }
    lightTrace(id);
    showInspector(nodeById(id));
  }

  /**
   * Toggle a root's expanded state, re-render, and auto-fit.
   *
   * EXPAND a single spec → FOCUS-fit (drill-IN): zoom to JUST that spec's subtree
   * (spec card + its stories + tasks) so it fills the viewport readably, rather
   * than refitting all ~16 collapsed cards (which would shrink everything to a
   * tiny strip). COLLAPSE → fit back to the whole visible grid.
   */
  function toggleExpand(rootId) {
    const willExpand = !state.expanded.has(rootId);
    if (willExpand) state.expanded.add(rootId);
    else state.expanded.delete(rootId);
    render({ fit: true, focusId: willExpand ? rootId : null });
  }

  /* ── blocked-path computation over the rendered (rail-filtered) graph, so a
   *    collapsed root that contains a blocked descendant can still surface state.
   *    @param {{nodes:object[],edges:object[]}} g the graph being rendered ─── */
  function computeBlocked(g) {
    const blockedNodes = g.nodes.filter((n) => n.status === 'blocked').map((n) => n.id);
    const dependentsOf = new Map(); // prerequisite id → [dependent ids]
    for (const e of g.edges) {
      if (e.kind !== 'depends_on') continue;
      if (!dependentsOf.has(e.to)) dependentsOf.set(e.to, []);
      dependentsOf.get(e.to).push(e.from);
    }
    const blockedSet = new Set();
    const stack = [...blockedNodes];
    while (stack.length) {
      const cur = stack.pop();
      for (const dep of dependentsOf.get(cur) || []) {
        if (!blockedSet.has(dep)) { blockedSet.add(dep); stack.push(dep); }
      }
    }
    for (const b of blockedNodes) blockedSet.delete(b);
    const onBlockedPath = new Set([...blockedNodes, ...blockedSet]);
    const blockedEdgeKeys = new Set();
    for (const e of g.edges) {
      if (e.kind !== 'depends_on') continue;
      if (onBlockedPath.has(e.to)) blockedEdgeKeys.add(`${e.from} ${e.to}`);
    }
    return { blockedSet, blockedEdgeKeys };
  }

  /* ── full canvas render (visible set only) ─────────────────────────── */
  function render(opts = {}) {
    // The rail-filtered live graph is the single source for THIS render. Every
    // node that survives the rail filter must be representable on the canvas.
    const g = filteredGraph();
    const hierarchy = buildHierarchy(g, state.mode);
    const laid = layoutVisible(g, state.mode, state.expanded);

    // Every id that BELONGS to the contains-forest (roots + all descendants),
    // computed from the hierarchy regardless of collapse state. A collapsed
    // root's descendants are hidden on purpose, so they must NOT fall into the
    // "Other" lane — only genuine non-hierarchy nodes (auxiliary types / orphans)
    // do. Walk childrenOf from each root.
    const hierMembers = new Set();
    const collectMembers = (id) => {
      if (hierMembers.has(id)) return;
      hierMembers.add(id);
      for (const child of (hierarchy.childrenOf.get(id) || [])) collectMembers(child);
    };
    for (const rootId of hierarchy.roots) collectMembers(rootId);

    // The hierarchy layout only places nodes reachable from the mode's root types
    // (spec, or epic/feature). Any other filtered node — auxiliary types (quick,
    // backlog, adr, sprint), orphans, or unknown types — is laid into an appended
    // "Other" lane so NOTHING vanishes. Merge those boxes into the layout, then
    // add the edges among the now-complete visible set and re-derive the bbox.
    const otherLane = layoutOtherLane(g.nodes, laid.nodes, hierMembers, laid.bbox);
    if (Object.keys(otherLane.nodes).length) {
      Object.assign(laid.nodes, otherLane.nodes);
      const visible = new Set(Object.keys(laid.nodes));
      const drawn = new Set(laid.edges.map((e) => `${e.kind} ${e.from} ${e.to}`));
      for (const e of g.edges) {
        if (!visible.has(e.from) || !visible.has(e.to)) continue;
        if (drawn.has(`${e.kind} ${e.from} ${e.to}`)) continue; // already laid by the engine
        laid.edges.push({ from: e.from, to: e.to, kind: e.kind });
      }
      laid.bbox = mergeBoxes(laid.bbox, otherLane.box);
    }
    laid.otherLabel = otherLane.label;

    const { blockedSet, blockedEdgeKeys } = computeBlocked(g);

    lastBox = laid.bbox;
    lastLaid = laid;

    // neighbour index for hover/select trace; reset the lit-guard so the selection
    // restore below re-lights the FRESH dom even when the selected id is unchanged.
    tracedId = null;
    lastAdj = new Map();
    for (const e of laid.edges) {
      if (!lastAdj.has(e.from)) lastAdj.set(e.from, new Set());
      if (!lastAdj.has(e.to)) lastAdj.set(e.to, new Set());
      lastAdj.get(e.from).add(e.to);
      lastAdj.get(e.to).add(e.from);
    }

    const vbX = laid.bbox.minX;
    const vbY = laid.bbox.minY;
    const vbW = Math.max(1, laid.bbox.width);
    const vbH = Math.max(1, laid.bbox.height);

    // The SVG fills the stage with NO viewBox, so 1 user unit == 1 screen px and
    // the inner viewport <g> transform is the SOLE source of pan/zoom. (Setting a
    // viewBox to the bbox double-scales — viewBox "meet" × our transform — which is
    // why the canvas rendered far smaller than the fit intended.)
    const svgRoot = svg('svg', { class: 'ds-graph__svg' });
    viewport = svg('g', { class: 'ds-graph__viewport' });
    svgRoot.append(viewport);

    // defs INSIDE the transformed viewport: a dot-grid pattern (tracks pan/zoom
    // 1:1 — the infinite-canvas tell) + directional arrowheads for depends_on.
    viewport.append(svg('defs', {}, [
      svg('pattern', { id: 'ds-dotgrid', width: 24, height: 24, patternUnits: 'userSpaceOnUse' }, [
        svg('circle', { cx: 1, cy: 1, r: 1, class: 'ds-graph__dot' }),
      ]),
      svg('marker', { id: 'ds-arrow-dep', markerWidth: 8, markerHeight: 8, refX: 7, refY: 3, orient: 'auto', markerUnits: 'userSpaceOnUse' }, [
        svg('path', { d: 'M0,0 L7,3 L0,6 z', class: 'ds-arrowhead-dep' }),
      ]),
      svg('marker', { id: 'ds-arrow-blocked', markerWidth: 8, markerHeight: 8, refX: 7, refY: 3, orient: 'auto', markerUnits: 'userSpaceOnUse' }, [
        svg('path', { d: 'M0,0 L7,3 L0,6 z', class: 'ds-arrowhead-blocked' }),
      ]),
    ]));

    // dot-grid backdrop (first visual child → behind edges + nodes), inflated well
    // past the bbox so panning never reveals an edge.
    const GRID_M = 2000;
    viewport.append(svg('rect', {
      class: 'ds-graph__grid',
      x: vbX - GRID_M, y: vbY - GRID_M,
      width: vbW + GRID_M * 2, height: vbH + GRID_M * 2,
      fill: 'url(#ds-dotgrid)',
    }));

    // edges (drawn first so nodes sit on top)
    const gEdges = svg('g', { class: 'edges' });
    viewport.append(gEdges);
    for (const e of laid.edges) {
      const fromN = laid.nodes[e.from];
      const toN = laid.nodes[e.to];
      if (!fromN || !toN) continue;
      const isDep = e.kind === 'depends_on';
      // depends_on: from=dependent, to=prerequisite → draw prereq -> dependent so
      // the arrowhead points at the dependent. contains: parent(from) -> child(to).
      const src = isDep ? toN : fromN;
      const dst = isDep ? fromN : toN;
      const isBlocked = isDep && blockedEdgeKeys.has(`${e.from} ${e.to}`);
      let cls; let marker = null;
      if (isBlocked) { cls = 'edge-blocked'; marker = 'url(#ds-arrow-blocked)'; }
      else if (isDep) { cls = 'edge-depends'; marker = 'url(#ds-arrow-dep)'; }
      else cls = 'edge-contains';
      const attrs = { class: cls, d: edgePath(src, dst, e.kind), 'data-from': e.from, 'data-to': e.to };
      if (marker) attrs['marker-end'] = marker;
      gEdges.append(svg('path', attrs));
    }

    // nodes (foreignObject wrapping a ds-node div)
    const gNodes = svg('g', { class: 'nodes' });
    viewport.append(gNodes);
    for (const [id, p] of Object.entries(laid.nodes)) {
      const n = nodeById(id);
      if (!n) continue;
      const isRoot = p.kind === 'root';
      const isAux = p.kind === 'aux';
      const fo = svg('foreignObject', { x: p.x, y: p.y, width: p.w, height: p.h });
      const [badgeClass, badgeLabel] = badgeFor(n.status);
      const blockedCls = blockedSet.has(id) ? ' node-blocked' : '';
      const selCls = id === state.selectedId ? ' is-selected' : '';
      const rootCls = isRoot ? ' is-root' : '';
      const expandedCls = isRoot && state.expanded.has(id) ? ' is-expanded' : '';
      const ghostCls = (state.expanded.size >= 1 && isRoot && !state.expanded.has(id)) ? ' is-ghost' : '';
      const localId = displayId(n);

      // Aux-lane cards lead with a type-colour dot + type label so quick / backlog
      // / adr / sprint (and any unknown type) carry a clear, fallback-safe type cue
      // — typeAccent / typeLabel both degrade gracefully for unknown types.
      const head = el('div', { class: 'ds-node__head' }, [
        isAux
          ? el('span', { class: 'ds-node__type-dot', attrs: { style: `background:${typeAccent(n.type)}`, title: typeLabel(n.type) } })
          : null,
        el('div', { class: 'ds-node__id', text: localId }),
      ]);
      let chevron = null;
      if (isRoot) {
        const open = state.expanded.has(id);
        chevron = el('button', {
          class: 'ds-node__chevron', text: open ? '−' : '+',
          attrs: { type: 'button', 'aria-label': `${open ? 'Collapse' : 'Expand'} ${localId}`, 'aria-expanded': String(open) },
        });
        head.append(chevron);
      }

      const body = [
        head,
        el('div', { class: 'ds-node__title', text: n.title || localId }),
      ];
      if (isRoot) {
        body.push(el('div', { class: 'ds-node__rollup', text: rollupLine(hierarchy.rollupOf.get(id)) }));
      } else {
        body.push(el('div', { class: 'ds-node__badge' }, [el('span', { class: `ds-badge ${badgeClass}`, text: badgeLabel })]));
      }

      const card = el('div', {
        class: `ds-node type-${n.type} ${accentClass(n.status)}${blockedCls}${selCls}${rootCls}${expandedCls}${ghostCls}`,
        attrs: { 'data-id': id, role: 'button', tabindex: '0', 'aria-label': `${localId} ${n.title || ''}`.trim() },
      }, body);

      // body click → inspector; chevron click → expand/collapse (stops propagation)
      const onPick = () => selectNode(id);
      card.addEventListener('click', onPick);
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(); }
      });
      if (chevron) {
        chevron.addEventListener('click', (ev) => { ev.stopPropagation(); toggleExpand(id); });
        chevron.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); toggleExpand(id); }
        });
      }
      fo.append(card);
      gNodes.append(fo);
    }

    // "Other" lane heading (drawn after nodes so it reads on top of the grid).
    if (laid.otherLabel) {
      viewport.append(svg('text', {
        class: 'ds-graph__lane-label',
        x: laid.otherLabel.x, y: laid.otherLabel.y,
      }, [document.createTextNode('Other')]));
    }

    // mount the svg (no viewBox — 1 user unit == 1 screen px; the viewport <g>
    // transform alone positions + scales the drawing).
    scroll.innerHTML = '';
    scroll.append(svgRoot);

    // tier chips reflect the present hierarchy layer set as short codes
    // (SPEC · US · TASK) for the CURRENT rail-filtered graph.
    tierChips.textContent = presentTiers(g, state.mode).map((t) => t.code).join(' · ');

    // legend (edge styles + status-to-accent key)
    renderLegend();

    // minimap (scaled SVG clone reflecting the currently-visible nodes)
    renderMinimap(laid, blockedSet);

    // restore selection highlight + inspector
    if (state.selectedId && nodeById(state.selectedId)) selectNode(state.selectedId);

    // auto-fit on first render + after every expand/collapse so the visible set
    // is always centered + on-frame; otherwise keep the user's pan/zoom.
    if (opts.fit) {
      // FOCUS-fit a single expanded spec (drill-IN); otherwise fit ALL visible
      // nodes with a readable-floor clamp so a wide graph never goes microscopic.
      const runFit = () => {
        // EXPAND is a deliberate drill-IN: focus-fit the opened subtree (readable
        // band) and glide there via the viewport's transition. Other fits (collapse,
        // ⤢, expand-all, resize) fit ALL visible nodes with the readable floor.
        const focusBox = opts.focusId ? bboxOf(laid.nodes, opts.focusId) : null;
        if (focusBox) fitToView(focusBox, FOCUS_MIN_SCALE, FOCUS_MAX_SCALE);
        else fitToView(lastBox, FIT_ALL_MIN_SCALE);
      };
      // defer one task so the freshly-mounted SVG is laid out before measuring.
      // A 0ms timer (unlike requestAnimationFrame, which is throttled to never in
      // a hidden/background tab) always fires, so the auto-fit is never skipped.
      setTimeout(runFit, 0);
    } else {
      applyTransform();
    }
  }

  /** Fill the legend (edge styles + status-to-accent key). */
  function renderLegend() {
    legend.innerHTML = '';
    const statusKeys = [
      ['lg-done', 'done'], ['lg-progress', 'in progress'],
      ['lg-blocked', 'blocked'], ['lg-todo', 'todo'], ['lg-addressed', 'addressed'],
    ];
    for (const [dotCls, label] of statusKeys) {
      legend.append(el('span', { class: 'ds-graph__legend-item' }, [
        el('span', { class: `ds-graph__legend-dot ${dotCls}` }),
        el('span', { text: label }),
      ]));
    }
    legend.append(
      el('span', { class: 'ds-graph__legend-item' }, [
        el('span', { class: 'ds-graph__legend-line' }), el('span', { text: 'contains' }),
      ]),
      el('span', { class: 'ds-graph__legend-item' }, [
        el('span', { class: 'ds-graph__legend-line is-dashed' }), el('span', { text: 'depends_on' }),
      ]),
      el('span', { class: 'ds-graph__legend-item' }, [
        el('span', { class: 'ds-graph__legend-line is-blocked' }), el('span', { text: 'blocked path' }),
      ]),
    );
  }

  /**
   * Render the minimap: a viewBox-matched SVG with one rect per VISIBLE node plus
   * a viewport-indicator rect showing what slice of the canvas is on screen.
   */
  function renderMinimap(laid, blockedSet) {
    minimap.innerHTML = '';
    const b = laid.bbox;
    const mm = svg('svg', {
      viewBox: `${b.minX} ${b.minY} ${Math.max(1, b.width)} ${Math.max(1, b.height)}`,
      preserveAspectRatio: 'xMidYMid meet',
    });
    for (const [id, p] of Object.entries(laid.nodes)) {
      const n = nodeById(id);
      let acc = n ? accentClass(n.status) : 'acc-todo';
      if (blockedSet.has(id)) acc = 'acc-blocked';
      mm.append(svg('rect', {
        class: `mm-node ${acc}`,
        x: p.x, y: p.y, width: p.w, height: p.h, rx: 4,
      }));
    }
    minimapVp = svg('rect', { class: 'mm-viewport', x: b.minX, y: b.minY, width: 1, height: 1 });
    mm.append(minimapVp);
    minimap.append(mm);
    updateMinimapViewport();
  }

  /** Position the minimap's viewport indicator from the current pan/zoom. */
  function updateMinimapViewport() {
    if (!minimapVp) return;
    const { w: vw, h: vh } = viewportSize();
    // the content rectangle currently visible: invert the transform
    const x = (-state.tx) / state.scale;
    const y = (-state.ty) / state.scale;
    const w = vw / state.scale;
    const h = vh / state.scale;
    minimapVp.setAttribute('x', x);
    minimapVp.setAttribute('y', y);
    minimapVp.setAttribute('width', Math.max(1, w));
    minimapVp.setAttribute('height', Math.max(1, h));
  }

  /* ── interaction wiring ────────────────────────────────────────────── */
  zoomIn.addEventListener('click', () => zoomBy(ZOOM_STEP));
  zoomOut.addEventListener('click', () => zoomBy(1 / ZOOM_STEP));
  // 1:1 → return to 100% scale, re-centered on the current drawing.
  const resetZoom = () => {
    const { w: vw, h: vh } = viewportSize();
    state.scale = 1;
    const cx = lastBox.minX + lastBox.width / 2;
    const cy = lastBox.minY + lastBox.height / 2;
    state.tx = vw / 2 - cx;
    state.ty = vh / 2 - cy;
    applyTransform();
  };
  zoomReset.addEventListener('click', resetZoom);
  // ⤢ fits ALL visible nodes (collapsed grid or expanded subtrees), with the
  // readable-floor clamp so a wide drawing never collapses to a tiny strip.
  zoomFit.addEventListener('click', () => fitToView(lastBox, FIT_ALL_MIN_SCALE));

  // hover-to-trace (delegated on the stable scroll container so it survives
  // re-renders): light the hovered card, its neighbours, and connecting edges.
  scroll.addEventListener('pointerover', (ev) => {
    if (panning) return;
    const card = ev.target && ev.target.closest && ev.target.closest('.ds-node');
    if (card) lightTrace(card.getAttribute('data-id'));
  });
  scroll.addEventListener('pointerout', (ev) => {
    const card = ev.target && ev.target.closest && ev.target.closest('.ds-node');
    if (!card) return;
    if (state.selectedId) lightTrace(state.selectedId); // selection pins the trace
    else clearTrace();
  });

  // keyboard pan/zoom (arrow keys pan, +/- zoom, 0 reset, f fit) — only when the
  // canvas itself is focused, not a card (cards handle Enter/Space).
  scroll.addEventListener('keydown', (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest('.ds-node')) return;
    const step = ev.shiftKey ? 192 : 48;
    let handled = true;
    switch (ev.key) {
      case 'ArrowLeft': state.tx += step; applyTransform(); break;
      case 'ArrowRight': state.tx -= step; applyTransform(); break;
      case 'ArrowUp': state.ty += step; applyTransform(); break;
      case 'ArrowDown': state.ty -= step; applyTransform(); break;
      case '+': case '=': zoomBy(ZOOM_STEP); break;
      case '-': case '_': zoomBy(1 / ZOOM_STEP); break;
      case '0': resetZoom(); break;
      case 'f': case 'F': fitToView(lastBox, FIT_ALL_MIN_SCALE); break;
      default: handled = false;
    }
    if (handled) ev.preventDefault();
  });

  // Figma-grade input model (ported from the design-board viewport): a trackpad
  // two-finger scroll PANS; pinch / ⌘-scroll / a mouse wheel ZOOMS toward the
  // cursor. Transition-free while interacting so it tracks the pointer 1:1.
  let zoomIdle = null;
  let isGesturing = false;
  const focalOf = (ev) => {
    const r = scroll.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const markActive = () => {
    scroll.classList.add('is-zooming');
    hint.classList.add('is-gone');
    if (zoomIdle) clearTimeout(zoomIdle);
    zoomIdle = setTimeout(() => scroll.classList.remove('is-zooming'), 140);
  };
  // Mouse wheel vs trackpad: line-mode, or a chunky integer deltaY with no deltaX.
  const isMouseWheel = (e) => e.deltaMode !== 0
    || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);
  scroll.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    if (isGesturing) return;
    if ((ev.ctrlKey || ev.metaKey) && !isMouseWheel(ev)) {
      // trackpad pinch (browser reports it as ctrl+wheel) → smooth zoom at cursor
      markActive();
      zoomBy(Math.exp(-ev.deltaY * 0.01), focalOf(ev));
    } else if (isMouseWheel(ev)) {
      // discrete mouse wheel → zoom at cursor
      markActive();
      zoomBy(Math.exp(-Math.sign(ev.deltaY) * 0.18), focalOf(ev));
    } else {
      // trackpad two-finger scroll → PAN (Figma behaviour)
      markActive();
      state.tx -= ev.deltaX;
      state.ty -= ev.deltaY;
      applyTransform();
    }
  }, { passive: false });

  // Safari trackpad pinch (gesture* events): zoom toward the cursor.
  let gestureBase = 1;
  scroll.addEventListener('gesturestart', (ev) => {
    ev.preventDefault();
    isGesturing = true;
    gestureBase = state.scale;
  }, { passive: false });
  scroll.addEventListener('gesturechange', (ev) => {
    ev.preventDefault();
    markActive();
    zoomBy((gestureBase * ev.scale) / state.scale, focalOf(ev));
  }, { passive: false });
  scroll.addEventListener('gestureend', (ev) => {
    ev.preventDefault();
    isGesturing = false;
  }, { passive: false });

  // pan-by-drag via pointer events on the scroll container
  let panning = false;
  let startX = 0; let startY = 0; let startTx = 0; let startTy = 0;
  scroll.addEventListener('pointerdown', (ev) => {
    // ignore drags that begin on a node (those are clicks/selection/chevron)
    if (ev.target && ev.target.closest && ev.target.closest('.ds-node')) return;
    panning = true;
    hint.classList.add('is-gone');
    startX = ev.clientX; startY = ev.clientY; startTx = state.tx; startTy = state.ty;
    scroll.classList.add('is-panning');
    if (scroll.setPointerCapture) { try { scroll.setPointerCapture(ev.pointerId); } catch { /* unsupported */ } }
  });
  scroll.addEventListener('pointermove', (ev) => {
    if (!panning) return;
    state.tx = startTx + (ev.clientX - startX);
    state.ty = startTy + (ev.clientY - startY);
    applyTransform();
  });
  function endPan() { panning = false; scroll.classList.remove('is-panning'); }
  scroll.addEventListener('pointerup', endPan);
  scroll.addEventListener('pointercancel', endPan);
  scroll.addEventListener('pointerleave', endPan);

  // expand-all / collapse-all (over the CURRENT rail-filtered roots)
  expandAllBtn.addEventListener('click', () => {
    const h = buildHierarchy(filteredGraph(), state.mode);
    state.expanded = new Set(h.roots);
    render({ fit: true });
  });
  collapseAllBtn.addEventListener('click', () => {
    state.expanded = new Set();
    render({ fit: true });
  });

  // mode toggle: re-layout + re-render + auto-fit in the chosen mode
  function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    state.expanded = new Set(); // start collapsed in the new mode
    agileBtn.setAttribute('aria-pressed', String(mode === 'agile'));
    specBtn.setAttribute('aria-pressed', String(mode === 'spec'));
    render({ fit: true });
  }
  let userPickedMode = false;
  agileBtn.addEventListener('click', () => { userPickedMode = true; setMode('agile'); });
  specBtn.addEventListener('click', () => { userPickedMode = true; setMode('spec'); });

  // If /api/meta resolves the project mode AFTER this view mounted, adopt the
  // project default for the toggle — unless the user already chose a mode.
  const onProjectMode = () => { if (!userPickedMode) setMode(defaultMode()); };
  document.addEventListener('planr:mode', onProjectMode);
  mount.cleanup = () => document.removeEventListener('planr:mode', onProjectMode);

  // re-render + re-fit when the SHARED rail filter (type / status) changes, so the
  // canvas always reflects exactly the rail's selection — never a stale set.
  const onFilterChange = () => { state.expanded = new Set(); render({ fit: true }); };
  document.addEventListener('planr:filter-change', onFilterChange);
  let prevCleanup = mount.cleanup;
  mount.cleanup = () => { prevCleanup(); document.removeEventListener('planr:filter-change', onFilterChange); };

  // re-fit on viewport resize so the drawing stays centered (no re-layout); a
  // resize re-fits ALL visible nodes with the readable-floor clamp.
  let resizeIdle = null;
  const onResize = () => {
    if (resizeIdle) clearTimeout(resizeIdle);
    resizeIdle = setTimeout(() => fitToView(lastBox, FIT_ALL_MIN_SCALE), 120);
  };
  window.addEventListener('resize', onResize);
  prevCleanup = mount.cleanup;
  mount.cleanup = () => { prevCleanup(); window.removeEventListener('resize', onResize); };

  // mount scaffold + first render (auto-fit so nodes are centered on load)
  mountEl.innerHTML = '';
  mountEl.append(root);
  render({ fit: true });

  // expose a partialRefresh hook so live SSE patches (main.js) repaint without a
  // full re-mount, preserving mode / expansion / selection (no auto-fit so the
  // user's pan/zoom survives a live patch).
  mount.partialRefresh = () => render({ fit: false });
}

/** Optional live-sync hook used by main.js after an SSE patch (set on mount). */
export function partialRefresh() {
  if (typeof mount.partialRefresh === 'function') return mount.partialRefresh();
  return undefined;
}
