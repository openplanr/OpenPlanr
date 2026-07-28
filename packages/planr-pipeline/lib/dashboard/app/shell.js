/**
 * shell.js — the dashboard-native shell (SPEC-016 / T-006).
 *
 * Exports renderShell(root): injects the 264px left rail + 56px sticky top bar
 * (design-spec §3–§5) into `root`, then a content mount point the router fills.
 *
 *   Rail  : workspace switcher · view nav (Overview · Graph · Board · List ·
 *           Sprints · Activity) · Filters (Status + Type) · "Live — watching
 *           .planr/" indicator (pulse animation).
 *   Topbar: hamburger (mobile) · breadcrumb · ⌘K search field · planning-mode
 *           chip · live badge · theme toggle · export · notifications bell.
 *
 * The mode chip is NOT hard-coded: it reflects the real project mode reported by
 * GET /api/meta (`spec | agile | mixed | empty`). main.js fetches the mode on
 * boot and calls setModeChip(mode); until then the chip is hidden. Mapping:
 *   spec → "Spec" · agile → "Agile" · mixed → "Agile + Spec" · empty → hidden.
 *
 * Styling uses ONLY tokens declared in ds.css — no raw hex, no off-grid spacing,
 * no third-party product codenames. Icons are inline outline SVG (currentColor,
 * 1.6 stroke) per design-spec §6 — never emoji.
 *
 * The shell emits one custom event on `document` so view modules / main.js can
 * react without a hard dependency:
 *   - `planr:theme-change` { detail: { theme } }  from the theme toggle
 */

import { setFilter, getFilter } from './main.js';
import { typesInGraph, statusesInGraph, typePlural, statusLabel } from './metadata.js';

/* ── inline outline icons (design-spec §6) ──────────────────────────── */
const ICON = {
  overview: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  graph: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M6 8.5v3a3 3 0 0 0 3 3h.5M18 8.5v3a3 3 0 0 1-3 3h-.5"/></svg>',
  board: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
  sprints: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 3 2 3H5"/></svg>',
  activity: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2 6 4-14 2 8h6"/></svg>',
  operate: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h5M8 16h3"/><circle cx="17" cy="16" r="2"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6"/><path d="m20 20-3.2-3.2"/></svg>',
  hamburger: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.2 6.2 0 0 0 10.5 10.5Z"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10.5 19a1.6 1.6 0 0 0 3 0"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m7 10 5 5 5-5"/></svg>',
};

/** The six rail views (design-spec §4). The first segment is the hash route. */
const VIEWS = [
  { id: 'overview', label: 'Overview', icon: ICON.overview },
  { id: 'graph', label: 'Graph', icon: ICON.graph },
  { id: 'board', label: 'Board', icon: ICON.board },
  { id: 'list', label: 'List', icon: ICON.list },
  { id: 'sprints', label: 'Sprints', icon: ICON.sprints },
  { id: 'activity', label: 'Activity', icon: ICON.activity },
  { id: 'operate', label: 'Operating', icon: ICON.operate, optional: true },
];

/** Small DOM helper — create an element with class, attrs, html, and children. */
function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  for (const child of children) if (child) node.append(child);
  return node;
}

