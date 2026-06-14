/**
 * search.js — ⌘K command palette (SPEC-016 / T-010 UI + T-011 logic).
 *
 * design-spec §9 Screen #8 (mockups/08-search-{desktop,tablet,mobile}.png):
 * a command-palette overlay — scrim + auto-focused input + a results list with
 * id, title, type badge, and an "open" hint. Fuzzy-matches over the project
 * graph and jumps to `#detail/${id}` on Enter. Keyboard: ArrowUp/ArrowDown move
 * the active result, Enter opens it, Escape closes the overlay.
 *
 * UI layer (T-010): open() / close() + overlay rendering + key handling.
 * Data layer (T-011): pure buildIndex() / query() + the KeyNavState machine,
 * exported below — no DOM, unit-testable. Both live in this one file per the
 * task contract. The index is a character-trigram index (stdlib only, zero npm
 * deps).
 *
 * Token-only styling (ds.css tokens; overlay extras injected via <style> since
 * ds.css is a Preserve file). No raw hex, no off-grid spacing, no third-party
 * product codenames. Icons are inline outline SVG (design-spec §6) — never emoji.
 *
 * Node shape (schemas/v1.0.0/graph.schema.json):
 *   { id, type, title, status, frontmatter }
 */

import { displayId } from '../display-id.js';

/* ── data layer (T-011) — pure, no DOM ──────────────────────────────── */

const MAX_RESULTS = 20;

/** Normalize text for indexing/querying: lowercase, collapse whitespace. */
function normalize(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Character trigrams of a normalized string (padded so short terms still hit). */
function trigrams(s) {
  const text = normalize(s);
  if (!text) return [];
  if (text.length < 3) return [text];
  const out = [];
  for (let i = 0; i <= text.length - 3; i++) out.push(text.slice(i, i + 3));
  return out;
}

/**
 * Build a fuzzy search index over node id + title. Pure: no DOM.
 * @param {Array<object>} nodes
 * @returns {{ map: Object<string, Set<string>>, byId: Map<string, object>, nodes: Array<object> }}
 *   `map` maps each trigram to a Set of node ids; `byId` resolves ids back to
 *   nodes; `nodes` is the source list (for result assembly).
 */
export function buildIndex(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const map = Object.create(null);
  const byId = new Map();
  for (const n of list) {
    if (!n || n.id == null) continue;
    byId.set(n.id, n);
    const grams = new Set([...trigrams(n.id), ...trigrams(n.title)]);
    for (const g of grams) {
      if (!map[g]) map[g] = new Set();
      map[g].add(n.id);
    }
  }
  return { map, byId, nodes: list };
}

/**
 * Query a built index. Pure: no DOM. Computes the query trigrams, scores each
 * candidate node by how many query trigrams it contains, and returns the
 * highest-scoring nodes (at most MAX_RESULTS), score descending. A direct
 * substring match on id/title is boosted so e.g. "US-00" surfaces US-0xx ids.
 * @param {ReturnType<typeof buildIndex>} index
 * @param {string} term
 * @returns {Array<object>}
 */
export function query(index, term) {
  if (!index || !index.map) return [];
  const t = normalize(term);
  if (!t) return [];
  const grams = trigrams(t);
  const score = new Map();
  for (const g of grams) {
    const ids = index.map[g];
    if (!ids) continue;
    for (const id of ids) score.set(id, (score.get(id) || 0) + 1);
  }
  // substring boost — keeps exact prefix matches (ids) ahead of fuzzy noise.
  for (const n of index.nodes) {
    if (!n || n.id == null) continue;
    const hay = `${normalize(n.id)} ${normalize(n.title)}`;
    if (hay.includes(t)) score.set(n.id, (score.get(n.id) || 0) + grams.length + 1);
  }
  return [...score.entries()]
    .sort((a, b) => (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])))
    .slice(0, MAX_RESULTS)
    .map(([id]) => index.byId.get(id))
    .filter(Boolean);
}

/**
 * Keyboard-navigation state machine for the results list. Pure: no DOM.
 * Cursor starts at -1 (nothing active). moveDown/moveUp are clamped to the
 * list bounds and return `this` for chaining.
 * @param {Array<object>} items
 */
