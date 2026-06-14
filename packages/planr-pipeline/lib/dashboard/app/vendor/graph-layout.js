/**
 * graph-layout.js — self-contained, collapse-to-roots graph layout
 * (SPEC-016 / T-009, US-006). ZERO dependencies — no module is pulled in from any
 * package; pure ESM that runs identically in the browser and in Node. Names no
 * third-party product.
 *
 * WHY THIS SHAPE: the project graph is wide and shallow — ~15 spec roots, each
 * containing a handful of stories, each containing a handful of tasks (≈147 nodes
 * total). Laying out every node at once crams 147 cards into 3 hairline rows that
 * render off-frame. Instead this module lays out a COLLAPSE-TO-ROOTS canvas:
 *
 *   - COLLAPSED (default): one card per top-level group (spec in spec mode;
 *     epic / feature root in agile mode), arranged in a tidy grid. Each root
 *     carries a `rollup` (story count · task count · % of its tasks done).
 *   - EXPANDED (per root): a root the caller has opened reveals a compact subtree
 *     of its child stories and each story's tasks, with contains + depends_on
 *     edges. Unopened roots stay one card and reflow around the opened block.
 *
 * Only the VISIBLE set is laid out (collapsed roots + the subtrees of expanded
 * roots) — never the full 147-node graph when 16 cards are shown.
 *
 * ALGORITHM CLASS (described neutrally): a hierarchy walk over the `contains`
 * edges builds a forest of roots → stories → tasks; each expanded root gets a
 * small layered subtree drawing (root row → story row → task row, ordered to
 * reduce dependency-edge crossings); the roots/subtrees are then packed into a
 * responsive grid of "blocks". The result carries an absolute bounding box the
 * view uses to auto-fit the viewport so nodes are always centered and on-frame.
 *
 * PUBLIC API
 *   buildHierarchy(graph, mode)
 *     → { roots: [rootId], childrenOf: Map, parentOf: Map, kind: Map,
 *         rollupOf: Map<rootId,{stories,tasks,donePct}>, byId: Map }
 *   layoutVisible(graph, mode, expanded, opts)
 *     → { nodes: {[id]:{id,x,y,w,h,width,height,kind,rootId}},
 *         edges: [{from,to,kind,points}],
 *         roots: [rootId],
 *         bbox: {minX,minY,maxX,maxY,width,height} }
 *   layout(graph, mode)   — back-compat: the collapsed-roots layout, with the
 *         legacy { nodes, edges, tiers, width, height } shape preserved.
 *
 * Coordinates are absolute pixels. `w`/`h` mirror `width`/`height` so both the
 * map-style consumer and coordinate-style assertions read the same numbers.
 */

/* ── which node types are the top-level ROOTS, per model ───────────────────── */
const ROOT_TYPES = {
  spec: ['spec'],
  agile: ['epic', 'feature'],
};

/* ── layout geometry (every value is a multiple of the 4-point grid, §3) ─── */
const ROOT_W = 232; // collapsed root / spec card width (px)
const ROOT_H = 96; // collapsed root card height (px, holds id + title + rollup)
// Story and task cards share ONE size inside a subtree so a column reads as a
// clean, uniform stack (type is shown by the accent colour + the id, not size).
const STORY_W = 200;
const STORY_H = 68;
const TASK_W = 200;
const TASK_H = 68;

const COL_GAP = 24; // horizontal gap between sibling cards
const ROW_GAP = 56; // vertical gap between tiers (root→stories) + between wrapped grid rows
const CHILD_GAP = 20; // vertical gap from a story card down to its first task
const TASK_GAP = 12; // vertical gap between a story's stacked tasks
const STORY_COL_GAP = 32; // horizontal gap between sibling story columns
const BLOCK_GAP_X = 48; // horizontal gap between two blocks (roots) in the grid
const BLOCK_GAP_Y = 48; // vertical gap between block rows in the grid
const PAD = 48; // canvas padding around the whole drawing

/* ── tiny helpers ─────────────────────────────────────────────────────────── */

/** Safe graph: tolerate missing / malformed input without throwing. */
function safeGraph(graph) {
  return graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges)
    ? graph
    : { nodes: [], edges: [] };
}

