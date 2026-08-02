/**
 * detail.js — Artifact Detail (drill-down) view (SPEC-016 / T-012).
 *
 * design-spec §9 Screen #5 (mockups/05-detail-{desktop,tablet,mobile}.png):
 * a read-only drill-down for a single artifact reached via #detail/:id. Fetches
 * GET /api/node/:id (T-002) and renders:
 *   - a header: type badge · id + parent crumb · H1 title + lede · status badge
 *   - a meta grid: two-column label/value cards for the parent-reference and
 *     descriptive frontmatter fields that are present (created, updated, agent,
 *     specId / storyId / featureId / epicId, sprintId, owner, deps count)
 *   - an Acceptance criteria card: Given/When/Then/And rows parsed from the
 *     body's `## Acceptance Criteria` section, with a "Gherkin" chip + an
 *     optional note linking to a referenced `-gherkin.feature` file
 *   - a subtask checklist card: `- [ ]` / `- [x]` lines from the body rendered
 *     read-only with a checked/unchecked icon and an "n/total" counter
 *   - a footer row: dependsOn chips (links to #detail/:depId) + ship/QA refs
 *
 * The dashboard is READ-ONLY: the checklist checkboxes are non-interactive icons
 * (write-back is PRD M4, out of SPEC-016 scope). Token-only styling — the detail
 * CSS is injected via <style> because ds.css is a Preserve file. No raw hex, no
 * off-grid spacing, no third-party product codenames. Icons are inline outline
 * SVG (design-spec §6) — never emoji.
 *
 * Node shape (lib/dashboard/graph-reader.mjs, includeBody: true):
 *   { id, type, title, status, frontmatter, body }
 *   status ∈ done | in-progress | blocked | outstanding | addressed
 */

import { displayId } from '../display-id.js';
import { typeAccent, typeLabel, typePlural, sprintOf } from '../metadata.js';

/* ── element helper ─────────────────────────────────────────────────── */

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

/**
 * Render a minimal subset of inline markdown (**bold**, `code`) as DOM children.
 * Everything else is emitted as a literal Text node, so untrusted body text can
 * never become markup (no innerHTML). Unclosed markers fall through as literal
 * text. Returns an array of Text / <strong> / <code> nodes.
 * @param {string} text
 * @returns {Node[]}
 */
export function renderInline(text) {
  const src = String(text || '');
  const out = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push(document.createTextNode(src.slice(last, m.index)));
    if (m[1]) out.push(el('code', { class: 'md-code', text: m[1].slice(1, -1) }));
    else out.push(el('strong', { class: 'md-strong', text: m[2].slice(2, -2) }));
    last = re.lastIndex;
  }
  if (last < src.length) out.push(document.createTextNode(src.slice(last)));
  return out;
}

/* ── scoped stylesheet (ds.css is Preserve) ─────────────────────────── */

