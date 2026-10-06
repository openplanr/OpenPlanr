---
'openplanr': patch
'planr-pipeline': patch
---

Local Studio and review servers take their control token in a dedicated header. A Studio started by the previous version is still listed, reused, exported from and stopped. Older OpenPlanr versions cannot use a Studio started by this one, so stop running Studios with `openplanr server stop --all --yes` before switching to an older version, including an older `npx` run or a project-local install. If an older version reports "Local Studio owner state is unsafe or malformed", stop the Studio with this version. If no Studio is running, delete the `state-*.json` and `instance-*.json` files in `~/.planr/artifact-daemon/` (under `PLANR_HOME` when it is set).
