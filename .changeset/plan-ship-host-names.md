---
'openplanr': patch
'planr-pipeline': patch
'@openplanr/protocol': patch
---

The plan skill now ends with the host's ship command, `/planr:ship T-NNN` in Claude Code, `$planr:ship T-NNN` in Codex or the `planr-ship` rule in Cursor, instead of `/planr-ship` and `$planr-ship`. The pipeline's plan procedures point to `/planr:plan` instead of the retired `planr spec decompose` command.
