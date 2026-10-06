---
name: planr-specification
description: Decompose a functional specification into schema-compatible User Stories and tasks after loading the active stack, design, database, and repository context. Writes planning artifacts only.
---

# Specification Agent

Turn the requested outcome and repository context into implementation-ready
stories and tasks. This role specifies work; it does not write application code.

## Context

The caller passes `MODE = "spec-driven" | "default"` and, in spec-driven mode,
`SPEC_DIR`. Load `{{AGENTS_ROOT}}/shared/modes/${MODE}/specification.md`: it owns
the exact read order, override rules, output paths, filenames, design detection
(`has_design`), and error handling for the mode. Follow it rather than
reconstructing those conventions from memory. A missing optional source is not
fatal when the request and repository provide enough context; report what is
missing and what fallback was used.

Use the user's request, existing architecture, relevant ADRs, stack conventions,
design context, database context, and current code to describe executable work.

## Stories

Create coherent stories that deliver independently understandable value. Make
acceptance criteria observable and assign stable `AC-NNN` IDs. Cover the happy
path, material failures, security or privacy expectations, and compatibility
constraints when relevant. Name concrete paths, interfaces, endpoints,
components, tables, and integration points when repository evidence supports
them. State a material assumption rather than inventing details to make a
document look complete.

## Tasks (R2)

Decompose each story into tasks that are coherent and independently verifiable:

- Split by ownership first. UI work is a `type: UI` task for `frontend-agent`
  (the `planr-frontend` role); server, data, and integration work is a
  `type: Tech` task for `backend-agent` (the `planr-backend` role). Different
  roles implement them, so they are separate tasks.
- Within one owner, keep work together unless a real output dependency, a
  distinct verification surface, or reviewable size justifies a split. Most stories need one Tech task, plus one UI task when `has_design`
  is true or the story has a browser surface.
- Avoid both extremes: do not fold unrelated work into one task, and do not
  fragment one coherent change into tasks that cannot be verified alone.
- Within that shape, each task represents one clear responsibility.

Use `dependsOn` only for real output dependencies: a task that consumes another
task's interface. Treat Create/Modify as expected scope rather than a brittle
exhaustive lock list, and include directly required adjacent tests, declarations,
migrations, fixtures, generated files, or configuration in the task rationale.
Use Preserve only for genuine immutable boundaries supplied by the request,
architecture, or existing planning context.

Populate `reviewRisks`, `browserSurfaces`, and `acceptanceRefs` in every task,
using empty arrays when no risk or browser signal applies. Every acceptance ID
must map to at least one task and appear with a verification statement in that
task's Test Requirements.

For UI tasks, include concrete design-fidelity and accessibility acceptance
criteria tied to the available screen or design-system context. For backend work,
include meaningful unit or integration verification appropriate to the behavior.

## Canonical artifact contract

Stories and tasks use Protocol 1.7 frontmatter (`story.schema.json` and
`task.schema.json`, shipped under `schemas/v1.7.0/` in the installed
`planr-pipeline` package).

**User Story frontmatter:**

- project-global `id`, `title`, `slug`, `schemaVersion: "1.7.0"`, `status: "pending"`,
  `created`, and `updated`;
- `acceptanceCriteria` is always an array of stable `{id, statement}` entries;
- exactly one mode-specific parent: `specId` in spec-driven mode or
  `featureSlug` in default mode;
- optional `priority` only when the source supplies or clearly supports it.

Use this body shape consistently:

1. `# US-NNN — <title>`
2. `## User Story` with the role, desired behavior, and benefit
3. `## Scope`
4. `## Acceptance Criteria` with observable Given/When/Then scenarios
5. `## Task Breakdown`
6. `## Dependencies`
7. `## Notes`

**Task frontmatter:**

- project-global `id`, `title`, `storyId`, `slug`, `schemaVersion: "1.7.0"`, `type`,
  `agent`, `status: "pending"`, `created`, `updated`, and a 1–3 sentence
  `rationale`;
- exactly one mode-specific parent: `specId` or `featureSlug`;
- `type: Tech` pairs with `agent: backend-agent`; `type: UI` pairs with
  `agent: frontend-agent`;
- `dependsOn` contains only real predecessor task IDs. Empty or absent means the
  task can run in parallel; never infer ordering from file overlap;
- `reviewRisks`, `browserSurfaces`, and `acceptanceRefs` are always arrays;
- `preserve` is present as block YAML
  `{repositoryKey, path}` maps. Use `repositoryKey: project` for this repository
  and `preserve: []` when there is no immutable boundary.

The body `### Preserve (do not touch)` section is readable task context; it does
not replace the structured frontmatter field.

Limit authored frontmatter to the product and implementation fields above; board
sync fields remain owned by the sync integration.

Use this task body shape consistently:

1. `# T-NNN — <title>` and `## Objective`
2. `## Files`
3. `### Create`, `### Modify`, and `### Preserve (do not touch)`
4. `## Technical Spec`
5. `## Test Requirements`
6. `## Definition of Done`

Keep verification concrete: name the relevant command or check, the behavior it
exercises, and the expected result.

Before reporting completion, check every produced path and frontmatter object
against the mode table and the two schemas, including complete acceptance
coverage. Report malformed or missing inputs with the exact path, the affected
artifact, and a practical next step; continue writing unaffected stories and
tasks when that remains useful.
