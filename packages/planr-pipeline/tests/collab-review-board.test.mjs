/**
 * unit tests for the persistent, attributed feedback model.
 *
 * Covers the pure model layer in lib/design-engine/feedback.mjs:
 *   - generateStableId       — deterministic, content-keyed, 12-char hex
 *   - normalizeLegacy        — legacy (unattributed) → Anonymous + stable id + roster
 *   - mergeFeedback          — non-destructive, idempotent, two-author merge
 *   - schema validation      — merged + normalized output validates against the extended schema
 *
 * Zero third-party deps: node:test + node:assert + the in-repo schema validator.
 */

import assert from 'node:assert/strict';
import {
  readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../conformance/json-schema-validate.mjs';
import { createDaemon } from '../lib/design-engine/daemon.mjs';
import { openSse, isEvent } from './sse-client.mjs';
import {
  mergeFeedback,
  normalizeLegacy,
  generateStableId,
  isDeleteMarker,
  DEFAULT_AUTHOR,
} from '../lib/design-engine/feedback.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const feedbackSchema = JSON.parse(
  readFileSync(join(here, '..', 'schemas/v1.0.0/design-feedback.schema.json'), 'utf-8'),
);

/** The board id used across every fixture in this suite — one place to change it. */
const FIXED_BOARD_ID = 'collab-2026-06-17';

/** A minimal valid base store (no pins yet). */
const emptyStore = () => ({
  schema_version: '1.0.0',
  boardId: FIXED_BOARD_ID,
  publishedAt: '2026-06-17T10:00:00Z',
  regenerated: false,
  ratings: {},
  comments: {},
  pins: [],
});

const pin = (over) => ({
  variant: 's-dashboard',
  x: 0.1,
  y: 0.2,
  w: 0.05,
  h: 0.05,
  comment: 'tighten this spacing',
  intent: 'fix',
  ...over,
});

// ── generateStableId ──────────────────────────────────────────────────────

test('generateStableId: deterministic 12-char hex, content-keyed', () => {
  const a = generateStableId({ author: 'Dana', createdAt: '2026-06-17T10:00:00Z', comment: 'fix this' });
  const b = generateStableId({ author: 'Dana', createdAt: '2026-06-17T10:00:00Z', comment: 'fix this' });
  assert.equal(a, b, 'same content → same id (idempotent)');
  assert.equal(a.length, 12);
  assert.match(a, /^[0-9a-f]{12}$/, '12-char lowercase hex prefix');

  const diff = generateStableId({ author: 'Ravi', createdAt: '2026-06-17T10:00:00Z', comment: 'fix this' });
  assert.notEqual(a, diff, 'different author → different id');
});

// ── normalizeLegacy ───────────────────────────────────────────────────────

test('normalizeLegacy: legacy file with no id/author maps to Anonymous + stable id', () => {
  const legacy = {
    ...emptyStore(),
    pins: [pin({ comment: 'legacy note one' }), pin({ comment: 'legacy note two', intent: 'improve' })],
  };
  const norm = normalizeLegacy(legacy);

  for (const p of norm.pins) {
    assert.equal(p.author, DEFAULT_AUTHOR, 'unattributed pin → Anonymous');
    assert.match(p.id, /^[0-9a-f]{12}$/, 'stable id assigned');
  }
  // roster reconstructed from pins
  assert.deepEqual(norm.authors.map((a) => a.name), [DEFAULT_AUTHOR]);
});

test('normalizeLegacy: preserves all existing fields and does not mutate the input', () => {
  const legacy = {
    ...emptyStore(),
    overall: 'lean darker',
    ratings: { A: 4 },
    pins: [pin({ comment: 'keep my fields', screen: 's-hero' })],
  };
  const before = JSON.parse(JSON.stringify(legacy));
  const norm = normalizeLegacy(legacy);

  assert.deepEqual(legacy, before, 'input is not mutated (pure)');
  assert.equal(norm.overall, 'lean darker');
  assert.deepEqual(norm.ratings, { A: 4 });
  assert.equal(norm.pins[0].screen, 's-hero');
  assert.equal(norm.pins[0].comment, 'keep my fields');
});

test('normalizeLegacy: an existing id/author on a pin is left intact', () => {
  const attributed = {
    ...emptyStore(),
    pins: [pin({ id: 'deadbeef0001', author: 'Dana', comment: 'already attributed' })],
  };
  const norm = normalizeLegacy(attributed);
  assert.equal(norm.pins[0].id, 'deadbeef0001');
  assert.equal(norm.pins[0].author, 'Dana');
});

// ── mergeFeedback ─────────────────────────────────────────────────────────

test('mergeFeedback: two authors → both items preserved, neither overwritten', () => {
  const danaPin = pin({ author: 'Dana', createdAt: '2026-06-17T10:01:00Z', comment: 'dana fix' });
  const danaPinId = generateStableId(danaPin);
  const stored = {
    ...emptyStore(),
    authors: [{ name: 'Dana' }],
    pins: [{ ...danaPin, id: danaPinId }],
  };

  const raviPin = pin({ author: 'Ravi', createdAt: '2026-06-17T10:02:00Z', comment: 'ravi improve', intent: 'improve' });
  const contribution = {
    ...emptyStore(),
    authors: [{ name: 'Ravi', color: '--avatar-3' }],
    pins: [{ ...raviPin, id: generateStableId(raviPin) }],
  };

  const merged = mergeFeedback(stored, contribution);

  assert.equal(merged.pins.length, 2, 'both authors\' pins survive the merge');
  const byAuthor = merged.pins.map((p) => p.author).sort();
  assert.deepEqual(byAuthor, ['Dana', 'Ravi']);
  assert.equal(merged.authors.length, 2, 'both authors in the roster, once each');
  assert.ok(merged.authors.find((a) => a.name === 'Ravi').color === '--avatar-3', 'roster fields merged');
});

test('mergeFeedback: idempotent re-submit of the same item → exactly one pin', () => {
  const danaPin = pin({ author: 'Dana', createdAt: '2026-06-17T10:01:00Z', comment: 'same content' });
  const withId = { ...danaPin, id: generateStableId(danaPin) };
  const stored = { ...emptyStore(), authors: [{ name: 'Dana' }], pins: [withId] };

  const contribution = { ...emptyStore(), authors: [{ name: 'Dana' }], pins: [withId] };
  const once = mergeFeedback(stored, contribution);
  assert.equal(once.pins.length, 1, 'idempotent — no duplicate item');

  // a second pass over the result is still stable
  const twice = mergeFeedback(once, contribution);
  assert.equal(twice.pins.length, 1, 'still one item after a second merge');
});