/**
 * Build the contains-forest for `mode`: which nodes are roots, the children of
 * every node (in their source order), and a per-root rollup. Pure — never
 * mutates the input. The hierarchy is derived from `contains` edges, so it works
 * for any tier depth (spec → story → task, or epic → feature → story → task).
 *
 * @param {{nodes:object[],edges:object[]}} graph
 * @param {"spec"|"agile"} mode
 */
export function buildHierarchy(graph, mode = 'spec') {
  const g = safeGraph(graph);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));

  // contains adjacency: parent → [child ids], preserving source order
  const childrenOf = new Map();
  const parentOf = new Map();
  for (const e of g.edges) {
    if (e.kind !== 'contains') continue;
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    if (!childrenOf.has(e.from)) childrenOf.set(e.from, []);
    childrenOf.get(e.from).push(e.to);
    parentOf.set(e.to, e.from);
  }

  // ROOTS: nodes of a root type for this mode (spec: 'spec'; agile: epic/feature)
  // that have no contains-parent of a root type. In a mixed tree we take the
  // top-most root type present.
  const rootTypes = ROOT_TYPES[mode] || ROOT_TYPES.spec;
  const rootTypeSet = new Set(rootTypes);
  const roots = [];
  for (const n of g.nodes) {
    if (!rootTypeSet.has(n.type)) continue;
    const parent = parentOf.get(n.id);
    const parentNode = parent != null ? byId.get(parent) : null;
    if (parentNode && rootTypeSet.has(parentNode.type)) continue; // nested root
    roots.push(n.id);
  }

  // descendants of a node, depth-first (used for rollups)
  function descendants(id) {
    const out = [];
    const stack = [...(childrenOf.get(id) || [])];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.shift();
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);
      for (const c of childrenOf.get(cur) || []) stack.push(c);
    }
    return out;
  }

  // per-root rollup: story count · task count · % of its tasks done
  const rollupOf = new Map();
  for (const rootId of roots) {
    let stories = 0;
    let tasks = 0;
    let done = 0;
    for (const d of descendants(rootId)) {
      const node = byId.get(d);
      if (!node) continue;
      if (node.type === 'story') stories += 1;
      else if (node.type === 'task') {
        tasks += 1;
        if (node.status === 'done') done += 1;
      }
    }
    rollupOf.set(rootId, { stories, tasks, donePct: tasks ? Math.round((done / tasks) * 100) : 0 });
  }

  return { roots, childrenOf, parentOf, byId, rollupOf };
}

/* ── crossing-aware ordering within a subtree ─────────────────────────────── */

/**
 * Order a layer of sibling nodes by the median position of their depends_on
 * neighbours in the layer above (greedy median heuristic), keeping the base
 * order as a deterministic tie-break. Mutates nothing; returns a new array.
 */
function orderByMedian(layer, above, depAdj) {
  if (layer.length < 2 || above.length === 0) return layer.slice();
  const posAbove = new Map(above.map((id, i) => [id, i]));
  const base = new Map(layer.map((id, i) => [id, i]));
  const medianOf = (id) => {
    const ns = (depAdj.get(id) || [])
      .map((to) => posAbove.get(to))
      .filter((p) => p != null)
      .sort((a, b) => a - b);
    if (ns.length === 0) return -1;
    const mid = Math.floor(ns.length / 2);
    return ns.length % 2 ? ns[mid] : (ns[mid - 1] + ns[mid]) / 2;
  };
  const med = new Map(layer.map((id) => [id, medianOf(id)]));
  return layer.slice().sort((a, b) => {
    const ma = med.get(a);
    const mb = med.get(b);
    if (ma === mb || ma === -1 || mb === -1) return base.get(a) - base.get(b);
    return ma - mb;
  });
}

/* ── per-root subtree layout (relative coordinates, origin at 0,0) ────────── */

