<!-- agents/shared/modes/spec-driven/frontend.md: spec-driven-mode-only content for frontend-agent. Loaded by agents/frontend-agent.md when MODE=spec-driven. T-002 of SPEC-002. -->

> **Mode:** spec-driven
> **Loaded by:** `agents/frontend-agent.md` when the orchestrator passes `MODE=spec-driven` and `SPEC_DIR`.

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
- Design context: `<SPEC_DIR>/design/design-spec.md` when present.
- Dependencies: resolve each `dependsOn` ID against task frontmatter in the flat
  `<SPEC_DIR>/tasks/` directory.

If `SPEC_DIR` was not passed, resolve it from the explicit SPEC ID or slug under
`.planr/specs/` and use it only when the match is unique. If no exact task path
was passed, match the explicit task ID or slug only inside that spec's `tasks/`
directory and use it only when unique. Follow
`agents/shared/modes/shared/task-context-resolution.md` after resolving
the file. Task content is schema-identical in both modes; only paths differ.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `<SPEC_DIR>/tasks/T-NNN-{slug}.md` (Type=UI) | Specification Agent | Yes |
| `<SPEC_DIR>/design/design-spec.md` | Designer Agent | If exists |
| `input/tech/stack.md` | Tech Lead | Yes |
| Existing codebase files (for context) | Dev environment | Read-only for context |

---

## Outputs

All files listed under `### Create` and `### Modify` in the task file (`<SPEC_DIR>/tasks/T-NNN-{slug}.md`).

---

## Implementation guidance

```
1. Load `<SPEC_DIR>/tasks/T-NNN-{slug}.md` and extract frontmatter,
   Create/Modify/Preserve, Objective, Implementation or Technical Spec,
   Verification, and Done When. Follow `storyId` to the story, load its optional
   Gherkin sidecar when present, then load the enclosing specification.
2. Load `input/tech/stack.md`. Resolve every `ActiveStackFiles` entry through the
   installed stack root and the project-local `.claude/stacks` overlay as
   defined by the shared task-context guidance.
3. Read each declared predecessor's output contract when `dependsOn` is non-empty.
   Load `<SPEC_DIR>/design/design-spec.md` when it exists.
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
| SPEC_DIR or Ship task path missing/ambiguous | Report the selector, searched directory, and candidates; do not guess |
| Parent story or spec missing | Continue from the task and source when sufficient; list the missing path under Issues |
| Active stack file missing | Report the logical path and both lookup locations; use the installed default when available |
| design-spec.md missing | Use the existing design system; report the missing path only when the task depends on absent tokens or states |
| Component library unavailable | Report the import/package and affected UI; use an established project alternative when one exists |
| `dependsOn` output unavailable | Name the dependency and required interface; continue independent work and report the blocked portion |
| Preserve path changed | Restore it, use another implementation approach, and report a conflict only if no safe approach remains |

---

*Reads: task · spec/story/Gherkin · dependency outputs · stack overlays · design · source*
*Writes: UI layer files only*
*Runs in parallel with: Backend Agent (Tech task)*
