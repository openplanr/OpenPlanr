---
'openplanr': patch
---

Bound the Claude Code and Codex version checks used by plugin inspection. When `claude --version` or `codex --version` does not finish within 5 seconds, the inspection reports the runtime as present with an unknown version and says that plugin state was not read, instead of waiting for it.
