---
id: "BL-011"
title: "Spec-driven planning mode — third posture alongside agile + QT, shared schema with openplanr-pipeline"
priority: "critical"
tags: ["feedback", "strategy", "spec-driven", "pipeline-integration", "architecture", "roadmap", "multi-mode", "in-design"]
status: "in-design"
created: "2026-04-25"
updated: "2026-04-25"
designDoc: "docs/proposals/spec-driven-mode.md"
relatedRepos:
  - "openplanr/openplanr-pipeline"
  - "openplanr/skills"
---

# BL-011: Spec-driven planning mode — third posture, shared schema with openplanr-pipeline

## Status update — 2026-04-25

**Promoted to `in-design`.** A formal design proposal has been authored that incorporates this backlog item plus the addendum's directory-structure revision. When this BL is implemented, follow the design doc as canonical, not the verbatim feedback below (kept for provenance).

- **Design doc:** [`docs/proposals/spec-driven-mode.md`](../../docs/proposals/spec-driven-mode.md) (to be committed)
- **Addendum's directory layout adopted:** `.planr/specs/SPEC-NNN-{slug}/{design,stories,tasks}/` (self-contained per spec)
- **ID scoping resolved:** `US-NNN` and `T-NNN` are scoped to their parent SPEC, not project-globally unique
- **`mode:` and `featSlug:` frontmatter dropped** (redundant — directory location declares mode; path declares spec linkage with `specId` as the explicit pointer)
- **Schema versioning added:** `schemaVersion: "1.0.0"` on all artifacts
- **Cross-repo coordination defined:** planr CLI ships first, then openplanr-pipeline v0.3.0 adds the bridge, then openplanr-skills updates the `openplanr` SKILL.md to teach Claude about spec mode

## Priority
CRITICAL

## Tags

- feedback
- strategy
- spec-driven
- pipeline-integration
- architecture
- roadmap
- multi-mode

## Description

Verbatim PM-style feedback proposing a third planning mode (`spec-driven`) alongside the existing `agile` and `quick` modes. The goal: produce planning artifacts that AI agents can execute directly, with a richer task contract (file Create/Modify/Preserve lists, agent assignment, DoD with build/test commands). Schema is the existing `openplanr-pipeline` plugin's contract — adopt verbatim, no conversion layer.

Sibling to BL-010 (refine/revise feedback). Both BLs likely benefit from a combined plan once triaged — they share the same direction (richer artifact contracts, repo-aware authoring) and the implementation work overlaps (path validation, deliverable tracking, file-list grounding).

---

# As OpenPlanr's PM — yes, this is the right move

Adding a **spec-driven planning layer** to OpenPlanr CLI is the strategically correct direction. It transforms OpenPlanr from "yet another agile tool" into "the planning tool *for the agentic era*" — a real positional moat. Most agile tools (Linear, Jira, Asana, Shortcut) optimize for humans planning for humans. OpenPlanr could uniquely optimize for **humans planning for AI agents to execute**, where the artifact contract is fundamentally different (file lists, agent assignment, DoD with build/test commands — not story points and burndown charts).

**Strategic logic:**

- The pipeline framework already proves the spec-driven artifact contract works. Don't reinvent — port it into OpenPlanr.
- A spec-driven mode in `planr` makes the bridge to `openplanr-pipeline` *trivial* — same schema, same paths. No conversion layer.
- The agile layer (epic/feature/story/task) and the QT layer remain untouched. Adopt a **three-mode posture**: agile, quick, spec-driven. Pick the mode that matches the team's reality.
- Competitive positioning becomes much sharper: "OpenPlanr — three planning modes, one CLI. Agile for humans. Quick for one-offs. Spec-driven for AI agents." That's a marketable differentiation Linear/Jira can't replicate without rebuilding.

The risk is scope creep, but it's manageable: spec-driven mode reuses 80% of OpenPlanr's existing primitives (markdown artifacts, frontmatter, cross-references, `--yes` semantics). The new content is template + commands + the agent-contract task schema.

Below is a full PM-style feedback prompt for the OpenPlanr team.

---

# Feedback for OpenPlanr Developers — Add a Spec-Driven Planning Layer

## TL;DR

