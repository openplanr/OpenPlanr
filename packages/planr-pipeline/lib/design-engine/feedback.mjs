/**
 * @shape extended, attributed feedback object (backward/forward compatible)
 *
 * The feedback file is the durable, MERGED store (never overwritten). It extends the
 * v1.0.0 design-feedback shape additively:
 *
 *   {
 *     schema_version: "1.0.0",
 *     boardId, publishedAt, regenerated, ratings, comments, pins,   // existing
 *     authors?: Array<{                                             // reviewer roster
 *       name: string,            // display-name only — the merge + avatar key (no auth/PII)
 *       color?: string,          // deterministic avatar token derived from `name`
 *       initials?: string,       // 1–2 letters
 *       lastSeen?: string,       // ISO timestamp
 *     }>,
 *     pins: Array<{
 *       id: string,              // stable 12-char sha256 hex prefix — merge key (w/ author)
 *       author: string,          // reviewer display name ("Anonymous" for legacy items)
 *       variant, x, y, w, h, comment, intent,                       // existing
 *       status?: "open"|"addressed"|"resolved",                     // lifecycle
 *       createdAt?: string,      // ISO timestamp (also feeds the stable id)
 *       screen?: string,
 *       replies?: Array<{ id?: string, author: string, comment: string, createdAt?: string }>,  // thread
 *     }>,
 *   }
 *
 * pin LIFECYCLE write operations fold through mergeFeedback():
 *   - delete: a contribution pin of the form { id, author, deleted: true } removes the matching
 *     stored item — but ONLY when the marker's author equals the stored item's author. A delete
 *     by anyone else is a silent no-op (you cannot delete another reviewer's pin). Delete markers
 *     are themselves the wire-shape POSTed by the board client; they are never stored.
 *   - reply: replies merge per-item by reply id (the optional reply.id, else a content signature
 *     of author+comment+createdAt). New replies are appended; an existing reply id is last-write-
 *     wins, so re-posting the same reply (idempotent retry) never duplicates the thread.
 *   - status: a per-item field carried on the full-item contribution; last-write-wins per item.
 *
 * Identity is a LOCAL display name + deterministic avatar only — no account, no auth, no PII.
 * The merge is non-destructive: a contribution is reconciled into the store keyed by
 * (pin.id + pin.author), last-write-wins per item; items not present in the contribution are
 * never removed. Legacy (unattributed) files load via normalizeLegacy() → "Anonymous" + stable id.
 *
 * The board↔agent FILE handshake (hard rule 3). The board writes feedback as a
 * file NEXT TO the board HTML; the agent reads it only after the user says
 * they're done in the blocking AskUserQuestion — never parsed from chat.
 *
 *   feedback.json          — final submit / approve round. Left in place.
 *   feedback-pending.json  — regenerate / remix / more-like round. CONSUMED
 *                            (deleted) on read so a stale pending round can
 *                            never be double-applied.
 *
 * Every read validates against design-feedback.schema.json + the cross-field
 * rule the schema can't express (regenerated=true ⇒ regenerateAction present).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { assertValid } from '../design/schema-loader.mjs';

export const FEEDBACK_FILE = 'feedback.json';
export const PENDING_FILE = 'feedback-pending.json';

/** Clamp + round a pin into the normalized 0..1 space (the schema has no `maximum`). */
export function clampPin(pin) {
  const unit = (v) => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 10000) / 10000;
  return { ...pin, x: unit(pin.x), y: unit(pin.y), w: unit(pin.w), h: unit(pin.h) };
}

export const DEFAULT_AUTHOR = 'Anonymous';

/** Length of the stable-id hex prefix (a sha256 truncation — enough to avoid collisions in a board). */
export const STABLE_ID_LENGTH = 12;

/**
 * derive a stable item id from its content, so the same logical pin keys to the
 * same id across reloads/merges (idempotent re-submit) without any server-side counter.
 *
 * The id is a STABLE_ID_LENGTH-char prefix of sha256(author + '\n' + createdAt + '\n' + comment).
 * Two distinct pins by the same author at the same instant with the same comment intentionally
 * collapse to one item — that is the idempotency the merge relies on.
 *
 * @param {object} item a pin-like object ({ author?, createdAt?, comment? })
 * @returns {string} lowercase hex, STABLE_ID_LENGTH chars
 */
export function generateStableId(item = {}) {
  const author = item.author == null ? '' : String(item.author);
  const createdAt = item.createdAt == null ? '' : String(item.createdAt);
  const comment = item.comment == null ? '' : String(item.comment);
  return createHash('sha256')
    .update(`${author}\n${createdAt}\n${comment}`)
    .digest('hex')
    .slice(0, STABLE_ID_LENGTH);
}

