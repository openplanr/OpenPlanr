---
'openplanr': minor
---

`openplanr artifact share` now prints the review link to send for live rooms and encrypted short links, and a link it opens stays reachable until the browser requests it or 30 seconds pass. `openplanr artifact status <private-file>` shows that link again, and in `--json` `opened` is `true` only when the browser requested the link.