/** Resolve the active view id from location.hash (defaults to overview). */
function activeView() {
  const raw = (typeof location !== 'undefined' && location.hash || '').replace(/^#\/?/, '');
  const id = raw.split('/')[0] || 'overview';
  return VIEWS.some((v) => v.id === id) ? id : 'overview';
}

/** Build the left rail. */
function buildRail() {
  const rail = el('nav', { class: 'ds-rail', attrs: { 'aria-label': 'Primary' } });

  // workspace switcher
  const ws = el('button', { class: 'ds-workspace', attrs: { type: 'button', 'aria-haspopup': 'menu' } }, [
    el('span', { class: 'ds-workspace__mark', text: 'P' }),
    el('span', { class: 'ds-workspace__meta' }, [
      el('span', { class: 'ds-workspace__name', text: 'planr-pipeline' }),
      el('span', { class: 'ds-workspace__sub', text: 'main · 15 specs' }),
    ]),
    el('span', { class: 'ds-workspace__chev', html: ICON.chevron }),
  ]);
  rail.append(ws);

  // view nav
  const current = activeView();
  const navGroup = el('div', { class: 'ds-rail__group' }, [
    el('div', { class: 'ds-rail__label', text: 'Views' }),
  ]);
  const nav = el('div', { class: 'ds-nav' });
  for (const v of VIEWS) {
    const link = el('a', {
      class: 'ds-nav__link',
      attrs: { href: `#${v.id}`, 'data-view': v.id },
    }, [
      el('span', { class: 'ds-nav__icon', html: v.icon }),
      el('span', { class: 'ds-nav__text', text: v.label }),
    ]);
    if (v.optional) link.setAttribute('hidden', 'hidden');
    if (v.id === current) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  navGroup.append(nav);
  rail.append(navGroup);

  // filters — the Status chips + Type checkboxes are METADATA-DRIVEN: the
  // containers render empty here and populateFilters(graph) (called by main.js
  // once /api/graph loads, and again on each live patch) fills them from the
  // types/statuses ACTUALLY present, wired to the shared filter state. A status
  // (Outstanding/Addressed) or type (Quick/Backlog) that exists in the data
  // shows up automatically; one that doesn't is never advertised.
  const filters = el('div', { class: 'ds-filters' }, [
    el('div', { class: 'ds-rail__label', text: 'Filters' }),
    el('div', { class: 'ds-filter' }, [
      el('div', { class: 'ds-filter__head', text: 'Status' }),
      el('div', { class: 'ds-chips', attrs: { 'data-status-chips': '' } }),
    ]),
    el('div', { class: 'ds-filter' }, [
      el('div', { class: 'ds-filter__head', text: 'Type' }),
      el('div', { class: 'ds-typefilter', attrs: { 'data-type-filter': '' } }),
    ]),
  ]);
  rail.append(filters);

  // live indicator (rail foot, pulse)
  const live = el('div', { class: 'ds-rail__foot' }, [
    el('div', { class: 'ds-live', attrs: { role: 'status' } }, [
      el('span', { class: 'ds-live__dot' }),
      el('span', { text: 'Live — watching .planr/' }),
    ]),
  ]);
  rail.append(live);

  return rail;
}

/** Build the sticky top bar. */
function buildTopbar() {
  const bar = el('header', { class: 'ds-topbar' });

  const hamburger = el('button', {
    class: 'ds-hamburger',
    html: ICON.hamburger,
    attrs: { type: 'button', 'aria-label': 'Open navigation', 'data-action': 'menu' },
  });

  const crumb = el('div', { class: 'ds-crumb', attrs: { 'aria-label': 'Breadcrumb' } }, [
    el('span', { class: 'ds-crumb__root', text: 'planr-pipeline' }),
    el('span', { class: 'ds-crumb__sep', text: '/' }),
    el('span', { class: 'ds-crumb__here', attrs: { 'data-crumb': 'view' }, text: 'Overview' }),
  ]);

  // ⌘K search field — a button that opens the command palette overlay (T-009).
  const search = el('button', {
    class: 'ds-search',
    attrs: { type: 'button', 'aria-label': 'Search specs, stories, tasks', 'data-action': 'search' },
  }, [
    el('span', { class: 'ds-search__icon', html: ICON.search }),
    el('span', { class: 'ds-search__text', text: 'Search specs, stories, tasks…' }),
    el('kbd', { class: 'ds-search__kbd', text: '⌘K' }),
  ]);
  search.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('planr:open-search'));
  });

  // right cluster
  const right = el('div', { class: 'ds-topbar__right' });

  // Planning-mode chip — read-only, driven by setModeChip(mode) once /api/meta
  // resolves. Hidden until then (and whenever the project has no artifacts) so
  // it never shows a guessed/hard-coded mode.
  const modeChip = el('span', {
    class: 'ds-modechip',
    attrs: { 'data-mode-chip': '', 'aria-label': 'Planning mode', hidden: 'hidden' },
  });

  const liveBadge = el('span', { class: 'ds-livebadge', attrs: { role: 'status' } }, [
    el('span', { class: 'ds-livebadge__dot' }),
    el('span', { text: 'live' }),
  ]);

  const themeToggle = el('button', {
    class: 'ds-iconbtn',
    html: ICON.moon,
    attrs: { type: 'button', 'aria-label': 'Toggle theme', 'data-action': 'theme' },
  });
  themeToggle.addEventListener('click', () => {
    // main.js owns the localStorage write via toggleTheme(); we toggle the class
    // here only as a self-contained fallback when no listener is attached, then
    // announce so listeners can persist the choice.
    const willBeDark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', willBeDark);
    document.dispatchEvent(new CustomEvent('planr:theme-change', {
      detail: { theme: willBeDark ? 'dark' : 'light' },
    }));
  });

  const exportBtn = el('button', {
    class: 'ds-iconbtn',
    html: ICON.download,
    attrs: { type: 'button', 'aria-label': 'Export board', 'data-action': 'export' },
  });

  const bell = el('button', {
    class: 'ds-iconbtn',
    html: ICON.bell,
    attrs: { type: 'button', 'aria-label': 'Notifications', 'data-action': 'notifications' },
  });

  right.append(modeChip, liveBadge, themeToggle, exportBtn, bell);
  bar.append(hamburger, crumb, search, right);
  return bar;
}

