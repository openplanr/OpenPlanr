# Agent Model Map

> Why each agent uses its assigned model. Never reassign without reading this.

---

## Assignment Table

| Agent               | Model       | Phase    | Rationale |
|---------------------|-------------|----------|-----------|
| DB Agent            | Sonnet 4.6  | Step 0.1 | Schema introspection is structured, deterministic, and read-only. Sonnet 4.6 handles SQL + JSON generation reliably at lower cost. |
| Designer Agent      | Sonnet 4.6  | Step 1   | Vision analysis + structured Markdown output. Sonnet 4.6 vision is accurate for design token extraction. No code generation needed. |
| Specification Agent | Sonnet 4.6  | Step 1   | Decomposition requires strong reasoning but not code generation. Sonnet 4.6 produces high-quality structured documents at speed. |
| Frontend Agent      | Opus 4.7    | Step 3   | Production UI code requires the highest-quality output: correct JSX, TypeScript, state management, API wiring, and test generation. |
| Backend Agent       | Opus 4.7    | Step 0.2 + 3 | Entity scaffolding + service/controller/DTO generation requires deep technical precision and context-aware code writing. |
| QA Agent            | Sonnet 4.6  | Step 3.5 | Read-only verification: walks task DoD, runs build/test commands, surfaces error-reports. No code generation, so Opus 4.7 cost is unjustified. |
| DevOps Agent        | Sonnet 4.6  | Step 3.5 | Generates infrastructure config from stack templates. Structured Markdown/YAML output, no novel logic. |
| Doc-Gen Agent       | Sonnet 4.6  | Step 3.5 | Produces human-readable Markdown docs from existing artifacts. No code, no novel inference. |

---

## Why Sonnet 4.6 for Decomposition Phases?

```
Sonnet 4.6 strengths in this pipeline:
✅ Fast structured Markdown generation
✅ Accurate visual analysis (PNG → design tokens)
✅ Strong instruction following for templated outputs
✅ Cost-efficient for high-volume spec runs
✅ Reliable JSON output for schema.json

Sonnet 4.6 limitations (why it's NOT used for DEV):
⚠️ Less reliable for long-context code generation
⚠️ More likely to miss edge cases in complex service implementations
⚠️ Lower precision on multi-file coordination tasks
```

---

## Why Opus 4.7 for Code Generation Phases?

```
Opus 4.7 strengths in this pipeline:
✅ Best-in-class multi-file code generation
✅ Deep understanding of framework conventions
✅ Reliable TypeScript/C# type correctness
✅ Strong test generation (unit + integration)
✅ Handles complex dependency graphs across files
✅ Understands and applies design token systems

Opus 4.7 trade-offs (acceptable in DEV phase):
⚠️ Higher cost per token → only used where it matters
⚠️ Slower → offset by parallel execution (Frontend + Backend run simultaneously)
```

---

## Parallel Execution Architecture

```
Step 3 — DEV Phase
                     ┌─────────────────────┐
         task-1.md → │  Frontend Agent     │ → UI files
                     │  (Opus 4.7)         │
                     └─────────────────────┘
                              ↓ (parallel)
                     ┌─────────────────────┐
         task-2.md → │  Backend Agent      │ → Tech files
                     │  (Opus 4.7)         │
                     └─────────────────────┘
                              ↓
                     Consolidated Build Check
```

Frontend Agent (task-1) runs first or in parallel with Backend Agent (task-2).
They operate on completely different file sets — no merge conflicts by design.

Topological parallelism rule:
- task-1 (UI) and task-2 (Tech) within the same US can run in parallel
- US-N+1 tasks must wait for US-N to complete (if dependency declared)

---

## Cost Optimization Strategy

```
High-volume, low-complexity → Sonnet 4.6
  - Schema scans (run frequently after migrations)
  - Spec decompositions (run per feature, per sprint)
  - Design analysis (run once per feature with PNG changes)

Low-volume, high-complexity → Opus 4.7
  - Code generation (run once per task, re-run only on failure)
  - Scaffold generation (run once per project migration)
```

---

*Rules: R3 in docs/rules.md · Update all AGENT.md files if models change*
