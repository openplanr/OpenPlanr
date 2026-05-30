---
id: "T-002"
title: "Feature B (crashed mid-merge — orphaned)"
specId: "SPEC-G6"
slug: "feature-b-in-progress"
schemaVersion: "1.0.0"
type: "Tech"
agent: "backend-agent"
status: "in-progress"
---

# T-002 — Feature B (crashed mid-merge — orphaned)

The prior /ship run crashed after opening this task's manifest record but
before merging it. Its target file `src/feature-b.ts` does NOT exist in the
seeded tree, and a stale `planr-wt/T-002-*` branch with no live worktree
survives. On re-run the reconcile sweep prunes that branch, then Step 2a
re-queues this task (`in-progress` → `pending`) and it runs to `done`.

## Files

### Create

- `src/feature-b.ts`

### Preserve (do not touch)

- `src/index.ts`