/**
 * Lay out one expanded root as a COMPACT subtree: a root card, then one column
 * per story with that story's tasks STACKED VERTICALLY beneath it. The story
 * columns WRAP into multiple rows (a roughly-square grid) instead of running off
 * in a single wide strip — so a spec with many stories / tasks stays small enough
 * that the view can focus-fit it readably (a drill-IN), not a 12-wide row that
 * forces a microscopic whole-graph refit. Returns node boxes in coordinates
 * RELATIVE to the block origin, plus the block's own width/height.
 *
 * @returns {{nodes:object, width:number, height:number}}
 */
function layoutSubtree(rootId, hierarchy, depAdj) {
  const { childrenOf, byId } = hierarchy;
  const nodes = {};

  // story layer = the root's INTERMEDIATE children (stories), NOT its tasks.
  // In this graph a task is `contains`-linked to BOTH its spec and its owning
  // story, so the root's child list mixes stories and tasks — keep only the
  // non-leaf tier (anything that is not a 'task') so each task lands under its
  // owning story exactly once via that story's own contains edges.
  const stories = (childrenOf.get(rootId) || [])
    .filter((id) => byId.has(id))
    .filter((id) => byId.get(id).type !== 'task');

  const orderedStories = orderByMedian(stories, [rootId], depAdj);

  if (orderedStories.length === 0) {
    // no stories → the subtree is just the root card
    nodes[rootId] = {
      id: rootId, x: 0, y: 0,
      w: ROOT_W, h: ROOT_H, width: ROOT_W, height: ROOT_H, kind: 'root', rootId,
    };
    return { nodes, width: ROOT_W, height: ROOT_H };
  }

  // PARENT-ANCHORED COLUMNS: the stories sit in ONE row (the shape the user asked
  // for), and each story's tasks STACK VERTICALLY directly beneath it — one column
  // per story. This makes every `contains` edge a short straight drop from a story
  // into its own task stack (zero crossings between the tiers) AND keeps the
  // subtree NARROW and tall, so the focus-fit stays readable and fills the canvas
  // vertically instead of shrinking to a wide hairline strip.
  const taskParent = new Map();
  const allTasks = [];
  const tasksByStory = new Map(orderedStories.map((s) => [s, []]));
  for (const sid of orderedStories) {
    for (const tid of (childrenOf.get(sid) || []).filter((id) => byId.has(id))) {
      taskParent.set(tid, sid);
      tasksByStory.get(sid).push(tid);
      allTasks.push(tid);
    }
  }

  const COL_W = Math.max(STORY_W, TASK_W);
  const storyY = ROOT_H + ROW_GAP;
  const taskTop = storyY + STORY_H + CHILD_GAP;
  let maxStack = 0;

  orderedStories.forEach((sid, i) => {
    const colX = i * (COL_W + STORY_COL_GAP);
    nodes[sid] = {
      id: sid, x: colX + (COL_W - STORY_W) / 2, y: storyY,
      w: STORY_W, h: STORY_H, width: STORY_W, height: STORY_H, kind: 'story', rootId,
    };
    const tasks = tasksByStory.get(sid) || [];
    if (tasks.length > maxStack) maxStack = tasks.length;
    tasks.forEach((tid, j) => {
      nodes[tid] = {
        id: tid, x: colX + (COL_W - TASK_W) / 2, y: taskTop + j * (TASK_H + TASK_GAP),
        w: TASK_W, h: TASK_H, width: TASK_W, height: TASK_H, kind: 'task', rootId,
      };
    });
  });

  const colsW = orderedStories.length * COL_W + (orderedStories.length - 1) * STORY_COL_GAP;
  const contentW = Math.max(ROOT_W, colsW);

  // root card centered over the full content width
  nodes[rootId] = {
    id: rootId, x: (contentW - ROOT_W) / 2, y: 0,
    w: ROOT_W, h: ROOT_H, width: ROOT_W, height: ROOT_H, kind: 'root', rootId,
  };

  const height = maxStack
    ? taskTop + maxStack * TASK_H + (maxStack - 1) * TASK_GAP
    : storyY + STORY_H;
  return { nodes, width: contentW, height };
}

/* ── edge routing (vertical bezier control points) ────────────────────────── */

