---
'@openplanr/artifact': patch
'planr-pipeline': patch
'openplanr': patch
---

When a review frame times out while loading, its diagnostics now report an elapsed time of at least the load deadline instead of sometimes a shorter one.
