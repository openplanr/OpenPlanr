---
id: "BL-014"
title: "linear push: TASK workflow state propagates to TaskList issue (aggregation rule)"
priority: "high"
tags: ["feature", "linear", "push", "task", "aggregation", "follow-up"]
status: "open"
created: "2026-04-25"
updated: "2026-04-25"
---

# BL-014: linear push — TASK workflow state propagates to TaskList issue

## Priority
HIGH

## Tags

- feature
- linear
- push
- task
- aggregation
- follow-up

## Description

Real user report:

> Local TASK-006 / TASK-007 frontmatter `status: done` ✅
> Linear MOD-61 / MOD-63 workflow state ❌ Backlog
> No path from "shipped TASK locally" → "Linear TaskList issue moves to Done"

Today: `planr linear push QT-XXX` and `planr linear push BL-XXX` set the Linear `stateId` to match the local `status` (zero-config auto-derive). `planr linear push TASK-XXX` does NOT — the merged TaskList Linear issue stays at whatever state Linear had.

This was deliberately deferred when status sync shipped (see BL-007 §"TASK is deliberately out of scope" and QT-004 §3.5). The reasoning: one Linear TaskList issue aggregates **multiple** TASK-NNN files under the same feature, so a 1:1 mapping doesn't apply. The deferral was correct at the time; the aggregation rule is now overdue.

## Aggregation rule (push direction)

For a feature with N task files (TASK-006, TASK-007, …) all merged into one Linear TaskList issue:

| Local task file states | TaskList Linear state |
|---|---|
| All `done` | Done (`completed` type) |
| Any `in-progress` | In Progress (`started` type) |
| Mix of `pending` and `done` (none in progress) | In Progress (`started` type) — work has begun |
| All `pending` | Todo (`unstarted` type) — only when an issue exists; on first create, leave at Linear's default |

The auto-derived stateId map (already cached per push run for QT/BL/feature/story) covers all four buckets. Reuse `getAutoStateIdMap(client)` and resolve the bucket → stateId at push time.

## Pull direction (the inverse)

`planr linear sync` should also propagate the TaskList issue's state back to the local task files, but with a guard: if local files disagree (TASK-006 = done, TASK-007 = pending) and Linear says "Done," **do not silently overwrite** the partial local state. Either:

- Prompt per-task-file (interactive only)
- `--on-conflict linear` → all task files under the feature get the Linear-derived status
- `--on-conflict local` → leave locals alone, log a warning that Linear and local disagree
- Default in non-TTY: log warning + skip the propagation, audit to `.planr/reports/`

The same `linearStatusReconciled` baseline pattern from the bidirectional status-sync work applies — store it on each task file.

## What "good" looks like

- After `planr task update TASK-006 --status done` and `planr task update TASK-007 --status done`, run `planr linear push FEAT-006`. Both task files marked done → TaskList MOD-61 moves to Done in Linear.
- After `planr task update TASK-006 --status in-progress`, run `planr linear push TASK-006 --push-parents`. The merged TaskList moves to In Progress (any-in-progress rule), not Done (because TASK-007 is still pending).
- `planr linear sync` after a Linear-side state change writes the new state back to all task files under that feature, respecting `--on-conflict` for partial-disagreement cases.

## Acceptance criteria

1. `pushOneTaskListForFeature` resolves a TaskList stateId from the merged status of all task files using the aggregation rule above.
2. The resolved stateId is sent on both create and update calls to Linear (omitted when unmapped, matching the null-stateId rule).
3. On update, if all task files have the same `linearStatusReconciled` baseline that matches Linear's current state, push the new aggregate state. If baselines disagree (one task changed locally, another didn't), the existing three-way merge guards still hold.
4. `linear sync` propagates Linear → local for task files under a feature with a per-feature partial-conflict guard.
5. Tests:
   - All-done aggregation → TaskList state = Done.
   - Any-in-progress aggregation → state = In Progress.
   - All-pending aggregation → state = Todo.
   - Partial-disagreement on pull → respects `--on-conflict`.
   - Idempotent re-push (same aggregated state) → no Linear API change.

## Out of scope (deferred again)

- **Pull-side propagation** (Linear TaskList state → all task files under feature) — separate slice. The user's feedback explicitly noted that local→Linear mirroring of checkboxes is already handled by `planr linear tasklist-sync`, so the immediate gap is the *outbound* state propagation (closed by this BL's push side). Pull side adds partial-disagreement conflict handling that doesn't fit cleanly under a single feature heading; track as BL-014b when it surfaces.
- **Per-task-file Linear issues** — the alternative design where one TASK-NNN.md = one Linear issue, breaking the merged-tasklist model. Possible in a future major release; not v1.x. BL-014 keeps the aggregation model and adds the missing state propagation.

## Size estimate

~3–4 hours end to end:
- Aggregation rule as a pure function in [src/services/linear/estimate-resolver.ts](src/services/linear/estimate-resolver.ts) sibling (or a new `aggregate-task-status.ts`). Inputs: the array of task file `status` values. Output: the canonical Linear state type.
- Wire into `pushOneTaskListForFeature` ([src/services/linear-push-service.ts:597](src/services/linear-push-service.ts:597)) — same `stateId: stateId ?? null` omission rule as feature/story/QT/BL.
- Pull-side propagation in `syncLinearStatusIntoArtifacts` — iterate features, distribute state, respect conflicts.
- ~6 tests across the aggregation rule and the push integration.
- Doc note in [docs/CLI.md](docs/CLI.md) status-sync section: TASK is now status-synced via the aggregation rule.

## Cross-references

- **BL-007** — original deferral note: "TASK is deliberately out of scope. One Linear TaskList issue aggregates *all* task files under a feature… aggregation requires per-TaskList rules."
- **QT-004 §3.5** — same deferral, with a TODO comment in `pushOneTaskListForFeature`.
- **BL-012** — granular push scope; orthogonal to BL-014. After both ship: `planr linear push TASK-006 --push-parents` pushes parent feature (no sibling stories) + the merged TaskList state derived from all task files under that feature.

---
_Promote to agile hierarchy: `planr backlog promote BL-014 --story` or `planr backlog promote BL-014 --quick`_
_Close when done: `planr backlog close BL-014`_
