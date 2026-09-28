---
'openplanr': patch
'planr-pipeline': patch
'@openplanr/protocol': patch
---

The `planr-sync` skill's bundled helper no longer talks to Linear or reads `PLANR_LINEAR_TOKEN`. Linear synchronization runs through the host's Linear connector or the `planr linear` CLI, which stores its own token. To migrate, run `planr linear init` once, audit with `planr linear sync --dry-run`, and create or update issues with `planr linear push <artifact-id>`. `sync.mjs linear …` now exits with `E_SYNC_USAGE` and names these commands. GitHub and local reconciliation are unchanged and still need no CLI.
