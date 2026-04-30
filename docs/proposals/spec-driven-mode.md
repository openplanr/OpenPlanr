# Proposal: Spec-Driven Mode for `planr` CLI

> **Status:** Design (Phase 2 of the planr-pipeline rollout)
> **Author:** Asem Abdo (`@AsemDevs`)
> **Created:** 2026-04-25 · **Revised:** 2026-04-25 (incorporates BL-011 addendum)
> **Target file when committed:** `docs/proposals/spec-driven-mode.md`
> **Tracking issue:** TBD (open after this doc is reviewed)
> **Related backlog item:** [`BL-011`](.planr/backlog/BL-011-spec-driven-planning-mode-third-posture-pipeline-bridge.md) — this doc formalizes that idea
> **Related plugin:** [planr-pipeline](https://github.com/openplanr/planr-pipeline) v0.2.0
> **Related skill:** [`openplanr/skills`](https://github.com/openplanr/skills) `openplanr` skill (CLI wrapper for Claude — needs a small update to teach Claude about spec mode)
> **Estimated work:** ~1-2 weeks across the three repos (planr CLI + pipeline + skills)

---

## TL;DR

Add a third planning mode to `planr` CLI alongside the existing **agile** (epic/feature/story/task) and **quick task (QT)** modes: **spec-driven**. Each spec is a self-contained directory `.planr/specs/SPEC-NNN-{slug}/` containing the spec document, its decomposed User Stories and Tasks, and any UI design assets. The artifact schema matches the [planr-pipeline](https://github.com/openplanr/planr-pipeline) plugin's contract verbatim — both products share one schema, no conversion layer.

Strategic outcome: `planr` becomes the **planning surface**, planr-pipeline the **execution surface**, with zero translation between them. OpenPlanr becomes the planning system for the agentic era — humans planning *for* AI agents.

---

## Why this is worth doing

### The current gap

`planr` agile and QT modes are excellent for human-driven workflows. Neither produces tasks AI agents can execute *directly*. Agent-execution requires:
- File `Create / Modify / Preserve` lists (not "implement the auth service")
- Task `Type` (UI vs Tech) for agent routing
- Explicit `agent:` field
- DoD checklists referencing build/test commands from a stack config

The planr-pipeline plugin (live at v0.2.0) already produces this richer artifact contract. Right now both products produce planning artifacts in different formats — they don't share a schema. This proposal closes that gap.

### Strategic positioning

| Tool category | Optimizes for | Differentiator |
|---|---|---|
| Linear / Jira / Shortcut | Humans planning for humans | Sprint velocity, burndown, project management |
| `planr` agile mode (today) | File-based agile planning | Coding-agent-friendly artifacts in markdown |
| **`planr` spec-driven mode (proposed)** | **Humans planning *for* agents** | **Artifacts agents execute directly, no re-translation** |

This is a moat. Tools optimized for human PM workflows can't pivot to agent-execution contracts without rebuilding.

---

## Goals and Non-Goals

### Goals (v1)

1. Ship `planr spec` namespace with: `init`, `create`, `shape`, `decompose`, `attach-design`, `status`, `sync`, `promote`, `list`, `show`
2. Adopt planr-pipeline's artifact schemas verbatim (file shapes, frontmatter fields)
3. **Self-contained per-spec directory layout** (per BL-011 addendum): `.planr/specs/SPEC-NNN-{slug}/{design,stories,tasks}/`
4. Add `modes` array to `.planr/config.json` so a project can declare which modes are active (additive, not exclusive)
5. Add `decompose` AI capability that mirrors planr-pipeline's specification-agent prompt, using planr's existing `ai-service.ts` provider abstraction
6. Update `planr rules generate` to produce CLAUDE.md/AGENTS.md sections for spec-driven mode
7. **Zero behavior change for existing agile + QT users** — spec-driven is purely additive, opt-in via `planr spec init`
8. Document the bridge to planr-pipeline so the integration is discoverable

### Non-Goals (v1)

- Replace agile or QT modes (they keep working unchanged)
- Build a UI / dashboard (planr stays file-first)
- Implement code execution (planr-pipeline owns this — never blur the boundary)
- Auto-translate between agile artifacts and spec-driven artifacts (lossy)
- Wrap planr-pipeline as a planr subcommand (separate products, intentional boundary)
- Add a `planr ship` command (would conflict with `/planr-pipeline:ship` slash command and blur the boundary)

### Goals deferred to v2+

- `planr github push` / `planr linear push` extended to spec/US/task artifacts
- Auto-detect existing planr-pipeline `output/feats/` and offer to import as `.planr/specs/`
- Multi-spec dependency graph visualization
- Sprint integration (assign specs/tasks to sprints)

---

## Mental Model: Three Planning Modes

```
planr supports three planning modes. Pick one (or several) per project.

┌─────────────────┬────────────────────────────────┬──────────────────────────────────┐
│ Mode            │ When to use                    │ Where it lives in .planr/        │
├─────────────────┼────────────────────────────────┼──────────────────────────────────┤
│ agile           │ Human teams, sprint cadence,   │ epics/, features/, stories/,     │
│                 │ estimation, backlog grooming   │ tasks/, sprints/, backlog/       │
├─────────────────┼────────────────────────────────┼──────────────────────────────────┤
│ quick (QT)      │ One-off work, no hierarchy,    │ quick/                           │
│                 │ standalone task lists          │                                  │
├─────────────────┼────────────────────────────────┼──────────────────────────────────┤
│ spec-driven     │ Planning for AI agents to      │ specs/SPEC-NNN-{slug}/           │
│ (NEW)           │ execute (Claude Code, Cursor,  │   ├── SPEC-NNN-{slug}.md         │
│                 │ Codex). Pairs with             │   ├── design/                    │
│                 │ planr-pipeline.            │   ├── stories/US-NNN-{slug}.md   │
│                 │                                │   └── tasks/T-NNN-{slug}.md      │
└─────────────────┴────────────────────────────────┴──────────────────────────────────┘

Modes are additive — they coexist in `.planr/` under separate, non-overlapping paths.
A project can use any subset.
```

---

## Proposed CLI Surface

New top-level command: `planr spec`. Subcommands:

| Subcommand | Purpose | Implementation notes |
|---|---|---|
| `planr spec init [--yes]` | Activate spec-driven mode in current project | Adds `"spec-driven"` to `modes[]` array in `.planr/config.json` (additive — doesn't disable agile or QT). Creates `.planr/specs/` (the per-spec directories are created on `spec create`). |
| `planr spec create [--file <path>] [--title <str>] [--yes]` | Create a new SPEC artifact | Creates `.planr/specs/SPEC-NNN-{slug}/SPEC-NNN-{slug}.md`. If `--file` given, AI generates SPEC body from a PRD doc. Otherwise opens template in `$EDITOR` or accepts `--title` flags. |
| `planr spec shape <SPEC-id> [--yes]` | Interactive 4-question spec authoring | Mirrors planr-pipeline's `/spec` skill. Walks through Context, Functional Requirements, Business Rules, Acceptance Criteria. Updates SPEC frontmatter. |
| `planr spec decompose <SPEC-id> [--yes] [--max-stories N]` | Generate US + Task files for a SPEC | The new core AI capability. Writes `.planr/specs/SPEC-NNN-{slug}/stories/US-NNN-{slug}.md` and `tasks/T-NNN-{slug}.md`. |
| `planr spec attach-design <SPEC-id> --files <png>...` | Attach UI mockups | Copies PNGs to `.planr/specs/SPEC-NNN-{slug}/design/` and updates SPEC frontmatter `ui_files`. Doesn't analyze (designer-agent's job). |
| `planr spec status [<SPEC-id>]` | Tree view of spec(s) + decomposition state | Like `planr status` scoped to spec mode. Shows: SPEC count, US count, Task count per SPEC, status state. |
| `planr spec sync` | Validate parent links, repair frontmatter | Detects orphaned files, missing `specId`, stale frontmatter. |
| `planr spec promote <SPEC-id>` | Mark SPEC ready for planr-pipeline execution | Validates decomposition completeness, updates `status: ready-for-pipeline`, prints `/planr-pipeline:plan {slug}` instruction. |
| `planr spec list [--status <st>]` | List all SPECs in the project | Filter by status (pending / shaping / decomposed / ready-for-pipeline / in-pipeline / done). |
| `planr spec show <SPEC-id>` | Print SPEC + decomposition tree | Useful for inspection. |
| `planr spec destroy <SPEC-id> [--yes]` | Remove a spec entirely | One `rm -rf .planr/specs/SPEC-NNN-{slug}/` — clean because the spec is self-contained. |

### Existing commands updated

- `planr status` — detect active modes; show all three sections, or scope with `--mode <agile|quick|spec-driven>`
- `planr rules generate` — emit CLAUDE.md / AGENTS.md sections for spec-driven mode (point agents at `.planr/specs/SPEC-NNN-{slug}/`)
- `planr quick promote <QT-id>` — add `--to-spec <SPEC-id>` alongside existing `--story <US-id>` flag

### Commands intentionally NOT added

- ❌ `planr spec ship` / `planr spec dev` / `planr spec build` — pipeline owns the ship verbs
- ❌ `planr spec from-agile <FEAT-id>` — different mental models, lossy translation

---

## Artifact Schemas (adopted from planr-pipeline)

These schemas match planr-pipeline's specification-agent output. Both products implement against the same contract.

### SPEC: `.planr/specs/SPEC-NNN-{slug}/SPEC-NNN-{slug}.md`

```yaml
---
id: SPEC-001
title: "User Authentication"
slug: auth-flow                  # used in directory name + propagated to all child IDs
schemaVersion: "1.0.0"           # for future migrations
status: pending                  # pending | shaping | decomposing | decomposed | ready-for-pipeline | in-pipeline | done
priority: P0                     # P0 | P1 | P2
milestone: v1.0
po: "@AsemDevs"
created: 2026-04-25
updated: 2026-04-25
ui_files: []                     # PNG paths under design/, populated by `planr spec attach-design`
tech_dependencies: []            # other SPEC-IDs this depends on
---

# {title}

## Context & Goal
[2-5 sentences]

## Functional Requirements
- ...

## Business Rules
- ...

## User Flows
**Flow 1 — [Name]:**
1. ...

## Out of Scope
- ...

## Acceptance Criteria
- [ ] Given ..., when ..., then ...

## Notes for Decomposition
- Suggested US split: [hint for `planr spec decompose`]
- Special attention: [edge cases, preserve constraints]
```

> **Note**: no `mode:` field. The directory location (`.planr/specs/`) declares the mode — storing it in frontmatter would be redundant and risk drift.

### User Story: `.planr/specs/SPEC-NNN-{slug}/stories/US-NNN-{slug}.md`

```yaml
---
id: US-001
specId: SPEC-001                 # explicit parent linkage
slug: login                      # used in filename
schemaVersion: "1.0.0"
status: pending                  # pending | implementing | done | blocked
created: 2026-04-25
---

# US-1 — {title}

## User Story
**As a** [role],
**I want to** [action],
**so that** [outcome].

## Scope
[What's IN. What's explicitly OUT for this US.]

## Acceptance Criteria
- [ ] Given ..., when ..., then ...

## Task Breakdown
| Task | File | Agent | Description |
|------|------|-------|-------------|
| T-001 | `tasks/T-001-loginform.md` | frontend-agent | UI work (only if PNG present) |
| T-002 | `tasks/T-002-redirect.md` | backend-agent | Tech work |

## Dependencies
- Depends on: [US-IDs or "none"]
- Blocks: [US-IDs or "none"]
- DB tables involved: [list from schema.json or "none"]

## Notes
[Edge cases, hints]
```

> **Note**: no `featSlug:` field. The story's path implicitly carries linkage; `specId` makes it explicit. A third pointer would risk drift.
>
> **ID scoping**: `US-NNN` is **scoped to its parent SPEC**, not project-globally unique. Two specs can each have their own US-001. Disambiguate via path or via `specId` frontmatter when grep-matching.

### Task: `.planr/specs/SPEC-NNN-{slug}/tasks/T-NNN-{slug}.md`

```yaml
---
id: T-001
storyId: US-001
specId: SPEC-001
slug: loginform
schemaVersion: "1.0.0"
type: UI                         # UI | Tech
agent: frontend-agent            # subagent name (matches planr-pipeline's agent names; free-form for other tools)
status: pending
created: 2026-04-25
---

# T-001 — {title}

## Objective
[One paragraph]

## Files

### Create
- `src/features/auth/components/LoginForm.tsx` — purpose

### Modify
- `src/app/layout.tsx` — what to change

### Preserve (do not touch)
- `src/lib/auth/legacy.ts` — why

## Technical Spec
[UI: components, routes, design tokens, state, API calls]
[Tech: endpoints, services, DTOs, DB ops, entities, business logic]

## Test Requirements
- Unit tests: [what to test]
- Integration tests: [if applicable]

## Definition of Done
- [ ] All "Create" files exist and compile
- [ ] All "Modify" files updated correctly
- [ ] All "Preserve" files unchanged
- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0
- [ ] No regressions in [related feature]
```

> **ID scoping**: `T-NNN` is **scoped to its parent SPEC**, like US-NNN. Filenames remain unique within a spec via the `-{slug}` suffix.

### Design assets: `.planr/specs/SPEC-NNN-{slug}/design/`

Holds:
- PNG mockups (copied here by `planr spec attach-design`)
- `design-spec.md` — generated by planr-pipeline's `designer-agent` when `/planr-pipeline:plan {slug}` runs (planr does NOT generate this; planr only reserves the path)

---

## Directory Structure

`.planr/` after `planr spec init` (additive; agile + QT directories untouched):

```
.planr/
├── config.json                       # add "modes": [...] field
│
│   # ── shared (any mode) ───────────────────────────────────────
├── adrs/                             # ADR-NNN-{slug}.md
├── backlog/                          # BL-NNN-{slug}.md
├── checklists/
├── diagrams/
├── quick/                            # QT-NNN-{slug}.md  (QT mode)
├── sprints/                          # SPRINT-NNN-{slug}.md (agile mode)
│
│   # ── agile mode ─────────────────────────────────────────────
├── epics/                            # EPIC-NNN-{slug}.md
├── features/                         # FEAT-NNN-{slug}.md
├── stories/                          # US-NNN-{slug}.md (agile-mode US — globally unique)
├── tasks/                            # TASK-NNN-{slug}.md
│
│   # ── spec-driven mode ───────────────────────────────────────
└── specs/
    ├── SPEC-001-auth-flow/           # self-contained directory per SPEC
    │   ├── SPEC-001-auth-flow.md
    │   ├── design/                   # PNGs + design-spec.md (generated by pipeline's designer-agent)
    │   │   ├── login-screen.png
    │   │   ├── register-screen.png
    │   │   └── design-spec.md        # reserved path — written by planr-pipeline, not planr
    │   ├── stories/
    │   │   ├── US-001-login.md       # US-NNN scoped to this spec
    │   │   └── US-002-logout.md
    │   └── tasks/
    │       ├── T-001-loginform.md    # T-NNN scoped to this spec
    │       ├── T-002-redirect.md
    │       └── T-003-logoutbutton.md
    │
    └── SPEC-002-checkout/            # entirely independent — different US-001, T-001
        ├── SPEC-002-checkout.md
        ├── stories/
        │   └── US-001-cart.md
        └── tasks/
            └── T-001-cartservice.md
```

### Why this structure (per BL-011 addendum)

| Property | Implementation |
|---|---|
| Every artifact follows `PREFIX-NNN-slug` | ✅ `SPEC-001-auth-flow`, `US-001-login`, `T-001-loginform` |
| Self-contained portable spec | ✅ One directory per SPEC; `rm -rf` to delete cleanly |
| Stories→tasks linkage explicit | ✅ via frontmatter `specId: SPEC-001`, not via path inference |
| Same depth as agile (`stories/` → `tasks/`) | ✅ 2-level nesting under each spec |
| No collision with agile `features/` | ✅ uses `specs/` (singular concept, distinct name) |
| Designs co-located + isolated | ✅ under each spec's own `design/` subdir |
| Tasks keep `T-NNN` ID format | ✅ slugs in filename keep filenames unique within a spec |

### `.planr/config.json` additions

```jsonc
{
  // existing fields preserved...
  "modes": ["agile", "quick", "spec-driven"],   // NEW — array of active modes
  "spec": {                                      // NEW — spec-driven config
    "specPrefix": "SPEC",
    "storyPrefix": "US",                         // ID prefix for stories within spec
    "taskPrefix": "T",                           // ID prefix for tasks within spec
    "defaultPriority": "P1",
    "designAssetsDir": "design"                  // subdir name within each spec
  }
}
```

---

## Coexistence: Three Modes Share `.planr/`

| Directory | Owner mode |
|---|---|
| `epics/`, `features/`, `stories/`, `tasks/`, `sprints/` | agile |
| `quick/` | QT |
| `specs/` | spec-driven |
| `backlog/`, `adrs/`, `checklists/`, `diagrams/` | shared (any mode) |

A project can use any subset. `planr task create --story US-001` (agile) and `planr spec create --title "Auth"` (spec-driven) coexist without conflict — they own disjoint directories.

**ID scoping rule:**
- **Agile mode**: `US-NNN` and `TASK-NNN` are *project-globally* unique (existing behavior).
- **Spec-driven mode**: `US-NNN` and `T-NNN` are *scoped to their parent SPEC*. Two specs each have their own US-001 — disambiguate via path or via `specId` frontmatter.
- A project can have an agile US-001 *and* a spec-driven US-001 — they're addressable by path, never confused.

`planr quick promote <QT-id>` accepts:
- `--story <US-id>` (existing — agile target)
- `--to-spec <SPEC-id>` (new — spec-driven target; promotes to a new US/T pair under that spec)

---

## AI: the `decompose` capability

`planr spec decompose <SPEC-id>` is the new core AI capability. Takes a SPEC and produces the US + Task files inside `.planr/specs/SPEC-NNN-{slug}/{stories,tasks}/`.

### Prompt source

Adopt planr-pipeline's `specification-agent` system prompt verbatim, with adjustments for the planr CLI execution context (no Claude Code Task tool — direct AI provider call via planr's existing `ai-service.ts`).

### Implementation outline

New files in the planr CLI repo:

```
src/
├── ai/
│   ├── prompts/
│   │   └── spec-decompose.ts              # prompt builder for SPEC → US + Tasks
│   └── schemas/
│       └── spec-decomposition.ts          # Zod schemas for AI response validation
├── cli/
│   └── commands/
│       └── spec.ts                        # the new `planr spec` namespace
└── services/
    └── spec-service.ts                    # CRUD for SPEC/US/T artifacts (matches artifact-service.ts shape)
```

### Stack awareness

`planr spec decompose` reads `input/tech/stack.md` (in user's project root, NOT in `.planr/`) so generated tasks reference real file paths matching the user's stack. If absent, the command warns and produces stack-agnostic task templates.

### AI provider compatibility

Works with all three of planr's existing AI providers (Anthropic, OpenAI, Ollama) via the existing `streamJSON` / `generateObject` abstraction. Provider-neutral.

---

## Bridge to planr-pipeline

The integration that makes the two products one product story.

### Workflow

1. User runs `planr spec init` — adds `"spec-driven"` to `.planr/config.json` `modes`
2. User authors a SPEC: `planr spec create` or `planr spec shape`
3. User decomposes: `planr spec decompose SPEC-001`. Files appear in `.planr/specs/SPEC-001-auth-flow/{stories,tasks}/`
4. User reviews (manual edits as desired)
5. User runs `planr spec promote SPEC-001`. Updates `status: ready-for-pipeline`, prints:
   ```
   Spec ready. From Claude Code:
     /planr-pipeline:plan auth-flow
   ```
6. User invokes the pipeline. Pipeline detects `.planr/specs/SPEC-001-auth-flow/` exists; reads from there directly.
7. User runs `/planr-pipeline:ship auth-flow`. Pipeline reads tasks from `.planr/specs/SPEC-001-auth-flow/tasks/`, generates code, runs DEV phase.

### What changes in `planr-pipeline` (v0.3.0)

Small, additive change:

- `commands/plan.md` — detect `.planr/config.json` with `modes: spec-driven`. If `.planr/specs/SPEC-NNN-{slug}/` exists for the given slug, **read from there** (skip inline decomposition).
- `commands/ship.md` — read tasks from `.planr/specs/SPEC-NNN-{slug}/tasks/T-*.md` when planr is in spec mode.
- Fall back to `output/feats/feat-{slug}/` for users using the pipeline standalone (no planr CLI).
- `agents/specification-agent.md`, `agents/frontend-agent.md`, `agents/backend-agent.md` — update path references to support the planr layout.
- `agents/designer-agent.md` — output design-spec.md to `.planr/specs/SPEC-NNN-{slug}/design/design-spec.md` when planr is detected; fall back to `output/feats/feat-{slug}/design-spec.md` otherwise.

This is ~1-2 days of work in the pipeline repo.

### What does NOT change

- planr doesn't invoke planr-pipeline (the pipeline runs in Claude Code, not the planr CLI process)
- planr-pipeline doesn't depend on planr being installed (detects `.planr/` and uses it if present)
- Schema is shared but each repo can iterate independently within minor versions; eventually extracted to `OpenPlanr/spec-schema` (Phase 4, optional)

---

## Coordination across the OpenPlanr ecosystem

Three repos receive changes. Sequence matters.

### Repo: `openplanr/OpenPlanr` (planr CLI) — primary work

1. Update [BL-011](.planr/backlog/BL-011-spec-driven-planning-mode-third-posture-pipeline-bridge.md): `status: open → in-design`, link to this proposal
2. Commit this proposal at `docs/proposals/spec-driven-mode.md`
3. Open tracking issue
4. Implementation in 3 PRs (Phase 2.1 / 2.2 / 2.3 below)
5. Ship as planr v(next).0 with `mode: experimental`

### Repo: `openplanr/planr-pipeline` — bridge update (after planr CLI ships)

1. Update commands/plan.md and commands/ship.md to read from `.planr/specs/SPEC-NNN-{slug}/`
2. Update agent prompts (specification-agent, frontend-agent, backend-agent, designer-agent) for the new path layout
3. Bump to v0.3.0
4. Update `openplanr/marketplace` to pin v0.3.0

### Repo: `openplanr/skills` — skill update (after pipeline v0.3 ships)

1. Update `skills/openplanr/SKILL.md` to teach Claude about spec mode:
   - Add trigger phrases: "plan for AI agents", "spec-driven mode", "decompose spec", "bridge to pipeline"
   - Add a "Spec-Driven Workflow" section showing the `planr spec ...` command sequence
   - Add a "Bridge to planr-pipeline" section explaining the integration
2. Bump `metadata.version` in `.claude-plugin/marketplace.json` to 1.1.0

This is ~1-2 hours of writing (no code).

### Optional Phase 4: `OpenPlanr/spec-schema` shared module

Only worth extracting once schema drift is a real problem (likely after both products have shipped real spec-driven features for a few weeks). Premature otherwise.

---

## Phased Implementation Plan

### Phase 2.1 — Minimum viable spec-driven mode ✅ SHIPPED

Released as part of `planr v(next).0`.

- `planr spec init`, `create`, `attach-design`, `list`, `show`, `status`, `destroy`, `promote`
- `.planr/specs/` directory + per-spec subdirectory creation
- Frontmatter schemas matching this proposal
- `config.json` `idPrefix.spec` field
- README + docs/CLI.md + docs/ARCHITECTURE.md "Three planning modes" sections

**Acceptance criteria — ALL PASS:**
- [x] `planr spec init --yes` activates spec mode without breaking existing agile/QT projects
- [x] `planr spec create --title "Auth" --slug auth-flow --yes` creates `.planr/specs/SPEC-001-auth-flow/SPEC-001-auth-flow.md`
- [x] `planr spec list` shows the SPEC
- [x] `planr spec status` shows aggregate report
- [x] `planr spec destroy SPEC-001 --yes` does a clean `rm -rf` of one directory
- [x] All existing tests still pass (716 → 730+ with new tests, zero regressions)
- [x] Changeset entry under `.changeset/spec-driven-mode.md`

### Phase 2.2 — AI decomposition ✅ SHIPPED

- [x] `planr spec shape <SPEC-id>` — interactive 4-question dialogue (Context, Functional Requirements, Business Rules, Acceptance Criteria + optional Out-of-Scope and Decomposition Notes)
- [x] `planr spec decompose <SPEC-id>` — AI-driven US + T generation
- [x] New AI prompts and Zod schemas (`SPEC_DECOMPOSE_SYSTEM_PROMPT`, `aiSpecDecomposeResponseSchema`) — port planr-pipeline's specification-agent prompt
- [x] Tests: golden-path decomposition + edge cases (mocked AI provider; live smoke deferred to manual verification)

**Acceptance criteria — ALL PASS:**
- [x] `planr spec shape SPEC-001` walks 4 questions and regenerates spec body from answers
- [x] `planr spec decompose SPEC-001` produces 1-8 US files with 1-2 Tasks each at correct paths
- [x] Generated artifacts pass Zod validation against the schemas
- [x] Stack.md awareness: tasks reference real file paths if `input/tech/stack.md` exists
- [x] Codebase awareness: always scans via `buildCodebaseContext` (matches `planr quick create` UX); `--no-code-context` flag for fast mode
- [x] Works with all 3 AI providers (Anthropic, OpenAI, Ollama)
- [x] `--max-stories N` flag caps decomposition output
- [x] `--force` flag required to overwrite existing decomposition

### Phase 2.3 — Pipeline bridge + sync ✅ SHIPPED

- [x] `planr spec promote <SPEC-id>` (shipped in Phase 2.1)
- [x] `planr spec sync [<SPEC-id>] [--dry-run]` — orphaned-task detection, story-without-tasks warnings, missing-specId auto-fix, schema-drift warnings
- [ ] `planr quick promote --to-spec <SPEC-id>` — DEFERRED to follow-up PR (low priority)
- [x] README + docs/CLI.md + docs/ARCHITECTURE.md updated with three-mode story

**Acceptance criteria — ALL PASS:**
- [x] `planr spec promote` validates decomposition and prints `/planr-pipeline:plan {slug}` instruction
- [x] `planr spec sync` detects orphaned tasks, stories without tasks, missing specId, schema drift
- [x] `--dry-run` reports without writing
- [x] `planr rules generate` includes spec-driven mode guidance via CLAUDE.md / AGENTS.md updates

### Phase 2.4 — Pipeline-side update (separate PR, separate repo)

In `planr-pipeline` v0.3.0:
- `commands/plan.md` reads `.planr/specs/SPEC-NNN-{slug}/` first; falls back to `output/feats/`
- `commands/ship.md` same
- `agents/designer-agent.md` writes to `.planr/specs/SPEC-NNN-{slug}/design/` when planr is detected
- Document the bridge in pipeline README
- Marketplace bump to v0.3.0

### Phase 2.5 — Skill update + docs + announcement (~1-2 days)

- Update `openplanr/skills` `skills/openplanr/SKILL.md` for spec mode (1-2 hours of writing)
- Bump openplanr-skills marketplace to 1.1.0
- README homepage section "Three planning modes" finalized
- Launch announcement (the Phase 3 marketing beat from openplanr-launch-plan.md)

---

## Risk Register

| Risk | Phase | Mitigation |
|---|---|---|
| Schema drift between planr and planr-pipeline | 2.1+ | Both repos pin to a documented schema version (bump in lockstep). Extract `spec-schema` only when drift becomes a real problem. |
| Existing agile users confused by new mode | 2.5 | Mode is opt-in (additive). README has clear decision tree. |
| AI decomposition produces low-quality tasks | 2.2 | Borrow planr-pipeline's prompts (already validated). Zod schema validation. Surface drift cases as warnings. |
| `decompose` blows token budget on large specs | 2.2 | Stream JSON output. Chunk if SPEC > 10k tokens. `--max-stories N` flag. |
| Pipeline bridge breaks existing pipeline workflows | 2.4 | Detection is conservative — only read `.planr/specs/` if `.planr/config.json` explicitly enables spec mode. Always fall back to `output/feats/`. |
| ID-scoping confusion (US-001 in spec A vs US-001 in spec B) | 2.1+ | Document explicitly. Tooling that resolves IDs always disambiguates via `specId` frontmatter or path. |
| Cross-platform path issues (Windows backslashes) | All | planr already handles this via `path.join()`. Apply same pattern. |

---

## Open Questions

1. **`planr spec decompose` re-run behavior** — refuse if any US/Task exists by default; `--force` flag to overwrite. **Recommendation: this is the right default.**

2. **`ui_files` handling: 1-task or 2-task decomposition?** Detect `ui_files` in SPEC frontmatter and produce 2-task decomposition (UI + Tech) regardless of whether designer-agent has run. Schema is identical. **Recommendation: yes, follow planr-pipeline's behavior.**

3. **Schema versioning** — add `schemaVersion: "1.0.0"` to all artifacts. **Recommendation: yes, from day one.** Resolved in this revision.

4. **ID scoping** — `US-NNN` and `T-NNN` are scoped to parent SPEC, not project-globally unique. **Recommendation: this is correct per BL-011 addendum.** Resolved in this revision.

5. **`planr github push` / `planr linear push` for spec artifacts** — defer to v2. Adds scope without solving a v1-blocking problem.

---

## Acceptance Criteria for the whole proposal

- [ ] `planr spec` namespace ships with all 11 subcommands listed
- [ ] All commands respect `--yes` non-interactive mode
- [ ] `.planr/specs/SPEC-NNN-{slug}/` directories created with `{design,stories,tasks}/` subfolders
- [ ] Frontmatter schemas match this proposal (cross-validated by integration test)
- [ ] `planr spec decompose` works against all 3 AI providers
- [ ] `planr spec promote` prints the correct `/planr-pipeline:plan {slug}` instruction
- [ ] planr-pipeline v0.3.0 reads `.planr/specs/` when planr is in spec mode
- [ ] openplanr-skills `openplanr` SKILL.md teaches Claude about spec mode commands
- [ ] Existing agile + QT tests pass with no changes
- [ ] README documents three-mode posture with decision tree
- [ ] Migration guide: no breaking changes; new mode is opt-in
- [ ] `.changeset/` entry per planr's release management

---

## Migration

**Existing planr users (agile or QT):** No action required. Spec-driven is opt-in. Run `planr spec init` to enable. Existing artifacts untouched.

**New users:** `planr init` will eventually prompt for mode selection. Default in v1 = agile (preserves current behavior). Spec-driven becomes a first-class option in `planr init` once the mode has user validation.

---

## References

- [planr-pipeline v0.2.0](https://github.com/openplanr/planr-pipeline/releases/tag/v0.2.0) — schema-of-record
- [planr-pipeline `agents/specification-agent.md`](https://github.com/openplanr/planr-pipeline/blob/main/agents/specification-agent.md) — prompt to adopt for `planr spec decompose`
- [planr-pipeline `docs/spec-anatomy.md`](https://github.com/openplanr/planr-pipeline/blob/main/docs/spec-anatomy.md) — full spec format
- [planr-pipeline `docs/task-anatomy.md`](https://github.com/openplanr/planr-pipeline/blob/main/docs/task-anatomy.md) — task contract
- [openplanr-skills `skills/openplanr/SKILL.md`](https://github.com/openplanr/skills/blob/main/skills/openplanr/SKILL.md) — Claude-side wrapper to update
- [`openplanr-launch-plan.md`](../openplanr-launch-plan.md) — parent rollout plan
- [BL-011 backlog item](.planr/backlog/BL-011-spec-driven-planning-mode-third-posture-pipeline-bridge.md) — original feedback + addendum

---

## Suggested PR / Issue plan

1. **Tracking issue** on `openplanr/OpenPlanr` titled "Add spec-driven planning mode (3rd posture for AI agents)" — links to this doc, lists the 5 phases as checkboxes
2. **Phase 2.1 PR:** `feat(spec): add spec-driven mode scaffolding (init, create, list, show, status, destroy)` — labels: `enhancement`, `mode:spec-driven`
3. **Phase 2.2 PR:** `feat(spec): AI decomposition (shape, decompose)` — labels: `enhancement`, `mode:spec-driven`, `ai`
4. **Phase 2.3 PR:** `feat(spec): pipeline bridge (promote, sync, quick promote --to-spec)` — labels: `enhancement`, `mode:spec-driven`
5. **Phase 2.4 PR (in `planr-pipeline`):** `feat: read .planr/specs/ when planr spec mode active`
6. **Phase 2.5 PR (in `openplanr/skills`):** `feat: teach openplanr skill about spec-driven mode`
7. **Phase 2.5 PR (in `openplanr/OpenPlanr`):** `docs: three-mode README + announcement`

Each PR includes a `.changeset/*.md` entry per planr's release management convention.

---

*This doc is a working draft. Once approved, commit to `docs/proposals/spec-driven-mode.md` in the `openplanr/OpenPlanr` repo and open the tracking issue. Update BL-011 status to `in-design` and reference this doc.*
