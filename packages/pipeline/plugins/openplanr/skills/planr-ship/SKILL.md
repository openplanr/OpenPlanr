---
name: planr-ship
description: Implement an OpenPlanr plan, specification, task, or clearly stated request end to end in the current repository. Use when the user asks to build, implement, fix, finish, or ship local work.
license: MIT
---

# Planr Ship

Ship produces an implementation-complete local repository. Landing and release
preparation belong to `/planr-pipeline:land`.

## Resolve the implementation boundary

When given an exact task, load it first:

- Spec-driven: `<SPEC_DIR>/tasks/T-NNN-{slug}.md`.
- Default: `output/feats/feat-{slug}/us-{N}/tasks/task-{M}.md`.

Read the whole task, including `storyId`, parent, `dependsOn`, `rationale`,
`preserve`, `reviewRisks`, `browserSurfaces`, `acceptanceRefs`, file lists,
Technical Spec, Test Requirements, and Definition of Done. Then read:

1. Follow `storyId` to its parent story, acceptance criteria, matching Gherkin file when present,
   and enclosing specification;
2. `input/tech/stack.md`, its `ActiveStackFiles`, installed stack defaults, and matching
   `.claude/stacks/` overrides;
3. the applicable design specification and `output/db/schema.json`;
4. implemented interfaces from each declared `dependsOn` task.

Only `dependsOn` represents semantic ordering. If a dependency has not produced
the interface this task consumes, report that concrete gap. Never invent a
dependency from task order or overlapping paths. If multiple active tasks write
the same files, use isolated worktrees when the host supports them; otherwise
serialize only those writes. Do not add `conflictsWith`.

Create and Modify name the expected surface, not an artificial file fence.
Include companion files required for correctness and leave Preserve entries
unchanged. Preserve unrelated dirty-worktree changes. If a selector resolves to
zero or multiple tasks, report the searched location and candidates instead of
guessing.

For a direct implementation request, use the request, repository instructions,
ADRs, relevant code and tests, and useful planning artifacts. Missing or stale
Planr state does not block a clear request.

## Implement and verify

State a short approach for substantial work, implement the complete local
outcome, and run focused checks while working.

Discover verification in this order:

1. task Test Requirements;
2. repository instructions;
3. package and task-runner commands;
4. applicable CI and pre-commit configuration.

Use the installed support script to perform that read-only discovery:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/discover-verification.mjs --project . --task <task-path>
```

The script returns ordered JSON candidates and does not execute or write
anything. If it is unavailable, inspect those four sources in the same order.
Missing commands are a diagnostic: choose the strongest applicable repository
checks that exist and report what could not be run.

Use `reviewRisks` to select relevant security, performance, migration,
API-contract, or data-integrity checks. Use `browserSurfaces` to select practical
browser checks for the named surfaces. Empty metadata is normal, and neither
field is a workflow gate.

Fix relevant failures and rerun affected checks. Keep the five-field
`implementation-result` machine contract unchanged.

## Response

Return exactly these fields:

- **Outcome:** `completed`, `partial`, or `blocked`, followed by what now works.
- **Task:** the task ID and path, or `direct-request`.
- **Changed:** material paths grouped by purpose.
- **Checks:** command, `passed`, `failed`, or `not-run`, and a concise result.
- **Issues:** problem, impact, and next action, or `none`.

When Outcome is `completed`, append `Next: /planr-pipeline:land` to the human-readable
Outcome summary. It is presentation guidance, not a sixth machine field.
