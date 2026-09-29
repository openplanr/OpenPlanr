---
"openplanr": patch
---

Honor backlog priority supplied through `--data` when no `--priority` flag is given. New backlog files keep priority in frontmatter only, and updating an older file also updates its existing body priority so the two values cannot disagree.
