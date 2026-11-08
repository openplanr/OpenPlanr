---
plan: docs/plans/note-sharing.md
verdict: revise
---
# Plan review: note sharing by link

| ID | Lens | Severity | Finding |
|----|------|----------|---------|
| R-1 | Product | Blocking | No task covers revoking a link (spec requirement 4). Add a revoke task after task 1. |
| R-2 | Engineering | Blocking | Task 2 adds a `shares` array to `data/notes.json` without a migration or a `SCHEMA_VERSION` bump, which the README requires. |
| R-3 | Engineering | Blocking | Task 3 never checks that the caller owns the note: anyone who knows an id can create a link. Use `requireUser` and `requireOwner`. |
| R-4 | Delivery | Major | Task 4 bundles six days of work (read route, read-only, expiry, errors, logging, e2e tests). Split it. |
| R-5 | DX | Minor | Task 1 is sound; consider a test for token length. |
| R-6 | Docs | Minor | Task 5 is fine as written. |

**Verdict:** revise before starting; tasks 1 and 5 can proceed.
