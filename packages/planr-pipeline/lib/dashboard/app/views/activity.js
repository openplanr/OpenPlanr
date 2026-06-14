/**
 * activity.js — Live Activity feed view (SPEC-016 / T-012).
 *
 * design-spec §9 Screen #7 (mockups/07-activity-{desktop,tablet,mobile}.png):
 * a live SSE feed of `.planr/` changes. Opens a persistent EventSource on
 * GET /api/events (T-004) and, on each `message`, prepends a feed entry:
 *   - a status dot (colour from §1 tokens)
 *   - a change-description line (the affected id + status, bold)
 *   - an actor / meta label
 *   - a relative-time label ("2m", "1h", …) computed by a tiny elapsed
 *     formatter — no i18n library
 *
 * It also dispatches `planr:activity-event` on `document` so the shell's live
 * badge can pulse, and exposes unmount() (called by the router before mounting a
 * new view) which closes the EventSource so no orphan listeners remain.
 * A "Connecting…" placeholder shows until the first event arrives.
 *
 * Read-only. Token-only styling — the feed CSS is injected via <style> because
 * ds.css is a Preserve file. No raw hex, no off-grid spacing, no third-party
 * product codenames. Icons would be inline outline SVG (§6) — never emoji.
 */

import { displayId } from '../display-id.js';

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

/* ── scoped stylesheet (ds.css is Preserve) ─────────────────────────── */

const STYLE_ID = 'ds-activity-style';
const ACTIVITY_CSS = `
.activity-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  padding: var(--space-2) var(--space-4);
  margin-top: var(--space-6);
}
.activity-feed { list-style: none; margin: 0; padding: 0; }
.feed-entry {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-top: 1px solid var(--border);
}
.feed-entry:first-child { border-top: none; }
.feed-entry__main { min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.feed-entry__text { font-size: var(--text-sm); color: var(--foreground); }
.feed-entry__text strong { font-weight: var(--weight-semibold); }
.feed-entry__meta { font-size: var(--text-xs); color: var(--muted-foreground); }
.feed-entry__time { font-size: var(--text-xs); color: var(--muted-foreground); font-variant-numeric: tabular-nums; white-space: nowrap; }

.dot {
  flex: 0 0 auto;
  margin-top: var(--space-1);
  width: var(--space-2);
  height: var(--space-2);
  border-radius: 50%;
  background: var(--muted-foreground);
}
.dot-done       { background: var(--success); }
.dot-in-progress { background: var(--primary); }
.dot-blocked    { background: var(--warning); }
.dot-addressed  { background: var(--info); }
.dot-outstanding { background: var(--muted-foreground); }

.activity-placeholder {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-6) 0;
  color: var(--muted-foreground);
  font-size: var(--text-sm);
}
.activity-placeholder__dot {
  width: var(--space-2);
  height: var(--space-2);
  border-radius: 50%;
  background: var(--primary);
}
@media (prefers-reduced-motion: no-preference) {
  .activity-placeholder__dot { animation: activity-pulse var(--duration-slow, 260ms) var(--ease, ease) infinite alternate; }
}
@keyframes activity-pulse { from { opacity: 0.4; } to { opacity: 1; } }

@container shell (max-width: 767px) {
  .feed-entry { grid-template-columns: auto 1fr; }
  .feed-entry__time { grid-column: 2; }
}
@supports not (container-type: inline-size) {
  @media (max-width: 767px) {
    .feed-entry { grid-template-columns: auto 1fr; }
    .feed-entry__time { grid-column: 2; }
  }
}
`;

/** Inject the activity stylesheet once. */
function ensureStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = ACTIVITY_CSS;
  document.head.append(style);
}

/* ── relative-time formatter (no i18n library) ──────────────────────── */

/**
 * Format an elapsed millisecond span as a compact relative label.
 * @param {number} ms milliseconds since the event
 * @returns {string} e.g. "now" · "8m" · "1h" · "3d"
 */
export function relativeTime(ms) {
  const s = Math.max(0, Math.floor(Number(ms) / 1000));
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/* ── patch → feed-entry model (pure) ────────────────────────────────── */

const KNOWN_STATUS = new Set(['done', 'in-progress', 'blocked', 'addressed', 'outstanding']);

/** Normalise a status string onto the five known buckets (for the dot colour). */
function dotStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (KNOWN_STATUS.has(s)) return s;
  if (s === 'in_progress' || s === 'in progress') return 'in-progress';
  return 'outstanding';
}

