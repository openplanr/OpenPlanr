---
name: planr-plan
description: Run the OpenPlanr pipeline PO phase for a feature and stop for human review.
---

# Planr PLAN

1. Run `planr-pipeline prepare-plan <feature> --json` to resolve mode and scaffold
   a missing spec when appropriate. If it scaffolded a spec, stop so the user can edit it.
2. Read the returned spec, `input/tech/stack.md`, optional database schema, and
   optional design spec. Follow the portable procedure in `commands/plan.md` from
   the installed `planr-pipeline` package.
3. Produce stories and tasks with no more than two tasks per story.
4. Run `planr-pipeline complete-plan <feature> --runtime codex --json`.
5. Summarize the artifacts and stop. Never invoke SHIP automatically.