test('mergeFeedback: editing an item is last-write-wins per item (no duplicate)', () => {
  const base = pin({ author: 'Dana', createdAt: '2026-06-17T10:01:00Z', comment: 'first take' });
  const id = generateStableId(base);
  const stored = { ...emptyStore(), authors: [{ name: 'Dana' }], pins: [{ ...base, id, status: 'open' }] };

  const edited = { ...base, id, status: 'resolved', intent: 'improve' };
  const contribution = { ...emptyStore(), authors: [{ name: 'Dana' }], pins: [edited] };
  const merged = mergeFeedback(stored, contribution);

  assert.equal(merged.pins.length, 1, 'edit replaces in place, no duplicate');
  assert.equal(merged.pins[0].status, 'resolved', 'last write wins per item');
  assert.equal(merged.pins[0].intent, 'improve');
});

test('mergeFeedback: a contribution never removes a stored item it omits', () => {
  const a = pin({ author: 'Dana', createdAt: '2026-06-17T10:01:00Z', comment: 'keep me' });
  const aId = generateStableId(a);
  const stored = { ...emptyStore(), authors: [{ name: 'Dana' }], pins: [{ ...a, id: aId }] };

  // contribution carries only Ravi's pin
  const b = pin({ author: 'Ravi', createdAt: '2026-06-17T10:05:00Z', comment: 'add me' });
  const contribution = { ...emptyStore(), authors: [{ name: 'Ravi' }], pins: [{ ...b, id: generateStableId(b) }] };

  const merged = mergeFeedback(stored, contribution);
  assert.ok(merged.pins.some((p) => p.id === aId), 'Dana\'s omitted pin is retained');
  assert.equal(merged.pins.length, 2);
});

test('mergeFeedback: per-variant ratings/comments merge key-by-key (no clobber)', () => {
  const stored = { ...emptyStore(), ratings: { A: 5 }, comments: { A: 'great' } };
  const contribution = { ...emptyStore(), ratings: { B: 3 }, comments: { B: 'meh' } };
  const merged = mergeFeedback(stored, contribution);
  assert.deepEqual(merged.ratings, { A: 5, B: 3 }, 'A rating survives, B added');
  assert.deepEqual(merged.comments, { A: 'great', B: 'meh' });
});

test('mergeFeedback: is pure — neither argument is mutated', () => {
  const stored = { ...emptyStore(), pins: [{ ...pin({ author: 'Dana', comment: 'x' }), id: 'aaaaaaaaaaaa' }] };
  const contribution = { ...emptyStore(), pins: [{ ...pin({ author: 'Ravi', comment: 'y' }), id: 'bbbbbbbbbbbb' }] };
  const storedBefore = JSON.parse(JSON.stringify(stored));
  const contribBefore = JSON.parse(JSON.stringify(contribution));

  mergeFeedback(stored, contribution);

  assert.deepEqual(stored, storedBefore, 'stored not mutated');
  assert.deepEqual(contribution, contribBefore, 'contribution not mutated');
});

// ── schema validation of the merged / normalized output ─────────────────────

test('mergeFeedback output validates against the extended design-feedback schema', () => {
  const danaPin = pin({ author: 'Dana', createdAt: '2026-06-17T10:01:00Z', comment: 'dana', status: 'open' });
  const raviPin = pin({
    author: 'Ravi',
    createdAt: '2026-06-17T10:02:00Z',
    comment: 'ravi',
    intent: 'question',
    status: 'resolved',
    replies: [{ author: 'Dana', comment: 'agreed', createdAt: '2026-06-17T10:03:00Z' }],
  });
  const stored = {
    ...emptyStore(),
    authors: [{ name: 'Dana', color: '--avatar-1', initials: 'D' }],
    pins: [{ ...danaPin, id: generateStableId(danaPin) }],
  };
  const contribution = {
    ...emptyStore(),
    authors: [{ name: 'Ravi', color: '--avatar-2', initials: 'R' }],
    pins: [{ ...raviPin, id: generateStableId(raviPin) }],
  };

  const merged = mergeFeedback(stored, contribution);
  const errs = validate(merged, feedbackSchema);
  assert.equal(errs.length, 0, `merged output should validate, got: ${JSON.stringify(errs)}`);
});

test('legacy file validates against the extended schema AFTER normalizeLegacy', () => {
  // a file written by the previous (unattributed) board version — no id/author on pins
  const legacy = {
    ...emptyStore(),
    pins: [pin({ comment: 'old note' }), pin({ comment: 'another old note', intent: 'question' })],
  };
  // raw legacy is missing required id/author → should NOT validate yet
  assert.ok(validate(legacy, feedbackSchema).length > 0, 'raw legacy lacks required id/author');

  const norm = normalizeLegacy(legacy);
  const errs = validate(norm, feedbackSchema);
  assert.equal(errs.length, 0, `normalized legacy should validate, got: ${JSON.stringify(errs)}`);
});

// ── daemon GET + merge-safe POST integration ─────────────────────────
//
// These exercise the real HTTP daemon (lib/design-engine/daemon.mjs) end-to-end:
//   - GET  /boards/<id>/api/feedback returns the durable record (empty when absent)
//   - POST /boards/<id>/api/feedback MERGES under the per-board mutex — two authors
//     (sequential AND async-parallel) both survive, neither clobbers the other.
// Zero third-party deps: node:test + global fetch + a tmp board dir.

/** Spin up a daemon on an ephemeral port with an isolated PLANR_HOME + board dir. */
async function startBoard() {
  const home = mkdtempSync(join(tmpdir(), 'planr-collab-home-'));
  const boardDir = mkdtempSync(join(tmpdir(), 'planr-collab-board-'));
  // The daemon requires board.html to exist before it will register the dir.
  writeFileSync(join(boardDir, 'board.html'), '<!doctype html><title>board</title>');

  const daemon = createDaemon({ env: { PLANR_HOME: home } });
  const port = await daemon.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const id = `collab--${'a'.repeat(24)}`;

  const reg = await fetch(`${base}/api/boards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, dir: boardDir }),
  });
  assert.equal(reg.status, 200, 'board registers');

  const cleanup = async () => {
    await daemon.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(boardDir, { recursive: true, force: true });
  };
  return { base, id, boardDir, cleanup };
}

/** A complete, schema-valid feedback contribution for one author's single pin. */
const contributionFor = (author, comment, over = {}) => ({
  schema_version: '1.0.0',
  boardId: FIXED_BOARD_ID,
  publishedAt: '2026-06-17T10:00:00Z',
  regenerated: false,
  ratings: {},
  comments: {},
  authors: [{ name: author }],
  pins: [
    {
      author,
      createdAt: `2026-06-17T10:0${Math.floor(Math.random() * 9)}:00Z`,
      variant: 's-dashboard',
      x: 0.1,
      y: 0.2,
      w: 0.05,
      h: 0.05,
      comment,
      intent: 'fix',
      ...over,
    },
  ],
});

const postFeedback = (base, id, feedback) =>
  fetch(`${base}/boards/${encodeURIComponent(id)}/api/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'submit', feedback }),
  });

const getFeedback = (base, id) =>
  fetch(`${base}/boards/${encodeURIComponent(id)}/api/feedback`).then((r) => r.json());

