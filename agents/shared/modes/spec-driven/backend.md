<!-- {{AGENTS_ROOT}}/shared/modes/spec-driven/backend.md: spec-driven-mode-only content for backend-agent (DEV Tech tasks only). Loaded by agents/backend-agent.md when MODE=spec-driven. -->

> **Mode:** spec-driven
> **Loaded by:** `agents/backend-agent.md` when the orchestrator passes `MODE=spec-driven` and `SPEC_DIR`.

## Path Resolution

The orchestrator (`/ship`) passes the absolute task file path,
`MODE=spec-driven`, and `SPEC_DIR`. Use that exact task path first.

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

**Step 0.2 entity scaffold** (`output/db/schema.json` → `output/src/`): use **`agents/entity-scaffold-agent.md`** — not this file.

---

## Inputs (Dev Mode — Step 3)

| Input | Source | Required |
|-------|--------|----------|
| `<SPEC_DIR>/tasks/T-NNN-{slug}.md` (Type=Tech) | Specification Agent | Yes |
| `input/tech/stack.md` | Tech Lead | Yes |
| `output/db/schema.json` | DB Agent | When referencing the DB |
| Existing codebase (read context) | Dev environment | Read-only |

---

## Outputs (Dev Mode — Step 3)

All files listed under `### Create` and `### Modify` in the task file (`<SPEC_DIR>/tasks/T-NNN-{slug}.md`).

---

## Implementation guidance

```
1. Load `<SPEC_DIR>/tasks/T-NNN-{slug}.md` and extract frontmatter,
   Create/Modify/Preserve, Objective, Implementation or Technical Spec,
   Verification, and Done When. Follow `storyId` to the story, load its optional
   Gherkin sidecar when present, then load the enclosing specification.
2. Load `input/tech/stack.md`. Resolve every `ActiveStackFiles` entry through the
   installed stack root and the project-local `{{PROJECT_STACKS_ROOT}}` overlay as
   defined by the shared task-context guidance.
3. Read each declared predecessor's output contract when `dependsOn` is non-empty.
   Load `output/db/schema.json` when the task references persistence, and validate
   table and column names before implementing them.
4. Read the listed files and enough connected source to understand established
   interfaces and project patterns.
5. Implement the requested backend behavior completely using established project
   patterns. Add meaningful unit and integration coverage where it improves
   confidence.
6. Treat Create/Modify as expected scope. A directly required companion test,
   declaration, migration, fixture, generated file, or configuration change is
   valid when it serves acceptance criteria, stays within backend ownership, and
   remains outside Preserve. Disclose it in the result.
7. Keep Preserve paths unchanged. If the requested outcome conflicts with one,
   find a safe in-scope alternative or report the conflict clearly.
8. Apply `{{AGENTS_ROOT}}/shared/modes/shared/verification-and-recovery-backend.md` for
   adaptive verification and recovery.
9. Return the shared implementation-result format.
```

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| SPEC_DIR or Ship task path missing/ambiguous | Report the selector, searched directory, and candidates; do not guess |
| Parent story or spec missing | Continue from the task and source when sufficient; list the missing path under Issues |
| Active stack file missing | Report the logical path and both lookup locations; use the installed default when available |
| schema.json missing for DB work | Identify the affected requirement and avoid inventing tables or columns; continue unaffected work |
| DB table or column absent from schema | Report the exact reference and the smallest schema or task correction needed |
| `dependsOn` output unavailable | Name the dependency and required interface; continue independent work and report the blocked portion |
| Preserve path changed | Restore it, use another implementation approach, and report a conflict only if no safe approach remains |

---

*Reads: task · spec/story/Gherkin · dependency outputs · stack overlays · schema · source*
*Writes: backend layer files only*
*Runs in parallel with: Frontend Agent (UI task)*
