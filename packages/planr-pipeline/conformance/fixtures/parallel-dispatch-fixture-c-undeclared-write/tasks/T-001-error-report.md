---
id: "T-001-error-report"
task: "T-001"
specId: "SPEC-FC"
kind: "task-failure-handoff"
created: "2026-05-30"
---

# T-001 — Error report (undeclared write rejected at merge)

The orchestrator rejected this task's worktree at the Section 7 step 1 subset
check. The worktree diff included a path that is in NEITHER the task's `### Create`
nor its `### Modify` list.

## Undeclared paths (must not land in main)

- `src/undeclared.ts` — written by the agent inside the worktree but never
  declared. Per `agents/modes/shared/contract-create-modify-preserve.md` rule 4,
  any file changed in a worktree that is absent from both the Create and Modify
  lists is an undeclared write; the orchestrator rejects it at merge time and
  fails the task into R6. The undeclared file must not land in main.

## Declared write-set (withheld this attempt)

- `src/feature.ts` (Create) — NOT applied to main on this attempt. Section 7
  step 1 withholds the ENTIRE worktree on a subset-check failure (partial
  application is worse than none).

## Repair

Remove the undeclared write to `src/undeclared.ts` from the worktree (or declare
it under `### Create` / `### Modify` in the task spec if it is legitimately part
of the change), then re-run the R6 loop. The task stays `blocked` until the
worktree diff is a subset of the declared write-set.
