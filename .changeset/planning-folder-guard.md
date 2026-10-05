---
'openplanr': patch
'planr-pipeline': minor
'@openplanr/protocol': patch
---

OpenPlanr no longer writes into a `.planr/` folder it didn't create. When that folder has no OpenPlanr `config.json` but holds other planning files, `openplanr init`, project setup, provenance appends and design taste updates stop and list what they found. Move or rename that folder, or use OpenPlanr in another repository.
