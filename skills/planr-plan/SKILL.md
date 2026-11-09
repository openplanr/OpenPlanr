---
name: planr-plan
description: Turn a Protocol-compatible specification or product intent into schema-compatible OpenPlanr stories and implementation tasks. Use for planning and decomposition, not implementation.
license: MIT
---

# OpenPlanr Plan

Turn a decision-complete specification or clear product request into
implementation-ready stories and tasks in this active coding session. Do not
delegate semantic planning to a command-line or model subprocess. Plan ends with a
Ship handoff; it never starts implementation
automatically.

## Resolve context directly

Read the request, the selected specification and the files either names, plus
`AGENTS.md` and `CLAUDE.md` when tracked, in one batch. Expand only for a missing
contract, a dependency or a contradiction, and stop when each claim has evidence
or a named gap. Read the schema or persistence code when data behavior is involved.

Use repository-local conventions first. Missing legacy `input/` or `.planr/`
paths do not block a clear request. State what was unavailable and continue when
the remaining context is sufficient.

When a design exists (a design spec, a review handoff or an approved
implementation package), read
[the design handoff contract](references/design-handoff.md) before decomposing UI
work. Without a design, ordinary planning from a clear specification is
unchanged. If `openplanr` is not found, lacks `design`, or reports
`E_DESIGN_RUNTIME_MISSING`, name the fix: install the `openplanr` CLI at this plugin's version, upgrade it to
that version, or reinstall it without `--omit=optional`, respectively.

For a consequential unresolved choice, use the host's structured question
interface. Ask at most three short, mutually exclusive questions at once. If the
host has no structured question interface, ask one concise chat question.

## Apply PO lenses in-session

The main session owns the plan, decisions, and integration. Keep small coherent
planning work in this session. Delegate only a self-contained outcome that
benefits from context isolation, a distinct capability boundary, or independent
parallel work; agent availability alone is not a reason to dispatch.

Use specification for a distinct planning assignment or completeness review,
designer for a separate design deliverable or critique, and database only for
authorized read-only live introspection when repository schemas are insufficient.
Do not have two planners decompose the same request. Entity scaffolding remains
manual, on explicit request.

Select the exact registered identity from the host's roster; Claude plugin
agents use names such as `planr:planr-specification`. Give each worker its outcome,
authoritative paths, relevant decisions, file ownership, verification requirements,
and concise return expectations. Parallel workers need disjoint writes or an
agreed interface. When the host lacks the native role, perform the work sequentially in this session
and disclose capability limitations; never claim an unavailable specialist ran.

## Choose where the plan goes

When the repository has no `.planr/`, return the decomposition in chat or in one
file where the repository keeps such documents, even when implementation follows.
Use plain task and acceptance numbering, write no `.planr/` files and skip
frontmatter and the ID procedure; task splitting, `dependsOn` and mapping every
acceptance item to a task still apply. End with one line offering `openplanr init`
for tracked IDs and the full planning contract; never create `.planr/` or run init
unless the user asks. With `.planr/`, use the full planning contract below.

An existing specification stays where it is: never copy an existing specification
into `.planr/specs/`; reference its path from each story's Notes. Write Gherkin
`.feature` files only when the user asks.

## Author the decomposition

Read [the artifact contract](references/artifact-contract.md) before writing.
Write stories and tasks directly in the repository's active planning mode.

- Allocate project-global monotonic `US-NNN` and `T-NNN` IDs. Never reuse a
  deleted ID. Follow [the planning ID procedure](references/planning-ids.md)
  immediately before writing: it reads the stored sequence and the existing
  files, never overwrites an artifact, and never falls back to `US-001` or
  `T-001`.
- Give each story stable acceptance IDs starting at `AC-001`.
- Split each story into tasks that are coherent and independently verifiable.
  Separate by ownership first: UI work is a `UI` task for the frontend role and
  server, data, or integration work is a `Tech` task for the backend role.
  Within one owner, split further only for a real output dependency, a distinct
  verification surface, or reviewable size. Most stories need one Tech task,
  plus one UI task when a design surface applies; never fragment one coherent
  change into tasks that cannot be verified alone, and never fold unrelated work
  into one task.
- Map every acceptance ID through `acceptanceRefs` and name it with a concrete
  verification statement under `## Test Requirements`.
- Set `reviewRisks` and `browserSurfaces` from repository evidence; use empty
  arrays when no signal applies.
- Set `dependsOn` only when a task consumes another task's output. File overlap,
  numbering, and prose never create a semantic dependency.
- Name concrete files and repository-grounded checks. Preserve established
  repository headings when they carry additional information.

Before finishing, check directly that every story and task frontmatter is
valid, every acceptance ID is mapped through `acceptanceRefs` and named under
`## Test Requirements`, and no ID repeats an existing one. When
`command -v openplanr` succeeds and a `SPEC-NNN` exists,
`openplanr spec validate-plan <SPEC-ID>` also checks the spec's stories and
tasks, and `openplanr spec sync <SPEC-ID> --dry-run` adds an orphan and
schema-drift check; both write nothing. Do not route semantic work to a CLI fallback.

## Return

Lead with what is implementation-ready. Keep full story/task inventories and
acceptance mappings in the planning artifacts; link their index or parent story
instead of repeating every path in chat.

- **Outcome:** the ready scope and story/task counts, or what remains partial or blocked.
- **Artifacts:** clickable specification, story and task links grouped by purpose.
- **Checks:** frontmatter, ID and acceptance coverage checks actually performed.
- **Issues:** unresolved inputs or material assumptions, with their impact and recovery step; omit when empty.
- **Next:** the exact ready task selector and a copy-ready host-native
  invocation such as `/planr:ship T-NNN` (Claude Code), `$planr:ship T-NNN`
  (Codex/ChatGPT) or the `planr-ship` rule (Cursor). In minimal mode, name the
  task number or file instead of a selector.

Mention the layout or lenses only when they explain a material choice. Follow [the shared return rules](references/return-contract.md).

When the OpenPlanr dashboard is running, the planned graph is browsable at
`#/board`; open one story at `#/detail/<US-###>`.

Stop after the handoff.
