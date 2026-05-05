# Pipeline Overview

> Full description of the PO → DEV 2-Phase Pipeline with all stages, agents, and data flows.

---

## Core Principle

The pipeline enforces a **hard separation** between two activities:

| Activity | Phase | Who | Agents |
|----------|-------|-----|--------|
| Understand & Decompose | PO Phase (Step 1) | PO + Tech Lead review | Sonnet 4.6 |
| Build & Generate | DEV Phase (Step 3) | Tech Lead review | Opus 4.7 |

A **mandatory human checkpoint** exists between them.
The framework refuses to auto-chain PO Phase → DEV Phase.

---

## Full Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  HUMAN INPUTS                                                               │
│                                                                             │
│  Tech Lead          PO                  UX Designer                        │
│  input/tech/        input/specs/         input/ui/                         │
│  stack.md           spec-{name}.md       *.png                             │
└──────────────┬──────────────┬────────────────┬────────────────────────────┘
               │              │                │
               ▼              ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 0 — DB PREPARATION (once per project, optional)                       │
│                                                                             │
│  0.1  DB Agent (Sonnet 4.6, READ-ONLY)                                     │
│       SQL: SELECT on INFORMATION_SCHEMA                                     │
│       Mongo: driver-based collection introspection                          │
│       → output/db/schema.json                                               │
│                                                                             │
│  0.2  Entity Scaffold Agent (Sonnet 4.6) — optional manual dispatch          │
│       ORM entity / DbContext skeleton from schema.json → output/src/      │
│       → output/src/Entities/ + output/src/DbContext/                        │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 1 — PO PHASE (Functional → Technical Decomposition)                   │
│                                                                             │
│  Trigger: /planr-pipeline:plan {name}                                │
│                                                                             │
│  Chain (in order):                                                          │
│  ① DB Agent (Sonnet 4.6) — conditional: DatabaseType set, no fresh schema  │
│    stack.md + DB env vars                                                   │
│    → output/db/schema.json                                                  │
│                         │                                                   │
│                         ▼                                                   │
│  ② Designer Agent (Sonnet 4.6) — conditional on ≥1 PNG for this feature    │
│    input/ui/feat-{name}/*.png OR PNGs listed in spec UIFiles                │
│    → output/feats/feat-{name}/design-spec.md                                │
│                         │                                                   │
│                         ▼                                                   │
│  ③ Specification Agent (Sonnet 4.6)                                         │
│    spec + design-spec + stack + schema                                      │
│    → output/feats/feat-{name}/                                              │
│       ├── design-spec.md                                                    │
│       ├── us-1/                                                             │
│       │   ├── us-1.md                                                       │
│       │   └── tasks/                                                        │
│       │       ├── task-1.md  (UI if PNG present, else Tech)                 │
│       │       └── task-2.md  (Tech — only if PNG present)                   │
│       └── us-N/ ...                                                         │
│                                                                             │
│  🛑 PIPELINE STOPS HERE INTENTIONALLY                                       │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 2 — MANUAL REVIEW (Human Checkpoint) ⚠️                               │
│                                                                             │
│  Human reviews output/feats/feat-{name}/:                                  │
│                                                                             │
│  ✓ design-spec.md     — colors, fonts, components correct?                 │
│  ✓ us-{N}/us-{N}.md  — business scope coherent?                            │
│  ✓ tasks/task-{M}.md — files, stacks, preserves/adds valid?                │
│  ✓ stack.md           — still accurate?                                    │
│                                                                             │
│  Manual edits are allowed.                                                  │
│  Tech Lead never edits task-{M}.md directly.                               │
│  Open the generated US/task files and walk them before approving /ship.                │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 3 — DEV PHASE (Code Generation)                                       │
│                                                                             │
│  Trigger: /planr-pipeline:ship {name}                               │
│                                                                             │
│  Parallel execution per US (Frontend ‖ Backend within same US):            │
│                                                                             │
│  Frontend Agent (Opus 4.7)      Backend Agent (Opus 4.7)                   │
│  ← task-1.md (Type=UI)           ← task-2.md (Type=Tech)                    │
│  ← OR task-1.md (Type=Tech)      OR task-1.md if no PNG (Type=Tech)         │
│  UI layer only                  Services, DTOs, Entities, APIs             │
│  Components, pages, routes      DB queries, middleware                      │
│  Each DEV agent: **`docs/rules.md` § R6** correction passes + stack       │
│  commands (`BuildCommand`, `TestCommand`, …); on exhaustion of R6 writes   │
│  handoff **`T-<TASK_ID>-error-report.md`** per `templates/error-report.md`. │
│                                                                             │
│                         ▼                                                   │
│  STEP 3.5 — POST-BUILD AGENTS (after all DEV tasks settle)                 │
│                                                                             │
│  ④ QA Agent (Sonnet 4.6) — gates DEV output against task DoD               │
│  ⑤ DevOps Agent (Sonnet 4.6, optional) — generates docker-compose / CI    │
│  ⑥ Doc-Gen Agent (Sonnet 4.6, optional) — writes Docs/ from US + tasks    │
│                                                                             │
│                         ▼                                                   │
│            /snapshot → CLAUDE.md updated                                    │
│            (also wired as Stop hook in .claude/settings.json)               │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  FINAL OUTPUTS                                                              │
│                                                                             │
│  src/          ← Application source code                                   │
│  Tests/        ← Unit + integration tests                                  │
│  Docs/         ← Generated docs                                            │
│  CLAUDE.md     ← Project snapshot                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Map

| From | To | Data | Condition |
|------|----|------|-----------|
| `input/tech/stack.md` | DB Agent | Connection config | Step 0.1 |
| `output/db/schema.json` | Entity Scaffold Agent | Entity/DbContext scaffold inputs | Step 0.2 (optional) |
| `input/specs/spec-{name}.md` | Designer Agent | Feature name | Step 1 (if PNG) |
| `input/ui/*.png` | Designer Agent | Visual mockups | Step 1 (if PNG) |
| `output/feats/../design-spec.md` | Specification Agent | Design constraints | Step 1 |
| `input/specs/spec-{name}.md` | Specification Agent | Functional requirements | Step 1 |
| `input/tech/stack.md` | Specification Agent | File path conventions | Step 1 |
| `output/db/schema.json` | Specification Agent | DB table/column references | Step 1 |
| `output/feats/../task-1.md` | Frontend Agent | UI implementation spec | Step 3 |
| `output/feats/../design-spec.md` | Frontend Agent | Design tokens | Step 3 |
| `output/feats/../task-2.md` | Backend Agent | Tech implementation spec | Step 3 |
| `output/db/schema.json` | Backend Agent | DB schema validation | Step 3 |
| `output/feats/../tasks/*.md` + generated code | QA Agent | DoD verification | Step 3.5 |
| `input/tech/stack.md` + `.claude/stacks/devops/*.md` | DevOps Agent | Container/CI config templates | Step 3.5 |
| US + tasks + generated code | Doc-Gen Agent | Source for `Docs/` markdown | Step 3.5 |

---

## Correction Protocol (Step 3)

Normative definition: **`docs/rules.md`** → **`### R6 — Max 3 Correction Iterations`**. This file does not duplicate R6 prose — read R6 before changing pipeline agent prompts.

*See: `docs/rules.md` · `docs/agent-model-map.md` · `docs/task-anatomy.md`*