/* ── metadata-driven rail filters (wired to the shared filter state) ─────────*/

/** Recompute the "all checked / none checked ⇒ all types" rule into a filter. */
function typeFilterFromChecks(allTypes) {
  const host = document.querySelector('[data-type-filter]');
  if (!host) return [];
  const checked = [...host.querySelectorAll('input[type="checkbox"]')]
    .filter((b) => b.checked).map((b) => b.value);
  // Empty typeFilter means "all types"; selecting every present type is the
  // same as no filter, so collapse both to [] (keeps the List "All" chip in sync).
  return (checked.length === 0 || checked.length === allTypes.length) ? [] : checked;
}

/** Build the Status chips (All + each status present) from the graph. */
function populateStatusChips(nodes) {
  const host = document.querySelector('[data-status-chips]');
  if (!host) return;
  const sel = getFilter().statusFilter; // null ⇒ All
  host.innerHTML = '';
  const make = (id, label) => {
    const pressed = id === 'all' ? sel == null : sel === id;
    const chip = el('button', {
      class: 'ds-chip',
      text: label,
      attrs: { type: 'button', 'data-status': id, 'aria-pressed': pressed ? 'true' : 'false' },
    });
    chip.addEventListener('click', () => setFilter('status', id === 'all' ? null : id));
    host.append(chip);
  };
  make('all', 'All');
  for (const s of statusesInGraph(nodes)) make(s, statusLabel(s));
}

/** Build the Type checkboxes (one per type present, with a live count). */
function populateTypeFilter(nodes) {
  const host = document.querySelector('[data-type-filter]');
  if (!host) return;
  const types = typesInGraph(nodes);
  const selected = getFilter().typeFilter; // [] ⇒ all
  host.innerHTML = '';
  for (const t of types) {
    const count = nodes.filter((n) => n && n.type === t).length;
    const label = el('label', { class: 'ds-checkbox' });
    const box = el('input', { attrs: { type: 'checkbox', value: t } });
    box.checked = selected.length === 0 || selected.includes(t);
    box.addEventListener('change', () => setFilter('type', typeFilterFromChecks(types)));
    label.append(box, el('span', { text: `${typePlural(t)} ${count}` }));
    host.append(label);
  }
}

/**
 * Fill the rail's Status + Type filter controls from the graph actually loaded.
 * Idempotent: rebuilds from the current `getFilter()` selection so it can be
 * re-run on every live patch (a new type/status appears automatically). Called
 * by main.js after /api/graph loads and after each SSE merge.
 * @param {{nodes?: object[]}} graph
 */
