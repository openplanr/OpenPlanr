/**
 * metadata.js — the dashboard's single source of truth for artifact metadata
 * (SPEC-016 follow-up: metadata-driven filters, grouping, and labels).
 *
 * The data layer (graph-reader.mjs) emits a node `type` ∈ TYPE_IDS and a
 * classified `status` ∈ STATUS_IDS. Before this module those vocabularies were
 * re-hardcoded in every view (shell TYPE_FILTERS, list TYPE_CHIPS, board DIMS,
 * graph TIERS, overview tallies…), so new/auxiliary types (quick, backlog,
 * sprint, adr) silently vanished from filters, grouping, counts, and search.
 *
 * Everything UI-facing now derives from THIS registry + the graph actually
 * loaded, so any type present in `.planr/` is filterable, groupable, countable,
 * and labelled everywhere — and nothing is ever silently dropped. A node whose
 * type is unknown to the registry still renders (it falls back to a sane label,
 * the muted accent, and a "to do" badge) rather than disappearing.
 *
 * Pure, dependency-free ES module (browser + Node test). No DOM. Token-only
 * accents (ds.css custom properties). No third-party product codenames.
 */

/* ── artifact types ─────────────────────────────────────────────────────────
 * Registry order is the canonical display order (hierarchy first, then the
 * auxiliary artifact kinds). `accent` is the ds.css token for the card accent
 * stripe / dot; `plural` labels chips and KPI tiles. Keep in lockstep with the
 * graph.schema.json `type` enum and graph-reader.mjs inferType(). */
export const TYPES = [
  { id: 'epic', label: 'Epic', plural: 'Epics', accent: 'var(--primary)' },
  { id: 'feature', label: 'Feature', plural: 'Features', accent: 'var(--info)' },
  { id: 'story', label: 'Story', plural: 'Stories', accent: 'var(--success)' },
  { id: 'task', label: 'Task', plural: 'Tasks', accent: 'var(--muted-foreground)' },
  { id: 'spec', label: 'Spec', plural: 'Specs', accent: 'var(--primary)' },
  { id: 'backlog', label: 'Backlog', plural: 'Backlog', accent: 'var(--muted-foreground)' },
  { id: 'quick', label: 'Quick', plural: 'Quick tasks', accent: 'var(--warning)' },
  { id: 'sprint', label: 'Sprint', plural: 'Sprints', accent: 'var(--info)' },
  { id: 'adr', label: 'ADR', plural: 'ADRs', accent: 'var(--accent-foreground)' },
];

export const TYPE_BY_ID = new Map(TYPES.map((t) => [t.id, t]));
export const TYPE_IDS = TYPES.map((t) => t.id);

/** Registry order index for a type id (unknown types sort last, then alpha). */
function typeOrder(id) {
  const i = TYPE_IDS.indexOf(id);
  return i === -1 ? TYPE_IDS.length : i;
}

