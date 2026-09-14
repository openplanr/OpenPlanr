<!-- agents/shared/modes/default/specification.md: default-mode-only content for specification-agent. Loaded by agents/specification-agent.md when MODE=default. T-002 of SPEC-002. -->

> **Mode:** default
> **Loaded by:** `agents/specification-agent.md` when the orchestrator passes `MODE=default` (no `SPEC_DIR`).

## Path Resolution

The orchestrator (`/plan`) passes `MODE=default`:

- Output goes to `output/feats/feat-$ARGUMENTS/us-{N}/{us-{N}.md, tasks/task-{M}.md}`.

Protocol 1.7 frontmatter is identical in both modes. `SPEC-NNN`, `US-NNN`, and
`T-NNN` IDs are project-global, monotonic, and never reused; default-mode file
names retain their established feature-local layout.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `input/specs/spec-{name}.md` or explicit request | User / Product Owner | Use strongest available |
| `input/tech/stack.md` | Tech Lead | Load when present |
| `output/db/schema.json` | DB Agent | If DB interaction required |
| `output/feats/feat-{name}/design-spec.md` | Designer Agent | If PNGs were present |

---

## Outputs

| Output | Path | Description |
|--------|------|-------------|
| User Story N | `output/feats/feat-{name}/us-{N}/us-{N}.md` | One file per US |
| Task M (UI) | `output/feats/feat-{name}/us-{N}/tasks/task-1.md` | UI layer task |
| Task M (Tech) | `output/feats/feat-{name}/us-{N}/tasks/task-1.md` without design; `task-2.md` with design | Tech layer task |

---

## Deterministic execution

```
0. Resolve $ARGUMENTS as the {name} in `feat-{name}`.
1. Load `input/specs/spec-$ARGUMENTS.md`. If it is absent, use the explicit
   request when it contains enough product intent; otherwise report the missing
   path and the specific decision still needed.
2. Load `input/tech/stack.md` when present.
   a. Read its `ActiveStackFiles` entries in declared order.
   b. For each entry, load the installed default from
      `${CLAUDE_PLUGIN_ROOT}/stacks/...` first, then load the matching
      `.claude/stacks/...` file when present. The project file overrides
      the installed file on a filename collision.
   c. Apply the resulting folder, naming, framework, testing, and integration
      conventions when selecting task paths. If a declared stack file cannot be
      resolved in either location, report that exact entry and continue with the
      remaining valid context.
3. Detect design intent deterministically:
   a. load `output/feats/feat-$ARGUMENTS/design-spec.md` when it exists; or
   b. when no design spec exists, inspect the designer input sources (`UIFiles`,
      `input/ui/feat-$ARGUMENTS/*.png`, then the documented single-feature
      `input/ui/*.png` fallback).
   Set `has_design = true` when either a design spec or valid design input exists.
4. Load `output/db/schema.json` when the spec or stack indicates database work.
   If it is expected but absent, identify the affected story/task and record the
   missing schema as an implementation note rather than inventing tables.
5. Decompose the source into independently valuable User Stories and write each
   story to `output/feats/feat-$ARGUMENTS/us-{N}/us-{N}.md` using the canonical
   story frontmatter and body shape.
6. For each story, create its `tasks/` directory and apply R2:
   a. `has_design = true`: write one `task-1.md` as `type: "UI"` /
      `agent: "frontend-agent"`, and one `task-2.md` as `type: "Tech"` /
      `agent: "backend-agent"`;
   b. `has_design = false`: write one `task-1.md` as `type: "Tech"` /
      `agent: "backend-agent"`;
   c. never write a third task for the story.
7. Populate every task with its required Protocol 1.7 schema fields, mode parent
   `featureSlug`, 1–3 sentence `rationale`, concrete Create/Modify paths,
   verification, and `preserve` block maps with exact `repositoryKey` and `path`
   fields (or `preserve: []`). The task body remains readable task context; it
   does not replace the canonical frontmatter fields.
8. Assign stable `AC-NNN` story criteria. Populate task `reviewRisks`,
   `browserSurfaces`, and `acceptanceRefs` arrays; map every criterion to at
   least one task and name its verification under Test Requirements.
9. Set `dependsOn` only when a task consumes another task's output. Task IDs are
   project-global. Empty or absent means parallel;
   do not derive dependencies from file overlap, shared paths, or write sets and
   do not bury a hard dependency only in prose.
10. Validate the written paths and frontmatter against the output table,
   Protocol 1.7 `story.schema.json` and `task.schema.json`, and complete
   acceptance coverage. Report every path, then end with the exact ready task
   selector and `/planr-pipeline:ship T-NNN`. Do not start Ship.
```

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| `spec-{name}.md` missing | Name the missing path; use explicit product intent when sufficient, otherwise ask for the one missing decision |
| `stack.md` missing | Report the path, infer conventions from the repository, and mark material assumptions |
| Active stack entry missing or malformed | Name the exact entry and both lookup roots; continue with other valid entries |
| Design input exists but `design-spec.md` is missing | Keep `has_design = true`, create the UI task, and report that design extraction/context is incomplete |
| Ambiguous scope in spec | Decompose unaffected scope and identify the exact ambiguity in Delivery Notes |
| DB schema missing but DB tasks needed | Identify the affected task and note `schema.json not found — verify the data contract before implementation` |
| Story/task schema mismatch | Report the artifact path, field, expected shape, and correction; do not present malformed output as complete |

---

*Reads: spec · stack · design-spec · schema.json*
*Writes: `output/feats/feat-{name}/` arborescence*
*Produces schema-compatible planning artifacts and a concise diagnostic summary.*
