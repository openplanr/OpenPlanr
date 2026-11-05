---
'openplanr': minor
'planr-pipeline': patch
---

The design skills now share through the `openplanr` CLI. Their bundled scripts no longer read a shared review's owner keys or contact the share service: `design.mjs share`, `publish`, `sync` and `manage`, the studio's Share dialog, feedback sync and handoff decisions on a shared design all run `openplanr artifact` for the network step. Local design work is unchanged and needs no CLI.

- Without the CLI, sharing stops with `E_DESIGN_SHARE_CLI_REQUIRED` and asks you to run `npm install -g openplanr`. Feedback inspection still works and reports that sync was skipped, and the studio's Share dialog says the CLI is needed.
- If the skills and the CLI use different sharing formats, sharing refuses with `E_DESIGN_SHARE_RUNTIME_MISMATCH` and names which one to update. An older CLI is refused the same way.
- Existing shares keep working. The CLI reads the same owner records, sends to the same address, and `OPENPLANR_SHARE_BASE` still chooses the origin for a new share.
- The studio syncs a shared design every 15 seconds only while its page is visible, and no longer polls designs that are not shared.
- A recovery file exported without `--output` goes to a new file in `PLANR_HOME/design-recovery`, a private folder next to the owner keys, from the CLI and from the studio's Share dialog. The file holds the owner keys, so keep it private when you move it.
- If the CLI does not answer within a few seconds, the studio keeps working and reports that the CLI did not respond. Changing the category or decision on a hosted reviewer's comment is refused, and nothing is saved, until sharing can run, instead of being saved locally and never sent.
- On Windows the skills start the CLI's own script from the `openplanr.cmd` that npm installs.
