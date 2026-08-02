---
id: "BL-015"
title: "planr <type> update --all-done — bulk-tick all subtask checkboxes when work ships"
priority: "medium"
tags: ["feature", "ux", "task", "quick", "checkbox"]
status: "open"
created: "2026-04-25"
updated: "2026-04-25"
---

# BL-015: planr <type> update — bulk subtask completion flag

## Priority
MEDIUM

## Tags

- feature
- ux
- task
- quick
- checkbox

## Description

Real user report:

> Local TASK-006 frontmatter `status: done` ✅
> Local TASK-006 subtasks `- [x]` ✅ all ticked (manually)
> Local TASK-007 frontmatter `status: done` ✅
> Local TASK-007 subtasks `- [ ]` ❌ all unticked
> "There's no path from 'feature shipped' → 'tick all task subtasks locally' — that's currently a manual step the CLI doesn't own."

The frontmatter `status` and the body subtask checkboxes can drift apart. When work ships, users have two correct end states they want: status=done AND every `- [ ]` flipped to `- [x]`. Today they have to either (a) tick each box by hand, or (b) `sed` the file. Both are friction the CLI should own.

## Proposal

Add `--all-done` (or similar) to the per-type update commands so a single CLI call sets the canonical "shipped" state for the whole artifact:

```bash
planr task update TASK-006 --all-done    # status=done + all subtasks `- [x]`
planr quick update QT-001 --all-done     # same for QT
planr update TASK-006 TASK-007 --all-done # generic multi-id wrapper
```

Equivalent to:
- Set frontmatter `status: done`
- Walk the body, replace every `- [ ] **N.M**` with `- [x] **N.M**` (top-level groups) and every `- [ ] N.M` with `- [x] N.M` (subtasks)
- Preserve everything else byte-for-byte (Relevant Files, Notes, prose, etc.)
- Write atomically via the existing `atomicWriteFile` path

Inverse flag for symmetry:
```bash
planr task update TASK-006 --all-pending   # status=pending + all `- [x]` → `- [ ]`
```

Useful when revising scope or rolling back a misfiled "done."

## What "good" looks like

- After `planr task update TASK-006 --all-done`, `planr linear push TASK-006` pushes the merged TaskList body with every checkbox ticked AND the aggregated TaskList state moves to Done (BL-014).
- The flag is an explicit affirmative — no auto-tick-when-status-changes magic. Users who flip status to `done` without `--all-done` keep their existing checkbox state.
- Mutually exclusive with `--status` — passing both errors with a clear message: "use `--all-done` (which implies `--status done`) instead."

## Acceptance criteria

1. `planr task update <id> --all-done` writes `status: done` to frontmatter AND flips every `- [ ]` to `- [x]` in the body.
2. Same for `planr quick update <id> --all-done`.
3. `planr update <ids...> --all-done` works on multiple ids of any compatible type.
4. `--all-pending` is the inverse: `status: pending` + all `- [x]` → `- [ ]`.
5. Both flags refuse to combine with `--status` (they imply a status, so the combo is ambiguous).
6. Body content outside of checkbox lines is preserved byte-for-byte (verified by a test that snapshots everything except the checkbox bullet lines).
7. Atomic write — partial-failure leaves the file unchanged.
8. Linear baseline invalidation (per the existing `updateArtifactFields` auto-clear rule) still fires when status changes.

## Reuse existing infrastructure

- [parseTaskMarkdown](src/agents/task-parser.ts) already extracts the checkbox lines.
- [applyTaskCheckboxStateMap](src/utils/markdown.ts) already mutates checkboxes by id-to-bool map. Build the map by iterating parsed subtasks → `{ id, true }` for `--all-done`.
- [updateArtifactFields](src/services/artifact-service.ts) writes status + invalidates linear baseline. Wrap the call in a single helper that also rewrites the body checkboxes.

## Out of scope

- **Auto-tick on `--status done`** — explicitly NOT done because users sometimes want status=done before all subtasks are checked (e.g., closing as won't-do). Keep the two operations independent and explicit.
- **Tick subset by id** — `--done 1.0,2.1` etc. Could ship later if requested.
- **Cross-feature bulk** — `planr update FEAT-006 --all-done` cascading to all stories + tasks under it. Out of scope; users can use `planr update TASK-006 TASK-007 --all-done` explicitly.

## Size estimate

~2–3 hours end to end:
- New helper `applyAllCheckboxes(body, value: boolean): string` — pure, reusing `parseTaskMarkdown` + `applyTaskCheckboxStateMap`.
- Wire into [src/cli/commands/task.ts](src/cli/commands/task.ts), [src/cli/commands/quick.ts](src/cli/commands/quick.ts), and [src/cli/commands/update.ts](src/cli/commands/update.ts).
- Mutual-exclusion validation (—status vs —all-done/--all-pending).
- ~5 tests covering the flip logic + body preservation + the no-status-collision guard.

## Cross-references

- **BL-014** — TASK status aggregation. After both BL-014 and BL-015 ship, the workflow is:
  1. Ship the work in code.
  2. `planr task update TASK-006 --all-done` (subtasks ticked + status done locally).
  3. `planr linear push FEAT-006` (TaskList state → Done via BL-014's aggregation; checkboxes mirrored via existing `tasklist-sync` machinery).

  No manual checkbox flipping anywhere in the loop.

---
_Promote to agile hierarchy: `planr backlog promote BL-015 --story` or `planr backlog promote BL-015 --quick`_
_Close when done: `planr backlog close BL-015`_