Add a third planning mode to `planr`: **spec-driven**, alongside agile and QT. The unit of planning is a `SPEC-NNN-{name}.md` that decomposes into `US-NNN-{name}.md` (User Stories) and `T-NNN-{name}.md` (agent-execution Tasks). This mode is designed for teams planning *for* AI agents, not for humans. It uses an artifact contract richer than current OpenPlanr tasks: explicit file Create/Modify/Preserve lists, task `Type` (UI vs Tech), `agent` assignment, and a Definition of Done that names build/test commands.

The schema is defined by the existing `openplanr-pipeline` Claude Code plugin. **`planr` should adopt that schema verbatim** so the two tools share a single source of truth — no conversion layer ever.

---

## Strategic Context (the why)

OpenPlanr's current value prop is "agile planning for coding agents". That's correct but understated. The agile layer (epic/feature/story/task) and QT layer are useful, but they're not differentiated against Linear, Jira, or hand-rolled markdown.

The differentiated play: **planning artifacts that AI agents can execute directly**, with no human re-translation. That requires tasks to carry:
- Specific file paths to create, modify, preserve (not "implement the auth service")
- Task type (UI vs Tech) for agent routing
- Agent assignment (Frontend Agent vs Backend Agent)
- DoD with explicit build/test commands the agent runs to verify itself

Today's `planr task create` produces tasks too loose for this. The `openplanr-pipeline` Claude Code plugin already produces the right shape (`task-{M}.md` under `output/feats/feat-{name}/us-{N}/tasks/`). OpenPlanr should host the *authoring* of those artifacts as a first-class mode in the CLI, with the pipeline as the *executor*.

This matters for OpenPlanr commercially because:
1. It moves OpenPlanr "up the stack" from artifact tracker to artifact authoring system.
2. It creates a hard moat: tools that don't understand agent-execution contracts can't compete in this lane.
3. It tightens the planr ↔ pipeline integration story to "they share a schema" — much stronger than "they have an adapter".

---

## What to Build (concretely)

### 1. New CLI commands

Add a `planr spec` namespace:

```bash
planr spec init --yes                                           # Marks .planr/ as spec-driven mode (writes mode flag in config.json)
planr spec create --title "Auth flow" --yes                     # Creates SPEC-001-auth-flow.md from template
planr spec create --file path/to/prd.md --yes                   # Creates spec from existing PRD doc
planr spec shape SPEC-001 --yes                                 # 4-question guided dialogue (port /shape-spec from the plugin)
planr spec decompose SPEC-001 --yes                             # Generates US-NNN + T-NNN files (the agent-execution contract)
planr spec status                                               # Tree view of all specs + their US + tasks + state
planr spec sync                                                 # Validates parent links, repairs frontmatter
planr spec promote SPEC-001 --to-pipeline                       # Hands off to openplanr-pipeline for execution
```

The `decompose` command is the new core capability. It produces tasks with the agent-contract schema — see Schema section below.

### 2. New artifact directory

```
.planr/
├── config.json                  # add "modes": ["agile", "qt", "spec-driven"] field
├── epics/                       # existing — agile mode
├── features/                    # existing — agile mode
├── stories/                     # existing — agile mode
├── tasks/                       # existing — agile mode
├── quick/                       # existing — QT mode
├── specs/                       # NEW — spec-driven mode
│   └── SPEC-001-{slug}.md
├── feats/                       # NEW — spec-driven mode
│   └── feat-{slug}/
│       ├── design-spec.md       # written by `planr spec attach-design` if mockups exist
│       ├── us-1/
│       │   ├── us-1.md
│       │   └── tasks/
│       │       ├── task-1.md
│       │       └── task-2.md
│       └── us-N/
└── ...
```

The `feats/` tree mirrors exactly what `openplanr-pipeline` writes to `output/feats/`. The pipeline plugin should be updated to **read from `.planr/feats/`** when the mode flag is `spec-driven`, eliminating the duplicate `output/feats/` tree.

### 3. Artifact schemas (port from openplanr-pipeline)

#### `.planr/specs/SPEC-NNN-{slug}.md` (frontmatter + body)

