---
'openplanr': patch
'planr-pipeline': patch
'@openplanr/protocol': patch
---

After a CLI upgrade, `openplanr upgrade status` reports `agents-behind` instead of `incompatible` when only your coding agents need updating, and lists the commands to run. When a file in an installed runtime package was edited, `openplanr runtime update` and `openplanr setup` name the file and stop, and `openplanr doctor --fix` restores the package from the CLI after you confirm, backing up the changed files first; `upgrade status` points there instead of at a step that would fail. Error messages keep relative paths such as `skills/delegate/scripts/context.mjs` intact.