const STYLE_ID = 'ds-detail-style';
const DETAIL_CSS = `
.detail-header { margin-bottom: var(--space-6); }
.detail-header__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}
.detail-crumb {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--muted-foreground);
}
.detail-crumb__id { font-family: var(--font-mono); font-size: var(--text-xs); }
.detail-crumb__sep { color: var(--border); }
.detail-header__title { margin: var(--space-2) 0 var(--space-1); }
.detail-header__lede { margin: 0; color: var(--muted-foreground); max-width: 64ch; }

/* type + status badges (solid fill + foreground token, AA in both themes) */
.type-badge {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  text-transform: capitalize;
  background: var(--muted);
  color: var(--muted-foreground);
}
/* per-type badge colors mirror the metadata-registry accents (typeAccent):
 * epic/spec=primary, feature/sprint=info, story=success, task/backlog=muted,
 * quick=warning, adr=accent. Unknown/auxiliary types fall through to the
 * neutral .type-badge base (muted) so they still render legibly. */
.type-badge.type-epic    { background: var(--primary); color: var(--primary-foreground); }
.type-badge.type-feature { background: var(--info); color: var(--info-foreground); }
.type-badge.type-story   { background: var(--success); color: var(--success-foreground); }
.type-badge.type-task    { background: var(--muted); color: var(--muted-foreground); }
.type-badge.type-spec    { background: var(--primary); color: var(--primary-foreground); }
.type-badge.type-backlog { background: var(--muted); color: var(--muted-foreground); }
.type-badge.type-quick   { background: var(--warning); color: var(--warning-foreground); }
.type-badge.type-sprint  { background: var(--info); color: var(--info-foreground); }
.type-badge.type-adr     { background: var(--accent); color: var(--accent-foreground); }

.status-badge {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-xl);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  background: var(--muted);
  color: var(--muted-foreground);
  white-space: nowrap;
}
.status-badge.status-done       { background: var(--success); color: var(--success-foreground); }
.status-badge.status-in-progress { background: var(--primary); color: var(--primary-foreground); }
.status-badge.status-blocked    { background: var(--warning); color: var(--warning-foreground); }
.status-badge.status-addressed  { background: var(--info); color: var(--info-foreground); }
.status-badge.status-outstanding { background: var(--muted); color: var(--muted-foreground); }

/* meta grid — two-column cards of label/value pairs */
.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-6);
}
.meta-cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}
.meta-cell__label { font-size: var(--text-xs); color: var(--muted-foreground); }
.meta-cell__value { font-size: var(--text-sm); color: var(--foreground); word-break: break-word; }
.meta-cell__value.tnum { font-family: var(--font-mono); }

/* acceptance criteria card */
.detail-card {
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  margin-bottom: var(--space-6);
}
.detail-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.detail-card__title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  font-weight: var(--weight-semibold);
  color: var(--foreground);
}
.detail-card__count { font-size: var(--text-sm); color: var(--muted-foreground); }
.detail-chip {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--muted);
  color: var(--muted-foreground);
  font-size: var(--text-xs);
}

.gherkin-list { list-style: none; margin: 0; padding: 0; }
.gherkin-row {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-top: 1px solid var(--border);
}
.gherkin-row:first-child { border-top: none; }
.gherkin-row__kw {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--primary);
  font-weight: var(--weight-medium);
}
.gherkin-row__text { font-size: var(--text-sm); color: var(--foreground); }
.gherkin-note { margin: var(--space-3) 0 0; font-size: var(--text-xs); color: var(--muted-foreground); }
.gherkin-note a { color: var(--primary); }

/* subtask checklist */
.subtask-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
.subtask-item { display: flex; align-items: flex-start; gap: var(--space-3); font-size: var(--text-sm); color: var(--foreground); }
.subtask-item__icon { flex: 0 0 auto; margin-top: 1px; color: var(--muted-foreground); }
.subtask-item--checked .subtask-item__icon { color: var(--primary); }
.subtask-item--checked .subtask-item__text { color: var(--muted-foreground); }

/* footer: dependsOn chips + ship/QA refs */
.detail-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-4);
}
.detail-deps { display: inline-flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.detail-deps__label { font-size: var(--text-sm); color: var(--muted-foreground); }
.dep-chip {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  color: var(--foreground);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-decoration: none;
  transition: border-color var(--duration-fast) var(--ease), background var(--duration-fast) var(--ease);
}
.dep-chip:hover { border-color: var(--ring); background: var(--muted); }
.detail-refs { display: inline-flex; align-items: center; flex-wrap: wrap; gap: var(--space-4); font-size: var(--text-sm); }
.detail-ref { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--muted-foreground); }
.detail-ref a { color: var(--primary); text-decoration: none; }
.detail-ref a:hover { text-decoration: underline; }

/* user-story statement (role / goal / benefit) */
.story-stmt__row {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: var(--space-3);
  align-items: baseline;
  margin: 0;
  padding: var(--space-2) 0;
  border-top: 1px solid var(--border);
}
.story-stmt__row:first-of-type { border-top: none; padding-top: 0; }
.story-stmt__kw {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--muted-foreground);
  text-transform: lowercase;
}
.story-stmt__text { font-size: var(--text-base); color: var(--foreground); }

/* inline markdown (rendered safely as DOM, never innerHTML) */
.gherkin-row__text .md-strong,
.story-stmt__text .md-strong { font-weight: var(--weight-semibold); }
.gherkin-row__text .md-code,
.story-stmt__text .md-code {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--muted);
  color: var(--foreground);
}

/* plain (non-Gherkin) criteria: tight bullet, no wide keyword column */
.gherkin-row--plain { grid-template-columns: auto 1fr; }
.gherkin-row--plain .gherkin-row__kw {
  color: var(--muted-foreground);
  font-family: var(--font-sans);
}

/* child relationships (any parent type): linked id · title + status badge */
.childtask-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.childtask-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-top: 1px solid var(--border);
}
.childtask-item:first-child { border-top: none; }
.childtask-link {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-3);
  min-width: 0;
  flex: 1 1 auto;
  text-decoration: none;
  color: var(--foreground);
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast) var(--ease);
}
.childtask-link:hover { color: var(--primary); }
.childtask-id { flex: 0 0 auto; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--muted-foreground); }
.childtask-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* small type dot so a mixed child list (epic → features + stories) reads its
 * relationships at a glance; color is the registry accent (set inline). */
.childtask-dot { flex: 0 0 auto; width: var(--space-2); height: var(--space-2); border-radius: var(--radius-xl); }
.childtask-end { display: inline-flex; align-items: center; gap: var(--space-3); flex: 0 0 auto; }
.childtask-type { font-size: var(--text-xs); color: var(--muted-foreground); }

@container shell (max-width: 767px) {
  .detail-header__top { flex-direction: column; gap: var(--space-3); }
  .gherkin-row { grid-template-columns: 64px 1fr; }
}
@supports not (container-type: inline-size) {
  @media (max-width: 767px) {
    .detail-header__top { flex-direction: column; gap: var(--space-3); }
    .gherkin-row { grid-template-columns: 64px 1fr; }
  }
}
`;

