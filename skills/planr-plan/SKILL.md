---
name: planr-plan
description: Turn a Protocol-compatible specification or product intent into schema-compatible OpenPlanr stories and implementation tasks. Use for planning and decomposition, not implementation.
license: MIT
---

# Planr Plan

Turn a decision-complete specification or clear product request into
implementation-ready stories and tasks. Perform the reasoning in this active
coding session. Do not delegate semantic planning to a command-line or model
subprocess. Plan ends with a Ship handoff; it never starts implementation
automatically.

## Resolve context directly

Read the strongest available inputs:

1. the request and selected specification;
2. repository instructions (`AGENTS.md`, `CLAUDE.md`, or equivalents), ADRs,
   planning rules, and active stack files named by the repository;
3. relevant implementation code, tests, package scripts, and CI configuration;
4. design inputs and design specifications when a browser surface is involved;
5. the database schema or persistence code when data behavior is involved.

Use repository-local conventions first. Missing legacy `input/` or `.planr/`
paths do not block a clear request. State what was unavailable and continue when
the remaining context is sufficient.

For a completed Design handoff, read `design-document.json`, the selected
direction, and the authored ten-section `design-spec.md`. The specification lives
inside `design/` in spec-driven mode and beside `design/` in default feature mode.
For a studio-backed design, read its `.design/studio-state.json`: the recorded
`selectedVariant` is authoritative. Verify that the authored document and the
specification describe that same direction before decomposing UI work. If they
disagree, synchronize the design handoff using the settled choice or report the
specific unsynced inputs; do not silently plan the original preview direction.
Use stable screen IDs, component recipes, responsive frames, and interaction
flows as UI-task context. Read the current render's verification result and
unresolved feedback; carry relevant gaps into explicit task checks. Preserve
`finalized.json` compatibility inputs for older designs. Do not regenerate an
existing design or re-extract an authored specification from preview images.

When `review-handoff.json` is present beside `design-spec.md`, read its current
approval and freshness with the bundled
`node scripts/design.mjs handoff <design-document.json> --action inspect --json`. Use approved, current
handoff items as additional planning context, retaining revision/comment links and
unresolved questions. An outdated or unapproved draft is evidence, not agreed scope;
report the changed inputs and obtain the missing decision only when it affects the
requested plan. Never silently substitute a newer draft for an approved snapshot.
A missing review handoff does not block ordinary planning from a clear specification.

For a consequential unresolved choice, use the host's structured question
interface. Ask at most three short, mutually exclusive questions at once. If the
host has no structured question interface, ask one concise chat question.

## Apply PO lenses in-session

When the host supports native agents, dispatch the applicable database,
designer, and specification roles inside this session. Give each role the
request, repository root, relevant paths, and the precise decision or artifact
it owns. Parallelize independent lenses. When native agents are unavailable,
perform the same lenses sequentially in the active agent.

The specification role integrates the results. Database and design roles
provide grounded inputs; they do not create a second independent plan.

## Author the decomposition

Read [the artifact contract](references/artifact-contract.md) before writing.
Write stories and tasks directly in the repository's active planning mode.

- Allocate project-global monotonic `US-NNN` and `T-NNN` IDs. Never reuse a
  deleted ID. The packaged [planning ID helper](scripts/planning-ids.mjs) may
  inspect or reserve IDs; it never generates content.
- Give each story stable acceptance IDs starting at `AC-001`.
- Create one Tech task when no design surface applies; create one UI and one
  Tech task when it does. Never exceed two tasks for one story.
- Map every acceptance ID through `acceptanceRefs` and name it with a concrete
  verification statement under `## Test Requirements`.
- Set `reviewRisks` and `browserSurfaces` from repository evidence; use empty
  arrays when no signal applies.
- Set `dependsOn` only when a task consumes another task's output. File overlap,
  numbering, and prose never create a semantic dependency.
- Name concrete files and repository-grounded checks. Preserve established
  repository headings when they carry additional information.

Validate all frontmatter and acceptance coverage before finishing. If a helper
is unavailable, inspect existing IDs and validate the same invariants directly;
do not route semantic work to a CLI fallback.

## Return

- **Outcome:** what is implementation-ready.
- **Mode:** the planning layout used.
- **Inputs:** repository context and role lenses used.
- **Artifacts:** every story and task path.
- **Issues:** only unresolved inputs or material assumptions, or `none`.
- **Next:** the exact ready task selector and a copy-ready host-native
  invocation such as `$planr-ship T-NNN` (Codex/ChatGPT) or
  `/planr-ship T-NNN` (Claude Code).

When the OpenPlanr dashboard is running, the planned graph is browsable at
`#/board`; open one story at `#/detail/<US-###>`.

Stop after the handoff.
