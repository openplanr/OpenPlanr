---
'openplanr': patch
'planr-pipeline': patch
'@openplanr/protocol': patch
---

The plan skill's ID helper now stops with an error naming the folder when `--root` is missing or is not a planning folder, instead of offering `US-001` and `T-001`. It no longer creates the folder when reserving IDs.
