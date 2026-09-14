# Pipeline Overview

> Full description of the PO → DEV 2-Phase Pipeline with all stages, agents, and data flows.

> **Model names in the stage diagrams below are the Claude Code native adapter's
> current mapping, not a protocol rule.** The portable assignment is the
> capability tier in `registry/roles.json` (R3 in `docs/rules.md`); each adapter
> resolves a tier to whatever it runs. See `docs/agent-model-map.md` for the
> Claude Code mapping and its rationale.

---

## Core Principle

The pipeline provides context for two related activities:

| Activity | Phase | Who | Capability tier |
|----------|-------|-----|-----------------|
| Understand & Decompose | PO Phase (Step 1) | Product and engineering agents | `analysis-high` |
| Build & Generate | DEV Phase (Step 3) | Coding and QA agents | `implementation-high` |

The user's request controls the outcome. Planning requests produce the plan;
implementation requests continue through code and the relevant engineering
checks.

---

## Optional Design Sub-Phase (`/planr-pipeline:design`, before PO)

A feature can carry **design intent** into the PO Phase so it decomposes real UI tasks
instead of degrading to a Tech-only ship. Two ways intent arrives:

- **Mockups** — drop `*.png` and `designer-agent` extracts a `design-spec.md` during `/plan`
  (the original path; unchanged).
- **Generation** — run `/planr-pipeline:design {slug}` **before** `/plan`. It generates a
  visual artifact in one of three formats and authors `design-spec.md` directly:

  | Format | Output | Substrate |
  |--------|--------|-----------|
  | prototype | one interactive screen (`finalized.html`) | vanilla + Pretext |
  | walkthrough | multi-screen gallery, grouped sidebar (anchor ≤8 / lazy >8 screens) | vanilla + Pretext |
  | canvas | Figma-like board of artboards (`canvas.html`, export + view-only) | vendored React |

```
  spec (no PNG)  ──/design──▶  design/{finalized.html|canvas.html} + design-spec.md
                                            │
                                            ▼  (R2: design-spec.md OR PNG ⇒ UI task)
                               /plan ──▶ US + UI task + Tech task  ──▶ optional review ──▶ /ship
```

The format is chosen by a clarification prompt with a **recommended default** computed from
the screen count (`lib/design/recommendFormat.mjs`); supplying `--format … --from …` skips
the prompt for CI. `design-spec.md` has **one writer per run** (PNGs → `designer-agent`,
otherwise the generator). `/design` is a standalone command whose output `/plan`
can consume; `/plan` prints a one-line nudge when UI intent is detected but no
design exists. Tested core lives in `lib/design/` (escaping, screen resolver, format
rule, manifest); conformance in `conformance/verify-design-assets.mjs` + `tests/design/`.

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
│  0.1  DB Agent (Sonnet 5, READ-ONLY)                                     │
│       SQL: SELECT on INFORMATION_SCHEMA                                     │
│       Mongo: driver-based collection introspection                          │
│       → output/db/schema.json                                               │
│                                                                             │
│  0.2  Entity Scaffold Agent (Sonnet 5) — optional manual dispatch          │
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
│  ① DB Agent (Sonnet 5) — conditional: DatabaseType set, no fresh schema  │
│    stack.md + DB env vars                                                   │
│    → output/db/schema.json                                                  │
│                         │                                                   │
│                         ▼                                                   │
│  ② Designer Agent (Sonnet 5) — conditional on ≥1 PNG for this feature    │
│    input/ui/feat-{name}/*.png OR PNGs listed in spec UIFiles                │
│    → output/feats/feat-{name}/design-spec.md                                │
│                         │                                                   │
│                         ▼                                                   │
│  ③ Specification Agent (Sonnet 5)                                         │
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
│  Planning-only requests stop here; implementation requests may continue.   │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 2 — OPTIONAL PLAN REVIEW                                               │
│                                                                             │
│  Review only when requested or when it adds material value:                 │
│                                                                             │
│  ✓ design-spec.md     — colors, fonts, components correct?                 │
│  ✓ us-{N}/us-{N}.md  — business scope coherent?                            │
│  ✓ tasks/task-{M}.md — files, stacks, preserves/adds valid?                │
│  ✓ stack.md           — still accurate?                                    │
│                                                                             │
│  Return prioritized changes directly; do not create a review lifecycle.     │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 3 — GUIDANCE-FIRST IMPLEMENTATION                                     │
│                                                                             │
│  Trigger: /planr-pipeline:ship {name}                               │
│                                                                             │
│  The coding runtime owns tools, subagents, edit order, and debugging.        │
│                                                                             │
│  Frontend Agent (Opus 4.8)      Backend Agent (Opus 4.8)                   │
│  ← task-1.md (Type=UI)           ← task-2.md (Type=Tech)                    │
│  ← OR task-1.md (Type=Tech)      OR task-1.md if no PNG (Type=Tech)         │
│  UI layer only                  Services, DTOs, Entities, APIs             │
│  Components, pages, routes      DB queries, middleware                      │
│  Run relevant stack checks and correct failures while evidence supports     │
│  meaningful progress. Report a genuine impasse concisely.                   │
│                                                                             │
│                         ▼                                                   │
│  STEP 3.5 — PROPORTIONATE QA                                                 │
│                                                                             │
│  A read-only QA agent may check acceptance, security, correctness, and      │
│  design fidelity, returning concise actionable findings.                    │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  FINAL OUTPUTS                                                              │
│                                                                             │
│  src/          ← Application source code                                   │
│  Tests/        ← Unit + integration tests                                  │
│  Planning status + concise changed-file and verification report             │
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
| Scoped requirements + current diff | QA Agent | Concise actionable findings | When QA adds value |
| Verified implementation | Planning artifacts | Status update and deferred work | Completion |

---

## Project Memory (Step 1.9)

`.planr/memory.md` may retain useful project learnings when the project chooses
to use it:

- **Decisions** — architectural choices made during `/ship` not captured in ADRs
- **Traps** — durable failure patterns worth remembering
- **Corrections** — explicit project decisions that supersede an earlier assumption

Memory is context, not a completion gate. Agents do not stop or create entries
merely because a retry count was reached. Humans may prune stale entries.

---

## Correction and review protocol

`docs/rules.md` R6 uses adaptive recovery from observed command results and R7
uses proportionate verification. Auditable release-candidate records belong to
the separate release product.

---

## Coherent native dispatch

The coding runtime may use native subagents and dependency waves when useful;
hosts without isolated subagents work sequentially. The runtime owns execution
and reports verified outcomes directly. Planr does not add a second task queue,
prompt-authored manifest, or resume loop around the agent.

*See: `docs/rules.md` · `docs/agent-model-map.md` · `docs/task-anatomy.md` · `docs/feat-parallel-dispatch/`*
