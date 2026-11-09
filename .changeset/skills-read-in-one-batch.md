---
'openplanr': minor
---

Spec, Plan, Plan Review, Operate, Ship and Release now read the files your request names plus `AGENTS.md` and `CLAUDE.md` in one batch, and widen the search only when something is missing or contradictory. Their closing summaries share one set of rules, and Spec checks its work with `openplanr spec validate <SPEC-ID>` when the CLI is installed, while Plan can add `openplanr spec sync <SPEC-ID> --dry-run` to its own checks.