function edgePoints(a, b, kind, sameRow) {
  // depends_on between two same-row siblings: a lateral arc (right port of the
  // prerequisite -> left port of the dependent). Mirrors the view's edgePath so
  // the sampled points stay honest with what is drawn.
  if (kind !== 'contains' && sameRow) {
    const y = a.y + a.h / 2;
    let xr; let xl; let dir;
    if (b.x >= a.x) { xr = a.x + a.w; xl = b.x; dir = -1; }
    else { xr = a.x; xl = b.x + b.w; dir = 1; }
    const bow = dir * Math.min(36, a.h * 0.6);
    return [
      { x: xr, y },
      { x: (xr + xl) / 2, y: y + bow },
      { x: xl, y },
    ];
  }
  // contains + cross-row depends_on: vertical sampling
  const x1 = a.x + a.w / 2;
  const y1 = a.y + a.h;
  const x2 = b.x + b.w / 2;
  const y2 = b.y;
  const my = (y1 + y2) / 2;
  return [
    { x: x1, y: y1 },
    { x: (x1 + x2) / 2, y: my },
    { x: x2, y: y2 },
  ];
}

/* ── visible-set layout: collapsed roots + expanded subtrees, grid-packed ─── */

/**
 * Lay out ONLY the currently-visible set: every root as a block (collapsed = a
 * single root card; expanded = its subtree), packed into a responsive grid, plus
 * the edges among visible nodes. Returns absolute pixel coordinates and a
 * bounding box the view uses to compute the auto-fit transform.
 *
 * @param {{nodes:object[],edges:object[]}} graph
 * @param {"spec"|"agile"} mode
 * @param {Set<string>|Iterable<string>} expanded root ids that are expanded
 * @param {{columns?:number}} [opts] columns: target blocks per grid row
 * @returns {{nodes:object, edges:object[], roots:string[], bbox:object}}
 */
export function layoutVisible(graph, mode = 'spec', expanded = new Set(), opts = {}) {
  const g = safeGraph(graph);
  const hierarchy = buildHierarchy(g, mode);
  const { roots, byId } = hierarchy;
  const expandedSet = expanded instanceof Set ? expanded : new Set(expanded || []);

  // depends_on adjacency (dependent → [prerequisites]) for crossing-aware order
  const depAdj = new Map();
  for (const e of g.edges) {
    if (e.kind !== 'depends_on') continue;
    if (!depAdj.has(e.from)) depAdj.set(e.from, []);
    depAdj.get(e.from).push(e.to);
  }

  // 1 — build one block per root (collapsed card OR expanded subtree)
  const blocks = roots.map((rootId) => {
    if (expandedSet.has(rootId)) {
      const sub = layoutSubtree(rootId, hierarchy, depAdj);
      return { rootId, nodes: sub.nodes, width: sub.width, height: sub.height, expanded: true };
    }
    // collapsed: a single root card
    const nodes = {
      [rootId]: {
        id: rootId, x: 0, y: 0,
        w: ROOT_W, h: ROOT_H, width: ROOT_W, height: ROOT_H, kind: 'root', rootId,
      },
    };
    return { rootId, nodes, width: ROOT_W, height: ROOT_H, expanded: false };
  });

  // 2 — pack blocks into a responsive grid. Columns: caller hint, else a square
  //     grid of the root count, capped so collapsed cards read comfortably.
  const count = Math.max(1, blocks.length);
  const columns = Math.max(1, opts.columns || Math.min(count, Math.max(3, Math.ceil(Math.sqrt(count)))));

  // row-by-row placement: each grid row is as tall as its tallest block, each
  // grid column is as wide as the widest block in it (keeps cards aligned).
  const rowsOfBlocks = [];
  for (let i = 0; i < blocks.length; i += columns) rowsOfBlocks.push(blocks.slice(i, i + columns));
  const colWidth = [];
  for (const row of rowsOfBlocks) {
    row.forEach((b, c) => { colWidth[c] = Math.max(colWidth[c] || 0, b.width); });
  }
  const colX = [];
  let acc = PAD;
  for (let c = 0; c < colWidth.length; c++) { colX[c] = acc; acc += colWidth[c] + BLOCK_GAP_X; }

  const nodes = {};
  let cursorY = PAD;
  for (const row of rowsOfBlocks) {
    const rowH = Math.max(...row.map((b) => b.height));
    row.forEach((b, c) => {
      // center each block within its grid column
      const offX = colX[c] + (colWidth[c] - b.width) / 2;
      for (const [id, p] of Object.entries(b.nodes)) {
        nodes[id] = { ...p, x: p.x + offX, y: p.y + cursorY };
      }
    });
    cursorY += rowH + BLOCK_GAP_Y;
  }

  // 3 — edges among visible nodes only
  const visible = new Set(Object.keys(nodes));
  const edges = [];
  for (const e of g.edges) {
    const fromN = nodes[e.from];
    const toN = nodes[e.to];
    if (!fromN || !toN) continue;
    if (!visible.has(e.from) || !visible.has(e.to)) continue;
    // depends_on: from=dependent, to=prerequisite — sample prereq -> dependent so
    // the points (and the view's arrowhead) run toward the dependent. contains:
    // from=parent (source) -> child (target).
    const isDep = e.kind === 'depends_on';
    const src = isDep ? toN : fromN;
    const dst = isDep ? fromN : toN;
    const sameRow = Math.abs(src.y - dst.y) < 2;
    edges.push({ from: e.from, to: e.to, kind: e.kind, points: edgePoints(src, dst, e.kind, sameRow) });
  }

  // 4 — bounding box of every placed node (the view fits this to the viewport)
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of Object.values(nodes)) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = ROOT_W; maxY = ROOT_H; }
  const bbox = {
    minX: minX - PAD, minY: minY - PAD,
    maxX: maxX + PAD, maxY: maxY + PAD,
    width: (maxX - minX) + PAD * 2,
    height: (maxY - minY) + PAD * 2,
  };

  void byId; // (referenced for parity with buildHierarchy consumers)
  return { nodes, edges, roots, bbox };
}

