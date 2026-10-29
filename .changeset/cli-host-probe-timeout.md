---
'openplanr': patch
---

Plugin inspection no longer hangs on a slow `claude --version` or `codex --version`. After 5 seconds it reports the runtime as present with an unknown version.
