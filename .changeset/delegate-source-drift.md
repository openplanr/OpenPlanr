---
'openplanr': patch
---

`delegate` apply no longer refuses with `E_INTEGRATION_SOURCE_DRIFT` in repositories that track files also matched by `.gitignore` while the checkout has an unrelated uncommitted edit. When the final checkout or the selected candidate does differ, the refusal lists the first differing paths and whether each is missing, extra or changed. `prepare` rejects glob characters in `scopePaths` and names the literal prefix to use, `review` of an unfinished run names the step that unblocks it, and the operator guide explains how to set Cursor's command allowlist before dispatch.
