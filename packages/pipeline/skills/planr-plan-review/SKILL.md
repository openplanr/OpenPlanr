---
name: planr-plan-review
description: Review an OpenPlanr plan for product, engineering, design, and developer-experience problems. Use after planning and before implementation to improve the plan.
license: MIT
---

# Planr Plan Review

Give the plan a senior, practical review. Read the plan, its repository context,
and the decisions it depends on. Use only the review lenses relevant to the
work; do not manufacture a fixed committee.

## Review

- Check that the outcome and user value are clear and measurable.
- Check scope, sequencing, ownership, architecture, migration, security,
  operability, testing, and rollback in proportion to the change.
- Check the first-run and everyday developer experience, including setup,
  diagnostics, defaults, and recovery.
- Prefer concrete corrections over abstract criticism. Name the affected plan
  section and the change that would resolve each material issue.
- Use subagents or tools when they improve the review, but return one coherent
  result rather than their raw transcripts.

Ask through the host's native structured question UI only when a missing answer
would materially change the review. Otherwise state the assumption and continue.

## Output

Lead with one verdict: `ready`, `ready with improvements`, or `needs revision`.
Then report:

1. Must fix — only issues that would make the implementation wrong or unsafe.
2. Improvements — worthwhile changes that are not blockers.
3. Decisions and assumptions — unresolved choices with a recommended default.
4. Next action — the smallest useful next step.

Return the useful findings directly. Revisit the review when the user asks or
the plan materially changes.
