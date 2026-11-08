---
'openplanr': minor
---

`/ship` and `/investigate` now file findings as backlog items with the agent's own file tools, so the plugin no longer needs Node for this. They re-check the next free ID right before writing, never overwrite an existing item, and write the same file `openplanr backlog add` does. If `openplanr` is on your `PATH`, they can still use it. The one-time "install the CLI" hint is gone.
