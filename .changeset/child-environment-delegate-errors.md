---
"openplanr": patch
"planr-pipeline": patch
"@openplanr/integrations": patch
---

`openplanr github` and `openplanr doctor` now start their child processes with a limited environment instead of the full one. `openplanr delegate prune` reports nothing to prune when no run has been recorded yet, and a missing run store gives a clear error elsewhere. Protocol v1 checks accept `executable`, and the environment hint after a failed apply appears only when a check failed for a missing toolchain.