export function KeyNavState(items) {
  return {
    items: Array.isArray(items) ? items.slice() : [],
    activeIdx: -1,
    moveDown() {
      if (this.activeIdx < this.items.length - 1) this.activeIdx += 1;
      return this;
    },
    moveUp() {
      if (this.activeIdx > 0) this.activeIdx -= 1;
      return this;
    },
    getActive() {
      return this.activeIdx >= 0 && this.activeIdx < this.items.length
        ? this.items[this.activeIdx]
        : null;
    },
    reset(newItems) {
      this.items = Array.isArray(newItems) ? newItems.slice() : [];
      this.activeIdx = -1;
      return this;
    },
  };
}

/* ── UI layer (T-010) ───────────────────────────────────────────────── */

const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
  + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
  + '<circle cx="11" cy="11" r="6"/><path d="m20 20-3.2-3.2"/></svg>';

const ENTER_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" '
  + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M9 10 5 14l4 4"/><path d="M5 14h10a4 4 0 0 0 4-4V6"/></svg>';

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

/** Token-scoped overlay CSS, injected once (ds.css is a Preserve file). */
const STYLE_ID = 'ds-search-style';
const SEARCH_CSS = `
.search-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-16) var(--space-4) var(--space-4);
}
.search-scrim {
  position: absolute;
  inset: 0;
  background: var(--foreground);
  opacity: .45;
}
.search-panel {
  position: relative;
  width: 100%;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.search-inputrow {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: 1px solid var(--border);
}
.search-inputrow__icon { flex: 0 0 auto; color: var(--muted-foreground); display: grid; place-items: center; }
.search-input {
  flex: 1 1 auto;
  border: none;
  outline: none;
  background: transparent;
  color: var(--foreground);
  font: inherit;
  font-size: var(--text-lg);
}
.search-input::placeholder { color: var(--muted-foreground); }
.search-results {
  list-style: none;
  margin: 0;
  padding: var(--space-2);
  max-height: 50vh;
  overflow-y: auto;
}
.search-result {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.search-result:hover { background: var(--muted); }
.search-result.active { background: var(--accent); }
.dark .search-result.active { background: var(--accent); }
.search-result__id {
  flex: 0 0 auto;
  min-width: var(--space-16);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--muted-foreground);
}
.search-result__title {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.search-result__type {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--muted-foreground);
  text-transform: capitalize;
}
.search-result__hint {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--muted-foreground);
}
.search-empty { padding: var(--space-6); text-align: center; color: var(--muted-foreground); }
.search-foot {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border);
  font-size: var(--text-xs);
  color: var(--muted-foreground);
}
.search-foot__hint { display: inline-flex; align-items: center; gap: var(--space-1); }
.search-foot kbd {
  padding: 0 var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
@container shell (max-width: 767px) {
  .search-overlay { padding: var(--space-8) var(--space-3) var(--space-3); }
}
@supports not (container-type: inline-size) {
  @media (max-width: 767px) {
    .search-overlay { padding: var(--space-8) var(--space-3) var(--space-3); }
  }
}
`;

/** Inject the overlay stylesheet once. */
function ensureStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = SEARCH_CSS;
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

const OVERLAY_ID = 'ds-search-overlay';

/** Module-scoped open-state so open()/close() coordinate without re-querying. */
let state = null;

/** Render the result `<li>` items for the current nav state. */
function renderResults(listEl, nav) {
  listEl.innerHTML = '';
  if (!nav.items.length) {
    listEl.append(el('li', { class: 'search-empty', text: 'No matches.' }));
    return;
  }
  nav.items.forEach((node, idx) => {
    const li = el('li', {
      class: `search-result${idx === nav.activeIdx ? ' active' : ''}`,
      attrs: { 'data-id': node.id, role: 'option', 'aria-selected': idx === nav.activeIdx ? 'true' : 'false' },
    }, [
      el('span', { class: 'search-result__id', text: displayId(node) }),
      el('span', { class: 'search-result__title', text: node.title || displayId(node) }),
      el('span', { class: 'search-result__type', text: node.type || '' }),
      el('span', { class: 'search-result__hint' }, [
        el('span', { html: ENTER_ICON }),
        el('span', { text: 'open' }),
      ]),
    ]);
    li.addEventListener('mousemove', () => {
      if (nav.activeIdx === idx) return;
      nav.activeIdx = idx;
      paintActive(listEl, nav);
    });
    li.addEventListener('click', () => { navigateTo(node); });
    listEl.append(li);
  });
}