```yaml
---
id: SPEC-001
title: "User Authentication"
mode: spec-driven
status: pending           # pending | decomposed | in-pipeline | done
created: 2026-04-25
priority: P0
ui_files: []              # PNGs that belong to this spec
tech_dependencies: []     # other SPECs this depends on
---

[Body follows the existing pipeline template — Context, Functional Requirements,
Business Rules, User Flows, Out of Scope, Acceptance Criteria, Notes for Decomposition]
```

#### `.planr/feats/feat-{slug}/us-{N}/us-{N}.md`

```yaml
---
id: US-001
specId: SPEC-001
featSlug: feat-auth
status: pending
---

[As-a / I-want / So-that, Scope, Acceptance Criteria, Task Breakdown table,
Dependencies, Notes — same shape as openplanr-pipeline's us-{N}.md]
```

#### `.planr/feats/feat-{slug}/us-{N}/tasks/task-{M}.md` (the new contract)

```yaml
---
id: T-001
storyId: US-001
specId: SPEC-001
type: UI                  # UI | Tech
agent: frontend-agent     # which subagent owns this
status: pending
files_create:
  - src/features/auth/components/LoginForm.tsx
files_modify:
  - src/app/layout.tsx
files_preserve:
  - src/lib/auth/legacy.ts
---

[Objective, Technical Spec, Test Requirements, Definition of Done — referencing
input/tech/stack.md::BuildCommand and TestCommand]
```

This is the schema the `openplanr-pipeline` plugin already produces. By hosting the authoring in `planr`, the pipeline becomes purely an executor.

### 4. Mode handling in existing commands

`planr` should detect mode from `config.json` and route commands appropriately:
- `planr status` shows whichever mode is active (or all three with section headers)
- `planr rules generate` produces CLAUDE.md sections for spec-driven projects (pointing agents at the right artifact types)
- `planr github push` handles spec/US/task artifacts as well as agile artifacts

### 5. Bridge to openplanr-pipeline

The pipeline plugin's `commands/po-phase.md` and `commands/dev-phase.md` should be updated (in pipeline v0.2) to **read from `.planr/feats/` first**, falling back to `output/feats/` only if `.planr/` doesn't exist. When OpenPlanr is detected (via presence of `.planr/config.json` with `mode: spec-driven`), the pipeline reads/writes the planr tree directly. No conversion.

The `planr spec promote SPEC-001 --to-pipeline` command:
- Validates the SPEC has been decomposed (`status: decomposed`)
- Checks `output/feats/feat-{slug}/` doesn't conflict with `.planr/feats/feat-{slug}/`
- Updates SPEC frontmatter to `status: in-pipeline`
- Prints: `"Ready to ship. Run /openplanr-pipeline:dev-phase {slug}"`

### 6. Migration / coexistence

- Existing `.planr/` directories remain valid; mode flag is *additive*, not exclusive.
- A project can use agile + QT + spec-driven simultaneously (different teams, different posture).
- `planr quick promote QT-001 --story US-001` continues to work for agile-mode promotion. Add a parallel `planr quick promote QT-001 --to-spec SPEC-001` for spec-driven promotion.

### 7. CLAUDE.md / AGENTS.md generation

Update `planr rules generate` so when `spec-driven` mode is active, the generated CLAUDE.md includes:
- Pointer to the spec directory and decomposition convention
- Hard rule: no User Story numbering jumps
- Hard rule: every task must name files under Create/Modify/Preserve
- Pointer to `openplanr-pipeline` plugin docs for execution semantics

---

## Why share the schema, don't bridge it

Two architectures were considered:

**A) OpenPlanr defines its own artifact format. Adapter converts to pipeline format on `--to-pipeline`.**
- Pro: each tool fully owns its schema.
- Con: drift inevitable. Schema versioning is hell. Adapter becomes maintenance debt.

**B) OpenPlanr adopts the pipeline's schema verbatim. Pipeline reads `.planr/feats/` directly when present.**
- Pro: zero conversion layer ever. One schema = one bug surface.
- Con: tighter coupling between products.

**Pick B.** The coupling is intentional and is the differentiator. "These tools share a schema" is a feature, not a bug — it's why bridging works at all.

The schema lives in one place: a new repo `OpenPlanr/spec-schema` with markdown templates, frontmatter validation, and a minimal Node module both `planr` and `openplanr-pipeline` import. Versioned independently, semver-bumped together.

---