/** Human singular label for a type id (capitalized fallback for unknowns). */
export function typeLabel(id) {
  const t = TYPE_BY_ID.get(id);
  if (t) return t.label;
  const s = String(id || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Item';
}

/** Human plural label for a type id (falls back to the singular label). */
export function typePlural(id) {
  const t = TYPE_BY_ID.get(id);
  return t ? t.plural : typeLabel(id);
}

/** ds.css accent token for a type id (muted for unknowns). */
export function typeAccent(id) {
  const t = TYPE_BY_ID.get(id);
  return t ? t.accent : 'var(--muted-foreground)';
}

/* ── statuses ────────────────────────────────────────────────────────────────
 * The five classified statuses graph-reader.mjs produces. `badge` is the
 * ds.css badge modifier; `label` is the chip/badge text. */
export const STATUSES = [
  { id: 'outstanding', label: 'Outstanding', badge: 'ds-badge--todo', badgeText: 'to do' },
  { id: 'in-progress', label: 'In progress', badge: 'ds-badge--progress', badgeText: 'in progress' },
  { id: 'blocked', label: 'Blocked', badge: 'ds-badge--blocked', badgeText: 'blocked' },
  { id: 'done', label: 'Done', badge: 'ds-badge--done', badgeText: 'done' },
  { id: 'addressed', label: 'Addressed', badge: 'ds-badge--addressed', badgeText: 'addressed' },
];

export const STATUS_BY_ID = new Map(STATUSES.map((s) => [s.id, s]));
export const STATUS_IDS = STATUSES.map((s) => s.id);

/** Human label for a status id. */
export function statusLabel(id) {
  const s = STATUS_BY_ID.get(id);
  return s ? s.label : (id ? String(id) : 'Unknown');
}

/** [badgeClass, badgeText] for a status — the one place views resolve a badge. */
export function statusBadge(status) {
  const s = STATUS_BY_ID.get(status);
  return s ? [s.badge, s.badgeText] : ['ds-badge--todo', 'to do'];
}

/* ── present-in-graph enumeration (metadata-driven discovery) ────────────────*/

/** Distinct type ids present in the graph, in registry order (unknowns last). */
export function typesInGraph(nodes) {
  const present = new Set();
  for (const n of (Array.isArray(nodes) ? nodes : [])) {
    if (n && n.type != null && n.type !== '') present.add(String(n.type));
  }
  return [...present].sort((a, b) => typeOrder(a) - typeOrder(b) || a.localeCompare(b));
}

/** Distinct status ids present in the graph, in canonical STATUS_IDS order. */
export function statusesInGraph(nodes) {
  const present = new Set();
  for (const n of (Array.isArray(nodes) ? nodes : [])) {
    if (n && n.status != null && n.status !== '') present.add(String(n.status));
  }
  const known = STATUS_IDS.filter((s) => present.has(s));
  const extra = [...present].filter((s) => !STATUS_BY_ID.has(s)).sort();
  return [...known, ...extra];
}

/* ── spec scope (shared by board + grouping; was board-local) ────────────────*/

/**
 * Resolve the spec a node belongs to, or null. Reads frontmatter `specScope`
 * (stamped on every story/task under specs/SPEC-NNN/) → authored `specId` →
 * the namespaced id prefix. A spec body node resolves to its own id.
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

/** Distinct spec ids present, numerically sorted (drives the spec dropdown). */
export function specsInGraph(nodes) {
  const set = new Set();
  for (const n of (Array.isArray(nodes) ? nodes : [])) {
    const s = specOf(n);
    if (s) set.add(s);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** The sprint ref off a node (frontmatter.sprintId / sprint, else ""). */
export function sprintOf(node) {
  const fm = (node && node.frontmatter) || {};
  return fm.sprintId || fm.sprint || '';
}

/* ── grouping ────────────────────────────────────────────────────────────────
 * A single generic grouping vocabulary used by the Board (and reusable by the
 * List). Every dimension is metadata-driven: it appears only when ≥1 node
 * actually carries that key, and items missing the key land in an explicit
 * "No <dimension>" bucket (never silently dropped). */

const STATUS_COLUMN_ORDER = ['outstanding', 'in-progress', 'blocked', 'done'];

/** Map a raw status onto its board column bucket (addressed folds into done). */
export function statusColumnOf(status) {
  if (status === 'addressed') return 'done';
  return STATUS_COLUMN_ORDER.includes(status) ? status : 'outstanding';
}

/** The frontmatter/derived key a node falls under for a grouping dimension. */
export function groupKeyOf(node, dim) {
  const fm = (node && node.frontmatter) || {};
  switch (dim) {
    case 'status': return statusColumnOf(node && node.status);
    case 'type': return (node && node.type) || 'unknown';
    case 'sprint': return sprintOf(node) || '';
    case 'feature': return (fm.featureId != null ? String(fm.featureId) : '');
    case 'epic': return (fm.epicId != null ? String(fm.epicId) : '');
    case 'spec': return specOf(node) || '';
    default: return (fm[dim] != null ? String(fm[dim]) : '');
  }
}

/** Human label for a grouping dimension (for the Group-by control). */
export function dimensionLabel(dim) {
  switch (dim) {
    case 'status': return 'Status';
    case 'type': return 'Type';
    case 'sprint': return 'Sprint';
    case 'feature': return 'Feature';
    case 'epic': return 'Epic';
    case 'spec': return 'Spec';
    default: return dim ? dim.charAt(0).toUpperCase() + dim.slice(1) : 'Group';
  }
}

/**
 * The grouping dimensions worth offering for a graph: Status + Type always (when
 * there are nodes), plus Sprint/Feature/Epic/Spec when ≥1 node carries that key.
 * @returns {Array<{key:string,label:string}>}
 */
export function groupingDimensions(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const dims = [];
  if (list.length) {
    dims.push({ key: 'status', label: 'Status' });
    dims.push({ key: 'type', label: 'Type' });
  }
  const has = (dim) => list.some((n) => groupKeyOf(n, dim) !== '');
  if (has('sprint')) dims.push({ key: 'sprint', label: 'Sprint' });
  if (has('feature')) dims.push({ key: 'feature', label: 'Feature' });
  if (has('epic')) dims.push({ key: 'epic', label: 'Epic' });
  if (specsInGraph(list).length) dims.push({ key: 'spec', label: 'Spec' });
  return dims;
}

/** Display label for a group bucket key under a dimension. */
export function groupBucketLabel(dim, key) {
  if (key === '' || key == null) return `No ${dimensionLabel(dim).toLowerCase()}`;
  if (dim === 'status') return statusLabel(key);
  if (dim === 'type') return typePlural(key);
  return String(key);
}

/**
 * Group nodes by any dimension into an ORDERED array of buckets. Pure, no DOM.
 *   - status : the four board columns in fixed order (empty kept so the board
 *              always shows all columns); addressed folds into Done.
 *   - type   : one bucket per type present, in registry order.
 *   - other  : named keys sorted (numeric-aware) first, the "No <dim>" bucket last.
 * @returns {Array<{ key:string, label:string, nodes:object[] }>}
 */
export function groupBy(nodes, dim) {
  const list = Array.isArray(nodes) ? nodes : [];

  if (dim === 'status') {
    const buckets = new Map(STATUS_COLUMN_ORDER.map((k) => [k, []]));
    for (const n of list) buckets.get(statusColumnOf(n && n.status)).push(n);
    return STATUS_COLUMN_ORDER.map((k) => ({ key: k, label: statusLabel(k), nodes: buckets.get(k) }));
  }

  const buckets = new Map();
  for (const n of list) {
    const k = groupKeyOf(n, dim);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(n);
  }

  if (dim === 'type') {
    return [...buckets.keys()]
      .sort((a, b) => typeOrder(a) - typeOrder(b) || a.localeCompare(b))
      .map((k) => ({ key: k, label: typePlural(k), nodes: buckets.get(k) }));
  }

  const named = [...buckets.keys()].filter((k) => k !== '')
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const out = named.map((k) => ({ key: k, label: groupBucketLabel(dim, k), nodes: buckets.get(k) }));
  if (buckets.has('')) out.push({ key: '', label: groupBucketLabel(dim, ''), nodes: buckets.get('') });
  return out;
}

/* ── filtering (shared by every browse view) ─────────────────────────────────*/

/**
 * Filter nodes by the rail's Type + Status selection (+ optional search). Pure.
 * @param {Array<object>} nodes
 * @param {{ typeFilter?: string[], statusFilter?: string|null, search?: string }} filter
 *   typeFilter: selected type ids; empty/absent ⇒ all types.
 *   statusFilter: a status id; null/absent ⇒ all statuses.
 *   search: case-insensitive substring over id + title (optional).
 * @param {(node:object)=>string} [displayId] optional id-display fn folded into search
 */
export function filterNodes(nodes, filter, displayId) {
  const list = Array.isArray(nodes) ? nodes : [];
  const f = filter || {};
  const types = Array.isArray(f.typeFilter) ? f.typeFilter : [];
  const status = f.statusFilter == null ? null : f.statusFilter;
  const search = typeof f.search === 'string' ? f.search.trim().toLowerCase() : '';
  return list.filter((n) => {
    if (types.length && !types.includes(n && n.type)) return false;
    if (status != null && (n && n.status) !== status) return false;
    if (search) {
      const disp = typeof displayId === 'function' ? displayId(n) : '';
      const hay = `${(n && n.id) || ''} ${disp} ${(n && n.title) || ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}