export function populateFilters(graph) {
  if (typeof document === 'undefined') return;
  const nodes = (graph && Array.isArray(graph.nodes)) ? graph.nodes : [];
  populateStatusChips(nodes);
  populateTypeFilter(nodes);
}

/**
 * Reflect the current shared filter state onto the rail controls WITHOUT
 * rebuilding (so a change made from another surface — e.g. the List view's type
 * chips or its "All" chip — keeps the rail in sync). Bound to planr:filter-change.
 */
function syncFilterControls() {
  if (typeof document === 'undefined') return;
  const f = getFilter();
  const statusHost = document.querySelector('[data-status-chips]');
  if (statusHost) {
    for (const chip of statusHost.querySelectorAll('[data-status]')) {
      const id = chip.getAttribute('data-status');
      const pressed = id === 'all' ? f.statusFilter == null : f.statusFilter === id;
      chip.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    }
  }
  const typeHost = document.querySelector('[data-type-filter]');
  if (typeHost) {
    for (const box of typeHost.querySelectorAll('input[type="checkbox"]')) {
      box.checked = f.typeFilter.length === 0 || f.typeFilter.includes(box.value);
    }
  }
}

/**
 * Render the shell into `root`. Returns the content element view modules mount
 * into (also discoverable via `#ds-content`).
 * @param {HTMLElement} root
 * @returns {HTMLElement} the content mount element
 */
export function renderShell(root) {
  if (!root) throw new Error('renderShell: root element is required');
  root.innerHTML = '';

  const shell = el('div', { class: 'ds-shell' });
  const content = el('main', { class: 'ds-content', attrs: { id: 'ds-content', role: 'main' } });

  shell.append(buildRail(), buildTopbar(), content);
  root.append(shell);

  // Keep the rail controls in sync when the filter changes from any surface
  // (List view chips, the "All" chip, etc.). Guarded so repeat renders don't
  // stack listeners. populateFilters() fills the options once the graph loads.
  if (!renderShell._filterSyncBound) {
    document.addEventListener('planr:filter-change', syncFilterControls);
    renderShell._filterSyncBound = true;
  }

  return content;
}

/** Human label for each planning mode (empty → no label, chip hides). */
const MODE_LABEL = { spec: 'Spec', agile: 'Agile', mixed: 'Agile + Spec', empty: '' };

/**
 * Drive the top-bar planning-mode chip from the real project mode reported by
 * GET /api/meta. `mixed` shows "Agile + Spec"; `spec`/`agile` show their single
 * label; `empty` (or an unknown value) hides the chip entirely. Idempotent —
 * main.js calls this once meta resolves.
 * @param {'spec'|'agile'|'mixed'|'empty'} mode
 */
export function setModeChip(mode) {
  if (typeof document === 'undefined') return;
  const chip = document.querySelector('[data-mode-chip]');
  if (!chip) return;
  const label = MODE_LABEL[mode];
  if (!label) {
    chip.setAttribute('hidden', 'hidden');
    chip.textContent = '';
    chip.removeAttribute('data-mode');
    return;
  }
  chip.textContent = label;
  chip.setAttribute('data-mode', mode);
  chip.removeAttribute('hidden');
}

/** Update the breadcrumb's trailing crumb + the rail's active link for a view. */
export function setActiveView(viewId) {
  const links = document.querySelectorAll('.ds-nav__link');
  links.forEach((link) => {
    if (link.getAttribute('data-view') === viewId) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const crumb = document.querySelector('[data-crumb="view"]');
  if (crumb) {
    const v = VIEWS.find((x) => x.id === viewId);
    crumb.textContent = v ? v.label : (viewId || 'Overview');
  }
}

/** Show the optional Operating route only after its projection is discovered. */
export function setOperatingAvailable(available) {
  if (typeof document === 'undefined') return;
  const link = document.querySelector('.ds-nav__link[data-view="operate"]');
  if (!link) return;
  if (available || activeView() === 'operate') link.removeAttribute('hidden');
  else link.setAttribute('hidden', 'hidden');
}

export { VIEWS };
