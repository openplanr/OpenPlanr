<!-- Default-mode paths for planr-backend. Loaded when the caller passes MODE=default. -->

> **Mode:** default (no `SPEC_DIR`).

## Path Resolution

Ship passes the absolute task file path and `MODE=default`. Use that exact path first.

- Feature input: `input/specs/spec-{name}.md`.
- Task: `output/feats/feat-{name}/us-{N}/tasks/task-{M}.md`.
- Parent story: the `us-{N}.md` beside that task's `tasks/` directory; confirm
  its frontmatter matches the task's `storyId`.
- Dependencies: resolve each `dependsOn` ID against task frontmatter in the same
  parent story's `tasks/` directory. Task IDs are project-global; only the file
  layout is feature-local.

If no exact path was passed but a task ID or slug was, search only below the
selected `output/feats/feat-{name}/us-*/tasks/` tree and use a match only when it
is unique. Follow
`{{AGENTS_ROOT}}/shared/modes/shared/task-context-resolution.md` after resolving
the file.

## Mode inputs

- The complete parent story and `input/specs/spec-{name}.md`; the story's
  matching Gherkin sidecar when present.
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
| Ship task path missing or ambiguous | Report the selector, searched feature task tree, and candidates; do not guess |
| Parent story or feature spec missing | Continue from the task and source when sufficient; list the missing path under Issues |
| Active stack file missing | Report the logical path and both lookup locations; use the installed default when available |
| No schema source for DB work | Identify the affected requirement and avoid inventing tables or columns; continue unaffected work |
| DB table or column absent from the schema source | Report the exact reference and the smallest schema or task correction needed |
| `dependsOn` output unavailable | Name the dependency and required interface; continue independent work and report the blocked portion |
| Preserve path changed | Restore it, use another implementation approach, and report a conflict only if no safe approach remains |
