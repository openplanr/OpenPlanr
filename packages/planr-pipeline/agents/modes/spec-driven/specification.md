<!-- agents/modes/spec-driven/specification.md: spec-driven-mode-only content for specification-agent. Loaded by agents/specification-agent.md when MODE=spec-driven. T-002 of SPEC-002. -->

> **Mode:** spec-driven
> **Loaded by:** `agents/specification-agent.md` when the orchestrator passes `MODE=spec-driven` and `SPEC_DIR`.

## Path Resolution

The orchestrator (`/plan`) passes `MODE=spec-driven` and `SPEC_DIR`:

- Output goes to `<SPEC_DIR>/{stories/US-NNN-{slug}.md, tasks/T-NNN-{slug}.md}` (slug-based filenames; flat tasks/ directory; per-spec ID scoping).

`<SPEC_DIR> = .planr/specs/SPEC-NNN-${ARGUMENTS}/`. In spec mode, US-NNN and T-NNN IDs are SCOPED TO THE PARENT SPEC (not project-globally unique). Schema content (frontmatter + body) is identical in both modes.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `<SPEC_DIR>/SPEC-NNN-{slug}.md` | Product Owner | Yes |
| `input/tech/stack.md` | Tech Lead | Yes |
| `output/db/schema.json` | DB Agent | If DB interaction required |
| `<SPEC_DIR>/design/design-spec.md` | Designer Agent | If PNGs were present |

---

## Outputs

| Output | Path | Description |
|--------|------|-------------|
| User Story N | `<SPEC_DIR>/stories/US-NNN-{slug}.md` | One file per US (per-spec scoping) |
| Task M (UI) | `<SPEC_DIR>/tasks/T-NNN-{slug}.md` | UI layer task (Type=UI) |
| Task M (Tech) | `<SPEC_DIR>/tasks/T-NNN-{slug}.md` | Tech layer task (Type=Tech, if PNG) |

The flat `tasks/` directory is intentional — `storyId` frontmatter on each task links it back to its parent US-NNN.

---

## Execution Steps

```
0. Receive spec slug from /planr-pipeline:plan as $ARGUMENTS (the {slug} in SPEC-NNN-{slug})
1. Load <SPEC_DIR>/SPEC-NNN-$ARGUMENTS.md
2. Load input/tech/stack.md
   2a. For each path in stack.md's ActiveStackFiles list → load that stack file
       Look up each path in this order: `${CLAUDE_PLUGIN_ROOT}/stacks/...` (plugin default), then `.claude/stacks/...` (user override).
       User project files always take precedence on filename collision.
   2b. Use stack-file conventions (folder layout, naming) when filling task file paths
3. Check if <SPEC_DIR>/design/design-spec.md exists → set has_design = true/false
   (Designer Agent should have run first via /planr-pipeline:plan if PNGs were present)
4. Check if output/db/schema.json exists → load if relevant
5. Decompose spec into N User Stories
6. For each US:
   a. Write <SPEC_DIR>/stories/US-NNN-{slug}.md (per-spec ID scoping)
   b. If has_design: write T-NNN-{slug}.md for the UI task (Type=UI) + T-NNN-{slug}.md for the Tech task (Type=Tech) under <SPEC_DIR>/tasks/
   c. If !has_design: write a single T-NNN-{slug}.md (Type=Tech) — per docs/rules.md R2
   d. Each task's frontmatter sets `storyId: "US-NNN"` to link back to its parent
7. Log: "Specification Agent complete. N US, M tasks → <SPEC_DIR>/"
8. STOP. Do not proceed to DEV phase. The /planr-pipeline:plan orchestrator stops here for human review.
```

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| `<SPEC_DIR>/SPEC-NNN-{slug}.md` missing | Error: "No spec found at <SPEC_DIR>. Initialize via planr CLI first." |
| stack.md missing | Error: "No stack config. Create input/tech/stack.md first." |
| Ambiguous scope in spec | Write best-effort decomposition, flag ambiguities in US Notes |
| DB schema missing but DB tasks needed | Flag in task Notes: "schema.json not found — verify tables manually" |

---

*Reads: spec · stack · design-spec · schema.json (all under `<SPEC_DIR>/...`)*
*Writes: `<SPEC_DIR>/stories/` · `<SPEC_DIR>/tasks/`*
*Does NOT chain to DEV — pipeline stops here for human review*
