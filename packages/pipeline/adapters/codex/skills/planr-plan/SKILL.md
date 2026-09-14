---
name: planr-plan
description: Turn a Protocol-compatible specification or product intent into schema-compatible OpenPlanr stories and implementation tasks. Use for planning and decomposition, not implementation.
license: MIT
---

# Planr Plan

Create implementation-ready planning artifacts from a specification or a clear
product request. Plan ends with an exact task handoff; it never starts Ship.

## Resolve context

Read the strongest available inputs in this order:

1. **Specification**
   - Spec-driven: `<SPEC_DIR>/SPEC-NNN-{slug}.md`, where `<SPEC_DIR>` is
     `.planr/specs/SPEC-NNN-{slug}/`.
   - Default: `input/specs/spec-{slug}.md`.
   - A decision-complete request can stand in for a missing file. Report the
     missing path and ask only for a decision that the repository cannot answer.
     Use the host's native structured question UI when available and ask one
     concise chat question otherwise.
2. **Stack** — read `input/tech/stack.md`. Resolve each `ActiveStackFiles`
   entry from the installed `planr-pipeline/stacks/` tree, then apply the
   matching `.codex/stacks/` override. The project file wins on
   collision by logical path.
3. **Design** — read `<SPEC_DIR>/design/design-spec.md` in spec-driven mode or
   `output/feats/feat-{slug}/design-spec.md` in default mode, plus available UI
   inputs. Set `has_design = true` when those inputs define a real browser surface.
4. **Database** — read `output/db/schema.json` when persistence is in scope.
   Do not invent schema details when it is absent.

Name unresolved paths and their effect, then continue whenever the remaining
context is sufficient.

## Decompose safely

For spec-driven work, use `planr spec decompose SPEC-NNN`. Add `--preview` to
inspect the proposed global IDs and handoff without writing files. If generated
stories or tasks already exist, preview first and apply with
`--replace-existing`; `--force` is only a deprecated compatibility spelling.
Replacement creates new project-global story and task IDs, resets regenerated
work to `pending`, preserves other files inside the spec, validates the complete
staged result, and then swaps it into place.

Protocol 1.7 IDs are project-global monotonic `SPEC-NNN`, `US-NNN`, and
`T-NNN` values. Never reuse deleted IDs. Response-local task IDs from the
decomposer are translated to global IDs before files are written.

For each story:

- assign stable acceptance IDs beginning at `AC-001`;
- create one Tech task when no design input applies;
- create one UI task and one Tech task when design input applies;
- never create more than two tasks for one story;
- map every acceptance ID to at least one task through `acceptanceRefs` and
  name that ID with its verification statement under `## Test Requirements`;
- populate `reviewRisks` and `browserSurfaces` from real signals, using `[]`
  when none apply;
- set `dependsOn` only when a task consumes another task's output.

Never infer ordering from file overlap, shared paths, task numbering, or prose.
Validate all generated frontmatter against Protocol 1.7 and reject incomplete
acceptance coverage before publishing the staged decomposition.

Story bodies use `## User Story`, `## Scope`, `## Acceptance Criteria`,
`## Task Breakdown`, `## Dependencies`, and `## Notes`. Task bodies use
`## Objective`, `## Files`, `### Create`, `### Modify`,
`### Preserve (do not touch)`, `## Technical Spec`, `## Test Requirements`,
and `## Definition of Done`.

Default-mode paths remain:

- stories: `output/feats/feat-{slug}/us-{N}/us-{N}.md`;
- tasks: `output/feats/feat-{slug}/us-{N}/tasks/task-{M}.md`.

## Response

Return:

- **Outcome:** what is implementation-ready.
- **Mode:** `spec-driven` or `default`.
- **Inputs:** specification, stack overlays, design, and database context used.
- **Artifacts:** every story and task path.
- **Issues:** unresolved inputs or material assumptions; omit when empty.
- **Next:** the exact ready task selector and a copy-ready invocation in the
  form `$planr-ship T-NNN`.

Stop after that handoff.
