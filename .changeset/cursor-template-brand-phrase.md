---
"openplanr": patch
---

Fix a leftover `OpenPlanr-pipeline-aware` phrase in the cursor master rule template that the v1.5.1 rename sed missed (mixed-case compound adjective). After upgrade, regenerated `.cursor/rules/planr-pipeline.mdc` files use `planr-pipeline-aware` consistently with the renamed plugin.

No behavioural change. Run `planr rules generate --target cursor --scope pipeline` to refresh existing projects.
