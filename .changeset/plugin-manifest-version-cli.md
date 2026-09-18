---
'openplanr': patch
---

Stamp the generated Claude, Codex and Cursor plugin manifests, the local marketplaces and the host adapter registry with the CLI package version instead of a fixed `0.1.0`, so `planr runtime update` and the host plugin panels see a real version change on every release.
