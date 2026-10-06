<!-- Spec-driven paths for planr-backend. Loaded when the caller passes MODE=spec-driven and SPEC_DIR. -->

> **Mode:** spec-driven (`SPEC_DIR` supplied).

## Path Resolution

Ship passes the absolute task file path, `MODE=spec-driven`, and `SPEC_DIR`.
Use that exact task path first.

- Spec directory: `.planr/specs/SPEC-NNN-{slug}/`.
- Task: `<SPEC_DIR>/tasks/T-NNN-{slug}.md`.
- Specification: the single `<SPEC_DIR>/SPEC-NNN-*.md` whose ID matches
  `specId`.
- Parent story: `<SPEC_DIR>/stories/{storyId}-*.md`.
- Optional acceptance scenarios: `<SPEC_DIR>/stories/{storyId}-gherkin.feature`
  when present; story Markdown remains canonical.
- Dependencies: resolve each `dependsOn` ID against task frontmatter in the flat
  `<SPEC_DIR>/tasks/` directory.

If `SPEC_DIR` was not passed, resolve it from the explicit SPEC ID or slug under
`.planr/specs/` and use it only when the match is unique. If no exact task path
was passed, match the explicit task ID or slug only inside that spec's `tasks/`
directory and use it only when unique. Follow
`{{AGENTS_ROOT}}/shared/modes/shared/task-context-resolution.md` after resolving
the file.

## Mode inputs

- The parent story, its optional Gherkin sidecar, and the enclosing
  specification.
- `input/tech/stack.md` when present, with every `ActiveStackFiles` entry
  resolved through the installed stack root and the project-local
  `{{PROJECT_STACKS_ROOT}}` overlay.
- Each declared predecessor's output contract when `dependsOn` is non-empty.
- `output/db/schema.json` when the project keeps that snapshot and the task
  references persistence; otherwise the repository's migrations or ORM models.
  Validate table and column names before implementing them.

Apply `{{AGENTS_ROOT}}/shared/modes/shared/verification-and-recovery-backend.md`
for adaptive verification and recovery, and return the shared
implementation-result format.

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| SPEC_DIR or Ship task path missing/ambiguous | Report the selector, searched directory, and candidates; do not guess |
| Parent story or spec missing | Continue from the task and source when sufficient; list the missing path under Issues |
| Active stack file missing | Report the logical path and both lookup locations; use the installed default when available |
| No schema source for DB work | Identify the affected requirement and avoid inventing tables or columns; continue unaffected work |
| DB table or column absent from the schema source | Report the exact reference and the smallest schema or task correction needed |
| `dependsOn` output unavailable | Name the dependency and required interface; continue independent work and report the blocked portion |
| Preserve path changed | Restore it, use another implementation approach, and report a conflict only if no safe approach remains |
