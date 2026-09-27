---
'openplanr': patch
'planr-pipeline': patch
'@openplanr/protocol': patch
---

`planr operate dashboard` and `planr-pipeline dashboard` now load `startDashboard` from `planr-pipeline/dashboard` instead of the deprecated package-root alias. Behavior is unchanged; the command registry and its projection record the two changed command sources.