## Phased Rollout

### Phase 1: `planr` v(current+1).0 — minimum viable spec-driven mode

- `planr spec create`, `planr spec shape`, `planr spec decompose`, `planr spec status`
- `.planr/specs/`, `.planr/feats/` directories
- Schemas matching openplanr-pipeline 0.1.0
- `config.json` mode flag
- Documentation: README section "Three modes of planning"

Ship in 1 sprint (1-2 weeks). Mark as **experimental** in release notes.

### Phase 2: `planr` v(current+1).1 — pipeline integration

- `planr spec promote --to-pipeline`
- Update CLAUDE.md / AGENTS.md generation for spec-driven mode
- Update `planr rules generate` for the new mode

### Phase 3: `openplanr-pipeline` v0.2 — read from `.planr/feats/`

- Pipeline detects `.planr/config.json` and reads planr's spec-driven tree directly
- `output/feats/` becomes a fallback only

### Phase 4: `OpenPlanr/spec-schema` — extracted shared schema

- Both products import frontmatter validators from one module
- Versioned independently

### Phase 5: marketing + repositioning

- New OpenPlanr README hero: "Three planning modes. Agile for humans. Quick for one-offs. Spec-driven for AI agents."
- Comparison table vs Linear/Jira showing the spec-driven differentiator
- Tutorial: "Plan an auth feature in spec-driven mode, ship it via openplanr-pipeline"

---

## What NOT to do

1. **Don't deprecate the agile or QT modes.** They're earned use cases. Spec-driven is a *third* mode, not a replacement.
2. **Don't translate spec-driven artifacts back to agile artifacts automatically.** A spec is not an epic, even if related. Conversion is lossy. Leave the user in the mode they chose.
3. **Don't add a UI / dashboard for spec-driven mode in v1.** OpenPlanr is file-first; that's a strength, not a weakness. Stay file-first.
4. **Don't let `planr spec decompose` invent file paths.** It must read the actual repo structure (or refuse) so generated tasks reference real files. This is the line between "useful artifact" and "hallucinated artifact".

---

## Risks / open questions

1. **Schema drift between `planr` and `openplanr-pipeline`.** Mitigation: extract `OpenPlanr/spec-schema` as shared module in Phase 4.
2. **Confused positioning.** Three modes in one CLI risks "swiss army knife" perception. Mitigation: clear mode-selection guidance in `planr init` ("which mode best fits your team?").
3. **Existing users of agile mode hate change.** Mitigation: spec-driven is purely additive, opt-in, doesn't touch existing artifacts.
4. **Subagent assignment in tasks couples `planr` to a specific tool ecosystem (Claude Code).** Mitigation: make `agent:` field free-form text — Claude Code agents, Cursor agents, Codex agents, even human assignees. The pipeline plugin maps it to subagent names; other tools can map differently.
5. **Existing users of `planr task create` will wonder "should I use spec-driven or agile?"** Mitigation: ship a decision tree in docs:
   - "Are you planning what humans will execute? → agile"
   - "Are you planning what an AI agent will execute? → spec-driven"
   - "Is this a one-off without hierarchy? → quick"

---

## Implementation budget

- **`planr` core changes** (new commands, schemas, mode flag): ~5-7 days for one engineer.
- **`openplanr-pipeline` v0.2 to read `.planr/feats/`**: ~2-3 days.
- **Shared `spec-schema` module**: ~2 days.
- **Documentation + tutorial**: ~3 days.
- **Total**: ~2-3 weeks of focused work for one engineer, or ~1 week with two engineers in parallel.

This is a manageable investment for a positional moat that makes OpenPlanr meaningfully different from Linear/Jira/Shortcut.

---

## Definition of Done for the spec-driven layer

- [ ] `planr spec` namespace ships with `init`, `create`, `shape`, `decompose`, `status`, `sync`, `promote` subcommands.
- [ ] All commands respect `--yes` non-interactive mode.
- [ ] `.planr/specs/` and `.planr/feats/` directories are created on first `planr spec init`.
- [ ] Frontmatter schemas match `openplanr-pipeline` 0.1.0 exactly.
- [ ] `planr spec promote --to-pipeline` validates state and prints the next pipeline command.
- [ ] `openplanr-pipeline` v0.2 reads from `.planr/feats/` when `.planr/config.json` declares spec-driven mode.
- [ ] README documents the three-mode posture with a decision tree.
- [ ] Migration guide for existing users (no breaking changes; new mode is opt-in).

