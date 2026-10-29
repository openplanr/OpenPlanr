---
'openplanr': patch
---

`fonts fetch` no longer leaves empty folders behind when writing to disk fails, and it clears its own staging folders left by an interrupted run. Destinations named `.fonts-fetch-*` are now refused, because that prefix is reserved for staging.