/**
 * normalize a (possibly legacy / unattributed) feedback object so every pin
 * carries an `author` and a stable `id`. Pure — returns an augmented copy; the input is
 * not mutated. All existing fields are preserved; only missing attribution is filled.
 *
 *   - pin.author missing/blank → DEFAULT_AUTHOR ("Anonymous")
 *   - pin.id missing/blank     → generateStableId(pin) (computed AFTER author is filled)
 *   - feedbackObj.authors absent → reconstructed roster from the pins' authors
 *
 * @param {object} feedbackObj
 * @returns {object} augmented copy
 */
export function normalizeLegacy(feedbackObj) {
  if (feedbackObj == null || typeof feedbackObj !== 'object') return feedbackObj;
  const out = { ...feedbackObj };
  const pins = Array.isArray(feedbackObj.pins) ? feedbackObj.pins : [];

  out.pins = pins.map((pin) => {
    const next = { ...pin };
    if (next.author == null || String(next.author).trim() === '') {
      next.author = DEFAULT_AUTHOR;
    }
    if (next.id == null || String(next.id).trim() === '') {
      next.id = generateStableId(next);
    }
    return next;
  });

  // Author roster: keep existing entries, then add any pin author not already present.
  const roster = new Map();
  const existing = Array.isArray(feedbackObj.authors) ? feedbackObj.authors : [];
  for (const a of existing) {
    if (a && typeof a === 'object' && typeof a.name === 'string' && a.name) {
      roster.set(a.name, { ...a });
    }
  }
  for (const pin of out.pins) {
    if (!roster.has(pin.author)) roster.set(pin.author, { name: pin.author });
  }
  out.authors = [...roster.values()];

  return out;
}

/**
 * is this contribution pin a DELETE MARKER rather than a real pin?
 * The board client POSTs `{ id, author, deleted: true }` to remove an item. A marker is any
 * pin object carrying a truthy `deleted` flag; it is never written to the durable store — it is
 * the instruction to drop the matching item (author-scoped) during the merge.
 *
 * @param {object} pin
 * @returns {boolean}
 */
export function isDeleteMarker(pin) {
  return Boolean(pin && typeof pin === 'object' && pin.deleted);
}

/**
 * the reply-level merge key. Prefer an explicit reply.id (the optional schema
 * field); otherwise derive a stable content signature from author + comment + createdAt so the
 * append/dedup is idempotent even when the client never assigns reply ids. Two replies that are
 * byte-identical in those fields collapse to one — exactly the idempotency a retry relies on.
 *
 * @param {object} reply
 * @returns {string}
 */
function replyKey(reply) {
  if (reply && typeof reply === 'object' && reply.id != null && String(reply.id).trim() !== '') {
    return `id:${reply.id}`;
  }
  const author = reply && reply.author != null ? String(reply.author) : '';
  const comment = reply && reply.comment != null ? String(reply.comment) : '';
  const createdAt = reply && reply.createdAt != null ? String(reply.createdAt) : '';
  return `sig:${author}\n${comment}\n${createdAt}`;
}

/**
 * merge two reply arrays by reply key. Stored replies come first (order
 * preserved), incoming replies with a NEW key are appended, and an incoming reply that matches
 * an existing key is last-write-wins (it replaces the stored entry in place). Idempotent:
 * re-merging the same replies yields the same array. Pure — returns a fresh array.
 *
 * @param {Array} storedReplies
 * @param {Array} incomingReplies
 * @returns {Array}
 */
function mergeReplies(storedReplies, incomingReplies) {
  const stored = Array.isArray(storedReplies) ? storedReplies : [];
  const incoming = Array.isArray(incomingReplies) ? incomingReplies : [];
  const order = [];
  const byKey = new Map();
  const upsert = (reply) => {
    const k = replyKey(reply);
    if (!byKey.has(k)) order.push(k);
    byKey.set(k, reply);
  };
  for (const r of stored) upsert(r);
  for (const r of incoming) upsert(r);
  return order.map((k) => byKey.get(k));
}

