---
'openplanr': patch
---

Ship with `planr-pipeline@0.42.0`, which requires an explicit `protocolVersion`
when building a legacy advisor brief. The previous silent default allowed a
frozen v1.2 contract to reach a Protocol v1.4 mandate.
