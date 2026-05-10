<!-- agents/modes/default/specification.md: default-mode-only content for specification-agent. Loaded by agents/specification-agent.md when MODE=default. T-002 of SPEC-002. -->

> **Mode:** default
> **Loaded by:** `agents/specification-agent.md` when the orchestrator passes `MODE=default` (no `SPEC_DIR`).

## Path Resolution

The orchestrator (`/plan`) passes `MODE=default`:

- Output goes to `output/feats/feat-$ARGUMENTS/us-{N}/{us-{N}.md, tasks/task-{M}.md}`.

Schema content (frontmatter + body) is identical in both modes.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `input/specs/spec-{name}.md` | Product Owner | Yes |
| `input/tech/stack.md` | Tech Lead | Yes |
| `output/db/schema.json` | DB Agent | If DB interaction required |
| `output/feats/feat-{name}/design-spec.md` | Designer Agent | If PNGs were present |

---

## Outputs

| Output | Path | Description |
|--------|------|-------------|
| User Story N | `output/feats/feat-{name}/us-{N}/us-{N}.md` | One file per US |
| Task M (UI) | `output/feats/feat-{name}/us-{N}/tasks/task-1.md` | UI layer task |
| Task M (Tech) | `output/feats/feat-{name}/us-{N}/tasks/task-2.md` | Tech layer task (if PNG) |

---

## Execution Steps

```
0. Receive feature name from /planr-pipeline:plan as $ARGUMENTS (the {name} in feat-{name})
1. Load input/specs/spec-$ARGUMENTS.md
2. Load input/tech/stack.md
   2a. For each path in stack.md's ActiveStackFiles list → load that stack file
       Look up each path in this order: `${CLAUDE_PLUGIN_ROOT}/stacks/...` (plugin default), then `.claude/stacks/...` (user override).
       User project files always take precedence on filename collision.
       (e.g. ${CLAUDE_PLUGIN_ROOT}/stacks/frontend/nextjs.md, .claude/stacks/backend/custom.md)
   2b. Use stack-file conventions (folder layout, naming) when filling task file paths
3. Check if output/feats/feat-$ARGUMENTS/design-spec.md exists → set has_design = true/false
   (Designer Agent should have run first via /planr-pipeline:plan if PNGs were present)
4. Check if output/db/schema.json exists → load if relevant
   (DB Agent should have run first via /planr-pipeline:plan if DatabaseType is configured)
5. Decompose spec into N User Stories
6. For each US:
   a. Write us-{N}/us-{N}.md
   b. Create us-{N}/tasks/ directory
   c. If has_design: write task-1.md (UI, Frontend Agent) + task-2.md (Tech, Backend Agent)
   d. If !has_design: write task-1.md (Tech only, Backend Agent) — per docs/rules.md R2
   e. Each task's frontmatter sets `rationale:` with 1-3 sentences explaining why this task exists and why these files
7. If any genuine ambiguity remains, emit `output/feats/feat-$ARGUMENTS/clarifications.md` with structured options (see `${CLAUDE_PLUGIN_ROOT}/templates/clarifications.md.tpl`). Continue decomposing unambiguous parts.
8. Log: "Specification Agent complete. N US, M tasks → output/feats/feat-$ARGUMENTS/"
9. STOP. Do not proceed to DEV phase. The /planr-pipeline:plan orchestrator stops here for human review.
```

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| spec-{name}.md missing | Error: "No spec found. Create input/specs/spec-{name}.md first." |
| stack.md missing | Error: "No stack config. Create input/tech/stack.md first." |
| Ambiguous scope in spec | Write best-effort decomposition, flag ambiguities in us-{N}.md Notes |
| DB schema missing but DB tasks needed | Flag in task Notes: "schema.json not found — verify tables manually" |

---

*Reads: spec · stack · design-spec · schema.json*
*Writes: `output/feats/feat-{name}/` arborescence*
*Does NOT chain to DEV — pipeline stops here for human review*