---

## Open question for the OpenPlanr team

Where should the shared `spec-schema` module live? Three options:
1. **Inside `planr` repo** — simplest, but couples pipeline updates to planr releases.
2. **Inside `openplanr-pipeline` repo** — couples planr to pipeline, awkward.
3. **Standalone `OpenPlanr/spec-schema` repo** — cleanest, but adds a third repo to maintain.

Recommend option 3. The schema is a contract; contracts deserve their own home. Both products take a version-pinned dependency.

---

**Bottom line for the OpenPlanr team:** ship this. It's the move that turns OpenPlanr from "agile CLI for coding agents" into "the planning system *for* the agentic era". The technical work is bounded (~2-3 weeks). The strategic upside is significant — a positional differentiator no incumbent can copy without rebuilding.

---

# Addendum — directory structure critique (added 2026-04-25)

The verbatim feedback above is preserved for provenance. This addendum proposes a **revised directory structure** that addresses concrete UX problems with the proposal in §2 ("New artifact directory"). When implementing BL-011, **use the structure in this addendum**, not the one in the original feedback.

## Problems with the proposed structure

1. **`features/` (agile) vs `feats/` (spec-driven)** — name collision. Two visually similar directories at the same level with opposite mode semantics. New contributors will mix them up.
2. **Two naming conventions side by side** — `EPIC-001-{slug}.md` (agile: `PREFIX-NNN-slug`) vs `feat-{slug}/` (spec: `prefix-slug`, no number). The numbering convention disappears and reappears arbitrarily across modes.
3. **Inconsistent depth per mode** — agile is flat (`stories/US-001.md` directly), spec-driven nests three levels (`feats/feat-x/us-1/tasks/task-1.md`). Same root, different rules.
4. **Redundant nesting** — `us-1/us-1.md` repeats the directory name in the file name; `tasks/task-1.md` loses the global `T-NNN` ID uniqueness that frontmatter declares.
5. **Implicit linkage** — `feats/feat-{slug}/` ties to `specs/SPEC-NNN-{slug}.md` only via slug match, not via spec ID. Two specs with similar slugs collide.
6. **`design-spec.md` is unprefixed** — breaks the artifact-ID pattern; not addressable by any `planr <type> show <id>` command.

## Recommended structure

```
.planr/
├── config.json                  # mode: "agile" | "spec-driven" | "mixed"
│
│   # ── shared (any mode) ──────────────────
├── backlog/                     # BL-NNN
├── quick/                       # QT-NNN
├── adrs/                        # ADR-NNN
├── sprints/                     # SPRINT-NNN
├── checklists/
│
│   # ── agile mode ─────────────────────────
├── epics/                       # EPIC-NNN-{slug}.md
├── features/                    # FEAT-NNN-{slug}.md
├── stories/                     # US-NNN-{slug}.md         (agile US scope)
├── tasks/                       # TASK-NNN-{slug}.md
│
│   # ── spec-driven mode ──────────────────
└── specs/
    └── SPEC-001-auth-flow/      # self-contained — named like every other artifact
        ├── SPEC-001-auth-flow.md
        ├── design/
        │   ├── design-spec.md
        │   └── *.png            # mockups co-located, isolated from story/task files
        ├── stories/
        │   ├── US-001-login.md  # US-NNN scoped to this spec
        │   └── US-002-logout.md
        └── tasks/
            ├── T-001-loginform.md   # T-NNN scoped to this spec
            └── T-002-redirect.md
```

## Why this structure is cleaner