test('daemon GET /api/feedback returns an empty valid record before any submit', async () => {
  const { base, id, cleanup } = await startBoard();
  try {
    const res = await fetch(`${base}/boards/${encodeURIComponent(id)}/api/feedback`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { authors: [], items: [] }, 'no file yet → designed empty record');
  } finally {
    await cleanup();
  }
});

test('daemon: two sequential POSTs from different authors both survive + GET returns the merge', async () => {
  const { base, id, boardDir, cleanup } = await startBoard();
  try {
    const a = await postFeedback(base, id, contributionFor('Author A', 'A says fix this'));
    assert.equal(a.status, 200, 'Author A POST ok');
    // GET immediately after the first POST already reflects the merged record
    const afterA = await getFeedback(base, id);
    assert.equal(afterA.pins.length, 1, 'GET after first POST shows A\'s pin');
    assert.ok(afterA.pins.some((p) => p.author === 'Author A'));

    const b = await postFeedback(base, id, contributionFor('Author B', 'B says improve this', { intent: 'improve' }));
    assert.equal(b.status, 200, 'Author B POST ok');

    const merged = await getFeedback(base, id);
    const authors = merged.pins.map((p) => p.author).sort();
    assert.deepEqual(authors, ['Author A', 'Author B'], 'both authors\' pins survive — neither overwritten');
    assert.equal(merged.authors.length, 2, 'both authors in the roster, once each');

    // The durable file on disk is the source of truth and stays schema-valid.
    const onDisk = JSON.parse(readFileSync(join(boardDir, 'feedback.json'), 'utf-8'));
    assert.equal(validate(onDisk, feedbackSchema).length, 0, 'durable file validates against the schema');
    assert.equal(onDisk.pins.length, 2);
  } finally {
    await cleanup();
  }
});

test('daemon: async-parallel POSTs (Promise.all) do not corrupt the file or drop an item', async () => {
  const { base, id, boardDir, cleanup } = await startBoard();
  try {
    // Five distinct authors fire concurrently — the per-board mutex must serialize the
    // read-merge-write so the final file is valid JSON with every contribution present.
    const authors = ['A', 'B', 'C', 'D', 'E'];
    const results = await Promise.all(
      authors.map((name) => postFeedback(base, id, contributionFor(`Author ${name}`, `${name} pin`))),
    );
    for (const r of results) assert.equal(r.status, 200, 'every concurrent POST ok');

    const merged = await getFeedback(base, id);
    const got = merged.pins.map((p) => p.author).sort();
    assert.deepEqual(
      got,
      authors.map((n) => `Author ${n}`),
      'no missing item after concurrent merge',
    );

    // No JSON parse error: the durable file is well-formed and schema-valid.
    const raw = readFileSync(join(boardDir, 'feedback.json'), 'utf-8');
    const onDisk = JSON.parse(raw); // throws on corruption — that is the assertion
    assert.equal(onDisk.pins.length, authors.length, 'all 5 pins persisted, none clobbered');
    assert.equal(validate(onDisk, feedbackSchema).length, 0, 'concurrent-merged file still validates');
  } finally {
    await cleanup();
  }
});

