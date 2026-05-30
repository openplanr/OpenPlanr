---
id: "T-001"
title: "Add feature module (undeclared-write reject target)"
specId: "SPEC-FC"
slug: "undeclared-write"
schemaVersion: "1.0.0"
type: "Tech"
agent: "backend-agent"
status: "blocked"
updated: "2026-05-30"
---

# T-001 — Add feature module (undeclared-write reject target)

This is the orchestrator-owned copy of the task .md in main. Its `status` field
is `blocked` — written by the orchestrator AFTER the Section 7 step 1 subset
check rejected the worktree because it touched an UNDECLARED path
(`src/undeclared.ts`). No file from this worktree was applied to main: not the
rogue `src/undeclared.ts`, and not even the declared `src/feature.ts` (partial
application is worse than none — Section 7 step 1). A `T-001-error-report.md`
was written alongside this file to feed the failure back into R6 on the next
wave. The undeclared-write rule that fired is
`agents/modes/shared/contract-create-modify-preserve.md` rule 4 (the T-006 DRY
consolidation of the merge-time reject).

## Files

### Create

- `src/feature.ts`

### Preserve (do not touch)

- `src/index.ts`
