---
name: planr-ship
description: Implement an OpenPlanr plan, specification, task, or clearly stated request end to end in the current repository. Use when the user asks to build, implement, fix, finish, or ship local work.
license: MIT
---

# Planr Ship

Produce an implementation-complete local repository in this active coding
session. Landing and release preparation belong to `planr-land`. Do not
delegate implementation to a command-line or model subprocess.
Keep the work local; do not publish or deploy it.

## Resolve the task and context

For a selector, locate exactly one task and read it completely. Then follow its
`storyId` and `specId` to the parent story, acceptance criteria, Gherkin file
when present, and specification. Also read repository instructions, ADRs,
planning rules, applicable stack guidance, relevant design/database context,
implementation code, tests, and interfaces produced by declared dependencies.

Read [the design lineage contract](references/design-lineage.md). If the selected
planning root contains `design-lineage.json`, load only the selected task's mapped
requirements and source references, and report whether the exact approved package
is current or stale. Its absence leaves the ordinary task context unchanged.

Only `dependsOn` defines semantic ordering. When a dependency has not produced
the interface this task consumes, report that concrete gap. Never infer a
dependency from order or overlapping paths. Isolate independent executions when
the host supports it; otherwise serialize only overlapping writes.

Create and Modify describe the expected surface, not an artificial file fence.
Include companion files needed for correctness, leave Preserve entries
unchanged, and retain unrelated working-tree changes. If a selector resolves to
zero or multiple tasks, report the searched locations and candidates instead of
guessing. For a direct implementation request, the request plus repository
context is sufficient; missing planning files do not create a gate.

## Implement with native roles

Use the host's read, edit, shell, browser, and test capabilities. When native
agents are available, dispatch only the applicable frontend, backend, database,
QA, DevOps, and documentation roles inside this session. Give each role its
owned outcome, relevant context paths, and explicit file coordination boundary.
Run independent work in parallel. When native agents are unavailable, perform
the same lenses sequentially in the active agent.

Integrate the complete change, then verify behavior. `reviewRisks` and
`browserSurfaces` select useful checks; empty arrays are normal and neither field
is a workflow gate.

## Discover and run verification

Discover checks in this order:

1. task Test Requirements;
2. repository instructions;
3. package and task-runner scripts;
4. applicable CI and pre-commit configuration.

The packaged read-only [verification discovery helper](scripts/discover-verification.mjs)
may list candidates. Resolve it relative to this `SKILL.md`; pass the repository
root and task path. It never executes checks or writes files. If it is unavailable,
inspect those four sources directly. Missing commands are diagnostics, not a
reason to invent or skip all verification.

Run the strongest applicable focused checks while working, then the relevant
regression checks. Fix failures caused by the change and rerun affected checks.
Read [the result contract](references/result-contract.md) before reporting.

Do not write progress into an approved design package. The studio derives
approved, planned, implementing, and verified state from canonical planning and
Ship artifacts after this separate invocation.

## Return

Return the existing five fields:

- **Outcome:** `completed`, `partial`, or `blocked`, followed by what now works.
- **Task:** task ID and path, or `direct-request`.
- **Changed:** material paths grouped by purpose.
- **Checks:** command, `passed`, `failed`, or `not-run`, plus a concise result.
- **Issues:** problem, impact, and next action, or `none`.

For a completed outcome, append `Next: planr-land` to the human summary. It is
presentation guidance, not a sixth machine field.

When the OpenPlanr dashboard is running, the shipped work is browsable at
`#/detail/<T-###>` and the board at `#/board`. This is navigation only.
