---
name: planr-land
description: Assess release readiness and prepare or inspect an OpenPlanr landing sequence. Use after implementation and checks are complete, before merge, publication, or deployment.
license: MIT
---

# Planr Land

Use this skill after implementation and relevant checks are complete, when the
user wants to assess readiness or prepare a clear landing sequence.

1. Read the current branch, worktree status, requested target, completed checks,
   and release constraints already available in the repository or conversation.
2. Inspect the installed CLI help, then use `planr land prepare`, `planr land
   show`, or `planr land status` only when that command adds useful local state.
3. Identify blockers, missing checks, ordering constraints, recovery options,
   and the exact merge, publication, or deployment commands the user would run.
4. If a real release choice is missing, use the host's native structured question
   UI; otherwise continue with the safest explicit assumption and label it.
5. Return this concise structure:

- **Readiness:** ready, conditional, or blocked, with one-sentence reasoning.
- **Blockers:** prioritized and actionable; write `none` when empty.
- **Landing sequence:** ordered commands or actions, including preconditions.
- **Recovery:** rollback or retry guidance for the first meaningful failure.
- **Next action:** the single most useful step for the user.

When the OpenPlanr dashboard is running, readiness context is browsable at its
`#/overview` and `#/list` views. This is navigation only.

This skill prepares and inspects the sequence; it does not perform merge,
publication, or deployment effects. When a local command fails, report the
failing command, what remains known, and the shortest practical repair.
