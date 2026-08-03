# The Collaborative Review Board

> The review board (`/planr-pipeline:design-review`, served by `lib/design-engine/`) is a live
> review canvas where reviewers pin comments, rate, and leave feedback on a generated design. This
> document covers the **collaboration + persistence layer** (SPEC-017): how feedback is stored,
> merged, attributed, live-synced, and how older feedback files stay compatible. For the engine
> internals (daemon protocol, providers, sessions, taste) see `docs/design-loop.md` — both the
> `design-loop` (variant authoring) and `design-review` (pin-review of an existing artifact) modes
> share the one engine.

The board is a **live projection of the feedback file**: open = load + render, contribute = merge
+ persist. There is no in-memory-only state a reload can lose. Several reviewers can open the same
board, identify themselves once (name → a coloured initialed avatar), and pin / rate / comment;
every contribution is attributed, merged without data loss, and survives refresh, close, and
re-serve. The feedback file is the durable record the design-review loop reads and the team works
from.

---

## The feedback model

The durable record is the board's feedback file (`feedback.json`, next to `board.html`), validated
against `schemas/v1.0.0/design-feedback.schema.json`. The collaboration layer extends the shape
**additively**:

- **`authors[]`** — the roster of reviewers who contributed to this board. Each appears once. An
  entry carries `{ name, color, initials, lastSeen }`. `name` is the merge + avatar key; identity
  is a **local display name + deterministic avatar only** — no account, no auth, no PII.
- **Per-item `author`** — the display name of the reviewer who created the pin. Legacy /
  unattributed items normalize to `"Anonymous"`.
- **Per-item stable `id`** — a 12-char hex prefix of `sha256(author\ncreatedAt\ncomment)`. Together
  with `author` it is the merge key. Computed client-side at pin-drop time with the same derivation
  the daemon uses, so a client-computed id equals the daemon's canonical id (idempotent re-submit).
- **Per-item `status`** — the lifecycle of the pin as tracked feedback: `open | addressed |
  resolved`. Defaults to `open` when absent.
- **Per-item `replies[]`** — short threaded replies (`{ id?, author, comment, createdAt }`) so a
  pin is a tracked conversation, not a write-once note.
- **Per-item `createdAt`** — the ISO timestamp the pin was created (also feeds the stable id).

A pin still carries its normalized `0..1` region (`variant`, `x`, `y`, `w`, `h`), `comment`, and
`intent` (`fix | improve | question`). Pin markers, the feedback list, hover/detail surfaces, and
replies all show the author avatar and a timestamp, so it is always clear **who** said **what**.

The pure model lives in `lib/design-engine/feedback.mjs`:

| Function | Purpose |
|---|---|
| `generateStableId({ author, createdAt, comment })` | deterministic, content-keyed 12-char hex id |
| `normalizeLegacy(file)` | legacy (unattributed) → `Anonymous` + assigned ids + reconstructed roster |
| `mergeFeedback(stored, contribution)` | non-destructive, idempotent merge by author + item id |
| `isDeleteMarker(pin)` | flags an explicit `{ id, author, deleted: true }` delete contribution |

---

## Merge semantics (non-destructive, last-write-wins per item)

A contribution is **merged into** the stored record by author + item id — it never overwrites the
whole file:

- **Per-item last-write-wins.** Re-submitting an item with the same `id` + `author` replaces it in
  place (an edit to status, intent, comment, or position). One reviewer's edit never deletes
  another reviewer's items.
- **Idempotent.** Re-submitting an unchanged item is a no-op (no duplicate). Replies dedup by id, or
  by a content signature (`author + comment + createdAt`) when a reply has no id, so an
  append/dedup stays idempotent either way.
- **Non-destructive on omission.** A contribution that omits a stored item never removes it — a
  single-pin POST from one tab leaves every other pin intact.
- **Per-variant ratings / comments merge key-by-key.** `ratings` and `comments` (keyed by variant /
  screen id) merge per key; one author's `A` rating is not clobbered by another's `B` rating.
- **Deletions are explicit and owner-scoped.** A reviewer removes their own pin by POSTing a delete
  marker (`{ id, author, deleted: true }`); the merge removes the item only when the marker's
  author owns it. A foreign delete marker is a silent no-op. Resolving is a team action that changes
  `status`, not a delete. A delete marker is never written verbatim into the durable file.
