---
'planr-pipeline': patch
'@openplanr/protocol': patch
'openplanr': patch
---

Source modules over 800 lines open with a short comment that names what the module owns and its entry points, and several stale comments now match the code. Only comments change: code, exports and behaviour are unchanged, and the bundled dashboard assets differ only in their source-derived build id.
