---
'openplanr': patch
---

`planr github sync` now reads the upper-case issue states `gh` reports, so pull no longer resets artifacts linked to closed issues to `pending`, push closes or reopens only the issues whose state differs, and the default direction reports a conflict only where the two sides disagree. An issue number that names a merged pull request counts as closed, and `planr github status` marks an issue it could not fetch as out of sync.
