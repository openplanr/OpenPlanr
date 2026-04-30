---
"openplanr": patch
---

Plugin rename: `openplanr-pipeline` → `planr-pipeline`. Brand convergence on the `planr` CLI binary. The CLI's TypeScript API is unchanged — only generated artifact names + slash command identifiers.

**What changes for users:**

- Generated cursor rule filenames: `openplanr-pipeline.mdc` → `planr-pipeline.mdc` (also `-plan.mdc` and `-ship.mdc` variants)
- Claude sibling reference card: `openplanr-pipeline.md` → `planr-pipeline.md`
- Slash commands: `/openplanr-pipeline:plan` → `/planr-pipeline:plan` (same for `:ship`)

**Migration:** re-run `planr rules generate` to pick up the new files. Legacy filenames trigger a one-line cleanup hint pointing at safe-to-delete paths — never auto-deleted.

**Pairs with:** `planr-pipeline` Claude Code plugin v0.7.0 (renamed from `openplanr-pipeline` v0.6.0); `openplanr` skill v1.4.0; marketplace pin updated to v0.7.0.
