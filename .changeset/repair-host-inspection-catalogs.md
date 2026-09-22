---
"openplanr": patch
"planr-pipeline": patch
---

Correct Codex inspection errors to identify the CLI's bundled host package and the setup repair command.

Make professional-skill catalog reads work in an isolated pipeline installation by defaulting to its bundled compatibility snapshots. Current-source inspection and evaluation now require an explicit source root instead of reading retired package host trees.

Build pipeline compatibility projections from canonical workspace sources during packaging, preserving the self-contained published package. Validate generated archive contents against the existing projection manifests.
