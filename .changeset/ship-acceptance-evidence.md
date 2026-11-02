---
'openplanr': minor
---

`/ship` now passes the task path and mode to delegated roles, re-runs the checks a delegate reports as passed, acts on warning diagnostics and on the new files a `package-contents` check expects, and maps each check to the acceptance criteria it covers. A new `awaiting-acceptance` outcome marks repository work that only the owner can accept. `/ship` and `/investigate` now report whether an acceptance or regression test actually failed before the change.
