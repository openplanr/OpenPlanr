# Plan artifact contract

## Spec-driven layout

```text
.planr/specs/SPEC-NNN-{slug}/
  SPEC-NNN-{slug}.md
  stories/US-NNN-{slug}.md
  stories/US-NNN-gherkin.feature
  tasks/T-NNN-{slug}.md
```

Use Protocol `1.7.0` frontmatter for stories and tasks. Story frontmatter has
`id`, `title`, `specId`, `slug`, `schemaVersion`, `status`, dates, and
`acceptanceCriteria` entries with stable `AC-NNN` IDs. Task frontmatter has
`id`, `title`, `storyId`, `specId`, `slug`, `schemaVersion`, `type`, `agent`,
`status`, dates, `rationale`, `dependsOn`, `preserve`, `reviewRisks`,
`browserSurfaces`, and `acceptanceRefs`.

Story body headings are `## User Story`, `## Scope`, `## Acceptance Criteria`,
`## Task Breakdown`, `## Dependencies`, and `## Notes`. Task body headings are
`## Objective`, `## Files` with `### Create`, `### Modify`, and
`### Preserve (do not touch)` subsections, `## Technical Spec`,
`## Test Requirements`, and `## Definition of Done`.

Each story criterion must be referenced by at least one task, and that task's
Test Requirements must name the same ID with an observable verification.

## Default layout

When a repository intentionally uses the older default mode, retain its paths:

```text
input/specs/spec-{slug}.md
output/feats/feat-{slug}/us-{N}/us-{N}.md
output/feats/feat-{slug}/us-{N}/tasks/task-{M}.md
```

Do not create both layouts for one request.