test('daemon: a "pending" round is reconciled into the durable store, never destructively deleted', async () => {
  const { base, id, boardDir, cleanup } = await startBoard();
  try {
    // Seed a durable record + a leftover pending round on disk, then re-register the board
    // (which triggers reconcilePending). The pending pin must be merged in, not dropped.
    const stored = contributionFor('Author A', 'durable pin');
    writeFileSync(join(boardDir, 'feedback.json'), `${JSON.stringify(stored, null, 2)}\n`);
    const pending = contributionFor('Author B', 'pending pin', { intent: 'question' });
    writeFileSync(join(boardDir, 'feedback-pending.json'), `${JSON.stringify(pending, null, 2)}\n`);

    const reg = await fetch(`${base}/api/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, dir: boardDir }),
    });
    assert.equal(reg.status, 200);
    // Reconciliation is mutex-serialized + fire-and-forget on register; poll the durable
    // record until the pending author has been folded in (bounded — fails loudly otherwise).
    let merged;
    for (let i = 0; i < 50; i += 1) {
      merged = await getFeedback(base, id);
      if ((merged.pins ?? []).some((p) => p.author === 'Author B')) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const authors = merged.pins.map((p) => p.author).sort();
    assert.deepEqual(authors, ['Author A', 'Author B'], 'pending round folded into the durable store');

    // The pending file still exists (emptied, not deleted) so a stale round can't double-apply.
    const pendingRaw = JSON.parse(readFileSync(join(boardDir, 'feedback-pending.json'), 'utf-8'));
    assert.deepEqual(pendingRaw.pins, [], 'pending file emptied after reconciliation, not deleted destructively');
  } finally {
    await cleanup();
  }
});

// ── author identity is wired into the contribution submit path ────────
//
// The board client (lib/design-engine/board.mjs) stamps the reviewer's identity onto
// every outgoing contribution before POST /api/feedback: the per-pin `author` is the
// display-name STRING (the schema's pin.author + the daemon merge key), the per-pin
// `createdAt` anchors the stable id, and the full { name, initials, color } object lives
// once in the payload's authors[] roster. This mirrors that exact payload shape and
// asserts the attribution survives into the stored feedback file.

/** A board-client-shaped, attributed submit payload (mirrors board.mjs payload()). */
const attributedContribution = (name, comment, initials, color) => ({
  schema_version: '1.0.0',
  boardId: FIXED_BOARD_ID,
  publishedAt: '2026-06-17T10:00:00Z',
  regenerated: false,
  ratings: {},
  comments: {},
  // authors[] roster: the full { name, initials, color } object, once per author.
  authors: [{ name, initials, color, lastSeen: '2026-06-17T10:00:00Z' }],
  pins: [
    {
      author: name,
      createdAt: '2026-06-17T10:01:00Z',
      variant: 's-dashboard',
      x: 0.1,
      y: 0.2,
      w: 0.05,
      h: 0.05,
      comment,
      intent: 'fix',
    },
  ],
});

test('a POSTed item carries author + createdAt, and the authors roster carries name/initials/color in the stored file', async () => {
  const { base, id, boardDir, cleanup } = await startBoard();
  try {
    const fb = attributedContribution('Alice Chen', 'tighten this spacing', 'AC', '#4f46e5');

    // Pre-condition: the simulated POST payload itself carries the full attribution the
    // board client stamps on (author.name + initials + color in the roster, createdAt on the pin).
    assert.equal(fb.authors[0].name, 'Alice Chen', 'payload roster carries author.name');
    assert.equal(fb.authors[0].initials, 'AC', 'payload roster carries author.initials');
    assert.equal(fb.authors[0].color, '#4f46e5', 'payload roster carries author.color');
    assert.equal(fb.pins[0].author, 'Alice Chen', 'payload pin carries author (display name)');
    assert.ok(fb.pins[0].createdAt, 'payload pin carries createdAt');

    const res = await postFeedback(base, id, fb);
    assert.equal(res.status, 200, 'attributed submit accepted');

    // The stored feedback file is the durable record — the attribution must survive into it.
    const onDisk = JSON.parse(readFileSync(join(boardDir, 'feedback.json'), 'utf-8'));
    assert.equal(validate(onDisk, feedbackSchema).length, 0, 'stored file validates against the schema');

    const storedPin = onDisk.pins.find((p) => p.comment === 'tighten this spacing');
    assert.ok(storedPin, 'the POSTed pin is in the stored file');
    assert.equal(storedPin.author, 'Alice Chen', 'stored pin carries author.name (the display name)');
    assert.ok(storedPin.createdAt, 'stored pin carries createdAt');
    assert.match(storedPin.id, /^[0-9a-f]{12}$/, 'stored pin has a stable id');

    const rosterEntry = onDisk.authors.find((a) => a.name === 'Alice Chen');
    assert.ok(rosterEntry, 'the author appears once in the authors roster');
    assert.equal(rosterEntry.name, 'Alice Chen', 'roster carries author.name');
    assert.equal(rosterEntry.initials, 'AC', 'roster carries author.initials');
    assert.equal(rosterEntry.color, '#4f46e5', 'roster carries author.color');

    // GET drives the authors-seen cluster on the next load — the roster must be returned too.
    const reloaded = await getFeedback(base, id);
    assert.ok(
      (reloaded.authors ?? []).some((a) => a.name === 'Alice Chen'),
      'GET returns the authors roster that drives the top-bar seen cluster',
    );
  } finally {
    await cleanup();
  }
});

// ── pin-drop wire-up — load on open + persist each drop (round-trip) ──────
//
// The board client (lib/design-engine/board.mjs) now POSTs each dropped pin to
// /api/feedback as a single-pin merge contribution carrying the fully-attributed item
// payload — { id, author, x, y, w, h, intent, comment, status:'open', createdAt, replies:[] }
// — with the reviewer's authors[] roster entry, computing the stable id client-side with
// the SAME sha256(author\ncreatedAt\ncomment) prefix the daemon derives. These tests mirror
// that exact wire payload against the real HTTP daemon and prove the load + persist round-trip:
//   - GET /api/feedback after a drop contains the pin with all fields intact;
//   - the pin survives a refresh / re-serve (a fresh GET, and re-register, both see it);
//   - the client-computed id equals the daemon's canonical id (idempotent re-submit → no dup).

/** The exact single-pin merge contribution the board client POSTs on a pin drop. */
const droppedPinContribution = (name, item) => ({
  schema_version: '1.0.0',
  boardId: FIXED_BOARD_ID,
  publishedAt: '2026-06-17T10:00:00Z',
  regenerated: false,
  ratings: {},
  comments: {},
  authors: [{ name, initials: 'DR', color: '#4f46e5', lastSeen: '2026-06-17T10:00:00Z' }],
  pins: [item],
});

/** A fully-attributed dropped-pin item — the shape the board builds at click time. */
const droppedItem = (name, comment, over = {}) => ({
  id: generateStableId({ author: name, createdAt: '2026-06-17T10:01:00Z', comment }),
  author: name,
  variant: 's-dashboard',
  x: 0.42,
  y: 0.18,
  w: 0,
  h: 0,
  comment,
  intent: 'improve',
  status: 'open',
  createdAt: '2026-06-17T10:01:00Z',
  replies: [],
  ...over,
});

test('a dropped pin POSTed to /api/feedback is returned by a subsequent GET with all fields intact', async () => {
  const { base, id, cleanup } = await startBoard();
  try {
    // Open: before any drop, GET returns the designed empty record (the load half).
    const initial = await getFeedback(base, id);
    assert.deepEqual(initial, { authors: [], items: [] }, 'open on an empty board → designed empty record');

    const item = droppedItem('Dana Reviewer', 'lift the contrast on this label', { screen: 's-dashboard' });
    const res = await postFeedback(base, id, droppedPinContribution('Dana Reviewer', item));
    assert.equal(res.status, 200, 'pin-drop POST accepted');
    const posted = await res.json();
    assert.ok(posted.feedback, 'daemon returns the merged durable record on a drop');

    // GET after the drop carries the pin with every field intact.
    const after = await getFeedback(base, id);
    const stored = after.pins.find((p) => p.comment === 'lift the contrast on this label');
    assert.ok(stored, 'the dropped pin is loaded by GET /api/feedback');
    assert.equal(stored.author, 'Dana Reviewer', 'author intact');
    assert.equal(stored.intent, 'improve', 'intent intact');
    assert.equal(stored.status, 'open', 'status intact');
    assert.equal(stored.createdAt, '2026-06-17T10:01:00Z', 'createdAt intact');
    assert.equal(stored.x, 0.42, 'x intact'); assert.equal(stored.y, 0.18, 'y intact');
    assert.deepEqual(stored.replies, [], 'replies intact');
    assert.match(stored.id, /^[0-9a-f]{12}$/, 'stable id present');
    assert.equal(stored.id, item.id, 'the client-computed id is the daemon\'s canonical id (idempotent)');

    // The roster the GET returns drives the authors-seen cluster on the next load.
    assert.ok((after.authors ?? []).some((a) => a.name === 'Dana Reviewer'), 'author in the returned roster');
  } finally {
    await cleanup();
  }
});

test('a pin persists across a refresh and a board re-serve (load on open never starts empty)', async () => {
  const { base, id, boardDir, cleanup } = await startBoard();
  try {
    const item = droppedItem('Dana Reviewer', 'persist me across refresh');
    const res = await postFeedback(base, id, droppedPinContribution('Dana Reviewer', item));
    assert.equal(res.status, 200, 'pin-drop POST accepted');

    // "Refresh the tab" = a fresh GET against the same daemon — the pin is still there.
    const afterRefresh = await getFeedback(base, id);
    assert.ok(
      afterRefresh.pins.some((p) => p.comment === 'persist me across refresh'),
      'a refresh (re-GET) re-loads the dropped pin — the board is never empty',
    );

    // "Re-serve the board" = re-register the same dir (a new daemon would read the same file).
    const reg = await fetch(`${base}/api/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, dir: boardDir }),
    });
    assert.equal(reg.status, 200, 'board re-registers');
    const afterReserve = await getFeedback(base, id);
    assert.ok(
      afterReserve.pins.some((p) => p.comment === 'persist me across refresh'),
      'the pin survives a re-serve — the durable file is the source of truth',
    );

    // The durable file on disk holds the pin and validates against the schema.
    const onDisk = JSON.parse(readFileSync(join(boardDir, 'feedback.json'), 'utf-8'));
    assert.equal(validate(onDisk, feedbackSchema).length, 0, 'durable file validates against the schema');
    assert.ok(onDisk.pins.some((p) => p.comment === 'persist me across refresh'));
  } finally {
    await cleanup();
  }
});

