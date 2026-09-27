---
'planr-pipeline': patch
---

The artifact review controls in `lib/artifact/ui` (`annotations`, `feedback-rail`, `share-dialog`, `hosted-viewer`, `stage-mount` and `stage-payload`) are now compiled from TypeScript sources at build time, and each ships a generated `.d.mts`. The compiled modules are token-identical to the JavaScript they replace, and the review stage and diagram studio bundles are byte-identical.
