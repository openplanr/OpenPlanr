---
'planr-pipeline': minor
'@openplanr/design': patch
'@openplanr/artifact': patch
---

The design studio runtime is now built from ES modules under `lib/design/ui/` into a single `templates/studio/studio.js` that already contains the review experience, the Handoff Center and the review export tools. `templates/studio/enhancements.js` and `templates/studio/handoff-center.js` are no longer shipped, so hosts that concatenated them load `templates/studio/studio.js` alone. The studio mounts when the artifact stage announces itself with the new `planr:artifact-stage-mount` window event instead of polling for it every 30 ms. `window.__openPlanrDesignStudio`, `window.__openPlanrDesignExperience` and `window.__openPlanrDesignHandoffCenter` are unchanged; the internal `window.__openPlanrDesignHandoffBridge` and `globalThis.OpenPlanrDesignReviewExport` globals are no longer defined by the local studio.
