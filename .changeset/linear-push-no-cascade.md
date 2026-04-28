---
"openplanr": patch
---

Three improvements that close real workflow gaps in `planr linear push` and the per-type `update` commands.

**Granular push scope (BL-012).** `planr linear push` adds `--no-cascade` and redefines `--push-parents` to be upward-attachment only.

- `--no-cascade` on EPIC/FEAT pushes skips descendants (stories, tasklists, linked QT/BL). No-op for leaves.
- `--push-parents` no longer drags in the parent's other children. Pushing `TASK-004 --push-parents` now creates EPIC + parent FEAT + this tasklist only — not the feature's sibling stories.

**TASK status now propagates to Linear (BL-014).** `planr linear push` resolves a workflow stateId for the merged TaskList issue using an aggregation rule across all task files under the feature: all `done` → Linear Done, any `in-progress` → Linear In Progress, mix of done+pending → In Progress, all `pending` → Linear Todo. Closes the gap where `TASK-006 status: done` locally left Linear's TaskList in Backlog.

**Bulk subtask completion (BL-015).** `planr task update`, `planr quick update`, and `planr update` add `--all-done` and `--all-pending` flags that set the frontmatter status AND flip every `N.M` task checkbox in the body in one operation. Replaces the manual `sed`-or-edit-each-box workflow when shipping a feature.

Backward-compat note: scripts that relied on `--push-parents` cascading downward will see fewer entities pushed.
