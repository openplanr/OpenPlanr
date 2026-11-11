---
name: planr-plan-review
description: Review an OpenPlanr plan for product, engineering, design, and developer-experience problems. Use after planning and before implementation to improve the plan.
license: MIT
---

# OpenPlanr Plan Review

Review the plan as a senior engineer would before implementation. Read the plan
and the files it names, plus `AGENTS.md` and `CLAUDE.md` when tracked, in one
batch. Expand only for a missing contract, a dependency or a contradiction, and
stop when each claim has evidence or a named gap.

Lead with one verdict: `ready`, `ready with improvements` or `needs revision`.
Use `needs revision` only while a must-fix remains.

- **Must fix**: what would make the implementation wrong or unsafe. Give each
  one its evidence (the plan section plus the file and line, or the quoted
  text, that shows it) and the change that resolves it. A concern without
  evidence is an improvement or an open question, never a must-fix.
- **Improvements**: worthwhile, non-blocking changes.
- **Decisions and assumptions**: unresolved choices, each with a recommended
  default. Ask only when a missing answer would change the verdict; otherwise
  state the assumption and continue.

End with the smallest useful next step. Link the reviewed plan. Follow
[the shared return rules](references/return-contract.md).