/**
 * the crux: merge a `contribution` into the durable `stored` feedback object,
 * NON-DESTRUCTIVELY. Pure: no file I/O, no mutation of either argument; returns a new object.
 *
 *   - pins are keyed by (id + ' ' + author); a contribution pin replaces the stored
 *     pin with the same key (last-write-wins PER ITEM), and contribution pins with new keys
 *     are appended. Stored pins NOT present in the contribution are kept untouched — one
 *     author's submit never deletes another author's (or an earlier) pin.
 *   - authors are merged by `name`; contribution author fields shallow-override the stored
 *     entry of the same name, so each author appears exactly once in the roster.
 *   - scalar/top-level fields (ratings, comments, overall, preferred, publishedAt, …) on the
 *     contribution shallow-override stored; stored values survive when the contribution omits
 *     them. ratings/comments are merged key-by-key (per-variant) rather than wholesale-replaced.
 *
 * Both inputs are normalized first so pins always have an id+author to key on (idempotent
 * re-submit of an unchanged item is therefore a no-op).
 *
 * Delete markers ({ id, author, deleted:true }) on the contribution remove the matching stored
 * item (author-scoped); replies merge per-item by reply id (or content signature); status rides
 * the last-write-wins pin replacement. See isDeleteMarker / mergeReplies below.
 *
 * @param {object} stored the durable record (may be legacy/empty)
 * @param {object} contribution the incoming round to fold in
 * @returns {object} the merged record
 */
export function mergeFeedback(stored, contribution) {
  const base = normalizeLegacy(stored && typeof stored === 'object' ? stored : {});
  // Separate delete markers from the contribution BEFORE normalizing real pins — a marker carries
  // no variant/x/y/comment to fill, and normalizeLegacy would only re-key it with a bogus id.
  const rawIncoming = contribution && typeof contribution === 'object' ? contribution : {};
  const rawPins = Array.isArray(rawIncoming.pins) ? rawIncoming.pins : [];
  const deleteMarkers = rawPins.filter(isDeleteMarker);
  const realPins = rawPins.filter((p) => !isDeleteMarker(p));
  const incoming = normalizeLegacy({ ...rawIncoming, pins: realPins });

  const keyOf = (pin) => `${pin.id} ${pin.author}`;

  // ── pins: keyed last-write-wins per item, never drop stored items ──
  // Replies merge per-item (append-by-key) so concurrent reviewers never clobber each other's thread.
  const pinByKey = new Map();
  for (const pin of Array.isArray(base.pins) ? base.pins : []) pinByKey.set(keyOf(pin), pin);
  for (const pin of Array.isArray(incoming.pins) ? incoming.pins : []) {
    const k = keyOf(pin);
    const prev = pinByKey.get(k);
    if (prev && (Array.isArray(prev.replies) || Array.isArray(pin.replies))) {
      pinByKey.set(k, { ...pin, replies: mergeReplies(prev.replies, pin.replies) });
    } else {
      pinByKey.set(k, pin);
    }
  }

  // Delete markers: remove the matching item, author-scoped (silent no-op otherwise).
  for (const marker of deleteMarkers) {
    const k = keyOf(marker);
    const target = pinByKey.get(k);
    if (target && target.author === marker.author) pinByKey.delete(k);
  }

  const mergedPins = [...pinByKey.values()];

  // ── authors: union by name, contribution fields override ──
  const authorByName = new Map();
  for (const a of Array.isArray(base.authors) ? base.authors : []) {
    if (a && a.name) authorByName.set(a.name, { ...a });
  }
  for (const a of Array.isArray(incoming.authors) ? incoming.authors : []) {
    if (a && a.name) authorByName.set(a.name, { ...authorByName.get(a.name), ...a });
  }
  const mergedAuthors = [...authorByName.values()];

  // ── per-variant maps: merge key-by-key so a partial submit doesn't drop other variants ──
  const mergeMap = (a, b) => ({
    ...(a && typeof a === 'object' ? a : {}),
    ...(b && typeof b === 'object' ? b : {}),
  });

  const merged = {
    ...base,
    ...incoming,
    ratings: mergeMap(base.ratings, incoming.ratings),
    comments: mergeMap(base.comments, incoming.comments),
    pins: mergedPins,
    authors: mergedAuthors,
  };

  return merged;
}

export function assertValidFeedback(feedback) {
  assertValid(feedback, 'design-feedback');
  if (feedback.regenerated && !feedback.regenerateAction) {
    throw new Error('invalid design-feedback: regenerated=true requires regenerateAction');
  }
  return feedback;
}

/**
 * Read whichever feedback file the board produced.
 * @returns {{ kind: 'submit'|'pending', feedback: object }|null} null when neither file exists.
 */
export function readFeedback(boardDir) {
  const pendingPath = join(boardDir, PENDING_FILE);
  if (existsSync(pendingPath)) {
    const feedback = assertValidFeedback(JSON.parse(readFileSync(pendingPath, 'utf-8')));
    unlinkSync(pendingPath); // consumed on read — never double-applied
    return { kind: 'pending', feedback };
  }
  const submitPath = join(boardDir, FEEDBACK_FILE);
  if (existsSync(submitPath)) {
    const feedback = assertValidFeedback(JSON.parse(readFileSync(submitPath, 'utf-8')));
    return { kind: 'submit', feedback };
  }
  return null;
}