test('dropping a second pin merges in without clobbering the first (per-pin POST is non-destructive)', async () => {
  const { base, id, cleanup } = await startBoard();
  try {
    const first = droppedItem('Dana Reviewer', 'first dropped pin');
    await postFeedback(base, id, droppedPinContribution('Dana Reviewer', first));

    // A second drop POSTs ONLY the new pin (the client sends a single-pin contribution);
    // the non-destructive daemon merge must keep the first pin.
    const second = droppedItem('Dana Reviewer', 'second dropped pin', { intent: 'question' });
    const res = await postFeedback(base, id, droppedPinContribution('Dana Reviewer', second));
    assert.equal(res.status, 200);

    const after = await getFeedback(base, id);
    const comments = after.pins.map((p) => p.comment).sort();
    assert.deepEqual(
      comments,
      ['first dropped pin', 'second dropped pin'],
      'both dropped pins survive — a single-pin POST never wipes the earlier pin',
    );

    // Idempotent: re-POSTing the identical first pin does not duplicate it.
    await postFeedback(base, id, droppedPinContribution('Dana Reviewer', first));
    const afterDup = await getFeedback(base, id);
    assert.equal(afterDup.pins.length, 2, 're-submitting an unchanged pin is a no-op (idempotent)');
  } finally {
    await cleanup();
  }
});

// ── feedback rail / inbox + detail card render ───────
//
// The board client (lib/design-engine/board.mjs) renders the persistent right rail
// (header + filter bar + grouped items) and the pin detail card (author, intent badge,
// comment, reply thread, reply input, Resolve). These render checks assert the inbox /
// thread structure ships, that the wiring functions exist, that the palette stays on the
// tokens (no off-palette hex in the feedback-rail CSS), and that a reply payload the card POSTs is
// schema-valid + merges non-destructively against the real daemon.

const { renderBoardHtml } = await import('../lib/design-engine/board.mjs');
const boardHtml = () => renderBoardHtml({
  boardId: FIXED_BOARD_ID,
  title: 'collab review',
  mode: 'review',
  variants: [{ id: 'A', label: 'screen', src: 'a.svg', type: 'svg' }],
});

test('the board ships the feedback rail — header, filter bar, grouped items', () => {
  const html = boardHtml();
  for (const hook of [
    'rb-feedback-rail', 'rb-rail-header', 'rb-rail-title', 'rbRailOpenCount', 'rbRailResolvedChip',
    'rb-filter-bar', 'rbFilterBar', 'rb-rail-list', 'rbRailList',
    'rb-filter-chip', 'rb-filter-chip--active', 'rb-rail-item', 'rb-rail-item--active',
  ]) {
    assert.ok(html.includes(hook), `feedback rail ships ${hook}`);
  }
  // CSS classes the filter/item list need at runtime (built in JS) are present in the stylesheet.
  for (const cls of ['rb-badge--fix', 'rb-badge--improve', 'rb-badge--question', 'rb-badge--open', 'rb-badge--resolved']) {
    assert.ok(html.includes(cls), `intent/status badge class ${cls} is styled`);
  }
});

test('the board ships the detail card — thread, reply input, resolve, delete', () => {
  const html = boardHtml();
  for (const hook of [
    'rb-detail-card', 'rbDetailCard', 'rb-thread-list', 'rbThreadList',
    'rb-reply-input', 'rbReplyText', 'rbReplySend', 'rb-resolve-btn', 'rbResolveBtn',
    'rb-delete-btn', 'rbDeleteBtn', 'rbDetailClose',
  ]) {
    assert.ok(html.includes(hook), `detail card ships ${hook}`);
  }
  // detail card caps at 600px with an internal scroll (DoD)
  assert.match(html, /\.rb-detail-card\s*\{[^}]*max-height:600px/, 'detail card caps at 600px');
  assert.match(html, /\.rb-detail-body\s*\{[^}]*overflow-y:auto/, 'detail body scrolls internally');
});

test('two-way selection + lifecycle wiring functions are present in the client', () => {
  const html = boardHtml();
  for (const fn of [
    'function renderRail', 'function selectPin', 'function selectRailItem',
    'function openDetailCard', 'function submitReply', 'function resolvePin', 'function deletePin',
  ]) {
    assert.ok(html.includes(fn), `client wires ${fn}`);
  }
  // container-query reflow (rail moves below the stage on narrow widths)
  assert.ok(html.includes('@container rb-screen (max-width: 1023px)'), 'rail reflows ≤1023px');
});

