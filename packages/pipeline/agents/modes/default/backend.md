<!-- agents/shared/modes/default/backend.md: default-mode-only content for backend-agent (DEV Tech tasks only). Loaded by agents/backend-agent.md when MODE=default. -->

> **Mode:** default
> **Loaded by:** `agents/backend-agent.md` when the orchestrator passes `MODE=default` (no `SPEC_DIR`).

## Path Resolution

The orchestrator (`/ship`) passes the absolute task file path and `MODE=default`.
Use that exact path first.

- Feature input: `input/specs/spec-{name}.md`.
- Task: `output/feats/feat-{name}/us-{N}/tasks/task-{M}.md`
  (`task-2.md` for Tech, or the sole `task-1.md` when there is no UI task).
- Parent story: the `us-{N}.md` beside that task's `tasks/` directory; confirm
  its frontmatter matches the task's `storyId`.
- Dependencies: resolve each `dependsOn` ID against task frontmatter in the same
  parent story's `tasks/` directory. Default-mode task IDs are story-scoped.

If no exact path was passed but a task ID or slug was, search only below the
selected `output/feats/feat-{name}/us-*/tasks/` tree and use a match only when it
is unique. Follow
`agents/shared/modes/shared/task-context-resolution.md` after resolving
the file.

**Step 0.2 entity scaffold** (`output/db/schema.json` → `output/src/`): use **`agents/entity-scaffold-agent.md`** — not this file.

---

## Inputs (Dev Mode — Step 3)

| Input | Source | Required |
|-------|--------|----------|
| `output/feats/feat-{name}/us-{N}/tasks/task-2.md` (or sole `task-1.md`) | Specification Agent | Yes |
| `input/tech/stack.md` | Tech Lead | Yes |
| `output/db/schema.json` | DB Agent | When referencing the DB |
| Existing codebase (read context) | Dev environment | Read-only |

---

## Outputs (Dev Mode — Step 3)

All files listed under `### Create` and `### Modify` in the task file (`output/feats/feat-{name}/us-{N}/tasks/task-{M}.md`).

---

## Implementation guidance

```
1. Load the active Tech task and extract frontmatter, Create/Modify/Preserve,
   Technical Spec or Implementation, Verification, and Definition of Done. Read
   the complete parent story and `input/specs/spec-{name}.md`; load the story's
   matching Gherkin sidecar when present.
2. Load `input/tech/stack.md`. Resolve every `ActiveStackFiles` entry through the
   installed stack root and the project-local `.claude/stacks` overlay as
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
8. Apply `agents/shared/modes/shared/verification-and-recovery-backend.md` for
   adaptive verification and recovery.
9. Return the shared implementation-result format.
```

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| Ship task path missing or ambiguous | Report the selector, searched feature task tree, and candidates; do not guess |
| Parent story or feature spec missing | Continue from the task and source when sufficient; list the missing path under Issues |
| Active stack file missing | Report the logical path and both lookup locations; use the installed default when available |
| schema.json missing for DB work | Identify the affected requirement and avoid inventing tables or columns; continue unaffected work |
| DB table or column absent from schema | Report the exact reference and the smallest schema or task correction needed |
| `dependsOn` output unavailable | Name the dependency and required interface; continue independent work and report the blocked portion |
| Preserve path changed | Restore it, use another implementation approach, and report a conflict only if no safe approach remains |

---

*Reads: task · parent story/spec · dependency outputs · stack overlays · schema · source*
*Writes: backend layer files only*
*Runs in parallel with: Frontend Agent (task-1)*
