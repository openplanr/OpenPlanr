---
"openplanr": patch
---

Fix project root resolution for monorepos — planr now walks up the directory tree to find `.planr/config.json`, so commands work from any subdirectory
