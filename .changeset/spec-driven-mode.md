---
"openplanr": minor
---

Add spec-driven planning mode — third planning posture alongside agile + QT, designed for humans planning *for* AI coding agents.

A new `planr spec` command namespace authors specs that decompose into User Stories and Tasks with the **same artifact contract as the [openplanr-pipeline](https://github.com/openplanr/openplanr-pipeline) Claude Code plugin** — file Create/Modify/Preserve lists, Type=UI|Tech, agent assignment, DoD with build/test commands. The two products share one schema; no conversion adapter ever.

**Subcommands shipped:**

- `planr spec init` — Activate spec-driven mode in the current project
- `planr spec create [title]` — Create a self-contained `.planr/specs/SPEC-NNN-{slug}/` directory
- `planr spec shape <id>` — Interactive 4-question SPEC authoring (Context, Functional Requirements, Business Rules, Acceptance Criteria)
- `planr spec decompose <id>` — AI-driven generation of User Stories + Tasks; matches openplanr-pipeline schema; works with all 3 AI providers (Anthropic, OpenAI, Ollama). Flags: `--force`, `--no-code-context`, `--max-stories <n>`
- `planr spec sync [id]` — Validate spec integrity (orphaned tasks, stories without tasks, missing `specId`, schema drift); auto-fixes safe issues; `--dry-run` reports without writing
- `planr spec list` — List all specs with status + decomposition counts
- `planr spec show <id>` — Print a spec + its US/Task tree
- `planr spec status [id]` — Decomposition state across one or all specs
- `planr spec destroy <id>` — `rm -rf` of a single self-contained spec directory
- `planr spec attach-design <id> --files <png>...` — Attach UI mockups for the pipeline's designer-agent
- `planr spec promote <id>` — Validate completeness, mark `ready-for-pipeline`, print the `/openplanr-pipeline:plan {slug}` handoff command

**Directory layout (per spec, self-contained):**

```
.planr/specs/SPEC-NNN-{slug}/
├── SPEC-NNN-{slug}.md         # the spec document
├── design/                    # PNG mockups + design-spec.md (written by pipeline's designer-agent)
├── stories/US-NNN-{slug}.md   # US-NNN scoped to this spec
└── tasks/T-NNN-{slug}.md      # T-NNN scoped to this spec
```

**ID scoping:** US-NNN and T-NNN are scoped to their parent SPEC (not project-globally unique). Two specs can each have their own US-001. Disambiguate via path or via `specId` frontmatter.

**Coexistence:** purely additive — agile (epic/feature/story/task) and QT modes work unchanged. Activate spec mode per project via `planr spec init`. Modes are independent; pick the posture that fits the work.

**Decompose AI behavior:**
- Always scans the project codebase via the existing `buildCodebaseContext()` so generated tasks reference real file paths matching the user's stack
- Reads `input/tech/stack.md` (best-effort) for stack-specific hints
- Detects `ui_files` in SPEC frontmatter to drive 1-vs-2 tasks per US (per openplanr-pipeline rule R2)
- Refuses to overwrite an existing decomposition unless `--force` is passed
- Status: pending|shaping → decomposing → decomposed

**Pipeline integration:** When this CLI marks a spec `ready-for-pipeline`, the openplanr-pipeline Claude Code plugin (v0.3.0+) reads `.planr/specs/SPEC-NNN-{slug}/` directly — no conversion. See `docs/proposals/spec-driven-mode.md` for the full design proposal and BL-011 for the original strategic feedback.