/**
 * Best-effort status extraction from a contract `change` string (e.g.
 * "status → done") so the feed dot is coloured. Falls back to the event `type`.
 */
function statusFromChange(change, type) {
  const text = String(change || '');
  for (const known of KNOWN_STATUS) {
    if (text.toLowerCase().includes(known)) return known;
  }
  return type;
}

/**
 * Derive a feed entry model from an SSE patch payload. Tolerant of the watcher
 * patch shape ({ updated, added, removed, edges }) and of a flat single-event
 * shape ({ id, status, actor, text }). Pure: no DOM. Returns null when the patch
 * carries nothing to show.
 * @returns {{status:string, text:string, id:string, actor:string}|null}
 */
export function entryFromPatch(patch) {
  if (!patch || typeof patch !== 'object') return null;

  // SSE event-shape contract (T-013): { type, nodeId, change, actor?, ts }.
  if (patch.nodeId && patch.change != null) {
    return {
      status: dotStatus(statusFromChange(patch.change, patch.type)),
      id: String(patch.nodeId),
      text: String(patch.change),
      actor: patch.actor != null ? String(patch.actor) : '',
    };
  }

  // Flat single-event shape.
  if (patch.id && (patch.text || patch.status)) {
    return {
      status: dotStatus(patch.status),
      id: String(patch.id),
      text: patch.text != null ? String(patch.text) : `${patch.id} → ${patch.status || 'updated'}`,
      actor: patch.actor != null ? String(patch.actor) : '',
    };
  }

  // Watcher patch shape: pick the most salient affected node.
  const updated = Array.isArray(patch.updated) ? patch.updated : [];
  const added = Array.isArray(patch.added) ? patch.added : [];
  const removed = Array.isArray(patch.removed) ? patch.removed : [];
  const node = updated[0] || added[0] || null;

  if (node && node.id) {
    const verb = added.includes(node) ? 'added' : 'updated';
    const status = node.status || verb;
    const actor = (node.frontmatter && (node.frontmatter.agent || node.frontmatter.owner)) || '';
    return {
      status: dotStatus(node.status),
      id: String(node.id),
      text: `${node.id} → ${status}`,
      actor: actor ? String(actor) : '.planr/ change',
    };
  }
  if (removed.length) {
    return { status: 'outstanding', id: String(removed[0]), text: `${removed[0]} removed`, actor: '.planr/ change' };
  }
  return null;
}

/* ── SSE event-shape contract (pure) ────────────────────────────────── */

/**
 * Parse and validate one SSE `event.data` string from `GET /api/events` (T-004)
 * into the Activity event-shape contract. Pure: no DOM, stdlib only.
 *
 * Contract: `{ type: string, nodeId: string, change: string, actor?: string, ts: number }`.
 * Throws a `TypeError` with a descriptive message when the JSON is malformed or
 * the shape is invalid (the message names the offending field). The Activity
 * view's EventSource message handler calls this before rendering each entry.
 *
 * @param {string} rawData the raw string from `event.data`
 * @returns {{ type: string, nodeId: string, change: string, actor?: string, ts: number }}
 */
