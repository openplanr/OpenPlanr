# Agent Model Map

> Why each agent uses its assigned model. Never reassign without reading this.

---

## Assignment Table

| Agent               | Model       | Phase    | Rationale |
|---------------------|-------------|----------|-----------|
| DB Agent            | Sonnet 5  | Step 0.1 | Schema introspection is structured, deterministic, and read-only. Sonnet 5 handles SQL + JSON generation reliably at lower cost. |
| Entity Scaffold Agent | Sonnet 5 | Step 0.2 | Schema → `output/src/` entity/DbContext (or ORM equivalent) is **structured** codegen — map columns to types, wire FKs, no feature logic. Sonnet 5 is sufficient; Opus is reserved for Step 3 Tech tasks. |
| Designer Agent      | Sonnet 5  | Step 1   | Vision analysis + structured Markdown output. Sonnet 5 vision is accurate for design token extraction. No code generation needed. |
| Specification Agent | Sonnet 5  | Step 1   | Decomposition requires strong reasoning but not code generation. Sonnet 5 produces high-quality structured documents at speed. |
| Frontend Agent      | Opus 4.8    | Step 3   | Production UI code requires the highest-quality output: correct JSX, TypeScript, state management, API wiring, and test generation. |
| Backend Agent       | Opus 4.8    | Step 3   | Task-driven services/controllers/DTOs/endpoints need deep reasoning and multi-file coordination — same tier as Frontend Agent. (Step 0.2 uses **Entity Scaffold Agent**.) |
| QA Agent            | Sonnet 5  | Step 3.5 | Read-only verification: walks task DoD, runs build/test commands, surfaces error-reports. No code generation, so Opus 4.8 cost is unjustified. |
| DevOps Agent        | Sonnet 5  | Step 3.5 | Generates infrastructure config from stack templates. Structured Markdown/YAML output, no novel logic. |
| Doc-Gen Agent       | Sonnet 5  | Step 3.5 | Produces human-readable Markdown docs from existing artifacts. No code, no novel inference. |

---

## Operating Board Advisory Lenses (generated)

The six generated lens agents under `agents/operating/` (strategy-finance,
technology-risk, product-activation, growth-market, operations-customer,
chair) are assigned **Sonnet 5** (`model: claude-sonnet-5`, templated at
`templates/runtime/operating-lens-agent.md.tpl`). Rationale: they perform
read-only advisory analysis — search, read, cite — with no code generation
and a strict output contract, the same profile class as the decomposition
agents below. Their tool grant is the seven mission read-only tools only; no
Edit, Write, or unscoped Bash. Do not hand-edit these files — they are
generated from the role registry and `npm run check:operating-assets` fails
on drift.

## Why Sonnet 5 for Decomposition Phases?

```
Sonnet 5 strengths in this pipeline:
✅ Fast structured Markdown generation
✅ Accurate visual analysis (PNG → design tokens)
✅ Strong instruction following for templated outputs
✅ Cost-efficient for high-volume spec runs
✅ Reliable JSON output for schema.json

Sonnet 5 limitations (why it's NOT used for DEV):
⚠️ Less reliable for long-context code generation
⚠️ More likely to miss edge cases in complex service implementations
⚠️ Lower precision on multi-file coordination tasks
```

---

## Why Opus 4.8 for Code Generation Phases?

```
Opus 4.8 strengths in this pipeline:
✅ Best-in-class multi-file code generation
✅ Deep understanding of framework conventions
✅ Reliable TypeScript/C# type correctness
✅ Strong test generation (unit + integration)
✅ Handles complex dependency graphs across files
✅ Understands and applies design token systems

Opus 4.8 trade-offs (acceptable in DEV phase):
⚠️ Higher cost per token → only used where it matters
⚠️ Slower → offset by parallel execution (Frontend + Backend run simultaneously)
```

---

## Parallel Execution Architecture

```
Step 3 — DEV Phase
                     ┌─────────────────────┐
         task-1.md → │  Frontend Agent     │ → UI files
                     │  (Opus 4.8)         │
                     └─────────────────────┘
                              ↓ (parallel)
                     ┌─────────────────────┐
         task-2.md → │  Backend Agent      │ → Tech files
                     │  (Opus 4.8)         │
                     └─────────────────────┘
                              ↓
                     Consolidated Build Check
```

Frontend and Backend Agents operate on completely different file sets — no merge
conflicts by design.

Feature-flat parallelism rule (multi-task):
- ALL ready tasks across ALL stories dispatch together — not just the UI/Tech pair
  within one US. Independent US-N+1 tasks run alongside US-N tasks.
- The ONLY ordering is per-task `dependsOn`: a task waits only for the specific
  tasks it declares, regardless of which story they belong to. Whole stories do
  not serialize.

---

## Cost Optimization Strategy

```
High-volume, low-complexity → Sonnet 5
  - Schema scans (run frequently after migrations)
  - Spec decompositions (run per feature, per sprint)
  - Design analysis (run once per feature with PNG changes)

Low-volume, high-complexity → Opus 4.8
  - Feature code generation (run once per task, re-run only on failure)

Structured scaffold (Step 0.2) → Sonnet 5 via **Entity Scaffold Agent** (run manually when `output/src/` entities are needed)
```

---

*Rules: R3 in docs/rules.md · Update all AGENT.md files if models change*
