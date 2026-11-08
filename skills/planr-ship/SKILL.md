---
name: planr-ship
description: Implement an OpenPlanr plan, specification, task, or clearly stated request end to end in the current repository. Use when the user asks to build, implement, fix, finish, or ship local work, or to plan and implement an accepted change. Invoke before editing files for the requested change. Not for planning only, landing, release, or work handed to another coding agent.
license: MIT
---

# OpenPlanr Ship

Produce an implementation-complete local repository in this active coding session.
Landing and release preparation belong to `planr-land`. Ordinary
Ship stays host-native. Do not delegate implementation to a command-line or model subprocess. If the user explicitly asks another coding agent to implement,
hand off to `planr-delegate` before implementation. That separate opt-in workflow
previews the selected context, writable repository, profile, and destination;
plain Ship never launches its helper. Keep the work local; do not publish or deploy it.

## Resolve the task and context

For a selector, locate exactly one task and read it completely. Then follow its
`storyId` and `specId` to the parent story, acceptance criteria, Gherkin file
when present, and specification. Also read repository instructions, ADRs,
planning rules, applicable stack guidance, relevant design/database context,
implementation code, tests, and interfaces produced by declared dependencies. Read any
`.planr/conventions/<area>.md`, indexed from AGENTS.md, for the areas this task touches.

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

The main session owns scope, decisions, integration, and final verification.
Use the host's read, edit, shell, browser, and test capabilities inside this session.
Keep small coherent changes in this session. Delegate only a self-contained
outcome that benefits from context isolation, a distinct capability boundary,
or independent parallel work; agent availability alone is not a reason to dispatch.

Frontend and backend own substantial bounded implementation assignments.
Persistence implementation, including a task carrying the legacy `db-agent`
identity, belongs to backend with the relevant database guidance; preserve the
task's recorded identity. Database is optional read-only introspection when
repository schemas are insufficient, never migration implementation. Keep small
documentation updates with their implementation; delegate substantial documentation
or requested configuration work separately. DevOps never deploys. Entity
scaffolding remains manual, on explicit request.

Use a separate QA reviewer for authorization, credentials, data-loss risk,
migrations, public contracts, release behavior, or substantial delegated
implementation. Small low-risk edits use focused verification in the main session.
QA retains verification tools, subject to role policy and session permissions.

Select the exact registered identity from the host's roster; Claude plugin
agents use names such as `planr:planr-backend` and `planr:planr-qa`. Give each worker
its outcome, the absolute task path with `MODE` and, in spec-driven mode, `SPEC_DIR`,
authoritative paths, relevant decisions, file ownership, verification requirements,
and concise return expectations. Parallel workers need disjoint
writes or an agreed interface. Explain the delegation's purpose briefly in
commentary. Host-native workers do not invoke the separate `planr-delegate` helper.
When the host lacks the native role, perform the work sequentially in this session
and disclose capability limitations; never claim an unavailable specialist ran.

Integrate the complete change, then verify behavior. `reviewRisks` and
`browserSurfaces` select useful checks; empty arrays are normal and neither field
is a workflow gate. Re-run the cheap checks a worker reports as passed, and compare
its `changed` list with `git diff --name-only` plus untracked files; report any difference.

## Discover and run verification

Inspect these sources directly, in this order:

1. task Test Requirements;
2. repository instructions;
3. package and task-runner scripts;
4. applicable CI and pre-commit configuration.

List each candidate check with its `cwd` and the source that named it. Discovery
only reads: never execute a check while discovering. Then run the candidates from
each `cwd`. Let the change pick checks: when it touches a build input (a
`tsconfig*.json`, a bundler config, or a package's `main`, `exports`, `bin` or
`build` scripts), include the build CI runs; prefer tests related to the changed
files. Before pushing, include every CI job whose triggers and path filters fire
for the changed paths, and for a published package that gains non-code files, a
dry-run pack that confirms they are packed. Missing commands are diagnostics, not
a reason to invent or skip all verification.

If `openplanr` is already on `PATH`, `openplanr ship checks --json --task <task-path>`
(omit `--task` for a direct request; add `--tier story` or `--tier push` before
pushing) adds `complete` and diagnostics. The command never executes checks or writes files. When
`complete` is `false`, report its error diagnostics and treat the check set as
incomplete: a pass is not CI-equivalent. Act on warning diagnostics too; each names
the files or checks it affects. A diagnostic that a check could not run, such as
`TYPESCRIPT_UNAVAILABLE`, is not a pass: name that check in `checks` and verify its
concern yourself where you can (for a new test file, confirm some tsconfig includes
it). For a `package-contents` check, account for every `expectFiles` entry in the
tarball's `files`: packed or deliberately left out.

Run the strongest applicable focused checks while working, then the relevant
regression checks. Run each check on its own or under `set -o pipefail`, and judge
it by its own exit code; to shorten output, write it to a log and read the tail.
Fix failures caused by the change and rerun affected checks.
For an acceptance check written or changed for this task, follow
[fail-first](references/fail-first.md) and report what it proved in that check's result.
Read [the result contract](references/result-contract.md) before reporting.

Report defects you notice outside the task as [findings](references/findings.md),
and never fix them in this change unless they block it.
[Backlog filing](references/backlog-filing.md) lists and files backlog items with
your own file tools.

Do not write progress into an approved design package. The studio derives
approved, planned, implementing, and verified state from canonical planning and
Ship artifacts after this separate invocation.

## Return

Summarize the existing five fields concisely where relevant. Lead with the achieved
behavior, link material changes by purpose, and summarize actual verification.
Retain complete file inventories and command diagnostics in their existing
results instead of reproducing them in chat.

- **Outcome:** `completed`, `partial`, `blocked`, or `awaiting-acceptance` (repository
  work done; acceptance needs a run only the owner can do), followed by what now works.
- **Task:** task ID and path, or `direct-request`.
- **Changed:** material paths grouped by purpose, files outside Create and Modify apart.
- **Checks:** command, `passed`, `failed`, or `not-run`, plus a concise result and the
  acceptance IDs it covers; list acceptance criteria no check covers.
- **Issues:** blockers with problem, impact, and next action, or `none`; then
  findings outside the task, each with its disposition.

Keep the five machine fields unchanged. A human summary may omit empty or unavailable fields,
but must make partial, blocked or unverified work clear and give the smallest
recovery action. Preserve native transcripts; never require another execution
or correction just to change summary wording.

Suggest `planr-land` only when a landing step remains in the requested workflow.
Do not add a next action when the requested scope is fulfilled. This guidance
does not add a sixth machine field.

When the OpenPlanr dashboard is running, the shipped work is browsable at
`#/detail/<T-###>` and the board at `#/board`. This is navigation only.
