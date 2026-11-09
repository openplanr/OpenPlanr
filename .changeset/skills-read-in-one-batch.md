---
'openplanr': patch
---

Spec, Plan, Plan Review, Operate, Ship and Release now read the files your request names plus `AGENTS.md` and `CLAUDE.md` in one batch, and widen the search only when something is missing or contradictory. Their closing summaries share one set of rules, and Spec and Plan check their work with `openplanr spec validate <SPEC-ID>` when the CLI is installed.
