---
'openplanr': patch
---

The one-time migration of `~/.planr/credentials.json` now moves only the CLI's own keys and leaves other entries, such as the design engine's `openai_api_key`, in the file, deleting it only when nothing else remains. If an earlier run moved the design engine's key, store it again with the design engine's `setup` command or set `OPENAI_API_KEY`.
