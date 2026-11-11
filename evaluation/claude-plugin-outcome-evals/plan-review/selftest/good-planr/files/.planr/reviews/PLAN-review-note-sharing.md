---
plan: docs/plans/note-sharing.md
verdict: revise
---
# Plan review: note sharing by link

| ID | Lens | Severity | Finding |
|----|------|----------|---------|
| R-1 | Product | Blocking | No task covers revoking a link (spec requirement 4). Add a revoke task after task 3. |
| R-2 | Security | Blocking | Task 3 never checks that the caller owns the note: anyone who knows an id can create a link. Use `requireUser` and `requireOwner`. |
| R-3 | Security | Blocking | Task 1 makes tokens with `Math.random().toString(36)`, about 41 bits from a non-cryptographic source. The spec asks for unguessable tokens; use `crypto.randomBytes(32)`. |
| R-4 | Engineering | Blocking | Task 4 adds `GET /shared/:token` after the `/notes` match, but `handle` calls `requireUser` first and throws 404 for other paths, so the route either demands `x-user-id` or is never reached. The spec says no header. Route it before `requireUser`. |
| R-5 | Security | Blocking | Task 4 responds with `present(note)`, which returns `ownerId`, `id` and `done`. The spec allows title, body and due date only. |
| R-6 | Product | Major | Task 4 expires links after 7 days; the spec says 30. |
| R-7 | Engineering | Major | Task 2 adds a `shares` array to `data/notes.json` without a migration or a `SCHEMA_VERSION` bump, which the README requires for every change to the stored shape. |
| R-8 | Delivery | Major | Task 6 bundles six days of unrelated work (logging, retries, rate limits, the whole end-to-end suite). Split it, and move each route's tests into its own task. |
| R-9 | Engineering | Note | Task 5 is sound: throwing `HttpError` reuses the existing JSON error path. |
| R-10 | Product | Note | Showing the note's current content matches the spec's goal of avoiding stale copies, and keeping expired records is what lets an expired token return 410. Neither needs to change. |
| R-11 | Docs | Note | Task 7 is fine as written. |

**Verdict:** revise before starting; tasks 5 and 7 and both design notes can stand.
