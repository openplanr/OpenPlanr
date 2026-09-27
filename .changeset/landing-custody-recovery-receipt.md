---
'openplanr': patch
---

Landing custody now clears a stored `recovery_required` receipt when the rollback or compensate intent is committed, so a landing host built on it can dispatch the recovery instead of failing with `LANDING_BINDING_MISMATCH`.
