---
"openplanr": patch
"planr-pipeline": patch
"@openplanr/protocol": patch
"@openplanr/skill-runtime": patch
---

Add the opt-in `planr-delegate` preview to the packaged Claude Code and Codex
skills. Explicit delegation requests can hand one implementation scope to a
trusted enrolled Claude, Codex or versioned generic backend. Ordinary Ship stays
in the active host agent; no public `planr delegate` command is added.

The preview discloses selected context and the actual destination before dispatch,
retains a private capsule and isolated worktree, pins the helper across rebuilds,
and sends corrections to the exact recorded session. The orchestrator verifies
observed changes and independent checks before integrating an uncommitted diff.
Repeated commands, missing final results and hard deadlines block the run without
discarding recovery state. Successful integration closes the exact run and makes
its five-field report recoverable through status. Planning updates are report-only.

Execution requires a local terminal and Node 20 or later. A worktree is not a
filesystem sandbox, context preflight is conservative rather than exact automatic
compaction, and compatibility must be verified for each provider/model combination.
Model visibility alone does not prove a backend works. Landing, publication and
deployment remain separate actions.

New backlog items also show the supported closing command,
`planr backlog update <id> --status closed`, and downstream backlog extraction
omits that helper text. Existing backlog files are not rewritten.
