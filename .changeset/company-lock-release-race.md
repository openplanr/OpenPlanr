---
'openplanr': patch
---

Company sign-in, credential refresh and binding operations no longer fail with `ENOENT` when another process releases its lock at the moment this one inspects it; the lock is retried instead.
