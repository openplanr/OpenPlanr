/**
 * display-id.js — human-facing id resolver (SPEC-016 follow-up).
 *
 * After the graph reader began namespacing node ids for cross-spec uniqueness
 * (e.g. `node.id` = "SPEC-016/US-001"), the raw `node.id` is the wrong thing to
 * SHOW the user. It stays the unique key — used for selection, edge matching,
 * `#detail/:id` routing, and `GET /api/node/:id` — but every place that renders
 * an id to a human should call displayId() so cards / rows / graph labels /
 * inspector / search read "US-001", not "SPEC-016/US-001".
 *
 * Resolution order (per the backend contract):
 *   1. node.frontmatter.id — the authored, human id
 *   2. the last `/`-segment of node.id — strips the namespace prefix
 *   3. node.id — last-resort fallback so we never render empty
 *
 * Pure, no DOM, zero dependencies. Tolerant of a raw id string as well as a
 * node object, so SSE-derived feeds (which only carry a namespaced id string)
 * can reuse the namespace-stripping logic.
 */

/** Strip a namespace prefix from an id string: "SPEC-016/US-001" → "US-001". */
function lastSegment(id) {
  const s = String(id == null ? '' : id);
  const cut = s.lastIndexOf('/');
  return cut >= 0 ? s.slice(cut + 1) : s;
}

/**
 * Resolve the human-facing id to display for a node (or a raw id string).
 *
 * @param {{id?: string, frontmatter?: {id?: string}} | string | null | undefined} node
 *   a graph node, or a raw (possibly-namespaced) id string
 * @returns {string} the local id to display (never the namespaced form)
 */
export function displayId(node) {
  if (node == null) return '';
  if (typeof node === 'string') return lastSegment(node);
  const fm = node.frontmatter;
  if (fm && fm.id != null && fm.id !== '') return String(fm.id);
  if (node.id != null && node.id !== '') return lastSegment(node.id);
  return '';
}

export { lastSegment };
