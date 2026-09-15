<!-- agents/shared/modes/default/frontend.md: default-mode-only content for frontend-agent. Loaded by agents/frontend-agent.md when MODE=default. T-002 of SPEC-002. -->

> **Mode:** default
> **Loaded by:** `agents/frontend-agent.md` when the orchestrator passes `MODE=default` (no `SPEC_DIR`).

## Path Resolution

The orchestrator (`/ship`) passes the absolute task file path and `MODE=default`.
Use that exact path first.

- Feature input: `input/specs/spec-{name}.md`.
- Task: `output/feats/feat-{name}/us-{N}/tasks/task-{M}.md` (`task-1.md` for UI).
- Parent story: the `us-{N}.md` beside that task's `tasks/` directory; confirm
  its frontmatter matches the task's `storyId`.
- Design context: `output/feats/feat-{name}/design-spec.md` when present.
- Dependencies: resolve each `dependsOn` ID against task frontmatter in the same
  parent story's `tasks/` directory. Default-mode task IDs are story-scoped.

If no exact path was passed but a task ID or slug was, search only below the
selected `output/feats/feat-{name}/us-*/tasks/` tree and use a match only when it
is unique. Follow
`agents/shared/modes/shared/task-context-resolution.md` after resolving
the file.

Task content (Create/Modify/Preserve, Type, agent, DoD) is schema-identical in both modes — your behavior doesn't change, only the output paths.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `output/feats/feat-{name}/us-{N}/tasks/task-1.md` | Specification Agent | Yes |
| `output/feats/feat-{name}/design-spec.md` | Designer Agent | If exists |
| `input/tech/stack.md` | Tech Lead | Yes |
| Existing codebase files (for context) | Dev environment | Read-only for context |

---

## Outputs

All files listed under `### Create` and `### Modify` in the task file (`output/feats/feat-{name}/us-{N}/tasks/task-1.md`).

---

## Implementation guidance

```
1. Load the active UI task and extract frontmatter, Create/Modify/Preserve,
   Technical Spec or Implementation, Verification, and Definition of Done. Read
   the complete parent story and `input/specs/spec-{name}.md`; load the story's
   matching Gherkin sidecar when present.
2. Load `input/tech/stack.md`. Resolve every `ActiveStackFiles` entry through the
   installed stack root and the project-local `.claude/stacks` overlay as
   defined by the shared task-context guidance.
3. Read each declared predecessor's output contract when `dependsOn` is non-empty.
   Load `output/feats/feat-{name}/design-spec.md` when it exists.
4. Read the listed files, reusable UI, design-system implementation, and enough
   connected source to understand established interfaces and patterns.
5. Implement the requested UI behavior completely using established project and
   design-system patterns. Cover material loading, empty, error, success, and
   accessibility behavior.
6. Add meaningful component, interaction, and browser coverage where it improves
   confidence.
7. Treat Create/Modify as expected scope. A directly required companion test,
   story, fixture, route registration, generated file, or configuration change is
   valid when it serves acceptance criteria, stays within frontend ownership, and
   remains outside Preserve. Disclose it in the result.
8. Keep Preserve paths unchanged. If the requested outcome conflicts with one,
   find a safe in-scope alternative or report the conflict clearly.
9. Apply `agents/shared/modes/shared/verification-and-recovery-frontend.md` for
   adaptive verification and recovery.
10. Return the shared implementation-result format.
```

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| Ship task path missing or ambiguous | Report the selector, searched feature task tree, and candidates; do not guess |
| Parent story or feature spec missing | Continue from the task and source when sufficient; list the missing path under Issues |
| Active stack file missing | Report the logical path and both lookup locations; use the installed default when available |
| design-spec.md missing | Use the existing design system; report the missing path only when the task depends on absent tokens or states |
| Component library unavailable | Report the import/package and affected UI; use an established project alternative when one exists |
| `dependsOn` output unavailable | Name the dependency and required interface; continue independent work and report the blocked portion |
| Preserve path changed | Restore it, use another implementation approach, and report a conflict only if no safe approach remains |

---

*Reads: task · parent story/spec · dependency outputs · stack overlays · design · source*
*Writes: UI layer files only*
*Runs in parallel with: Backend Agent (task-2)*
