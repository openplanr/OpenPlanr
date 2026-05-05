---
"openplanr": minor
---

feat(types): widen `TaskStatus` to include `'blocked'` for v0.8.0 plugin alignment

The planr-pipeline v0.8.0 task schema enum is `['pending', 'in-progress', 'done', 'blocked']`. Prior CLI versions silently coerced `blocked` → `pending` via `asTaskStatus()`, dropping the R6-failure signal that the pipeline writes alongside `T-NNN-error-report.md`.

Changes:
- `TaskStatus` union now includes `'blocked'` (`src/models/types.ts`)
- All four `asTaskStatus()` normalizers accept and preserve `'blocked'` (linear-pull, linear-push, scope-loaders)
- `DEFAULT_LINEAR_STATE_TO_OP` adds `['blocked', 'blocked']` so a Linear "Blocked" workflow state pulls back into a blocked task file
- `buildNameToStatusMap` accepts `'blocked'` from user `linear.statusMap` overrides
- `aggregateTaskStatus()` adds top-precedence rule: any blocked child → blocked parent (escalation, not averaging)

Migration: zero-friction. Tasks that don't carry `blocked` are unaffected. The CLI no longer demotes blocked back to pending on Linear pull.
