---
'openplanr': patch
'planr-pipeline': patch
'@openplanr/protocol': patch
---

The Claude Code plugin pre-approves no tools: the seven Operate review skills drop their `allowed-tools` grant, so the package qualifies as instructions-only and every write follows your normal permission prompts. An Operate lens run on its own now creates the same `.planr/operate/<date>-<slug>/` cycle `planr-operate` creates, with a one-lens roster, so the dashboard lists it.

Role agents are simpler and current: descriptions no longer route by task file names or pipeline step numbers, legacy role names are gone, and most roles inherit the session's tools. The QA agent denies the file-editing tools and the DevOps agent keeps no shell; both boundaries are documented as what the host enforces. Plan decomposes a story into coherent, independently verifiable tasks split by ownership instead of a fixed one-or-two-task count.
