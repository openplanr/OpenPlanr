# OpenPlanr — Agile Planning & Implementation Guide

> Generated from the OpenPlanr instruction source on 2026-08-30

This project uses OpenPlanr planning context under `.planr/`.

## OpenPlanr context

- Start with the request and relevant code, tests, configuration, documentation,
  ADRs, and project rules.
- When an exact Planr task is supplied, read the complete task first, then its
  complete parent story, enclosing spec, matching Gherkin sidecar when present,
  and declared `dependsOn` output contracts. Treat Create/Modify as the expected
  change surface and structured Preserve entries as unchanged paths.
- Load `input/tech/stack.md` when present. Resolve each `ActiveStackFiles` entry
  from the active OpenPlanr skill's bundled references, then the project stack
  directory; the project file wins on collision.
- Load the applicable `design-spec.md` for UI work and `output/db/schema.json`
  for persistence work.
- When no task is supplied, use the strongest relevant artifacts under
  `.planr/`. Missing or stale planning state does not block a clear
  implementation request.
- Ask only when an unresolved choice materially changes product behavior,
  scope, architecture, or risk. Prefer the host's native structured question
  surface; otherwise ask one concise question.
- Keep PLAN and SHIP as separate user-invoked workflows. PLAN prepares context;
  SHIP implements it. Never auto-chain them. This is a workflow boundary, not
  a prerequisite for useful work within the selected workflow.

## Implementation guidance

1. Implement the coherent requested outcome, including directly required
   companion files.
2. Match the repository's architecture, conventions, and ownership boundaries.
3. Verify in proportion to risk and acceptance behavior. Fix relevant failures
   directly.
4. When a command or check fails, inspect the actual error and use it to choose
   the next useful step. If progress is not possible, report the failing command,
   concise error context, and the next useful action.
5. Report `Outcome`, `Task`, `Changed`, `Checks`, and `Issues`; write `none`
   when no material issue remains.

## Planning artifact map

- Specs: `.planr/specs/`
- Tasks and quick work: `.planr/tasks/`, `.planr/quick/`
- Stories, features, and epics: `.planr/stories/`,
  `.planr/features/`, `.planr/epics/`
- Backlog and architecture decisions: `.planr/backlog/`,
  `.planr/adrs/`