| Property | Original proposal | Recommended |
|---|---|---|
| Every artifact follows the `PREFIX-NNN-slug` naming pattern | ❌ `feat-{slug}` breaks it | ✅ `SPEC-001-auth-flow/` matches |
| Each spec is one self-contained, portable directory | ❌ split across `specs/` + `feats/` | ✅ everything under `specs/SPEC-NNN-slug/` |
| Stories→tasks linkage is explicit | ❌ via slug match (`feat-{slug}` vs `SPEC-NNN-{slug}`) | ✅ via frontmatter `specId: SPEC-001` |
| `planr spec destroy SPEC-001` = single `rm -rf` | ❌ two trees to clean | ✅ one directory |
| Same depth as agile `stories/`→`tasks/` | ❌ 3 levels deep | ✅ 2 levels (`specs/<spec>/{stories,tasks}`) |
| No name collisions with agile dirs | ❌ `feats` vs `features` | ✅ `specs` is unique |
| Designs co-located + isolated | partial — flat alongside US dirs | ✅ under spec's own `design/` subdir |
| Tasks keep global ID uniqueness in filenames | ❌ `task-1.md` per US | ✅ `T-NNN-slug.md` flat under spec |

## Mode coexistence rule

- **Agile mode** uses root-level `stories/` and `tasks/`. IDs are `US-NNN` and `TASK-NNN`, project-globally unique.
- **Spec-driven mode** uses nested `specs/SPEC-NNN-{slug}/{stories,tasks}/`. IDs are `US-NNN` (story) and `T-NNN` (task), **scoped to their containing SPEC**.
- The two coexist without filesystem collision because their paths don't overlap. A project that mixes modes simply has both trees populated.
- If a single project genuinely needs both an agile US-001 and a spec-driven US-001, this is by design — they're different artifacts in different modes, addressable by the file path. Tooling that grep-matches by ID alone needs to disambiguate via the artifact's `specId` frontmatter (present on spec-driven, absent on agile).
- **Recommended in `planr init`**: prompt for the project's primary mode and only populate that tree. Mixed-mode is opt-in via `planr <other-mode> init` after the fact.

## Pipeline integration adjustment

The original §5 says the pipeline should read from `.planr/feats/feat-{slug}/`. Update that to:

> The pipeline plugin's `commands/po-phase.md` and `commands/dev-phase.md` should be updated (in pipeline v0.2) to **read from `.planr/specs/SPEC-{NNN}-{slug}/` first**, falling back to `output/feats/feat-{slug}/` only if `.planr/specs/` doesn't exist. The slug→spec-id mapping is the small thing the pipeline learns; in return OpenPlanr owns the canonical artifact-naming convention everywhere.

The pipeline's old `feat-{slug}` directory naming is preserved as a fallback for migration but not produced by `planr spec decompose` — new specs always land at `specs/SPEC-NNN-slug/`.

## Schema field adjustments (minor)

Two frontmatter fields in the original §3 schemas are now redundant or wrong:

- `featSlug: feat-auth` (in `us-{N}.md`) — drop it. The story's path (`specs/SPEC-001-auth-flow/stories/US-001-login.md`) implicitly carries the spec linkage; `specId: SPEC-001` makes it explicit. No need for a third pointer.
- `mode: spec-driven` (in `SPEC-NNN.md` frontmatter) — drop it. The artifact's directory location (`specs/`) declares the mode; storing it in frontmatter is redundant and risks drift.

Everything else in the original schemas (id, title, status, files_create/modify/preserve, type, agent, storyId, specId) stays as-is.

## What to update in BL-011's Phases

- **Phase 1** — replace "create `.planr/specs/` and `.planr/feats/`" with "create `.planr/specs/<spec-id-slug>/` per spec". Drop any references to `feats/`.
- **Phase 3** — adjust the pipeline plugin update to point at `.planr/specs/SPEC-NNN-{slug}/`, not `.planr/feats/`.
- **Phase 4** — the shared `spec-schema` module enforces the path layout above and the slimmed frontmatter.
- **Phase 5** — README hero stays the same; the docs describe the corrected structure.

## What stays unchanged

- Three-mode posture (agile / quick / spec-driven). Modes coexist; nothing is deprecated.
- File-Create/Modify/Preserve task contract. This is the differentiator and it's intact.
- `planr spec` command surface (init, create, shape, decompose, status, sync, promote). Same commands, cleaner output paths.
- Strategic positioning, rollout phases, implementation budget, DoD checklist.
- Decision tree in `planr init` ("agile / quick / spec-driven — which fits your team?").

---

_Promote to agile hierarchy: `planr backlog promote BL-011 --story` or `planr backlog promote BL-011 --quick`_
_Close when done: `planr backlog close BL-011`_
