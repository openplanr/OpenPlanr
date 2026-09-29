---
'openplanr': patch
'planr-pipeline': patch
'@openplanr/protocol': patch
---

`planr upgrade apply`, `planr runtime update` and `planr setup` now print only what changed. After an upgrade you see the new version, up to five highlights per release with a link to the full release notes (`--notes full` prints every entry), and one command per installed coding agent, planned by the newly installed CLI instead of the version you upgraded from. `planr runtime update` prints one line per coding agent and which ones to restart; `--verbose` adds the changed files and `--json` prints the full result.
