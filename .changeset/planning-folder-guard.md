---
'openplanr': patch
'planr-pipeline': minor
'@openplanr/protocol': patch
---

OpenPlanr no longer writes into a `.planr/` folder that another tool created. When that folder has no OpenPlanr `config.json` but holds `planr.config.json`, `board.html`, or `*-goal.md` files in `tasks/` or `plans/`, `openplanr init`, project setup, provenance appends and design taste updates stop and say what they found. Move or rename that folder, or use OpenPlanr in another repository.