/** Update only the `.active` class + aria-selected without a full re-render. */
function paintActive(listEl, nav) {
  const items = listEl.querySelectorAll('.search-result');
  items.forEach((node, idx) => {
    const on = idx === nav.activeIdx;
    node.classList.toggle('active', on);
    node.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  });
}

/** Navigate to a node's detail view and close the overlay. */
function navigateTo(node) {
  if (!node || node.id == null) return;
  location.hash = `#detail/${node.id}`;
  close();
}

/** Window-level key handler for the overlay (arrow nav / enter / escape). */
function onKeydown(e) {
  if (!state) return;
  const { nav, listEl } = state;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    nav.moveDown();
    paintActive(listEl, nav);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    nav.moveUp();
    paintActive(listEl, nav);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const active = nav.getActive() || nav.items[0];
    if (active) navigateTo(active);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
}

/**
 * Open the command-palette overlay. Renders the scrim + auto-focused input +
 * results list, builds the fuzzy index from GET /api/graph, and wires keyboard
 * navigation. Idempotent — calling open() while open just re-focuses the input.
 */
export async function open() {
  if (typeof document === 'undefined') return;
  ensureStyle();

  if (document.getElementById(OVERLAY_ID)) {
    const input = document.querySelector(`#${OVERLAY_ID} .search-input`);
    if (input) input.focus();
    return;
  }

  const graph = await fetchGraph();
  const index = buildIndex(graph.nodes);
  const nav = KeyNavState([]);

  const input = el('input', {
    class: 'search-input',
    attrs: {
      type: 'text',
      placeholder: 'Search specs, stories, tasks…',
      'aria-label': 'Search',
      autocomplete: 'off',
      spellcheck: 'false',
    },
  });

  const listEl = el('ul', { class: 'search-results', attrs: { role: 'listbox', 'aria-label': 'Search results' } });

  const scrim = el('div', { class: 'search-scrim', attrs: { 'aria-hidden': 'true' } });
  scrim.addEventListener('click', () => close());

  const panel = el('div', { class: 'search-panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' } }, [
    el('div', { class: 'search-inputrow' }, [
      el('span', { class: 'search-inputrow__icon', html: SEARCH_ICON }),
      input,
    ]),
    listEl,
    el('div', { class: 'search-foot' }, [
      el('span', { class: 'search-foot__hint' }, [el('kbd', { text: '↑↓' }), el('span', { text: 'navigate' })]),
      el('span', { class: 'search-foot__hint' }, [el('kbd', { text: '↵' }), el('span', { text: 'open' })]),
      el('span', { class: 'search-foot__hint' }, [el('kbd', { text: 'esc' }), el('span', { text: 'close' })]),
    ]),
  ]);

  const overlay = el('div', { class: 'search-overlay', attrs: { id: OVERLAY_ID } }, [scrim, panel]);

  state = { overlay, input, listEl, nav, index };

  // re-query on input (within one event-loop tick — synchronous handler).
  input.addEventListener('input', () => {
    const results = query(index, input.value);
    nav.reset(results);
    if (results.length) nav.activeIdx = 0;
    renderResults(listEl, nav);
  });

  document.body.append(overlay);
  window.addEventListener('keydown', onKeydown, true);

  // initial empty state, then focus the input.
  renderResults(listEl, nav);
  input.focus();
}

/** Close the overlay: remove it from the DOM and unbind the key handler. */
export function close() {
  if (typeof document === 'undefined') return;
  window.removeEventListener('keydown', onKeydown, true);
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  state = null;
}

// Open on the shell's ⌘K event (dispatched by shell.js' search button) and on
// the ⌘K / Ctrl-K shortcut. main.js may also drive these; the listeners are
// idempotent.
if (typeof document !== 'undefined') {
  document.addEventListener('planr:open-search', () => { open(); });
}