/**
 * Padded bounding box of a subset of laid nodes (SPEC-016 focus-fit). Pass the
 * map from `layoutVisible(...).nodes` and, optionally, a `rootId` to restrict the
 * box to just that root's subtree (the root card + its stories + tasks) — the
 * view uses this to focus-fit a single expanded spec instead of refitting all
 * ~16 collapsed cards. Returns null when no node matches.
 *
 * @param {object} laidNodes map of id → { x, y, w, h, rootId }
 * @param {string|null} [rootId] restrict to one root's subtree (null = all)
 * @param {number} [pad=PAD] padding (px) added on every side
 * @returns {{minX,minY,maxX,maxY,width,height}|null}
 */
export function bboxOf(laidNodes, rootId = null, pad = PAD) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  let any = false;
  for (const p of Object.values(laidNodes || {})) {
    if (rootId != null && p.rootId !== rootId) continue;
    any = true;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  if (!any) return null;
  return {
    minX: minX - pad, minY: minY - pad,
    maxX: maxX + pad, maxY: maxY + pad,
    width: (maxX - minX) + pad * 2,
    height: (maxY - minY) + pad * 2,
  };
}

/* ── back-compat: the collapsed-roots layout in the legacy shape ──────────── */

/**
 * Layered layout for a project Graph — retained for callers that expect the
 * legacy `{ nodes, edges, tiers, width, height }` shape. It returns the COLLAPSED
 * roots layout (one card per top-level group), which is the default canvas.
 *
 * @param {{nodes:object[],edges:object[]}} graph schema-valid Graph object
 * @param {"spec"|"agile"} [mode="spec"] which tier model to lay out
 * @returns {{nodes:object, edges:object[], tiers:object[], width:number, height:number}}
 */
export function layout(graph, mode = 'spec') {
  const laid = layoutVisible(graph, mode, new Set());
  const rootLabel = (ROOT_TYPES[mode] || ROOT_TYPES.spec)[0] || 'spec';
  const tiers = [{
    type: rootLabel,
    label: rootLabel.charAt(0).toUpperCase() + rootLabel.slice(1),
    layer: 0,
    y: laid.bbox.minY + PAD,
  }];
  return {
    nodes: laid.nodes,
    edges: laid.edges,
    tiers,
    width: laid.bbox.width,
    height: laid.bbox.height,
  };
}

export default layout;
