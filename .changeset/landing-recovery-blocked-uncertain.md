---
'planr-pipeline': patch
---

Landing now records a rollback or compensate that ends blocked or uncertain. Before, building that outcome failed with `LANDING_RECOVERY_INVALID`, so the run stayed at its recorded intent and every resume failed the same way.
