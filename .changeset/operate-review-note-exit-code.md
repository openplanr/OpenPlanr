---
'openplanr': patch
---

The Operate review-note validator (`scripts/validate-note.mjs` in `planr-operate` and the seven review skills) now exits 0 when a note passes and 1 only when it reports diagnostics. It previously exited 1 on every note, including clean ones.
