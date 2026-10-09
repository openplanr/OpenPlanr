---
'openplanr': patch
---

`openplanr setup --runtime claude` no longer fails when the local Claude plugin marketplace was registered by another OpenPlanr install. Setup now shows both locations and points the marketplace at the install you are running. Your plugin data is kept. `openplanr doctor` reports when the marketplace points at a different install.