/** Inject the detail stylesheet once. */
function ensureStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = DETAIL_CSS;
  document.head.append(style);
}

/* ── icons (inline outline SVG, currentColor — never emoji) ──────────── */

const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
  + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
  + '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/></svg>';

const BOX_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
  + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
  + '<rect x="3" y="3" width="18" height="18" rx="4"/></svg>';

/* ── data fetch ─────────────────────────────────────────────────────── */

/** Fetch a single node by id; null on 404 / network / parse failure. */
async function fetchNode(id) {
  if (!id || typeof fetch !== 'function') return null;
  try {
    const res = await fetch(`/api/node/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const node = await res.json();
    if (!node || typeof node !== 'object' || !node.id) return null;
    return node;
  } catch {
    return null;
  }
}

/** Fetch the full typed graph (for a story's child tasks); null on failure. */
async function fetchGraph() {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch('/api/graph');
    if (!res.ok) return null;
    const g = await res.json();
    return (g && Array.isArray(g.nodes)) ? g : null;
  } catch {
    return null;
  }
}

/**
 * Task nodes contained by a parent id, via the graph's `contains` edges. Edge
 * from/to use namespaced ids (`SPEC-016/T-004`). Pure: no DOM. Retained for
 * backwards compatibility — `childrenOf` is the general (any-type) form.
 * @param {{nodes:object[],edges:object[]}} graph
 * @param {string} parentId
 * @returns {Array<object>}
 */
export function childTasksOf(graph, parentId) {
  return childrenOf(graph, parentId).filter((n) => n.type === 'task');
}

/**
 * Every child node a parent id `contains`, in graph order, regardless of child
 * type (epic→features/stories, feature→stories/tasks, spec→stories/tasks,
 * story→tasks). Edge from/to use namespaced ids. Pure: no DOM.
 * @param {{nodes:object[],edges:object[]}} graph
 * @param {string} parentId
 * @returns {Array<object>}
 */
export function childrenOf(graph, parentId) {
  if (!graph || !Array.isArray(graph.edges)) return [];
  const byId = new Map((graph.nodes || []).map((n) => [n.id, n]));
  return graph.edges
    .filter((e) => e && e.kind === 'contains' && e.from === parentId)
    .map((e) => byId.get(e.to))
    .filter((n) => n);
}

/**
 * Member nodes of a sprint — every node whose `sprintOf()` resolves to the
 * sprint's local id. Sprints aggregate work by frontmatter ref rather than by
 * `contains` edges, so this complements `childrenOf`. Pure: no DOM.
 * @param {{nodes:object[]}} graph
 * @param {object} sprintNode
 * @returns {Array<object>}
 */
export function sprintMembersOf(graph, sprintNode) {
  if (!graph || !Array.isArray(graph.nodes) || !sprintNode) return [];
  const localId = displayId(sprintNode);
  if (!localId) return [];
  return graph.nodes.filter((n) => {
    if (!n || n.id === sprintNode.id) return false;
    const ref = String(sprintOf(n) || '');
    return ref === localId || ref === String(sprintNode.id);
  });
}

/* ── body parsing (pure) ────────────────────────────────────────────── */

const GHERKIN_KEYWORDS = ['Given', 'When', 'Then', 'And', 'But', 'Scenario', 'Feature'];

/**
 * Parse the `## Acceptance Criteria` section of a markdown body into rows.
 * A row is { keyword, text } — when a line starts with a Gherkin keyword it is
 * split into keyword + remainder; otherwise it is a plain criterion line.
 * @returns {Array<{keyword: string|null, text: string}>}
 */
export function parseAcceptanceCriteria(body) {
  const text = String(body || '');
  const lines = text.split('\n');
  const rows = [];
  let inSection = false;
  for (const line of lines) {
    const heading = line.match(/^#{2,6}\s+(.*)$/);
    if (heading) {
      inSection = /acceptance criteria/i.test(heading[1]);
      continue;
    }
    if (!inSection) continue;
    const raw = line.replace(/^[-*+]\s+/, '').trim();
    if (raw === '') continue;
    // Detect a Gherkin keyword on an emphasis-stripped COPY, but keep `raw`
    // (markers intact) as the row text so renderInline can format **bold** / `code`.
    const probe = raw.replace(/^[*_`]+|[*_`]+$/g, '').trim();
    const first = probe.split(/\s+/)[0];
    if (GHERKIN_KEYWORDS.includes(first)) {
      const after = raw.replace(/^[*_`]*\s*/, '').slice(first.length).trim();
      rows.push({ keyword: first, text: after });
    } else {
      rows.push({ keyword: null, text: raw });
    }
  }
  return rows;
}

/**
 * Parse `- [ ]` / `- [x]` checklist lines from a markdown body.
 * @returns {Array<{checked: boolean, text: string}>}
 */
export function parseSubtasks(body) {
  const text = String(body || '');
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (!m) continue;
    out.push({ checked: m[1].toLowerCase() === 'x', text: m[2].trim() });
  }
  return out;
}

// User-story statement markers: `**As a** … / **I want** … / **so that** …`.
const STORY_MARKERS = [
  ['role', /^\s*\*{0,2}As an?\*{0,2}[\s:]+/i],
  ['goal', /^\s*\*{0,2}I want(?: to)?\*{0,2}[\s:]+/i],
  ['benefit', /^\s*\*{0,2}so that\*{0,2}[\s:]+/i],
];
// Un-double a keyword the author repeated after the bold marker ("As a As a …").
const STORY_REDUNDANT = {
  role: /^as an? /i,
  goal: /^i want(?: to)? /i,
  benefit: /^so that /i,
};

/**
 * Parse a story body's role/goal/benefit statement (the `**As a** / **I want** /
 * **so that**` lines between the H1 and the first `##` section). Tolerant of the
 * doubled-keyword shape (`**As a** As a maintainer…`) and a missing `**I want**`
 * line. Pure: no DOM, stdlib only.
 * @param {string} body
 * @returns {{role:string, goal:string, benefit:string}|null}
 */
export function parseStoryStatement(body) {
  const lines = String(body || '').split('\n');
  const out = { role: '', goal: '', benefit: '' };
  for (const line of lines) {
    for (const [field, re] of STORY_MARKERS) {
      const m = line.match(re);
      if (!m) continue;
      let rest = line.slice(m[0].length).trim();
      rest = rest.replace(STORY_REDUNDANT[field], '').trim();
      rest = rest.replace(/[\s,;—–-]+$/, '').trim();
      if (rest && !out[field]) out[field] = rest;
      break;
    }
  }
  return (out.role && (out.goal || out.benefit)) ? out : null;
}

/**
 * Parse the plain criteria lines from a body's `## Acceptance Criteria` section.
 * Each `- (AC…)` or plain `- ` bullet becomes one string entry (markdown bullet
 * marker stripped, surrounding whitespace trimmed). Lines that are themselves
 * checklist items (`- [ ]` / `- [x]`) are excluded — those are subtasks. Returns
 * `[]` when there is no Acceptance Criteria section. Pure: no DOM, stdlib only.
 * @returns {string[]}
 */
export function parseCriteriaLines(body) {
  const lines = String(body || '').split('\n');
  const out = [];
  let inSection = false;
  for (const line of lines) {
    const heading = line.match(/^#{2,6}\s+(.*)$/);
    if (heading) {
      inSection = /acceptance criteria/i.test(heading[1]);
      continue;
    }
    if (!inSection) continue;
    // Skip checklist subtask lines — those belong to `subtasks`, not criteria.
    if (/^\s*[-*+]\s+\[[ xX]\]/.test(line)) continue;
    const m = line.match(/^\s*[-*+]\s+(.*)$/);
    if (!m) continue;
    const text = m[1].trim();
    if (text === '') continue;
    out.push(text);
  }
  return out;
}

/* ── detail payload assembly (pure, no DOM) ─────────────────────────── */

// Frontmatter keys promoted onto the header — never duplicated into `meta`.
const HEADER_KEYS = new Set(['id', 'title', 'type', 'status', 'body']);

/**
 * Assemble the structured payload the Detail view renders from a raw `Node`
 * returned by `GET /api/node/:id` (T-002). Pure: no DOM, no fetch, stdlib only.
 *
 * Parsing rules (per T-013 spec):
 *   - `header`   — { id, title, type, status } hoisted from the node
 *   - `meta`     — every frontmatter field except id/title/type/status/body,
 *                  stringified for display (arrays joined, objects JSON-encoded)
 *   - `criteria` — plain lines from the body's `## Acceptance Criteria` section
 *   - `subtasks` — `- [ ]` / `- [x]` lines as { text, done }
 *   - `depIds`   — `frontmatter.dependsOn ?? []`
 *   - `shipRef` / `qaRef` — from frontmatter when present (else omitted)
 *
 * @param {{id?:string,title?:string,type?:string,status?:string,frontmatter?:object,body?:string}} node
 * @returns {{
 *   header: { id: string, title: string, type: string, status: string },
 *   meta: Record<string, string>,
 *   criteria: string[],
 *   subtasks: Array<{ text: string, done: boolean }>,
 *   depIds: string[],
 *   shipRef?: string,
 *   qaRef?: string
 * }}
 */
export function assembleDetail(node) {
  const n = node && typeof node === 'object' ? node : {};
  const fm = n.frontmatter && typeof n.frontmatter === 'object' ? n.frontmatter : {};

  const header = {
    id: n.id != null ? String(n.id) : '',
    title: n.title != null ? String(n.title) : '',
    type: n.type != null ? String(n.type) : '',
    status: n.status != null ? String(n.status) : '',
  };

  // meta: all frontmatter except header keys, stringified for display.
  const meta = {};
  for (const [key, value] of Object.entries(fm)) {
    if (HEADER_KEYS.has(key)) continue;
    if (value == null) continue;
    meta[key] = stringifyMeta(value);
  }

  const criteria = parseCriteriaLines(n.body);
  const subtasks = parseSubtasks(n.body).map((s) => ({ text: s.text, done: s.checked }));
  const depIds = Array.isArray(fm.dependsOn) ? fm.dependsOn.map((d) => String(d)) : [];

  const out = { header, meta, criteria, subtasks, depIds };
  if (fm.shipRef != null && fm.shipRef !== '') out.shipRef = String(fm.shipRef);
  if (fm.qaRef != null && fm.qaRef !== '') out.qaRef = String(fm.qaRef);
  return out;
}

/** Stringify a frontmatter value for the meta grid (arrays join, objects JSON). */
function stringifyMeta(value) {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

/* ── meta-grid assembly ─────────────────────────────────────────────── */

// Descriptive + parent-reference frontmatter fields shown in the meta grid,
// in display order. Only fields present on the node are rendered.
const META_FIELDS = [
  ['type', 'Type'],
  ['sprintId', 'Sprint'],
  ['specId', 'Spec'],
  ['epicId', 'Epic'],
  ['featureId', 'Feature'],
  ['storyId', 'Story'],
  ['agent', 'Agent'],
  ['owner', 'Owner'],
  ['created', 'Created'],
  ['updated', 'Updated'],
];

// Mono-rendered values (ids / dates).
const MONO_FIELDS = new Set(['sprintId', 'specId', 'epicId', 'featureId', 'storyId', 'created', 'updated']);

// Frontmatter keys already surfaced elsewhere (promoted META_FIELDS, the header
// lede, the deps cell, the footer refs) — excluded from the generic "remaining
// frontmatter" pass so auxiliary fields (priority / estimate / sprint dates …)
// appear exactly once and a QT/BL/sprint node is never a dead-end.
const META_HANDLED = new Set([
  ...HEADER_KEYS,
  ...META_FIELDS.map(([k]) => k),
  'dependsOn', 'shipRef', 'qaRef',
  'rationale', 'description', 'goal',
  'specScope', 'gherkin',
]);

// Date-ish auxiliary keys rendered with the mono (tabular-number) treatment.
const MONO_AUX = new Set(['startDate', 'endDate', 'dueDate', 'date', 'startedAt', 'completedAt']);

/** Human label for an arbitrary frontmatter key (camelCase → "Title Case"). */
function humanizeKey(key) {
  const s = String(key || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim();
  if (!s) return 'Field';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Whether a frontmatter value is present (non-empty). */
function present(v) {
  return v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
}

/**
 * Resolve a frontmatter reference (e.g. a `dependsOn` value) to a routable node id.
 * Node ids are namespaced per spec (`SPEC-016/T-004`) but `dependsOn` lists hold
 * LOCAL ids (`T-004`), so a bare ref is prefixed with the current node's scope (the
 * part of its id before the last `/`). Already-namespaced refs pass through.
 * @param {{id?:string}} node the node the ref belongs to
 * @param {string} ref the raw reference value
 * @returns {string} a node id usable in `#detail/<id>` and `/api/node/<id>`
 */
function scopedRef(node, ref) {
  const r = String(ref);
  if (r.includes('/')) return r;
  const fullId = node && node.id != null ? String(node.id) : '';
  const slash = fullId.lastIndexOf('/');
  const scope = slash > 0 ? fullId.slice(0, slash) : '';
  return scope ? `${scope}/${r}` : r;
}

/** One label/value meta cell. `mono` applies the tabular-number treatment. */
function metaCell(label, value, mono) {
  return el('div', { class: 'meta-cell' }, [
    el('div', { class: 'meta-cell__label', text: label }),
    el('div', { class: `meta-cell__value${mono ? ' tnum' : ''}`, text: value }),
  ]);
}

/** Build the meta grid from the node's type + frontmatter. */
function metaGrid(node) {
  const fm = node.frontmatter || {};
  const cells = [];
  for (const [key, label] of META_FIELDS) {
    const value = key === 'type' ? node.type : fm[key];
    if (!present(value)) continue;
    // The Type value uses the registry's canonical label (so quick → "Quick",
    // adr → "ADR") rather than a naive first-letter capitalize.
    const display = key === 'type' ? typeLabel(String(value)) : String(value);
    cells.push(metaCell(label, display, MONO_FIELDS.has(key)));
  }

  // Generic "remaining frontmatter" pass: every present field not already
  // surfaced (promoted, lede, deps, footer refs) gets a cell, in frontmatter
  // order. This keeps auxiliary types coherent — opening a quick/backlog node
  // shows its priority/estimate, a sprint shows its dates — never a dead-end.
  for (const [key, value] of Object.entries(fm)) {
    if (META_HANDLED.has(key)) continue;
    if (!present(value)) continue;
    cells.push(metaCell(humanizeKey(key), stringifyMeta(value), MONO_AUX.has(key)));
  }

  // Always show a "Depends on" cell so the grid mirrors the comp.
  const deps = Array.isArray(fm.dependsOn) ? fm.dependsOn : [];
  cells.push(el('div', { class: 'meta-cell' }, [
    el('div', { class: 'meta-cell__label', text: 'Depends on' }),
    el('div', {
      class: 'meta-cell__value tnum',
      text: deps.length ? deps.join(' · ') : 'none',
    }),
  ]));
  return el('div', { class: 'meta-grid' }, cells);
}

/* ── section builders ───────────────────────────────────────────────── */

/** The header: type badge · crumb · title · lede · status badge. */
function headerSection(node) {
  const fm = node.frontmatter || {};
  const type = node.type || 'task';
  const status = node.status || 'outstanding';

  // The badge label is the registry's canonical singular (typeLabel); the
  // per-type CSS class drives its accent, with an inline accent fallback so an
  // unknown/auxiliary type still reads as a colored chip rather than vanishing.
  const known = type === 'epic' || type === 'feature' || type === 'story'
    || type === 'task' || type === 'spec' || type === 'backlog'
    || type === 'quick' || type === 'sprint' || type === 'adr';
  const crumb = el('div', { class: 'detail-crumb' }, [
    el('span', {
      class: `type-badge type-${type}`,
      text: typeLabel(type),
      attrs: known ? {} : { style: `background: ${typeAccent(type)}; color: var(--primary-foreground);` },
    }),
    el('span', { class: 'detail-crumb__id', text: displayId(node) }),
  ]);
  // append the parent reference (spec/story/feature/epic) to the crumb if present
  const parentKey = ['specId', 'storyId', 'featureId', 'epicId'].find((k) => present(fm[k]));
  if (parentKey) {
    crumb.append(
      el('span', { class: 'detail-crumb__sep', text: '·' }),
      el('span', { class: 'detail-crumb__id', text: String(fm[parentKey]) }),
    );
  }

  const titleLine = el('div', { class: 'detail-header__top' }, [
    el('div', {}, [
      el('h1', { class: 'ds-h1 detail-header__title', text: node.title || displayId(node) }),
    ]),
    el('span', { class: `status-badge status-${status}`, text: status.replace('-', ' ') }),
  ]);

  const lede = present(fm.rationale) ? String(fm.rationale)
    : present(fm.description) ? String(fm.description)
      : present(fm.goal) ? String(fm.goal) : '';

  const children = [crumb, titleLine];
  if (lede) children.push(el('p', { class: 'detail-header__lede', text: lede }));
  return el('header', { class: 'detail-header' }, children);
}

/** The Acceptance criteria card (Gherkin rows + optional feature-file note). */
function criteriaSection(node) {
  const rows = parseAcceptanceCriteria(node.body);
  const fm = node.frontmatter || {};
  if (!rows.length && !present(fm.gherkin)) return null;

  const list = el('ul', { class: 'gherkin-list' });
  for (const row of rows) {
    const isKw = !!row.keyword;
    list.append(el('li', { class: `gherkin-row${isKw ? '' : ' gherkin-row--plain'}` }, [
      el('span', { class: 'gherkin-row__kw', text: row.keyword || '•' }),
      el('span', { class: 'gherkin-row__text' }, renderInline(row.text)),
    ]));
  }

  const head = el('div', { class: 'detail-card__head' }, [
    el('span', { class: 'detail-card__title' }, [
      el('span', { text: 'Acceptance criteria' }),
      el('span', { class: 'detail-chip', text: 'Gherkin' }),
    ]),
  ]);

  const children = [head, list];
  // If the frontmatter references a -gherkin.feature file, note it. Match on the
  // local (display) id so namespaced ids like "SPEC-016/US-001" still resolve.
  const localId = displayId(node);
  const featureRef = present(fm.gherkin) ? String(fm.gherkin)
    : (/^US-/.test(localId) ? `${localId}-gherkin.feature` : null);
  if (featureRef && rows.length) {
    children.push(el('p', { class: 'gherkin-note' }, [
      el('span', { text: 'Full scenarios: ' }),
      el('span', { text: featureRef }),
    ]));
  }
  return el('section', { class: 'detail-card' }, children);
}

/** The subtask checklist card (read-only icons + n/total counter). */
function checklistSection(node) {
  const subtasks = parseSubtasks(node.body);
  if (!subtasks.length) return null;
  const done = subtasks.filter((s) => s.checked).length;

  const list = el('ul', { class: 'subtask-list' });
  for (const s of subtasks) {
    list.append(el('li', {
      class: `subtask-item${s.checked ? ' subtask-item--checked' : ''}`,
      attrs: { 'aria-checked': s.checked ? 'true' : 'false', role: 'checkbox' },
    }, [
      el('span', { class: 'subtask-item__icon', html: s.checked ? CHECK_ICON : BOX_ICON }),
      el('span', { class: 'subtask-item__text', text: s.text }),
    ]));
  }

  const title = `${displayId(node)} · subtasks`;
  return el('section', { class: 'detail-card' }, [
    el('div', { class: 'detail-card__head' }, [
      el('span', { class: 'detail-card__title', text: title }),
      el('span', { class: 'detail-card__count tnum', text: `${done} / ${subtasks.length}` }),
    ]),
    list,
  ]);
}

/** The user-story statement card (role / goal / benefit). Story-only. */
function storyStatementSection(node) {
  if ((node.type || '') !== 'story') return null;
  const s = parseStoryStatement(node.body);
  if (!s) return null;
  const row = (kw, val) => (val ? el('p', { class: 'story-stmt__row' }, [
    el('span', { class: 'story-stmt__kw', text: kw }),
    el('span', { class: 'story-stmt__text' }, renderInline(val)),
  ]) : null);
  return el('section', { class: 'detail-card story-stmt' }, [
    el('div', { class: 'detail-card__head' }, [
      el('span', { class: 'detail-card__title', text: 'User story' }),
    ]),
    row('As a', s.role),
    row('I want', s.goal),
    row('so that', s.benefit),
  ]);
}

/**
 * Resolve a parent node's child nodes + a card heading, for ANY parent type:
 *   - sprint → members (every node whose sprintOf() points at this sprint)
 *   - everything else → nodes it `contains` (epic→features/stories,
 *     feature→stories/tasks, spec→stories/tasks, story→tasks, …)
 * The heading names the dominant child type when the children are uniform
 * (e.g. "Tasks"), else a neutral "Contains" / "Sprint work". Pure: no DOM.
 * @returns {{ kids: object[], heading: string }}
 */
function resolveChildren(node, graph) {
  const type = node.type || '';
  if (type === 'sprint') {
    return { kids: sprintMembersOf(graph, node), heading: 'Sprint work' };
  }
  const kids = childrenOf(graph, node.id);
  const childTypes = new Set(kids.map((k) => k.type).filter(Boolean));
  const heading = childTypes.size === 1
    ? typePlural([...childTypes][0])
    : 'Contains';
  return { kids, heading };
}

/**
 * The child-relationships card (any parent type): each child rendered as a
 * linked id · title with a type dot + status badge, plus an n/total done
 * counter. Returns null only when the parent genuinely has no children — never
 * silently drops a present child of an unexpected type.
 */
function childrenSection(node, graph) {
  const { kids, heading } = resolveChildren(node, graph);
  if (!kids.length) return null;
  const done = kids.filter((k) => k.status === 'done' || k.status === 'addressed').length;
  const list = el('ul', { class: 'childtask-list' });
  for (const k of kids) {
    const st = k.status || 'outstanding';
    const kType = k.type || '';
    list.append(el('li', { class: 'childtask-item' }, [
      el('a', { class: 'childtask-link', attrs: { href: `#detail/${k.id}` } }, [
        el('span', {
          class: 'childtask-dot',
          attrs: { style: `background: ${typeAccent(kType)};`, title: typeLabel(kType) },
        }),
        el('span', { class: 'childtask-id', text: displayId(k) }),
        el('span', { class: 'childtask-title', text: k.title || displayId(k) }),
      ]),
      el('span', { class: 'childtask-end' }, [
        el('span', { class: 'childtask-type', text: typeLabel(kType) }),
        el('span', { class: `status-badge status-${st}`, text: st.replace('-', ' ') }),
      ]),
    ]));
  }
  return el('section', { class: 'detail-card' }, [
    el('div', { class: 'detail-card__head' }, [
      el('span', { class: 'detail-card__title', text: heading }),
      el('span', { class: 'detail-card__count tnum', text: `${done} / ${kids.length}` }),
    ]),
    list,
  ]);
}

/** The footer: dependsOn chips + ship/QA refs. */
function footerSection(node) {
  const fm = node.frontmatter || {};
  const deps = Array.isArray(fm.dependsOn) ? fm.dependsOn.filter(present) : [];

  const depsRow = el('div', { class: 'detail-deps' }, [
    el('span', { class: 'detail-deps__label', text: 'Depends on' }),
  ]);
  if (deps.length) {
    for (const dep of deps) {
      depsRow.append(el('a', {
        class: 'dep-chip',
        text: String(dep),
        attrs: { href: `#detail/${scopedRef(node, dep)}` },
      }));
    }
  } else {
    depsRow.append(el('span', { class: 'detail-chip', text: 'no blockers' }));
  }

  const refs = el('div', { class: 'detail-refs' });
  if (present(fm.shipRef)) {
    refs.append(el('span', { class: 'detail-ref' }, [
      el('span', { text: 'Ship:' }),
      el('a', { text: String(fm.shipRef), attrs: { href: String(fm.shipRef) } }),
    ]));
  }
  if (present(fm.qaRef)) {
    refs.append(el('span', { class: 'detail-ref' }, [
      el('span', { text: 'QA:' }),
      el('a', { text: String(fm.qaRef), attrs: { href: String(fm.qaRef) } }),
    ]));
  }
  if (!refs.childElementCount) {
    refs.append(el('span', { class: 'detail-ref', text: 'QA fidelity gate: pending' }));
  }

  return el('footer', { class: 'detail-foot' }, [depsRow, refs]);
}

/* ── mount ──────────────────────────────────────────────────────────── */

// Types that can own children (so they need the full graph to resolve them).
// Leaf types (task / backlog / quick / adr) skip the graph fetch entirely.
const PARENT_TYPES = new Set(['epic', 'feature', 'spec', 'story', 'sprint']);

/**
 * Obtain the typed graph for resolving a parent's children. Prefer the live
 * SSE-merged graph the shell keeps fresh on window.__dashboard.graph (no extra
 * request, stays current) and fall back to a one-shot fetch. Returns null when
 * neither is available.
 * @returns {Promise<{nodes:object[],edges:object[]}|null>}
 */
async function loadGraph() {
  const live = (typeof window !== 'undefined' && window.__dashboard && window.__dashboard.graph) || null;
  if (live && Array.isArray(live.nodes) && live.nodes.length) return live;
  return fetchGraph();
}

/**
 * Mount the Detail view into `el`.
 * @param {HTMLElement} el2 content mount element
 * @param {{ id?: string }} [params] route params (the artifact id)
 */
export async function mount(el2, params = {}) {
  if (!el2) return;
  ensureStyle();
  const id = params && params.id;

  el2.innerHTML = '';
  if (!id) {
    el2.append(el('p', { class: 'ds-note', text: 'No artifact selected.' }));
    return;
  }
  el2.append(el('p', { class: 'ds-note', text: 'Loading artifact…' }));

  const node = await fetchNode(id);
  // Any parent type (epic/feature/spec/story/sprint) needs the full graph to
  // resolve its children; leaf types keep their single-fetch cost.
  const graph = node && PARENT_TYPES.has(node.type) ? await loadGraph() : null;
  el2.innerHTML = '';

  if (!node) {
    el2.append(el('p', { class: 'ds-note', text: `Artifact “${id}” was not found.` }));
    return;
  }

  // Section assembly is type-aware but never leaves a null body: stories add the
  // user-story statement; any parent adds its child-relationships card; every
  // node always gets header + meta grid + footer, so opening a quick/backlog/
  // sprint/adr node is a coherent page rather than a dead-end.
  el2.append(
    headerSection(node),
    storyStatementSection(node),
    metaGrid(node),
    criteriaSection(node),
    childrenSection(node, graph),
    checklistSection(node),
    footerSection(node),
  );
}
