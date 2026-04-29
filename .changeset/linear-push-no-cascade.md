---
"openplanr": patch
---

Four improvements that close real workflow gaps in `planr linear push`, `planr linear tasklist-sync`, and the per-type `update` commands.

**Granular push scope (BL-012).** `planr linear push` adds `--no-cascade` and redefines `--push-parents` to be upward-attachment only.

- `--no-cascade` on EPIC/FEAT pushes skips descendants (stories, tasklists, linked QT/BL). No-op for leaves.
- `--push-parents` no longer drags in the parent's other children. Pushing `TASK-004 --push-parents` now creates EPIC + parent FEAT + this tasklist only — not the feature's sibling stories.

**TASK status now propagates to Linear (BL-014).** `planr linear push` resolves a workflow stateId for the merged TaskList issue using an aggregation rule across all task files under the feature: all `done` → Linear Done, any `in-progress` → Linear In Progress, mix of done+pending → In Progress, all `pending` → Linear Todo. Closes the gap where `TASK-006 status: done` locally left Linear's TaskList in Backlog.

**Bulk subtask completion (BL-015).** `planr task update`, `planr quick update`, and `planr update` add `--all-done` and `--all-pending` flags that set the frontmatter status AND flip every `N.M` task checkbox in the body in one operation. Replaces the manual `sed`-or-edit-each-box workflow when shipping a feature.

**tasklist-sync no longer skips healthy issue UUIDs (BL-016).** `planr linear tasklist-sync` previously rejected every task file whose `linearIssueId` was a UUIDv4 — the entire population of healthy task files — because a shape-based pre-screen flagged them as "looks like a workflow state UUID." Linear issue ids and workflow-state ids are both UUIDv4 and indistinguishable by shape, so the pre-screen has been removed; the existing `isLikelyLinearIssueId` check still rejects truly malformed values like `ENG42`.

Backward-compat note: scripts that relied on `--push-parents` cascading downward will see fewer entities pushed.
