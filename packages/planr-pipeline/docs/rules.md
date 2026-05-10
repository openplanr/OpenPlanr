# Framework Rules

> All hard constraints and soft guidelines governing the PO → DEV Pipeline.
> These rules are enforced by the agents (manifest-level tool restrictions) and checked during the human-review checkpoint between `/planr-pipeline:plan` and `/planr-pipeline:ship`.

---

## Hard Rules (Never Violate)

### R1 — No Single End-to-End Command
```
❌ FORBIDDEN: A single command that triggers PO Phase and DEV Phase together.
✅ REQUIRED:  Two separate triggers with a human review between them.
```
Rationale: The human checkpoint between phases is the primary quality gate.
Bypassing it removes the ability to catch decomposition errors before expensive code generation.

---

### R2 — Task Count Per US
```
IF input/ui/*.png EXISTS for the feature:
  tasks_per_us = 2
  task-1 = UI task → Frontend Agent
  task-2 = Tech task → Backend Agent

IF no PNG:
  tasks_per_us = 1
  task-1 = Tech task → Backend Agent (or combined UI+Tech)

NEVER: 3 or more tasks per US
```
Rationale: More than 2 tasks per US creates coordination complexity and ambiguous agent ownership.

---

### R3 — Model Assignments Are Fixed
```
Sonnet 4.6 → DB Agent, Designer Agent, Specification Agent, Entity Scaffold Agent
Opus 4.7   → Frontend Agent, Backend Agent
```
Rationale: Sonnet 4.6 is sufficient for analysis, decomposition, and **structured** schema→scaffold output (Entity Scaffold Agent — Step 0.2). Opus 4.7 is required for exploratory multi-file DEV codegen (Frontend + Backend task implementation).
Never swap these without updating all agent frontmatter files and `docs/agent-model-map.md`.

---

### R4 — Tech Lead Never Edits task-{M}.md
```
❌ FORBIDDEN: Tech Lead manually editing task-{M}.md files
✅ REQUIRED:  If task content is wrong, edit us-{N}.md or spec-{name}.md,
              then re-run the Specification Agent
```
Rationale: Tasks are generated artifacts. Editing them directly creates drift
between the spec and the implementation plan.

---

### R5 — Preserve Lists Are Inviolable
```
Any file listed under "Preserve" in a task MUST NOT be touched by the agent.
If an agent modifies a preserved file, it must self-revert immediately.
```
Rationale: Preserved files represent existing functionality that must not regress.

---

### R6 — Max 3 Correction Iterations
```
Per task, after each code-generation pass, the DEV agent runs (in order, all commands from input/tech/stack.md — skip any that are empty / undefined):
  1. LintCommand        (if defined)
  2. TypeCheckCommand   (if defined)
  3. BuildCommand       (required for this pipeline)
  4. TestCommand        (required — must meaningfully exercise generated code for this repo)

On any failure, enter the correction loop (same task, same agent):
  • Pass 1: direct fix against the failing command
  • Pass 2: holistic re-read of the active task file + design-spec or schema (when relevant) + stack — then fix
  • Pass 3: minimal safe fix — then re-run the full R6 command chain
  • After 3 failed passes: STOP. Write the human handoff report using `templates/error-report.md` **shape** at the per-task path **`<tasks-dir>/T-<TASK_ID>-error-report.md`**, where `<TASK_ID>` is the failing task's YAML `id` (`^T-\\d{3}$`). Do **not** write a singleton `error-report.md` that could clobber parallel failures.
      – Default mode:   `output/feats/feat-{name}/us-{N}/tasks/T-<TASK_ID>-error-report.md`
      – Spec-driven:    `<SPEC_DIR>/tasks/T-<TASK_ID>-error-report.md`
    Escalate to a human — do not spin further.

Forbidden shortcuts: --no-verify, // @ts-ignore (without justification), skip()'d tests,
                     stubbed return values to fool tests, removing assertions to green the run.
```

