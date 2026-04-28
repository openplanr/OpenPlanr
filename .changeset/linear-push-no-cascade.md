---
"openplanr": patch
---

`planr linear push` adds `--no-cascade` for granular scope control and redefines `--push-parents` to be upward-attachment only.

- `--no-cascade` on EPIC/FEAT pushes skips descendants (stories, tasklists, linked QT/BL). No-op for leaves.
- `--push-parents` no longer drags in the parent's other children. Pushing `TASK-004 --push-parents` now creates EPIC + parent FEAT + this tasklist only — not the feature's sibling stories. Pushing `US-014 --push-parents` similarly skips other stories under the same feature.
- Default behavior unchanged: `push EPIC-001` and `push FEAT-006` still cascade fully.

Backward-compat note: scripts that relied on `--push-parents` cascading downward will see fewer entities pushed. Add `--cascade` is not yet a flag — combine `--push-parents` with a separate cascading push if you want both.
