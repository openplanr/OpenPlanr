---
'openplanr': patch
---

`/planr:ship` runs each check on its own or with `set -o pipefail`, so shortening a check's output no longer hides a failure. Ship now names the verification helper's `--project` and `--task` arguments, and the helper prints its usage when it gets a plain path.