test('the rail/detail CSS stays on the palette tokens (no off-palette raw hex)', () => {
  const html = boardHtml();
  // isolate the feedback-rail CSS section (from its banner to </style>) and assert no raw
  // hex literals appear in its rule bodies — every colour is a var(--rb-*)/var(--pin-*) token.
  const start = html.indexOf('feedback rail / inbox');
  assert.ok(start > 0, 'feedback-rail CSS section is present');
  const end = html.indexOf('</style>', start);
  const section = html.slice(start, end);
  const rawHex = section.match(/#[0-9a-fA-F]{3,6}\b/g) || [];
  assert.equal(rawHex.length, 0, `feedback-rail CSS uses only palette tokens, found raw hex: ${rawHex.join(', ')}`);
});

test('a reply the detail card POSTs is schema-valid and merges non-destructively', async () => {
  const { base, id, boardDir, cleanup } = await startBoard();
  try {
    // seed a durable pin (Dana), then submit the FULL item with a reply appended (the exact
    // single-item merge contribution submitReply builds) and assert the thread persists.
    const item = droppedItem('Dana Reviewer', 'thread me');
    await postFeedback(base, id, droppedPinContribution('Dana Reviewer', item));

    const replied = {
      ...item,
      replies: [{ author: 'Ravi', comment: 'on it', createdAt: '2026-06-17T11:00:00Z' }],
    };
    const contribution = {
      schema_version: '1.0.0',
      boardId: FIXED_BOARD_ID,
      publishedAt: '2026-06-17T11:00:00Z',
      regenerated: false,
      ratings: {},
      comments: {},
      authors: [{ name: 'Ravi', initials: 'R', color: '#0e7490', lastSeen: '2026-06-17T11:00:00Z' }],
      pins: [replied],
    };
    assert.equal(validate(contribution, feedbackSchema).length, 0, 'reply contribution is schema-valid');

    const res = await postFeedback(base, id, contribution);
    assert.equal(res.status, 200, 'reply POST accepted');

    const after = await getFeedback(base, id);
    const stored = after.pins.find((p) => p.comment === 'thread me');
    assert.ok(stored, 'the pin survives the reply merge (non-destructive)');
    assert.equal(stored.replies.length, 1, 'reply appended to the thread');
    assert.equal(stored.replies[0].comment, 'on it');
    assert.equal(after.pins.length, 1, 'no duplicate pin — last-write-wins per item');
  } finally {
    await cleanup();
  }
});

test('resolve sets status to resolved and persists, leaving other items intact', async () => {
  const { base, id, cleanup } = await startBoard();
  try {
    const a = droppedItem('Dana Reviewer', 'resolve me', { intent: 'fix' });
    const b = droppedItem('Dana Reviewer', 'keep me open', { intent: 'improve' });
    await postFeedback(base, id, droppedPinContribution('Dana Reviewer', a));
    await postFeedback(base, id, droppedPinContribution('Dana Reviewer', b));

    // resolvePin POSTs the full item with status:'resolved'.
    const resolved = { ...a, status: 'resolved' };
    const res = await postFeedback(base, id, droppedPinContribution('Dana Reviewer', resolved));
    assert.equal(res.status, 200, 'resolve POST accepted');

    const after = await getFeedback(base, id);
    const r = after.pins.find((p) => p.comment === 'resolve me');
    const open = after.pins.find((p) => p.comment === 'keep me open');
    assert.equal(r.status, 'resolved', 'the resolved pin persists status=resolved');
    assert.notEqual(open.status, 'resolved', 'the other pin stays open (resolve is per-item)');
    assert.equal(after.pins.length, 2, 'no item dropped by the resolve merge');
  } finally {
    await cleanup();
  }
});

// ── reply / resolve / delete persistence round-trips ─────────────────────
//
// Lifecycle WRITE operations must survive the full board↔daemon round-trip:
//   - reply append persists into the thread and is idempotent (re-POST → one entry);
//   - status updates persist last-write-wins per item (resolve, then re-open);
//   - a delete marker { id, author, deleted:true } removes ONLY the marker-author's own item;
//     another author's delete is a silent no-op (their item remains).
// These exercise the pure mergeFeedback() model AND the real HTTP daemon end-to-end.

/** The board client's delete-marker contribution: { id, author, deleted:true } as the only pin. */
const deleteMarkerContribution = (name, item) => ({
  schema_version: '1.0.0',
  boardId: FIXED_BOARD_ID,
  publishedAt: '2026-06-17T12:00:00Z',
  regenerated: false,
  ratings: {},
  comments: {},
  authors: [{ name }],
  pins: [{ id: item.id, author: item.author, deleted: true }],
});

// ── unit: mergeFeedback delete-marker + reply-append behaviour ────────────────

test('isDeleteMarker flags { deleted:true } and ignores real pins', () => {
  assert.equal(isDeleteMarker({ id: 'x', author: 'A', deleted: true }), true);
  assert.equal(isDeleteMarker(pin({ author: 'A', comment: 'real' })), false);
  assert.equal(isDeleteMarker(null), false);
});

test('mergeFeedback removes an item on the OWNER\'s delete marker only', () => {
  const danaPin = pin({ author: 'Dana', createdAt: '2026-06-17T10:01:00Z', comment: 'dana item' });
  const danaId = generateStableId(danaPin);
  const stored = {
    ...emptyStore(),
    authors: [{ name: 'Dana' }],
    pins: [{ ...danaPin, id: danaId }],
  };

  // Dana deletes Dana's own item → removed.
  const ownDelete = { ...emptyStore(), authors: [{ name: 'Dana' }], pins: [{ id: danaId, author: 'Dana', deleted: true }] };
  const afterOwn = mergeFeedback(stored, ownDelete);
  assert.equal(afterOwn.pins.length, 0, 'owner delete removes the item');

  // Ravi tries to delete Dana's item (same id, wrong author) → no-op, item stays.
  const foreignDelete = { ...emptyStore(), authors: [{ name: 'Ravi' }], pins: [{ id: danaId, author: 'Ravi', deleted: true }] };
  const afterForeign = mergeFeedback(stored, foreignDelete);
  assert.equal(afterForeign.pins.length, 1, 'a non-owner cannot delete another reviewer\'s item');
  assert.equal(afterForeign.pins[0].author, 'Dana');
});

test('mergeFeedback appends new replies and is idempotent by reply signature', () => {
  const base = pin({ author: 'Dana', createdAt: '2026-06-17T10:01:00Z', comment: 'thread' });
  const id = generateStableId(base);
  const stored = {
    ...emptyStore(),
    authors: [{ name: 'Dana' }],
    pins: [{ ...base, id, replies: [{ author: 'Dana', comment: 'first', createdAt: '2026-06-17T10:02:00Z' }] }],
  };

  // a NEW reply (different content) is appended to the thread, not clobbering the first
  const withSecond = {
    ...emptyStore(),
    authors: [{ name: 'Ravi' }],
    pins: [{ ...base, id, replies: [{ author: 'Ravi', comment: 'second', createdAt: '2026-06-17T10:03:00Z' }] }],
  };
  const merged = mergeFeedback(stored, withSecond);
  assert.equal(merged.pins.length, 1, 'one pin');
  assert.equal(merged.pins[0].replies.length, 2, 'new reply appended, the first preserved');
  assert.deepEqual(merged.pins[0].replies.map((r) => r.comment), ['first', 'second']);

  // re-merging the same contribution is idempotent — no duplicate reply
  const again = mergeFeedback(merged, withSecond);
  assert.equal(again.pins[0].replies.length, 2, 're-posting the same reply is a no-op (idempotent)');
});

// ── reply append persists + idempotent (HTTP round-trip) ─────────────

test('a reply POSTed for a pin persists and a re-POST of the same reply is idempotent', async () => {
  const { base, id, cleanup } = await startBoard();
  try {
    const item = droppedItem('Dana Reviewer', 'reply round-trip');
    await postFeedback(base, id, droppedPinContribution('Dana Reviewer', item));

    const reply = { author: 'Ravi', comment: 'looking at it', createdAt: '2026-06-17T11:00:00Z' };
    const replied = { ...item, replies: [reply] };
    const res = await postFeedback(base, id, droppedPinContribution('Ravi', replied));
    assert.equal(res.status, 200, 'reply POST accepted');

    const after = await getFeedback(base, id);
    const stored = after.pins.find((p) => p.comment === 'reply round-trip');
    assert.ok(stored, 'the pin survives the reply merge');
    assert.equal(stored.replies.length, 1, 'reply appended to the thread');
    assert.equal(stored.replies[0].comment, 'looking at it');

    // POST the SAME reply again (same author/comment/createdAt) → no duplicate entry (idempotent).
    const dup = await postFeedback(base, id, droppedPinContribution('Ravi', { ...item, replies: [reply] }));
    assert.equal(dup.status, 200);
    const afterDup = await getFeedback(base, id);
    const storedDup = afterDup.pins.find((p) => p.comment === 'reply round-trip');
    assert.equal(storedDup.replies.length, 1, 're-posting the identical reply is a no-op (idempotent)');
    assert.equal(afterDup.pins.length, 1, 'no duplicate pin');
  } finally {
    await cleanup();
  }
});

// ── status update persists last-write-wins per item ──────────────────

test('POST status:resolved persists, then POST status:open reverts (last-write-wins per item)', async () => {
  const { base, id, cleanup } = await startBoard();
  try {
    const item = droppedItem('Dana Reviewer', 'flip my status', { status: 'open' });
    await postFeedback(base, id, droppedPinContribution('Dana Reviewer', item));

    // resolve
    const resolved = { ...item, status: 'resolved' };
    assert.equal((await postFeedback(base, id, droppedPinContribution('Dana Reviewer', resolved))).status, 200);
    let after = await getFeedback(base, id);
    assert.equal(after.pins.find((p) => p.comment === 'flip my status').status, 'resolved', 'resolved persists');

    // re-open — last write wins per item
    const reopened = { ...item, status: 'open' };
    assert.equal((await postFeedback(base, id, droppedPinContribution('Dana Reviewer', reopened))).status, 200);
    after = await getFeedback(base, id);
    assert.equal(after.pins.find((p) => p.comment === 'flip my status').status, 'open', 'status reverts to open (last-write-wins)');
    assert.equal(after.pins.length, 1, 'still one item — status edits never duplicate');
  } finally {
    await cleanup();
  }
});

// ── delete removes only own item; another author's delete is rejected ─

test('an author deletes their own pin; a foreign delete marker is a no-op', async () => {
  const { base, id, boardDir, cleanup } = await startBoard();
  try {
    // P1 owned by Author A, P2 owned by Author B.
    const p1 = droppedItem('Author A', 'A owns P1', { createdAt: '2026-06-17T10:01:00Z' });
    const p2 = droppedItem('Author B', 'B owns P2', { createdAt: '2026-06-17T10:02:00Z' });
    await postFeedback(base, id, droppedPinContribution('Author A', p1));
    await postFeedback(base, id, droppedPinContribution('Author B', p2));

    // Author A deletes their OWN P1 → P1 absent after the merge.
    const delOwn = await postFeedback(base, id, deleteMarkerContribution('Author A', p1));
    assert.equal(delOwn.status, 200, 'own-item delete marker accepted');
    let after = await getFeedback(base, id);
    assert.ok(!after.pins.some((p) => p.comment === 'A owns P1'), 'P1 removed by its owner');
    assert.ok(after.pins.some((p) => p.comment === 'B owns P2'), 'P2 untouched');

    // Author A POSTs a delete marker for P2 (owned by Author B) → no-op, P2 still present.
    const delForeign = await postFeedback(base, id, deleteMarkerContribution('Author A', { id: p2.id, author: 'Author A' }));
    assert.equal(delForeign.status, 200, 'a foreign delete marker is accepted but is a no-op');
    after = await getFeedback(base, id);
    assert.ok(after.pins.some((p) => p.comment === 'B owns P2'), 'a non-owner cannot delete another author\'s item');
    assert.equal(after.pins.length, 1, 'only P2 remains');

    // The durable file is still valid (delete markers are never written verbatim).
    const onDisk = JSON.parse(readFileSync(join(boardDir, 'feedback.json'), 'utf-8'));
    assert.equal(validate(onDisk, feedbackSchema).length, 0, 'durable file still validates after deletes');
    assert.ok(!onDisk.pins.some((p) => p.deleted), 'no delete marker is ever stored in the durable file');
  } finally {
    await cleanup();
  }
});

// ── daemon SSE stream — presence join/leave + feedback:update fan-out ─────
//
// The daemon exposes GET /api/feedback/stream (text/event-stream). It keeps an in-memory
// per-board registry of connected response streams and pushes named SSE events:
//   - presence:join  → emitted to the OTHER clients when a tab connects (carries the
//                      deduplicated roster of who is viewing now);
//   - presence:leave → emitted to the REMAINING clients when a tab disconnects;
//   - feedback:update→ emitted to ALL clients after a successful POST /api/feedback merge,
//                      carrying only the single changed item (not the whole file).
// Identity is a LOCAL display name + avatar passed as ?name=&initials=&color= — no auth/PII.
// Same-name dedup: two tabs by the same reviewer collapse to ONE presence entry.
// The SSE test client (openSse + isEvent) lives in ./sse-client.mjs — pure stdlib, no third-party deps.

test('a second SSE client connecting triggers presence:join on the first', async () => {
  const { base, id, cleanup } = await startBoard();
  let a; let b;
  try {
    a = openSse(base, id, { name: 'Reviewer A', initials: 'RA', color: '--avatar-1' });
    await a.ready;

    b = openSse(base, id, { name: 'Reviewer B', initials: 'RB', color: '--avatar-2' });
    await b.ready;

    // The FIRST client receives a presence:join carrying the deduplicated roster that now
    // includes the second viewer. The joining client never gets its own join event.
    const join = await a.waitFor(isEvent('presence:join'), { label: 'presence:join on A' });
    const names = (join.data.roster ?? []).map((r) => r.name).sort();
    assert.ok(names.includes('Reviewer B'), 'A sees B join the presence roster');
    const rosterB = join.data.roster.find((r) => r.name === 'Reviewer B');
    assert.equal(rosterB.initials, 'RB', 'roster carries the avatar initials');
    assert.equal(rosterB.color, '--avatar-2', 'roster carries the avatar color');
    assert.equal(b.events.filter(isEvent('presence:join')).length, 0, 'B does not receive its own join');
  } finally {
    a?.close();
    b?.close();
    await cleanup();
  }
});

test('same reviewer with two tabs is deduplicated to one presence entry (by name)', async () => {
  const { base, id, cleanup } = await startBoard();
  let watcher; let tab1; let tab2;
  try {
    watcher = openSse(base, id, { name: 'Watcher', initials: 'W', color: '--avatar-5' });
    await watcher.ready;

    // The SAME reviewer opens two tabs — both connect, but presence must collapse to one avatar.
    tab1 = openSse(base, id, { name: 'Dana', initials: 'D', color: '--avatar-3' });
    await tab1.ready;
    await watcher.waitFor(isEvent('presence:join'), { label: 'join for Dana tab 1' });

    tab2 = openSse(base, id, { name: 'Dana', initials: 'D', color: '--avatar-3' });
    await tab2.ready;
    // Wait until the watcher has seen two join events (one per tab connecting).
    await watcher.waitFor(
      () => watcher.events.filter(isEvent('presence:join')).length >= 2,
      { label: 'second join' },
    );

    const lastJoin = watcher.events.filter(isEvent('presence:join')).at(-1);
    const danaEntries = (lastJoin.data.roster ?? []).filter((r) => r.name === 'Dana');
    assert.equal(danaEntries.length, 1, 'two tabs by the same reviewer surface as one presence entry');
  } finally {
    tab1?.close();
    tab2?.close();
    watcher?.close();
    await cleanup();
  }
});

test('a successful POST /api/feedback emits feedback:update to all connected clients', async () => {
  const { base, id, cleanup } = await startBoard();
  let a; let b;
  try {
    a = openSse(base, id, { name: 'Reviewer A', initials: 'RA', color: '--avatar-1' });
    b = openSse(base, id, { name: 'Reviewer B', initials: 'RB', color: '--avatar-2' });
    await Promise.all([a.ready, b.ready]);
    // Let the join handshake settle so both streams are registered before the POST.
    await a.waitFor(isEvent('presence:join'), { label: 'A sees B join' });

    const item = droppedItem('Reviewer B', 'live-synced pin', { screen: 's-dashboard' });
    const res = await postFeedback(base, id, droppedPinContribution('Reviewer B', item));
    assert.equal(res.status, 200, 'POST accepted');

    // Both connected clients must receive feedback:update carrying ONLY the changed item.
    const [evA, evB] = await Promise.all([
      a.waitFor(isEvent('feedback:update'), { label: 'feedback:update on A' }),
      b.waitFor(isEvent('feedback:update'), { label: 'feedback:update on B' }),
    ]);
    assert.equal(evA.data.item.comment, 'live-synced pin', 'A receives the merged item');
    assert.equal(evB.data.item.comment, 'live-synced pin', 'B receives the merged item');
    assert.equal(evA.data.item.id, item.id, 'the broadcast carries the canonical merged item id');
    assert.equal(evA.data.item.author, 'Reviewer B', 'attribution rides the live update');
    // The event is the single item delta, not the entire file (no pins[]/authors[] envelope).
    assert.ok(!Array.isArray(evA.data.pins), 'feedback:update carries only the changed item, not the whole record');
  } finally {
    a?.close();
    b?.close();
    await cleanup();
  }
});

test('when a client disconnects, the remaining client receives presence:leave', async () => {
  const { base, id, cleanup } = await startBoard();
  let a; let b;
  try {
    a = openSse(base, id, { name: 'Reviewer A', initials: 'RA', color: '--avatar-1' });
    await a.ready;
    b = openSse(base, id, { name: 'Reviewer B', initials: 'RB', color: '--avatar-2' });
    await b.ready;
    await a.waitFor(isEvent('presence:join'), { label: 'A sees B join' });

    // B closes its tab → A must be told B left, with the post-leave deduplicated roster.
    b.close();
    const leave = await a.waitFor(isEvent('presence:leave'), { label: 'presence:leave on A' });
    const names = (leave.data.roster ?? []).map((r) => r.name);
    assert.ok(!names.includes('Reviewer B'), 'B is gone from the roster after disconnect');
    assert.ok(names.includes('Reviewer A'), 'A (still connected) remains in the roster');
  } finally {
    a?.close();
    b?.close();
    await cleanup();
  }
});

// ── Show / Hide pins overlay toggle (board render) ────────────────────
//
// US-004 primary AC: a single, always-discoverable Show/Hide toggle hides or shows the
// entire pin overlay, is keyboard-accessible, and the state is preserved for the session.
// This closes the one render-level coverage gap (the persistence + lifecycle paths are
// already covered by the pin-drop and delete round-trips). The toggle is a role=switch button
// (Space/Enter operable, aria-checked mirrors visibility); the floating "Show pins" bar is
// the no-dead-end re-entry when the overlay is hidden. Assert the markup + the wiring fns.

test('the board ships a keyboard-accessible Show/Hide pins toggle (role=switch + aria-checked)', () => {
  const html = boardHtml();

  // The top-bar toggle: a real button with role=switch and aria-checked (keyboard operable).
  assert.ok(html.includes('id="rbPinsToggle"'), 'show/hide pins toggle ships');
  const toggle = html.slice(html.indexOf('id="rbPinsToggle"') - 80, html.indexOf('id="rbPinsToggle"') + 120);
  assert.ok(/role="switch"/.test(toggle), 'the toggle is role=switch (keyboard accessible)');
  assert.ok(/aria-checked=/.test(toggle), 'aria-checked mirrors pin visibility for AT');

  // The floating re-entry bar (no dead end when pins are hidden) + its keyboard-operable button.
  for (const hook of ['rb-pins-hidden-bar', 'rbPinsHiddenBar', 'rbHiddenCount', 'id="rbShowPins"']) {
    assert.ok(html.includes(hook), `hidden-pins re-entry bar ships ${hook}`);
  }

  // The wiring: a togglePins() function flips state and the session-remembered flag.
  assert.ok(html.includes('function togglePins'), 'client wires togglePins()');
  assert.ok(html.includes('pinsHidden'), 'visibility is tracked as a session flag (preserved for the session)');
});

// ── premium designed states + accessibility (board render) ────────────
//
// US-007 primary AC: every state — empty (no feedback), loading, save failure, stream
// down, all-resolved — shows a designed, actionable surface (never a blank screen, silent
// loss, or dead end), and the board respects prefers-reduced-motion. These are render-level
// assertions against the static board HTML so they stay deterministic and $0.

test('the board ships every designed no-dead-end state (empty / loading / offline / save-fail / all-resolved)', () => {
  const html = boardHtml();

  // empty (first-pin invite) — the DESIGN stays visible; the invitation lives in the feedback
  // rail, never as a full-stage overlay that hides the design.
  assert.ok(!html.includes('id="rbEmptyStage"'), 'no full-stage empty overlay (the design is always visible)');
  assert.ok(html.includes('No feedback yet'), 'the rail invites the first pin');

  // loading skeleton — no blank white flash during the GET flight.
  assert.ok(html.includes('id="rbSkeletonStage"'), 'loading skeleton ships');
  assert.ok(html.includes('rb-skeleton--block'), 'skeleton blocks are present');

  // stream-down / offline badge — board stays usable, re-syncs on reconnect.
  assert.ok(html.includes('id="rbOfflineBadge"'), 'offline (stream-down) badge ships');
  const offline = html.slice(html.indexOf('id="rbOfflineBadge"') - 60, html.indexOf('id="rbOfflineBadge"') + 80);
  assert.ok(/role="status"/.test(offline) && /aria-live=/.test(offline), 'offline badge is announced politely (a11y)');

  // save-failed toast with Retry — never a silent loss.
  assert.ok(html.includes('id="rbSaveToast"'), 'save-failed toast ships');
  assert.ok(html.includes('id="rbSaveToastRetry"'), 'save-failed toast offers Retry (no silent loss)');
  const toastEl = html.slice(html.indexOf('id="rbSaveToast"') - 60, html.indexOf('id="rbSaveToast"') + 80);
  assert.ok(/role="alert"/.test(toastEl), 'save-failed toast is an assertive alert');

  // all-resolved celebratory empty state in the rail.
  assert.ok(html.includes('rb-all-resolved'), 'all-resolved state is styled');
  assert.ok(html.includes('function shouldShowAllResolved'), 'client decides when to show the all-resolved state');
  assert.ok(html.includes('function buildAllResolvedNode'), 'client builds the all-resolved node');
});

test('the board honours prefers-reduced-motion (motion collapses to ~0ms)', () => {
  const html = boardHtml();
  assert.ok(
    html.includes('@media (prefers-reduced-motion: reduce)'),
    'a reduced-motion kill-switch neutralises animations/transitions',
  );
  assert.ok(
    html.includes('@media (prefers-reduced-motion: no-preference)'),
    'the new motion is authored under no-preference (only scheduled when motion is welcome)',
  );
});
