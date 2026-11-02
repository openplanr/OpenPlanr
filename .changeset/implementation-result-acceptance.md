---
'@openplanr/protocol': minor
---

The `implementation-result` contract gains Protocol `1.23.0`: the outcome status adds `awaiting-acceptance` for repository work that only the owner can accept, and each check can list the `acceptanceIds` it covers. Results written for `1.5.0` remain valid, and `1.5.0` still rejects the new status.