export function parseActivityEvent(rawData) {
  let parsed;
  try {
    parsed = JSON.parse(rawData);
  } catch (err) {
    throw new TypeError(`parseActivityEvent: event.data is not valid JSON (${err.message})`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('parseActivityEvent: event payload must be a JSON object');
  }

  // Required string fields.
  for (const field of ['type', 'nodeId', 'change']) {
    if (!(field in parsed)) {
      throw new TypeError(`parseActivityEvent: missing required field "${field}"`);
    }
    if (typeof parsed[field] !== 'string') {
      throw new TypeError(`parseActivityEvent: field "${field}" must be a string`);
    }
  }
  // Required numeric timestamp.
  if (!('ts' in parsed)) {
    throw new TypeError('parseActivityEvent: missing required field "ts"');
  }
  if (typeof parsed.ts !== 'number' || !Number.isFinite(parsed.ts)) {
    throw new TypeError('parseActivityEvent: field "ts" must be a finite number');
  }
  // Optional actor.
  if ('actor' in parsed && parsed.actor != null && typeof parsed.actor !== 'string') {
    throw new TypeError('parseActivityEvent: optional field "actor" must be a string');
  }

  const out = {
    type: parsed.type,
    nodeId: parsed.nodeId,
    change: parsed.change,
    ts: parsed.ts,
  };
  if (typeof parsed.actor === 'string') out.actor = parsed.actor;
  return out;
}

/* ── feed rendering ─────────────────────────────────────────────────── */

/** Build a `<li class="feed-entry">` for an entry model captured at `at` ms.
 * The model id is the (possibly-namespaced) change subject; display the local
 * id and strip the namespace prefix from the change text too. */
function feedEntry(model, at) {
  const localId = displayId(model.id);
  const time = el('span', {
    class: 'feed-entry__time',
    attrs: { 'data-at': String(at) },
    text: relativeTime(Date.now() - at),
  });
  const text = String(model.text || '')
    .replace(`${model.id} → `, '→ ')
    .replace(model.id, localId);
  return el('li', { class: 'feed-entry' }, [
    el('span', { class: `dot dot-${model.status}` }),
    el('div', { class: 'feed-entry__main' }, [
      el('div', { class: 'feed-entry__text' }, [
        el('strong', { text: localId }),
        el('span', { text: ` — ${text}` }),
      ]),
      el('div', { class: 'feed-entry__meta', text: model.actor || '.planr/ change' }),
    ]),
    time,
  ]);
}

/* ── view state (module-scoped so unmount can tear down) ────────────── */

let _source = null;
let _tick = null;
let _onMessage = null;
let _onError = null;

/**
 * Close the EventSource and clear timers/listeners. Called by the router before
 * mounting the next view so no orphan listeners or open streams remain (AC10).
 */
export function unmount() {
  if (_source) {
    if (_onMessage) _source.removeEventListener('message', _onMessage);
    if (_onError) _source.removeEventListener('error', _onError);
    try { _source.close(); } catch { /* already closed */ }
    _source = null;
  }
  _onMessage = null;
  _onError = null;
  if (_tick) { clearInterval(_tick); _tick = null; }
}

/**
 * Mount the Activity view into `el`.
 * @param {HTMLElement} el2 content mount element
 */
export function mount(el2) {
  if (!el2) return;
  ensureStyle();
  // Tear down any prior stream (defensive — the router also calls unmount()).
  unmount();

  el2.innerHTML = '';

  const feed = el('ul', { class: 'activity-feed', attrs: { 'aria-live': 'polite', 'aria-label': 'Live activity feed' } });
  const placeholder = el('div', { class: 'activity-placeholder' }, [
    el('span', { class: 'activity-placeholder__dot' }),
    el('span', { text: 'Connecting…' }),
  ]);
  const card = el('div', { class: 'activity-card' }, [placeholder, feed]);

  el2.append(
    el('header', {}, [
      el('div', { class: 'ds-eyebrow', text: 'Activity' }),
      el('h1', { class: 'ds-h1', text: 'Live activity' }),
      el('p', { class: 'ds-lede', text: 'Every change to .planr/ — pushed over SSE as the agents and you edit' }),
    ]),
    card,
  );

  let firstArrived = false;

  /** Append an entry to the top of the feed for one SSE patch. */
  const append = (patch) => {
    const model = entryFromPatch(patch);
    if (!model) return;
    if (!firstArrived) { firstArrived = true; placeholder.remove(); }
    feed.prepend(feedEntry(model, Date.now()));
    // Pulse the shell's live badge.
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('planr:activity-event', { detail: model }));
    }
  };

  if (typeof EventSource !== 'undefined') {
    try {
      _source = new EventSource('/api/events');
      _onMessage = (event) => {
        // Prefer the SSE event-shape contract (T-013); fall back to the watcher
        // patch shape ({ updated, added, removed }) for live-sync diffs.
        try {
          append(parseActivityEvent(event.data));
          return;
        } catch { /* not a contract event — try the patch shape below */ }
        let patch;
        try { patch = JSON.parse(event.data); } catch { return; }
        append(patch);
      };
      _onError = () => { /* EventSource auto-reconnects; surface nothing in the UI */ };
      _source.addEventListener('message', _onMessage);
      _source.addEventListener('error', _onError);
    } catch {
      placeholder.lastChild.textContent = 'Live updates unavailable';
    }
  } else {
    placeholder.lastChild.textContent = 'Live updates unavailable';
  }

  // Refresh the relative-time labels in place every 30s (no re-render).
  _tick = setInterval(() => {
    const now = Date.now();
    for (const node of feed.querySelectorAll('.feed-entry__time')) {
      const at = Number(node.getAttribute('data-at'));
      if (at) node.textContent = relativeTime(now - at);
    }
  }, 30000);

  // Hand the router a teardown alias (matches the board.js mount.cleanup pattern).
  mount.cleanup = unmount;
}
