# Specification contract

For spec-driven repositories, write
`.planr/specs/SPEC-NNN-{slug}/SPEC-NNN-{slug}.md` with Protocol `1.7.0`
frontmatter: `id`, `title`, `slug`, `schemaVersion`, `status`, `priority`,
`created`, `updated`, `ui_files`, and `tech_dependencies`. Preserve supported
optional fields used by the repository.

Use these body sections, in this order, when the repository has no stronger
template:

1. `## Context & Goal`
2. `## Audience`
3. `## Outcome & Measurement`
4. `## Functional Requirements`
5. `## Business Rules`
6. `## Constraints`
7. `## Evidence Expectations`
8. `## Failure Modes`
9. `## Rollback`
10. `## Scope Boundaries`, with `### In Scope` and `### Out of Scope`
11. `## Acceptance Criteria`, with stable `AC-NNN` identifiers
12. `## Declared Risk Specialists`
13. `## Notes for Decomposition`

Keep evidence and rollback as useful planning context, not approval gates or
receipt requirements. A risk-specialist section may be empty when no specialist
lens applies.

For a repository intentionally using default mode, write
`input/specs/spec-{slug}.md` and preserve its active schema. Do not create a
parallel `.planr` spec solely to normalize the project.