**Authoritative copy:** Only this section defines the correction loop normatively. Prompts (`agents/*.md`), mode packs (`agents/modes/**`), orchestrator commands (`commands/*.md`), and `docs/pipeline-overview.md` MUST link here instead of copying multi-step loop prose. They may keep **operational sequencing** (which task paths to load, when to invoke Bash) — not a second definition of passes 1–3.

Rationale: Infinite retry loops are expensive and rarely converge after 3 attempts
without a fundamentally different approach (which requires human judgment).
The error report is the formal handoff artifact — it captures the attempt log,
suspected root cause, and recommended human action.

---

### R7 — CLAUDE.md Snapshot Is Mandatory
```
After every successful DEV Phase run: /snapshot must execute.
CLAUDE.md must exist and be current before any subsequent agent run.
```
Rationale: Agents use CLAUDE.md to understand project state.
Stale or missing CLAUDE.md leads to redundant work or conflicting outputs.

---

### R8 — DB Agent Is Always READ-ONLY
```
❌ FORBIDDEN: Any DDL or DML from the DB Agent
✅ ONLY: SELECT statements on INFORMATION_SCHEMA or equivalent
```
Rationale: The DB Agent has production database credentials.
Any write operation could destroy data irreversibly.

---

### R9 — Agent Scope Boundaries
```
Frontend Agent → UI files only (components, pages, styles, client state)
Backend Agent  → Tech files only (services, DTOs, entities, endpoints, DB queries)
Neither agent may write files outside their designated scope.
```
Rationale: Clear ownership prevents conflicts when agents run in parallel.

### R10 — Agent Role Parity (Build-Order Rule)
```
No pipeline release adds a new agent role (agents/<role>-agent.md + manifest entry)
without corresponding qa-agent verification coverage.
```
The qa-agent must know how to verify the new role's outputs: file existence, schema conformance, DoD checks. Roles producing non-code artifacts (e.g., designer-agent → design-spec.md) must have structural validation in the qa-gate. Build order: Foundation (db, specification, frontend, backend) → Verification (qa) → Optional (devops, doc-gen). New roles insert into this pyramid at the appropriate layer; verification always covers them.

---

## Soft Guidelines (Strongly Recommended)

### G1 — US Count Per Feature
```
Recommended: 2–6 US per feature
Acceptable: More if the feature is genuinely large
Avoid: 1 mega-US (too broad) or 10+ micro-US (too fragmented)
```

### G2 — Spec Quality Before Running
```
A spec that is vague or incomplete will produce poor decomposition.
Use `planr spec create + shape` (planr CLI) to guide POs through writing complete specs, or fill in the placeholder body the pipeline auto-scaffolds on the first `/planr-pipeline:plan` invocation.
The Specification Agent's output quality is directly proportional
to the input spec quality.
```

### G3 — Run DB Agent Before PO Phase on New Projects
```
If the project has an existing database, always run Step 0.1 first.
The Specification Agent produces better task files when it can
reference real table and column names.
```

### G4 — Keep stack.md Up To Date
```
Update input/tech/stack.md whenever:
- A new dependency is added
- A naming convention changes
- A new stack file is added to .claude/stacks/
All agents read this file — stale stack.md = wrong generated code.
```

### G5 — Human Review Is Not Optional
```
Step 2 (Manual Review) exists for a reason.
Even if the decomposition looks correct at a glance, open every generated US and task file before approving `/ship`.
The checklist often surfaces issues invisible in a quick read.
```

### G6 — Design Spec Open Questions Must Be Resolved Before DEV
```
Section 10 of design-spec.md (Open Questions) must be cleared
before launching the DEV Phase.
Unresolved design ambiguities become bugs in UI code.
```

---

## The Core Warning

```
⚠️  THE FRAMEWORK INTENTIONALLY REFUSES A SINGLE PO → DEV COMMAND.

    Both phases must chain manually to guarantee quality and control.

    This is not a limitation. It is the primary design principle.
```

---

*See: `docs/pipeline-overview.md` · `docs/agent-model-map.md`*