- **Concurrency-safe.** The write path is serialized on the per-board mutex the daemon already
  holds, so concurrent POSTs read-merge-write one at a time — the final file is valid JSON with
  every contribution present.

`mergeFeedback` is pure: it mutates neither argument and returns the merged record.

### Daemon endpoints

`lib/design-engine/daemon.mjs` exposes the load + merge path under the per-board mutex:

| Route | Method | Purpose |
|---|---|---|
| `/boards/<id>/api/feedback` | GET | returns the durable record (a designed empty `{ authors: [], items: [] }` before any submit) |
| `/boards/<id>/api/feedback` | POST | **merges** the contribution into the durable record (no longer overwrites); returns the merged record |
| `/boards/<id>/api/feedback/stream` | GET | the SSE presence + live-update stream (see below) |

A leftover `feedback-pending.json` round is **reconciled into the durable store** on register —
merged in, then the pending file is emptied (not destructively deleted), so a stale round can
neither drop another author's pins nor double-apply.

---

## The presence + live-update stream (SSE)

`GET /boards/<id>/api/feedback/stream` is a `text/event-stream` the board client connects to.
Identity rides the query string (`?name=&initials=&color=`) — a local display name + avatar only,
never auth/PII. The daemon keeps an in-memory per-board registry of connected streams and pushes
named events:

| Event | Sent to | Carries |
|---|---|---|
| `presence:join` | the **other** clients when a tab connects | the deduplicated roster of who is viewing now |
| `presence:leave` | the **remaining** clients when a tab disconnects | the post-leave deduplicated roster |
| `feedback:update` | **all** connected clients after a successful POST merge | only the single changed item (a delta, not the whole file) |

A reviewer's two tabs collapse to **one** presence entry (deduped by name). When multiple tabs view
the same board, a contribution from one appears in the others within about a second, and a presence
cluster shows the avatars of current viewers.

**Degrades cleanly.** If the stream is unavailable, the board still works fully through load +
merge-on-submit (eventual consistency on refresh) — never a broken state. A non-blocking offline
badge marks the stream-down state; the board re-syncs on reconnect.

---

## Identity (local display name + deterministic avatar)

Before a reviewer's first contribution the board asks for their **name** — no account, no password.
This is a local review tool. From the name the board derives an **avatar**: the reviewer's initials
(1–2 letters) on a **deterministic colour** drawn from a fixed accessible palette (same name → same
colour). The identity is **remembered per browser** (localStorage) so returning reviewers are not
asked again, and is **editable**. Each reviewer appears once in the `authors[]` roster; the avatar
appears on pins, in the feedback list, in presence, and on replies.

On submit the board client stamps identity onto the outgoing contribution: the per-pin `author` is
the display-name string (the schema's `pin.author` + the daemon merge key), the per-pin `createdAt`
anchors the stable id, and the full `{ name, initials, color }` object lives once in the payload's
`authors[]` roster.

---

## Backward compatibility

The augmented shape extends the schema additively, so the design-review loop and any consumer keep
working:

- A feedback file written by the **previous (unattributed) board version** loads cleanly.
  `normalizeLegacy` assigns each item a stable id, attributes unattributed items to **`"Anonymous"`**,
  and reconstructs the `authors[]` roster from the pins. Legacy items render as `Anonymous`.
- A **new write produces a file that validates** against `design-feedback.schema.json` — the
  per-item `id` + `author` are now required on a pin, so a raw legacy pin fails validation until it
  is normalized at load time, after which the same record validates.
- Export of the feedback record and the annotated view remains available through the board's
  existing export.

---

## Premium states (no dead ends)

Every state the board can reach is designed and actionable — never a blank screen, a silent loss,
or a dead end:

- **Empty** — an inviting "drop your first pin" affordance, not a blank canvas.
- **Loading** — a skeleton during the `GET /api/feedback` flight (no white flash).
- **Save failure** — a toast with **Retry** that holds the failed contribution in memory and
  re-submits it; never a silent loss.
- **Stream down** — a non-blocking offline badge; the board stays fully usable and re-syncs on
  reconnect.
- **All resolved** — a celebratory empty state in the feedback rail when every pin is resolved.

The board meets AA contrast, is keyboard reachable (the Show/Hide-pins control is a `role="switch"`
operable with Space / Enter), supports dark / light, and respects `prefers-reduced-motion` — the
new motion is authored under `prefers-reduced-motion: no-preference` and a global kill-switch
collapses animation / transition to about zero for reduced-motion reviewers.
