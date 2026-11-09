---
'openplanr': minor
'planr-pipeline': patch
---

New `openplanr sync tracker` command. It shows which GitHub repository `gh` resolves, previews a batch of issue changes, and with `--apply` creates, updates, closes or reopens each issue through `gh`.

- Every change is checked before any runs, and unknown fields are refused.
- `--json` returns each change as `planned`, `applied`, `failed` or `not-run`, plus a `next` step. A run that fails part way names the changes to run again.
- `gh` gets only the variables it needs: its own sign-in, `PATH`, home, locale and proxy settings. Other variables, such as unrelated tokens, never reach it.

The sync skill now calls this command instead of a bundled script, so the OpenPlanr plugins for Claude Code, Codex and Cursor no longer ship a script for sync. If `openplanr` is missing, the skill tells you and runs the command once through `npx` at this exact version, or gives the install command (install only on Codex). Syncing through your coding agent's own tracker connection needs no CLI, as before.

Install commands in the design and plan skills and the plugin README now name an exact `openplanr` version, and the Prisma stack reference runs `prisma` through your project's package manager.
