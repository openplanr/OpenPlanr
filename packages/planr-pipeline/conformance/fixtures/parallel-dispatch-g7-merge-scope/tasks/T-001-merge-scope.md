---
id: "T-001"
title: "Add feature module (file-scoped merge target)"
specId: "SPEC-G7"
slug: "merge-scope"
schemaVersion: "1.0.0"
type: "Tech"
agent: "backend-agent"
status: "done"
---

# T-001 — Add feature module (file-scoped merge target)

This is the orchestrator-owned copy of the task .md in main. Its `status` field
is `done` — written by the orchestrator after the file-scoped merge of the sole
declared path `src/feature.ts`. The worktree branch ALSO modified a copy of this
very file (see worktree-diff.json), but the file-scoped checkout applies only the
declared write-set, so the worktree's task-.md mutation is NEVER round-tripped
into main (SPEC-013 FR9/FR11; Section 7 step 4).

## Files

### Create

- `src/feature.ts`

### Preserve (do not touch)

- `src/index.ts`
